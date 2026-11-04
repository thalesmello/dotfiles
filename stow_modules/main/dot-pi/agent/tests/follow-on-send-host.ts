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
	readonly followEnd: boolean;
	readonly primary: boolean;
	currentScrollTop = 0;
	contentHeight = 0;
	currentViewportHeight = 0;
	followingEnd: boolean;
	private requestRenderCallback: (() => void) | undefined;

	constructor(options: { follow?: "none" | "end"; primary?: boolean } = {}) {
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
	}

	scrollBy(lines: number): void {
		const start = this.followingEnd ? this.maxScrollTop : this.currentScrollTop;
		this.currentScrollTop = Math.max(0, Math.min(this.maxScrollTop, start + lines));
		this.followingEnd = this.followEnd && this.currentScrollTop === this.maxScrollTop;
	}

	scrollToEnd(): void {
		this.currentScrollTop = this.maxScrollTop;
		this.followingEnd = this.followEnd;
		this.requestRenderCallback?.();
	}
}

// The pi-tui surface the extension imports.
export const ScrollView = FakeScrollView;
