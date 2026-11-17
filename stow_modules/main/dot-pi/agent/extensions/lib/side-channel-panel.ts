import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, truncateToWidth } from "@earendil-works/pi-tui";
import { getScrollCollapseStore, MIN_COLLAPSED_CONTENT_LINES, type DockCollapseTarget } from "../follow-on-send.ts";

interface PanelMouseEvent { type?: string; wheelDelta?: number }

/** A disposable dock panel, using the same transcript-scroll collapse target as questionnaire. */
export async function showSideChannelAnswer(
	title: string,
	prompt: string,
	answer: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	if (ctx.mode !== "tui") {
		if (ctx.hasUI) ctx.ui.notify(`${title}\n\n${answer}`, "warning");
		return;
	}

	const store = getScrollCollapseStore();
	const previousTarget = store.questionnaireTarget;
	const previousCollapse = store.collapseLines;
	let target: DockCollapseTarget | undefined;

	try {
		await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
			let scrollOffset = 0;
			let maxScroll = 0;
			let cachedWidth: number | undefined;
			let cachedBody: string[] | undefined;
			const body = prompt ? `${prompt}\n\n${answer}` : answer;
			const invalidate = () => {
				cachedWidth = undefined;
				cachedBody = undefined;
			};
			const refresh = () => { invalidate(); tui.requestRender(); };
			target = { maxCollapseLines: 0, onCollapseChange: refresh };
			// This slot represents the foreground custom dock, not just questionnaires.
			// Register only while visible; never add an entry or a model-context message.
			store.questionnaireTarget = target;
			store.collapseLines = 0;

			return {
				render(width: number): string[] {
					const renderWidth = Math.max(1, width);
					if (!cachedBody || cachedWidth !== renderWidth) {
						cachedBody = new Markdown(body, 1, 0, getMarkdownTheme()).render(renderWidth);
						cachedWidth = renderWidth;
					}
					const terminalRows = Math.max(1, tui.terminal.rows);
					const fullHeight = Math.min(cachedBody.length, Math.max(1, Math.min(24, terminalRows - 8)));
					const minHeight = Math.min(fullHeight, MIN_COLLAPSED_CONTENT_LINES);
					target!.maxCollapseLines = Math.max(0, fullHeight - minHeight);
					const collapse = Math.max(0, Math.min(target!.maxCollapseLines, store.collapseLines));
					const height = fullHeight - collapse;
					maxScroll = Math.max(0, cachedBody.length - height);
					scrollOffset = Math.max(0, Math.min(maxScroll, scrollOffset));
					const visible = cachedBody.slice(scrollOffset, scrollOffset + height);
					const hiddenBelow = cachedBody.length - scrollOffset - visible.length;
					const position = [scrollOffset ? `↑ ${scrollOffset} above` : "", hiddenBelow ? `↓ ${hiddenBelow} below` : ""]
						.filter(Boolean).join(" · ");
					const help = `${position ? `${position} · ` : ""}↑↓/wheel read · Enter/Esc close`;
					const border = theme.fg("warning", "─".repeat(renderWidth));
					// Keep chrome to one line each; omit it when the terminal is too short.
					return [
						...(terminalRows >= 6 ? [border] : []),
						...(terminalRows >= 2 ? [truncateToWidth(theme.fg("warning", theme.bold(title)), renderWidth)] : []),
						...visible,
						...(terminalRows >= 3 ? [truncateToWidth(theme.fg("dim", help), renderWidth)] : []),
						...(terminalRows >= 6 ? [border] : []),
					];
				},
				invalidate,
				handleMouse(event: PanelMouseEvent): { handled: boolean; render: boolean } | undefined {
					if (event.type !== "wheel") return undefined;
					const delta = typeof event.wheelDelta === "number" && Number.isFinite(event.wheelDelta)
						? Math.trunc(event.wheelDelta) : 0;
					if (delta === 0) return { handled: true, render: false };
					if (store.collapseLines > 0) {
						// The first wheel gesture only restores the collapsed panel height.
						store.collapseLines = 0;
						refresh();
						return { handled: true, render: false };
					}
					const next = Math.max(0, Math.min(maxScroll, scrollOffset + delta));
					if (next !== scrollOffset) {
						scrollOffset = next;
						refresh();
					}
					return { handled: true, render: false };
				},
				handleInput(data: string): void {
					if (keybindings.matches(data, "tui.select.confirm") || keybindings.matches(data, "tui.select.cancel")) {
						done();
						return;
					}
					if (keybindings.matches(data, "tui.select.up") || keybindings.matches(data, "tui.select.down")) {
						store.collapseLines = 0;
						const delta = keybindings.matches(data, "tui.select.up") ? -1 : 1;
						scrollOffset = Math.max(0, Math.min(maxScroll, scrollOffset + delta));
						refresh();
					}
					// PageUp/PageDown and transcript wheel scrolling remain owned by Pi.
				},
			};
		});
	} finally {
		if (store.questionnaireTarget === target) {
			store.questionnaireTarget = previousTarget;
			store.collapseLines = previousTarget ? previousCollapse : 0;
			(previousTarget ?? store.editorTarget)?.onCollapseChange?.();
		}
	}
}
