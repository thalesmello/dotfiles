import { describe, expect, test } from "bun:test";
import herdrSkill, { herdrPointer } from "../extensions/herdr-skill.ts";

type Handler = (event: any, ctx: any) => Promise<void> | void;

function createHarness(options: Parameters<typeof herdrSkill>[1]) {
	const handlers = new Map<string, Handler[]>();
	const pi: any = {
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
	};
	herdrSkill(pi, options);
	return {
		handlerCount: (event: string) => handlers.get(event)?.length ?? 0,
		async emitBeforeAgentStart() {
			const event: any = { systemPromptOptions: { sections: {} } };
			for (const handler of handlers.get("before_agent_start") ?? []) {
				await handler(event, {});
			}
			return event;
		},
	};
}

describe("herdr-skill extension", () => {
	test("does nothing outside a Herdr pane", () => {
		const harness = createHarness({ env: { HERDR_ENV: "0" } });
		expect(harness.handlerCount("before_agent_start")).toBe(0);
	});

	test("adds only a pointer to the skill inside a Herdr pane", async () => {
		const harness = createHarness({
			env: { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w1", HERDR_TAB_ID: "w1:t1", HERDR_PANE_ID: "w1:p1" },
		});

		const event = await harness.emitBeforeAgentStart();
		const section: string = event.systemPromptOptions.sections.herdr;

		// The pointer: where the skill lives, and when to load it.
		expect(section).toContain("Run `herdr --skill`");
		expect(section).toContain("read, inspect, or wait on output from another pane");
		expect(section).toContain("create, split, move, focus, run a command in, or close a pane");
		expect(section).toContain("another coding agent on this machine");
		expect(section).toContain("HERDR_PANE_ID=w1:p1");

		// Not the skill itself, and no hc/herdr-app leakage in a herdr session.
		expect(section).not.toContain("agent start");
		expect(section).not.toContain("pane split --current");
		expect(section).not.toContain("name: herdr");
		expect(section).not.toContain("hc --skill");
		expect(section).not.toContain("herdr-app --skill");
		expect(section.length).toBeLessThan(1500);
	});

	test("pointer stays the same on a later turn", async () => {
		const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" };
		const harness = createHarness({ env });
		const first = await harness.emitBeforeAgentStart();
		const second = await harness.emitBeforeAgentStart();
		expect(second.systemPromptOptions.sections.herdr).toBe(first.systemPromptOptions.sections.herdr);
		expect(herdrPointer(env)).toBe(first.systemPromptOptions.sections.herdr);
	});

	test("adds pointer only to hc --skill and herdr-app --skill inside an hc session", async () => {
		const harness = createHarness({
			env: { HC_TERMINAL_ID: "t3" },
		});

		const event = await harness.emitBeforeAgentStart();
		const section: string = event.systemPromptOptions.sections.herdr;

		expect(section).toContain("Run `hc --skill`");
		expect(section).toContain("Run `herdr-app --skill`");
		expect(section).toContain("HC_TERMINAL_ID=t3");
		expect(section).toContain("Do not load either skill for work that stays in this terminal");
		expect(section).not.toContain("Run `herdr --skill`");
		expect(section.length).toBeLessThan(1500);
	});
});
