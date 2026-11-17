import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pi-side-channel-tests-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function loadExtension(name: string) {
	const result = await Bun.build({
		entrypoints: [join(import.meta.dir, `../extensions/${name}.ts`)],
		target: "bun",
		format: "esm",
		plugins: [{
			name: "local-ui-host",
			setup(build) {
				build.onResolve({ filter: /^@earendil-works\/pi-(coding-agent|tui)$/ }, () => ({
					path: join(import.meta.dir, "side-channel-host.ts"),
				}));
			},
		}],
	});
	if (!result.success) throw new Error(result.logs.join("\n"));
	const file = join(directory, `${name.replaceAll("/", "-")}.mjs`);
	writeFileSync(file, await result.outputs[0].text());
	return import(file);
}

function createHarness(extension: (pi: any) => unknown, messages = [{ role: "user", content: "Fix src/auth.ts" }]) {
	const commands = new Map<string, any>();
	const renderers = new Map<string, any>();
	const events = new Map<string, any>();
	const entries: any[] = [];
	const notifications: Array<{ message: string; level: string }> = [];
	const statuses: any[] = [];
	const requests: any[] = [];
	const pi = {
		registerCommand: (name: string, spec: any) => commands.set(name, spec),
		registerEntryRenderer: (name: string, render: any) => renderers.set(name, render),
		on: (event: string, handler: any) => events.set(event, handler),
		appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
		sendMessage: () => { throw new Error("Must not add model-context messages"); },
		sendUserMessage: () => { throw new Error("Must not start a normal turn"); },
	};
	const ctx: any = {
		mode: "rpc", hasUI: true, model: { provider: "test", id: "current-model" },
		ui: {
			notify: (message: string, level: string) => notifications.push({ message, level }),
			setStatus: (key: string, value: unknown) => statuses.push({ key, value }),
			custom: async (factory: any) => new Promise((resolve) => {
				factory({}, {}, {}, resolve);
			}),
		},
		sessionManager: {
			buildSessionProjection: () => ({ messages }),
			getBranch: () => messages.map((message) => ({ type: "message", message })),
		},
		modelRegistry: {
			complete: async (...args: any[]) => {
				requests.push(args);
				return { stopReason: "stop", content: [{ type: "text", text: "A private answer" }] };
			},
		},
	};
	const ready = Promise.resolve(extension(pi));
	return { ctx, commands, renderers, events, entries, notifications, statuses, requests, ready,
		async run(name: string, args = "") { await ready; await commands.get(name).handler(args, ctx); },
	};
}

const recap = await loadExtension("recap");

describe("recap side-channel", () => {
	test("uses the current model and projected context without starting a main turn", async () => {
		const h = createHarness(recap.default);
		await h.run("recap", "testing and blockers");
		expect(h.requests).toHaveLength(1);
		expect(h.requests[0][0]).toBe(h.ctx.model);
		expect(h.requests[0][1].messages[0].content[0].text).toContain("Fix src/auth.ts");
		expect(h.requests[0][1].messages[0].content[0].text).toContain("Focus: testing and blockers");
		expect(h.requests[0][1].tools).toBeUndefined();
		expect(h.requests[0][2].signal).toBeInstanceOf(AbortSignal);
	});

	test("defaults to recapping the whole session", async () => {
		const h = createHarness(recap.default);
		await h.run("recap");
		expect(h.requests[0][1].messages[0].content[0].text).toContain("Focus: the whole current session");
	});

	test("empty history needs no model request", async () => {
		const h = createHarness(recap.default, []);
		await h.run("recap");
		expect(h.requests).toHaveLength(0);
		expect(h.entries).toHaveLength(0);
		expect(h.notifications[0].message).toContain("No substantive session history");
	});

	test("missing model and non-UI modes do not make requests", async () => {
		const h = createHarness(recap.default);
		h.ctx.model = undefined;
		await h.run("recap");
		expect(h.notifications[0].message).toBe("No model selected");
		h.ctx.hasUI = false;
		await h.run("recap");
		expect(h.requests).toHaveLength(0);
	});

	test("provider failures are reported and the status is cleared", async () => {
		const h = createHarness(recap.default);
		h.ctx.modelRegistry.complete = async () => ({ stopReason: "error", errorMessage: "Provider unavailable", content: [] });
		await h.run("recap");
		expect(h.notifications.at(-1)).toEqual({ message: "/recap failed: Provider unavailable", level: "error" });
		expect(h.entries).toHaveLength(0);
		expect(h.statuses.at(-1)).toEqual({ key: "recap", value: undefined });
	});

	test("shutdown aborts a private request without publishing stale results", async () => {
		const h = createHarness(recap.default);
		let finish!: (value: unknown) => void;
		let signal!: AbortSignal;
		h.ctx.modelRegistry.complete = async (_model: any, _context: any, options: any) => {
			signal = options.signal;
			return new Promise((resolve) => { finish = resolve; });
		};
		const running = h.run("recap");
		await h.ready;
		await Promise.resolve();
		h.events.get("session_shutdown")();
		expect(signal.aborted).toBe(true);
		finish({ stopReason: "stop", content: [{ type: "text", text: "Stale recap" }] });
		await running;
		expect(h.entries).toHaveLength(0);
		expect(h.notifications).toHaveLength(0);
	});
});

const btw = await loadExtension("btw");
const panel = await loadExtension("lib/side-channel-panel");
const scroll = await loadExtension("follow-on-send");

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
const keybindings = {
	matches: (data: string, action: string) => data === ({
		"tui.select.confirm": "enter", "tui.select.cancel": "escape",
		"tui.select.up": "up", "tui.select.down": "down",
	} as Record<string, string>)[action],
};

function capturePanel(rows = 40) {
	let component: any;
	let renders = 0;
	const ctx: any = { mode: "tui", hasUI: true, ui: {
		custom: (factory: any) => new Promise((resolve) => {
			component = factory({ terminal: { rows }, requestRender: () => { renders++; } }, theme, keybindings, resolve);
		}),
	} };
	return { ctx, get component() { return component; }, get renders() { return renders; } };
}

describe("disposable side-channel panels", () => {
	test("shrinks gradually on history scroll, to three content lines, and expands at the tail", async () => {
		const h = capturePanel();
		const answer = Array.from({ length: 60 }, (_, i) => `Answer line ${i}`).join("\n");
		const showing = panel.showSideChannelAnswer("/recap", "", answer, h.ctx);
		const fullHeight = h.component.render(80).length;
		expect(scroll.applyTranscriptScrollDelta(-2)).toBe(2);
		expect(h.component.render(80).length).toBe(fullHeight - 2);
		scroll.applyTranscriptScrollDelta(-100, true);
		expect(h.component.render(80).length).toBe(7); // three content lines + title, help, borders
		expect(scroll.applyTranscriptScrollDelta(5, false, 100)).toBe(0); // still reading older history
		scroll.applyTranscriptScrollDelta(5, false, 0);
		expect(h.component.render(80).length).toBe(12);
		h.component.handleInput("up");
		expect(h.component.render(80).length).toBe(fullHeight);
		expect(h.renders).toBeGreaterThan(0);
		h.component.handleInput("enter");
		await showing;
		expect(scroll.getScrollCollapseStore().questionnaireTarget).toBeUndefined();
	});

	test("long answers can be read to the end, and narrow rendering stays within width", async () => {
		const h = capturePanel();
		const answer = Array.from({ length: 60 }, (_, i) => `Answer line ${i}`).join("\n");
		const showing = panel.showSideChannelAnswer("/btw", "Question", answer, h.ctx);
		h.component.render(80);
		for (let i = 0; i < 100; i++) { h.component.handleInput("down"); h.component.render(80); }
		expect(h.component.render(80).join("\n")).toContain("Answer line 59");
		for (const width of [1, 4, 12, 80]) {
			expect(h.component.render(width).every((line: string) => line.length <= width)).toBe(true);
		}
		h.component.handleInput("escape");
		await showing;
	});

	test("wheel over a collapsed panel expands first, then reads down and up with boundary clamping", async () => {
		const h = capturePanel();
		const answer = Array.from({ length: 60 }, (_, i) => `Answer line ${i}`).join("\n");
		const showing = panel.showSideChannelAnswer("/recap", "", answer, h.ctx);
		const fullHeight = h.component.render(80).length;
		scroll.applyTranscriptScrollDelta(-100, true);
		const collapsed = h.component.render(80);
		expect(collapsed.length).toBe(7);
		const rendersBefore = h.renders;
		expect(h.component.handleMouse({ type: "wheel", wheelDelta: 3 })).toEqual({ handled: true, render: false });
		expect(h.renders).toBe(rendersBefore + 1);
		const expanded = h.component.render(80);
		expect(expanded.length).toBe(fullHeight);
		expect(expanded.join("\n")).toContain("Answer line 0"); // initial expansion does not move the body
		expect(expanded.join("\n")).not.toContain("above");

		expect(h.component.handleMouse({ type: "wheel", wheelDelta: 3 })?.handled).toBe(true);
		expect(h.component.render(80).join("\n")).toContain("↑ 3 above");
		expect(h.component.handleMouse({ type: "wheel", wheelDelta: -1 })?.handled).toBe(true);
		expect(h.component.render(80).join("\n")).toContain("↑ 2 above");

		const rendersAfterMoves = h.renders;
		for (const wheelDelta of [0, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
			expect(h.component.handleMouse({ type: "wheel", wheelDelta })).toEqual({ handled: true, render: false });
		}
		expect(h.renders).toBe(rendersAfterMoves);

		h.component.handleMouse({ type: "wheel", wheelDelta: -1000 });
		h.component.render(80);
		const top = h.renders;
		expect(h.component.handleMouse({ type: "wheel", wheelDelta: -1 })?.handled).toBe(true);
		expect(h.renders).toBe(top);
		h.component.handleMouse({ type: "wheel", wheelDelta: 1000 });
		const bottom = h.component.render(80).join("\n");
		expect(bottom).toContain("Answer line 59");
		const bottomRenders = h.renders;
		expect(h.component.handleMouse({ type: "wheel", wheelDelta: 1 })?.handled).toBe(true);
		expect(h.renders).toBe(bottomRenders);
		expect(h.component.handleMouse({ type: "press" })).toBeUndefined();

		h.component.render(80);
		h.component.handleInput("enter");
		await showing;
		expect(scroll.getScrollCollapseStore().questionnaireTarget).toBeUndefined();
	});

	test("wheel scroll offset is clamped after width resize", async () => {
		const h = capturePanel();
		const answer = Array.from({ length: 60 }, (_, i) => `Answer line ${i}`).join("\n");
		const showing = panel.showSideChannelAnswer("/btw", "Q", answer, h.ctx);
		h.component.render(40);
		h.component.handleMouse({ type: "wheel", wheelDelta: 1000 });
		expect(h.component.render(40).join("\n")).toContain("Answer line 59");
		expect(h.component.render(120).join("\n")).toContain("Answer line 59");
		h.component.handleMouse({ type: "wheel", wheelDelta: -1000 });
		expect(h.component.render(120).join("\n")).toContain("Answer line 0");
		h.component.handleInput("escape");
		await showing;
	});

	test("closing restores the prior dock collapse target", async () => {
		const store = scroll.getScrollCollapseStore();
		const prior = { maxCollapseLines: 4, onCollapseChange() {} };
		store.questionnaireTarget = prior;
		store.collapseLines = 2;
		const h = capturePanel();
		const showing = panel.showSideChannelAnswer("/recap", "", "A recap", h.ctx);
		expect(store.questionnaireTarget).not.toBe(prior);
		h.component.handleInput("enter");
		await showing;
		expect(store.questionnaireTarget).toBe(prior);
		expect(store.collapseLines).toBe(2);
		store.questionnaireTarget = undefined;
		store.collapseLines = 0;
	});

	test("closing re-expands and invalidates the underlying prompt editor", async () => {
		const store = scroll.getScrollCollapseStore();
		let invalidations = 0;
		store.editorTarget = { maxCollapseLines: 4, onCollapseChange: () => { invalidations++; } };
		store.collapseLines = 2;
		const h = capturePanel();
		const showing = panel.showSideChannelAnswer("/recap", "", "A recap", h.ctx);
		h.component.handleInput("enter");
		await showing;
		expect(store.collapseLines).toBe(0);
		expect(invalidations).toBe(1);
		store.editorTarget = undefined;
	});

	test("very short terminals keep the panel within the available rows", async () => {
		for (const rows of [1, 2, 4, 6, 8, 40]) {
			const h = capturePanel(rows);
			const showing = panel.showSideChannelAnswer("/recap", "", "A long answer\n".repeat(60), h.ctx);
			expect(h.component.render(12).length).toBeLessThanOrEqual(rows);
			h.component.handleInput("enter");
			await showing;
		}
	});

	test("cancelling the recap loader aborts its request and does not open an answer panel", async () => {
		const h = createHarness(recap.default);
		h.ctx.mode = "tui";
		let signal!: AbortSignal;
		h.ctx.modelRegistry.complete = (_model: any, _context: any, options: any) => {
			signal = options.signal;
			return new Promise(() => {});
		};
		h.ctx.ui.custom = (factory: any) => new Promise((resolve) => {
			const loader = factory({ terminal: { rows: 40 }, requestRender() {} }, theme, keybindings, resolve);
			expect(typeof loader.abort).toBe("function");
			loader.abort();
		});
		await h.run("recap");
		expect(signal.aborted).toBe(true);
		expect(h.notifications).toEqual([{ message: "/recap cancelled or timed out", level: "warning" }]);
		expect(h.statuses.at(-1)).toEqual({ key: "recap", value: undefined });
		expect(h.entries).toHaveLength(0);
	});

	test.each(["btw", "recap"])("/%s opens the disposable panel without saving any conversation entries", async (command) => {
		const h = createHarness(command === "btw" ? btw.default : recap.default);
		h.ctx.mode = "tui";
		const panels: any[] = [];
		h.ctx.ui.custom = (factory: any) => new Promise((resolve) => {
			const component = factory({ terminal: { rows: 40 }, requestRender() {} }, theme, keybindings, resolve);
			if (typeof component.render === "function") {
				if (command === "recap") expect(h.statuses.at(-1)).toEqual({ key: "recap", value: undefined });
				panels.push(component.render(80));
				expect(component.handleMouse({ type: "wheel", wheelDelta: 1 })?.handled).toBe(true);
				component.handleInput("enter");
			}
		});
		await h.run(command, command === "btw" ? "What changed?" : "");
		expect(panels).toHaveLength(1);
		expect(panels[0].join("\n")).toContain("A private answer");
		expect(panels[0].join("\n")).toContain(`/${command}`);
		expect(h.entries).toHaveLength(0);
		expect(h.requests).toHaveLength(1);
	});
});
