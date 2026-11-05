/**
 * insert-caret.ts -- an insert-style caret in the prompt box, like
 * Neovim in insert mode.
 *
 * Neovim's insert-mode caret is the terminal's real cursor with its shape
 * set to a thin vertical bar (DECSCUSR, steady -- not blinking), sitting at the
 * insertion point with the character next to it fully visible. Pi's
 * editor instead hides the real cursor and draws a terminal-style block:
 * the character under the cursor wrapped in reverse video.
 *
 * This extension makes the prompt caret Neovim-insert-style:
 *
 * - pi is switched to its hardware cursor (`setShowHardwareCursor(true)`
 *   on the live TUI instance), so pi positions the real terminal cursor
 *   at the editor's cursor marker (that's also the IME position) and
 *   stops drawing the fake block; and
 * - the cursor shape is set to a steady vertical bar by writing
 *   DECSCUSR `\x1b[6 q` to the terminal. On shutdown the shape is
 *   restored to the terminal default (`\x1b[0 q`).
 *
 * Why a prototype patch instead of a custom editor: editor factories are
 * installed by several extensions from `session_start`, and their order
 * is not the file order -- an earlier version of this extension wrapped
 * the editor factory, a later `session_start` handler (copy-snippet)
 * replaced that factory, and the wrapped editor never rendered. Patching
 * `Editor.prototype.render` -- the pattern code-block-copy.ts and
 * table-selection.ts use for pi-tui prototypes -- is independent of the
 * factory chain: every editor (prompt box and dialog editors alike, they
 * all share the one TUI instance) passes through it. The patch changes
 * no rendered lines; it only configures the TUI on the first render and
 * re-asserts the bar shape at most once a second (in case an external
 * editor such as Neovim, opened from pi, leaves its own shape behind
 * when it exits).
 *
 * Patch state lives on `globalThis` under a Symbol (the osc8-links.ts /
 * code-block-copy.ts pattern) so a /reload never wraps twice, and
 * shutdown only restores the method when this patch is still outermost.
 *
 * `/insert-caret` reports whether the patch is installed and whether a
 * TUI has been configured yet.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";

// DECSCUSR: 6 = steady vertical bar (Neovim insert-style, no blink), 0 = the
// terminal's own default shape (used to restore on shutdown).
const CURSOR_SHAPE_BAR = "\x1b[6 q";
const CURSOR_SHAPE_DEFAULT = "\x1b[0 q";
const REASSERT_INTERVAL_MS = 1_000;

interface TuiLike {
	terminal?: { write?: (data: string) => void };
	getShowHardwareCursor?: () => boolean;
	setShowHardwareCursor?: (enabled: boolean) => void;
	requestRender?: () => void;
}

interface EditorLike {
	tui?: TuiLike;
	render(width: number): string[];
}

type RenderFn = (this: EditorLike, width: number) => string[];

interface PatchState {
	installed: boolean;
	origRender: RenderFn | undefined;
	patchedRender: RenderFn | undefined;
	configuredTuis: WeakSet<object>;
	terminals: Set<{ write: (data: string) => void }>;
	lastAssertAt: Map<object, number>;
	configureCount: number;
}

const PATCH_STATE_SYMBOL = Symbol.for("pi.insertCaret.patchState");

function getPatchState(): PatchState {
	const holder = globalThis as Record<symbol, PatchState | undefined>;
	holder[PATCH_STATE_SYMBOL] ??= {
		installed: false,
		origRender: undefined,
		patchedRender: undefined,
		configuredTuis: new WeakSet(),
		terminals: new Set(),
		lastAssertAt: new Map(),
		configureCount: 0,
	};
	return holder[PATCH_STATE_SYMBOL]!;
}

function assertInsertCursor(tui: TuiLike | undefined): void {
	if (!tui) return;
	const state = getPatchState();
	try {
		if (typeof tui.setShowHardwareCursor === "function" && tui.getShowHardwareCursor?.() !== true) {
			tui.setShowHardwareCursor(true);
		}
		const write = tui.terminal?.write;
		if (typeof write !== "function") return;
		state.terminals.add(write.bind(tui.terminal));
		const now = Date.now();
		const last = state.lastAssertAt.get(tui as object) ?? 0;
		if (!state.configuredTuis.has(tui as object)) {
			state.configuredTuis.add(tui as object);
			state.lastAssertAt.set(tui as object, now);
			state.configureCount += 1;
			write.call(tui.terminal, CURSOR_SHAPE_BAR);
		} else if (now - last >= REASSERT_INTERVAL_MS) {
			state.lastAssertAt.set(tui as object, now);
			write.call(tui.terminal, CURSOR_SHAPE_BAR);
		}
	} catch {
		// Cursor styling must never break rendering.
	}
}

function patchedRender(this: EditorLike, width: number): string[] {
	const state = getPatchState();
	assertInsertCursor(this?.tui);
	return state.origRender!.call(this, width);
}

function installInsertCaret(): boolean {
	const state = getPatchState();
	if (state.installed) return true;
	const prototype = Editor.prototype as unknown as { render?: RenderFn };
	if (typeof prototype.render !== "function") return false;
	state.origRender = prototype.render;
	state.patchedRender = patchedRender as RenderFn;
	prototype.render = state.patchedRender;
	state.installed = true;
	return true;
}

function uninstallInsertCaret(): void {
	const state = getPatchState();
	const prototype = Editor.prototype as unknown as { render?: RenderFn };
	if (state.installed && prototype.render === state.patchedRender) {
		prototype.render = state.origRender;
		state.installed = false;
	}
	// Restore the terminal's default cursor shape on the way out (a
	// reload's new runtime re-asserts the bar on its first render).
	for (const write of state.terminals) {
		try {
			write(CURSOR_SHAPE_DEFAULT);
		} catch {
			// Ignore a dead terminal.
		}
	}
	state.terminals.clear();
	state.configuredTuis = new WeakSet();
	state.lastAssertAt.clear();
}

export default function insertCaretExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (!installInsertCaret()) {
			ctx.ui.notify("insert-caret: Editor internals not found; caret unchanged", "warning");
		}
	});

	pi.on("session_shutdown", () => {
		uninstallInsertCaret();
	});

	pi.registerCommand("insert-caret", {
		description: "Report whether the insert-style (Neovim-like) prompt caret is active",
		handler: async (_args, ctx) => {
			const state = getPatchState();
			ctx.ui.notify(
				state.installed
					? `insert-caret: active (bar cursor configured on ${state.configureCount} TUI instance(s))`
					: "insert-caret: inactive (Editor render patch not installed)",
				state.installed ? "info" : "warning",
			);
		},
	});
}
