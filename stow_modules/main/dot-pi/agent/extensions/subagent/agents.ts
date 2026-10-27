/**
 * Agent discovery and configuration
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter, withFileMutationQueue } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";
export const SUBAGENT_SESSION_DIR_ENV = "PI_SUBAGENT_SESSION_DIR";

export interface SubagentSessionMeta {
	sessionId: string;
	sessionFile?: string;
	agent: string;
	agentSource: "user" | "project";
	cwd: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	updatedAt: string;
}

const VALID_THINKING_LEVELS = new Set<ThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

export interface AgentConfig {
	name: string;
	aliases?: string[];
	description: string;
	tools?: string[];
	model?: string;
	thinking?: ThinkingLevel;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

type AgentFrontmatter = {
	name?: unknown;
	aliases?: unknown;
	description?: unknown;
	tools?: unknown;
	model?: unknown;
	thinking?: unknown;
};

export function parseStringList(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const items = raw
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
	return items.length > 0 ? items : undefined;
}

export function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase() as ThinkingLevel;
	return VALID_THINKING_LEVELS.has(normalized) ? normalized : undefined;
}

export function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	entries.sort((a, b) => a.name.localeCompare(b.name));

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);

		if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") {
			continue;
		}

		agents.push({
			name: frontmatter.name.trim(),
			aliases: parseStringList(frontmatter.aliases),
			description: frontmatter.description.trim(),
			tools: parseStringList(frontmatter.tools),
			model: typeof frontmatter.model === "string" && frontmatter.model.trim() ? frontmatter.model.trim() : undefined,
			thinking: parseThinkingLevel(frontmatter.thinking),
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function findAgent(agents: AgentConfig[], nameOrAlias: string): AgentConfig | undefined {
	const needle = nameOrAlias.trim().toLowerCase();
	if (!needle) return undefined;
	return (
		agents.find((a) => a.name.toLowerCase() === needle) ??
		agents.find((a) => a.aliases?.some((alias) => alias.toLowerCase() === needle))
	);
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}

export function getSubagentSessionsDir(): string {
	const override = process.env[SUBAGENT_SESSION_DIR_ENV]?.trim();
	if (override) return path.resolve(override);
	return path.join(getAgentDir(), "subagent-sessions");
}

export function generateSubagentSessionId(): string {
	return `subagent_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function findSessionFile(sessionsDir: string, sessionId: string): string | undefined {
	if (!fs.existsSync(sessionsDir)) return undefined;
	const suffix = `_${sessionId}.jsonl`;
	const exact = `${sessionId}.jsonl`;

	const searchDir = (dir: string, depth: number): string | undefined => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return undefined;
		}
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isFile() && (entry.name === exact || entry.name.endsWith(suffix))) {
				return fullPath;
			}
			if (depth > 0 && entry.isDirectory()) {
				const nested = searchDir(fullPath, depth - 1);
				if (nested) return nested;
			}
		}
		return undefined;
	};

	return searchDir(sessionsDir, 1);
}

function metaFilePath(sessionsDir: string, sessionId: string): string {
	const safeId = sessionId.replace(/[^\w.-]+/g, "_");
	return path.join(sessionsDir, `${safeId}.meta.json`);
}

export function readSessionMeta(sessionsDir: string, sessionId: string): SubagentSessionMeta | undefined {
	const file = metaFilePath(sessionsDir, sessionId);
	if (!fs.existsSync(file)) return undefined;
	try {
		return JSON.parse(fs.readFileSync(file, "utf-8")) as SubagentSessionMeta;
	} catch {
		return undefined;
	}
}

export async function writeSessionMeta(sessionsDir: string, meta: SubagentSessionMeta): Promise<void> {
	await fs.promises.mkdir(sessionsDir, { recursive: true });
	const file = metaFilePath(sessionsDir, meta.sessionId);
	await withFileMutationQueue(file, async () => {
		await fs.promises.writeFile(file, JSON.stringify(meta, null, 2), { encoding: "utf-8", mode: 0o600 });
	});
}

export function resolveResumeTarget(
	sessionsDir: string,
	resume: string,
): { sessionId: string; sessionFile: string; meta?: SubagentSessionMeta } | null {
	const trimmed = resume.trim();
	if (!trimmed) return null;

	if (trimmed.endsWith(".jsonl") && fs.existsSync(trimmed)) {
		const resolvedFile = path.resolve(trimmed);
		const base = path.basename(resolvedFile, ".jsonl");
		const underscoreIdx = base.indexOf("_");
		const sessionId = underscoreIdx >= 0 ? base.slice(underscoreIdx + 1) : base;
		const meta = readSessionMeta(sessionsDir, sessionId);
		return { sessionId, sessionFile: resolvedFile, meta };
	}

	const meta = readSessionMeta(sessionsDir, trimmed);
	const sessionFile =
		(meta?.sessionFile && fs.existsSync(meta.sessionFile) ? meta.sessionFile : undefined) ??
		findSessionFile(sessionsDir, trimmed);
	if (!sessionFile) return null;

	return { sessionId: trimmed, sessionFile, meta };
}
