import { describe, expect, mock, test } from "bun:test";

const STYLE_TAG_RE = /\[\/?[a-z]{2,}\]|<CURSOR>/g;

function stripTestStyleTags(text: string): string {
	return text.replace(STYLE_TAG_RE, "");
}

function visibleWidthWithStyleTags(text: string): number {
	return stripTestStyleTags(text).length;
}

function wrapTextWithStyleTags(text: string, width: number): string[] {
	const maxWidth = Math.max(1, width);
	return text.split(/\r?\n/).flatMap((paragraph) => {
		if (!paragraph || visibleWidthWithStyleTags(paragraph) <= maxWidth) {
			return [paragraph];
		}
		const tokens = paragraph.match(/\S+|\s+/g) ?? [paragraph];
		const lines: string[] = [];
		let current = "";
		let currentWidth = 0;

		for (const token of tokens) {
			const isSpace = /^\s+$/.test(stripTestStyleTags(token));
			const tokenWidth = visibleWidthWithStyleTags(token);
			if (isSpace) {
				if (currentWidth === 0) continue;
				if (currentWidth + tokenWidth <= maxWidth) {
					current += token;
					currentWidth += tokenWidth;
				} else {
					lines.push(current.trimEnd());
					current = "";
					currentWidth = 0;
				}
				continue;
			}
			if (currentWidth > 0 && currentWidth + tokenWidth > maxWidth) {
				lines.push(current.trimEnd());
				current = "";
				currentWidth = 0;
			}
			if (tokenWidth <= maxWidth) {
				current += token;
				currentWidth += tokenWidth;
				continue;
			}
			const plain = stripTestStyleTags(token);
			for (let i = 0; i < plain.length; i += maxWidth) {
				const slice = plain.slice(i, i + maxWidth);
				if (i + maxWidth < plain.length) {
					lines.push(slice);
				} else {
					current = slice;
					currentWidth = slice.length;
				}
			}
		}

		if (currentWidth > 0 || lines.length === 0) {
			lines.push(current.trimEnd());
		}
		return lines;
	});
}

mock.module("@earendil-works/pi-tui", () => ({
	CURSOR_MARKER: "<CURSOR>",
	Editor: class {
		private text = "";
		private cursorCol = 0;
		onSubmit?: (value: string) => void;
		setText(value: string) {
			this.text = value;
			this.cursorCol = value.length;
		}
		getText() {
			return this.text;
		}
		getLines() {
			return [this.text];
		}
		getCursor() {
			return { line: 0, col: this.cursorCol };
		}
		handleInput(value: string) {
			// Mirror the real Editor: Enter submits, navigation moves cursor, other input inserts at cursor.
			if (value === "enter") {
				this.onSubmit?.(this.text);
				return;
			}
			if (value === "left") {
				this.cursorCol = Math.max(0, this.cursorCol - 1);
				return;
			}
			if (value === "right") {
				this.cursorCol = Math.min(this.text.length, this.cursorCol + 1);
				return;
			}
			if (value === "word-left") {
				while (this.cursorCol > 0 && this.text[this.cursorCol - 1] === " ") {
					this.cursorCol--;
				}
				while (this.cursorCol > 0 && this.text[this.cursorCol - 1] !== " ") {
					this.cursorCol--;
				}
				return;
			}
			if (value === "backspace") {
				if (this.cursorCol > 0) {
					this.text = this.text.slice(0, this.cursorCol - 1) + this.text.slice(this.cursorCol);
					this.cursorCol--;
				}
				return;
			}
			this.text = this.text.slice(0, this.cursorCol) + value + this.text.slice(this.cursorCol);
			this.cursorCol += value.length;
		}
		render() {
			return [this.text];
		}
	},
	Key: {
		down: "down",
		enter: "enter",
		escape: "escape",
		left: "left",
		right: "right",
		space: "space",
		tab: "tab",
		up: "up",
		shift: (key: string) => `shift+${key}`,
	},
	Text: class {
		constructor(
			readonly text: string,
			readonly x: number,
			readonly y: number,
		) {}
	},
	matchesKey: (data: string, key: string) => data === key,
	truncateToWidth: (text: string) => text,
	visibleWidth: visibleWidthWithStyleTags,
	wrapTextWithAnsi: wrapTextWithStyleTags,
	SettingsList: class {},
}));

mock.module("typebox", () => ({
	Type: {
		Array: (items: unknown, options?: unknown) => ({ type: "array", items, options }),
		Boolean: (options?: unknown) => ({ type: "boolean", options }),
		Object: (properties: unknown, options?: unknown) => ({ type: "object", properties, options }),
		Optional: (schema: unknown) => ({ ...schema, optional: true }),
		String: (options?: unknown) => ({ type: "string", options }),
	},
}));

const {
	formatAnswerEntriesForText,
	formatEditorCursorText,
	formatEntryLabels,
	joinInlineText,
	optionMarker,
	parseContextEntry,
	parseCustomEntries,
} = await import("../extensions/questionnaire.ts");
const questionnaire = (await import("../extensions/questionnaire.ts")).default;

type AnswerEntry = Parameters<typeof formatEntryLabels>[0][number];

describe("questionnaire helpers", () => {
	test("joins inline text directly onto the selected option label", () => {
		expect(joinInlineText("Broad", ["with tests"])).toBe("Broad with tests");
		expect(joinInlineText("Broad", ["", " with tests "])).toBe("Broad with tests");
	});

	test("formats radio answers with inline text as one selected answer", () => {
		const entries: AnswerEntry[] = [
			{
				value: "broad with tests",
				label: "Broad with tests",
				wasCustom: false,
				kind: "option",
				index: 3,
			},
		];

		expect(formatAnswerEntriesForText(entries)).toBe("user selected: 3. Broad with tests");
	});

	test("keeps legacy context formatting inline instead of adding punctuation", () => {
		const entries: AnswerEntry[] = [
			{
				value: "broad",
				label: "Broad",
				wasCustom: false,
				kind: "option",
				index: 3,
			},
			{
				value: "with tests",
				label: "with tests",
				wasCustom: true,
				kind: "context",
			},
		];

		expect(formatEntryLabels(entries)).toBe("Broad with tests");
		expect(formatAnswerEntriesForText(entries)).toBe("user selected: 3. Broad with tests");
	});

	test("only active radio questions use the selected radio marker", () => {
		expect(optionMarker(false, true, true)).toBe("●");
		expect(optionMarker(false, false, true)).toBe("✓");
		expect(optionMarker(false, true, false)).toBe("○");
		expect(optionMarker(false, false, false)).toBe(" ");
	});

	test("multiple choice markers remain checkboxes", () => {
		expect(optionMarker(true, true, true)).toBe("[x]");
		expect(optionMarker(true, false, true)).toBe("[x]");
		expect(optionMarker(true, true, false)).toBe("[ ]");
		expect(optionMarker(true, false, false)).toBe("[ ]");
	});

	test("parses typed entries", () => {
		expect(parseCustomEntries("one, two\nthree")).toEqual(["one", "two", "three"]);
		expect(parseCustomEntries("   ")).toEqual(["(no response)"]);
		expect(parseContextEntry(" with tests ")).toEqual(["with tests"]);
		expect(parseContextEntry("   ")).toEqual([]);
	});

	test("formats editor text with cursor at the active character or end of line", () => {
		const inv = (text: string) => `[inv]${text}[/inv]`;
		expect(
			formatEditorCursorText(
				{
					getText: () => "with old tests",
					getLines: () => ["with old tests"],
					getCursor: () => ({ line: 0, col: 5 }),
				},
				inv,
			),
		).toBe("with <CURSOR>[inv]o[/inv]ld tests");
		expect(
			formatEditorCursorText(
				{
					getText: () => "with old tests",
					getLines: () => ["with old tests"],
					getCursor: () => ({ line: 0, col: 14 }),
				},
				inv,
			),
		).toBe("with old tests<CURSOR>[inv] [/inv]");
	});
});

describe("questionnaire multiple-choice inline context", () => {
	function createHarness(questions: unknown[]) {
		let tool: any;
		let component: any;
		let submitted: any;
		const pi: any = {
			registerTool(captured: any) {
				tool = captured;
			},
			events: { emit() {} },
		};
		questionnaire(pi);
		const theme: any = {
			// Encode the style so render tests can tell which lines are highlighted.
			fg: (style: string, text: string) => `[${style}]${text}[/${style}]`,
			bg: (_style: string, text: string) => text,
			bold: (text: string) => text,
			inverse: (text: string) => `[inv]${text}[/inv]`,
		};
		const tui: any = { requestRender() {}, terminal: { rows: 50 } };
		const ctx: any = {
			mode: "tui",
			ui: {
				custom: (factory: any) =>
					new Promise((resolve) => {
						component = factory(tui, theme, {}, (result: any) => {
							submitted = result;
							resolve(result);
						});
					}),
			},
		};
		const resultPromise = tool.execute("call", { questions }, undefined, undefined, ctx);
		return {
			resultPromise,
			input: (data: string) => component.handleInput(data),
			mouse: (event: {
				type?: string;
				button?: string;
				x?: number;
				y?: number;
				width?: number;
				height?: number;
				wheelDelta?: number;
				clickCount?: number;
			}) => component.handleMouse?.(event),
			render: (width = 80) => component.render(width) as string[],
			setRows: (rows: number) => {
				tui.terminal.rows = rows;
			},
			getSubmitted: () => submitted,
		};
	}

	const options = [
		{ value: "a", label: "A" },
		{ value: "b", label: "B" },
	];

	test("Enter and Tab accept context without submitting, so another option can be selected", async () => {
		const harness = createHarness([{ id: "q1", prompt: "Pick", options, multiple: true }]);

		// Tab opens inline context on A; Enter accepts the text.
		harness.input("tab");
		harness.input(" with tests");
		harness.input("enter");
		expect(harness.getSubmitted()).toBeUndefined();

		// Tab again reopens the full accepted text for editing: accepting it
		// replaces it instead of appending a duplicate fragment.
		harness.input("tab");
		harness.input(" updated");
		harness.input("enter");
		expect(harness.getSubmitted()).toBeUndefined();

		// Select B as well, add context, and accept it with Tab.
		harness.input("down");
		harness.input("space");
		harness.input("tab");
		harness.input(" for speed");
		harness.input("tab");
		expect(harness.getSubmitted()).toBeUndefined();

		// Enter outside input mode confirms the multiple-choice question.
		harness.input("enter");
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(false);
		expect(result.details.answers[0].entries.map((entry: any) => entry.label)).toEqual([
			"A with tests updated",
			"B for speed",
		]);
	});

	test("reopening Type something edits the full set of custom entries", async () => {
		const harness = createHarness([{ id: "q1", prompt: "Pick", options, multiple: true }]);

		harness.input("down");
		harness.input("down");
		harness.input("tab");
		harness.input("custom one");
		harness.input("enter");
		expect(harness.getSubmitted()).toBeUndefined();

		// Reopened editor holds "custom one"; extending it replaces the set
		// instead of appending duplicate entries.
		harness.input("tab");
		harness.input(", custom two");
		harness.input("enter");
		expect(harness.getSubmitted()).toBeUndefined();

		harness.input("up");
		harness.input("enter");
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(false);
		expect(result.details.answers[0].entries.map((entry: any) => entry.label)).toEqual(["custom one", "custom two"]);
	});

	test("accepting context returns to the option list on a single-select question too", async () => {
		const harness = createHarness([{ id: "q1", prompt: "Pick", options, multiple: false }]);

		harness.input("tab");
		harness.input(" with tests");
		harness.input("enter");
		expect(harness.getSubmitted()).toBeUndefined();

		// Enter outside editing mode confirms the question.
		harness.input("enter");
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(false);
		expect(result.details.answers[0].entries.map((entry: any) => entry.label)).toEqual(["A with tests"]);
	});

	test("Enter on Type something never enters editing; it only confirms an existing answer", async () => {
		const harness = createHarness([{ id: "q1", prompt: "Pick", options, multiple: true }]);

		// No answer yet: typing and Enter on "Type something." do nothing
		// (only Tab enters editing mode).
		harness.input("down");
		harness.input("down");
		harness.input("x");
		harness.input("enter");
		expect(harness.getSubmitted()).toBeUndefined();

		// Tab enters editing; Enter accepts and returns to the option list.
		harness.input("tab");
		harness.input("custom one");
		harness.input("enter");
		expect(harness.getSubmitted()).toBeUndefined();

		// Enter on "Type something." now confirms this question.
		harness.input("enter");
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(false);
		expect(result.details.answers[0].entries.map((entry: any) => entry.label)).toEqual(["custom one"]);
	});

	test("Tab editing a regular option highlights only that option, not Type something", async () => {
		const harness = createHarness([{ id: "q1", prompt: "Pick", options, multiple: false }]);

		// Tab adds inline text to the selected option (A).
		harness.input("tab");
		const lines = harness.render();
		const optionLine = lines.find((line) => line.includes("1. A"));
		const otherLine = lines.find((line) => line.includes("Type something"));
		expect(optionLine).toContain("[accent]");
		expect(otherLine).not.toContain("[accent]");
		expect(otherLine).not.toContain("✎");

		// Esc leaves input mode; Esc, Esc cancels the questionnaire.
		harness.input("escape");
		harness.input("escape");
		harness.input("escape");
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(true);
	});

	test("Tab editing Type something highlights only Type something", async () => {
		const harness = createHarness([{ id: "q1", prompt: "Pick", options, multiple: false }]);

		harness.input("down");
		harness.input("down");
		harness.input("tab");
		const lines = harness.render();
		const optionLine = lines.find((line) => line.includes("1. A"));
		const otherLine = lines.find((line) => line.includes("Type something"));
		expect(otherLine).toContain("[accent]");
		expect(otherLine).toContain("✎");
		expect(optionLine).not.toContain("[accent]");

		harness.input("escape");
		harness.input("escape");
		harness.input("escape");
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(true);
	});

	test("Enter on Type something confirms an existing custom answer on a single-select question", async () => {
		const harness = createHarness([{ id: "q1", prompt: "Pick", options, multiple: false }]);

		harness.input("down");
		harness.input("down");
		harness.input("enter");
		expect(harness.getSubmitted()).toBeUndefined();

		harness.input("tab");
		harness.input("custom one");
		harness.input("enter");
		expect(harness.getSubmitted()).toBeUndefined();

		harness.input("enter");
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(false);
		expect(result.details.answers[0].entries.map((entry: any) => entry.label)).toEqual(["custom one"]);
	});

	test("navigating back to a previous word shows the cursor at that word and previews live edits in place", async () => {
		const harness = createHarness([{ id: "q1", prompt: "Pick", options, multiple: false }]);

		harness.input("tab");
		harness.input("with old tests");

		// At the end of input, cursor sits on the trailing space.
		let optionLine = harness.render().find((line) => line.includes("1. A"));
		expect(optionLine).toContain("1. A with old tests<CURSOR>[inv] [/inv]");

		// Navigate back two words to "old": cursor highlights "o" in "old".
		harness.input("word-left");
		optionLine = harness.render().find((line) => line.includes("1. A"));
		expect(optionLine).toContain("1. A with old <CURSOR>[inv]t[/inv]ests");

		harness.input("word-left");
		optionLine = harness.render().find((line) => line.includes("1. A"));
		expect(optionLine).toContain("1. A with <CURSOR>[inv]o[/inv]ld tests");

		// Insert "very " before "old" and watch the live preview update in place.
		harness.input("very ");
		optionLine = harness.render().find((line) => line.includes("1. A"));
		expect(optionLine).toContain("1. A with very <CURSOR>[inv]o[/inv]ld tests");

		// Accept with Tab, then reopen with Tab: preview must not duplicate saved context.
		harness.input("tab");
		optionLine = harness.render().find((line) => line.includes("1. A"));
		expect(optionLine).toContain("1. A with very old tests");

		harness.input("tab");
		optionLine = harness.render().find((line) => line.includes("1. A"));
		expect(optionLine).toContain("1. A with very old tests<CURSOR>[inv] [/inv]");
		expect(optionLine).not.toContain("with very old tests with very old tests");

		harness.input("enter");
		harness.input("enter");
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(false);
		expect(result.details.answers[0].entries.map((entry: any) => entry.label)).toEqual(["A with very old tests"]);
	});

	test("wraps long questions onto continuation lines and re-wraps when terminal width narrows", async () => {
		const longPrompt = "Where should Cmd+Up / Cmd+Down jump to the top/bottom of history?";
		const harness = createHarness([{ id: "target", label: "Target", prompt: longPrompt, options, multiple: false }]);

		// 1. First render on a wide terminal (127 columns): question fits on a single line.
		const wideLines = harness.render(127).map(stripTestStyleTags);
		expect(wideLines).toContain(`> ${longPrompt}`);
		for (const line of wideLines) {
			expect(line.length).toBeLessThanOrEqual(127);
		}

		// 2. Terminal narrows to 63 columns (e.g. a 50/50 split pane) without an intermediate keypress.
		// Previously cachedLines was returned unchanged, causing the terminal to clip "history?" mid-word ("hist").
		const narrowLines = harness.render(63).map(stripTestStyleTags);
		for (const line of narrowLines) {
			expect(line.length).toBeLessThanOrEqual(63);
		}
		expect(narrowLines).toContain("> Where should Cmd+Up / Cmd+Down jump to the top/bottom of");
		expect(narrowLines).toContain("  history?");

		harness.input("escape");
		harness.input("escape");
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(true);
	});

	test("re-renders when terminal row count changes and keeps wrapped question prompt visible on first option", async () => {
		const longPrompt =
			"Does typing flicker while Pi is idle, or only while the agent is producing output in the terminal?";
		const manyOptions = Array.from({ length: 8 }, (_, idx) => ({
			value: `opt_${idx + 1}`,
			label: `Option ${idx + 1}`,
			description: `Description for option ${idx + 1}`,
		}));
		const harness = createHarness([{ id: "q1", label: "When", prompt: longPrompt, options: manyOptions }]);

		// Initial render at 50 rows shows the full form.
		const fullLines = harness.render(45).map(stripTestStyleTags);
		expect(fullLines.length).toBeGreaterThan(20);

		// Shrink terminal rows to 20 (viewportHeight = 12): cache must invalidate and slice to 12 rows,
		// while keeping all 3 wrapped question prompt lines visible above Option 1 even after scrolling down and back up.
		harness.setRows(20);
		for (let i = 0; i < 5; i++) harness.input("down");
		for (let i = 0; i < 5; i++) harness.input("up");
		const compactLines = harness.render(45).map(stripTestStyleTags);
		expect(compactLines.length).toBe(12);
		expect(compactLines).toContain("> Does typing flicker while Pi is idle, or");
		expect(compactLines).toContain("  only while the agent is producing output in");
		expect(compactLines).toContain("  the terminal?");
		expect(compactLines.some((line) => line.includes("1. Option 1"))).toBe(true);

		harness.input("escape");
		harness.input("escape");
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(true);
	});

	test("gradually collapses to 3 content lines on history scroll up, expands gradually on scroll down, and immediately expands on Up/Down keys", async () => {
		const manyOptions = Array.from({ length: 8 }, (_, idx) => ({
			value: `opt_${idx + 1}`,
			label: `Option ${idx + 1}`,
			description: `Description for option ${idx + 1}`,
		}));
		const harness = createHarness([{ id: "q1", label: "Q1", prompt: "Choose an option", options: manyOptions }]);
		const store = (globalThis as Record<symbol, { collapseLines: number }>)[Symbol.for("pi.scroll-collapse")]!;

		const fullLines = harness.render(80).map(stripTestStyleTags);
		const fullHeight = fullLines.length;
		expect(fullHeight).toBeGreaterThan(15);

		// Simulate gradual history scroll up by 4 lines: questionnaire shrinks by 4 lines.
		store.collapseLines = 4;
		const partialCollapsed = harness.render(80).map(stripTestStyleTags);
		expect(partialCollapsed.length).toBe(fullHeight - 4);

		// Simulate large history scroll up (e.g. PageUp): clamps at 3 content lines + 2 border/indicator lines = 5 rows total.
		store.collapseLines = 100;
		const fullyCollapsed = harness.render(80).map(stripTestStyleTags);
		expect(fullyCollapsed.length).toBe(5);
		expect(fullyCollapsed.slice(1, 4).some((line) => line.includes("1. Option 1"))).toBe(true);

		// Simulate gradual history scroll down by 3 lines from maxCollapseLines: expands by 3 lines (5 -> 8 rows).
		const maxCollapse = fullHeight - 5;
		store.collapseLines = maxCollapse - 3;
		const partialExpanded = harness.render(80).map(stripTestStyleTags);
		expect(partialExpanded.length).toBe(8);

		// Any Up/Down keyboard input immediately expands the whole questionnaire back to full height.
		harness.input("down");
		expect(store.collapseLines).toBe(0);
		const expandedLines = harness.render(80).map(stripTestStyleTags);
		expect(expandedLines.length).toBe(fullHeight);
		expect(expandedLines.some((line) => line.includes("> ○ 2. Option 2"))).toBe(true);

		harness.input("escape");
		harness.input("escape");
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(true);
	});

	test("mouse wheel on top of questionnaire scrolls the questionnaire and consumes the event", async () => {
		const manyOptions = Array.from({ length: 12 }, (_, idx) => ({
			value: `opt_${idx + 1}`,
			label: `Option ${idx + 1}`,
			description: `Description for option ${idx + 1}`,
		}));
		const harness = createHarness([{ id: "q1", label: "Q1", prompt: "Choose an option", options: manyOptions }]);
		harness.setRows(20); // viewportHeight = 12

		const initialLines = harness.render(80).map(stripTestStyleTags);
		expect(initialLines.length).toBe(12);
		expect(initialLines.some((line) => line.includes("1. Option 1"))).toBe(true);
		expect(initialLines[11]).toMatch(/^↓ \d+ more$/);

		// Scroll down with mouse wheel on top of questionnaire.
		const wheelDown = harness.mouse({ type: "wheel", wheelDelta: 6 });
		expect(wheelDown).toEqual({ handled: true, render: true });
		const scrolledLines = harness.render(80).map(stripTestStyleTags);
		expect(scrolledLines.length).toBe(12);
		expect(scrolledLines[0]).toBe("↑ 6 more");
		expect(scrolledLines.some((line) => line.includes("1. Option 1"))).toBe(false);

		// Subsequent keyboard navigation returns viewport focus to the active option.
		harness.input("down");
		const afterKeyLines = harness.render(80).map(stripTestStyleTags);
		expect(afterKeyLines.some((line) => line.includes("> ○ 2. Option 2"))).toBe(true);

		harness.input("escape");
		harness.input("escape");
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(true);
	});

	test("mouse clicking an option (or its description) selects and submits a single-select question", async () => {
		const optionsWithDescriptions = [
			{ value: "alpha", label: "Alpha", description: "First description" },
			{ value: "beta", label: "Beta", description: "Second description" },
		];
		const harness = createHarness([{ id: "q1", prompt: "Pick one", options: optionsWithDescriptions }]);
		const lines = harness.render(80).map(stripTestStyleTags);
		const betaDescriptionRow = lines.findIndex((line) => line.includes("Second description"));
		expect(betaDescriptionRow).toBeGreaterThan(0);

		// Simulate Pi TUI's press -> release -> click sequence on Beta's description line.
		// Never return focus: true, because done() runs synchronously during release/click
		// and restores focus to the main editor before TuiAltScreen.applyMouseDispatchResult runs;
		// returning focus: true would re-focus the disposed questionnaire component and freeze input.
		const pressResult = harness.mouse({ type: "press", button: "left", x: 6, y: betaDescriptionRow });
		expect(pressResult).toEqual({
			handled: true,
			render: true,
		});
		expect((pressResult as any)?.focus).toBeUndefined();

		const releaseResult = harness.mouse({ type: "release", button: "left", x: 6, y: betaDescriptionRow });
		expect(releaseResult).toEqual({
			handled: true,
			render: true,
		});
		expect((releaseResult as any)?.focus).toBeUndefined();

		const clickResult = harness.mouse({ type: "click", button: "left", x: 6, y: betaDescriptionRow });
		expect(clickResult).toEqual({
			handled: true,
			render: false,
		});
		expect((clickResult as any)?.focus).toBeUndefined();

		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(false);
		expect(result.details.answers).toHaveLength(1);
		expect(result.details.answers[0].value).toBe("beta");
		expect(result.details.answers[0].label).toBe("Beta");
	});

	test("mouse clicking toggles checkboxes on a multiple-choice question and submits when clicking Submit answers", async () => {
		const threeOptions = [
			{ value: "a", label: "Option A" },
			{ value: "b", label: "Option B" },
			{ value: "c", label: "Option C" },
		];
		const harness = createHarness([{ id: "q1", prompt: "Pick multiple", options: threeOptions, multiple: true }]);
		let lines = harness.render(80).map(stripTestStyleTags);
		const rowA = lines.findIndex((line) => line.includes("Option A"));
		const rowB = lines.findIndex((line) => line.includes("Option B"));
		const rowC = lines.findIndex((line) => line.includes("Option C"));
		const submitRow = lines.findIndex((line) => line.includes("✓ Submit answers"));
		expect(rowA).toBeGreaterThan(0);
		expect(rowB).toBeGreaterThan(rowA);
		expect(rowC).toBeGreaterThan(rowB);
		expect(submitRow).toBeGreaterThan(rowC);

		// Clicking Submit before any option is selected does not submit.
		harness.mouse({ type: "click", button: "left", x: 4, y: submitRow });
		expect(harness.getSubmitted()).toBeUndefined();

		// Click A and C to check them, click A again to uncheck, then click B.
		harness.mouse({ type: "click", button: "left", x: 4, y: rowA });
		harness.mouse({ type: "click", button: "left", x: 4, y: rowC });
		lines = harness.render(80).map(stripTestStyleTags);
		expect(lines[rowA]).toContain("[x] Option A");
		expect(lines[rowC]).toContain("[x] Option C");

		harness.mouse({ type: "click", button: "left", x: 4, y: rowA });
		harness.mouse({ type: "click", button: "left", x: 4, y: rowB });
		lines = harness.render(80).map(stripTestStyleTags);
		expect(lines[rowA]).toContain("[ ] Option A");
		expect(lines[rowB]).toContain("[x] Option B");
		expect(lines[rowC]).toContain("[x] Option C");

		// Click Submit answers.
		harness.mouse({ type: "click", button: "left", x: 4, y: submitRow });
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(false);
		expect(result.details.answers[0].entries.map((entry: any) => entry.label)).toEqual(["Option B", "Option C"]);
	});

	test("mouse clicking answers multiple questions and submits on clicking Submit answers", async () => {
		const harness = createHarness([
			{
				id: "scope",
				label: "Scope",
				prompt: "Which scope?",
				options: [
					{ value: "local", label: "Local" },
					{ value: "global", label: "Global" },
				],
			},
			{
				id: "checks",
				label: "Checks",
				prompt: "Which checks?",
				options: [
					{ value: "unit", label: "Unit" },
					{ value: "lint", label: "Lint" },
				],
				multiple: true,
			},
		]);

		let lines = harness.render(80).map(stripTestStyleTags);
		const globalRow = lines.findIndex((line) => line.includes("2. Global"));
		const unitRow = lines.findIndex((line) => line.includes("[ ] Unit"));
		const lintRow = lines.findIndex((line) => line.includes("[ ] Lint"));
		const submitRow = lines.findIndex((line) => line.includes("✓ Submit answers"));

		// Click Global on Q1 -> Q1 answered, advances focus to Q2 without submitting yet.
		harness.mouse({ type: "click", button: "left", x: 4, y: globalRow });
		expect(harness.getSubmitted()).toBeUndefined();
		lines = harness.render(80).map(stripTestStyleTags);
		expect(lines.some((line) => line.includes("Scope: Which scope? ✓"))).toBe(true);

		// Click Unit and Lint on Q2.
		harness.mouse({ type: "click", button: "left", x: 4, y: unitRow });
		harness.mouse({ type: "click", button: "left", x: 4, y: lintRow });
		expect(harness.getSubmitted()).toBeUndefined();

		// Click Submit answers.
		harness.mouse({ type: "click", button: "left", x: 4, y: submitRow });
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(false);
		expect(result.details.answers.map((a: any) => ({ id: a.id, value: a.value }))).toEqual([
			{ id: "scope", value: "global" },
			{ id: "checks", value: "unit, lint" },
		]);
	});

	test("mouse clicking Type something opens custom input and clicking another option cancels empty input", async () => {
		const harness = createHarness([{ id: "q1", prompt: "Pick", options, multiple: false }]);
		let lines = harness.render(80).map(stripTestStyleTags);
		const otherRow = lines.findIndex((line) => line.includes("Type something."));
		const rowA = lines.findIndex((line) => line.includes("1. A"));

		// Click "Type something." to enter inline editing mode.
		harness.mouse({ type: "click", button: "left", x: 4, y: otherRow });
		lines = harness.render(80).map(stripTestStyleTags);
		expect(lines[otherRow]).toContain("✎");

		// Clicking Option A while custom input is still empty cancels input mode and selects Option A.
		harness.mouse({ type: "click", button: "left", x: 4, y: rowA });
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(false);
		expect(result.details.answers[0].value).toBe("a");
	});

	test("mouse clicking scrolled questionnaire selects the visible option at the scrolled offset", async () => {
		const manyOptions = Array.from({ length: 10 }, (_, idx) => ({
			value: `opt_${idx + 1}`,
			label: `Option ${idx + 1}`,
		}));
		const harness = createHarness([{ id: "q1", label: "Q1", prompt: "Choose an option", options: manyOptions }]);
		harness.setRows(16); // viewportHeight = 8

		harness.render(80);
		harness.mouse({ type: "wheel", wheelDelta: 5 });
		const scrolledLines = harness.render(80).map(stripTestStyleTags);
		expect(scrolledLines[0]).toBe("↑ 5 more");

		const option8Row = scrolledLines.findIndex((line) => line.includes("8. Option 8"));
		expect(option8Row).toBeGreaterThan(0);

		harness.mouse({ type: "click", button: "left", x: 4, y: option8Row });
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(false);
		expect(result.details.answers[0].value).toBe("opt_8");
	});

	test("pressing on one option and releasing on a different option cancels the click", async () => {
		const harness = createHarness([{ id: "q1", prompt: "Pick", options, multiple: false }]);
		const lines = harness.render(80).map(stripTestStyleTags);
		const rowA = lines.findIndex((line) => line.includes("1. A"));
		const rowB = lines.findIndex((line) => line.includes("2. B"));

		harness.mouse({ type: "press", button: "left", x: 4, y: rowA });
		harness.mouse({ type: "drag", button: "left", x: 4, y: rowB });
		harness.mouse({ type: "release", button: "left", x: 4, y: rowB });
		expect(harness.getSubmitted()).toBeUndefined();

		harness.input("escape");
		harness.input("escape");
		const result = await harness.resultPromise;
		expect(result.details.cancelled).toBe(true);
	});
});
