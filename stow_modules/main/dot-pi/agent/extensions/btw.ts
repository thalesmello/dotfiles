import type { UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, DynamicBorder, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, matchesKey, Text } from "@earendil-works/pi-tui";

const SYSTEM_PROMPT = `You are /btw, a private side-channel helper inside a Pi session.
Answer the user's question about the supplied prompt snapshot without changing or continuing the main conversation.
Use only the snapshot. If the answer is not visible in it, say so.
Be direct and concise. Do not propose tool calls or next actions unless the user explicitly asks.
When the question is about instructions or hidden prompt state, answer from the visible snapshot and avoid inventing details.`;

const MAX_SYSTEM_CHARS = 24_000;
const MAX_TRANSCRIPT_CHARS = 72_000;
const MAX_MESSAGE_CHARS = 8_000;
const MAX_JSON_CHARS = 2_000;

type ContentBlock = {
	type?: string;
	text?: unknown;
	name?: unknown;
	arguments?: unknown;
	content?: unknown;
	toolCallId?: unknown;
};

type BranchEntry = {
	type?: string;
	message?: {
		role?: string;
		content?: unknown;
	};
};

type BtwResult =
	| {
			answer: string;
	  }
	| {
			error: string;
	  }
	| null;

function compact(text: string, max: number): string {
	if (text.length <= max) return text;
	const keepHead = Math.floor(max * 0.35);
	const keepTail = max - keepHead;
	const omitted = text.length - keepHead - keepTail;
	return `${text.slice(0, keepHead)}\n\n[… ${omitted.toLocaleString()} characters omitted …]\n\n${text.slice(-keepTail)}`;
}

function stringify(value: unknown, max = MAX_JSON_CHARS): string {
	try {
		return compact(JSON.stringify(value, null, 2), max);
	} catch {
		return String(value);
	}
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const raw of content) {
		if (typeof raw === "string") {
			parts.push(raw);
			continue;
		}
		if (!raw || typeof raw !== "object") continue;

		const block = raw as ContentBlock;
		if (block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
			continue;
		}
		if (block.type === "toolCall") {
			const name = typeof block.name === "string" ? block.name : "unknown";
			parts.push(`[tool call: ${name} ${stringify(block.arguments)}]`);
			continue;
		}
		if (block.type === "toolResult") {
			const id = typeof block.toolCallId === "string" ? ` ${block.toolCallId}` : "";
			const body = textOf(block.content) || stringify(block.content ?? block);
			parts.push(`[tool result${id}]\n${body}`);
			continue;
		}
		if (block.type === "image") {
			parts.push("[image]");
			continue;
		}
		if (typeof block.text === "string") {
			parts.push(block.text);
		}
	}

	return parts.join("\n");
}

function buildTranscript(entries: BranchEntry[]): string {
	const sections: string[] = [];
	let index = 0;

	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message?.role) continue;
		const role = entry.message.role;
		const body = compact(textOf(entry.message.content).trim(), MAX_MESSAGE_CHARS);
		if (!body) continue;
		index += 1;
		sections.push(`## ${index}. ${role}\n${body}`);
	}

	return sections.join("\n\n---\n\n");
}

function buildPromptSnapshot(ctx: ExtensionCommandContext): string {
	const sections: string[] = [];

	const systemPrompt = ctx.getSystemPrompt?.();
	if (systemPrompt) {
		sections.push(`# Effective system prompt\n${compact(systemPrompt, MAX_SYSTEM_CHARS)}`);
	}

	const transcript = buildTranscript(ctx.sessionManager.getBranch() as BranchEntry[]);
	sections.push(
		`# Current conversation branch\n${
			transcript ? compact(transcript, MAX_TRANSCRIPT_CHARS) : "(No user/assistant messages on this branch yet.)"
		}`,
	);

	return sections.join("\n\n");
}

async function askBtw(question: string, ctx: ExtensionCommandContext, signal: AbortSignal): Promise<BtwResult> {
	if (!ctx.model) {
		return { error: "No model selected" };
	}

	const snapshot = buildPromptSnapshot(ctx);
	const userMessage: UserMessage = {
		role: "user",
		content: [
			{
				type: "text",
				text: `<prompt_snapshot>\n${snapshot}\n</prompt_snapshot>\n\nQuestion: ${question}`,
			},
		],
		timestamp: Date.now(),
	};

	try {
		const response = await ctx.modelRegistry.complete(
			ctx.model,
			{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
			{ signal },
		);

		if (response.stopReason === "aborted") return null;

		const answer = response.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.trim();

		return { answer: answer || "(No text response.)" };
	} catch (error) {
		if (signal.aborted) return null;
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

async function showAnswer(question: string, answer: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.ui.custom((_tui, theme, _kb, done) => {
		const container = new Container();
		const border = new DynamicBorder((s: string) => theme.fg("accent", s));
		const mdTheme = getMarkdownTheme();
		const title = theme.fg("accent", theme.bold("/btw"));
		const body = [`**Q:** ${question}`, "", answer].join("\n");

		container.addChild(border);
		container.addChild(new Text(title, 1, 0));
		container.addChild(new Markdown(body, 1, 1, mdTheme));
		container.addChild(new Text(theme.fg("dim", "Press Enter or Esc to close"), 1, 0));
		container.addChild(border);

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
					done(undefined);
				}
			},
		};
	});
}

export default function btw(pi: ExtensionAPI) {
	pi.registerCommand("btw", {
		description: "Ask a side question about the current prompt without adding to the conversation",
		handler: async (args, ctx) => {
			const question = args.trim();
			if (!question) {
				ctx.ui.notify("Usage: /btw <question about the current prompt/context>", "warning");
				return;
			}

			if (ctx.mode !== "tui") {
				ctx.ui.notify("/btw requires interactive mode", "error");
				return;
			}

			if (!ctx.model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const result = await ctx.ui.custom<BtwResult>((tui, theme, _kb, done) => {
				const loader = new BorderedLoader(tui, theme, `Asking /btw using ${ctx.model!.id}...`);
				loader.onAbort = () => done(null);

				askBtw(question, ctx, loader.signal)
					.then(done)
					.catch((error) =>
						done({ error: error instanceof Error ? error.message : String(error) }),
					);

				return loader;
			});

			if (!result) {
				ctx.ui.notify("/btw cancelled", "info");
				return;
			}

			if ("error" in result) {
				ctx.ui.notify(`/btw failed: ${result.error}`, "error");
				return;
			}

			await showAnswer(question, result.answer, ctx);
		},
	});
}
