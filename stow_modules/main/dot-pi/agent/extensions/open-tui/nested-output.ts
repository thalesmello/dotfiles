import { Buffer } from "node:buffer";
import type { NestedOutput } from "./nested-tool-blocks.ts";

const MAX_CALLS = 64;
const MAX_CALL_BYTES = 8_192;
const MAX_SCRIPT_BYTES = 65_536;
const MAX_ID_CHARS = 512;
function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function clipUtf8(text: string, bytes: number): string {
	let low = 0, high = Math.min(text.length, Math.max(0, bytes));
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (Buffer.byteLength(text.slice(0, mid), "utf8") <= bytes) low = mid;
		else high = mid - 1;
	}
	let shown = text.slice(0, low);
	if (/[\uD800-\uDBFF]$/.test(shown)) shown = shown.slice(0, -1);
	return shown;
}

export function nestedOutputs(details: unknown): NestedOutput[] {
	const values = record(details).openTuiNestedOutputs;
	if (!Array.isArray(values)) return [];
	let budget = MAX_SCRIPT_BYTES;
	return values.slice(0, MAX_CALLS).flatMap((value) => {
		const output = record(value);
		if (typeof output.id !== "string" || output.id.length > MAX_ID_CHARS || typeof output.text !== "string") return [];
		const text = clipUtf8(output.text, Math.min(MAX_CALL_BYTES, budget));
		budget -= Buffer.byteLength(text, "utf8");
		return [{ id: output.id, text, images: typeof output.images === "number" && Number.isSafeInteger(output.images) && output.images >= 0 ? output.images : 0, truncated: output.truncated === true || text.length < output.text.length, isError: output.isError === true }];
	});
}

/** Bounded UI-only text snapshots. Parent content sent to the model is never modified. */
export class NestedOutputCapture {
	private roots = new Map<string, string>();
	private outputs = new Map<string, NestedOutput[]>();
	start(event: { toolName: string; toolCallId: string; parentToolCallId?: string }, enabled = true): void {
		if (enabled && event.toolName === "codemode" && !event.parentToolCallId) {
			this.roots.set(event.toolCallId, event.toolCallId);
			this.outputs.set(event.toolCallId, []);
		} else if (event.parentToolCallId) {
			const root = this.roots.get(event.parentToolCallId);
			if (root) this.roots.set(event.toolCallId, root);
		}
	}
	end(event: { toolCallId: string; parentToolCallId?: string; result: unknown; isError: boolean }): void {
		const root = this.roots.get(event.toolCallId);
		this.roots.delete(event.toolCallId);
		if (!root) return;
		if (root === event.toolCallId) { this.outputs.delete(root); return; }
		const list = this.outputs.get(root);
		if (!list || list.length >= MAX_CALLS || event.toolCallId.length > MAX_ID_CHARS) return;
		const result = record(event.result);
		const content = Array.isArray(result.content) ? result.content.map(record) : [];
		let budget = Math.max(0, Math.min(MAX_CALL_BYTES, MAX_SCRIPT_BYTES - list.reduce((total, output) => total + Buffer.byteLength(output.text, "utf8"), 0)));
		let text = "", truncated = false;
		for (const block of content) {
			if (block.type !== "text" || typeof block.text !== "string") continue;
			if (text && budget) { text += "\n"; budget--; }
			const shown = clipUtf8(block.text, budget);
			text += shown;
			budget -= Buffer.byteLength(shown, "utf8");
			truncated ||= shown.length < block.text.length;
		}
		list.push({ id: event.toolCallId, text, images: content.filter((block) => block.type === "image").length, truncated, isError: event.isError });
	}
	get(id: string): NestedOutput[] { return this.outputs.get(id)?.slice() ?? []; }
	clear(): void { this.roots.clear(); this.outputs.clear(); }
}
