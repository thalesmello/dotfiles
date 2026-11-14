import { describe, expect, test } from "bun:test";
import longRunningCheckerExtension, {
	type AgentKillDecision,
	buildProcessTreeSnapshot,
	type CommandTelemetry,
	DEFAULT_INITIAL_CHECK_MS,
	DEFAULT_RECHECK_INTERVAL_MS,
	formatDuration,
	type JudgeVerdict,
	parseAgentKillDecision,
	parseJudgeVerdict,
	parsePsDurationSeconds,
	parsePsOutput,
	type ProcessEntry,
} from "../extensions/long-running-checker.ts";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHarness(options: {
	initialCheckMs?: number;
	recheckIntervalMs?: number;
	piPid?: number;
	processes?: ProcessEntry[];
	onJudge?: (telemetry: CommandTelemetry) => JudgeVerdict | null | Promise<JudgeVerdict | null>;
	onAgentDecision?: (
		telemetry: CommandTelemetry,
		judge: JudgeVerdict,
	) => AgentKillDecision | null | Promise<AgentKillDecision | null>;
}) {
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;
	const notifications: Array<{ message: string; level: string }> = [];
	const statuses = new Map<string, string | undefined>();
	const killedGroups: Array<{ shellPid: number; pgid?: number; pids: number[] }> = [];
	let currentNow = 1_000_000;
	let currentProcesses: ProcessEntry[] = options.processes ?? [];

	const pi: any = {
		on(event: string, handler: (event: any, ctx: any) => any) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {
				const arr = handlers.get(event);
				if (!arr) return;
				const idx = arr.indexOf(handler);
				if (idx !== -1) arr.splice(idx, 1);
			};
		},
		registerCommand(name: string, spec: any) {
			if (name === "longcheck") {
				commandHandler = spec.handler;
			}
		},
	};

	const ctx: any = {
		cwd: "/home/thalesmello/src",
		mode: "tui",
		hasUI: true,
		model: { provider: "google", id: "gemini-4-argon" },
		modelRegistry: {},
		ui: {
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
			setStatus(key: string, value: string | undefined) {
				statuses.set(key, value);
			},
			theme: {
				fg(_color: string, text: string) {
					return text;
				},
			},
		},
		sessionManager: {
			getSessionId: () => "session-123",
			getBranch: () => [
				{
					type: "message",
					message: {
						role: "user",
						content: [{ type: "text", text: "Run the test suite and check if it hangs" }],
					},
				},
			],
		},
	};

	longRunningCheckerExtension(pi, {
		now: () => currentNow,
		piPid: options.piPid ?? 1000,
		initialCheckMs: options.initialCheckMs ?? 30,
		recheckIntervalMs: options.recheckIntervalMs ?? 60,
		listProcesses: async () => currentProcesses,
		killProcessGroup: async (shellPid, pgid, procs) => {
			killedGroups.push({
				shellPid,
				pgid,
				pids: procs.map((p) => p.pid),
			});
		},
		runJudge: async (telemetry) => {
			return (await options.onJudge?.(telemetry)) ?? {
				status: "working",
				confidence: "high",
				summary: "Making steady progress.",
			};
		},
		runAgentDecision: async (telemetry, judge) => {
			return (await options.onAgentDecision?.(telemetry, judge)) ?? {
				decision: "wait",
				reason: "Still waiting on build.",
			};
		},
	});

	async function emit(event: string, payload: any): Promise<any> {
		const list = [...(handlers.get(event) ?? [])];
		let lastResult: any;
		for (const h of list) {
			const res = await h(payload, ctx);
			if (res !== undefined) lastResult = res;
		}
		return lastResult;
	}

	return {
		emit,
		ctx,
		notifications,
		statuses,
		killedGroups,
		advanceNow(deltaMs: number) {
			currentNow += deltaMs;
		},
		setProcesses(procs: ProcessEntry[]) {
			currentProcesses = procs;
		},
		async runLongcheck(args = "") {
			if (!commandHandler) throw new Error("longcheck not registered");
			await commandHandler(args, ctx);
		},
	};
}

describe("duration and ps parsing helpers", () => {
	test("Verify default thresholds are 90s initial and 10m recheck", () => {
		expect(DEFAULT_INITIAL_CHECK_MS).toBe(90_000);
		expect(DEFAULT_RECHECK_INTERVAL_MS).toBe(600_000);
		expect(formatDuration(90_000)).toBe("1m30s");
		expect(formatDuration(600_000)).toBe("10m");
	});

	test("parsePsDurationSeconds handles Linux and macOS ps formats", () => {
		expect(parsePsDurationSeconds("45")).toBe(45);
		expect(parsePsDurationSeconds("01:30")).toBe(90);
		expect(parsePsDurationSeconds("00:10:05")).toBe(605);
		expect(parsePsDurationSeconds("2-01:00:00")).toBe(2 * 86400 + 3600);
		expect(parsePsDurationSeconds("00:12.48")).toBe(12);
	});

	test("parsePsOutput parses ps rows and buildProcessTreeSnapshot resolves child tree", () => {
		const raw = [
			"  1000    900   1000 Ss     10:00 00:00:05 ep_poll  pi",
			"  2000   1000   2000 Ss     01:35 00:00:01 do_wait  /bin/bash -c buck2 test //foo:bar",
			"  2005   2000   2000 R      01:34 00:00:14 -        buck2 test //foo:bar",
			"  2010   2005   2000 S      01:20 00:00:03 futex    tpx --buck-target //foo:bar",
			"  3000   1000   3000 Ss     00:05 00:00:00 do_wait  /bin/bash -c other command",
		].join("\n");

		const parsed = parsePsOutput(raw);
		expect(parsed).toHaveLength(5);

		const snapshot = buildProcessTreeSnapshot(
			parsed,
			1000,
			{
				command: "buck2 test //foo:bar",
				shellPid: undefined,
				pgid: undefined,
				preExistingChildPids: new Set(),
			},
			new Set(),
		);

		expect(snapshot.shellPid).toBe(2000);
		expect(snapshot.pgid).toBe(2000);
		expect(snapshot.processes.map((p) => p.pid)).toEqual([2000, 2005, 2010]);
		expect(snapshot.totalCpuSeconds).toBe(18);
		expect(snapshot.hasRunningOrRunnable).toBe(true);
		expect(snapshot.hasZombieOrStopped).toBe(false);
	});
});

describe("JSON verdict parsers", () => {
	test("parseJudgeVerdict parses plain and fenced JSON", () => {
		expect(
			parseJudgeVerdict('```json\n{"status":"working","confidence":"high","summary":"Tester is polling Chronos"}\n```'),
		).toEqual({
			status: "working",
			confidence: "high",
			summary: "Tester is polling Chronos",
		});

		expect(parseJudgeVerdict('{"status":"stuck","summary":"Blocked on [y/N] stdin prompt"}')).toEqual({
			status: "stuck",
			confidence: "medium",
			summary: "Blocked on [y/N] stdin prompt",
		});

		expect(parseJudgeVerdict("not json")).toBeNull();
	});

	test("parseAgentKillDecision parses kill and wait decisions", () => {
		expect(parseAgentKillDecision('{"decision":"kill","reason":"phps hit stale WWW fatal"}')).toEqual({
			decision: "kill",
			reason: "phps hit stale WWW fatal",
		});
		expect(parseAgentKillDecision('{"decision":"wait","reason":"Dataswarm tester still running"}')).toEqual({
			decision: "wait",
			reason: "Dataswarm tester still running",
		});
	});
});

describe("long-running-checker lifecycle", () => {
	test("checks at 90s, computes output/CPU deltas on 10m recheck when working, and cleans up on end", async () => {
		const telemetries: CommandTelemetry[] = [];
		const harness = createHarness({
			initialCheckMs: 40,
			recheckIntervalMs: 70,
			piPid: 1000,
			onJudge: (t) => {
				telemetries.push(t);
				return {
					status: "working",
					confidence: "high",
					summary: `Check #${t.checkNumber} OK`,
				};
			},
		});

		await harness.emit("session_start", { reason: "startup" });

		// Start bash command
		await harness.emit("tool_call", {
			toolName: "bash",
			toolCallId: "call-1",
			input: { command: "dataswarm-cli daemon execute tester -- -b test_ foo.py 2026-11-12" },
		});

		// Simulate child process and streaming output before check #1
		harness.setProcesses([
			{
				pid: 5001,
				ppid: 1000,
				pgid: 5001,
				stat: "Ss",
				elapsedSeconds: 90,
				cpuSeconds: 4,
				wchan: "do_wait",
				args: "/bin/bash -c dataswarm-cli daemon execute tester -- -b test_ foo.py 2026-11-12",
			},
		]);
		harness.advanceNow(90_000);
		await harness.emit("tool_execution_update", {
			toolName: "bash",
			toolCallId: "call-1",
			partialResult: {
				content: [{ type: "text", text: "Submitting job...\nChronos job x123456 running\n" }],
			},
		});

		// Wait for initial check timer (40ms in test harness)
		await sleep(55);
		expect(telemetries).toHaveLength(1);
		expect(telemetries[0]!.checkNumber).toBe(1);
		expect(telemetries[0]!.deltaOutputBytes).toBeGreaterThan(0);
		expect(telemetries[0]!.deltaCpuSeconds).toBe(4);
		expect(harness.killedGroups).toHaveLength(0);

		// Simulate 10 minutes passing with additional output and CPU
		harness.setProcesses([
			{
				pid: 5001,
				ppid: 1000,
				pgid: 5001,
				stat: "Ss",
				elapsedSeconds: 690,
				cpuSeconds: 11,
				wchan: "ep_poll",
				args: "/bin/bash -c dataswarm-cli daemon execute tester -- -b test_ foo.py 2026-11-12",
			},
		]);
		harness.advanceNow(600_000);
		await harness.emit("tool_execution_update", {
			toolName: "bash",
			toolCallId: "call-1",
			partialResult: {
				content: [
					{
						type: "text",
						text: "Submitting job...\nChronos job x123456 running\nTask 1/3 succeeded\n",
					},
				],
			},
		});

		// Wait for recheck timer (70ms in test harness)
		await sleep(85);
		expect(telemetries).toHaveLength(2);
		expect(telemetries[1]!.checkNumber).toBe(2);
		expect(telemetries[1]!.deltaCpuSeconds).toBe(7); // 11 - 4
		expect(telemetries[1]!.deltaOutputBytes).toBe(Buffer.byteLength("Task 1/3 succeeded\n", "utf8"));
		expect(telemetries[1]!.previousChecks).toHaveLength(1);

		// Finish command and ensure timers/status are cleaned up
		await harness.emit("tool_execution_end", {
			toolName: "bash",
			toolCallId: "call-1",
		});
		expect(harness.statuses.get("long-running-checker")).toBeUndefined();
	});

	test("when judge flags stuck and agent decides kill, terminates process group and annotates tool_result", async () => {
		const harness = createHarness({
			initialCheckMs: 30,
			recheckIntervalMs: 80,
			piPid: 1000,
			onJudge: () => ({
				status: "stuck",
				confidence: "high",
				summary: "phps threw stale WWW revision fatal and xbox worker is hung",
			}),
			onAgentDecision: () => ({
				decision: "kill",
				reason: "WWW checkout is older than 5 days; need to rebase before re-running phps",
			}),
		});

		await harness.emit("session_start", { reason: "startup" });

		await harness.emit("tool_call", {
			toolName: "bash",
			toolCallId: "call-stuck",
			input: { command: "phps MyScript.php" },
		});

		harness.setProcesses([
			{
				pid: 7001,
				ppid: 1000,
				pgid: 7001,
				stat: "S",
				elapsedSeconds: 90,
				cpuSeconds: 0,
				wchan: "futex",
				args: "/bin/bash -c phps MyScript.php",
			},
		]);
		harness.advanceNow(90_000);
		await harness.emit("tool_execution_update", {
			toolName: "bash",
			toolCallId: "call-stuck",
			partialResult: {
				content: [{ type: "text", text: "Fatal: You are running a very old revision of WWW" }],
			},
		});

		await sleep(50);

		expect(harness.killedGroups).toHaveLength(1);
		expect(harness.killedGroups[0]).toEqual({
			shellPid: 7001,
			pgid: 7001,
			pids: [7001],
		});

		const modifiedResult = await harness.emit("tool_result", {
			toolName: "bash",
			toolCallId: "call-stuck",
			content: [{ type: "text", text: "Fatal: You are running a very old revision of WWW" }],
			isError: false,
		});

		expect(modifiedResult?.isError).toBe(true);
		const resultText = modifiedResult?.content?.[0]?.text ?? "";
		expect(resultText).toContain("Long-Running Command Checker: command terminated at 1m30s (check #1)");
		expect(resultText).toContain("phps threw stale WWW revision fatal");
		expect(resultText).toContain("WWW checkout is older than 5 days");

		await harness.emit("tool_execution_end", {
			toolName: "bash",
			toolCallId: "call-stuck",
		});
	});

	test("when judge flags stuck but agent decides wait, leaves command running and rechecks", async () => {
		let judgeCalls = 0;
		const harness = createHarness({
			initialCheckMs: 30,
			recheckIntervalMs: 50,
			piPid: 1000,
			onJudge: () => {
				judgeCalls += 1;
				return {
					status: "stuck",
					confidence: "low",
					summary: "No output for 90s",
				};
			},
			onAgentDecision: () => ({
				decision: "wait",
				reason: "Presto query is scanning a large table without streaming progress",
			}),
		});

		await harness.emit("session_start", { reason: "startup" });
		await harness.emit("tool_call", {
			toolName: "bash",
			toolCallId: "call-wait",
			input: { command: "presto --execute 'SELECT COUNT(*) FROM big_table'" },
		});

		harness.advanceNow(90_000);
		await sleep(45);
		expect(judgeCalls).toBe(1);
		expect(harness.killedGroups).toHaveLength(0);

		// Should recheck after recheckIntervalMs
		harness.advanceNow(600_000);
		await sleep(60);
		expect(judgeCalls).toBe(2);
		expect(harness.killedGroups).toHaveLength(0);

		await harness.emit("tool_execution_end", {
			toolName: "bash",
			toolCallId: "call-wait",
		});
	});

	test("pauses timer during ui_prompt_start and resumes on ui_prompt_end", async () => {
		let judgeCalls = 0;
		const harness = createHarness({
			initialCheckMs: 50,
			recheckIntervalMs: 100,
			piPid: 1000,
			onJudge: () => {
				judgeCalls += 1;
				return { status: "working", confidence: "high", summary: "OK" };
			},
		});

		await harness.emit("session_start", { reason: "startup" });
		await harness.emit("tool_call", {
			toolName: "bash",
			toolCallId: "call-pause",
			input: { command: "sleep 120" },
		});

		await sleep(15);
		await harness.emit("ui_prompt_start", { reason: "ui_prompt", kind: "confirm" });

		// Wait past the original 50ms window while paused
		await sleep(60);
		expect(judgeCalls).toBe(0);

		// Resume prompt and wait for remaining time
		await harness.emit("ui_prompt_end", {});
		await sleep(55);
		expect(judgeCalls).toBe(1);

		await harness.emit("tool_execution_end", {
			toolName: "bash",
			toolCallId: "call-pause",
		});
	});

	test("/longcheck command supports status, config, check, off, and on", async () => {
		let judgeCalls = 0;
		const harness = createHarness({
			initialCheckMs: 500,
			recheckIntervalMs: 1000,
			piPid: 1000,
			onJudge: () => {
				judgeCalls += 1;
				return { status: "working", confidence: "high", summary: "Manual check OK" };
			},
		});

		await harness.emit("session_start", { reason: "startup" });
		await harness.runLongcheck("config 90 600");
		expect(harness.notifications.at(-1)?.message).toContain("initial=1m30s, recheck=10m");

		await harness.emit("tool_call", {
			toolName: "bash",
			toolCallId: "call-cmd",
			input: { command: "buck2 build //target:app" },
		});

		await harness.runLongcheck("status");
		expect(harness.notifications.at(-1)?.message).toContain("buck2 build //target:app");

		await harness.runLongcheck("check");
		expect(judgeCalls).toBe(1);

		await harness.runLongcheck("off");
		expect(harness.notifications.at(-1)?.message).toContain("disabled");

		await harness.runLongcheck("on");
		expect(harness.notifications.at(-1)?.message).toContain("enabled");
	});
});
