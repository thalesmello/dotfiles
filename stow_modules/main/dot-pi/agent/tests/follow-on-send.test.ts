import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Load the real extension source with its "@earendil-works/pi-tui" import
// redirected to the local test host (follow-on-send-host.ts). The host
// provides a fake ScrollView with the real follow-end semantics. This
// avoids a process-wide pi-tui mock, which would fight the questionnaire
// and osc8-links tests' mocks when the whole suite runs in one Bun process.
const hostPath = join(import.meta.dir, "follow-on-send-host.ts");
const { FakeEditor, FakeScrollView } = await import(pathToFileURL(hostPath).href);

const extensionPath = join(import.meta.dir, "../extensions/follow-on-send.ts");
const extensionSource = fs.readFileSync(extensionPath, "utf8");
if (!extensionSource.includes('from "@earendil-works/pi-tui"')) {
	throw new Error("follow-on-send.ts no longer imports pi-tui as this test expects");
}
const redirectedSource = extensionSource.replace(
	'from "@earendil-works/pi-tui"',
	`from ${JSON.stringify(pathToFileURL(hostPath).href)}`,
);
const redirectedPath = join(tmpdir(), `follow-on-send-extension-${process.pid}.ts`);
fs.writeFileSync(redirectedPath, redirectedSource);
afterAll(() => {
	fs.rmSync(redirectedPath, { force: true });
});

const {
	default: followOnSend,
	NEAR_END_LINES,
	findLastMessageStartRow,
	snapToEndIfNearEnd,
} = await import(pathToFileURL(redirectedPath).href);

// ---------------------------------------------------------------------------
// Extension harness: capture the handlers the extension registers on `pi`.
// ---------------------------------------------------------------------------

type Handler = (event: any, ctx: any) => Promise<any> | any;

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

followOnSend(fakePi);

const tuiCtx: any = {
	mode: "tui",
	ui: {
		notify(message: string, type?: string) {
			notifications.push({ message, type });
		},
	},
};

async function emit(event: string, eventData: any = {}, ctx: any = tuiCtx): Promise<any> {
	let result: any;
	for (const handler of handlers.get(event) ?? []) {
		result = await handler(eventData, ctx);
	}
	return result;
}

function startTranscript(lineCount = 30, viewportHeight = 5): FakeScrollView {
	const view = new FakeScrollView({ follow: "end", primary: true });
	view.updateLayout(lineCount, viewportHeight, () => {});
	return view;
}

describe("snapToEndIfNearEnd", () => {
	test("snaps within the threshold and reports following state", () => {
		let scrollToEndCalls = 0;
		const view = {
			primary: true,
			followEnd: true,
			scrollTop: 20,
			isFollowingEnd: false,
			scrollToEnd() {
				scrollToEndCalls += 1;
				this.scrollTop = 25;
				this.isFollowingEnd = true;
			},
		};
		expect(snapToEndIfNearEnd(view, { contentHeight: 30, viewportHeight: 5 })).toBe(true);
		expect(scrollToEndCalls).toBe(1);
		expect(view.scrollTop).toBe(25);
	});

	test("keeps the position beyond the threshold", () => {
		const view = {
			primary: true,
			followEnd: true,
			scrollTop: 14,
			isFollowingEnd: false,
			scrollToEnd() {
				throw new Error("must not snap");
			},
		};
		// 11 lines hidden below the viewport: one past the default threshold.
		expect(snapToEndIfNearEnd(view, { contentHeight: 30, viewportHeight: 5 })).toBe(false);
		expect(view.scrollTop).toBe(14);
	});

	test("honors a custom threshold and never snaps without follow-end", () => {
		const base = {
			primary: true,
			scrollTop: 19,
			isFollowingEnd: false,
			scrollToEnd() {
				this.scrollTop = 25;
				this.isFollowingEnd = true;
			},
		};
		const custom = { ...base, followEnd: true };
		expect(snapToEndIfNearEnd(custom, { contentHeight: 30, viewportHeight: 5 }, 3)).toBe(false);
		expect(snapToEndIfNearEnd(custom, { contentHeight: 30, viewportHeight: 5 }, 6)).toBe(true);

		const noFollow = { ...base, followEnd: false };
		expect(snapToEndIfNearEnd(noFollow, { contentHeight: 30, viewportHeight: 5 }, 100)).toBe(false);
	});

	test("an already-following view stays following without a snap", () => {
		let scrollToEndCalls = 0;
		const view = {
			primary: true,
			followEnd: true,
			scrollTop: 25,
			isFollowingEnd: true,
			scrollToEnd() {
				scrollToEndCalls += 1;
			},
		};
		expect(snapToEndIfNearEnd(view, { contentHeight: 30, viewportHeight: 5 })).toBe(true);
		expect(scrollToEndCalls).toBe(0);
	});
	test("snaps when scrolled within one viewportHeight of the tail", () => {
		let snapped = false;
		const view = {
			primary: true,
			followEnd: true,
			// 200-line transcript in a 35-line viewport (maxScrollTop = 165);
			// user scrolled up 35 lines to row 130 (within one viewportHeight of the tail).
			scrollTop: 130,
			isFollowingEnd: false,
			scrollToEnd() {
				snapped = true;
				this.scrollTop = 165;
				this.isFollowingEnd = true;
			},
		};
		expect(
			snapToEndIfNearEnd(view, {
				contentHeight: 200,
				viewportHeight: 35,
			}),
		).toBe(true);
		expect(snapped).toBe(true);
		expect(view.scrollTop).toBe(165);
	});

	test("keeps position when scrolled more than one viewportHeight above the tail even inside a long recent message", () => {
		const view = {
			primary: true,
			followEnd: true,
			// 200-line transcript in a 35-line viewport (maxScrollTop = 165);
			// user scrolled up to row 120 (45 lines above maxScrollTop > viewportHeight 35).
			scrollTop: 120,
			isFollowingEnd: false,
			scrollToEnd() {
				throw new Error("must not snap");
			},
		};
		expect(
			snapToEndIfNearEnd(view, {
				contentHeight: 200,
				viewportHeight: 35,
				lastMessageStartRow: 80,
			}),
		).toBe(false);
		expect(view.scrollTop).toBe(120);
	});
});

describe("findLastMessageStartRow", () => {
	class UserMessageComponent {}
	class AssistantMessageComponent {
		hasToolCalls: boolean;
		isStreaming: boolean;
		constructor(hasToolCalls = false, isStreaming = false) {
			this.hasToolCalls = hasToolCalls;
			this.isStreaming = isStreaming;
		}
	}
	class ToolExecutionComponent {}
	class Spacer {}
	class ThemedText {}

	test("locates the start of the most recent turn across nested containers, tool calls, and trailing status", () => {
		const headerContainer = {
			mouseLayout: { width: 80, children: [{ component: new Spacer(), height: 4 }] },
		};
		const loadedResourcesContainer = {
			mouseLayout: { width: 80, children: [{ component: new ThemedText(), height: 6 }] },
		};
		const chatContainer = {
			mouseLayout: {
				width: 80,
				children: [
					// Turn 1: rows 10..42
					{ component: new UserMessageComponent(), height: 2 },
					{ component: new AssistantMessageComponent(false), height: 30 },
					// Turn 2: starts after 1-line spacer at row 43
					{ component: new Spacer(), height: 1 },
					{ component: new UserMessageComponent(), height: 3 },
					{ component: new AssistantMessageComponent(true), height: 8 },
					{ component: new ToolExecutionComponent(), height: 4 },
					{ component: new AssistantMessageComponent(false), height: 50 },
					// Trailing telemetry status lines
					{ component: new Spacer(), height: 1 },
					{ component: new ThemedText(), height: 1 },
				],
			},
		};
		const documentContainer = {
			mouseLayout: {
				width: 80,
				children: [
					{ component: headerContainer, height: 4 },
					{ component: loadedResourcesContainer, height: 6 },
					{ component: chatContainer, height: 100 },
				],
			},
		};
		expect(findLastMessageStartRow(documentContainer)).toBe(43);
	});
});

describe("follow-on-send extension", () => {
	test("installs the patch on session_start and restores it on session_shutdown", async () => {
		const scrollProto: any = FakeScrollView.prototype;
		const editorProto: any = FakeEditor.prototype;
		const originalUpdateLayout = scrollProto.updateLayout;
		const originalHandleInput = editorProto.handleInput;

		await emit("session_start");
		expect(scrollProto.updateLayout).not.toBe(originalUpdateLayout);
		expect(editorProto.handleInput).not.toBe(originalHandleInput);

		await emit("session_shutdown");
		expect(scrollProto.updateLayout).toBe(originalUpdateLayout);
		expect(editorProto.handleInput).toBe(originalHandleInput);
	});

	test("does not install outside tui mode", async () => {
		const prototype: any = FakeScrollView.prototype;
		const original = prototype.updateLayout;

		await emit("session_start", {}, { ...tuiCtx, mode: "rpc" });
		expect(prototype.updateLayout).toBe(original);
	});

	test("sending near the end snaps and follows new output", async () => {
		await emit("session_start");
		const view = startTranscript();
		view.scrollBy(-5);
		view.updateLayout(30, 5, () => {});
		expect(view.scrollTop).toBe(20);
		expect(view.isFollowingEnd).toBe(false);

		const result = await emit("input", { text: "hello", source: "interactive" });
		expect(result).toEqual({ action: "continue" });
		expect(view.scrollTop).toBe(25);
		expect(view.isFollowingEnd).toBe(true);

		// New output grows the transcript; the view follows it.
		view.updateLayout(36, 5, () => {});
		expect(view.scrollTop).toBe(31);
		await emit("session_shutdown");
	});

	test("sending far from the end keeps the scroll position", async () => {
		await emit("session_start");
		const view = startTranscript();
		view.scrollBy(-(NEAR_END_LINES + 10));
		view.updateLayout(30, 5, () => {});
		expect(view.scrollTop).toBe(5);

		await emit("input", { text: "hello", source: "interactive" });
		expect(view.scrollTop).toBe(5);
		expect(view.isFollowingEnd).toBe(false);

		view.updateLayout(36, 5, () => {});
		expect(view.scrollTop).toBe(5);
		await emit("session_shutdown");
	});

	test("exactly NEAR_END_LINES above the end snaps; one more line does not", async () => {
		await emit("session_start");

		const atBoundary = startTranscript();
		atBoundary.scrollBy(-NEAR_END_LINES);
		atBoundary.updateLayout(30, 5, () => {});
		await emit("input", { text: "hello", source: "interactive" });
		expect(atBoundary.isFollowingEnd).toBe(true);

		const pastBoundary = startTranscript();
		pastBoundary.scrollBy(-(NEAR_END_LINES + 1));
		pastBoundary.updateLayout(30, 5, () => {});
		await emit("input", { text: "hello", source: "interactive" });
		expect(pastBoundary.isFollowingEnd).toBe(false);
		expect(pastBoundary.scrollTop).toBe(25 - (NEAR_END_LINES + 1));
		await emit("session_shutdown");
	});

	test("a bash command near the end snaps too", async () => {
		await emit("session_start");
		const view = startTranscript();
		view.scrollBy(-3);
		view.updateLayout(30, 5, () => {});

		await emit("user_bash", { command: "pwd", excludeFromContext: false });
		expect(view.isFollowingEnd).toBe(true);
		await emit("session_shutdown");
	});

	test("only the primary follow-end view is the transcript", async () => {
		await emit("session_start");
		const transcript = startTranscript();
		const other = new FakeScrollView({ follow: "end", primary: false });
		other.updateLayout(30, 5, () => {});
		const fitting = new FakeScrollView({ follow: "none", primary: true });
		fitting.updateLayout(30, 5, () => {});

		transcript.scrollBy(-4);
		transcript.updateLayout(30, 5, () => {});
		await emit("input", { text: "hello", source: "interactive" });
		expect(transcript.isFollowingEnd).toBe(true);
		await emit("session_shutdown");
	});

	test("typing in the prompt editor does not snap; hitting submit (Enter) snaps when near the tail", async () => {
		await emit("session_start");
		const view = startTranscript(100, 20);
		// Scroll up 15 lines (within one viewportHeight of 20).
		view.scrollBy(-15);
		view.updateLayout(100, 20, () => {});
		expect(view.scrollTop).toBe(65);
		expect(view.isFollowingEnd).toBe(false);

		const editor = new FakeEditor();
		// Non-editing key (Escape) must not snap.
		editor.handleInput("\x1b");
		expect(view.isFollowingEnd).toBe(false);

		// Typing characters and editing must NOT snap to the bottom.
		editor.handleInput("h");
		editor.handleInput("i");
		editor.handleInput("\x7f");
		expect(view.isFollowingEnd).toBe(false);
		expect(view.scrollTop).toBe(65);

		// Hitting submit (Enter) on a non-empty prompt snaps to the end.
		editor.handleInput("\r");
		expect(view.isFollowingEnd).toBe(true);
		expect(view.scrollTop).toBe(80);
		await emit("session_shutdown");
	});

	test("hitting submit (Enter) in the prompt editor keeps the scroll position when far from the tail", async () => {
		await emit("session_start");
		const documentContainer = {
			mouseLayout: {
				width: 80,
				children: [
					{ component: { role: "user" }, height: 2 },
					{ component: { role: "assistant" }, height: 80 },
					{ component: { role: "user" }, height: 2 },
					{ component: { role: "assistant" }, height: 60 },
				],
			},
		};
		const view = new FakeScrollView(documentContainer, { follow: "end", primary: true });
		view.updateLayout(144, 20, () => {});
		// Scroll 30 lines above maxScrollTop (124 -> 94), which is inside the latest
		// 60-line assistant message (rows 84..144) but > viewportHeight (20) from the tail.
		view.scrollBy(-30);
		view.updateLayout(144, 20, () => {});
		expect(view.scrollTop).toBe(94);
		expect(view.isFollowingEnd).toBe(false);

		const editor = new FakeEditor();
		editor.handleInput("h");
		editor.handleInput("\r");
		await emit("input", { text: "h", source: "interactive" });
		expect(view.isFollowingEnd).toBe(false);
		expect(view.scrollTop).toBe(94);
		await emit("session_shutdown");
	});

	test("submitting in an overlay editor or from an extension does not snap the transcript", async () => {
		await emit("session_start");
		const view = startTranscript(30, 5);
		view.scrollBy(-3);
		view.updateLayout(30, 5, () => {});
		expect(view.isFollowingEnd).toBe(false);

		const overlayEditor = new FakeEditor({ hasOverlay: () => true });
		overlayEditor.handleInput("q");
		overlayEditor.handleInput("\r");
		expect(view.isFollowingEnd).toBe(false);

		await emit("input", { text: "background notification", source: "extension" });
		expect(view.isFollowingEnd).toBe(false);
		await emit("session_shutdown");
	});

	test("the status command reports the active state", async () => {
		await emit("session_start");
		notifications.length = 0;
		await commands.get("follow-on-send")!.handler("", tuiCtx);
		expect(notifications.at(-1)?.message).toContain("active");
		await emit("session_shutdown");

		notifications.length = 0;
		await commands.get("follow-on-send")!.handler("", tuiCtx);
		expect(notifications.at(-1)?.message).toContain("inactive");
	});
});
