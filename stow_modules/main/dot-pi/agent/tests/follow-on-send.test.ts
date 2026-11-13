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

	test("gradually collapses a multi-line prompt bar down to 3 content lines on history scroll up and expands on scroll down", async () => {
		await emit("session_start");
		const view = startTranscript(100, 20);
		const editor = new FakeEditor({ terminal: { rows: 40 } });
		editor.setText(["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"].join("\n"));

		// Initial render: all 8 content lines + 2 borders = 10 rows.
		let rendered = editor.render(80);
		expect(rendered).toHaveLength(10);
		expect(rendered.slice(1, -1)).toEqual(["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"]);

		// Scroll up 2 lines in history: prompt bar shrinks by 2 lines (8 -> 6 content lines = 8 rows).
		view.scrollBy(-2);
		rendered = editor.render(80);
		expect(rendered).toHaveLength(8);
		expect(rendered[0]).toContain("↑ 2 more");
		expect(rendered.slice(1, -1)).toEqual(["L3", "L4", "L5", "L6", "L7", "L8"]);

		// Scroll up 10 more lines (scrollTop = 68, 7 lines above collapsed tail 75):
		// clamps at 3 content lines + 2 borders = 5 rows total.
		view.scrollBy(-10);
		rendered = editor.render(80);
		expect(rendered).toHaveLength(5);
		expect(rendered[0]).toContain("↑ 5 more");
		expect(rendered.slice(1, -1)).toEqual(["L6", "L7", "L8"]);

		// Scrolling down while not at the tail of history (7 lines remaining to tail 75)
		// keeps the prompt bar collapsed until the tail is reached.
		view.scrollBy(4);
		rendered = editor.render(80);
		expect(rendered).toHaveLength(5);
		view.scrollBy(3); // now at scrollTop = 75 (the tail of the collapsed viewport)
		rendered = editor.render(80);
		expect(rendered).toHaveLength(5);

		// Once at the tail of history (scrollTop = 75, hiddenLinesBelow = 0), scrolling down
		// gradually expands the prompt bar (3 -> 5 content lines = 7 rows).
		view.scrollBy(2);
		rendered = editor.render(80);
		expect(rendered).toHaveLength(7);
		expect(rendered[0]).toContain("↑ 3 more");
		expect(rendered.slice(1, -1)).toEqual(["L4", "L5", "L6", "L7", "L8"]);

		// Scroll down 3 more lines at the tail: fully restored to 8 content lines (10 rows).
		view.scrollBy(3);
		rendered = editor.render(80);
		expect(rendered).toHaveLength(10);
		expect(rendered.slice(1, -1)).toEqual(["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"]);

		// Typing in the prompt while scrolled far up in history immediately expands the prompt,
		// and scrolling up again from the middle of history collapses it again.
		view.scrollBy(-30);
		expect(editor.render(80)).toHaveLength(5);
		editor.handleInput("!");
		expect(editor.render(80)).toHaveLength(10);
		view.scrollBy(-2);
		expect(editor.render(80)).toHaveLength(8);

		await emit("session_shutdown");
	});

	test("PageUp immediately collapses a multi-line prompt bar to 3 content lines, and Up/Down key in editor immediately expands it", async () => {
		await emit("session_start");
		const view = startTranscript(100, 20);
		const editor = new FakeEditor({ terminal: { rows: 40 } });
		editor.setText(["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10"].join("\n"));

		expect(editor.render(80)).toHaveLength(12); // 10 content + 2 borders

		// PageUp (viewportHeight - 4 = 16 lines) collapses all the way to 3 content lines (5 rows).
		view.scrollBy(-16);
		const collapsed = editor.render(80);
		expect(collapsed).toHaveLength(5);
		expect(collapsed.slice(1, -1)).toEqual(["L8", "L9", "L10"]);

		// Pressing Up arrow in the prompt editor immediately expands it back to full size.
		editor.handleInput("\x1b[A");
		const expanded = editor.render(80);
		expect(expanded).toHaveLength(12);
		expect(expanded.slice(1, -1)).toEqual(["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10"]);

		// Short prompts with <= 3 lines keep their natural line count when scrolling history.
		editor.setText("Only1\nOnly2");
		expect(editor.render(80)).toHaveLength(4);
		view.scrollBy(-16);
		expect(editor.render(80)).toHaveLength(4);

		await emit("session_shutdown");
	});

	test("mouse wheel on top of the prompt bar expands it when collapsed and scrolls its content once expanded without scrolling chat history", async () => {
		await emit("session_start");
		const view = startTranscript(100, 20);
		// Terminal with 20 rows => defaultMaxVisibleLines = Math.max(5, 6) = 6 content lines.
		const editor = new FakeEditor({ terminal: { rows: 20 } });
		editor.setText(["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"].join("\n"));
		expect(editor.render(80)).toHaveLength(8); // 6 content lines + 2 borders (L3..L8)

		// Collapse prompt bar to 3 content lines via history scroll up (maxCollapse = 6 - 3 = 3).
		view.scrollBy(-10);
		const historyScrollTop = view.scrollTop;
		let rendered = editor.render(80);
		expect(rendered.slice(1, -1)).toEqual(["L6", "L7", "L8"]);

		// Wheel up on top of the collapsed prompt bar scrolls its 3-line viewport up (L6..L8 -> L3..L5).
		const wheelUpCollapsed = editor.handleMouse({ type: "wheel", x: 5, y: 1, wheelDelta: -3 } as any) as any;
		expect(wheelUpCollapsed).toEqual({ handled: true, render: true });
		expect(view.scrollTop).toBe(historyScrollTop);
		rendered = editor.render(80);
		expect(rendered.slice(1, -1)).toEqual(["L3", "L4", "L5"]);

		// Wheel down on top of the collapsed prompt bar by 2 lines expands it from 3 -> 5 content lines (L3..L7).
		const expandPartial = editor.handleMouse({ type: "wheel", x: 5, y: 1, wheelDelta: 2 } as any) as any;
		expect(expandPartial).toEqual({ handled: true, render: true });
		expect(view.scrollTop).toBe(historyScrollTop);
		rendered = editor.render(80);
		expect(rendered.slice(1, -1)).toEqual(["L3", "L4", "L5", "L6", "L7"]);

		// Wheel down on top of the prompt bar by 2 more lines finishes expanding (5 -> 6 content lines)
		// and scrolls the remaining 1 line down inside the expanded prompt bar (L3..L8).
		const expandAndScroll = editor.handleMouse({ type: "wheel", x: 5, y: 1, wheelDelta: 2 } as any) as any;
		expect(expandAndScroll).toEqual({ handled: true, render: true });
		expect(view.scrollTop).toBe(historyScrollTop);
		rendered = editor.render(80);
		expect(rendered[0]).toContain("↑ 2 more");
		expect(rendered.slice(1, -1)).toEqual(["L3", "L4", "L5", "L6", "L7", "L8"]);

		// Scrolling up on the chat history collapses the prompt bar again.
		view.scrollBy(-3);
		rendered = editor.render(80);
		expect(rendered).toHaveLength(5);

		await emit("session_shutdown");
	});

	test("scrollToStart, scrollToEnd, and scrollTo drive gradual and full collapse/expansion for active questionnaireTarget", async () => {
		await emit("session_start");
		const view = startTranscript(100, 12);
		const store = (globalThis as Record<symbol, any>)[Symbol.for("pi.scroll-collapse")]!;
		let renderNotifications = 0;
		store.questionnaireTarget = {
			maxCollapseLines: 20,
			onCollapseChange: () => {
				renderNotifications += 1;
			},
		};

		// Gradual wheel scroll up on history (3 lines) collapses questionnaire by 3 lines.
		view.scrollBy(-3);
		expect(store.collapseLines).toBe(3);
		expect(renderNotifications).toBe(1);

		// PageUp (viewportHeight - 4 = 8) collapses questionnaire all the way to maxCollapseLines (20).
		view.scrollBy(-8);
		expect(store.collapseLines).toBe(20);
		expect(renderNotifications).toBe(2);

		// Scroll up further into history so hiddenLinesBelow > 0: scrolling down in the middle
		// of history keeps questionnaire collapsed until reaching the tail (scrollTop = 68),
		// then expands by 5 lines (20 -> 15) once past the tail.
		view.scrollBy(-15);
		const collapsedTail = 100 - (12 + 20); // 68
		view.scrollTo(collapsedTail);
		expect(store.collapseLines).toBe(20);
		view.scrollTo(collapsedTail + 5);
		expect(store.collapseLines).toBe(15);

		// scrollToEnd restores questionnaire to full height immediately (collapseLines = 0).
		view.scrollToEnd();
		expect(store.collapseLines).toBe(0);
		expect(view.isFollowingEnd).toBe(true);

		// scrollToStart collapses questionnaire all the way immediately (collapseLines = 20).
		view.scrollToStart();
		expect(store.collapseLines).toBe(20);
		expect(view.isFollowingEnd).toBe(false);

		store.questionnaireTarget = undefined;
		await emit("session_shutdown");
	});
});
