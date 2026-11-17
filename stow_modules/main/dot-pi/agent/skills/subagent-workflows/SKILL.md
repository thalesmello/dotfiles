---
name: subagent-workflows
description: Orchestrate multiple subagents with a deterministic SubagentWorkflow script — fan-out, pipelines, parallel verification, judge panels, migrations and audits at scale. Use ONLY when the user has explicitly asked to run a workflow, fan out agents, use multi-agent orchestration, or run a named/saved workflow; never infer opt-in from task size alone. Read this skill in full (including references/api.md, and references/patterns.md when designing a workflow) before writing or calling any workflow script.
---

# Subagent workflows

This skill is the authoritative reference for the `SubagentWorkflow` tool. The
tool's own description is intentionally a short stub: everything below — the
explicit opt-in gate, the script API, and the orchestration patterns — lives
here so it only enters context when a workflow is actually on the table.

**Before writing or calling a workflow script:**

1. Read this file in full.
2. Read `references/api.md` in full — it is the exact script API
   (`agent()`, `pipeline()`, `parallel()`, `phase()`, `log()`, `args`,
   `budget`, `workflow()`), including the pure-literal `meta` requirement,
   the concurrency/agent caps, and the resume semantics. Scripts written
   without it fail in avoidable ways.
3. Read `references/patterns.md` when designing anything beyond a trivial
   fan-out — pipeline-vs-barrier choice, adversarial verification,
   loop-until-dry, gate-and-retry, and the worked examples live there.
4. If you already read these files earlier in this session, you may skip
   re-reading them.

Execute a workflow script that orchestrates multiple subagents deterministically. Workflows run in the background — this tool returns immediately with a task ID, and you are notified when the workflow completes. Use /agents → Workflows to watch live progress.

A workflow structures work across many agents — to be comprehensive (decompose and cover in parallel), to be confident (independent perspectives and adversarial checks before committing), or to take on scale one context can't hold (migrations, audits, broad sweeps). The script is where you encode that structure: what fans out, what verifies, what synthesizes.

ONLY call this tool when the user has explicitly opted into multi-agent orchestration. Workflows can spawn dozens of agents and consume a large amount of tokens; the user must request that scale, not have it inferred. Explicit opt-in means one of:
- The user directly asked you to run a workflow or use multi-agent orchestration in their own words ("use a workflow", "run a workflow", "fan out agents", "orchestrate this with subagents"). The ask must be in the user's words — a task that would merely benefit from a workflow does not count.
- The user invoked a skill or slash command whose instructions tell you to call SubagentWorkflow.
- The user asked you to run a specific named or saved workflow.

For any other task — even one that would clearly benefit from parallelism — do NOT call this tool. Use the Agent tool for individual subagents, or briefly describe what a multi-agent workflow could do and how much it would roughly cost, and ask the user whether to run it. Mention they can ask for one with "use a workflow" in a future message to skip the ask.

When you do call it, the right move is often **hybrid**: scout inline first (list the files, find the channels, scope the diff) to discover the work-list, then call SubagentWorkflow to pipeline over it. You don't need to know the shape before the *task* — only before the *orchestration step*.

Common single-phase workflows you can chain across turns:
- **Understand** — parallel readers over relevant subsystems → structured map
- **Design** — judge panel of N independent approaches → scored synthesis
- **Review** — dimensions → find → adversarially verify (example below)
- **Research** — multi-modal sweep → deep-read → synthesize
- **Migrate** — discover sites → transform each (worktree isolation) → verify

For larger work, run several in sequence — read each result before deciding the next phase. You stay in the loop; each workflow is one well-scoped fan-out.

Pass the script inline via `script` — do not Write it to a file first. Every invocation automatically persists its script to a file under the session directory and returns the path in the tool result. To iterate on a workflow, edit that file with Write/Edit and re-invoke SubagentWorkflow with `{scriptPath: "<path>"}` instead of resending the full script. A script you will run more than once belongs in `.pi/workflows/<name>.js` (or `.agents/workflows/`, or `<agent dir>/workflows/` for one that follows the user everywhere); call it with `name: "<name>"` instead of re-sending the source.

Every script must begin with `export const meta = {...}`:
  export const meta = {
    name: 'find-flaky-tests',
    description: 'Find flaky tests and propose fixes',   // one-line, shown in permission dialog
    phases: [                                            // one entry per phase() call
      { title: 'Scan', detail: 'grep test logs for retries' },
      { title: 'Fix', detail: 'one agent per flaky test' },
    ],
  }
  // script body starts here — use agent()/parallel()/pipeline()/phase()/log()
  phase('Scan')
  const flaky = await agent('grep CI logs for retry markers', {schema: FLAKY_SCHEMA})
  ...

The `meta` object must be a PURE LITERAL — no variables, function calls, spreads, or template interpolation. Required fields: `name`, `description`. Optional: `whenToUse` (shown in the workflow list), `phases`. Use the SAME phase titles in meta.phases as in phase() calls — titles are matched exactly; a phase() call with no matching meta entry just gets its own progress group. Add `model` to a phase entry when that phase uses a specific model override.

## Reference files

- `references/api.md` — script body hooks and runtime rules (read before
  every new workflow).
- `references/patterns.md` — orchestration patterns and quality patterns
  (read when designing a workflow).
