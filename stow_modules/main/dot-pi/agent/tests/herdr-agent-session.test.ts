import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "bun:test";
import herdrAgentSession, {
	LABEL_TIMEOUT_MS,
	writeHcLabels,
	type SessionLabelOptions,
} from "../extensions/herdr-agent-session.ts";

type Handler = (event: any, ctx: any) => Promise<void> | void;

function context(file: string | undefined = "/tmp/session.jsonl", id: string | undefined = "session-id", mode: string | undefined = "tui") {
	return { mode, hasUI: true, sessionManager: { getSessionFile: () => file, getSessionId: () => id } };
}

function createHarness(options: SessionLabelOptions = {}) {
	const handlers = new Map<string, Handler[]>();
	const writes: Array<{ terminalId: string; labels: string[] }> = [];
	const pi: any = {
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
	};
	herdrAgentSession(pi, {
		identity: () => "t7",
		writeLabels: async (terminalId, labels) => {
			writes.push({ terminalId, labels });
			return true;
		},
		...options,
	});
	async function emit(event: string, ctx: any = context(), payload: any = {}) {
		for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
	}
	return { emit, writes, handlers };
}

const labelsFor = (ref: string, kind = "path") => ["agent.kind=pi", `agent.session=${ref}`, `agent.session_kind=${kind}`];

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

describe("herdr-agent-session extension", () => {
	test("only registers lifecycle hooks and does not write during factory loading", () => {
		const h = createHarness();
		expect(h.writes).toEqual([]);
		expect([...h.handlers.keys()]).toEqual(["session_start", "agent_start", "session_shutdown"]);
	});

	test("publishes an exact path, preferring it over an ID", async () => {
		const h = createHarness();
		const file = "/tmp/session space=a;$x.jsonl";
		await h.emit("session_start", context(file, "ignored"));
		expect(h.writes).toEqual([{ terminalId: "t7", labels: labelsFor(file) }]);
	});

	test("falls back to ID and removes stale reference labels when neither exists", async () => {
		const h = createHarness();
		await h.emit("session_start");
		const ephemeral = context();
		ephemeral.sessionManager.getSessionFile = () => undefined as any;
		await h.emit("agent_start", ephemeral);
		ephemeral.sessionManager.getSessionId = () => undefined as any;
		await h.emit("agent_start", ephemeral);
		expect(h.writes.map((w) => w.labels)).toEqual([
			labelsFor("/tmp/session.jsonl"), labelsFor("session-id", "id"), labelsFor("", ""),
		]);
	});

	test("strictly gates every refresh on TUI mode and hc identity (not hasUI)", async () => {
		const h = createHarness();
		for (const mode of ["rpc", "print", "json", "unknown", ""]) {
			await h.emit("session_start", context("/tmp/child.jsonl", "child", mode));
			await h.emit("agent_start", context("/tmp/child.jsonl", "child", mode));
		}
		await h.emit("session_start", { mode: undefined, hasUI: true });
		await h.emit("agent_start", { hasUI: true });
		expect(h.writes).toEqual([]);
		for (const identity of [undefined, ""]) {
			const absent = createHarness({ identity: () => identity });
			await absent.emit("session_start", { mode: "tui" });
			await absent.emit("agent_start", { mode: "tui" });
			expect(absent.writes).toEqual([]);
		}
	});

	test("deduplicates successful writes and refreshes changed refs at both hooks", async () => {
		const h = createHarness();
		await h.emit("session_start");
		await h.emit("agent_start");
		await h.emit("session_start", context("/tmp/new.jsonl"), { reason: "new" });
		await h.emit("agent_start", context("/tmp/resumed.jsonl"));
		expect(h.writes.map((w) => w.labels)).toEqual([
			labelsFor("/tmp/session.jsonl"), labelsFor("/tmp/new.jsonl"), labelsFor("/tmp/resumed.jsonl"),
		]);
	});

	test("includes terminal identity in deduplication", async () => {
		let terminal = "t7";
		const h = createHarness({ identity: () => terminal });
		await h.emit("session_start");
		terminal = "t8";
		await h.emit("agent_start");
		expect(h.writes.map((w) => w.terminalId)).toEqual(["t7", "t8"]);
	});

	test("retries false results and exceptions, without rejecting lifecycle hooks", async () => {
		let attempts = 0;
		const h = createHarness({ writeLabels: async () => {
			attempts++;
			if (attempts === 1) return false;
			if (attempts === 2) throw new Error("hc unavailable");
			return true;
		} });
		await h.emit("session_start");
		await h.emit("agent_start");
		await h.emit("agent_start");
		await h.emit("agent_start");
		expect(attempts).toBe(3);
	});

	test("a failed changed ref invalidates the previous successful cache", async () => {
		const refs: string[] = [];
		const h = createHarness({ writeLabels: async (_terminal, labels) => {
			refs.push(labels[1]);
			return refs.length !== 2;
		} });
		await h.emit("session_start");
		await h.emit("agent_start", context("/tmp/other.jsonl"));
		await h.emit("agent_start");
		expect(refs).toEqual(["agent.session=/tmp/session.jsonl", "agent.session=/tmp/other.jsonl", "agent.session=/tmp/session.jsonl"]);
	});

	test("serializes overlapping writes and deduplicates queued identical refs", async () => {
		const first = deferred<boolean>();
		const started = deferred<void>();
		const refs: string[] = [];
		const h = createHarness({ writeLabels: async (_terminal, labels) => {
			refs.push(labels[1]);
			if (refs.length === 1) { started.resolve(); return first.promise; }
			return true;
		} });
		const old = h.emit("session_start");
		await started.promise;
		const next = h.emit("session_start", context("/tmp/new.jsonl"), { reason: "new" });
		const duplicate = h.emit("agent_start", context("/tmp/new.jsonl"));
		const resumed = h.emit("session_start", context("/tmp/resume.jsonl"), { reason: "resume" });
		expect(refs).toEqual(["agent.session=/tmp/session.jsonl"]);
		first.resolve(true);
		await Promise.all([old, next, duplicate, resumed]);
		expect(refs).toEqual(["agent.session=/tmp/session.jsonl", "agent.session=/tmp/new.jsonl", "agent.session=/tmp/resume.jsonl"]);
	});

	test("root shutdown clears all owned labels on the last observed terminal, once", async () => {
		let terminal: string | undefined = "t7";
		const h = createHarness({ identity: () => terminal });
		await h.emit("session_start");
		terminal = "t8";
		await h.emit("agent_start");
		terminal = undefined; // Shutdown must not re-read inherited/dynamic identity.
		await h.emit("session_shutdown", context(), { reason: "quit" });
		await h.emit("session_shutdown");
		await h.emit("agent_start");
		expect(h.writes).toEqual([
			{ terminalId: "t7", labels: labelsFor("/tmp/session.jsonl") },
			{ terminalId: "t8", labels: labelsFor("/tmp/session.jsonl") },
			{ terminalId: "t8", labels: ["agent.kind=", "agent.session=", "agent.session_kind="] },
		]);
	});

	test("does not clear without an observed root TUI hc session", async () => {
		const unstarted = createHarness();
		await unstarted.emit("session_shutdown");
		expect(unstarted.writes).toEqual([]);
		const absent = createHarness({ identity: () => undefined });
		await absent.emit("session_start");
		await absent.emit("session_shutdown");
		expect(absent.writes).toEqual([]);
		for (const mode of ["print", "rpc", "json"]) {
			const child = createHarness();
			await child.emit("session_start", context("/tmp/child.jsonl", "child", mode));
			await child.emit("session_shutdown", context("/tmp/child.jsonl", "child", mode));
			await child.emit("session_shutdown");
			expect(child.writes).toEqual([]);
		}
	});

	test("child shutdown cannot clear root labels or stop subsequent root refreshes", async () => {
		const h = createHarness();
		await h.emit("session_start");
		for (const mode of ["print", "rpc", "json"]) {
			await h.emit("session_shutdown", context("/tmp/child.jsonl", "child", mode));
		}
		await h.emit("agent_start", context("/tmp/root.jsonl"));
		expect(h.writes.map((w) => w.labels)).toEqual([
			labelsFor("/tmp/session.jsonl"), labelsFor("/tmp/root.jsonl"),
		]);
	});

	test("shutdown clear failures remain best effort and block late hooks", async () => {
		for (const throws of [false, true]) {
			let attempts = 0;
			const h = createHarness({ writeLabels: async () => {
				attempts++;
				if (attempts === 2 && throws) throw new Error("hc unavailable");
				return attempts === 1;
			} });
			await h.emit("session_start");
			await h.emit("session_shutdown");
			await h.emit("agent_start");
			expect(attempts).toBe(2);
		}
	});

	test("shutdown drains writes then clears before replacement and blocks late old hooks", async () => {
		for (const reason of ["new", "reload"]) {
			const first = deferred<boolean>();
			const started = deferred<void>();
			const clearing = deferred<void>();
			const clear = deferred<boolean>();
			const refs: string[] = [];
			const old = createHarness({ writeLabels: async (_terminal, labels) => {
				if (labels[0] === "agent.kind=") {
					clearing.resolve();
					await clear.promise;
				} else {
					started.resolve();
					await first.promise;
				}
				refs.push(labels[1]);
				return true;
			} });
			const refreshing = old.emit("agent_start");
			await started.promise;
			let drained = false;
			const shutdown = old.emit("session_shutdown", context(), { reason }).then(() => { drained = true; });
			await old.emit("session_start", context("/tmp/stale.jsonl"));
			expect(drained).toBe(false);
			expect(refs).toEqual([]);
			first.resolve(true);
			await clearing.promise;
			expect(refs).toEqual(["agent.session=/tmp/session.jsonl"]);
			expect(drained).toBe(false); // Draining writes alone is not enough.
			clear.resolve(true);
			await Promise.all([refreshing, shutdown]);
			const replacement = createHarness({ writeLabels: async (_terminal, labels) => {
				refs.push(labels[1]); return true;
			} });
			await replacement.emit("session_start", context("/tmp/new.jsonl"));
			await old.emit("agent_start");
			expect(refs).toEqual(["agent.session=/tmp/session.jsonl", "agent.session=", "agent.session=/tmp/new.jsonl"]);
		}
	});
});

// Exercise the real subprocess writer using a temporary executable, never the
// user's hc core. Restore PATH immediately after spawn, before awaiting it.
function fakeHc(script: string, run: () => Promise<boolean>) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-label-test-"));
	fs.writeFileSync(path.join(dir, "hc"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
	const previousPath = process.env.PATH;
	let result: Promise<boolean>;
	try {
		process.env.PATH = `${dir}:${previousPath ?? ""}`;
		result = run();
	} finally {
		if (previousPath === undefined) delete process.env.PATH;
		else process.env.PATH = previousPath;
	}
	return result.finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

describe("native hc label writer", () => {
	test("passes label argv literally without a shell", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-label-argv-"));
		try {
			const output = path.join(dir, "args");
			const labels = labelsFor("/tmp/spaces and = ; $(exit 9).jsonl");
			expect(await fakeHc(`printf '%s\\n' "$@" > ${JSON.stringify(output)}`, () => writeHcLabels("t7", labels))).toBe(true);
			expect(fs.readFileSync(output, "utf8").trimEnd().split("\n")).toEqual(["label", "t7", ...labels]);
		} finally { fs.rmSync(dir, { recursive: true, force: true }); }
	});

	test("nonzero subprocess exits fail best effort", async () => {
		expect(await fakeHc("exit 3", () => writeHcLabels("t7", labelsFor("x")))).toBe(false);
	});

	test("kills an unresponsive process within the bounded timeout", async () => {
		const start = Date.now();
		expect(await fakeHc("exec /bin/sleep 30", () => writeHcLabels("t7", labelsFor("x")))).toBe(false);
		expect(Date.now() - start).toBeLessThan(LABEL_TIMEOUT_MS + 2000);
	});
});
