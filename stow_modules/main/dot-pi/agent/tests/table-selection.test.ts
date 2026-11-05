import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Load the real extension source with its "@earendil-works/pi-tui" import
// redirected to the local test host (table-selection-host.ts). The host
// provides a fake TuiAltScreen that implements the internals contract the
// extension patches, backed by the real pi-tui utilities. This avoids a
// process-wide pi-tui mock, which would fight the osc8-links test's mock
// when the whole suite runs in one Bun process.
const hostPath = join(import.meta.dir, "table-selection-host.ts");
const { FakeAltScreen, FakeCustomEditor } = await import(pathToFileURL(hostPath).href);

const extensionPath = join(import.meta.dir, "../extensions/table-selection.ts");
const extensionSource = fs.readFileSync(extensionPath, "utf8");
if (!extensionSource.includes('from "@earendil-works/pi-tui"')) {
	throw new Error("table-selection.ts no longer imports pi-tui as this test expects");
}
const redirectedSource = extensionSource
	.replace('from "@earendil-works/pi-tui"', `from ${JSON.stringify(pathToFileURL(hostPath).href)}`)
	.replace('from "@earendil-works/pi-coding-agent"', `from ${JSON.stringify(pathToFileURL(hostPath).href)}`);
const redirectedPath = join(tmpdir(), `table-selection-extension-${process.pid}.ts`);
fs.writeFileSync(redirectedPath, redirectedSource);
afterAll(() => {
	fs.rmSync(redirectedPath, { force: true });
});

const tableSelection = (await import(pathToFileURL(redirectedPath).href)).default;

// ---------------------------------------------------------------------------
// Extension harness: capture the handlers the extension registers on `pi`.
// ---------------------------------------------------------------------------

type Handler = (event: any, ctx: any) => Promise<void> | void;

const handlers = new Map<string, Handler[]>();
const commands = new Map<string, { handler: Handler }>();
const notifications: Array<{ message: string; type?: string }> = [];

const fakePi: any = {
	on(event: string, handler: Handler) {
		const list = handlers.get(event) ?? [];
		list.push(handler);
		handlers.set(event, list);
	},
	registerCommand(name: string, config: { handler: Handler }) {
		commands.set(name, config);
	},
};

tableSelection(fakePi);

let editorText = "";
let editorFactory: ((tui: unknown, theme: unknown, keybindings: unknown) => unknown) | undefined;

const tuiCtx: any = {
	mode: "tui",
	ui: {
		notify(message: string, type?: string) {
			notifications.push({ message, type });
		},
		getEditorText() {
			return editorText;
		},
		setEditorText(text: string) {
			editorText = text;
		},
		getEditorComponent() {
			return editorFactory;
		},
		setEditorComponent(factory: typeof editorFactory) {
			editorFactory = factory;
		},
	},
};

async function emit(event: string): Promise<void> {
	for (const handler of handlers.get(event) ?? []) {
		await handler({}, tuiCtx);
	}
}

function startScreen(lines: string[]): InstanceType<typeof FakeAltScreen> {
	const screen = new FakeAltScreen();
	screen.setTranscript(lines);
	return screen;
}

const BASIC_TABLE = [
	"┌────────┬────────┐",
	"│ Name   │ Role   │",
	"├────────┼────────┤",
	"│ Alice  │ Admin  │",
	"├────────┼────────┤",
	"│ Bob    │ User   │",
	"└────────┴────────┘",
];

describe("table-selection extension", () => {
	test("installs the patch on session_start and restores it on session_shutdown", async () => {
		const prototype: any = FakeAltScreen.prototype;
		const originalCopy = prototype.getActiveSelectionText;
		const originalHighlight = prototype.applySelection;

		await emit("session_start");
		expect(prototype.getActiveSelectionText).not.toBe(originalCopy);
		expect(prototype.applySelection).not.toBe(originalHighlight);

		notifications.length = 0;
		await commands.get("table-selection")!.handler("", tuiCtx);
		expect(notifications.at(-1)?.message).toContain("active");

		await emit("session_shutdown");
		expect(prototype.getActiveSelectionText).toBe(originalCopy);
		expect(prototype.applySelection).toBe(originalHighlight);

		// Later tests need the patch; reinstall for them.
		await emit("session_start");
		expect(prototype.getActiveSelectionText).not.toBe(originalCopy);
	});

	test("keeps a selection that overshoots a table cell border inside that cell", () => {
		const screen = startScreen(BASIC_TABLE);

		// From inside the Alice cell to the border right after it (0-based columns).
		screen.setSelection({ row: 3, col: 2 }, { row: 3, col: 9 });

		expect(screen.getActiveSelectionText()).toBe("Alice");
	});

	test("copies multiple selected table cells as a Markdown table with its header", () => {
		const screen = startScreen(BASIC_TABLE);

		// From inside the Name header cell to inside the Admin cell.
		screen.setSelection({ row: 1, col: 2 }, { row: 3, col: 12 });

		expect(screen.getActiveSelectionText()).toBe("| Name | Role |\n| --- | --- |\n| Alice | Admin |");
	});

	test("copies one column as separated cells and highlights only that column", () => {
		const screen = startScreen(BASIC_TABLE);

		// Down the Role column, from the Admin cell to the User cell.
		screen.setSelection({ row: 3, col: 11 }, { row: 5, col: 11 });

		expect(screen.getActiveSelectionText()).toBe("Admin\n------\nUser");

		const painted = screen.applySelection([...BASIC_TABLE]);
		expect(painted[3]).toContain("\x1b[7mAdmin\x1b[27m");
		expect(painted[5]).toContain("\x1b[7mUser\x1b[27m");
		expect(painted[3]).not.toContain("\x1b[7mAlice");
		expect(painted[5]).not.toContain("\x1b[7mBob");
		// Separator rows between the cells get no highlight at all.
		expect(painted[4]).not.toContain("\x1b[7m");
	});

	test("keeps authored cell lines and unwraps a word split inside a bullet", () => {
		const screen = startScreen([
			"┌────────┬────────┐",
			"│ Detail │ Words  │",
			"├────────┼────────┤",
			"│ Owner: │ Alpha  │",
			"│ Steps: │ Beta   │",
			"│ - Run  │        │",
			"│ - Test │        │",
			"│ - Ship │        │",
			"├────────┼────────┤",
			"│ Steps: │ X      │",
			"│ - Buil │        │",
			"│ d      │        │",
			"│ - Run  │        │",
			"└────────┴────────┘",
		]);

		// Both columns of both body rows.
		screen.setSelection({ row: 3, col: 2 }, { row: 9, col: 11 });
		expect(screen.getActiveSelectionText()).toBe(
			"| Owner:<br>Steps:<br>- Run<br>- Test<br>- Ship | Alpha Beta |\n| Steps:<br>- Build<br>- Run | X |",
		);

		// Only the first Detail cell. Authored lines stay real newlines there.
		screen.setSelection({ row: 3, col: 2 }, { row: 7, col: 7 });
		expect(screen.getActiveSelectionText()).toBe("Owner:\nSteps:\n- Run\n- Test\n- Ship");
	});

	test("offers a reference popup and inserts the reference on Tab or popup click", async () => {
		editorText = "";
		const screen = startScreen(BASIC_TABLE);

		// Complete a multi-cell selection; the popup paints at its end.
		screen.setSelection({ row: 1, col: 2 }, { row: 3, col: 12 });
		expect(screen.getActiveSelectionText()).toBe("| Name | Role |\n| --- | --- |\n| Alice | Admin |");
		let painted = screen.applySelection([...BASIC_TABLE]);
		expect(painted[3]).toContain("⇥ reference");

		// Tab inserts only the one-line reference and leaves the cursor on the next line.
		expect(screen.emitInput("\t")).toEqual({ consume: true });
		expect(editorText).toBe("> | Name | Role | ...\n");
		painted = screen.applySelection([...BASIC_TABLE]);
		expect(painted[3]).not.toContain("⇥ reference");

		// Repeat the selection, then click the popup instead of pressing Tab.
		screen.setSelection({ row: 1, col: 2 }, { row: 3, col: 12 });
		screen.getActiveSelectionText();
		screen.applySelection([...BASIC_TABLE]);
		screen.handleMouseEvent({ button: 0, x: 16, y: 3, release: false });
		expect(screen.mouseEvents).toEqual([]);
		expect(editorText).toBe("> | Name | Role | ...\n> | Name | Role | ...\n");

		// On submit the reference lines expand to the full selected text.
		const inputHandler = handlers.get("input")![0]!;
		const result: any = await inputHandler({ text: `${editorText}Which rows are these?` }, tuiCtx);
		expect(result.action).toBe("transform");
		expect(result.text).toContain("| Name | Role |\n| --- | --- |\n| Alice | Admin |");
		expect(result.text).not.toContain("> | Name | Role | ...");
		expect(result.text).toContain("Which rows are these?");
	});

	test("renders references as highlighted blocks that cannot be edited, only removed", async () => {
		const keybindings = {
			matches: (data: string, action: string) => action === "tui.input.submit" && data === "\r",
		};
		const editor: any = editorFactory!(undefined, undefined, keybindings);
		expect(editor).toBeInstanceOf(FakeCustomEditor);

		const seedReference = () => {
			editorText = "";
			const screen = startScreen(BASIC_TABLE);
			screen.setSelection({ row: 1, col: 2 }, { row: 3, col: 12 });
			screen.getActiveSelectionText();
			screen.applySelection([...BASIC_TABLE]);
			screen.emitInput("\t");
		};
		const referenceLine = "> | Name | Role | ...";

		seedReference();
		expect(editorText).toBe(`${referenceLine}\n`);
		editor.setText(`${editorText}draft prompt`);

		// The reference line renders grayed out over its text only, italic
		// gray with a vertical bar like a quoted line in the transcript.
		const rendered = editor.render(40);
		expect(rendered[0]).toContain("\x1b[3;38;5;245m");
		expect(rendered[0]).toContain("│ > | Name | Role | ...");
		expect(rendered[0]!.replace(/\x1b\[[0-9;]*m/g, "")).toBe("│ > | Name | Role | ...");
		expect(rendered[1]).not.toContain("\x1b[3;38;5;245m");

		// Typing while the cursor is on the block changes nothing.
		editor.cursorLine = 0;
		editor.cursorCol = 4;
		editor.handleInput("x");
		expect(editor.getText()).toBe(`${referenceLine}\ndraft prompt`);

		// Backspace on the block removes the whole block.
		editor.handleInput("\x7f");
		expect(editor.getText()).toBe("draft prompt");

		// Backspace at the start of the line below the block also removes it.
		seedReference();
		editor.setText(`${editorText}draft prompt`);
		editor.cursorLine = 1;
		editor.cursorCol = 0;
		editor.handleInput("\x7f");
		expect(editor.getText()).toBe("draft prompt");

		// A removed reference no longer expands on submit.
		const inputHandler = handlers.get("input")![0]!;
		const result: any = await inputHandler({ text: "draft prompt" }, tuiCtx);
		expect(result.action).toBe("continue");
	});

	test("keeps the built-in plain text copy outside tables", () => {
		const screen = startScreen(["alpha", "beta", "gamma"]);

		screen.setSelection({ row: 0, col: 0 }, { row: 1, col: 3 });

		expect(screen.getActiveSelectionText()).toBe("alpha\nbeta");
	});
});
