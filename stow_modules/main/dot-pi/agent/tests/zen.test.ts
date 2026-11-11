import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const hostPath = join(import.meta.dir, "zen-host.ts");
const hostHref = pathToFileURL(hostPath).href;
const { Container, Text } = await import(hostHref);

const bundlePath = join(import.meta.dir, "../extensions/zen/bundle.js");
const bundleSource = fs.readFileSync(bundlePath, "utf8");
const redirectedSource = bundleSource
	.replaceAll('from "@earendil-works/pi-tui"', `from ${JSON.stringify(hostHref)}`)
	.replaceAll('from "@earendil-works/pi-coding-agent"', `from ${JSON.stringify(hostHref)}`);

const redirectedPath = join(tmpdir(), `zen-extension-test-${process.pid}.mjs`);
fs.writeFileSync(redirectedPath, redirectedSource);
afterAll(() => {
	fs.rmSync(redirectedPath, { force: true });
});

const {
	default: zenExtension,
	computeZenColumn,
	padZenLine,
	isZenActive,
	MIN_TEXT_WIDTH,
	MAX_SIDE_MARGIN_RATIO,
} = await import(pathToFileURL(redirectedPath).href);

describe("zen column margin sizing (computeZenColumn)", () => {
	test("has no margins when terminal width is <= 80", () => {
		expect(MIN_TEXT_WIDTH).toBe(80);
		expect(MAX_SIDE_MARGIN_RATIO).toBe(0.2);

		expect(computeZenColumn(40)).toEqual({ leftMargin: 0, rightMargin: 0, contentWidth: 40 });
		expect(computeZenColumn(60)).toEqual({ leftMargin: 0, rightMargin: 0, contentWidth: 60 });
		expect(computeZenColumn(79)).toEqual({ leftMargin: 0, rightMargin: 0, contentWidth: 79 });
		expect(computeZenColumn(80)).toEqual({ leftMargin: 0, rightMargin: 0, contentWidth: 80 });
		expect(computeZenColumn(81)).toEqual({ leftMargin: 0, rightMargin: 0, contentWidth: 81 });
	});

	test("grows margins symmetrically while preserving at least 80 characters of text width", () => {
		// At 90 cols: 10 extra cols -> 5 left, 5 right, 80 text
		expect(computeZenColumn(90)).toEqual({ leftMargin: 5, rightMargin: 5, contentWidth: 80 });
		// At 100 cols: 20 extra cols -> 10 left, 10 right, 80 text
		expect(computeZenColumn(100)).toEqual({ leftMargin: 10, rightMargin: 10, contentWidth: 80 });
		// At 120 cols: 40 extra cols -> 20 left, 20 right, 80 text (20 <= 120*0.2=24)
		expect(computeZenColumn(120)).toEqual({ leftMargin: 20, rightMargin: 20, contentWidth: 80 });
		// At 133 cols: 53 extra cols -> 26 left, 26 right, 81 text (26 <= floor(133*0.2)=26)
		expect(computeZenColumn(133)).toEqual({ leftMargin: 26, rightMargin: 26, contentWidth: 81 });
	});

	test("caps left and right margins at 20% each on wide terminals", () => {
		// At 150 cols: 20% = 30 left, 30 right, 90 text
		expect(computeZenColumn(150)).toEqual({ leftMargin: 30, rightMargin: 30, contentWidth: 90 });
		// At 200 cols: 20% = 40 left, 40 right, 120 text
		expect(computeZenColumn(200)).toEqual({ leftMargin: 40, rightMargin: 40, contentWidth: 120 });

		for (let width = 1; width <= 300; width++) {
			const layout = computeZenColumn(width);
			expect(layout.leftMargin).toBe(layout.rightMargin);
			expect(layout.leftMargin + layout.rightMargin + layout.contentWidth).toBe(width);
			expect(layout.leftMargin).toBeLessThanOrEqual(Math.floor(width * 0.2));
			if (width <= 80) {
				expect(layout.leftMargin).toBe(0);
				expect(layout.contentWidth).toBe(width);
			} else {
				expect(layout.contentWidth).toBeGreaterThanOrEqual(80);
			}
		}
	});
});

describe("padZenLine", () => {
	test("keeps empty lines empty and pads non-empty lines", () => {
		expect(padZenLine("", 10)).toBe("");
		expect(padZenLine("hello", 0)).toBe("hello");
		expect(padZenLine("hello", 4)).toBe("    hello");
	});

	test("preserves leading OSC 133 prompt zone markers before the left margin", () => {
		const oscStart = "\x1b]133;A\x07";
		const oscEnd = "\x1b]133;B\x07\x1b]133;C\x07";
		expect(padZenLine(`${oscStart}┃ prompt`, 6)).toBe(`${oscStart}      ┃ prompt`);
		expect(padZenLine(`${oscEnd}last line`, 6)).toBe(`${oscEnd}      last line`);
		expect(padZenLine(oscEnd, 6)).toBe(oscEnd);
	});
});

describe("zen extension lifecycle, centered column, and /zen command", () => {
	beforeEach(() => {
		delete (globalThis as { piZenSwitch?: unknown }).piZenSwitch;
	});

	function createHarness() {
		const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
		const eventBus = new Map<string, Array<(data: any) => void>>();
		const commands = new Map<string, { description: string; handler: (args: string, ctx: any) => Promise<void> }>();
		const widgets = new Map<string, any>();
		const notices: Array<{ text: string; level: string }> = [];
		const zenEvents: Array<{ active: boolean }> = [];
		let markdownTransformer: ((md: string, ctx: any) => string) | undefined;
		let toolRendererResolver: ((toolName: string, next: () => any) => any) | undefined;
		let headerFactory: any;
		let editorFactory: any;

		// Build a fake TUI with the 3-child documentContainer + dock containers
		const headerContainer = new Container();
		const loadedResourcesContainer = new Container();
		loadedResourcesContainer.addChild(new Text("[Context]\n  AGENTS.md"));
		const chatContainer = new Container();
		const lastClick: { x?: number; width?: number } = {};
		chatContainer.addChild({
			invalidate() {},
			render(w: number) {
				return [`chatwidth=${w}`];
			},
			handleMouse(ev: any) {
				lastClick.x = ev.x;
				lastClick.width = ev.width;
				return { handled: true };
			},
		});

		const documentContainer = new Container();
		documentContainer.addChild(headerContainer);
		documentContainer.addChild(loadedResourcesContainer);
		documentContainer.addChild(chatContainer);

		const footerContainer = new Container();
		footerContainer.addChild({
			invalidate() {},
			render(w: number) {
				return [`footer=${w}`];
			},
		});

		const tui = {
			children: [documentContainer, footerContainer],
			renderCount: 0,
			invalidate() {
				for (const c of this.children) c.invalidate?.();
			},
			requestRender() {
				this.renderCount += 1;
			},
		};

		const theme = {
			fg: (_color: string, text: string) => text,
			bg: (_color: string, text: string) => text,
			getFgAnsi: () => "\x1b[38;2;200;200;200m",
			getBgAnsi: () => "\x1b[48;2;30;30;30m",
		};

		const ui = {
			theme,
			notify(text: string, level: string) {
				notices.push({ text, level });
			},
			setHeader(factory: any) {
				headerFactory = factory;
			},
			getEditorComponent() {
				return editorFactory;
			},
			setEditorComponent(factory: any) {
				editorFactory = factory;
			},
			setWidget(key: string, factory: any) {
				const prev = widgets.get(key);
				if (prev?.dispose) prev.dispose();
				if (factory === undefined) {
					widgets.delete(key);
					return;
				}
				const mounted = typeof factory === "function" ? factory(tui, theme) : factory;
				widgets.set(key, mounted);
			},
			setWorkingMessage() {},
			setWorkingIndicator() {},
		};

		const ctx = {
			mode: "tui",
			hasUI: true,
			cwd: "/tmp/project",
			ui,
			sessionManager: {
				buildContextEntries() {
					return [];
				},
			},
		};

		const pi: any = {
			events: {
				on(name: string, fn: (data: any) => void) {
					const list = eventBus.get(name) ?? [];
					list.push(fn);
					eventBus.set(name, list);
				},
				emit(name: string, data: any) {
					for (const fn of eventBus.get(name) ?? []) fn(data);
				},
			},
			on(event: string, fn: (event: any, ctx: any) => any) {
				const list = handlers.get(event) ?? [];
				list.push(fn);
				handlers.set(event, list);
			},
			registerCommand(name: string, spec: any) {
				commands.set(name, spec);
			},
			registerMarkdownTransformer(fn: (md: string, ctx: any) => string) {
				markdownTransformer = fn;
			},
			registerToolRenderer(fn: (toolName: string, next: () => any) => any) {
				toolRendererResolver = fn;
			},
		};

		pi.events.on("zen:change", (data: { active: boolean }) => {
			zenEvents.push(data);
		});

		zenExtension(pi);

		return {
			ctx,
			tui,
			documentContainer,
			loadedResourcesContainer,
			chatContainer,
			footerContainer,
			lastClick,
			notices,
			zenEvents,
			getHeaderFactory: () => headerFactory,
			getEditorFactory: () => editorFactory,
			transformMarkdown: (md: string, mCtx: any) => markdownTransformer!(md, mCtx),
			resolveTool: (name: string, base?: any) => toolRendererResolver!(name, () => base),
			emit: async (event: string, payload: any = {}) => {
				for (const fn of handlers.get(event) ?? []) {
					await fn(payload, ctx);
				}
			},
			runZenCommand: async (args = "") => {
				await commands.get("zen")!.handler(args, ctx);
			},
		};
	}

	test("starts off by default and does not claim UI on startup", async () => {
		const h = createHarness();
		expect(isZenActive()).toBe(false);

		await h.emit("session_start", { reason: "startup" });
		expect(isZenActive()).toBe(false);
		expect(h.getHeaderFactory()).toBeUndefined();
		expect(h.zenEvents).toEqual([]);

		// At width 120, while Zen is off, documentContainer renders at full width 120 and includes loadedResources
		const lines = h.documentContainer.render(120);
		expect(lines).toEqual(["[Context]", "  AGENTS.md", "chatwidth=120"]);
	});

	test("/zen toggles Zen mode on with centered column margins and off back to native/open-tui", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });

		// Enable Zen via /zen
		await h.runZenCommand("");
		expect(isZenActive()).toBe(true);
		expect(h.zenEvents).toEqual([{ active: true }]);
		expect(h.notices.at(-1)).toEqual({ text: "Zen on", level: "info" });

		// At width 120: leftMargin = 20, rightMargin = 20, contentWidth = 80
		// loadedResourcesContainer is hidden while Zen is on
		const docLines120 = h.documentContainer.render(120);
		expect(docLines120).toEqual([`${" ".repeat(20)}chatwidth=80`]);

		const footerLines120 = h.footerContainer.render(120);
		expect(footerLines120).toEqual([`${" ".repeat(20)}footer=80`]);

		// At width 150: leftMargin = 30 (20%), rightMargin = 30 (20%), contentWidth = 90
		const docLines150 = h.documentContainer.render(150);
		expect(docLines150).toEqual([`${" ".repeat(30)}chatwidth=90`]);

		// At width 75 (< 80): no margins, contentWidth = 75
		const docLines75 = h.documentContainer.render(75);
		expect(docLines75).toEqual(["chatwidth=75"]);

		// Re-render at width 120 for mouse hit testing (leftMargin = 20, contentWidth = 80)
		h.documentContainer.render(120);

		// Click in left margin (x = 10 < 20) -> ignored
		const marginHit = h.documentContainer.handleMouse({ x: 10, y: 0, width: 120, height: 1 });
		expect(marginHit).toBeUndefined();

		// Click in right margin (x = 105 >= 20 + 80) -> ignored
		const rightMarginHit = h.documentContainer.handleMouse({ x: 105, y: 0, width: 120, height: 1 });
		expect(rightMarginHit).toBeUndefined();

		// Click inside content column (x = 25 -> localX = 5, width = 80)
		const insideHit = h.documentContainer.handleMouse({ x: 25, y: 0, width: 120, height: 1 });
		expect(insideHit).toEqual({ handled: true });
		expect(h.lastClick).toEqual({ x: 5, width: 80 });

		// User message markdown transformer adds the left rail only while Zen is active
		const userTransformed = h.transformMarkdown("Hello world", {
			messageType: "user",
			isStreaming: false,
			availableWidth: 78,
		});
		expect(userTransformed).toContain("┃\u00A0");

		// Disable Zen via /zen off
		await h.runZenCommand("off");
		expect(isZenActive()).toBe(false);
		expect(h.zenEvents).toEqual([{ active: true }, { active: false }]);
		expect(h.notices.at(-1)).toEqual({ text: "Zen off", level: "info" });

		// Restores full width and loadedResourcesContainer
		const restoredLines = h.documentContainer.render(120);
		expect(restoredLines).toEqual(["[Context]", "  AGENTS.md", "chatwidth=120"]);

		const userUntransformed = h.transformMarkdown("Hello world", {
			messageType: "user",
			isStreaming: false,
			availableWidth: 118,
		});
		expect(userUntransformed).toBe("Hello world");
	});

	test("renders compact tool rows and groups consecutive tool calls when Zen is active, and passes through when Zen is off", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });

		const nativeRenderer = {
			renderShell: "default",
			renderCall: (args: any) => new Text(`native-call:${args.path}`),
			renderResult: () => new Text("native-result"),
		};
		const readRenderer = h.resolveTool("read", nativeRenderer);

		const context1 = {
			args: { path: "/tmp/project/src/cat.ts" },
			toolCallId: "call-1",
			cwd: "/tmp/project",
			executionStarted: true,
			argsComplete: true,
			isPartial: false,
			expanded: false,
			showImages: true,
			isError: false,
			durationMs: 12,
			outputPad: 1,
			state: {},
			invalidate: () => {},
		};

		// While Zen is off, delegates to nativeRenderer without adding extra padding
		const offResult = readRenderer.renderResult(
			{ content: [{ type: "text", text: "const cat = 1;" }], details: {} },
			{ expanded: false, isPartial: false },
			h.ctx.ui.theme,
			context1,
		);
		expect(offResult.render(80)).toEqual(["native-result"]);

		// Turn Zen on
		await h.runZenCommand("on");

		// In Zen mode, renders compact tool row (` - read  src/cat.ts`)
		const onResult1 = readRenderer.renderResult(
			{ content: [{ type: "text", text: "const cat = 1;" }], details: {} },
			{ expanded: false, isPartial: false },
			h.ctx.ui.theme,
			context1,
		);
		expect(onResult1.render(80)).toEqual([" - read  src/cat.ts"]);

		// A second consecutive tool call in the same run joins the collapsible `▸ tools` group
		const context2 = {
			...context1,
			args: { path: "/tmp/project/src/dog.ts" },
			toolCallId: "call-2",
			state: {},
		};
		const onResult2 = readRenderer.renderResult(
			{ content: [{ type: "text", text: "const dog = 2;" }], details: {} },
			{ expanded: false, isPartial: false },
			h.ctx.ui.theme,
			context2,
		);
		expect(onResult1.render(80)[0]).toContain("▸ tools  2 read");
		expect(onResult2.render(80)[0]).toContain("- read  src/dog.ts");
	});
});
