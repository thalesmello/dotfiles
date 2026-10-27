import { describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

mock.module("@earendil-works/pi-coding-agent", () => ({
	CONFIG_DIR_NAME: ".pi",
	formatReadLineRange: () => "",
	getAgentDir: () => path.resolve(import.meta.dir, ".."),
	getMarkdownTheme: () => ({}),
	parseFrontmatter: (content: string) => {
		const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
		if (!match) return { frontmatter: {}, body: content };
		const frontmatter: Record<string, string> = {};
		for (const line of match[1].split(/\r?\n/)) {
			const idx = line.indexOf(":");
			if (idx > 0) {
				frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
			}
		}
		return { frontmatter, body: match[2] };
	},
	withFileMutationQueue: async (_file: string, fn: () => Promise<void>) => fn(),
}));

const {
	discoverAgents,
	findAgent,
	findSessionFile,
	resolveResumeTarget,
	writeSessionMeta,
} = await import("../extensions/subagent/agents.ts");
const {
	buildSubagentSystemPromptSection,
	parseTierSelector,
	resolveSubagentModel,
	splitModelAndThinking,
} = await import("../extensions/subagent/models.ts");

function createMockRegistry(availableModels: string[], authedModels?: Set<string>) {
	const set = new Set(availableModels);
	return {
		find(provider: string, modelId: string) {
			const key = `${provider}/${modelId}`;
			return set.has(key) ? { provider, id: modelId, key } : undefined;
		},
		hasConfiguredAuth(model: { key: string }) {
			return authedModels ? authedModels.has(model.key) : true;
		},
	};
}

describe("subagent agent discovery and aliases", () => {
	test("discovers configured user agents and resolves Claude-style aliases", () => {
		const { agents } = discoverAgents(process.cwd(), "user");
		expect(agents.map((a) => a.name)).toEqual(["planner", "reviewer", "scout", "worker"]);

		expect(findAgent(agents, "scout")?.name).toBe("scout");
		expect(findAgent(agents, "explore")?.name).toBe("scout");
		expect(findAgent(agents, "planner")?.name).toBe("planner");
		expect(findAgent(agents, "plan")?.name).toBe("planner");
		expect(findAgent(agents, "reviewer")?.name).toBe("reviewer");
		expect(findAgent(agents, "review")?.name).toBe("reviewer");
		expect(findAgent(agents, "worker")?.name).toBe("worker");
		expect(findAgent(agents, "general-purpose")?.name).toBe("worker");
	});
});

describe("subagent model selection", () => {
	const googleDefaults = {
		provider: "google",
		model: "google/gemini-4-argon",
		thinkingLevel: "high" as const,
	};

	const mockRegistry = createMockRegistry([
		"google/gemini-3.8-flash",
		"google/gemini-4-argon",
		"anthropic/claude-haiku-5-5",
		"anthropic/claude-sonnet-5-5",
		"anthropic/claude-opus-5-5",
		"openai/gpt-6-luna",
		"openai/gpt-5.6-terra",
		"openai/gpt-6.1-sol",
	]);

	test("splits optional thinking suffix only when valid", () => {
		expect(splitModelAndThinking("opus:xhigh")).toEqual({
			modelSpec: "opus",
			thinkingLevel: "xhigh",
		});
		expect(splitModelAndThinking("anthropic/claude-opus-5-5:max")).toEqual({
			modelSpec: "anthropic/claude-opus-5-5",
			thinkingLevel: "max",
		});
		expect(splitModelAndThinking("ollama/qwen2.5-coder:7b")).toEqual({
			modelSpec: "ollama/qwen2.5-coder:7b",
		});
	});

	test("parses only canonical tier selectors and rejects colliding synonyms", () => {
		expect(parseTierSelector("haiku")).toEqual({ tier: "fast", preferAnthropic: true });
		expect(parseTierSelector("sonnet")).toEqual({ tier: "balanced", preferAnthropic: true });
		expect(parseTierSelector("opus")).toEqual({ tier: "deep", preferAnthropic: true });
		expect(parseTierSelector("fast")).toEqual({ tier: "fast", preferAnthropic: false });
		expect(parseTierSelector("balanced")).toEqual({ tier: "balanced", preferAnthropic: false });
		expect(parseTierSelector("deep")).toEqual({ tier: "deep", preferAnthropic: false });

		for (const dropped of ["light", "cheap", "standard", "medium", "smart", "frontier", "max", "auto"]) {
			expect(parseTierSelector(dropped)).toBeNull();
		}
	});

	test("omitted model resolves to inherit and preserves parent thinking level", () => {
		const resolved = resolveSubagentModel({
			agent: { name: "worker" },
			dispatchDefaults: googleDefaults,
			registry: mockRegistry,
		});
		expect(resolved).toEqual({
			model: "google/gemini-4-argon",
			thinkingLevel: "high",
			tier: "inherit",
			source: "inherit",
		});
	});

	test("frontmatter model: fast on a non-scout agent stays fast and inherits parent thinking level", () => {
		const resolved = resolveSubagentModel({
			agent: { name: "custom-helper", model: "fast" },
			dispatchDefaults: googleDefaults,
			registry: mockRegistry,
		});
		expect(resolved).toEqual({
			model: "google/gemini-3.8-flash",
			thinkingLevel: "high",
			tier: "fast",
			source: "agent",
		});

		const haikuFrontmatter = resolveSubagentModel({
			agent: { name: "custom-helper", model: "haiku" },
			dispatchDefaults: googleDefaults,
			registry: mockRegistry,
		});
		expect(haikuFrontmatter).toEqual({
			model: "anthropic/claude-haiku-5-5",
			thinkingLevel: "high",
			tier: "fast",
			source: "agent",
		});
	});

	test("unavailable tier falls back to the parent model", () => {
		// When registry is undefined
		const noRegistry = resolveSubagentModel({
			agent: { name: "scout", model: "fast" },
			dispatchDefaults: googleDefaults,
			registry: undefined,
		});
		expect(noRegistry.model).toBe("google/gemini-4-argon");
		expect(noRegistry.thinkingLevel).toBe("high");

		// When no candidate in registry is available/authed
		const unauthedRegistry = createMockRegistry(["anthropic/claude-haiku-5-5"], new Set());
		const unauthed = resolveSubagentModel({
			agent: { name: "worker" },
			taskModel: "haiku",
			dispatchDefaults: googleDefaults,
			registry: unauthedRegistry,
		});
		expect(unauthed.model).toBe("google/gemini-4-argon");
		expect(unauthed.thinkingLevel).toBe("high");
	});

	test("resolves explicit Claude aliases and thinking overrides", () => {
		const haikuResolved = resolveSubagentModel({
			agent: { name: "worker" },
			taskModel: "haiku",
			dispatchDefaults: googleDefaults,
			registry: mockRegistry,
		});
		expect(haikuResolved.model).toBe("anthropic/claude-haiku-5-5");
		expect(haikuResolved.thinkingLevel).toBe("high");
		expect(haikuResolved.source).toBe("param");

		const sonnetResolved = resolveSubagentModel({
			agent: { name: "worker" },
			taskModel: "sonnet",
			taskThinking: "medium",
			dispatchDefaults: googleDefaults,
			registry: mockRegistry,
		});
		expect(sonnetResolved.model).toBe("anthropic/claude-sonnet-5-5");
		expect(sonnetResolved.thinkingLevel).toBe("medium");

		const opusResolved = resolveSubagentModel({
			agent: { name: "reviewer" },
			taskModel: "opus:xhigh",
			dispatchDefaults: googleDefaults,
			registry: mockRegistry,
		});
		expect(opusResolved.model).toBe("anthropic/claude-opus-5-5");
		expect(opusResolved.thinkingLevel).toBe("xhigh");
	});

	test("builds system prompt section without duplicating into AGENTS.md", () => {
		const { agents } = discoverAgents(process.cwd(), "user");
		const prompt = buildSubagentSystemPromptSection(agents, googleDefaults, mockRegistry);

		expect(prompt).toContain("## Available Subagents");
		expect(prompt).toContain("`scout`");
		expect(prompt).toContain("`planner`");
		expect(prompt).toContain("`reviewer`");
		expect(prompt).toContain("`worker`");
		expect(prompt).toContain("When in Doubt, Don't");
		expect(prompt).toContain("resume: \"<sessionId>\"");
		expect(prompt).toContain("google/gemini-3.8-flash");

		const agentsMd = fs.readFileSync(path.resolve(import.meta.dir, "../AGENTS.md"), "utf-8");
		expect(agentsMd).not.toContain("Subagent delegation");
	});

	test("persists and resolves subagent session metadata for resume", async () => {
		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-test-"));
		try {
			const sessionId = "subagent_abc123def456";
			const sessionFile = path.join(tmpDir, `2026-10-27T06-00-00-000Z_${sessionId}.jsonl`);
			await fs.promises.writeFile(sessionFile, '{"type":"session"}\n', "utf-8");

			await writeSessionMeta(tmpDir, {
				sessionId,
				sessionFile,
				agent: "scout",
				agentSource: "user",
				cwd: "/tmp",
				model: "google/gemini-3.8-flash",
				thinkingLevel: "high",
				updatedAt: new Date().toISOString(),
			});

			expect(findSessionFile(tmpDir, sessionId)).toBe(sessionFile);

			const byId = resolveResumeTarget(tmpDir, sessionId);
			expect(byId?.sessionId).toBe(sessionId);
			expect(byId?.sessionFile).toBe(sessionFile);
			expect(byId?.meta?.agent).toBe("scout");
			expect(byId?.meta?.model).toBe("google/gemini-3.8-flash");

			const byPath = resolveResumeTarget(tmpDir, sessionFile);
			expect(byPath?.sessionId).toBe(sessionId);
			expect(byPath?.sessionFile).toBe(sessionFile);
			expect(byPath?.meta?.agent).toBe("scout");

			expect(resolveResumeTarget(tmpDir, "nonexistent_session")).toBeNull();
		} finally {
			await fs.promises.rm(tmpDir, { recursive: true, force: true });
		}
	});
});
