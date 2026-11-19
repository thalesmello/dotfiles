/** Display-only normalization of Pi's codemode progress/final details. */
export interface CodemodeCall {
	name: string;
	args: Record<string, unknown>;
	status: "running" | "ok" | "error" | "cancelled";
	durationMs?: number;
	error?: string;
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function codemodeCalls(details: unknown): CodemodeCall[] {
	const calls = record(details).calls;
	if (!Array.isArray(calls)) return [];
	return calls.flatMap((value) => {
		const call = record(value);
		if (typeof call.name !== "string" || !call.name.trim()) return [];
		let args = call.args;
		if (typeof args === "string") {
			try { args = JSON.parse(args); } catch { args = {}; }
		}
		const status = call.status === "ok" || call.status === "error" || call.status === "cancelled" ? call.status : "running";
		return [{
			name: call.name,
			args: record(args),
			status,
			...(typeof call.durationMs === "number" && Number.isFinite(call.durationMs) && call.durationMs >= 0 ? { durationMs: call.durationMs } : {}),
			...(typeof call.error === "string" ? { error: call.error } : {}),
		} satisfies CodemodeCall];
	});
}

/** Remove only Pi's known envelope, never arbitrary user output. */
export function codemodeOutput(text: string): string {
	return text.replace(/^Script (?:completed|failed)\nWall time \d+(?:\.\d+)? seconds\nOutput:\n/, "").replace(/^\n/, "").replace(/\n+$/, "");
}

export function codemodeFailure(output: string): string {
	const marker = /(?:^|\n)Script error:\s*\n/.exec(output);
	const error = marker ? output.slice(marker.index + marker[0].length) : output;
	return error.split("\n").find((line) => line.trim())?.trim().replace(/^Error:\s*/, "") || "Script failed";
}

const countItems = (count: number, label: string) => `${count} ${label}${count === 1 ? "" : "s"}`;

export function codemodeSummary(calls: CodemodeCall[], output: string, images: number, partial: boolean, failed: boolean): string {
	const errors = calls.filter((call) => call.status === "error").length;
	const cancelled = calls.filter((call) => call.status === "cancelled").length;
	const running = calls.filter((call) => call.status === "running").length;
	const body = output.split("\n").filter((line) => line.trim());
	return [
		partial ? "Running…" : failed ? "Failed" : "Done",
		...(calls.length ? [countItems(calls.length, "call")] : []),
		...(partial && running ? [`${running} running`] : []),
		...(errors ? [`${errors} failed`] : []),
		...(cancelled ? [`${cancelled} cancelled`] : []),
		...(!partial ? [body.length ? countItems(body.length, "line") : "no output"] : []),
		...(images ? [countItems(images, "image")] : []),
	].join(" · ");
}

/** Keep compact groups bounded, ensuring failures don't disappear behind successful calls. */
export function visibleCodemodeCalls(calls: CodemodeCall[], limit = 4): CodemodeCall[] {
	const visible = calls.slice(0, limit);
	const hiddenErrors = calls.slice(limit).filter((call) => call.status === "error" || call.status === "cancelled");
	if (!hiddenErrors.length) return visible;
	const priority = [...calls.filter((call) => call.status === "error" || call.status === "cancelled"), ...calls.filter((call) => call.status !== "error" && call.status !== "cancelled")];
	return priority.slice(0, limit);
}
