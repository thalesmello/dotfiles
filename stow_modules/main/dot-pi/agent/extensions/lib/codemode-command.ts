import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CodemodeChoice, CodemodePick } from "./codemode-picker.ts";

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

export type CodemodeMode = "on" | "only";

export async function saveCodemodeDefault(path: string, enabled?: boolean, mode?: CodemodeMode) {
	let settings: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Settings must be a JSON object");
		settings = parsed;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const updated: Record<string, unknown> = enabled === undefined ? { ...settings } : updateCodemodeDefault(settings, enabled);
	if (mode !== undefined) {
		const current = settings.codemode;
		if (current !== undefined && (!current || typeof current !== "object" || Array.isArray(current))) {
			throw new Error("settings.codemode must be a JSON object");
		}
		updated.codemode = { ...(current as Record<string, unknown> | undefined), mode };
	}
	await mkdir(dirname(path), { recursive: true });
	// Write through the existing symlink, rather than replacing it with a rename.
	await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
}

export function registerCodemodeCommand(pi: ExtensionAPI, options: {
	settingsPath: string;
	saveDefault: (enabled: boolean, mode?: CodemodeMode) => Promise<void>;
	saveMode: (mode: CodemodeMode) => Promise<void>;
	pick: (ctx: ExtensionCommandContext, current: CodemodeChoice) => Promise<CodemodePick | undefined>;
}) {
	const mode = (): CodemodeMode => pi.getSettings().codemode?.mode === "only" ? "only" : "on";
	pi.registerCommand("codemode", {
		description: "Choose codemode on/off/only, or set default on/off/only for future sessions",
		getArgumentCompletions(prefix) {
			const values = ["on", "off", "only", "status", "default on", "default off", "default only"];
			const matches = values.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
			return matches.length ? matches : null;
		},
		handler: async (args, ctx) => {
			const tokens = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
			const active = () => pi.getActiveTools().includes("codemode");
			const state = (): CodemodeChoice => active() ? mode() : "off";
			const saveDefault = async (choice: CodemodeChoice) => {
				await options.saveDefault(choice !== "off", choice === "off" ? undefined : choice);
				ctx.ui.notify(`Codemode default ${choice} saved to ${options.settingsPath}. Current session unchanged (${state()}). Applies to future sessions on this machine; project settings, CLI flags, and resumed tool selections may override it.`, "info");
			};
			try {
				if (tokens[0] === "default" && tokens.length === 2 && ["on", "off", "only"].includes(tokens[1])) {
					await saveDefault(tokens[1] as CodemodeChoice);
					return;
				}
				if (tokens.length === 1 && tokens[0] === "status") {
					ctx.ui.notify(`Codemode is ${state()} in this session.`, "info");
					return;
				}
				let choice: string | undefined = tokens[0];
				if (!tokens.length) {
					if (!ctx.hasUI) throw new Error("Use /codemode on, off, only, or status in non-interactive mode");
					if (ctx.mode === "tui") {
						const picked = await options.pick(ctx, state());
						if (!picked) return;
						if (picked.setDefault) {
							await saveDefault(picked.choice);
							return;
						}
						choice = picked.choice;
					} else {
						choice = await ctx.ui.select(`Codemode is ${state()} — on: optional; only: forced`, ["on", "off", "only"]);
						if (!choice) return;
					}
				} else if (tokens.length !== 1 || !["on", "off", "only"].includes(choice)) {
					throw new Error("Usage: /codemode [on|off|only|status|default on|default off|default only]");
				}
				if (choice !== "off" && !pi.getAllTools().some((tool) => tool.name === "codemode" && tool.exposure !== "hidden")) {
					throw new Error("Codemode is not loaded. Enable builtin:codemode in Pi configuration and /reload first.");
				}
				const needsReload = choice !== "off" && mode() !== choice;
				if (needsReload) {
					await ctx.waitForIdle();
					await options.saveMode(choice as CodemodeMode);
				}
				const tools = pi.getActiveTools().filter((name) => name !== "codemode");
				pi.setActiveTools(choice !== "off" ? [...tools, "codemode"] : tools);
				if (active() !== (choice !== "off")) throw new Error("Pi could not apply the codemode selection");
				ctx.ui.notify(`Codemode ${choice} for this session.${needsReload ? " Presentation mode saved for this machine; reloading Pi. Default tool selection unchanged." : " Default unchanged."}`, "info");
				if (needsReload) {
					// The built-in extension reads mode from Pi settings. Reload to
					// refresh its loadout; do not use the old runtime afterward.
					await ctx.reload();
					return;
				}
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
