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
 *   - the transcript, as a {"type":"session_info","name":...} record, which is
 *     what resume pickers and outside readers see;
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
 * Cheap and fast. Must be a model `pi --list-models` offers: on a gateway
 * without a given id the call fails with DeploymentNotFound (the cheap OpenAI
 * tier -- gpt-4.1-mini, gpt-5-mini, gpt-5-nano, gpt-4o-mini -- is not
 * available here). gemini-3-flash-preview is a cheaper alternative;
 * claude-haiku-4-5 answers the conversation instead of naming it.
 */
const MODEL = "gpt-5.4";

const SYSTEM_PROMPT =
	"You name coding-agent sessions. Reply with ONLY a 3-7 word title, " +
	"max 48 chars, no quotes, no trailing punctuation. Name the work, " +
	"preferring the most recent turns over the opening request.";

/** Set in the child, checked at load: the recursion guard. */
const CHILD_MARKER = "PI_SESSION_TITLE_CHILD";

const TITLE_MAX = 48;
const CALL_TIMEOUT_MS = 30_000;
/** Digest budget: enough for the shape of a thread, cheap to send. */
const EXCERPT_MAX = 3000;
const PER_TURN_MAX = 600;
const KEEP_FIRST = 2;
const KEEP_LAST = 4;
/** Re-title after this many further turns, so a long thread stays honest. */
const RETITLE_EVERY = 6;

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
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
			.replace(/<\/?[a-z][a-z0-9-]*>/gi, " ")
			.replace(/\(?\bhttps?:\/\/\S+\)?/g, " ")
			.replace(/\s+/g, " ")
			.trim()
	);
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
	return kept.join("\n\n").slice(0, EXCERPT_MAX);
}

function tidyTitle(raw: string): string | undefined {
	// Last non-empty line: CLIs print banners first, the answer comes last.
	const lines = raw
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	let title = clean(lines.at(-1) ?? "");
	title = title.replace(/^["'`“”]+|["'`“”]+$/g, "").replace(/[.!,;:]+$/, "").trim();
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

function summarize(text: string): Promise<string | undefined> {
	const { command, args } = piInvocation([
		"-p",
		// Ephemeral: without this every title generation leaves a 2-message
		// session file in the SAME session dir as the conversation it names --
		// and since the digest opens with your first prompt, the row in
		// `pi --resume` is character-identical to the real session.
		"--no-session",
		"--model",
		MODEL,
		"--system-prompt",
		SYSTEM_PROMPT,
		text,
	]);
	return new Promise((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, args, {
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

export default function (pi: ExtensionAPI) {
	// Inside our own summarizer: register nothing at all.
	if (process.env[CHILD_MARKER]) return;

	const userTurns: string[] = [];
	let ourName: string | undefined; // the last name WE set
	let titledAtTurn = -1;
	let running = false;

	const mayTitle = (turnIndex: number): boolean => {
		if (running || userTurns.length === 0) return false;
		const current = pi.getSessionName();
		// Named by someone else: theirs wins, for good.
		if (current && current !== ourName) return false;
		if (titledAtTurn < 0) return true;
		return turnIndex - titledAtTurn >= RETITLE_EVERY;
	};

	const retitle = async (
		turnIndex: number,
		ctx: { hasUI?: boolean; ui?: { setTitle(title: string): void } },
	): Promise<string | undefined> => {
		running = true;
		try {
			const title = await summarize(digest(userTurns));
			if (!title) return undefined;
			// Re-check: /name may have been typed while we waited.
			const current = pi.getSessionName();
			if (current && current !== ourName) return undefined;
			pi.setSessionName(title);
			ourName = title;
			titledAtTurn = turnIndex;
			// pi does not put the session name in the terminal title, and the
			// terminal title is what a multiplexer reads.
			if (ctx.hasUI) ctx.ui?.setTitle(title);
			return title;
		} finally {
			running = false;
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		// Adopt an existing name: a resumed session keeps the name it had, and
		// a name set in an earlier run still counts as yours.
		const existing = pi.getSessionName();
		if (existing) {
			ourName = undefined; // not ours -> never overwrite
			if (ctx.hasUI) ctx.ui?.setTitle(existing);
		}
	});

	pi.on("message_end", async (event) => {
		const message = (event as { message?: { role?: string; content?: unknown } }).message;
		if (message?.role !== "user") return;
		const text = clean(textOf(message.content));
		if (text) userTurns.push(text.slice(0, PER_TURN_MAX));
	});

	pi.on("turn_end", async (event, ctx) => {
		if (!ctx.hasUI) return; // print/json mode: where the summarizer runs
		const turnIndex = (event as { turnIndex?: number }).turnIndex ?? 0;
		if (!mayTitle(turnIndex)) return;
		// Deliberately not awaited: the turn is over, and a ~7s model call
		// must not delay the next prompt.
		void retitle(turnIndex, ctx);
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
			const title = await retitle(titledAtTurn < 0 ? 0 : titledAtTurn, ctx);
			ctx.ui.notify(
				title ? `Session named: ${title}` : "Could not name the session",
				title ? "info" : "warn",
			);
		},
	});
}
