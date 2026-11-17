import { beforeEach, describe, expect, mock, test } from "bun:test";

let mockSpaces: any[] = [];
let mockMachines: any[] = [{ name: null, layout: "ready" }];
let mockPanes: any[] = [];
let mockAgents: any[] = [];
let mockFocused: any = null;
let mockChecking = false;
const runCalls: Array<{ name: string; args: any }> = [];
const notifyCalls: Array<{ title: string; body?: string; timeout?: number }> = [];
const sharedStore = new Map<string, any>();

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
	agents: () => mockAgents,
	spaces: () => mockSpaces,
	machines: () => mockMachines,
	panes: () => mockPanes,
	terminals: () => [],
	focused: () => mockFocused,
	run: (name: string, args?: any) => {
		runCalls.push({ name, args });
		return null;
	},
	openOverlay: () => "",
	notify: (payload: any) => {
		notifyCalls.push(payload);
	},
	exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	hc: async () => ({ code: 0, stdout: "{}", stderr: "" }),
	home: () => "/Users/thalesmello",
	theme: () => ({}),
	shared: (key: string) => sharedStore.get(key) ?? null,
	setShared: (key: string, val: any) => {
		sharedStore.set(key, val);
		return null;
	},
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
	resolveFocusedPaneId,
} = await import("../../../dot-config/herdr-app/mods/spaces-reconnect/main.js");

function createView() {
	const view = Object.create(Spaces.prototype);
	view.autoTitles = JSON.parse(store.get("tabs.autoTitles") ?? "{}");
	view.pendingHistoryTarget = null;
	view.initFocusHistory();
	return view as {
		autoTitles: Record<string, any>;
		focusHistory: {
			journal: string[];
			seq: number;
			walk: string[];
			walkState: { index: number; expectedPane: string; seq: number } | null;
		};
		pendingHistoryTarget: { pane: string; fromPane: string; until: number } | null;
		syncAutoTitles(now: number, sp: any[], ps: any[]): void;
		syncFocusHistory(now?: number, sp?: any[], ps?: any[], foc?: any): void;
		focusJumplist(
			direction: "back" | "forward",
			now?: number,
			sp?: any[],
			ps?: any[],
			foc?: any,
			currentOverride?: string | null,
		): boolean;
		attentionJump(
			now?: number,
			sp?: any[],
			ps?: any[],
			foc?: any,
			currentOverride?: string | null,
		): boolean;
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

describe("Spaces focus-history jumplist and attention jump", () => {
	beforeEach(() => {
		store.clear();
		sharedStore.clear();
		runCalls.length = 0;
		notifyCalls.length = 0;
		mockChecking = false;
		mockSpaces = [
			{
				id: "sp1",
				name: "src",
				active: true,
				tabs: [
					{ id: "tb1", name: "1", active: true },
					{ id: "tb2", name: "2", active: false },
				],
			},
		];
		mockPanes = [
			{ pane: "p1", terminal: "t1", tab: "tb1", focused: true },
			{ pane: "p2", terminal: "t2", tab: "tb1", focused: false },
			{ pane: "p3", terminal: "t3", tab: "tb2", focused: false },
		];
		mockAgents = [];
		mockFocused = { pane: "p1", terminal: "t1", tab: "tb1", space: "sp1" };
	});

	test("records focus transitions, suppresses consecutive duplicates, and walks back and forward", () => {
		const view = createView();

		// Focus p1 -> p2 -> p3 -> p2
		view.syncFocusHistory(1000, mockSpaces, mockPanes, { pane: "p1" });
		view.syncFocusHistory(1100, mockSpaces, mockPanes, { pane: "p1" }); // duplicate
		view.syncFocusHistory(1200, mockSpaces, mockPanes, { pane: "p2" });
		view.syncFocusHistory(1300, mockSpaces, mockPanes, { pane: "p3" });

		expect(view.focusHistory.journal).toEqual(["p1", "p2", "p3"]);
		expect(view.focusHistory.seq).toBe(3);

		// Step back from p3 -> p2
		expect(view.focusJumplist("back", 1400, mockSpaces, mockPanes, { pane: "p3" })).toBe(true);
		expect(runCalls.at(-1)).toEqual({ name: "pane.focus", args: { pane: "p2" } });
		expect(notifyCalls.at(-1)?.title).toBe("← p2");
		expect(notifyCalls.at(-1)?.body).toBe("1 back");

		// While p2 focus is still in flight (focused() still reports p3), syncFocusHistory must not re-record p3
		view.syncFocusHistory(1450, mockSpaces, mockPanes, { pane: "p3" });
		expect(view.focusHistory.journal.at(-1)).toBe("p2");

		// Once p2 lands, step back again -> p1
		view.syncFocusHistory(1500, mockSpaces, mockPanes, { pane: "p2" });
		expect(view.focusJumplist("back", 1600, mockSpaces, mockPanes, { pane: "p2" })).toBe(true);
		expect(runCalls.at(-1)).toEqual({ name: "pane.focus", args: { pane: "p1" } });
		expect(notifyCalls.at(-1)?.title).toBe("← p1");
		expect(notifyCalls.at(-1)?.body).toBe("2 back");

		// Further back hits start of focus history
		expect(view.focusJumplist("back", 1700, mockSpaces, mockPanes, { pane: "p1" })).toBe(false);
		expect(notifyCalls.at(-1)?.title).toBe("Start of focus history");

		// Step forward -> p2 -> p3
		expect(view.focusJumplist("forward", 1800, mockSpaces, mockPanes, { pane: "p1" })).toBe(true);
		expect(runCalls.at(-1)).toEqual({ name: "pane.focus", args: { pane: "p2" } });
		expect(notifyCalls.at(-1)?.title).toBe("→ p2");
		expect(notifyCalls.at(-1)?.body).toBe("1 back");

		expect(view.focusJumplist("forward", 1900, mockSpaces, mockPanes, { pane: "p2" })).toBe(true);
		expect(runCalls.at(-1)).toEqual({ name: "pane.focus", args: { pane: "p3" } });
		expect(notifyCalls.at(-1)?.title).toBe("→ p3");
		expect(notifyCalls.at(-1)?.body).toBeUndefined();

		// Further forward hits end of focus history
		expect(view.focusJumplist("forward", 2000, mockSpaces, mockPanes, { pane: "p3" })).toBe(false);
		expect(notifyCalls.at(-1)?.title).toBe("End of focus history");
	});

	test("ignores ephemeral overlay focus in split tabs and skips closed panes during walk", () => {
		const view = createView();
		view.syncFocusHistory(1000, mockSpaces, mockPanes, { pane: "p1" });
		view.syncFocusHistory(1100, mockSpaces, mockPanes, { pane: "p2" });
		view.syncFocusHistory(1200, mockSpaces, mockPanes, { pane: "p3" });

		// Ephemeral popup terminal t99 focused with no pane: must not pollute journal or pick p1 in split tab tb1
		mockPanes[0].focused = false;
		mockPanes[1].focused = false;
		expect(resolveFocusedPaneId(mockSpaces, mockPanes, { pane: null, terminal: "t99" })).toBeNull();
		view.syncFocusHistory(1250, mockSpaces, mockPanes, { pane: null, terminal: "t99" });
		expect(view.focusHistory.journal).toEqual(["p1", "p2", "p3"]);

		// Close p2, then walk back from p3 -> should skip closed p2 and land on p1
		mockPanes = [
			{ pane: "p1", terminal: "t1", tab: "tb1", focused: false },
			{ pane: "p3", terminal: "t3", tab: "tb2", focused: true },
		];
		expect(view.focusJumplist("back", 1300, mockSpaces, mockPanes, { pane: "p3" })).toBe(true);
		expect(runCalls.at(-1)).toEqual({ name: "pane.focus", args: { pane: "p1" } });
	});

	test("attentionJump focuses blocked/done agents in smart priority order and falls back to forward history", () => {
		const view = createView();
		mockPanes = [
			{ pane: "p1", terminal: "t1", tab: "tb1", focused: true },
			{ pane: "p2", terminal: "t2", tab: "tb1", focused: false },
			{ pane: "p3", terminal: "t3", tab: "tb2", focused: false },
			{ pane: "devserver/p4", terminal: "devserver/t4", tab: "tb2", focused: false },
		];
		store.set(
			"changed",
			JSON.stringify({
				t2: { s: "blocked", at: 1000 },
				t3: { s: "done", at: 3000 },
				"devserver/t4": { s: "blocked", at: 2000 },
			}),
		);
		mockAgents = [
			{ address: "t1", pane: "p1", status: "idle", seq: 10, focused: true, program: { key: "pi" } },
			{ address: "t2", pane: "p2", status: "blocked", seq: 20, focused: false, program: { key: "pi" } },
			{ address: "t3", pane: "p3", status: "done", seq: 30, focused: false, program: { key: "claude" } },
			{
				address: "devserver/t4",
				pane: "devserver/p4",
				status: "blocked",
				seq: 25,
				focused: false,
				program: { key: "codex" },
			},
		];

		// 1. Jumps to devserver/p4 first (blocked, newer timestamp 2000 > 1000)
		expect(view.attentionJump(5000, mockSpaces, mockPanes, { pane: "p1" })).toBe(true);
		expect(runCalls.at(-1)).toEqual({ name: "pane.focus", args: { pane: "devserver/p4" } });
		expect(notifyCalls.at(-1)?.title).toBe("→ codex blocked (+2 more)");

		// 2. While on devserver/p4 (still blocked), pressing Tab again rotates past it to p2 (blocked) -> then p3 (done)
		expect(view.attentionJump(5100, mockSpaces, mockPanes, { pane: "devserver/p4" })).toBe(true);
		expect(runCalls.at(-1)).toEqual({ name: "pane.focus", args: { pane: "p2" } });

		// 3. When no agents need attention, Tab falls back to forward jumplist history
		mockAgents = [];
		// Walk back from p2 -> devserver/p4 first
		expect(view.focusJumplist("back", 5200, mockSpaces, mockPanes, { pane: "p2" })).toBe(true);
		expect(runCalls.at(-1)).toEqual({ name: "pane.focus", args: { pane: "devserver/p4" } });

		// Now attentionJump steps forward back to p2
		expect(view.attentionJump(5300, mockSpaces, mockPanes, { pane: "devserver/p4" })).toBe(true);
		expect(runCalls.at(-1)).toEqual({ name: "pane.focus", args: { pane: "p2" } });
		expect(notifyCalls.at(-1)?.title).toBe("→ p2");
	});

	test("tracks and jumps across machines even when local and remote pane IDs collide (p1 vs devserver p1)", () => {
		const view = createView();
		const crossSpaces = [
			{
				id: "local-sp1",
				name: "laptop",
				machine: null,
				active: true,
				tabs: [{ id: "tb1", name: "1", active: true }],
			},
			{
				id: "devserver/sp1",
				name: "src",
				machine: "devserver",
				active: false,
				tabs: [
					{ id: "tb1", name: "1", active: true },
					{ id: "tb2", name: "2", active: false },
				],
			},
		];
		const crossPanes = [
			{ pane: "p1", terminal: "t1", tab: "tb1", focused: true },
			{ pane: "p1", terminal: "devserver/t1", tab: "tb1", focused: false },
			{ pane: "p2", terminal: "devserver/t2", tab: "tb2", focused: false },
		];

		// 1. Focus local p1 (t1)
		view.syncFocusHistory(1000, crossSpaces, crossPanes, { pane: "p1", terminal: "t1" });
		expect(view.focusHistory.journal).toEqual(["p1"]);

		// 2. Switch to devserver p1 (devserver/t1) — even though raw pane is "p1", it records "devserver/p1"
		crossSpaces[0].active = false;
		crossSpaces[1].active = true;
		crossPanes[0].focused = false;
		crossPanes[1].focused = true;
		view.syncFocusHistory(1100, crossSpaces, crossPanes, { pane: "p1", terminal: "devserver/t1" });
		expect(view.focusHistory.journal).toEqual(["p1", "devserver/p1"]);

		// 3. Switch to devserver p2 (devserver/t2) in tab tb2
		crossSpaces[1].tabs[0].active = false;
		crossSpaces[1].tabs[1].active = true;
		crossPanes[1].focused = false;
		crossPanes[2].focused = true;
		view.syncFocusHistory(1200, crossSpaces, crossPanes, { pane: "p2", terminal: "devserver/t2" });
		expect(view.focusHistory.journal).toEqual(["p1", "devserver/p1", "devserver/p2"]);

		// 4. Jump back from devserver/p2 -> devserver/p1 (selects tb1 and focuses terminal devserver/t1)
		runCalls.length = 0;
		expect(
			view.focusJumplist("back", 1300, crossSpaces, crossPanes, { pane: "p2", terminal: "devserver/t2" }),
		).toBe(true);
		expect(runCalls).toEqual([
			{ name: "tab.select", args: { id: "tb1" } },
			{ name: "pane.focus", args: { terminal: "devserver/t1" } },
		]);

		// 5. Jump back from devserver/p1 -> local p1 (switches space across machines to local-sp1 and focuses p1)
		crossSpaces[1].tabs[0].active = true;
		crossSpaces[1].tabs[1].active = false;
		runCalls.length = 0;
		expect(
			view.focusJumplist("back", 1400, crossSpaces, crossPanes, { pane: "p1", terminal: "devserver/t1" }),
		).toBe(true);
		expect(runCalls).toEqual([
			{ name: "space.select", args: { id: "local-sp1" } },
			{ name: "pane.focus", args: { pane: "p1" } },
		]);

		// 6. Jump forward from local p1 -> devserver/p1 (switches space back to devserver/sp1)
		crossSpaces[0].active = true;
		crossSpaces[1].active = false;
		runCalls.length = 0;
		expect(view.focusJumplist("forward", 1500, crossSpaces, crossPanes, { pane: "p1", terminal: "t1" })).toBe(
			true,
		);
		expect(runCalls).toEqual([
			{ name: "space.select", args: { id: "devserver/sp1" } },
			{ name: "pane.focus", args: { terminal: "devserver/t1" } },
		]);
	});
});
