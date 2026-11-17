import { describe, expect, test } from "bun:test";
import { buildRecapSnapshot } from "../extensions/lib/recap-snapshot.ts";

// Snapshot tests are independent of the TUI and do not make model requests.
describe("recap snapshot", () => {
	test("includes history, tool evidence, summaries, and shell exit status", () => {
		const snapshot = buildRecapSnapshot([
			{ role: "compactionSummary", summary: "Earlier goal and constraints" },
			{ role: "branchSummary", summary: "Approach ruled out" },
			{ role: "user", content: "Fix src/auth.ts" },
			{ role: "assistant", content: [
				{ type: "text", text: "Testing the change" },
				{ type: "toolCall", name: "bash", arguments: { command: "bun test" } },
			] },
			{ role: "toolResult", toolName: "bash", isError: true, content: [{ type: "text", text: "1 test failed" }] },
			{ role: "bashExecution", command: "git status", output: "M src/auth.ts", exitCode: 0 },
		]);
		for (const text of ["Earlier goal", "Approach ruled out", "src/auth.ts", "bun test", "1 test failed", "(error)", "exit code: 0"]) {
			expect(snapshot).toContain(text);
		}
	});

	test("does not expose system prompts, thinking, excluded shell output, or image bytes", () => {
		const snapshot = buildRecapSnapshot([
			{ role: "system", content: "PRIVATE SYSTEM PROMPT" },
			{ role: "assistant", content: [
				{ type: "thinking", thinking: "PRIVATE REASONING" },
				{ type: "text", text: "Visible answer" },
			] },
			{ role: "user", content: [{ type: "image", data: "PRIVATE IMAGE BYTES" }] },
			{ role: "bashExecution", output: "EXCLUDED SHELL OUTPUT", excludeFromContext: true },
		]);
		expect(snapshot).toContain("Visible answer");
		expect(snapshot).toContain("image not included");
		for (const text of ["PRIVATE SYSTEM PROMPT", "PRIVATE REASONING", "PRIVATE IMAGE BYTES", "EXCLUDED SHELL OUTPUT"]) {
			expect(snapshot).not.toContain(text);
		}
	});

	test("marks incomplete responses instead of treating them as success", () => {
		expect(buildRecapSnapshot([{ role: "assistant", stopReason: "error", errorMessage: "Provider unavailable" }]))
			.toContain("[error: Provider unavailable]");
		expect(buildRecapSnapshot([{ role: "assistant", stopReason: "aborted" }])).toContain("[aborted]");
	});

	test("explicitly marks truncation while keeping the start and end", () => {
		const snapshot = buildRecapSnapshot([{ role: "user", content: `START${"x".repeat(20_000)}END` }]);
		expect(snapshot).toContain("START");
		expect(snapshot).toContain("END");
		expect(snapshot).toContain("characters omitted");
		expect(snapshot.length).toBeLessThan(8_200);
	});

	test("bounds the whole snapshot and keeps opening and recent context", () => {
		const snapshot = buildRecapSnapshot(Array.from({ length: 40 }, (_, i) => ({
			role: "user", content: `TURN-${i} ${"x".repeat(6_000)} END-${i}`,
		})));
		expect(snapshot).toContain("TURN-0");
		expect(snapshot).toContain("END-39");
		expect(snapshot).toContain("characters omitted");
		expect(snapshot.length).toBeLessThan(72_200);
	});

	test("empty or unsupported history is empty", () => {
		expect(buildRecapSnapshot([])).toBe("");
		expect(buildRecapSnapshot([{ role: "system", content: "Instructions only" }])).toBe("");
	});
});
