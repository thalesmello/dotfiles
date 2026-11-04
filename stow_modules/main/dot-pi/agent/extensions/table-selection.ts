/**
 * table-selection.ts -- table-aware mouse selection in fullscreen mode.
 *
 * Why this exists
 * ---------------
 * In fullscreen mode pi owns mouse selection and copies the selected screen
 * range as plain text. For a rendered Markdown table that range is wrong in
 * both directions: the highlight and the copy walk straight across rows, so
 * they include table borders, padding, and text from cells the pointer never
 * meant to touch.
 *
 * pi has no extension hook for selection text or for the selection highlight,
 * so this extension patches two `TuiAltScreen` prototype methods for the life
 * of a TUI session:
 *
 * - `getActiveSelectionText` decides what a selection copies.
 * - `applySelection` decides what a selection paints.
 *
 * TypeScript `private` members are runtime properties, and the installed pi
 * keeps these method names, so the patch can reuse the built-in internals
 * (`getSelectionBounds`, `getSelectionColumns`, the layout tree). If those
 * internals are not present, the extension reports itself inactive and leaves
 * the built-in behavior untouched.
 *
 * Behavior
 * --------
 * - A selection inside one cell copies only that cell's text, even when the
 *   pointer overshoots the cell border. The highlight stays in the cell too.
 * - A selection across cells copies the whole touched cells and highlights
 *   only those cells: no borders, no separators, no padding, no other cells.
 * - Two or more columns copy as a Markdown table. Authored line breaks inside
 *   a cell become `<br>`, and the header separator appears when the selection
 *   includes the table header.
 * - One column copies as a list: the header (when selected) as a first line,
 *   then each cell as plain text with its line breaks kept, cells separated
 *   by a `------` line.
 * - Inside a cell, physical lines are rejoined by shape: a word split at the
 *   column edge joins with nothing, a word-boundary wrap joins with one
 *   space, and an authored break (list item, colon label, a break the
 *   wrapper would not have taken) stays a break.
 *
 * Requires fullscreen mode (`tuiMode: "fullscreen"`) with copy on select, so
 * pi captures the mouse at all. In regular mode the terminal owns selection
 * and this extension does nothing visible.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, stripTerminalSequences, TuiAltScreen, visibleWidth } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Rendered-table parsing (operates on plain rendered lines, as pi's TUI does)
// ---------------------------------------------------------------------------

interface TableCellBounds {
	index: number;
	contentStart: number;
	contentEnd: number;
}

interface TableLogicalRow {
	startRow: number;
	endRow: number;
	isHeader: boolean;
	cells: string[];
}

interface TableBlock {
	startRow: number;
	endRow: number;
	rows: TableLogicalRow[];
}

type TableBorderKind = "top" | "separator" | "bottom";

/** Return the content bounds of each cell in a rendered table row such as `│ a │ b │`. */
function getTableRowCells(line: string): TableCellBounds[] | undefined {
	const plain = stripTerminalSequences(line);
	const trimmed = plain.trim();
	if (!trimmed.startsWith("│") || !trimmed.endsWith("│")) return undefined;
	const borders: number[] = [];
	let column = 0;
	for (const character of plain) {
		if (character === "│") borders.push(column);
		column += visibleWidth(character);
	}
	if (borders.length < 2) return undefined;
	return borders.slice(0, -1).map((border, index) => {
		const nextBorder = borders[index + 1]!;
		let contentStart = border + 1;
		let contentEnd = nextBorder;
		// Rendered cells use one padding space on each side: `│ text │`.
		if (sliceByColumn(plain, contentStart, 1, true) === " ") contentStart += 1;
		if (contentEnd > contentStart && sliceByColumn(plain, contentEnd - 1, 1, true) === " ") contentEnd -= 1;
		return { index, contentStart, contentEnd };
	});
}

function getTableBorderKind(line: string): TableBorderKind | undefined {
	const trimmed = stripTerminalSequences(line).trim();
	if (trimmed.length < 2 || !trimmed.includes("─")) return undefined;
	const kinds: Record<string, TableBorderKind> = { "┌": "top", "├": "separator", "└": "bottom" };
	const kind = kinds[trimmed[0]!];
	if (!kind) return undefined;
	const expectedEnd = kind === "top" ? "┐" : kind === "bottom" ? "┘" : "┤";
	if (!trimmed.endsWith(expectedEnd)) return undefined;
	if (![...trimmed].every((character) => "─┬┼┴┌├└┐┤┘".includes(character))) return undefined;
	return kind;
}

/** Find the cell that contains a column. A column on a border belongs to the adjacent cell in the bias direction. */
function getTableCellIndexAtColumn(cells: readonly TableCellBounds[], column: number, bias: "start" | "end"): number {
	if (column <= cells[0]!.contentStart) return 0;
	const last = cells[cells.length - 1]!;
	if (column >= last.contentEnd) return last.index;
	for (const cell of cells) {
		if (column >= cell.contentStart && column < cell.contentEnd) return cell.index;
		// Columns in the padding or on the border between this cell and the next one.
		if (column < cell.contentStart) return bias === "start" ? cell.index : Math.max(0, cell.index - 1);
	}
	return last.index;
}

type CellFragmentBreak = "space" | "none" | "newline";

/**
 * Classify the break between two physical lines of one table cell.
 *
 * Rendered lines do not say whether a break came from the author or from
 * wrapping, so this uses the wrap rules as evidence. A greedy wrapper only
 * breaks a line when the next word does not fit, when a word is longer than
 * the column, or at an authored break. Therefore:
 * - A line that starts a list item, follows a line that ends in a colon, is
 *   itself a lone label that ends in a colon, or could have fit the next word,
 *   sits after an authored break.
 * - A line that fills the column and ends in a word character, followed by a
 *   lowercase word character, was split in the middle of a word.
 * - Two long one-word lines where the second starts with a capital letter
 *   form a list of words, one per line.
 * - Anything else is a word-boundary wrap.
 *
 * Some shapes stay ambiguous in rendered text alone: a word that fills the
 * column and an authored line that holds one such word look the same. The
 * rules above prefer not merging two capitalized words over merging a split
 * lowercase continuation.
 */
function getCellFragmentBreak(previous: string, next: string, columnWidth: number): CellFragmentBreak {
	if (/^(?:[-*+•]|\d+[.)])\s/.test(next)) return "newline";
	const previousWidth = visibleWidth(previous);
	if (previous.endsWith(":")) return "newline";
	if (/^\S+:$/.test(next)) return "newline";
	if (
		columnWidth > 1 &&
		previousWidth >= columnWidth - 1 &&
		/[\p{L}\p{N}]$/u.test(previous) &&
		/^[\p{Ll}\p{N}]/u.test(next)
	) {
		return "none";
	}
	if (
		!/\s/.test(previous) &&
		!/\s/.test(next) &&
		previousWidth >= 8 &&
		visibleWidth(next) >= 8 &&
		/^\p{Lu}/u.test(next)
	) {
		return "newline";
	}
	const firstWord = next.split(/\s+/)[0] ?? "";
	if (previousWidth + 1 + visibleWidth(firstWord) <= columnWidth) return "newline";
	return "space";
}

/** Join the physical lines of one wrapped table cell, keeping authored breaks. */
function joinWrappedCellText(fragments: readonly string[], columnWidth: number, authoredBreak: string): string {
	let text = "";
	let previous = "";
	for (const rawFragment of fragments) {
		const fragment = rawFragment.trim();
		if (!fragment) continue;
		if (!text) {
			text = fragment;
		} else {
			const breakKind = getCellFragmentBreak(previous, fragment, columnWidth);
			text += (breakKind === "newline" ? authoredBreak : breakKind === "space" ? " " : "") + fragment;
		}
		previous = fragment;
	}
	return text;
}

/** Group rendered table lines into logical rows. Wrapped cells span physical lines without a separator. */
function parseTableBlocks(plainLines: readonly string[]): TableBlock[] {
	const blocks: TableBlock[] = [];
	let block: TableBlock | undefined;
	let current: { startRow: number; endRow: number; isHeader: boolean; physicalRows: number[] } | undefined;
	let nextIsHeader = false;

	const finishCurrent = () => {
		if (!block || !current) return;
		const cellTexts: string[][] = [];
		const columnWidths: number[] = [];
		for (const row of current.physicalRows) {
			const cells = getTableRowCells(plainLines[row] ?? "") ?? [];
			for (const cell of cells) {
				const fragment = sliceByColumn(
					plainLines[row] ?? "",
					cell.contentStart,
					Math.max(0, cell.contentEnd - cell.contentStart),
					true,
				).trim();
				const fragments = cellTexts[cell.index] ?? [];
				fragments.push(fragment);
				cellTexts[cell.index] = fragments;
				columnWidths[cell.index] = Math.max(columnWidths[cell.index] ?? 0, cell.contentEnd - cell.contentStart);
			}
		}
		block.rows.push({
			startRow: current.startRow,
			endRow: current.endRow,
			isHeader: current.isHeader,
			cells: cellTexts.map((fragments, index) => joinWrappedCellText(fragments, columnWidths[index] ?? 0, "\n")),
		});
		current = undefined;
	};
	const finishBlock = (endRow: number) => {
		finishCurrent();
		if (block) blocks.push({ ...block, endRow });
		block = undefined;
		nextIsHeader = false;
	};

	for (let row = 0; row < plainLines.length; row++) {
		const line = plainLines[row] ?? "";
		const border = getTableBorderKind(line);
		if (border === "top") {
			if (block) finishBlock(row - 1);
			block = { startRow: row, endRow: row, rows: [] };
			nextIsHeader = true;
			continue;
		}
		if (border === "separator") {
			finishCurrent();
			nextIsHeader = false;
			continue;
		}
		if (border === "bottom") {
			if (block) finishBlock(row);
			continue;
		}
		if (getTableRowCells(line)) {
			if (!block) continue;
			if (!current) current = { startRow: row, endRow: row, isHeader: nextIsHeader, physicalRows: [] };
			current.endRow = row;
			current.physicalRows.push(row);
			continue;
		}
		if (block) finishBlock(row - 1);
	}
	if (block) finishBlock(plainLines.length - 1);
	return blocks;
}

function escapeMarkdownTableCell(text: string): string {
	// A Markdown table cell cannot hold a raw newline, so authored breaks become <br>.
	return text.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

// ---------------------------------------------------------------------------
// TuiAltScreen internals, reached through runtime properties
// ---------------------------------------------------------------------------

interface SelectionPointLike {
	row: number;
	col: number;
	boundary?: boolean;
	scrollView?: { scrollTop: number };
}

interface SelectionLike {
	start: SelectionPointLike;
	end: SelectionPointLike;
}

interface LayoutRectLike {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface LayoutBoxLike {
	rect: LayoutRectLike;
	clip: LayoutRectLike;
	children?: LayoutBoxLike[];
	scrollView?: { scrollTop: number };
	scrollContentLines?: readonly string[];
}

interface LayoutFrameLike {
	root: LayoutBoxLike;
}

interface AltScreenInternals {
	getSelectionBounds(): SelectionLike | undefined;
	getSelectionColumns(
		line: string,
		row: number,
		selection: SelectionLike,
		minColumn?: number,
		maxColumn?: number,
	): { start: number; end: number };
	previousScreen: string[];
	currentLayout?: LayoutFrameLike;
	terminal: { columns: number; rows: number };
}

function findScrollViewBox(box: LayoutBoxLike | undefined, scrollView: unknown): LayoutBoxLike | undefined {
	if (!box) return undefined;
	if (box.scrollView === scrollView) return box;
	for (const child of box.children ?? []) {
		const found = findScrollViewBox(child, scrollView);
		if (found) return found;
	}
	return undefined;
}

function getSelectionSourceLines(
	internals: AltScreenInternals,
	selection: SelectionLike,
): readonly string[] | undefined {
	if (!selection.start.scrollView) return internals.previousScreen;
	const box = findScrollViewBox(internals.currentLayout?.root, selection.start.scrollView);
	return box?.scrollContentLines;
}

const IMAGE_LINE_MARKERS = ["\x1b_G", "\x1b]1337;File="];

function isImageLine(line: string): boolean {
	return IMAGE_LINE_MARKERS.some((marker) => line.includes(marker));
}

const ANSI_AT = /^\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/;

function applySelectionHighlight(text: string): string {
	let result = "\x1b[7m";
	let index = 0;
	while (index < text.length) {
		const ansi = ANSI_AT.exec(text.slice(index));
		if (ansi) {
			result += ansi[0];
			if (ansi[0].endsWith("m")) result += "\x1b[7m";
			index += ansi[0].length;
			continue;
		}
		result += text[index];
		index += 1;
	}
	return `${result}\x1b[27m`;
}

// ---------------------------------------------------------------------------
// Table-aware selection text and highlight
// ---------------------------------------------------------------------------

/**
 * Table-aware selection text for a rendered Markdown table.
 *
 * A selection inside one cell returns only text from that cell, even when the
 * pointer overshoots the cell border. A selection that spans multiple cells
 * returns the whole intersected cells, either as Markdown table rows or, for
 * a single column, as separated cell text.
 */
function getTableSelectionText(
	internals: AltScreenInternals,
	selection: SelectionLike,
	sourceLines: readonly string[],
): string | undefined {
	const plainLines = sourceLines.map((line) => stripTerminalSequences(line));
	const block = parseTableBlocks(plainLines).find(
		(candidate) =>
			candidate.rows.length > 0 &&
			selection.start.row >= candidate.startRow &&
			selection.end.row <= candidate.endRow,
	);
	if (!block) return undefined;

	const logicalAt = (row: number, bias: "start" | "end"): TableLogicalRow | undefined => {
		const containing = block.rows.find((candidate) => row >= candidate.startRow && row <= candidate.endRow);
		if (containing) return containing;
		return bias === "start"
			? (block.rows.find((candidate) => candidate.startRow > row) ?? block.rows[block.rows.length - 1])
			: ([...block.rows].reverse().find((candidate) => candidate.endRow < row) ?? block.rows[0]);
	};
	const startLogical = logicalAt(selection.start.row, "start");
	const endLogical = logicalAt(selection.end.row, "end");
	if (!startLogical || !endLogical) return undefined;
	const startCells = getTableRowCells(plainLines[startLogical.startRow] ?? "");
	const endCells = getTableRowCells(plainLines[endLogical.endRow] ?? "");
	if (!startCells || !endCells) return undefined;
	const startCellIndex = getTableCellIndexAtColumn(startCells, selection.start.col, "start");
	const endCellIndex = getTableCellIndexAtColumn(endCells, selection.end.col, "end");

	if (startLogical === endLogical && startCellIndex === endCellIndex) {
		const fragments: string[] = [];
		let columnWidth = 0;
		for (let row = selection.start.row; row <= selection.end.row; row++) {
			if (row < startLogical.startRow || row > startLogical.endRow) continue;
			const cell = getTableRowCells(plainLines[row] ?? "")?.[startCellIndex];
			if (!cell) continue;
			columnWidth = Math.max(columnWidth, cell.contentEnd - cell.contentStart);
			const columns = internals.getSelectionColumns(sourceLines[row] ?? "", row, selection);
			const start = Math.max(columns.start, cell.contentStart);
			const end = Math.min(columns.end, cell.contentEnd);
			if (end <= start) continue;
			fragments.push(sliceByColumn(plainLines[row] ?? "", start, end - start, true));
		}
		if (fragments.length === 0) return undefined;
		if (fragments.length === 1) return fragments[0]!.trimEnd() || undefined;
		return joinWrappedCellText(fragments, columnWidth, "\n") || undefined;
	}

	const startLogicalIndex = block.rows.indexOf(startLogical);
	const endLogicalIndex = block.rows.indexOf(endLogical);
	const firstLogicalIndex = Math.min(startLogicalIndex, endLogicalIndex);
	const lastLogicalIndex = Math.max(startLogicalIndex, endLogicalIndex);
	const firstColumn = Math.min(startCellIndex, endCellIndex);
	const lastColumn = Math.max(startCellIndex, endCellIndex);
	const columns = Array.from({ length: lastColumn - firstColumn + 1 }, (_, offset) => firstColumn + offset);
	const selectedRows = block.rows.slice(firstLogicalIndex, lastLogicalIndex + 1);

	// A single column is a list of cells, not a Markdown table. Keep authored
	// breaks as real newlines and separate the cells with a dash line. A
	// selected header becomes the first line, underlined by that separator.
	if (columns.length === 1) {
		const separator = "------";
		const out: string[] = [];
		let previousWasHeader = false;
		for (const row of selectedRows) {
			const cell = row.cells[firstColumn] ?? "";
			if (row.isHeader) {
				out.push(cell, separator);
			} else {
				if (out.length > 0 && !previousWasHeader) out.push(separator);
				out.push(cell);
			}
			previousWasHeader = row.isHeader;
		}
		return out.join("\n");
	}

	const lines = selectedRows.map(
		(row) => `| ${columns.map((column) => escapeMarkdownTableCell(row.cells[column] ?? "")).join(" | ")} |`,
	);
	const headerIndex = selectedRows.findIndex((row) => row.isHeader);
	if (headerIndex >= 0) {
		lines.splice(headerIndex + 1, 0, `| ${columns.map(() => "---").join(" | ")} |`);
	}
	return lines.join("\n");
}

/**
 * Highlight segments for a multi-cell table selection.
 *
 * The copy path returns a rectangle of cells, so the highlight paints that
 * same rectangle. A plain screen-range highlight would also paint the other
 * cells on the first and last rows and every cell on the rows in between.
 * Returns column segments per screen row, or undefined when the selection is
 * not a multi-cell table selection.
 */
function getTableHighlightSegments(
	screen: string[],
	selection: SelectionLike,
): Map<number, Array<{ start: number; end: number }>> | undefined {
	const plainLines = screen.map((line) => stripTerminalSequences(line));
	let firstRow: number | undefined;
	let lastRow: number | undefined;
	for (let row = selection.start.row; row <= selection.end.row && row < plainLines.length; row++) {
		const line = plainLines[row] ?? "";
		if (!getTableRowCells(line) && !getTableBorderKind(line)) return undefined;
		if (getTableRowCells(line)) {
			firstRow ??= row;
			lastRow = row;
		}
	}
	if (firstRow === undefined || lastRow === undefined) return undefined;

	const firstCells = getTableRowCells(plainLines[firstRow] ?? "");
	const lastCells = getTableRowCells(plainLines[lastRow] ?? "");
	if (!firstCells || !lastCells) return undefined;
	const sameGeometry =
		firstCells.length === lastCells.length &&
		firstCells.every(
			(cell, index) =>
				cell.contentStart === lastCells[index]!.contentStart && cell.contentEnd === lastCells[index]!.contentEnd,
		);
	if (!sameGeometry) return undefined;

	// Group physical lines into logical rows. A border line starts a new
	// group, and a bottom or top border means the selection leaves this table.
	const rowGroups = new Map<number, number>();
	let group = 0;
	let seenRow = false;
	for (let row = firstRow; row <= lastRow; row++) {
		const line = plainLines[row] ?? "";
		const border = getTableBorderKind(line);
		if (border) {
			if (border !== "separator" && row !== firstRow && seenRow) return undefined;
			if (seenRow) group += 1;
			continue;
		}
		if (!getTableRowCells(line)) return undefined;
		seenRow = true;
		rowGroups.set(row, group);
	}
	const firstGroup = rowGroups.get(firstRow)!;
	const lastGroup = rowGroups.get(lastRow)!;

	const startCellIndex = getTableCellIndexAtColumn(firstCells, selection.start.col, "start");
	const endCellIndex = getTableCellIndexAtColumn(lastCells, selection.end.col, "end");
	if (firstGroup === lastGroup && startCellIndex === endCellIndex) return undefined;

	const firstColumn = Math.min(startCellIndex, endCellIndex);
	const lastColumn = Math.max(startCellIndex, endCellIndex);
	const segments = new Map<number, Array<{ start: number; end: number }>>();
	for (const [row, rowGroup] of rowGroups) {
		if (rowGroup < firstGroup || rowGroup > lastGroup) continue;
		const cells = getTableRowCells(plainLines[row] ?? "") ?? [];
		segments.set(
			row,
			cells
				.filter((cell) => cell.index >= firstColumn && cell.index <= lastColumn)
				.map((cell) => {
					// Paint the cell text only, not the padding that fills the cell.
					let end = cell.contentEnd;
					while (end > cell.contentStart && sliceByColumn(plainLines[row] ?? "", end - 1, 1, true) === " ") end -= 1;
					return { start: cell.contentStart, end };
				}),
		);
	}
	return segments;
}

// ---------------------------------------------------------------------------
// Prototype patch install / restore
// ---------------------------------------------------------------------------

type GetSelectionTextFn = (this: AltScreenInternals) => string | undefined;
type ApplySelectionFn = (this: AltScreenInternals, screen: string[], layout?: LayoutFrameLike) => string[];

interface AltScreenPrototype {
	getActiveSelectionText?: GetSelectionTextFn;
	applySelection?: ApplySelectionFn;
}

let installed = false;
let originals: { getActiveSelectionText: GetSelectionTextFn; applySelection: ApplySelectionFn } | undefined;

function patchedGetActiveSelectionText(this: AltScreenInternals): string | undefined {
	const selection = this.getSelectionBounds();
	if (!selection) return undefined;
	const sourceLines = getSelectionSourceLines(this, selection);
	if (sourceLines) {
		const tableText = getTableSelectionText(this, selection, sourceLines);
		if (tableText !== undefined) return tableText;
	}
	return originals!.getActiveSelectionText.call(this);
}

function patchedApplySelection(this: AltScreenInternals, screen: string[], layout?: LayoutFrameLike): string[] {
	const internals = this;
	const selection = internals.getSelectionBounds();
	if (!selection) return screen;

	let screenSelection = selection;
	let minRow = 0;
	let maxRow = screen.length - 1;
	let minColumn = 0;
	let maxColumn = internals.terminal.columns;
	if (selection.start.scrollView) {
		const frame = layout ?? internals.currentLayout;
		const box = frame ? findScrollViewBox(frame.root, selection.start.scrollView) : undefined;
		if (!box) return screen;
		minRow = Math.max(0, box.rect.y, box.clip.y);
		maxRow = Math.min(screen.length - 1, box.rect.y + box.rect.height - 1, box.clip.y + box.clip.height - 1);
		minColumn = Math.max(0, box.rect.x, box.clip.x);
		maxColumn = Math.min(internals.terminal.columns, box.rect.x + box.rect.width, box.clip.x + box.clip.width);
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

	// Paint the same cell rectangle that the copy path returns for a
	// multi-cell table selection. Single-cell and non-table selections keep
	// the built-in screen-range highlight, except that a single-cell
	// highlight is clipped to the cell below.
	const tableSegments = getTableHighlightSegments(screen, screenSelection);
	let singleCellIndex: number | undefined;
	const startCells = getTableRowCells(screen[screenSelection.start.row] ?? "");
	const endCells = getTableRowCells(screen[screenSelection.end.row] ?? "");
	if (startCells && endCells) {
		const startCellIndex = getTableCellIndexAtColumn(startCells, screenSelection.start.col, "start");
		const endCellIndex = getTableCellIndexAtColumn(endCells, screenSelection.end.col, "end");
		const crossesRowSeparator = screen
			.slice(screenSelection.start.row, screenSelection.end.row + 1)
			.some((line) => getTableBorderKind(line) !== undefined);
		if (startCellIndex === endCellIndex && !crossesRowSeparator) singleCellIndex = startCellIndex;
	}
	if (!tableSegments && singleCellIndex === undefined) {
		return originals!.applySelection.call(internals, screen, layout);
	}

	return screen.map((line, row) => {
		if (
			row < minRow ||
			row > maxRow ||
			row < screenSelection.start.row ||
			row > screenSelection.end.row ||
			isImageLine(line)
		) {
			return line;
		}
		const lineWidth = visibleWidth(line);
		if (tableSegments) {
			const segments = tableSegments.get(row) ?? [];
			if (segments.length === 0) return line;
			let result = line;
			for (const segment of [...segments].sort((a, b) => b.start - a.start)) {
				const start = Math.max(minColumn, segment.start);
				const end = Math.min(maxColumn, segment.end);
				if (end <= start) continue;
				const before = sliceByColumn(result, 0, start, true);
				const selected = sliceByColumn(result, start, end - start, true);
				const after = sliceByColumn(result, end, Math.max(0, lineWidth - end), true);
				result = `${before}${applySelectionHighlight(selected)}${after}`;
			}
			return result;
		}
		const columns = internals.getSelectionColumns(line, row, screenSelection, minColumn, maxColumn);
		const cell = getTableRowCells(line)?.[singleCellIndex!];
		if (!cell) return line;
		columns.start = Math.max(columns.start, cell.contentStart);
		columns.end = Math.min(columns.end, cell.contentEnd);
		if (columns.end <= columns.start) return line;
		const before = sliceByColumn(line, 0, columns.start, true);
		const selected = sliceByColumn(line, columns.start, columns.end - columns.start, true);
		const after = sliceByColumn(line, columns.end, Math.max(0, lineWidth - columns.end), true);
		return `${before}${applySelectionHighlight(selected)}${after}`;
	});
}

function installTableSelection(): boolean {
	if (installed) return true;
	const prototype = TuiAltScreen.prototype as unknown as AltScreenPrototype;
	if (typeof prototype.getActiveSelectionText !== "function" || typeof prototype.applySelection !== "function") {
		return false;
	}
	originals = {
		getActiveSelectionText: prototype.getActiveSelectionText,
		applySelection: prototype.applySelection,
	};
	prototype.getActiveSelectionText = patchedGetActiveSelectionText;
	prototype.applySelection = patchedApplySelection;
	installed = true;
	return true;
}

function uninstallTableSelection(): void {
	if (!installed || !originals) return;
	const prototype = TuiAltScreen.prototype as unknown as AltScreenPrototype;
	prototype.getActiveSelectionText = originals.getActiveSelectionText;
	prototype.applySelection = originals.applySelection;
	originals = undefined;
	installed = false;
}

export default function tableSelectionExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (!installTableSelection()) {
			ctx.ui.notify("table-selection: fullscreen selection internals not found; extension inactive", "warning");
		}
	});

	pi.on("session_shutdown", () => {
		uninstallTableSelection();
	});

	pi.registerCommand("table-selection", {
		description: "Report whether table-aware mouse selection is active",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				installed
					? "table-selection: active (fullscreen table cells copy as Markdown)"
					: "table-selection: inactive (patch not installed)",
				installed ? "info" : "warning",
			);
		},
	});
}
