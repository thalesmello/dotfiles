import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Load the real extension source with its pi-tui / pi-coding-agent imports
// redirected to the local test host, which provides a fake Markdown and a
// fake TuiAltScreen backed by the real pi-tui utilities.
const hostPath = join(import.meta.dir, "code-block-copy-host.ts");
const host = await import(pathToFileURL(hostPath).href);
const { FakeAltScreen, Markdown, plainTheme } = host;
const strip = host.stripTerminalSequences as (text: string) => string;

const extensionPath = join(import.meta.dir, "../extensions/code-block-copy.ts");
const extensionSource = fs.readFileSync(extensionPath, "utf8");
for (const specifier of ['from "@earendil-works/pi-coding-agent"', 'from "@earendil-works/pi-tui"']) {
	if (!extensionSource.includes(specifier)) {
		throw new Error(`code-block-copy.ts no longer imports ${specifier} as this test expects`);
	}
}
const redirectedSource = extensionSource
	.replaceAll('from "@earendil-works/pi-coding-agent"', `from ${JSON.stringify(pathToFileURL(hostPath).href)}`)
	.replaceAll('from "@earendil-works/pi-tui"', `from ${JSON.stringify(pathToFileURL(hostPath).href)}`);
const redirectedPath = join(tmpdir(), `code-block-copy-extension-${process.pid}.ts`);
fs.writeFileSync(redirectedPath, redirectedSource);
afterAll(() => {
	fs.rmSync(redirectedPath, { force: true });
});

const codeBlockCopy = (await import(pathToFileURL(redirectedPath).href)).default;

// ---------------------------------------------------------------------------
// Extension harness
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

codeBlockCopy(fakePi);

const tuiCtx: any = {
	mode: "tui",
	ui: {
		notify(message: string, type?: string) {
			notifications.push({ message, type });
		},
	},
};

async function emit(event: string): Promise<void> {
	for (const handler of handlers.get(event) ?? []) {
		await handler({}, tuiCtx);
	}
}

const CODE = "const x = 1;\nconsole.log(x);";

function renderTranscript(): string[] {
	const markdown = new Markdown("", plainTheme);
	const lines = markdown.renderToken({ type: "code", lang: "ts", text: CODE }, 40, "paragraph");
	const paragraph = markdown.renderToken({ type: "paragraph", text: "after" }, 40, undefined);
	return [...lines, ...paragraph];
}

describe("code-block-copy extension", () => {
	test("installs the patches on session_start and restores them on session_shutdown", async () => {
		const markdownPrototype: any = Markdown.prototype;
		const altPrototype: any = FakeAltScreen.prototype;
		const origRender = markdownPrototype.renderToken;
		const origCopy = altPrototype.getActiveSelectionText;
		const origHighlight = altPrototype.applySelection;
		const origMouse = altPrototype.handleSelectionMouseEvent;

		await emit("session_start");
		expect(markdownPrototype.renderToken).not.toBe(origRender);
		expect(altPrototype.getActiveSelectionText).not.toBe(origCopy);
		expect(altPrototype.applySelection).not.toBe(origHighlight);
		expect(altPrototype.handleSelectionMouseEvent).not.toBe(origMouse);

		notifications.length = 0;
		await commands.get("code-copy")!.handler("", tuiCtx);
		expect(notifications.at(-1)?.message).toContain("active");

		await emit("session_shutdown");
		expect(markdownPrototype.renderToken).toBe(origRender);
		expect(altPrototype.getActiveSelectionText).toBe(origCopy);
		expect(altPrototype.applySelection).toBe(origHighlight);
		expect(altPrototype.handleSelectionMouseEvent).toBe(origMouse);

		// Later tests need the patches; reinstall for them.
		await emit("session_start");
		expect(markdownPrototype.renderToken).not.toBe(origRender);
	});

	test("renders highlighted code on a background panel with a copy button under the closing fence", () => {
		const raw = renderTranscript();
		const lines = raw.map((line) => strip(line));

		// Fences and code lines sit on the distinguished background (the
		// plain test theme yields no probeable colour, so the dark-theme
		// background is used); the button below the block, the separator,
		// and the following paragraph do not.
		for (const index of [0, 1, 2, 3]) {
			expect(raw[index]).toContain("\x1b[48;5;236m");
		}
		expect(raw[4]).not.toContain("\x1b[48;5;236m");
		expect(raw[5]).not.toContain("\x1b[48;5;");
		expect(raw[6]).not.toContain("\x1b[48;5;");
		// The button is a UI chip: the plain test theme yields no probeable
		// accent, so it gets the fallback filled background and bold text,
		// distinct from the panel background around it.
		expect(raw[4]).toContain("\x1b[48;5;62m");
		expect(raw[4]).toContain("\x1b[1m");

		expect(lines[0]).toBe("```ts");
		// Theme-provided syntax highlighting is kept.
		expect(lines[1]).toBe("  HL:const x = 1;");
		expect(lines[2]).toBe("  HL:console.log(x);");
		expect(lines[3]).toBe("```");
		expect(lines[4]).toContain("⧉ Copy");
		expect(lines[5]).toBe("");
		expect(lines[6]).toBe("after");
	});

	test("falls back to pi's highlighter when the theme provides none", () => {
		const theme = { ...plainTheme, highlightCode: undefined };
		const markdown = new Markdown("", theme);
		const lines = markdown
			.renderToken({ type: "code", lang: "ts", text: CODE }, 40, undefined)
			.map((line: string) => strip(line));

		expect(lines[1]).toBe("  FB:const x = 1;");
		expect(lines.at(-1)).toContain("⧉ Copy");
	});

	test("clicking the button copies the block's exact original contents", async () => {
		const screen = new FakeAltScreen();
		screen.setTranscript(renderTranscript());

		// Button is on row 4; press and release on the same cell inside it.
		const buttonRow = 4;
		const buttonCol = strip(renderTranscript()[buttonRow]!).indexOf("Copy");
		screen.handleSelectionMouseEvent({ button: 0, x: buttonCol, y: buttonRow });
		screen.handleSelectionMouseEvent({ button: 3, x: buttonCol, y: buttonRow, release: true });

		// Exact source: no highlighting markers, indent, fences, or button.
		expect(screen.clipboard).toEqual([CODE]);
		expect(screen.flashes).toEqual(["Copied!"]);
		expect(screen.getSelectionBounds()).toBeUndefined();
	});

	test("clicking code (not the button) copies nothing", () => {
		const screen = new FakeAltScreen();
		screen.setTranscript(renderTranscript());

		screen.handleSelectionMouseEvent({ button: 0, x: 3, y: 1 });
		screen.handleSelectionMouseEvent({ button: 3, x: 3, y: 1, release: true });

		expect(screen.clipboard).toEqual([]);
	});

	test("a selection covering the button excludes it from the copied text", () => {
		const screen = new FakeAltScreen();
		const lines = renderTranscript();
		screen.setTranscript(lines);

		// From the first code line through the paragraph after the button.
		screen.setSelection({ row: 1, col: 2 }, { row: 6, col: 4 });

		const text = screen.getActiveSelectionText()!;
		expect(text).toContain("HL:const x = 1;");
		expect(text).toContain("after");
		expect(text).not.toContain("Copy");
		expect(text).not.toContain("⧉");
	});

	test("a selection of only the button copies nothing and its glyphs disappear", () => {
		const screen = new FakeAltScreen();
		const lines = renderTranscript();
		screen.setTranscript(lines);

		screen.setSelection({ row: 4, col: 2 }, { row: 4, col: 13 });

		expect(screen.getActiveSelectionText()).toBeUndefined();

		const painted = screen.applySelection([...lines]);
		expect(strip(painted[4]!)).not.toContain("Copy");
		expect(strip(painted[4]!)).not.toContain("⧉");
		// The line itself is still there, just blank where the button was.
		expect(painted[4]).toContain("\x1b[7m");
	});

	test("a selection elsewhere leaves the button visible", () => {
		const screen = new FakeAltScreen();
		const lines = renderTranscript();
		screen.setTranscript(lines);

		screen.setSelection({ row: 6, col: 0 }, { row: 6, col: 4 });

		const painted = screen.applySelection([...lines]);
		expect(strip(painted[4]!)).toContain("⧉ Copy");
		expect(strip(painted[6]!)).toContain("after");
	});

	test("keeps the built-in plain text copy outside code blocks", () => {
		const screen = new FakeAltScreen();
		screen.setTranscript(["alpha", "beta", "gamma"]);

		screen.setSelection({ row: 0, col: 0 }, { row: 1, col: 3 });

		expect(screen.getActiveSelectionText()).toBe("alpha\nbeta");
	});
});
