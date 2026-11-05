/**
 * diff-highlight.ts -- diff-so-fancy-style intra-line highlighting for pi tool diffs.
 *
 * Pi's built-in diff renderer only reverse-videos the changed words when a
 * change block is exactly one removed line paired with one added line
 * (`renderIntraLineDiff` in pi's bundled diff renderer). Multi-line blocks --
 * the common case for an edit -- get only whole-line red/green foreground, so
 * the actual changed words are invisible. Tool output that happens to be a
 * unified diff (`sl diff`, `git diff` run through bash) gets no diff colours
 * at all.
 *
 * This extension wraps every tool's built-in renderer via
 * `pi.registerToolRenderer()` (execution is never touched), then rewrites any
 * diff text found inside the returned components:
 *
 *   - both diff formats are recognised: pi's internal `-<line> content` and
 *     standard unified diffs (`@@` hunks, `---`/`+++` headers);
 *   - within each removed/added block, lines are paired by best token
 *     similarity (greedy, threshold-guarded) instead of only 1-to-1;
 *   - each pair is word-diffed and the changed fragments get a bright
 *     background (the diff colour as a solid background, bold), while the
 *     rest of the line keeps its red/green foreground.
 *
 * Non-diff output delegates to the built-in renderers untouched.
 *
 * Not covered (no extension hook can inject ANSI background there): diffs in
 * assistant markdown code blocks and `!`-command output. The write tool shows
 * no diff, so there is nothing to highlight there either.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Minimal subset of pi's Theme this file needs; tests supply a fake. */
export interface DiffHighlightTheme {
	fg(color: string, text: string): string;
	style?(text: string, options: { fg?: unknown; bg?: unknown; bold?: boolean }): string;
	inverse?(text: string): string;
	getBgAnsi?(color: string): string;
	colors?: Record<string, unknown>;
}

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

const TOKEN_RE = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

export function tokenizeWords(text: string): string[] {
	return text.match(TOKEN_RE) ?? [];
}

export interface WordDiffPart {
	value: string;
	added?: boolean;
	removed?: boolean;
}

const MAX_DIFF_TOKENS = 400;
const MAX_DIFF_CELLS = 160_000;

/**
 * Word-level diff via LCS over word/whitespace/punctuation tokens.
 * Returns undefined when the lines are too large to diff safely.
 */
export function diffWords(oldText: string, newText: string): WordDiffPart[] | undefined {
	const a = tokenizeWords(oldText);
	const b = tokenizeWords(newText);
	if (a.length > MAX_DIFF_TOKENS || b.length > MAX_DIFF_TOKENS || a.length * b.length > MAX_DIFF_CELLS) {
		return undefined;
	}

	// dp[i][j] = LCS length of a[i:] and b[j:], filled back to front.
	const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const parts: WordDiffPart[] = [];
	const push = (value: string, kind: "common" | "added" | "removed") => {
		if (!value) return;
		const flag = kind === "common" ? {} : { [kind]: true };
		const last = parts[parts.length - 1];
		if (last && !!last.added === !!flag.added && !!last.removed === !!flag.removed) {
			last.value += value;
		} else {
			parts.push({ value, ...flag });
		}
	};

	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			push(a[i], "common");
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			push(a[i], "removed");
			i++;
		} else {
			push(b[j], "added");
			j++;
		}
	}
	while (i < a.length) push(a[i++], "removed");
	while (j < b.length) push(b[j++], "added");
	return parts;
}

/** Token-LCS similarity in [0, 1]: 1 means identical token multisets in order. Whitespace tokens are ignored -- otherwise two unrelated short lines score as similar on shared spaces alone. */
export function lineSimilarity(a: string, b: string): number {
	const parts = diffWords(a, b);
	if (!parts) return 0;
	const wordCount = (text: string) => tokenizeWords(text).filter((t) => t.trim() !== "").length;
	const common = parts.filter((p) => !p.added && !p.removed).reduce((n, p) => n + wordCount(p.value), 0);
	const max = Math.max(wordCount(a), wordCount(b));
	return max === 0 ? 1 : common / max;
}

const PAIR_THRESHOLD = 0.35;

/**
 * Greedily pair removed-line indexes to added-line indexes by best
 * similarity. Lines under the threshold stay unpaired (plain colour).
 * Returns a map from removed index to added index.
 */
export function pairLines(removed: string[], added: string[]): Map<number, number> {
	const candidates: Array<{ r: number; a: number; score: number }> = [];
	for (let r = 0; r < removed.length; r++) {
		for (let a = 0; a < added.length; a++) {
			const score = lineSimilarity(removed[r], added[a]);
			if (score >= PAIR_THRESHOLD) candidates.push({ r, a, score });
		}
	}
	candidates.sort((x, y) => y.score - x.score);
	const usedR = new Set<number>();
	const usedA = new Set<number>();
	const pairs = new Map<number, number>();
	for (const { r, a } of candidates) {
		if (usedR.has(r) || usedA.has(a)) continue;
		usedR.add(r);
		usedA.add(a);
		pairs.set(r, a);
	}
	return pairs;
}

type DiffLineKind = "removed" | "added" | "context" | "header" | "other";

interface DiffLine {
	kind: DiffLineKind;
	/** Display prefix, e.g. "-  42 " for pi diffs or "-" for unified diffs. */
	prefix: string;
	content: string;
	raw: string;
}

const PI_LINE_RE = /^([+-])(\s*\d+)\s+(.*)$/;
const PI_CONTEXT_RE = /^ (\s*\d+)\s+(.*)$/;

function classifyLine(line: string): DiffLine {
	const pi = line.match(PI_LINE_RE);
	if (pi && pi[2].trim() !== "") {
		return { kind: pi[1] === "-" ? "removed" : "added", prefix: `${pi[1]}${pi[2]} `, content: pi[3], raw: line };
	}
	const piContext = line.match(PI_CONTEXT_RE);
	if (piContext && piContext[1].trim() !== "") {
		return { kind: "context", prefix: ` ${piContext[1]} `, content: piContext[2], raw: line };
	}
	if (
		line.startsWith("--- ") ||
		line.startsWith("+++ ") ||
		line.startsWith("@@") ||
		line.startsWith("diff ") ||
		line.startsWith("index ")
	) {
		return { kind: "header", prefix: "", content: line, raw: line };
	}
	if (line.startsWith("-")) return { kind: "removed", prefix: "-", content: line.slice(1), raw: line };
	if (line.startsWith("+")) return { kind: "added", prefix: "+", content: line.slice(1), raw: line };
	if (line.startsWith(" ") || line.startsWith("\\")) {
		return { kind: "context", prefix: "", content: line, raw: line };
	}
	return { kind: "other", prefix: "", content: line, raw: line };
}

/** True when the text looks like a diff worth re-rendering (either format). */
export function containsDiff(text: string): boolean {
	const lines = text.split("\n");
	const classified = lines.map(classifyLine);
	if (classified.some((l) => l.kind === "header" && l.raw.startsWith("@@"))) return true;
	const hasFileHeader =
		lines.some((l) => l.startsWith("--- ")) && lines.some((l) => l.startsWith("+++ "));
	if (hasFileHeader) return true;
	// Pi format: line-numbered +/- lines. Unified lines without a hunk or
	// file header need several of each so plain +/- output is left alone.
	const removed = classified.filter((l) => l.kind === "removed").length;
	const added = classified.filter((l) => l.kind === "added").length;
	return removed >= 2 && added >= 2;
}

function highlightFragment(
	theme: DiffHighlightTheme,
	kind: "added" | "removed",
	value: string,
	restoreBgToken?: string,
): string {
	const token = kind === "added" ? "toolDiffAdded" : "toolDiffRemoved";
	if (!value.trim()) return theme.fg(token, value);
	const bg = theme.colors?.[token];
	if (bg !== undefined && theme.style) {
		try {
			const styled = theme.style(value, { fg: "text", bg, bold: true });
			// style() resets the background (to default, or everything via
			// [0m). That kills the tool panel's background for the rest of
			// the line, so re-emit the ambient panel background here; the
			// following segments only re-apply their foreground.
			if (restoreBgToken && theme.getBgAnsi) {
				try {
					return styled + theme.getBgAnsi(restoreBgToken);
				} catch {
					return styled;
				}
			}
			return styled;
		} catch {
			// Theme without a usable concrete colour: fall through.
		}
	}
	if (theme.inverse) return theme.fg(token, theme.inverse(value));
	return theme.fg(token, value);
}

function renderPairedLine(
	theme: DiffHighlightTheme,
	kind: "added" | "removed",
	prefix: string,
	parts: WordDiffPart[],
	restoreBgToken?: string,
): string {
	const token = kind === "added" ? "toolDiffAdded" : "toolDiffRemoved";
	let out = theme.fg(token, prefix);
	for (const part of parts) {
		const isChange = kind === "removed" ? !!part.removed : !!part.added;
		const isOtherChange = kind === "removed" ? !!part.added : !!part.removed;
		if (isOtherChange) continue;
		out += isChange ? highlightFragment(theme, kind, part.value, restoreBgToken) : theme.fg(token, part.value);
	}
	return out;
}

/**
 * Re-render plain diff text with intra-line highlighting.
 * `restoreBgToken` names the ambient panel background (e.g. "toolSuccessBg")
 * to restore after each highlighted fragment; omit it when the diff text
 * sits on the terminal's default background.
 */
export function renderDiffText(text: string, theme: DiffHighlightTheme, restoreBgToken?: string): string {
	const classified = text.split("\n").map(classifyLine);
	const out: string[] = [];
	let i = 0;
	while (i < classified.length) {
		const line = classified[i];
		if (line.kind !== "removed" && line.kind !== "added") {
			if (line.kind === "context") out.push(theme.fg("toolDiffContext", line.raw));
			else if (line.kind === "header") out.push(theme.fg("muted", line.raw));
			else out.push(line.raw ? theme.fg("toolOutput", line.raw) : line.raw);
			i++;
			continue;
		}

		const removedBlock: DiffLine[] = [];
		while (i < classified.length && classified[i].kind === "removed") removedBlock.push(classified[i++]);
		const addedBlock: DiffLine[] = [];
		while (i < classified.length && classified[i].kind === "added") addedBlock.push(classified[i++]);

		const pairs = pairLines(
			removedBlock.map((l) => l.content),
			addedBlock.map((l) => l.content),
		);
		const pairedParts = new Map<string, WordDiffPart[]>();
		for (const [r, a] of pairs) {
			const parts = diffWords(removedBlock[r].content, addedBlock[a].content);
			if (parts) pairedParts.set(`${r}:${a}`, parts);
		}

		for (let r = 0; r < removedBlock.length; r++) {
			const a = pairs.get(r);
			const parts = a !== undefined ? pairedParts.get(`${r}:${a}`) : undefined;
			out.push(
				parts
					? renderPairedLine(theme, "removed", removedBlock[r].prefix, parts, restoreBgToken)
					: theme.fg("toolDiffRemoved", removedBlock[r].raw),
			);
		}
		const pairedAdded = new Map([...pairs].map(([r, a]) => [a, r]));
		for (let a = 0; a < addedBlock.length; a++) {
			const r = pairedAdded.get(a);
			const parts = r !== undefined ? pairedParts.get(`${r}:${a}`) : undefined;
			out.push(
				parts
					? renderPairedLine(theme, "added", addedBlock[a].prefix, parts, restoreBgToken)
					: theme.fg("toolDiffAdded", addedBlock[a].raw),
			);
		}
	}
	return out.join("\n");
}

const MAX_REWRITE_CHARS = 200_000;

interface TextLike {
	text: string;
	setText(text: string): void;
}

interface PreviewLike {
	options: { text: string; [key: string]: unknown };
	invalidate(): void;
}

function isTextLike(node: Record<string, unknown>): node is Record<string, unknown> & TextLike {
	return typeof node.text === "string" && typeof node.setText === "function";
}

function isPreviewLike(node: Record<string, unknown>): node is Record<string, unknown> & PreviewLike {
	const options = node.options as { text?: unknown } | undefined;
	return !!options && typeof options.text === "string" && typeof node.invalidate === "function";
}

/**
 * Walk a rendered component tree and rewrite, in place, any text node whose
 * plain content is a recognisable diff. Covers pi's Text components (edit
 * preview/result, generic results) and VisualLinePreview (collapsed bash).
 */
export function rewriteComponentDiffs(component: unknown, theme: DiffHighlightTheme, restoreBgToken?: string): void {
	const visited = new Set<unknown>();
	const walk = (node: unknown): void => {
		if (!node || typeof node !== "object" || visited.has(node)) return;
		visited.add(node);
		const record = node as Record<string, unknown>;

		if (isTextLike(record)) {
			const plain = stripAnsi(record.text);
			if (plain.length <= MAX_REWRITE_CHARS && containsDiff(plain)) {
				record.setText(renderDiffText(plain, theme, restoreBgToken));
			}
			return;
		}
		if (isPreviewLike(record)) {
			const plain = stripAnsi(record.options.text);
			if (plain.length <= MAX_REWRITE_CHARS && containsDiff(plain)) {
				record.options.text = renderDiffText(plain, theme, restoreBgToken);
				record.invalidate();
			}
			return;
		}
		if (Array.isArray(record.children)) {
			for (const child of record.children) walk(child);
		}
	};
	walk(component);
}

export default function (pi: ExtensionAPI) {
	pi.registerToolRenderer((toolName, next) => {
		const base = next();
		if (!base) return base;

		const wrapped: typeof base = { ...base };

		if (base.renderCall) {
			const renderCall = base.renderCall;
			wrapped.renderCall = (args, theme, context) => {
				const component = renderCall(args, theme, context);
				// Only the edit tool's call slot contains a diff (its preview).
				// The write tool's call slot is file content, not a diff.
				// With a preview present, the edit box paints toolSuccessBg.
				if (toolName === "edit") {
					rewriteComponentDiffs(component, theme as unknown as DiffHighlightTheme, "toolSuccessBg");
				}
				return component;
			};
		}

		if (base.renderResult) {
			const renderResult = base.renderResult;
			wrapped.renderResult = (result, options, theme, context) => {
				const component = renderResult(result, options, theme, context);
				// Default-shell results sit in the tool box, whose background is
				// pending/success/error by state. Self-shell tools (edit) lay
				// their result out on the default background instead.
				const restoreBgToken =
					base.renderShell === "self"
						? undefined
						: options.isPartial
							? "toolPendingBg"
							: context.isError
								? "toolErrorBg"
								: "toolSuccessBg";
				rewriteComponentDiffs(component, theme as unknown as DiffHighlightTheme, restoreBgToken);
				return component;
			};
		}

		return wrapped;
	});
}
