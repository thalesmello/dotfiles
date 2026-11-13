import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { NativePromptEditor } from "./prompt-editor-host.ts";
import { realUtils } from "./selection-manager-host.ts";

const helper = join(import.meta.dir, "../extensions/selection-manager/editor-selection.ts");
const hostUrl = pathToFileURL(join(import.meta.dir, "selection-manager-host.ts")).href;
const redirected = join(tmpdir(), `prompt-editor-selection-${process.pid}.ts`);
fs.writeFileSync(redirected, fs.readFileSync(helper, "utf8").replace('from "@earendil-works/pi-tui"', `from ${JSON.stringify(hostUrl)}`));
afterAll(() => fs.rmSync(redirected, { force: true }));
const { installEditorSelection } = await import(pathToFileURL(redirected).href);

function makeEditor(text: string, base?: NativePromptEditor) {
	const editor = base ?? new NativePromptEditor();
	const copied: string[] = [];
	let focused = 0;
	let replacements = 0;
	installEditorSelection(editor, {
		onFocus: () => focused++,
		copyText: (text: string) => copied.push(text),
		onReplace: () => replacements++,
		isReference: (line: string) => line === "> protected reference",
		isSubmit: (data: string) => data === "\r",
	});
	editor.setText(text);
	editor.render(40);
	return { editor, copied, get focused() { return focused; }, get replacements() { return replacements; } };
}
function caret(editor: any, line: number, col: number) {
	editor.state.cursorLine = line;
	editor.setCursorCol(col);
}
const key = { left: "\x1b[1;2D", right: "\x1b[1;2C", up: "\x1b[1;2A", down: "\x1b[1;2B", wordLeft: "\x1b[1;4D", wordRight: "\x1b[1;4C" };
function mouse(editor: any, type: string, x: number, y: number, extra = {}) {
	return editor.handleMouse({ type, button: "left", x, y, width: 40, height: 5, screenX: x, screenY: y, shift: false, alt: false, ctrl: false, ...extra });
}
function highlight(line: string) {
	const start = line.indexOf("\x1b[7m");
	const end = line.indexOf("\x1b[27m", start);
	return start < 0 ? "" : realUtils.stripTerminalSequences(line.slice(start, end));
}

describe("editable prompt selection (native Pi editor)", () => {
	test("Shift+Left selects text visibly, typing replaces it in one undo step", () => {
		const { editor, copied } = makeEditor("alpha beta");
		let changes = 0;
		editor.onChange = () => changes++;
		for (let i = 0; i < 4; i++) editor.handleInput(key.left);
		expect(highlight(editor.render(40)[1]!)).toBe("beta");
		editor.handleInput("X");
		expect(editor.getText()).toBe("alpha X");
		expect(changes).toBe(1);
		expect(copied).toEqual([]);
		editor.handleInput("\x1f"); // Native undo, ctrl+minus.
		expect(editor.getText()).toBe("alpha beta");
	});

	test("Shift+Alt+Left/Right selects words, shrinks, and changes direction", () => {
		const { editor } = makeEditor("alpha beta gamma");
		caret(editor, 0, 6);
		editor.handleInput(key.wordRight);
		expect(highlight(editor.render(40)[1]!)).toBe("beta");
		editor.handleInput(key.wordRight);
		expect(highlight(editor.render(40)[1]!)).toBe("beta gamma");
		editor.handleInput(key.wordLeft);
		editor.handleInput(key.wordLeft);
		editor.handleInput(key.wordLeft);
		editor.handleInput("X");
		expect(editor.getText()).toBe("Xbeta gamma");
	});

	test("Backspace/Delete replaces a selection rather than deleting one character", () => {
		for (const deletion of ["\x7f", "\x1b[3~"]) {
			const { editor } = makeEditor("alpha beta");
			editor.handleInput(key.wordLeft);
			editor.handleInput(deletion);
			expect(editor.getText()).toBe("alpha ");
		}
	});

	test("mouse press/drag/release selects, and copy is explicit", () => {
		const harness = makeEditor("alpha beta gamma");
		const { editor, copied } = harness;
		const padding = editor.getPaddingX();
		expect(mouse(editor, "press", padding + 6, 1)).toMatchObject({ capture: true, focus: true });
		mouse(editor, "drag", padding + 10, 1);
		mouse(editor, "release", padding + 10, 1);
		mouse(editor, "click", padding + 10, 1); // Pi's synthetic click must not collapse it.
		expect(highlight(editor.render(40)[1]!)).toBe("beta");
		expect(copied).toEqual([]);
		editor.handleInput("\x1bw");
		expect(copied).toEqual(["beta"]);
		editor.handleInput("X");
		expect(editor.getText()).toBe("alpha X gamma");
		expect(harness.focused).toBeGreaterThan(0);
	});

	test("composes with instance-level frame decorators and maps mouse coordinates", () => {
		const base = new NativePromptEditor();
		const originalRender = base.render.bind(base);
		const originalMouse = base.handleMouse.bind(base);
		base.render = (width) => {
			const lines = originalRender(width - 4);
			return lines.map((line, row) => row === 0 ? `╭${"─".repeat(width - 2)}╮`
				: row === lines.length - 1 ? `╰${"─".repeat(width - 2)}╯` : `│ ${line} │`);
		};
		base.handleMouse = (event) => originalMouse({ ...event, x: event.x - 2, width: event.width - 4 });
		const { editor } = makeEditor("alpha beta gamma", base);
		mouse(editor, "press", 8, 1);
		mouse(editor, "drag", 12, 1);
		mouse(editor, "release", 12, 1);
		const painted = editor.render(40);
		expect(painted[0]!.startsWith("╭")).toBe(true);
		expect(highlight(painted[1]!)).toBe("beta");
		editor.handleInput("X");
		expect(editor.getText()).toBe("alpha X gamma");
	});

	test("Cmd+C copies and Ctrl+X cuts selected prompt text", () => {
		const { editor, copied } = makeEditor("alpha beta");
		editor.handleInput(key.wordLeft);
		editor.handleInput("\x1b[99;9u"); // Kitty Cmd+C.
		expect(copied).toEqual(["beta"]);
		editor.handleInput("\x18");
		expect(copied).toEqual(["beta", "beta"]);
		expect(editor.getText()).toBe("alpha ");
		editor.undo();
		expect(editor.getText()).toBe("alpha beta");
	});

	test("a click-only mouse event retains native cursor placement", () => {
		const { editor } = makeEditor("alpha beta gamma");
		mouse(editor, "click", editor.getPaddingX() + 6, 1);
		editor.handleInput("X");
		expect(editor.getText()).toBe("alpha Xbeta gamma");
	});

	test("double-click selects a word without copying it", () => {
		const { editor, copied } = makeEditor("alpha beta gamma");
		const x = editor.getPaddingX() + 7;
		for (let i = 0; i < 2; i++) { mouse(editor, "press", x, 1); mouse(editor, "release", x, 1); mouse(editor, "click", x, 1); }
		expect(highlight(editor.render(40)[1]!)).toBe("beta");
		expect(copied).toEqual([]);
		editor.handleInput("X");
		expect(editor.getText()).toBe("alpha X gamma");
	});

	test("multi-line vertical selection deletes the selected text", () => {
		const { editor } = makeEditor("alpha\nbeta\ngamma");
		caret(editor, 0, 2);
		editor.handleInput(key.down);
		expect(highlight(editor.render(40)[1]!)).toBe("pha "); // Includes the selected newline cell.
		expect(highlight(editor.render(40)[2]!)).toBe("be");
		editor.handleInput("X");
		expect(editor.getText()).toBe("alXta\ngamma");
	});

	test("wrapped rows and wide graphemes use native visual layout", () => {
		const { editor } = makeEditor("alpha beta gamma delta epsilon zeta theta");
		editor.render(15);
		const visual = editor.buildVisualLineMap(editor.lastWidth);
		expect(visual.length).toBeGreaterThan(1);
		caret(editor, 0, visual[1]!.startCol);
		editor.handleInput(key.down);
		const painted = editor.render(15);
		expect(painted.some((line: string) => line.includes("\x1b[7m"))).toBe(true);
		editor.handleInput("X");
		expect(editor.getText()).toContain("X");
		const wide = makeEditor("a👩🏽‍💻e\u0301z").editor;
		wide.handleInput(key.left); // z
		wide.handleInput(key.left); // combining grapheme
		wide.handleInput("X");
		expect(wide.getText()).toBe("a👩🏽‍💻X");
	});

	test("bracketed paste replaces selection, including split chunks, with one undo", () => {
		const { editor } = makeEditor("alpha beta");
		editor.handleInput(key.wordLeft);
		editor.handleInput("\x1b[200~first\n");
		editor.handleInput("second\x1b[201~");
		expect(editor.getText()).toBe("alpha first\nsecond");
		editor.handleInput("\x1f");
		expect(editor.getText()).toBe("alpha beta");
	});

	test("replacement preserves collapsed paste markers and undo restores removed markers", () => {
		const { editor } = makeEditor("alpha ");
		const large = "x".repeat(1100);
		editor.handleInput(`\x1b[200~${large}\x1b[201~`);
		const pasted = editor.getText();
		expect(pasted).toContain("[paste #");
		expect(editor.pastes.size).toBe(1);
		editor.handleInput(key.left); // Native atomic marker grapheme.
		editor.handleInput("X");
		expect(editor.getText()).toBe("alpha X");
		editor.undo();
		expect(editor.getText()).toBe(pasted);
		expect(editor.pastes.size).toBe(1);
	});

	test("plain arrows collapse selection and do not leave a replacement active", () => {
		const { editor } = makeEditor("alpha beta");
		editor.handleInput(key.wordLeft);
		editor.handleInput("\x1b[C");
		editor.handleInput("X");
		expect(editor.getText()).toBe("alpha betaX");
	});

	test("Enter submits selected prompt text, rather than copying or replacing it", () => {
		const { editor, copied } = makeEditor("alpha beta");
		let submitted = "";
		editor.onSubmit = (text: string) => { submitted = text; };
		editor.handleInput(key.wordLeft);
		editor.handleInput("\r");
		expect(submitted).toBe("alpha beta");
		expect(copied).toEqual([]);
	});

	test("replacement removes a reference atomically, never leaving a partial stand-in", () => {
		const harness = makeEditor("> protected reference\nquestion");
		const { editor } = harness;
		caret(editor, 0, 4);
		editor.handleInput(key.right);
		editor.handleInput("\x7f");
		expect(editor.getText()).toBe("question");
		expect(harness.replacements).toBe(1);
	});

	test("setting editor text clears stale selection and key releases do not move it", () => {
		const { editor } = makeEditor("alpha beta");
		editor.handleInput(key.wordLeft);
		const col = editor.state.cursorCol;
		editor.handleInput("\x1b[1;2:3D");
		expect(editor.state.cursorCol).toBe(col);
		editor.setText("new prompt");
		editor.handleInput("X");
		expect(editor.getText()).toBe("new promptX");
	});
});
