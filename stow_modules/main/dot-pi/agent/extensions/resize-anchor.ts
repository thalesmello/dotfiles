/**
 * resize-anchor.ts -- anchor the chat scroll position to the top visible line on terminal width resize.
 *
 * Why this exists
 * ---------------
 * In fullscreen mode (`TuiAltScreen`), pi's `ScrollView.prototype.updateLayout`
 * keeps `currentScrollTop` as a raw line index when `isFollowingEnd` is false:
 *
 *   this.currentScrollTop = Math.max(0, Math.min(this.currentScrollTop, maxScrollTop));
 *
 * When the terminal width changes, wrapped paragraphs, lists, blockquotes,
 * tables, and code blocks above `scrollTop` reflow to a different number of
 * physical lines, so the raw line index `scrollTop` points to a completely
 * different place in the conversation history.
 *
 * How this works
 * --------------
 * In `pi-tui`'s layout pass (`layoutComponent` for `node.type === "scroll"`):
 * 1. `scrollView.getContentWidth(safeWidth)` computes the inner content width.
 * 2. `scrollView.child.render(contentWidth)` renders the transcript container
 *    and populates `mouseLayout` on every `Container` and `Box` in the tree.
 * 3. `scrollView.updateLayout(contentHeight, viewportHeight, requestRender)`
 *    updates `scrollTop` BEFORE `translateBox` and `paintBox` slice the
 *    visible screen rows.
 *
 * This extension patches `Container.prototype.render`,
 * `ScrollView.prototype.getContentWidth`, and
 * `ScrollView.prototype.updateLayout` for the life of a TUI session:
 *
 * - On normal renders (same width), `Container.prototype.render` only records
 *   the rendered line array reference and width — O(1) with zero parsing.
 * - When the width changes while a `ScrollView` is scrolled into history
 *   (`!isFollowingEnd`), right before the child re-renders at the new width
 *   (while the old `mouseLayout`, `Markdown.blocks`, and rendered lines are
 *   still intact), the extension captures an anchor for the line at
 *   `scrollTop`:
 *     1. The leaf component (and `Markdown` block token index when available)
 *        and its top-level message/tool owner in the container tree.
 *     2. The non-empty content segment within that block and the exact
 *        non-whitespace character offset of the first character on the top
 *        visible line (which is invariant under greedy word wrapping), plus
 *        the line's leading text prefix (for right-truncated lines such as
 *        tool previews) and structural/blank-line offsets.
 * - Immediately afterward in `ScrollView.prototype.updateLayout`, the anchor
 *   is resolved against the newly rendered tree and lines, and
 *   `currentScrollTop` is updated in place before `translateBox` and
 *   `paintBox` run — so the screen, mouse hit-boxes, and scrollbar all paint
 *   at the anchored position in a single render pass.
 * - Across consecutive width changes without manual scrolling (e.g. dragging
 *   a window border or splitting and unsplitting a Herdr pane), the original
 *   anchor is retained so there is zero cumulative rounding drift and
 *   resizing back restores the exact original row.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, ScrollView, stripTerminalSequences } from "@earendil-works/pi-tui";

/** Layout entry recorded by pi-tui's `Container.render` and `Box.render`. */
export interface MouseLayoutChild {
	readonly component: unknown;
	readonly height: number;
}

/** Container-like node with `mouseLayout` from its last render pass. */
export interface ContainerLike {
	readonly mouseLayout?: {
		readonly width: number;
		readonly children: readonly MouseLayoutChild[];
	};
	readonly paddingY?: number;
	readonly bgFn?: unknown;
	readonly cachedLines?: readonly string[];
	readonly lines?: readonly string[];
	render?(width: number): string[];
}

interface MarkdownTokenLike {
	readonly type?: string;
	readonly raw?: string;
}

interface MarkdownBlockLike {
	readonly lines?: readonly string[];
}

interface MarkdownComponentLike {
	readonly paddingY?: number;
	readonly cachedLines?: readonly string[];
	readonly cachedTokens?: { deref?: () => { tokens?: readonly MarkdownTokenLike[] } | undefined };
	readonly blocks?: { deref?: () => Map<string, MarkdownBlockLike> | undefined };
}

/** Public and runtime-accessible `ScrollView` surface used by this extension. */
export interface ScrollViewLike {
	readonly child?: unknown;
	readonly followEnd: boolean;
	readonly primary: boolean;
	readonly scrollTop: number;
	readonly isFollowingEnd: boolean;
	readonly viewportHeight?: number;
	readonly contentHeight?: number;
	currentScrollTop?: number;
	followingEnd?: boolean;
	followSuppressedAtEnd?: boolean;
	getContentWidth?(width: number): number;
	updateLayout?(contentHeight: number, viewportHeight: number, requestRender: () => void): void;
}

/** A contiguous slice of rendered rows belonging to one leaf component or Markdown token. */
export interface LayoutBlock {
	readonly component: object;
	/**
	 * Sub-block index within `component`:
	 * - `0..N-1` for a Markdown component's token blocks when available
	 * - `-1` for a leaf component (or top padding)
	 * - `-2` for bottom padding of a Box or Markdown component
	 */
	readonly subIndex: number;
	/** Top-level transcript entry component (message, tool execution, spacer) that owns this block. */
	readonly owner: object;
	/** Starting row in the ScrollView's rendered lines. */
	readonly startRow: number;
	/** Height in rendered rows. */
	readonly height: number;
}

/** Character range and compact content of a single line inside a `LineSegment`. */
export interface SegmentRowRange {
	readonly start: number;
	readonly end: number;
	readonly compact: string;
}

/** A contiguous run of non-structural content lines inside a block. */
export interface LineSegment {
	readonly index: number;
	readonly startRow: number;
	readonly endRow: number;
	readonly height: number;
	readonly totalChars: number;
	readonly isTable: boolean;
	readonly rowCharRanges: readonly SegmentRowRange[];
}

/** Analyzed segments and per-row character ranges for a block's rendered lines. */
export interface AnalyzedBlockLines {
	readonly lineCount: number;
	readonly totalChars: number;
	readonly segments: readonly LineSegment[];
	readonly rowBlockCharRanges: ReadonlyArray<{
		readonly start: number;
		readonly end: number;
		readonly compact: string;
		readonly isStructural: boolean;
	}>;
}

/** Position of a target line within a single block's rendered lines. */
export type BlockLineAnchor =
	| {
			readonly kind: "start";
			readonly localRow: 0;
			readonly blockHeight: number;
	  }
	| {
			readonly kind: "proportional";
			readonly localRow: number;
			readonly blockHeight: number;
	  }
	| {
			readonly kind: "end";
			readonly localRow: number;
			readonly blockHeight: number;
			readonly rowsFromBlockEnd: number;
	  }
	| {
			readonly kind: "before-segment";
			readonly localRow: number;
			readonly blockHeight: number;
			readonly segmentIndex: number;
			readonly segmentCount: number;
			readonly rowsBeforeNextSegment: number;
			readonly blockCharOffset: number;
			readonly blockTotalChars: number;
			readonly linePrefix: string;
	  }
	| {
			readonly kind: "segment";
			readonly localRow: number;
			readonly blockHeight: number;
			readonly segmentIndex: number;
			readonly segmentCount: number;
			readonly segmentLocalRow: number;
			readonly segmentHeight: number;
			readonly segmentCharOffset: number;
			readonly segmentTotalChars: number;
			readonly blockCharOffset: number;
			readonly blockTotalChars: number;
			readonly linePrefix: string;
	  };

/** Complete anchor describing the line at `scrollTop` before a width resize. */
export interface ScrollAnchor {
	readonly component: object;
	readonly subIndex: number;
	readonly owner: object;
	readonly lineAnchor: BlockLineAnchor;
	readonly ownerLineAnchor: BlockLineAnchor;
	readonly documentLineAnchor: BlockLineAnchor;
	/**
	 * When `scrollTop` sits on a structural/spacer block with 0 content chars,
	 * records the first content block below `scrollTop` and the row distance to it.
	 */
	readonly nextContentBlock?: {
		readonly component: object;
		readonly subIndex: number;
		readonly owner: object;
		readonly rowsBefore: number;
	};
}

// ---------------------------------------------------------------------------
// Line normalization & block segment analysis
// ---------------------------------------------------------------------------

const STRUCTURAL_BORDER_LINE = /^[╭┌├╰└─═╴╶┬┴┼┐╮┤╯\s]+$/u;
const FRAMED_TOP_BORDER = /^╭─.*╮$/u;
const FRAMED_BOTTOM_BORDER = /^╰[─═\s]*╯$/u;
const CODE_FENCE_LINE = /^(?:`{3,}|~{3,})/u;
const COPY_BUTTON_SUFFIX = /\s*(?:⧉\s*copy|✓\s*copied|\[Copy\]|\[Copied!?\])\s*(?:│)?$/u;

function isTableBorderLine(trimmed: string): boolean {
	if (trimmed.length < 2 || !trimmed.includes("─")) return false;
	const first = trimmed[0]!;
	const last = trimmed[trimmed.length - 1]!;
	if (!((first === "┌" && last === "┐") || (first === "├" && last === "┤") || (first === "└" && last === "┘"))) {
		return false;
	}
	for (const ch of trimmed) {
		if (!"─┬┼┴┌├└┐┤┘".includes(ch)) return false;
	}
	return true;
}

function isStructuralTrimmedLine(trimmed: string): boolean {
	if (trimmed.length === 0) return true;
	if (isTableBorderLine(trimmed)) return true;
	if (STRUCTURAL_BORDER_LINE.test(trimmed)) return true;
	if (FRAMED_TOP_BORDER.test(trimmed)) return true;
	if (FRAMED_BOTTOM_BORDER.test(trimmed)) return true;
	if (CODE_FENCE_LINE.test(trimmed)) return true;
	return false;
}

/**
 * Analyze the rendered lines of a block into width-invariant content segments
 * and per-row non-whitespace character offsets.
 */
export function analyzeBlockLines(lines: readonly string[]): AnalyzedBlockLines {
	const plainTrimmed = lines.map((line) => stripTerminalSequences(line ?? "").trim());
	const hasTableBorders = plainTrimmed.some(isTableBorderLine);

	const rowBlockCharRanges: Array<{
		readonly start: number;
		readonly end: number;
		readonly compact: string;
		readonly isStructural: boolean;
		readonly isTableRow: boolean;
	}> = [];

	let blockChars = 0;
	for (let r = 0; r < plainTrimmed.length; r++) {
		const trimmed = plainTrimmed[r]!;
		if (isStructuralTrimmedLine(trimmed)) {
			rowBlockCharRanges.push({
				start: blockChars,
				end: blockChars,
				compact: "",
				isStructural: true,
				isTableRow: false,
			});
			continue;
		}

		let content = trimmed.replace(COPY_BUTTON_SUFFIX, "");
		let isTableRow = false;
		if (content.startsWith("│") && content.endsWith("│") && content.length >= 2) {
			const inner = content.slice(1, -1);
			if (hasTableBorders && inner.includes("│")) {
				isTableRow = true;
				content = inner.replace(/│/gu, " ").trim();
			} else {
				content = inner.trim();
			}
		} else if (content.startsWith("│")) {
			content = content.replace(/^(?:│\s*)+/u, "");
		}

		const compact = content.replace(/\s+/gu, "");
		if (compact.length === 0) {
			rowBlockCharRanges.push({
				start: blockChars,
				end: blockChars,
				compact: "",
				isStructural: true,
				isTableRow: false,
			});
			continue;
		}

		const start = blockChars;
		blockChars += compact.length;
		rowBlockCharRanges.push({
			start,
			end: blockChars,
			compact,
			isStructural: false,
			isTableRow,
		});
	}

	const segments: LineSegment[] = [];
	let row = 0;
	while (row < rowBlockCharRanges.length) {
		if (rowBlockCharRanges[row]!.isStructural) {
			row++;
			continue;
		}
		const startRow = row;
		let segChars = 0;
		let isTable = false;
		const rowCharRanges: SegmentRowRange[] = [];
		while (row < rowBlockCharRanges.length && !rowBlockCharRanges[row]!.isStructural) {
			const entry = rowBlockCharRanges[row]!;
			const start = segChars;
			segChars += entry.compact.length;
			if (entry.isTableRow) isTable = true;
			rowCharRanges.push({ start, end: segChars, compact: entry.compact });
			row++;
		}
		const endRow = row - 1;
		segments.push({
			index: segments.length,
			startRow,
			endRow,
			height: endRow - startRow + 1,
			totalChars: segChars,
			isTable,
			rowCharRanges,
		});
	}

	return {
		lineCount: lines.length,
		totalChars: blockChars,
		segments,
		rowBlockCharRanges,
	};
}

/**
 * Capture the position of `localRow` within a block's rendered lines.
 */
export function captureBlockLineAnchor(
	blockLines: readonly string[],
	localRow: number,
	explicitHeight?: number,
): BlockLineAnchor {
	const blockHeight = Math.max(1, explicitHeight ?? blockLines.length);
	const clampedRow = Math.max(0, Math.min(blockHeight - 1, Math.trunc(localRow)));
	if (clampedRow === 0) {
		return { kind: "start", localRow: 0, blockHeight };
	}
	if (blockLines.length === 0 || clampedRow >= blockLines.length) {
		return { kind: "proportional", localRow: clampedRow, blockHeight };
	}

	const analyzed = analyzeBlockLines(blockLines);
	if (analyzed.segments.length === 0) {
		return { kind: "proportional", localRow: clampedRow, blockHeight: blockLines.length };
	}

	for (const seg of analyzed.segments) {
		if (clampedRow >= seg.startRow && clampedRow <= seg.endRow) {
			const segmentLocalRow = clampedRow - seg.startRow;
			const range = seg.rowCharRanges[segmentLocalRow]!;
			const blockRange = analyzed.rowBlockCharRanges[clampedRow]!;
			return {
				kind: "segment",
				localRow: clampedRow,
				blockHeight: blockLines.length,
				segmentIndex: seg.index,
				segmentCount: analyzed.segments.length,
				segmentLocalRow,
				segmentHeight: seg.height,
				segmentCharOffset: range.start,
				segmentTotalChars: seg.totalChars,
				blockCharOffset: blockRange.start,
				blockTotalChars: analyzed.totalChars,
				linePrefix: range.compact.slice(0, 24),
			};
		}
	}

	// `clampedRow` sits on a blank or structural line. Find the next content segment after it.
	const nextSeg = analyzed.segments.find((seg) => seg.startRow > clampedRow);
	if (nextSeg) {
		const nextBlockRange = analyzed.rowBlockCharRanges[nextSeg.startRow]!;
		return {
			kind: "before-segment",
			localRow: clampedRow,
			blockHeight: blockLines.length,
			segmentIndex: nextSeg.index,
			segmentCount: analyzed.segments.length,
			rowsBeforeNextSegment: nextSeg.startRow - clampedRow,
			blockCharOffset: nextBlockRange.start,
			blockTotalChars: analyzed.totalChars,
			linePrefix: nextSeg.rowCharRanges[0]?.compact.slice(0, 24) ?? "",
		};
	}

	return {
		kind: "end",
		localRow: clampedRow,
		blockHeight: blockLines.length,
		rowsFromBlockEnd: Math.max(1, blockLines.length - clampedRow),
	};
}

function findRowByCharOffset(
	ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>,
	targetChar: number,
): number {
	if (ranges.length === 0) return 0;
	const clamped = Math.max(0, targetChar);
	for (let r = 0; r < ranges.length; r++) {
		const range = ranges[r]!;
		if (clamped >= range.start && clamped < range.end) {
			return r;
		}
	}
	// If targetChar lands on a structural line or at the very end, return the nearest row at or after targetChar.
	for (let r = 0; r < ranges.length; r++) {
		if (ranges[r]!.end > clamped) return r;
	}
	return ranges.length - 1;
}

function findRowByPrefix(
	rows: ReadonlyArray<{ readonly compact: string }>,
	prefix: string,
	expectedRow: number,
): number | undefined {
	if (prefix.length < 4) return undefined;
	const probe = prefix.slice(0, Math.min(prefix.length, 16));
	let bestRow: number | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let r = 0; r < rows.length; r++) {
		const compact = rows[r]!.compact;
		if (!compact) continue;
		const matches =
			compact.startsWith(probe) ||
			(compact.length >= 6 && probe.startsWith(compact)) ||
			(probe.length >= 8 && compact.includes(probe));
		if (!matches) continue;
		const distance = Math.abs(r - expectedRow);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestRow = r;
		}
	}
	return bestRow;
}

/**
 * Resolve a `BlockLineAnchor` against a block's newly rendered lines at the new width.
 */
export function resolveBlockLineAnchor(
	newBlockLines: readonly string[],
	anchor: BlockLineAnchor,
	explicitNewHeight?: number,
): number {
	const newHeight = Math.max(1, explicitNewHeight ?? newBlockLines.length);
	if (newHeight <= 1 || anchor.localRow <= 0 || anchor.kind === "start") {
		return 0;
	}
	const proportionalFallback = (): number =>
		Math.max(0, Math.min(newHeight - 1, Math.floor((anchor.localRow * newHeight) / Math.max(1, anchor.blockHeight))));

	if (newBlockLines.length === 0 || anchor.kind === "proportional") {
		return proportionalFallback();
	}

	if (anchor.kind === "end") {
		return Math.max(0, Math.min(newBlockLines.length - 1, newBlockLines.length - anchor.rowsFromBlockEnd));
	}

	const analyzed = analyzeBlockLines(newBlockLines);
	if (analyzed.segments.length === 0) {
		return proportionalFallback();
	}

	if (anchor.kind === "before-segment") {
		if (analyzed.segments.length === anchor.segmentCount && anchor.segmentIndex < analyzed.segments.length) {
			const targetSeg = analyzed.segments[anchor.segmentIndex]!;
			const prevEnd = anchor.segmentIndex > 0 ? analyzed.segments[anchor.segmentIndex - 1]!.endRow : -1;
			const availableGap = Math.max(1, targetSeg.startRow - (prevEnd + 1));
			return Math.max(0, targetSeg.startRow - Math.min(anchor.rowsBeforeNextSegment, availableGap));
		}
		if (analyzed.totalChars > 0 && anchor.blockTotalChars > 0) {
			const scaledChar = Math.min(
				analyzed.totalChars - 1,
				Math.round((anchor.blockCharOffset / anchor.blockTotalChars) * analyzed.totalChars),
			);
			const nextRow = findRowByCharOffset(analyzed.rowBlockCharRanges, scaledChar);
			return Math.max(0, nextRow - anchor.rowsBeforeNextSegment);
		}
		return proportionalFallback();
	}

	// `anchor.kind === "segment"`
	if (analyzed.segments.length === anchor.segmentCount && anchor.segmentIndex < analyzed.segments.length) {
		const seg = analyzed.segments[anchor.segmentIndex]!;
		if (anchor.segmentLocalRow <= 0 || seg.height <= 1) {
			return seg.startRow;
		}
		if (seg.isTable) {
			const subRow = Math.min(
				seg.height - 1,
				Math.floor((anchor.segmentLocalRow * seg.height) / Math.max(1, anchor.segmentHeight)),
			);
			return seg.startRow + subRow;
		}

		const charDiff = Math.abs(seg.totalChars - anchor.segmentTotalChars);
		const charTolerance = Math.max(4, Math.ceil(anchor.segmentTotalChars * 0.08));
		if (seg.totalChars > 0 && anchor.segmentTotalChars > 0 && charDiff <= charTolerance) {
			const targetChar =
				seg.totalChars === anchor.segmentTotalChars
					? anchor.segmentCharOffset
					: Math.min(
							seg.totalChars - 1,
							Math.round((anchor.segmentCharOffset / anchor.segmentTotalChars) * seg.totalChars),
						);
			const localIdx = findRowByCharOffset(seg.rowCharRanges, targetChar);
			return seg.startRow + localIdx;
		}

		// Truncated or width-adapted segment (e.g. tool output lines truncated with `…`):
		if (seg.height === anchor.segmentHeight) {
			return seg.startRow + Math.min(seg.height - 1, anchor.segmentLocalRow);
		}
		const expectedInSeg = Math.floor((anchor.segmentLocalRow * seg.height) / Math.max(1, anchor.segmentHeight));
		const prefixMatch = findRowByPrefix(seg.rowCharRanges, anchor.linePrefix, expectedInSeg);
		if (prefixMatch !== undefined) {
			return seg.startRow + prefixMatch;
		}
		return seg.startRow + Math.min(seg.height - 1, expectedInSeg);
	}

	// Segment count changed (e.g., component layout changed or owner/document-level resolution):
	const expectedRow = proportionalFallback();
	const prefixRow = findRowByPrefix(analyzed.rowBlockCharRanges, anchor.linePrefix, expectedRow);
	if (prefixRow !== undefined) {
		return prefixRow;
	}
	if (analyzed.totalChars > 0 && anchor.blockTotalChars > 0) {
		const charDiff = Math.abs(analyzed.totalChars - anchor.blockTotalChars);
		if (charDiff <= Math.max(8, Math.ceil(anchor.blockTotalChars * 0.15))) {
			const targetChar =
				analyzed.totalChars === anchor.blockTotalChars
					? anchor.blockCharOffset
					: Math.min(
							analyzed.totalChars - 1,
							Math.round((anchor.blockCharOffset / anchor.blockTotalChars) * analyzed.totalChars),
						);
			return findRowByCharOffset(analyzed.rowBlockCharRanges, targetChar);
		}
	}
	return expectedRow;
}

// ---------------------------------------------------------------------------
// Component tree layout decomposition
// ---------------------------------------------------------------------------

function isPlainGroupingContainer(node: object, depth: number): boolean {
	if (depth === 0) return true;
	if (depth > 1) return false;
	const ctorName = (node as { constructor?: { name?: string } }).constructor?.name;
	if (ctorName && ctorName !== "Container") return false;
	const candidate = node as Record<string, unknown>;
	if ("role" in candidate || "text" in candidate || "lastMessage" in candidate || "toolName" in candidate) {
		return false;
	}
	return Array.isArray((node as ContainerLike).mouseLayout?.children);
}

/**
 * Decompose a rendered transcript container tree into an ordered list of leaf
 * `LayoutBlock`s with their exact row ranges.
 */
export function buildLayoutBlocks(root: unknown, totalHeight?: number): LayoutBlock[] {
	if (!root || typeof root !== "object") return [];
	const blocks: LayoutBlock[] = [];

	const visit = (node: object, startRow: number, height: number, owner: object | undefined, depth: number): void => {
		if (height <= 0) return;
		const effectiveOwner = isPlainGroupingContainer(node, depth) ? owner : (owner ?? node);

		// Unwrap MouseRegion wrappers (`{ child, onMouse }`).
		const maybeRegion = node as { child?: unknown; onMouse?: unknown; mouseLayout?: unknown };
		if (
			"onMouse" in maybeRegion &&
			maybeRegion.child &&
			typeof maybeRegion.child === "object" &&
			!Array.isArray((maybeRegion as ContainerLike).mouseLayout?.children)
		) {
			visit(maybeRegion.child as object, startRow, height, effectiveOwner ?? node, depth + 1);
			return;
		}

		// Decompose Markdown components into their individual block tokens when token blocks match height.
		const md = node as MarkdownComponentLike;
		const tokens = md.cachedTokens?.deref?.()?.tokens;
		const blockMap = md.blocks?.deref?.();
		if (Array.isArray(tokens) && blockMap instanceof Map && tokens.length > 0) {
			const padY = Math.max(0, Math.trunc(Number(md.paddingY) || 0));
			let sum = padY * 2;
			const tokenHeights: number[] = [];
			let valid = true;
			for (const token of tokens) {
				const block = token && typeof token.raw === "string" ? blockMap.get(token.raw) : undefined;
				if (!block || !Array.isArray(block.lines)) {
					valid = false;
					break;
				}
				tokenHeights.push(block.lines.length);
				sum += block.lines.length;
			}
			if (valid && sum === height) {
				let cursor = startRow;
				const resolvedOwner = effectiveOwner ?? node;
				if (padY > 0) {
					blocks.push({ component: node, subIndex: -1, owner: resolvedOwner, startRow: cursor, height: padY });
					cursor += padY;
				}
				for (let i = 0; i < tokenHeights.length; i++) {
					const h = tokenHeights[i]!;
					if (h > 0) {
						blocks.push({ component: node, subIndex: i, owner: resolvedOwner, startRow: cursor, height: h });
						cursor += h;
					}
				}
				if (padY > 0) {
					blocks.push({ component: node, subIndex: -2, owner: resolvedOwner, startRow: cursor, height: padY });
				}
				return;
			}
		}

		// Decompose Container and Box nodes using their `mouseLayout.children`.
		const container = node as ContainerLike;
		const children = container.mouseLayout?.children;
		if (Array.isArray(children) && children.length > 0) {
			const isBox =
				typeof container.paddingY === "number" &&
				("bgFn" in container || (node as { constructor?: { name?: string } }).constructor?.name === "Box");
			const padY = isBox ? Math.max(0, Math.trunc(container.paddingY ?? 0)) : 0;
			let childrenHeight = 0;
			for (const entry of children) {
				childrenHeight += Number.isFinite(entry?.height) ? Math.max(0, Math.trunc(entry.height)) : 0;
			}
			if (depth === 0 || childrenHeight + padY * 2 === height) {
				let cursor = startRow;
				const resolvedOwner = effectiveOwner ?? node;
				if (padY > 0) {
					blocks.push({ component: node, subIndex: -1, owner: resolvedOwner, startRow: cursor, height: padY });
					cursor += padY;
				}
				for (const entry of children) {
					const h = Number.isFinite(entry?.height) ? Math.max(0, Math.trunc(entry.height)) : 0;
					if (h <= 0) continue;
					if (entry?.component && typeof entry.component === "object") {
						visit(entry.component as object, cursor, h, effectiveOwner, depth + 1);
					} else {
						blocks.push({ component: node, subIndex: -1, owner: resolvedOwner, startRow: cursor, height: h });
					}
					cursor += h;
				}
				if (padY > 0) {
					blocks.push({ component: node, subIndex: -2, owner: resolvedOwner, startRow: cursor, height: padY });
				}
				return;
			}
		}

		blocks.push({
			component: node,
			subIndex: -1,
			owner: effectiveOwner ?? node,
			startRow,
			height,
		});
	};

	const rootChildren = (root as ContainerLike).mouseLayout?.children;
	let inferredHeight = totalHeight;
	if ((inferredHeight === undefined || inferredHeight <= 0) && Array.isArray(rootChildren)) {
		inferredHeight = rootChildren.reduce(
			(sum, entry) => sum + (Number.isFinite(entry?.height) ? Math.max(0, Math.trunc(entry.height)) : 0),
			0,
		);
	}
	visit(root as object, 0, Math.max(0, Math.trunc(inferredHeight ?? 0)), undefined, 0);
	return blocks;
}

function getBlockLines(block: LayoutBlock, documentLines: readonly string[]): readonly string[] {
	if (documentLines.length >= block.startRow + block.height) {
		return documentLines.slice(block.startRow, block.startRow + block.height);
	}
	const comp = block.component as ContainerLike & MarkdownComponentLike;
	if (block.subIndex >= 0) {
		const tokens = comp.cachedTokens?.deref?.()?.tokens;
		const blockMap = comp.blocks?.deref?.();
		const raw = tokens?.[block.subIndex]?.raw;
		const tokenLines = raw !== undefined ? blockMap?.get(raw)?.lines : undefined;
		if (Array.isArray(tokenLines) && tokenLines.length === block.height) {
			return tokenLines;
		}
	}
	if (Array.isArray(comp.cachedLines) && comp.cachedLines.length === block.height) {
		return comp.cachedLines;
	}
	if (Array.isArray(comp.lines) && comp.lines.length === block.height) {
		return comp.lines;
	}
	return [];
}

function getOwnerBounds(blocks: readonly LayoutBlock[], owner: object): { startRow: number; height: number } | undefined {
	let startRow = Number.POSITIVE_INFINITY;
	let endRow = 0;
	for (const b of blocks) {
		if (b.owner !== owner) continue;
		if (b.startRow < startRow) startRow = b.startRow;
		if (b.startRow + b.height > endRow) endRow = b.startRow + b.height;
	}
	if (!Number.isFinite(startRow) || endRow <= startRow) return undefined;
	return { startRow, height: endRow - startRow };
}

function isBlockContentEmpty(block: LayoutBlock, documentLines: readonly string[]): boolean {
	const lines = getBlockLines(block, documentLines);
	if (lines.length === 0) {
		const ctorName = (block.component as { constructor?: { name?: string } }).constructor?.name;
		return ctorName === "Spacer" || ctorName === "DynamicBorder" || block.subIndex < -1;
	}
	return analyzeBlockLines(lines).totalChars === 0;
}

/**
 * Capture a `ScrollAnchor` for `scrollTop` from a rendered container tree and its lines.
 */
export function captureScrollAnchor(
	root: unknown,
	documentLines: readonly string[],
	totalHeight: number,
	scrollTop: number,
): ScrollAnchor | undefined {
	const height = Math.max(documentLines.length, Math.max(0, Math.trunc(totalHeight)));
	if (height <= 0) return undefined;
	const blocks = buildLayoutBlocks(root, height);
	return captureScrollAnchorFromBlocks(blocks, documentLines, height, scrollTop);
}

export function captureScrollAnchorFromBlocks(
	blocks: readonly LayoutBlock[],
	documentLines: readonly string[],
	totalHeight: number,
	scrollTop: number,
): ScrollAnchor | undefined {
	const height = Math.max(documentLines.length, Math.max(0, Math.trunc(totalHeight)));
	if (height <= 0 || blocks.length === 0) return undefined;
	const clampedTop = Math.max(0, Math.min(height - 1, Math.trunc(scrollTop)));

	const blockIndex = blocks.findIndex((b) => clampedTop >= b.startRow && clampedTop < b.startRow + b.height);
	const block = blockIndex >= 0 ? blocks[blockIndex]! : blocks[blocks.length - 1]!;
	const localRow = Math.max(0, Math.min(block.height - 1, clampedTop - block.startRow));
	const blockLines = getBlockLines(block, documentLines);
	const lineAnchor = captureBlockLineAnchor(blockLines, localRow, block.height);

	const ownerBounds = getOwnerBounds(blocks, block.owner) ?? { startRow: block.startRow, height: block.height };
	const ownerLocalRow = Math.max(0, Math.min(ownerBounds.height - 1, clampedTop - ownerBounds.startRow));
	const ownerLines =
		documentLines.length >= ownerBounds.startRow + ownerBounds.height
			? documentLines.slice(ownerBounds.startRow, ownerBounds.startRow + ownerBounds.height)
			: [];
	const ownerLineAnchor = captureBlockLineAnchor(ownerLines, ownerLocalRow, ownerBounds.height);
	const documentLineAnchor = captureBlockLineAnchor(documentLines, clampedTop, height);

	let nextContentBlock: ScrollAnchor["nextContentBlock"];
	if (isBlockContentEmpty(block, documentLines)) {
		const startIdx = blockIndex >= 0 ? blockIndex + 1 : blocks.length;
		for (let i = startIdx; i < blocks.length; i++) {
			const candidate = blocks[i]!;
			if (!isBlockContentEmpty(candidate, documentLines)) {
				nextContentBlock = {
					component: candidate.component,
					subIndex: candidate.subIndex,
					owner: candidate.owner,
					rowsBefore: Math.max(1, candidate.startRow - clampedTop),
				};
				break;
			}
		}
	}

	return {
		component: block.component,
		subIndex: block.subIndex,
		owner: block.owner,
		lineAnchor,
		ownerLineAnchor,
		documentLineAnchor,
		...(nextContentBlock === undefined ? {} : { nextContentBlock }),
	};
}

/**
 * Resolve a previously captured `ScrollAnchor` against the newly rendered
 * container tree and lines after a terminal width change.
 */
export function resolveScrollAnchor(
	root: unknown,
	newDocumentLines: readonly string[],
	newTotalHeight: number,
	anchor: ScrollAnchor,
): number {
	const height = Math.max(newDocumentLines.length, Math.max(0, Math.trunc(newTotalHeight)));
	if (height <= 1) return 0;
	const newBlocks = buildLayoutBlocks(root, height);
	return resolveScrollAnchorFromBlocks(newBlocks, newDocumentLines, height, anchor);
}

export function resolveScrollAnchorFromBlocks(
	newBlocks: readonly LayoutBlock[],
	newDocumentLines: readonly string[],
	newTotalHeight: number,
	anchor: ScrollAnchor,
): number {
	const height = Math.max(newDocumentLines.length, Math.max(0, Math.trunc(newTotalHeight)));
	if (height <= 1) return 0;

	// 1. Exact leaf component + subIndex match.
	const exactBlock = newBlocks.find(
		(b) => b.component === anchor.component && b.subIndex === anchor.subIndex && b.height > 0,
	);
	if (exactBlock) {
		const newBlockLines = getBlockLines(exactBlock, newDocumentLines);
		const localRow = resolveBlockLineAnchor(newBlockLines, anchor.lineAnchor, exactBlock.height);
		return Math.max(0, Math.min(height - 1, exactBlock.startRow + localRow));
	}

	// 2. If the anchored block was a spacer/border that got replaced, anchor relative to the next content block.
	if (anchor.nextContentBlock) {
		const nextTarget = anchor.nextContentBlock;
		const nextMatch =
			newBlocks.find((b) => b.component === nextTarget.component && b.subIndex === nextTarget.subIndex && b.height > 0) ??
			newBlocks.find((b) => b.owner === nextTarget.owner && b.height > 0);
		if (nextMatch) {
			return Math.max(0, Math.min(height - 1, nextMatch.startRow - nextTarget.rowsBefore));
		}
	}

	// 3. Same leaf component (e.g. Markdown fell back from per-token blocks to single component block).
	const componentBounds = getOwnerBounds(
		newBlocks.filter((b) => b.component === anchor.component),
		anchor.owner,
	);
	if (componentBounds) {
		const compLines =
			newDocumentLines.length >= componentBounds.startRow + componentBounds.height
				? newDocumentLines.slice(componentBounds.startRow, componentBounds.startRow + componentBounds.height)
				: [];
		const localRow = resolveBlockLineAnchor(compLines, anchor.lineAnchor, componentBounds.height);
		return Math.max(0, Math.min(height - 1, componentBounds.startRow + localRow));
	}

	// 4. Same top-level message/tool owner component (e.g. a tool card replaced its inner leaf on update).
	const ownerBounds = getOwnerBounds(newBlocks, anchor.owner);
	if (ownerBounds) {
		const ownerLines =
			newDocumentLines.length >= ownerBounds.startRow + ownerBounds.height
				? newDocumentLines.slice(ownerBounds.startRow, ownerBounds.startRow + ownerBounds.height)
				: [];
		const localRow = resolveBlockLineAnchor(ownerLines, anchor.ownerLineAnchor, ownerBounds.height);
		return Math.max(0, Math.min(height - 1, ownerBounds.startRow + localRow));
	}

	// 5. Document-wide fallback.
	return resolveBlockLineAnchor(newDocumentLines, anchor.documentLineAnchor, height);
}

// ---------------------------------------------------------------------------
// Prototype patch state & lifecycle
// ---------------------------------------------------------------------------

interface ViewState {
	lastWidth?: number;
	lastLines?: readonly string[];
	lastBlocks?: readonly LayoutBlock[];
	lastContentHeight?: number;
	activeAnchor?: ScrollAnchor;
	lastAnchoredScrollTop?: number;
	lastAnchoredLine?: string;
	pendingResizeWidth?: number;
	customChildWrapped?: boolean;
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

type ContainerRenderFn = (this: ContainerLike, width: number) => string[];
type GetContentWidthFn = (this: ScrollViewLike, width: number) => number;
type UpdateLayoutFn = (
	this: ScrollViewLike,
	contentHeight: number,
	viewportHeight: number,
	requestRender: () => void,
) => void;

interface ContainerPrototype {
	render?: ContainerRenderFn;
}

interface ScrollViewPrototype {
	getContentWidth?: GetContentWidthFn;
	updateLayout?: UpdateLayoutFn;
}

let installed = false;
let originalContainerRender: ContainerRenderFn | undefined;
let originalGetContentWidth: GetContentWidthFn | undefined;
let originalUpdateLayout: UpdateLayoutFn | undefined;

let viewStates = new WeakMap<ScrollViewLike, ViewState>();
let childToView = new WeakMap<object, WeakRef<ScrollViewLike>>();

function getViewState(view: ScrollViewLike): ViewState {
	let state = viewStates.get(view);
	if (!state) {
		state = {};
		viewStates.set(view, state);
	}
	return state;
}

function getContainerLayoutWidth(child: unknown): number | undefined {
	if (!child || typeof child !== "object") return undefined;
	const width = (child as ContainerLike).mouseLayout?.width;
	return typeof width === "number" && Number.isFinite(width) && width > 0 ? width : undefined;
}

function isAnchorStillValidAtCurrentScroll(
	view: ScrollViewLike,
	state: ViewState,
	currentLines?: readonly string[],
): boolean {
	if (!state.activeAnchor || state.lastAnchoredScrollTop === undefined) return false;
	if (view.isFollowingEnd || view.scrollTop !== state.lastAnchoredScrollTop) return false;
	if (state.lastAnchoredLine !== undefined && currentLines && currentLines.length > view.scrollTop) {
		if (currentLines[view.scrollTop] !== state.lastAnchoredLine) return false;
	}
	return true;
}

function onBeforeChildWidthChange(
	view: ScrollViewLike,
	state: ViewState,
	child: object,
	nextWidth: number,
): void {
	if (view.isFollowingEnd) {
		state.activeAnchor = undefined;
		state.lastAnchoredScrollTop = undefined;
		state.lastAnchoredLine = undefined;
		state.pendingResizeWidth = undefined;
		return;
	}
	if (!isAnchorStillValidAtCurrentScroll(view, state, state.lastLines)) {
		if (view.scrollTop <= 0) {
			state.activeAnchor = undefined;
			state.lastAnchoredScrollTop = undefined;
			state.lastAnchoredLine = undefined;
			state.pendingResizeWidth = undefined;
			return;
		}
		const prevLines = state.lastLines ?? [];
		const prevHeight = prevLines.length > 0 ? prevLines.length : (state.lastContentHeight ?? view.contentHeight ?? 0);
		state.activeAnchor = captureScrollAnchor(child, prevLines, prevHeight, view.scrollTop);
	}
	state.pendingResizeWidth = state.activeAnchor ? nextWidth : undefined;
}

function onAfterChildRender(
	view: ScrollViewLike,
	state: ViewState,
	width: number,
	lines: readonly string[],
): void {
	if (state.pendingResizeWidth === undefined && state.activeAnchor !== undefined) {
		if (!isAnchorStillValidAtCurrentScroll(view, state, lines)) {
			state.activeAnchor = undefined;
			state.lastAnchoredScrollTop = undefined;
			state.lastAnchoredLine = undefined;
		}
	}
	state.lastWidth = width;
	state.lastLines = lines;
}

function registerScrollViewChild(view: ScrollViewLike, state: ViewState): void {
	const child = view.child;
	if (!child || typeof child !== "object") return;
	childToView.set(child, new WeakRef(view));

	// `Container` instances (like pi's `documentContainer`) go through
	// `Container.prototype.render`, which keeps own `.render` wrappers (such
	// as `zen-column.ts`) untouched. Non-Container custom children with their
	// own `.render` method are wrapped directly on first registration.
	if (state.customChildWrapped || child instanceof Container) return;
	const renderable = child as ContainerLike;
	if (typeof renderable.render !== "function") return;
	state.customChildWrapped = true;
	const origChildRender = renderable.render;
	renderable.render = function patchedCustomChildRender(this: ContainerLike, width: number): string[] {
		if (installed) {
			const previousWidth = state.lastWidth ?? getContainerLayoutWidth(this);
			if (previousWidth !== undefined && width !== previousWidth) {
				onBeforeChildWidthChange(view, state, this, width);
			}
		}
		const lines = origChildRender.call(this, width);
		if (installed) {
			onAfterChildRender(view, state, width, lines);
		}
		return lines;
	};
}

function patchedContainerRender(this: ContainerLike, width: number): string[] {
	const view = installed ? childToView.get(this)?.deref() : undefined;
	if (!view) {
		return originalContainerRender!.call(this, width);
	}
	const state = getViewState(view);
	const previousWidth = state.lastWidth ?? getContainerLayoutWidth(this);
	if (previousWidth !== undefined && width !== previousWidth) {
		onBeforeChildWidthChange(view, state, this, width);
	}
	const lines = originalContainerRender!.call(this, width);
	onAfterChildRender(view, state, width, lines);
	return lines;
}

function patchedGetContentWidth(this: ScrollViewLike, width: number): number {
	if (installed) {
		const state = getViewState(this);
		registerScrollViewChild(this, state);
	}
	return originalGetContentWidth!.call(this, width);
}

function applyAnchoredScrollTop(
	view: ScrollViewLike,
	contentHeight: number,
	viewportHeight: number,
	targetScrollTop: number,
	runOriginalUpdateLayout: () => void,
): void {
	const clampedContent = Math.max(0, Math.floor(contentHeight));
	const clampedViewport = Math.max(0, Math.floor(viewportHeight));
	const maxScrollTop = Math.max(0, clampedContent - clampedViewport);
	const nextScrollTop = Math.max(0, Math.min(maxScrollTop, Math.trunc(targetScrollTop)));

	if (typeof view.currentScrollTop === "number") {
		view.currentScrollTop = nextScrollTop;
	} else {
		try {
			(view as { scrollTop: number }).scrollTop = nextScrollTop;
		} catch {
			// Getter-only fallback handled after originalUpdateLayout.
		}
	}
	if (nextScrollTop >= maxScrollTop && "followSuppressedAtEnd" in view) {
		view.followSuppressedAtEnd = true;
	}

	runOriginalUpdateLayout();

	// Ensure minimal ScrollView test doubles without `followSuppressedAtEnd`
	// keep the non-following state and exact clamped scrollTop on width resize.
	if (typeof view.currentScrollTop === "number" && view.currentScrollTop !== nextScrollTop) {
		view.currentScrollTop = nextScrollTop;
	}
	if (typeof view.followingEnd === "boolean" && view.followingEnd) {
		view.followingEnd = false;
	}
}

function patchedUpdateLayout(
	this: ScrollViewLike,
	contentHeight: number,
	viewportHeight: number,
	requestRender: () => void,
): void {
	if (!installed) {
		originalUpdateLayout!.call(this, contentHeight, viewportHeight, requestRender);
		return;
	}

	const state = getViewState(this);
	registerScrollViewChild(this, state);

	const explicitWidth = getContainerLayoutWidth(this.child);
	const hasRenderFn = typeof (this.child as ContainerLike | undefined)?.render === "function";

	// Support callers / tests that mutate `child.mouseLayout.width` and call
	// `updateLayout` directly without invoking `child.render(width)`.
	if (
		!hasRenderFn &&
		state.pendingResizeWidth === undefined &&
		explicitWidth !== undefined &&
		state.lastWidth !== undefined &&
		explicitWidth !== state.lastWidth
	) {
		if (this.isFollowingEnd) {
			state.activeAnchor = undefined;
			state.lastAnchoredScrollTop = undefined;
			state.lastAnchoredLine = undefined;
		} else {
			if (!isAnchorStillValidAtCurrentScroll(this, state, state.lastLines)) {
				if (this.scrollTop > 0 && state.lastBlocks && state.lastBlocks.length > 0) {
					state.activeAnchor = captureScrollAnchorFromBlocks(
						state.lastBlocks,
						state.lastLines ?? [],
						state.lastContentHeight ?? 0,
						this.scrollTop,
					);
				} else {
					state.activeAnchor = undefined;
					state.lastAnchoredScrollTop = undefined;
					state.lastAnchoredLine = undefined;
				}
			}
			if (state.activeAnchor) {
				state.pendingResizeWidth = explicitWidth;
			}
		}
	}

	if (state.pendingResizeWidth !== undefined && state.activeAnchor !== undefined && !this.isFollowingEnd) {
		const targetScrollTop = resolveScrollAnchor(
			this.child,
			state.lastLines ?? [],
			contentHeight,
			state.activeAnchor,
		);
		applyAnchoredScrollTop(this, contentHeight, viewportHeight, targetScrollTop, () => {
			originalUpdateLayout!.call(this, contentHeight, viewportHeight, requestRender);
		});
		state.lastAnchoredScrollTop = this.scrollTop;
		state.lastAnchoredLine = state.lastLines?.[this.scrollTop];
		state.pendingResizeWidth = undefined;
	} else {
		const wasAtAnchoredTop = isAnchorStillValidAtCurrentScroll(this, state, state.lastLines);
		originalUpdateLayout!.call(this, contentHeight, viewportHeight, requestRender);
		if (wasAtAnchoredTop && !this.isFollowingEnd) {
			state.lastAnchoredScrollTop = this.scrollTop;
			state.lastAnchoredLine = state.lastLines?.[this.scrollTop];
		} else {
			state.activeAnchor = undefined;
			state.lastAnchoredScrollTop = undefined;
			state.lastAnchoredLine = undefined;
		}
		state.pendingResizeWidth = undefined;
	}

	const normalizedHeight = Math.max(0, Math.floor(contentHeight));
	state.lastContentHeight = normalizedHeight;
	if (!hasRenderFn) {
		if (explicitWidth !== undefined) state.lastWidth = explicitWidth;
		const childLines = (this.child as ContainerLike | undefined)?.lines;
		if (Array.isArray(childLines)) state.lastLines = childLines;
		state.lastBlocks = buildLayoutBlocks(this.child, normalizedHeight);
	}
}

function installResizeAnchor(): boolean {
	if (installed) return true;
	const scrollPrototype = ScrollView.prototype as unknown as ScrollViewPrototype;
	const containerPrototype = Container.prototype as unknown as ContainerPrototype;
	if (typeof scrollPrototype.updateLayout !== "function") return false;

	originalUpdateLayout = scrollPrototype.updateLayout;
	(patchedUpdateLayout as UpdateLayoutFn & ChainedPatch<UpdateLayoutFn>).__inactive = false;
	(patchedUpdateLayout as UpdateLayoutFn & ChainedPatch<UpdateLayoutFn>).__prev = originalUpdateLayout;
	scrollPrototype.updateLayout = patchedUpdateLayout;

	if (typeof scrollPrototype.getContentWidth === "function") {
		originalGetContentWidth = scrollPrototype.getContentWidth;
		(patchedGetContentWidth as GetContentWidthFn & ChainedPatch<GetContentWidthFn>).__inactive = false;
		(patchedGetContentWidth as GetContentWidthFn & ChainedPatch<GetContentWidthFn>).__prev = originalGetContentWidth;
		scrollPrototype.getContentWidth = patchedGetContentWidth;
	}

	if (typeof containerPrototype.render === "function") {
		originalContainerRender = containerPrototype.render;
		(patchedContainerRender as ContainerRenderFn & ChainedPatch<ContainerRenderFn>).__inactive = false;
		(patchedContainerRender as ContainerRenderFn & ChainedPatch<ContainerRenderFn>).__prev = originalContainerRender;
		containerPrototype.render = patchedContainerRender;
	}

	installed = true;
	return true;
}

function uninstallResizeAnchor(): void {
	if (installed && originalUpdateLayout) {
		(patchedUpdateLayout as UpdateLayoutFn & ChainedPatch<UpdateLayoutFn>).__inactive = true;
		const scrollPrototype = ScrollView.prototype as unknown as ScrollViewPrototype;
		scrollPrototype.updateLayout = unwrapPrototypeChain(scrollPrototype.updateLayout);
	}
	if (installed && originalGetContentWidth) {
		(patchedGetContentWidth as GetContentWidthFn & ChainedPatch<GetContentWidthFn>).__inactive = true;
		const scrollPrototype = ScrollView.prototype as unknown as ScrollViewPrototype;
		scrollPrototype.getContentWidth = unwrapPrototypeChain(scrollPrototype.getContentWidth);
	}
	if (installed && originalContainerRender) {
		(patchedContainerRender as ContainerRenderFn & ChainedPatch<ContainerRenderFn>).__inactive = true;
		const containerPrototype = Container.prototype as unknown as ContainerPrototype;
		containerPrototype.render = unwrapPrototypeChain(containerPrototype.render);
	}
	installed = false;
	viewStates = new WeakMap();
	childToView = new WeakMap();
}

export default function resizeAnchorExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (!installResizeAnchor()) {
			ctx.ui.notify("resize-anchor: transcript scroll internals not found; extension inactive", "warning");
		}
	});

	pi.on("session_shutdown", () => {
		uninstallResizeAnchor();
	});

	pi.registerCommand("resize-anchor", {
		description: "Report whether terminal width resize scroll anchoring is active",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				installed
					? "resize-anchor: active (chat history stays anchored to the top visible line on width resize)"
					: "resize-anchor: inactive (patch not installed)",
				installed ? "info" : "warning",
			);
		},
	});
}
