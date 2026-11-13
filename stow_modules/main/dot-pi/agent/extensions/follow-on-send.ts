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

/** Maximum content lines visible in the prompt bar or questionnaire when fully collapsed. */
export const MIN_COLLAPSED_CONTENT_LINES = 3;

const SCROLL_COLLAPSE_SYMBOL = Symbol.for("pi.scroll-collapse");

export interface DockCollapseTarget {
	maxCollapseLines: number;
	onCollapseChange?: () => void;
}

export interface ScrollCollapseStore {
	collapseLines: number;
	questionnaireTarget?: DockCollapseTarget;
	editorTarget?: DockCollapseTarget;
}

export function getScrollCollapseStore(): ScrollCollapseStore {
	const holder = globalThis as Record<symbol, ScrollCollapseStore | undefined>;
	holder[SCROLL_COLLAPSE_SYMBOL] ??= {
		collapseLines: 0,
	};
	return holder[SCROLL_COLLAPSE_SYMBOL]!;
}

function getActiveCollapseTarget(store = getScrollCollapseStore()): DockCollapseTarget | undefined {
	return store.questionnaireTarget ?? store.editorTarget;
}

/** Expand the active dock component (questionnaire or prompt bar) back to its full height immediately. */
export function resetScrollCollapse(): void {
	const store = getScrollCollapseStore();
	if (store.collapseLines !== 0) {
		store.collapseLines = 0;
		getActiveCollapseTarget(store)?.onCollapseChange?.();
	}
}

/**
 * Update the dock collapse offset for a transcript scroll delta (`< 0` = scroll up, `> 0` = scroll down).
 * Scrolling up anywhere in history collapses the dock (gradually on wheel, immediately on PageUp).
 * Scrolling down only expands the dock once at the tail of the history (`hiddenLinesBelow === 0`).
 * Returns the signed change in collapsed lines (`nextCollapse - prevCollapse`).
 */
export function applyTranscriptScrollDelta(
	deltaLines: number,
	isPageOrJump = false,
	hiddenLinesBelow = 0,
): number {
	const store = getScrollCollapseStore();
	const target = getActiveCollapseTarget(store);
	const maxCollapse = Math.max(0, Math.trunc(target?.maxCollapseLines ?? 0));
	const prevCollapse = Math.max(0, Math.min(maxCollapse, store.collapseLines));
	store.collapseLines = prevCollapse;
	if (deltaLines === 0 || maxCollapse === 0) return 0;

	let nextCollapse = prevCollapse;
	if (deltaLines < 0) {
		const step = isPageOrJump ? Math.max(-deltaLines, maxCollapse) : -deltaLines;
		nextCollapse = Math.max(0, Math.min(maxCollapse, prevCollapse + step));
	} else {
		const linesToTail = Math.max(0, Math.trunc(hiddenLinesBelow));
		const tailOverflow = Math.max(0, deltaLines - linesToTail);
		if (tailOverflow > 0) {
			const expandStep = isPageOrJump ? Math.max(tailOverflow, maxCollapse) : tailOverflow;
			nextCollapse = Math.max(0, Math.min(maxCollapse, prevCollapse - expandStep));
		}
	}
	const heightDelta = nextCollapse - prevCollapse;
	if (heightDelta !== 0) {
		store.collapseLines = nextCollapse;
		target?.onCollapseChange?.();
	}
	return heightDelta;
}

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
	currentScrollTop?: number;
	currentViewportHeight?: number;
	followingEnd?: boolean;
	followSuppressedAtEnd?: boolean;
	requestRenderCallback?: () => void;
	scrollBy?(lines: number): number | void;
	scrollTo?(scrollTop: number, options?: { disableFollow?: boolean }): void;
	scrollToStart?(): void;
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
type ScrollByFn = (this: TranscriptViewLike, lines: number) => number;
type ScrollToFn = (this: TranscriptViewLike, scrollTop: number, options?: { disableFollow?: boolean }) => void;
type ScrollToStartFn = (this: TranscriptViewLike) => void;
type ScrollToEndFn = (this: TranscriptViewLike) => void;

interface ScrollViewPrototype {
	updateLayout?: UpdateLayoutFn;
	scrollBy?: ScrollByFn;
	scrollTo?: ScrollToFn;
	scrollToStart?: ScrollToStartFn;
	scrollToEnd?: ScrollToEndFn;
}

interface EditorLayoutLine {
	text: string;
	hasCursor: boolean;
	cursorPos?: number;
}

export interface EditorMouseEventLike {
	type: string;
	button?: string;
	x: number;
	y: number;
	width?: number;
	height?: number;
	wheelDelta?: number;
}

export interface EditorMouseResultLike {
	handled?: boolean;
	focus?: boolean;
	capture?: boolean;
	render?: boolean;
}

interface EditorLike {
	tui?: {
		terminal?: { columns?: number; rows?: number };
		hasOverlay?: () => boolean;
		getPrimaryScrollView?: () => TranscriptViewLike | undefined;
		requestRender?: () => void;
	};
	paddingX?: number;
	lastWidth?: number;
	scrollOffset?: number;
	renderedVisibleLineCount?: number;
	renderedAutocompleteHeight?: number;
	autocompleteState?: unknown;
	autocompleteList?: {
		handleMouse?: (event: EditorMouseEventLike) => EditorMouseResultLike | undefined;
	};
	getPaddingX?(): number;
	getText?(): string;
	setText?(text: string): void;
	layoutText?(contentWidth: number): EditorLayoutLine[];
	renderTopBorder?(width: number, hiddenLineCount: number): string;
	renderBottomBorder?(width: number, hiddenLineCount: number): string;
	render?(width: number): string[];
	handleMouse?(event: EditorMouseEventLike): EditorMouseResultLike | undefined;
	handleInput?(data: string): void;
}

type HandleInputFn = (this: EditorLike, data: string) => void;
type EditorRenderFn = (this: EditorLike, width: number) => string[];
type EditorHandleMouseFn = (this: EditorLike, event: EditorMouseEventLike) => EditorMouseResultLike | undefined;

interface EditorPrototype {
	handleInput?: HandleInputFn;
	render?: EditorRenderFn;
	handleMouse?: EditorHandleMouseFn;
}

interface EditorScrollState {
	manualScrollOffset?: number;
	lastText?: string;
	lastCursorLine?: number;
	lastCursorCol?: number;
	totalLines: number;
	visibleCount: number;
}

const editorScrollStates = new WeakMap<object, EditorScrollState>();

function getEditorScrollState(editor: object): EditorScrollState {
	let state = editorScrollStates.get(editor);
	if (!state) {
		state = { totalLines: 1, visibleCount: 1 };
		editorScrollStates.set(editor, state);
	}
	return state;
}

let installed = false;
let originalUpdateLayout: UpdateLayoutFn | undefined;
let originalScrollBy: ScrollByFn | undefined;
let originalScrollTo: ScrollToFn | undefined;
let originalScrollToStart: ScrollToStartFn | undefined;
let originalScrollToEnd: ScrollToEndFn | undefined;
let originalHandleInput: HandleInputFn | undefined;
let originalEditorRender: EditorRenderFn | undefined;
let originalEditorHandleMouse: EditorHandleMouseFn | undefined;
let transcriptView: WeakRef<TranscriptViewLike> | undefined;
let transcriptMetrics: TranscriptMetrics | undefined;
let collapseLinesAtLastLayout = 0;

function recordTranscriptLayout(view: TranscriptViewLike, contentHeight: number, viewportHeight: number): void {
	transcriptView = new WeakRef(view);
	collapseLinesAtLastLayout = getScrollCollapseStore().collapseLines;
	const lastMessageStartRow = findLastMessageStartRow(view.child);
	transcriptMetrics = {
		contentHeight,
		viewportHeight,
		...(lastMessageStartRow === undefined ? {} : { lastMessageStartRow }),
	};
}

function getHiddenLinesBelow(view: TranscriptViewLike): number {
	const store = getScrollCollapseStore();
	const contentHeight = view.contentHeight ?? transcriptMetrics?.contentHeight ?? 0;
	const currentViewportHeight =
		view.viewportHeight ?? view.currentViewportHeight ?? transcriptMetrics?.viewportHeight ?? 0;
	const baseViewportHeight = Math.max(1, currentViewportHeight - collapseLinesAtLastLayout);
	const effectiveViewportHeight = baseViewportHeight + store.collapseLines;
	const maxScrollTop = Math.max(0, contentHeight - effectiveViewportHeight);
	const currentTop = view.isFollowingEnd ? maxScrollTop : view.scrollTop;
	return Math.max(0, maxScrollTop - currentTop);
}

function syncViewportHeightForCollapse(view: TranscriptViewLike): void {
	const store = getScrollCollapseStore();
	if (typeof view.currentViewportHeight === "number" && store.collapseLines < collapseLinesAtLastLayout) {
		const shrink = collapseLinesAtLastLayout - store.collapseLines;
		view.currentViewportHeight = Math.max(1, view.currentViewportHeight - shrink);
		collapseLinesAtLastLayout = store.collapseLines;
	}
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
	if (installed && this.primary && this.followEnd) {
		const store = getScrollCollapseStore();
		if (store.collapseLines > 0) {
			this.followingEnd = false;
			this.followSuppressedAtEnd = true;
		}
	}
	originalUpdateLayout!.call(this, contentHeight, viewportHeight, requestRender);
	if (installed && this.primary && this.followEnd) {
		const store = getScrollCollapseStore();
		if (store.collapseLines > 0) {
			this.followingEnd = false;
			this.followSuppressedAtEnd = true;
		}
		recordTranscriptLayout(this, contentHeight, viewportHeight);
	}
}

function patchedScrollBy(this: TranscriptViewLike, lines: number): number {
	if (!installed || !this.primary || !this.followEnd) {
		return originalScrollBy!.call(this, lines);
	}
	const requested = Number.isFinite(lines) ? Math.trunc(lines) : 0;
	if (requested === 0) {
		return originalScrollBy!.call(this, lines);
	}
	const viewportHeight = this.viewportHeight ?? this.currentViewportHeight ?? 0;
	const pageThreshold = viewportHeight > 5 ? Math.max(1, viewportHeight - 4) : Number.POSITIVE_INFINITY;
	const isPageScroll = Math.abs(requested) >= pageThreshold;
	const hiddenLinesBelow = requested > 0 ? getHiddenLinesBelow(this) : 0;
	const heightDelta = applyTranscriptScrollDelta(requested, isPageScroll, hiddenLinesBelow);

	if (heightDelta < 0) {
		syncViewportHeightForCollapse(this);
	}

	let effectiveRequest = requested;
	if (isPageScroll && heightDelta > 0) {
		effectiveRequest = -Math.max(-requested, heightDelta + 1);
	} else if (isPageScroll && heightDelta < 0) {
		effectiveRequest = Math.max(requested, -heightDelta);
	}

	const remaining = originalScrollBy!.call(this, effectiveRequest);
	const store = getScrollCollapseStore();
	if (store.collapseLines > 0) {
		this.followingEnd = false;
		this.followSuppressedAtEnd = true;
	} else if (this.isFollowingEnd) {
		this.followSuppressedAtEnd = false;
	}
	if (heightDelta !== 0) {
		this.requestRenderCallback?.();
	}
	return remaining;
}

function patchedScrollTo(
	this: TranscriptViewLike,
	scrollTop: number,
	options?: { disableFollow?: boolean },
): void {
	if (!installed || !this.primary || !this.followEnd) {
		originalScrollTo!.call(this, scrollTop, options);
		return;
	}
	const target = Number.isFinite(scrollTop) ? Math.trunc(scrollTop) : this.scrollTop;
	const delta = target - this.scrollTop;
	const hiddenLinesBelow = delta > 0 ? getHiddenLinesBelow(this) : 0;
	const heightDelta = delta !== 0 ? applyTranscriptScrollDelta(delta, false, hiddenLinesBelow) : 0;
	if (heightDelta < 0) {
		syncViewportHeightForCollapse(this);
	}
	originalScrollTo!.call(this, scrollTop, options);
	const store = getScrollCollapseStore();
	if (store.collapseLines > 0) {
		this.followingEnd = false;
		this.followSuppressedAtEnd = true;
	}
	if (heightDelta !== 0) {
		this.requestRenderCallback?.();
	}
}

function patchedScrollToStart(this: TranscriptViewLike): void {
	if (!installed || !this.primary || !this.followEnd) {
		originalScrollToStart!.call(this);
		return;
	}
	const store = getScrollCollapseStore();
	const maxCollapse = Math.max(0, Math.trunc(getActiveCollapseTarget(store)?.maxCollapseLines ?? 0));
	const heightDelta = applyTranscriptScrollDelta(-Math.max(1, maxCollapse), true);
	originalScrollToStart!.call(this);
	if (store.collapseLines > 0) {
		this.followingEnd = false;
		this.followSuppressedAtEnd = true;
	}
	if (heightDelta !== 0) {
		this.requestRenderCallback?.();
	}
}

function patchedScrollToEnd(this: TranscriptViewLike): void {
	if (!installed || !this.primary || !this.followEnd) {
		originalScrollToEnd!.call(this);
		return;
	}
	const store = getScrollCollapseStore();
	const maxCollapse = Math.max(0, Math.trunc(getActiveCollapseTarget(store)?.maxCollapseLines ?? 0));
	const heightDelta = applyTranscriptScrollDelta(Math.max(1, maxCollapse), true);
	if (heightDelta < 0) {
		syncViewportHeightForCollapse(this);
	}
	this.followSuppressedAtEnd = false;
	originalScrollToEnd!.call(this);
	if (heightDelta !== 0) {
		this.requestRenderCallback?.();
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

/** Whether `data` is a vertical navigation key sequence (Up/Down/Ctrl+P/Ctrl+N). */
export function isVerticalKeyData(data: string): boolean {
	return (
		data === "up" ||
		data === "down" ||
		data === "\x10" ||
		data === "\x0e" ||
		/^\x1b(?:\[(?:1;[0-9:]+)?[AB]|O[AB]|\[(?:57352|57353|112;5|110;5)(?:;[0-9:]+)?u)$/.test(data)
	);
}

function patchedEditorRender(this: EditorLike, width: number): string[] {
	if (
		!installed ||
		typeof this.layoutText !== "function" ||
		typeof this.renderTopBorder !== "function" ||
		typeof this.renderBottomBorder !== "function"
	) {
		return originalEditorRender!.call(this, width);
	}

	const editorState = getEditorScrollState(this);
	const currentText = typeof this.getText === "function" ? this.getText() : undefined;
	if (currentText !== undefined && currentText !== editorState.lastText) {
		editorState.manualScrollOffset = undefined;
		editorState.lastText = currentText;
	}

	const paddingProp = typeof this.getPaddingX === "function" ? this.getPaddingX() : (this.paddingX ?? 0);
	const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
	const paddingX = Math.min(paddingProp, maxPadding);
	const contentWidth = Math.max(1, width - paddingX * 2);
	const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1));
	const fullLayoutLines = this.layoutText(layoutWidth);
	const totalLines = fullLayoutLines.length;
	const currentCursorLine = fullLayoutLines.findIndex((line) => line.hasCursor);
	const currentCursorCol = currentCursorLine >= 0 ? fullLayoutLines[currentCursorLine]?.cursorPos : undefined;
	if (
		editorState.lastCursorLine !== undefined &&
		(currentCursorLine !== editorState.lastCursorLine || currentCursorCol !== editorState.lastCursorCol)
	) {
		editorState.manualScrollOffset = undefined;
		if (currentCursorLine !== editorState.lastCursorLine && !this.tui?.hasOverlay?.()) {
			getScrollCollapseStore().collapseLines = 0;
		}
	}
	editorState.lastCursorLine = currentCursorLine;
	editorState.lastCursorCol = currentCursorCol;

	const terminalRows = this.tui?.terminal?.rows ?? 40;
	const defaultMaxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3));
	const fullVisibleCount = Math.min(totalLines, defaultMaxVisibleLines);
	const minVisibleCount = Math.min(fullVisibleCount, MIN_COLLAPSED_CONTENT_LINES);
	const maxCollapseLines = Math.max(0, fullVisibleCount - minVisibleCount);

	const store = getScrollCollapseStore();
	if (!this.tui?.hasOverlay?.()) {
		store.editorTarget = {
			maxCollapseLines,
			onCollapseChange: () => {
				this.tui?.requestRender?.();
			},
		};
	}

	const collapseLines = store.questionnaireTarget
		? 0
		: Math.max(0, Math.min(maxCollapseLines, store.collapseLines));
	const effectiveMaxVisibleLines = Math.max(minVisibleCount, fullVisibleCount - collapseLines);
	const maxScrollOffset = Math.max(0, totalLines - effectiveMaxVisibleLines);

	let targetScrollOffset: number;
	if (editorState.manualScrollOffset !== undefined) {
		targetScrollOffset = Math.max(0, Math.min(editorState.manualScrollOffset, maxScrollOffset));
		editorState.manualScrollOffset = targetScrollOffset;
	} else {
		let cursorLineIndex = fullLayoutLines.findIndex((line) => line.hasCursor);
		if (cursorLineIndex === -1) cursorLineIndex = 0;
		let offset = this.scrollOffset ?? 0;
		if (cursorLineIndex < offset) {
			offset = cursorLineIndex;
		} else if (cursorLineIndex >= offset + effectiveMaxVisibleLines) {
			offset = cursorLineIndex - effectiveMaxVisibleLines + 1;
		}
		targetScrollOffset = Math.max(0, Math.min(offset, maxScrollOffset));
	}

	const visibleLayoutLines = fullLayoutLines.slice(
		targetScrollOffset,
		targetScrollOffset + effectiveMaxVisibleLines,
	);
	editorState.totalLines = totalLines;
	editorState.visibleCount = visibleLayoutLines.length;

	const ownLayoutText = Object.prototype.hasOwnProperty.call(this, "layoutText") ? this.layoutText : undefined;
	this.layoutText = () => visibleLayoutLines;
	this.scrollOffset = 0;
	let result: string[];
	try {
		result = originalEditorRender!.call(this, width);
	} finally {
		if (ownLayoutText !== undefined) this.layoutText = ownLayoutText;
		else Reflect.deleteProperty(this, "layoutText");
	}

	this.scrollOffset = targetScrollOffset;
	this.renderedVisibleLineCount = visibleLayoutLines.length;
	if (result.length >= visibleLayoutLines.length + 2) {
		result[0] = this.renderTopBorder(width, targetScrollOffset);
		const linesBelow = Math.max(0, totalLines - (targetScrollOffset + visibleLayoutLines.length));
		result[visibleLayoutLines.length + 1] = this.renderBottomBorder(width, linesBelow);
	}
	return result;
}

function patchedEditorHandleMouse(
	this: EditorLike,
	event: EditorMouseEventLike,
): EditorMouseResultLike | undefined {
	if (!installed) {
		return originalEditorHandleMouse?.call(this, event);
	}
	const editorState = getEditorScrollState(this);
	if (event.type === "wheel") {
		const autocompleteStartRow = (this.renderedVisibleLineCount ?? 1) + 2;
		const autocompleteHeight = this.renderedAutocompleteHeight ?? 0;
		if (
			this.autocompleteState &&
			this.autocompleteList &&
			event.y >= autocompleteStartRow &&
			event.y < autocompleteStartRow + autocompleteHeight
		) {
			return originalEditorHandleMouse?.call(this, event);
		}
		const delta =
			typeof event.wheelDelta === "number" && Number.isFinite(event.wheelDelta)
				? Math.trunc(event.wheelDelta)
				: 0;
		const store = getScrollCollapseStore();
		let expanded = false;
		let remainingDelta = delta;
		if (delta > 0 && !store.questionnaireTarget && store.collapseLines > 0) {
			const maxCollapse = Math.max(0, Math.trunc(store.editorTarget?.maxCollapseLines ?? store.collapseLines));
			const currentCollapse = Math.max(0, Math.min(maxCollapse, store.collapseLines));
			const expandStep = Math.min(currentCollapse, delta);
			if (expandStep > 0) {
				store.collapseLines = currentCollapse - expandStep;
				remainingDelta = delta - expandStep;
				expanded = true;
				const view = transcriptView?.deref();
				if (view) {
					syncViewportHeightForCollapse(view);
					if (store.collapseLines === 0 && getHiddenLinesBelow(view) === 0) {
						view.followSuppressedAtEnd = false;
					}
				}
			}
		}
		const totalLines =
			typeof this.layoutText === "function"
				? this.layoutText(this.lastWidth ?? 80).length
				: editorState.totalLines;
		const terminalRows = this.tui?.terminal?.rows ?? 40;
		const defaultMaxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3));
		const fullVisibleCount = Math.min(totalLines, defaultMaxVisibleLines);
		const minVisibleCount = Math.min(fullVisibleCount, MIN_COLLAPSED_CONTENT_LINES);
		const maxCollapseLines = Math.max(0, fullVisibleCount - minVisibleCount);
		const activeCollapse = store.questionnaireTarget
			? 0
			: Math.max(0, Math.min(maxCollapseLines, store.collapseLines));
		const visibleCount = Math.max(minVisibleCount, fullVisibleCount - activeCollapse);
		const maxScrollOffset = Math.max(0, totalLines - visibleCount);
		const rawOffset = editorState.manualScrollOffset ?? this.scrollOffset ?? 0;
		const currentOffset = Math.max(0, Math.min(maxScrollOffset, rawOffset));
		const nextOffset = Math.max(0, Math.min(maxScrollOffset, currentOffset + remainingDelta));
		if (remainingDelta !== 0 && maxScrollOffset > 0) {
			editorState.manualScrollOffset = nextOffset;
			this.scrollOffset = nextOffset;
		} else if (expanded && editorState.manualScrollOffset !== undefined) {
			editorState.manualScrollOffset = Math.max(0, Math.min(maxScrollOffset, editorState.manualScrollOffset));
			this.scrollOffset = editorState.manualScrollOffset;
		}
		return { handled: true, render: expanded || nextOffset !== currentOffset };
	}
	if (event.type === "press" || event.type === "click" || event.type === "drag") {
		editorState.manualScrollOffset = undefined;
	}
	return originalEditorHandleMouse?.call(this, event);
}

function patchedHandleInput(this: EditorLike, data: string): void {
	if (!installed) {
		originalHandleInput!.call(this, data);
		return;
	}
	const editorState = getEditorScrollState(this);
	editorState.manualScrollOffset = undefined;
	const beforeText = typeof this.getText === "function" ? this.getText() : undefined;
	if (!this.tui?.hasOverlay?.() && isVerticalKeyData(data)) {
		resetScrollCollapse();
	}
	originalHandleInput!.call(this, data);
	const afterText = typeof this.getText === "function" ? this.getText() : undefined;
	editorState.lastText = afterText;
	if (!this.tui?.hasOverlay?.() && beforeText !== afterText) {
		resetScrollCollapse();
	}
	if (this.tui?.hasOverlay?.()) return;
	if (!isSubmitKeyData(data)) return;
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
	resetScrollCollapse();
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

	if (typeof scrollPrototype.scrollBy === "function") {
		originalScrollBy = scrollPrototype.scrollBy;
		(patchedScrollBy as ScrollByFn & ChainedPatch<ScrollByFn>).__inactive = false;
		(patchedScrollBy as ScrollByFn & ChainedPatch<ScrollByFn>).__prev = originalScrollBy;
		scrollPrototype.scrollBy = patchedScrollBy;
	}
	if (typeof scrollPrototype.scrollTo === "function") {
		originalScrollTo = scrollPrototype.scrollTo;
		(patchedScrollTo as ScrollToFn & ChainedPatch<ScrollToFn>).__inactive = false;
		(patchedScrollTo as ScrollToFn & ChainedPatch<ScrollToFn>).__prev = originalScrollTo;
		scrollPrototype.scrollTo = patchedScrollTo;
	}
	if (typeof scrollPrototype.scrollToStart === "function") {
		originalScrollToStart = scrollPrototype.scrollToStart;
		(patchedScrollToStart as ScrollToStartFn & ChainedPatch<ScrollToStartFn>).__inactive = false;
		(patchedScrollToStart as ScrollToStartFn & ChainedPatch<ScrollToStartFn>).__prev = originalScrollToStart;
		scrollPrototype.scrollToStart = patchedScrollToStart;
	}
	if (typeof scrollPrototype.scrollToEnd === "function") {
		originalScrollToEnd = scrollPrototype.scrollToEnd;
		(patchedScrollToEnd as ScrollToEndFn & ChainedPatch<ScrollToEndFn>).__inactive = false;
		(patchedScrollToEnd as ScrollToEndFn & ChainedPatch<ScrollToEndFn>).__prev = originalScrollToEnd;
		scrollPrototype.scrollToEnd = patchedScrollToEnd;
	}

	const editorPrototype = Editor.prototype as unknown as EditorPrototype;
	if (typeof editorPrototype.handleInput === "function") {
		originalHandleInput = editorPrototype.handleInput;
		(patchedHandleInput as HandleInputFn & ChainedPatch<HandleInputFn>).__inactive = false;
		(patchedHandleInput as HandleInputFn & ChainedPatch<HandleInputFn>).__prev = originalHandleInput;
		editorPrototype.handleInput = patchedHandleInput;
	}
	if (typeof editorPrototype.render === "function") {
		originalEditorRender = editorPrototype.render;
		(patchedEditorRender as EditorRenderFn & ChainedPatch<EditorRenderFn>).__inactive = false;
		(patchedEditorRender as EditorRenderFn & ChainedPatch<EditorRenderFn>).__prev = originalEditorRender;
		editorPrototype.render = patchedEditorRender;
	}
	if (typeof editorPrototype.handleMouse === "function") {
		originalEditorHandleMouse = editorPrototype.handleMouse;
		(patchedEditorHandleMouse as EditorHandleMouseFn & ChainedPatch<EditorHandleMouseFn>).__inactive = false;
		(patchedEditorHandleMouse as EditorHandleMouseFn & ChainedPatch<EditorHandleMouseFn>).__prev =
			originalEditorHandleMouse;
		editorPrototype.handleMouse = patchedEditorHandleMouse;
	}

	const store = getScrollCollapseStore();
	store.collapseLines = 0;
	store.questionnaireTarget = undefined;
	store.editorTarget = undefined;
	collapseLinesAtLastLayout = 0;
	installed = true;
	return true;
}

function uninstallFollowOnSend(): void {
	const scrollPrototype = ScrollView.prototype as unknown as ScrollViewPrototype;
	if (installed && originalUpdateLayout) {
		(patchedUpdateLayout as UpdateLayoutFn & ChainedPatch<UpdateLayoutFn>).__inactive = true;
		scrollPrototype.updateLayout = unwrapPrototypeChain(scrollPrototype.updateLayout);
	}
	if (installed && originalScrollBy) {
		(patchedScrollBy as ScrollByFn & ChainedPatch<ScrollByFn>).__inactive = true;
		scrollPrototype.scrollBy = unwrapPrototypeChain(scrollPrototype.scrollBy);
	}
	if (installed && originalScrollTo) {
		(patchedScrollTo as ScrollToFn & ChainedPatch<ScrollToFn>).__inactive = true;
		scrollPrototype.scrollTo = unwrapPrototypeChain(scrollPrototype.scrollTo);
	}
	if (installed && originalScrollToStart) {
		(patchedScrollToStart as ScrollToStartFn & ChainedPatch<ScrollToStartFn>).__inactive = true;
		scrollPrototype.scrollToStart = unwrapPrototypeChain(scrollPrototype.scrollToStart);
	}
	if (installed && originalScrollToEnd) {
		(patchedScrollToEnd as ScrollToEndFn & ChainedPatch<ScrollToEndFn>).__inactive = true;
		scrollPrototype.scrollToEnd = unwrapPrototypeChain(scrollPrototype.scrollToEnd);
	}
	const editorPrototype = Editor.prototype as unknown as EditorPrototype;
	if (installed && originalHandleInput) {
		(patchedHandleInput as HandleInputFn & ChainedPatch<HandleInputFn>).__inactive = true;
		editorPrototype.handleInput = unwrapPrototypeChain(editorPrototype.handleInput);
	}
	if (installed && originalEditorRender) {
		(patchedEditorRender as EditorRenderFn & ChainedPatch<EditorRenderFn>).__inactive = true;
		editorPrototype.render = unwrapPrototypeChain(editorPrototype.render);
	}
	if (installed && originalEditorHandleMouse) {
		(patchedEditorHandleMouse as EditorHandleMouseFn & ChainedPatch<EditorHandleMouseFn>).__inactive = true;
		editorPrototype.handleMouse = unwrapPrototypeChain(editorPrototype.handleMouse);
	}
	installed = false;
	transcriptView = undefined;
	transcriptMetrics = undefined;
	collapseLinesAtLastLayout = 0;
	const store = getScrollCollapseStore();
	store.collapseLines = 0;
	store.editorTarget = undefined;
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
