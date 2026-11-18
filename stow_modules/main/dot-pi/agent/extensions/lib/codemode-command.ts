import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function updateCodemodeDefault(settings: Record<string, unknown>, enabled: boolean) {
	const current = settings.defaultTools;
	if (current !== undefined && (!Array.isArray(current) || current.some((item) => typeof item !== "string"))) {
		throw new Error("settings.defaultTools must be an array of strings");
	}
	const names = (current ?? []) as string[];
	// An explicit empty list or plain-name allowlist replaces the built-in
	// defaults. Do not turn it into a modifier-only list and re-enable them.
	if (current !== undefined && (names.length === 0 || names.some((name) => !/^[+-]/.test(name)))) {
		const selection = new Set(names.filter((name) => !/^[+-]/.test(name)));
		for (const name of names) {
			if (name.startsWith("+")) selection.add(name.slice(1));
			else if (name.startsWith("-")) selection.delete(name.slice(1));
		}
		if (enabled) selection.add("codemode");
		else selection.delete("codemode");
		return { ...settings, defaultTools: [...selection] };
	}
	const tools = names.filter((name) => !["codemode", "+codemode", "-codemode"].includes(name));
	return { ...settings, defaultTools: [...tools, enabled ? "+codemode" : "-codemode"] };
}

export async function saveCodemodeDefault(path: string, enabled: boolean) {
	let settings: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Settings must be a JSON object");
		settings = parsed;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const updated = updateCodemodeDefault(settings, enabled);
	await mkdir(dirname(path), { recursive: true });
	// Write through the existing symlink, rather than replacing it with a rename.
	await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
}

export function registerCodemodeCommand(pi: ExtensionAPI, options: {
	settingsPath: string;
	saveDefault: (enabled: boolean) => Promise<void>;
}) {
	pi.registerCommand("codemode", {
		description: "Choose codemode, turn it on/off, or set default on/off for future sessions",
		getArgumentCompletions(prefix) {
			const values = ["on", "off", "status", "default on", "default off"];
			const matches = values.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
			return matches.length ? matches : null;
		},
		handler: async (args, ctx) => {
			const tokens = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
			const active = () => pi.getActiveTools().includes("codemode");
			try {
				if (tokens[0] === "default" && tokens.length === 2 && ["on", "off"].includes(tokens[1])) {
					await options.saveDefault(tokens[1] === "on");
					ctx.ui.notify(`Codemode default ${tokens[1]} saved to ${options.settingsPath}. Current session unchanged (${active() ? "on" : "off"}). Applies to future sessions on this machine; project settings, CLI flags, and resumed tool selections may override it.`, "info");
					return;
				}
				if (tokens.length === 1 && tokens[0] === "status") {
					ctx.ui.notify(`Codemode is ${active() ? "on" : "off"} in this session.`, "info");
					return;
				}
				let choice: string | undefined = tokens[0];
				if (!tokens.length) {
					if (!ctx.hasUI) throw new Error("Use /codemode on, off, or status in non-interactive mode");
					choice = await ctx.ui.select(`Codemode is ${active() ? "on" : "off"} — choose for this session`, ["on", "off"]);
					if (!choice) return;
				} else if (tokens.length !== 1 || !["on", "off"].includes(choice)) {
					throw new Error("Usage: /codemode [on|off|status|default on|default off]");
				}
				if (choice === "on" && !pi.getAllTools().some((tool) => tool.name === "codemode" && tool.exposure !== "hidden")) {
					throw new Error("Codemode is not loaded. Enable builtin:codemode in Pi configuration and /reload first.");
				}
				const tools = pi.getActiveTools().filter((name) => name !== "codemode");
				pi.setActiveTools(choice === "on" ? [...tools, "codemode"] : tools);
				if (active() !== (choice === "on")) throw new Error("Pi could not apply the codemode selection");
				// Pi owns the active-tool loadout and records it with the next model request.
				ctx.ui.notify(`Codemode ${choice} for this session. Default unchanged.`, "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
