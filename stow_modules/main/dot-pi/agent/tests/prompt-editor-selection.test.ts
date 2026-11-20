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
fs.writeFileSync(redirected, fs.readFileSync(helper, "utf8")
	.replace('from "@earendil-works/pi-tui"', `from ${JSON.stringify(hostUrl)}`)
	.replace('from "../prompt-wrap.ts"', `from ${JSON.stringify(pathToFileURL(join(import.meta.dir, "../extensions/prompt-wrap.ts")).href)}`));
afterAll(() => fs.rmSync(redirected, { force: true }));
const { installEditorSelection } = await import(pathToFileURL(redirected).href);
const railSource = join(import.meta.dir, "../extensions/zen/src/editor-rail.ts");
const redirectedRail = join(tmpdir(), `prompt-editor-rail-${process.pid}.ts`);
fs.writeFileSync(redirectedRail, fs.readFileSync(railSource, "utf8").replace('from "@earendil-works/pi-tui"', `from ${JSON.stringify(hostUrl)}`));
afterAll(() => fs.rmSync(redirectedRail, { force: true }));
const { applyRail } = await import(pathToFileURL(redirectedRail).href);
const frameHost = join(tmpdir(), `prompt-editor-frame-host-${process.pid}.ts`);
fs.writeFileSync(frameHost, [
	`export { NativePromptEditor as CustomEditor, CURSOR_MARKER } from ${JSON.stringify(pathToFileURL(join(import.meta.dir, "prompt-editor-host.ts")).href)};`,
	`export { truncateToWidth } from ${JSON.stringify(pathToFileURL(join(import.meta.dir, "zen-host.ts")).href)};`,
	`export { visibleWidth, stripTerminalSequences } from ${JSON.stringify(hostUrl)};`,
].join("\n"));
const frameBuild = await Bun.build({
	entrypoints: [join(import.meta.dir, "../extensions/open-tui/editor.ts")],
	target: "bun", format: "esm",
	external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
});
if (!frameBuild.success) throw new Error(frameBuild.logs.join("\n"));
const frameModule = join(tmpdir(), `prompt-editor-frame-${process.pid}.mjs`);
fs.writeFileSync(frameModule, (await frameBuild.outputs[0].text())
	.replaceAll('from "@earendil-works/pi-tui"', `from ${JSON.stringify(pathToFileURL(frameHost).href)}`)
	.replaceAll('from "@earendil-works/pi-coding-agent"', `from ${JSON.stringify(pathToFileURL(frameHost).href)}`));
afterAll(() => { fs.rmSync(frameHost, { force: true }); fs.rmSync(frameModule, { force: true }); });
const { decorateOpenTuiEditor } = await import(pathToFileURL(frameModule).href);
// Exercise the shipped bundle as well, not just a fresh build of editor.ts.
const shippedBundle = fs.readFileSync(join(import.meta.dir, "../extensions/open-tui/bundle.js"), "utf8");
const bundleSection = (file: string) => {
	const marker = `// stow_modules/main/dot-pi/agent/extensions/open-tui/${file}`;
	const start = shippedBundle.indexOf(marker);
	const end = shippedBundle.indexOf("\n// stow_modules/", start + marker.length);
	if (start < 0 || end < 0) throw new Error(`Missing shipped bundle section: ${file}`);
	return shippedBundle.slice(start, end);
};
const shippedFrameModule = join(tmpdir(), `prompt-editor-shipped-frame-${process.pid}.mjs`);
fs.writeFileSync(shippedFrameModule, (bundleSection("utils.ts") + "\n" + bundleSection("editor.ts") + "\nexport { decorateOpenTuiEditor };\n")
	.replaceAll('from "@earendil-works/pi-tui"', `from ${JSON.stringify(pathToFileURL(frameHost).href)}`)
	.replaceAll('from "@earendil-works/pi-coding-agent"', `from ${JSON.stringify(pathToFileURL(frameHost).href)}`));
afterAll(() => fs.rmSync(shippedFrameModule, { force: true }));
const { decorateOpenTuiEditor: decorateShippedEditor } = await import(pathToFileURL(shippedFrameModule).href);

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

describe("in-text soft-wrap prefix (native Pi editor)", () => {
	const plain = (rows: string[]) => rows.map(realUtils.stripTerminalSequences);
	test("marks only virtual continuations, never explicit newlines or prompt text", () => {
		const text = "alpha beta gamma delta\nshort\nepsilon zeta eta theta";
		const { editor, copied } = makeEditor(text);
		const rows = plain(editor.render(14));
		const visual = editor.buildVisualLineMap(editor.lastWidth);
		for (let i = 0; i < visual.length; i++) {
			expect(rows[i + 1]!.startsWith("↪ ")).toBe(visual[i]!.startCol > 0);
		}
		expect(editor.getText()).toBe(text);
		editor.handleInput("\x1b[97;9u");
		editor.handleInput("\x1b[99;9u");
		expect(copied).toEqual([text]);
		for (const width of [1, 2]) {
			expect(plain(editor.render(width)).some((row) => row.includes("↪"))).toBe(false);
		}
		for (const width of [3, 8, 14, 80]) {
			const rows = plain(editor.render(width));
			expect(rows.slice(1, 1 + editor.renderedVisibleLineCount).every((row) => realUtils.visibleWidth(row) <= width), `width ${width}: ${JSON.stringify(rows)}`).toBe(true);
		}
	});
	test("continuation gutter clicks preserve caret and selection coordinates", () => {
		const { editor } = makeEditor("alpha beta gamma delta epsilon");
		editor.render(14);
		const visual = editor.buildVisualLineMap(editor.lastWidth);
		const start = visual[1]!.startCol;
		editor.handleMouse({ type: "click", button: "left", x: 0, y: 2, width: 14 });
		expect(editor.getCursor()).toEqual({ line: 0, col: start });
		editor.handleMouse({ type: "press", button: "left", x: 2, y: 2, width: 14 });
		editor.handleMouse({ type: "drag", button: "left", x: 5, y: 2, width: 14 });
		editor.handleMouse({ type: "release", button: "left", x: 5, y: 2, width: 14 });
		const rows = editor.render(14);
		expect(plain(rows)[2]!.startsWith("↪ ")).toBe(true);
		expect(highlight(rows[2]!)).toBe(editor.getText().slice(start, start + 3));
	});
	test("scrolled continuations retain the marker and resizing removes obsolete wraps", () => {
		const { editor } = makeEditor("long word ".repeat(60));
		const rows = plain(editor.render(14));
		expect(editor.scrollOffset).toBeGreaterThan(0);
		expect(rows[1]!.startsWith("↪ ")).toBe(true);
		expect(plain(editor.render(1000)).some((row) => row.includes("↪"))).toBe(false);
	});
	for (const [name, decorate] of [["source", decorateOpenTuiEditor], ["shipped bundle", decorateShippedEditor]] as const) test(`Open TUI ${name} draws wrap markers without the selection wrapper or padding`, () => {
		const editor = new NativePromptEditor();
		editor.setText("alpha beta gamma delta epsilon\nshort");
		decorate(editor, editor.tui);
		expect(editor.getPaddingX()).toBe(0);
		const rows = plain(editor.render(18));
		const visual = editor.buildVisualLineMap(editor.lastWidth);
		for (let i = 0; i < visual.length; i++) {
			expect(rows[i + 1]!.startsWith("│ ↪ ")).toBe(visual[i]!.startCol > 0);
		}
		expect(editor.getText()).toBe("alpha beta gamma delta epsilon\nshort");
	});

	test("the real Open TUI frame aligns the prefix with text and keeps mouse coordinates", () => {
		const { editor, copied } = makeEditor("alpha beta gamma delta epsilon");
		decorateOpenTuiEditor(editor, editor.tui);
		expect(editor.getPaddingX()).toBe(0);
		const rows = plain(editor.render(18));
		expect(rows[0]!.startsWith("╭")).toBe(true);
		expect(rows[2]!.startsWith("│ ↪ ")).toBe(true);
		const visual = editor.buildVisualLineMap(editor.lastWidth);
		editor.handleMouse({ type: "click", button: "left", x: 2, y: 2, width: 18 });
		expect(editor.getCursor()).toEqual({ line: 0, col: visual[1]!.startCol });
		editor.handleInput("\x1b[97;9u");
		editor.handleInput("\x1b[99;9u");
		expect(copied).toEqual(["alpha beta gamma delta epsilon"]);
		(editor as any).setPaddingX(3);
		expect(editor.getPaddingX()).toBe(0);
		expect(plain(editor.render(18))[2]!.startsWith("│ ↪ ")).toBe(true);
	});

	test("Zen retains both its rail and wrap marker in either decorator order", () => {
		for (const zenOutside of [false, true]) {
			const base = new NativePromptEditor();
			(base as any).setPaddingX(2);
			const decorate = () => {
				const render = base.render.bind(base);
				base.render = (width) => applyRail(render(width), base.getPaddingX(), (glyph: string) => `\x1b[36m${glyph}\x1b[39m`);
			};
			if (!zenOutside) decorate();
			const { editor } = makeEditor("alpha beta gamma delta", base);
			if (zenOutside) decorate();
			const rows = plain(editor.render(14));
			expect(rows[0]!.startsWith("┃ ")).toBe(true);
			expect(rows.slice(1).every((row) => row.startsWith("┃ ↪ "))).toBe(true);
		}
	});
});

describe("prompt redo (native Pi editor)", () => {
	const redo = "\x1b[47;6u"; // Cmd+Shift+Z in Ghostty and Herdr.
	test("redo restores native edit grouping and is undoable", () => {
		for (const data of [redo, "\x1b[63;5u", "\x1b[122;10u"]) {
			const { editor } = makeEditor("abc");
			editor.handleInput("X");
			editor.handleInput("Y");
			editor.handleInput("\x1f");
			expect(editor.getText()).toBe("abc");
			editor.handleInput(data);
			expect(editor.getText()).toBe("abcXY");
			expect(editor.getCursor()).toEqual({ line: 0, col: 5 });
			editor.handleInput("\x1f");
			expect(editor.getText()).toBe("abc");
		}
	});
	test("multiple redo steps and new edits invalidate the future", () => {
		const { editor } = makeEditor("abc");
		editor.handleInput("X");
		editor.handleInput("\x7f");
		editor.handleInput("\x1f");
		editor.handleInput("\x1f");
		editor.handleInput(redo);
		expect(editor.getText()).toBe("abcX");
		editor.handleInput(redo);
		expect(editor.getText()).toBe("abc");
		editor.handleInput("\x1f");
		editor.handleInput("Y");
		editor.handleInput(redo);
		expect(editor.getText()).toBe("abcXY");
	});
	test("selection replacement redos as one edit and emits onChange", () => {
		const { editor } = makeEditor("alpha beta");
		for (let i = 0; i < 4; i++) editor.handleInput(key.left);
		editor.handleInput("X");
		editor.handleInput("\x1f");
		const changes: string[] = [];
		editor.onChange = (text) => changes.push(text);
		editor.handleInput(redo);
		expect(editor.getText()).toBe("alpha X");
		expect(changes).toEqual(["alpha X"]);
		expect(highlight(editor.render(40)[1]!)).toBe("");
	});
	test("redo preserves collapsed paste metadata and cursor", () => {
		const { editor } = makeEditor("");
		editor.handleInput("\x1b[200~" + "long pasted text\n".repeat(30) + "\x1b[201~");
		const text = editor.getText();
		const pastes = new Map(editor.pastes);
		const cursor = editor.getCursor();
		expect(pastes.size).toBeGreaterThan(0);
		editor.handleInput("\x1f");
		editor.handleInput(redo);
		expect(editor.getText()).toBe(text);
		expect(editor.pastes).toEqual(pastes);
		expect(editor.getCursor()).toEqual(cursor);
	});
	test("submit clears redo and releases never replay", () => {
		const { editor } = makeEditor("abc");
		editor.handleInput(redo); // empty redo stack
		expect(editor.getText()).toBe("abc");
		editor.handleInput("X");
		editor.handleInput("\x1f");
		editor.handleInput("\x1b[47;6:3u");
		expect(editor.getText()).toBe("abc");
		editor.handleInput("\r");
		editor.handleInput(redo);
		expect(editor.getText()).toBe("");
	});
});

describe("editable prompt selection (native Pi editor)", () => {
	test("Cmd+A selects the entire multiline prompt for copy and replacement", () => {
		const { editor, copied } = makeEditor("alpha\nbeta\ngamma");
		caret(editor, 1, 2);
		editor.handleInput("\x1b[97;9u");
		expect(editor.getCursor()).toEqual({ line: 2, col: 5 });
		editor.handleInput("\x1b[99;9u");
		expect(copied).toEqual(["alpha\nbeta\ngamma"]);
		editor.handleInput("X");
		expect(editor.getText()).toBe("X");
		editor.handleInput("\x1f");
		expect(editor.getText()).toBe("alpha\nbeta\ngamma");
	});
	test("Cmd+A works on empty prompts and replaces an existing selection", () => {
		const { editor } = makeEditor("");
		editor.handleInput("\x1b[97;9u");
		editor.handleInput("abc");
		expect(editor.getText()).toBe("abc");
		editor.handleInput(key.left);
		editor.handleInput("\x1b[97;9u");
		editor.handleInput("\x7f");
		expect(editor.getText()).toBe("");
	});
	test("Cmd+A releases do not select the prompt", () => {
		const { editor } = makeEditor("abc");
		editor.handleInput("\x1b[97;9:3u");
		editor.handleInput("X");
		expect(editor.getText()).toBe("abcX");
	});
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

	test("Ghostty Cmd+Arrows move to line and document boundaries without selecting", () => {
		const { editor, copied } = makeEditor("alpha\nbeta\ngamma");
		caret(editor, 1, 2);
		editor.handleInput("\x01"); // Ghostty Cmd+Left -> Ctrl+A.
		expect(editor.getCursor()).toEqual({ line: 1, col: 0 });
		editor.handleInput("\x05"); // Ghostty Cmd+Right -> Ctrl+E.
		expect(editor.getCursor()).toEqual({ line: 1, col: 4 });
		editor.handleInput("\x1b[1;9A"); // Cmd+Up.
		expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
		editor.handleInput("\x1b[1;9B"); // Cmd+Down.
		expect(editor.getCursor()).toEqual({ line: 2, col: 5 });
		editor.handleInput("X");
		expect(editor.getText()).toBe("alpha\nbeta\ngammaX");
		expect(copied).toEqual([]);
	});

	test("Ctrl+A/E and Cmd+Left/Right escalate from line to whole-prompt boundaries", () => {
		for (const [start, end] of [["\x01", "\x05"], ["\x1b[1;9D", "\x1b[1;9C"]]) {
			const { editor } = makeEditor("alpha\nbeta\ngamma");
			caret(editor, 1, 2);
			editor.handleInput(start!);
			expect(editor.getCursor()).toEqual({ line: 1, col: 0 });
			editor.handleInput(start!);
			expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
			editor.handleInput(start!);
			expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
			caret(editor, 1, 2);
			editor.handleInput(end!);
			expect(editor.getCursor()).toEqual({ line: 1, col: 4 });
			editor.handleInput(end!);
			expect(editor.getCursor()).toEqual({ line: 2, col: 5 });
			editor.handleInput(end!);
			expect(editor.getCursor()).toEqual({ line: 2, col: 5 });
		}
	});

	test("history arrows remain sticky across multiline entries and restore the draft cursor", () => {
		const { editor } = makeEditor("draft\nsecond line");
		const native = editor as any;
		native.addToHistory("old\nentry");
		native.addToHistory("new\nentry");
		caret(editor, 0, 0);
		editor.handleInput("\x1b[A");
		expect(editor.getText()).toBe("new\nentry");
		editor.handleInput("\x1b[A");
		expect(editor.getText()).toBe("old\nentry");
		editor.handleInput("\x1b[A"); // Oldest boundary keeps history mode.
		editor.handleInput("\x1b[B");
		expect(editor.getText()).toBe("new\nentry");
		editor.handleInput("\x1b[B"); // Must not move within the multiline entry.
		expect(editor.getText()).toBe("draft\nsecond line");
		expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
		editor.handleInput("\x1b[A"); // Still sticky after draft restoration.
		expect(editor.getText()).toBe("new\nentry");
	});

	test("left/right and typing leave history mode until a prompt boundary is reached", () => {
		for (const interrupt of ["\x1b[C", "\x1b[D", "X", "\x1b[88u"]) {
			const { editor } = makeEditor("");
			(editor as any).addToHistory("one\ntwo\nthree");
			editor.handleInput("\x1b[A");
			if (interrupt === "\x1b[D") editor.handleInput("\x1b[C");
			editor.handleInput(interrupt);
			const recalled = editor.getText();
			editor.handleInput("\x1b[B");
			expect(editor.getText()).toBe(recalled);
			expect(editor.getCursor().line).toBe(1);
			editor.handleInput("\x1b[A"); // Move back within prompt, not history.
			expect(editor.getText()).toBe(recalled);
			expect(editor.getCursor().line).toBe(0);
			editor.handleInput("\x01");
			editor.handleInput("\x1b[A"); // Re-enter history at the top.
			expect(editor.getText()).toBe("one\ntwo\nthree");
			editor.handleInput("\x1b[B");
			expect(editor.getText()).toBe(recalled);
		}
	});

	test("sticky history handles wrapped prompts and ignores key releases", () => {
		const { editor } = makeEditor("");
		const entry = "a long history entry ".repeat(10);
		(editor as any).addToHistory(entry);
		editor.handleInput("\x1b[A");
		expect(editor.buildVisualLineMap(editor.lastWidth).length).toBeGreaterThan(1);
		editor.handleInput("\x1b[57352;1:3u"); // Kitty Up release.
		editor.handleInput("\x1b[B");
		expect(editor.getText()).toBe("");
		editor.handleInput("\x1b[A");
		expect(editor.getText()).toBe(entry.trim());
	});

	test("history mode respects autocomplete ownership and external text replacement", () => {
		const { editor } = makeEditor("");
		const native = editor as any;
		native.addToHistory("one\ntwo");
		editor.handleInput("\x1b[A");
		const selections: string[] = [];
		native.autocompleteState = "manual";
		native.autocompleteList = { handleInput: (data: string) => selections.push(data) };
		editor.handleInput("\x1b[B");
		expect(selections).toEqual(["\x1b[B"]);
		expect(editor.getText()).toBe("one\ntwo");
		native.autocompleteState = null;
		native.autocompleteList = undefined;
		editor.setText("replacement\nprompt");
		caret(editor, 0, 0);
		editor.handleInput("\x1b[B");
		expect(editor.getText()).toBe("replacement\nprompt");
		expect(editor.getCursor()).toEqual({ line: 1, col: 0 });
	});

	test("Shift+Cmd+Arrows extend and shrink prompt selection to boundaries", () => {
		const { editor, copied } = makeEditor("alpha\nbeta\ngamma");
		caret(editor, 1, 2);
		editor.handleInput("\x1b[1;10D");
		editor.handleInput("\x1bw");
		expect(copied.pop()).toBe("be");
		editor.handleInput("\x1b[1;10C");
		editor.handleInput("\x1bw");
		expect(copied.pop()).toBe("ta");
		editor.handleInput("\x1b[1;10A");
		editor.handleInput("\x1bw");
		expect(copied.pop()).toBe("alpha\nbe");
		editor.handleInput("\x1b[1;10B");
		expect(copied).toEqual([]); // Extending still must not copy automatically.
		editor.handleInput("\x1bw");
		expect(copied.pop()).toBe("ta\ngamma");
		editor.handleInput("X");
		expect(editor.getText()).toBe("alpha\nbeX");
	});

	test("Shift+Alt+Up/Down and Alt+Up/Down expand and contract prompt selection by paragraph", () => {
		const { editor, copied } = makeEditor("p1a\np1b\n\np2a\np2b\np2c\n\np3a\np3b");
		caret(editor, 4, 1); // Inside "p2b"
		editor.handleInput("\x1b[1;4B"); // Shift+Alt+Down -> end of p2
		editor.handleInput("\x1bw");
		expect(copied.pop()).toBe("2b\np2c");
		editor.handleInput("\x1b[1;3B"); // Alt+Down (while selection active) -> end of p3
		editor.handleInput("\x1bw");
		expect(copied.pop()).toBe("2b\np2c\n\np3a\np3b");
		editor.handleInput("\x1b[1;3A"); // Alt+Up -> contract to end of p2
		editor.handleInput("\x1bw");
		expect(copied.pop()).toBe("2b\np2c");
		editor.handleInput("\x1b[1;3A"); // Alt+Up -> start of p2
		editor.handleInput("\x1bw");
		expect(copied.pop()).toBe("p2a\np");
		editor.handleInput("\x1b[1;4A"); // Shift+Alt+Up -> start of p1
		editor.handleInput("\x1bw");
		expect(copied.pop()).toBe("p1a\np1b\n\np2a\np");
		editor.handleInput("\x1b[1;3B"); // Alt+Down -> contract to start of p2
		editor.handleInput("\x1bw");
		expect(copied.pop()).toBe("p2a\np");
	});

	test("Cmd line bounds work across wrapped rows and collapse an existing selection", () => {
		const text = "alpha beta gamma delta epsilon";
		const { editor } = makeEditor(text);
		editor.render(12);
		caret(editor, 0, 8);
		editor.handleInput("\x1b[1;10D");
		editor.handleInput("\x01");
		expect(editor.state.cursorCol).toBe(0);
		editor.handleInput("X");
		expect(editor.getText()).toBe(`X${text}`);
		caret(editor, 0, 8);
		editor.handleInput("\x1b[57418;10u"); // Kitty Shift+Cmd+Right.
		editor.handleInput("\x1b[1;10:3D"); // Release must not move the focus.
		expect(editor.state.cursorCol).toBe(editor.getText().length);
		editor.handleInput("X");
		expect(editor.getText()).toBe("Xalpha bX");
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
		const padding = editor.getPaddingX();
		mouse(editor, "press", padding + 8, 1);
		mouse(editor, "drag", padding + 12, 1);
		mouse(editor, "release", padding + 12, 1);
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
