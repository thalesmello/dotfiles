/**
 * herdr-agent-status.ts -- mark a Herdr agent row with a notebook glyph when
 * the work in this session looks done and is a candidate for settling.
 *
 * The mark is a pane-metadata token (`book`, source `herdr-agent-status`)
 * rendered beside the status glyph in the Agents sidebar (see the `$book`
 * token in herdr's config.toml), the same way agent-handler's pin glyph sits
 * beside the status. This file sits beside herdr-agent-state.ts (Herdr's own
 * integration, which only reports working/blocked/idle and must not be
 * edited) and only adds this one marker on top.
 *
 * Rules:
 *
 *   SET   -- a bash command that publishes the work succeeds:
 *            * a commit (`git commit`, `sl commit`, `sl amend`) whose
 *              effective directory is inside a dotfiles checkout, or
 *            * `gh pr create|edit|ready|reopen`, or
 *            * another extension announcing it on the pi event bus as
 *              `herdr-agent-status:settled` (site-specific publishers, e.g.
 *              the `jf submit` watcher in meta-dotfiles, live outside this
 *              repo and emit that event; this file stays forge-agnostic).
 *   CLEAR -- further mutating work starts: the `edit`/`write` tools, or a
 *            bash command that is not plainly read-only. Read-only bash
 *            (status/log/diff, queries, tests, listings) keeps the mark, so
 *            checking a submitted change does not un-book it. A failed
 *            settling command also clears: the publish did not happen.
 *
 * A compound command is judged by its last non-read-only segment, so
 * `git add . && git commit` books on success while `git commit && ./tester`
 * does not (the tester is further work after the commit).
 *
 * When `/new` creates a fresh session (`session_start` with `reason: "new"`),
 * the previous conversation (`previousSessionFile`, when persisted on disk)
 * is settled into `herdr-settled`'s registry without closing the pane, and
 * the notebook mark is cleared for the new session.
 *
 * Only the root TUI session reports: print/RPC children (subagents, title
 * summarizers) share the pane but are not the session being settled.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const HERDR_ENV = process.env.HERDR_ENV;
const socketPath = process.env.HERDR_SOCKET_PATH;
const socketEndpoint =
	process.platform === "win32" && socketPath ? `\\\\.\\pipe\\${socketPath}` : socketPath;
const paneId = process.env.HERDR_PANE_ID;
const source = "herdr-agent-status";

/** Event other extensions emit when site-specific work is published. */
export const SETTLED_EVENT = "herdr-agent-status:settled";

/** nf-md-notebook (U+F00BA), same Material Design family as the sidebar pin. */
export const BOOK_GLYPH = "󰂺";
export const BOOK_TOKEN = "book";

function enabled(): boolean {
	return HERDR_ENV === "1" && !!socketPath && !!paneId;
}

function sendRequestAttempt(request: unknown, timeoutMs: number): Promise<boolean> {
	if (!enabled()) return Promise.resolve(true);
	return new Promise((resolve) => {
		let done = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const socket = net.createConnection(socketEndpoint!);
		const finish = (delivered: boolean) => {
			if (done) return;
			done = true;
			if (timeout) clearTimeout(timeout);
			socket.destroy();
			resolve(delivered);
		};
		socket.on("error", () => finish(false));
		socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
		socket.on("data", () => finish(true));
		socket.on("end", () => finish(false));
		timeout = setTimeout(() => finish(false), timeoutMs);
		timeout.unref?.();
	});
}

async function reportBook(booked: boolean): Promise<void> {
	const request = {
		id: `${source}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
		method: "pane.report_metadata",
		params: {
			pane_id: paneId,
			source,
			tokens: { [BOOK_TOKEN]: booked ? BOOK_GLYPH : null },
		},
	};
	if (await sendRequestAttempt(request, 500)) return;
	await sendRequestAttempt(request, 1500);
}

function settledScriptPath(): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
	return path.join(xdgConfig, "herdr", "scripts", "herdr-settled.py");
}

export function settlePreviousSession(
	sessionFile: string,
	targetPane: string | undefined = paneId ?? process.env.HERDR_PANE_ID,
): Promise<boolean> {
	if (!targetPane) return Promise.resolve(false);
	const script = settledScriptPath();
	return new Promise((resolve) => {
		let done = false;
		const finish = (ok: boolean) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve(ok);
		};
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn("python3", [script, "settle-session", targetPane, sessionFile], {
				stdio: "ignore",
			});
		} catch {
			finish(false);
			return;
		}
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish(false);
		}, 5000);
		timer.unref?.();
		child.on("error", () => finish(false));
		child.on("close", (code) => finish(code === 0));
	});
}

// ---------------------------------------------------------------------------
// Bash classification
// ---------------------------------------------------------------------------

export type BashVerdict = "settle" | "mutating" | "readonly";

/** Drop quoted spans so `echo "git commit"` or a commit message cannot match. */
function stripQuotes(command: string): string {
	return command.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, " ");
}

/** Split a compound command into segments on &&, ||, ;, | and newlines. */
export function splitSegments(command: string): string[] {
	return stripQuotes(command)
		.split(/&&|\|\||[;\n|]/)
		.map((segment) => segment.trim())
		.filter(Boolean);
}

function isDotfilesDir(dir: string): boolean {
	return /(^|\/)(meta-)?dotfiles(\/|$)/.test(dir);
}

function resolveDir(current: string, target: string): string {
	const home = process.env.HOME ?? "";
	let dir = target.trim();
	if (dir === "~") dir = home;
	else if (dir.startsWith("~/")) dir = home + dir.slice(1);
	else if (dir.startsWith("$HOME/")) dir = home + dir.slice(5);
	else if (dir === "$HOME") dir = home;
	if (!dir.startsWith("/")) {
		const parts = (current + "/" + dir).split("/");
		const out: string[] = [];
		for (const part of parts) {
			if (part === "" || part === ".") continue;
			if (part === "..") out.pop();
			else out.push(part);
		}
		return "/" + out.join("/");
	}
	return dir.replace(/\/+$/, "") || "/";
}

const READONLY_STARTERS =
	/^(ls|cat|head|tail|grep|rg|ag|fd|find|pwd|echo|printf|date|which|type|env|printenv|wc|jq|yq|diff|cmp|stat|file|du|df|ps|whoami|hostname|id|true|false|test|sleep|herdr\s+(agent|pane|workspace|tab|api|status)\b.*\b(list|get|read|current|layout|snapshot|process-info|neighbor|edges|explain)\b|presto\b|chronos\s+cinfo\b|dotsync2\s+pull\b)/;
const READONLY_VCS =
	/^(git|sl|hg)\s+(status|log|diff|show|blame|annotate|grep|branch|tag|describe|rev-parse|ls-files|cat-file|stash\s+list|bookmark|id|root|whereami)\b/;
const READONLY_MISC =
	/^(\.\/status\b|dataswarm-cli\s+daemon\s+execute\s+status\b|buck2\s+(test|build|targets|query|audit)\b|jf\s+(template|list|info)\b|gh\s+(pr|diff|issue|repo)\s+(view|list|status|checks|diff)\b|meta\s+.*\b(get|list|export|status|info)\b)/;

const MUTATING_SEGMENTS: RegExp[] = [
	/^(git|sl|hg)\s+(commit|amend|push|pull|add|rm|mv|forget|revert|checkout|goto|update|rebase|merge|shelve|unshelve|strip|prune|bookmark|phase|evolve|absorb|split|fold|histedit|clone|init|submit)\b/,
	/^jf\s+(submit|land)\b/,
	/^(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln|install|patch|truncate|dd|tee|kill|pkill)\b/,
	/^(arc|lint)\b.*(--apply-patches|--update-schema|--fix)\b/,
	/.*\blinter\b.*--update-schema\b/,
	/\barc\s+dsfmt\b/, // dsfmt rewrites the file in place
	/^(sed|perl)\b[^;]*\s-i\b/,
	/(^|\s)(>>?|&>)\s*[^\s&|]/, // output redirection writes a file
	/^(npm|pnpm|yarn|pip|pipx|brew|cargo|go)\s+(install|add|remove|uninstall|update|upgrade|publish|mod)\b/,
	/^herdr\s+(agent|pane|workspace|tab|worktree|session)\s+(start|run|split|close|create|remove|send-|prompt|rename|move|swap|resize|focus|attach)\b/,
	/^(chronos\s+ckill|dataswarm-cli\s+daemon\s+execute\s+(tester|nbackfill|linter)\b|\.\/(tester|nbackfill)\b)/,
	/^(stow|dotsync2\s+push)\b/,
];

const GH_SETTLE = /^gh\s+pr\s+(create|edit|ready|reopen)\b/;
const COMMIT = /^(git|sl)\s+(commit|amend)\b/;

const WRITES_FILE = /(^|\s)(>>?|&>)\s*[^\s&|]|^(sed|perl)\b[^;]*\s-i\b|^tee\b/;

function classifySegment(segment: string, dir: string): BashVerdict {
	if (GH_SETTLE.test(segment)) return "settle";
	if (COMMIT.test(segment) && isDotfilesDir(dir)) return "settle";
	// A read-only verb with a redirection still writes a file.
	if (WRITES_FILE.test(segment)) return "mutating";
	if (READONLY_STARTERS.test(segment) || READONLY_VCS.test(segment) || READONLY_MISC.test(segment)) {
		return "readonly";
	}
	for (const pattern of MUTATING_SEGMENTS) {
		if (pattern.test(segment)) return "mutating";
	}
	// Unknown commands fail safe: a stale notebook would offer unfinished
	// work for settling, which is worse than a missing one.
	return "mutating";
}

/**
 * Judge a whole bash command. `cd` segments retarget the directory used for
 * the dotfiles check; the verdict is that of the last non-read-only segment.
 */
export function classifyBash(command: string, cwd: string): BashVerdict {
	let dir = cwd;
	let verdict: BashVerdict = "readonly";
	for (const segment of splitSegments(command)) {
		const cd = segment.match(/^cd\s+(\S+)\s*$/);
		if (cd) {
			dir = resolveDir(dir, cd[1]);
			continue;
		}
		// A `cd` glued to a command in one segment (`cd x git commit`) is rare
		// but cheap to handle: retarget, then judge the rest in the new dir.
		const inlineCd = segment.match(/^cd\s+(\S+)\s+(.+)$/);
		if (inlineCd) {
			dir = resolveDir(dir, inlineCd[1]);
			const rest = classifySegment(inlineCd[2], dir);
			if (rest !== "readonly") verdict = rest;
			continue;
		}
		const segmentVerdict = classifySegment(segment, dir);
		if (segmentVerdict !== "readonly") verdict = segmentVerdict;
	}
	return verdict;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

type Deps = {
	report?: (booked: boolean) => Promise<void>;
	settle?: (sessionFile: string) => Promise<unknown>;
	sessionExists?: (sessionFile: string) => boolean;
	enabled?: boolean;
};

export default function (pi: ExtensionAPI, deps: Deps = {}) {
	const report = deps.report ?? reportBook;
	const settle = deps.settle ?? settlePreviousSession;
	const sessionExists =
		deps.sessionExists ?? (deps.settle ? () => true : (file: string) => fs.existsSync(file));
	if (!(deps.enabled ?? enabled())) return;

	let rootSession = false;
	let booked = false;

	function setBooked(next: boolean): void {
		if (next === booked) return;
		booked = next;
		void report(next);
	}

	pi.events.on(SETTLED_EVENT, () => {
		if (rootSession) setBooked(true);
	});

	pi.on("session_start", async (event, ctx) => {
		// TUI only: RPC/print children have no Herdr row of their own.
		if (ctx?.mode !== "tui") return;
		rootSession = true;
		// A brand-new session is new work; a reload/resume keeps the mark.
		if ((event as { reason?: string })?.reason === "new") {
			setBooked(false);
			const previousSessionFile = (event as { previousSessionFile?: unknown })?.previousSessionFile;
			if (
				typeof previousSessionFile === "string" &&
				previousSessionFile.length > 0 &&
				sessionExists(previousSessionFile)
			) {
				await settle(previousSessionFile);
			}
		}
	});

	pi.on("tool_call", (event, ctx) => {
		if (!rootSession) return;
		if (event.toolName === "edit" || event.toolName === "write") {
			setBooked(false);
			return;
		}
		if (event.toolName === "bash") {
			const command = (event.input as { command?: string })?.command ?? "";
			// Settle commands wait for their result; mutating work clears now
			// so the mark drops as soon as the work starts, not when it ends.
			if (classifyBash(command, ctx.cwd) === "mutating") setBooked(false);
		}
	});

	pi.on("tool_result", (event, ctx) => {
		if (!rootSession || event.toolName !== "bash") return;
		const command = (event.input as { command?: string })?.command ?? "";
		if (classifyBash(command, ctx.cwd) !== "settle") return;
		// Success books the session; a failed publish clears any stale mark.
		setBooked(!event.isError);
	});
}
