/**
 * Test host for code-block-copy.test.ts.
 *
 * Exports the pi-tui / pi-coding-agent surface the extension imports,
 * backed by:
 * - the real pi-tui utilities extracted from the installed pi binary (the
 *   same pattern selection-manager-host.ts uses), and
 * - a fake Markdown whose renderToken mirrors the built-in code-block
 *   rendering, and a fake TuiAltScreen implementing the internals contract
 *   the extension patches into (selection bounds/columns, click handling
 *   via press/release, and clipboard capture).
 *
 * This file is not a test and pi never loads it; the test redirects the
 * extension's imports here.
 */
import * as fs from "node:fs";

function loadRealPiTuiUtils() {
	const bin = fs.readFileSync("/usr/local/bin/pi_cli/pi.real", "utf8");
	const uStart = bin.indexOf("// ../../../../../../../../../../re_tmp/pi-mono/packages/tui/src/utils.ts");
	const uEnd = bin.indexOf("// ../../../../../../../../../../re_tmp/pi-mono/packages/tui/src/autocomplete.ts");
	const factoryCode = `
const __esm = (fn) => fn;
const init_get_east_asian_width = () => {};
const eastAsianWidth = () => 1;
const init_marked_esm = () => {};
const init_latex = () => {};
const renderLatex = () => undefined;
const isImageLine = () => false;
const getCapabilities = () => ({ images: null, trueColor: true, hyperlinks: false });
const setCapabilityOverrides = () => {};
const hyperlink = (text, url) => text;
${bin.slice(uStart, uEnd)}
init_utils5();
return { visibleWidth, sliceByColumn, stripTerminalSequences, getGraphemeCellRange };
`;
	return new Function(factoryCode)() as {
		visibleWidth: (text: string) => number;
		sliceByColumn: (line: string, startCol: number, length: number, strict?: boolean) => string;
		stripTerminalSequences: (text: string) => string;
		getGraphemeCellRange: (line: string, column: number) => { start: number; end: number } | undefined;
	};
}

export const realUtils = loadRealPiTuiUtils();
const { visibleWidth, sliceByColumn, stripTerminalSequences, getGraphemeCellRange } = realUtils;

// pi-coding-agent surface: pi's exported highlighter, stubbed so tests can
// tell it apart from a theme-provided highlighter.
export function highlightCode(code: string, _lang?: string): string[] {
	return code.split("\n").map((line) => `FB:${line}`);
}

// ---------------------------------------------------------------------------
// Fake Markdown: renderToken mirrors the built-in `code` case
// ---------------------------------------------------------------------------

export interface FakeMarkdownTheme {
	code: (text: string) => string;
	bold: (text: string) => string;
	codeBlock: (text: string) => string;
	codeBlockBorder: (text: string) => string;
	codeBlockIndent?: string;
	highlightCode?: (code: string, lang?: string) => string[];
}

export const plainTheme: FakeMarkdownTheme = {
	code: (text) => text,
	bold: (text) => text,
	codeBlock: (text) => text,
	codeBlockBorder: (text) => text,
	codeBlockIndent: "  ",
	highlightCode: (code) => code.split("\n").map((line) => `HL:${line}`),
};

export class Markdown {
	text: string;
	theme: FakeMarkdownTheme;
	cachedRenderWidth: number | undefined;
	cachedRenderedLines: string[] | undefined;

	constructor(text: string, theme: FakeMarkdownTheme = plainTheme) {
		this.text = text;
		this.theme = theme;
	}

	/**
	 * Mirrors the real Markdown.render: a fenced block in the text is
	 * rendered once via renderToken and the resulting lines are cached
	 * (button id included) and returned as-is on later calls at the same
	 * width, so a label change can only come from a render wrapper
	 * post-processing the returned lines, never from re-rendering.
	 */
	render(width: number): string[] {
		if (this.cachedRenderedLines && this.cachedRenderWidth === width) {
			return this.cachedRenderedLines;
		}
		const fence = /^```([^\n]*)\n([\s\S]*?)\n```\s*$/.exec(this.text.trim());
		const lines = fence
			? this.renderToken({ type: "code", lang: fence[1], text: fence[2] }, width, undefined)
			: this.text
				? [this.text]
				: [];
		this.cachedRenderWidth = width;
		this.cachedRenderedLines = lines;
		return lines;
	}

	renderToken(token: any, _width: number, nextTokenType?: string): string[] {
		if (token?.type === "code") {
			const indent = this.theme.codeBlockIndent ?? "  ";
			const lines = [this.theme.codeBlockBorder(`\`\`\`${token.lang || ""}`)];
			if (this.theme.highlightCode) {
				for (const line of this.theme.highlightCode(token.text, token.lang)) lines.push(`${indent}${line}`);
			} else {
				for (const line of token.text.split("\n")) lines.push(`${indent}${this.theme.codeBlock(line)}`);
			}
			lines.push(this.theme.codeBlockBorder("```"));
			if (nextTokenType && nextTokenType !== "space") lines.push("");
			return lines;
		}
		if (token?.type === "paragraph") {
			const lines = [String(token.text ?? "")];
			if (nextTokenType && nextTokenType !== "space") lines.push("");
			return lines;
		}
		return [String(token?.text ?? "")];
	}

	invalidate(): void {
		this.cachedRenderWidth = undefined;
		this.cachedRenderedLines = undefined;
	}
}

// ---------------------------------------------------------------------------
// Fake alt screen
// ---------------------------------------------------------------------------

export interface SelectionPoint {
	row: number;
	col: number;
	boundary?: boolean;
	scrollView?: { scrollTop: number };
}

export interface Selection {
	start: SelectionPoint;
	end: SelectionPoint;
}

export interface LayoutBox {
	rect: { x: number; y: number; width: number; height: number };
	clip: { x: number; y: number; width: number; height: number };
	children?: LayoutBox[];
	scrollView?: { scrollTop: number };
	scrollContentLines?: readonly string[];
}

function findBox(box: LayoutBox | undefined, scrollView: unknown): LayoutBox | undefined {
	if (!box) return undefined;
	if (box.scrollView === scrollView) return box;
	for (const child of box.children ?? []) {
		const found = findBox(child, scrollView);
		if (found) return found;
	}
	return undefined;
}

export class FakeAltScreen {
	previousScreen: string[] = [];
	currentLayout: { root: LayoutBox } | undefined;
	terminal = { columns: 40, rows: 16 };
	scrollView = { scrollTop: 0 };
	selectionAnchor: SelectionPoint | undefined;
	selectionFocus: SelectionPoint | undefined;
	selectionPressActive = false;
	selectionDragged = false;
	pressedUrl: string | undefined;
	clipboard: string[] = [];
	flashes: string[] = [];
	renderRequests = 0;

	setTranscript(lines: string[]): void {
		this.previousScreen = [...lines];
		const rect = { x: 0, y: 0, width: this.terminal.columns, height: this.terminal.rows };
		this.currentLayout = {
			root: { rect, clip: rect, children: [], scrollView: this.scrollView, scrollContentLines: lines },
		};
	}

	setSelection(anchor: { row: number; col: number }, focus: { row: number; col: number }): void {
		this.selectionAnchor = { ...anchor, scrollView: this.scrollView };
		this.selectionFocus = { ...focus, scrollView: this.scrollView };
	}

	getSelectionBounds(): Selection | undefined {
		if (!this.selectionAnchor || !this.selectionFocus) return undefined;
		if (this.selectionAnchor.scrollView !== this.selectionFocus.scrollView) return undefined;
		if (this.selectionAnchor.row === this.selectionFocus.row && this.selectionAnchor.col === this.selectionFocus.col) {
			return undefined;
		}
		const anchorFirst =
			this.selectionAnchor.row < this.selectionFocus.row ||
			(this.selectionAnchor.row === this.selectionFocus.row && this.selectionAnchor.col < this.selectionFocus.col);
		return anchorFirst
			? { start: this.selectionAnchor, end: this.selectionFocus }
			: { start: this.selectionFocus, end: this.selectionAnchor };
	}

	getSelectionColumns(
		line: string,
		row: number,
		selection: Selection,
		minColumn = 0,
		maxColumn = visibleWidth(line),
	): { start: number; end: number } {
		const lineWidth = visibleWidth(line);
		let start = Math.max(0, minColumn);
		let end = Math.min(lineWidth, maxColumn);
		if (row === selection.start.row) {
			start = getGraphemeCellRange(line, selection.start.col)?.start ?? Math.min(selection.start.col, lineWidth);
		}
		if (row === selection.end.row) {
			end = selection.end.boundary
				? Math.min(selection.end.col, lineWidth)
				: (getGraphemeCellRange(line, selection.end.col)?.end ?? Math.min(selection.end.col + 1, lineWidth));
		}
		return { start: Math.max(minColumn, start), end: Math.min(maxColumn, end) };
	}

	getScrollSelectionPoint(scrollView: { scrollTop: number }, x: number, y: number): SelectionPoint {
		const box = this.currentLayout ? findBox(this.currentLayout.root, scrollView) : undefined;
		if (!box) return { row: y, col: x, scrollView };
		const maxRow = Math.max(0, (box.scrollContentLines?.length ?? 1) - 1);
		return {
			row: Math.max(0, Math.min(maxRow, scrollView.scrollTop + y - box.rect.y)),
			col: Math.max(0, Math.min(box.rect.width - 1, x - box.rect.x)),
			scrollView,
		};
	}

	getSelectionPoint(event: { x: number; y: number }, scrollView?: { scrollTop: number }): SelectionPoint {
		if (scrollView) return this.getScrollSelectionPoint(scrollView, event.x, event.y);
		return { row: event.y, col: event.x };
	}

	getSelectionSourceLine(point: SelectionPoint): string {
		if (point.scrollView && this.currentLayout) {
			const box = findBox(this.currentLayout.root, point.scrollView);
			if (box?.scrollContentLines) return box.scrollContentLines[point.row] ?? "";
		}
		return this.previousScreen[point.row] ?? "";
	}

	getActiveSelectionText(): string | undefined {
		const selection = this.getSelectionBounds();
		if (!selection) return undefined;
		let sourceLines: readonly string[] = this.previousScreen;
		if (selection.start.scrollView) {
			const box = this.currentLayout ? findBox(this.currentLayout.root, selection.start.scrollView) : undefined;
			if (!box?.scrollContentLines) return undefined;
			sourceLines = box.scrollContentLines;
		}
		const lines: string[] = [];
		for (let row = selection.start.row; row <= selection.end.row; row++) {
			const line = sourceLines[row] ?? "";
			const columns = this.getSelectionColumns(line, row, selection);
			lines.push(
				stripTerminalSequences(sliceByColumn(line, columns.start, Math.max(0, columns.end - columns.start), true)).trimEnd(),
			);
		}
		const text = lines.join("\n");
		return text.length === 0 ? undefined : text;
	}

	applySelection(screen: string[], _layout?: unknown): string[] {
		const selection = this.getSelectionBounds();
		if (!selection) return screen;
		let screenSelection = selection;
		if (selection.start.scrollView) {
			const box = this.currentLayout ? findBox(this.currentLayout.root, selection.start.scrollView) : undefined;
			if (!box) return screen;
			screenSelection = {
				start: {
					...selection.start,
					row: box.rect.y + selection.start.row - selection.start.scrollView.scrollTop,
					col: box.rect.x + selection.start.col,
				},
				end: {
					...selection.end,
					row: box.rect.y + selection.end.row - selection.start.scrollView.scrollTop,
					col: box.rect.x + selection.end.col,
				},
			};
		}
		return screen.map((line, row) => {
			if (row < screenSelection.start.row || row > screenSelection.end.row) return line;
			const lineWidth = visibleWidth(line);
			const columns = this.getSelectionColumns(line, row, screenSelection, 0, this.terminal.columns);
			if (columns.end <= columns.start) return line;
			const before = sliceByColumn(line, 0, columns.start, true);
			const selected = sliceByColumn(line, columns.start, columns.end - columns.start, true);
			const after = sliceByColumn(line, columns.end, Math.max(0, lineWidth - columns.end), true);
			return `${before}\x1b[7m${selected}\x1b[27m${after}`;
		});
	}

	async copyTextToClipboard(text: string): Promise<boolean> {
		this.clipboard.push(text);
		this.flashes.push("Copied!");
		return true;
	}

	requestRender(): void {
		this.renderRequests += 1;
	}

	stopSelectionAutoScroll(): void {}

	/** Simplified built-in: press anchors, drag extends, release copies on select. */
	handleSelectionMouseEvent(event: { button: number; x: number; y: number; release?: boolean }): void {
		if (event.release) {
			if (!this.selectionPressActive) return;
			this.selectionPressActive = false;
			if (!this.selectionAnchor) return;
			const point = this.getSelectionPoint(event, this.selectionAnchor.scrollView);
			this.selectionFocus = point;
			const isClick =
				!this.selectionDragged &&
				this.selectionAnchor.row === point.row &&
				this.selectionAnchor.col === point.col;
			if (isClick) {
				this.selectionAnchor = undefined;
				this.selectionFocus = undefined;
				return;
			}
			const text = this.getActiveSelectionText();
			if (text !== undefined) void this.copyTextToClipboard(text);
			return;
		}
		if ((event.button & 32) !== 0) {
			if (!this.selectionPressActive || !this.selectionAnchor) return;
			this.selectionDragged = true;
			this.selectionFocus = this.getSelectionPoint(event, this.selectionAnchor.scrollView);
			return;
		}
		this.selectionPressActive = true;
		const anchor = this.getSelectionPoint(event, this.scrollView);
		this.selectionAnchor = anchor;
		this.selectionFocus = anchor;
		this.selectionDragged = false;
	}
}

// The pi-tui surface the extension imports.
export const TuiAltScreen = FakeAltScreen;
export { sliceByColumn, stripTerminalSequences, visibleWidth };
