/**
 * follow-on-send.ts -- follow the transcript end after sending a message.
 *
 * Why this exists
 * ---------------
 * In fullscreen mode the transcript follows new output only while it sits at
 * the exact end. Scroll up a few lines to read the last answer and follow
 * mode turns off, so a new message and its response grow below the fold and
 * the view stays behind.
 *
 * pi has no extension hook for transcript scrolling, so this extension
 * patches one `ScrollView` prototype method for the life of a TUI session:
 *
 * - `updateLayout` runs on every layout. The patch only records the primary
 *   follow-end view (the transcript) and its last content and viewport
 *   heights, then calls the original method. It never moves the view, so
 *   manual scrolling keeps the built-in exact-end rule.
 *
 * On the `input` event (a new user message) and on `user_bash` (a `!`
 * command), the extension checks the recorded view: when the lines hidden
 * below the viewport number at most `NEAR_END_LINES`, it calls the view's
 * own `scrollToEnd()`, which snaps to the end and re-enables follow mode for
 * the output that follows. Farther up, it changes nothing.
 *
 * TypeScript `private` members are runtime properties, but this patch only
 * touches the public surface (`primary`, `followEnd`, `scrollTop`,
 * `isFollowingEnd`, `scrollToEnd`). If `updateLayout` is not present, the
 * extension reports itself inactive and leaves the built-in behavior
 * untouched.
 *
 * Requires fullscreen mode (`tuiMode: "fullscreen"`), which owns the
 * transcript scroll view. In regular mode the terminal owns scrolling and
 * this extension does nothing visible.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ScrollView } from "@earendil-works/pi-tui";

/** Lines hidden below the viewport that still count as near the end. */
export const NEAR_END_LINES = 10;

/** The public ScrollView surface this extension relies on. */
export interface TranscriptViewLike {
	readonly primary: boolean;
	readonly followEnd: boolean;
	readonly scrollTop: number;
	readonly isFollowingEnd: boolean;
	scrollToEnd(): void;
}

/** Last layout metrics recorded for a scroll view. */
export interface TranscriptMetrics {
	contentHeight: number;
	viewportHeight: number;
}

/**
 * Snap a transcript view to its end when it sits near the end.
 *
 * @param view The transcript scroll view.
 * @param metrics Content and viewport heights from its last layout.
 * @param withinLines Lines hidden below the viewport that count as near.
 * @returns Whether the view now sits at and follows the end.
 */
export function snapToEndIfNearEnd(
	view: TranscriptViewLike,
	metrics: TranscriptMetrics,
	withinLines: number = NEAR_END_LINES,
): boolean {
	if (!view.followEnd) return false;
	if (view.isFollowingEnd) return true;
	const threshold = Number.isFinite(withinLines) ? Math.max(0, Math.trunc(withinLines)) : 0;
	const maxScrollTop = Math.max(0, metrics.contentHeight - metrics.viewportHeight);
	if (maxScrollTop - view.scrollTop > threshold) return false;
	view.scrollToEnd();
	return true;
}

// ---------------------------------------------------------------------------
// Prototype patch install / restore
// ---------------------------------------------------------------------------

type UpdateLayoutFn = (
	this: TranscriptViewLike,
	contentHeight: number,
	viewportHeight: number,
	requestRender: () => void,
) => void;

interface ScrollViewPrototype {
	updateLayout?: UpdateLayoutFn;
}

let installed = false;
let originalUpdateLayout: UpdateLayoutFn | undefined;
let transcriptView: WeakRef<TranscriptViewLike> | undefined;
let transcriptMetrics: TranscriptMetrics | undefined;

function patchedUpdateLayout(
	this: TranscriptViewLike,
	contentHeight: number,
	viewportHeight: number,
	requestRender: () => void,
): void {
	originalUpdateLayout!.call(this, contentHeight, viewportHeight, requestRender);
	if (this.primary && this.followEnd) {
		transcriptView = new WeakRef(this);
		transcriptMetrics = { contentHeight, viewportHeight };
	}
}

/** Snap the recorded transcript to its end when it sits near the end. */
export function followTranscriptOnSend(withinLines: number = NEAR_END_LINES): boolean {
	const view = transcriptView?.deref();
	if (!view || !transcriptMetrics) return false;
	return snapToEndIfNearEnd(view, transcriptMetrics, withinLines);
}

function installFollowOnSend(): boolean {
	if (installed) return true;
	const prototype = ScrollView.prototype as unknown as ScrollViewPrototype;
	if (typeof prototype.updateLayout !== "function") return false;
	originalUpdateLayout = prototype.updateLayout;
	prototype.updateLayout = patchedUpdateLayout;
	installed = true;
	return true;
}

function uninstallFollowOnSend(): void {
	if (installed && originalUpdateLayout) {
		const prototype = ScrollView.prototype as unknown as ScrollViewPrototype;
		prototype.updateLayout = originalUpdateLayout;
	}
	originalUpdateLayout = undefined;
	installed = false;
	transcriptView = undefined;
	transcriptMetrics = undefined;
}

export default function followOnSendExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (!installFollowOnSend()) {
			ctx.ui.notify("follow-on-send: transcript scroll internals not found; extension inactive", "warning");
		}
	});

	// A new user message: follow the output it is about to produce when the
	// transcript already sits near the end.
	pi.on("input", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		followTranscriptOnSend();
		return { action: "continue" } as const;
	});

	// `!` commands bypass the input event, but they send output to the
	// transcript too.
	pi.on("user_bash", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		followTranscriptOnSend();
	});

	pi.on("session_shutdown", () => {
		uninstallFollowOnSend();
	});

	pi.registerCommand("follow-on-send", {
		description: "Report whether follow-on-send transcript scrolling is active",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				installed
					? `follow-on-send: active (sending snaps to the end within ${NEAR_END_LINES} lines of it)`
					: "follow-on-send: inactive (patch not installed)",
				installed ? "info" : "warning",
			);
		},
	});
}
