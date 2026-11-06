/**
 * default-agents.ts — Embedded default agent configurations.
 *
 * Emptied so only user-defined agents in ~/.pi/agent/agents/*.md
 * (scout, planner, reviewer, worker) and project .pi/agents/*.md are registered.
 */

import type { AgentConfig } from "./types.js";

export const DEFAULT_AGENTS: Map<string, AgentConfig> = new Map();
