import { describe, expect, test } from "bun:test";
import herdrAgentState, {
	type AgentState,
	formatOsc7501Status,
	formatWaitingMessage,
	STATUS_KEY,
} from "../extensions/herdr-agent-state.ts";

type Handler = (event: any, ctx: any) => Promise<void> | void;

function createHarness(options: { branch?: any[]; isIdle?: () => boolean } = {}) {
	const handlers = new Map<string, Handler[]>();
	const bus = new Map<string, Array<(data: unknown) => void>>();
	const states: Array<{ state: AgentState; message?: string }> = [];
	const oscWrites: string[] = [];
	const statuses = new Map<string, string | undefined>();
	let idle = true;

	const pi: any = {
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		events: {
			on(name: string, handler: (data: unknown) => void) {
				const list = bus.get(name) ?? [];
				list.push(handler);
				bus.set(name, list);
			},
			emit(name: string, data: unknown) {
				for (const handler of bus.get(name) ?? []) handler(data);
			},
		},
	};

	herdrAgentState(pi, {
		enabled: true,
		herdrSocketEnabled: true,
		hcSession: true,
		sendState: (state, message) => {
			states.push({ state, message });
		},
		reportSession: () => {},
		writeOscStatus: (sequence) => {
			oscWrites.push(sequence);
		},
	});

	const ctx: any = {
		mode: "tui",
		isIdle: options.isIdle ?? (() => idle),
		sessionManager: {
			getSessionFile: () => "/tmp/session.jsonl",
			getSessionId: () => "session-1",
			getBranch: () => options.branch ?? [],
		},
		ui: {
			theme: {
				fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
			},
			setStatus: (key: string, value: string | undefined) => {
				statuses.set(key, value);
			},
		},
	};

	async function emit(event: string, payload: any = {}, context: any = ctx) {
		if (event === "agent_start") idle = false;
		if (event === "agent_settled") idle = true;
		for (const handler of handlers.get(event) ?? []) {
			await handler(payload, context);
		}
	}

	return {
		emit,
		busEmit: pi.events.emit as (name: string, data: unknown) => void,
		states,
		oscWrites,
		statuses,
		ctx,
		setIdle: (next: boolean) => {
			idle = next;
		},
	};
}

describe("formatWaitingMessage", () => {
	test("prefixes error details with Waiting for user input", () => {
		expect(formatWaitingMessage()).toBe("Waiting for user input");
		expect(formatWaitingMessage("429 Too Many Requests\nmore lines")).toBe(
			"Waiting for user input: 429 Too Many Requests",
		);
		expect(formatWaitingMessage("Awaiting input: Q1")).toBe("Awaiting input: Q1");
		expect(formatWaitingMessage("Permission Required: bash")).toBe("Permission Required: bash");
		expect(formatWaitingMessage("Waiting for user input: custom")).toBe(
			"Waiting for user input: custom",
		);
	});
});

describe("herdr-agent-state extension", () => {
	test("normal run transitions idle -> working -> idle", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });
		expect(h.states).toEqual([{ state: "idle", message: undefined }]);

		await h.emit("agent_start");
		expect(h.states.at(-1)).toEqual({ state: "working", message: undefined });

		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h.emit("agent_settled", { aborted: false });
		expect(h.states.at(-1)).toEqual({ state: "idle", message: undefined });
		expect(h.statuses.get(STATUS_KEY)).toBeUndefined();
	});

	test("API error transitions agent to blocked and waiting for user input on settle, and clears on user input", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });
		await h.emit("agent_start");

		await h.emit("message_end", {
			message: {
				role: "assistant",
				stopReason: "error",
				errorMessage: "429 Too Many Requests: quota exceeded\nretry later",
			},
		});
		// Still working until retries/run settle
		expect(h.states.at(-1)).toEqual({ state: "working", message: undefined });

		await h.emit("agent_settled", { aborted: false });
		const expectedMsg = "Waiting for user input: 429 Too Many Requests: quota exceeded";
		expect(h.states.at(-1)).toEqual({
			state: "blocked",
			message: expectedMsg,
		});
		expect(h.statuses.get(STATUS_KEY)).toBe(`[error]blocked · ${expectedMsg}[/error]`);
		expect(h.oscWrites.at(-1)).toBe(formatOsc7501Status("blocked", expectedMsg));

		// User submits input to continue -> unblocks
		await h.emit("input", { text: "continue", source: "interactive" });
		expect(h.states.at(-1)).toEqual({ state: "idle", message: undefined });
		expect(h.statuses.get(STATUS_KEY)).toBeUndefined();

		await h.emit("agent_start");
		expect(h.states.at(-1)).toEqual({ state: "working", message: undefined });
	});

	test("transient API error that recovers on auto-retry settles to idle, not blocked", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });
		await h.emit("agent_start");

		// First attempt fails
		await h.emit("message_end", {
			message: {
				role: "assistant",
				stopReason: "error",
				errorMessage: "503 Service Unavailable",
			},
		});
		expect(h.states.at(-1)).toEqual({ state: "working", message: undefined });

		// Auto-retry starts a new low-level run and succeeds
		await h.emit("agent_start");
		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h.emit("agent_settled", { aborted: false });

		expect(h.states.at(-1)).toEqual({ state: "idle", message: undefined });
		expect(h.statuses.get(STATUS_KEY)).toBeUndefined();
	});

	test("user abort (Escape) settles to idle instead of blocked", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });
		await h.emit("agent_start");

		await h.emit("message_end", {
			message: {
				role: "assistant",
				stopReason: "error",
				errorMessage: "503 Service Unavailable",
			},
		});
		await h.emit("agent_settled", { aborted: true });

		expect(h.states.at(-1)).toEqual({ state: "idle", message: undefined });
	});

	test("compaction failure marks agent blocked both during run and on manual /compact", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });

		// Manual /compact failure while idle
		await h.emit("session_compact_failed", {
			reason: "manual",
			aborted: false,
			errorMessage: "Compaction failed: 502 Bad Gateway",
		});
		expect(h.states.at(-1)).toEqual({
			state: "blocked",
			message: "Waiting for user input: Compaction failed: 502 Bad Gateway",
		});

		// Subsequent successful compaction clears it
		await h.emit("session_compact", { reason: "manual" });
		expect(h.states.at(-1)).toEqual({ state: "idle", message: undefined });

		// Overflow auto-compaction failure during run
		await h.emit("agent_start");
		await h.emit("session_compact_failed", {
			reason: "overflow",
			aborted: false,
			errorMessage: "Context overflow recovery failed: token limit exceeded",
		});
		await h.emit("agent_settled", { aborted: false });
		expect(h.states.at(-1)).toEqual({
			state: "blocked",
			message: "Waiting for user input: Context overflow recovery failed: token limit exceeded",
		});
	});

	test("blocked tool call that halts progress marks agent blocked; adapted tool call clears it", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });
		await h.emit("agent_start");

		// Tool call 1 is blocked before execution (durationMs is undefined)
		await h.emit("tool_execution_end", {
			toolCallId: "t1",
			toolName: "bash",
			isError: true,
			durationMs: undefined,
			result: { content: [{ type: "text", text: "Command blocked by policy" }] },
		});
		// Agent replies that it cannot proceed and settles without running any other tool
		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h.emit("agent_settled", { aborted: false });
		expect(h.states.at(-1)).toEqual({
			state: "blocked",
			message: "Waiting for user input: Command blocked by policy",
		});

		// Now test adaptation: tool 1 is blocked, tool 2 executes and succeeds
		await h.emit("agent_start");
		await h.emit("tool_execution_end", {
			toolCallId: "t2",
			toolName: "bash",
			isError: true,
			durationMs: undefined,
			result: { content: [{ type: "text", text: "Use grep tool instead of rg" }] },
		});
		await h.emit("tool_execution_end", {
			toolCallId: "t3",
			toolName: "grep",
			isError: false,
			durationMs: 12,
			result: { content: [{ type: "text", text: "match" }] },
		});
		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h.emit("agent_settled", { aborted: false });
		expect(h.states.at(-1)).toEqual({ state: "idle", message: undefined });
	});

	test("normal tool execution error (durationMs present) does not mark agent blocked on settle", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });
		await h.emit("agent_start");

		await h.emit("tool_execution_end", {
			toolCallId: "t1",
			toolName: "bash",
			isError: true,
			durationMs: 40,
			result: { content: [{ type: "text", text: "Command exited with code 1" }] },
		});
		await h.emit("message_end", {
			message: { role: "assistant", stopReason: "stop" },
		});
		await h.emit("agent_settled", { aborted: false });
		expect(h.states.at(-1)).toEqual({ state: "idle", message: undefined });
	});

	test("ui_prompt_start and ui_prompt_end mark agent blocked during interactive prompts", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });
		await h.emit("agent_start");

		await h.emit("ui_prompt_start", {
			reason: "ui_prompt",
			kind: "confirm",
			title: "Allow dangerous command?",
		});
		expect(h.states.at(-1)).toEqual({
			state: "blocked",
			message: "Waiting for user input: Allow dangerous command?",
		});

		await h.emit("ui_prompt_end", {
			reason: "ui_prompt",
			kind: "confirm",
			title: "Allow dangerous command?",
		});
		expect(h.states.at(-1)).toEqual({ state: "working", message: undefined });

		// Idle custom UI overlay (e.g. /settings) does not mark agent blocked when idle
		await h.emit("agent_settled", { aborted: false });
		await h.emit("ui_prompt_start", {
			reason: "ui_prompt",
			kind: "custom",
		});
		expect(h.states.at(-1)).toEqual({ state: "idle", message: undefined });
	});

	test("nested herdr:blocked events maintain a stack of labels", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });
		await h.emit("agent_start");

		h.busEmit("herdr:blocked", { active: true, label: "Permission Required: bash" });
		expect(h.states.at(-1)).toEqual({
			state: "blocked",
			message: "Permission Required: bash",
		});

		h.busEmit("herdr:blocked", { active: true, label: "Awaiting input: Q1" });
		expect(h.states.at(-1)).toEqual({
			state: "blocked",
			message: "Awaiting input: Q1",
		});

		h.busEmit("herdr:blocked", { active: false });
		expect(h.states.at(-1)).toEqual({
			state: "blocked",
			message: "Permission Required: bash",
		});

		h.busEmit("herdr:blocked", { active: false });
		expect(h.states.at(-1)).toEqual({
			state: "working",
			message: undefined,
		});
	});

	test("/reload preserves blocked state when branch ends on an assistant API error", async () => {
		const h = createHarness({
			branch: [
				{
					type: "message",
					message: { role: "user", content: [{ type: "text", text: "hi" }] },
				},
				{
					type: "message",
					message: {
						role: "assistant",
						stopReason: "error",
						errorMessage: "500 Internal Server Error",
					},
				},
			],
		});

		await h.emit("session_start", { reason: "reload" });
		expect(h.states.at(-1)).toEqual({
			state: "blocked",
			message: "Waiting for user input: 500 Internal Server Error",
		});
	});
});
