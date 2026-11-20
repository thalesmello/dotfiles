import { describe, expect, test } from "bun:test";
import { NestedOutputCapture, nestedOutputs } from "../extensions/open-tui/nested-output.ts";

describe("nested tool output snapshots", () => {
	test("captures nested results, never image bytes, and releases session state", () => {
		const capture = new NestedOutputCapture();
		capture.start({ toolName: "codemode", toolCallId: "parent" });
		capture.start({ toolName: "read", toolCallId: "parent/1", parentToolCallId: "parent" });
		capture.end({ toolCallId: "parent/1", parentToolCallId: "parent", isError: false, result: { content: [{ type: "text", text: "const answer = 42" }, { type: "image", data: "PRIVATE IMAGE BYTES" }] } });
		expect(capture.get("parent")).toEqual([{ id: "parent/1", text: "const answer = 42", images: 1, isError: false, truncated: false }]);
		expect(JSON.stringify(capture.get("parent"))).not.toContain("PRIVATE IMAGE BYTES");
		capture.end({ toolCallId: "parent", result: {}, isError: false });
		expect(capture.get("parent")).toEqual([]);
	});
	test("preserves native edit diffs for rendering and resumed sessions", () => {
		const capture = new NestedOutputCapture();
		capture.start({ toolName: "codemode", toolCallId: "p" });
		capture.start({ toolName: "edit", toolCallId: "p/1", parentToolCallId: "p" });
		const diff = "-4 const answer = 1;\n+4 const answer = 42;";
		capture.end({ toolCallId: "p/1", isError: false, result: { content: [{ type: "text", text: "Edited" }], details: { diff } } });
		const saved = capture.get("p");
		expect(saved[0].diff).toBe(diff);
		expect(nestedOutputs({ openTuiNestedOutputs: saved })[0].diff).toBe(diff);
	});
	test("byte clipping drops incomplete trailing diff rows without losing valid changes", () => {
		const capture = new NestedOutputCapture();
		capture.start({ toolName: "codemode", toolCallId: "p" });
		capture.start({ toolName: "edit", toolCallId: "p/1", parentToolCallId: "p" });
		capture.end({ toolCallId: "p/1", isError: false, result: { content: [{ type: "text", text: "Edited" }], details: { diff: "-4 old\n+4 new\n+" + "1".repeat(9000) + " source" } } });
		const output = capture.get("p")[0];
		expect(output.diff).toBe("-4 old\n+4 new");
		expect(output.diffTruncated).toBe(true);
	});
	test("diffs share the UTF-8 snapshot budget with ordinary output", () => {
		const capture = new NestedOutputCapture();
		capture.start({ toolName: "codemode", toolCallId: "p" });
		for (let i = 0; i < 10; i++) {
			capture.start({ toolName: "edit", toolCallId: `p/${i}`, parentToolCallId: "p" });
			capture.end({ toolCallId: `p/${i}`, isError: false, result: { content: [{ type: "text", text: "x".repeat(9000) }], details: { diff: "+1 " + "😀".repeat(9000) } } });
		}
		const saved = nestedOutputs({ openTuiNestedOutputs: capture.get("p") });
		expect(saved[0].diffTruncated).toBe(true);
		expect(saved.every((output) => Buffer.byteLength(output.text) + Buffer.byteLength(output.diff ?? "") <= 8192)).toBe(true);
		expect(saved.reduce((total, output) => total + Buffer.byteLength(output.text) + Buffer.byteLength(output.diff ?? ""), 0)).toBeLessThanOrEqual(65536);
	});
	test("caps child output and total script metadata; handles deeper nesting", () => {
		const capture = new NestedOutputCapture();
		capture.start({ toolName: "codemode", toolCallId: "parent" });
		capture.start({ toolName: "bridge", toolCallId: "parent/1", parentToolCallId: "parent" });
		for (let i = 0; i < 100; i++) {
			const id = `parent/1/${i}`;
			capture.start({ toolName: "bash", toolCallId: id, parentToolCallId: "parent/1" });
			capture.end({ toolCallId: id, parentToolCallId: "parent/1", isError: true, result: { content: [{ type: "text", text: "x".repeat(20_000) }] } });
		}
		const values = capture.get("parent");
		expect(values).toHaveLength(64);
		expect(values.reduce((total, value) => total + value.text.length, 0)).toBeLessThanOrEqual(65_536);
		expect(values.every((value) => value.text.length <= 8192 && value.truncated)).toBe(true);
		capture.clear();
		expect(capture.get("parent")).toEqual([]);
	});
	test("UTF-8 budgets apply during capture and replay without splitting emoji", () => {
		const capture = new NestedOutputCapture();
		capture.start({ toolName: "codemode", toolCallId: "p" });
		for (let i = 0; i < 20; i++) {
			capture.start({ toolName: "bash", toolCallId: `p/${i}`, parentToolCallId: "p" });
			capture.end({ toolCallId: `p/${i}`, isError: false, result: { content: [{ type: "text", text: "😀".repeat(8000) }] } });
		}
		const values = capture.get("p");
		expect(values.reduce((total, value) => total + Buffer.byteLength(value.text), 0)).toBeLessThanOrEqual(65_536);
		expect(values.every((value) => Buffer.byteLength(value.text) <= 8192 && !/[\uD800-\uDBFF]$/.test(value.text))).toBe(true);
		const loaded = nestedOutputs({ openTuiNestedOutputs: Array.from({ length: 64 }, (_, i) => ({ id: `p/${i}`, text: "😀".repeat(8000) })) });
		expect(loaded.reduce((total, value) => total + Buffer.byteLength(value.text), 0)).toBeLessThanOrEqual(65_536);
	});
	test("unrelated tools and disabled capture do not collect output", () => {
		const capture = new NestedOutputCapture();
		capture.start({ toolName: "codemode", toolCallId: "p" }, false);
		capture.start({ toolName: "bash", toolCallId: "p/1", parentToolCallId: "p" });
		capture.end({ toolCallId: "p/1", isError: false, result: { content: [{ type: "text", text: "secret" }] } });
		expect(capture.get("p")).toEqual([]);
	});
	test("malformed saved metadata is ignored and oversized snapshots are marked", () => {
		expect(nestedOutputs({ openTuiNestedOutputs: [null, {}, { id: "one", text: "x".repeat(9000), images: -1 }] })).toEqual([{ id: "one", text: "x".repeat(8192), images: 0, truncated: true, isError: false }]);
	});
});
