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

function isTextInput(data: string): boolean {
	return data.length > 0 && !data.includes("\x1b") && !/^[\x00-\x1f\x7f]+$/.test(data);
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
			const submitTab = questions.length;
			const totalTabs = questions.length + 1; // questions + Submit

			// Herdr reports the agent as working while a tool runs. Emit herdr:blocked
			// while the form is open so Herdr reports blocked/awaiting input
			// instead. herdr-agent-state.ts counts these events and clears the
			// blocked state when it gets active: false. No listener = no-op.
			pi.events.emit("herdr:blocked", {
				active: true,
				label: `Awaiting input: ${questions.map((q) => q.label).join(", ")}`,
			});
			const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, _kb, done) => {
				// State
				let currentTab = 0;
				let inputMode = false;
				let inputPurpose: InputPurpose = "answer";
				let inputQuestionId: string | null = null;
				let inputOptionIndex: number | null = null;
				let scrollOffset = 0;
				let cancelArmed = false;
				let cachedLines: string[] | undefined;
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
				function refresh() {
					cachedLines = undefined;
					tui.requestRender();
				}

				function submit(cancelled: boolean) {
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
						opts.push({ value: "__other__", label: "Type something (start typing).", isOther: true });
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
					if (values.length > 0) {
						setContextValues(question, optionIndex, [...contextValues(question, optionIndex), ...values]);
					}
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

				function openCustomInput(question: Question, purpose: InputPurpose = "answer", optionIndex: number | null = null) {
					clearCancelArmed();
					inputMode = true;
					inputPurpose = purpose;
					inputQuestionId = question.id;
					inputOptionIndex = optionIndex;
					editor.setText("");
					refresh();
				}

				function toggleMultipleOption(question: Question, optionIndex: number) {
					if (optionIndex >= question.options.length) {
						openCustomInput(question, "answer", optionIndex);
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
					if (question.multiple) {
						if (opt.isOther) {
							openCustomInput(question, "answer", optionIndex);
							return;
						}
						if (!hasMultipleEntries(question)) {
							toggleMultipleOption(question, optionIndex);
						}
						advanceAfterAnswer();
						return;
					}
					if (opt.isOther) {
						openCustomInput(question, "answer", optionIndex);
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
						customEntries.set(question.id, [...customValues(question), ...parseCustomEntries(value)]);
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
					advanceAfterAnswer();
				};

				function handleInput(data: string) {
					const isEscape = matchesKey(data, Key.escape);
					const clearedCancelArmed = !isEscape && clearCancelArmed();

					// Input mode: route to editor
					if (inputMode) {
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
						} else if (matchesKey(data, Key.up)) {
							moveUp();
						}
						return;
					}

					// Option navigation
					if (matchesKey(data, Key.up)) {
						moveUp();
						return;
					}
					if (matchesKey(data, Key.down)) {
						moveDown();
						return;
					}

					const opt = question ? currentOptions()[getOptionIndex(question)] : undefined;
					if (matchesKey(data, Key.space) && question) {
						if (question.multiple) {
							toggleMultipleOption(question, getOptionIndex(question));
						} else {
							confirmCurrentQuestion();
						}
						return;
					}

					if (question && opt?.isOther && isTextInput(data)) {
						openCustomInput(question, "answer", getOptionIndex(question));
						editor.handleInput(data);
						refresh();
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

				function render(width: number): string[] {
					if (cachedLines) return cachedLines;

					const lines: string[] = [];
					const renderWidth = Math.max(1, width);
					let activeLine = 0;
					let activeEndLine = 0;
					let activeQuestionLine = 0;
					let activeQuestionEndLine = 0;

					function addWrapped(text: string) {
						lines.push(...wrapTextWithAnsi(text, renderWidth));
					}

					function addWrappedWithPrefix(prefix: string, text: string) {
						const prefixWidth = visibleWidth(prefix);
						if (prefixWidth >= renderWidth) {
							addWrapped(prefix + text);
							return;
						}
						const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
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
							const suffix = isOther && inputMode && inputQuestionId === question.id ? " ✎" : "";
							const cursorText = `${editor.getText()}${CURSOR_MARKER}${theme.inverse(" ")}`;
							const context = !isOther && selectedOption ? contextValues(question, i).join(" ") : "";
							const contextInput =
								!isOther && inputMode && inputPurpose === "context" && inputQuestionId === question.id && inputOptionIndex === i
									? cursorText
									: "";
							const customText = isOther
								? question.multiple
									? custom.join(", ")
									: (answer?.entries.filter((entry) => entry.kind === "custom").map((entry) => entry.label).join(", ") ?? "")
								: "";
							const customInput =
								isOther && inputMode && inputPurpose === "answer" && inputQuestionId === question.id && inputOptionIndex === i
									? cursorText
									: "";
							const extraDisplay = [context, contextInput, customText, customInput]
								.filter((text) => text.length > 0)
								.join(" ");
							const labelContext = extraDisplay ? ` ${extraDisplay}` : "";
							const label = question.multiple
								? `${marker} ${opt.label}${labelContext}${suffix}`
								: `${marker} ${i + 1}. ${opt.label}${labelContext}${suffix}`;
							const color = activeOption || (isOther && inputMode && inputQuestionId === question.id) ? "accent" : "text";

							addWrappedWithPrefix(prefix, theme.fg(color, label));
							if (opt.description) {
								addWrappedWithPrefix("     ", theme.fg("muted", opt.description));
							}
							if (activeOption) {
								activeEndLine = Math.max(activeLine, lines.length - 1);
							}
						}
					}

					function renderQuestion(question: Question, questionIndex: number) {
						const activeQuestion = currentTab === questionIndex;
						const questionLine = lines.length;
						const answer = answers.get(question.id);
						const status = answer ? theme.fg("success", " ✓") : theme.fg("muted", "");
						const prefix = activeQuestion ? theme.fg("accent", "> ") : "  ";
						const label = isMulti ? theme.fg("muted", `${question.label}: `) : "";
						addWrappedWithPrefix(prefix, `${label}${theme.fg("text", question.prompt)}${status}`);
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

					if (isMulti) {
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
						if (activeSubmit) {
							activeEndLine = Math.max(activeLine, lines.length - 1);
						}
						lines.push("");
					}

					if (inputMode) {
						addWrappedWithPrefix(" ", theme.fg("dim", "Type inline • Enter submit text • Esc cancel input"));
					} else if (cancelArmed) {
						addWrappedWithPrefix(" ", theme.fg("warning", "Press Esc again to cancel questionnaire"));
					} else {
						const activeQuestion = currentQuestion();
						const help = activeQuestion?.multiple
							? "←→ change question • ↑↓ move • Space toggle • Tab edit selected option • Type on Other • Enter confirm/submit • Esc then Esc cancel"
							: isMulti
								? "←→ change question • ↑↓ move • Type on Other • Tab edit selected option • Enter select/submit • Esc then Esc cancel"
								: "↑↓ navigate • Type on Other • Tab edit selected option • Enter select • Esc then Esc cancel";
						addWrappedWithPrefix(" ", theme.fg("dim", help));
					}
					lines.push(theme.fg("accent", "─".repeat(renderWidth)));

					const viewportHeight = Math.max(8, Math.min(28, tui.terminal.rows - 8));
					if (lines.length <= viewportHeight) {
						cachedLines = lines;
						return lines;
					}

					const scrollMargin = 2;
					const activeQuestionHeight = activeQuestionEndLine - activeQuestionLine + 1;
					const canRevealActiveQuestion =
						currentTab !== submitTab && activeQuestionHeight <= viewportHeight - scrollMargin * 2;
					const targetLine = canRevealActiveQuestion ? activeQuestionLine : activeLine;
					const targetEndLine = canRevealActiveQuestion ? activeQuestionEndLine : activeEndLine;
					const maxScroll = Math.max(0, lines.length - viewportHeight);
					if (targetLine < scrollOffset + scrollMargin) {
						scrollOffset = Math.max(0, targetLine - scrollMargin);
					} else if (targetEndLine >= scrollOffset + viewportHeight - scrollMargin) {
						scrollOffset = Math.min(maxScroll, targetEndLine - viewportHeight + scrollMargin + 1);
					}
					scrollOffset = Math.max(0, Math.min(maxScroll, scrollOffset));

					const visible = lines.slice(scrollOffset, scrollOffset + viewportHeight);
					if (scrollOffset > 0) {
						visible[0] = theme.fg("dim", `↑ ${scrollOffset} more`);
					}
					const hiddenBelow = lines.length - (scrollOffset + viewportHeight);
					if (hiddenBelow > 0) {
						visible[visible.length - 1] = theme.fg("dim", `↓ ${hiddenBelow} more`);
					}
					cachedLines = visible;
					return visible;
				}

				return {
					render,
					invalidate: () => {
						cachedLines = undefined;
					},
					handleInput,
				};
			}).finally(() => {
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
