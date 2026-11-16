import { beforeEach, describe, expect, mock, test } from "bun:test";

let mockSpaces: any[] = [];
let mockMachines: any[] = [{ name: null, layout: "ready" }];
let mockPanes: any[] = [];
let mockChecking = false;
const runCalls: Array<{ name: string; args: any }> = [];

mock.module("gpui-kit", () => ({
	View: class {},
	div: () => ({}),
	svg: () => ({}),
}));

mock.module("gpui-base", () => ({
	v_flex: () => ({}),
	h_flex: () => ({}),
}));

mock.module("herdr", () => ({
	spaces: () => mockSpaces,
	machines: () => mockMachines,
	panes: () => mockPanes,
	terminals: () => [],
	focused: () => null,
	run: (name: string, args?: any) => {
		runCalls.push({ name, args });
		return null;
	},
	openOverlay: () => "",
	exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	hc: async () => ({ code: 0, stdout: "{}", stderr: "" }),
	home: () => "/Users/thalesmello",
	theme: () => ({}),
	shared: () => null,
	setShared: () => null,
	watchFolder: () => Object.assign(Promise.resolve([]), { cancel() {} }),
	nextCommand: () => new Promise(() => {}),
	window: () => ({ active: true, platform: "macos" }),
	layout: () => ({}),
	checking: () => mockChecking,
}));

const store = new Map<string, string>();
(globalThis as any).localStorage = {
	getItem: (key: string) => store.get(key) ?? null,
	setItem: (key: string, value: string) => {
		store.set(key, String(value));
	},
	removeItem: (key: string) => {
		store.delete(key);
	},
	clear: () => {
		store.clear();
	},
};

const {
	default: Spaces,
	cleanAgentTitle,
	isDefaultOrSlugTabName,
	isSlug,
} = await import("../../../dot-config/herdr-app/mods/spaces-reconnect/main.js");

function createView() {
	const view = Object.create(Spaces.prototype);
	view.autoTitles = JSON.parse(store.get("tabs.autoTitles") ?? "{}");
	return view as {
		autoTitles: Record<string, any>;
		syncAutoTitles(now: number, sp: any[], ps: any[]): void;
	};
}

describe("herdr-app auto tab title helpers", () => {
	test("isSlug detects hyphenated and underscored single-token slugs", () => {
		expect(isSlug("herdr-title-rename")).toBe(true);
		expect(isSlug("nvim_config_setup")).toBe(true);
		expect(isSlug("Porting Auto Rename Title")).toBe(false);
		expect(isSlug("auth")).toBe(false);
		expect(isSlug("")).toBe(false);
	});

	test("cleanAgentTitle extracts human titles and strips agent decorations", () => {
		const lead = {
			terminal: "t3p",
			cwd: "/Users/thalesmello/src",
			program: { key: "pi", name: "Pi", agent: true },
		};
		const space = { name: "src", folder: "/Users/thalesmello/src" };

		expect(cleanAgentTitle("Porting Auto Rename Title to Herdr App", lead, space)).toBe(
			"Porting Auto Rename Title to Herdr App",
		);
		expect(cleanAgentTitle("✦  Fix login flow", lead, space)).toBe("Fix login flow");
		expect(cleanAgentTitle("⠋ - Repair OAuth callbacks | src", lead, space)).toBe(
			"Repair OAuth callbacks",
		);
		expect(cleanAgentTitle("[ ! ] Fix flaky test | src", lead, space)).toBe("Fix flaky test");
		expect(cleanAgentTitle("[web] login redirect", lead, space)).toBe("[web] login redirect");
		expect(cleanAgentTitle("π - Named Pi Session - src", lead, space)).toBe("Named Pi Session");
		expect(cleanAgentTitle("Fish Shell Completions", lead, space)).toBe("Fish Shell Completions");
		expect(cleanAgentTitle("Git Worktree Cleanup", lead, space)).toBe("Git Worktree Cleanup");
	});

	test("cleanAgentTitle rejects startup defaults, paths, shells, terminal ids, and slugs", () => {
		const lead = {
			terminal: "devserver/t1c",
			cwd: "/home/thalesmello/src",
			program: { key: "pi", name: "Pi", agent: true },
		};
		const space = { name: "src", folder: "/home/thalesmello/src" };

		for (const raw of [
			"",
			"π",
			"π - src",
			"Pi",
			"pi",
			"Claude Code",
			"codex",
			"✦  Working",
			"⠋ - Thinking",
			"t1c",
			"devserver/t1c",
			"src",
			"/home/thalesmello/src",
			"~/src",
			"fish ~/src",
			"zsh ~/dotfiles",
			"nvim:init.lua",
			"thales@devserver:~/src",
			"herdr-title-rename",
		]) {
			expect(cleanAgentTitle(raw, lead, space)).toBe("");
		}
	});

	test("isDefaultOrSlugTabName matches unnamed, numeric, program, workspace, and slug tab names", () => {
		const lead = { program: { key: "pi", name: "Pi", agent: true } };
		const space = { name: "src" };

		expect(isDefaultOrSlugTabName({ name: "Custom", named: false }, lead, space)).toBe(true);
		expect(isDefaultOrSlugTabName({ name: "1", named: true }, lead, space)).toBe(true);
		expect(isDefaultOrSlugTabName({ name: "pi", named: true }, lead, space)).toBe(true);
		expect(isDefaultOrSlugTabName({ name: "Pi", named: true }, lead, space)).toBe(true);
		expect(isDefaultOrSlugTabName({ name: "herdr-title-rename", named: true }, lead, space)).toBe(
			true,
		);
		expect(isDefaultOrSlugTabName({ name: "src", named: true }, lead, space)).toBe(true);

		expect(isDefaultOrSlugTabName({ name: "My Custom Tab", named: true }, lead, space)).toBe(false);
		expect(isDefaultOrSlugTabName({ name: "auth", named: true }, lead, space)).toBe(false);
	});
});

describe("Spaces.prototype.syncAutoTitles", () => {
	beforeEach(() => {
		store.clear();
		runCalls.length = 0;
		mockChecking = false;
		mockMachines = [
			{ name: null, layout: "ready" },
			{ name: "devserver", layout: "ready" },
		];
		mockSpaces = [];
		mockPanes = [];
	});

	test("renames slug-named and unnamed tabs to the agent's human title and follows later updates", () => {
		const sp = [
			{
				id: "sp1",
				name: "src",
				folder: "/Users/thalesmello/src",
				machine: null,
				tabs: [
					{ id: "tb1", name: "herdr-title-rename", named: true },
					{ id: "tb2", name: "1", named: false },
				],
			},
		];
		const ps = [
			{
				pane: "p1",
				terminal: "t3p",
				tab: "tb1",
				title: "Porting Auto Rename Title to Herdr App",
				cwd: "/Users/thalesmello/src",
				status: "working",
				app: "pi",
				program: { key: "pi", name: "Pi", agent: true },
			},
			{
				pane: "p2",
				terminal: "t19",
				tab: "tb2",
				title: "Fix Herdr App Shortcuts and Performance",
				cwd: "/Users/thalesmello/src",
				status: "idle",
				app: "pi",
				program: { key: "pi", name: "Pi", agent: true },
			},
		];

		const view = createView();
		view.syncAutoTitles(1000, sp, ps);

		expect(runCalls).toEqual([
			{
				name: "tab.rename",
				args: { id: "tb1", name: "Porting Auto Rename Title to Herdr App" },
			},
			{
				name: "tab.rename",
				args: { id: "tb2", name: "Fix Herdr App Shortcuts and Performance" },
			},
		]);

		// While the rename is still in flight (< 5000ms) and tab.name hasn't echoed yet, do not re-send or yield.
		runCalls.length = 0;
		view.syncAutoTitles(1250, sp, ps);
		expect(runCalls).toEqual([]);
		expect(view.autoTitles.tb1.yielded).toBeUndefined();

		// Core doc echoes the renamed tab labels.
		sp[0].tabs[0].name = "Porting Auto Rename Title to Herdr App";
		sp[0].tabs[1].name = "Fix Herdr App Shortcuts and Performance";
		sp[0].tabs[1].named = true;
		view.syncAutoTitles(1500, sp, ps);
		expect(runCalls).toEqual([]);

		// Agent updates its session title later in the conversation (e.g. after 6 turns or /retitle).
		ps[0].title = "Auto Rename Tabs and Preserve Manual Overrides";
		view.syncAutoTitles(2000, sp, ps);
		expect(runCalls).toEqual([
			{
				name: "tab.rename",
				args: { id: "tb1", name: "Auto Rename Tabs and Preserve Manual Overrides" },
			},
		]);
	});

	test("yields ownership when the user manually renames a tab and persists across restarts", () => {
		const sp = [
			{
				id: "sp1",
				name: "src",
				folder: "/Users/thalesmello/src",
				machine: null,
				tabs: [{ id: "tb1", name: "herdr-title-rename", named: true }],
			},
		];
		const ps = [
			{
				pane: "p1",
				terminal: "t3p",
				tab: "tb1",
				title: "Initial Agent Title",
				cwd: "/Users/thalesmello/src",
				status: "idle",
				app: "pi",
				program: { key: "pi", name: "Pi", agent: true },
			},
		];

		const view = createView();
		view.syncAutoTitles(1000, sp, ps);
		sp[0].tabs[0].name = "Initial Agent Title";
		view.syncAutoTitles(1500, sp, ps);
		runCalls.length = 0;

		// User manually renames the tab (even to a hyphenated slug).
		sp[0].tabs[0].name = "my-custom-name";
		ps[0].title = "New Agent Title After Turn 6";
		view.syncAutoTitles(2000, sp, ps);

		expect(runCalls).toEqual([]);
		expect(view.autoTitles.tb1.yielded).toBe(true);

		// Simulated restart reloads state from localStorage and still respects the manual rename.
		const restartedView = createView();
		restartedView.syncAutoTitles(3000, sp, ps);
		expect(runCalls).toEqual([]);

		// If the user clears the manual tab name (named: false), auto-titling resumes.
		sp[0].tabs[0].named = false;
		sp[0].tabs[0].name = "1";
		restartedView.syncAutoTitles(3500, sp, ps);
		expect(runCalls).toEqual([
			{ name: "tab.rename", args: { id: "tb1", name: "New Agent Title After Turn 6" } },
		]);
	});

	test("waits for remote machine layout readiness and retains state while remote machine is loading", () => {
		mockMachines = [
			{ name: null, layout: "ready" },
			{ name: "devserver", layout: "loading" },
		];
		const sp = [
			{
				id: "devserver/sp1",
				name: "src",
				folder: "/home/thalesmello/src",
				machine: "devserver",
				tabs: [{ id: "devserver/tb1", name: "herdr-scroll-speed", named: true }],
			},
		];
		const ps = [
			{
				pane: "devserver/p1",
				terminal: "devserver/t1p",
				tab: "devserver/tb1",
				title: "Optimize Eternal Terminal Scroll Performance",
				cwd: "/home/thalesmello/src",
				status: "idle",
				app: "pi",
				program: { key: "pi", name: "Pi", agent: true },
			},
		];

		const view = createView();
		view.syncAutoTitles(1000, sp, ps);
		expect(runCalls).toEqual([]);

		// Once devserver layout becomes ready, the rename runs.
		mockMachines[1].layout = "ready";
		view.syncAutoTitles(1250, sp, ps);
		expect(runCalls).toEqual([
			{
				name: "tab.rename",
				args: { id: "devserver/tb1", name: "Optimize Eternal Terminal Scroll Performance" },
			},
		]);
	});

	test("retries after pending timeout if rename did not land, and skips multi-agent tabs", () => {
		const sp = [
			{
				id: "sp1",
				name: "src",
				folder: "/Users/thalesmello/src",
				machine: null,
				tabs: [
					{ id: "tb1", name: "1", named: false },
					{ id: "tb2", name: "split-tab", named: true },
				],
			},
		];
		const ps = [
			{
				pane: "p1",
				terminal: "t1",
				tab: "tb1",
				title: "First Agent Task",
				cwd: "/Users/thalesmello/src",
				status: "idle",
				app: "pi",
				program: { key: "pi", name: "Pi", agent: true },
			},
			{
				pane: "p2",
				terminal: "t2",
				tab: "tb2",
				title: "Split Agent One",
				cwd: "/Users/thalesmello/src",
				status: "idle",
				app: "pi",
				program: { key: "pi", name: "Pi", agent: true },
			},
			{
				pane: "p3",
				terminal: "t3",
				tab: "tb2",
				title: "Split Agent Two",
				cwd: "/Users/thalesmello/src",
				status: "working",
				app: "pi",
				program: { key: "pi", name: "Pi", agent: true },
			},
		];

		const view = createView();
		view.syncAutoTitles(1000, sp, ps);
		expect(runCalls).toEqual([{ name: "tab.rename", args: { id: "tb1", name: "First Agent Task" } }]);

		// After 5000ms timeout, if tb1 still has its old name "1", it retries instead of yielding.
		runCalls.length = 0;
		view.syncAutoTitles(6500, sp, ps);
		expect(runCalls).toEqual([{ name: "tab.rename", args: { id: "tb1", name: "First Agent Task" } }]);
	});
});
