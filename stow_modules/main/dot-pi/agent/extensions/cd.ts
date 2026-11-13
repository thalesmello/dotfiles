/**
 * cd.ts -- `/cd <dir>` command for Pi inside Herdr (`herdr` and `hc`).
 *
 * Changes the working directory of the current Pi session in place:
 *   1. Moves the session `.jsonl` file into the target directory's session
 *      bucket (`~/.pi/agent/sessions/--<encoded-cwd>--/`) and updates `"cwd"`
 *      in its `{"type":"session",...}` header.
 *   2. Spawns a detached (`nohup`) helper process that terminates the current
 *      Pi process, `cd`s the current Herdr pane/terminal (`herdr` or `hc`) to
 *      the target directory, and restarts Pi attached to the moved session.
 *
 * Unsupported outside Herdr (`HERDR_ENV=1` + `HERDR_PANE_ID`, or `HC_TERMINAL_ID`).
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

export type HerdrBackend = "herdr" | "hc";

export interface HerdrTarget {
	backend: HerdrBackend;
	paneId: string;
}

export interface MigrateSessionOptions {
	currentSessionFile?: string;
	sessionId: string;
	targetCwd: string;
	header?: Record<string, unknown> | null;
	entries?: unknown[];
	agentDir?: string;
}

export interface MigrateSessionResult {
	previousSessionFile?: string;
	targetSessionDir: string;
	targetSessionFile: string;
	sessionId: string;
}

export interface RestartPayload {
	backend: HerdrBackend;
	paneId: string;
	targetCwd: string;
	targetSessionFile: string;
	sessionId: string;
	piPid: number;
	piPpid: number;
}

export interface CdExtensionDeps {
	env?: NodeJS.ProcessEnv;
	spawnDetached?: (payload: RestartPayload, env: NodeJS.ProcessEnv) => void;
	shutdown?: (ctx: ExtensionCommandContext) => void;
	piPid?: number;
	piPpid?: number;
}

/** Detect whether the environment is an `hc` (`herdr-core` + `herdr-app`) terminal. */
export function isHcSession(env: NodeJS.ProcessEnv = process.env): boolean {
	if (!env.HC_TERMINAL_ID) return false;
	if (env.HERDR_ENV !== "1") return true;
	return env.TERM_PROGRAM === "ghostty";
}

/** Detect whether the environment is a legacy `herdr` TUI pane. */
export function isHerdrSession(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.HERDR_ENV === "1" && Boolean(env.HERDR_PANE_ID) && !isHcSession(env);
}

/** Resolve the active Herdr/hc backend and target pane/terminal ID, or null if outside Herdr. */
export function resolveHerdrTarget(env: NodeJS.ProcessEnv = process.env): HerdrTarget | null {
	if (isHcSession(env) && env.HC_TERMINAL_ID) {
		return { backend: "hc", paneId: env.HC_TERMINAL_ID };
	}
	if (isHerdrSession(env) && env.HERDR_PANE_ID) {
		return { backend: "herdr", paneId: env.HERDR_PANE_ID };
	}
	return null;
}

/** Encode a working directory path into Pi's `--<path>--` session directory name. */
export function encodeSessionDirName(cwd: string): string {
	const resolved = path.resolve(cwd);
	return `--${resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/** Strip optional surrounding quotes or backslash-escaped spaces from `/cd <arg>`. */
export function parseCdArgument(rawArgs: string): string {
	const trimmed = rawArgs.trim();
	if (!trimmed) return "";
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed.replace(/\\ /g, " ");
}

/** Expand `~` and `$HOME` and resolve against `currentCwd`, canonicalizing symlinks via `realpathSync`. */
export function resolveTargetDirectory(
	rawArg: string,
	currentCwd: string,
	env: NodeJS.ProcessEnv = process.env,
): { ok: true; path: string } | { ok: false; error: string } {
	const parsed = parseCdArgument(rawArg);
	if (!parsed) {
		return { ok: false, error: "Usage: /cd <directory>" };
	}

	const home = env.HOME || os.homedir();
	let expanded = parsed;
	if (expanded === "~" || expanded === "$HOME") {
		expanded = home;
	} else if (expanded.startsWith("~/")) {
		expanded = path.join(home, expanded.slice(2));
	} else if (expanded.startsWith("$HOME/")) {
		expanded = path.join(home, expanded.slice(6));
	}

	const candidate = path.resolve(currentCwd, expanded);
	let stat: fs.Stats;
	try {
		stat = fs.statSync(candidate);
	} catch {
		return { ok: false, error: `Directory not found: ${candidate}` };
	}
	if (!stat.isDirectory()) {
		return { ok: false, error: `Not a directory: ${candidate}` };
	}

	try {
		return { ok: true, path: fs.realpathSync(candidate) };
	} catch {
		return { ok: true, path: candidate };
	}
}

/** Find the root `~/.pi/agent/sessions` directory from an existing session file or environment. */
export function resolveSessionsRoot(
	currentSessionFile: string | undefined,
	agentDir?: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	if (currentSessionFile) {
		const parentDir = path.dirname(currentSessionFile);
		const parentName = path.basename(parentDir);
		if (/^--.*--$/.test(parentName)) {
			return path.dirname(parentDir);
		}
	}
	const baseAgentDir = agentDir || env.PI_CODING_AGENT_DIR || path.join(env.HOME || os.homedir(), ".pi", "agent");
	return path.join(path.resolve(baseAgentDir), "sessions");
}

/** Rewrite the `{"type":"session",...}` header line(s) in JSONL content to update `cwd`. */
export function rewriteSessionJsonlCwd(content: string, targetCwd: string, fallbackSessionId?: string): string {
	const lines = content.split("\n");
	let updatedHeader = false;
	const out: string[] = [];

	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			if (parsed && parsed.type === "session") {
				parsed.cwd = targetCwd;
				updatedHeader = true;
				out.push(JSON.stringify(parsed));
				continue;
			}
		} catch {
			// Keep non-JSON lines untouched
		}
		out.push(line);
	}

	if (!updatedHeader && fallbackSessionId) {
		const header = {
			type: "session",
			version: 3,
			id: fallbackSessionId,
			timestamp: new Date().toISOString(),
			cwd: targetCwd,
		};
		out.unshift(JSON.stringify(header));
	}

	return `${out.join("\n")}\n`;
}

/**
 * Move the active session `.jsonl` file into the target directory's session folder
 * and update `"cwd"` in the session header. If the session has not yet been flushed
 * to disk, materializes the header + in-memory entries at the target path.
 */
export function migrateSessionFile(
	options: MigrateSessionOptions,
	env: NodeJS.ProcessEnv = process.env,
): MigrateSessionResult {
	const { currentSessionFile, sessionId, targetCwd, header, entries = [], agentDir } = options;
	const sessionsRoot = resolveSessionsRoot(currentSessionFile, agentDir, env);
	const targetSessionDir = path.join(sessionsRoot, encodeSessionDirName(targetCwd));
	fs.mkdirSync(targetSessionDir, { recursive: true });

	const fileName = currentSessionFile
		? path.basename(currentSessionFile)
		: `${new Date().toISOString().replace(/[:.]/g, "-")}_${sessionId}.jsonl`;
	const targetSessionFile = path.join(targetSessionDir, fileName);

	let serialized: string;
	if (currentSessionFile && fs.existsSync(currentSessionFile)) {
		const raw = fs.readFileSync(currentSessionFile, "utf8");
		serialized = rewriteSessionJsonlCwd(raw, targetCwd, sessionId);
	} else {
		const sessionHeader = {
			type: "session",
			version: 3,
			id: sessionId,
			timestamp: new Date().toISOString(),
			...(header ?? {}),
			cwd: targetCwd,
		};
		const records = [sessionHeader, ...entries];
		serialized = `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
	}

	const tmpFile = `${targetSessionFile}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmpFile, serialized, "utf8");
	fs.renameSync(tmpFile, targetSessionFile);

	if (
		currentSessionFile &&
		path.resolve(currentSessionFile) !== path.resolve(targetSessionFile) &&
		fs.existsSync(currentSessionFile)
	) {
		try {
			fs.unlinkSync(currentSessionFile);
		} catch {
			// Best-effort cleanup of old session file
		}
	}

	return {
		previousSessionFile: currentSessionFile,
		targetSessionDir,
		targetSessionFile,
		sessionId,
	};
}

/**
 * Build the `pi` resume argv from a recorded launch argv, stripping old session
 * selection flags and initial prompt positional arguments while keeping flags
 * such as `--model`, `--thinking`, etc.
 */
export function buildPiResumeCommand(launchArgv: string[], targetSessionFile: string): string[] {
	const dropValue = new Set(["--session", "--session-id", "--fork"]);
	const dropOpt = new Set(["--resume", "-r"]);
	const dropBool = new Set(["--continue", "-c", "--no-session"]);
	const keepValue = new Set([
		"--model",
		"-m",
		"--name",
		"-n",
		"--system",
		"--system-prompt",
		"--append-system-prompt",
		"--tools",
		"--thinking",
		"--provider",
		"--session-dir",
		"--meta-agent-role",
		"--startup-context-mode",
		"--extension",
		"-e",
		"--skill",
	]);
	const boolFlags = new Set(["--verbose", "--quiet", "--no-tools", "--no-extensions", "--no-skills", "--no-context-files"]);

	function flagName(token: string): string {
		return token.split("=", 1)[0] ?? token;
	}

	function isBoolFlag(token: string): boolean {
		return token.startsWith("--no-") || boolFlags.has(token);
	}

	const kept: string[] = [];
	const rest = launchArgv.length > 0 ? launchArgv.slice(1) : [];
	let i = 0;
	while (i < rest.length) {
		const tok = rest[i]!;
		const f = flagName(tok);
		const inline = tok.startsWith("-") && tok.includes("=");
		if (tok === "--") {
			break;
		}
		if (dropValue.has(f) || dropOpt.has(f)) {
			if (inline) {
				i += 1;
			} else if (i + 1 < rest.length && (dropValue.has(f) || !rest[i + 1]!.startsWith("-"))) {
				i += 2;
			} else {
				i += 1;
			}
		} else if (dropBool.has(f)) {
			i += 1;
		} else if (keepValue.has(f) && !inline) {
			if (i + 1 < rest.length) {
				kept.push(tok, rest[i + 1]!);
				i += 2;
			} else {
				kept.push(tok);
				i += 1;
			}
		} else if (!tok.startsWith("-")) {
			const prev = kept.at(-1);
			if (prev !== undefined && prev.startsWith("-") && !prev.includes("=") && !isBoolFlag(prev)) {
				kept.push(tok);
			}
			i += 1;
		} else {
			kept.push(tok);
			i += 1;
		}
	}

	let argv0 = launchArgv[0] || "pi";
	const base = path.basename(argv0);
	if (base === "pi" || base === "pi.real" || base === "node" || base === "bun") {
		argv0 = "pi";
	}

	return [argv0, ...kept, "--session", targetSessionFile];
}

/** Python script executed under `nohup` to kill current Pi, `cd` the pane, and restart Pi. */
export const PYTHON_RESTART_SCRIPT = String.raw`
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import time

SHELL_NAMES = {
    "sh", "bash", "zsh", "fish", "dash", "ksh", "mksh",
    "tcsh", "csh", "nu", "nushell", "elvish", "xonsh", "pwsh", "login",
}

DROP_VALUE = {"--session", "--session-id", "--fork"}
DROP_OPT = {"--resume", "-r"}
DROP_BOOL = {"--continue", "-c", "--no-session"}
KEEP_VALUE = {
    "--model", "-m", "--name", "-n", "--system", "--system-prompt",
    "--append-system-prompt", "--tools", "--thinking", "--provider",
    "--session-dir", "--meta-agent-role", "--startup-context-mode",
    "--extension", "-e", "--skill",
}
BOOL_FLAGS = {
    "--verbose", "--quiet", "--no-tools", "--no-extensions",
    "--no-skills", "--no-context-files",
}


def find_bin(name, env_var=None):
    if env_var:
        val = os.environ.get(env_var)
        if val and os.path.isfile(val) and os.access(val, os.X_OK):
            return val
    for candidate in (
        os.path.expanduser(f"~/src/dotfiles/bin/{name}"),
        os.path.expanduser(f"~/.local/bin/{name}"),
        os.path.expanduser(f"~/dotfiles/bin/{name}"),
        f"/opt/homebrew/bin/{name}",
        f"/usr/local/bin/{name}",
    ):
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return shutil.which(name)


def build_resume_argv(launch, session_file):
    def flag(tok):
        return tok.split("=", 1)[0]

    def is_bool(tok):
        return tok.startswith("--no-") or tok in BOOL_FLAGS

    kept = []
    rest = launch[1:] if launch else []
    i = 0
    while i < len(rest):
        tok = rest[i]
        f = flag(tok)
        inline = "=" in tok and tok.startswith("-")
        if tok == "--":
            break
        if f in DROP_VALUE or f in DROP_OPT:
            if inline:
                i += 1
            elif i + 1 < len(rest) and (f in DROP_VALUE or not rest[i + 1].startswith("-")):
                i += 2
            else:
                i += 1
        elif f in DROP_BOOL:
            i += 1
        elif f in KEEP_VALUE and not inline:
            kept.extend(rest[i : i + 2])
            i += 2
        elif not tok.startswith("-"):
            prev = kept[-1] if kept else None
            if prev is not None and prev.startswith("-") and "=" not in prev and not is_bool(prev):
                kept.append(tok)
            i += 1
        else:
            kept.append(tok)
            i += 1

    argv0 = launch[0] if launch else "pi"
    base = os.path.basename(argv0)
    if base in ("pi", "pi.real", "node", "bun"):
        argv0 = "pi"
    return [argv0] + kept + ["--session", session_file]


def quote_arg(shell_name, arg):
    safe = re.compile(r"^[A-Za-z0-9_@%+=:,./-]+$")
    if arg and safe.match(arg):
        return arg
    if shell_name == "fish":
        return "'" + arg.replace("\\", "\\\\").replace("'", "\\'") + "'"
    return shlex.quote(arg)


def format_command(shell_name, argv):
    return " ".join(quote_arg(shell_name, a) for a in argv)


def pid_alive(pid):
    if not isinstance(pid, int) or pid <= 1:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def terminate_pids(pids, grace_s=1.5):
    targets = [p for p in dict.fromkeys(pids) if isinstance(p, int) and p > 1]
    for p in targets:
        if pid_alive(p):
            try:
                os.kill(p, signal.SIGTERM)
            except OSError:
                pass
    deadline = time.monotonic() + grace_s
    while time.monotonic() < deadline:
        if not any(pid_alive(p) for p in targets):
            return
        time.sleep(0.05)
    for p in targets:
        if pid_alive(p):
            try:
                os.kill(p, signal.SIGKILL)
            except OSError:
                pass


def get_process_info(hc_preset, herdr, hc, backend, pane_id):
    cmds = []
    if hc_preset:
        cmds.append([hc_preset, "--backend", backend, "pane", "process-info", "--pane", pane_id])
    if backend == "herdr" and herdr:
        cmds.append([herdr, "pane", "process-info", "--pane", pane_id])
    for cmd in cmds:
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=3.0)
            if res.returncode == 0 and res.stdout:
                data = json.loads(res.stdout)
                info = (data.get("result") or {}).get("process_info")
                if isinstance(info, dict):
                    return info
        except Exception:
            pass
    if backend == "hc" and hc:
        try:
            res = subprocess.run([hc, "get", pane_id, "--json"], capture_output=True, text=True, timeout=3.0)
            if res.returncode == 0 and res.stdout:
                t_obj = json.loads(res.stdout)
                if isinstance(t_obj.get("result"), dict):
                    t_obj = t_obj["result"]
                shell_pid = t_obj.get("pid")
                fg = t_obj.get("foreground") or {}
                fg_pid = fg.get("pid") or shell_pid
                fg_name = os.path.basename(str(fg.get("name") or "fish"))
                return {
                    "pane_id": pane_id,
                    "shell_pid": shell_pid,
                    "foreground_process_group_id": fg_pid,
                    "foreground_processes": [
                        {
                            "pid": fg_pid,
                            "name": fg_name,
                            "argv": fg.get("argv") or [fg_name],
                        }
                    ] if fg_pid else [],
                }
        except Exception:
            pass
    return None


def available_shell_name(info):
    if not isinstance(info, dict):
        return None
    shell_pid = info.get("shell_pid")
    fg_pgid = info.get("foreground_process_group_id")
    procs = info.get("foreground_processes") or []
    for proc in procs:
        if not isinstance(proc, dict):
            continue
        name = os.path.basename(str(proc.get("name") or "")).lstrip("-")
        if proc.get("pid") == shell_pid and name in SHELL_NAMES and (fg_pgid == shell_pid or len(procs) == 1):
            return name
    if shell_pid is not None and fg_pgid == shell_pid:
        for proc in procs:
            if isinstance(proc, dict):
                name = os.path.basename(str(proc.get("name") or "")).lstrip("-")
                if name in SHELL_NAMES:
                    return name
        return "fish"
    return None


def wait_for_shell(hc_preset, herdr, hc, backend, pane_id, timeout_s=10.0):
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        info = get_process_info(hc_preset, herdr, hc, backend, pane_id)
        shell_name = available_shell_name(info)
        if shell_name:
            return shell_name
        time.sleep(0.1)
    return None


def run_in_pane(hc_preset, herdr, hc, backend, pane_id, command_text):
    if hc_preset:
        res = subprocess.run(
            [hc_preset, "--backend", backend, "pane", "run", pane_id, command_text],
            capture_output=True,
            text=True,
            timeout=5.0,
        )
        if res.returncode == 0:
            return True
    if backend == "herdr" and herdr:
        res = subprocess.run([herdr, "pane", "run", pane_id, command_text], capture_output=True, text=True, timeout=5.0)
        return res.returncode == 0
    if backend == "hc" and hc:
        res = subprocess.run([hc, "send", pane_id, command_text], capture_output=True, text=True, timeout=5.0)
        return res.returncode == 0
    return False


def release_and_report_session(hc_preset, herdr, hc, backend, pane_id, session_file):
    if backend == "herdr" and herdr:
        try:
            subprocess.run(
                [herdr, "pane", "release-agent", "--source", "herdr:pi", "--agent", "pi", pane_id],
                capture_output=True,
                timeout=2.0,
            )
        except Exception:
            pass
        try:
            subprocess.run(
                [
                    herdr, "pane", "report-agent-session",
                    "--source", "herdr:pi",
                    "--agent", "pi",
                    "--session-start-source", "resume",
                    "--agent-session-path", session_file,
                    pane_id,
                ],
                capture_output=True,
                timeout=2.0,
            )
        except Exception:
            pass
    elif hc_preset:
        try:
            subprocess.run(
                [
                    hc_preset, "--backend", backend, "rpc", "pane.report_agent_session",
                    json.dumps({
                        "pane_id": pane_id,
                        "source": "herdr:pi",
                        "agent": "pi",
                        "session_start_source": "resume",
                        "agent_session_path": session_file,
                    }),
                ],
                capture_output=True,
                timeout=3.0,
            )
        except Exception:
            pass
    elif backend == "hc" and hc:
        try:
            subprocess.run(
                [
                    hc, "label", pane_id,
                    "agent.kind=pi",
                    f"agent.session={session_file}",
                    "agent.session_kind=path",
                ],
                capture_output=True,
                timeout=3.0,
            )
        except Exception:
            pass


def split_replacement_pane(hc_preset, herdr, backend, pane_id, target_cwd):
    cmd = None
    if hc_preset:
        cmd = [hc_preset, "--backend", backend, "pane", "split", pane_id, "--direction", "right", "--cwd", target_cwd, "--focus"]
    elif backend == "herdr" and herdr:
        cmd = [herdr, "pane", "split", pane_id, "--direction", "right", "--cwd", target_cwd, "--focus"]
    if not cmd:
        return None
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=5.0)
        if res.returncode == 0 and res.stdout:
            data = json.loads(res.stdout)
            pane = (data.get("result") or {}).get("pane") or {}
            return pane.get("pane_id") or pane.get("terminal_id")
    except Exception:
        pass
    return None


def main():
    payload = json.loads(sys.argv[1])
    backend = payload["backend"]
    pane_id = payload["paneId"]
    target_cwd = payload["targetCwd"]
    session_file = payload["targetSessionFile"]
    pi_pid = int(payload.get("piPid") or 0)
    pi_ppid = int(payload.get("piPpid") or 0)

    hc_preset = find_bin("hc-preset")
    herdr = find_bin("herdr", "HERDR_BIN_PATH")
    hc = find_bin("hc", "HC_BIN_PATH")

    info = get_process_info(hc_preset, herdr, hc, backend, pane_id)
    shell_pid = info.get("shell_pid") if isinstance(info, dict) else None
    procs = (info.get("foreground_processes") if isinstance(info, dict) else None) or []

    launch_argv = ["pi"]
    pi_pids = []
    for proc in procs:
        if not isinstance(proc, dict):
            continue
        pid = proc.get("pid")
        name = os.path.basename(str(proc.get("name") or ""))
        argv = proc.get("argv") or []
        if name in ("pi", "pi.real") or (argv and os.path.basename(str(argv[0])) in ("pi", "pi.real")):
            if isinstance(argv, list) and argv and os.path.basename(str(argv[0])) == "pi":
                launch_argv = [str(x) for x in argv]
            if isinstance(pid, int) and pid > 1:
                pi_pids.append(pid)

    if pi_pid > 1:
        pi_pids.append(pi_pid)
    if pi_ppid > 1 and pi_ppid != shell_pid:
        pi_pids.append(pi_ppid)

    # Check if the pane was started with exec pi (no underlying shell process).
    no_underlying_shell = (
        isinstance(shell_pid, int)
        and shell_pid > 1
        and (shell_pid == pi_pid or shell_pid == pi_ppid or shell_pid in pi_pids)
    )

    target_pane = pane_id
    use_exec = False
    if no_underlying_shell:
        new_pane = split_replacement_pane(hc_preset, herdr, backend, pane_id, target_cwd)
        if new_pane:
            target_pane = new_pane
            use_exec = True

    # Give ctx.shutdown() a brief moment to flush and exit cleanly, then terminate.
    time.sleep(0.15)
    kill_list = [p for p in pi_pids if p != shell_pid or no_underlying_shell]
    terminate_pids(kill_list)

    shell_name = wait_for_shell(hc_preset, herdr, hc, backend, target_pane, timeout_s=10.0) or "fish"
    release_and_report_session(hc_preset, herdr, hc, backend, target_pane, session_file)

    resume_argv = build_resume_argv(launch_argv, session_file)
    pi_cmd = format_command(shell_name, resume_argv)
    if use_exec:
        pi_cmd = f"exec {pi_cmd}"
    cd_cmd = f"cd {quote_arg(shell_name, target_cwd)} && {pi_cmd}"
    run_in_pane(hc_preset, herdr, hc, backend, target_pane, cd_cmd)


if __name__ == "__main__":
    main()
`;

/** Spawn the detached (`nohup`) helper process that restarts Pi in `targetCwd`. */
export function defaultSpawnDetached(payload: RestartPayload, env: NodeJS.ProcessEnv = process.env): void {
	const serialized = JSON.stringify(payload);
	try {
		const child = spawn("nohup", ["python3", "-c", PYTHON_RESTART_SCRIPT, serialized], {
			detached: true,
			stdio: "ignore",
			env,
		});
		child.on("error", () => {
			try {
				const fallback = spawn("python3", ["-c", PYTHON_RESTART_SCRIPT, serialized], {
					detached: true,
					stdio: "ignore",
					env,
				});
				fallback.unref();
			} catch {
				// Ignore fallback spawn errors
			}
		});
		child.unref();
	} catch {
		const fallback = spawn("python3", ["-c", PYTHON_RESTART_SCRIPT, serialized], {
			detached: true,
			stdio: "ignore",
			env,
		});
		fallback.unref();
	}
}

/** Provide directory completions for `/cd <prefix>`. */
export function getDirectoryCompletions(
	prefix: string,
	currentCwd: string,
	env: NodeJS.ProcessEnv = process.env,
): AutocompleteItem[] | null {
	const home = env.HOME || os.homedir();
	const raw = prefix.trimStart();

	let searchBaseDir = currentCwd;
	let displayPrefix = "";
	let partialName = raw;

	if (raw === "~") {
		return [{ value: "~/", label: "~/", description: home }];
	}

	let expanded = raw;
	if (raw.startsWith("~/")) {
		expanded = path.join(home, raw.slice(2));
	} else if (raw.startsWith("$HOME/")) {
		expanded = path.join(home, raw.slice(6));
	}

	const endsWithSep = raw.endsWith("/");
	if (endsWithSep) {
		searchBaseDir = path.resolve(currentCwd, expanded);
		displayPrefix = raw;
		partialName = "";
	} else if (raw.includes("/")) {
		const lastSlash = raw.lastIndexOf("/");
		displayPrefix = raw.slice(0, lastSlash + 1);
		partialName = raw.slice(lastSlash + 1);
		const parentExpanded = expanded.slice(0, expanded.lastIndexOf("/") + 1) || "/";
		searchBaseDir = path.resolve(currentCwd, parentExpanded);
	}

	let dirents: fs.Dirent[];
	try {
		dirents = fs.readdirSync(searchBaseDir, { withFileTypes: true });
	} catch {
		return null;
	}

	const showHidden = partialName.startsWith(".");
	const lowerPartial = partialName.toLowerCase();
	const items: AutocompleteItem[] = [];

	for (const dirent of dirents) {
		if (!showHidden && dirent.name.startsWith(".")) continue;
		let isDir = dirent.isDirectory();
		if (!isDir && dirent.isSymbolicLink()) {
			try {
				isDir = fs.statSync(path.join(searchBaseDir, dirent.name)).isDirectory();
			} catch {
				isDir = false;
			}
		}
		if (!isDir) continue;
		if (partialName && !dirent.name.toLowerCase().startsWith(lowerPartial)) continue;

		const value = `${displayPrefix}${dirent.name}/`;
		const fullPath = path.join(searchBaseDir, dirent.name);
		items.push({
			value: value.includes(" ") ? `"${value}"` : value,
			label: `${dirent.name}/`,
			description: fullPath,
		});
	}

	items.sort((a, b) => a.label.localeCompare(b.label));
	return items.length > 0 ? items.slice(0, 30) : null;
}

export default function cdExtension(pi: ExtensionAPI, deps: CdExtensionDeps = {}) {
	const env = deps.env ?? process.env;
	const spawnDetached = deps.spawnDetached ?? defaultSpawnDetached;
	const shutdown = deps.shutdown ?? ((ctx: ExtensionCommandContext) => ctx.shutdown());
	let latestCwd = process.cwd();

	pi.on("session_start", (_event, ctx) => {
		if (ctx?.cwd) {
			latestCwd = ctx.cwd;
		}
	});

	pi.registerCommand("cd", {
		description: "Change the working directory of the current Pi session inside Herdr",
		getArgumentCompletions: (prefix: string) => getDirectoryCompletions(prefix, latestCwd, env),
		handler: async (args, ctx) => {
			const target = resolveHerdrTarget(env);
			if (!target || ctx.mode !== "tui") {
				ctx.ui?.notify("The /cd command is only supported inside Herdr", "error");
				return;
			}

			const resolved = resolveTargetDirectory(args, ctx.cwd, env);
			if (!resolved.ok) {
				ctx.ui?.notify(resolved.error, "error");
				return;
			}

			const targetCwd = resolved.path;
			let currentRealCwd = path.resolve(ctx.cwd);
			try {
				currentRealCwd = fs.realpathSync(ctx.cwd);
			} catch {
				// Keep resolved path
			}

			if (targetCwd === currentRealCwd || targetCwd === path.resolve(ctx.cwd)) {
				ctx.ui?.notify(`Already in ${targetCwd}`, "info");
				return;
			}

			if (!ctx.isIdle?.()) {
				await ctx.waitForIdle?.();
			}

			const sessionId = ctx.sessionManager.getSessionId();
			const currentSessionFile = ctx.sessionManager.getSessionFile();
			const header = ctx.sessionManager.getHeader?.() as Record<string, unknown> | null | undefined;
			const entries = ctx.sessionManager.getEntries?.() ?? [];

			let migrated: MigrateSessionResult;
			try {
				migrated = migrateSessionFile(
					{
						currentSessionFile,
						sessionId,
						targetCwd,
						header,
						entries,
					},
					env,
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui?.notify(`Failed to move session file: ${msg}`, "error");
				return;
			}

			ctx.ui?.notify(`Changing session directory to ${targetCwd}…`, "info");

			spawnDetached(
				{
					backend: target.backend,
					paneId: target.paneId,
					targetCwd,
					targetSessionFile: migrated.targetSessionFile,
					sessionId,
					piPid: deps.piPid ?? process.pid,
					piPpid: deps.piPpid ?? process.ppid,
				},
				env,
			);

			shutdown(ctx);
		},
	});
}
