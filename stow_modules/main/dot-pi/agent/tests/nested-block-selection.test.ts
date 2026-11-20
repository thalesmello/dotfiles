import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { realUtils } from "./selection-manager-host.ts";

const temp = mkdtempSync(join(tmpdir(), "nested-block-selection-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
const host = pathToFileURL(join(import.meta.dir, "selection-manager-host.ts")).href;
const editorPath = join(temp, "editor.ts");
writeFileSync(editorPath, readFileSync(join(import.meta.dir, "../extensions/selection-manager/editor-selection.ts"), "utf8").replace('from "@earendil-works/pi-tui"', `from ${JSON.stringify(host)}`));
const source = readFileSync(join(import.meta.dir, "../extensions/selection-manager.ts"), "utf8")
	.replace('from "@earendil-works/pi-tui"', `from ${JSON.stringify(host)}`)
	.replace('from "@earendil-works/pi-coding-agent"', `from ${JSON.stringify(host)}`)
	.replace('from "./selection-manager/editor-selection.ts"', `from ${JSON.stringify(pathToFileURL(editorPath).href)}`);
const modulePath = join(temp, "selection.ts");
writeFileSync(modulePath, source);
const { parseCodeFrameBlocks, getCodeFrameSelectionText, getCodeFrameHighlightSegments, getCodeFrameForPoint } = await import(pathToFileURL(modulePath).href);
const { visibleWidth, sliceByColumn } = realUtils;

function frame(title: string, content: string[], width: number): string[] {
	const heading = `╭─ ${title} `;
	const marker = /^[▶▼]/.test(title) ? "\x1b_open-tui:nested-frame\x07" : "";
	return [marker + heading + "─".repeat(width - visibleWidth(heading) - 1) + "╮", ...content.map((text) => "│ " + text + " ".repeat(width - 4 - visibleWidth(text)) + " │"), marker + "╰" + "─".repeat(width - 2) + "╯"];
}
const first = ["print('a │ b')", "print(42)"];
const child = frame("▼ Bash", first, 30);
const sibling = frame("▶ Read", ["SIBLING MUST NOT COPY"], 30);
const parentBody = ["Codemode", ...child.map((line) => "  " + line), ...sibling.map((line) => "  " + line)];
const lines = frame("Codemode", parentBody, 40);
// Outer frame borders: 0/39; nested frame borders: 4/33; nested content: 6..31.
const anchor = { row: 3, col: 6 };
function internals(point = anchor) {
	return { selectionAnchor: point, getSelectionColumns(raw: string, row: number, selection: any, min = 0, max = visibleWidth(raw)) {
		return { start: row === selection.start.row ? Math.max(min, selection.start.col) : min, end: row === selection.end.row ? Math.min(max, selection.end.col + (selection.end.boundary ? 0 : 1)) : max };
	} };
}

describe("selection inside nested codemode blocks", () => {
	test("finds nested frames using their own column boundaries", () => {
		const blocks = parseCodeFrameBlocks(lines);
		expect(blocks).toHaveLength(3);
		expect(blocks.find((block: any) => block.startRow === 2)).toMatchObject({ left: 4, right: 33, bodyStartRow: 3, bodyEndRow: 4, endRow: 5 });
	});
	test("copying inside a child strips both border layers but preserves literal code bars", () => {
		const selection = { start: anchor, end: { row: 4, col: 39 } };
		expect(getCodeFrameSelectionText(internals(), selection, lines)).toBe(first.join("\n"));
	});
	test("dragging past the child into a sibling remains clipped to the original child", () => {
		const selection = { start: anchor, end: { row: 8, col: 39 } };
		expect(getCodeFrameSelectionText(internals(), selection, lines)).toBe(first.join("\n"));
		const painted = getCodeFrameHighlightSegments(internals(), lines, selection, 0, 40);
		expect([...painted.segments.keys()]).toEqual([3, 4]);
		for (const [row, segments] of painted.segments) for (const span of segments) {
			const text = sliceByColumn(lines[row]!, span.start, span.end - span.start, true);
			expect(first).toContain(text);
			expect(span.start).toBeGreaterThanOrEqual(6);
			expect(span.end).toBeLessThanOrEqual(32);
		}
	});
	test("reverse drags use the gesture anchor, not the normalized range start", () => {
		const point = { row: 4, col: 20 };
		const selection = { start: { row: 0, col: 0 }, end: point };
		expect(getCodeFrameSelectionText(internals(point), selection, lines)).toBe(first.join("\n"));
		const result = getCodeFrameHighlightSegments(internals(point), lines, selection, 0, 40, undefined, point);
		expect([...result.segments.keys()]).toEqual([3, 4]);
	});
	test("only frame borders produce no copied content or highlighted borders", () => {
		const selection = { start: { row: 2, col: 5 }, end: { row: 2, col: 31 } };
		expect(getCodeFrameSelectionText(internals(selection.start), selection, lines)).toBe("");
		expect(getCodeFrameHighlightSegments(internals(), lines, selection, 0, 40).segments.size).toBe(0);
	});
	test("viewport clipping works with a scrolled-off header", () => {
		const block = parseCodeFrameBlocks(lines).find((frame: any) => frame.startRow === 2);
		const shifted = { ...block, startRow: -1, endRow: 2, bodyStartRow: 0, bodyEndRow: 1 };
		const viewport = lines.slice(3, 5);
		const selection = { start: { row: 0, col: 6 }, end: { row: 1, col: 39 } };
		const result = getCodeFrameHighlightSegments(internals(), viewport, selection, 0, 40, shifted);
		expect([...result.segments.keys()]).toEqual([0, 1]);
	});
	test("screen-coordinate selections do not borrow coincident frames from scroll content", () => {
		const scrollView = { scrollTop: 3 };
		const screen = { previousScreen: Array(10).fill("plain outside-scroll text"), currentLayout: { root: { scrollView, scrollContentLines: lines, rect: { x: 5, y: 2, width: 40, height: 8 }, clip: { x: 5, y: 2, width: 40, height: 8 } } } };
		expect(getCodeFrameForPoint(screen, anchor)).toBeUndefined();
		expect(getCodeFrameForPoint(screen, { ...anchor, scrollView })).toMatchObject({ left: 4, right: 33, bodyStartRow: 3 });
	});
	test("ANSI styling and emoji inside a child do not become border content", () => {
		const text = "print('😀 │ b')";
		const child = frame("▼ Bash", [text], 30);
		const styled = frame("Codemode", child.map((line) => "  " + line), 40).map((line) => `\x1b[31m${line}\x1b[0m`);
		const point = { row: 2, col: 6 };
		expect(getCodeFrameSelectionText(internals(point), { start: point, end: { row: 2, col: 39 } }, styled)).toBe(text);
	});
	test("literal box-drawing diagrams inside code remain source text, not child scopes", () => {
		const diagram = frame("literal", ["x"], 18);
		const child = frame("▼ Bash", diagram, 30);
		const source = frame("Codemode", child.map((line) => "  " + line), 40);
		expect(parseCodeFrameBlocks(source)).toHaveLength(2);
		const point = { row: 2, col: 6 };
		expect(getCodeFrameSelectionText(internals(point), { start: point, end: { row: 4, col: 39 } }, source)).toBe(diagram.join("\n"));
	});
	test("ordinary prose and table borders are not treated as rounded code frames", () => {
		expect(parseCodeFrameBlocks(["ordinary ╭─ text ╮ in prose", "┌───┐", "│ x │", "└───┘"])).toEqual([]);
		expect(getCodeFrameSelectionText(internals({ row: 0, col: 0 }), { start: { row: 0, col: 0 }, end: { row: 0, col: 3 } }, ["plain prose"])).toBeUndefined();
	});
});
