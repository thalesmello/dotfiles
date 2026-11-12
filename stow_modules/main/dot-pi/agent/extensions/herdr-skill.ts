/**
 * herdr-skill.ts -- point the agent at `herdr --skill` inside a Herdr pane.
 *
 * Place this file beside herdr-agent-state.ts. Do not edit that file:
 * Herdr owns it and overwrites it on reinstall or update.
 *
 * Rule:
 *   - Outside Herdr (`HERDR_ENV` is not `1`), this extension does nothing.
 *   - Inside Herdr, this extension adds one short `herdr` section to the
 *     system prompt on every `before_agent_start`. The section does NOT
 *     contain the skill. It tells the agent where the skill lives and when
 *     to load it: before it reads a pane, creates a pane, or interacts
 *     with another agent on this machine.
 *
 * Why a pointer and not the full skill text:
 * Most turns never touch another pane or agent. The full skill costs
 * context on every turn. A pointer costs a few lines, and the agent loads
 * the real skill only for a turn that needs it.
 *
 * Why `systemPromptOptions.sections` and not a returned `systemPrompt`:
 * Pi diffs section changes and patches only the changed section. A returned
 * `systemPrompt` replaces the whole prompt for the run.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface HerdrSkillOptions {
	env?: NodeJS.ProcessEnv;
}

function isHcSession(env: NodeJS.ProcessEnv): boolean {
	if (!env.HC_TERMINAL_ID) return false;
	if (env.HERDR_ENV !== "1") return true;
	return env.TERM_PROGRAM === "ghostty";
}

function isHerdrSession(env: NodeJS.ProcessEnv): boolean {
	return env.HERDR_ENV === "1" && !isHcSession(env);
}

function callerContext(env: NodeJS.ProcessEnv): string {
	const parts = [
		["HERDR_WORKSPACE_ID", env.HERDR_WORKSPACE_ID],
		["HERDR_TAB_ID", env.HERDR_TAB_ID],
		["HERDR_PANE_ID", env.HERDR_PANE_ID],
	]
		.filter((entry): entry is [string, string] => Boolean(entry[1]))
		.map(([key, value]) => `${key}=${value}`);
	return parts.length > 0 ? ` Caller context: ${parts.join(", ")}.` : "";
}

function hcCallerContext(env: NodeJS.ProcessEnv): string {
	const parts = [
		["HC_TERMINAL_ID", env.HC_TERMINAL_ID],
		["HC_SESSION", env.HC_SESSION],
	]
		.filter((entry): entry is [string, string] => Boolean(entry[1]))
		.map(([key, value]) => `${key}=${value}`);
	return parts.join(", ");
}

/** The short instruction that goes into context. Exported for tests. */
export function herdrPointer(env: NodeJS.ProcessEnv): string {
	if (isHcSession(env)) {
		return [
			`This session runs inside a Herdr terminal (${hcCallerContext(env)}).`,
			"`hc` (herdr-core) runs persistent terminals and coding agents on this machine; `herdr-app` controls the window (spaces, tabs, and panes).",
			"Load the relevant skill only when a task needs you to interact with that surface:",
			"- Run `hc --skill`, read the full output, and follow it when you need to read, inspect, or wait on output from another pane/terminal, run a command in another terminal, or start, prompt, wait on, read, or send keys to another coding agent on this machine.",
			"- Run `herdr-app --skill`, read the full output, and follow it when you need to create, split, move, focus, or close a pane, tab, or space in the window, or customize layouts, keys, or mods.",
			"Do not guess `hc` or `herdr-app` commands, flags, or IDs. Load the skill first, then discover live state with the commands it names.",
			"Do not load either skill for work that stays in this terminal and needs no other pane or agent.",
		].join("\n");
	}

	return [
		`This session runs inside a Herdr pane (HERDR_ENV=1).${callerContext(env)}`,
		"Herdr controls the panes, tabs, and workspaces on this machine and tracks the coding agents inside them.",
		"Load the Herdr skill before you interact with that surface. Run `herdr --skill`, read the full output, and follow it. Load it when a task needs you to:",
		"- read, inspect, or wait on output from another pane;",
		"- create, split, move, focus, run a command in, or close a pane, tab, or workspace;",
		"- start, prompt, wait on, read, or send keys to another coding agent on this machine, or check the state of one.",
		"Do not guess Herdr commands, flags, or IDs. Load the skill first, then discover live state with the commands it names.",
		"Do not load the skill for work that stays in this pane and needs no other pane or agent.",
	].join("\n");
}

export default function herdrSkill(pi: ExtensionAPI, options: HerdrSkillOptions = {}) {
	const env = options.env ?? process.env;
	if (!isHerdrSession(env) && !isHcSession(env)) {
		return;
	}

	pi.on("before_agent_start", async (event) => {
		event.systemPromptOptions.sections.herdr = herdrPointer(env);
	});
}
