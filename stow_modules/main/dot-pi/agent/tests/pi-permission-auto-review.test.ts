import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import permissionAutoReview from "../extensions/pi-permission-system/auto-review/index.js";
import { composeAuthorizerChain } from "../extensions/pi-permission-system/src/authority/authorizer-chain.ts";
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
