import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Load the real extension source with its imports redirected to the
// local test host (a fake pi-tui Editor).
const hostPath = join(import.meta.dir, "insert-caret-host.ts");
const host = await import(pathToFileURL(hostPath).href);
const { Editor } = host;

const extensionPath = join(import.meta.dir, "../extensions/insert-caret.ts");
const extensionSource = fs.readFileSync(extensionPath, "utf8");
const redirectedSource = extensionSource
	.replaceAll('from "@earendil-works/pi-coding-agent"', `from ${JSON.stringify(pathToFileURL(hostPath).href)}`)
	.replaceAll('from "@earendil-works/pi-tui"', `from ${JSON.stringify(pathToFileURL(hostPath).href)}`);
if (redirectedSource === extensionSource) {
	throw new Error("insert-caret.ts imports changed; test redirection is stale");
}
const redirectedPath = join(tmpdir(), `insert-caret-extension-${process.pid}.ts`);
fs.writeFileSync(redirectedPath, redirectedSource);
afterAll(() => {
	fs.rmSync(redirectedPath, { force: true });
});

const insertCaret = (await import(pathToFileURL(redirectedPath).href)).default;

// ---------------------------------------------------------------------------
// Harness
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

insertCaret(fakePi);

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

class FakeTui {
	writes: string[] = [];
	hardwareCursor = false;
	terminal = {
		write: (data: string) => {
			this.writes.push(data);
		},
	};

	getShowHardwareCursor(): boolean {
		return this.hardwareCursor;
	}

	setShowHardwareCursor(enabled: boolean): void {
		this.hardwareCursor = enabled;
	}

	requestRender(): void {}
}

describe("insert-caret extension", () => {
	test("patches Editor.render on session_start and restores it (plus cursor shape) on shutdown", async () => {
		const prototype: any = Editor.prototype;
		const originalRender = prototype.render;

		await emit("session_start");
		expect(prototype.render).not.toBe(originalRender);

		notifications.length = 0;
		await commands.get("insert-caret")!.handler("", tuiCtx);
		expect(notifications.at(-1)?.message).toContain("active");

		await emit("session_shutdown");
		expect(prototype.render).toBe(originalRender);

		// Later tests need the patch; reinstall for them.
		await emit("session_start");
		expect(prototype.render).not.toBe(originalRender);
	});

	test("an editor render switches the TUI to a hardware bar cursor without changing lines", () => {
		const tui = new FakeTui();
		const editor = new Editor(tui, {});

		const lines = editor.render(40);
		// Lines are the base editor's own (the real cursor replaces the
		// drawn block downstream in pi's TUI, not by editing lines here).
		expect(lines[1]).toContain("hello");
		expect(lines[1]).toContain("world".slice(1));
		// The hardware cursor is on and its shape set to a steady bar.
		expect(tui.hardwareCursor).toBe(true);
		expect(tui.writes).toEqual(["\x1b[6 q"]);

		// An immediate second render does not spam the shape sequence.
		editor.render(40);
		expect(tui.writes).toEqual(["\x1b[6 q"]);
	});

	test("restores the default cursor shape on shutdown", async () => {
		const tui = new FakeTui();
		const editor = new Editor(tui, {});
		editor.render(40);
		expect(tui.writes).toEqual(["\x1b[6 q"]);

		await emit("session_shutdown");
		expect(tui.writes).toEqual(["\x1b[6 q", "\x1b[0 q"]);

		// Reinstall for any later tests.
		await emit("session_start");
	});
});
