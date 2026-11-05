import { describe, expect, test } from "bun:test";
import diffHighlightExtension, {
	containsDiff,
	diffWords,
	pairLines,
	renderDiffText,
	rewriteComponentDiffs,
	type DiffHighlightTheme,
} from "../extensions/diff-highlight.ts";

// Fake theme: fg wraps as [token]...[/], fragments become <bg>...</bg>,
// getBgAnsi marks a background restore as <restore:token>.
const theme: DiffHighlightTheme = {
	fg: (color, text) => `[${color}]${text}[/]`,
	style: (text) => `<bg>${text}</bg>`,
	inverse: (text) => `<inv>${text}</inv>`,
	getBgAnsi: (color) => `<restore:${color}>`,
	colors: { toolDiffAdded: "#0f0", toolDiffRemoved: "#f00" },
};

describe("diffWords", () => {
	test("isolates the changed word", () => {
		const parts = diffWords("const x = foo(1);", "const x = bar(1);")!;
		expect(parts.filter((p) => p.removed).map((p) => p.value)).toEqual(["foo"]);
		expect(parts.filter((p) => p.added).map((p) => p.value)).toEqual(["bar"]);
	});

	test("returns undefined for oversized lines", () => {
		const big = "word ".repeat(500);
		expect(diffWords(big, big.replace("word", "term"))).toBeUndefined();
	});
});

describe("pairLines", () => {
	test("pairs by similarity, not position", () => {
		const pairs = pairLines(
			["const a = 1;", "return hello(world);"],
			["return hello(moon);", "const a = 2;"],
		);
		expect(pairs.get(0)).toBe(1);
		expect(pairs.get(1)).toBe(0);
	});

	test("leaves dissimilar lines unpaired", () => {
		const pairs = pairLines(["alpha beta gamma delta"], ["completely different content here"]);
		expect(pairs.size).toBe(0);
	});
});

describe("containsDiff", () => {
	test("recognises pi-format diffs", () => {
		expect(containsDiff("- 10 const a = 1;\n+ 10 const a = 2;\n- 11 foo();\n+ 11 bar();")).toBe(true);
	});

	test("recognises unified diffs", () => {
		expect(containsDiff("--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n-old\n+new")).toBe(true);
	});

	test("ignores plain output with +/- bullets", () => {
		expect(containsDiff("- one thing\n- another thing\n+ a plus line")).toBe(false);
		expect(containsDiff("just some output\nno diff here")).toBe(false);
	});
});

describe("renderDiffText", () => {
	test("highlights only the changed fragment in a 1-to-1 pair", () => {
		const out = renderDiffText("- 10 const a = foo;\n+ 10 const a = bar;", theme);
		expect(out).toContain("<bg>foo</bg>");
		expect(out).toContain("<bg>bar</bg>");
		expect(out).not.toContain("<bg>const</bg>");
	});

	test("highlights multi-line blocks, not just 1-to-1 (the built-in gap)", () => {
		const out = renderDiffText(
			["- 10 const a = 1;", "- 11 return hello(world);", "+ 10 const a = 2;", "+ 11 return hello(moon);"].join("\n"),
			theme,
		);
		expect(out).toContain("<bg>1</bg>");
		expect(out).toContain("<bg>2</bg>");
		expect(out).toContain("<bg>world</bg>");
		expect(out).toContain("<bg>moon</bg>");
	});

	test("pairs reordered lines by similarity", () => {
		const out = renderDiffText("-const a = 1;\n-return hello(world);\n+return hello(moon);\n+const a = 2;", theme);
		expect(out).toContain("<bg>world</bg>");
		expect(out).toContain("<bg>2</bg>");
	});

	test("restores the ambient panel background after each fragment", () => {
		const out = renderDiffText("- 10 const a = foo;\n+ 10 const a = bar;", theme, "toolSuccessBg");
		expect(out).toContain("<bg>foo</bg><restore:toolSuccessBg>");
		expect(out).toContain("<bg>bar</bg><restore:toolSuccessBg>");
	});

	test("omits the background restore when no ambient token is given", () => {
		const out = renderDiffText("- 10 const a = foo;\n+ 10 const a = bar;", theme);
		expect(out).not.toContain("<restore:");
	});

	test("keeps unpaired lines plain and preserves context/headers", () => {
		const out = renderDiffText("@@ -1,2 +1,2 @@\n-alpha beta gamma\n+completely different content\n ctx line", theme);
		expect(out).toContain("[toolDiffRemoved]-alpha beta gamma[/]");
		expect(out).toContain("[toolDiffAdded]+completely different content[/]");
		expect(out).toContain("[muted]@@ -1,2 +1,2 @@[/]");
		expect(out).toContain("[toolDiffContext] ctx line[/]");
		expect(out).not.toContain("<bg>");
	});
});

describe("rewriteComponentDiffs", () => {
	test("rewrites a Text-like node containing a diff, leaves others alone", () => {
		const diffNode = {
			text: "\x1b[31m- 10 const a = foo;\x1b[39m\n\x1b[32m+ 10 const a = bar;\x1b[39m\n\x1b[31m- 11 x();\x1b[39m\n\x1b[32m+ 11 y();\x1b[39m",
			setText(t: string) {
				this.text = t;
			},
		};
		const plainNode = {
			text: "hello world",
			setText(t: string) {
				this.text = t;
			},
		};
		const tree = { children: [diffNode, plainNode] };
		rewriteComponentDiffs(tree, theme);
		expect(diffNode.text).toContain("<bg>foo</bg>");
		expect(plainNode.text).toBe("hello world");
	});

	test("rewrites a VisualLinePreview-like node and invalidates it", () => {
		let invalidated = false;
		const preview = {
			options: { text: "@@ -1 +1 @@\n-old value here\n+new value here\n-old second line\n+new second line" },
			invalidate() {
				invalidated = true;
			},
		};
		rewriteComponentDiffs(preview, theme);
		expect(preview.options.text).toContain("<bg>");
		expect(invalidated).toBe(true);
	});
});

describe("extension registration", () => {
	test("wraps the renderers next() provides without replacing execution", () => {
		let resolver: ((toolName: string, next: () => unknown) => unknown) | undefined;
		const pi: any = {
			registerToolRenderer(fn: typeof resolver) {
				resolver = fn;
			},
		};
		diffHighlightExtension(pi);
		expect(resolver).toBeDefined();

		const base = {
			renderShell: "self",
			renderCall: () => ({ children: [] }),
			renderResult: () => ({ children: [] }),
		};
		const wrapped = resolver!("edit", () => base) as typeof base & Record<string, unknown>;
		expect(wrapped).not.toBe(base);
		expect(wrapped.renderShell).toBe("self");
		expect(typeof wrapped.renderCall).toBe("function");
		expect(typeof wrapped.renderResult).toBe("function");
		expect(resolver!("edit", () => undefined)).toBeUndefined();
	});
});
