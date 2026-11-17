import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const agentDir = path.resolve(import.meta.dir, "..");
const { workflowToolDescription } = await import(
	"../extensions/subagent/workflow/tool-description.ts"
);

const skillDir = path.join(agentDir, "skills", "subagent-workflows");
const skillMd = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8");
const apiMd = fs.readFileSync(path.join(skillDir, "references", "api.md"), "utf-8");
const patternsMd = fs.readFileSync(
	path.join(skillDir, "references", "patterns.md"),
	"utf-8",
);

describe("SubagentWorkflow description is a stub pointing at the skill", () => {
	test("stub stays short and keeps the opt-in gate + skill pointer", () => {
		// The pre-skill description was ~19.4k characters charged to every
		// session that had the tool available. Keep the stub an order of
		// magnitude smaller.
		expect(workflowToolDescription.length).toBeLessThan(2500);
		expect(workflowToolDescription).toContain("explicitly opted into multi-agent orchestration");
		expect(workflowToolDescription).toContain("`subagent-workflows` skill");
		expect(workflowToolDescription).toContain("references/api.md");
		expect(workflowToolDescription).not.toContain("{{typeList}}");
	});

	test("index.ts registers the workflow tool with the stub", () => {
		const indexTs = fs.readFileSync(
			path.join(agentDir, "extensions", "subagent", "index.ts"),
			"utf-8",
		);
		expect(indexTs).toContain("workflowToolDescription");
		expect(indexTs).not.toContain("fullWorkflowToolDescription");
	});
});

describe("subagent-workflows skill carries the full guidance", () => {
	test("frontmatter routes on explicit opt-in only", () => {
		expect(skillMd.startsWith("---\nname: subagent-workflows\n")).toBe(true);
		const description = skillMd.match(/^description: (.+)$/m)?.[1] ?? "";
		expect(description.length).toBeGreaterThan(0);
		expect(description.length).toBeLessThanOrEqual(1024);
		expect(description).toContain("explicitly asked");
		expect(skillMd).toContain("references/api.md");
		expect(skillMd).toContain("references/patterns.md");
	});

	test("api reference keeps the load-bearing script surface", () => {
		for (const needle of [
			"agent(prompt: string",
			"pipeline(items",
			"parallel(thunks",
			"phase(title: string)",
			"log(message: string)",
			"args: any",
			"budget:",
			"workflow(nameOrRef",
			"Date.now()",
			"opts.gate",
			"opts.resume",
			"isolation: 'worktree'",
		]) {
			expect(apiMd).toContain(needle);
		}
		expect(apiMd).not.toContain("{{typeList}}");
	});

	test("skill core keeps the meta/script rules", () => {
		expect(skillMd).toContain("PURE LITERAL");
		expect(skillMd).toContain("export const meta");
		expect(skillMd).toContain("explicitly opted into");
	});

	test("patterns reference keeps the orchestration guidance", () => {
		for (const needle of [
			"DEFAULT TO pipeline()",
			"4096 items",
			"capped at 1000",
			"resumeFromRunId",
			"Adversarial verify",
			"Loop-until-dry",
			"Gate-and-retry",
			"Judge panel",
			"No silent caps",
		]) {
			expect(patternsMd).toContain(needle);
		}
	});

	test("guidance was moved, not deleted", () => {
		// Core + API + patterns together should retain roughly the size of
		// the original tool description (~19.4k chars).
		const total = skillMd.length + apiMd.length + patternsMd.length;
		expect(total).toBeGreaterThan(15_000);
	});
});
