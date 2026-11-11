/**
 * Test host for resize-anchor.test.ts.
 *
 * Exports the pi-tui surface the extension imports: FakeContainer,
 * FakeScrollView (with pi-tui's real follow-end, followSuppressedAtEnd,
 * getContentWidth, and updateLayout semantics), and stripTerminalSequences.
 */

const ANSI_ESCAPE = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|_[^\x07\x1b]*(?:\x07|\x1b\\))/gu;

export function stripTerminalSequences(text: string): string {
	return text.replace(ANSI_ESCAPE, "");
}

export interface ComponentLike {
	render(width: number): string[];
	invalidate?(): void;
}

export class FakeContainer implements ComponentLike {
	children: ComponentLike[] = [];
	mouseLayout: { width: number; children: Array<{ component: ComponentLike; height: number }> } | undefined;

	addChild(component: ComponentLike): void {
		this.children.push(component);
	}

	removeChild(component: ComponentLike): void {
		const idx = this.children.indexOf(component);
		if (idx !== -1) this.children.splice(idx, 1);
	}

	clear(): void {
		this.children = [];
	}

	invalidate(): void {
		for (const child of this.children) {
			child.invalidate?.();
		}
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const mouseChildren: Array<{ component: ComponentLike; height: number }> = [];
		for (const child of this.children) {
			const childLines = child.render(width);
			mouseChildren.push({ component: child, height: childLines.length });
			for (const line of childLines) {
				lines.push(line);
			}
		}
		this.mouseLayout = { width, children: mouseChildren };
		return lines;
	}
}

export class FakeScrollView {
	readonly child: unknown;
	readonly followEnd: boolean;
	readonly primary: boolean;
	currentScrollbar: "hidden" | "auto" | "always";
	currentScrollTop = 0;
	contentHeight = 0;
	currentViewportHeight = 0;
	followingEnd: boolean;
	followSuppressedAtEnd = false;
	private requestRenderCallback: (() => void) | undefined;

	constructor(
		childOrOptions: unknown = {},
		maybeOptions?: { follow?: "none" | "end"; primary?: boolean; scrollbar?: "hidden" | "auto" | "always"; child?: unknown },
	) {
		const hasExplicitChild = maybeOptions !== undefined;
		const options = ((hasExplicitChild ? maybeOptions : childOrOptions) ?? {}) as {
			follow?: "none" | "end";
			primary?: boolean;
			scrollbar?: "hidden" | "auto" | "always";
			child?: unknown;
		};
		this.child = hasExplicitChild ? childOrOptions : options.child;
		this.followEnd = (options.follow ?? "none") === "end";
		this.followingEnd = this.followEnd;
		this.primary = options.primary ?? false;
		this.currentScrollbar = options.scrollbar ?? "hidden";
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

	getContentWidth(width: number): number {
		return this.currentScrollbar === "always" && width > 1 ? width - 1 : width;
	}

	updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void {
		this.contentHeight = Math.max(0, Math.floor(contentHeight));
		this.currentViewportHeight = Math.max(0, Math.floor(viewportHeight));
		this.requestRenderCallback = requestRender;
		const maxScrollTop = this.maxScrollTop;
		if (this.followingEnd) {
			this.currentScrollTop = maxScrollTop;
		} else {
			this.currentScrollTop = Math.max(0, Math.min(this.currentScrollTop, maxScrollTop));
		}
		if (this.currentScrollTop < maxScrollTop) {
			this.followSuppressedAtEnd = false;
		}
		if (this.followEnd && this.currentScrollTop === maxScrollTop && !this.followSuppressedAtEnd) {
			this.followingEnd = true;
		}
	}

	scrollTo(scrollTop: number, options: { disableFollow?: boolean } = {}): void {
		const requested = Number.isFinite(scrollTop) ? Math.trunc(scrollTop) : this.currentScrollTop;
		const maxScrollTop = this.maxScrollTop;
		const next = Math.max(0, Math.min(maxScrollTop, requested));
		const nextFollowSuppressedAtEnd = options.disableFollow === true && next === maxScrollTop;
		const nextFollowingEnd = !nextFollowSuppressedAtEnd && this.followEnd && next === maxScrollTop;
		this.currentScrollTop = next;
		this.followingEnd = nextFollowingEnd;
		this.followSuppressedAtEnd = nextFollowSuppressedAtEnd;
		this.requestRenderCallback?.();
	}

	scrollBy(lines: number): number {
		const requested = Number.isFinite(lines) ? Math.trunc(lines) : 0;
		if (requested === 0) return 0;
		const maxScrollTop = this.maxScrollTop;
		const start = this.followingEnd ? maxScrollTop : this.currentScrollTop;
		const next = Math.max(0, Math.min(maxScrollTop, start + requested));
		const moved = next - start;
		this.currentScrollTop = next;
		this.followingEnd = this.followEnd && next === maxScrollTop;
		this.followSuppressedAtEnd = false;
		this.requestRenderCallback?.();
		return requested - moved;
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

export const Container = FakeContainer;
export const ScrollView = FakeScrollView;
