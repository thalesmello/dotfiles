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
const { FakeScrollView } = await import(pathToFileURL(hostPath).href);

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

const { default: followOnSend, NEAR_END_LINES, snapToEndIfNearEnd } = await import(pathToFileURL(redirectedPath).href);

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
});

describe("follow-on-send extension", () => {
	test("installs the patch on session_start and restores it on session_shutdown", async () => {
		const prototype: any = FakeScrollView.prototype;
		const original = prototype.updateLayout;

		await emit("session_start");
		expect(prototype.updateLayout).not.toBe(original);

		await emit("session_shutdown");
		expect(prototype.updateLayout).toBe(original);
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
