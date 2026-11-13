import { describe, expect, test } from "bun:test";
import sleepWakeRetryExtension, {
	SLEEP_INTERRUPTED_ERROR_MESSAGE,
	computeRetryDelayLimitError,
	computeRetryDelayMs,
	createSleepMonitor,
	didMessageSpanSleep,
	type AgentSessionEventLike,
	type AgentSessionLike,
	type AssistantEventStreamLike,
	type AssistantMessageLike,
	type ModelRuntimeLike,
	type RetryPolicyLike,
} from "../extensions/sleep-wake-retry.ts";

class FakeAgentSession implements AgentSessionLike {
	agent: {
		state?: { messages?: AssistantMessageLike[] };
		prepareRequest?: (request: unknown, signal?: AbortSignal) => Promise<unknown> | unknown;
		abort?: () => void;
		continue?: () => Promise<unknown>;
	} = { state: { messages: [] } };
	settingsManager: { getRetrySettings(): RetryPolicyLike };
	isCompacting = false;
	_isAgentRunActive = false;
	_agentRunAbortRequested = false;
	_retryAttempt = 0;
	_declinedRetryReason?: string;
	_failedResponse?: AssistantMessageLike;
	_runSystemPromptOptions?: unknown;
	_retryAbortController?: AbortController;

	emittedEvents: AgentSessionEventLike[] = [];
	extensionEvents: AgentSessionEventLike[] = [];
	omittedMessages: AssistantMessageLike[] = [];
	cancelledRetries = 0;
	settledCount = 0;

	constructor(policy: Partial<RetryPolicyLike> = {}) {
		const resolved: RetryPolicyLike = {
			enabled: policy.enabled ?? true,
			maxRetries: policy.maxRetries ?? 3,
			baseDelayMs: policy.baseDelayMs ?? 2_000,
			maxAgentDelayMs: policy.maxAgentDelayMs ?? 60_000,
		};
		this.settingsManager = {
			getRetrySettings: () => resolved,
		};
		this._installAgentRequestProjection();
	}

	_installAgentRequestProjection(): void {
		this.agent.prepareRequest = async (request: unknown) => request;
	}

	_isRetryableError(message: AssistantMessageLike): boolean {
		// Mirror Pi's built-in RETRYABLE_PROVIDER_ERROR_PATTERN behavior:
		// matches 503/socket closed/overloaded, but NOT "Request aborted".
		if (message.stopReason !== "error" || !message.errorMessage) return false;
		return /503|502|429|overloaded|socket connection was closed|connection reset|fetch failed/i.test(
			message.errorMessage,
		);
	}

	_omitRecoveryAttempt(message: AssistantMessageLike): void {
		this.omittedMessages.push(message);
		const msgs = this.agent.state?.messages;
		if (Array.isArray(msgs)) {
			const idx = msgs.indexOf(message);
			if (idx !== -1) msgs.splice(idx, 1);
		}
	}

	async _handlePostAgentRun(): Promise<boolean> {
		return false;
	}

	async _runBeforeSettleBoundary(): Promise<boolean> {
		return false;
	}

	async _emitAgentSettled(): Promise<void> {
		this._isAgentRunActive = false;
		this.settledCount += 1;
		this._emit({ type: "agent_settled", aborted: this._agentRunAbortRequested });
	}

	_finishCancelledRetry(): void {
		if (this._retryAttempt === 0) return;
		const attempt = this._retryAttempt;
		this._retryAttempt = 0;
		this.cancelledRetries += 1;
		this._emit({
			type: "auto_retry_end",
			success: false,
			attempt,
			finalError: "Retry cancelled",
		});
	}

	_emit(event: unknown): void {
		this.emittedEvents.push(event as AgentSessionEventLike);
	}

	async _emitExtensionEvent(event: AgentSessionEventLike): Promise<void> {
		this.extensionEvents.push(event);
	}

	_willRetryAfterAgentEnd(event: { messages?: AssistantMessageLike[] }): boolean {
		if (this._agentRunAbortRequested) return false;
		const settings = this.settingsManager.getRetrySettings();
		if (!settings.enabled || this._retryAttempt >= settings.maxRetries) {
			return false;
		}
		const messages = event.messages ?? [];
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg?.role === "assistant") {
				return (
					this._isRetryableError(msg) &&
					computeRetryDelayLimitError(settings, msg.errorInfo) === undefined
				);
			}
		}
		return false;
	}

	async _prepareRetry(message: AssistantMessageLike): Promise<boolean> {
		const settings = this.settingsManager.getRetrySettings();
		if (!settings.enabled || this._retryAttempt >= settings.maxRetries) {
			return false;
		}
		const limitError = computeRetryDelayLimitError(settings, message.errorInfo);
		if (limitError) {
			this._declinedRetryReason = `${limitError} Raise retry.maxAgentDelayMs to wait longer.`;
			return false;
		}
		this._retryAttempt++;
		const delayMs = computeRetryDelayMs(settings, this._retryAttempt, message.errorInfo);
		this._emit({
			type: "auto_retry_start",
			attempt: this._retryAttempt,
			maxAttempts: settings.maxRetries,
			delayMs,
			errorMessage: message.errorMessage || "Unknown error",
		});
		this._omitRecoveryAttempt(message);
		this._retryAbortController = new AbortController();
		try {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(resolve, delayMs);
				this._retryAbortController?.signal.addEventListener(
					"abort",
					() => {
						clearTimeout(timer);
						reject(new Error("Aborted"));
					},
					{ once: true },
				);
			});
		} catch {
			this._finishCancelledRetry();
			return false;
		} finally {
			this._retryAbortController = undefined;
		}
		return true;
	}

	async _startRun(trigger: unknown, onStarted?: () => void): Promise<unknown> {
		this._isAgentRunActive = true;
		onStarted?.();
		try {
			return typeof trigger === "function" ? await (trigger as () => Promise<unknown>)() : trigger;
		} finally {
			this._isAgentRunActive = false;
		}
	}

	abortRetry(): void {
		this._retryAbortController?.abort();
	}
}

class FakeEventStream implements AssistantEventStreamLike {
	done = false;
	events: unknown[] = [];
	finalResult: unknown;
	private resolveResult!: (value: unknown) => void;
	private resultPromise: Promise<unknown>;

	constructor() {
		this.resultPromise = new Promise((resolve) => {
			this.resolveResult = resolve;
		});
	}

	push(event: any): void {
		if (this.done) return;
		this.events.push(event);
		if (event?.type === "done") {
			this.done = true;
			this.finalResult = event.message;
			this.resolveResult(event.message);
		} else if (event?.type === "error") {
			this.done = true;
			this.finalResult = event.error;
			this.resolveResult(event.error);
		}
	}

	end(result?: unknown): void {
		this.done = true;
		if (result !== undefined && this.finalResult === undefined) {
			this.finalResult = result;
			this.resolveResult(result);
		}
	}

	result(): Promise<unknown> {
		return this.resultPromise;
	}
}

class FakeModelRuntime implements ModelRuntimeLike {
	lastSignal?: AbortSignal;
	activeStreams: FakeEventStream[] = [];
	streamCalls = 0;

	streamSimple(
		model: any,
		context: unknown,
		options?: Record<string, unknown>,
	): AssistantEventStreamLike {
		this.streamCalls += 1;
		if (model?.virtual) {
			return this.streamSimple({ ...model, virtual: false }, context, { ...options });
		}
		this.lastSignal = options?.signal as AbortSignal | undefined;
		const stream = new FakeEventStream();
		this.activeStreams.push(stream);
		return stream;
	}

	stream(
		_model: any,
		_context: unknown,
		options?: Record<string, unknown>,
	): AssistantEventStreamLike {
		this.streamCalls += 1;
		this.lastSignal = options?.signal as AbortSignal | undefined;
		const stream = new FakeEventStream();
		this.activeStreams.push(stream);
		return stream;
	}
}

function createHarness(options: {
	clock?: () => number;
	sleepCheckIntervalMs?: number;
	sleepJumpThresholdMs?: number;
} = {}) {
	type Handler = (event: any, ctx: any) => Promise<void> | void;
	const handlers = new Map<string, Handler[]>();
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
	const notifications: Array<{ message: string; type?: string }> = [];

	class ScopedSession extends FakeAgentSession {}
	class ScopedRuntime extends FakeModelRuntime {}

	const pi: any = {
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerCommand(name: string, config: { handler: (args: string, ctx: any) => Promise<void> }) {
			commands.set(name, config);
		},
	};

	const controller = sleepWakeRetryExtension(pi, {
		clock: options.clock,
		sleepCheckIntervalMs: options.sleepCheckIntervalMs ?? 5,
		sleepJumpThresholdMs: options.sleepJumpThresholdMs ?? 1_000,
		AgentSessionClass: ScopedSession,
		ModelRuntimeClass: ScopedRuntime,
	});

	const ctx = {
		mode: "tui",
		ui: {
			notify(message: string, type?: string) {
				notifications.push({ message, type });
			},
		},
	};

	async function emit(event: string, payload: any = {}) {
		for (const handler of handlers.get(event) ?? []) {
			await handler(payload, ctx);
		}
	}

	return {
		ScopedSession,
		ScopedRuntime,
		controller,
		emit,
		commands,
		notifications,
		ctx,
	};
}

describe("createSleepMonitor", () => {
	test("detects wall-clock jumps above threshold and increments wakeSeq", () => {
		let now = 10_000;
		const wakes: Array<{ delta: number; seq: number }> = [];
		const monitor = createSleepMonitor({
			clock: () => now,
			checkIntervalMs: 1_000,
			jumpThresholdMs: 4_000,
		});
		monitor.onWake((delta, seq) => wakes.push({ delta, seq }));

		now += 1_000;
		expect(monitor.check()).toBe(false);
		expect(monitor.getWakeSeq()).toBe(0);

		now += 15_000;
		expect(monitor.check()).toBe(true);
		expect(monitor.getWakeSeq()).toBe(1);
		expect(monitor.getLastWakeAt()).toBe(26_000);
		expect(wakes).toEqual([{ delta: 15_000, seq: 1 }]);

		monitor.close();
	});
});

describe("sleep-wake-retry extension", () => {
	test("cuts a long retry cooldown short and retries immediately when laptop wakes from sleep", async () => {
		let fakeNow = 100_000;
		const { ScopedSession, controller } = createHarness({
			clock: () => fakeNow,
			sleepCheckIntervalMs: 5,
			sleepJumpThresholdMs: 1_000,
		});

		const session = new ScopedSession({
			enabled: true,
			maxRetries: 12,
			baseDelayMs: 2_000,
			maxAgentDelayMs: 60_000,
		});
		// Simulate 9 prior DarkWake attempts so attempt 10 would normally wait 60s.
		session._retryAttempt = 9;

		const startedAt = performance.now();
		setTimeout(() => {
			// Laptop sleeps for 10 minutes while waiting in the retry cooldown.
			fakeNow += 10 * 60_000;
		}, 12);

		const shouldRetry = await session._prepareRetry({
			role: "assistant",
			stopReason: "error",
			errorMessage: "No route to host",
		});
		const elapsedMs = performance.now() - startedAt;

		expect(shouldRetry).toBe(true);
		// Resolved immediately on wake instead of waiting 60_000ms.
		expect(elapsedMs).toBeLessThan(500);
		// Retry attempt counter was reset to 1 for the immediate post-wake retry.
		expect(session._retryAttempt).toBe(1);

		// If the first post-wake retry fails while Wi-Fi is still reconnecting,
		// the next retry starts fresh at attempt 1 (baseDelayMs = 2ms in fast policy).
		session.settingsManager = {
			getRetrySettings: () => ({
				enabled: true,
				maxRetries: 12,
				baseDelayMs: 5,
				maxAgentDelayMs: 60_000,
			}),
		};
		const retryAfterWakeFailure = await session._prepareRetry({
			role: "assistant",
			stopReason: "error",
			errorMessage: "No route to host",
		});
		expect(retryAfterWakeFailure).toBe(true);
		expect(session._retryAttempt).toBe(1);
		const lastRetryStart = session.emittedEvents.findLast((e) => e.type === "auto_retry_start");
		expect(lastRetryStart).toMatchObject({
			type: "auto_retry_start",
			attempt: 1,
			maxAttempts: 12,
			delayMs: 5,
		});

		controller.uninstall();
	});

	test("aborts stale in-flight LLM request on wake and retries immediately with 0ms cooldown", async () => {
		let fakeNow = 500_000;
		const { ScopedSession, controller } = createHarness({
			clock: () => fakeNow,
			sleepCheckIntervalMs: 5,
			sleepJumpThresholdMs: 1_000,
		});

		const session = new ScopedSession({
			enabled: true,
			maxRetries: 2,
			baseDelayMs: 30_000,
			maxAgentDelayMs: 60_000,
		});
		// Exhausted 2 retries before sleep.
		session._retryAttempt = 2;

		let abortedInFlight = false;
		session.agent.abort = () => {
			abortedInFlight = true;
		};

		// Begin an LLM turn before sleep.
		await session.agent.prepareRequest?.({});

		// Laptop sleeps for 5 minutes while the LLM request is in-flight.
		fakeNow += 5 * 60_000;
		expect(controller.checkWake()).toBe(true);
		expect(abortedInFlight).toBe(true);

		// Provider returns "aborted" due to the sleep abort; _emit normalizes it to a retryable error.
		const assistantMessage: AssistantMessageLike = {
			role: "assistant",
			stopReason: "aborted",
			errorMessage: "Request was aborted",
		};
		await session._emitExtensionEvent({ type: "message_end", message: assistantMessage });
		expect(assistantMessage.stopReason).toBe("error");
		expect(assistantMessage.errorMessage).toBe(SLEEP_INTERRUPTED_ERROR_MESSAGE);

		// _willRetryAfterAgentEnd resets the exhausted budget and reports willRetry: true.
		expect(session._willRetryAfterAgentEnd({ messages: [assistantMessage] })).toBe(true);

		// _prepareRetry runs with 0ms cooldown (no 30_000ms wait!).
		const startMs = performance.now();
		const shouldRetry = await session._prepareRetry(assistantMessage);
		const elapsedMs = performance.now() - startMs;

		expect(shouldRetry).toBe(true);
		expect(elapsedMs).toBeLessThan(100);
		expect(session._retryAttempt).toBe(1);
		expect(session.emittedEvents.at(-1)).toMatchObject({
			type: "auto_retry_start",
			attempt: 1,
			maxAttempts: 2,
			delayMs: 0,
		});

		controller.uninstall();
	});

	test("survives many DarkWake cycles exceeding maxRetries without exhausting retry budget or accumulating backoff", async () => {
		let fakeNow = 1_000_000;
		const { ScopedSession, controller } = createHarness({
			clock: () => fakeNow,
			sleepCheckIntervalMs: 5,
			sleepJumpThresholdMs: 1_000,
		});

		const session = new ScopedSession({
			enabled: true,
			maxRetries: 3,
			baseDelayMs: 5,
			maxAgentDelayMs: 60_000,
		});

		// Simulate 8 DarkWakes (more than maxRetries = 3), each preceded by a 5-minute sleep.
		for (let i = 0; i < 8; i++) {
			await session.agent.prepareRequest?.({});
			fakeNow += 5 * 60_000;
			const msg: AssistantMessageLike = {
				role: "assistant",
				stopReason: "error",
				errorMessage: "errno = 65 (No route to host)",
			};
			await session._emitExtensionEvent({ type: "message_end", message: msg });
			expect(session._willRetryAfterAgentEnd({ messages: [msg] })).toBe(true);
			const ok = await session._prepareRetry(msg);
			expect(ok).toBe(true);
			expect(session._retryAttempt).toBe(1);
			const retryEvent = session.emittedEvents.at(-1);
			expect(retryEvent?.delayMs).toBe(0);
		}

		controller.uninstall();
	});

	test("does not abort running tool calls (bash / Agent) when laptop sleeps and wakes", async () => {
		let fakeNow = 2_000_000;
		const { ScopedSession, controller } = createHarness({
			clock: () => fakeNow,
			sleepCheckIntervalMs: 5,
			sleepJumpThresholdMs: 1_000,
		});

		const session = new ScopedSession();
		let abortCalls = 0;
		session.agent.abort = () => {
			abortCalls += 1;
		};

		// LLM turn starts and completes with a toolUse message.
		await session.agent.prepareRequest?.({});
		await session._emitExtensionEvent({
			type: "message_end",
			message: { role: "assistant", stopReason: "toolUse" },
		});

		// Laptop sleeps while the tool is executing (after assistant message_end).
		fakeNow += 10 * 60_000;
		expect(controller.checkWake()).toBe(true);
		expect(abortCalls).toBe(0);

		controller.uninstall();
	});

	test("preserves normal exponential backoff and Escape cancellation when awake", async () => {
		let fakeNow = 3_000_000;
		const { ScopedSession, controller } = createHarness({
			clock: () => fakeNow,
			sleepCheckIntervalMs: 50,
			sleepJumpThresholdMs: 5_000,
		});

		const session = new ScopedSession({
			enabled: true,
			maxRetries: 2,
			baseDelayMs: 5,
			maxAgentDelayMs: 60_000,
		});

		const errorMsg: AssistantMessageLike = {
			role: "assistant",
			stopReason: "error",
			errorMessage: "503 Service Unavailable",
		};

		expect(await session._prepareRetry(errorMsg)).toBe(true);
		expect(session._retryAttempt).toBe(1);
		expect(session.emittedEvents.at(-1)?.delayMs).toBe(5);

		expect(await session._prepareRetry(errorMsg)).toBe(true);
		expect(session._retryAttempt).toBe(2);
		expect(session.emittedEvents.at(-1)?.delayMs).toBe(10);

		// 3rd attempt exceeds maxRetries = 2 when no sleep occurred.
		expect(await session._prepareRetry(errorMsg)).toBe(false);

		// Escape (abortRetry) during cooldown cancels retry and returns false.
		session._retryAttempt = 0;
		session.settingsManager = {
			getRetrySettings: () => ({
				enabled: true,
				maxRetries: 3,
				baseDelayMs: 5_000,
				maxAgentDelayMs: 60_000,
			}),
		};
		setTimeout(() => {
			session.abortRetry();
		}, 10);
		expect(await session._prepareRetry(errorMsg)).toBe(false);
		expect(session.cancelledRetries).toBe(1);
		expect(session._retryAttempt).toBe(0);

		controller.uninstall();
	});

	test("ModelRuntime.streamSimple ends stale in-flight stream on wake and avoids double-wrapping virtual models", async () => {
		let fakeNow = 4_000_000;
		const { ScopedRuntime, controller } = createHarness({
			clock: () => fakeNow,
			sleepCheckIntervalMs: 5,
			sleepJumpThresholdMs: 1_000,
		});

		const runtime = new ScopedRuntime();
		const stream = runtime.streamSimple(
			{ api: "google-generative-ai", provider: "google", id: "gemini-4-argon", virtual: true },
			{ messages: [] },
			{},
		);

		expect(runtime.streamCalls).toBe(2); // outer virtual + inner physical
		expect(stream.done).toBe(false);
		expect(runtime.lastSignal?.aborted).toBe(false);

		// Simulate laptop sleep/wake while stream is in-flight.
		fakeNow += 60_000;
		expect(controller.checkWake()).toBe(true);

		expect(stream.done).toBe(true);
		expect(runtime.lastSignal?.aborted).toBe(true);
		const result = (await stream.result?.()) as AssistantMessageLike;
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe(SLEEP_INTERRUPTED_ERROR_MESSAGE);

		controller.uninstall();
	});

	test("treats 'Request aborted' when closing laptop (w5G:pR failure) as retryable and retries immediately via timestamp/durationMs sleep drift", async () => {
		// Exact timestamps from w5G:pR (2026-11-13T18:35:59.624Z -> 2026-11-13T18:37:24.913Z):
		// 85,289ms wall-clock elapsed vs 15,689ms monotonic durationMs (69.6s laptop sleep).
		const requestStartedAt = 1794594959624;
		const failedAt = 1794595044913;
		let fakeNow = failedAt;

		const { ScopedSession, controller } = createHarness({
			clock: () => fakeNow,
			sleepCheckIntervalMs: 50,
			sleepJumpThresholdMs: 4_000,
		});

		const session = new ScopedSession({
			enabled: true,
			maxRetries: 12,
			baseDelayMs: 2_000,
			maxAgentDelayMs: 60_000,
		});

		const w5GpRMessage: AssistantMessageLike = {
			role: "assistant",
			content: [],
			api: "google-generative-ai",
			provider: "google",
			model: "gemini-4-argon",
			stopReason: "error",
			timestamp: requestStartedAt,
			errorMessage: "Request aborted",
			durationMs: 15_689,
		};

		expect(didMessageSpanSleep(w5GpRMessage, fakeNow, 4_000)).toBe(true);
		// Base Pi _isRetryableError would reject "Request aborted", but our patch accepts it.
		expect(session._isRetryableError(w5GpRMessage)).toBe(true);
		expect(session._willRetryAfterAgentEnd({ messages: [w5GpRMessage] })).toBe(true);

		const shouldRetry = await session._prepareRetry(w5GpRMessage);
		expect(shouldRetry).toBe(true);
		expect(session._retryAttempt).toBe(1);
		expect(session.emittedEvents.at(-1)).toMatchObject({
			type: "auto_retry_start",
			attempt: 1,
			maxAttempts: 12,
			delayMs: 0,
			errorMessage: "Request aborted",
		});

		// Permanent quota/overflow errors or explicit user aborts are never retried.
		expect(
			session._isRetryableError({
				role: "assistant",
				stopReason: "error",
				errorMessage: "prompt is too long",
				timestamp: requestStartedAt,
				durationMs: 15_689,
			}),
		).toBe(false);
		session._agentRunAbortRequested = true;
		expect(session._isRetryableError(w5GpRMessage)).toBe(false);

		controller.uninstall();
	});

	test("automatically resumes a session upon wake if it had already settled on 'Error: Request aborted' while closing the laptop", async () => {
		let fakeNow = 6_000_000;
		const { ScopedSession, controller } = createHarness({
			clock: () => fakeNow,
			sleepCheckIntervalMs: 5,
			sleepJumpThresholdMs: 1_000,
		});

		const session = new ScopedSession({
			enabled: true,
			maxRetries: 3,
			baseDelayMs: 2_000,
			maxAgentDelayMs: 60_000,
		});

		const userMsg: AssistantMessageLike = { role: "user" };
		const failedAssistantMsg: AssistantMessageLike = {
			role: "assistant",
			stopReason: "error",
			errorMessage: "Request aborted",
		};
		session.agent.state!.messages = [userMsg, failedAssistantMsg];

		let continueCalls = 0;
		session.agent.continue = async () => {
			continueCalls += 1;
			const recoveredMsg: AssistantMessageLike = {
				role: "assistant",
				stopReason: "stop",
			};
			session.agent.state!.messages!.push(recoveredMsg);
			await session._emitExtensionEvent({ type: "message_end", message: recoveredMsg });
		};

		// Session fails with "Request aborted" and settles before/during sleep.
		await session._emitExtensionEvent({ type: "message_end", message: failedAssistantMsg });
		await session._emitExtensionEvent({ type: "agent_settled", aborted: false });

		expect(continueCalls).toBe(0);

		// Laptop wakes up after a 10-minute sleep.
		fakeNow += 10 * 60_000;
		expect(controller.checkWake()).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(continueCalls).toBe(1);
		expect(session.omittedMessages).toContain(failedAssistantMsg);
		expect(session.settledCount).toBe(1);

		controller.uninstall();
	});

	test("reports status via /sleep-wake-retry and restores prototypes on session_shutdown", async () => {
		let fakeNow = 5_000_000;
		const { ScopedSession, ScopedRuntime, emit, commands, notifications } = createHarness({
			clock: () => fakeNow,
		});
		const origPrepare = FakeAgentSession.prototype._prepareRetry;

		expect(ScopedSession.prototype._prepareRetry).not.toBe(origPrepare);

		await commands.get("sleep-wake-retry")?.handler("", {
			ui: {
				notify(message: string, type?: string) {
					notifications.push({ message, type });
				},
			},
		});
		expect(notifications.at(-1)?.message).toContain("sleep-wake-retry: active");

		await emit("session_shutdown");
		// After shutdown, prototype methods are unwrapped back to the class originals.
		expect(ScopedSession.prototype._prepareRetry.name).toBe("_prepareRetry");
		expect(ScopedRuntime.prototype.streamSimple.name).toBe("streamSimple");
	});
});
