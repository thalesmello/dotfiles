/**
 * Test host exposing Pi's *installed* prompt Editor (packages/tui/src/
 * components/editor.ts) as `NativePromptEditor`, for editor-selection tests.
 *
 * The real class source is sliced out of the embedded JS in
 * /usr/local/bin/pi_cli/pi.real, together with the real sources of its
 * dependencies (utils, keys, keybindings, kill-ring, undo-stack,
 * word-navigation, select-list). Only `tui.ts` is stubbed (CURSOR_MARKER and
 * renderFakeCursor, copied from the installed constants) plus a few leaf
 * modules utils.ts imports (east-asian-width, markdown/latex/images).
 *
 * Real: render, layoutText, buildVisualLineMap, handleMouse, moveCursor,
 * moveWordBackwards/Forwards, insertion, delete, paste, undo, kill ring.
 * Fake: tui (terminal size + render counter), theme, clipboard (none).
 *
 * Not a test; pi never loads it.
 */
import * as fs from "node:fs";

const PI_BIN = "/usr/local/bin/pi_cli/pi.real";
const SRC = "// ../../../../../../../../../../re_tmp/pi-mono/packages/tui/src/";

export interface EditorState { lines: string[]; cursorLine: number; cursorCol: number }
export interface VisualLine { logicalLine: number; startCol: number; length: number }
export interface FakeTui {
	terminal: { columns: number; rows: number };
	renderRequests: number;
	requestRender(force?: boolean): void;
}
export interface FakeTheme {
	borderColor(text: string): string;
	selectList: Record<string, (text: string) => string>;
}

export interface NativePromptEditorInstance {
	state: EditorState;
	focused: boolean;
	tui: FakeTui;
	theme: FakeTheme;
	lastWidth: number;
	scrollOffset: number;
	renderedVisibleLineCount: number;
	lastAction: unknown;
	pastes: Map<number, string>;
	undoStack: { length: number };
	onChange?: (text: string) => void;
	onSubmit?: (text: string) => void;
	getText(): string;
	setText(text: string): void;
	handleInput(data: string): void;
	handleMouse(event: { type: string; button: string; x: number; y: number; width: number; shift?: boolean; clickCount?: number }): unknown;
	render(width: number): string[];
	buildVisualLineMap(width: number): VisualLine[];
	layoutText(width: number): Array<{ text: string; hasCursor: boolean; cursorPos?: number }>;
	segment(text: string, mode: "grapheme" | "word"): Iterable<{ segment: string; index: number }>;
	moveCursor(deltaLine: number, deltaCol: number): void;
	moveWordBackwards(): void;
	moveWordForwards(): void;
	setCursorCol(col: number): void;
	pushUndoSnapshot(): void;
	undo(): void;
	cancelAutocomplete(): void;
	exitHistoryBrowsing(): void;
	normalizeText(text: string): string;
	insertTextAtCursor?(text: string): void;
	getPaddingX(): number;
}

export type NativePromptEditorClass = new (
	tui: FakeTui,
	theme: FakeTheme,
	options?: { paddingX?: number; autocompleteMaxVisible?: number },
) => NativePromptEditorInstance;

function slice(bin: string, from: string, to: string, fromAt = 0): string {
	const start = bin.indexOf(SRC + from, fromAt);
	const end = bin.indexOf(SRC + to, start);
	if (start < 0 || end <= start) throw new Error(`Cannot locate Pi source section ${from} .. ${to}`);
	return bin.slice(start, end);
}

function requireMarkers(code: string, markers: string[], section: string): void {
	for (const marker of markers) {
		if (!code.includes(marker)) throw new Error(`Installed Pi ${section} no longer contains "${marker}"`);
	}
}

function loadNativePromptEditor() {
	const bin = fs.readFileSync(PI_BIN, "utf8");
	const utils = slice(bin, "utils.ts", "autocomplete.ts");
	const keys = slice(bin, "keys.ts", "terminal-colors.ts");
	const keybindings = slice(bin, "keybindings.ts", "components/text.ts");
	// kill-ring.ts, undo-stack.ts, word-navigation.ts, select-list.ts, editor.ts are contiguous.
	const editorStack = slice(bin, "kill-ring.ts", "layout-node.ts");
	const tuiConstants = bin.match(/CURSOR_MARKER = "[^"]*", FAKE_CURSOR_START = "[^"]*", FAKE_CURSOR_END = "[^"]*"/)?.[0];
	if (!tuiConstants) throw new Error("Cannot find Pi cursor marker constants");

	requireMarkers(utils, ["function visibleWidth(", "function isWhitespaceChar(", "var init_utils5"], "utils");
	requireMarkers(keys, ["function matchesKey(", "var init_keys"], "keys");
	requireMarkers(keybindings, ["function getKeybindings()", "var init_keybindings", '"tui.editor.undo"'], "keybindings");
	requireMarkers(editorStack, [
		"class KillRing", "class UndoStack", "function findWordBackward(", "function findWordForward(", "class SelectList",
		"function wordWrapLine(", "class Editor {", "layoutText(", "buildVisualLineMap(", "moveCursor(", "moveWordBackwards(",
		"moveWordForwards(", "pushUndoSnapshot(", "var init_editor",
	], "editor");
	if (!/^function renderFakeCursor\(text\) \{\n  return `\$\{FAKE_CURSOR_START\}\$\{text\}\$\{FAKE_CURSOR_END\}`;/m.test(bin)) {
		throw new Error("Pi renderFakeCursor changed");
	}

	const factoryCode = `
const __esm = (fn) => fn;
// utils.ts leaf imports.
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
// tui.ts stub: only what editor.ts uses.
const ${tuiConstants};
function renderFakeCursor(text) { return \`\${FAKE_CURSOR_START}\${text}\${FAKE_CURSOR_END}\`; }
const init_tui = () => {};
${utils}
${keys}
${keybindings}
${editorStack}
init_utils5();
init_keys();
init_keybindings();
init_word_navigation();
init_select_list();
init_editor();
return { Editor, CURSOR_MARKER, FAKE_CURSOR_START, FAKE_CURSOR_END, KeybindingsManager, TUI_KEYBINDINGS, setKeybindings, getKeybindings };
`;
	return new Function(factoryCode)() as {
		Editor: NativePromptEditorClass;
		CURSOR_MARKER: string;
		FAKE_CURSOR_START: string;
		FAKE_CURSOR_END: string;
		getKeybindings(): unknown;
		setKeybindings(value: unknown): void;
	};
}

const loaded = loadNativePromptEditor();

/** The installed Pi Editor class itself, unmodified (requires tui and theme). */
export const InstalledPiEditor: NativePromptEditorClass = loaded.Editor;
export const { CURSOR_MARKER, FAKE_CURSOR_START, FAKE_CURSOR_END } = loaded;

export function createFakeTui(columns = 80, rows = 40): FakeTui {
	return {
		terminal: { columns, rows },
		renderRequests: 0,
		requestRender() { this.renderRequests += 1; },
	};
}

const identity = (text: string) => text;
export function createFakeTheme(): FakeTheme {
	return {
		borderColor: identity,
		selectList: {
			selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity,
		},
	};
}

/**
 * Convenience subclass of the installed Editor: `new NativePromptEditor()`
 * works with no arguments (fake tui 80x40 and identity theme; Pi's built-in
 * default keybindings are used through getKeybindings()). All behavior and
 * private methods come from the installed class. `onChange` / `onSubmit` are
 * ordinary assignable fields; `tui` and `theme` stay accessible.
 */
export interface NativePromptEditor extends NativePromptEditorInstance {}
export class NativePromptEditor extends (InstalledPiEditor as unknown as new (...args: unknown[]) => object) {
	constructor(
		tui: FakeTui = createFakeTui(),
		theme: FakeTheme = createFakeTheme(),
		options: { paddingX?: number; autocompleteMaxVisible?: number } = {},
	) {
		super(tui, theme, options);
	}
}

/** Create a real Pi Editor with fake tui/theme. */
export function createNativePromptEditor(
	options: { columns?: number; rows?: number; paddingX?: number; text?: string; focused?: boolean } = {},
): NativePromptEditor {
	const editor = new NativePromptEditor(createFakeTui(options.columns, options.rows), createFakeTheme(), { paddingX: options.paddingX ?? 0 });
	editor.focused = options.focused ?? true;
	if (options.text !== undefined) editor.setText(options.text);
	return editor;
}

// ---------------------------------------------------------------------------
// Temporary smoke check: `bun tests/prompt-editor-host.ts`
// ---------------------------------------------------------------------------
if (import.meta.main) {
	const assert = (await import("node:assert/strict")).default;
	const strip = (line: string) => line.replace(/\x1b_pi:[^\x07]*\x07/g, "");
	const rows = (editor: NativePromptEditorInstance, width: number) => editor.render(width).map(strip);

	const editor = createNativePromptEditor({ text: "alpha beta gamma delta" });
	let wide = rows(editor, 40);
	assert.equal(wide.length, 3);
	assert.match(wide[1]!, /^alpha beta gamma delta /);
	const narrow = rows(editor, 12);
	assert.ok(narrow.length > 3, "narrow width wraps");
	const map = editor.buildVisualLineMap(editor.lastWidth);
	assert.ok(map.length > 1 && map.every((v) => v.logicalLine === 0));
	assert.equal(editor.render(12).some((line) => line.includes(CURSOR_MARKER)), true, "focused emits cursor marker");

	// Plain cursor movement on the real base (what Shift is forwarded to).
	editor.state.cursorCol = 0;
	editor.moveCursor(0, 1);
	assert.equal(editor.state.cursorCol, 1);
	editor.moveWordForwards();
	assert.equal(editor.state.cursorCol, 5);
	editor.moveWordBackwards();
	assert.equal(editor.state.cursorCol, 0);
	editor.handleInput("\x1b[C");
	assert.equal(editor.state.cursorCol, 1);
	editor.handleInput("\x1b[D");
	assert.equal(editor.state.cursorCol, 0);

	// Insert, backspace, undo.
	editor.setText("abc");
	editor.handleInput("X");
	assert.equal(editor.getText(), "abcX");
	editor.handleInput("\x7f");
	assert.equal(editor.getText(), "abc");
	editor.handleInput("\x1b[45;5u"); // ctrl+-
	assert.equal(editor.getText(), "abcX");
	editor.handleInput("\x1b[200~pasted\ntext\x1b[201~");
	assert.equal(editor.getText(), "abcXpasted\ntext");
	editor.undo();
	assert.equal(editor.getText(), "abcX");

	// No-arg construction, assignable callbacks.
	const bare = new NativePromptEditor();
	const changes: string[] = [];
	const submits: string[] = [];
	bare.onChange = (text) => changes.push(text);
	bare.onSubmit = (text) => submits.push(text);
	bare.handleInput("h");
	bare.handleInput("i");
	bare.handleInput("\r");
	assert.deepEqual(submits, ["hi"]);
	assert.ok(changes.includes("hi"));
	assert.equal(bare.getText(), ""); // real Editor clears after submit
	assert.ok(bare instanceof InstalledPiEditor);
	assert.equal(typeof (bare as unknown as { insertTextAtCursorInternal: unknown }).insertTextAtCursorInternal, "function");

	// Multiline + mouse click maps through the real visual-line map.
	const clicked = createNativePromptEditor({ text: "one\ntwo" });
	clicked.render(20);
	clicked.handleMouse({ type: "click", button: "left", x: 2, y: 2, width: 20 });
	assert.deepEqual([clicked.state.cursorLine, clicked.state.cursorCol], [1, 2]);

	console.log("prompt-editor-host smoke OK");
}
