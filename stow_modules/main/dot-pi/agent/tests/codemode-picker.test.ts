import { describe, expect, test } from "bun:test";
import { createCodemodePicker, type CodemodeChoice, type CodemodePick } from "../extensions/lib/codemode-picker.ts";

function picker(current: CodemodeChoice = "on") {
	const results: (CodemodePick | undefined)[] = [];
	let renders = 0;
	const component = createCodemodePicker(current, {
		matches: (data, action) => data === action.split(".").at(-1),
		isSaveKey: (data) => data === "ctrl+s",
		fg: (_color, text) => text,
		truncate: (text, width) => text.slice(0, width),
		requestRender: () => { renders++; },
		done: (value) => { results.push(value); },
	});
	return { component, results, renders: () => renders };
}

describe("codemode picker", () => {
	test("Ctrl+S saves the highlighted choice, not the initial choice", () => {
		const h = picker();
		h.component.handleInput("down");
		h.component.handleInput("down");
		h.component.handleInput("ctrl+s");
		expect(h.results).toEqual([{ choice: "only", setDefault: true }]);
		expect(h.renders()).toBe(2);
	});
	test("Enter applies the current choice instead of saving defaults", () => {
		const h = picker("only");
		h.component.handleInput("confirm");
		expect(h.results).toEqual([{ choice: "only", setDefault: false }]);
	});
	test("Escape cancels and navigation wraps", () => {
		const h = picker();
		h.component.handleInput("up");
		expect(h.component.render(120).some((line) => line.startsWith("> only"))).toBe(true);
		h.component.handleInput("cancel");
		expect(h.results).toEqual([undefined]);
	});
	test("completion is delivered only once", () => {
		const h = picker("off");
		h.component.handleInput("ctrl+s");
		h.component.handleInput("confirm");
		expect(h.results).toEqual([{ choice: "off", setDefault: true }]);
	});
	test("renders save-default hint and respects narrow widths", () => {
		const h = picker();
		expect(h.component.render(120).join("\n")).toContain("Ctrl+S save default");
		expect(h.component.render(120).join("\n")).toContain("current session unchanged");
		for (const width of [0, 1, 15, 40]) {
			expect(h.component.render(width).every((line) => line.length <= width)).toBe(true);
		}
	});
});
