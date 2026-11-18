import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, symlink, lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { registerCodemodeCommand, saveCodemodeDefault, updateCodemodeDefault } from "../extensions/lib/codemode-command.ts";

function harness(initial = ["read", "bash", "codemode"]) {
	let active = [...initial];
	let command: any;
	let available = true;
	let selected: string | undefined;
	let saveError: Error | undefined;
	const saved: boolean[] = [];
	const notices: { text: string; level: string }[] = [];
	const pi = {
		registerCommand: (_name: string, definition: unknown) => { command = definition; },
		getActiveTools: () => [...active],
		getAllTools: () => available ? [{ name: "codemode" }] : [],
		setActiveTools: (names: string[]) => { active = [...names]; },
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		ui: {
			select: async () => selected,
			notify: (text: string, level: string) => { notices.push({ text, level }); },
		},
	} as unknown as ExtensionCommandContext;
	registerCodemodeCommand(pi, {
		settingsPath: "/settings.json",
		saveDefault: async (value) => { if (saveError) throw saveError; saved.push(value); },
	});
	return {
		run: (args: string) => command.handler(args, ctx),
		active: () => active,
		notices, saved, command,
		select: (value?: string) => { selected = value; },
		unload: () => { available = false; },
		failSave: () => { saveError = new Error("read-only settings"); },
	};
}

describe("codemode command", () => {
	test("session on/off preserves other tools, is idempotent, and does not save defaults", async () => {
		const h = harness();
		await h.run("off");
		expect(h.active()).toEqual(["read", "bash"]);
		await h.run("on");
		await h.run("  ON  ");
		expect(h.active()).toEqual(["read", "bash", "codemode"]);
		expect(h.saved).toEqual([]);
	});
	test("default on/off saves without changing the session", async () => {
		const h = harness();
		await h.run("default off");
		await h.run("default on");
		expect(h.saved).toEqual([false, true]);
		expect(h.active()).toContain("codemode");
		expect(h.notices[0].text).toContain("Current session unchanged");
	});
	test("bare command opens chooser; cancellation makes no changes", async () => {
		const h = harness();
		await h.run("");
		expect(h.active()).toContain("codemode");
		h.select("off");
		await h.run("");
		expect(h.active()).not.toContain("codemode");
	});
	test("status is read-only; invalid input never mutates settings or tools", async () => {
		const h = harness();
		await h.run("status");
		expect(h.notices[0].text).toContain("on");
		for (const args of ["default", "default maybe", "default on extra", "on extra", "only", "banana"]) {
			await h.run(args);
			expect(h.notices.at(-1)?.level).toBe("error");
		}
		expect(h.active()).toEqual(["read", "bash", "codemode"]);
		expect(h.saved).toEqual([]);
	});
	test("unloaded tool and save failures report errors without changing session", async () => {
		const h = harness(["read"]);
		h.unload();
		await h.run("on");
		expect(h.notices.at(-1)?.text).toContain("not loaded");
		h.failSave();
		await h.run("default on");
		expect(h.notices.at(-1)?.text).toContain("read-only settings");
		expect(h.active()).toEqual(["read"]);
	});
	test("completes default subcommands", () => {
		const h = harness();
		expect(h.command.getArgumentCompletions("default ").map((item: any) => item.value)).toEqual(["default on", "default off"]);
	});
});

describe("codemode default settings", () => {
	test("preserves unrelated settings and selection semantics", () => {
		for (const defaultTools of [undefined, [], ["+grep", "-write", "+codemode"], ["read", "bash", "codemode"], ["-codemode", "+codemode", "codemode"]]) {
			const base = { theme: "test", codemode: { mode: "only" }, ...(defaultTools === undefined ? {} : { defaultTools }) };
			for (const enabled of [true, false]) {
				const next = updateCodemodeDefault(base, enabled);
				expect(next.theme).toBe("test");
				expect(next.codemode).toEqual({ mode: "only" });
				const allowlist = defaultTools !== undefined && (defaultTools.length === 0 || defaultTools.some((name) => !/^[+-]/.test(name)));
				if (allowlist) expect(next.defaultTools.includes("codemode")).toBe(enabled);
				else expect(next.defaultTools.at(-1)).toBe(enabled ? "+codemode" : "-codemode");
			}
		}
		expect(updateCodemodeDefault({ defaultTools: ["read", "bash"] }, true).defaultTools).toEqual(["read", "bash", "codemode"]);
		expect(updateCodemodeDefault({ defaultTools: [] }, false).defaultTools).toEqual([]);
		expect(updateCodemodeDefault({ defaultTools: ["codemode"] }, false).defaultTools).toEqual([]);
		expect(updateCodemodeDefault({ defaultTools: ["codemode", "+grep"] }, false).defaultTools).toEqual(["grep"]);
		expect(() => updateCodemodeDefault({ defaultTools: "bad" }, true)).toThrow();
	});
	test("writes through symlink, preserves other settings, and leaves malformed JSON untouched", async () => {
		const dir = await mkdtemp(join(tmpdir(), "codemode-test-"));
		try {
			const target = join(dir, "meta-settings.json");
			const link = join(dir, "settings.json");
			await writeFile(target, JSON.stringify({ theme: "test", defaultTools: ["+grep", "+codemode"] }));
			await symlink(target, link);
			await saveCodemodeDefault(link, false);
			expect((await lstat(link)).isSymbolicLink()).toBe(true);
			expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ theme: "test", defaultTools: ["+grep", "-codemode"] });
			await writeFile(target, "invalid JSON");
			await expect(saveCodemodeDefault(link, true)).rejects.toThrow();
			expect(await readFile(target, "utf8")).toBe("invalid JSON");
		} finally { await rm(dir, { recursive: true, force: true }); }
	});
	test("creates missing settings with additive defaultTools", async () => {
		const dir = await mkdtemp(join(tmpdir(), "codemode-test-"));
		try {
			const path = join(dir, "agent", "settings.json");
			await saveCodemodeDefault(path, true);
			expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ defaultTools: ["+codemode"] });
		} finally { await rm(dir, { recursive: true, force: true }); }
	});
});
