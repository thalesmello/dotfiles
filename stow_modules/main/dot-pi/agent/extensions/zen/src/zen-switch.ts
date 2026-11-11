import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

import type { QuietingOutcome, RestoringOutcome, StartupFailure } from "./startup-quieting.ts";

export type Look = "zen" | "zen-details" | "pi";

export type DefaultMode = "toggle" | "on" | "off";

type ZenCommand =
	| { readonly _tag: "Toggle" }
	| { readonly _tag: "Choose"; readonly look: Look }
	| { readonly _tag: "Default"; readonly mode: DefaultMode };

type ParsedZenCommand =
	| { readonly _tag: "Command"; readonly command: ZenCommand }
	| { readonly _tag: "Unrecognized"; readonly argument: string };

type Notice = {
	readonly text: string;
	readonly level: "info" | "warning";
};

type CarriedLook = { look: Look };

export type DefaultPersistOutcome =
	| { readonly ok: true; readonly enabled: boolean }
	| { readonly ok: false; readonly enabled: boolean; readonly path: string; readonly detail: string };

export type ZenSwitch = {
	readonly look: () => Look;
	readonly turn: (command: Exclude<ZenCommand, { readonly _tag: "Default" }>) => Look;
	readonly isDefault: () => boolean;
	readonly turnDefault: (mode: DefaultMode) => DefaultPersistOutcome;
};

declare global {
	var piZenSwitch: CarriedLook | undefined;
}

const CONFIG_FILE = "pi-zen.json";

const CHOICES: ReadonlyMap<string, Look> = new Map([
	["on", "zen"],
	["off", "pi"],
	["details", "zen-details"],
]);

const DEFAULT_CHOICES: ReadonlyMap<string, DefaultMode> = new Map([
	["default", "toggle"],
	["default on", "on"],
	["default off", "off"],
]);

const TOP_COMPLETIONS = ["on", "off", "details", "default"] as const;
const DEFAULT_COMPLETIONS = ["default", "default on", "default off"] as const;

export const USAGE_NOTICE: Notice = { text: "Usage: /zen [on|off|details|default [on|off]]", level: "warning" };

export const ON_OUTSIDE_TUI: Notice = { text: "Zen on · it shows in Pi's interactive terminal", level: "info" };

export function parseZenCommand(args: string): ParsedZenCommand {
	const argument = args.trim().toLowerCase().replace(/\s+/g, " ");
	if (argument === "") return { _tag: "Command", command: { _tag: "Toggle" } };
	const defaultMode = DEFAULT_CHOICES.get(argument);
	if (defaultMode !== undefined) {
		return { _tag: "Command", command: { _tag: "Default", mode: defaultMode } };
	}
	const look = CHOICES.get(argument);
	return look === undefined
		? { _tag: "Unrecognized", argument }
		: { _tag: "Command", command: { _tag: "Choose", look } };
}

export function zenCompletions(prefix: string): AutocompleteItem[] {
	const normalized = prefix.trimStart().toLowerCase().replace(/\s+/g, " ");
	const candidates = normalized.startsWith("default") ? DEFAULT_COMPLETIONS : TOP_COMPLETIONS;
	return candidates.filter((word) => word.startsWith(normalized)).map((word) => ({ value: word, label: word }));
}

function lookAfter(command: Exclude<ZenCommand, { readonly _tag: "Default" }>, current: Look): Look {
	switch (command._tag) {
		case "Toggle":
			return current === "pi" ? "zen" : "pi";
		case "Choose":
			return command.look;
	}
}

function readConfigObject(path: string): Record<string, unknown> {
	try {
		const raw = readFileSync(path, "utf8");
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

export function readZenDefault(agentDir: string): boolean {
	const config = readConfigObject(join(agentDir, CONFIG_FILE));
	return config.defaultEnabled === true;
}

export function writeZenDefault(agentDir: string, enabled: boolean): DefaultPersistOutcome {
	const path = join(agentDir, CONFIG_FILE);
	try {
		const existing = readConfigObject(path);
		const updated = { ...existing, defaultEnabled: enabled };
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
		return { ok: true, enabled };
	} catch (cause) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		return { ok: false, enabled, path, detail };
	}
}

export function carriedSwitch(agentDir?: string): ZenSwitch {
	const initialLook: Look = agentDir !== undefined && readZenDefault(agentDir) ? "zen" : "pi";
	const carried = globalThis.piZenSwitch ?? { look: initialLook };
	globalThis.piZenSwitch = carried;

	const isDefault = (): boolean => (agentDir === undefined ? false : readZenDefault(agentDir));

	return {
		look: () => carried.look,
		turn: (command) => {
			carried.look = lookAfter(command, carried.look);
			return carried.look;
		},
		isDefault,
		turnDefault: (mode) => {
			const nextEnabled = mode === "on" ? true : mode === "off" ? false : !isDefault();
			carried.look = nextEnabled ? "zen" : "pi";
			if (agentDir === undefined) {
				return { ok: true, enabled: nextEnabled };
			}
			return writeZenDefault(agentDir, nextEnabled);
		},
	};
}

export function isZenActive(): boolean {
	return (globalThis.piZenSwitch?.look ?? "pi") !== "pi";
}

function failedAction(failure: StartupFailure): "read" | "write" {
	switch (failure._tag) {
		case "SettingsUnreadable":
		case "ZenRecordUnreadable":
			return "read";
		case "SettingsUnwritable":
		case "ZenRecordUnwritable":
			return "write";
	}
}

function failureText(failure: StartupFailure): string {
	return `could not ${failedAction(failure)} ${failure.path} (${failure.detail})`;
}

function headOnly(head: string): Notice {
	return { text: head, level: "info" };
}

function headed(head: string, detail: Notice): Notice {
	return { text: `${head} · ${detail.text}`, level: detail.level };
}

export function startupNotice(outcome: QuietingOutcome): Notice | undefined {
	switch (outcome._tag) {
		case "Quieted":
			return {
				text: "Zen turned on quietStartup in Pi's settings, so Pi starts quietly from the next launch. /zen off turns it back off.",
				level: "info",
			};
		case "Failed":
			return { text: `Zen left quietStartup unchanged: ${failureText(outcome.failure)}`, level: "warning" };
		case "QuietedUnrecorded":
			return {
				text: `Zen turned on quietStartup in Pi's settings but ${failureText(outcome.failure)}, so /zen off will not turn it back off.`,
				level: "warning",
			};
		case "AlreadyQuiet":
		case "LeftToUser":
			return undefined;
	}
}

export function onNotice(outcome: QuietingOutcome): Notice {
	switch (outcome._tag) {
		case "Quieted":
			return headed("Zen on", { text: "quiet startup from the next launch", level: "info" });
		case "QuietedUnrecorded":
			return headed("Zen on", {
				text: `quiet startup from the next launch, but ${failureText(outcome.failure)}, so /zen off will leave it on`,
				level: "warning",
			});
		case "Failed":
			return headed("Zen on", { text: `quietStartup unchanged: ${failureText(outcome.failure)}`, level: "warning" });
		case "AlreadyQuiet":
		case "LeftToUser":
			return headOnly("Zen on");
	}
}

export function offNotice(outcome: RestoringOutcome): Notice {
	switch (outcome._tag) {
		case "Restored":
			return headed("Zen off", { text: "Pi's startup screen returns from the next launch", level: "info" });
		case "RestoredUnrecorded":
			return headed("Zen off", {
				text: `Pi's startup screen returns from the next launch, but ${failureText(outcome.failure)}`,
				level: "warning",
			});
		case "Failed":
			return headed("Zen off", {
				text: `quietStartup not restored: ${failureText(outcome.failure)}`,
				level: "warning",
			});
		case "NothingToRestore":
			return headOnly("Zen off");
	}
}

export function defaultNotice(outcome: DefaultPersistOutcome): Notice {
	const head = outcome.enabled ? "Zen default on" : "Zen default off";
	if (!outcome.ok) {
		return headed(head, {
			text: `could not write ${outcome.path} (${outcome.detail})`,
			level: "warning",
		});
	}
	return headed(head, {
		text: outcome.enabled ? "Zen enabled by default on startup" : "Zen disabled by default on startup",
		level: "info",
	});
}

export function announce(ui: Pick<ExtensionUIContext, "notify">, notice: Notice): void {
	ui.notify(notice.text, notice.level);
}
