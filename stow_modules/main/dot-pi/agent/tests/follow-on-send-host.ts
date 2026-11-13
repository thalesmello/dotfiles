/**
 * Test host for follow-on-send.test.ts.
 *
 * Exports the pi-tui surface the extension imports: a fake ScrollView with
 * the real follow-end semantics the extension relies on. Following sticks
 * to the end on layout, scrolling away turns following off, and only
 * reaching the exact end (or scrollToEnd) turns it back on.
 *
 * This file is not a test and pi never loads it; the test redirects the
 * extension's "@earendil-works/pi-tui" import here.
 */
export class FakeScrollView {
	readonly child: unknown;
	readonly followEnd: boolean;
	readonly primary: boolean;
	currentScrollTop = 0;
	contentHeight = 0;
	currentViewportHeight = 0;
	followingEnd: boolean;
	followSuppressedAtEnd = false;
	requestRenderCallback: (() => void) | undefined;

	constructor(
		childOrOptions: unknown = {},
		maybeOptions?: { follow?: "none" | "end"; primary?: boolean; child?: unknown },
	) {
		const hasExplicitChild = maybeOptions !== undefined;
		const options = (hasExplicitChild ? maybeOptions : childOrOptions) as {
			follow?: "none" | "end";
			primary?: boolean;
			child?: unknown;
		} ?? {};
		this.child = hasExplicitChild ? childOrOptions : options.child;
		this.followEnd = (options.follow ?? "none") === "end";
		this.followingEnd = this.followEnd;
		this.primary = options.primary ?? false;
	}

	get scrollTop(): number {
		return this.currentScrollTop;
	}

	get isFollowingEnd(): boolean {
		return this.followingEnd;
	}

	get viewportHeight(): number {
		return this.currentViewportHeight;
	}

	private get maxScrollTop(): number {
		return Math.max(0, this.contentHeight - this.currentViewportHeight);
	}

	updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void {
		this.contentHeight = contentHeight;
		this.currentViewportHeight = viewportHeight;
		this.requestRenderCallback = requestRender;
		this.currentScrollTop = this.followingEnd
			? this.maxScrollTop
			: Math.max(0, Math.min(this.currentScrollTop, this.maxScrollTop));
		if (this.currentScrollTop < this.maxScrollTop) {
			this.followSuppressedAtEnd = false;
		}
		if (this.followEnd && this.currentScrollTop === this.maxScrollTop && !this.followSuppressedAtEnd) {
			this.followingEnd = true;
		}
	}

	scrollBy(lines: number): number {
		const requested = Number.isFinite(lines) ? Math.trunc(lines) : 0;
		if (requested === 0) return 0;
		const start = this.followingEnd ? this.maxScrollTop : this.currentScrollTop;
		const next = Math.max(0, Math.min(this.maxScrollTop, start + requested));
		const moved = next - start;
		this.currentScrollTop = next;
		this.followingEnd = this.followEnd && this.currentScrollTop === this.maxScrollTop;
		this.followSuppressedAtEnd = false;
		if (moved !== 0) this.requestRenderCallback?.();
		return requested - moved;
	}

	scrollTo(scrollTop: number, options: { disableFollow?: boolean } = {}): void {
		const requested = Number.isFinite(scrollTop) ? Math.trunc(scrollTop) : this.currentScrollTop;
		const next = Math.max(0, Math.min(this.maxScrollTop, requested));
		this.currentScrollTop = next;
		this.followSuppressedAtEnd = options.disableFollow === true && next === this.maxScrollTop;
		this.followingEnd = !this.followSuppressedAtEnd && this.followEnd && next === this.maxScrollTop;
		this.requestRenderCallback?.();
	}

	scrollToStart(): void {
		this.currentScrollTop = 0;
		this.followingEnd = this.followEnd && this.contentHeight <= this.currentViewportHeight;
		this.followSuppressedAtEnd = false;
		this.requestRenderCallback?.();
	}

	scrollToEnd(): void {
		this.currentScrollTop = this.maxScrollTop;
		this.followingEnd = this.followEnd;
		this.followSuppressedAtEnd = false;
		this.requestRenderCallback?.();
	}
}

export class FakeEditor {
	tui:
		| {
				terminal?: { columns?: number; rows?: number };
				hasOverlay?: () => boolean;
				getPrimaryScrollView?: () => FakeScrollView | undefined;
				requestRender?: () => void;
		  }
		| undefined;
	state = { lines: [""], cursorLine: 0, cursorCol: 0 };
	paddingX = 0;
	lastWidth = 80;
	scrollOffset = 0;
	renderedVisibleLineCount = 1;
	private text = "";

	constructor(tui?: {
		terminal?: { columns?: number; rows?: number };
		hasOverlay?: () => boolean;
		getPrimaryScrollView?: () => FakeScrollView | undefined;
		requestRender?: () => void;
	}) {
		this.tui = tui;
	}

	getPaddingX(): number {
		return this.paddingX;
	}

	getText(): string {
		return this.text;
	}

	setText(text: string): void {
		this.text = text;
		const lines = text.split("\n");
		this.state.lines = lines.length > 0 ? lines : [""];
		this.state.cursorLine = this.state.lines.length - 1;
		this.state.cursorCol = (this.state.lines[this.state.cursorLine] ?? "").length;
		this.scrollOffset = 0;
	}

	layoutText(_contentWidth: number): Array<{ text: string; hasCursor: boolean; cursorPos?: number }> {
		const lines = this.text.split("\n");
		const safeLines = lines.length > 0 ? lines : [""];
		const cursorLine = Math.max(0, Math.min(safeLines.length - 1, this.state.cursorLine));
		return safeLines.map((line, index) =>
			index === cursorLine
				? { text: line, hasCursor: true, cursorPos: this.state.cursorCol }
				: { text: line, hasCursor: false },
		);
	}

	renderTopBorder(width: number, hiddenLineCount: number): string {
		return hiddenLineCount > 0 ? `─── ↑ ${hiddenLineCount} more ───` : "─".repeat(Math.max(1, width));
	}

	renderBottomBorder(width: number, hiddenLineCount: number): string {
		return hiddenLineCount > 0 ? `─── ↓ ${hiddenLineCount} more ───` : "─".repeat(Math.max(1, width));
	}

	render(width = 80): string[] {
		this.lastWidth = Math.max(1, width);
		const layoutLines = this.layoutText(this.lastWidth);
		const terminalRows = this.tui?.terminal?.rows ?? 40;
		const maxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3));
		let cursorLineIndex = layoutLines.findIndex((line) => line.hasCursor);
		if (cursorLineIndex === -1) cursorLineIndex = 0;
		if (cursorLineIndex < this.scrollOffset) {
			this.scrollOffset = cursorLineIndex;
		} else if (cursorLineIndex >= this.scrollOffset + maxVisibleLines) {
			this.scrollOffset = cursorLineIndex - maxVisibleLines + 1;
		}
		const maxScrollOffset = Math.max(0, layoutLines.length - maxVisibleLines);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScrollOffset));
		const visibleLines = layoutLines.slice(this.scrollOffset, this.scrollOffset + maxVisibleLines);
		this.renderedVisibleLineCount = visibleLines.length;
		const linesBelow = layoutLines.length - (this.scrollOffset + visibleLines.length);
		return [
			this.renderTopBorder(width, this.scrollOffset),
			...visibleLines.map((line) => line.text),
			this.renderBottomBorder(width, linesBelow),
		];
	}

	handleMouse(event: { type: string; button?: string; x: number; y: number }): unknown {
		if (event.type !== "click" || event.button !== "left") return undefined;
		if (event.y <= 0 || event.y > this.renderedVisibleLineCount) {
			return { handled: true, focus: true };
		}
		const lineIndex = this.scrollOffset + event.y - 1;
		this.state.cursorLine = Math.max(0, Math.min(this.state.lines.length - 1, lineIndex));
		this.state.cursorCol = Math.max(0, Math.min((this.state.lines[this.state.cursorLine] ?? "").length, event.x));
		return { handled: true, focus: true };
	}

	handleInput(data: string): void {
		if (data === "\r" || data === "\n") {
			this.setText("");
			return;
		}
		if (data === "\x7f") {
			this.setText(this.text.slice(0, -1));
			return;
		}
		if (data === "\x1b[A" || data === "up") {
			this.state.cursorLine = Math.max(0, this.state.cursorLine - 1);
			return;
		}
		if (data === "\x1b[B" || data === "down") {
			this.state.cursorLine = Math.min(this.state.lines.length - 1, this.state.cursorLine + 1);
			return;
		}
		if (!data.startsWith("\x1b")) {
			this.setText(this.text + data);
		}
	}
}

// The pi-tui surface the extension imports.
export const ScrollView = FakeScrollView;
export const Editor = FakeEditor;
