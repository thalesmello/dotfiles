// Prefix-mode (`ctrl-space`) dispatcher and terminal popup host for herdr-app.
// Brings full feature parity with ~/.config/herdr/config.toml's [keys] and [[keys.command]].

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  agents,
  spaces,
  panes,
  terminals,
  focused,
  layout,
  run,
  exec,
  hc,
  theme,
  props,
  openOverlay,
  closeOverlay,
  notify,
  shared,
  setShared,
  home,
  appHome,
  checking,
  readTextFile,
  writeTextFile,
  watchFolder,
} from "herdr";

const PERL_SEND_SCRIPT = `use Socket;
my ($t, $hex, $mode, $cols_in, $rows_in) = @ARGV;
my $data = pack("H*", $hex);
my $sock = $ENV{HC_SOCKET} || $ENV{HC_TERMINAL_SOCKET} || "$ENV{HOME}/.local/state/herdr-core/default/default.sock";
socket(S, PF_UNIX, SOCK_STREAM, 0) && connect(S, sockaddr_un($sock)) or exit 1;
my $cols = $cols_in || 120;
my $rows = $rows_in || 40;
if ($mode eq "smart" || $mode eq "vim") {
  syswrite(S, "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"terminal.get\\",\\"params\\":{\\"terminal\\":\\"$t\\"}}\\n");
  my $g = ""; while ($g !~ /\\n/) { sysread(S, $g, 4096, length($g)) or exit 1; }
  my ($fg_block) = $g =~ /"foreground":(\\{[^}]*\\})/;
  my ($fg) = $fg_block ? ($fg_block =~ /"name":"([^"]+)"/) : ();
  my ($fpid) = $fg_block ? ($fg_block =~ /"pid":(\\d+)/) : ();
  my ($spid) = $g =~ /"parent":(?:null|"[^"]*"),"pid":(\\d+)/;
  my ($ti) = $g =~ /"title":"([^"]*)"/;
  my ($c) = $g =~ /"cols":(\\d+)/; $cols = $c if $c;
  my ($r) = $g =~ /"rows":(\\d+)/; $rows = $r if $r;
  my $base = $fg ? $fg : ""; $base =~ s!.*/!!; $base =~ s/^-+//; $base =~ s/\\.real$//;
  my $is_shell = ($base =~ /^(?:sh|bash|zsh|fish|dash|ksh|mksh|tcsh|csh|nu|nushell|pwsh|powershell|login)$/i);
  my $is_vim = ($base =~ /^(?:n?vim|vi)$/i) || (!$is_shell && $ti && $ti =~ /^(?:n?vim):/i);
  if (!$is_vim) {
    exit 2 if $mode eq "vim";
    if ($is_shell) {
      exit 3;
    }
    print "$base\\n";
    exit 2;
  }
}
syswrite(S, "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":2,\\"method\\":\\"hello\\",\\"params\\":{\\"framed\\":true}}\\n");
my $buf = ""; while ($buf !~ /\\n/) { sysread(S, $buf, 4096, length($buf)) or exit 1; }
my $req = "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":3,\\"method\\":\\"terminal.attach\\",\\"params\\":{\\"terminal\\":\\"$t\\",\\"cols\\":$cols,\\"rows\\":$rows}}";
syswrite(S, pack("VCV", 0, 0, length($req)) . $req);
while (1) {
  my $hdr = ""; while (length($hdr) < 9) { sysread(S, $hdr, 9 - length($hdr), length($hdr)) or exit 1; }
  my ($ch, $kind, $len) = unpack("VCV", $hdr);
  my $body = ""; while (length($body) < $len) { sysread(S, $body, $len - length($body), length($body)) or exit 1; }
  if ($ch == 0 && $kind == 0 && $body =~ /"id":3\\b.*"channel":(\\d+)/) {
    syswrite(S, pack("VCV", $1, 0, length($data)) . $data . pack("VCV", $1, 2, 0));
    last;
  }
}`;

function sendRawHex(termAddr, hexBytes, termObj = null, mode = "raw") {
  if (!termAddr) return Promise.resolve({ code: 1, stdout: "", stderr: "" });
  const t = termObj ?? (terminals() ?? []).find((x) => x.address === termAddr) ?? null;
  const cols = String(t?.cols || 120);
  const rows = String(t?.rows || 40);
  return exec("/usr/bin/perl", ["-e", PERL_SEND_SCRIPT, termAddr, hexBytes, mode, cols, rows]).catch(() => ({
    code: 1,
    stdout: "",
    stderr: "",
  }));
}

function isVimPane(p, termObj = null) {
  const progKey = (p?.program?.key ?? "").toLowerCase();
  const progName = (p?.program?.name ?? "").toLowerCase();
  const fgName = (termObj?.foreground?.name ?? "").toLowerCase();
  const title = (p?.title ?? termObj?.title ?? "").toLowerCase();
  return (
    progKey === "nvim" ||
    progKey === "vim" ||
    progName === "neovim" ||
    progName === "nvim" ||
    progName === "vim" ||
    fgName === "nvim" ||
    fgName === "vim" ||
    title.startsWith("nvim:") ||
    title.startsWith("vim:")
  );
}

const CTRL_HEX = { h: "08", j: "0a", k: "0b", l: "0c" };
const pendingClosePopups = new Set();

function openConfirmClosePopup(overlayId, p, procName) {
  // Freeze both IDs. A delayed popup must never adopt the new focused pane.
  const paneId = p?.pane || "";
  const target = (panes() ?? []).find((x) => x.pane === paneId && x.terminal === p?.terminal);
  if (!paneId || !target?.terminal) {
    if (overlayId) closeOverlay(overlayId);
    return;
  }
  if (pendingClosePopups.has(paneId)) return;
  pendingClosePopups.add(paneId);
  const proc = procName || p?.app || p?.program?.key || p?.program?.name || "process";
  const rawTitle = (p?.title ?? "").replace(/^[^\x00-\x7f]+\s*/, "").trim();
  const title = rawTitle && rawTitle.toLowerCase() !== proc.toLowerCase() ? rawTitle : "";
  const env = [
    `HC_PRESET_BACKEND="hc"`,
    `HERDR_APP_HOME=${JSON.stringify(appHome())}`,
    `ASCONFIRMCLOSE_PANE_ID=${JSON.stringify(paneId)}`,
    `ASCONFIRMCLOSE_TERMINAL_ID=${JSON.stringify(target.terminal)}`,
    `ASCONFIRMCLOSE_PROCESS=${JSON.stringify(proc)}`,
    ...(title ? [`ASCONFIRMCLOSE_TITLE=${JSON.stringify(title)}`] : []),
  ].join(" ");
  const cmd = `export PATH="$HOME/src/dotfiles/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" ${env}; python3 ~/.config/herdr/scripts/confirm-close.py prompt --local-app`;
  hc(["run", "--bg", "--rm", "--no-notify", "--json", "--cwd", home(), "--", "sh", "-c", cmd])
    .then((r) => {
      if (overlayId) closeOverlay(overlayId);
      if (r.code !== 0) return;
      const data = JSON.parse(r.stdout || "{}");
      if (!data.address) return;
      const f = focused() ?? {};
      if (!(panes() ?? []).some((x) => x.pane === paneId && x.terminal === target.terminal)
          || (f.pane && f.pane !== paneId) || (!f.pane && f.terminal && f.terminal !== target.terminal)) {
        hc(["kill", data.address]).catch(() => {});
        return;
      }
      openOverlay({
        kind: "dialog",
        width: 580,
        height: 220,
        layout: {
          type: "column",
          children: [{ type: "block", content: { terminal: data.address } }],
        },
      });
    })
    .catch(() => {
      if (overlayId) closeOverlay(overlayId);
    })
    .finally(() => pendingClosePopups.delete(paneId));
}

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function smartTabNav(dir) {
  const allSpaces = spaces() ?? [];
  const ring = [];
  for (const sp of allSpaces) {
    for (const tb of sp.tabs ?? []) {
      ring.push({ spaceId: sp.id, tabId: tb.id, active: Boolean(sp.active && tb.active) });
    }
  }
  if (ring.length === 0) return;
  const idx = ring.findIndex((x) => x.active);
  if (idx < 0) return;
  const step = dir === "prev" ? -1 : 1;
  const target = ring[(idx + step + ring.length) % ring.length];
  if (target.spaceId !== ring[idx].spaceId) {
    run("space.select", { id: target.spaceId });
  }
  run("tab.select", { id: target.tabId });
}

function stripMachinePrefix(id, machine) {
  if (!id) return "";
  if (machine && id.startsWith(`${machine}/`)) return id.slice(machine.length + 1);
  return id;
}

function qualifyPaneId(id, machine) {
  if (!id) return "";
  if (!machine || id.includes("/")) return id;
  return `${machine}/${id}`;
}

function activeContext() {
  const f = focused() ?? {};
  const sp = (spaces() ?? []).find((s) => s.active) ?? null;
  const tb = sp?.tabs?.find((t) => t.active) ?? null;
  const tabId = tb?.id ?? f.tab ?? "";
  const allPanes = panes() ?? [];
  const spMachine = sp?.machine ?? null;
  const tabPanes = tabId
    ? allPanes.filter((x) => {
        if (x.tab !== tabId) return false;
        const xMach = x.machine ?? (typeof x.terminal === "string" && x.terminal.includes("/") ? x.terminal.split("/")[0] : null);
        if (sp !== null && xMach !== spMachine) return false;
        return true;
      })
    : allPanes;
  // Keyboard focus is authoritative. History/the first pane are not safe
  // substitutes, especially while a confirmation or terminal block has focus.
  const p = f.pane
    ? (f.terminal ? allPanes.find((x) => (x.pane === f.pane || qualifyPaneId(x.pane, spMachine) === f.pane) && x.terminal === f.terminal) ?? null : null) ??
      tabPanes.find((x) => x.pane === f.pane || qualifyPaneId(x.pane, spMachine) === f.pane) ??
      allPanes.find((x) => x.pane === f.pane) ??
      null
    : (!f.terminal ? tabPanes.find((x) => x.focused) ?? null : null);
  const terminal = f.shown ?? p?.terminal ?? f.terminal ?? "";
  const baseTerm = p?.terminal ?? f.terminal ?? "";
  const termMachine = baseTerm.includes("/") ? baseTerm.split("/")[0] : "";
  const machine = sp?.machine ?? p?.machine ?? f.machine ?? termMachine ?? null;
  const rawPane = p?.pane ?? "";
  return {
    pane: rawPane,
    qualifiedPane: qualifyPaneId(rawPane, machine),
    rawPane,
    terminal,
    cwd: p?.cwd ?? f.cwd ?? sp?.folder ?? (machine ? "" : home()),
    space: sp?.id ?? f.space ?? "",
    spaceName: sp?.name ?? "",
    machine,
    tab: tabId,
    tabName: tb?.name ?? "",
  };
}

function buildEnv(ctx, extra = {}, opts = {}) {
  const remote = Boolean(opts.remote && ctx.machine);
  const termId = remote ? stripMachinePrefix(ctx.terminal, ctx.machine) : (ctx.terminal || "");
  const paneId = remote ? stripMachinePrefix(ctx.pane, ctx.machine) : (ctx.pane || "");
  const tabId = remote ? stripMachinePrefix(ctx.tab, ctx.machine) : (ctx.tab || "");
  const spaceId = remote ? stripMachinePrefix(ctx.space, ctx.machine) : (ctx.space || "");
  const env = {
    HC_PRESET_BACKEND: "hc",
    ...(!remote ? { HERDR_APP_HOME: appHome() } : {}),
    HERDR_ACTIVE_PANE_ID: paneId || termId || "",
    HERDR_ACTIVE_TERMINAL_ID: termId,
    HERDR_ACTIVE_TAB_ID: tabId,
    HERDR_ACTIVE_WORKSPACE_ID: spaceId,
    HERDR_ACTIVE_MACHINE: ctx.machine || "",
    HC_TERMINAL_ID: termId,
    ...extra,
  };
  return Object.entries(env)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${JSON.stringify(String(v))}`)
    .join(" ");
}

function runDetachedScript(overlayId, scriptCmd, ctx, extraEnv = {}, opts = {}) {
  const onMachine = opts.remote ? (ctx.machine || "") : "";
  const envExports = buildEnv(ctx, extraEnv, { remote: Boolean(onMachine) });
  const inner = `export PATH="$HOME/src/dotfiles/bin:$HOME/.local/bin:/opt/homebrew/bin:/opt/chef/embedded/bin:/usr/local/bin:$PATH" ${envExports}; ${scriptCmd}`;
  const execOpts = onMachine
    ? { cwd: ctx.cwd || undefined, on: onMachine }
    : { cwd: (!ctx.machine && ctx.cwd) ? ctx.cwd : home() };
  exec("sh", ["-c", `nohup sh -c ${JSON.stringify(inner)} >/dev/null 2>&1 </dev/null &`], execOpts)
    .catch((err) => {
      console.log(`prefix script failed (${scriptCmd}): ${err}`);
    })
    .finally(() => {
      if (overlayId) closeOverlay(overlayId);
    });
}

function openTerminalPopup(overlayId, scriptCmd, ctx, opts = {}) {
  const width = opts.width ?? 680;
  const height = opts.height ?? 360;
  const onMachine = opts.local ? "" : (ctx.machine || "");
  const envExports = buildEnv(ctx, opts.env ?? {}, { remote: Boolean(onMachine) });
  const full = `export PATH="$HOME/src/dotfiles/bin:$HOME/.local/bin:/opt/homebrew/bin:/opt/chef/embedded/bin:/usr/local/bin:$PATH" ${envExports}; ${scriptCmd}`;
  const args = ["run", "--bg", "--rm", "--no-notify", "--json"];
  if (onMachine) {
    args.push("--on", onMachine);
    if (ctx.cwd) args.push("--cwd", ctx.cwd);
  } else {
    args.push("--cwd", (!ctx.machine && ctx.cwd) ? ctx.cwd : home());
  }
  args.push("--", "sh", "-c", full);
  hc(args)
    .then((r) => {
      if (overlayId) closeOverlay(overlayId);
      if (r.code !== 0) {
        notify({ title: "Popup failed", body: (r.stderr || r.stdout || `exit ${r.code}`).trim(), timeout: 3000 });
        return;
      }
      const data = JSON.parse(r.stdout || "{}");
      if (!data.address) return;
      openOverlay({
        kind: "dialog",
        width,
        height,
        layout: {
          type: "column",
          children: [
            {
              type: "block",
              content: { terminal: data.address },
            },
          ],
        },
      });
    })
    .catch((err) => {
      if (overlayId) closeOverlay(overlayId);
      console.log(`openTerminalPopup failed: ${err}`);
    });
}

const SHIFTED_DIGITS = {
  "!": 1,
  "@": 2,
  "#": 3,
  "$": 4,
  "%": 5,
  "^": 6,
  "&": 7,
  "*": 8,
  "(": 9,
};

export default class Prefix extends View {
  init(_props, cx) {
    this.mode = "prefix"; // "prefix" | "resize"
    this.resizeQueue = [];
    this.resizing = false;
    this.resizeReady = null;
    this.resizeStartup = null;
    this.resizeFinish = null;
    this.closed = false;
    this.ctx = activeContext();
    this.handle = cx.focus_handle();
    if (checking()) return;
    this.handle.focus();
    cx.timer.after(30, () => this.handle.focus());

    // Check if opened via `hc-preset popup-open` (which writes data/popup-request.json)
    cx.spawn(async () => {
      try {
        const reqPath = `${appHome()}/data/popup-request.json`;
        const raw = await readTextFile(reqPath);
        if (raw && raw.trim()) {
          const req = JSON.parse(raw);
          await writeTextFile(reqPath, "", raw);
          if (Date.now() - (req.ts ?? 0) < 5000) {
            if (req?.mod) {
              closeOverlay(props().overlay);
              openOverlay({
                mod: req.mod,
                kind: req.kind ?? "dialog",
                width: req.width ?? 420,
                ...(req.height ? { height: req.height } : {}),
                props: req.props ?? {},
              });
              return;
            }
            if (req?.terminal) {
              closeOverlay(props().overlay);
              openOverlay({
                kind: "dialog",
                width: req.width ?? 680,
                height: req.height ?? 360,
                layout: {
                  type: "column",
                  children: [
                    {
                      type: "block",
                      content: { terminal: req.terminal },
                    },
                  ],
                },
              });
            }
          }
        }
      } catch {}
    });
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  resizeSidebar(deltaPx) {
    const sb = findNode(layout(), "sidebar");
    const cur = sb?.size?.px ?? 268;
    const next = Math.max(140, Math.min(480, cur + deltaPx));
    run("layout.resize", { id: "sidebar", px: next });
  }

  startResizeWorker(cx) {
    if (this.resizeReady || checking() || !this.ctx.pane || !this.ctx.tab) return;
    const dir = `${appHome()}/data`;
    const descriptor = `${dir}/prefix-resize-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    const startup = { cancelled: false, worker: null, watch: null, timer: null, reject: null };
    this.resizeStartup = startup;
    this.resizeReady = new Promise((resolve, reject) => {
      startup.reject = reject;
      // Bound the entire launch/read/watch sequence, not only the file watch.
      startup.timer = cx.timer.after(10000, (cx) => {
        startup.cancelled = true;
        startup.watch?.cancel();
        reject(new Error("Resize worker startup timed out"));
        cx.spawn(() => this.stopResizeWorker(startup));
      });
      cx.spawn(async () => {
        try {
          // Arm before launching: readiness cannot fall between a read and its watch.
          startup.watch = watchFolder(dir);
          const launch = await hc([
            "run", "--bg", "--rm", "--no-notify", "--no-parent", "--json",
            "--cwd", home(), "--", "python3", `${appHome()}/mods/prefix/resize.py`,
            "--serve", JSON.stringify(this.ctx), descriptor,
          ]);
          if (launch.code !== 0) throw new Error(launch.stderr || "Cannot start local resize worker");
          startup.worker = JSON.parse(launch.stdout).address;
          if (!startup.worker) throw new Error("Resize worker has no terminal address");
          // A late launch is still owned by this attempt and explicitly cleaned up.
          while (!this.closed && !startup.cancelled) {
            const raw = await readTextFile(descriptor);
            if (raw && !startup.cancelled && !this.closed) {
              const endpoint = JSON.parse(raw);
              resolve(`http://127.0.0.1:${endpoint.port}/${endpoint.token}`);
              return;
            }
            if (startup.cancelled || this.closed) break;
            await startup.watch;
            startup.watch = watchFolder(dir);
          }
          throw new Error("Resize mode closed or startup cancelled");
        } catch (error) {
          await this.stopResizeWorker(startup);
          reject(error);
        } finally {
          startup.timer.cancel();
          startup.watch?.cancel();
          startup.watch = null;
        }
      });
    });
    // Starting early is optional; display an error only if a resize key needs it.
    this.resizeReady.catch(() => {});
  }

  queueResize(direction, cx) {
    if (checking() || this.resizeFinish || !this.ctx.pane || !this.ctx.tab) return;
    this.startResizeWorker(cx);
    this.resizeQueue.push(direction);
    if (this.resizing) return;
    this.resizing = true;
    cx.spawn(async (cx) => {
      try {
        const endpoint = await this.resizeReady;
        while (this.resizeQueue.length) {
          const directions = this.resizeQueue.splice(0, 256);
          const response = await Promise.race([
            fetch(`${endpoint}/resize`, { method: "POST", body: JSON.stringify({ directions }) }),
            cx.sleep(6000).then(() => { throw new Error("Resize request timed out (not replayed)"); }),
          ]);
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.error || "Resize failed");
        }
      } catch (error) {
        this.resizeQueue.length = 0;
        const failed = this.resizeStartup;
        if (failed) {
          failed.cancelled = true;
          failed.timer.cancel();
          failed.watch?.cancel();
          cx.spawn(() => this.stopResizeWorker(failed));
        }
        // A later key gets a new worker after idle expiry/failure. Never replay this batch.
        this.resizeReady = null;
        this.resizeStartup = null;
        notify({ title: "Resize failed", body: String(error), timeout: 3000 });
      } finally {
        this.resizing = false;
        if (this.resizeFinish) this.finishResize(this.resizeFinish);
      }
    });
  }

  finishResize(action) {
    if (action !== "equalize") {
      this.dismiss();
    } else if (this.resizing) {
      this.resizeFinish = action;
    } else {
      runDetachedScript(props().overlay, "~/.config/herdr/scripts/even-layout.sh", this.ctx);
    }
  }

  async stopResizeWorker(startup) {
    if (startup?.worker) {
      await exec("hc", ["kill", startup.worker]).catch(() => {});
      await exec("hc", ["rm", startup.worker]).catch(() => {});
    }
  }

  async close() {
    this.closed = true;
    this.resizeQueue.length = 0;
    const startup = this.resizeStartup;
    if (startup) {
      startup.cancelled = true;
      startup.timer.cancel();
      startup.watch?.cancel();
      startup.reject(new Error("Resize mode closed"));
      await this.stopResizeWorker(startup);
    }
  }

  handleResizeModeKey(e, cx) {
    const k = (e.key || "").toLowerCase();
    if (k === "escape" || k === "enter" || k === "q") {
      this.finishResize("dismiss");
      cx.stop_propagation();
      return;
    }
    const dirMap = { h: "left", left: "left", j: "down", down: "down", k: "up", up: "up", l: "right", right: "right" };
    const dir = dirMap[k];
    if (dir) {
      this.queueResize(dir, cx);
      cx.stop_propagation();
      return;
    }
    if (k === "=") {
      this.finishResize("equalize");
      cx.stop_propagation();
    }
  }

  onKey(e, cx) {
    if (this.mode === "resize") {
      this.handleResizeModeKey(e, cx);
      return;
    }

    const ks = (e.keystroke || "").toLowerCase();
    const key = (e.key || "").toLowerCase();
    const ch = e.key_char || "";
    const mod = e.modifiers || {};
    const shift = Boolean(mod.shift);
    const ctrl = Boolean(mod.control);
    const alt = Boolean(mod.alt);
    const ctx = this.ctx;
    const overlayId = props().overlay;

    // Ignore bare modifier presses
    if (["shift", "control", "alt", "platform", "cmd", "super", " capslock"].includes(key)) {
      return;
    }

    cx.stop_propagation();

    // Escape cancels prefix mode
    if (key === "escape" || ks === "ctrl-[") {
      if (ks === "ctrl-[") {
        this.dismiss();
        run("tab.prev");
        return;
      }
      this.dismiss();
      return;
    }

    // Enter resize mode (stays open until Esc)
    if (ks === "r" && !ctrl && !alt && !shift) {
      this.mode = "resize";
      this.startResizeWorker(cx);
      cx.notify();
      return;
    }

    // 1. Ctrl+Space again -> send literal Ctrl+Space to terminal
    if (ks === "ctrl-space" || (ctrl && key === "space")) {
      if (ctx.terminal) {
        sendRawHex(ctx.terminal, "00").finally(() => this.dismiss());
      } else {
        this.dismiss();
      }
      return;
    }

    // 2. Indexed bindings: 1..9 (tab), shift+1..9 (agent), alt+1..9 (space)
    const shiftedDigit = SHIFTED_DIGITS[ch] ?? (shift && /^[1-9]$/.test(key) ? Number(key) : null);
    if (shiftedDigit && !ctrl && !alt) {
      this.dismiss();
      const order = (shared("layout") === "transition" ? shared("agents.visibleOrder") : null) ?? (agents() ?? []).map(a => a.address);
      const target = order[shiftedDigit - 1];
      if (target) run("agent.focus", { terminal: target });
      return;
    }
    if (/^[1-9]$/.test(key) && alt && !ctrl && !shift) {
      this.dismiss();
      run("space.select", { index: Number(key) });
      return;
    }
    if (/^[1-9]$/.test(key) && !ctrl && !alt && !shift) {
      this.dismiss();
      run("tab.select", { index: Number(key) });
      return;
    }

    // 3. Splits & Layout
    if (ks === "v" && !ctrl && !alt && !shift) {
      this.dismiss();
      run("pane.split", { direction: "right", pane: ctx.pane || undefined });
      return;
    }
    if ((key === "-" && !shift && !ctrl && !alt) || ch === '"' || ks === "shift-'" || ks === '"') {
      this.dismiss();
      run("pane.split", { direction: "down", pane: ctx.pane || undefined });
      return;
    }
    if ((ks === "z" && !ctrl && !alt && !shift) || ks === "ctrl-enter" || (ctrl && key === "enter")) {
      this.dismiss();
      run("pane.zoom", { pane: ctx.pane || undefined });
      return;
    }
    if (ks === "=" && !shift && !ctrl && !alt) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/even-layout.sh", ctx);
      return;
    }
    if (ch === "+" || ks === "shift-=" || ks === "+") {
      this.dismiss();
      this.resizeSidebar(16);
      return;
    }
    if (ch === "_" || ks === "shift--" || ks === "_") {
      this.dismiss();
      this.resizeSidebar(-16);
      return;
    }
    if (ks === "b" && !ctrl && !alt && !shift) {
      this.dismiss();
      run("layout.toggle", { id: "sidebar" });
      return;
    }

    // 4. Pane Navigation
    const navDirs = { h: "left", j: "down", k: "up", l: "right", left: "left", down: "down", up: "up", right: "right" };
    if (navDirs[key] && !ctrl && !alt && !shift) {
      this.dismiss();
      run("pane.go", { direction: navDirs[key] });
      return;
    }
    if (navDirs[key] && ctrl && !alt && !shift) {
      const sp = (spaces() ?? []).find((s) => s.active) ?? null;
      const tb = sp?.tabs?.find((t) => t.active) ?? null;
      const allPanes = panes() ?? [];
      const tabPanes = ctx.tab ? allPanes.filter((x) => x.tab === ctx.tab) : allPanes;
      const p = allPanes.find((x) => x.pane === ctx.pane) ?? tabPanes[0] ?? null;
      const termObj = ctx.terminal ? ((terminals() ?? []).find((x) => x.address === ctx.terminal) ?? null) : null;
      const noRoom = Boolean(tb?.zoomed || p?.zoomed || tabPanes.length <= 1);
      if (!noRoom || !ctx.terminal || !CTRL_HEX[key] || p?.status) {
        this.dismiss();
        run("pane.go", { direction: navDirs[key] });
        return;
      }
      sendRawHex(ctx.terminal, `00${CTRL_HEX[key]}`, termObj, "vim").then((r) => {
        this.dismiss();
        if (r.code !== 0) run("pane.go", { direction: navDirs[key] });
      });
      return;
    }

    // 5. Tab & Workspace Navigation / Creation / Rename / Close
    if (ks === "t" || ks === "ctrl-t") {
      this.dismiss();
      openOverlay({
        mod: "prompt",
        kind: "dialog",
        width: 420,
        props: {
          title: "New Tab",
          command: {
            name: "tab.new",
            args: {
              ...(ctx.space ? { space: ctx.space } : {}),
              ...(ctx.cwd ? { folder: ctx.cwd } : {}),
            },
          },
        },
      });
      return;
    }
    if (ks === "shift-t" || (key === "t" && shift && !ctrl && !alt)) {
      this.dismiss();
      if (ctx.tab) {
        openOverlay({
          mod: "prompt",
          kind: "dialog",
          width: 420,
          props: { title: "Rename Tab", value: ctx.tabName, command: { name: "tab.rename", args: { id: ctx.tab } } },
        });
      }
      return;
    }
    if (ks === "shift-n" || (key === "n" && shift && !ctrl && !alt)) {
      this.dismiss();
      run("space.new", {
        ...(ctx.cwd ? { folder: ctx.cwd } : {}),
        ...(ctx.machine ? { machine: ctx.machine } : {}),
      });
      return;
    }
    if (ks === "shift-w" || (key === "w" && shift && !ctrl && !alt)) {
      this.dismiss();
      if (ctx.space) {
        openOverlay({
          mod: "prompt",
          kind: "dialog",
          width: 420,
          props: { title: "Rename Space", value: ctx.spaceName, command: { name: "space.rename", args: { id: ctx.space } } },
        });
      }
      return;
    }
    if (ks === "g" && !ctrl && !alt && !shift) {
      this.dismiss();
      run("mod.open", { name: "picker" });
      return;
    }
    if (ks === "shift-g" || (key === "g" && shift && !ctrl && !alt)) {
      this.dismiss();
      openOverlay({
        mod: "worktree",
        kind: "dialog",
        width: 520,
        props: { space: ctx.space, folder: ctx.cwd, action: "new" },
      });
      return;
    }
    if (key === "]" && !ctrl && !alt && !shift) {
      this.dismiss();
      smartTabNav("next");
      return;
    }
    if (key === "[" && !ctrl && !alt && !shift) {
      this.dismiss();
      smartTabNav("prev");
      return;
    }
    if (ks === "ctrl-]" || (ctrl && key === "]")) {
      this.dismiss();
      run("tab.next");
      return;
    }
    if (ks === "ctrl-n" || (ctrl && key === "n")) {
      this.dismiss();
      run("space.next");
      return;
    }
    if (ks === "ctrl-p" || (ctrl && key === "p")) {
      this.dismiss();
      run("space.prev");
      return;
    }
    if (ks === "ctrl-," || (ctrl && key === ",")) {
      this.dismiss();
      run(shared("layout") === "transition" ? "agents-snooze.prev" : "agent.prev");
      return;
    }
    if (ks === "ctrl-." || (ctrl && key === ".")) {
      this.dismiss();
      run(shared("layout") === "transition" ? "agents-snooze.next" : "agent.next");
      return;
    }

    // 6. Close bindings (smart-close, confirm-close, close tab, close workspace)
    const closesPane = (key === "backspace" && !alt && !shift) || (ks === "x" && !ctrl && !alt && !shift);
    if (closesPane && !ctx.pane) {
      // Repeated prefix close inside the confirmation goes to that popup,
      // never to an inferred source pane underneath it.
      if (ctx.terminal) sendRawHex(ctx.terminal, ks === "x" ? "0078" : ctrl ? "0008" : "007f");
      this.dismiss();
      return;
    }
    if (closesPane && !(panes() ?? []).some((p) => p.pane === ctx.pane && p.terminal === ctx.terminal)) {
      this.dismiss();
      notify({ title: "Pane changed; close cancelled", level: "warning", timeout: 3000 });
      return;
    }
    if (key === "backspace" && !ctrl && !alt && !shift) {
      const allPanes = panes() ?? [];
      const p = allPanes.find((x) => x.pane === ctx.pane) ?? null;
      const termObj = ctx.terminal ? ((terminals() ?? []).find((x) => x.address === ctx.terminal) ?? null) : null;
      if (p?.status) {
        openConfirmClosePopup(overlayId, p, p.app || p.program?.key || p.program?.name || "agent");
        return;
      }
      if (ctx.terminal) {
        sendRawHex(ctx.terminal, "007f", termObj, "smart").then((r) => {
          if (r.code === 0) {
            this.dismiss();
            return;
          }
          if (r.code === 3 && p?.pane) {
            this.dismiss();
            if ((panes() ?? []).some((x) => x.pane === p.pane && x.terminal === ctx.terminal)) {
              hc(["kill", ctx.terminal]).then((result) => {
                if (result.code !== 0) notify({ title: "Could not close terminal", body: result.stderr || result.stdout, level: "error" });
              }).catch((err) => notify({ title: "Could not close terminal", body: String(err), level: "error" }));
            }
            return;
          }
          const procName = (r.stdout || "").trim() || p?.program?.name || "process";
          openConfirmClosePopup(overlayId, p ?? { pane: ctx.pane, terminal: ctx.terminal }, procName);
        });
        return;
      }
      runDetachedScript(overlayId, "~/.config/herdr/scripts/smart-close.sh", ctx);
      return;
    }
    if ((key === "backspace" && ctrl && !alt && !shift) || (ks === "x" && !ctrl && !alt && !shift)) {
      const allPanes = panes() ?? [];
      const p = allPanes.find((x) => x.pane === ctx.pane) ?? null;
      if (p?.status) {
        openConfirmClosePopup(overlayId, p, p.app || p.program?.key || p.program?.name || "agent");
        return;
      }
      runDetachedScript(overlayId, "~/.config/herdr/scripts/confirm-close.py close", ctx, { ASCONFIRMCLOSE_TERMINAL_ID: ctx.terminal });
      return;
    }
    if (key === "backspace" && shift && !ctrl && !alt) {
      this.dismiss();
      run("tab.close", { id: ctx.tab || undefined });
      return;
    }
    if (key === "backspace" && alt && !ctrl && !shift) {
      this.dismiss();
      run("space.close", { id: ctx.space || undefined });
      return;
    }

    // 7. Agent Launchers & Session Management (Pi split, Pi tab, Ask Agent, Resume Agent, Break Pane)
    if (ks === "c" && !ctrl && !alt && !shift) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/pi-split.sh", ctx);
      return;
    }
    if (ks === "shift-c" || (key === "c" && shift && !ctrl && !alt)) {
      openTerminalPopup(overlayId, "~/.config/herdr/scripts/pi-tab.sh", ctx, { width: 520, height: 180 });
      return;
    }
    if (ks === "ctrl-c" || (ctrl && key === "c" && !alt && !shift)) {
      if (ctx.terminal) {
        sendRawHex(ctx.terminal, "0c").finally(() => this.dismiss());
      } else {
        this.dismiss();
      }
      return;
    }
    if (ks === "ctrl-r" || (ctrl && key === "r" && !alt && !shift)) {
      runDetachedScript(overlayId, "~/src/dotfiles/bin/resume-agent", ctx, {}, { remote: true });
      return;
    }
    if (ks === "shift-r" || (key === "r" && shift && !ctrl && !alt)) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/reload-config.sh", ctx);
      return;
    }
    if (ks === "a" && !ctrl && !alt && !shift) {
      // The editor always runs on this desktop. Only agent creation is remote;
      // use the shared launcher rather than openTerminalPopup's --on default.
      runDetachedScript(overlayId, "hc-preset --backend hc popup-open prompt-popups ask-agent 65% 52.5%", ctx, {
        ASK_AGENT_SOURCE_PANE_ID: ctx.qualifiedPane || ctx.pane || ctx.terminal,
        ASK_AGENT_SOURCE_TERMINAL_ID: ctx.terminal,
      });
      return;
    }
    if (ks === "shift-a" || (key === "a" && shift && !ctrl && !alt)) {
      runDetachedScript(overlayId, "hc-preset --backend hc popup-open prompt-popups ask-agent 65% 52.5%", ctx, {
        ASK_AGENT_SOURCE_PANE_ID: ctx.qualifiedPane || ctx.pane || ctx.terminal,
        ASK_AGENT_SOURCE_TERMINAL_ID: ctx.terminal,
        ASK_AGENT_CONTEXT: "1",
        ASK_AGENT_CWD: ctx.cwd || "",
      });
      return;
    }
    if (ks === "shift-m" || (key === "m" && shift && !ctrl && !alt)) {
      openTerminalPopup(overlayId, "~/.config/herdr/scripts/break-pane.sh", ctx, { width: 620, height: 180 });
      return;
    }

    // 8. Attention Jump & Focus History Jumplist
    const isTabKey = key === "tab" || key === "backtab" || ks === "tab" || ks === "shift-tab";
    if (isTabKey && !shift && key !== "backtab" && ks !== "shift-tab" && !ctrl && !alt) {
      if (ctx.qualifiedPane || ctx.pane) setShared("focusHistory.activePane", ctx.qualifiedPane || ctx.pane);
      this.dismiss();
      run("tabs-shortcuts.attention_jump");
      return;
    }
    if (
      (isTabKey && (shift || key === "backtab" || ks === "shift-tab") && !ctrl && !alt) ||
      ks === "ctrl-o" ||
      (ctrl && key === "o" && !alt && !shift)
    ) {
      if (ctx.qualifiedPane || ctx.pane) setShared("focusHistory.activePane", ctx.qualifiedPane || ctx.pane);
      this.dismiss();
      run("tabs-shortcuts.focus_back");
      return;
    }
    if (ks === "ctrl-i" || (ctrl && key === "i" && !alt && !shift)) {
      if (ctx.qualifiedPane || ctx.pane) setShared("focusHistory.activePane", ctx.qualifiedPane || ctx.pane);
      this.dismiss();
      run("tabs-shortcuts.focus_forward");
      return;
    }

    // 9. Agent Pin, Unread, Panel Sort, Recap, Snooze, Settled, Settle Review
    if (ks === "p" && !ctrl && !alt && !shift) {
      if (ctx.terminal) {
        const curAgent = (agents() ?? []).find((a) => a.address === ctx.terminal);
        run("terminal.pin", { terminal: ctx.terminal, pinned: !curAgent?.pinned });
      }
      runDetachedScript(overlayId, "~/.config/herdr/scripts/agent-handler.py pin", ctx);
      return;
    }
    if (ks === "shift-p" || (key === "p" && shift && !ctrl && !alt)) {
      this.dismiss();
      run("app.palette");
      return;
    }
    if (ks === "u" && !ctrl && !alt && !shift) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/agent-handler.py toggle", ctx);
      return;
    }
    if (ks === "w" && !ctrl && !alt && !shift) {
      this.dismiss();
      // Legacy "hidden" is treated as priority; app sections fold instead.
      const curSort = shared("agents.sort") === "grouped" ? "grouped" : "priority";
      const order = ["grouped", "priority"];
      const labels = { grouped: "grouped", priority: "smart priority" };
      const nextSort = order[(order.indexOf(curSort) + 1) % order.length];
      setShared("agents.sort", nextSort);
      notify({ title: `Agents panel: ${labels[nextSort] ?? nextSort}`, timeout: 1500 });
      return;
    }
    if (ks === "i" && !ctrl && !alt && !shift) {
      openTerminalPopup(overlayId, "python3 ~/.config/herdr/scripts/herdr-recap.py picker", ctx, {
        width: 920,
        height: 620,
        local: true,
      });
      return;
    }
    if (ks === "shift-z" || (key === "z" && shift && !ctrl && !alt)) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/herdr-snooze.py action agent", ctx);
      return;
    }
    if (key === "z" && shift && alt && !ctrl) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/herdr-snooze.py action workspace", ctx);
      return;
    }
    if (ks === "alt-z" || (key === "z" && alt && !shift && !ctrl)) {
      openTerminalPopup(overlayId, "python3 ~/.config/herdr/scripts/herdr-snooze.py picker", ctx, {
        width: 820,
        height: 560,
        local: true,
        env: { HERDR_SNOOZE_SCREEN: "list", SNOOZE_SCREEN: "list" },
      });
      return;
    }
    if (ks === "ctrl-z" || (key === "z" && ctrl && !shift && !alt)) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/herdr-snooze.py toggle", ctx);
      return;
    }
    if ((key === "s" && alt && shift && !ctrl) || ks === "alt-shift-s" || ks === "shift-alt-s") {
      // The original picker runs only on the focused terminal's own machine.
      openTerminalPopup(overlayId, "python3 ~/.config/herdr/scripts/herdr-settled.py picker", ctx, {
        width: 920,
        height: 620,
      });
      return;
    }
    if (ks === "alt-s" || (key === "s" && alt && !shift && !ctrl)) {
      // Coordinate through this desktop's Core so all of its connected machines
      // are reachable, even when the underlying focused tab is remote.
      openTerminalPopup(overlayId, "python3 ~/.config/herdr/scripts/herdr-settled.py picker --all-machines", ctx, {
        width: 920,
        height: 620,
        local: true,
        // Keep the picker terminal's Core identity for viewport-size queries.
        env: { HC_TERMINAL_ID: "" },
      });
      return;
    }
    if (ks === "alt-d" || (key === "d" && alt && !shift && !ctrl)) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/settle-review.sh", ctx);
      return;
    }

    // 10. Output Picker, Copy IDs, Copy Last Output, Edit Config, Search, Help, Settings
    if (ks === "o" && !ctrl && !alt && !shift) {
      const target = ctx.pane || ctx.terminal;
      if (target) {
        openTerminalPopup(
          overlayId,
          `~/.config/herdr/scripts/pick-selection.sh open ${JSON.stringify(target)}`,
          ctx,
          { width: 0.85, height: 0.8, local: true },
        );
      } else {
        this.dismiss();
      }
      return;
    }
    if (ks === "shift-o" || (key === "o" && shift && !ctrl && !alt)) {
      this.dismiss();
      run(shared("layout") === "transition" ? "agents-snooze.next" : "agent.next");
      return;
    }
    if (ks === "y" && !ctrl && !alt && !shift) {
      const target = ctx.pane || ctx.terminal;
      if (target) {
        openTerminalPopup(
          overlayId,
          `~/.config/herdr/scripts/pick-selection.sh copy ${JSON.stringify(target)}`,
          ctx,
          { width: 0.85, height: 0.8, local: true },
        );
      } else {
        this.dismiss();
      }
      return;
    }
    if (ks === "shift-y" || (key === "y" && shift && !ctrl && !alt)) {
      const id = ctx.pane || ctx.terminal;
      if (id) {
        exec("sh", ["-c", `printf '%s' ${JSON.stringify(id)} | pbcopy`]).finally(() => {
          this.dismiss();
          notify({ title: "Copied pane id", body: id, timeout: 2000 });
        });
      } else {
        this.dismiss();
      }
      return;
    }
    if (ks === "ctrl-y" || (key === "y" && ctrl && !shift && !alt)) {
      if (ctx.tab) {
        exec("sh", ["-c", `printf '%s' ${JSON.stringify(ctx.tab)} | pbcopy`]).finally(() => {
          this.dismiss();
          notify({ title: "Copied tab id", body: ctx.tab, timeout: 2000 });
        });
      } else {
        this.dismiss();
      }
      return;
    }
    if (ks === "shift-b" || (key === "b" && shift && !ctrl && !alt)) {
      runDetachedScript(overlayId, "hc-preset popup-open prompt-popups copy-last-output 20 1", ctx);
      return;
    }
    if (ks === "shift-e" || (key === "e" && shift && !ctrl && !alt)) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/edit-config.sh", ctx);
      return;
    }
    if ((ks === "e" && !shift && !ctrl && !alt) || ks === "shift-v" || (key === "v" && shift && !ctrl && !alt)) {
      if (ctx.terminal) {
        runDetachedScript(
          overlayId,
          `tmp=$(mktemp -t herdr-scrollback.XXXXXX) && hc read ${ctx.terminal} --lines 2000 > "$tmp" && new_pane=$(hc-preset pane split "${ctx.pane || ctx.terminal}" --direction right --focus | sed -n 's/.*"pane_id":[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -1) && [ -n "$new_pane" ] && hc-preset pane run "$new_pane" "nvim \\"$tmp\\"; rm -f \\"$tmp\\"; exit"`,
          ctx,
        );
      } else {
        this.dismiss();
      }
      return;
    }
    if (ks === "alt-l" || (key === "l" && alt && !ctrl && !shift)) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/refresh-screen.sh", ctx);
      return;
    }
    if (key === "space" && !ctrl && !alt && !shift) {
      this.dismiss();
      run("terminal.search");
      return;
    }
    if (ch === "?" || ks === "shift-/" || ks === "?") {
      this.dismiss();
      run("app.help");
      return;
    }
    if (ks === "s" && !ctrl && !alt && !shift) {
      this.dismiss();
      run("app.settings");
      return;
    }
    this.dismiss();
  }

  render() {
    const t = theme();
    const isResize = this.mode === "resize";
    return v_flex()
      .id("prefix-root")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .w_full()
      .min_h(0)
      .px(16)
      .py(12)
      .gap(4)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(
                div()
                  .px(7)
                  .py(2)
                  .rounded(5)
                  .bg(t.accent)
                  .text_color(t.accent_foreground)
                  .text_size(11.5)
                  .font_semibold()
                  .child(isResize ? "RESIZE" : "PREFIX"),
              )
              .child(
                div()
                  .text_size(13)
                  .font_medium()
                  .child(isResize ? "h/j/k/l resize panes · = equalize · Esc done" : "Ctrl-Space active — press key"),
              ),
          )
          .child(div().text_size(11).text_color(t.dim).child("? help · Esc cancel")),
      )
      .child(
        div()
          .pt(4)
          .text_size(11)
          .text_color(t.muted)
          .truncate()
          .child("c pi-split · C pi-tab · a ask · g goto · v/- split · z zoom · o/y pick · Tab attention"),
      );
  }
}
