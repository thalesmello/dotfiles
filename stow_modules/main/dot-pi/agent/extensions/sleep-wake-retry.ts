/**
 * sleep-wake-retry.ts -- immediate LLM retry and backoff reset across laptop sleep/wake.
 *
 * Why this exists
 * ---------------
 * When a laptop lid is closed while Pi is in the middle of running a session
 * (or a subagent session):
 *
 * 1. In-flight LLM streams break or hang on stale sockets across sleep, and
 *    brief macOS DarkWakes while the lid is closed fail repeatedly against an
 *    offline network interface, incrementing `AgentSession._retryAttempt` and
 *    growing the exponential backoff delay.
 * 2. When the laptop wakes up, `AgentSession._prepareRetry` sits waiting out
 *    the remaining cooldown timer (`sleep(delayMs)` / `CountdownTimer`) before
 *    retrying the LLM call, blocking the session behind a long `Retrying ...`
 *    countdown (where pressing Escape cancels the run instead of retrying now).
 *
 * How this works
 * --------------
 * A lightweight wall-clock sleep monitor (`createSleepMonitor`) checks for
 * system sleep/wake jumps (`clock() - lastTick >= SLEEP_JUMP_THRESHOLD_MS`).
 *
 * This extension patches `AgentSession.prototype` and `ModelRuntime.prototype`:
 *
 * - **During a retry cooldown (`_prepareRetry`)**: if the system wakes from a
 *   sleep while waiting in `_prepareRetry`, the cooldown wait resolves
 *   immediately (0ms remaining wait), `_retryAttempt` is reset, and `_prepareRetry`
 *   returns `true` so `agent.continue()` fires the LLM call right away.
 * - **During an in-flight LLM call (`streamSimple` / `stream` / `prepareRequest`)**:
 *   if the system wakes from a sleep while an LLM request is in-flight (and not
 *   during tool execution such as `bash` or `Agent`), the stale pre-sleep LLM
 *   stream is terminated as a retryable error (`stopReason: "error"`),
 *   `_retryAttempt` is reset, and `_prepareRetry` skips the cooldown (`delayMs = 0`)
 *   to retry the LLM call immediately.
 * - **Post-wake reconnect budget**: if that immediate 0ms post-wake retry fails
 *   while Wi-Fi/VPN is still reconnecting right after opening the lid, the next
 *   retry starts fresh at attempt 1 (`baseDelayMs`) with the full `maxRetries`
 *   budget instead of inheriting pre-sleep or DarkWake attempt counts.
 */

import * as piCodingAgent from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const SLEEP_CHECK_INTERVAL_MS = 1_000;
export const SLEEP_JUMP_THRESHOLD_MS = 4_000;
export const DEFAULT_MAX_AGENT_RETRY_DELAY_MS = 60_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
export const SLEEP_INTERRUPTED_ERROR_MESSAGE = "Socket connection was closed during system sleep";

const WRAPPED_SIGNAL_SYMBOL = Symbol.for("pi.sleepWakeRetry.wrappedSignal");

export interface RetryPolicyLike {
	enabled: boolean;
	maxRetries: number;
	baseDelayMs: number;
	maxAgentDelayMs?: number;
}

export interface ErrorInfoLike {
	retryable?: boolean;
	retryAfterMs?: number;
}

export interface AssistantMessageLike {
	role?: string;
	content?: Array<{ type?: string; id?: string; [key: string]: unknown }>;
	stopReason?: string;
	errorMessage?: string;
	errorInfo?: ErrorInfoLike;
	[key: string]: unknown;
}

export interface AgentSessionEventLike {
	type?: string;
	message?: AssistantMessageLike;
	messages?: AssistantMessageLike[];
	willRetry?: boolean;
	[key: string]: unknown;
}

export interface AgentLike {
	prepareRequest?: (request: unknown, signal?: AbortSignal) => Promise<unknown> | unknown;
	abort?: () => void;
	streamFunction?: (...args: unknown[]) => unknown;
	[key: string]: unknown;
}

export interface AgentSessionLike {
	agent?: AgentLike;
	settingsManager: {
		getRetrySettings(): RetryPolicyLike;
	};
	_isAgentRunActive?: boolean;
	_agentRunAbortRequested?: boolean;
	_retryAttempt: number;
	_declinedRetryReason?: string;
	_retryAbortController?: AbortController;
	_isRetryableError(message: AssistantMessageLike): boolean;
	_omitRecoveryAttempt(message: AssistantMessageLike): void;
	_finishCancelledRetry(): void;
	_emit(event: unknown): void;
	_emitExtensionEvent?(event: AgentSessionEventLike): Promise<void>;
	_willRetryAfterAgentEnd(event: { messages?: AssistantMessageLike[] }): boolean;
	_prepareRetry(message: AssistantMessageLike): Promise<boolean>;
	_startRun?(trigger: unknown, onStarted?: () => void): Promise<unknown>;
	_installAgentRequestProjection?(): void;
	_runDefaultCompaction?(
		preparation: unknown,
		model: unknown,
		customInstructions: unknown,
		signal: AbortSignal,
		reason: unknown,
	): Promise<unknown>;
}

export interface AssistantEventStreamLike {
	done?: boolean;
	push(event: unknown): void;
	end(result?: unknown): void;
	result?(): Promise<unknown>;
}

export interface ModelRuntimeLike {
	streamSimple(model: unknown, context: unknown, options?: Record<string, unknown>): AssistantEventStreamLike;
	stream(model: unknown, context: unknown, options?: Record<string, unknown>): AssistantEventStreamLike;
}

export interface SleepMonitorOptions {
	clock?: () => number;
	checkIntervalMs?: number;
	jumpThresholdMs?: number;
}

export interface SleepMonitor {
	/** Check whether the wall clock jumped since the last check. */
	check(): boolean;
	/** Monotonic sequence counter incremented on each detected sleep/wake jump. */
	getWakeSeq(): number;
	/** Timestamp of the most recent detected wake, or 0 if none. */
	getLastWakeAt(): number;
	/** Subscribe to wake events. Returns an unsubscribe function. */
	onWake(listener: (deltaMs: number, wakeSeq: number) => void): () => void;
	/** Stop the background interval and clear listeners. */
	close(): void;
}

export function createSleepMonitor(options: SleepMonitorOptions = {}): SleepMonitor {
	const clock = options.clock ?? Date.now;
	const checkIntervalMs = options.checkIntervalMs ?? SLEEP_CHECK_INTERVAL_MS;
	const jumpThresholdMs = options.jumpThresholdMs ?? SLEEP_JUMP_THRESHOLD_MS;

	let lastTick = clock();
	let wakeSeq = 0;
	let lastWakeAt = 0;
	const listeners = new Set<(deltaMs: number, wakeSeq: number) => void>();

	const check = (): boolean => {
		const now = clock();
		const delta = now - lastTick;
		lastTick = now;
		if (delta >= jumpThresholdMs) {
			wakeSeq += 1;
			lastWakeAt = now;
			for (const listener of [...listeners]) {
				listener(delta, wakeSeq);
			}
			return true;
		}
		return false;
	};

	const interval = setInterval(check, checkIntervalMs);
	interval.unref?.();

	return {
		check,
		getWakeSeq: () => wakeSeq,
		getLastWakeAt: () => lastWakeAt,
		onWake(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		close() {
			clearInterval(interval);
			listeners.clear();
		},
	};
}

function serverRetryDelayMs(errorInfo?: ErrorInfoLike): number | undefined {
	const delayMs = errorInfo?.retryAfterMs;
	return typeof delayMs === "number" && delayMs >= 0 ? delayMs : undefined;
}

export function computeRetryDelayLimitError(
	policy: RetryPolicyLike,
	errorInfo?: ErrorInfoLike,
): string | undefined {
	const requestedMs = serverRetryDelayMs(errorInfo);
	if (requestedMs === undefined) return undefined;
	const limitMs = Math.min(
		policy.maxAgentDelayMs ?? DEFAULT_MAX_AGENT_RETRY_DELAY_MS,
		MAX_TIMER_DELAY_MS,
	);
	if (requestedMs <= limitMs) return undefined;
	return `Server requested ${Math.ceil(requestedMs / 1000)}s retry delay (max: ${Math.ceil(limitMs / 1000)}s).`;
}

export function computeRetryDelayMs(
	policy: RetryPolicyLike,
	attempt: number,
	errorInfo?: ErrorInfoLike,
): number {
	const requestedMs = serverRetryDelayMs(errorInfo);
	if (requestedMs !== undefined) {
		const limitError = computeRetryDelayLimitError(policy, errorInfo);
		if (limitError) throw new Error(limitError);
		return requestedMs;
	}
	const delay = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
	const safeDelay = Number.isSafeInteger(delay) ? delay : Number.MAX_SAFE_INTEGER;
	return Math.min(safeDelay, policy.maxAgentDelayMs ?? DEFAULT_MAX_AGENT_RETRY_DELAY_MS);
}

/**
 * Wait for `delayMs`, resolving early with `"woke"` when `sleepMonitor` detects
 * a system sleep/wake clock jump, or `"aborted"` when `signal` aborts.
 */
export function waitForDelayOrWake(
	delayMs: number,
	signal: AbortSignal | undefined,
	sleepMonitor: SleepMonitor,
): Promise<"done" | "woke" | "aborted"> {
	if (signal?.aborted) {
		return Promise.resolve("aborted");
	}
	if (delayMs <= 0) {
		return Promise.resolve("done");
	}
	return new Promise((resolve) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let unsubWake: (() => void) | undefined;

		const finish = (outcome: "done" | "woke" | "aborted") => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			unsubWake?.();
			signal?.removeEventListener("abort", onAbort);
			resolve(outcome);
		};

		const onAbort = () => finish("aborted");
		signal?.addEventListener("abort", onAbort, { once: true });

		unsubWake = sleepMonitor.onWake(() => {
			finish("woke");
		});

		timer = setTimeout(() => {
			if (sleepMonitor.check()) {
				finish("woke");
				return;
			}
			finish("done");
		}, delayMs);
		timer.unref?.();
	});
}

type ChainedPatch<Fn> = {
	__inactive?: boolean;
	__prev?: Fn;
};

function unwrapPrototypeChain<Fn>(current: Fn): Fn {
	let cursor: unknown = current;
	while (typeof cursor === "function" && (cursor as ChainedPatch<Fn>).__inactive) {
		cursor = (cursor as ChainedPatch<Fn>).__prev;
	}
	return (cursor as Fn) ?? current;
}

interface SessionRetryState {
	/** `sleepMonitor.getWakeSeq()` when the current LLM attempt started. */
	requestWakeSeq: number;
	/** True while the immediate 0ms post-wake retry attempt is running. */
	immediateRetryInFlight: boolean;
	/** True while an LLM turn is between `prepareRequest` / `message_start` and `message_end`. */
	isInLlmStream: boolean;
	/** Unsubscribe for the current in-flight turn's wake abort listener. */
	unsubTurnWake?: () => void;
	/** Whether `this.agent.prepareRequest` on this session has been wrapped. */
	prepareRequestWrapped?: boolean;
}

export interface SleepWakeRetryOptions {
	clock?: () => number;
	sleepCheckIntervalMs?: number;
	sleepJumpThresholdMs?: number;
	AgentSessionClass?: { prototype: AgentSessionLike };
	ModelRuntimeClass?: { prototype: ModelRuntimeLike };
}

export interface SleepWakeRetryController {
	install(): boolean;
	uninstall(): void;
	isInstalled(): boolean;
	getWakeCount(): number;
	checkWake(): boolean;
}

export function createSleepWakeRetryController(
	options: SleepWakeRetryOptions = {},
): SleepWakeRetryController {
	const clock = options.clock ?? Date.now;
	const sleepCheckIntervalMs = options.sleepCheckIntervalMs ?? SLEEP_CHECK_INTERVAL_MS;
	const sleepJumpThresholdMs = options.sleepJumpThresholdMs ?? SLEEP_JUMP_THRESHOLD_MS;

	const AgentSessionClass =
		options.AgentSessionClass ??
		(piCodingAgent as unknown as { AgentSession?: { prototype: AgentSessionLike } }).AgentSession;
	const ModelRuntimeClass =
		options.ModelRuntimeClass ??
		(piCodingAgent as unknown as { ModelRuntime?: { prototype: ModelRuntimeLike } }).ModelRuntime;

	let sleepMonitor: SleepMonitor | undefined;
	let installed = false;
	const sessionStates = new WeakMap<AgentSessionLike, SessionRetryState>();

	let origPrepareRetry: AgentSessionLike["_prepareRetry"] | undefined;
	let origWillRetryAfterAgentEnd: AgentSessionLike["_willRetryAfterAgentEnd"] | undefined;
	let origEmit: AgentSessionLike["_emit"] | undefined;
	let origEmitExtensionEvent: AgentSessionLike["_emitExtensionEvent"] | undefined;
	let origStartRun: AgentSessionLike["_startRun"] | undefined;
	let origInstallAgentRequestProjection: AgentSessionLike["_installAgentRequestProjection"] | undefined;
	let origStreamSimple: ModelRuntimeLike["streamSimple"] | undefined;
	let origStream: ModelRuntimeLike["stream"] | undefined;

	function ensureMonitor(): SleepMonitor {
		if (!sleepMonitor) {
			sleepMonitor = createSleepMonitor({
				clock,
				checkIntervalMs: sleepCheckIntervalMs,
				jumpThresholdMs: sleepJumpThresholdMs,
			});
		}
		return sleepMonitor;
	}

	function clearTurnWakeListener(state: SessionRetryState): void {
		state.isInLlmStream = false;
		if (state.unsubTurnWake) {
			state.unsubTurnWake();
			state.unsubTurnWake = undefined;
		}
	}

	function beginLlmAttempt(session: AgentSessionLike, state: SessionRetryState): void {
		const monitor = ensureMonitor();
		monitor.check();
		clearTurnWakeListener(state);
		state.requestWakeSeq = monitor.getWakeSeq();
		state.isInLlmStream = true;
		state.unsubTurnWake = monitor.onWake(() => {
			if (!state.isInLlmStream || session._agentRunAbortRequested) {
				return;
			}
			session.agent?.abort?.();
		});
	}

	function ensurePrepareRequestWrapped(session: AgentSessionLike, state: SessionRetryState): void {
		if (state.prepareRequestWrapped || !session.agent) return;
		state.prepareRequestWrapped = true;
		const previousPrepareRequest = session.agent.prepareRequest;
		session.agent.prepareRequest = async (request: unknown, signal?: AbortSignal) => {
			beginLlmAttempt(session, state);
			return await previousPrepareRequest?.(request, signal);
		};
	}

	function getSessionState(session: AgentSessionLike): SessionRetryState {
		let state = sessionStates.get(session);
		if (!state) {
			const monitor = ensureMonitor();
			monitor.check();
			state = {
				requestWakeSeq: monitor.getWakeSeq(),
				immediateRetryInFlight: false,
				isInLlmStream: false,
			};
			sessionStates.set(session, state);
		}
		ensurePrepareRequestWrapped(session, state);
		return state;
	}

	function normalizeSleepAbortedAssistantMessage(
		session: AgentSessionLike,
		state: SessionRetryState,
		message: AssistantMessageLike | undefined,
	): void {
		if (!message || message.role !== "assistant") return;
		const monitor = ensureMonitor();
		monitor.check();
		const wokeDuringAttempt = monitor.getWakeSeq() > state.requestWakeSeq;
		if (wokeDuringAttempt && !session._agentRunAbortRequested && message.stopReason === "aborted") {
			message.stopReason = "error";
			if (
				!message.errorMessage ||
				message.errorMessage === "Request was aborted" ||
				message.errorMessage === "Operation aborted"
			) {
				message.errorMessage = SLEEP_INTERRUPTED_ERROR_MESSAGE;
			}
		}
	}

	function handleSessionEvent(session: AgentSessionLike, event: AgentSessionEventLike): void {
		const state = getSessionState(session);
		if (!event || typeof event !== "object") return;

		if (event.type === "message_start" && event.message?.role === "assistant") {
			if (!state.isInLlmStream) {
				const monitor = ensureMonitor();
				monitor.check();
				if (monitor.getWakeSeq() === state.requestWakeSeq) {
					beginLlmAttempt(session, state);
				}
			}
			normalizeSleepAbortedAssistantMessage(session, state, event.message);
			return;
		}

		if (event.type === "message_end" && event.message?.role === "assistant") {
			clearTurnWakeListener(state);
			normalizeSleepAbortedAssistantMessage(session, state, event.message);
			if (event.message.stopReason !== "error") {
				const monitor = ensureMonitor();
				state.immediateRetryInFlight = false;
				state.requestWakeSeq = monitor.getWakeSeq();
			}
			return;
		}

		if (event.type === "turn_end" || event.type === "agent_end" || event.type === "agent_settled") {
			clearTurnWakeListener(state);
			if (event.type === "agent_settled") {
				state.immediateRetryInFlight = false;
			}
			return;
		}

		if (event.type === "tool_execution_end") {
			const monitor = ensureMonitor();
			monitor.check();
			state.requestWakeSeq = monitor.getWakeSeq();
		}
	}

	function patchedInstallAgentRequestProjection(this: AgentSessionLike): void {
		origInstallAgentRequestProjection?.call(this);
		const state = getSessionState(this);
		state.prepareRequestWrapped = false;
		ensurePrepareRequestWrapped(this, state);
	}

	async function patchedStartRun(
		this: AgentSessionLike,
		trigger: unknown,
		onStarted?: () => void,
	): Promise<unknown> {
		const monitor = ensureMonitor();
		monitor.check();
		const state = getSessionState(this);
		state.requestWakeSeq = monitor.getWakeSeq();
		state.immediateRetryInFlight = false;
		try {
			return await origStartRun!.call(this, trigger, onStarted);
		} finally {
			clearTurnWakeListener(state);
			state.immediateRetryInFlight = false;
		}
	}

	async function patchedEmitExtensionEvent(
		this: AgentSessionLike,
		event: AgentSessionEventLike,
	): Promise<void> {
		handleSessionEvent(this, event);
		return await origEmitExtensionEvent!.call(this, event);
	}

	function patchedEmit(this: AgentSessionLike, event: unknown): void {
		handleSessionEvent(this, event as AgentSessionEventLike);
		return origEmit!.call(this, event);
	}

	function patchedWillRetryAfterAgentEnd(
		this: AgentSessionLike,
		event: { messages?: AssistantMessageLike[] },
	): boolean {
		if (this._agentRunAbortRequested) {
			return false;
		}
		const monitor = ensureMonitor();
		monitor.check();
		const state = getSessionState(this);
		const wokeDuringAttempt = monitor.getWakeSeq() > state.requestWakeSeq;
		if (wokeDuringAttempt || state.immediateRetryInFlight) {
			const messages = event?.messages ?? [];
			for (let i = messages.length - 1; i >= 0; i--) {
				const msg = messages[i];
				if (msg?.role === "assistant") {
					normalizeSleepAbortedAssistantMessage(this, state, msg);
					if (this._isRetryableError(msg)) {
						this._retryAttempt = 0;
						const settings = this.settingsManager.getRetrySettings();
						if (!settings.enabled || settings.maxRetries <= 0) {
							return false;
						}
						if (wokeDuringAttempt) {
							return true;
						}
						return computeRetryDelayLimitError(settings, msg.errorInfo) === undefined;
					}
					break;
				}
			}
		}
		return origWillRetryAfterAgentEnd!.call(this, event);
	}

	async function patchedPrepareRetry(
		this: AgentSessionLike,
		message: AssistantMessageLike,
	): Promise<boolean> {
		const monitor = ensureMonitor();
		monitor.check();
		const state = getSessionState(this);
		clearTurnWakeListener(state);

		const wokeDuringAttempt = monitor.getWakeSeq() > state.requestWakeSeq;
		const settings = this.settingsManager.getRetrySettings();
		if (!settings.enabled) {
			return false;
		}

		if (wokeDuringAttempt || state.immediateRetryInFlight) {
			this._retryAttempt = 0;
		}

		if (this._retryAttempt >= settings.maxRetries) {
			return false;
		}

		if (!wokeDuringAttempt) {
			const limitError = computeRetryDelayLimitError(settings, message.errorInfo);
			if (limitError) {
				this._declinedRetryReason = `${limitError} Raise retry.maxAgentDelayMs to wait longer.`;
				return false;
			}
		}

		this._retryAttempt++;
		const delayMs = wokeDuringAttempt
			? 0
			: computeRetryDelayMs(settings, this._retryAttempt, message.errorInfo);

		if (wokeDuringAttempt) {
			state.requestWakeSeq = monitor.getWakeSeq();
			state.immediateRetryInFlight = true;
		} else {
			state.immediateRetryInFlight = false;
		}

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
			const outcome = await waitForDelayOrWake(
				delayMs,
				this._retryAbortController.signal,
				monitor,
			);
			if (outcome === "aborted") {
				this._finishCancelledRetry();
				return false;
			}
			if (outcome === "woke") {
				this._retryAttempt = 1;
				state.requestWakeSeq = monitor.getWakeSeq();
				state.immediateRetryInFlight = true;
			} else {
				state.requestWakeSeq = monitor.getWakeSeq();
			}
		} catch {
			this._finishCancelledRetry();
			return false;
		} finally {
			this._retryAbortController = undefined;
		}
		return true;
	}

	function createStreamWrapper<
		Fn extends (
			model: any,
			context: any,
			options?: Record<string, unknown>,
		) => AssistantEventStreamLike,
	>(getOrig: () => Fn | undefined): Fn {
		return function (
			this: unknown,
			model: any,
			context: any,
			options?: Record<string, unknown>,
		): AssistantEventStreamLike {
			const orig = getOrig();
			if (!orig) {
				throw new Error("Original ModelRuntime stream method is unavailable");
			}
			const callerSignal = options?.signal as (AbortSignal & { [WRAPPED_SIGNAL_SYMBOL]?: boolean }) | undefined;
			if (callerSignal?.[WRAPPED_SIGNAL_SYMBOL]) {
				return orig.call(this, model, context, options);
			}

			const monitor = ensureMonitor();
			monitor.check();

			const wakeAbortController = new AbortController();
			const combinedSignal = (
				callerSignal
					? AbortSignal.any([callerSignal, wakeAbortController.signal])
					: wakeAbortController.signal
			) as AbortSignal & { [WRAPPED_SIGNAL_SYMBOL]?: boolean };
			combinedSignal[WRAPPED_SIGNAL_SYMBOL] = true;

			const stream = orig.call(this, model, context, {
				...options,
				signal: combinedSignal,
			});
			if (!stream || typeof stream.push !== "function" || typeof stream.end !== "function") {
				return stream;
			}

			const unsubWake = monitor.onWake(() => {
				if (stream.done || callerSignal?.aborted) {
					return;
				}
				const errorMessage = {
					role: "assistant" as const,
					content: [],
					api: model?.api ?? "unknown",
					provider: model?.provider ?? "unknown",
					model: model?.id ?? "unknown",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "error" as const,
					errorMessage: SLEEP_INTERRUPTED_ERROR_MESSAGE,
					timestamp: Math.max(Date.now(), clock()),
				};
				stream.push({ type: "error", reason: "error", error: errorMessage });
				stream.end(errorMessage);
				wakeAbortController.abort();
			});

			if (typeof stream.result === "function") {
				Promise.resolve(stream.result()).then(
					() => unsubWake(),
					() => unsubWake(),
				);
			}

			return stream;
		} as Fn;
	}

	const patchedStreamSimple = createStreamWrapper(() => origStreamSimple);
	const patchedStream = createStreamWrapper(() => origStream);

	function install(): boolean {
		if (installed) return true;
		const sessionProto = AgentSessionClass?.prototype;
		if (!sessionProto || typeof sessionProto._prepareRetry !== "function") {
			return false;
		}

		ensureMonitor();

		origPrepareRetry = sessionProto._prepareRetry;
		(patchedPrepareRetry as typeof origPrepareRetry & ChainedPatch<typeof origPrepareRetry>).__inactive = false;
		(patchedPrepareRetry as typeof origPrepareRetry & ChainedPatch<typeof origPrepareRetry>).__prev =
			origPrepareRetry;
		sessionProto._prepareRetry = patchedPrepareRetry;

		if (typeof sessionProto._willRetryAfterAgentEnd === "function") {
			origWillRetryAfterAgentEnd = sessionProto._willRetryAfterAgentEnd;
			(
				patchedWillRetryAfterAgentEnd as typeof origWillRetryAfterAgentEnd &
					ChainedPatch<typeof origWillRetryAfterAgentEnd>
			).__inactive = false;
			(
				patchedWillRetryAfterAgentEnd as typeof origWillRetryAfterAgentEnd &
					ChainedPatch<typeof origWillRetryAfterAgentEnd>
			).__prev = origWillRetryAfterAgentEnd;
			sessionProto._willRetryAfterAgentEnd = patchedWillRetryAfterAgentEnd;
		}

		if (typeof sessionProto._emit === "function") {
			origEmit = sessionProto._emit;
			(patchedEmit as typeof origEmit & ChainedPatch<typeof origEmit>).__inactive = false;
			(patchedEmit as typeof origEmit & ChainedPatch<typeof origEmit>).__prev = origEmit;
			sessionProto._emit = patchedEmit;
		}

		if (typeof sessionProto._emitExtensionEvent === "function") {
			origEmitExtensionEvent = sessionProto._emitExtensionEvent;
			(
				patchedEmitExtensionEvent as typeof origEmitExtensionEvent &
					ChainedPatch<typeof origEmitExtensionEvent>
			).__inactive = false;
			(
				patchedEmitExtensionEvent as typeof origEmitExtensionEvent &
					ChainedPatch<typeof origEmitExtensionEvent>
			).__prev = origEmitExtensionEvent;
			sessionProto._emitExtensionEvent = patchedEmitExtensionEvent;
		}

		if (typeof sessionProto._startRun === "function") {
			origStartRun = sessionProto._startRun;
			(patchedStartRun as typeof origStartRun & ChainedPatch<typeof origStartRun>).__inactive = false;
			(patchedStartRun as typeof origStartRun & ChainedPatch<typeof origStartRun>).__prev = origStartRun;
			sessionProto._startRun = patchedStartRun;
		}

		if (typeof sessionProto._installAgentRequestProjection === "function") {
			origInstallAgentRequestProjection = sessionProto._installAgentRequestProjection;
			(
				patchedInstallAgentRequestProjection as typeof origInstallAgentRequestProjection &
					ChainedPatch<typeof origInstallAgentRequestProjection>
			).__inactive = false;
			(
				patchedInstallAgentRequestProjection as typeof origInstallAgentRequestProjection &
					ChainedPatch<typeof origInstallAgentRequestProjection>
			).__prev = origInstallAgentRequestProjection;
			sessionProto._installAgentRequestProjection = patchedInstallAgentRequestProjection;
		}

		const runtimeProto = ModelRuntimeClass?.prototype;
		if (runtimeProto) {
			if (typeof runtimeProto.streamSimple === "function") {
				origStreamSimple = runtimeProto.streamSimple;
				(
					patchedStreamSimple as typeof origStreamSimple & ChainedPatch<typeof origStreamSimple>
				).__inactive = false;
				(
					patchedStreamSimple as typeof origStreamSimple & ChainedPatch<typeof origStreamSimple>
				).__prev = origStreamSimple;
				runtimeProto.streamSimple = patchedStreamSimple;
			}
			if (typeof runtimeProto.stream === "function") {
				origStream = runtimeProto.stream;
				(patchedStream as typeof origStream & ChainedPatch<typeof origStream>).__inactive = false;
				(patchedStream as typeof origStream & ChainedPatch<typeof origStream>).__prev = origStream;
				runtimeProto.stream = patchedStream;
			}
		}

		installed = true;
		return true;
	}

	function uninstall(): void {
		if (!installed) return;
		const sessionProto = AgentSessionClass?.prototype;
		if (sessionProto) {
			if (origPrepareRetry) {
				(
					patchedPrepareRetry as typeof origPrepareRetry & ChainedPatch<typeof origPrepareRetry>
				).__inactive = true;
				sessionProto._prepareRetry = unwrapPrototypeChain(sessionProto._prepareRetry);
			}
			if (origWillRetryAfterAgentEnd) {
				(
					patchedWillRetryAfterAgentEnd as typeof origWillRetryAfterAgentEnd &
						ChainedPatch<typeof origWillRetryAfterAgentEnd>
				).__inactive = true;
				sessionProto._willRetryAfterAgentEnd = unwrapPrototypeChain(
					sessionProto._willRetryAfterAgentEnd,
				);
			}
			if (origEmit) {
				(patchedEmit as typeof origEmit & ChainedPatch<typeof origEmit>).__inactive = true;
				sessionProto._emit = unwrapPrototypeChain(sessionProto._emit);
			}
			if (origEmitExtensionEvent && sessionProto._emitExtensionEvent) {
				(
					patchedEmitExtensionEvent as typeof origEmitExtensionEvent &
						ChainedPatch<typeof origEmitExtensionEvent>
				).__inactive = true;
				sessionProto._emitExtensionEvent = unwrapPrototypeChain(
					sessionProto._emitExtensionEvent,
				);
			}
			if (origStartRun && sessionProto._startRun) {
				(patchedStartRun as typeof origStartRun & ChainedPatch<typeof origStartRun>).__inactive =
					true;
				sessionProto._startRun = unwrapPrototypeChain(sessionProto._startRun);
			}
			if (origInstallAgentRequestProjection && sessionProto._installAgentRequestProjection) {
				(
					patchedInstallAgentRequestProjection as typeof origInstallAgentRequestProjection &
						ChainedPatch<typeof origInstallAgentRequestProjection>
				).__inactive = true;
				sessionProto._installAgentRequestProjection = unwrapPrototypeChain(
					sessionProto._installAgentRequestProjection,
				);
			}
		}

		const runtimeProto = ModelRuntimeClass?.prototype;
		if (runtimeProto) {
			if (origStreamSimple) {
				(
					patchedStreamSimple as typeof origStreamSimple & ChainedPatch<typeof origStreamSimple>
				).__inactive = true;
				runtimeProto.streamSimple = unwrapPrototypeChain(runtimeProto.streamSimple);
			}
			if (origStream) {
				(patchedStream as typeof origStream & ChainedPatch<typeof origStream>).__inactive = true;
				runtimeProto.stream = unwrapPrototypeChain(runtimeProto.stream);
			}
		}

		sleepMonitor?.close();
		sleepMonitor = undefined;
		installed = false;
	}

	return {
		install,
		uninstall,
		isInstalled: () => installed,
		getWakeCount: () => sleepMonitor?.getWakeSeq() ?? 0,
		checkWake: () => ensureMonitor().check(),
	};
}

let defaultController: SleepWakeRetryController | undefined;
const activeExtensionHosts = new Set<unknown>();

export default function sleepWakeRetryExtension(
	pi: ExtensionAPI,
	options?: SleepWakeRetryOptions,
): SleepWakeRetryController {
	const usesCustomOptions = Boolean(
		options?.AgentSessionClass ||
			options?.ModelRuntimeClass ||
			options?.clock ||
			options?.sleepCheckIntervalMs !== undefined ||
			options?.sleepJumpThresholdMs !== undefined,
	);
	const controller = usesCustomOptions
		? createSleepWakeRetryController(options)
		: (defaultController ??= createSleepWakeRetryController());

	if (!usesCustomOptions) {
		activeExtensionHosts.add(pi);
	}
	controller.install();

	pi.on("session_start", () => {
		if (!usesCustomOptions) {
			activeExtensionHosts.add(pi);
		}
		controller.install();
	});

	pi.on("session_shutdown", () => {
		if (usesCustomOptions) {
			controller.uninstall();
			return;
		}
		activeExtensionHosts.delete(pi);
		if (activeExtensionHosts.size === 0) {
			controller.uninstall();
		}
	});

	pi.registerCommand("sleep-wake-retry", {
		description: "Report whether sleep/wake immediate retry recovery is active",
		handler: async (_args, ctx) => {
			const active = controller.isInstalled();
			const wakes = controller.getWakeCount();
			ctx.ui.notify(
				active
					? `sleep-wake-retry: active (immediate LLM retry after system sleep; ${wakes} wake transition${wakes === 1 ? "" : "s"} observed)`
					: "sleep-wake-retry: inactive (patch not installed)",
				active ? "info" : "warning",
			);
		},
	});

	return controller;
}
