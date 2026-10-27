/**
 * Subagent model selection and system-prompt guidance.
 *
 * Precedence matches Claude Code's Agent tool:
 *   1. `model` parameter passed by the parent LLM on the tool call
 *   2. `model:` frontmatter in the agent markdown definition
 *   3. Default: "inherit" (the parent session's active model)
 *
 * Thinking level always inherits the parent session's thinking level unless
 * explicitly overridden via `thinking`, a `:<thinking>` suffix, or `thinking:`
 * in the agent frontmatter.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AgentConfig } from "./agents.ts";
import { parseThinkingLevel } from "./agents.ts";

export type ModelTier = "fast" | "balanced" | "deep";
export type ClaudeTierAlias = "haiku" | "sonnet" | "opus";

export interface DispatchDefaults {
	provider?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
}

export interface ModelLookupRegistry {
	find(provider: string, modelId: string): unknown;
	hasConfiguredAuth?(model: any): boolean;
}

export interface ResolvedModelConfig {
	/** Model passed to `--model` (e.g. "anthropic/claude-haiku-5-5") */
	model?: string;
	/** Thinking level passed to `--thinking` */
	thinkingLevel?: ThinkingLevel;
	/** Resolved tier or mode */
	tier: ModelTier | "inherit" | "explicit";
	/** Where the selection came from */
	source: "param" | "agent" | "inherit";
}

interface ModelCandidate {
	provider: string;
	id: string;
}

const PROVIDER_TIER_CANDIDATES: Record<string, Record<ModelTier, string[]>> = {
	anthropic: {
		fast: ["claude-haiku-5-5", "claude-haiku-4-5"],
		balanced: ["claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-sonnet-4-5"],
		deep: [
			"claude-opus-5-5",
			"claude-opus-5",
			"claude-opus-4-8",
			"claude-opus-4-7",
			"claude-opus-4-6",
			"claude-opus-4-5",
		],
	},
	google: {
		fast: [
			"gemini-3.8-flash",
			"gemini-3.6-flash",
			"gemini-3.5-flash",
			"gemini-3-flash-preview",
			"gemini-2.5-flash",
		],
		balanced: ["gemini-4-argon", "gemini-3.1-pro-preview", "gemini-2.5-pro"],
		deep: ["gemini-4-argon", "gemini-3.1-pro-preview", "gemini-2.5-pro"],
	},
	openai: {
		fast: ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-mini"],
		balanced: ["gpt-5.6-terra", "gpt-6.1-sol", "gpt-5.5"],
		deep: ["gpt-6.1-sol", "gpt-6-sol", "gpt-5.6-sol"],
	},
	meta: {
		fast: ["muse-spark-1.3-internal", "muse-latest"],
		balanced: ["muse-latest", "muse-spark-1.3-internal"],
		deep: ["muse-wonder-1.0-internal", "muse-latest"],
	},
};

const FALLBACK_PROVIDER_ORDER = ["anthropic", "google", "openai", "meta"] as const;

const CLAUDE_ALIAS_TO_TIER: Record<ClaudeTierAlias, ModelTier> = {
	haiku: "fast",
	sonnet: "balanced",
	opus: "deep",
};

/**
 * Split an optional `:<thinking>` suffix from a model spec if the suffix is a
 * valid Pi thinking level (e.g. "opus:xhigh" or "anthropic/claude-opus-5-5:max").
 */
export function splitModelAndThinking(rawSpec: string): {
	modelSpec: string;
	thinkingLevel?: ThinkingLevel;
} {
	const trimmed = rawSpec.trim();
	const lastColon = trimmed.lastIndexOf(":");
	if (lastColon <= 0) {
		return { modelSpec: trimmed };
	}
	const maybeThinking = parseThinkingLevel(trimmed.slice(lastColon + 1));
	if (!maybeThinking) {
		return { modelSpec: trimmed };
	}
	return {
		modelSpec: trimmed.slice(0, lastColon).trim(),
		thinkingLevel: maybeThinking,
	};
}

/**
 * Normalize a tier alias ("haiku", "sonnet", "opus", "fast", "balanced", "deep")
 * into its canonical tier and whether it explicitly requested Anthropic's Claude family.
 */
export function parseTierSelector(spec: string): {
	tier: ModelTier;
	preferAnthropic: boolean;
} | null {
	const normalized = spec.trim().toLowerCase();
	if (normalized in CLAUDE_ALIAS_TO_TIER) {
		return {
			tier: CLAUDE_ALIAS_TO_TIER[normalized as ClaudeTierAlias],
			preferAnthropic: true,
		};
	}
	if (normalized === "fast" || normalized === "balanced" || normalized === "deep") {
		return { tier: normalized, preferAnthropic: false };
	}
	return null;
}

function buildProviderOrder(preferredProvider?: string): string[] {
	const order: string[] = [];
	if (preferredProvider && preferredProvider in PROVIDER_TIER_CANDIDATES) {
		order.push(preferredProvider);
	}
	for (const provider of FALLBACK_PROVIDER_ORDER) {
		if (!order.includes(provider)) {
			order.push(provider);
		}
	}
	return order;
}

function isModelAvailable(registry: ModelLookupRegistry | undefined, provider: string, id: string): boolean {
	if (!registry) return false;
	const found = registry.find(provider, id);
	if (!found) return false;
	if (typeof registry.hasConfiguredAuth === "function") {
		return registry.hasConfiguredAuth(found);
	}
	return true;
}

/**
 * Pick the first available `<provider>/<model>` for a given tier, or fall back
 * to `dispatchDefaults.model` (inherit) when no candidate is available.
 */
export function resolveTierModel(
	tier: ModelTier,
	dispatchDefaults: DispatchDefaults,
	registry?: ModelLookupRegistry,
	preferAnthropic = false,
): string | undefined {
	if (!registry) {
		return dispatchDefaults.model;
	}

	const preferredProvider = preferAnthropic ? "anthropic" : dispatchDefaults.provider;
	const providerOrder = buildProviderOrder(preferredProvider);

	const candidates: ModelCandidate[] = [];
	for (const provider of providerOrder) {
		const ids = PROVIDER_TIER_CANDIDATES[provider]?.[tier] ?? [];
		for (const id of ids) {
			candidates.push({ provider, id });
		}
	}

	for (const candidate of candidates) {
		if (isModelAvailable(registry, candidate.provider, candidate.id)) {
			return `${candidate.provider}/${candidate.id}`;
		}
	}

	return dispatchDefaults.model;
}

/**
 * Resolve the model and thinking level for a single subagent execution.
 *
 * Precedence:
 *   1. `taskModel` / `taskThinking` passed in the tool call
 *   2. `agent.model` / `agent.thinking` from the agent markdown frontmatter
 *   3. Default: "inherit" (`dispatchDefaults.model` and `dispatchDefaults.thinkingLevel`)
 */
export function resolveSubagentModel(options: {
	agent: Pick<AgentConfig, "name" | "model" | "thinking">;
	taskModel?: string;
	taskThinking?: ThinkingLevel;
	dispatchDefaults: DispatchDefaults;
	registry?: ModelLookupRegistry;
}): ResolvedModelConfig {
	const { agent, taskModel, taskThinking, dispatchDefaults, registry } = options;

	const rawParam = taskModel?.trim();
	const rawAgent = agent.model?.trim();

	const hasExplicitParam = Boolean(rawParam);
	const rawSelector = hasExplicitParam ? rawParam! : rawAgent || "inherit";
	const source: ResolvedModelConfig["source"] = hasExplicitParam ? "param" : rawAgent ? "agent" : "inherit";

	const { modelSpec, thinkingLevel: suffixThinking } = splitModelAndThinking(rawSelector);
	const thinkingLevel = taskThinking ?? suffixThinking ?? agent.thinking ?? dispatchDefaults.thinkingLevel;
	const normalizedSpec = modelSpec.toLowerCase();

	if (!normalizedSpec || normalizedSpec === "inherit") {
		return {
			model: dispatchDefaults.model,
			thinkingLevel,
			tier: "inherit",
			source: hasExplicitParam ? "param" : "inherit",
		};
	}

	const tierMatch = parseTierSelector(modelSpec);
	if (tierMatch) {
		const model = resolveTierModel(tierMatch.tier, dispatchDefaults, registry, tierMatch.preferAnthropic);
		return {
			model,
			thinkingLevel,
			tier: tierMatch.tier,
			source,
		};
	}

	return {
		model: modelSpec,
		thinkingLevel,
		tier: "explicit",
		source,
	};
}

/**
 * Summarize the currently resolved tier models for system-prompt instructions.
 */
export function describeTierModels(
	dispatchDefaults: DispatchDefaults,
	registry?: ModelLookupRegistry,
): Record<ModelTier, string> {
	const fallback = dispatchDefaults.model ?? "inherit";
	return {
		fast: resolveTierModel("fast", dispatchDefaults, registry, false) ?? fallback,
		balanced: resolveTierModel("balanced", dispatchDefaults, registry, false) ?? fallback,
		deep: resolveTierModel("deep", dispatchDefaults, registry, false) ?? fallback,
	};
}

export function buildSubagentSystemPromptSection(
	agents: AgentConfig[],
	dispatchDefaults: DispatchDefaults,
	registry?: ModelLookupRegistry,
): string {
	const tiers = describeTierModels(dispatchDefaults, registry);
	const parentModel = dispatchDefaults.model ?? "current session model";
	const agentLines =
		agents.length > 0
			? agents.map((a) => {
					const aliases = a.aliases && a.aliases.length > 0 ? ` (aliases: ${a.aliases.join(", ")})` : "";
					const tools = a.tools && a.tools.length > 0 ? ` [tools: ${a.tools.join(", ")}]` : " [tools: all default]";
					const modelDefault = a.model ?? "inherit";
					return `- \`${a.name}\`${aliases} (default model: \`${modelDefault}\`)${tools}: ${a.description}`;
				})
			: ["- (No user agents discovered in ~/.pi/agent/agents)"];

	return [
		"You can delegate work to specialized subagents with isolated context windows using the `subagent` tool. In single mode, `agent` defaults to `worker` when omitted.",
		"",
		"## Available Subagents",
		...agentLines,
		"",
		"## When to Spawn a Subagent (When in Doubt, Don't)",
		"A subagent has startup overhead and both handoffs (your brief and its final report) lose detail.",
		"- **Do the work yourself** when it takes a handful of tool calls or when you already know the target file or symbol (`read`, `grep`, `find`, `edit`).",
		"- **Delegate** for independent work that can run in parallel, broad searches across many unfamiliar files where you need only the conclusion (`scout`), or self-contained side quests that should not bloat the main conversation.",
		"- **Do not delegate test runs or builds by default.** You usually need the exact failure output. Delegate them only when raw output is huge and only a summary matters.",
		"- **Parallel work**: Run subagents in parallel either by emitting multiple `subagent` tool calls in one assistant message or by passing `tasks: [...]` in a single call. Use `chain: [...]` with `{previous}` only when sequential steps must pass output directly from one step to the next.",
		"",
		"## How to Brief and Handle Subagents",
		"- Pass a short 3-5 word `description` for the UI label alongside the full `task` prompt.",
		"- Brief the subagent like a peer who has not seen this conversation: state the goal, what is already ruled out, which files or directories to read, and an explicit, narrow scope. If you cannot write a clear brief, gather the needed context yourself first.",
		"- After you delegate something, wait for the result. Do not perform the same search or edits yourself in parallel.",
		"- The user does not see the subagent's full transcript by default. Relay the findings or changes that matter.",
		"- Subagent mistakes come back in the same confident tone as real findings. Verify claims that matter before acting on them.",
		"- For an independent review (`reviewer`), give the reviewer the code or diff, not your conclusion or hypothesis. An agent given your hypothesis tends to confirm it.",
		"- Every subagent result returns a `sessionId`. Pass `resume: \"<sessionId>\"` with a follow-up `task` to continue that subagent with its full prior context intact.",
		"",
		"## Model Selection (`model` parameter)",
		"Precedence: (1) `model` passed on the `subagent` call, (2) `model:` in the agent definition, (3) default `\"inherit\"`. Thinking level inherits the parent session's thinking level unless explicitly overridden with `thinking` or a `:<thinking>` suffix.",
		`- \`"inherit"\` (default, \`${parentModel}\`): Inherits the parent session's active model and thinking level.`,
		`- \`"fast"\` or \`"haiku"\` (\`${tiers.fast}\`): Fast, low-cost model for broad file/symbol search (\`scout\`) or simple mechanical tasks.`,
		`- \`"balanced"\` or \`"sonnet"\` (\`${tiers.balanced}\`): Balanced coding model for standard implementation, planning, and code review.`,
		`- \`"deep"\` or \`"opus"\` (\`${tiers.deep}\`): Frontier reasoning model for complex architecture, subtle concurrency/state bugs, or security-critical review.`,
		"- `<provider>/<model>[:<thinking>]`: Explicit model ID.",
	].join("\n");
}
