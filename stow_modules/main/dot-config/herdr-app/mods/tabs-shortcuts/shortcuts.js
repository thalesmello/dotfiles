// Workspace shortcut actions. Kept inside this mod because Herdr's module
// loader isolates each mod folder. Close targets are captured before async IPC.
import { spaces, panes, terminals, focused, run, openOverlay, notify, exec, hc, home, appHome } from "herdr";

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
  my ($ti) = $g =~ /"title":"([^"]*)"/;
  my ($c) = $g =~ /"cols":(\\d+)/; $cols = $c if $c;
  my ($r) = $g =~ /"rows":(\\d+)/; $rows = $r if $r;
  my $base = $fg ? $fg : ""; $base =~ s!.*/!!; $base =~ s/^-+//; $base =~ s/\\.real$//;
  my $is_shell = ($base =~ /^(?:sh|bash|zsh|fish|dash|ksh|mksh|tcsh|csh|nu|nushell|pwsh|powershell|login)$/i);
  my $is_vim = ($base =~ /^(?:n?vim|vi)$/i) || (!$is_shell && $ti && $ti =~ /^(?:n?vim):/i);
  if (!$is_vim) {
    exit 2 if $mode eq "vim";
    if ($is_shell) { exit 3; }
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
  const t = termObj ?? (terminals() ?? []).find(x => x.address === termAddr) ?? null;
  return exec("/usr/bin/perl", ["-e", PERL_SEND_SCRIPT, termAddr, hexBytes, mode, String(t?.cols || 120), String(t?.rows || 40)])
    .catch(err => ({ code: 1, stdout: "", stderr: String(err) }));
}

function qualifyPaneId(id, machine) {
  return !id || !machine || id.includes("/") ? id : `${machine}/${id}`;
}

function activePaneContext() {
  const f = focused() ?? {};
  const sp = (spaces() ?? []).find(s => s.active) ?? null;
  const tb = sp?.tabs?.find(t => t.active) ?? null;
  const tabId = tb?.id ?? f.tab ?? "";
  const allPanes = panes() ?? [];
  const tabPanes = tabId ? allPanes.filter(x => x.tab === tabId) : allPanes;
  // Never use focus history/the first pane while a popup has the keyboard.
  const p = f.pane
    ? (f.terminal ? allPanes.find(x => (x.pane === f.pane || qualifyPaneId(x.pane, sp?.machine ?? null) === f.pane) && x.terminal === f.terminal) ?? null : null) ??
      tabPanes.find(x => x.pane === f.pane || qualifyPaneId(x.pane, sp?.machine ?? null) === f.pane) ??
      allPanes.find(x => x.pane === f.pane) ?? null
    : (!f.terminal ? tabPanes.find(x => x.focused) ?? null : null);
  const termAddr = f.shown ?? p?.terminal ?? f.terminal ?? null;
  const termObj = termAddr ? (terminals() ?? []).find(x => x.address === termAddr) ?? null : null;
  return { f, sp, tb, tabPanes, p, termAddr, termObj };
}

const pendingClosePopups = new Set();
function closeError(body) {
  notify({ title: "Could not open close confirmation", body: String(body), level: "error" });
}

function openConfirmClosePopup(p, procName) {
  const paneId = p?.pane || "";
  const target = (panes() ?? []).find(x => x.pane === paneId && x.terminal === p?.terminal);
  if (!paneId || !target?.terminal || pendingClosePopups.has(paneId)) return;
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
    .then(r => {
      if (r.code !== 0) { closeError(r.stderr || r.stdout || `exit ${r.code}`); return; }
      const data = JSON.parse(r.stdout || "{}");
      if (!data.address) { closeError("The confirmation helper returned no terminal address"); return; }
      const f = focused() ?? {};
      if (!(panes() ?? []).some(x => x.pane === paneId && x.terminal === target.terminal)
          || (f.pane && f.pane !== paneId) || (!f.pane && f.terminal && f.terminal !== target.terminal)) {
        hc(["kill", data.address]).catch(() => {});
        return;
      }
      openOverlay({ kind: "dialog", width: 580, height: 220,
        layout: { type: "column", children: [{ type: "block", content: { terminal: data.address } }] } });
    })
    .catch(closeError)
    .finally(() => pendingClosePopups.delete(paneId));
}

const CTRL_HEX = { h: "08", j: "0a", k: "0b", l: "0c" };
export function smartPaneNav(dir, letter) {
  const { tb, tabPanes, p, termAddr, termObj } = activePaneContext();
  const noRoom = Boolean(tb?.zoomed || p?.zoomed || tabPanes.length <= 1);
  if (!noRoom || !termAddr || !CTRL_HEX[letter] || p?.status) {
    run("pane.go", { direction: dir });
    return;
  }
  sendRawHex(termAddr, `00${CTRL_HEX[letter]}`, termObj, "vim").then(r => {
    if (r.code !== 0) run("pane.go", { direction: dir });
  });
}

export function smartClose() {
  const { f, p, termAddr, termObj } = activePaneContext();
  if (!f.pane && f.terminal) {
    sendRawHex(f.terminal, "1b17", null, "raw");
    return;
  }
  if (!p || !termAddr) return;
  if (p.terminal !== termAddr) {
    notify({ title: "Close cancelled: this pane is showing another terminal", level: "warning", timeout: 3000 });
    return;
  }
  if (p.status) {
    openConfirmClosePopup(p, p.app || p.program?.key || p.program?.name || "agent");
    return;
  }
  sendRawHex(termAddr, "007f", termObj, "smart").then(r => {
    if (r.code === 0) return; // Vim receives <c-space><bs>.
    if (r.code === 3) {
      if ((panes() ?? []).some(x => x.pane === p.pane && x.terminal === termAddr)) {
        hc(["kill", termAddr]).then(result => {
          if (result.code !== 0) notify({ title: "Could not close terminal", body: result.stderr || result.stdout, level: "error" });
        }).catch(err => notify({ title: "Could not close terminal", body: String(err), level: "error" }));
      }
      return;
    }
    openConfirmClosePopup(p, (r.stdout || "").trim() || p.program?.name || "process");
  });
}

export function smartTabNav(dir) {
  const ring = (spaces() ?? []).flatMap(sp => (sp.tabs ?? []).map(tb => ({
    spaceId: sp.id, tabId: tb.id, active: Boolean(sp.active && tb.active),
  })));
  const idx = ring.findIndex(x => x.active);
  if (idx < 0) return;
  const target = ring[(idx + (dir === "prev" ? -1 : 1) + ring.length) % ring.length];
  if (target.spaceId !== ring[idx].spaceId) run("space.select", { id: target.spaceId });
  run("tab.select", { id: target.tabId });
}

export function openNewTabPrompt() {
  const { f, sp, p } = activePaneContext();
  const space = sp?.id ?? f.space ?? "";
  const folder = p?.cwd ?? f.cwd ?? sp?.folder ?? "";
  openOverlay({ mod: "prompt", kind: "dialog", width: 420, props: {
    title: "New Tab", command: { name: "tab.new", args: {
      ...(space ? { space } : {}), ...(folder ? { folder } : {}),
    } },
  } });
}

export function smartScroll(to) {
  const { p, termAddr, termObj } = activePaneContext();
  const progKey = (p?.program?.key ?? "").toLowerCase();
  const progName = (p?.program?.name ?? "").toLowerCase();
  const fgName = (termObj?.foreground?.name ?? "").toLowerCase();
  const title = (p?.title ?? termObj?.title ?? "").toLowerCase();
  const shouldForward = Boolean(p?.status || p?.program?.agent) ||
    [progKey, progName, fgName].some(x => ["nvim", "vim", "neovim", "pi", "less"].includes(x)) ||
    title.startsWith("nvim:") || title.startsWith("vim:") || title.includes("herdr") || title.startsWith("π ");
  if (shouldForward && termAddr) {
    sendRawHex(termAddr, to === "top" ? "1b5b313b3941" : "1b5b313b3942", termObj, "raw");
  } else {
    run("terminal.scroll", { to, ...(termAddr ? { terminal: termAddr } : {}) });
  }
}
