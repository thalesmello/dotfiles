import { spawnSync } from "node:child_process";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type TextContent = {
	type?: string;
	text?: unknown;
};

type BranchEntry = {
	type?: string;
	message?: {
		role?: string;
		content?: unknown;
		stopReason?: string;
	};
};

const CLIPBOARD_TIMEOUT_MS = 5_000;
const WHOLE_MESSAGE_CHOICE = "Whole response";
const EDIT_CHOICE = "Edit/custom snippet...";

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.map((part) => {
			if (typeof part === "string") return part;
			if (!part || typeof part !== "object") return "";
			const block = part as TextContent;
			return block.type === "text" && typeof block.text === "string" ? block.text : "";
		})
		.filter(Boolean)
		.join("\n");
}

function lastAssistantText(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch() as BranchEntry[];
	for (let i = branch.length - 1; i >= 0; i -= 1) {
		const entry = branch[i];
		if (entry.type !== "message" || entry.message?.role !== "assistant") continue;

		const text = textOf(entry.message.content);
		if (text) return text;
	}
	return undefined;
}

function runClipboardCommand(command: string, args: string[], text: string): true | string {
	const result = spawnSync(command, args, {
		input: text,
		encoding: "utf-8",
		timeout: CLIPBOARD_TIMEOUT_MS,
		stdio: ["pipe", "ignore", "pipe"],
	});

	if (result.error) return result.error.message;
	if (result.status !== 0) {
		return result.stderr?.toString().trim() || `${command} exited with status ${result.status}`;
	}
	return true;
}

function copyToClipboard(text: string): true | string {
	if (process.platform === "darwin") {
		return runClipboardCommand("pbcopy", [], text);
	}

	if (process.platform === "win32") {
		return runClipboardCommand(
			"powershell.exe",
			["-NoProfile", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
			text,
		);
	}

	const attempts: Array<[string, string[]]> = [
		["wl-copy", []],
		["xclip", ["-selection", "clipboard"]],
		["xsel", ["--clipboard", "--input"]],
	];

	const errors: string[] = [];
	for (const [command, args] of attempts) {
		const result = runClipboardCommand(command, args, text);
		if (result === true) return true;
		errors.push(`${command}: ${result}`);
	}

	return errors.join("; ");
}

interface CopyCandidate {
	label: string;
	text: string;
}

function truncateOneLine(text: string, max = 72): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function countLines(text: string): number {
	return text.length === 0 ? 0 : text.split("\n").length;
}

function extractCodeBlocks(markdown: string): CopyCandidate[] {
	const candidates: CopyCandidate[] = [];
	const fenceRegex = /(^|\n)(```|~~~)([^\n]*)\n([\s\S]*?)(?:\n\2(?=\n|$)|$)/g;
	let match: RegExpExecArray | null;
	let index = 0;

	while ((match = fenceRegex.exec(markdown)) !== null) {
		const info = (match[3] ?? "").trim();
		const code = match[4] ?? "";
		if (!code.trim()) continue;

		index += 1;
		const language = info.split(/\s+/)[0] || "code";
		const lines = countLines(code);
		const preview = truncateOneLine(code.split("\n").find((line) => line.trim()) ?? code);
		candidates.push({
			label: `Code block ${index} (${language}, ${lines} ${lines === 1 ? "line" : "lines"}) — ${preview}`,
			text: code,
		});
	}

	return candidates;
}

function copyChosenText(ctx: ExtensionContext, text: string): void {
	if (!text.length) {
		ctx.ui.notify("Nothing copied: snippet is empty", "warning");
		return;
	}

	const result = copyToClipboard(text);
	if (result === true) {
		ctx.ui.notify(`Copied ${text.length.toLocaleString()} characters`, "info");
	} else {
		ctx.ui.notify(`Copy failed: ${result}`, "error");
	}
}

async function chooseAndCopySnippet(ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) {
		return;
	}

	const lastMessage = lastAssistantText(ctx);
	if (!lastMessage) {
		ctx.ui.notify("No assistant message found to copy", "error");
		return;
	}

	const codeBlocks = extractCodeBlocks(lastMessage);
	const choices = [WHOLE_MESSAGE_CHOICE, ...codeBlocks.map((candidate) => candidate.label), EDIT_CHOICE];
	const selected = await ctx.ui.select("What should /copy copy?", choices);

	if (!selected) {
		ctx.ui.notify("Copy cancelled", "info");
		return;
	}

	if (selected === WHOLE_MESSAGE_CHOICE) {
		copyChosenText(ctx, lastMessage);
		return;
	}

	if (selected === EDIT_CHOICE) {
		const snippet = await ctx.ui.editor("Edit/custom snippet to copy", lastMessage);
		if (snippet === undefined) {
			ctx.ui.notify("Copy cancelled", "info");
			return;
		}
		copyChosenText(ctx, snippet);
		return;
	}

	const candidate = codeBlocks.find((block) => block.label === selected);
	if (!candidate) {
		ctx.ui.notify("Copy cancelled", "info");
		return;
	}

	copyChosenText(ctx, candidate.text);
}

function selectedAutocompleteValue(editor: unknown): string | undefined {
	const selected = (editor as { autocompleteList?: { getSelectedItem?: () => { value?: unknown; label?: unknown } } })
		.autocompleteList?.getSelectedItem?.();
	const value = selected?.value ?? selected?.label;
	return typeof value === "string" ? value : undefined;
}

function installSnippetCopyEditor(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") return;

	ctx.ui.setEditorComponent((tui, theme, keybindings) => {
		class SnippetCopyEditor extends CustomEditor {
			override handleInput(data: string): void {
				const isSubmit = keybindings.matches(data, "tui.input.submit");
				const isCopyShortcut = keybindings.matches(data, "app.message.copy");
				const selectedCommand = selectedAutocompleteValue(this);
				const isCopyCommand = this.getText().trim() === "/copy" || selectedCommand === "copy";

				if ((isSubmit && isCopyCommand) || isCopyShortcut) {
					this.addToHistory(isCopyCommand ? "/copy" : this.getText());
					this.setText("");
					void chooseAndCopySnippet(ctx);
					return;
				}

				super.handleInput(data);
			}
		}

		return new SnippetCopyEditor(tui, theme, keybindings);
	});
}

export default function copySnippetExtension(pi: ExtensionAPI): void {
	// In TUI mode, built-in slash commands are handled before the extension
	// `input` event. A custom editor lets us catch `/copy` and Ctrl+X before the
	// built-in copy handler copies the whole last assistant message.
	pi.on("session_start", (_event, ctx) => installSnippetCopyEditor(ctx));

	// Keep the same behaviour for RPC/prompt submissions, where `/copy` reaches
	// extension input handlers.
	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") {
			return { action: "continue" };
		}

		if (event.text.trim() !== "/copy") {
			return { action: "continue" };
		}

		await chooseAndCopySnippet(ctx);
		return { action: "handled" };
	});
}
