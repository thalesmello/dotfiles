/**
 * Test host for insert-caret.test.ts.
 *
 * Exports the pi-tui surface the extension imports: a fake Editor whose
 * render() mirrors pi's real one (borders plus a content line carrying
 * the fake block cursor). The pi-coding-agent import is type-only in the
 * extension, so this host only needs to stand behind that specifier too.
 *
 * This file is not a test and pi never loads it; the test redirects the
 * extension's imports here.
 */

export const CURSOR_MARKER = "\x1B_pi:c\x07";
export const FAKE_CURSOR_START = "\x1B_pi:fc\x07";
export const FAKE_CURSOR_END = "\x1B_pi:/fc\x07";

export class Editor {
	tui: unknown;
	theme: unknown;

	constructor(tui: unknown, theme: unknown, _options: Record<string, unknown> = {}) {
		this.tui = tui;
		this.theme = theme;
	}

	render(width: number): string[] {
		const border = "─".repeat(width);
		const content = `  hello${CURSOR_MARKER}${FAKE_CURSOR_START}w${FAKE_CURSOR_END}orld`;
		return [border, content + " ".repeat(Math.max(0, width - 13)), border];
	}

	invalidate(): void {}
}
