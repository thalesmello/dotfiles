/**
 * tool-description.ts — the model-facing description of the `SubagentWorkflow` tool.
 *
 * Intentionally a short stub. The full guidance — the explicit opt-in gate,
 * the script API (`agent()`, `pipeline()`, `parallel()`, `phase()`, `log()`,
 * `args`, `budget`, `workflow()`), the pure-literal `meta` requirement, the
 * caps, resume semantics, and the orchestration/quality patterns — lives in
 * the `subagent-workflows` skill
 * (`skills/subagent-workflows/SKILL.md` + `references/api.md` +
 * `references/patterns.md`), which Pi advertises by name/description only and
 * the model reads in full before writing a workflow. Keeping ~19k characters
 * of workflow prose in this description charged every session that merely had
 * the tool available; the skill charges only sessions that actually use it.
 *
 * `tests/subagent-workflows.test.ts` pins this split: the stub stays short
 * and keeps pointing at the skill, and the skill files keep containing the
 * load-bearing API surface, so the two cannot silently drift apart.
 *
 * Keep the stub accurate to what the runtime implements — documenting a
 * global we do not ship is worse than documenting nothing, because the
 * script only fails once it is running.
 */
export const workflowToolDescription = `Execute a workflow script that orchestrates multiple subagents deterministically. Workflows run in the background — this tool returns immediately with a task ID, and you are notified when the workflow completes. Use /agents → Workflows to watch live progress.

ONLY call this tool when the user has explicitly opted into multi-agent orchestration. Workflows can spawn dozens of agents and consume a large amount of tokens; the user must request that scale, not have it inferred. Explicit opt-in means one of:
- The user directly asked you to run a workflow or use multi-agent orchestration in their own words ("use a workflow", "run a workflow", "fan out agents", "orchestrate this with subagents").
- The user invoked a skill or slash command whose instructions tell you to call SubagentWorkflow.
- The user asked you to run a specific named or saved workflow.

Before writing or calling any workflow script, load the \`subagent-workflows\` skill in full — its SKILL.md plus references/api.md, and references/patterns.md when designing the workflow — unless you already read them in this session. The skill is the authoritative API and pattern reference; scripts must follow it exactly (pure-literal \`meta\` block, plain JavaScript, pipeline-by-default). Pass the script inline via \`script\` — do not Write it to a file first — or reuse a saved workflow via \`scriptPath\` or \`name\`. A workflow runs in the background and notifies you when it finishes — do not poll or sleep waiting for it.`;
