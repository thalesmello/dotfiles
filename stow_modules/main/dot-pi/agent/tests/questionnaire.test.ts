import { describe, expect, mock, test } from "bun:test";

mock.module("@earendil-works/pi-tui", () => ({
	CURSOR_MARKER: "",
	Editor: class {
		private text = "";
		onSubmit?: (value: string) => void;
		setText(value: string) {
			this.text = value;
		}
		getText() {
			return this.text;
		}
		handleInput(value: string) {
			this.text += value;
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
	visibleWidth: (text: string) => text.length,
	wrapTextWithAnsi: (text: string) => [text],
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
	formatEntryLabels,
	joinInlineText,
	optionMarker,
	parseContextEntry,
	parseCustomEntries,
} = await import("../extensions/questionnaire.ts");

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
});
