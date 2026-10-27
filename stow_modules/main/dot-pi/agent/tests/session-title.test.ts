import { describe, expect, test } from "bun:test";
import sessionTitleExtension from "../extensions/session-title.ts";

type Handler = (event: any, ctx: any) => Promise<void> | void;

function createHarness(summarize: (text: string) => Promise<string | undefined>) {
	const handlers = new Map<string, Handler[]>();
	const entries: Array<{ type: string; customType?: string; data?: unknown; name?: string; timestamp: string }> = [];
	let sessionName: string | undefined;
	const titles: string[] = [];

	const pi: any = {
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerCommand() {},
		getSessionName() {
			return sessionName;
		},
		setSessionName(name: string) {
			sessionName = name;
			entries.push({ type: "session_info", name, timestamp: new Date().toISOString() });
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data, timestamp: new Date().toISOString() });
		},
	};

	const ctx = {
		cwd: "/tmp/project",
		hasUI: true,
		ui: {
			setTitle(title: string) {
				titles.push(title);
			},
			notify() {},
		},
		sessionManager: {
			getBranch() {
				return entries;
			},
		},
	};

	sessionTitleExtension(pi, { summarize });

	async function emit(event: string, payload: any = {}) {
		for (const handler of handlers.get(event) ?? []) {
			await handler(payload, ctx);
		}
	}

	return {
		emit,
		entries,
		titles,
		getSessionName: () => sessionName,
		setManualSessionName: (name: string) => {
			sessionName = name;
			entries.push({ type: "session_info", name, timestamp: new Date().toISOString() });
		},
	};
}

describe("session-title extension", () => {
	test("starts retitling on the first user message_end before turn_end (in parallel with subagent/turn)", async () => {
		let resolveSummary!: (title: string | undefined) => void;
		const summaryCalls: string[] = [];
		const summarize = (text: string) => {
			summaryCalls.push(text);
			return new Promise<string | undefined>((resolve) => {
				resolveSummary = resolve;
			});
		};

		const harness = createHarness(summarize);

		// User submits the first prompt; message_end fires before the assistant or subagent finishes.
		await harness.emit("message_end", {
			message: { role: "user", content: "Investigate auth bug with a scout subagent" },
		});

		// Summarizer is already running in parallel before turn_end fires.
		expect(summaryCalls).toEqual(["Investigate auth bug with a scout subagent"]);
		expect(harness.getSessionName()).toBeUndefined();

		// Summarizer finishes while the subagent is still running (before turn_end).
		resolveSummary("Investigate Auth Bug");
		await Promise.resolve();
		await Promise.resolve();

		expect(harness.getSessionName()).toBe("Investigate Auth Bug");
		expect(harness.titles.at(-1)).toBe("Investigate Auth Bug");

		// When the subagent and turn finally finish, turn_end does not re-run the summarizer.
		await harness.emit("turn_end", { turnIndex: 0 });
		expect(summaryCalls).toHaveLength(1);
	});

	test("does not spawn a duplicate summary on turn_end if the first summary is still in flight", async () => {
		let resolveSummary!: (title: string | undefined) => void;
		let callCount = 0;
		const summarize = () => {
			callCount += 1;
			return new Promise<string | undefined>((resolve) => {
				resolveSummary = resolve;
			});
		};

		const harness = createHarness(summarize);

		await harness.emit("message_end", {
			message: { role: "user", content: "Quick question" },
		});
		expect(callCount).toBe(1);

		// Turn ends before the summarizer finishes.
		await harness.emit("turn_end", { turnIndex: 0 });
		expect(callCount).toBe(1);

		resolveSummary("Quick Question");
		await Promise.resolve();
		await Promise.resolve();

		expect(harness.getSessionName()).toBe("Quick Question");
	});

	test("retries on turn_end if the parallel summary on message_end failed", async () => {
		let attempts = 0;
		const summarize = async () => {
			attempts += 1;
			return attempts === 1 ? undefined : "Recovered Title";
		};

		const harness = createHarness(summarize);

		await harness.emit("message_end", {
			message: { role: "user", content: "Fix flaky test" },
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(harness.getSessionName()).toBeUndefined();
		expect(attempts).toBe(1);

		await harness.emit("turn_end", { turnIndex: 0 });
		await Promise.resolve();
		await Promise.resolve();
		expect(attempts).toBe(2);
		expect(harness.getSessionName()).toBe("Recovered Title");
	});
});
