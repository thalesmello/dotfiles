import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { codemodeCalls, codemodeOutput, visibleCodemodeCalls } from "../extensions/open-tui/codemode-view.ts";
import { nestedOutputs } from "../extensions/open-tui/nested-output.ts";
import { visibleWidth, highlightRequests } from "./open-tui-tool-host.ts";

const temp = mkdtempSync(join(tmpdir(), "open-tui-codemode-test-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
const hostPath = join(import.meta.dir, "open-tui-tool-host.ts");
const hostHref = pathToFileURL(hostPath).href;
const entryPath = join(temp, "entry.ts");
writeFileSync(entryPath, [
	`export * from ${JSON.stringify(join(import.meta.dir, "../extensions/open-tui/tool-view.ts"))};`,
	`export * from ${JSON.stringify(join(import.meta.dir, "../extensions/rounded-tools.ts"))};`,
	`export * from ${JSON.stringify(join(import.meta.dir, "../extensions/open-tui/nested-tool-blocks.ts"))};`,
].join("\n"));
const build = await Bun.build({
	entrypoints: [entryPath],
	target: "bun", format: "esm",
	external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
	plugins: [{ name: "test-osc8", setup(builder) {
		builder.onResolve({ filter: /osc8-links\.ts$/ }, () => ({ path: hostPath, external: true }));
	} }],
});
if (!build.success) throw new Error(build.logs.join("\n"));
const source = (await build.outputs[0].text())
	.replaceAll('from "@earendil-works/pi-tui"', `from ${JSON.stringify(hostHref)}`)
	.replaceAll('from "@earendil-works/pi-coding-agent"', `from ${JSON.stringify(hostHref)}`);
const modulePath = join(temp, "tool-view.mjs");
writeFileSync(modulePath, source);
const { createCompactRenderers, registerToolView, registerRoundedTools, nestedToolBlocks, highlightedSource, nestedSources } = await import(pathToFileURL(modulePath).href);
const theme = { colors: {}, appearance: "dark", getColorMode: () => "truecolor", fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text };
const icons = () => ({ toolCall: "●", toolResult: "└" });
const args = { code: 'const r = await tools.read({path: "src/a.ts"});\nreturn r;' };
const context = (extra = {}) => ({ state: {}, toolCallId: "parent", cwd: "/project", outputPad: 2, args, expanded: false, executionStarted: false, isPartial: false, isError: false, invalidate() {}, ...extra });
const result = (output = "answer", calls: unknown[] = [], extra = {}) => ({ content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }, { type: "text", text: output }], details: { calls }, ...extra });
const readCall = { name: "read", args: '{"path":"/project/src/a.ts"}', status: "ok", durationMs: 12 };
const native = { renderCall: () => ({ render: () => ["FULL SCRIPT"], invalidate() {} }), renderResult: () => ({ render: () => ["FULL OUTPUT"], invalidate() {} }) };
const renderer = () => createCompactRenderers("codemode", native, icons);
function renderResult(value: unknown, extra = {}, partial = false, width = 120): string[] {
	return renderer().renderResult(value, { isPartial: partial, expanded: false }, theme, context(extra)).render(width);
}

describe("open-tui codemode groups", () => {
	test("rounded wrapper frames the entire codemode group like Bash", () => {
		const resolvers: any[] = [];
		const pi = { on() {}, registerToolRenderer(fn: any) { resolvers.push(fn); }, getAllTools: () => [{ name: "codemode", sourceInfo: { source: "builtin" } }] };
		registerRoundedTools(pi);
		registerToolView(pi, () => ({ mode: "compact", extensionTools: false, exclude: [] }), icons);
		const resolve = (i: number): any => i < resolvers.length ? resolvers[i]("codemode", () => resolve(i + 1)) : native;
		const r = resolve(0);
		const ctx = context();
		const call = r.renderCall(args, theme, ctx).render(100);
		const output = r.renderResult(result("answer", [readCall]), { isPartial: false }, theme, ctx).render(100);
		const group = [...call, ...output];
		expect(group[0]).toStartWith("╭");
		expect(group.at(-1)).toStartWith("╰");
		expect(group.filter((line: string) => line.startsWith("╭"))).toHaveLength(1);
		expect(group.filter((line: string) => line.startsWith("╰"))).toHaveLength(1);
		expect(group.join("\n")).toContain("Codemode(JavaScript");
		expect(group.join("\n")).toContain("Read(src/a.ts)");
		expect(group.join("\n")).toContain("answer");
		expect(group.every((line: string) => visibleWidth(line) <= 100)).toBe(true);
	});
	test("nested block clicks toggle only that child through the rounded parent", () => {
		const resolvers: any[] = [];
		const pi = { on() {}, registerToolRenderer(fn: any) { resolvers.push(fn); }, getAllTools: () => [{ name: "codemode", sourceInfo: { source: "builtin" } }] };
		registerRoundedTools(pi);
		registerToolView(pi, () => ({ mode: "compact", extensionTools: false, exclude: [] }), icons);
		const resolve = (i: number): any => i < resolvers.length ? resolvers[i]("codemode", () => resolve(i + 1)) : native;
		const r = resolve(0);
		let invalidations = 0;
		const ctx = context({ invalidate: () => { invalidations++; } });
		const value = result("script output", [
			{ ...readCall, id: "read-1" },
			{ id: "bash-1", name: "bash", args: JSON.stringify({ command: "python3 - <<'PY'\nprint(42)\nPY" }), status: "ok" },
		], { details: { calls: [{ ...readCall, id: "read-1" }, { id: "bash-1", name: "bash", args: JSON.stringify({ command: "python3 - <<'PY'\nprint(42)\nPY" }), status: "ok" }], openTuiNestedOutputs: [{ id: "read-1", text: "const value = 42;", images: 0, truncated: false, isError: false }] } });
		const view = r.renderResult(value, { isPartial: false }, theme, ctx);
		const before = view.render(100);
		expect(before.join("\n")).toContain("▶ Read");
		const click = { type: "click", button: "left", x: 10, y: 1, width: 100, height: before.length, screenX: 10, screenY: 1, shift: false, alt: false, ctrl: false };
		expect(view.handleMouse(click)).toEqual({ handled: true, render: true });
		const after = view.render(100).join("\n");
		expect(after).toContain("▼ Read");
		expect(after).toContain("▶ Bash");
		expect(after).toContain("const value = 42;");
		expect(invalidations).toBe(1);
		expect(view.handleMouse({ ...click, type: "drag" })).toBeUndefined();
		expect(view.handleMouse({ ...click, x: 0 })).toBeUndefined();
		const refreshed = r.renderResult(value, { isPartial: false }, theme, ctx).render(100).join("\n");
		expect(refreshed).toContain("▼ Read");
		expect(highlightRequests.some((request) => request.language === "typescript")).toBe(true);
	});
	test("collapsed nested Edit blocks display the native numbered diff preview", () => {
		const call = { id: "edit-1", name: "edit", args: { path: "src/a.ts", edits: [{ oldText: "const answer = 1;", newText: "const answer = 42;" }] }, status: "ok" };
		const blocks = nestedToolBlocks({ calls: [call], outputs: [{ id: "edit-1", text: "Edited", diff: "-4 const answer = 1;\n+4 const answer = 42;", images: 0, truncated: false, isError: false }], expanded: false, overrides: new Map(), theme, heading: () => "Edit(src/a.ts)", invalidate() {} });
		const lines = blocks.render(100).join("\n");
		expect(lines).toContain("▶ Edit");
		expect(lines).toContain("Changes");
		expect(lines).toContain("-4 const answer = 1;");
		expect(lines).toContain("+4 const answer = 42;");
	});
	test("historical Edit calls without diff snapshots show requested changes without fake file line numbers", () => {
		const call = { id: "edit-old", name: "edit", args: { path: "script.py", edits: [{ oldText: "print(1)", newText: "print(42)" }] }, status: "ok" };
		const blocks = nestedToolBlocks({ calls: [call], outputs: [], expanded: false, overrides: new Map(), theme, heading: () => "Edit", invalidate() {} });
		const lines = blocks.render(80).join("\n");
		expect(lines).toContain("Requested changes");
		expect(lines).toContain("- print(1)");
		expect(lines).toContain("+ print(42)");
		expect(lines).not.toContain("-1 print");
	});
	test("truncated native diffs keep complete preview rows", () => {
		const call = { id: "edit-cut", name: "edit", args: { path: "a.ts" }, status: "ok" };
		const outputs = nestedOutputs({ openTuiNestedOutputs: [{ id: "edit-cut", text: "Edited", diff: "-4 const a = 1;\n+4 const a = 42;\n+123", diffTruncated: true }] });
		const blocks = nestedToolBlocks({ calls: [call], outputs, expanded: false, overrides: new Map(), theme, heading: () => "Edit", invalidate() {} });
		const lines = blocks.render(80).join("\n");
		expect(lines).toContain("-4 const a = 1;");
		expect(lines).toContain("+4 const a = 42;");
		expect(lines).toContain("diff snapshot truncated");
	});
	test("requested previews clearly mark omitted lines and characters", () => {
		for (const oldText of ["old", "x".repeat(20_000)]) {
			const call = { name: "edit", args: { oldText, newText: "new\n".repeat(100) }, status: "ok" };
			const blocks = nestedToolBlocks({ calls: [call], outputs: [], expanded: false, overrides: new Map(), theme, heading: () => "Edit", invalidate() {} });
			expect(blocks.render(80).join("\n")).toContain("requested diff preview truncated");
		}
	});
	test("failed Edit calls do not claim an applied diff preview", () => {
		const call = { id: "edit-failed", name: "edit", args: { oldText: "old", newText: "new" }, status: "error" };
		const blocks = nestedToolBlocks({ calls: [call], outputs: [], expanded: false, overrides: new Map(), theme, heading: () => "Edit", invalidate() {} });
		expect(blocks.render(80).join("\n")).not.toContain("Requested changes");
	});
	test("UI snapshots are attached to parent details without altering model output", () => {
		const handlers = new Map<string, Function[]>();
		registerToolView({ on(name: string, fn: Function) { handlers.set(name, [...handlers.get(name) ?? [], fn]); }, registerToolRenderer() {}, getAllTools: () => [] }, () => ({ mode: "compact", exclude: [], extensionTools: false }), icons);
		const emit = (name: string, event: any) => handlers.get(name)?.map((fn) => fn(event));
		emit("tool_execution_start", { toolName: "codemode", toolCallId: "parent" });
		emit("tool_execution_start", { toolName: "bash", toolCallId: "parent/1", parentToolCallId: "parent" });
		emit("tool_execution_end", { toolCallId: "parent/1", parentToolCallId: "parent", isError: false, result: { content: [{ type: "text", text: "child output" }] } });
		const parent = { toolName: "codemode", toolCallId: "parent", details: { calls: [readCall] }, content: [{ type: "text", text: "filtered script output" }] };
		const updated = emit("tool_result", parent)?.[0];
		expect(updated.details.openTuiNestedOutputs[0].text).toBe("child output");
		expect(updated.content).toBeUndefined();
		expect(parent.content[0].text).toBe("filtered script output");
	});
	test("nested source highlighting handles requested file types and interpreter bodies", () => {
		const languages = { py: "python", rb: "ruby", rs: "rust", c: "c", cpp: "cpp", java: "java", php: "php", js: "javascript", ts: "typescript", R: "r", sql: "sql", go: "go" };
		for (const [extension, language] of Object.entries(languages)) {
			highlightRequests.length = 0;
			const sections = nestedSources({ name: "write", args: { path: `script.${extension}`, content: "example source" }, status: "ok" });
			highlightedSource(sections[0], theme);
			expect(highlightRequests[0].language).toBe(language);
		}
		highlightRequests.length = 0;
		highlightedSource({ label: "Command", source: "python3 - <<'PY'\nprint(42)\nPY", shell: true }, theme);
		expect(highlightRequests.some((request) => request.language === "python" && request.source.includes("print(42)"))).toBe(true);
	});
	test("large nested edit sources have a shared bounded highlighting budget", () => {
		highlightRequests.length = 0;
		const largeSource = "x".repeat(100_000);
		const call = { id: "large-edit", name: "edit", args: { path: "big.py", edits: Array.from({ length: 2000 }, () => ({ oldText: largeSource, newText: largeSource })) }, status: "ok" };
		const blocks = nestedToolBlocks({ calls: [call], outputs: [], expanded: true, overrides: new Map(), theme, heading: () => "Edit", invalidate() {} });
		const rendered = blocks.render(80);
		expect(highlightRequests.reduce((total, request) => total + request.source.length, 0)).toBeLessThanOrEqual(16_384);
		expect(rendered.length).toBeLessThan(110);
		expect(rendered.join("\n")).toContain("truncated");
	});
	test("line budget is applied before highlighting, preserving detected Python body", () => {
		highlightRequests.length = 0;
		const source = "python3 - <<'PY'\n" + "print(42)\n".repeat(1000) + "PY";
		highlightedSource({ label: "Command", source, shell: true }, theme);
		expect(highlightRequests.some((request) => request.language === "python")).toBe(true);
		expect(highlightRequests.reduce((total, request) => total + request.source.split("\n").length, 0)).toBeLessThanOrEqual(81);
	});
	test("codemode gets the built-in compact view with generic extension rendering disabled", () => {
		let resolve: any;
		const pi = { on() {}, registerToolRenderer(fn: any) { resolve = fn; }, getAllTools: () => [{ name: "codemode", sourceInfo: { source: "builtin" } }] };
		registerToolView(pi, () => ({ mode: "compact", extensionTools: false, exclude: [] }), icons);
		const custom = resolve("codemode", () => native);
		expect(custom).not.toBe(native);
		const lines = custom.renderCall(args, theme, context()).render(120);
		expect(lines.join("\n")).toContain("Codemode(JavaScript · 2 lines)");
		expect(lines.join("\n")).not.toContain("code=");
	});
	test("native mode, excluded tools, and non-builtin overrides remain untouched", () => {
		for (const settings of [{ mode: "native", exclude: [] }, { mode: "compact", exclude: ["codemode"] }]) {
			let resolve: any;
			registerToolView({ on() {}, registerToolRenderer(fn: any) { resolve = fn; }, getAllTools: () => [] }, () => ({ ...settings, extensionTools: false }), icons);
			expect(resolve("codemode", () => native)).toBe(native);
		}
		let resolve: any;
		registerToolView({ on() {}, registerToolRenderer(fn: any) { resolve = fn; }, getAllTools: () => [{ name: "codemode", sourceInfo: { source: "custom-extension" } }] }, () => ({ mode: "compact", exclude: [], extensionTools: false }), icons);
		expect(resolve("codemode", () => native)).toBe(native);
	});
	test("does not build native script cards for collapsed progress", () => {
		let calls = 0;
		const n = { renderCall: () => { calls++; return native.renderCall(); }, renderResult: () => { calls++; return native.renderResult(); } };
		const r = createCompactRenderers("codemode", n, icons);
		const ctx = context({ isPartial: true });
		r.renderCall(args, theme, ctx).render(120);
		r.renderResult(result("", [readCall]), { isPartial: true }, theme, ctx).render(120);
		expect(calls).toBe(0);
	});
	test("groups call statuses, duration, and actual output without the script envelope", () => {
		const lines = renderResult(result("answer", [readCall]), { durationMs: 120 }).join("\n");
		expect(lines).toContain("Done · 1 call · 1 line · 120ms");
		expect(lines).toContain("Read(src/a.ts)");
		expect(lines).toContain("Done · 12ms");
		expect(lines).toContain("answer");
		expect(lines).not.toContain("Script completed");
		expect(lines).not.toContain("Wall time");
	});
	test("live results show nested progress under the parent", () => {
		const lines = renderResult(result("", [{ ...readCall, status: "running", durationMs: undefined }]), { isPartial: true }, true).join("\n");
		expect(lines).toContain("Running… · 1 call · 1 running");
		expect(lines).toContain("▶ Read(src/a.ts)");
	});
	test("caught nested errors are visible without turning a successful script into a failure", () => {
		const lines = renderResult(result("recovered", [{ ...readCall, status: "error", error: "Denied" }])).join("\n");
		expect(lines).toContain("Done · 1 call · 1 failed");
		expect(lines).toContain("▶ Read(src/a.ts)");
		expect(lines).toContain("Failed");
		expect(lines).toContain("Denied");
		expect(lines).toContain("recovered");
	});
	test("script failures show the real reason, not just Script failed", () => {
		const value = result("Script error:\nError: Permission denied", [{ ...readCall, status: "error" }]);
		value.content[0].text = "Script failed\nWall time 0.1 seconds\nOutput:\n";
		const lines = renderResult(value, { isError: true }).join("\n");
		expect(lines).toContain("Failed · 1 call · 1 failed");
		expect(lines).toContain("Permission denied");
	});
	test("large groups and output are bounded, failures are kept, full output stays discoverable", () => {
		const calls = Array.from({ length: 12 }, (_, i) => ({ ...readCall, name: i === 11 ? "bash" : "read", status: i === 11 ? "error" : "ok", error: i === 11 ? "failed test" : undefined }));
		const value = result(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"), calls, { details: { calls, fullOutputPath: "/tmp/full-output.txt" } });
		const lines = renderResult(value);
		expect(lines.length).toBeLessThanOrEqual(23);
		expect(lines.join("\n")).toContain("failed test");
		expect(lines.join("\n")).toContain("… +8 calls");
		expect(lines.join("\n")).toContain("… +17 output lines");
		expect(lines.join("\n")).toContain("Full output: /tmp/full-output.txt");
	});
	test("expanded view renders highlighted parent code and full script output", () => {
		const r = renderer();
		const ctx = context({ expanded: true });
		expect(r.renderCall(args, theme, ctx).render(120).join("\n")).toContain("const r = await tools.read");
		expect(r.renderResult(result("answer"), { isPartial: false, expanded: true }, theme, ctx).render(120).join("\n")).toContain("answer");
	});
	test("missing native result renderer still exposes full output on expansion", () => {
		const r = createCompactRenderers("codemode", { renderCall: native.renderCall }, icons);
		const ctx = context({ expanded: true });
		const output = "one\ntwo\nthree\nfour\nfive";
		const rendered = r.renderResult(result(output), { isPartial: false, expanded: true }, theme, ctx).render(120).join("\n");
		expect(rendered).toContain("five");
		expect(rendered).not.toContain("+2 output lines");
	});
	test("codemode owns rendering across expansion and completion without nesting native frames", () => {
		const events: string[] = [];
		const n = {
			renderCall: (_args: unknown, _theme: unknown, ctx: any) => { ctx.state.initialized = true; events.push("call"); return native.renderCall(); },
			renderResult: (_result: unknown, options: any, _theme: unknown, ctx: any) => { expect(ctx.state.initialized).toBe(true); events.push(options.isPartial ? "progress" : "complete"); return native.renderResult(); },
		};
		const r = createCompactRenderers("codemode", n, icons);
		const ctx = context({ isPartial: true });
		r.renderCall(args, theme, ctx).render(120);
		ctx.expanded = true;
		r.renderCall(args, theme, ctx).render(120);
		r.renderResult(result("", [readCall]), { isPartial: true }, theme, ctx).render(120);
		ctx.expanded = false;
		r.renderResult(result("", [readCall]), { isPartial: true }, theme, ctx).render(120);
		ctx.isPartial = false;
		r.renderResult(result("answer", [readCall]), { isPartial: false }, theme, ctx).render(120);
		expect(events).toEqual([]);
	});
	test("Zen receives native renderers or the complete fallback, not compact groups", () => {
		(globalThis as any).piZenSwitch = { look: "zen" };
		try {
			expect(renderer().renderResult(result("answer"), { isPartial: false }, theme, context()).render(120)).toEqual(["FULL OUTPUT"]);
			const r = createCompactRenderers("codemode", undefined, icons);
			expect(r.renderResult(result("all output"), { isPartial: false }, theme, context()).render(120).join("\n")).toContain("all output");
		} finally { delete (globalThis as any).piZenSwitch; }
	});
	test("images are counted; rows fit narrow widths and sanitize terminal controls", () => {
		const value = result("safe\x1b[31m text\x00");
		(value.content as any[]).push({ type: "image", mimeType: "image/png", data: "image-data" });
		for (const width of [0, 1, 8, 25, 60]) expect(renderResult(value, {}, false, width).every((line) => visibleWidth(line) <= width)).toBe(true);
		expect(renderResult(value).join("\n")).toContain("1 image");
		expect(renderResult(value).join("\n")).not.toContain("\x00");
	});
});

describe("codemode normalization", () => {
	test("malformed metadata is safe and unknown statuses are not claimed successful", () => {
		expect(codemodeCalls({ calls: [null, 5, {}, { name: "read", args: "broken JSON", status: "new-status" }] })).toEqual([{ name: "read", args: {}, status: "running" }]);
		expect(codemodeCalls(undefined)).toEqual([]);
		expect(codemodeCalls({ calls: false })).toEqual([]);
	});
	test("preserves arbitrary output and prioritizes cancelled calls outside the compact window", () => {
		expect(codemodeOutput("Script completed\nThis is user output")).toBe("Script completed\nThis is user output");
		const calls = codemodeCalls({ calls: [...Array(6).fill(readCall), { name: "bash", status: "cancelled" }] });
		expect(visibleCodemodeCalls(calls).some((call) => call.status === "cancelled")).toBe(true);
	});
});
