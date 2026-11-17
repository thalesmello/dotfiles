const MAX_MESSAGE_CHARS = 8_000;
const MAX_SNAPSHOT_CHARS = 72_000;

type SnapshotMessage = {
	role: string;
	content?: unknown;
	summary?: string;
	toolName?: string;
	isError?: boolean;
	stopReason?: string;
	errorMessage?: string;
	command?: string;
	output?: string;
	exitCode?: number;
	cancelled?: boolean;
	excludeFromContext?: boolean;
};

function compact(text: string, max: number): string {
	if (text.length <= max) return text;
	const head = Math.floor(max * 0.35);
	const tail = max - head;
	return `${text.slice(0, head)}\n\n[… ${text.length - max} characters omitted …]\n\n${text.slice(-tail)}`;
}

function toolArguments(value: unknown): string {
	try {
		return compact(JSON.stringify(value) ?? "{}", 2_000);
	} catch {
		return "(arguments unavailable)";
	}
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
		if (part.type === "toolCall") {
			parts.push(`[tool call: ${part.name ?? "unknown"} ${toolArguments(part.arguments)}]`);
		}
		if (part.type === "image") parts.push("[image not included in recap snapshot]");
	}
	return parts.join("\n");
}

/** Projected context honors compaction, the active branch, and context edits. Never include system prompts or thinking. */
export function buildRecapSnapshot(messages: SnapshotMessage[]): string {
	const sections: string[] = [];
	for (const message of messages) {
		let label = message.role;
		let body: string;
		switch (message.role) {
			case "user":
			case "assistant":
			case "custom":
				body = textOf(message.content);
				if (message.stopReason === "error" || message.stopReason === "aborted") {
					body += `\n[${message.stopReason}${message.errorMessage ? `: ${message.errorMessage}` : ""}]`;
				}
				break;
			case "toolResult":
				label = `tool result: ${message.toolName ?? "unknown"} (${message.isError ? "error" : "success"})`;
				body = textOf(message.content);
				break;
			case "compactionSummary":
			case "branchSummary":
				body = message.summary ?? "";
				break;
			case "bashExecution":
				if (message.excludeFromContext) continue;
				body = `$ ${message.command ?? ""}\n${message.output ?? ""}\n[exit code: ${message.exitCode ?? "unknown"}${message.cancelled ? "; cancelled" : ""}]`;
				break;
			default:
				continue;
		}
		if (body.trim()) sections.push(`## ${label}\n${compact(body.trim(), MAX_MESSAGE_CHARS)}`);
	}
	return compact(sections.join("\n\n---\n\n"), MAX_SNAPSHOT_CHARS);
}
