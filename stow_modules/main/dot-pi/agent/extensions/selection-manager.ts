/**
 * selection-manager.ts -- Markdown-aware mouse selection in fullscreen mode.
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
 * - Outside tables and code frames, a selection copies as Markdown. When
 *   it touches one of pi's Markdown components, the original source of the
 *   touched blocks is recovered from the layout tree — the component keeps
 *   its source text and lexed blocks, and each block's rendered rows say
 *   which blocks the selection touches — so bold, inline code, links, and
 *   headings copy as authored, and no wrap survives inside a block. Lists
 *   are sliced per item, and a partially selected code block is re-fenced
 *   around the touched code lines.
 * - When no Markdown source is reachable, the rendered rows are instead
 *   reconstructed as Markdown: each list item joins its wrapped
 *   continuation rows into one continuous line with its marker and
 *   nesting intact, paragraph wraps rejoin (a long path split as
 *   `pi-permissio` / `n-system/config.json` copies as one token, a
 *   word-boundary wrap with one space), blockquotes become `> ` lines,
 *   fenced code is kept verbatim, and a break the wrapper would not have
 *   taken (a short line, a blank line, a structural line) stays a newline.
 *
 * Requires fullscreen mode (`tuiMode: "fullscreen"`) with copy on select, so
 * pi captures the mouse at all. In regular mode the terminal owns selection
 * and this extension does nothing visible.
 *
 * Referencing a selection
 * ------------------------
 * While a selection is live, a `⇥ reference` popup sits at the end of the
 * selection. Clicking it, or pressing Tab, appends a one-line reference to
 * the prompt editor — `> the first line of the selection ...` — and leaves
 * the cursor on the next line. The editor never holds the whole selection.
 * On submit, the `input` handler swaps each reference line for the full
 * selected text, so the model receives the selection as context.
 *
 * In the editor, a reference line renders as a grayed-out block. It cannot
 * be edited: typing on that line does nothing, and Backspace or Delete on
 * or next to the block removes the whole block (and its pending reference).
 * The editor wrapper composes over whichever editor factory was installed
 * before this extension (copy-snippet's editor today).
 */

import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
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

// ---------------------------------------------------------------------------
// Plain-text unwrapping (soft wraps outside tables and code frames)
// ---------------------------------------------------------------------------

/**
 * Width, in selection-source columns, at which plain text wraps.
 *
 * For a scroll view this is the width of the scroll box that carries the
 * transcript lines; otherwise it is the terminal width. Rendered lines are
 * padded to that width, and a line that wraps fills it (minus at most a
 * right padding column), which is the evidence the break classifier below
 * relies on. Without a known width there is no safe way to tell a wrap
 * from an authored break, so callers must leave the text alone.
 */
function getPlainTextWrapWidth(internals: AltScreenInternals, selection: SelectionLike): number {
	if (selection.start.scrollView) {
		const box = findScrollViewBox(internals.currentLayout?.root, selection.start.scrollView);
		if (box && box.rect.width > 0) return box.rect.width;
	}
	return internals.terminal?.columns ?? 0;
}

/**
 * Classify the break between two physical lines of plain text.
 *
 * This mirrors the table-cell rules, with the wrap width taken from the
 * rendered screen instead of a cell. A break is a soft wrap when the
 * wrapper would have had to take it: a line that fills the width and is
 * followed by a lowercase or digit continuation was split inside a word
 * (join with nothing), and a line whose next word did not fit was wrapped
 * at a word boundary (join with one space). Anything else — a short line,
 * a line that could have held the next word, a structural next line — is
 * an authored break. A line that fills the width exactly stays ambiguous
 * (a word-boundary wrap can also fill it); like the cell rules, this
 * prefers rejoining a split word over inserting a space into one.
 */
function getPlainFragmentBreak(previous: string, next: string, wrapWidth: number): CellFragmentBreak {
	if (/^(?:[-*+•]\s|\d+[.)]\s|#{1,6}\s|>+\s|```|~~~|[│┌├└┐┤┘─])/.test(next)) return "newline";
	const previousWidth = visibleWidth(previous);
	const fillsWidth = previousWidth >= wrapWidth - 1;
	if (fillsWidth && /[\p{L}\p{N}]$/u.test(previous) && /^[\p{Ll}\p{N}]/u.test(next)) return "none";
	if (fillsWidth && (previous.endsWith("-") || previous.endsWith("/")) && /^[\p{L}\p{N}]/u.test(next)) return "none";
	if (fillsWidth && /^[\p{L}\p{N}._~/-]/u.test(next) && /[\p{L}\p{N}._~/-]$/u.test(previous)) return "none";
	const firstWord = next.split(/\s+/)[0] ?? "";
	if (previousWidth + 1 + visibleWidth(firstWord) <= wrapWidth) return "newline";
	return "space";
}

const LIST_ITEM_AT = /^(\s*)([-*+•]|\d+[.)])(\s+)(.*)$/;

/** Join two fragments of one logical line, choosing only between a space and nothing. */
function joinContinuation(previous: string, next: string, wrapWidth: number): string {
	return getPlainFragmentBreak(previous, next, wrapWidth) === "none" ? next : ` ${next}`;
}

/**
 * Selection text reconstructed as Markdown from rendered lines.
 *
 * This is the fallback for text whose original Markdown source is not
 * reachable through the layout tree, and for non-Markdown text. Physical
 * rows are grouped into logical Markdown lines first, because structure
 * is stronger evidence than width: a rendered list item wraps at the
 * item's own (narrower) width, so its continuation rows — indented to the
 * item's content column — always belong to that item even when the next
 * word would have fit on a full-width line. Each list item therefore
 * copies as one continuous line with its marker and nesting intact.
 * Wrapped paragraph rows rejoin with the width-based rules, blockquote
 * rows (`│ ` in the render) become `> ` lines, fenced code rows are kept
 * verbatim, and every other break keeps the built-in behavior.
 *
 * Returns undefined for a single-row selection or when the wrap width is
 * unknown, so the caller falls back to the built-in behavior.
 */
function getPlainSelectionText(
	internals: AltScreenInternals,
	selection: SelectionLike,
	sourceLines: readonly string[],
): string | undefined {
	if (selection.end.row <= selection.start.row) return undefined;
	return getRenderedSelectionText(internals, selection, sourceLines, selection.start.row, selection.end.row);
}

/** Reconstruct Markdown for the inclusive row range of a selection. */
function getRenderedSelectionText(
	internals: AltScreenInternals,
	selection: SelectionLike,
	sourceLines: readonly string[],
	firstRow: number,
	lastRow: number,
): string | undefined {
	if (lastRow < firstRow) return undefined;
	const viewportWidth = getPlainTextWrapWidth(internals, selection);
	if (viewportWidth <= 1) return undefined;
	const plainLines = sourceLines.map((line) => stripTerminalSequences(line));
	// The rightmost content column reached by the selected rows is the
	// effective wrap width when it reaches the edge of the viewport: it
	// already excludes any right padding the renderer added. For narrower
	// selections (short authored lines) the viewport width is the width a
	// wrapper would have had available, so a break it would not have taken
	// still reads as authored.
	let edgeWidth = 0;
	for (let row = firstRow; row <= lastRow; row++) {
		edgeWidth = Math.max(edgeWidth, visibleWidth((plainLines[row] ?? "").trimEnd()));
	}
	const wrapWidth = edgeWidth >= viewportWidth - 2 ? edgeWidth : viewportWidth - 1;

	const out: string[] = [];
	// The logical line currently being accumulated, when rows can join it.
	let current: { outIndex: number; kind: "list" | "paragraph" | "quote"; contentIndent: number; last: string } | undefined;
	let inFence = false;

	const appendJoined = (next: string) => {
		if (!current) return;
		out[current.outIndex] += joinContinuation(current.last, next, wrapWidth);
		current.last = next;
	};

	for (let row = firstRow; row <= lastRow; row++) {
		const plainLine = plainLines[row] ?? "";
		const columns = internals.getSelectionColumns(sourceLines[row] ?? "", row, selection);
		const fragment = sliceByColumn(plainLine, columns.start, Math.max(0, columns.end - columns.start), true).trimEnd();
		const trimmed = fragment.trim();
		const indent = fragment.length - fragment.trimStart().length;

		if (inFence) {
			out.push(fragment);
			if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) inFence = false;
			current = undefined;
			continue;
		}
		if (!trimmed) {
			out.push("");
			current = undefined;
			continue;
		}
		if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
			out.push(fragment.trimStart());
			inFence = true;
			current = undefined;
			continue;
		}

		// Blockquote rows carry a `│ ` (or authored `> `) prefix on every
		// physical row; strip it, join the wrapped text, and re-emit `> `.
		const quoteMatch = /^(│|>)\s(.*)$/.exec(trimmed);
		// A trailing `│` means a table or framed row, not a blockquote.
		if (quoteMatch && !trimmed.endsWith("│") && (trimmed.startsWith("│") || current?.kind === "quote" || /^>\s/.test(trimmed))) {
			const inner = quoteMatch[2]!.trim();
			if (current?.kind === "quote") {
				appendJoined(inner);
			} else {
				out.push(`> ${inner}`);
				current = { outIndex: out.length - 1, kind: "quote", contentIndent: indent, last: inner };
			}
			continue;
		}

		const listMatch = LIST_ITEM_AT.exec(fragment);
		if (listMatch) {
			const markerIndent = visibleWidth(listMatch[1]!);
			const markerWidth = visibleWidth(listMatch[2]!) + visibleWidth(listMatch[3]!);
			out.push(fragment);
			current = {
				outIndex: out.length - 1,
				kind: "list",
				contentIndent: markerIndent + markerWidth,
				last: trimmed,
			};
			continue;
		}

		// A row indented to (or past) the current list item's content column
		// is that item's continuation — a wrapped line or an indented block
		// of the item — never a new logical line. Join it onto the item.
		if (current?.kind === "list" && indent >= current.contentIndent) {
			appendJoined(trimmed);
			continue;
		}

		if (current?.kind === "quote") current = undefined;
		if (!current || current.kind === "list") {
			out.push(fragment);
			current = { outIndex: out.length - 1, kind: "paragraph", contentIndent: indent, last: trimmed };
			continue;
		}
		// Ordinary paragraph rows: rejoin only a break the wrapper took.
		if (getPlainFragmentBreak(current.last, trimmed, wrapWidth) === "newline") {
			out.push(fragment);
			current = { outIndex: out.length - 1, kind: "paragraph", contentIndent: indent, last: trimmed };
		} else {
			appendJoined(trimmed);
		}
	}
	const text = out.join("\n");
	return text.length > 0 ? text : undefined;
}

// ---------------------------------------------------------------------------
// Original-Markdown recovery (pi's Markdown components retain their source)
// ---------------------------------------------------------------------------

interface MarkdownTokenLike {
	type?: string;
	raw?: string;
	text?: string;
	lang?: string;
	items?: Array<{ raw?: string }>;
}

interface MarkdownComponentLike {
	text: string;
	paddingY?: number;
	cachedTokens?: { deref?: () => { tokens?: MarkdownTokenLike[] } | undefined };
	blocks?: { deref?: () => Map<string, { lines?: readonly string[] }> | undefined };
}

interface MarkdownSource {
	component: MarkdownComponentLike;
	startRow: number;
	endRow: number;
}

/**
 * A Markdown component keeps its (pre-transform) source in `text`, the
 * lexed blocks in a `cachedTokens` WeakRef, and each block's rendered
 * lines in a `blocks` WeakRef, so duck-typing those fields finds it
 * without depending on the class name surviving bundling. Plain `Text`
 * components have none of `defaultTextStyle`/`cachedTokens`, which keeps
 * styled labels out of this path.
 */
function asMarkdownComponent(component: unknown): MarkdownComponentLike | undefined {
	if (!component || typeof component !== "object") return undefined;
	const candidate = component as Record<string, unknown>;
	if (typeof candidate.text !== "string") return undefined;
	if (!("defaultTextStyle" in candidate) && !("cachedTokens" in candidate)) return undefined;
	return candidate as unknown as MarkdownComponentLike;
}

/** Collect Markdown components whose rendered rows intersect the selection, in row order. */
function collectMarkdownSources(internals: AltScreenInternals, selection: SelectionLike): MarkdownSource[] {
	const root = internals.currentLayout?.root;
	if (!root) return [];
	const scrollBox = selection.start.scrollView ? findScrollViewBox(root, selection.start.scrollView) : undefined;
	const sources: MarkdownSource[] = [];
	const visit = (box: LayoutBoxLike) => {
		const component = asMarkdownComponent(box.component);
		if (component) {
			const lineCount = box.lines?.length ?? box.rect.height;
			if (lineCount > 0) {
				const startRow = selection.start.scrollView
					? box.rect.y - (scrollBox?.rect.y ?? 0) + (selection.start.scrollView.scrollTop ?? 0)
					: box.rect.y;
				const endRow = startRow + lineCount - 1;
				if (endRow >= selection.start.row && startRow <= selection.end.row) {
					sources.push({ component, startRow, endRow });
				}
			}
		}
		for (const child of box.children ?? []) visit(child);
	};
	visit(root);
	return sources.sort((a, b) => a.startRow - b.startRow);
}

/** Rendered row starts of each top-level list item, or undefined when the shape is unexpected. */
function getListItemRenderedStarts(renderedLines: readonly string[]): number[] | undefined {
	const plain = renderedLines.map((line) => stripTerminalSequences(line).trimEnd());
	let baseIndent: number | undefined;
	const starts: number[] = [];
	for (let row = 0; row < plain.length; row++) {
		const match = LIST_ITEM_AT.exec(plain[row] ?? "");
		if (!match) continue;
		const indent = visibleWidth(match[1]!);
		if (baseIndent === undefined) baseIndent = indent;
		if (indent === baseIndent) starts.push(row);
	}
	return starts.length > 0 ? starts : undefined;
}

/**
 * Markdown for the part of one component that the selection touches.
 *
 * Blocks are recovered whole: a selection that touches any rendered row
 * of a paragraph, heading, blockquote, or list item copies that block's
 * original source — formatting, inline code, and links intact, and with
 * no wrap inside it. Code blocks are the exception: their rendered rows
 * line up with code lines, so a partial selection copies only the touched
 * code lines, re-fenced. Returns undefined when the component's block
 * map is unavailable and the selection covers only part of it, so the
 * caller can reconstruct those rows from the render instead.
 */
function getMarkdownComponentSlice(source: MarkdownSource, selection: SelectionLike): string | undefined {
	const { component } = source;
	const relStart = Math.max(selection.start.row, source.startRow) - source.startRow;
	const relEnd = Math.min(selection.end.row, source.endRow) - source.startRow;
	const tokens = component.cachedTokens?.deref?.()?.tokens;
	const blocks = component.blocks?.deref?.();
	if (!tokens || !blocks) {
		const lineCount = source.endRow - source.startRow + 1;
		const padding = component.paddingY ?? 0;
		if (relStart <= padding && relEnd >= lineCount - 1 - padding) return component.text.trim() || undefined;
		return undefined;
	}
	const parts: string[] = [];
	let rowCursor = component.paddingY ?? 0;
	for (const token of tokens) {
		const block = token.raw !== undefined ? blocks.get(token.raw) : undefined;
		if (!block?.lines) return undefined;
		const blockStart = rowCursor;
		const blockEnd = rowCursor + block.lines.length - 1;
		rowCursor = blockEnd + 1;
		if (blockEnd < relStart || blockStart > relEnd || token.type === "space") continue;
		if (token.type === "list" && token.items && token.items.length > 0) {
			const starts = getListItemRenderedStarts(block.lines);
			if (starts && starts.length === token.items.length) {
				const itemRaws: string[] = [];
				for (let index = 0; index < starts.length; index++) {
					const itemStart = blockStart + starts[index]!;
					const itemEnd = blockStart + (starts[index + 1] ?? block.lines.length) - 1;
					if (itemEnd < relStart || itemStart > relEnd) continue;
					const raw = token.items[index]?.raw?.trim();
					if (raw) itemRaws.push(raw);
				}
				if (itemRaws.length > 0) {
					parts.push(itemRaws.join("\n"));
					continue;
				}
			}
			const raw = token.raw?.trim();
			if (raw) parts.push(raw);
			continue;
		}
		if (token.type === "code" && typeof token.text === "string" && block.lines.length > 2) {
			const codeLines = token.text.split("\n");
			// Rendered rows are fence, code lines, fence; only slice when
			// they still line up (a wrapped long code line breaks the map).
			if (block.lines.length === codeLines.length + 2 && (relStart > blockStart || relEnd < blockEnd)) {
				const first = Math.max(relStart, blockStart + 1) - (blockStart + 1);
				const last = Math.min(relEnd, blockEnd - 1) - (blockStart + 1);
				if (last >= first) {
					parts.push(`\`\`\`${token.lang ?? ""}\n${codeLines.slice(first, last + 1).join("\n")}\n\`\`\``);
					continue;
				}
			}
			const raw = token.raw?.trim();
			if (raw) parts.push(raw);
			continue;
		}
		const raw = token.raw?.trim();
		if (raw) parts.push(raw);
	}
	const joined = parts.join("\n\n");
	return joined.length > 0 ? joined : undefined;
}

/**
 * Selection text from the original Markdown of the components it touches.
 *
 * Rows between Markdown components (other messages, tool output, spacers)
 * are reconstructed from the render, so a selection that spans messages
 * still copies in order. Returns undefined when no Markdown component is
 * in the selection or none of them can be sliced.
 */
function getSourceMarkdownSelectionText(
	internals: AltScreenInternals,
	selection: SelectionLike,
	sourceLines: readonly string[],
): string | undefined {
	// Block-granular recovery is for multi-row selections; a single-row
	// selection (a dragged word or phrase) keeps pi's exact built-in slice.
	if (selection.end.row <= selection.start.row) return undefined;
	const sources = collectMarkdownSources(internals, selection);
	if (sources.length === 0) return undefined;
	const parts: string[] = [];
	let cursor = selection.start.row;
	let usedSource = false;
	for (const source of sources) {
		if (source.startRow > cursor) {
			const gap = getRenderedSelectionText(internals, selection, sourceLines, cursor, Math.min(source.startRow - 1, selection.end.row));
			if (gap?.trim()) parts.push(gap.trim());
		}
		const slice = getMarkdownComponentSlice(source, selection);
		if (slice) {
			parts.push(slice);
			usedSource = true;
		} else {
			const rendered = getRenderedSelectionText(
				internals,
				selection,
				sourceLines,
				Math.max(cursor, source.startRow),
				Math.min(source.endRow, selection.end.row),
			);
			if (rendered?.trim()) parts.push(rendered.trim());
		}
		cursor = Math.max(cursor, source.endRow + 1);
	}
	if (cursor <= selection.end.row) {
		const tail = getRenderedSelectionText(internals, selection, sourceLines, cursor, selection.end.row);
		if (tail?.trim()) parts.push(tail.trim());
	}
	if (!usedSource) return undefined;
	const joined = parts.join("\n\n");
	return joined.length > 0 ? joined : undefined;
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
// Framed code-block parsing (`╭─ lang ─── [Copy] ╮` ... `╰───╯` from open-tui)
// ---------------------------------------------------------------------------

interface CodeFrameRowBounds {
	contentStart: number;
	contentEnd: number;
	trimmedEnd: number;
}

interface CodeFrameBlock {
	startRow: number;
	endRow: number;
	bodyStartRow: number;
	bodyEndRow: number;
}

function isCodeFrameTopBorder(line: string): boolean {
	const trimmed = stripTerminalSequences(line).trim();
	return trimmed.startsWith("╭─") && trimmed.endsWith("╮");
}

function isCodeFrameBottomBorder(line: string): boolean {
	const trimmed = stripTerminalSequences(line).trim();
	return trimmed.length >= 2 && trimmed.startsWith("╰") && trimmed.endsWith("╯") && [...trimmed.slice(1, -1)].every((c) => c === "─");
}

function getCodeFrameRowBounds(line: string): CodeFrameRowBounds | undefined {
	const plain = stripTerminalSequences(line);
	const trimmed = plain.trim();
	if (!trimmed.startsWith("│") || !trimmed.endsWith("│")) return undefined;
	let firstBorder = -1;
	let lastBorder = -1;
	let column = 0;
	for (const character of plain) {
		if (character === "│") {
			if (firstBorder < 0) firstBorder = column;
			lastBorder = column;
		}
		column += visibleWidth(character);
	}
	if (firstBorder < 0 || lastBorder <= firstBorder) return undefined;
	let contentStart = firstBorder + 1;
	let contentEnd = lastBorder;
	if (sliceByColumn(plain, contentStart, 1, true) === " ") contentStart += 1;
	if (contentEnd > contentStart && sliceByColumn(plain, contentEnd - 1, 1, true) === " ") contentEnd -= 1;
	let trimmedEnd = contentEnd;
	while (trimmedEnd > contentStart && sliceByColumn(plain, trimmedEnd - 1, 1, true) === " ") {
		trimmedEnd -= 1;
	}
	return { contentStart, contentEnd, trimmedEnd };
}

function parseCodeFrameBlocks(plainLines: readonly string[]): CodeFrameBlock[] {
	const blocks: CodeFrameBlock[] = [];
	let startRow: number | undefined;
	let bodyStartRow: number | undefined;
	let bodyEndRow: number | undefined;

	for (let row = 0; row < plainLines.length; row += 1) {
		const line = plainLines[row] ?? "";
		if (isCodeFrameTopBorder(line)) {
			if (startRow !== undefined && bodyStartRow !== undefined && bodyEndRow !== undefined) {
				blocks.push({ startRow, endRow: bodyEndRow, bodyStartRow, bodyEndRow });
			}
			startRow = row;
			bodyStartRow = undefined;
			bodyEndRow = undefined;
			continue;
		}
		if (startRow !== undefined && isCodeFrameBottomBorder(line)) {
			if (bodyStartRow !== undefined && bodyEndRow !== undefined) {
				blocks.push({ startRow, endRow: row, bodyStartRow, bodyEndRow });
			}
			startRow = undefined;
			bodyStartRow = undefined;
			bodyEndRow = undefined;
			continue;
		}
		if (startRow !== undefined && getCodeFrameRowBounds(line)) {
			bodyStartRow ??= row;
			bodyEndRow = row;
			continue;
		}
		if (startRow !== undefined) {
			if (bodyStartRow !== undefined && bodyEndRow !== undefined) {
				blocks.push({ startRow, endRow: bodyEndRow, bodyStartRow, bodyEndRow });
			}
			startRow = undefined;
			bodyStartRow = undefined;
			bodyEndRow = undefined;
		}
	}
	if (startRow !== undefined && bodyStartRow !== undefined && bodyEndRow !== undefined) {
		blocks.push({ startRow, endRow: bodyEndRow, bodyStartRow, bodyEndRow });
	}
	return blocks;
}

function getCodeFrameSelectionText(
	internals: AltScreenInternals,
	selection: SelectionLike,
	sourceLines: readonly string[],
): string | undefined {
	const plainLines = sourceLines.map((line) => stripTerminalSequences(line));
	const frame = parseCodeFrameBlocks(plainLines).find(
		(candidate) => selection.start.row >= candidate.startRow && selection.end.row <= candidate.endRow,
	);
	if (!frame) return undefined;
	const firstRow = Math.max(selection.start.row, frame.bodyStartRow);
	const lastRow = Math.min(selection.end.row, frame.bodyEndRow);
	if (lastRow < firstRow) return undefined;
	const out: string[] = [];
	for (let row = firstRow; row <= lastRow; row += 1) {
		const bounds = getCodeFrameRowBounds(plainLines[row] ?? "");
		if (!bounds) continue;
		const columns = internals.getSelectionColumns(sourceLines[row] ?? "", row, selection);
		const start = Math.max(columns.start, bounds.contentStart);
		const end = Math.min(columns.end, bounds.trimmedEnd);
		out.push(end > start ? sliceByColumn(plainLines[row] ?? "", start, end - start, true) : "");
	}
	const joined = out.join("\n");
	return joined.trim().length > 0 ? joined : undefined;
}

function getCodeFrameHighlightSegments(
	internals: AltScreenInternals,
	screen: string[],
	selection: SelectionLike,
	minColumn: number,
	maxColumn: number,
): { segments: Map<number, Array<{ start: number; end: number }>>; lastBodyRow: number; highlightEnd: number } | undefined {
	const plainLines = screen.map((line) => stripTerminalSequences(line));
	const frame = parseCodeFrameBlocks(plainLines).find(
		(candidate) => selection.start.row >= candidate.startRow && selection.end.row <= candidate.endRow,
	);
	if (!frame) return undefined;
	const firstRow = Math.max(selection.start.row, frame.bodyStartRow);
	const lastRow = Math.min(selection.end.row, frame.bodyEndRow);
	if (lastRow < firstRow) return undefined;
	const segments = new Map<number, Array<{ start: number; end: number }>>();
	let highlightEnd = selection.end.col + (selection.end.boundary ? 0 : 1);
	for (let row = firstRow; row <= lastRow; row += 1) {
		const bounds = getCodeFrameRowBounds(plainLines[row] ?? "");
		if (!bounds) continue;
		const columns = internals.getSelectionColumns(screen[row] ?? "", row, selection, minColumn, maxColumn);
		const start = Math.max(columns.start, bounds.contentStart);
		const end = Math.min(columns.end, bounds.trimmedEnd);
		segments.set(row, end > start ? [{ start, end }] : []);
		if (row === lastRow && end > start) highlightEnd = end;
	}
	return { segments, lastBodyRow: lastRow, highlightEnd };
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
	component?: unknown;
	lines?: readonly string[];
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
// Referencing a selection in the next prompt
// ---------------------------------------------------------------------------

const REFERENCE_POPUP_LABEL = " ⇥ reference ";

interface SelectionSnapshot {
	text: string;
}

/** The last completed selection, armed for referencing until it is used or replaced. */
let armedSnapshot: SelectionSnapshot | undefined;
/** Where the popup was last painted, in screen columns on one row. */
let popupRect: { row: number; start: number; end: number } | undefined;
/** Editor/session context captured at session_start, used to reach the prompt editor. */
let activeCtx: ExtensionContext | undefined;
/** The live fullscreen renderer instance, captured while it renders a selection. */
let capturedTui: AltScreenInternals | undefined;
/** Reference line shown in the editor -> full selected text, swapped in on submit. */
const pendingReferences = new Map<string, string>();

/** One-line visual stand-in for a selection in the prompt editor. */
function makeReferenceLine(text: string): string {
	const firstLine = text.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "";
	const maxPreview = 60;
	const truncated = text.includes("\n") || firstLine.length > maxPreview;
	const preview = firstLine.length > maxPreview ? firstLine.slice(0, maxPreview).trimEnd() : firstLine;
	return truncated ? `> ${preview} ...` : `> ${preview}`;
}

/** Append the armed selection as a reference line and put the cursor on the next line. */
function addArmedSelectionAsReference(): void {
	if (!armedSnapshot || !activeCtx) return;
	const referenceLine = makeReferenceLine(armedSnapshot.text);
	pendingReferences.set(referenceLine, armedSnapshot.text);
	const current = activeCtx.ui.getEditorText();
	const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
	activeCtx.ui.setEditorText(`${current}${prefix}${referenceLine}\n`);
	armedSnapshot = undefined;
	popupRect = undefined;
	(capturedTui as { requestRender?: () => void } | undefined)?.requestRender?.();
}

/** Tab adds the armed selection as a reference; every other key passes through. */
function handleReferenceInput(data: string): { consume: boolean } | undefined {
	if (data !== "\t" && data !== "\x1b[9u" && data !== "\x1b[9;1u") return undefined;
	if (!armedSnapshot || !activeCtx) return undefined;
	addArmedSelectionAsReference();
	return { consume: true };
}

/** Paint the reference popup on the row below the end of the selection (same column) and remember its rectangle. */
function drawReferencePopup(
	screen: string[],
	screenSelection: SelectionLike,
	terminalWidth: number,
	highlightEnd: number,
): string[] {
	popupRect = undefined;
	if (!armedSnapshot) return screen;
	const preferredRow = screenSelection.end.row + 1;
	const row = preferredRow < screen.length ? preferredRow : screenSelection.end.row;
	if (row < 0 || row >= screen.length || isImageLine(screen[row] ?? "")) return screen;
	const labelWidth = visibleWidth(REFERENCE_POPUP_LABEL);
	const start = Math.max(0, Math.min(highlightEnd, terminalWidth - labelWidth));
	if (terminalWidth < labelWidth) return screen;
	popupRect = { row, start, end: start + labelWidth };
	const line = screen[row] ?? "";
	const lineWidth = visibleWidth(line);
	// Non-strict slices keep ANSI resets that sit exactly on the cut column.
	// If a highlight still ends open at the cut, close it before the popup.
	let before = sliceByColumn(line, 0, start);
	if (before.lastIndexOf("\x1b[7m") > before.lastIndexOf("\x1b[27m")) before += "\x1b[27m";
	const beforeWidth = visibleWidth(before);
	if (beforeWidth < start) {
		before += " ".repeat(start - beforeWidth);
	}
	const after = sliceByColumn(line, start + labelWidth, Math.max(0, lineWidth - (start + labelWidth)));
	const result = [...screen];
	// Style from the active theme (accent background, message-panel foreground)
	// so the popup matches the current palette instead of a fixed bright cyan.
	// `accent` is a foreground token, so pass the concrete Color objects from `theme.colors`.
	const theme = activeCtx?.ui.theme;
	const fgColor = theme?.colors?.userMessageBg;
	const bgColor = theme?.colors?.accent;
	const popupLabel =
		theme && fgColor && bgColor && typeof fgColor === "object" && typeof bgColor === "object"
			? `${theme.style(REFERENCE_POPUP_LABEL, {
					fg: fgColor,
					bg: bgColor,
					bold: true,
				})}\x1b[0m`
			: `\x1b[1;30;106m${REFERENCE_POPUP_LABEL}\x1b[0m`;
	result[row] = `${before}${popupLabel}${after}`;
	return result;
}

// ---------------------------------------------------------------------------
// Reference blocks in the prompt editor
// ---------------------------------------------------------------------------

const REFERENCE_EDITOR_MARKER = Symbol.for("selection-manager.reference-editor");

/**
 * Style one text segment in the reference block style: gray italic text,
 * the way a quoted line renders in the transcript. The style is restated
 * after any inner styles so the whole segment stays gray.
 */
const REFERENCE_STYLE = "\x1b[3;38;5;245m";

function styleReferenceSegment(text: string): string {
	let result = REFERENCE_STYLE;
	let index = 0;
	while (index < text.length) {
		const ansi = ANSI_AT.exec(text.slice(index));
		if (ansi) {
			result += ansi[0];
			if (ansi[0].endsWith("m")) result += REFERENCE_STYLE;
			index += ansi[0].length;
			continue;
		}
		result += text[index];
		index += 1;
	}
	return `${result}\x1b[0m`;
}

/**
 * Gray out a reference line in an editor render.
 *
 * Only the reference text itself is highlighted — not the editor padding
 * around it and not the rest of the row. The block shows a `│` vertical bar
 * in front of the quoted text, which stays as-is. The editor text itself
 * keeps the `>` line, so submit expansion still matches it.
 */
function highlightReferenceLine(line: string, referenceLine: string): string {
	const plain = stripTerminalSequences(line);
	const start = plain.indexOf(referenceLine);
	if (start < 0) return line;
	const segmentWidth = visibleWidth(referenceLine);
	const end = start + segmentWidth;
	const lineWidth = visibleWidth(line);
	const before = sliceByColumn(line, 0, start, true);
	const segment = sliceByColumn(line, start, segmentWidth, true);
	const after = sliceByColumn(line, end, Math.max(0, lineWidth - end), true);
	const displaySegment = `│ ${stripTerminalSequences(segment)}`;
	return `${before}${styleReferenceSegment(displaySegment)}${after}`;
}

interface EditorInternals {
	getText(): string;
	setText(text: string): void;
	// The real pi editor keeps its cursor in `state`; flat fields are a fallback.
	state?: { cursorLine: number; cursorCol: number };
	cursorLine: number;
	cursorCol: number;
	setCursorCol?(col: number): void;
	handleInput(data: string): void;
	handleMouse?(event: unknown): unknown;
	render(width: number): string[];
}

function getEditorCursor(editor: EditorInternals): { cursorLine: number; cursorCol: number } {
	return editor.state ?? editor;
}

function setEditorCursor(editor: EditorInternals, line: number, col: number): void {
	const cursor = getEditorCursor(editor);
	cursor.cursorLine = line;
	if (editor.state && typeof editor.setCursorCol === "function") editor.setCursorCol(col);
	else cursor.cursorCol = col;
}

/** Remove one reference block from the editor and drop its pending reference. */
function removeReferenceBlock(editor: EditorInternals, referenceIndex: number, cursor: { line: number; col: number }): void {
	const lines = editor.getText().split("\n");
	const [removed] = lines.splice(referenceIndex, 1);
	if (removed) pendingReferences.delete(removed);
	editor.setText(lines.join("\n"));
	setEditorCursor(editor, Math.max(0, Math.min(cursor.line, lines.length - 1)), cursor.col);
	(editor as { requestRender?: () => void }).requestRender?.();
}

/** Drop pending references whose line no longer exists verbatim in the editor. */
function pruneStaleReferences(editor: EditorInternals): void {
	if (pendingReferences.size === 0) return;
	const lines = editor.getText().split("\n");
	for (const referenceLine of [...pendingReferences.keys()]) {
		if (!lines.includes(referenceLine)) pendingReferences.delete(referenceLine);
	}
}

/** Keep the cursor out of a reference block: park it at the block's end. */
function snapCursorOffReference(editor: EditorInternals): void {
	const lines = editor.getText().split("\n");
	const cursor = getEditorCursor(editor);
	const line = lines[cursor.cursorLine];
	if (line !== undefined && pendingReferences.has(line)) {
		setEditorCursor(editor, cursor.cursorLine, line.length);
	}
}

/**
 * Wrap an editor instance so reference lines render as highlighted blocks
 * and cannot be edited. The wrapper subclasses the instance's own class and
 * then swaps the instance prototype, so host instanceof checks and every
 * other editor behavior stay the base editor's.
 */
function wrapEditorWithReferenceBlocks(base: unknown, keybindings: { matches(data: string, action: string): boolean }): unknown {
	const editor = base as EditorInternals & Record<PropertyKey, unknown>;
	if (editor[REFERENCE_EDITOR_MARKER]) return base;
	const BaseCtor = editor.constructor as new (...args: never[]) => EditorInternals;
	const baseHandleInput = BaseCtor.prototype.handleInput;
	const baseHandleMouse = BaseCtor.prototype.handleMouse;
	const baseRender = BaseCtor.prototype.render;

	class ReferenceEditor extends BaseCtor {}
	const proto = ReferenceEditor.prototype as EditorInternals & Record<PropertyKey, unknown>;

	proto.handleInput = function (data: string): void {
		const self = this as unknown as EditorInternals;
		const isSubmit = keybindings.matches(data, "tui.input.submit");
		const isBackspace = data === "\x7f" || data === "\x08";
		const isDelete = data.startsWith("\x1b[3");
		if (!isSubmit) {
			const cursor = getEditorCursor(self);
			const lines = self.getText().split("\n");
			const lineIndex = Math.max(0, Math.min(cursor.cursorLine, lines.length - 1));
			const onReference = pendingReferences.has(lines[lineIndex] ?? "");
			if (onReference) {
				if (isBackspace || isDelete) {
					removeReferenceBlock(self, lineIndex, { line: lineIndex, col: 0 });
					return;
				}
				// Navigation keys (escape sequences other than paste) may pass;
				// anything else would edit the block, so it stops here.
				if (!data.startsWith("\x1b") || data.startsWith("\x1b[200~")) return;
			} else {
				if (isBackspace && cursor.cursorCol === 0 && lineIndex > 0 && pendingReferences.has(lines[lineIndex - 1] ?? "")) {
					removeReferenceBlock(self, lineIndex - 1, { line: lineIndex - 1, col: 0 });
					return;
				}
				if (
					isDelete &&
					cursor.cursorCol >= (lines[lineIndex]?.length ?? 0) &&
					lineIndex + 1 < lines.length &&
					pendingReferences.has(lines[lineIndex + 1] ?? "")
				) {
					removeReferenceBlock(self, lineIndex + 1, { line: lineIndex, col: cursor.cursorCol });
					return;
				}
			}
		}
		baseHandleInput.call(self, data);
		pruneStaleReferences(self);
		snapCursorOffReference(self);
	};
	if (baseHandleMouse) {
		proto.handleMouse = function (event: unknown): unknown {
			const result = baseHandleMouse.call(this, event);
			snapCursorOffReference(this as unknown as EditorInternals);
			return result;
		};
	}
	proto.render = function (width: number): string[] {
		const lines = baseRender.call(this, width);
		if (pendingReferences.size === 0) return lines;
		return lines.map((line: string) => {
			const plain = stripTerminalSequences(line);
			for (const referenceLine of pendingReferences.keys()) {
				if (plain.includes(referenceLine)) return highlightReferenceLine(line, referenceLine);
			}
			return line;
		});
	};

	Object.setPrototypeOf(editor, ReferenceEditor.prototype);
	editor[REFERENCE_EDITOR_MARKER] = true;
	return editor;
}

type EditorFactoryLike = (tui: unknown, theme: unknown, keybindings: { matches(data: string, action: string): boolean }) => unknown;

/** Install the reference-block editor wrapper over the current editor factory. */
function installReferenceEditor(ctx: ExtensionContext): void {
	const previous = ctx.ui.getEditorComponent() as EditorFactoryLike | undefined;
	if ((previous as (EditorFactoryLike & Record<PropertyKey, unknown>) | undefined)?.[REFERENCE_EDITOR_MARKER]) return;
	const factory: EditorFactoryLike & Record<PropertyKey, unknown> = (tui, theme, keybindings) => {
		const base = previous?.(tui, theme, keybindings) ?? new CustomEditor(tui as never, theme as never, keybindings as never);
		return wrapEditorWithReferenceBlocks(base, keybindings);
	};
	factory[REFERENCE_EDITOR_MARKER] = true;
	ctx.ui.setEditorComponent(factory as never);
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
	handleMouseEvent?: HandleMouseEventFn;
}

let installed = false;
let originals:
	| { getActiveSelectionText: GetSelectionTextFn; applySelection: ApplySelectionFn; handleMouseEvent: HandleMouseEventFn }
	| undefined;

function patchedGetActiveSelectionText(this: AltScreenInternals): string | undefined {
	const selection = this.getSelectionBounds();
	if (!selection) return undefined;
	const sourceLines = getSelectionSourceLines(this, selection);
	let result: string | undefined;
	if (sourceLines) {
		result =
			getCodeFrameSelectionText(this, selection, sourceLines) ??
			getTableSelectionText(this, selection, sourceLines) ??
			getSourceMarkdownSelectionText(this, selection, sourceLines) ??
			getPlainSelectionText(this, selection, sourceLines);
	}
	result ??= originals!.getActiveSelectionText.call(this);
	// A completed selection arms the reference popup until it is used or a
	// new mouse press replaces the selection.
	if (result) armedSnapshot = { text: result };
	return result;
}

interface RawMouseEvent {
	button: number;
	x: number;
	y: number;
	release: boolean;
}

type HandleMouseEventFn = (this: AltScreenInternals, event: RawMouseEvent) => void;

function patchedHandleMouseEvent(this: AltScreenInternals, event: RawMouseEvent): void {
	const isPrimaryPress = !event.release && (event.button & 32) === 0 && (event.button & 3) === 0;
	if (isPrimaryPress) {
		if (
			armedSnapshot &&
			popupRect &&
			event.y === popupRect.row &&
			event.x >= popupRect.start &&
			event.x < popupRect.end
		) {
			addArmedSelectionAsReference();
			return;
		}
		// Any other press starts a new selection and drops the armed one.
		armedSnapshot = undefined;
		popupRect = undefined;
	}
	originals!.handleMouseEvent.call(this, event);
}

function patchedApplySelection(this: AltScreenInternals, screen: string[], layout?: LayoutFrameLike): string[] {
	const internals = this;
	// Capture the live renderer once so Tab presses can reach the reference
	// logic. The renderer's own input listener was registered first, so Tab
	// reaches this listener only when no viewport action consumes it.
	if (capturedTui !== internals) {
		capturedTui = internals;
		popupRect = undefined;
		const withInput = internals as AltScreenInternals & {
			addInputListener?: (listener: typeof handleReferenceInput) => void;
		};
		withInput.addInputListener?.(handleReferenceInput);
	}
	const selection = internals.getSelectionBounds();
	if (!selection) return originals!.applySelection.call(internals, screen, layout);

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

	// Framed code blocks (`╭─ lang ─── [Copy] ╮` ... `╰───╯`) highlight only
	// the inner code lines and never their borders or padding.
	const codeFrameHighlight = getCodeFrameHighlightSegments(internals, screen, screenSelection, minColumn, maxColumn);
	const tableSegments = codeFrameHighlight ? undefined : getTableHighlightSegments(screen, screenSelection);
	let singleCellIndex: number | undefined;
	const startCells = codeFrameHighlight ? undefined : getTableRowCells(screen[screenSelection.start.row] ?? "");
	const endCells = codeFrameHighlight ? undefined : getTableRowCells(screen[screenSelection.end.row] ?? "");
	if (startCells && endCells) {
		const startCellIndex = getTableCellIndexAtColumn(startCells, screenSelection.start.col, "start");
		const endCellIndex = getTableCellIndexAtColumn(endCells, screenSelection.end.col, "end");
		const crossesRowSeparator = screen
			.slice(screenSelection.start.row, screenSelection.end.row + 1)
			.some((line) => getTableBorderKind(line) !== undefined);
		if (startCellIndex === endCellIndex && !crossesRowSeparator) singleCellIndex = startCellIndex;
	}
	// The popup sits after the painted highlight, which for a table
	// selection can extend past the pointer to the end of the last cell.
	let highlightEnd = screenSelection.end.col + (screenSelection.end.boundary ? 0 : 1);
	let popupSelection = screenSelection;
	if (codeFrameHighlight) {
		highlightEnd = codeFrameHighlight.highlightEnd;
		popupSelection = {
			...screenSelection,
			end: { ...screenSelection.end, row: codeFrameHighlight.lastBodyRow },
		};
	} else if (tableSegments) {
		const endSegments = tableSegments.get(screenSelection.end.row) ?? [];
		if (endSegments.length > 0) highlightEnd = Math.max(...endSegments.map((segment) => segment.end));
	} else if (singleCellIndex !== undefined) {
		const cell = getTableRowCells(screen[screenSelection.end.row] ?? "")?.[singleCellIndex];
		if (cell) highlightEnd = Math.max(highlightEnd, cell.contentEnd);
	}

	const activeSegments = codeFrameHighlight?.segments ?? tableSegments;
	let painted: string[];
	if (!activeSegments && singleCellIndex === undefined) {
		painted = originals!.applySelection.call(internals, screen, layout);
		return drawReferencePopup(painted, popupSelection, internals.terminal.columns, highlightEnd);
	}

	painted = screen.map((line, row) => {
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
		if (activeSegments) {
			const segments = activeSegments.get(row) ?? [];
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
	return drawReferencePopup(painted, popupSelection, internals.terminal.columns, highlightEnd);
}

function installTableSelection(): boolean {
	if (installed) return true;
	const prototype = TuiAltScreen.prototype as unknown as AltScreenPrototype;
	if (
		typeof prototype.getActiveSelectionText !== "function" ||
		typeof prototype.applySelection !== "function" ||
		typeof prototype.handleMouseEvent !== "function"
	) {
		return false;
	}
	originals = {
		getActiveSelectionText: prototype.getActiveSelectionText,
		applySelection: prototype.applySelection,
		handleMouseEvent: prototype.handleMouseEvent,
	};
	prototype.getActiveSelectionText = patchedGetActiveSelectionText;
	prototype.applySelection = patchedApplySelection;
	prototype.handleMouseEvent = patchedHandleMouseEvent;
	installed = true;
	return true;
}

function uninstallTableSelection(): void {
	if (!installed || !originals) return;
	const prototype = TuiAltScreen.prototype as unknown as AltScreenPrototype;
	prototype.getActiveSelectionText = originals.getActiveSelectionText;
	prototype.applySelection = originals.applySelection;
	prototype.handleMouseEvent = originals.handleMouseEvent;
	originals = undefined;
	installed = false;
	armedSnapshot = undefined;
	popupRect = undefined;
	capturedTui = undefined;
	pendingReferences.clear();
}

export default function selectionManagerExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		activeCtx = ctx;
		installReferenceEditor(ctx);
		if (!installTableSelection()) {
			ctx.ui.notify("selection-manager: fullscreen selection internals not found; extension inactive", "warning");
		}
	});

	pi.on("session_shutdown", () => {
		activeCtx = undefined;
		uninstallTableSelection();
	});

	// Swap reference lines in the submitted prompt for the full selections.
	pi.on("input", async (event) => {
		if (pendingReferences.size === 0) return { action: "continue" };
		let text = event.text;
		let changed = false;
		for (const [referenceLine, fullText] of [...pendingReferences]) {
			if (!text.includes(referenceLine)) continue;
			text = text.split(referenceLine).join(`Referenced selection:\n"""\n${fullText}\n"""`);
			pendingReferences.delete(referenceLine);
			changed = true;
		}
		return changed ? { action: "transform", text } : { action: "continue" };
	});

	pi.registerCommand("selection-manager", {
		description: "Report whether Markdown-aware mouse selection is active",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				installed
					? "selection-manager: active (fullscreen selections copy as Markdown)"
					: "selection-manager: inactive (patch not installed)",
				installed ? "info" : "warning",
			);
		},
	});
}
