/**
 * long-running-checker.ts — Automatic health & hang checker for long-running Pi `bash` commands.
 *
 * Schedule:
 *   - First assessment after 90 seconds (`INITIAL_CHECK_MS = 90_000`)
 *   - Subsequent assessments every 10 minutes (`RECHECK_INTERVAL_MS = 600_000`) while running
 *
 * Two-stage AI assessment (Option A):
 *   1. Stage 1 (Fast Judge): Evaluates live command telemetry (command text, elapsed time,
 *      output bytes/lines delta since last check, time since last output chunk, stdout/stderr
 *      head+tail, and OS process-group snapshot via `ps` with CPU time delta and process states)
 *      to determine whether the command is `"working"` or `"stuck"`.
 *   2. Stage 2 (Coding Agent Decision): Only when Stage 1 flags `"stuck"`, queries the session's
 *      active coding agent model (`ctx.model`) with recent conversation context + the stuck
 *      assessment to decide `"kill"` vs `"wait"`.
 *      - If `"kill"`: terminates the `bash` child process group (`SIGTERM` -> `SIGKILL`) so
 *        `bash.execute()` returns immediately, and appends the diagnostic report to `tool_result`
 *        so the main agent turn can recover/retry right away.
 *      - If `"wait"`: leaves the command running and rechecks again in 10 minutes.
 */

import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

function isBashToolCall(
	event: unknown,
): event is { toolName: "bash"; toolCallId: string; input: { command: string; timeout?: number } } {
	if (!event || typeof event !== "object") return false;
	const candidate = event as { toolName?: unknown; toolCallId?: unknown; input?: unknown };
	if (candidate.toolName !== "bash" || typeof candidate.toolCallId !== "string") return false;
	if (!candidate.input || typeof candidate.input !== "object") return false;
	return typeof (candidate.input as { command?: unknown }).command === "string";
}

export const DEFAULT_INITIAL_CHECK_MS = 90_000; // 90 seconds
export const DEFAULT_RECHECK_INTERVAL_MS = 600_000; // 10 minutes
export const PID_DISCOVERY_DELAY_MS = 250;
export const STATUS_TICK_INTERVAL_MS = 5_000;
export const MODEL_CALL_TIMEOUT_MS = 30_000;
export const KILL_GRACE_MS = 3_000;
export const MAX_OUTPUT_SNAPSHOT_CHARS = 4_000;
export const STATUS_KEY = "long-running-checker";
const SESSION_KEY_PREFIX = "long-running-checker:";
const TRUNCATION_TAG = "\n...[truncated]...\n";

const FAMILY_FAST_CANDIDATES: Record<string, string[]> = {
	meta: ["muse-spark-1.4-internal", "muse-spark-1.3-internal", "muse-latest"],
	anthropic: ["claude-haiku-5-5", "claude-haiku-4-5", "claude-sonnet-5-5", "claude-sonnet-5"],
	google: [
		"gemini-3.8-flash",
		"gemini-3.6-flash",
		"gemini-3.5-flash",
		"gemini-3-flash-preview",
		"gemini-3.5-flash-lite",
		"gemini-2.5-flash",
	],
	openai: ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-mini", "gpt-5.5"],
};

const FAMILY_LIGHT_PATTERN: Record<string, RegExp> = {
	meta: /spark/i,
	openai: /luna|mini/i,
	anthropic: /haiku/i,
	google: /flash/i,
};

export interface ProcessEntry {
	pid: number;
	ppid: number;
	pgid: number;
	stat: string;
	elapsedSeconds: number;
	cpuSeconds: number;
	wchan: string;
	args: string;
}

export interface ProcessTreeSnapshot {
	shellPid?: number;
	pgid?: number;
	processes: ProcessEntry[];
	totalCpuSeconds: number;
	hasRunningOrRunnable: boolean;
	hasUninterruptibleDiskSleep: boolean;
	hasZombieOrStopped: boolean;
}

export interface CommandTelemetry {
	toolCallId: string;
	command: string;
	cwd: string;
	checkNumber: number;
	elapsedMs: number;
	silenceMs: number;
	totalOutputBytes: number;
	totalOutputLines: number;
	deltaOutputBytes: number;
	deltaOutputLines: number;
	outputUpdateCount: number;
	outputSnippet: string;
	processSnapshot: ProcessTreeSnapshot;
	deltaCpuSeconds: number;
	previousChecks: CheckHistoryEntry[];
}

export interface JudgeVerdict {
	status: "working" | "stuck";
	confidence: "high" | "medium" | "low";
	summary: string;
}

export interface AgentKillDecision {
	decision: "kill" | "wait";
	reason: string;
}

export interface CheckHistoryEntry {
	checkNumber: number;
	elapsedMs: number;
	status: "working" | "stuck";
	summary: string;
	agentDecision?: "kill" | "wait";
	agentReason?: string;
	totalOutputBytes: number;
	totalCpuSeconds: number;
}

export interface KilledCommandReport {
	checkNumber: number;
	elapsedMs: number;
	judgeSummary: string;
	agentReason: string;
	processSummary: string;
}

export interface TrackedCommand {
	toolCallId: string;
	command: string;
	timeoutSec?: number;
	cwd: string;
	startedAt: number;
	lastOutputAt: number;
	outputText: string;
	outputUpdateCount: number;
	checkCount: number;
	lastCheckedOutputBytes: number;
	lastCheckedOutputLines: number;
	lastCheckedCpuSeconds: number;
	shellPid?: number;
	pgid?: number;
	preExistingChildPids: Set<number>;
	checkHistory: CheckHistoryEntry[];
	timer?: ReturnType<typeof setTimeout>;
	pidTimer?: ReturnType<typeof setTimeout>;
	nextCheckDueAt?: number;
	remainingMsWhenPaused?: number;
	checking: boolean;
	killedReport?: KilledCommandReport;
	ctx: ExtensionContext;
}

export interface CheckerConfig {
	initialCheckMs: number;
	recheckIntervalMs: number;
	enabled: boolean;
}

export interface LongRunningCheckerDeps {
	now?: () => number;
	piPid?: number;
	initialCheckMs?: number;
	recheckIntervalMs?: number;
	listProcesses?: () => Promise<ProcessEntry[]>;
	killProcessGroup?: (shellPid: number, pgid: number | undefined, processes: ProcessEntry[]) => Promise<void>;
	runJudge?: (telemetry: CommandTelemetry, ctx: ExtensionContext) => Promise<JudgeVerdict | null>;
	runAgentDecision?: (
		telemetry: CommandTelemetry,
		judgeVerdict: JudgeVerdict,
		ctx: ExtensionContext,
	) => Promise<AgentKillDecision | null>;
}

const JUDGE_SYSTEM_PROMPT = `You are the long-running command health judge inside Pi (a coding agent harness).
A \`bash\` tool call has been running for over 90 seconds. Your job is to assess the live telemetry (command, elapsed time, output growth since the last check, time since last output chunk, stdout/stderr snippet, and OS process tree with CPU deltas and kernel wait channels) and classify whether the command is STILL WORKING or STUCK.

Return ONLY a single JSON object with no markdown fences or extra prose:
{"status": "working" | "stuck", "confidence": "high" | "medium" | "low", "summary": "concise 1-sentence diagnosis"}

Guidelines for "working":
1. Active progress: New output bytes/lines arrived since the last check, or child processes accumulated CPU time (deltaCpuSeconds > 0), or processes are in runnable ('R') or active disk/network wait for a legitimate batch operation.
2. Legitimate long-running jobs that often produce sparse output while polling or computing:
   - Dataswarm / Chronos jobs (\`dataswarm-cli daemon execute tester\`, \` dataswarm-cli ... status/linter\`, \`chronos\`, \`chronos-watcher\`, \`nbackfill\`)
   - Builds and test suites (\`buck2 build\`, \`buck2 test\`, \`tpx\`, \`cargo\`, \`bun test\`, \`npm\`, \`pytest\`, \`arc unit\`, \`arc dsfmt\`, \`hh\`)
   - Data queries (\`presto\`, \`db\`, \`scuba\`)
   - Environment & source control operations (\`devenv-admin lease reserve-and-wait\`, \`sl pull\`, \`sl goto\`, \`sl rebase\`, \`jf submit\`, \`git clone/fetch/push\`)
   - Explicit sleeps or polling loops (\`sleep\`, \`while ...\`, \`wait\`)

Guidelines for "stuck":
1. Fatal-then-hung worker: Output contains a fatal error, exception, or abort message (for example \`You are running a very old revision of WWW\`, \`DevserverCustomConfig::assertRevisionIsOK\`, \`Fatal error\`, \`Traceback\`, \`Segmentation fault\`, \`Address already in use\`), yet the wrapper/client process (such as \`phps\`) is still sitting idle with 0 CPU delta waiting forever.
2. Blocked on interactive input: Output ends with an interactive prompt waiting for stdin (e.g. \`[y/N]\`, \`Password:\`, \`Passphrase\`, \`Proceed?\`, \`Press Enter\`, \`(yes/no)\`, or an interactive REPL/pager like \`less\`/\`more\`/\`vim\`) and no stdin will ever be sent.
3. Dead/zombie/stopped subtree: All child processes are zombies ('Z') or stopped ('T'), or the command is supposed to be a fast local operation (e.g., \`cat\`, \`sed\`, \`grep\` without path reading stdin, hung \`ssh\` handshake) with 0 CPU delta and 0 output for a long period.`;

const AGENT_DECISION_SYSTEM_PROMPT = `You are the coding agent in this Pi session. One of your in-flight \`bash\` tool calls has been flagged as potentially STUCK by the long-running command health checker.
Review the user's goal, your recent actions, the command's live output, the OS process tree, and the health judge's diagnosis.
Decide whether to KILL the stuck command now (so the tool call returns immediately and you can recover, fix the issue, or try another approach) or WAIT another 10 minutes.

Return ONLY a single JSON object with no markdown fences or extra prose:
{"decision": "kill" | "wait", "reason": "concise 1-sentence explanation of why you are killing or waiting"}

Rules:
- Choose "kill" if the command is genuinely hung, waiting on interactive stdin, hit an init-time fatal (such as a stale WWW checkout in \`phps\`), or is wedged with no realistic chance of completing cleanly.
- Choose "wait" if the command is legitimately waiting on a long build, remote lease, backfill, Presto query, or Chronos job that you still expect to finish.`;

export function truncateHeadTail(text: string, maxCharacters = MAX_OUTPUT_SNAPSHOT_CHARS): string {
	if (typeof text !== "string" || text.length <= maxCharacters) {
		return text ?? "";
	}
	const available = Math.max(0, maxCharacters - TRUNCATION_TAG.length);
	const headLength = Math.floor(available * 0.35);
	const tailLength = available - headLength;
	return tailLength > 0
		? `${text.slice(0, headLength)}${TRUNCATION_TAG}${text.slice(text.length - tailLength)}`
		: `${text.slice(0, headLength)}${TRUNCATION_TAG}`;
}

export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) {
		return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
	}
	if (minutes > 0) {
		return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`;
	}
	return `${seconds}s`;
}

/**
 * Parse `ps` duration strings (`[[dd-]hh:]mm:ss[.xx]` or integer seconds) into seconds.
 */
export function parsePsDurationSeconds(raw: string): number {
	const trimmed = raw.trim();
	if (!trimmed) return 0;
	if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
		return Math.floor(Number.parseFloat(trimmed));
	}
	let days = 0;
	let timePart = trimmed;
	const dashIdx = trimmed.indexOf("-");
	if (dashIdx !== -1) {
		days = Number.parseInt(trimmed.slice(0, dashIdx), 10) || 0;
		timePart = trimmed.slice(dashIdx + 1);
	}
	const parts = timePart.split(":").map((part) => Number.parseFloat(part) || 0);
	if (parts.length === 3) {
		return Math.floor(days * 86400 + parts[0]! * 3600 + parts[1]! * 60 + parts[2]!);
	}
	if (parts.length === 2) {
		return Math.floor(days * 86400 + parts[0]! * 60 + parts[1]!);
	}
	return 0;
}

/**
 * Parse output of `ps -eo pid=,ppid=,pgid=,stat=,etime=,time=,wchan=,args=`.
 */
export function parsePsOutput(stdout: string): ProcessEntry[] {
	const entries: ProcessEntry[] = [];
	const lines = stdout.split("\n");
	const lineRegex = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/;
	for (const line of lines) {
		if (!line.trim()) continue;
		const match = lineRegex.exec(line);
		if (!match) continue;
		const pid = Number.parseInt(match[1]!, 10);
		const ppid = Number.parseInt(match[2]!, 10);
		const pgid = Number.parseInt(match[3]!, 10);
		const stat = match[4]!;
		const elapsedSeconds = parsePsDurationSeconds(match[5]!);
		const cpuSeconds = parsePsDurationSeconds(match[6]!);
		const wchan = match[7]!;
		const args = match[8]!.trim();
		if (Number.isNaN(pid) || Number.isNaN(ppid) || Number.isNaN(pgid)) continue;
		entries.push({ pid, ppid, pgid, stat, elapsedSeconds, cpuSeconds, wchan, args });
	}
	return entries;
}

export async function defaultListProcesses(): Promise<ProcessEntry[]> {
	return new Promise((resolve) => {
		execFile(
			"ps",
			["-eo", "pid=,ppid=,pgid=,stat=,etime=,time=,wchan=,args="],
			{ timeout: 4_000, maxBuffer: 8 * 1024 * 1024 },
			(error, stdout) => {
				if (error && !stdout) {
					resolve([]);
					return;
				}
				resolve(parsePsOutput(String(stdout ?? "")));
			},
		);
	});
}

function normalizeCommandSnippet(cmd: string): string {
	return cmd.replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * Resolve the shell child PID and full descendant/process-group tree for a tracked command.
 */
export function buildProcessTreeSnapshot(
	allProcesses: ProcessEntry[],
	piPid: number,
	record: Pick<TrackedCommand, "command" | "shellPid" | "pgid" | "preExistingChildPids">,
	claimedShellPids: Set<number>,
): ProcessTreeSnapshot {
	let shellPid = record.shellPid;
	let pgid = record.pgid;

	if (shellPid !== undefined && !allProcesses.some((p) => p.pid === shellPid)) {
		// Shell process may have exited while leaving background children in the same pgid
		if (pgid === undefined) {
			pgid = shellPid;
		}
	}

	if (shellPid === undefined) {
		const directChildren = allProcesses.filter(
			(p) =>
				p.ppid === piPid &&
				!record.preExistingChildPids.has(p.pid) &&
				!claimedShellPids.has(p.pid) &&
				!/\bps\b.*wchan/.test(p.args),
		);
		const snippet = normalizeCommandSnippet(record.command);
		const matchedByCommand = snippet
			? directChildren.find((p) => p.args.replace(/\s+/g, " ").includes(snippet))
			: undefined;
		const chosen = matchedByCommand ?? directChildren[0];
		if (chosen) {
			shellPid = chosen.pid;
			pgid = chosen.pgid || chosen.pid;
		}
	}

	if (shellPid === undefined && pgid === undefined) {
		return {
			processes: [],
			totalCpuSeconds: 0,
			hasRunningOrRunnable: false,
			hasUninterruptibleDiskSleep: false,
			hasZombieOrStopped: false,
		};
	}

	const subtreePids = new Set<number>();
	if (shellPid !== undefined) subtreePids.add(shellPid);

	// Collect all processes in the same process group or descending from shellPid
	let added = true;
	while (added) {
		added = false;
		for (const proc of allProcesses) {
			if (subtreePids.has(proc.pid)) continue;
			if ((pgid !== undefined && proc.pgid === pgid) || subtreePids.has(proc.ppid)) {
				subtreePids.add(proc.pid);
				added = true;
			}
		}
	}

	const processes = allProcesses.filter((p) => subtreePids.has(p.pid));
	const totalCpuSeconds = processes.reduce((sum, p) => sum + p.cpuSeconds, 0);
	const hasRunningOrRunnable = processes.some((p) => p.stat.startsWith("R"));
	const hasUninterruptibleDiskSleep = processes.some((p) => p.stat.startsWith("D"));
	const hasZombieOrStopped = processes.some((p) => p.stat.startsWith("Z") || p.stat.startsWith("T"));

	return {
		shellPid,
		pgid,
		processes,
		totalCpuSeconds,
		hasRunningOrRunnable,
		hasUninterruptibleDiskSleep,
		hasZombieOrStopped,
	};
}

export async function defaultKillProcessGroup(
	shellPid: number,
	pgid: number | undefined,
	processes: ProcessEntry[],
): Promise<void> {
	const targetPgid = pgid ?? shellPid;
	try {
		process.kill(-targetPgid, "SIGTERM");
	} catch {
		// Fall back to signaling individual PIDs
		for (const proc of processes) {
			try {
				process.kill(proc.pid, "SIGTERM");
			} catch {
				// Ignore ESRCH
			}
		}
	}

	await new Promise((resolve) => setTimeout(resolve, KILL_GRACE_MS));

	try {
		process.kill(-targetPgid, "SIGKILL");
	} catch {
		for (const proc of processes) {
			try {
				process.kill(proc.pid, "SIGKILL");
			} catch {
				// Ignore ESRCH
			}
		}
	}
}

function inferModelFamily(model: any): string | undefined {
	const prov = typeof model?.provider === "string" ? model.provider.toLowerCase().trim() : "";
	if (prov in FAMILY_FAST_CANDIDATES) return prov;
	const id = typeof model?.id === "string" ? model.id.toLowerCase().trim() : "";
	if (id.startsWith("muse") || prov.includes("meta") || prov.includes("muse")) return "meta";
	if (id.startsWith("gpt-") || id.includes("luna") || id.includes("sol") || prov.includes("openai")) return "openai";
	if (
		id.startsWith("claude") ||
		id.includes("haiku") ||
		id.includes("sonnet") ||
		id.includes("opus") ||
		id.includes("fable") ||
		prov.includes("anthropic")
	) {
		return "anthropic";
	}
	if (id.startsWith("gemini") || prov.includes("google")) return "google";
	return undefined;
}

function isModelUsable(registry: any, model: any): boolean {
	if (!model) return false;
	if (typeof registry?.hasConfiguredAuth === "function") {
		return registry.hasConfiguredAuth(model);
	}
	return true;
}

export function resolveFastJudgeModels(registry: any, fallbackModel: any): any[] {
	if (!registry) return fallbackModel ? [fallbackModel] : [];
	const preferredFamily = inferModelFamily(fallbackModel);
	const providerOrder = [
		...(preferredFamily ? [preferredFamily] : []),
		...Object.keys(FAMILY_FAST_CANDIDATES).filter((p) => p !== preferredFamily),
	];
	const seen = new Set<string>();
	const addCandidate = (list: any[], m: any) => {
		if (!m || !isModelUsable(registry, m)) return;
		const key = `${m.provider ?? ""}/${m.id ?? ""}`;
		if (seen.has(key)) return;
		seen.add(key);
		list.push(m);
	};

	for (const prov of providerOrder) {
		const familyModels: any[] = [];
		for (const id of FAMILY_FAST_CANDIDATES[prov] ?? []) {
			const found = registry.find?.(prov, id);
			if (found !== undefined) {
				addCandidate(familyModels, found);
			}
		}
		const lightPattern = FAMILY_LIGHT_PATTERN[prov];
		if (lightPattern && typeof registry.getAll === "function") {
			for (const m of registry.getAll() ?? []) {
				if (m?.provider === prov && typeof m?.id === "string" && lightPattern.test(m.id)) {
					addCandidate(familyModels, m);
				}
			}
		}
		if (prov === preferredFamily && familyModels.length === 0) {
			addCandidate(familyModels, fallbackModel);
		}
		if (familyModels.length > 0) {
			return familyModels;
		}
	}
	return fallbackModel ? [fallbackModel] : [];
}

function extractTextFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			if (part && typeof part === "object" && (part as any).type === "text" && typeof (part as any).text === "string") {
				return (part as any).text;
			}
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

export function parseJsonObject<T extends Record<string, unknown>>(raw: string): T | null {
	if (!raw || typeof raw !== "string") return null;
	const stripped = raw
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/i, "")
		.trim();
	const candidates = [stripped];
	const firstBrace = stripped.indexOf("{");
	const lastBrace = stripped.lastIndexOf("}");
	if (firstBrace !== -1 && lastBrace > firstBrace) {
		candidates.push(stripped.slice(firstBrace, lastBrace + 1));
	}
	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as T;
			}
		} catch {
			// Continue trying next candidate
		}
	}
	return null;
}

export function parseJudgeVerdict(raw: string): JudgeVerdict | null {
	const obj = parseJsonObject<{ status?: unknown; confidence?: unknown; summary?: unknown }>(raw);
	if (!obj) return null;
	const status = typeof obj.status === "string" ? obj.status.toLowerCase().trim() : "";
	if (status !== "working" && status !== "stuck") return null;
	const confRaw = typeof obj.confidence === "string" ? obj.confidence.toLowerCase().trim() : "medium";
	const confidence: "high" | "medium" | "low" =
		confRaw === "high" || confRaw === "medium" || confRaw === "low" ? confRaw : "medium";
	const summary =
		typeof obj.summary === "string" && obj.summary.trim()
			? obj.summary.trim()
			: status === "working"
				? "Command appears to be progressing normally."
				: "Command appears to be stuck with no progress.";
	return { status, confidence, summary };
}

export function parseAgentKillDecision(raw: string): AgentKillDecision | null {
	const obj = parseJsonObject<{ decision?: unknown; reason?: unknown }>(raw);
	if (!obj) return null;
	const decision = typeof obj.decision === "string" ? obj.decision.toLowerCase().trim() : "";
	if (decision !== "kill" && decision !== "wait") return null;
	const reason =
		typeof obj.reason === "string" && obj.reason.trim()
			? obj.reason.trim()
			: decision === "kill"
				? "Command is stuck and should be terminated so the agent can recover."
				: "Command is legitimately running and should be given another 10 minutes.";
	return { decision, reason };
}

async function callModelText(
	registry: any,
	model: any,
	systemPrompt: string,
	userText: string,
	options: { reasoning?: "off" | "low"; sessionId?: string; timeoutMs?: number; parentSignal?: AbortSignal } = {},
): Promise<string | null> {
	if (!registry || !model) return null;
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? MODEL_CALL_TIMEOUT_MS);
	const onParentAbort = () => controller.abort();
	options.parentSignal?.addEventListener("abort", onParentAbort, { once: true });

	try {
		const context = {
			systemPrompt,
			messages: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: userText }],
					timestamp: Date.now(),
				},
			],
		};

		let response: any;
		if (typeof registry.streamSimple === "function") {
			const stream = registry.streamSimple(model, context, {
				signal: controller.signal,
				reasoning: options.reasoning ?? "off",
				maxRetries: 0,
				...(options.sessionId ? { sessionId: `${SESSION_KEY_PREFIX}${options.sessionId}` } : {}),
			});
			if (stream && typeof stream.result === "function") {
				response = await stream.result();
			}
		}
		if (!response && typeof registry.complete === "function") {
			response = await registry.complete(model, context, { signal: controller.signal });
		}
		if (!response || response.stopReason === "aborted") return null;
		const text = extractTextFromContent(response.content).trim();
		return text || null;
	} catch {
		return null;
	} finally {
		clearTimeout(timeoutId);
		options.parentSignal?.removeEventListener("abort", onParentAbort);
	}
}

export function formatTelemetryPayload(telemetry: CommandTelemetry): string {
	const payload = {
		command: telemetry.command,
		cwd: telemetry.cwd,
		checkNumber: telemetry.checkNumber,
		elapsed: formatDuration(telemetry.elapsedMs),
		elapsedSeconds: Math.round(telemetry.elapsedMs / 1000),
		timeSinceLastOutput: formatDuration(telemetry.silenceMs),
		timeSinceLastOutputSeconds: Math.round(telemetry.silenceMs / 1000),
		output: {
			totalBytes: telemetry.totalOutputBytes,
			totalLines: telemetry.totalOutputLines,
			deltaBytesSinceLastCheck: telemetry.deltaOutputBytes,
			deltaLinesSinceLastCheck: telemetry.deltaOutputLines,
			streamChunksReceived: telemetry.outputUpdateCount,
			snippet: telemetry.outputSnippet || "(no output emitted yet)",
		},
		osProcessTree: {
			shellPid: telemetry.processSnapshot.shellPid ?? null,
			pgid: telemetry.processSnapshot.pgid ?? null,
			totalCpuSeconds: telemetry.processSnapshot.totalCpuSeconds,
			deltaCpuSecondsSinceLastCheck: telemetry.deltaCpuSeconds,
			hasRunningOrRunnable: telemetry.processSnapshot.hasRunningOrRunnable,
			hasUninterruptibleDiskSleep: telemetry.processSnapshot.hasUninterruptibleDiskSleep,
			hasZombieOrStopped: telemetry.processSnapshot.hasZombieOrStopped,
			processes: telemetry.processSnapshot.processes.map((p) => ({
				pid: p.pid,
				ppid: p.ppid,
				stat: p.stat,
				elapsedSec: p.elapsedSeconds,
				cpuSec: p.cpuSeconds,
				wchan: p.wchan,
				args: truncateHeadTail(p.args, 200),
			})),
		},
		previousChecks: telemetry.previousChecks,
	};
	return JSON.stringify(payload, null, 2);
}

export function extractRecentSessionSummary(ctx: ExtensionContext, maxMessages = 4): string {
	try {
		const branch = (ctx.sessionManager?.getBranch?.() ?? []) as Array<{
			type?: string;
			message?: { role?: string; content?: unknown };
		}>;
		const items: string[] = [];
		for (let i = branch.length - 1; i >= 0 && items.length < maxMessages; i -= 1) {
			const entry = branch[i];
			if (entry?.type !== "message" || !entry.message?.role) continue;
			const role = entry.message.role;
			if (role !== "user" && role !== "assistant") continue;
			const text = truncateHeadTail(extractTextFromContent(entry.message.content).trim(), 600);
			if (!text) continue;
			items.unshift(`[${role}]: ${text}`);
		}
		return items.length > 0 ? items.join("\n\n") : "(no prior conversation messages)";
	} catch {
		return "(unavailable)";
	}
}

export async function defaultRunJudge(
	telemetry: CommandTelemetry,
	ctx: ExtensionContext,
): Promise<JudgeVerdict | null> {
	const candidates = resolveFastJudgeModels(ctx.modelRegistry, ctx.model);
	if (candidates.length === 0) return null;
	const sessionId = ctx.sessionManager?.getSessionId?.();
	const userPrompt = `Assess this long-running bash command telemetry:\n\n${formatTelemetryPayload(telemetry)}`;

	for (const model of candidates) {
		for (const reasoning of ["off", "low"] as const) {
			const raw = await callModelText(ctx.modelRegistry, model, JUDGE_SYSTEM_PROMPT, userPrompt, {
				reasoning,
				sessionId,
				parentSignal: ctx.signal,
			});
			if (!raw) continue;
			const parsed = parseJudgeVerdict(raw);
			if (parsed) return parsed;
		}
	}
	return null;
}

export async function defaultRunAgentDecision(
	telemetry: CommandTelemetry,
	judgeVerdict: JudgeVerdict,
	ctx: ExtensionContext,
): Promise<AgentKillDecision | null> {
	const models = [
		...(ctx.model ? [ctx.model] : []),
		...resolveFastJudgeModels(ctx.modelRegistry, ctx.model).filter((m) => m !== ctx.model),
	];
	if (models.length === 0) return null;
	const sessionId = ctx.sessionManager?.getSessionId?.();
	const sessionContext = extractRecentSessionSummary(ctx);
	const userPrompt = [
		`<recent_session_context>\n${sessionContext}\n</recent_session_context>`,
		`<judge_assessment>\n${JSON.stringify(judgeVerdict, null, 2)}\n</judge_assessment>`,
		`<command_telemetry>\n${formatTelemetryPayload(telemetry)}\n</command_telemetry>`,
		"Should we kill this stuck command now or wait another 10 minutes?",
	].join("\n\n");

	for (const model of models) {
		for (const reasoning of ["off", "low"] as const) {
			const raw = await callModelText(ctx.modelRegistry, model, AGENT_DECISION_SYSTEM_PROMPT, userPrompt, {
				reasoning,
				sessionId,
				parentSignal: ctx.signal,
			});
			if (!raw) continue;
			const parsed = parseAgentKillDecision(raw);
			if (parsed) return parsed;
		}
	}
	return null;
}

export function formatProcessSummary(snapshot: ProcessTreeSnapshot): string {
	if (snapshot.processes.length === 0) {
		return "no active child processes found";
	}
	return snapshot.processes
		.map(
			(p) =>
				`pid=${p.pid} stat=${p.stat} cpu=${p.cpuSeconds}s wchan=${p.wchan} cmd=${truncateHeadTail(p.args, 80)}`,
		)
		.join("; ");
}

export function formatKilledReportBlock(report: KilledCommandReport): string {
	return [
		`[Long-Running Command Checker: command terminated at ${formatDuration(report.elapsedMs)} (check #${report.checkNumber})]`,
		`- Health judge assessment: ${report.judgeSummary}`,
		`- Agent decision: kill — ${report.agentReason}`,
		`- OS process state at termination: ${report.processSummary}`,
	].join("\n");
}

function countLines(text: string): number {
	if (!text) return 0;
	return text.split("\n").length;
}

function firstCommandLine(cmd: string, maxLen = 50): string {
	const first = cmd.replace(/\r\n?/g, "\n").trim().split("\n")[0] ?? "";
	return first.length <= maxLen ? first : `${first.slice(0, maxLen - 1)}…`;
}

export default function longRunningCheckerExtension(pi: ExtensionAPI, deps: LongRunningCheckerDeps = {}) {
	const now = deps.now ?? Date.now;
	const piPid = deps.piPid ?? process.pid;
	const listProcesses = deps.listProcesses ?? defaultListProcesses;
	const killProcessGroup = deps.killProcessGroup ?? defaultKillProcessGroup;
	const runJudge = deps.runJudge ?? defaultRunJudge;
	const runAgentDecision = deps.runAgentDecision ?? defaultRunAgentDecision;

	const config: CheckerConfig = {
		initialCheckMs: deps.initialCheckMs ?? DEFAULT_INITIAL_CHECK_MS,
		recheckIntervalMs: deps.recheckIntervalMs ?? DEFAULT_RECHECK_INTERVAL_MS,
		enabled: true,
	};

	const activeCommands = new Map<string, TrackedCommand>();
	const completedReports = new Map<string, KilledCommandReport>();
	let uiPromptOpen = false;
	let lateToolCallUnsubscribe: (() => void) | undefined;

	function updateFooterStatus(ctx?: ExtensionContext): void {
		const targetCtx = ctx ?? Array.from(activeCommands.values())[0]?.ctx;
		if (!targetCtx?.hasUI) return;

		if (!config.enabled || activeCommands.size === 0) {
			targetCtx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}

		// Only show footer status once a command has been checked at least once or is currently being checked
		const checkedOrChecking = Array.from(activeCommands.values()).filter(
			(cmd) => cmd.checking || cmd.checkCount > 0,
		);
		if (checkedOrChecking.length === 0) {
			targetCtx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}

		const primary = checkedOrChecking[0]!;
		const elapsed = formatDuration(now() - primary.startedAt);
		if (primary.checking) {
			targetCtx.ui.setStatus(
				STATUS_KEY,
				targetCtx.ui.theme.fg("warning", `⏳ checking cmd (${elapsed})…`),
			);
			return;
		}

		const lastCheck = primary.checkHistory[primary.checkHistory.length - 1];
		const statusLabel = lastCheck?.status === "stuck" ? "flagged-waiting" : "working";
		const color = lastCheck?.status === "stuck" ? "warning" : "accent";
		targetCtx.ui.setStatus(
			STATUS_KEY,
			targetCtx.ui.theme.fg(
				color,
				`⏳ cmd ${statusLabel} (${elapsed}, #${primary.checkCount}, next 10m)`,
			),
		);
	}

	function clearTimers(record: TrackedCommand): void {
		if (record.timer !== undefined) {
			clearTimeout(record.timer);
			record.timer = undefined;
		}
		if (record.pidTimer !== undefined) {
			clearTimeout(record.pidTimer);
			record.pidTimer = undefined;
		}
		record.nextCheckDueAt = undefined;
	}

	function scheduleCheck(record: TrackedCommand, delayMs: number): void {
		if (record.timer !== undefined) {
			clearTimeout(record.timer);
			record.timer = undefined;
		}
		if (!config.enabled) return;
		if (uiPromptOpen) {
			record.remainingMsWhenPaused = delayMs;
			record.nextCheckDueAt = undefined;
			return;
		}
		record.remainingMsWhenPaused = undefined;
		record.nextCheckDueAt = now() + delayMs;
		record.timer = setTimeout(() => {
			record.timer = undefined;
			void performCheck(record.toolCallId);
		}, delayMs);
	}

	function pauseAllTimers(): void {
		const currentNow = now();
		for (const record of activeCommands.values()) {
			if (record.timer !== undefined && record.nextCheckDueAt !== undefined) {
				const remaining = Math.max(1, record.nextCheckDueAt - currentNow);
				clearTimeout(record.timer);
				record.timer = undefined;
				record.remainingMsWhenPaused = remaining;
				record.nextCheckDueAt = undefined;
			}
		}
	}

	function resumeAllTimers(): void {
		for (const record of activeCommands.values()) {
			if (record.timer === undefined && record.remainingMsWhenPaused !== undefined && !record.checking) {
				const delay = record.remainingMsWhenPaused;
				record.remainingMsWhenPaused = undefined;
				scheduleCheck(record, delay);
			}
		}
	}

	function getClaimedShellPids(excludeToolCallId?: string): Set<number> {
		const claimed = new Set<number>();
		for (const [id, cmd] of activeCommands.entries()) {
			if (id !== excludeToolCallId && cmd.shellPid !== undefined) {
				claimed.add(cmd.shellPid);
			}
		}
		return claimed;
	}

	async function discoverShellPid(toolCallId: string): Promise<void> {
		const record = activeCommands.get(toolCallId);
		if (!record || record.shellPid !== undefined) return;
		const procs = await listProcesses();
		if (!activeCommands.has(toolCallId)) return;
		const snapshot = buildProcessTreeSnapshot(
			procs,
			piPid,
			record,
			getClaimedShellPids(toolCallId),
		);
		if (snapshot.shellPid !== undefined) {
			record.shellPid = snapshot.shellPid;
			record.pgid = snapshot.pgid;
		}
	}

	async function performCheck(toolCallId: string): Promise<void> {
		const record = activeCommands.get(toolCallId);
		if (!record || !config.enabled) return;
		if (uiPromptOpen) {
			scheduleCheck(record, 5_000);
			return;
		}

		record.checking = true;
		const checkNumber = record.checkCount + 1;
		updateFooterStatus(record.ctx);

		try {
			const procs = await listProcesses();
			if (!activeCommands.has(toolCallId)) return;

			const processSnapshot = buildProcessTreeSnapshot(
				procs,
				piPid,
				record,
				getClaimedShellPids(toolCallId),
			);
			if (processSnapshot.shellPid !== undefined && record.shellPid === undefined) {
				record.shellPid = processSnapshot.shellPid;
				record.pgid = processSnapshot.pgid;
			}

			const currentNow = now();
			const elapsedMs = Math.max(0, currentNow - record.startedAt);
			const silenceMs = Math.max(0, currentNow - record.lastOutputAt);
			const totalOutputBytes = Buffer.byteLength(record.outputText, "utf8");
			const totalOutputLines = countLines(record.outputText);
			const deltaOutputBytes = Math.max(0, totalOutputBytes - record.lastCheckedOutputBytes);
			const deltaOutputLines = Math.max(0, totalOutputLines - record.lastCheckedOutputLines);
			const deltaCpuSeconds = Math.max(
				0,
				processSnapshot.totalCpuSeconds - record.lastCheckedCpuSeconds,
			);

			const telemetry: CommandTelemetry = {
				toolCallId,
				command: record.command,
				cwd: record.cwd,
				checkNumber,
				elapsedMs,
				silenceMs,
				totalOutputBytes,
				totalOutputLines,
				deltaOutputBytes,
				deltaOutputLines,
				outputUpdateCount: record.outputUpdateCount,
				outputSnippet: truncateHeadTail(record.outputText, MAX_OUTPUT_SNAPSHOT_CHARS),
				processSnapshot,
				deltaCpuSeconds,
				previousChecks: [...record.checkHistory],
			};

			record.lastCheckedOutputBytes = totalOutputBytes;
			record.lastCheckedOutputLines = totalOutputLines;
			record.lastCheckedCpuSeconds = processSnapshot.totalCpuSeconds;
			record.checkCount = checkNumber;

			// Stage 1: Fast Judge assessment
			const verdict =
				(await runJudge(telemetry, record.ctx)) ?? {
					status: "working" as const,
					confidence: "low" as const,
					summary: "Health judge unavailable; assuming command is still working.",
				};

			if (!activeCommands.has(toolCallId)) return;

			if (verdict.status === "working") {
				record.checkHistory.push({
					checkNumber,
					elapsedMs,
					status: "working",
					summary: verdict.summary,
					totalOutputBytes,
					totalCpuSeconds: processSnapshot.totalCpuSeconds,
				});
				record.checking = false;
				updateFooterStatus(record.ctx);
				if (record.ctx.hasUI) {
					record.ctx.ui.notify(
						`⏳ [${formatDuration(elapsedMs)}] ${firstCommandLine(record.command)}: ${verdict.summary} (next check in ${formatDuration(config.recheckIntervalMs)})`,
						"info",
					);
				}
				scheduleCheck(record, config.recheckIntervalMs);
				return;
			}

			// Stage 2: Command was flagged as "stuck" — let the session's coding agent model decide whether to kill or wait
			const agentDecision =
				(await runAgentDecision(telemetry, verdict, record.ctx)) ?? {
					decision: "wait" as const,
					reason: "Agent decision call unavailable; defaulting to waiting another 10 minutes.",
				};

			if (!activeCommands.has(toolCallId)) return;

			record.checkHistory.push({
				checkNumber,
				elapsedMs,
				status: "stuck",
				summary: verdict.summary,
				agentDecision: agentDecision.decision,
				agentReason: agentDecision.reason,
				totalOutputBytes,
				totalCpuSeconds: processSnapshot.totalCpuSeconds,
			});

			if (agentDecision.decision === "wait") {
				record.checking = false;
				updateFooterStatus(record.ctx);
				if (record.ctx.hasUI) {
					record.ctx.ui.notify(
						`⚠️ [${formatDuration(elapsedMs)}] Flagged as stuck (${verdict.summary}), but agent chose to wait: ${agentDecision.reason} (rechecking in ${formatDuration(config.recheckIntervalMs)})`,
						"warning",
					);
				}
				scheduleCheck(record, config.recheckIntervalMs);
				return;
			}

			// Agent decided to KILL the stuck command
			const processSummary = formatProcessSummary(processSnapshot);
			const report: KilledCommandReport = {
				checkNumber,
				elapsedMs,
				judgeSummary: verdict.summary,
				agentReason: agentDecision.reason,
				processSummary,
			};
			record.killedReport = report;
			completedReports.set(toolCallId, report);
			record.checking = false;

			if (record.ctx.hasUI) {
				record.ctx.ui.notify(
					`🛑 [${formatDuration(elapsedMs)}] Terminating stuck command (${firstCommandLine(record.command)}): ${agentDecision.reason}`,
					"error",
				);
			}

			if (processSnapshot.shellPid !== undefined) {
				await killProcessGroup(
					processSnapshot.shellPid,
					processSnapshot.pgid,
					processSnapshot.processes,
				);
			}
			updateFooterStatus(record.ctx);
		} finally {
			const latest = activeCommands.get(toolCallId);
			if (latest && latest.checking) {
				latest.checking = false;
				updateFooterStatus(latest.ctx);
			}
		}
	}

	async function startTrackingBashCall(
		toolCallId: string,
		command: string,
		timeoutSec: number | undefined,
		ctx: ExtensionContext,
	): Promise<void> {
		if (!config.enabled || activeCommands.has(toolCallId)) return;

		const existingProcs = await listProcesses();
		const preExistingChildPids = new Set(
			existingProcs.filter((p) => p.ppid === piPid).map((p) => p.pid),
		);

		const startTs = now();
		const record: TrackedCommand = {
			toolCallId,
			command,
			timeoutSec,
			cwd: ctx.cwd,
			startedAt: startTs,
			lastOutputAt: startTs,
			outputText: "",
			outputUpdateCount: 0,
			checkCount: 0,
			lastCheckedOutputBytes: 0,
			lastCheckedOutputLines: 0,
			lastCheckedCpuSeconds: 0,
			preExistingChildPids,
			checkHistory: [],
			checking: false,
			ctx,
		};

		activeCommands.set(toolCallId, record);

		record.pidTimer = setTimeout(() => {
			record.pidTimer = undefined;
			void discoverShellPid(toolCallId);
		}, PID_DISCOVERY_DELAY_MS);

		scheduleCheck(record, config.initialCheckMs);
	}

	function stopTrackingCommand(toolCallId: string, ctx?: ExtensionContext): void {
		const record = activeCommands.get(toolCallId);
		if (!record) return;
		clearTimers(record);
		activeCommands.delete(toolCallId);
		updateFooterStatus(ctx ?? record.ctx);
	}

	function stopAllCommands(ctx?: ExtensionContext): void {
		for (const record of activeCommands.values()) {
			clearTimers(record);
		}
		activeCommands.clear();
		completedReports.clear();
		updateFooterStatus(ctx);
	}

	function bindLateToolCallListener(): void {
		lateToolCallUnsubscribe?.();
		// Registered in session_start so this handler runs AFTER permission gates
		// registered during extension factory initialization (such as pi-permission-system).
		lateToolCallUnsubscribe = pi.on("tool_call", async (event, ctx) => {
			if (!isBashToolCall(event)) return;
			await startTrackingBashCall(
				event.toolCallId,
				event.input.command,
				event.input.timeout,
				ctx,
			);
		});
	}

	// Bind once at factory time as fallback for harnesses that don't emit session_start,
	// then re-bind at the tail of the tool_call chain on session_start.
	bindLateToolCallListener();

	pi.on("session_start", async (_event, ctx) => {
		bindLateToolCallListener();
		updateFooterStatus(ctx);
	});

	pi.on("ui_prompt_start", () => {
		uiPromptOpen = true;
		pauseAllTimers();
	});

	pi.on("ui_prompt_end", () => {
		uiPromptOpen = false;
		resumeAllTimers();
	});

	pi.on("tool_execution_update", (event, ctx) => {
		if (event.toolName !== "bash") return;
		const record = activeCommands.get(event.toolCallId);
		if (!record) return;
		record.ctx = ctx;
		const latestText = extractTextFromContent(event.partialResult?.content);
		if (latestText !== record.outputText) {
			record.outputText = latestText;
			record.lastOutputAt = now();
			record.outputUpdateCount += 1;
		}
	});

	pi.on("tool_result", (event) => {
		if (event.toolName !== "bash") return;
		const report =
			activeCommands.get(event.toolCallId)?.killedReport ??
			completedReports.get(event.toolCallId);
		if (!report) return;
		completedReports.delete(event.toolCallId);

		const existingText = extractTextFromContent(event.content);
		const reportBlock = formatKilledReportBlock(report);
		const combinedText = existingText ? `${existingText}\n\n${reportBlock}` : reportBlock;

		return {
			content: [{ type: "text" as const, text: combinedText }],
			isError: true,
		};
	});

	pi.on("tool_execution_end", (event, ctx) => {
		if (event.toolName !== "bash") return;
		stopTrackingCommand(event.toolCallId, ctx);
		completedReports.delete(event.toolCallId);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		lateToolCallUnsubscribe?.();
		lateToolCallUnsubscribe = undefined;
		stopAllCommands(ctx);
	});

	pi.registerCommand("longcheck", {
		description:
			"Inspect or control the long-running bash command checker (`/longcheck [status|check|on|off|config <initSec> <recheckSec>]`)",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const sub = (parts[0] ?? "status").toLowerCase();

			if (sub === "on") {
				config.enabled = true;
				ctx.ui.notify(
					`Long-running checker enabled (initial: ${formatDuration(config.initialCheckMs)}, recheck: ${formatDuration(config.recheckIntervalMs)})`,
					"info",
				);
				return;
			}

			if (sub === "off") {
				config.enabled = false;
				stopAllCommands(ctx);
				ctx.ui.notify("Long-running checker disabled", "info");
				return;
			}

			if (sub === "config") {
				const initSec = Number.parseFloat(parts[1] ?? "");
				const recheckSec = Number.parseFloat(parts[2] ?? "");
				if (!Number.isFinite(initSec) || initSec <= 0 || !Number.isFinite(recheckSec) || recheckSec <= 0) {
					ctx.ui.notify("Usage: /longcheck config <initialSeconds> <recheckSeconds>", "warning");
					return;
				}
				config.initialCheckMs = Math.round(initSec * 1000);
				config.recheckIntervalMs = Math.round(recheckSec * 1000);
				ctx.ui.notify(
					`Updated checker thresholds: initial=${formatDuration(config.initialCheckMs)}, recheck=${formatDuration(config.recheckIntervalMs)}`,
					"info",
				);
				return;
			}

			if (sub === "check") {
				if (activeCommands.size === 0) {
					ctx.ui.notify("No active bash commands currently running.", "info");
					return;
				}
				for (const id of Array.from(activeCommands.keys())) {
					await performCheck(id);
				}
				return;
			}

			const currentNow = now();
			const header = `Long-running checker: ${config.enabled ? "ENABLED" : "DISABLED"} (initial=${formatDuration(config.initialCheckMs)}, recheck=${formatDuration(config.recheckIntervalMs)})`;
			if (activeCommands.size === 0) {
				ctx.ui.notify(`${header}\nNo active bash commands running.`, "info");
				return;
			}

			const lines = [header];
			for (const cmd of activeCommands.values()) {
				const elapsed = formatDuration(currentNow - cmd.startedAt);
				const silence = formatDuration(currentNow - cmd.lastOutputAt);
				const nextDue =
					cmd.nextCheckDueAt !== undefined
						? formatDuration(Math.max(0, cmd.nextCheckDueAt - currentNow))
						: "paused";
				lines.push(
					`• ${firstCommandLine(cmd.command, 60)} | elapsed=${elapsed} | lastOutput=${silence} ago | checks=${cmd.checkCount} | next=${nextDue}`,
				);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
