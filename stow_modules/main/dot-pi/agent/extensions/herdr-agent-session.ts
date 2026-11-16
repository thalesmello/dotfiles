/**
 * Sidecar for Herdr's managed agent-state extension: publish exact Pi session
 * references as native hc terminal labels, without legacy socket dependencies.
 * Only TUI sessions own the labels; print/JSON/RPC children inherit the terminal
 * identity but must never replace its root conversation.
 */
import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const LABEL_TIMEOUT_MS = 1500;
export type LabelWriter = (terminalId: string, labels: string[]) => Promise<boolean>;

/** No shell interpolation, detached process, or unbounded output/wait. */
export const writeHcLabels: LabelWriter = (terminalId, labels) =>
	new Promise((resolve) => {
		try {
			execFile("hc", ["label", terminalId, ...labels], {
				timeout: LABEL_TIMEOUT_MS,
				killSignal: "SIGKILL",
				maxBuffer: 64 * 1024,
			}, (error) => resolve(!error));
		} catch {
			resolve(false);
		}
	});

export interface SessionLabelOptions {
	identity?: () => string | undefined;
	writeLabels?: LabelWriter;
}

export default function herdrAgentSession(pi: ExtensionAPI, options: SessionLabelOptions = {}) {
	const identity = options.identity ?? (() => process.env.HC_TERMINAL_ID);
	const writeLabels = options.writeLabels ?? writeHcLabels;
	let pending = Promise.resolve();
	let lastWritten: string | undefined;
	let lastRootTerminalId: string | undefined;
	let stopped = false;

	function refresh(_event: unknown, ctx: ExtensionContext): Promise<void> | void {
		if (stopped || ctx.mode !== "tui") return;
		const terminalId = identity();
		if (!terminalId) return;
		lastRootTerminalId = terminalId;
		// Snapshot now: a later /new or /resume must not reuse the old context.
		const file = ctx.sessionManager.getSessionFile();
		const ref = file || ctx.sessionManager.getSessionId() || "";
		const kind = file ? "path" : ref ? "id" : "";
		const labels = ["agent.kind=pi", `agent.session=${ref}`, `agent.session_kind=${kind}`];
		const key = JSON.stringify([terminalId, ...labels]);
		pending = pending.then(async () => {
			if (key === lastWritten) return;
			// A failed write may have partially changed labels: invalidate the cache.
			lastWritten = undefined;
			try {
				if (await writeLabels(terminalId, labels)) lastWritten = key;
			} catch {
				// Best effort; the next lifecycle event retries, without a timer.
			}
		});
		return pending;
	}

	pi.on("session_start", refresh);
	pi.on("agent_start", refresh);
	// Pi recreates extension instances on /new, /resume, /fork and /reload.
	// Drain and clear before replacement so an old process cannot finish last,
	// and a persistent shell cannot retain labels identifying it as live Pi.
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui" || stopped) return pending;
		stopped = true; // Block late hooks while the final clear is queued.
		const terminalId = lastRootTerminalId;
		if (terminalId) {
			pending = pending.then(async () => {
				lastWritten = undefined;
				try {
					await writeLabels(terminalId, ["agent.kind=", "agent.session=", "agent.session_kind="]);
				} catch {
					// Shutdown cleanup is best effort, like lifecycle reporting.
				}
			});
		}
		return pending;
	});
}
