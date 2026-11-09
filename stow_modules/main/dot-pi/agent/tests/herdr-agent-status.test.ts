import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "bun:test";
import herdrAgentStatus, { classifyBash, settlePreviousSession } from "../extensions/herdr-agent-status.ts";

type Handler = (event: any, ctx: any) => Promise<void> | void;

function createHarness(options: { sessionExists?: (file: string) => boolean } = {}) {
	const handlers = new Map<string, Handler[]>();
	const bus = new Map<string, Array<(data: unknown) => void>>();
	const reports: boolean[] = [];
	const settled: string[] = [];

	const pi: any = {
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		events: {
			on(name: string, handler: (data: unknown) => void) {
				const list = bus.get(name) ?? [];
				list.push(handler);
				bus.set(name, list);
			},
			emit(name: string, data: unknown) {
				for (const handler of bus.get(name) ?? []) handler(data);
			},
		},
	};

	herdrAgentStatus(pi, {
		enabled: true,
		report: async (booked: boolean) => {
			reports.push(booked);
		},
		settle: async (sessionFile: string) => {
			settled.push(sessionFile);
		},
		sessionExists: options.sessionExists,
	});

	const ctx = { cwd: "/home/user/src/dotfiles", mode: "tui" };

	async function emit(event: string, payload: any = {}, context: any = ctx) {
		for (const handler of handlers.get(event) ?? []) {
			await handler(payload, context);
		}
	}

	return { emit, reports, settled, ctx, busEmit: pi.events.emit as (n: string, d: unknown) => void };
}

const bashCall = (command: string) => ({ toolName: "bash", input: { command } });
const bashResult = (command: string, isError = false) => ({
	toolName: "bash",
	input: { command },
	isError,
});

describe("classifyBash", () => {
	test("dotfiles commit settles, from cwd or after cd", () => {
		expect(classifyBash("git commit -m 'x'", "/home/user/src/dotfiles")).toBe("settle");
		expect(classifyBash("git add . && git commit -m 'x'", "/home/user/src/dotfiles")).toBe("settle");
		expect(classifyBash("cd ~/src/meta-dotfiles && sl commit -m 'x'", "/home/user/src")).toBe("settle");
		expect(classifyBash("sl amend", "/home/user/src/dotfiles")).toBe("settle");
	});

	test("commit outside dotfiles does not settle on its own", () => {
		expect(classifyBash("git commit -m 'x'", "/home/user/src/project")).toBe("mutating");
		expect(classifyBash("sl commit -m 'x'", "/home/user/fbsource")).toBe("mutating");
	});

	test("gh pr create/update settles anywhere", () => {
		expect(classifyBash("gh pr create --fill", "/home/user/src/project")).toBe("settle");
		expect(classifyBash("gh pr edit 12 --title x", "/home/user/src/project")).toBe("settle");
		expect(classifyBash("gh pr view 12", "/home/user/src/project")).toBe("readonly");
	});

	test("last non-read-only segment wins", () => {
		expect(classifyBash("git commit -m 'x' && ./tester", "/home/user/src/dotfiles")).toBe("mutating");
		expect(classifyBash("echo 'git commit' > /dev/null", "/home/user/src/dotfiles")).toBe("mutating");
	});

	test("read-only work is readonly, unknown work fails safe to mutating", () => {
		expect(classifyBash("sl status && git log --oneline -3", "/home/user/fbsource")).toBe("readonly");
		expect(classifyBash("presto --execute 'select 1' ns", "/home/user/fbsource")).toBe("readonly");
		expect(classifyBash("cat file.ts | grep book", "/home/user/src")).toBe("readonly");
		expect(classifyBash("some-random-tool --write", "/home/user/src")).toBe("mutating");
		expect(classifyBash("rm file.ts", "/home/user/src")).toBe("mutating");
		expect(classifyBash("echo hi > out.txt", "/home/user/src")).toBe("mutating");
	});
});

describe("herdr-agent-status extension", () => {
	test("books on a successful dotfiles commit, clears on the next edit", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });

		await h.emit("tool_call", bashCall("git commit -m 'x'"));
		expect(h.reports).toEqual([]); // not yet: the commit has not run

		await h.emit("tool_result", bashResult("git commit -m 'x'"));
		expect(h.reports).toEqual([true]);

		await h.emit("tool_call", { toolName: "edit", input: { path: "a.ts" } });
		expect(h.reports).toEqual([true, false]);
	});

	test("failed settling command does not book; read-only bash keeps the mark", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });

		await h.emit("tool_result", bashResult("gh pr create --fill", true));
		expect(h.reports).toEqual([]);

		await h.emit("tool_result", bashResult("gh pr create --fill"));
		expect(h.reports).toEqual([true]);

		await h.emit("tool_call", bashCall("sl status"));
		await h.emit("tool_result", bashResult("sl status"));
		expect(h.reports).toEqual([true]);

		await h.emit("tool_call", bashCall("rm out.txt"));
		expect(h.reports).toEqual([true, false]);
	});

	test("settled event from another extension books the session", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });
		h.busEmit("herdr-agent-status:settled", { via: "jf submit" });
		expect(h.reports).toEqual([true]);
	});

	test("does nothing before a TUI session_start", async () => {
		const h = createHarness();
		await h.emit("tool_result", bashResult("git commit -m 'x'"));
		h.busEmit("herdr-agent-status:settled", { via: "jf submit" });
		expect(h.reports).toEqual([]);
	});

	test("/new settles the previous conversation and clears the book mark", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });
		await h.emit("tool_result", bashResult("git commit -m 'x'"));
		expect(h.reports).toEqual([true]);

		await h.emit("session_start", {
			reason: "new",
			previousSessionFile: "/tmp/prev-session.jsonl",
		});
		expect(h.reports).toEqual([true, false]);
		expect(h.settled).toEqual(["/tmp/prev-session.jsonl"]);
	});

	test("/new skips settling when the previous session was never flushed to disk", async () => {
		const h = createHarness({ sessionExists: () => false });
		await h.emit("session_start", {
			reason: "new",
			previousSessionFile: "/tmp/empty-session.jsonl",
		});
		expect(h.settled).toEqual([]);
	});

	test("/resume settles the previous conversation and clears the book mark", async () => {
		const h = createHarness();
		await h.emit("session_start", { reason: "startup" });
		await h.emit("tool_result", bashResult("git commit -m 'x'"));
		expect(h.reports).toEqual([true]);

		await h.emit("session_start", {
			reason: "resume",
			previousSessionFile: "/tmp/prev-session.jsonl",
		});
		expect(h.reports).toEqual([true, false]);
		expect(h.settled).toEqual(["/tmp/prev-session.jsonl"]);
	});

	test("/reload does not settle the current session", async () => {
		const h = createHarness();
		await h.emit("session_start", {
			reason: "reload",
		});
		expect(h.settled).toEqual([]);
	});

	test("settlePreviousSession writes the outgoing transcript into the settle store", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-settle-test-"));
		try {
			const transcript = path.join(tmpDir, "prev.jsonl");
			fs.writeFileSync(
				transcript,
				[
					JSON.stringify({ type: "session", version: 3, id: "abc", cwd: "/tmp/repo" }),
					JSON.stringify({ type: "message", message: { role: "user", content: "hello" } }),
					JSON.stringify({ type: "session_info", name: "Fix Auth Flow" }),
				].join("\n") + "\n",
			);
			const storeFile = path.join(tmpDir, "agent-sessions.json");
			fs.writeFileSync(
				storeFile,
				JSON.stringify({
					panes: {
						"w1:p1": {
							agent: "pi",
							cwd: "/tmp/repo",
							argv: ["pi"],
							session: { kind: "path", value: transcript, source: "herdr:pi" },
							identity: { workspace_id: "w1", workspace_label: "web", tab_id: "w1:t1", tab_label: "auth" },
						},
					},
				}),
			);

			const prevStateDir = process.env.SETTLED_STATE_DIR;
			const prevStore = process.env.SETTLED_AGENT_SESSIONS;
			const prevSocket = process.env.HERDR_SOCKET_PATH;
			process.env.SETTLED_STATE_DIR = tmpDir;
			process.env.SETTLED_AGENT_SESSIONS = storeFile;
			process.env.HERDR_SOCKET_PATH = path.join(tmpDir, "missing.sock");
			try {
				const ok = await settlePreviousSession(transcript, "w1:p1");
				expect(ok).toBe(true);
			} finally {
				if (prevStateDir === undefined) delete process.env.SETTLED_STATE_DIR;
				else process.env.SETTLED_STATE_DIR = prevStateDir;
				if (prevStore === undefined) delete process.env.SETTLED_AGENT_SESSIONS;
				else process.env.SETTLED_AGENT_SESSIONS = prevStore;
				if (prevSocket === undefined) delete process.env.HERDR_SOCKET_PATH;
				else process.env.HERDR_SOCKET_PATH = prevSocket;
			}

			const registry = JSON.parse(fs.readFileSync(path.join(tmpDir, "default.json"), "utf8"));
			expect(registry.settled[transcript]).toBeDefined();
			expect(registry.settled[transcript].title).toBe("Fix Auth Flow");
			expect(registry.settled[transcript].workspace_label).toBe("web");
			expect(registry.settled[transcript].cwd).toBe("/tmp/repo");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
