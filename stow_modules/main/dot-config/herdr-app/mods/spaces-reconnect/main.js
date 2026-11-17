// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, machines, panes, terminals, focused, run, openOverlay, notify, exec, hc, home, theme, shared, setShared, watchFolder, nextCommand, window, layout, checking } from "herdr";

const isChecking = () => typeof checking === "function" && Boolean(checking());

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
    if (!$base || $is_shell || ($fpid && $spid && $fpid == $spid)) {
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

function openConfirmClosePopup(p, procName) {
  const paneId = p?.pane || p?.terminal || "";
  if (!paneId) return;
  const proc = procName || p?.app || p?.program?.key || p?.program?.name || "process";
  const rawTitle = (p?.title ?? "").replace(/^[^\x00-\x7f]+\s*/, "").trim();
  const title = rawTitle && rawTitle.toLowerCase() !== proc.toLowerCase() ? rawTitle : "";
  const env = [
    `HC_PRESET_BACKEND="hc"`,
    `ASCONFIRMCLOSE_PANE_ID=${JSON.stringify(paneId)}`,
    `ASCONFIRMCLOSE_PROCESS=${JSON.stringify(proc)}`,
    ...(title ? [`ASCONFIRMCLOSE_TITLE=${JSON.stringify(title)}`] : []),
  ].join(" ");
  const cmd = `export PATH="$HOME/src/dotfiles/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" ${env}; python3 ~/.config/herdr/scripts/confirm-close.py prompt`;
  hc(["run", "--bg", "--rm", "--no-notify", "--json", "--cwd", home(), "--", "sh", "-c", cmd])
    .then((r) => {
      if (r.code !== 0) return;
      const data = JSON.parse(r.stdout || "{}");
      if (!data.address) return;
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
    .catch(() => {});
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

export function resolveFocusedPaneId(sp = spaces(), ps = panes(), foc = focused()) {
  const allPanes = ps ?? [];
  if (!allPanes.length) return null;
  if (foc?.pane) {
    const direct = allPanes.find((x) => x.pane === foc.pane);
    if (direct?.pane) return direct.pane;
  }
  const activeSpace = (sp ?? []).find((s) => s.active) ?? null;
  const activeTab = activeSpace?.tabs?.find((t) => t.active) ?? null;
  const tabId = activeTab?.id ?? foc?.tab ?? "";
  const tabPanes = tabId ? allPanes.filter((x) => x.tab === tabId) : allPanes;
  const focusedInTab = tabPanes.find((x) => x.focused);
  if (focusedInTab?.pane) return focusedInTab.pane;
  if (foc?.terminal) {
    const byTerm =
      tabPanes.find((x) => x.terminal === foc.terminal) ??
      allPanes.find((x) => x.terminal === foc.terminal);
    if (byTerm?.pane) return byTerm.pane;
  }
  const focusedAnywhere = allPanes.find((x) => x.focused);
  if (focusedAnywhere?.pane) return focusedAnywhere.pane;
  if (tabPanes.length === 1 && tabPanes[0]?.pane) return tabPanes[0].pane;
  return null;
}

function activePaneContext() {
  const f = focused() ?? {};
  const sp = (spaces() ?? []).find((s) => s.active) ?? null;
  const tb = sp?.tabs?.find((t) => t.active) ?? null;
  const tabId = tb?.id ?? f.tab ?? "";
  const allPanes = panes() ?? [];
  const tabPanes = tabId ? allPanes.filter((x) => x.tab === tabId) : allPanes;
  const lastPane = typeof shared === "function" ? shared("focusHistory")?.journal?.at?.(-1) : null;
  const p =
    allPanes.find((x) => f.pane && x.pane === f.pane) ??
    tabPanes.find((x) => x.focused) ??
    allPanes.find((x) => x.focused) ??
    (lastPane ? tabPanes.find((x) => x.pane === lastPane) : null) ??
    tabPanes[0] ??
    allPanes[0] ??
    null;
  const termAddr = p?.terminal ?? f.terminal ?? null;
  const termObj = termAddr ? ((terminals() ?? []).find((x) => x.address === termAddr) ?? null) : null;
  return { f, sp, tb, tabId, tabPanes, p, termAddr, termObj };
}

function openNewTabPrompt() {
  const { f, sp, p } = activePaneContext();
  const space = sp?.id ?? f.space ?? "";
  const folder = p?.cwd ?? f.cwd ?? sp?.folder ?? "";
  openOverlay({
    mod: "prompt",
    kind: "dialog",
    width: 420,
    props: {
      title: "New Tab",
      command: {
        name: "tab.new",
        args: {
          ...(space ? { space } : {}),
          ...(folder ? { folder } : {}),
        },
      },
    },
  });
}

function smartPaneNav(dir, letter) {
  const { tb, tabPanes, p, termAddr, termObj } = activePaneContext();
  const noRoom = Boolean(tb?.zoomed || p?.zoomed || tabPanes.length <= 1);
  if (!noRoom || !termAddr || !CTRL_HEX[letter] || p?.status) {
    run("pane.go", { direction: dir });
    return;
  }
  sendRawHex(termAddr, `00${CTRL_HEX[letter]}`, termObj, "vim").then((r) => {
    if (r.code !== 0) run("pane.go", { direction: dir });
  });
}

function smartScroll(to) {
  const { p, termAddr, termObj } = activePaneContext();
  const progKey = (p?.program?.key ?? "").toLowerCase();
  const fgName = (termObj?.foreground?.name ?? "").toLowerCase();
  const title = p?.title ?? termObj?.title ?? "";
  const shouldForward =
    Boolean(p?.status || p?.program?.agent) ||
    isVimPane(p, termObj) ||
    ["pi", "less"].includes(progKey) ||
    ["pi", "less"].includes(fgName) ||
    title.includes("herdr") ||
    title.startsWith("π ");
  if (shouldForward && termAddr) {
    sendRawHex(termAddr, to === "top" ? "1b5b313b3941" : "1b5b313b3942", termObj, "raw");
  } else {
    run("terminal.scroll", { to, ...(termAddr ? { terminal: termAddr } : {}) });
  }
}

function smartClose() {
  const { f, p, termAddr, termObj } = activePaneContext();
  if (!f.pane && f.terminal) {
    // An overlay dialog (such as confirm-close) has keyboard focus:
    // repeating cmd+w sends ctrl+alt+w (\x1b\x17) to confirm closing.
    sendRawHex(f.terminal, "1b17", null, "raw");
    return;
  }
  if (!p || !termAddr) return;
  if (p.status) {
    openConfirmClosePopup(p, p.app || p.program?.key || p.program?.name || "agent");
    return;
  }
  // Always query live foreground process via terminal.get ("smart" mode) rather
  // than trusting cached p.program / termObj.foreground, which stay stale ("nvim")
  // for 1-2s after nvim exits back to the shell.
  sendRawHex(termAddr, "007f", termObj, "smart").then((r) => {
    if (r.code === 0) return; // was vim, <c-space><bs> already sent
    if (r.code === 3) {
      run("pane.close", { pane: p.pane });
      return;
    }
    const procName = (r.stdout || "").trim() || p.program?.name || "process";
    openConfirmClosePopup(p, procName);
  });
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const RAIL_CELL = 32;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
const AUTO_TITLE_PENDING_MS = 5000;

const GENERIC_TITLES = new Set([
  "",
  "pi",
  "claude",
  "claude code",
  "codex",
  "gemini",
  "opencode",
  "amp",
  "cursor",
  "cursor-agent",
  "droid",
  "kiro",
  "aider",
  "grok",
  "hermes",
  "kilo",
  "qwen",
  "qwen-code",
  "devin",
  "cline",
  "copilot",
  "kimi",
  "maki",
  "terminal",
  "shell",
  "fish",
  "zsh",
  "bash",
  "sh",
  "dash",
  "ksh",
  "nu",
  "tmux",
  "working",
  "thinking",
]);

export function isSlug(value) {
  const text = String(value ?? "").trim();
  return Boolean(text && !/\s/.test(text) && (text.includes("-") || text.includes("_")));
}

export function cleanAgentTitle(rawTitle, lead, space) {
  const raw = String(rawTitle ?? "").replace(/[\x00-\x1f\x7f-\x9f]+/g, " ").trim();
  if (!raw || raw === "π") return "";
  const cwd = lead?.cwd || space?.folder || "";
  const cwdBase = cwd ? base(cwd) : "";

  let candidate = raw;
  if (candidate.startsWith("π - ")) {
    const rest = candidate.slice(4).trim();
    if (!rest || (cwdBase && rest.toLowerCase() === cwdBase.toLowerCase())) return "";
    if (cwdBase && rest.toLowerCase().endsWith(` - ${cwdBase.toLowerCase()}`)) {
      candidate = rest.slice(0, -(cwdBase.length + 3)).trim();
    } else if (!rest.includes(" - ")) {
      return "";
    } else {
      candidate = rest;
    }
  }

  const pathCheck = candidate.replace(/^[^\p{L}\p{N}~/\\]+/u, "");
  if (/^[~/]|^[A-Za-z]:\\|^\\\\/.test(pathCheck)) return "";

  let live = candidate
    .replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "")
    .replace(/^\[ [!.] \] /, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cwdBase && live.toLowerCase().endsWith(` | ${cwdBase.toLowerCase()}`)) {
    live = live.slice(0, -(cwdBase.length + 3)).trim();
  }

  if (!live || live.includes("@") || isSlug(live)) return "";
  if (/^(nvim|vim):/i.test(live) || /^(fish|zsh|bash|sh|dash|ksh|nu)\s+[~/]/i.test(live)) return "";

  const lower = live.toLowerCase();
  if (GENERIC_TITLES.has(lower)) return "";
  const termFull = String(lead?.terminal ?? "").toLowerCase();
  const termBare = (termFull.split("/").pop() ?? "").toLowerCase();
  if (lower === termFull || (termBare && lower === termBare)) return "";
  if (lead?.program?.name && lower === lead.program.name.toLowerCase()) return "";
  if (lead?.program?.key && lower === lead.program.key.toLowerCase()) return "";
  if (cwdBase && lower === cwdBase.toLowerCase()) return "";
  if (cwd && lower === cwd.toLowerCase()) return "";

  return live;
}

export function isDefaultOrSlugTabName(tab, lead, space) {
  if (!tab?.named) return true;
  const name = String(tab.name ?? "").trim();
  if (!name || /^\d+$/.test(name)) return true;
  if (isSlug(name)) return true;
  const lower = name.toLowerCase();
  if (GENERIC_TITLES.has(lower) || lower === "ask") return true;
  if (lead?.program?.name && lower === lead.program.name.toLowerCase()) return true;
  if (lead?.program?.key && lower === lead.program.key.toLowerCase()) return true;
  if (space?.name && lower === String(space.name).trim().toLowerCase()) return true;
  return false;
}

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.shownPanes = new Set((panes() ?? []).map((p) => p.pane).filter(Boolean));
    this.pendingFocus = null;
    this.pendingHistoryTarget = null;
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.initFocusHistory();
    try {
      this.autoTitles = JSON.parse(localStorage.getItem("tabs.autoTitles") ?? "{}");
    } catch {
      this.autoTitles = {};
    }
    if (!this.autoTitles || typeof this.autoTitles !== "object" || Array.isArray(this.autoTitles)) {
      this.autoTitles = {};
    }
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    if (isChecking()) return;
    const initSpaces = spaces();
    const initPanes = panes();
    this.syncFocusHistory(Date.now(), initSpaces, initPanes, focused());
    this.syncAutoTitles(Date.now(), initSpaces, initPanes);
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    cx.spawn(async () => {
      for (;;) {
        const cmd = await nextCommand();
        if (cmd === "tab_next") smartTabNav("next");
        else if (cmd === "tab_prev") smartTabNav("prev");
        else if (cmd === "tab_new") openNewTabPrompt();
        else if (cmd === "pane_left") smartPaneNav("left", "h");
        else if (cmd === "pane_down") smartPaneNav("down", "j");
        else if (cmd === "pane_up") smartPaneNav("up", "k");
        else if (cmd === "pane_right") smartPaneNav("right", "l");
        else if (cmd === "scroll_top") smartScroll("top");
        else if (cmd === "scroll_bottom") smartScroll("bottom");
        else if (cmd === "smart_close") smartClose();
        else if (cmd === "focus_back") this.focusJumplist("back", Date.now(), spaces(), panes(), focused(), this.consumePrefixActivePane());
        else if (cmd === "focus_forward") this.focusJumplist("forward", Date.now(), spaces(), panes(), focused(), this.consumePrefixActivePane());
        else if (cmd === "attention_jump") this.attentionJump(Date.now(), spaces(), panes(), focused(), this.consumePrefixActivePane());
      }
    });
  }

  initFocusHistory() {
    let loaded = null;
    try {
      loaded = JSON.parse(localStorage.getItem("focusHistory") ?? "null");
    } catch {
      loaded = null;
    }
    this.focusHistory = {
      journal: Array.isArray(loaded?.journal) ? loaded.journal.filter((x) => typeof x === "string" && x) : [],
      seq: typeof loaded?.seq === "number" && loaded.seq >= 0 ? loaded.seq : 0,
      walk: Array.isArray(loaded?.walk) ? loaded.walk.filter((x) => typeof x === "string" && x) : [],
      walkState:
        loaded?.walkState && typeof loaded.walkState === "object" && !Array.isArray(loaded.walkState)
          ? loaded.walkState
          : null,
    };
    if (typeof setShared === "function") setShared("focusHistory", this.focusHistory);
  }

  saveFocusHistory() {
    try {
      localStorage.setItem("focusHistory", JSON.stringify(this.focusHistory));
    } catch {}
    if (typeof setShared === "function") setShared("focusHistory", this.focusHistory);
  }

  consumePrefixActivePane() {
    if (typeof shared !== "function") return null;
    const val = shared("focusHistory.activePane");
    if (val && typeof setShared === "function") setShared("focusHistory.activePane", null);
    return typeof val === "string" && val ? val : null;
  }

  notifyToast(title, body) {
    if (typeof notify === "function") {
      notify({ title, ...(body ? { body } : {}), timeout: 1500 });
    }
  }

  recordFocusPane(paneId, syncDisk = true) {
    if (!this.focusHistory) this.initFocusHistory();
    const id = typeof paneId === "string" ? paneId.trim() : "";
    if (!id) return false;
    const fh = this.focusHistory;
    if (fh.journal.length > 0 && fh.journal[fh.journal.length - 1] === id) {
      return false;
    }
    fh.journal.push(id);
    if (fh.journal.length > 2000) {
      fh.journal = fh.journal.slice(-500);
    }
    fh.seq = (fh.seq || 0) + 1;
    this.saveFocusHistory();
    if (syncDisk && !isChecking() && typeof exec === "function" && typeof home === "function") {
      exec("python3", [`${home()}/.config/herdr/scripts/focus-history-daemon.fish`, "record", id]).catch(() => {});
    }
    return true;
  }

  syncFocusHistory(now = Date.now(), sp = spaces(), ps = panes(), foc = focused()) {
    if (!this.focusHistory) this.initFocusHistory();
    const cur = resolveFocusedPaneId(sp, ps, foc);
    if (!cur) return;
    if (this.pendingHistoryTarget) {
      if (cur === this.pendingHistoryTarget.pane) {
        this.pendingHistoryTarget = null;
      } else if (cur === this.pendingHistoryTarget.fromPane && now < this.pendingHistoryTarget.until) {
        return;
      } else {
        this.pendingHistoryTarget = null;
      }
    }
    this.recordFocusPane(cur);
  }

  focusJumplist(direction, now = Date.now(), sp = spaces(), ps = panes(), foc = focused(), currentOverride = null) {
    if (!this.focusHistory) this.initFocusHistory();
    if (direction !== "back" && direction !== "forward") return false;
    const allPanes = ps ?? [];
    const live = new Set(allPanes.map((p) => p.pane).filter(Boolean));
    let current =
      (this.pendingHistoryTarget && now < this.pendingHistoryTarget.until ? this.pendingHistoryTarget.pane : null) ||
      (currentOverride && live.has(currentOverride) ? currentOverride : null) ||
      resolveFocusedPaneId(sp, allPanes, foc) ||
      this.focusHistory.journal.at(-1) ||
      "";
    if (!current) {
      this.notifyToast("Focus jumplist failed", "No focused pane");
      return false;
    }

    this.recordFocusPane(current);

    const fh = this.focusHistory;
    const trail = fh.journal;
    const curSeq = fh.seq;

    let index = -1;
    let walk = [];
    const ws = fh.walkState;
    if (
      ws &&
      typeof ws.index === "number" &&
      ws.expectedPane === current &&
      typeof ws.seq === "number" &&
      curSeq - ws.seq >= 0 &&
      curSeq - ws.seq <= 1 &&
      Array.isArray(fh.walk) &&
      fh.walk.length > 1
    ) {
      index = ws.index;
      walk = fh.walk;
    }

    if (index < 0) {
      if (direction === "forward") {
        this.notifyToast("No forward history");
        return false;
      }
      if (trail.length === 0) {
        this.notifyToast("No focus history yet");
        return false;
      }
      walk = [current];
      for (let i = trail.length - 1; i >= 0; i--) {
        const p = trail[i];
        if (!p || walk.includes(p) || !live.has(p)) continue;
        walk.push(p);
      }
      if (walk.length <= 1) {
        fh.walk = [];
        fh.walkState = null;
        this.saveFocusHistory();
        this.notifyToast("Start of focus history");
        return false;
      }
      index = 0;
      fh.walk = walk;
    }

    let targetIndex = index;
    while (true) {
      if (direction === "back") {
        targetIndex += 1;
        if (targetIndex >= walk.length) {
          fh.walkState = { index, expectedPane: current, seq: curSeq };
          this.saveFocusHistory();
          this.notifyToast("Start of focus history");
          return false;
        }
      } else {
        targetIndex -= 1;
        if (targetIndex < 0) {
          fh.walkState = { index, expectedPane: current, seq: curSeq };
          this.saveFocusHistory();
          this.notifyToast("End of focus history");
          return false;
        }
      }
      if (live.has(walk[targetIndex])) break;
    }

    const target = walk[targetIndex];
    this.pendingHistoryTarget = { pane: target, fromPane: current, until: now + 1500 };
    run("pane.focus", { pane: target });
    this.recordFocusPane(target);
    fh.walkState = { index: targetIndex, expectedPane: target, seq: fh.seq };
    this.saveFocusHistory();

    const steps = targetIndex;
    if (direction === "back") {
      this.notifyToast(`← ${target}`, `${steps} back`);
    } else if (steps === 0) {
      this.notifyToast(`→ ${target}`);
    } else {
      this.notifyToast(`→ ${target}`, `${steps} back`);
    }
    return true;
  }

  attentionJump(now = Date.now(), sp = spaces(), ps = panes(), foc = focused(), currentOverride = null) {
    if (!this.focusHistory) this.initFocusHistory();
    const allPanes = ps ?? [];
    const live = new Set(allPanes.map((p) => p.pane).filter(Boolean));
    const currentPane =
      (this.pendingHistoryTarget && now < this.pendingHistoryTarget.until ? this.pendingHistoryTarget.pane : null) ||
      (currentOverride && live.has(currentOverride) ? currentOverride : null) ||
      resolveFocusedPaneId(sp, allPanes, foc) ||
      this.focusHistory.journal.at(-1) ||
      "";
    if (currentPane) this.recordFocusPane(currentPane);

    const agentList = (typeof agents === "function" ? agents() : null) ?? [];
    const snoozeState = (typeof shared === "function" ? shared("agents.snooze") : null) ?? {};
    const snoozePanes = snoozeState.panes ?? {};
    const snoozeWorkspaces = snoozeState.workspaces ?? {};
    const isSnoozed = (a) => {
      const pEntry = snoozePanes[a.pane] ?? Object.values(snoozePanes).find((e) => e?.terminal_id === a.address);
      if (pEntry && pEntry.until > now) return true;
      const wEntry = a.space ? snoozeWorkspaces[a.space] : null;
      return Boolean(wEntry && wEntry.until > now);
    };

    let changed = {};
    try {
      changed = JSON.parse(localStorage.getItem("changed") ?? "{}") ?? {};
    } catch {
      changed = {};
    }

    const candidates = [];
    for (let i = 0; i < agentList.length; i++) {
      const a = agentList[i];
      if (!a?.pane || !live.has(a.pane)) continue;
      if (isSnoozed(a)) continue;
      const status = a.status === "error" ? "blocked" : a.status;
      if (status !== "blocked" && status !== "done") continue;
      const since = changed[a.address]?.at ?? 0;
      const seq = a.seq ?? 0;
      candidates.push({
        agent: a,
        status,
        pinned: Boolean(a.pinned),
        since,
        seq,
        index: i,
        focused: currentPane ? a.pane === currentPane : Boolean(a.focused),
      });
    }

    candidates.sort((x, y) => {
      if (x.pinned !== y.pinned) return x.pinned ? -1 : 1;
      if (x.status !== y.status) return x.status === "blocked" ? -1 : 1;
      if (y.since !== x.since) return y.since - x.since;
      if (y.seq !== x.seq) return y.seq - x.seq;
      return x.index - y.index;
    });

    const focIdx = candidates.findIndex((c) => c.focused);
    const rotated =
      focIdx >= 0 ? [...candidates.slice(focIdx + 1), ...candidates.slice(0, focIdx)] : candidates;
    const picked = rotated.filter((c) => !c.focused);

    if (picked.length === 0) {
      return this.focusJumplist("forward", now, sp, allPanes, foc, currentPane);
    }

    const chosen = picked[0];
    const targetPane = chosen.agent.pane;
    const kind = chosen.agent.program?.key || chosen.agent.program?.name?.toLowerCase() || chosen.agent.app || "agent";
    const label = `${kind} ${chosen.status}`;

    this.pendingHistoryTarget = { pane: targetPane, fromPane: currentPane, until: now + 1500 };
    run("pane.focus", { pane: targetPane });
    this.recordFocusPane(targetPane);

    const others = picked.length - 1;
    this.notifyToast(others > 0 ? `→ ${label} (+${others} more)` : `→ ${label}`);
    return true;
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    const ps = panes();
    this.syncFocusHistory(now, sp, ps, focused());
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    for (const p of ps) {
      if (p.pane && !this.shownPanes.has(p.pane)) {
        this.shownPanes.add(p.pane);
        const barePane = typeof p.pane === "string" ? (p.pane.split("/").pop() ?? "") : "";
        if (barePane.startsWith("pf")) {
          this.pendingFocus = { pane: p.pane, until: now + 2500 };
          run("pane.focus", { pane: p.pane });
        }
      }
    }
    if (this.pendingFocus) {
      if (now > this.pendingFocus.until) {
        this.pendingFocus = null;
      } else if (ps.some((p) => p.pane === this.pendingFocus.pane && !p.focused)) {
        run("pane.focus", { pane: this.pendingFocus.pane });
      }
    }
    this.syncAutoTitles(now, sp, ps);
    const due = this.due(now, sp, ps);
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  syncAutoTitles(now, sp, ps) {
    if (isChecking()) return;
    const machineList = machines() ?? [];
    const isMachineReady = (name) => {
      const m = machineList.find((x) => (x.name ?? null) === (name ?? null));
      return m ? m.layout === "ready" : name == null;
    };

    const agentsByTab = new Map();
    for (const p of ps) {
      if (!p.terminal || !p.tab) continue;
      if (p.program?.agent || p.app || p.status) {
        let list = agentsByTab.get(p.tab);
        if (!list) {
          list = [];
          agentsByTab.set(p.tab, list);
        }
        list.push(p);
      }
    }

    let dirty = false;
    const liveTabIds = new Set();

    for (const s of sp) {
      const machineReady = isMachineReady(s.machine ?? null);
      for (const tab of s.tabs ?? []) {
        liveTabIds.add(tab.id);
        const tabAgents = agentsByTab.get(tab.id) ?? [];
        if (tabAgents.length !== 1) continue;

        const lead = tabAgents[0];
        const wantTitle = cleanAgentTitle(lead.title, lead, s);
        let rec = this.autoTitles[tab.id];

        if (rec && rec.terminal && rec.terminal !== lead.terminal) {
          if (!tab.named || isDefaultOrSlugTabName(tab, lead, s) || tab.name === rec.title) {
            delete this.autoTitles[tab.id];
            rec = null;
            dirty = true;
          }
        }

        if (!tab.named && rec && !(rec.pendingUntil && now < rec.pendingUntil && tab.name === rec.fromName)) {
          delete this.autoTitles[tab.id];
          rec = null;
          dirty = true;
        }

        if (rec) {
          if (rec.pendingUntil && now < rec.pendingUntil && tab.name === rec.fromName) {
            continue;
          }
          if (rec.pendingUntil && now >= rec.pendingUntil && tab.name === rec.fromName) {
            delete this.autoTitles[tab.id];
            rec = null;
            dirty = true;
          } else if (rec.yielded) {
            continue;
          } else if (tab.name !== rec.title) {
            this.autoTitles[tab.id] = {
              terminal: lead.terminal,
              title: rec.title,
              yielded: true,
              manualName: tab.name,
            };
            dirty = true;
            continue;
          } else {
            if (rec.pendingUntil || rec.fromName !== undefined) {
              rec = { terminal: lead.terminal, title: rec.title };
              this.autoTitles[tab.id] = rec;
              dirty = true;
            }
            if (wantTitle && wantTitle !== tab.name && machineReady) {
              run("tab.rename", { id: tab.id, name: wantTitle });
              this.autoTitles[tab.id] = {
                terminal: lead.terminal,
                title: wantTitle,
                fromName: tab.name,
                pendingUntil: now + AUTO_TITLE_PENDING_MS,
              };
              dirty = true;
            }
            continue;
          }
        }

        if (!wantTitle) continue;

        if (tab.name === wantTitle) {
          this.autoTitles[tab.id] = { terminal: lead.terminal, title: wantTitle };
          dirty = true;
          continue;
        }

        if (isDefaultOrSlugTabName(tab, lead, s) && machineReady) {
          run("tab.rename", { id: tab.id, name: wantTitle });
          this.autoTitles[tab.id] = {
            terminal: lead.terminal,
            title: wantTitle,
            fromName: tab.name,
            pendingUntil: now + AUTO_TITLE_PENDING_MS,
          };
          dirty = true;
        }
      }
    }

    for (const id of Object.keys(this.autoTitles)) {
      const machine = id.includes("/") ? id.split("/")[0] : null;
      if (isMachineReady(machine) && !liveTabIds.has(id)) {
        delete this.autoTitles[id];
        dirty = true;
      }
    }

    if (dirty) {
      localStorage.setItem("tabs.autoTitles", JSON.stringify(this.autoTitles));
    }
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }


  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        await Promise.all(keys.map((key) => this.check(key, cx)));
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await Promise.all([
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      ]);
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts] = await Promise.all([
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
      ]);
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : rows.map(draw);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = this.folded.has(m);
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (collapsed && login) { run("app.settings", { section: "machines" }); return; }
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, el => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));
      if (!collapsed && rebuilt) return [head];
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      return [cell(head), ...guidance, ...(folded ? [] : mine.length ? mine.map(draw) : [loading(m) ? loadingRow(m) : cell(empty)])];
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  row({ w, i, g, tree }, t) {
    const on = w.active;
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim)))
          .when(!tree, el => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?")))
          .child(div().flex_shrink(0).max_w(150).truncate().text_color(t.foreground).child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),
      );
  }

  compact({ w, i }, t) {
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(6)
      .justify_center()
      .items_center()
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    if (!isChecking()) this.syncFocusHistory(Date.now(), sp, panes(), focused());
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child("Spaces"))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(this.grouped(t, collapsed)));
  }
}
