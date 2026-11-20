import { highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type TuiMouseEvent, type TuiMouseEventResult, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { codeLines, prepareToolPreview } from "./tool-preview.ts";
import { type CodemodeCall } from "./codemode-view.ts";
import { languageForPath, scriptSegments } from "./script-language.ts";

export interface NestedOutput {
	id: string;
	text: string;
	images: number;
	truncated: boolean;
	isError: boolean;
	diff?: string;
	diffTruncated?: boolean;
}
export interface SourceSection {
	label: string;
	source: string;
	language?: string;
	shell?: boolean;
}
// Zero-width metadata distinguishes UI borders from box-drawing characters in code.
// Keep in sync with selection-manager.ts's inset-frame recognition.
export const NESTED_FRAME_MARKER = "\x1b_open-tui:nested-frame\x07";
const MAX_SOURCE_CHARS = 16_384;
const MAX_SOURCE_LINES = 80;
interface SourceBudget { chars: number; lines: number }
function boundedArguments(args: Record<string, unknown>): string {
	const entries = Object.entries(args).slice(0, 12).map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 512) : value && typeof value === "object" ? `[${Array.isArray(value) ? "array" : "object"}]` : value]);
	return JSON.stringify(Object.fromEntries(entries), null, 2);
}

export function nestedSources(call: CodemodeCall): SourceSection[] {
	const args = call.args;
	const path = String(args.file_path ?? args.path ?? args.filename ?? "");
	const explicit = typeof args.language === "string" ? args.language : typeof args.lang === "string" ? args.lang : undefined;
	const language = explicit ?? languageForPath(path);
	if ((call.name === "bash" || call.name === "powershell") && typeof args.command === "string") {
		return [{ label: "Command", source: args.command, shell: call.name === "bash", language: call.name === "powershell" ? "powershell" : "bash" }];
	}
	const sections: SourceSection[] = [];
	for (const key of ["content", "code", "script", "source", "sql", "newText", "oldText"]) {
		if (typeof args[key] === "string") sections.push({ label: key, source: args[key] as string, language: key === "sql" ? "sql" : language ?? (call.name === "codemode" ? "javascript" : undefined) });
	}
	if (Array.isArray(args.edits)) args.edits.slice(0, 8).forEach((edit, index) => {
		if (typeof edit !== "object" || !edit) return;
		for (const key of ["oldText", "newText"]) {
			const source = (edit as Record<string, unknown>)[key];
			if (typeof source === "string") sections.push({ label: `Edit ${index + 1} · ${key}`, source, language });
		}
	});
	if (!sections.length) sections.push({ label: "Arguments", source: boundedArguments(args), language: "json" });
	return sections.slice(0, 16);
}

/** Historical calls may lack native diff snapshots; show requested changes without invented file line numbers. */
export function requestedEditDiff(call: CodemodeCall): { source: string; truncated: boolean } | undefined {
	const edits = Array.isArray(call.args.edits) ? call.args.edits.slice(0, 8) : [call.args];
	const rows: string[] = [];
	let truncated = Array.isArray(call.args.edits) && call.args.edits.length > edits.length;
	let budget = 8_192;
	for (const edit of edits) {
		if (!edit || typeof edit !== "object") continue;
		const values = edit as Record<string, unknown>;
		if (typeof values.oldText !== "string" || typeof values.newText !== "string" || values.oldText === values.newText) continue;
		const eachSide = Math.floor(budget / 2);
		for (const [marker, text] of [["-", values.oldText], ["+", values.newText]] as const) {
			const bounded = text.slice(0, eachSide);
			budget -= bounded.length;
			const lines = codeLines(bounded);
			truncated ||= bounded.length < text.length || lines.length > 16;
			rows.push(...lines.slice(0, 16).map((line, index) => `${marker}${index + 1} ${line}`));
		}
		if (!budget) break;
	}
	return rows.length ? { source: rows.join("\n"), truncated } : undefined;
}

/** Bounded highlighting, prepared once per source/theme rather than on each keystroke. */
export function highlightedSource(section: SourceSection, theme: Theme, budget: SourceBudget = { chars: MAX_SOURCE_CHARS, lines: MAX_SOURCE_LINES }): string[] {
	// Bound input before sanitization, parsing, splitting, or highlighting.
	const raw = section.source.slice(0, Math.max(0, budget.chars));
	const clean = codeLines(raw).join("\n").slice(0, Math.max(0, budget.chars));
	const source = clean.split("\n").slice(0, Math.max(0, budget.lines)).join("\n");
	const segments = section.shell ? scriptSegments(clean) : [{ source: clean, language: section.language ?? "plaintext" }];
	let offset = 0;
	const colored = segments.map((segment) => {
		const shown = segment.source.slice(0, Math.max(0, source.length - offset));
		offset += segment.source.length;
		if (!shown) return "";
		try { return highlightCode(shown, segment.language).join("\n"); }
		catch { return theme.fg("toolOutput", shown); }
	}).join("").split("\n");
	budget.chars = Math.max(0, budget.chars - source.length);
	budget.lines = Math.max(0, budget.lines - colored.length);
	if (raw.length < section.source.length || source.length < clean.length) colored.push(theme.fg("dim", "… source preview truncated"));
	return colored;
}

/** Each child owns its collapse state; only genuine clicks toggle, never selection drags. */
export function nestedToolBlocks(options: {
	calls: CodemodeCall[];
	outputs: NestedOutput[];
	expanded: boolean;
	overrides: Map<string, boolean>;
	theme: Theme;
	heading: (call: CodemodeCall) => string;
	invalidate: () => void;
}): Component {
	let cached: { width: number; lines: string[] } | undefined;
	let regions: { id: string; from: number; to: number }[] = [];
	const sources = new Map<string, string[]>();
	const previews = new Map<string, { label: string; render: ReturnType<typeof prepareToolPreview>; notice?: string } | undefined>();
	const outputById = new Map(options.outputs.map((output) => [output.id, output]));
	const expanded = (id: string) => options.overrides.get(id) ?? options.expanded;
	const color = (call: CodemodeCall) => call.status === "error" ? "error" : call.status === "cancelled" ? "warning" : call.status === "running" ? "accent" : "dim";
	const status = (call: CodemodeCall) => call.status === "ok" ? "Done" : call.status === "error" ? "Failed" : call.status === "cancelled" ? "Cancelled" : "Running…";
	const component: Component = {
		render(width) {
			if (cached?.width === width) return cached.lines;
			regions = [];
			const rows: string[] = [];
			const room = Math.max(0, width - 4);
			for (const [index, call] of options.calls.entries()) {
				const id = call.id ?? `call-${index}`;
				const open = expanded(id);
				const from = rows.length;
				const border = (text: string) => options.theme.fg("border", text);
				const title = truncateToWidth(`${open ? "▼" : "▶"} ${options.heading(call)}`, Math.max(0, width - 5), "…");
				rows.push(NESTED_FRAME_MARKER + border("╭─ ") + title + border("─".repeat(Math.max(0, width - 4 - visibleWidth(title))) + "╮"));
				const body = [options.theme.fg(color(call), status(call) + (call.durationMs === undefined ? "" : ` · ${Math.round(call.durationMs)}ms`) + (call.error ? ` · ${codeLines(call.error)[0] ?? ""}` : ""))];
				const output = outputById.get(id);
				if (call.name === "edit" && call.status === "ok" && !output?.isError) {
					if (!previews.has(id)) {
						const actual = output?.diff;
						const requested = actual ? undefined : requestedEditDiff(call);
						const diff = actual || requested?.source;
						const path = String(call.args.file_path ?? call.args.path ?? "");
						const notice = output?.diffTruncated ? "… diff snapshot truncated" : requested?.truncated ? "… requested diff preview truncated" : undefined;
						previews.set(id, diff ? { label: actual ? "Changes" : "Requested changes", render: prepareToolPreview("edit", diff, path, options.theme, { showLineNumbers: Boolean(actual), expandHint: false }), notice } : undefined);
					}
					const preview = previews.get(id);
					if (preview) {
						body.push(options.theme.fg("dim", preview.label), ...preview.render(room, ""));
						if (preview.notice) body.push(options.theme.fg("warning", preview.notice));
					}
				}
				if (open) {
					let prepared = sources.get(id);
					if (!prepared) {
						prepared = [];
						const budget = { chars: MAX_SOURCE_CHARS, lines: MAX_SOURCE_LINES };
						for (const section of nestedSources(call)) {
							if (!budget.chars || !budget.lines) { prepared.push(options.theme.fg("dim", "… source sections truncated")); break; }
							prepared.push(options.theme.fg("dim", `${section.label}${section.language ? ` · ${section.language}` : ""}`), ...highlightedSource(section, options.theme, budget));
						}
						if (output) {
							const path = String(call.args.file_path ?? call.args.path ?? "");
							const language = call.name === "read" && !output.isError ? languageForPath(path) : undefined;
							prepared.push(options.theme.fg("dim", "Output"), ...highlightedSource({ label: "Output", source: output.text || "(no output)", language }, options.theme));
							if (output.images) prepared.push(options.theme.fg("dim", `${output.images} image(s); see parent output for emitted images`));
							if (output.truncated) prepared.push(options.theme.fg("warning", "… nested output snapshot truncated"));
						} else prepared.push(options.theme.fg("dim", "Nested output not recorded; script output is shown below."));
						sources.set(id, prepared);
					}
					body.push(...prepared);
					if (call.error) body.push(options.theme.fg("error", codeLines(call.error).join(" ")));
				}
				for (const line of body) {
					const clipped = truncateToWidth(line, room, "…");
					rows.push(border("│ ") + clipped + " ".repeat(Math.max(0, room - visibleWidth(clipped))) + border(" │"));
				}
				rows.push(NESTED_FRAME_MARKER + border(`╰${"─".repeat(Math.max(0, width - 2))}╯`));
				regions.push({ id, from, to: rows.length });
			}
			cached = { width, lines: rows.map((line) => truncateToWidth(line, Math.max(0, width), "…")) };
			return cached.lines;
		},
		handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
			if (event.type !== "click" || event.button !== "left" || event.shift || event.alt || event.ctrl || event.x < 0 || event.x >= event.width) return;
			const region = regions.find((region) => event.y >= region.from && event.y < region.to);
			if (!region) return;
			options.overrides.set(region.id, !expanded(region.id));
			cached = undefined;
			options.invalidate();
			return { handled: true, render: true };
		},
		invalidate() { cached = undefined; sources.clear(); previews.clear(); },
	};
	return component;
}
