/**
 * Questionnaire Tool - Unified tool for asking single or multiple questions
 *
 * Single question: simple options list
 * Multiple questions: single form that shows all questions together
 * Multiple entries: checkbox-style questions plus custom text entries
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	Text,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

// Types
interface QuestionOption {
	value: string;
	label: string;
	description?: string;
}

type RenderOption = QuestionOption & { isOther?: boolean };

interface Question {
	id: string;
	label: string;
	prompt: string;
	options: QuestionOption[];
	allowOther: boolean;
	multiple: boolean;
}

type AnswerEntryKind = "option" | "custom" | "context";

type InputPurpose = "answer" | "context";

type MouseTarget =
	| { kind: "option"; questionIndex: number; optionIndex: number }
	| { kind: "question"; questionIndex: number }
	| { kind: "submit" }
	| { kind: "scroll-up" }
	| { kind: "scroll-down" };

interface QuestionnaireMouseEvent {
	type?: string;
	button?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	wheelDelta?: number;
	clickCount?: number;
}

export interface AnswerEntry {
	value: string;
	label: string;
	wasCustom: boolean;
	kind: AnswerEntryKind;
	index?: number;
}

interface Answer {
	id: string;
	value: string;
	label: string;
	wasCustom: boolean;
	multiple: boolean;
	entries: AnswerEntry[];
	index?: number;
}

interface QuestionnaireResult {
	questions: Question[];
	answers: Answer[];
	cancelled: boolean;
}

// Schema
const QuestionOptionSchema = Type.Object({
	value: Type.String({ description: "The value returned when selected" }),
	label: Type.String({ description: "Display label for the option" }),
	description: Type.Optional(Type.String({ description: "Optional description shown below label" })),
});

const QuestionSchema = Type.Object({
	id: Type.String({ description: "Unique identifier for this question" }),
	label: Type.Optional(
		Type.String({
			description: "Short contextual label for the form, e.g. 'Scope', 'Priority' (defaults to Q1, Q2)",
		}),
	),
	prompt: Type.String({ description: "The full question text to display" }),
	options: Type.Array(QuestionOptionSchema, { description: "Available options to choose from" }),
	allowOther: Type.Optional(Type.Boolean({ description: "Allow 'Type something' option (default: true)" })),
	multiple: Type.Optional(
		Type.Boolean({
			description:
				"Allow selecting multiple options and entering multiple custom values for this question (default: false)",
		}),
	),
});

const QuestionnaireParams = Type.Object({
	questions: Type.Array(QuestionSchema, {
		description:
			"Questions to ask the user. Put every needed question in this array so the user can answer all questions in one interaction.",
	}),
});

function errorResult(
	message: string,
	questions: Question[] = [],
): { content: { type: "text"; text: string }[]; details: QuestionnaireResult } {
	return {
		content: [{ type: "text", text: message }],
		details: { questions, answers: [], cancelled: true },
	};
}

export function parseCustomEntries(value: string): string[] {
	const entries = value
		.split(/\r?\n|,/)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	return entries.length > 0 ? entries : ["(no response)"];
}

export function parseContextEntry(value: string): string[] {
	const trimmed = value.trim();
	return trimmed ? [trimmed] : [];
}

export function formatEntryLabels(entries: AnswerEntry[]): string {
	const primary = entries.filter((entry) => entry.kind !== "context").map((entry) => entry.label);
	const context = entries.filter((entry) => entry.kind === "context").map((entry) => entry.label);
	if (primary.length > 0 && context.length > 0) {
		return `${primary.join(", ")} ${context.join(" ")}`;
	}
	return [...primary, ...context].join(", ");
}

export function formatAnswerEntriesForText(entries: AnswerEntry[]): string {
	const primary = entries
		.filter((entry) => entry.kind !== "context")
		.map((entry) => {
			if (entry.wasCustom) {
				return `user wrote: ${entry.label}`;
			}
			return `user selected: ${entry.index}. ${entry.label}`;
		});
	const context = entries.filter((entry) => entry.kind === "context").map((entry) => entry.label);
	if (primary.length === 1 && context.length > 0) {
		return `${primary[0]} ${context.join(" ")}`;
	}
	return [...primary, ...context.map((entry) => `additional context: ${entry}`)].join("; ");
}

export function joinInlineText(label: string, inlineText: string[]): string {
	const suffix = inlineText.map((text) => text.trim()).filter((text) => text.length > 0).join(" ");
	return suffix ? `${label} ${suffix}` : label;
}

export function optionMarker(multiple: boolean, activeQuestion: boolean, selected: boolean): string {
	if (multiple) return selected ? "[x]" : "[ ]";
	if (selected) return activeQuestion ? "●" : "✓";
	return activeQuestion ? "○" : " ";
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Maximum content lines visible in the questionnaire when fully collapsed. */
export const MIN_COLLAPSED_CONTENT_LINES = 3;

const SCROLL_COLLAPSE_SYMBOL = Symbol.for("pi.scroll-collapse");

interface DockCollapseTarget {
	maxCollapseLines: number;
	onCollapseChange?: () => void;
}

interface ScrollCollapseStore {
	collapseLines: number;
	questionnaireTarget?: DockCollapseTarget;
	editorTarget?: DockCollapseTarget;
}

function getScrollCollapseStore(): ScrollCollapseStore {
	const holder = globalThis as Record<symbol, ScrollCollapseStore | undefined>;
	holder[SCROLL_COLLAPSE_SYMBOL] ??= {
		collapseLines: 0,
	};
	return holder[SCROLL_COLLAPSE_SYMBOL]!;
}

export function formatEditorCursorText(
	editor: Pick<Editor, "getText"> & Partial<Pick<Editor, "getLines" | "getCursor">>,
	inverse: (text: string) => string,
): string {
	const rawLines = editor.getLines?.() ?? editor.getText().split("\n");
	const lines = rawLines.length > 0 ? rawLines : [""];
	const fallbackLine = lines.length - 1;
	const cursor = editor.getCursor?.() ?? {
		line: fallbackLine,
		col: (lines[fallbackLine] ?? "").length,
	};
	const cursorLine = Math.max(0, Math.min(lines.length - 1, cursor.line));
	return lines
		.map((lineText, lineIndex) => {
			if (lineIndex !== cursorLine) return lineText;
			const col = Math.max(0, Math.min(lineText.length, cursor.col));
			const before = lineText.slice(0, col);
			const after = lineText.slice(col);
			if (after.length === 0) {
				return `${before}${CURSOR_MARKER}${inverse(" ")}`;
			}
			const firstGrapheme =
				graphemeSegmenter.segment(after)[Symbol.iterator]().next().value?.segment ?? after[0] ?? " ";
			const restAfter = after.slice(firstGrapheme.length);
			return `${before}${CURSOR_MARKER}${inverse(firstGrapheme)}${restAfter}`;
		})
		.join(" ");
}

export default function questionnaire(pi: ExtensionAPI) {
	pi.registerTool({
		name: "questionnaire",
		label: "Questionnaire",
		description:
			"Ask the user one or more questions in one interaction. Put all needed questions in the questions array instead of asking one question per tool call. For multiple questions, shows one form with every question. Set question.multiple=true when the user may select or enter multiple values.",
		parameters: QuestionnaireParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (ctx.mode !== "tui") {
				return errorResult("Error: UI not available (running in non-interactive mode)");
			}
			if (params.questions.length === 0) {
				return errorResult("Error: No questions provided");
			}

			// Normalize questions with defaults
			const questions: Question[] = params.questions.map((q, i) => ({
				...q,
				label: q.label || `Q${i + 1}`,
				allowOther: q.allowOther !== false,
				multiple: q.multiple === true,
			}));

			const isMulti = questions.length > 1;
			const showSubmit = isMulti || questions.some((q) => q.multiple);
			const submitTab = questions.length;
			const totalTabs = questions.length + 1; // questions + Submit

			// Herdr reports the agent as working while a tool runs. Emit herdr:blocked
			// while the form is open so Herdr reports blocked/awaiting input
			// instead. herdr-agent-state.ts counts these events and clears the
			// blocked state when it gets active: false. No listener = no-op.
			const blockedLabel = `Awaiting input: ${questions.map((q) => q.label).join(", ")}`;
			pi.events.emit("herdr:blocked", {
				active: true,
				label: blockedLabel,
			});
			const result = await ctx.ui.custom<QuestionnaireResult>(
				(tui, theme, _kb, done) => {
				// State
				let currentTab = 0;
				let inputMode = false;
				let inputPurpose: InputPurpose = "answer";
				let inputQuestionId: string | null = null;
				let inputOptionIndex: number | null = null;
				let scrollOffset = 0;
				let lastMaxScroll = 0;
				let manualScroll = false;
				let cancelArmed = false;
				let cachedWidth: number | undefined;
				let cachedRows: number | undefined;
				let cachedCollapseLines: number | undefined;
				let cachedLines: string[] | undefined;
				let lastRenderWidth = 80;
				let visibleRowTargets: (MouseTarget | undefined)[] = [];
				let pressedTarget: MouseTarget | undefined;
				let pressedLayoutTargets: (MouseTarget | undefined)[] | undefined;
				let lastReleasePoint: { x?: number; y?: number } | undefined;
				let isSubmitted = false;
				const answers = new Map<string, Answer>();
				const optionIndices = new Map<string, number>();
				const selectedOptions = new Map<string, Set<number>>();
				const customEntries = new Map<string, string[]>();
				const inlineContexts = new Map<string, Map<number, string[]>>();

				// Editor for "Type something" option
				const editorTheme: EditorTheme = {
					borderColor: (s) => theme.fg("accent", s),
					selectList: {
						selectedPrefix: (t) => theme.fg("accent", t),
						selectedText: (t) => theme.fg("accent", t),
						description: (t) => theme.fg("muted", t),
						scrollInfo: (t) => theme.fg("dim", t),
						noMatch: (t) => theme.fg("warning", t),
					},
				};
				const editor = new Editor(tui, editorTheme);

				// Helpers
				function invalidateCache() {
					cachedWidth = undefined;
					cachedRows = undefined;
					cachedCollapseLines = undefined;
					cachedLines = undefined;
				}

				function refresh() {
					invalidateCache();
					tui.requestRender();
				}

				const collapseStore = getScrollCollapseStore();
				collapseStore.collapseLines = 0;
				const questionnaireCollapseTarget: DockCollapseTarget = {
					maxCollapseLines: 0,
					onCollapseChange: refresh,
				};
				collapseStore.questionnaireTarget = questionnaireCollapseTarget;

				function expandQuestionnaire() {
					if (collapseStore.collapseLines !== 0) {
						collapseStore.collapseLines = 0;
						invalidateCache();
					}
				}

				function submit(cancelled: boolean) {
					if (isSubmitted) return;
					isSubmitted = true;
					done({ questions, answers: Array.from(answers.values()), cancelled });
				}

				function armOrCancel() {
					if (cancelArmed) {
						submit(true);
						return;
					}
					cancelArmed = true;
					refresh();
				}

				function clearCancelArmed(): boolean {
					if (!cancelArmed) return false;
					cancelArmed = false;
					return true;
				}

				function currentQuestion(): Question | undefined {
					return questions[currentTab];
				}

				function optionsFor(question: Question | undefined): RenderOption[] {
					if (!question) return [];
					const opts: RenderOption[] = [...question.options];
					if (question.allowOther) {
						opts.push({ value: "__other__", label: "Type something.", isOther: true });
					}
					return opts;
				}

				function currentOptions(): RenderOption[] {
					return optionsFor(currentQuestion());
				}

				function allAnswered(): boolean {
					return questions.every((q) => answers.has(q.id));
				}

				function selectedOptionIndexes(question: Question): Set<number> {
					const selected = selectedOptions.get(question.id);
					return selected ?? new Set<number>();
				}

				function customValues(question: Question): string[] {
					return customEntries.get(question.id) ?? [];
				}

				function contextValues(question: Question, optionIndex: number): string[] {
					return inlineContexts.get(question.id)?.get(optionIndex) ?? [];
				}

				function setContextValues(question: Question, optionIndex: number, values: string[]) {
					let questionContexts = inlineContexts.get(question.id);
					if (!questionContexts) {
						questionContexts = new Map<number, string[]>();
						inlineContexts.set(question.id, questionContexts);
					}
					questionContexts.set(optionIndex, values);
				}

				function hasMultipleEntries(question: Question): boolean {
					return selectedOptionIndexes(question).size > 0 || customValues(question).length > 0;
				}

				function getOptionIndex(question: Question): number {
					const opts = optionsFor(question);
					if (opts.length === 0) return 0;
					const index = optionIndices.get(question.id) ?? 0;
					return Math.max(0, Math.min(opts.length - 1, index));
				}

				function setOptionIndex(question: Question, index: number) {
					const opts = optionsFor(question);
					if (opts.length === 0) return;
					optionIndices.set(question.id, Math.max(0, Math.min(opts.length - 1, index)));
				}

				function advanceAfterAnswer() {
					if (!isMulti) {
						submit(false);
						return;
					}
					if (currentTab < questions.length - 1) {
						currentTab++;
					} else {
						currentTab = submitTab;
					}
					refresh();
				}

				function saveAnswerEntries(question: Question, entries: AnswerEntry[], multiple: boolean, index?: number) {
					if (entries.length === 0) {
						answers.delete(question.id);
						return;
					}
					answers.set(question.id, {
						id: question.id,
						value: entries.map((entry) => entry.value).join(", "),
						label: formatEntryLabels(entries),
						wasCustom: entries.some((entry) => entry.wasCustom),
						multiple,
						entries,
						index,
					});
				}

				function saveSingleAnswer(question: Question, value: string, label: string, wasCustom: boolean, index?: number) {
					const context = index === undefined ? [] : contextValues(question, index - 1);
					const baseEntry: AnswerEntry = {
						value: joinInlineText(value, context),
						label: joinInlineText(label, context),
						wasCustom,
						kind: wasCustom ? "custom" : "option",
						index,
					};
					saveAnswerEntries(question, [baseEntry], false, index);
				}

				function saveMultipleAnswer(question: Question) {
					const optionEntries = Array.from(selectedOptionIndexes(question))
						.sort((a, b) => a - b)
						.flatMap((optionIndex) => {
							const option = question.options[optionIndex];
							if (!option) return [];
							return [
								{
									value: joinInlineText(option.value, contextValues(question, optionIndex)),
									label: joinInlineText(option.label, contextValues(question, optionIndex)),
									wasCustom: false,
									kind: "option" as const,
									index: optionIndex + 1,
								},
							];
						});
					const customAnswerEntries = customValues(question).map((value) => ({
						value,
						label: value,
						wasCustom: true,
						kind: "custom" as const,
					}));
					const entries: AnswerEntry[] = [...optionEntries, ...customAnswerEntries];
					saveAnswerEntries(question, entries, true, entries.length === 1 ? entries[0]?.index : undefined);
				}

				function saveContextAnswer(question: Question, optionIndex: number, values: string[]) {
					// Replace, not append: the editor is prefilled with the full
					// accepted text, so submitting it is an edit of that text
					// (an empty value clears the context for this option).
					setContextValues(question, optionIndex, values);
					if (question.multiple) {
						saveMultipleAnswer(question);
						return;
					}
					const opt = question.options[optionIndex];
					if (opt) {
						saveSingleAnswer(question, opt.value, opt.label, false, optionIndex + 1);
					}
				}

				function openInlineContextInput(question: Question) {
					const optionIndex = getOptionIndex(question);
					const opt = currentOptions()[optionIndex];
					if (!opt || opt.isOther) {
						openCustomInput(question, "answer", optionIndex);
						return;
					}
					if (question.multiple) {
						const selected = new Set(selectedOptionIndexes(question));
						selected.add(optionIndex);
						selectedOptions.set(question.id, selected);
						saveMultipleAnswer(question);
					} else {
						saveSingleAnswer(question, opt.value, opt.label, false, optionIndex + 1);
					}
					openCustomInput(question, "context", optionIndex);
				}

				function existingInputText(question: Question, purpose: InputPurpose, optionIndex: number | null): string {
					if (purpose === "context" && optionIndex !== null) {
						return contextValues(question, optionIndex).join(" ");
					}
					if (question.multiple) {
						return customValues(question).join(", ");
					}
					const answer = answers.get(question.id);
					return (
						answer?.entries
							.filter((entry) => entry.kind === "custom")
							.map((entry) => entry.label)
							.join(", ") ?? ""
					);
				}

				function openCustomInput(question: Question, purpose: InputPurpose = "answer", optionIndex: number | null = null) {
					clearCancelArmed();
					inputMode = true;
					inputPurpose = purpose;
					inputQuestionId = question.id;
					inputOptionIndex = optionIndex;
					// Prefill with any already-accepted text so it can be edited
					// or cleared, not just appended to.
					editor.setText(existingInputText(question, purpose, optionIndex));
					refresh();
				}

				function toggleMultipleOption(question: Question, optionIndex: number) {
					if (optionIndex >= question.options.length) {
						// "Type something." is not toggleable, and only Tab enters
						// editing mode (Space/Enter never open the editor).
						return;
					}
					const selected = new Set(selectedOptionIndexes(question));
					if (selected.has(optionIndex)) {
						selected.delete(optionIndex);
					} else {
						selected.add(optionIndex);
					}
					selectedOptions.set(question.id, selected);
					saveMultipleAnswer(question);
					refresh();
				}

				function confirmCurrentQuestion() {
					const question = currentQuestion();
					if (!question) return;
					const opts = currentOptions();
					const optionIndex = getOptionIndex(question);
					const opt = opts[optionIndex];
					if (!opt) return;
					if (opt.isOther) {
						// Enter never enters editing mode (only Tab does). On
						// "Type something." Enter only confirms this question, and
						// only when an answer already exists to confirm.
						const hasAnswer = question.multiple
							? hasMultipleEntries(question)
							: answers.get(question.id)?.entries.some((entry) => entry.kind === "custom") === true;
						if (hasAnswer) {
							advanceAfterAnswer();
						}
						return;
					}
					if (question.multiple) {
						if (!hasMultipleEntries(question)) {
							toggleMultipleOption(question, optionIndex);
						}
						advanceAfterAnswer();
						return;
					}
					saveSingleAnswer(question, opt.value, opt.label, false, optionIndex + 1);
					advanceAfterAnswer();
				}

				function moveDown() {
					if (currentTab === submitTab) return;
					const question = currentQuestion();
					if (!question) return;
					const opts = currentOptions();
					const optionIndex = getOptionIndex(question);
					if (optionIndex < opts.length - 1) {
						setOptionIndex(question, optionIndex + 1);
					} else if (currentTab < questions.length - 1) {
						currentTab++;
					} else {
						currentTab = submitTab;
					}
					refresh();
				}

				function moveUp() {
					if (currentTab === submitTab) {
						currentTab = questions.length - 1;
						refresh();
						return;
					}
					const question = currentQuestion();
					if (!question) return;
					const optionIndex = getOptionIndex(question);
					if (optionIndex > 0) {
						setOptionIndex(question, optionIndex - 1);
					} else if (currentTab > 0) {
						currentTab--;
						const previous = currentQuestion();
						if (previous) {
							setOptionIndex(previous, optionsFor(previous).length - 1);
						}
					}
					refresh();
				}

				// Editor submit callback
				editor.onSubmit = (value) => {
					if (!inputQuestionId) return;
					const question = questions.find((q) => q.id === inputQuestionId);
					if (!question) return;
					if (inputPurpose === "context" && inputOptionIndex !== null) {
						saveContextAnswer(question, inputOptionIndex, parseContextEntry(value));
					} else if (question.multiple) {
						// Replace: the editor holds the full set of custom entries.
						// An emptied editor clears them instead of adding "(no response)".
						customEntries.set(question.id, value.trim() ? parseCustomEntries(value) : []);
						saveMultipleAnswer(question);
					} else {
						const trimmed = value.trim() || "(no response)";
						saveSingleAnswer(question, trimmed, trimmed, true);
					}
					inputMode = false;
					inputPurpose = "answer";
					inputQuestionId = null;
					inputOptionIndex = null;
					clearCancelArmed();
					editor.setText("");
					// Accepting edited text always returns to this question's
					// option list (never advances/submits). Enter outside
					// editing mode is what confirms the question.
					refresh();
				};

				function handleInput(data: string) {
					if (isSubmitted) return;
					pressedTarget = undefined;
					pressedLayoutTargets = undefined;
					lastReleasePoint = undefined;
					const isEscape = matchesKey(data, Key.escape);
					const clearedCancelArmed = !isEscape && clearCancelArmed();
					const kb = _kb as { matches?: (data: string, action: string) => boolean } | undefined;
					const isUp =
						matchesKey(data, Key.up) ||
						Boolean(kb?.matches?.(data, "tui.select.up")) ||
						data === "\x10" ||
						/^\x1b(?:\[(?:1;[0-9:]+)?A|OA|\[(?:57352|112;5)(?:;[0-9:]+)?u)$/.test(data);
					const isDown =
						matchesKey(data, Key.down) ||
						Boolean(kb?.matches?.(data, "tui.select.down")) ||
						data === "\x0e" ||
						/^\x1b(?:\[(?:1;[0-9:]+)?B|OB|\[(?:57353|110;5)(?:;[0-9:]+)?u)$/.test(data);

					manualScroll = false;
					if (isUp || isDown) {
						expandQuestionnaire();
					}

					// Input mode: route to editor
					if (inputMode) {
						if (matchesKey(data, Key.tab)) {
							// Tab accepts the typed text exactly like Enter (editor
							// submit) instead of being passed to the editor. The
							// submit handler returns to this question's option
							// list, so another option can be selected.
							editor.onSubmit?.(editor.getText());
							refresh();
							return;
						}
						if (isEscape) {
							clearCancelArmed();
							inputMode = false;
							inputPurpose = "answer";
							inputQuestionId = null;
							inputOptionIndex = null;
							editor.setText("");
							refresh();
							return;
						}
						editor.handleInput(data);
						refresh();
						return;
					}

					const question = currentQuestion();

					// Tab edits extra text inline on the selected option. Arrow keys still navigate between questions.
					if (matchesKey(data, Key.tab) && question) {
						openInlineContextInput(question);
						return;
					}

					// Question navigation (multi-question only)
					if (isMulti) {
						if (matchesKey(data, Key.right)) {
							currentTab = (currentTab + 1) % totalTabs;
							refresh();
							return;
						}
						if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
							currentTab = (currentTab - 1 + totalTabs) % totalTabs;
							refresh();
							return;
						}
					}

					// Submit action
					if (currentTab === submitTab) {
						if (matchesKey(data, Key.enter) && allAnswered()) {
							submit(false);
						} else if (isEscape) {
							armOrCancel();
						} else if (isUp) {
							moveUp();
						}
						return;
					}

					// Option navigation
					if (isUp) {
						moveUp();
						return;
					}
					if (isDown) {
						moveDown();
						return;
					}

					if (matchesKey(data, Key.space) && question) {
						if (question.multiple) {
							toggleMultipleOption(question, getOptionIndex(question));
						} else {
							confirmCurrentQuestion();
						}
						return;
					}

					// Select option or confirm current question
					if (matchesKey(data, Key.enter)) {
						confirmCurrentQuestion();
						return;
					}

					// Cancel after confirmation to avoid accidental exit.
					if (isEscape) {
						armOrCancel();
					} else if (clearedCancelArmed) {
						refresh();
					}
				}

				function sameMouseTarget(a: MouseTarget | undefined, b: MouseTarget | undefined): boolean {
					if (!a || !b || a.kind !== b.kind) return false;
					if (a.kind === "option" && b.kind === "option") {
						return a.questionIndex === b.questionIndex && a.optionIndex === b.optionIndex;
					}
					if (a.kind === "question" && b.kind === "question") {
						return a.questionIndex === b.questionIndex;
					}
					return true;
				}

				function scrollByWheel(delta: number): { handled: boolean; render: boolean } {
					let expanded = false;
					let remainingDelta = delta;
					if (delta > 0 && collapseStore.collapseLines > 0) {
						const maxCollapse = Math.max(0, Math.trunc(questionnaireCollapseTarget.maxCollapseLines));
						const currentCollapse = Math.max(0, Math.min(maxCollapse, collapseStore.collapseLines));
						const expandStep = Math.min(currentCollapse, delta);
						if (expandStep > 0) {
							collapseStore.collapseLines = currentCollapse - expandStep;
							remainingDelta = delta - expandStep;
							expanded = true;
							invalidateCache();
						}
					}
					if (remainingDelta !== 0 && lastMaxScroll > 0) {
						const nextOffset = Math.max(0, Math.min(lastMaxScroll, scrollOffset + remainingDelta));
						if (nextOffset !== scrollOffset) {
							scrollOffset = nextOffset;
							manualScroll = true;
							invalidateCache();
							return { handled: true, render: true };
						}
					}
					return { handled: true, render: expanded };
				}

				function getMouseTargetAt(
					event: QuestionnaireMouseEvent,
					rowTargetsSnapshot?: (MouseTarget | undefined)[],
				): MouseTarget | undefined {
					if (!rowTargetsSnapshot && !cachedLines) {
						render(typeof event.width === "number" && event.width > 0 ? event.width : lastRenderWidth);
					}
					const targets = rowTargetsSnapshot ?? visibleRowTargets;
					if (typeof event.x === "number" && Number.isFinite(event.x)) {
						const width = cachedWidth ?? lastRenderWidth;
						if (event.x < 0 || event.x >= width) {
							return undefined;
						}
					}
					if (typeof event.y !== "number" || !Number.isFinite(event.y)) {
						return undefined;
					}
					const row = Math.trunc(event.y);
					if (row < 0 || row >= targets.length) {
						return undefined;
					}
					return targets[row];
				}

				function previewMouseTarget(target: MouseTarget) {
					clearCancelArmed();
					if (inputMode) return;
					if (target.kind === "option") {
						const question = questions[target.questionIndex];
						if (!question) return;
						currentTab = target.questionIndex;
						setOptionIndex(question, target.optionIndex);
						manualScroll = true;
						refresh();
						return;
					}
					if (target.kind === "question") {
						if (!questions[target.questionIndex]) return;
						currentTab = target.questionIndex;
						manualScroll = true;
						refresh();
						return;
					}
					if (target.kind === "submit") {
						currentTab = submitTab;
						manualScroll = true;
						refresh();
					}
				}

				function activateMouseTarget(target: MouseTarget) {
					if (target.kind === "scroll-up") {
						if (scrollByWheel(-3).render) {
							tui.requestRender();
						}
						return;
					}
					if (target.kind === "scroll-down") {
						if (scrollByWheel(3).render) {
							tui.requestRender();
						}
						return;
					}

					clearCancelArmed();
					expandQuestionnaire();

					if (inputMode) {
						const clickedQuestion = target.kind === "option" ? questions[target.questionIndex] : undefined;
						const clickingActiveEditorOption =
							target.kind === "option" &&
							clickedQuestion?.id === inputQuestionId &&
							target.optionIndex === inputOptionIndex;
						const currentText = editor.getText();
						if (clickingActiveEditorOption) {
							if (currentText.trim().length > 0) {
								const wasAnswerPurpose = inputPurpose === "answer";
								editor.onSubmit?.(currentText);
								if (wasAnswerPurpose && clickedQuestion && !clickedQuestion.multiple) {
									manualScroll = false;
									advanceAfterAnswer();
								}
							} else {
								refresh();
							}
							return;
						}
						if (currentText.trim().length > 0) {
							editor.onSubmit?.(currentText);
						} else {
							if (inputPurpose === "context" && inputQuestionId && inputOptionIndex !== null) {
								const editedQuestion = questions.find((q) => q.id === inputQuestionId);
								if (editedQuestion && contextValues(editedQuestion, inputOptionIndex).length > 0) {
									saveContextAnswer(editedQuestion, inputOptionIndex, []);
								}
							} else if (inputPurpose === "answer" && inputQuestionId) {
								const editedQuestion = questions.find((q) => q.id === inputQuestionId);
								if (editedQuestion && editedQuestion.multiple && customValues(editedQuestion).length > 0) {
									customEntries.set(editedQuestion.id, []);
									saveMultipleAnswer(editedQuestion);
								}
							}
							inputMode = false;
							inputPurpose = "answer";
							inputQuestionId = null;
							inputOptionIndex = null;
							editor.setText("");
						}
					}

					if (target.kind === "question") {
						if (!questions[target.questionIndex]) return;
						currentTab = target.questionIndex;
						manualScroll = true;
						refresh();
						return;
					}

					if (target.kind === "submit") {
						currentTab = submitTab;
						if (allAnswered()) {
							submit(false);
						} else {
							manualScroll = true;
							refresh();
						}
						return;
					}

					const question = questions[target.questionIndex];
					if (!question) return;
					currentTab = target.questionIndex;
					setOptionIndex(question, target.optionIndex);
					const opts = optionsFor(question);
					const opt = opts[target.optionIndex];
					if (!opt) return;
					if (opt.isOther) {
						manualScroll = true;
						openCustomInput(question, "answer", target.optionIndex);
						return;
					}
					if (question.multiple) {
						manualScroll = true;
						toggleMultipleOption(question, target.optionIndex);
						return;
					}
					manualScroll = false;
					saveSingleAnswer(question, opt.value, opt.label, false, target.optionIndex + 1);
					advanceAfterAnswer();
				}

				function handleMouse(event: QuestionnaireMouseEvent) {
					if (isSubmitted) {
						return { handled: true, render: false };
					}
					if (event.type === "wheel") {
						pressedTarget = undefined;
						pressedLayoutTargets = undefined;
						lastReleasePoint = undefined;
						const delta =
							typeof event.wheelDelta === "number" && Number.isFinite(event.wheelDelta)
								? Math.trunc(event.wheelDelta)
								: 0;
						return scrollByWheel(delta);
					}
					if (event.button !== undefined && event.button !== "left") {
						return undefined;
					}
					if (event.type === "press") {
						lastReleasePoint = undefined;
						const target = getMouseTargetAt(event);
						pressedTarget = target;
						pressedLayoutTargets = target ? [...visibleRowTargets] : undefined;
						if (!target) {
							return undefined;
						}
						previewMouseTarget(target);
						return { handled: true, render: true };
					}
					if (event.type === "drag") {
						if (!pressedTarget) return undefined;
						return { handled: true, render: false };
					}
					if (event.type === "release") {
						const currentPressed = pressedTarget;
						const snapshot = pressedLayoutTargets;
						pressedTarget = undefined;
						pressedLayoutTargets = undefined;
						if (!currentPressed) return undefined;
						const target = getMouseTargetAt(event, snapshot);
						if (target && sameMouseTarget(currentPressed, target)) {
							lastReleasePoint = { x: event.x, y: event.y };
							activateMouseTarget(currentPressed);
							return { handled: true, render: true };
						}
						lastReleasePoint = undefined;
						return { handled: true, render: false };
					}
					if (event.type === "click") {
						if (
							lastReleasePoint &&
							lastReleasePoint.x === event.x &&
							lastReleasePoint.y === event.y
						) {
							lastReleasePoint = undefined;
							pressedTarget = undefined;
							pressedLayoutTargets = undefined;
							return { handled: true, render: true };
						}
						lastReleasePoint = undefined;
						const snapshot = pressedLayoutTargets;
						const target = getMouseTargetAt(event, snapshot) ?? pressedTarget;
						pressedTarget = undefined;
						pressedLayoutTargets = undefined;
						if (!target) {
							return undefined;
						}
						activateMouseTarget(target);
						return { handled: true, render: true };
					}
					return undefined;
				}

				function render(width: number): string[] {
					const renderWidth = Math.max(1, width);
					lastRenderWidth = renderWidth;
					const terminalRows = tui.terminal.rows;
					const currentCollapseRequest = collapseStore.collapseLines;
					if (
						cachedLines &&
						cachedWidth === renderWidth &&
						cachedRows === terminalRows &&
						cachedCollapseLines === currentCollapseRequest
					) {
						return cachedLines;
					}

					const lines: string[] = [];
					const contentLineTargets: (MouseTarget | undefined)[] = [];
					let activeLine = 0;
					let activeEndLine = 0;
					let activeQuestionLine = 0;
					let activeQuestionEndLine = 0;

					function markContentLines(startLine: number, endLine: number, target: MouseTarget) {
						for (let lineIdx = startLine; lineIdx <= endLine; lineIdx++) {
							contentLineTargets[lineIdx] = target;
						}
					}

					function addWrapped(text: string) {
						lines.push(...wrapTextWithAnsi(text.replace(/\t/g, "   "), renderWidth));
					}

					function addWrappedWithPrefix(prefix: string, text: string) {
						const normalizedText = text.replace(/\t/g, "   ");
						const prefixWidth = visibleWidth(prefix);
						if (prefixWidth >= renderWidth) {
							addWrapped(prefix + normalizedText);
							return;
						}
						const wrapped = wrapTextWithAnsi(normalizedText, renderWidth - prefixWidth);
						const continuationPrefix = " ".repeat(prefixWidth);
						for (let i = 0; i < wrapped.length; i++) {
							lines.push(`${i === 0 ? prefix : continuationPrefix}${wrapped[i]}`);
						}
					}

					function renderOptions(question: Question, questionIndex: number) {
						const opts = optionsFor(question);
						const activeQuestion = currentTab === questionIndex;
						const optionIndex = getOptionIndex(question);
						const answer = answers.get(question.id);
						const selected = selectedOptionIndexes(question);
						const custom = customValues(question);
						for (let i = 0; i < opts.length; i++) {
							const opt = opts[i];
							const activeOption = activeQuestion && i === optionIndex;
							const isOther = opt.isOther === true;
							if (activeOption) {
								activeLine = lines.length;
								activeEndLine = lines.length;
							}
							const prefix = activeOption ? theme.fg("accent", "> ") : "  ";
							const selectedSingle = !question.multiple && answer?.entries.some((entry) => entry.index === i + 1) === true;
							const selectedOther =
								isOther && (custom.length > 0 || (!question.multiple && answer?.entries.some((entry) => entry.kind === "custom") === true));
							const selectedOption = question.multiple ? selected.has(i) || selectedOther : selectedSingle || selectedOther;
							const marker = optionMarker(question.multiple, activeQuestion, selectedOption);
							const editingThisContext =
								!isOther &&
								inputMode &&
								inputPurpose === "context" &&
								inputQuestionId === question.id &&
								inputOptionIndex === i;
							const editingThisOther =
								isOther &&
								inputMode &&
								inputPurpose === "answer" &&
								inputQuestionId === question.id &&
								inputOptionIndex === i;
							const suffix = editingThisOther ? " ✎" : "";
							const cursorText = formatEditorCursorText(editor, (text) => theme.inverse(text));
							const context = !isOther && selectedOption && !editingThisContext ? contextValues(question, i).join(" ") : "";
							const contextInput = editingThisContext ? cursorText : "";
							const customText =
								isOther && !editingThisOther
									? question.multiple
										? custom.join(", ")
										: (answer?.entries.filter((entry) => entry.kind === "custom").map((entry) => entry.label).join(", ") ?? "")
									: "";
							const customInput = editingThisOther ? cursorText : "";
							const extraDisplay = [context, contextInput, customText, customInput]
								.filter((text) => text.length > 0)
								.join(" ");
							const labelContext = extraDisplay ? ` ${extraDisplay}` : "";
							const label = question.multiple
								? `${marker} ${opt.label}${labelContext}${suffix}`
								: `${marker} ${i + 1}. ${opt.label}${labelContext}${suffix}`;
							const color = activeOption ? "accent" : "text";

							const optionStartLine = lines.length;
							addWrappedWithPrefix(prefix, theme.fg(color, label));
							if (opt.description) {
								addWrappedWithPrefix("     ", theme.fg("muted", opt.description));
							}
							markContentLines(optionStartLine, lines.length - 1, {
								kind: "option",
								questionIndex,
								optionIndex: i,
							});
							if (activeOption) {
								activeEndLine = Math.max(activeLine, lines.length - 1);
							}
						}
					}

					function renderQuestion(question: Question, questionIndex: number) {
						const activeQuestion = currentTab === questionIndex;
						const questionLine = lines.length;
						const answer = answers.get(question.id);
						const status = answer ? theme.fg("success", " ✓") : "";
						const prefix = activeQuestion ? theme.fg("accent", "> ") : "  ";
						const label = isMulti ? theme.fg("muted", `${question.label}: `) : "";
						addWrappedWithPrefix(prefix, `${label}${theme.fg("text", question.prompt)}${status}`);
						markContentLines(questionLine, lines.length - 1, {
							kind: "question",
							questionIndex,
						});
						lines.push("");
						renderOptions(question, questionIndex);
						if (activeQuestion) {
							activeQuestionLine = questionLine;
							activeQuestionEndLine = Math.max(questionLine, lines.length - 1);
						}
					}

					lines.push(theme.fg("accent", "─".repeat(renderWidth)));

					if (isMulti) {
						addWrappedWithPrefix(" ", theme.fg("accent", theme.bold("Answer all questions")));
						lines.push("");
					}

					for (let i = 0; i < questions.length; i++) {
						renderQuestion(questions[i], i);
						lines.push("");
					}

					if (showSubmit) {
						const submitStartLine = lines.length;
						const activeSubmit = currentTab === submitTab;
						if (activeSubmit) {
							activeLine = lines.length;
							activeEndLine = lines.length;
						}
						const submitPrefix = activeSubmit ? theme.fg("accent", "> ") : "  ";
						const canSubmit = allAnswered();
						addWrappedWithPrefix(submitPrefix, theme.fg(canSubmit ? "success" : "dim", "✓ Submit answers"));
						if (canSubmit) {
							addWrappedWithPrefix("  ", theme.fg("success", "Press Enter to submit"));
						} else {
							const missing = questions
								.filter((q) => !answers.has(q.id))
								.map((q) => q.label)
								.join(", ");
							addWrappedWithPrefix("  ", theme.fg("warning", `Unanswered: ${missing}`));
						}
						markContentLines(submitStartLine, lines.length - 1, { kind: "submit" });
						if (activeSubmit) {
							activeEndLine = Math.max(activeLine, lines.length - 1);
						}
						lines.push("");
					}

					if (inputMode) {
						addWrappedWithPrefix(" ", theme.fg("dim", "Type inline • Enter/Tab accept text • Esc cancel input"));
					} else if (cancelArmed) {
						addWrappedWithPrefix(" ", theme.fg("warning", "Press Esc again to cancel questionnaire"));
					} else {
						const activeQuestion = currentQuestion();
						const help = activeQuestion?.multiple
							? "←→ change question • ↑↓ move • Space toggle • Tab edit selected option • Enter confirm/submit • Esc then Esc cancel"
							: isMulti
								? "←→ change question • ↑↓ move • Tab edit selected option • Enter select/submit • Esc then Esc cancel"
								: "↑↓ navigate • Tab edit selected option • Enter select • Esc then Esc cancel";
						addWrappedWithPrefix(" ", theme.fg("dim", help));
					}
					lines.push(theme.fg("accent", "─".repeat(renderWidth)));

					const baseViewportHeight = Math.max(8, Math.min(28, terminalRows - 8));
					const fullViewportHeight = Math.min(lines.length, baseViewportHeight);
					const minViewportHeight = Math.min(fullViewportHeight, MIN_COLLAPSED_CONTENT_LINES + 2);
					const maxCollapseLines = Math.max(0, fullViewportHeight - minViewportHeight);
					questionnaireCollapseTarget.maxCollapseLines = maxCollapseLines;
					const collapseLines = Math.max(0, Math.min(maxCollapseLines, currentCollapseRequest));
					const viewportHeight = fullViewportHeight - collapseLines;

					if (lines.length <= viewportHeight) {
						lastMaxScroll = 0;
						scrollOffset = 0;
						visibleRowTargets = Array.from({ length: lines.length }, (_, idx) => contentLineTargets[idx]);
						cachedWidth = renderWidth;
						cachedRows = terminalRows;
						cachedCollapseLines = currentCollapseRequest;
						cachedLines = lines;
						return lines;
					}

					const maxScroll = Math.max(0, lines.length - viewportHeight);
					lastMaxScroll = maxScroll;
					if (!manualScroll) {
						const scrollMargin = viewportHeight >= 7 ? 2 : 1;
						const activeQuestionHeight = activeQuestionEndLine - activeQuestionLine + 1;
						const canRevealActiveQuestion =
							currentTab !== submitTab && activeQuestionHeight <= viewportHeight - scrollMargin * 2;
						const canRevealQuestionThroughActiveOption =
							currentTab !== submitTab && activeEndLine - activeQuestionLine + 1 <= viewportHeight - scrollMargin * 2;
						const targetLine =
							canRevealActiveQuestion || canRevealQuestionThroughActiveOption ? activeQuestionLine : activeLine;
						const targetEndLine = canRevealActiveQuestion ? activeQuestionEndLine : activeEndLine;
						if (targetLine < scrollOffset + scrollMargin) {
							scrollOffset = Math.max(0, targetLine - scrollMargin);
						} else if (targetEndLine >= scrollOffset + viewportHeight - scrollMargin) {
							scrollOffset = Math.min(maxScroll, targetEndLine - viewportHeight + scrollMargin + 1);
						}
					}
					scrollOffset = Math.max(0, Math.min(maxScroll, scrollOffset));

					const visible = lines.slice(scrollOffset, scrollOffset + viewportHeight);
					visibleRowTargets = Array.from(
						{ length: visible.length },
						(_, idx) => contentLineTargets[scrollOffset + idx],
					);
					if (scrollOffset > 0) {
						visible[0] = theme.fg("dim", `↑ ${scrollOffset} more`);
						visibleRowTargets[0] = { kind: "scroll-up" };
					}
					const hiddenBelow = lines.length - (scrollOffset + viewportHeight);
					if (hiddenBelow > 0) {
						visible[visible.length - 1] = theme.fg("dim", `↓ ${hiddenBelow} more`);
						visibleRowTargets[visible.length - 1] = { kind: "scroll-down" };
					}
					cachedWidth = renderWidth;
					cachedRows = terminalRows;
					cachedCollapseLines = currentCollapseRequest;
					cachedLines = visible;
					return visible;
				}

				return {
					render,
					invalidate: invalidateCache,
					handleInput,
					handleMouse,
				};
				},
				{ blocked: { kind: "question", message: blockedLabel } } as never,
			).finally(() => {
				const store = getScrollCollapseStore();
				store.questionnaireTarget = undefined;
				store.collapseLines = 0;
				pi.events.emit("herdr:blocked", { active: false });
			});

			if (result.cancelled) {
				return {
					content: [{ type: "text", text: "User cancelled the questionnaire" }],
					details: result,
				};
			}

			const answerLines = result.answers.map((answer) => {
				const qLabel = questions.find((q) => q.id === answer.id)?.label || answer.id;
				return `${qLabel}: ${formatAnswerEntriesForText(answer.entries)}`;
			});

			return {
				content: [{ type: "text", text: answerLines.join("\n") }],
				details: result,
			};
		},

		renderCall(args, theme, _context) {
			const qs = (args.questions as Question[]) || [];
			const count = qs.length;
			const labels = qs.map((q) => q.label || q.id).join(", ");
			let text = theme.fg("toolTitle", theme.bold("questionnaire "));
			text += theme.fg("muted", `${count} question${count !== 1 ? "s" : ""}`);
			if (labels) {
				text += theme.fg("dim", ` (${labels})`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as QuestionnaireResult | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			if (details.cancelled) {
				return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			}
			const lines = details.answers.map((answer) => {
				const primary = answer.entries
					.filter((entry) => entry.kind !== "context")
					.map((entry) => {
						if (entry.wasCustom) {
							return `${theme.fg("muted", "(wrote) ")}${entry.label}`;
						}
						return entry.index ? `${entry.index}. ${entry.label}` : entry.label;
					});
				const context = answer.entries.filter((entry) => entry.kind === "context").map((entry) => entry.label);
				const display =
					primary.length > 0 && context.length > 0
						? `${primary.join(", ")} ${context.join(" ")}`
						: [...primary, ...context].join(", ");
				return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${display}`;
			});
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
