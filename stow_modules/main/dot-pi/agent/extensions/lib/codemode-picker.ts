export type CodemodeChoice = "on" | "off" | "only";
export interface CodemodePick {
	choice: CodemodeChoice;
	setDefault: boolean;
}

/** Small three-way chooser, with separate session and default actions. */
export function createCodemodePicker(current: CodemodeChoice, options: {
	matches: (data: string, action: "tui.select.up" | "tui.select.down" | "tui.select.confirm" | "tui.select.cancel") => boolean;
	isSaveKey: (data: string) => boolean;
	fg: (color: "accent" | "dim", text: string) => string;
	truncate: (text: string, width: number) => string;
	requestRender: () => void;
	done: (result: CodemodePick | undefined) => void;
}) {
	const choices: CodemodeChoice[] = ["on", "off", "only"];
	const descriptions = { on: "Optional codemode alongside direct tools", off: "Direct tools, no codemode", only: "Force tool access through codemode" };
	let index = choices.indexOf(current);
	let finished = false;
	const finish = (result: CodemodePick | undefined) => {
		finished = true;
		options.done(result);
	};
	return {
		render(width: number) {
			return [
				options.fg("accent", `Codemode — current: ${current}`),
				...choices.map((choice, i) => `${i === index ? ">" : " "} ${choice.padEnd(4)} ${descriptions[choice]}`),
				"",
				options.fg("dim", "↑/↓ move · Enter apply · Ctrl+S save default · Esc cancel"),
				options.fg("dim", "Saving a default leaves the current session unchanged."),
			].map((line) => options.truncate(line, width));
		},
		handleInput(data: string) {
			if (finished) return;
			if (options.isSaveKey(data)) {
				finish({ choice: choices[index], setDefault: true });
			} else if (options.matches(data, "tui.select.confirm")) {
				finish({ choice: choices[index], setDefault: false });
			} else if (options.matches(data, "tui.select.cancel")) {
				finish(undefined);
			} else if (options.matches(data, "tui.select.up")) {
				index = (index - 1 + choices.length) % choices.length;
				options.requestRender();
			} else if (options.matches(data, "tui.select.down")) {
				index = (index + 1) % choices.length;
				options.requestRender();
			}
		},
		invalidate() {},
	};
}
