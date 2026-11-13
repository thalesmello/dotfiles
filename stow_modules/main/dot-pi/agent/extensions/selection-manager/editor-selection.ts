import { decodeKittyPrintable, isKeyRelease, matchesKey, sliceByColumn, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

interface VisualLine { logicalLine: number; startCol: number; length: number }
interface MouseEvent {
	type: string;
	button: string;
	x: number;
	y: number;
	width: number;
	shift?: boolean;
	clickCount?: number;
}
interface Editor {
	state: { lines: string[]; cursorLine: number; cursorCol: number };
	getText(): string;
	handleInput(data: string): void;
	handleMouse?(event: MouseEvent): unknown;
	render(width: number): string[];
	setText(text: string): void;
	setCursorCol?(col: number): void;
	buildVisualLineMap?(width: number): VisualLine[];
	segment?(text: string, mode: "grapheme"): Iterable<{ segment: string; index: number }>;
	moveCursor?(line: number, col: number): void;
	moveWordBackwards?(): void;
	moveWordForwards?(): void;
	pushUndoSnapshot?(): void;
	cancelAutocomplete?(): void;
	exitHistoryBrowsing?(): void;
	normalizeText?(text: string): string;
	onChange?(text: string): void;
	lastAction?: unknown;
	lastWidth?: number;
	scrollOffset?: number;
	renderedVisibleLineCount?: number;
	getPaddingX?(): number;
}
interface Options {
	onFocus(): void;
	copyText(text: string): void;
	onReplace(): void;
	isReference(line: string): boolean;
	isSubmit(data: string): boolean;
}
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export type SelectionBoundary = "line-start" | "line-end" | "document-start" | "document-end";

/** Ghostty's Cmd+Left/Right aliases and explicit Cmd(+Shift)+Arrow sequences. */
export function parseBoundaryKey(data: string): { edge: SelectionBoundary; extend: boolean; release: boolean } | undefined {
	const directions = { left: "line-start", right: "line-end", up: "document-start", down: "document-end" } as const;
	for (const direction of ["left", "right", "up", "down"] as const) {
		const extend = matchesKey(data, `shift+super+${direction}`);
		if (extend || matchesKey(data, `super+${direction}`)) {
			return { edge: directions[direction], extend, release: isKeyRelease(data) };
		}
	}
	// Existing Ghostty mappings: super+left=text:\\x01, super+right=text:\\x05.
	if (matchesKey(data, "ctrl+a")) return { edge: "line-start", extend: false, release: isKeyRelease(data) };
	if (matchesKey(data, "ctrl+e")) return { edge: "line-end", extend: false, release: isKeyRelease(data) };
	return undefined;
}

/** Editable selection on one existing editor instance; compose with its actual methods. */
export function installEditorSelection(base: unknown, options: Options): unknown {
	const editor = base as Editor;
	const input = editor.handleInput.bind(editor);
	const mouse = editor.handleMouse?.bind(editor);
	const render = editor.render.bind(editor);
	const setText = editor.setText.bind(editor);
	let anchor: number | undefined;
	let focus: number | undefined;
	let selectedTextVersion = editor.getText();
	let dragging = false;
	let suppressClick = false;
	let paste: string | undefined;
	let bodyInset = 1;
	let contentStart = 0;
	let lastPress: { time: number; offset: number; count: number } | undefined;
	let mouseGranularity: "character" | "word" | "line" = "character";
	let initialRange: [number, number] | undefined;

	const segments = (text: string) => editor.segment?.(text, "grapheme") ?? graphemes.segment(text);
	const lineOffset = (line: number) => editor.state.lines.slice(0, line).reduce((n, text) => n + text.length + 1, 0);
	const cursor = () => lineOffset(editor.state.cursorLine) + editor.state.cursorCol;
	const moveTo = (offset: number) => {
		let remaining = Math.max(0, Math.min(editor.getText().length, offset));
		let line = 0;
		while (line < editor.state.lines.length - 1 && remaining > editor.state.lines[line]!.length) {
			remaining -= editor.state.lines[line]!.length + 1;
			line++;
		}
		editor.state.cursorLine = line;
		if (editor.setCursorCol) editor.setCursorCol(remaining);
		else editor.state.cursorCol = remaining;
	};
	const clear = () => { anchor = focus = undefined; dragging = false; suppressClick = false; initialRange = undefined; };
	const validate = () => {
		if (selectedTextVersion !== editor.getText()) clear();
		selectedTextVersion = editor.getText();
	};
	const bounds = (): [number, number] | undefined => anchor !== undefined && focus !== undefined && anchor !== focus
		? [Math.min(anchor, focus), Math.max(anchor, focus)] : undefined;
	const map = () => editor.buildVisualLineMap?.(editor.lastWidth ?? 80) ?? editor.state.lines.map((line, logicalLine) => ({ logicalLine, startCol: 0, length: line.length }));
	const rangeAt = (offset: number, granularity: typeof mouseGranularity): [number, number] => {
		const text = editor.getText();
		if (granularity === "line") {
			const start = text.lastIndexOf("\n", offset - 1) + 1;
			const end = text.indexOf("\n", offset);
			return [start, end < 0 ? text.length : end];
		}
		if (granularity === "word") {
			// Mouse words include paths/identifiers as one token, like the transcript.
			for (const match of text.matchAll(/[\p{L}\p{N}_./~+\\-]+|[^\p{L}\p{N}_./~+\\-]/gu)) {
				const start = match.index!;
				if (offset >= start && offset < start + match[0].length) return [start, start + match[0].length];
			}
		}
		return [offset, offset];
	};
	const pointer = (event: MouseEvent): number | undefined => {
		const lines = map();
		const visibleCount = editor.renderedVisibleLineCount ?? lines.length;
		const localRow = event.y - bodyInset;
		if (!dragging && (localRow < 0 || localRow >= visibleCount)) return undefined;
		const index = (editor.scrollOffset ?? 0) + Math.max(0, Math.min(visibleCount - 1, localRow));
		const visual = lines[index];
		if (!visual) return undefined;
		const chunk = editor.state.lines[visual.logicalLine]!.slice(visual.startCol, visual.startCol + visual.length);
		const target = Math.max(0, event.x - contentStart);
		let column = 0;
		let char = chunk.length;
		for (const segment of segments(chunk)) {
			if (target < column + visibleWidth(segment.segment)) { char = segment.index; break; }
			column += visibleWidth(segment.segment);
		}
		return lineOffset(visual.logicalLine) + visual.startCol + char;
	};
	const replace = (value: string) => {
		const range = bounds();
		if (!range) return;
		let [start, end] = range;
		// Reference blocks are atomic: selection replacement may remove a
		// block, but must never leave half of its stand-in in the editor.
		let offset = 0;
		for (const line of editor.state.lines) {
			if (options.isReference(line) && start < offset + line.length && end > offset) {
				start = Math.min(start, offset);
				end = Math.max(end, Math.min(editor.getText().length, offset + line.length + 1));
			}
			offset += line.length + 1;
		}
		const text = editor.getText();
		value = editor.normalizeText?.(value) ?? value.replace(/\r\n?/g, "\n");
		const next = text.slice(0, start) + value + text.slice(end);
		editor.cancelAutocomplete?.();
		// Snapshot BEFORE the combined deletion/insertion, so one undo
		// restores the entire previous text and paste-marker metadata.
		if (editor.pushUndoSnapshot) {
			editor.pushUndoSnapshot();
			editor.state.lines = next.split("\n");
		} else setText(next);
		moveTo(start + value.length);
		editor.lastAction = null;
		editor.exitHistoryBrowsing?.();
		clear();
		selectedTextVersion = next;
		if (editor.pushUndoSnapshot) editor.onChange?.(next);
		options.onReplace();
	};

	editor.setText = (text) => { clear(); paste = undefined; setText(text); selectedTextVersion = editor.getText(); };
	editor.handleInput = (data) => {
		validate();
		if (paste !== undefined) {
			paste += data;
			const end = paste.indexOf("\x1b[201~");
			if (end >= 0) {
				const value = paste.slice(0, end);
				const rest = paste.slice(end + 6);
				paste = undefined;
				replace(value);
				if (rest) input(rest);
			}
			return;
		}
		if (isKeyRelease(data)) return;
		options.onFocus();
		const boundary = parseBoundaryKey(data);
		if (boundary) {
			editor.cancelAutocomplete?.();
			if (boundary.extend) anchor ??= cursor();
			else clear();
			const offset = boundary.edge === "document-start" ? 0
				: boundary.edge === "document-end" ? editor.getText().length
				: lineOffset(editor.state.cursorLine) + (boundary.edge === "line-end" ? editor.state.lines[editor.state.cursorLine]!.length : 0);
			moveTo(offset);
			if (boundary.extend) focus = cursor();
			editor.exitHistoryBrowsing?.();
			selectedTextVersion = editor.getText();
			return;
		}
		for (const direction of ["left", "right", "up", "down"] as const) {
			const word = matchesKey(data, `shift+alt+${direction}`);
			if (!word && !matchesKey(data, `shift+${direction}`)) continue;
			editor.cancelAutocomplete?.();
			anchor ??= cursor();
			if (word && direction === "left" && editor.moveWordBackwards) editor.moveWordBackwards();
			else if (word && direction === "right" && editor.moveWordForwards) editor.moveWordForwards();
			else if (editor.moveCursor) editor.moveCursor(direction === "up" ? -1 : direction === "down" ? 1 : 0, direction === "left" ? -1 : direction === "right" ? 1 : 0);
			else input(`\x1b[${word && (direction === "left" || direction === "right") ? "1;3" : ""}${{ left: "D", right: "C", up: "A", down: "B" }[direction]}`);
			focus = cursor();
			selectedTextVersion = editor.getText();
			return;
		}
		const range = bounds();
		if (range) {
			if (matchesKey(data, "alt+w") || matchesKey(data, "super+c")) {
				options.copyText(editor.getText().slice(...range)); return;
			}
			if (matchesKey(data, "ctrl+x")) {
				options.copyText(editor.getText().slice(...range)); replace(""); return;
			}
			if (matchesKey(data, "backspace") || matchesKey(data, "delete")) { replace(""); return; }
			if (data.startsWith("\x1b[200~")) {
				paste = data.slice(6);
				const end = paste.indexOf("\x1b[201~");
				if (end >= 0) {
					const value = paste.slice(0, end);
					const rest = paste.slice(end + 6);
					paste = undefined;
					replace(value);
					if (rest) input(rest);
				}
				return;
			}
			if (!options.isSubmit(data) && (matchesKey(data, "shift+enter") || matchesKey(data, "alt+enter"))) { replace("\n"); return; }
			const printable = decodeKittyPrintable(data) ?? (/^[^\x00-\x1f\x7f]+$/u.test(data) ? data : undefined);
			if (printable !== undefined) { replace(printable); return; }
			for (const direction of ["left", "right", "up", "down"] as const) {
				if (!matchesKey(data, direction)) continue;
				if (direction === "left" || direction === "right") {
					moveTo(direction === "left" ? range[0] : range[1]); clear(); return;
				}
			}
		}
		clear();
		input(data);
		selectedTextVersion = editor.getText();
	};
	editor.handleMouse = (event) => {
		validate();
		if (event.button !== "left" && !(event.type === "release" && event.button === "none")) return mouse?.(event);
		if (event.type === "click" && (dragging || suppressClick)) {
			suppressClick = false;
			return { handled: true, focus: true };
		}
		if (!["press", "drag", "release", "click"].includes(event.type)) return mouse?.(event);
		const offset = pointer(event);
		if (offset === undefined) return mouse?.(event);
		options.onFocus();
		editor.cancelAutocomplete?.();
		if (event.type === "press") {
			suppressClick = false;
			const now = Date.now();
			const count = lastPress && now - lastPress.time <= 500 && lastPress.offset === offset ? lastPress.count % 3 + 1 : 1;
			lastPress = { time: now, offset, count };
			mouseGranularity = count === 3 ? "line" : count === 2 ? "word" : "character";
			initialRange = rangeAt(offset, mouseGranularity);
			if (!event.shift) { anchor = initialRange[0]; focus = initialRange[1]; }
			else { anchor ??= cursor(); focus = offset; }
			dragging = true;
		} else if (dragging) {
			if (lastPress && lastPress.offset !== offset) lastPress = undefined;
			const [start, end] = rangeAt(offset, mouseGranularity);
			if (initialRange && mouseGranularity !== "character") {
				anchor = start < initialRange[0] ? initialRange[1] : initialRange[0];
				focus = start < initialRange[0] ? start : end;
			} else focus = offset;
			if (event.type === "release") { dragging = false; suppressClick = true; }
		} else if (event.type === "click") {
			// Preserve click-only callers too; only a synthesized click after
			// our captured release is suppressed above.
			clear();
			if (mouse) return mouse(event);
			moveTo(offset);
			return { handled: true, focus: true, render: true };
		} else return mouse?.(event);
		moveTo(focus ?? offset);
		editor.exitHistoryBrowsing?.();
		selectedTextVersion = editor.getText();
		return { handled: true, focus: true, capture: event.type === "press", render: true };
	};
	editor.render = (width) => {
		validate();
		const lines = render(width);
		const visual = map();
		const count = editor.renderedVisibleLineCount ?? visual.length;
		bodyInset = editor.buildVisualLineMap ? 1 : 0;
		const first = stripTerminalSequences(lines[bodyInset] ?? "");
		const framed = /^│ /.test(first) && /^[╭┌]/.test(stripTerminalSequences(lines[0] ?? ""));
		contentStart = (framed ? 2 : 0) + Math.min(editor.getPaddingX?.() ?? 0, Math.max(0, Math.floor((width - 1) / 2)));
		const range = bounds();
		if (!range) return lines;
		const result = [...lines];
		for (let row = 0; row < count; row++) {
			const v = visual[(editor.scrollOffset ?? 0) + row];
			if (!v) continue;
			const start = lineOffset(v.logicalLine) + v.startCol;
			const from = Math.max(range[0], start);
			const to = Math.min(range[1], start + v.length);
			const lastChunk = visual[(editor.scrollOffset ?? 0) + row + 1]?.logicalLine !== v.logicalLine;
			const newlineSelected = lastChunk && v.logicalLine < editor.state.lines.length - 1 && range[0] <= start + v.length && range[1] > start + v.length;
			if (to <= from && !newlineSelected) continue;
			const logical = editor.state.lines[v.logicalLine]!;
			const col = contentStart + visibleWidth(logical.slice(v.startCol, v.startCol + from - start));
			const size = visibleWidth(logical.slice(v.startCol + from - start, v.startCol + to - start)) + (newlineSelected ? 1 : 0);
			const index = row + bodyInset;
			const line = result[index] ?? "";
			const before = sliceByColumn(line, 0, col, true);
			const selected = sliceByColumn(line, col, size, true).replace(/(\x1b\[[0-9;]*m)/g, "$1\x1b[7m");
			const after = sliceByColumn(line, col + size, Math.max(0, visibleWidth(line) - col - size), true);
			result[index] = `${before}\x1b[7m${selected}\x1b[27m${after}`;
		}
		return result;
	};
	return base;
}
