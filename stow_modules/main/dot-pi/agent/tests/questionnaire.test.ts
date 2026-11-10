import { describe, expect, mock, test } from "bun:test";

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
	visibleWidth: (text: string) => text.length,
	wrapTextWithAnsi: (text: string) => [text],
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
			render: (width = 80) => component.render(width) as string[],
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
});
