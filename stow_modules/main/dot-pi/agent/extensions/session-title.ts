/**
 * session-title.ts -- name pi sessions after the work they are doing.
 *
 * pi shows the first message in its session selector and leaves the terminal
 * title as "π - <dir>", which is what every pane of every project looks like.
 * This names the session instead: after the first turn it asks a cheap model
 * for a 3-7 word title and calls pi.setSessionName(), then refreshes it as the
 * thread moves on.
 *
 * The name lands in three places at once:
 *
 *   - pi's own session selector (that is what setSessionName is for);
 *   - the transcript, as a {"type":"session_info","name":...} record, plus
 *     a custom ownership marker used after /reload and /resume;
 *   - the terminal title, via ctx.ui.setTitle -- which is what a multiplexer
 *     reads. In herdr it arrives as terminal_title_stripped, so the Agents
 *     sidebar shows it with no daemon involved at all.
 *
 * Two rules it never breaks:
 *
 *   - a name YOU set (/name, --name, /session-name) is never overwritten. It
 *     only ever replaces a name it set itself.
 *   - it never titles in print/json mode, and never inside its own child. The
 *     summarizer is a `pi -p` call, so without both guards a summary could
 *     spawn a summary.
 *
 * The child is spawned as process.execPath + this script, mirroring pi's own
 * examples/extensions/subagent. That detail matters: the `pi` on PATH may be a
 * wrapper that applies a sandbox, and sandboxes do not nest -- going through it
 * dies with "sandbox_apply: Operation not permitted". It also runs with
 * `--no-session`, so naming a session never creates one.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Cheap and fast. Must be a fully-qualified model `pi --list-models` offers.
 * Keep the child pi invocation as bare as ask-agent.sh does: no tools, no
 * extensions, no session, no thinking. If the explicit model call fails, fall
 * back to the current default model, still without creating a session.
 */
const MODEL = "google/gemini-3-flash-preview";
const PI_PRINT_ARGS = [
	"-p",
	"--no-tools",
	"--no-extensions",
	"--no-context-files",
	"--no-skills",
	"--no-session",
	"--thinking",
	"off",
];

const SYSTEM_PROMPT =
	"You name coding-agent sessions. Reply with ONLY a 3-7 word title, " +
	"max 48 chars, no quotes, no trailing punctuation. Name the work, " +
	"preferring the most recent turns over the opening request.";

/** Set in the child, checked at load: the recursion guard. */
const CHILD_MARKER = "PI_SESSION_TITLE_CHILD";
const STATE_ENTRY = "session-title";

const TITLE_MAX = 48;
const CALL_TIMEOUT_MS = 30_000;
/** Digest budget: enough for the shape of a thread, cheap to send. */
const EXCERPT_MAX = 6000;
const PER_TURN_MAX = 1000;
const KEEP_FIRST = 2;
const KEEP_LAST = 4;
/** Re-title after this many further turns, so a long thread stays honest. */
const RETITLE_EVERY = 6;

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (typeof part === "string") {
			parts.push(part);
		} else if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
			const text = (part as { text?: unknown }).text;
			if (typeof text === "string") parts.push(text);
		}
	}
	return parts.join("\n");
}

/** Strip what makes a bad title: reminders, tool wrappers, URLs, control bytes. */
function clean(text: string): string {
	return (
		text
			// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
			.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, " ")
			.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ")
			.replace(/\(?\bhttps?:\/\/\S+\)?/g, " ")
			.replace(/[*_`]+/g, "")
			.replace(/\s+/g, " ")
			.trim()
	);
}

/** More aggressive cleaning for the input digest to stay under token budget. */
function cleanDigest(text: string): string {
	return clean(text).replace(/<\/?[a-z][a-z0-9-]*>/gi, " ");
}

/**
 * Opening prompts plus the most recent ones, middle elided.
 *
 * A thread is described by where it started and where it got to. Sending the
 * whole transcript would mostly be assistant output, and costs tokens.
 */
function digest(turns: string[]): string {
	const kept =
		turns.length > KEEP_FIRST + KEEP_LAST
			? [...turns.slice(0, KEEP_FIRST), "[…]", ...turns.slice(-KEEP_LAST)]
			: turns;
	const joined = kept.join("\n\n");
	if (joined.length <= EXCERPT_MAX) return joined;
	// Prefer the recent end if it still exceeds the total budget.
	return `…${joined.slice(-EXCERPT_MAX)}`;
}

function defaultPiTitle(cwd: string): string {
	// Pi's own startup title before this extension applies a generated session
	// title. The extension API can set a title, but cannot ask Pi to restore its
	// built-in one, so keep this in sync with Pi's default `π - <cwd basename>`.
	return `π - ${path.basename(cwd)}`;
}

function tidyTitle(raw: string): string | undefined {
	// Last non-empty line: CLIs print banners first, the answer comes last.
	const lines = raw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("(") && !line.endsWith(")"));
	let title = clean(lines.at(-1) ?? "");
	title = title
		.replace(/^.*?(title|session\s*name|session\s*title):\s*/i, "")
		.replace(/^["'`“”]+|["'`“”]+$/g, "")
		.replace(/[.!,;:]+$/, "")
		.trim();
	if (title.length > TITLE_MAX) {
		const cut = title.slice(0, TITLE_MAX);
		const space = cut.lastIndexOf(" ");
		title = (space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).trim();
	}
	// A model that explained itself instead of answering.
	if (title.length < 3 || title.split(/\s+/).length > 12) return undefined;
	return title;
}

/** Spawn pi itself, bypassing any wrapper on PATH (see the header). */
function piInvocation(args: string[]): { command: string; args: string[] } {
	const script = process.argv[1];
	const isVirtual = script?.startsWith("/$bunfs/root/");
	if (script && !isVirtual && fs.existsSync(script)) {
		return { command: process.execPath, args: [script, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(execName)) {
		return { command: process.execPath, args };
	}
	return { command: "pi", args };
}

function summaryArgs(text: string, model?: string): string[] {
	// Ephemeral: --no-session keeps title generation out of ~/.pi/agent/sessions,
	// out of `pi --resume`, and out of the agent inbox's history.
	const args = [...PI_PRINT_ARGS];
	if (model) args.push("--model", model);
	args.push("--system-prompt", SYSTEM_PROMPT, "--", text);
	return args;
}

function runSummary(args: string[]): Promise<string | undefined> {
	const { command, args: invocationArgs } = piInvocation(args);
	return new Promise((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, invocationArgs, {
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, [CHILD_MARKER]: "1" },
			});
		} catch {
			resolve(undefined);
			return;
		}
		let out = "";
		const finish = (value: string | undefined) => {
			clearTimeout(timer);
			resolve(value);
		};
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish(undefined);
		}, CALL_TIMEOUT_MS);
		child.stdout?.on("data", (chunk) => {
			out += String(chunk);
		});
		child.on("error", () => finish(undefined));
		child.on("close", (code) => finish(code === 0 ? tidyTitle(out) : undefined));
	});
}

async function summarize(text: string): Promise<string | undefined> {
	return (await runSummary(summaryArgs(text, MODEL))) ?? runSummary(summaryArgs(text));
}

type BranchEntry = {
	type?: string;
	customType?: string;
	data?: unknown;
	timestamp?: string;
	message?: { role?: string; content?: unknown };
};

type TitleState = {
	name?: string;
	userTurnCount?: number;
};

function titleState(data: unknown): TitleState | undefined {
	if (!data || typeof data !== "object") return undefined;
	const state = data as { name?: unknown; userTurnCount?: unknown };
	return {
		name: typeof state.name === "string" ? state.name : undefined,
		userTurnCount: typeof state.userTurnCount === "number" ? state.userTurnCount : undefined,
	};
}

export default function (pi: ExtensionAPI) {
	// Inside our own summarizer: register nothing at all.
	if (process.env[CHILD_MARKER]) return;

	let userTurns: string[] = [];
	let ourName: string | undefined; // the last name WE set
	let titledAtUserTurnCount = -1;
	let running = false;

	const rememberUserTurn = (content: unknown) => {
		const text = cleanDigest(textOf(content));
		if (text) userTurns.push(text.slice(0, PER_TURN_MAX));
	};

	const hydrateFromBranch = (entries: BranchEntry[]) => {
		userTurns = [];
		let lastState: TitleState | undefined;
		const chronological = [...entries].sort(
			(a, b) => Date.parse(a.timestamp ?? "") - Date.parse(b.timestamp ?? ""),
		);
		for (const entry of chronological) {
			if (entry.type === "message" && entry.message?.role === "user") {
				rememberUserTurn(entry.message.content);
			} else if (entry.type === "custom" && entry.customType === STATE_ENTRY) {
				lastState = titleState(entry.data);
			}
		}

		const existing = pi.getSessionName();
		ourName = existing && lastState?.name === existing ? existing : undefined;
		titledAtUserTurnCount = ourName ? lastState?.userTurnCount ?? -1 : -1;
	};

	const mayTitle = (): boolean => {
		if (running || userTurns.length === 0) return false;
		const current = pi.getSessionName();
		// Named by someone else: theirs wins, for good.
		if (current && current !== ourName) return false;
		if (titledAtUserTurnCount < 0) return true;
		return userTurns.length - titledAtUserTurnCount >= RETITLE_EVERY;
	};

	const retitle = async (
		ctx: { hasUI?: boolean; ui?: { setTitle(title: string): void } },
	): Promise<string | undefined> => {
		running = true;
		const startingName = pi.getSessionName();
		try {
			const title = await summarize(digest(userTurns));
			if (!title) return undefined;
			// Re-check: /name may have been typed or cleared while we waited.
			const current = pi.getSessionName();
			if (current !== startingName) return undefined;
			if (current && current !== ourName) return undefined;
			pi.setSessionName(title);
			ourName = title;
			titledAtUserTurnCount = userTurns.length;
			pi.appendEntry(STATE_ENTRY, { name: title, userTurnCount: titledAtUserTurnCount });
			// pi does not put the session name in the terminal title, and the
			// terminal title is what a multiplexer reads.
			if (ctx.hasUI) ctx.ui?.setTitle(title);
			return title;
		} finally {
			running = false;
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		// Rebuild state after /reload, /resume, and /new. Without this, /retitle
		// has no history after a reload and auto-refresh treats our own previous
		// title as manual.
		hydrateFromBranch(ctx.sessionManager.getBranch() as BranchEntry[]);

		// A resumed/named session keeps the name it had. A brand-new unnamed
		// session is reset to Pi's own startup title, so a title left behind by an
		// older pi run is not shown while the first generated name is computed.
		const existing = pi.getSessionName();
		if (ctx.hasUI) ctx.ui?.setTitle(existing ?? defaultPiTitle(ctx.cwd));
	});

	pi.on("message_end", async (event) => {
		const message = (event as { message?: { role?: string; content?: unknown } }).message;
		if (message?.role !== "user") return;
		rememberUserTurn(message.content);
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (!ctx.hasUI) return; // print/json mode: where the summarizer runs
		if (!mayTitle()) return;
		// Deliberately not awaited: the turn is over, and a ~7s model call
		// must not delay the next prompt.
		void retitle(ctx);
	});

	pi.registerCommand("retitle", {
		description: "Regenerate this session's name from the conversation",
		handler: async (_args, ctx) => {
			if (userTurns.length === 0) {
				ctx.ui.notify("Nothing to title yet", "info");
				return;
			}
			// An explicit ask hands the name back to us, even if it was set
			// by hand.
			ourName = pi.getSessionName();
			ctx.ui.notify("Naming session…", "info");
			const title = await retitle(ctx);
			ctx.ui.notify(
				title ? `Session named: ${title}` : "Could not name the session",
				title ? "info" : "warn",
			);
		},
	});
}
