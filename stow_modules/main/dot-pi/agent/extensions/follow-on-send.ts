/**
 * follow-on-send.ts -- follow the transcript end after submitting a prompt.
 *
 * Why this exists
 * ---------------
 * In fullscreen mode the transcript follows new output only while it sits at
 * the exact end. Scroll up to read the last answer and follow mode turns off,
 * so the `↓ Jump to latest message` indicator stays up and a new message and
 * its response grow below the fold while the view stays behind.
 *
 * pi has no extension hook for transcript scrolling, so this extension
 * patches two prototypes for the life of a TUI session:
 *
 * - `ScrollView.prototype.updateLayout` runs on every layout. The patch
 *   records the primary follow-end view (the transcript) and its last content
 *   and viewport heights, then calls the original method. It never moves the
 *   view, so manual scrolling and typing keep the current scroll position.
 * - `Editor.prototype.handleInput` runs when typing or submitting in the
 *   prompt editor. Only when hitting submit (Enter) clears a non-empty prompt
 *   (and no overlay is open) does it snap the transcript back to the end if
 *   the scroll view is close enough to the tail of the conversation.
 *
 * On prompt submit (`Editor.handleInput` on Enter, `input` event, and
 * `user_bash` `!` command), the extension checks the recorded view: when the
 * hidden tail below the viewport is at most `max(NEAR_END_LINES, viewportHeight)`
 * lines, it calls the view's own `scrollToEnd()`, which snaps to the end and
 * re-enables follow mode for the output that follows. Farther up in history,
 * it changes nothing.
 *
 * Requires fullscreen mode (`tuiMode: "fullscreen"`), which owns the
 * transcript scroll view. In regular mode the terminal owns scrolling and
 * this extension does nothing visible.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, ScrollView } from "@earendil-works/pi-tui";

/** Minimum lines hidden below the viewport that still count as near the end. */
export const NEAR_END_LINES = 10;

/** Layout entry recorded by pi-tui's `Container.render`. */
export interface MouseLayoutChild {
	readonly component: unknown;
	readonly height: number;
}

/** Container-like child with `mouseLayout` from the last render pass. */
export interface TranscriptDocumentLike {
	readonly mouseLayout?: {
		readonly width: number;
		readonly children: readonly MouseLayoutChild[];
	};
}

/** The public ScrollView surface this extension relies on. */
export interface TranscriptViewLike {
	readonly primary: boolean;
	readonly followEnd: boolean;
	readonly scrollTop: number;
	readonly isFollowingEnd: boolean;
	readonly child?: unknown;
	readonly contentHeight?: number;
	readonly viewportHeight?: number;
	scrollToEnd(): void;
}

/** Last layout metrics recorded for a scroll view. */
export interface TranscriptMetrics {
	contentHeight: number;
	viewportHeight: number;
	/** Start row of the most recent message or turn, when known. */
	lastMessageStartRow?: number;
}

type TranscriptComponentKind =
	| "container"
	| "skill"
	| "user"
	| "standalone"
	| "assistant"
	| "tool"
	| "spacer"
	| "other";

function classifyTranscriptComponent(component: unknown): TranscriptComponentKind {
	if (!component || typeof component !== "object") return "other";
	const candidate = component as Record<string, unknown>;
	const name = (component as { constructor?: { name?: string } }).constructor?.name ?? "";

	if (name === "SkillInvocationMessageComponent" || candidate.role === "skill") return "skill";
	if (
		name === "UserMessageComponent" ||
		candidate.role === "user" ||
		("text" in candidate && "markdownTransformers" in candidate && !("lastMessage" in candidate))
	) {
		return "user";
	}
	if (
		name === "BashExecutionComponent" ||
		name === "CustomMessageComponent" ||
		name === "CustomEntryComponent" ||
		name === "CompactionSummaryMessageComponent" ||
		name === "BranchSummaryMessageComponent" ||
		candidate.role === "custom" ||
		candidate.role === "bashExecution"
	) {
		return "standalone";
	}
	if (
		name === "AssistantMessageComponent" ||
		candidate.role === "assistant" ||
		("lastMessage" in candidate && "contentContainer" in candidate)
	) {
		return "assistant";
	}
	if (name === "ToolExecutionComponent" || candidate.role === "tool" || ("toolName" in candidate && "toolCallId" in candidate)) {
		return "tool";
	}
	if (name === "Spacer") return "spacer";
	if (Array.isArray((component as TranscriptDocumentLike).mouseLayout?.children)) return "container";
	return "other";
}

/**
 * Find the start row of the most recent message or turn in a rendered
 * transcript document container.
 */
export function findLastMessageStartRow(root: unknown): number | undefined {
	if (!root || typeof root !== "object") return undefined;
	let rowOffset = 0;
	let lastTurnStartRow: number | undefined;
	let inTurn = false;
	let afterSkillBlock = false;

	const visit = (node: unknown): void => {
		if (!node || typeof node !== "object") return;
		const children = (node as TranscriptDocumentLike).mouseLayout?.children;
		if (!Array.isArray(children)) return;
		for (const entry of children) {
			const height = Number.isFinite(entry?.height) ? Math.max(0, Math.trunc(entry.height)) : 0;
			const comp = entry?.component;
			const kind = classifyTranscriptComponent(comp);
			if (kind === "container") {
				visit(comp);
				continue;
			}
			if (height > 0) {
				if (kind === "skill") {
					lastTurnStartRow = rowOffset;
					inTurn = true;
					afterSkillBlock = true;
				} else if (kind === "user") {
					if (!afterSkillBlock) lastTurnStartRow = rowOffset;
					inTurn = true;
					afterSkillBlock = false;
				} else if (kind === "standalone") {
					lastTurnStartRow = rowOffset;
					inTurn = false;
					afterSkillBlock = false;
				} else if (kind === "assistant") {
					afterSkillBlock = false;
					if (!inTurn) lastTurnStartRow = rowOffset;
					const assistant = comp as { hasToolCalls?: boolean; isStreaming?: boolean };
					inTurn = Boolean(assistant.hasToolCalls || assistant.isStreaming);
				} else if (kind === "tool") {
					afterSkillBlock = false;
					if (!inTurn) lastTurnStartRow = rowOffset;
					inTurn = true;
				} else if (kind !== "spacer") {
					afterSkillBlock = false;
				}
			}
			rowOffset += height;
		}
	};

	visit(root);
	return lastTurnStartRow;
}

/**
 * Snap a transcript view to its end when it sits close enough to the tail of
 * the conversation.
 *
 * @param view The transcript scroll view.
 * @param metrics Content and viewport heights from its last layout.
 * @param withinLines Lines hidden below the viewport that count as near (defaults to `max(NEAR_END_LINES, viewportHeight)`).
 * @returns Whether the view now sits at and follows the end.
 */
export function snapToEndIfNearEnd(
	view: TranscriptViewLike,
	metrics: TranscriptMetrics,
	withinLines?: number,
): boolean {
	if (!view.followEnd) return false;
	if (view.isFollowingEnd) return true;
	const threshold =
		withinLines === undefined
			? Math.max(NEAR_END_LINES, Math.max(0, Math.trunc(metrics.viewportHeight)))
			: Number.isFinite(withinLines)
				? Math.max(0, Math.trunc(withinLines))
				: 0;
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

interface EditorLike {
	tui?: {
		hasOverlay?: () => boolean;
		getPrimaryScrollView?: () => TranscriptViewLike | undefined;
	};
	getText?(): string;
	handleInput?(data: string): void;
}

type HandleInputFn = (this: EditorLike, data: string) => void;

interface EditorPrototype {
	handleInput?: HandleInputFn;
}

let installed = false;
let originalUpdateLayout: UpdateLayoutFn | undefined;
let originalHandleInput: HandleInputFn | undefined;
let transcriptView: WeakRef<TranscriptViewLike> | undefined;
let transcriptMetrics: TranscriptMetrics | undefined;

function recordTranscriptLayout(view: TranscriptViewLike, contentHeight: number, viewportHeight: number): void {
	transcriptView = new WeakRef(view);
	const lastMessageStartRow = findLastMessageStartRow(view.child);
	transcriptMetrics = {
		contentHeight,
		viewportHeight,
		...(lastMessageStartRow === undefined ? {} : { lastMessageStartRow }),
	};
}

interface ChainedPatch<Fn> {
	__inactive?: boolean;
	__prev?: Fn;
}

function unwrapPrototypeChain<Fn>(current: Fn | undefined): Fn | undefined {
	let cursor = current as (Fn & ChainedPatch<Fn>) | undefined;
	while (cursor?.__inactive && cursor.__prev) {
		cursor = cursor.__prev as Fn & ChainedPatch<Fn>;
	}
	return cursor;
}

function patchedUpdateLayout(
	this: TranscriptViewLike,
	contentHeight: number,
	viewportHeight: number,
	requestRender: () => void,
): void {
	originalUpdateLayout!.call(this, contentHeight, viewportHeight, requestRender);
	if (installed && this.primary && this.followEnd) {
		recordTranscriptLayout(this, contentHeight, viewportHeight);
	}
}

/** Whether `data` is an unmodified Enter/submit key sequence. */
export function isSubmitKeyData(data: string): boolean {
	return (
		data === "\r" ||
		data === "\n" ||
		data === "\x1bOM" ||
		data === "\x1b[13~" ||
		/^(\x1b\[13(?:;1(?::\d+)?)?u|\x1b\[27;1;13~)$/.test(data)
	);
}

function patchedHandleInput(this: EditorLike, data: string): void {
	if (!installed) {
		originalHandleInput!.call(this, data);
		return;
	}
	const beforeText = typeof this.getText === "function" ? this.getText() : undefined;
	originalHandleInput!.call(this, data);
	if (this.tui?.hasOverlay?.()) return;
	if (!isSubmitKeyData(data)) return;
	const afterText = typeof this.getText === "function" ? this.getText() : undefined;
	if (beforeText !== undefined && beforeText.trim().length > 0 && afterText === "") {
		if (!transcriptView?.deref()) {
			const primary = this.tui?.getPrimaryScrollView?.();
			if (primary && primary.primary && primary.followEnd) {
				recordTranscriptLayout(
					primary,
					primary.contentHeight ?? 0,
					primary.viewportHeight ?? 0,
				);
			}
		}
		followTranscriptOnSend();
	}
}

/** Snap the recorded transcript to its end when it sits near the most recent message. */
export function followTranscriptOnSend(withinLines?: number): boolean {
	const view = transcriptView?.deref();
	if (!view || !transcriptMetrics) return false;
	return snapToEndIfNearEnd(view, transcriptMetrics, withinLines);
}

function installFollowOnSend(): boolean {
	if (installed) return true;
	const scrollPrototype = ScrollView.prototype as unknown as ScrollViewPrototype;
	if (typeof scrollPrototype.updateLayout !== "function") return false;
	originalUpdateLayout = scrollPrototype.updateLayout;
	(patchedUpdateLayout as UpdateLayoutFn & ChainedPatch<UpdateLayoutFn>).__inactive = false;
	(patchedUpdateLayout as UpdateLayoutFn & ChainedPatch<UpdateLayoutFn>).__prev = originalUpdateLayout;
	scrollPrototype.updateLayout = patchedUpdateLayout;

	const editorPrototype = Editor.prototype as unknown as EditorPrototype;
	if (typeof editorPrototype.handleInput === "function") {
		originalHandleInput = editorPrototype.handleInput;
		(patchedHandleInput as HandleInputFn & ChainedPatch<HandleInputFn>).__inactive = false;
		(patchedHandleInput as HandleInputFn & ChainedPatch<HandleInputFn>).__prev = originalHandleInput;
		editorPrototype.handleInput = patchedHandleInput;
	}

	installed = true;
	return true;
}

function uninstallFollowOnSend(): void {
	if (installed && originalUpdateLayout) {
		(patchedUpdateLayout as UpdateLayoutFn & ChainedPatch<UpdateLayoutFn>).__inactive = true;
		const scrollPrototype = ScrollView.prototype as unknown as ScrollViewPrototype;
		scrollPrototype.updateLayout = unwrapPrototypeChain(scrollPrototype.updateLayout);
	}
	if (installed && originalHandleInput) {
		(patchedHandleInput as HandleInputFn & ChainedPatch<HandleInputFn>).__inactive = true;
		const editorPrototype = Editor.prototype as unknown as EditorPrototype;
		editorPrototype.handleInput = unwrapPrototypeChain(editorPrototype.handleInput);
	}
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
	pi.on("input", (event, ctx) => {
		if (ctx.mode !== "tui") return;
		if ((event as { source?: string })?.source && (event as { source?: string }).source !== "interactive") {
			return { action: "continue" } as const;
		}
		followTranscriptOnSend();
		return { action: "continue" } as const;
	});

	// `!` commands bypass the input event, but they send output to the
	// transcript too.
	pi.on("user_bash", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		followTranscriptOnSend();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx && ctx.mode !== "tui") return;
		uninstallFollowOnSend();
	});

	pi.registerCommand("follow-on-send", {
		description: "Report whether follow-on-send transcript scrolling is active",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				installed
					? `follow-on-send: active (submitting snaps to the end when near the tail of the conversation)`
					: "follow-on-send: inactive (patch not installed)",
				installed ? "info" : "warning",
			);
		},
	});
}
