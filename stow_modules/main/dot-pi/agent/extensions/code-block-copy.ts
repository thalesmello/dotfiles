/**
 * code-block-copy.ts -- syntax-highlighted code blocks with a copy button.
 *
 * What this does
 * --------------
 * Pi's built-in Markdown renderer already syntax-highlights fenced code
 * blocks when the Markdown theme provides `highlightCode` (the built-in
 * theme does). This extension keeps that rendering, and when a theme does
 * not provide a highlighter it supplies pi's own `highlightCode` so code
 * blocks stay highlighted either way. Each block (fences and code) is
 * also painted on a distinguished background panel -- a
 * dark grey on dark themes, a light grey on light themes, chosen by
 * probing the luminance of the theme's own code colour -- so a block
 * reads as one panel against the surrounding text.
 *
 * After the closing fence of every non-empty fenced code block it renders
 * one extra line:
 *
 *     a filled chip with an accent-coloured background:  "  ⧉ Copy  "
 *
 * Clicking that label (fullscreen mode) copies the block's exact original
 * contents -- not the highlighted, wrapped, or padded rendering -- to the
 * clipboard and shows pi's "Copied!" flash.
 *
 * The button is not selectable:
 * - Text copied from a drag selection never contains the button line. A
 *   selection that covers only the button copies nothing.
 * - While a selection covers the button, its glyphs are blanked out of the
 *   painted screen before the selection highlight is applied, so the button
 *   contents literally disappear under a selection instead of being
 *   highlighted as if they were text. The underlying rendered line is not
 *   modified; the button reappears when the selection is gone.
 *
 * How it works
 * ------------
 * Pi has no extension hook for rendering or clicking inside a normal
 * assistant/user Markdown message, so -- like osc8-links.ts and
 * selection-manager.ts -- this extension patches pi-tui prototypes for the
 * life of a TUI session:
 *
 * - `Markdown.prototype.renderToken` appends the button line to `code`
 *   tokens and remembers the block's raw text in a registry. The button
 *   carries the registry id encoded in zero-width characters after the
 *   visible label, so a rendered line can be traced back to its exact
 *   source even after highlighting, wrapping, and padding.
 * - `TuiAltScreen.prototype.handleSelectionMouseEvent` intercepts a click
 *   (press + release on the same cell, no drag) that lands on a button
 *   before the built-in selection handling can treat it as a selection.
 * - `TuiAltScreen.prototype.getActiveSelectionText` drops button lines
 *   from copied selection text.
 * - `TuiAltScreen.prototype.applySelection` blanks button glyphs that a
 *   selection covers before delegating to the previous implementation.
 *
 * Patch state lives on `globalThis` under a Symbol (the osc8-links.ts
 * pattern), so a /reload or a session replacement never wraps a method
 * twice, and shutdown only restores a method when this patch is still the
 * outermost one (selection-manager.ts may sit on top of the selection
 * methods; its own shutdown restore then puts this patch back).
 *
 * Clicking requires fullscreen mode (`tuiMode: "fullscreen"`), where pi
 * owns the mouse. In regular mode the terminal owns mouse and selection,
 * so the button is only a visual affordance there; use `/code-copy last`
 * to copy the most recently rendered block instead. `/code-copy` with no
 * arguments reports whether the patches are active.
 */

import { spawnSync } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { highlightCode } from "@earendil-works/pi-coding-agent";
import { Markdown, sliceByColumn, stripTerminalSequences, TuiAltScreen, visibleWidth } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Button label and registry-id encoding
// ---------------------------------------------------------------------------

export const COPY_BUTTON_LABEL = "⧉ Copy";
const COPY_BUTTON_LABEL_WIDTH = visibleWidth(COPY_BUTTON_LABEL);
// The button is rendered as a padded chip: two spaces of padding inside
// an accent-coloured background on each side of the label. The clickable
// (and blank-under-selection) segment covers the whole chip, padding
// included, not just the label text.
const CHIP_PADDING = 2;

// The registry id follows the visible label, encoded bit by bit in
// zero-width characters (U+200B = 0, U+200C = 1) between U+2060 markers.
// They add no visible width, survive ANSI stripping, and never wrap onto
// their own line because they sit directly after the short label.
const ID_MARKER = "\u2060";
const ID_ZERO = "\u200b";
const ID_ONE = "\u200c";

function encodeBlockId(id: number): string {
	const bits = id
		.toString(2)
		.split("")
		.map((bit) => (bit === "1" ? ID_ONE : ID_ZERO))
		.join("");
	return `${ID_MARKER}${bits}${ID_MARKER}`;
}

interface ButtonHit {
	start: number;
	end: number;
	id: number;
}

/** Find the copy button chip on a plain (ANSI-stripped) rendered line, if any. */
export function findCopyButton(plainLine: string): ButtonHit | undefined {
	const labelIndex = plainLine.indexOf(COPY_BUTTON_LABEL);
	if (labelIndex < 0) return undefined;
	// The id marker sits after the chip's trailing padding.
	let markerIndex = labelIndex + COPY_BUTTON_LABEL.length;
	let padding = 0;
	while (padding < CHIP_PADDING && plainLine[markerIndex] === " ") {
		markerIndex += 1;
		padding += 1;
	}
	const marker = new RegExp(`^${ID_MARKER}([${ID_ZERO}${ID_ONE}]+)${ID_MARKER}`).exec(plainLine.slice(markerIndex));
	if (!marker) return undefined;
	// Expand the segment over the chip padding on both sides.
	let start = labelIndex;
	for (let i = 0; i < CHIP_PADDING && start > 0 && plainLine[start - 1] === " "; i += 1) start -= 1;
	const id = Number.parseInt(
		marker[1]!
			.split("")
			.map((char) => (char === ID_ONE ? "1" : "0"))
			.join(""),
		2,
	);
	if (!Number.isFinite(id)) return undefined;
	return { start, end: labelIndex + COPY_BUTTON_LABEL_WIDTH + padding, id };
}

// ---------------------------------------------------------------------------
// Shared patch state (survives /reload without double-wrapping)
// ---------------------------------------------------------------------------

type RenderTokenFn = (token: unknown, width: number, nextTokenType?: string, styleContext?: unknown) => string[];
type GetSelectionTextFn = (this: AltScreenInternals) => string | undefined;
type ApplySelectionFn = (this: AltScreenInternals, screen: string[], layout?: unknown) => string[];
type HandleSelectionMouseFn = (this: AltScreenInternals, event: RawMouseEvent) => void;

interface PatchState {
	registry: Map<number, string>;
	lastBlockId: number;
	markdownInstalled: boolean;
	selectionTextInstalled: boolean;
	applySelectionInstalled: boolean;
	clickInstalled: boolean;
	origRenderToken: RenderTokenFn | undefined;
	origGetSelectionText: GetSelectionTextFn | undefined;
	origApplySelection: ApplySelectionFn | undefined;
	origHandleSelectionMouse: HandleSelectionMouseFn | undefined;
	patchedRenderToken: RenderTokenFn | undefined;
	patchedGetSelectionText: GetSelectionTextFn | undefined;
	patchedApplySelection: ApplySelectionFn | undefined;
	patchedHandleSelectionMouse: HandleSelectionMouseFn | undefined;
}

const PATCH_STATE_SYMBOL = Symbol.for("pi.codeBlockCopy.patchState");

function getPatchState(): PatchState {
	const holder = globalThis as Record<symbol, PatchState | undefined>;
	holder[PATCH_STATE_SYMBOL] ??= {
		registry: new Map(),
		lastBlockId: 0,
		markdownInstalled: false,
		selectionTextInstalled: false,
		applySelectionInstalled: false,
		clickInstalled: false,
		origRenderToken: undefined,
		origGetSelectionText: undefined,
		origApplySelection: undefined,
		origHandleSelectionMouse: undefined,
		patchedRenderToken: undefined,
		patchedGetSelectionText: undefined,
		patchedApplySelection: undefined,
		patchedHandleSelectionMouse: undefined,
	};
	return holder[PATCH_STATE_SYMBOL]!;
}

const MAX_REGISTERED_BLOCKS = 1000;

function registerBlock(state: PatchState, code: string): number {
	state.lastBlockId += 1;
	state.registry.set(state.lastBlockId, code);
	// Rendering the same message again mints new ids; keep the registry
	// bounded by dropping the oldest entries.
	while (state.registry.size > MAX_REGISTERED_BLOCKS) {
		const oldest = state.registry.keys().next().value;
		if (oldest === undefined) break;
		state.registry.delete(oldest);
	}
	return state.lastBlockId;
}

// ---------------------------------------------------------------------------
// TuiAltScreen internals, reached through runtime properties (as in
// selection-manager.ts; TypeScript `private` members are runtime properties)
// ---------------------------------------------------------------------------

interface SelectionPointLike {
	row: number;
	col: number;
	boundary?: boolean;
	scrollView?: { scrollTop: number };
}

interface SelectionLike {
	start: SelectionPointLike;
	end: SelectionPointLike;
}

interface LayoutBoxLike {
	rect: { x: number; y: number; width: number; height: number };
	clip: { x: number; y: number; width: number; height: number };
	children?: LayoutBoxLike[];
	scrollView?: { scrollTop: number };
	scrollContentLines?: readonly string[];
}

interface RawMouseEvent {
	button: number;
	x: number;
	y: number;
	release?: boolean;
}

interface AltScreenInternals {
	selectionAnchor?: SelectionPointLike;
	selectionFocus?: SelectionPointLike;
	selectionPressActive?: boolean;
	selectionDragged?: boolean;
	pressedUrl?: string;
	previousScreen: string[];
	currentLayout?: { root: LayoutBoxLike };
	terminal: { columns: number; rows: number };
	getSelectionBounds(): SelectionLike | undefined;
	getSelectionColumns(
		line: string,
		row: number,
		selection: SelectionLike,
		minColumn?: number,
		maxColumn?: number,
	): { start: number; end: number };
	getSelectionPoint?(event: { x: number; y: number }, scrollView?: { scrollTop: number }): SelectionPointLike;
	getSelectionSourceLine?(point: SelectionPointLike): string;
	copyTextToClipboard?(text: string): Promise<boolean> | boolean;
	requestRender?(): void;
	stopSelectionAutoScroll?(): void;
}

function findScrollViewBox(box: LayoutBoxLike | undefined, scrollView: unknown): LayoutBoxLike | undefined {
	if (!box) return undefined;
	if (box.scrollView === scrollView) return box;
	for (const child of box.children ?? []) {
		const found = findScrollViewBox(child, scrollView);
		if (found) return found;
	}
	return undefined;
}

function getSelectionSourceLine(internals: AltScreenInternals, point: SelectionPointLike): string {
	if (typeof internals.getSelectionSourceLine === "function") {
		return internals.getSelectionSourceLine(point);
	}
	if (point.scrollView) {
		const box = internals.currentLayout ? findScrollViewBox(internals.currentLayout.root, point.scrollView) : undefined;
		if (box?.scrollContentLines) return box.scrollContentLines[point.row] ?? "";
	}
	return internals.previousScreen[point.row] ?? "";
}

// ---------------------------------------------------------------------------
// Clipboard fallback (used when the alt screen cannot copy, and by the
// /code-copy command which runs outside the alt screen)
// ---------------------------------------------------------------------------

const CLIPBOARD_TIMEOUT_MS = 5_000;

function runClipboardCommand(command: string, args: string[], text: string): true | string {
	const result = spawnSync(command, args, {
		input: text,
		encoding: "utf-8",
		timeout: CLIPBOARD_TIMEOUT_MS,
		stdio: ["pipe", "ignore", "pipe"],
	});
	if (result.error) return result.error.message;
	if (result.status !== 0) return result.stderr?.toString().trim() || `${command} exited with status ${result.status}`;
	return true;
}

function copyToClipboard(text: string): true | string {
	const configured = process.env.PI_CLIPBOARD_COPY_COMMAND?.trim();
	if (configured) {
		const result = spawnSync(configured, [], {
			input: text,
			encoding: "utf-8",
			timeout: CLIPBOARD_TIMEOUT_MS,
			stdio: ["pipe", "ignore", "pipe"],
			shell: true,
		});
		if (result.error) return result.error.message;
		if (result.status !== 0) return result.stderr?.toString().trim() || `${configured} exited with status ${result.status}`;
		return true;
	}
	if (process.platform === "darwin") return runClipboardCommand("pbcopy", [], text);
	if (process.platform === "win32") {
		return runClipboardCommand(
			"powershell.exe",
			["-NoProfile", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
			text,
		);
	}
	const errors: string[] = [];
	for (const [command, args] of [
		["wl-copy", []],
		["xclip", ["-selection", "clipboard"]],
		["xsel", ["--clipboard", "--input"]],
	] as Array<[string, string[]]>) {
		const result = runClipboardCommand(command, args, text);
		if (result === true) return true;
		errors.push(`${command}: ${result}`);
	}
	return errors.join("; ");
}

// Set on session_start so the click patch can report fallback copies.
let notifyCopyResult: ((text: string) => void) | undefined;

function copyBlockText(internals: AltScreenInternals | undefined, code: string): void {
	if (internals && typeof internals.copyTextToClipboard === "function") {
		// The alt screen flashes "Copied!" (or the failure) itself.
		void internals.copyTextToClipboard(code);
		return;
	}
	const result = copyToClipboard(code);
	if (result === true) {
		notifyCopyResult?.(code);
	}
}

// ---------------------------------------------------------------------------
// Markdown patch: highlight (via the theme, or pi's highlighter as a
// fallback) plus the copy-button line after each fenced code block
// ---------------------------------------------------------------------------

interface MarkdownInternals {
	theme: {
		code?: (text: string) => string;
		bold?: (text: string) => string;
		codeBlock?: (text: string) => string;
		codeBlockBorder: (text: string) => string;
		codeBlockIndent?: string;
		highlightCode?: (code: string, lang?: string) => string[];
	};
}

interface CodeTokenLike {
	type: string;
	text?: string;
	lang?: string;
}

// ---------------------------------------------------------------------------
// Code-block background panel
// ---------------------------------------------------------------------------

// A code block gets a distinguished background so it reads as one panel:
// a dark grey on dark themes, a light grey on light themes. The theme
// does not expose its appearance through the Markdown theme object, so
// the choice is made by probing the theme's own code colour: dark themes
// style code in light colours (high luminance), light themes in dark
// colours. When no colour can be probed, assume a dark theme.
const CODE_BG_DARK = "\x1b[48;5;236m";
const CODE_BG_LIGHT = "\x1b[48;5;254m";

function paletteRgb(index: number): { r: number; g: number; b: number } {
	if (index < 16) {
		const base: Array<[number, number, number]> = [
			[0, 0, 0], [170, 0, 0], [0, 170, 0], [170, 85, 0], [0, 0, 170], [170, 0, 170], [0, 170, 170], [170, 170, 170],
			[85, 85, 85], [255, 85, 85], [85, 255, 85], [255, 255, 85], [85, 85, 255], [255, 85, 255], [85, 255, 255],
			[255, 255, 255],
		];
		const [r, g, b] = base[index]!;
		return { r, g, b };
	}
	if (index < 232) {
		const value = index - 16;
		const levels = [0, 95, 135, 175, 215, 255];
		return {
			r: levels[Math.floor(value / 36)]!,
			g: levels[Math.floor(value / 6) % 6]!,
			b: levels[value % 6]!,
		};
	}
	const grey = 8 + (index - 232) * 10;
	return { r: grey, g: grey, b: grey };
}

interface ProbedColor {
	rgb: { r: number; g: number; b: number };
	/** The same colour expressed as a background SGR sequence. */
	backgroundAnsi: string;
}

/** Extract the colour a Markdown theme style function produces, as RGB plus a background SGR. */
function probeStyleColor(style: ((text: string) => string) | undefined): ProbedColor | undefined {
	if (typeof style !== "function") return undefined;
	try {
		const styled = style("\x00");
		const sgr = /\x1b\[([0-9;]*)m/.exec(styled);
		if (!sgr) return undefined;
		const params = sgr[1]!.split(";").filter((part) => part.length > 0).map(Number);
		for (let i = 0; i < params.length; i += 1) {
			if (params[i] === 38 && params[i + 1] === 2 && params.length >= i + 5) {
				const rgb = { r: params[i + 2]!, g: params[i + 3]!, b: params[i + 4]! };
				return { rgb, backgroundAnsi: `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m` };
			}
			if (params[i] === 38 && params[i + 1] === 5 && params[i + 2] !== undefined) {
				return { rgb: paletteRgb(params[i + 2]!), backgroundAnsi: `\x1b[48;5;${params[i + 2]}m` };
			}
			if (params[i]! >= 30 && params[i]! <= 37) {
				return { rgb: paletteRgb(params[i]! - 30), backgroundAnsi: `\x1b[${params[i]! - 30 + 40}m` };
			}
			if (params[i]! >= 90 && params[i]! <= 97) {
				return { rgb: paletteRgb(params[i]! - 90 + 8), backgroundAnsi: `\x1b[${params[i]! - 90 + 100}m` };
			}
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function colorLuminance(rgb: { r: number; g: number; b: number }): number {
	return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

function codeBackgroundAnsi(theme: MarkdownInternals["theme"]): string {
	const probed = probeStyleColor(theme.codeBlock ?? theme.codeBlockBorder);
	if (!probed) return CODE_BG_DARK;
	return colorLuminance(probed.rgb) > 0.5 ? CODE_BG_DARK : CODE_BG_LIGHT;
}

/**
 * Chip colours for the copy button: an accent background taken from the
 * theme's inline-code colour (falling back to a slate blue), with bold
 * white text on it -- or dark text when the accent is very light. This
 * makes the button read as a filled UI element sitting below the panel,
 * rather than as another line of code.
 */
function chipColors(theme: MarkdownInternals["theme"]): { backgroundAnsi: string; foregroundAnsi: string } {
	const probed = probeStyleColor(theme.code ?? theme.codeBlock);
	if (!probed) return { backgroundAnsi: "\x1b[48;5;62m", foregroundAnsi: "\x1b[38;5;255m" };
	return {
		backgroundAnsi: probed.backgroundAnsi,
		foregroundAnsi: colorLuminance(probed.rgb) > 0.65 ? "\x1b[38;2;24;24;24m" : "\x1b[38;2;255;255;255m",
	};
}

/**
 * Paint the background behind a rendered code block (fences and code
 * lines; the copy button below the block stays outside the panel). The
 * background is reapplied after any full or
 * background reset inside the line, and deliberately not closed at the
 * end: the Markdown renderer pads the line to full width after this, and
 * pi resets styling at each line end, so the padding completes a
 * full-width panel without leaking into the next line.
 */
function applyCodeBackground(theme: MarkdownInternals["theme"], lines: string[]): string[] {
	const background = codeBackgroundAnsi(theme);
	const buttonIndex = lines.findIndex((line) => stripTerminalSequences(line).includes(COPY_BUTTON_LABEL));
	// The panel covers the fences and the code only. The copy button sits
	// below the closing fence, outside the panel, on the terminal's own
	// background (its chip provides its own accent background).
	const lastPanelLine = buttonIndex >= 0 ? buttonIndex - 1 : lines.length - 1;
	return lines.map((line, index) => {
		if (index > lastPanelLine) return line;
		const reapplied = line.replace(/\x1b\[(?:0|49)m/g, (reset) => `${reset}${background}`);
		return `${background}${reapplied}`;
	});
}

function buildButtonLine(markdown: MarkdownInternals, id: number): string {
	const indent = markdown.theme.codeBlockIndent ?? "  ";
	const { backgroundAnsi, foregroundAnsi } = chipColors(markdown.theme);
	const padding = " ".repeat(CHIP_PADDING);
	// A filled, padded chip: accent background, contrasting bold label,
	// then resets back to the terminal background (the button line is
	// outside the code panel). The zero-width id sits inside
	// the chip (after the trailing padding) so it survives stripping.
	const chip = `${backgroundAnsi}${foregroundAnsi}\x1b[1m${padding}${COPY_BUTTON_LABEL}${padding}${encodeBlockId(id)}\x1b[22m\x1b[39m\x1b[49m`;
	return `${indent}${chip}`;
}

function insertButtonLine(markdown: MarkdownInternals, lines: string[], code: string): string[] {
	const state = getPatchState();
	const id = registerBlock(state, code);
	const buttonLine = buildButtonLine(markdown, id);
	// The built-in renderer ends a code block with a closing ``` line,
	// optionally followed by one blank separator line. The button goes
	// directly under the closing fence, before that blank line.
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if (stripTerminalSequences(lines[index] ?? "").trim() === "```") {
			return [...lines.slice(0, index + 1), buttonLine, ...lines.slice(index + 1)];
		}
	}
	const trailingBlank = lines.length > 0 && stripTerminalSequences(lines[lines.length - 1] ?? "").trim() === "";
	return trailingBlank ? [...lines.slice(0, -1), buttonLine, lines[lines.length - 1]!] : [...lines, buttonLine];
}

function patchedRenderToken(
	this: MarkdownInternals,
	token: CodeTokenLike,
	width: number,
	nextTokenType?: string,
	styleContext?: unknown,
): string[] {
	const state = getPatchState();
	const original = state.origRenderToken!;
	if (token?.type !== "code" || !token.text) {
		return original.call(this, token, width, nextTokenType, styleContext);
	}

	// Highlighting: the built-in Markdown theme already provides
	// highlightCode, and the original renderer uses it. Only when a custom
	// theme omits it do we render the block ourselves with pi's exported
	// highlighter, so code blocks stay syntax-highlighted either way.
	if (!this.theme?.highlightCode && typeof highlightCode === "function") {
		try {
			const indent = this.theme.codeBlockIndent ?? "  ";
			const lines = [
				this.theme.codeBlockBorder(`\`\`\`${token.lang || ""}`),
				...highlightCode(token.text, token.lang).map((line) => `${indent}${line}`),
				this.theme.codeBlockBorder("```"),
			];
			if (nextTokenType && nextTokenType !== "space") lines.push("");
			return applyCodeBackground(this.theme, insertButtonLine(this, lines, token.text));
		} catch {
			// Fall through to the original renderer.
		}
	}

	const lines = original.call(this, token, width, nextTokenType, styleContext);
	return applyCodeBackground(this.theme, insertButtonLine(this, lines, token.text));
}

// ---------------------------------------------------------------------------
// Alt-screen patches: click to copy, and a button that is not selectable
// ---------------------------------------------------------------------------

function patchedGetSelectionText(this: AltScreenInternals): string | undefined {
	const state = getPatchState();
	const text = state.origGetSelectionText!.call(this);
	if (text === undefined || !text.includes(COPY_BUTTON_LABEL)) return text;
	// Button lines are not text the user can select: drop them wholesale.
	// Match on the visible label alone here: pi's column slicing can drop
	// the trailing zero-width id when a selection ends at the line's
	// visible width, so copied text may no longer carry the marker. (A
	// user-authored line containing this exact label would also be
	// dropped from a selection copy; that trade-off is intentional.)
	const kept = text.split("\n").filter((line) => !line.includes(COPY_BUTTON_LABEL));
	if (kept.length === text.split("\n").length) return text;
	const joined = kept.join("\n");
	return joined.length > 0 ? joined : undefined;
}

/**
 * Blank the button glyphs a selection covers. This runs on the screen
 * lines before the previous applySelection paints the highlight, so the
 * button contents disappear under a selection and take no highlight as
 * text. Lines outside the selection keep their button.
 */
function blankSelectedButtons(
	internals: AltScreenInternals,
	screen: string[],
	layout: unknown,
): string[] {
	const selection = internals.getSelectionBounds();
	if (!selection) return screen;

	let screenSelection = selection;
	let minRow = 0;
	let maxRow = screen.length - 1;
	let minColumn = 0;
	let maxColumn = internals.terminal.columns;
	if (selection.start.scrollView) {
		const frame = (layout as { root: LayoutBoxLike } | undefined) ?? internals.currentLayout;
		const box = frame ? findScrollViewBox(frame.root, selection.start.scrollView) : undefined;
		if (!box) return screen;
		minRow = Math.max(0, box.rect.y, box.clip.y);
		maxRow = Math.min(screen.length - 1, box.rect.y + box.rect.height - 1, box.clip.y + box.clip.height - 1);
		minColumn = Math.max(0, box.rect.x, box.clip.x);
		maxColumn = Math.min(internals.terminal.columns, box.rect.x + box.rect.width, box.clip.x + box.clip.width);
		screenSelection = {
			start: {
				...selection.start,
				row: box.rect.y + selection.start.row - selection.start.scrollView.scrollTop,
				col: box.rect.x + selection.start.col,
			},
			end: {
				...selection.end,
				row: box.rect.y + selection.end.row - selection.start.scrollView.scrollTop,
				col: box.rect.x + selection.end.col,
			},
		};
	}

	let changed = false;
	const result = screen.map((line, row) => {
		if (row < minRow || row > maxRow || row < screenSelection.start.row || row > screenSelection.end.row) {
			return line;
		}
		const hit = findCopyButton(stripTerminalSequences(line));
		if (!hit) return line;
		const columns = internals.getSelectionColumns(line, row, screenSelection, minColumn, maxColumn);
		const start = Math.max(hit.start, columns.start);
		const end = Math.min(hit.end, columns.end);
		if (end <= start) return line;
		changed = true;
		const lineWidth = visibleWidth(line);
		const before = sliceByColumn(line, 0, start, true);
		const after = sliceByColumn(line, end, Math.max(0, lineWidth - end), true);
		return `${before}${" ".repeat(end - start)}${after}`;
	});
	return changed ? result : screen;
}

function patchedApplySelection(this: AltScreenInternals, screen: string[], layout?: unknown): string[] {
	const state = getPatchState();
	let processed = screen;
	try {
		processed = blankSelectedButtons(this, screen, layout);
	} catch {
		processed = screen;
	}
	return state.origApplySelection!.call(this, processed, layout);
}

function patchedHandleSelectionMouse(this: AltScreenInternals, event: RawMouseEvent): void {
	const state = getPatchState();
	const original = state.origHandleSelectionMouse!;

	// A click is a left-button release on the same content cell where the
	// press started, with no drag in between (mirrors the built-in isClick
	// test). If that cell is on a copy button, copy the block instead of
	// letting the release fall through to selection/copy-on-select handling.
	if (event?.release && this.selectionPressActive && !this.selectionDragged && this.selectionAnchor) {
		try {
			const anchor = this.selectionAnchor;
			const point =
				typeof this.getSelectionPoint === "function"
					? this.getSelectionPoint(event, anchor.scrollView)
					: { row: event.y, col: event.x, scrollView: anchor.scrollView };
			if (point && point.row === anchor.row && point.col === anchor.col && point.scrollView === anchor.scrollView) {
				const hit = findCopyButton(stripTerminalSequences(getSelectionSourceLine(this, point)));
				if (hit && point.col >= hit.start && point.col < hit.end) {
					const code = state.registry.get(hit.id);
					if (code !== undefined) {
						this.selectionPressActive = false;
						this.selectionAnchor = undefined;
						this.selectionFocus = undefined;
						this.pressedUrl = undefined;
						this.stopSelectionAutoScroll?.();
						copyBlockText(this, code);
						this.requestRender?.();
						return;
					}
				}
			}
		} catch {
			// Fall through to the built-in selection handling.
		}
	}

	original.call(this, event);
}

// ---------------------------------------------------------------------------
// Install / restore
// ---------------------------------------------------------------------------

interface MarkdownPrototypeLike {
	renderToken?: RenderTokenFn;
}

interface AltScreenPrototypeLike {
	getActiveSelectionText?: GetSelectionTextFn;
	applySelection?: ApplySelectionFn;
	handleSelectionMouseEvent?: HandleSelectionMouseFn;
}

function installCodeBlockCopy(): { markdown: boolean; altScreen: boolean } {
	const state = getPatchState();

	let markdown = state.markdownInstalled;
	if (!state.markdownInstalled) {
		const prototype = Markdown.prototype as unknown as MarkdownPrototypeLike;
		if (typeof prototype.renderToken === "function") {
			state.origRenderToken = prototype.renderToken as RenderTokenFn;
			state.patchedRenderToken = patchedRenderToken as RenderTokenFn;
			prototype.renderToken = state.patchedRenderToken;
			state.markdownInstalled = true;
			markdown = true;
		}
	}

	let altScreen = state.selectionTextInstalled && state.applySelectionInstalled && state.clickInstalled;
	const prototype = TuiAltScreen.prototype as unknown as AltScreenPrototypeLike;
	if (!state.selectionTextInstalled && typeof prototype.getActiveSelectionText === "function") {
		state.origGetSelectionText = prototype.getActiveSelectionText;
		state.patchedGetSelectionText = patchedGetSelectionText as GetSelectionTextFn;
		prototype.getActiveSelectionText = state.patchedGetSelectionText;
		state.selectionTextInstalled = true;
	}
	if (!state.applySelectionInstalled && typeof prototype.applySelection === "function") {
		state.origApplySelection = prototype.applySelection;
		state.patchedApplySelection = patchedApplySelection as ApplySelectionFn;
		prototype.applySelection = state.patchedApplySelection;
		state.applySelectionInstalled = true;
	}
	if (!state.clickInstalled && typeof prototype.handleSelectionMouseEvent === "function") {
		state.origHandleSelectionMouse = prototype.handleSelectionMouseEvent;
		state.patchedHandleSelectionMouse = patchedHandleSelectionMouse as HandleSelectionMouseFn;
		prototype.handleSelectionMouseEvent = state.patchedHandleSelectionMouse;
		state.clickInstalled = true;
	}
	altScreen = state.selectionTextInstalled && state.applySelectionInstalled && state.clickInstalled;
	return { markdown, altScreen };
}

function uninstallCodeBlockCopy(): void {
	const state = getPatchState();

	// Only restore a method when this patch is still the outermost one.
	// If another extension (selection-manager) wrapped ours after we
	// installed, its own shutdown restore puts our patch back, and our
	// installed flags correctly stay set for the next session.
	const markdownPrototype = Markdown.prototype as unknown as MarkdownPrototypeLike;
	if (state.markdownInstalled && markdownPrototype.renderToken === state.patchedRenderToken) {
		markdownPrototype.renderToken = state.origRenderToken;
		state.markdownInstalled = false;
	}
	const altPrototype = TuiAltScreen.prototype as unknown as AltScreenPrototypeLike;
	if (state.selectionTextInstalled && altPrototype.getActiveSelectionText === state.patchedGetSelectionText) {
		altPrototype.getActiveSelectionText = state.origGetSelectionText;
		state.selectionTextInstalled = false;
	}
	if (state.applySelectionInstalled && altPrototype.applySelection === state.patchedApplySelection) {
		altPrototype.applySelection = state.origApplySelection;
		state.applySelectionInstalled = false;
	}
	if (state.clickInstalled && altPrototype.handleSelectionMouseEvent === state.patchedHandleSelectionMouse) {
		altPrototype.handleSelectionMouseEvent = state.origHandleSelectionMouse;
		state.clickInstalled = false;
	}
}

function isInstalled(): boolean {
	const state = getPatchState();
	return state.markdownInstalled && state.selectionTextInstalled && state.applySelectionInstalled && state.clickInstalled;
}

export default function codeBlockCopyExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		notifyCopyResult = (text) => {
			ctx.ui.notify(`Copied ${text.length.toLocaleString()} characters`, "info");
		};
		const { markdown, altScreen } = installCodeBlockCopy();
		if (!markdown || !altScreen) {
			ctx.ui.notify(
				"code-block-copy: pi-tui internals not found; copy buttons inactive (Markdown patch " +
					`${markdown ? "on" : "missing"}, fullscreen mouse patch ${altScreen ? "on" : "missing"})`,
				"warning",
			);
		}
	});

	pi.on("session_shutdown", () => {
		notifyCopyResult = undefined;
		uninstallCodeBlockCopy();
	});

	pi.registerCommand("code-copy", {
		description: "Copy the most recently rendered code block (/code-copy last), or report copy-button status",
		handler: async (args, ctx: ExtensionContext) => {
			const state = getPatchState();
			if (args.trim() === "last") {
				const code = state.lastBlockId > 0 ? state.registry.get(state.lastBlockId) : undefined;
				if (code === undefined) {
					ctx.ui.notify("code-block-copy: no code block has been rendered yet", "warning");
					return;
				}
				const result = copyToClipboard(code);
				if (result === true) {
					ctx.ui.notify(`Copied ${code.length.toLocaleString()} characters`, "info");
				} else {
					ctx.ui.notify(`Copy failed: ${result}`, "error");
				}
				return;
			}
			ctx.ui.notify(
				isInstalled()
					? `code-block-copy: active (${state.registry.size} code block(s) registered; click ${COPY_BUTTON_LABEL} under a block in fullscreen mode)`
					: "code-block-copy: inactive (fullscreen pi-tui internals not patched)",
				isInstalled() ? "info" : "warning",
			);
		},
	});
}
