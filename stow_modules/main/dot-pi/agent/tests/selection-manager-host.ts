/**
 * Test host for selection-manager.test.ts.
 *
 * Exports the pi-tui surface the extension imports, backed by:
 * - the real pi-tui utilities extracted from the installed pi binary (the
 *   same pattern osc8-links.test.ts uses), and
 * - a fake TuiAltScreen that implements the internals contract the
 *   extension patches into.
 *
 * This file is not a test and pi never loads it; the test redirects the
 * extension's "@earendil-works/pi-tui" import here.
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
const init_terminal_image = () => {};
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

function loadRealPiKeys() {
	const bin = fs.readFileSync("/usr/local/bin/pi_cli/pi.real", "utf8");
	const start = bin.lastIndexOf("// ", bin.indexOf("packages/tui/src/keys.ts"));
	const end = bin.lastIndexOf("// ", bin.indexOf("packages/tui/src/terminal-colors.ts", start));
	if (start < 0 || end <= start) throw new Error("Cannot find Pi key parser");
	return new Function(`const __esm = fn => fn; ${bin.slice(start, end)}\ninit_keys(); return { matchesKey, isKeyRelease, decodeKittyPrintable };`)() as {
		matchesKey(data: string, key: string): boolean;
		isKeyRelease(data: string): boolean;
		decodeKittyPrintable(data: string): string | undefined;
	};
}
export const { matchesKey, isKeyRelease, decodeKittyPrintable } = loadRealPiKeys();

// ---------------------------------------------------------------------------
// Fake host screen: selection bounds, per-row selection columns, the previous
// screen, and a layout tree whose scroll-view box carries the transcript
// lines. The "original" methods mirror pi's built-in plain-range behavior,
// which the extension must keep for non-table text.
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
	component?: unknown;
	lines?: readonly string[];
	rect: { x: number; y: number; width: number; height: number };
	clip: { x: number; y: number; width: number; height: number };
	children?: LayoutBox[];
	scrollView?: { scrollTop: number };
	scrollContentLines?: readonly string[];
}

export interface FakeMarkdownBlock {
	type: string;
	raw: string;
	renderedLines: string[];
	items?: Array<{ raw: string }>;
	text?: string;
	lang?: string;
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
	terminal = { columns: 30, rows: 16 };
	scrollView = { scrollTop: 0 };
	inputListeners: Array<(data: string) => { consume?: boolean } | undefined> = [];
	mouseEvents: Array<{ button: number; x: number; y: number; release: boolean }> = [];
	renderRequests = 0;
	selectionAnchor: SelectionPoint | undefined;
	selectionFocus: SelectionPoint | undefined;
	selectionGranularity: "character" | "word" | "line" = "character";
	selectionInitialRange: Selection | undefined;
	selectionPressActive = false;
	selectionDragged = false;
	copyOnSelect = true;
	copiedTexts: string[] = [];

	copySelectionToClipboard(): boolean {
		const text = this.getActiveSelectionText();
		if (!text) return false;
		return this.copyTextToClipboard(text);
	}

	copyTextToClipboard(text: string): boolean {
		this.copiedTexts.push(text);
		return true;
	}

	addInputListener(listener: (data: string) => { consume?: boolean } | undefined): () => void {
		this.inputListeners.push(listener);
		return () => {
			this.inputListeners = this.inputListeners.filter((candidate) => candidate !== listener);
		};
	}

	/** Run input listeners in registration order; returns the consuming result, if any. */
	emitInput(data: string): { consume?: boolean } | undefined {
		for (const listener of this.inputListeners) {
			const result = listener(data);
			if (result?.consume) return result;
		}
		return undefined;
	}

	handleMouseEvent(event: { button: number; x: number; y: number; release: boolean }): void {
		this.mouseEvents.push(event);
		(this as FakeAltScreen & { handleSelectionMouseEvent?: (raw: typeof event) => void })
			.handleSelectionMouseEvent?.(event);
	}

	requestRender(): void {
		this.renderRequests += 1;
	}

	/**
	 * Show `blocks` as one Markdown component in the transcript: the rendered
	 * lines become the screen, and the component box in the layout tree
	 * carries the original source (`text`), its lexed tokens, and each
	 * block's rendered lines, the way pi's real Markdown component does.
	 */
	setMarkdownTranscript(blocks: FakeMarkdownBlock[]): void {
		const lines = blocks.flatMap((block) => block.renderedLines);
		this.previousScreen = [...lines];
		const rect = { x: 0, y: 0, width: this.terminal.columns, height: this.terminal.rows };
		const component = {
			text: blocks.map((block) => block.raw).join("\n\n"),
			paddingY: 0,
			defaultTextStyle: undefined,
			options: {},
			cachedTokens: {
				deref: () => ({
					tokens: blocks.map((block) => ({
						type: block.type,
						raw: block.raw,
						items: block.items,
						text: block.text,
						lang: block.lang,
					})),
				}),
			},
			blocks: {
				deref: () => new Map(blocks.map((block) => [block.raw, { lines: block.renderedLines }])),
			},
		};
		const markdownBox: LayoutBox = { rect, clip: rect, children: [], component, lines };
		this.currentLayout = {
			root: { rect, clip: rect, children: [markdownBox], scrollView: this.scrollView, scrollContentLines: lines },
		};
	}

	/** Show `lines` as the transcript of a primary scroll view at the origin. */
	setTranscript(lines: string[]): void {
		this.previousScreen = [...lines];
		const rect = { x: 0, y: 0, width: this.terminal.columns, height: this.terminal.rows };
		this.currentLayout = {
			root: { rect, clip: rect, children: [], scrollView: this.scrollView, scrollContentLines: lines },
		};
	}

	setSelection(
		anchor: { row: number; col: number; boundary?: boolean },
		focus: { row: number; col: number; boundary?: boolean },
	): void {
		this.selectionAnchor = { ...anchor, scrollView: this.scrollView };
		this.selectionFocus = { ...focus, scrollView: this.scrollView };
		this.selectionGranularity = "character";
		this.selectionInitialRange = undefined;
	}

	getSelectionBounds(): Selection | undefined {
		if (!this.selectionAnchor || !this.selectionFocus) return undefined;
		if (this.selectionAnchor.row === this.selectionFocus.row && this.selectionAnchor.col === this.selectionFocus.col) return undefined;
		const anchorFirst =
			this.selectionAnchor.row < this.selectionFocus.row ||
			(this.selectionAnchor.row === this.selectionFocus.row && this.selectionAnchor.col < this.selectionFocus.col);
		return anchorFirst ? { start: this.selectionAnchor, end: this.selectionFocus } : { start: this.selectionFocus, end: this.selectionAnchor };
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

	getActiveSelectionText(): string | undefined {
		const selection = this.getSelectionBounds();
		if (!selection) return undefined;
		let sourceLines: readonly string[] = this.previousScreen;
		if (selection.start.scrollView) {
			const box = findBox(this.currentLayout?.root, selection.start.scrollView);
			if (!box?.scrollContentLines) return undefined;
			sourceLines = box.scrollContentLines;
		}
		const lines: string[] = [];
		for (let row = selection.start.row; row <= selection.end.row; row++) {
			const line = sourceLines[row] ?? "";
			const columns = this.getSelectionColumns(line, row, selection);
			lines.push(
				stripTerminalSequences(
					sliceByColumn(line, columns.start, Math.max(0, columns.end - columns.start), true),
				).trimEnd(),
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
			const box = findBox(this.currentLayout?.root, selection.start.scrollView);
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
}

// Exercise Pi's actual selection gesture/release code too. The simple fake
// above never auto-copies on release, which previously hid the native word
// copy on the second click of a triple-click sequence.
function loadRealSelectionMouseMethods(): Record<string, Function> {
	const bin = fs.readFileSync("/usr/local/bin/pi_cli/pi.real", "utf8");
	const section = bin.indexOf("packages/tui/src/tui-alt-screen.ts");
	const pointsStart = bin.indexOf("    getScrollSelectionPoint(", section);
	const pointsEnd = bin.indexOf("    updateSelectionAutoScroll(", pointsStart);
	const mouseStart = bin.indexOf("    handleSelectionMouseEvent(event) {", pointsEnd);
	const mouseEnd = bin.indexOf("    getSelectionBounds()", mouseStart);
	if (section < 0 || pointsStart < 0 || pointsEnd < 0 || mouseStart < 0 || mouseEnd < 0) {
		throw new Error("Cannot find the installed Pi selection methods");
	}
	return new Function("utils", "findBox", `
const { visibleWidth, stripTerminalSequences } = utils;
const DOUBLE_CLICK_INTERVAL_MS = 500;
const wordSegmenter4 = new Intl.Segmenter(undefined, { granularity: "word" });
const TERMINAL_WORD_SELECTION_JOINERS = new Set(["/", "-", "+", "\\\\", "~", "_", "."]);
const getScrollViewBox = (frame, view) => findBox(frame.root, view);
const getScrollViewsAt = (frame) => frame.root.scrollView ? [frame.root.scrollView] : [];
const getOsc8LinkAtColumn = () => undefined;
class NativeSelection {
${bin.slice(pointsStart, pointsEnd)}
${bin.slice(mouseStart, mouseEnd)}
}
return NativeSelection.prototype;
`)(realUtils, findBox);
}

export class NativeSelectionAltScreen extends FakeAltScreen {
	// Declaration only: the real implementation below is installed on this
	// prototype and discovered by the extension's runtime compatibility check.
	declare handleSelectionMouseEvent: (event: { button: number; x: number; y: number; release: boolean }) => void;

	stopSelectionAutoScroll(): void {}
	updateSelectionAutoScroll(): void {}
	hasOverlay(): boolean { return false; }
	createMouseEvent(): object { return {}; }
	dispatchMouseToOverlay(): { hit: boolean } { return { hit: false }; }
	dispatchMouseToLayout(): undefined { return undefined; }
}

const nativeMethods = Object.getOwnPropertyDescriptors(loadRealSelectionMouseMethods());
delete nativeMethods.constructor;
Object.defineProperties(NativeSelectionAltScreen.prototype, nativeMethods);
// The pi-tui surface the extension imports.
export const TuiAltScreen = FakeAltScreen;
export { sliceByColumn, stripTerminalSequences, visibleWidth };

// ---------------------------------------------------------------------------
// Fake editor for the reference-block wrapper. Implements the small slice of
// the pi editor the wrapper touches: text, cursor, basic editing keys,
// submit, and plain rendering.
// ---------------------------------------------------------------------------

export class FakeCustomEditor {
	state = { lines: [""], cursorLine: 0, cursorCol: 0 };
	focused = true;
	onSubmit: ((text: string) => void) | undefined;
	readonly tui: unknown;
	readonly theme: unknown;
	readonly keybindings: unknown;

	constructor(tui?: unknown, theme?: unknown, keybindings?: unknown) {
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
	}

	get cursorLine(): number {
		return this.state.cursorLine;
	}

	set cursorLine(value: number) {
		this.state.cursorLine = value;
	}

	get cursorCol(): number {
		return this.state.cursorCol;
	}

	set cursorCol(value: number) {
		this.state.cursorCol = value;
	}

	setCursorCol(col: number): void {
		const line = this.state.lines[this.state.cursorLine] ?? "";
		this.state.cursorCol = Math.max(0, Math.min(col, line.length));
	}

	getText(): string {
		return this.state.lines.join("\n");
	}

	setText(text: string): void {
		this.state.lines = text.split("\n");
		this.state.cursorLine = this.state.lines.length - 1;
		this.setCursorCol(this.state.lines[this.state.cursorLine]?.length ?? 0);
	}

	handleInput(data: string): void {
		if (data === "\r") {
			this.onSubmit?.(this.getText());
			return;
		}
		const lines = this.state.lines;
		const line = lines[this.state.cursorLine] ?? "";
		if (data === "\x7f" || data === "\x08") {
			if (this.state.cursorCol > 0) {
				lines[this.state.cursorLine] = line.slice(0, this.state.cursorCol - 1) + line.slice(this.state.cursorCol);
				this.state.cursorCol -= 1;
			} else if (this.state.cursorLine > 0) {
				const previous = lines[this.state.cursorLine - 1] ?? "";
				this.state.cursorCol = previous.length;
				lines.splice(this.state.cursorLine - 1, 2, previous + line);
				this.state.cursorLine -= 1;
			}
		} else if (data.startsWith("\x1b[3")) {
			if (this.state.cursorCol < line.length) {
				lines[this.state.cursorLine] = line.slice(0, this.state.cursorCol) + line.slice(this.state.cursorCol + 1);
			} else if (this.state.cursorLine + 1 < lines.length) {
				lines.splice(this.state.cursorLine, 2, line + (lines[this.state.cursorLine + 1] ?? ""));
			}
		} else if (data === "\x1b[D") {
			this.state.cursorCol = Math.max(0, this.state.cursorCol - 1);
		} else if (data === "\x1b[C") {
			this.state.cursorCol = Math.min(line.length, this.state.cursorCol + 1);
		} else if (data === "\x1b[A") {
			this.state.cursorLine = Math.max(0, this.state.cursorLine - 1);
			this.state.cursorCol = Math.min(this.state.cursorCol, (lines[this.state.cursorLine] ?? "").length);
		} else if (data === "\x1b[B") {
			this.state.cursorLine = Math.min(lines.length - 1, this.state.cursorLine + 1);
			this.state.cursorCol = Math.min(this.state.cursorCol, (lines[this.state.cursorLine] ?? "").length);
		} else if (!data.startsWith("\x1b") && data >= " ") {
			lines[this.state.cursorLine] = line.slice(0, this.state.cursorCol) + data + line.slice(this.state.cursorCol);
			this.state.cursorCol += data.length;
		}
	}

	render(_width: number): string[] {
		return [...this.state.lines];
	}
}

export const CustomEditor = FakeCustomEditor;
