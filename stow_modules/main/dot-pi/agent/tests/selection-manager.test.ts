import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Load the real extension source with its "@earendil-works/pi-tui" import
// redirected to the local test host (selection-manager-host.ts). The host
// provides a fake TuiAltScreen that implements the internals contract the
// extension patches, backed by the real pi-tui utilities. This avoids a
// process-wide pi-tui mock, which would fight the osc8-links test's mock
// when the whole suite runs in one Bun process.
const hostPath = join(import.meta.dir, "selection-manager-host.ts");
const { FakeAltScreen, FakeCustomEditor } = await import(pathToFileURL(hostPath).href);

const extensionPath = join(import.meta.dir, "../extensions/selection-manager.ts");
const extensionSource = fs.readFileSync(extensionPath, "utf8");
if (!extensionSource.includes('from "@earendil-works/pi-tui"')) {
	throw new Error("selection-manager.ts no longer imports pi-tui as this test expects");
}
const redirectedSource = extensionSource
	.replace('from "@earendil-works/pi-tui"', `from ${JSON.stringify(pathToFileURL(hostPath).href)}`)
	.replace('from "@earendil-works/pi-coding-agent"', `from ${JSON.stringify(pathToFileURL(hostPath).href)}`);
const redirectedPath = join(tmpdir(), `selection-manager-extension-${process.pid}.ts`);
fs.writeFileSync(redirectedPath, redirectedSource);
afterAll(() => {
	fs.rmSync(redirectedPath, { force: true });
});

const selectionManager = (await import(pathToFileURL(redirectedPath).href)).default;

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

selectionManager(fakePi);

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

describe("selection-manager extension", () => {
	test("installs the patch on session_start and restores it on session_shutdown", async () => {
		const prototype: any = FakeAltScreen.prototype;
		const originalCopy = prototype.getActiveSelectionText;
		const originalHighlight = prototype.applySelection;

		await emit("session_start");
		expect(prototype.getActiveSelectionText).not.toBe(originalCopy);
		expect(prototype.applySelection).not.toBe(originalHighlight);

		notifications.length = 0;
		await commands.get("selection-manager")!.handler("", tuiCtx);
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

		// Complete a multi-cell selection; the popup paints on the row below its end.
		screen.setSelection({ row: 1, col: 2 }, { row: 3, col: 12 });
		expect(screen.getActiveSelectionText()).toBe("| Name | Role |\n| --- | --- |\n| Alice | Admin |");
		let painted = screen.applySelection([...BASIC_TABLE]);
		expect(painted[4]).toContain("⇥ reference");

		// Tab inserts only the one-line reference and leaves the cursor on the next line.
		expect(screen.emitInput("\t")).toEqual({ consume: true });
		expect(editorText).toBe("> | Name | Role | ...\n");
		painted = screen.applySelection([...BASIC_TABLE]);
		expect(painted[4]).not.toContain("⇥ reference");

		// Repeat the selection, then click the popup on the row below instead of pressing Tab.
		screen.setSelection({ row: 1, col: 2 }, { row: 3, col: 12 });
		screen.getActiveSelectionText();
		screen.applySelection([...BASIC_TABLE]);
		screen.handleMouseEvent({ button: 0, x: 16, y: 4, release: false });
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

	test("unwraps a word split across physical lines in plain text", () => {
		// The fake screen is 30 columns wide, so a wrapped token fills the
		// first row and continues at the start of the next one.
		const screen = startScreen([
			"~/.pi/extensions/pi-permissio",
			"n-system/config.json is here",
		]);

		screen.setSelection({ row: 0, col: 0 }, { row: 1, col: 28 });

		expect(screen.getActiveSelectionText()).toBe("~/.pi/extensions/pi-permission-system/config.json is here");
	});

	test("rejoins a word-boundary wrap in plain text with one space", () => {
		const screen = startScreen(["alpha beta gamma delta epsi", "zeta theta"]);

		screen.setSelection({ row: 0, col: 0 }, { row: 1, col: 9 });

		expect(screen.getActiveSelectionText()).toBe("alpha beta gamma delta epsi zeta theta");
	});

	test("keeps authored breaks in plain text around wrapped lines", () => {
		const screen = startScreen([
			"alpha beta gamma delta epsilo",
			"- zeta theta iota kappa",
			"",
			"short line",
			"next authored line",
		]);

		// A list item after a full line, a blank line, and short authored
		// lines whose next word would have fit all stay real newlines.
		screen.setSelection({ row: 0, col: 0 }, { row: 4, col: 17 });
		expect(screen.getActiveSelectionText()).toBe(
			"alpha beta gamma delta epsilo\n- zeta theta iota kappa\n\nshort line\nnext authored line",
		);
	});

	test("copies the original Markdown source of the touched blocks", () => {
		const screen = startScreen([]);
		screen.setMarkdownTranscript([
			{
				type: "paragraph",
				raw: "**Changes** (in the dotfiles repo, live via the `~/.pi/agent` symlinks):",
				renderedLines: [" Changes in the dotfiles repo, live", " via the agent symlinks folder now"],
			},
			{
				type: "list",
				raw: "- `stow/extensions/selection-manager.ts` handles the copying behavior\n- Tests cover the behavior well",
				items: [
					{ raw: "- `stow/extensions/selection-manager.ts` handles the copying behavior" },
					{ raw: "- Tests cover the behavior well" },
				],
				renderedLines: [
					" - stow/extensions/selection-manager.ts",
					"   handles the copying behavior",
					" - Tests cover the behavior well",
				],
			},
		]);

		// The whole rendered range copies as the authored Markdown: bold and
		// inline code intact, and each bullet a single line.
		screen.setSelection({ row: 0, col: 0 }, { row: 4, col: 20 });
		expect(screen.getActiveSelectionText()).toBe(
			"**Changes** (in the dotfiles repo, live via the `~/.pi/agent` symlinks):\n\n" +
				"- `stow/extensions/selection-manager.ts` handles the copying behavior\n- Tests cover the behavior well",
		);

		// A selection touching only the first list item copies just that item,
		// as one line even though it renders on two rows.
		screen.setSelection({ row: 2, col: 2 }, { row: 3, col: 20 });
		expect(screen.getActiveSelectionText()).toBe("- `stow/extensions/selection-manager.ts` handles the copying behavior");
	});

	test("joins rendered list items into single continuous Markdown lines without source", () => {
		const screen = startScreen([
			"Intro paragraph line is here",
			" - Alpha bullet wraps a",
			"   more text and continues",
			"   onward to the end here",
			" - Beta bullet is short",
			"short tail",
			"next line",
		]);

		screen.setSelection({ row: 0, col: 0 }, { row: 6, col: 8 });

		expect(screen.getActiveSelectionText()).toBe(
			"Intro paragraph line is here\n" +
				" - Alpha bullet wraps a more text and continues onward to the end here\n" +
				" - Beta bullet is short\n" +
				"short tail\nnext line",
		);
	});

	test("reconstructs blockquote rows as Markdown quote lines", () => {
		const screen = startScreen(["│ quoted text wraps onto a", "│ second physical row here", "plain after"]);

		screen.setSelection({ row: 0, col: 0 }, { row: 2, col: 10 });

		expect(screen.getActiveSelectionText()).toBe("> quoted text wraps onto a second physical row here\nplain after");
	});

	test("copies only inner code lines from an open-tui framed code block and themes the reference popup", () => {
		const framedCode = [
			"╭─ bash ─────────── [Copy] ╮",
			"│ ls -la                   │",
			"│ echo \"a │ b\"             │",
			"╰──────────────────────────╯",
		];
		const screen = startScreen(framedCode);

		// Selection spanning from the top border through the bottom border
		// copies only the inner code lines (preserving `│` inside the code)
		// without borders, trailing padding, or `[Copy]`.
		screen.setSelection({ row: 0, col: 0 }, { row: 3, col: 27 });
		expect(screen.getActiveSelectionText()).toBe("ls -la\necho \"a │ b\"");

		// Simulate an active Pi theme where string tokens in `bg` only accept
		// `*Bg` tokens and concrete Color objects must be passed for `accent`.
		const fgColor = { kind: "rgb", r: 65, g: 69, b: 89 };
		const bgColor = { kind: "rgb", r: 202, g: 158, b: 230 };
		tuiCtx.ui.theme = {
			colors: {
				userMessageBg: fgColor,
				accent: bgColor,
			},
			style(text: string, opts: { fg?: unknown; bg?: unknown; bold?: boolean }) {
				if (typeof opts.bg === "string") {
					throw new Error(`Unknown theme color: ${opts.bg}`);
				}
				expect(opts.fg).toBe(fgColor);
				expect(opts.bg).toBe(bgColor);
				return `\x1b[1;38;2;65;69;89;48;2;202;158;230m${text}\x1b[22;49;39m`;
			},
		};
		try {
			const painted = screen.applySelection([...framedCode]);
			// Top border gets no selection highlight; the themed popup sits on the row below the last body row (row 3).
			expect(painted[0]).not.toContain("\x1b[7m");
			expect(painted[3]).not.toContain("\x1b[7m");
			// Body lines highlight only the code content.
			expect(painted[1]).toContain("\x1b[7mls -la\x1b[27m");
			expect(painted[2]).toContain("\x1b[7mecho \"a │ b\"\x1b[27m");
			expect(painted[3]).toContain("\x1b[1;38;2;65;69;89;48;2;202;158;230m ⇥ reference ");
		} finally {
			delete tuiCtx.ui.theme;
		}
	});
});
