import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "bun:test";
import cdExtension, {
	buildPiResumeCommand,
	encodeSessionDirName,
	getDirectoryCompletions,
	migrateSessionFile,
	PYTHON_RESTART_SCRIPT,
	type RestartPayload,
	resolveHerdrTarget,
	resolveTargetDirectory,
} from "../extensions/cd.ts";

function createHarness(options: {
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	mode?: string;
	sessionId?: string;
	sessionFile?: string;
	header?: Record<string, unknown> | null;
	entries?: unknown[];
}) {
	let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;
	let completionHandler: ((prefix: string) => any) | undefined;
	const sessionStartHandlers: Array<(event: any, ctx: any) => void> = [];
	const notifications: Array<{ message: string; level: string }> = [];
	const spawned: RestartPayload[] = [];
	let shutdownCalled = false;

	const pi: any = {
		on(event: string, handler: (event: any, ctx: any) => void) {
			if (event === "session_start") {
				sessionStartHandlers.push(handler);
			}
		},
		registerCommand(name: string, spec: any) {
			if (name === "cd") {
				commandHandler = spec.handler;
				completionHandler = spec.getArgumentCompletions;
			}
		},
	};

	const env = options.env ?? {};
	cdExtension(pi, {
		env,
		piPid: 4242,
		piPpid: 4141,
		spawnDetached: (payload) => {
			spawned.push(payload);
		},
		shutdown: () => {
			shutdownCalled = true;
		},
	});

	const ctx = {
		cwd: options.cwd ?? "/tmp",
		mode: options.mode ?? "tui",
		isIdle: () => true,
		waitForIdle: async () => {},
		ui: {
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
		},
		sessionManager: {
			getSessionId: () => options.sessionId ?? "11111111-2222-3333-4444-555555555555",
			getSessionFile: () => options.sessionFile,
			getHeader: () =>
				options.header ?? {
					type: "session",
					version: 3,
					id: options.sessionId ?? "11111111-2222-3333-4444-555555555555",
					timestamp: "2026-11-11T00:00:00.000Z",
					cwd: options.cwd ?? "/tmp",
				},
			getEntries: () => options.entries ?? [],
		},
	};

	for (const h of sessionStartHandlers) {
		h({ reason: "startup" }, ctx);
	}

	return {
		async runCd(args: string) {
			if (!commandHandler) throw new Error("cd command not registered");
			await commandHandler(args, ctx);
		},
		complete(prefix: string) {
			return completionHandler?.(prefix) ?? null;
		},
		notifications,
		spawned,
		isShutdownCalled: () => shutdownCalled,
	};
}

describe("resolveHerdrTarget", () => {
	test("rejects environment outside Herdr and hc", () => {
		expect(resolveHerdrTarget({})).toBeNull();
		expect(resolveHerdrTarget({ HERDR_ENV: "0", HERDR_PANE_ID: "w1:p1" })).toBeNull();
		expect(resolveHerdrTarget({ HERDR_ENV: "1" })).toBeNull();
	});

	test("detects legacy herdr pane", () => {
		expect(resolveHerdrTarget({ HERDR_ENV: "1", HERDR_PANE_ID: "w3D:p5" })).toEqual({
			backend: "herdr",
			paneId: "w3D:p5",
		});
	});

	test("detects hc terminal session, including when TERM_PROGRAM is ghostty", () => {
		expect(resolveHerdrTarget({ HC_TERMINAL_ID: "t3" })).toEqual({
			backend: "hc",
			paneId: "t3",
		});
		expect(
			resolveHerdrTarget({
				HERDR_ENV: "1",
				HERDR_PANE_ID: "w1:p1",
				HC_TERMINAL_ID: "t9",
				TERM_PROGRAM: "ghostty",
			}),
		).toEqual({
			backend: "hc",
			paneId: "t9",
		});
	});
});

describe("encodeSessionDirName and migrateSessionFile", () => {
	test("encodes working directory path matching Pi SessionManager", () => {
		expect(encodeSessionDirName("/home/thalesmello/src/dotfiles")).toBe("--home-thalesmello-src-dotfiles--");
	});

	test("moves existing session file to target directory bucket and updates header cwd", () => {
		const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cd-test-"));
		try {
			const oldCwd = path.join(tmpRoot, "old-proj");
			const newCwd = path.join(tmpRoot, "new-proj");
			fs.mkdirSync(oldCwd, { recursive: true });
			fs.mkdirSync(newCwd, { recursive: true });

			const sessionsRoot = path.join(tmpRoot, "sessions");
			const oldBucket = path.join(sessionsRoot, encodeSessionDirName(oldCwd));
			fs.mkdirSync(oldBucket, { recursive: true });

			const sessionId = "6195df6b-7397-4c24-99c5-798d5ef60d28";
			const fileName = `2026-11-11T23-39-26-080Z_${sessionId}.jsonl`;
			const oldSessionFile = path.join(oldBucket, fileName);

			fs.writeFileSync(
				oldSessionFile,
				[
					JSON.stringify({
						type: "session",
						version: 3,
						id: sessionId,
						timestamp: "2026-11-11T23:39:26.080Z",
						cwd: oldCwd,
					}),
					JSON.stringify({
						type: "message",
						id: "m1",
						parentId: null,
						message: { role: "user", content: "hello" },
					}),
					JSON.stringify({
						type: "session_info",
						id: "s1",
						parentId: "m1",
						name: "Develop CD Command",
					}),
				].join("\n") + "\n",
			);

			const result = migrateSessionFile({
				currentSessionFile: oldSessionFile,
				sessionId,
				targetCwd: newCwd,
			});

			const expectedDir = path.join(sessionsRoot, encodeSessionDirName(newCwd));
			const expectedFile = path.join(expectedDir, fileName);
			expect(result.targetSessionDir).toBe(expectedDir);
			expect(result.targetSessionFile).toBe(expectedFile);
			expect(fs.existsSync(oldSessionFile)).toBe(false);
			expect(fs.existsSync(expectedFile)).toBe(true);

			const lines = fs
				.readFileSync(expectedFile, "utf8")
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l));
			expect(lines[0].type).toBe("session");
			expect(lines[0].id).toBe(sessionId);
			expect(lines[0].cwd).toBe(newCwd);
			expect(lines[1].message.content).toBe("hello");
			expect(lines[2].name).toBe("Develop CD Command");
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	test("materializes un-flushed session when file does not exist on disk yet", () => {
		const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cd-unflushed-"));
		try {
			const oldCwd = path.join(tmpRoot, "old");
			const newCwd = path.join(tmpRoot, "new");
			const agentDir = path.join(tmpRoot, "agent");
			const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
			const unflushedFile = path.join(
				agentDir,
				"sessions",
				encodeSessionDirName(oldCwd),
				`2026-11-11T00-00-00-000Z_${sessionId}.jsonl`,
			);

			const result = migrateSessionFile({
				currentSessionFile: unflushedFile,
				sessionId,
				targetCwd: newCwd,
				header: {
					type: "session",
					version: 3,
					id: sessionId,
					timestamp: "2026-11-11T00:00:00.000Z",
					cwd: oldCwd,
				},
				entries: [{ type: "model_change", id: "mc1", parentId: null, provider: "google", modelId: "gemini" }],
				agentDir,
			});

			expect(fs.existsSync(result.targetSessionFile)).toBe(true);
			const lines = fs
				.readFileSync(result.targetSessionFile, "utf8")
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l));
			expect(lines[0].cwd).toBe(newCwd);
			expect(lines[1].type).toBe("model_change");
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});
});

describe("buildPiResumeCommand", () => {
	test("strips old session flags and initial prompt while keeping model/thinking flags", () => {
		const argv = [
			"/usr/local/bin/pi_cli/pi",
			"--model",
			"google/gemini-3-flash-preview",
			"--thinking",
			"high",
			"--session-id",
			"6195df6b-7397-4c24-99c5-798d5ef60d28",
			"--",
			"We're working on develop-cd-command.",
		];
		expect(buildPiResumeCommand(argv, "/tmp/sessions/new.jsonl")).toEqual([
			"pi",
			"--model",
			"google/gemini-3-flash-preview",
			"--thinking",
			"high",
			"--session",
			"/tmp/sessions/new.jsonl",
		]);
	});
});

describe("/cd extension command", () => {
	test("fails outside Herdr without moving session or shutting down", async () => {
		const h = createHarness({ env: { HERDR_ENV: "0" } });
		await h.runCd("/tmp");
		expect(h.notifications).toEqual([
			{ message: "The /cd command is only supported inside Herdr", level: "error" },
		]);
		expect(h.spawned).toEqual([]);
		expect(h.isShutdownCalled()).toBe(false);
	});

	test("moves session file, spawns detached restarter, and shuts down in herdr mode", async () => {
		const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cd-herdr-"));
		try {
			const oldDir = fs.realpathSync(fs.mkdtempSync(path.join(tmpRoot, "from-")));
			const newDir = fs.realpathSync(fs.mkdtempSync(path.join(tmpRoot, "to-")));
			const sessionsRoot = path.join(tmpRoot, "sessions");
			const oldBucket = path.join(sessionsRoot, encodeSessionDirName(oldDir));
			fs.mkdirSync(oldBucket, { recursive: true });

			const sessionId = "6195df6b-7397-4c24-99c5-798d5ef60d28";
			const oldFile = path.join(oldBucket, `2026-11-11_${sessionId}.jsonl`);
			fs.writeFileSync(
				oldFile,
				`${JSON.stringify({ type: "session", version: 3, id: sessionId, cwd: oldDir })}\n`,
			);

			const h = createHarness({
				env: { HERDR_ENV: "1", HERDR_PANE_ID: "w3D:p5", HOME: tmpRoot },
				cwd: oldDir,
				sessionId,
				sessionFile: oldFile,
			});

			await h.runCd(newDir);

			expect(h.isShutdownCalled()).toBe(true);
			expect(h.spawned).toHaveLength(1);
			const payload = h.spawned[0]!;
			expect(payload.backend).toBe("herdr");
			expect(payload.paneId).toBe("w3D:p5");
			expect(payload.targetCwd).toBe(newDir);
			expect(fs.existsSync(oldFile)).toBe(false);
			expect(fs.existsSync(payload.targetSessionFile)).toBe(true);
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	test("supports hc mode (HC_TERMINAL_ID) and relative / ~ paths", async () => {
		const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-cd-hc-")));
		try {
			const oldDir = path.join(tmpRoot, "src");
			const newDir = path.join(tmpRoot, "src", "dotfiles");
			fs.mkdirSync(newDir, { recursive: true });

			const sessionsRoot = path.join(tmpRoot, ".pi", "agent", "sessions");
			const oldBucket = path.join(sessionsRoot, encodeSessionDirName(oldDir));
			fs.mkdirSync(oldBucket, { recursive: true });

			const sessionId = "99999999-8888-7777-6666-555555555555";
			const oldFile = path.join(oldBucket, `2026-11-11_${sessionId}.jsonl`);
			fs.writeFileSync(
				oldFile,
				`${JSON.stringify({ type: "session", version: 3, id: sessionId, cwd: oldDir })}\n`,
			);

			const h = createHarness({
				env: { HC_TERMINAL_ID: "t7", HOME: tmpRoot },
				cwd: oldDir,
				sessionId,
				sessionFile: oldFile,
			});

			await h.runCd("~/src/dotfiles");

			expect(h.isShutdownCalled()).toBe(true);
			expect(h.spawned).toHaveLength(1);
			expect(h.spawned[0]!.backend).toBe("hc");
			expect(h.spawned[0]!.paneId).toBe("t7");
			expect(h.spawned[0]!.targetCwd).toBe(newDir);
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	test("executes PYTHON_RESTART_SCRIPT end-to-end against mocked hc-preset", () => {
		const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-cd-py-")));
		try {
			const binDir = path.join(tmpRoot, "bin");
			const logFile = path.join(tmpRoot, "calls.jsonl");
			fs.mkdirSync(binDir, { recursive: true });

			const mockHcPreset = path.join(binDir, "hc-preset");
			fs.writeFileSync(
				mockHcPreset,
				`#!/usr/bin/env python3
import json, os, sys
with open(${JSON.stringify(logFile)}, "a") as f:
    f.write(json.dumps(sys.argv[1:]) + "\\n")
args = sys.argv[1:]
if "process-info" in args:
    print(json.dumps({
        "result": {
            "process_info": {
                "pane_id": "t7",
                "shell_pid": 100,
                "foreground_process_group_id": 100,
                "foreground_processes": [
                    {"pid": 100, "name": "fish", "argv": ["fish"]}
                ]
            }
        }
    }))
else:
    print(json.dumps({"result": {"type": "ok"}}))
`,
				{ mode: 0o755 },
			);

			const payload: RestartPayload = {
				backend: "hc",
				paneId: "t7",
				targetCwd: "/Users/test/src/dotfiles",
				targetSessionFile: "/Users/test/.pi/agent/sessions/--Users-test-src-dotfiles--/sess.jsonl",
				sessionId: "sess-1",
				piPid: 999999,
				piPpid: 100,
			};

			const res = spawnSync("python3", ["-c", PYTHON_RESTART_SCRIPT, JSON.stringify(payload)], {
				env: {
					...process.env,
					HOME: tmpRoot,
					PATH: `${binDir}:${process.env.PATH ?? ""}`,
				},
				encoding: "utf8",
			});
			expect(res.status).toBe(0);

			const calls = fs
				.readFileSync(logFile, "utf8")
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l) as string[]);

			const runCall = calls.find((c) => c.includes("run"));
			expect(runCall).toBeDefined();
			expect(runCall).toEqual([
				"--backend",
				"hc",
				"pane",
				"run",
				"t7",
				"cd /Users/test/src/dotfiles && pi --session /Users/test/.pi/agent/sessions/--Users-test-src-dotfiles--/sess.jsonl",
			]);
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	test("provides directory completions for subdirectories", () => {
		const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-cd-comp-")));
		try {
			fs.mkdirSync(path.join(tmpRoot, "alpha"));
			fs.mkdirSync(path.join(tmpRoot, "alpine"));
			fs.writeFileSync(path.join(tmpRoot, "alpaca.txt"), "file");

			const items = getDirectoryCompletions("al", tmpRoot, { HOME: tmpRoot });
			expect(items?.map((i) => i.value)).toEqual(["alpha/", "alpine/"]);

			const resolved = resolveTargetDirectory("alpha", tmpRoot, { HOME: tmpRoot });
			expect(resolved).toEqual({ ok: true, path: path.join(tmpRoot, "alpha") });
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});
});
