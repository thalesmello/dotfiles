import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import permissionAutoReview, {
	MAX_REVIEW_ATTEMPTS,
	REVIEW_TIMEOUT_MS,
	resolveJudgeModel,
	resolveJudgeModels,
} from "../extensions/pi-permission-system/auto-review/index.js";
import { composeAuthorizerChain } from "../extensions/pi-permission-system/src/authority/authorizer-chain.ts";
import { LocalUserAuthorizer } from "../extensions/pi-permission-system/src/authority/local-user-authorizer.ts";
import {
	initialPromptState,
	type PromptModelConfig,
	reducePrompt,
	visibleActions,
} from "../extensions/pi-permission-system/src/authority/permission-prompt-decision.ts";
import { DEFAULT_DIALOG_KEYS } from "../extensions/pi-permission-system/src/config/dialog-keys.ts";
import { applyPermissionGate } from "../extensions/pi-permission-system/src/policy/permission-gate.ts";
import { SessionApproval } from "../extensions/pi-permission-system/src/session/session-approval.ts";
import { SessionRules } from "../extensions/pi-permission-system/src/session/session-rules.ts";

// dialog-renderer and config-modal reach @earendil-works/pi-tui / pi-coding-agent
// (only resolvable inside pi); stub them for unit testing.
mock.module("@earendil-works/pi-tui", () => ({
	wrapTextWithAnsi: (line: string) => [line],
	truncateToWidth: (line: string) => line,
	SettingsList: class {},
}));
mock.module("@earendil-works/pi-coding-agent", () => ({
	getSettingsListTheme: () => ({}),
}));

const { renderPromptDialog } = await import(
	"../extensions/pi-permission-system/src/presentation/dialog-renderer.ts"
);
const { mutateGlobalPermissionRule } = await import(
	"../extensions/pi-permission-system/src/config/config-modal.ts"
);

const payload = {
	kind: "bash",
	request: {
		requester: { agentName: null, forwarded: false, sessionId: null },
		surface: "bash",
		toolName: "bash",
		invokedToolName: null,
		value: "git push origin main",
		matchedPattern: "git push*",
		matchedSpelling: null,
		commandContext: null,
		executedUnit: null,
		decidingPath: null,
	},
	evidence: [],
	annotations: [],
} as never;

function makeDetails() {
	return {
		requestId: "req-1",
		source: "tool_call",
		agentName: null,
		payload,
	} as never;
}

const log = { debug() {}, review() {} } as never;
const query = {} as never;

describe("authorizer chain defer reason", () => {
	test("defer reason is annotated onto the payload the terminal renders", async () => {
		let seen: never | undefined;
		const terminal = {
			authorize: async (details: never) => {
				seen = details;
				return {
					approved: true,
					state: "approved",
					decidedBy: { kind: "user", via: "dialog" },
				} as never;
			},
		};
		const link = {
			name: "auto-review",
			authorize: async () => ({
				kind: "defer",
				reason: "Pushes to remote main, which you did not ask for.",
			}),
		};
		const chain = composeAuthorizerChain([link as never], terminal as never, query, log);
		await chain.authorize(makeDetails());

		const annotations = (seen as unknown as { payload: { annotations: unknown[] } }).payload
			.annotations;
		expect(annotations).toEqual([
			{ source: "auto-review", text: "Pushes to remote main, which you did not ask for." },
		]);

		const view = renderPromptDialog(
			(seen as unknown as { payload: never }).payload,
			{ maxRows: 24, fieldMaxWidth: 400, width: 80 },
		);
		expect(view.lines.join("\n")).toContain(
			"auto-review (AI) : Pushes to remote main, which you did not ask for.",
		);
	});

	test("defer without a reason leaves the payload untouched", async () => {
		let seen: never | undefined;
		const terminal = {
			authorize: async (details: never) => {
				seen = details;
				return {
					approved: true,
					state: "approved",
					decidedBy: { kind: "user", via: "dialog" },
				} as never;
			},
		};
		const link = {
			name: "auto-review",
			authorize: async () => ({ kind: "defer" }),
		};
		const chain = composeAuthorizerChain([link as never], terminal as never, query, log);
		await chain.authorize(makeDetails());
		expect(
			(seen as unknown as { payload: { annotations: unknown[] } }).payload.annotations,
		).toEqual([]);
	});
});

describe("auto-review judge & natural-language rule proposer", () => {
	function makeAutoReview(reply: string) {
		let authorize: ((details: unknown, query: unknown, log: unknown) => Promise<unknown>) | undefined;
		let sessionStart: ((event: unknown, ctx: unknown) => void) | undefined;
		let capturedUserPrompt = "";
		const pi = {
			on(event: string, handler: (event: unknown, ctx: unknown) => void) {
				if (event === "session_start") sessionStart = handler;
			},
			registerCommand() {},
		};
		const handle = permissionAutoReview(pi as never, {
			register(_name: string, fn: typeof authorize) {
				authorize = fn;
			},
		});
		sessionStart?.(null, {
			hasUI: false,
			cwd: "/Users/thalesmello/src/dotfiles",
			model: { provider: "anthropic", id: "fallback" },
			sessionManager: { getBranch: () => [] },
			modelRegistry: {
				find: () => undefined,
				complete: async (_model: unknown, req: { messages: Array<{ content: Array<{ text: string }> }> }) => {
					capturedUserPrompt = req.messages[0]?.content[0]?.text ?? "";
					return { content: [{ type: "text", text: reply }] };
				},
			},
		});
		return {
			authorize: authorize!,
			proposeRules: handle.proposeRules,
			getCapturedUserPrompt: () => capturedUserPrompt,
		};
	}

	test("defer returns the judge's reason", async () => {
		const { authorize } = makeAutoReview(
			'{"verdict":"defer","reason":"Pushes to remote main, which you did not ask for."}',
		);
		const verdict = await authorize(
			{ requestId: "r", payload: { request: { surface: "bash" } }, command: "git push" },
			{},
			log,
		);
		expect(verdict).toEqual({
			kind: "defer",
			reason: "Pushes to remote main, which you did not ask for.",
		});
	});

	test("allow still allows without a dialog reason", async () => {
		const { authorize } = makeAutoReview('{"verdict":"allow","reason":"Routine local work."}');
		const verdict = await authorize(
			{ requestId: "r", payload: { request: { surface: "bash" } }, command: "ls" },
			{},
			log,
		);
		expect(verdict).toEqual({ kind: "allow" });
	});

	test("proposeRules interprets natural language into concrete grants with pending context", async () => {
		const { proposeRules, getCapturedUserPrompt } = makeAutoReview(
			'{"grants":[{"surface":"bash","pattern":"bun test *","action":"allow"}],"summary":"Allow running bun test commands"}',
		);
		const proposal = await proposeRules("allow running bun test with any arguments", payload);
		expect(proposal).toEqual({
			grants: [{ surface: "bash", pattern: "bun test *", action: "allow" }],
			summary: "Allow running bun test commands",
		});
		expect(getCapturedUserPrompt()).toContain("git push origin main");
		expect(getCapturedUserPrompt()).toContain("allow running bun test with any arguments");
	});

	test("resolveJudgeModel always prefers the light model of the active family", () => {
		const catalog = [
			{ provider: "meta", id: "muse-wonder-1.0-internal" },
			{ provider: "meta", id: "muse-spark-1.4-internal" },
			{ provider: "openai", id: "gpt-6.1-sol" },
			{ provider: "openai", id: "gpt-6-luna" },
			{ provider: "anthropic", id: "claude-opus-5-5" },
			{ provider: "anthropic", id: "claude-haiku-5-5" },
			{ provider: "google", id: "gemini-4-argon" },
			{ provider: "google", id: "gemini-3.8-flash" },
		];
		const registry = {
			find: (p: string, id: string) => catalog.find((m) => m.provider === p && m.id === id),
			getAll: () => catalog,
			hasConfiguredAuth: () => true,
		};

		expect(resolveJudgeModel(registry, { provider: "meta", id: "muse-wonder-1.0-internal" })).toEqual({
			provider: "meta",
			id: "muse-spark-1.4-internal",
		});
		expect(resolveJudgeModel(registry, { provider: "openai", id: "gpt-6.1-sol" })).toEqual({
			provider: "openai",
			id: "gpt-6-luna",
		});
		expect(resolveJudgeModel(registry, { provider: "anthropic", id: "claude-opus-5-5" })).toEqual({
			provider: "anthropic",
			id: "claude-haiku-5-5",
		});
		expect(resolveJudgeModel(registry, { provider: "google", id: "gemini-4-argon" })).toEqual({
			provider: "google",
			id: "gemini-3.8-flash",
		});
	});

	test("uses a 30s timeout with retries on timeout or transient error", async () => {
		expect(REVIEW_TIMEOUT_MS).toBe(30_000);
		expect(MAX_REVIEW_ATTEMPTS).toBe(5);

		let authorize: ((details: unknown, query: unknown, log: unknown) => Promise<unknown>) | undefined;
		let sessionStart: ((event: unknown, ctx: unknown) => void) | undefined;
		let calls = 0;
		const pi = {
			on(event: string, handler: (event: unknown, ctx: unknown) => void) {
				if (event === "session_start") sessionStart = handler;
			},
			registerCommand() {},
		};
		permissionAutoReview(
			pi as never,
			{
				register(_name: string, fn: typeof authorize) {
					authorize = fn;
				},
			},
			{ timeoutMs: 25, retryDelaysMs: [2, 2, 2, 2] },
		);
		sessionStart?.(null, {
			hasUI: false,
			cwd: "/Users/thalesmello/src/dotfiles",
			model: { provider: "google", id: "gemini-3.8-flash" },
			sessionManager: { getBranch: () => [] },
			modelRegistry: {
				find: () => undefined,
				complete: async (_model: unknown, _req: unknown, opts: { signal?: AbortSignal }) => {
					calls += 1;
					if (calls <= 2) {
						await new Promise((resolve) => {
							opts.signal?.addEventListener("abort", resolve, { once: true });
						});
						return { stopReason: "aborted", content: [] };
					}
					return { content: [{ type: "text", text: '{"verdict":"allow","reason":"Retry succeeded."}' }] };
				},
			},
		});

		const verdict = await authorize!(
			{ requestId: "r-retry", payload: { request: { surface: "bash" } }, command: "ls" },
			{},
			log,
		);
		expect(calls).toBe(3);
		expect(verdict).toEqual({ kind: "allow" });
	});

	test("resets retry budget and aborts stale request when laptop sleeps and resumes (clock jump)", async () => {
		let authorize: ((details: unknown, query: unknown, log: unknown) => Promise<unknown>) | undefined;
		let sessionStart: ((event: unknown, ctx: unknown) => void) | undefined;
		let calls = 0;
		let fakeNow = 1_000_000;
		const pi = {
			on(event: string, handler: (event: unknown, ctx: unknown) => void) {
				if (event === "session_start") sessionStart = handler;
			},
			registerCommand() {},
		};
		permissionAutoReview(
			pi as never,
			{
				register(_name: string, fn: typeof authorize) {
					authorize = fn;
				},
			},
			{
				timeoutMs: 50,
				maxAttempts: 2,
				retryDelaysMs: [2],
				sleepCheckIntervalMs: 5,
				sleepJumpThresholdMs: 1_000,
				postWakeSettleMs: 5,
				clock: () => fakeNow,
			},
		);
		sessionStart?.(null, {
			hasUI: false,
			cwd: "/Users/thalesmello/src/dotfiles",
			model: { provider: "google", id: "gemini-3.8-flash" },
			sessionManager: { getBranch: () => [] },
			modelRegistry: {
				find: () => undefined,
				complete: async (_model: unknown, _req: unknown, opts: { signal?: AbortSignal }) => {
					calls += 1;
					if (calls === 1) {
						// Attempt 1 fails right before sleep
						return { stopReason: "error", errorMessage: "socket closed", content: [] };
					}
					if (calls === 2) {
						// Attempt 2 is in-flight when laptop lid closes for 10 minutes
						setTimeout(() => {
							fakeNow += 10 * 60_000;
						}, 8);
						await new Promise((resolve) => {
							opts.signal?.addEventListener("abort", resolve, { once: true });
						});
						return { stopReason: "aborted", content: [] };
					}
					if (calls === 3) {
						// First post-wake attempt fails while Wi-Fi is still reconnecting
						return { stopReason: "error", errorMessage: "network unreachable", content: [] };
					}
					// Second post-wake attempt succeeds because wake reset the 2-attempt budget!
					return { content: [{ type: "text", text: '{"verdict":"allow","reason":"Resumed after wake."}' }] };
				},
			},
		});

		const verdict = await authorize!(
			{ requestId: "r-sleep-wake", payload: { request: { surface: "bash" } }, command: "ls" },
			{},
			log,
		);
		expect(calls).toBe(4);
		expect(verdict).toEqual({ kind: "allow" });
	});

	test("falls back to secondary fast models in the same family on later retry attempts", async () => {
		const catalog = [
			{ provider: "google", id: "gemini-3.8-flash" },
			{ provider: "google", id: "gemini-3.6-flash" },
			{ provider: "google", id: "gemini-3.5-flash" },
		];
		const registry = {
			find: (p: string, id: string) => catalog.find((m) => m.provider === p && m.id === id),
			getAll: () => catalog,
			hasConfiguredAuth: () => true,
		};
		expect(resolveJudgeModels(registry, { provider: "google", id: "gemini-4-argon" })).toEqual(catalog);

		let authorize: ((details: unknown, query: unknown, log: unknown) => Promise<unknown>) | undefined;
		let sessionStart: ((event: unknown, ctx: unknown) => void) | undefined;
		const seenModels: string[] = [];
		const pi = {
			on(event: string, handler: (event: unknown, ctx: unknown) => void) {
				if (event === "session_start") sessionStart = handler;
			},
			registerCommand() {},
		};
		permissionAutoReview(
			pi as never,
			{
				register(_name: string, fn: typeof authorize) {
					authorize = fn;
				},
			},
			{ timeoutMs: 20, retryDelaysMs: [1, 1, 1, 1] },
		);
		sessionStart?.(null, {
			hasUI: false,
			cwd: "/Users/thalesmello/src/dotfiles",
			model: { provider: "google", id: "gemini-4-argon" },
			sessionManager: { getBranch: () => [] },
			modelRegistry: {
				...registry,
				complete: async (model: { id: string }) => {
					seenModels.push(model.id);
					if (seenModels.length < 3) {
						return { stopReason: "error", errorMessage: "503 unavailable", content: [] };
					}
					return { content: [{ type: "text", text: '{"verdict":"allow","reason":"Fallback model succeeded."}' }] };
				},
			},
		});

		const verdict = await authorize!(
			{ requestId: "r-fallback-model", payload: { request: { surface: "bash" } }, command: "ls" },
			{},
			log,
		);
		expect(seenModels).toEqual(["gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.6-flash"]);
		expect(verdict).toEqual({ kind: "allow" });
	});

	test("defers with transient: true after exhausting all attempts when every attempt times out", async () => {
		let authorize: ((details: unknown, query: unknown, log: unknown) => Promise<unknown>) | undefined;
		let sessionStart: ((event: unknown, ctx: unknown) => void) | undefined;
		let calls = 0;
		const pi = {
			on(event: string, handler: (event: unknown, ctx: unknown) => void) {
				if (event === "session_start") sessionStart = handler;
			},
			registerCommand() {},
		};
		permissionAutoReview(
			pi as never,
			{
				register(_name: string, fn: typeof authorize) {
					authorize = fn;
				},
			},
			{ timeoutMs: 15, retryDelaysMs: [1, 1, 1, 1] },
		);
		sessionStart?.(null, {
			hasUI: false,
			cwd: "/Users/thalesmello/src/dotfiles",
			model: { provider: "google", id: "gemini-3.8-flash" },
			sessionManager: { getBranch: () => [] },
			modelRegistry: {
				find: () => undefined,
				complete: async (_model: unknown, _req: unknown, opts: { signal?: AbortSignal }) => {
					calls += 1;
					await new Promise((resolve) => {
						opts.signal?.addEventListener("abort", resolve, { once: true });
					});
					return { stopReason: "aborted", content: [] };
				},
			},
		});

		const verdict = await authorize!(
			{ requestId: "r-timeout", payload: { request: { surface: "bash" } }, command: "ls" },
			{},
			log,
		);
		expect(calls).toBe(MAX_REVIEW_ATTEMPTS);
		expect(verdict).toEqual({
			kind: "defer",
			reason: "Auto-review judge (google/gemini-3.8-flash) timed out, so asking you instead.",
			transient: true,
		});
	});

	test("background re-evaluation auto-resolves an open prompt after laptop resume when initial evaluation timed out", async () => {
		let calls = 0;
		const link = {
			name: "auto-review",
			authorize: async () => {
				calls += 1;
				if (calls === 1) {
					return {
						kind: "defer" as const,
						reason: "Auto-review judge (google/gemini-3.8-flash) timed out, so asking you instead.",
						transient: true,
					};
				}
				return { kind: "allow" as const };
			},
		};
		const terminal = {
			authorize: async (details: {
				reevaluate?: (signal: AbortSignal) => Promise<unknown>;
			}) => {
				expect(typeof details.reevaluate).toBe("function");
				const controller = new AbortController();
				const reevaluated = await details.reevaluate!(controller.signal);
				expect(reevaluated).toEqual({
					approved: true,
					state: "approved",
					decidedBy: {
						kind: "authorizer",
						name: "auto-review",
						verdict: "allow",
						reason: null,
					},
				});
				return reevaluated as never;
			},
		};
		const chain = composeAuthorizerChain([link as never], terminal as never, query, log, {
			reevaluateBaseDelayMs: 5,
			reevaluateMaxDelayMs: 20,
			sleepCheckIntervalMs: 5,
		});
		const decision = await chain.authorize(makeDetails());
		expect(calls).toBe(2);
		expect(decision).toEqual({
			approved: true,
			state: "approved",
			decidedBy: {
				kind: "authorizer",
				name: "auto-review",
				verdict: "allow",
				reason: null,
			},
		});
	});
});

describe("permission prompt explain-and-propose flow", () => {
	const config: PromptModelConfig = {
		doublePressToConfirm: true,
		keys: DEFAULT_DIALOG_KEYS,
		sessionLabel: 'Yes, allow bash "git push *" for this session',
		canProposeRules: true,
	};

	test("pressing (e) opens explain step, proposes rule, and commits global customGrants", async () => {
		expect(visibleActions(config)).toContain("explainAllow");

		let state = initialPromptState(config);
		// Single press of 'e' opens the explain editor immediately even when doublePressToConfirm is true
		const step1 = reducePrompt(config, state, { type: "hotkey", action: "explainAllow" });
		expect(step1.kind).toBe("render");
		if (step1.kind !== "render") return;
		expect(step1.state.step).toBe("explain");

		// Submitting natural language transitions to 'proposing'
		const step2 = reducePrompt(config, step1.state, {
			type: "submitExplain",
			draft: "allow pushing to feature branches on origin",
		});
		expect(step2.kind).toBe("render");
		if (step2.kind !== "render") return;
		expect(step2.state.step).toBe("proposing");
		expect(step2.state.explainDraft).toBe("allow pushing to feature branches on origin");

		// AI proposal arrives -> transitions to 'proposal'
		const proposed = {
			grants: [{ surface: "bash", pattern: "git push origin feat/*", action: "allow" as const }],
			summary: "Allow pushing feature branches to origin",
		};
		const step3 = reducePrompt(config, step2.state, {
			type: "proposalReady",
			proposal: proposed,
		});
		expect(step3.kind).toBe("render");
		if (step3.kind !== "render") return;
		expect(step3.state.step).toBe("proposal");
		expect(step3.state.proposalChoice).toBe("saveGlobal");

		// Confirming default choice ('saveGlobal') commits decision with persistGlobal + customGrants
		const finalOutcome = reducePrompt(config, step3.state, { type: "confirm" });
		expect(finalOutcome).toEqual({
			kind: "decision",
			decision: {
				approved: true,
				state: "approved_for_session",
				persistGlobal: true,
				customGrants: proposed.grants,
			},
		});

		// Gate + SessionRules + mutateGlobalPermissionRule persist the proposed rule to config.json
		const gateRes = await applyPermissionGate({
			state: "ask",
			canGrantForSession: false,
			promptForApproval: async () => ({
				...finalOutcome.decision,
				decidedBy: { kind: "user", via: "dialog" },
			}),
			writeLog: () => {},
			logContext: {},
			decidedByRule: { kind: "rule", surface: "bash", pattern: "*", origin: "global" },
			messages: { denyReason: "denied", refusedReason: () => "refused" },
		});
		expect(gateRes.action).toBe("allow");
		if (gateRes.action !== "allow") return;
		expect(gateRes.sessionGrant).toEqual({
			width: "proven",
			persistGlobal: true,
			customGrants: proposed.grants,
		});

		const dir = mkdtempSync(join(tmpdir(), "perm-propose-"));
		const configPath = join(dir, "config.json");
		const sessionRules = new SessionRules();
		let persisted: Promise<{ ok: boolean; message: string }> | undefined;
		sessionRules.setGlobalPersister((grants) => {
			persisted = mutateGlobalPermissionRule(configPath, grants, "allow");
		});
		sessionRules.recordSessionApproval(
			SessionApproval.forGrants(gateRes.sessionGrant!.customGrants!),
			gateRes.sessionGrant!.persistGlobal,
		);
		await persisted;

		const written = JSON.parse(readFileSync(configPath, "utf8"));
		expect(written.permission).toEqual({
			bash: {
				"*": "ask",
				"git push origin feat/*": "allow",
			},
		});
	});
});

describe("LocalUserAuthorizer Herdr blocked status", () => {
	test("emits herdr:blocked while the permission dialog is open and clears it on settle", async () => {
		const emitted: Array<{ channel: string; data: unknown }> = [];
		let resolvePrompt: ((decision: unknown) => void) | undefined;

		const authorizer = new LocalUserAuthorizer({
			ui: {} as never,
			mode: "tui",
			events: {
				emit(channel: string, data: unknown) {
					emitted.push({ channel, data });
				},
				on: () => () => {},
			},
			dialogs: {
				run: <T>(task: () => Promise<T>) => task(),
			},
			getPromptPreferences: () => ({
				doublePressToConfirm: true,
				budget: { maxRows: 24, fieldMaxWidth: 400 },
				dialogKeys: DEFAULT_DIALOG_KEYS,
				promptNotifications: [],
			}),
			requestPermissionDecision: () =>
				new Promise((resolve) => {
					resolvePrompt = resolve as (decision: unknown) => void;
				}) as never,
			describeSession: () => ({ name: "test", cwd: "/Users/thalesmello/src" }),
		});

		const pending = authorizer.authorize(makeDetails());
		const blockedStart = emitted.filter((e) => e.channel === "herdr:blocked");
		expect(blockedStart).toEqual([
			{
				channel: "herdr:blocked",
				data: { active: true, label: "Permission Required: bash" },
			},
		]);

		resolvePrompt?.({
			approved: true,
			state: "approved",
			decidedBy: { kind: "user", via: "dialog" },
		});
		await pending;

		const blockedAll = emitted.filter((e) => e.channel === "herdr:blocked");
		expect(blockedAll).toEqual([
			{
				channel: "herdr:blocked",
				data: { active: true, label: "Permission Required: bash" },
			},
			{
				channel: "herdr:blocked",
				data: { active: false },
			},
		]);
	});
});

