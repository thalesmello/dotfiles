// Prefix-mode (`ctrl-space`) dispatcher and terminal popup host for herdr-app.
// Brings full feature parity with ~/.config/herdr/config.toml's [keys] and [[keys.command]].

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  agents,
  spaces,
  panes,
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
  readTextFile,
  writeTextFile,
} from "herdr";

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

function activeContext() {
  const f = focused() ?? {};
  const sp = (spaces() ?? []).find((s) => s.active) ?? null;
  const tb = sp?.tabs?.find((t) => t.active) ?? null;
  const tabId = tb?.id ?? f.tab ?? "";
  const allPanes = panes() ?? [];
  const tabPanes = tabId ? allPanes.filter((x) => x.tab === tabId) : allPanes;
  const p =
    allPanes.find((x) => f.pane && x.pane === f.pane) ??
    tabPanes.find((x) => x.focused) ??
    allPanes.find((x) => x.focused) ??
    tabPanes[0] ??
    allPanes[0] ??
    null;
  return {
    pane: p?.pane ?? f.pane ?? "",
    terminal: p?.terminal ?? f.terminal ?? "",
    cwd: p?.cwd ?? f.cwd ?? sp?.folder ?? home(),
    space: sp?.id ?? f.space ?? "",
    spaceName: sp?.name ?? "",
    machine: sp?.machine ?? null,
    tab: tabId,
    tabName: tb?.name ?? "",
  };
}

function buildEnv(ctx, extra = {}) {
  const env = {
    HC_PRESET_BACKEND: "hc",
    HERDR_ACTIVE_PANE_ID: ctx.pane || ctx.terminal || "",
    HERDR_ACTIVE_TERMINAL_ID: ctx.terminal || "",
    HERDR_ACTIVE_TAB_ID: ctx.tab || "",
    HERDR_ACTIVE_WORKSPACE_ID: ctx.space || "",
    HC_TERMINAL_ID: ctx.terminal || "",
    ...extra,
  };
  return Object.entries(env)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${JSON.stringify(String(v))}`)
    .join(" ");
}

function runDetachedScript(overlayId, scriptCmd, ctx, extraEnv = {}) {
  const envExports = buildEnv(ctx, extraEnv);
  const inner = `export PATH="$HOME/src/dotfiles/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" ${envExports}; ${scriptCmd}`;
  exec("sh", ["-c", `nohup sh -c ${JSON.stringify(inner)} >/dev/null 2>&1 </dev/null &`], {
    cwd: ctx.cwd || home(),
  })
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
  const envExports = buildEnv(ctx, opts.env ?? {});
  const full = `export PATH="$HOME/src/dotfiles/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" ${envExports}; ${scriptCmd}`;
  hc(["run", "--bg", "--rm", "--no-notify", "--json", "--cwd", ctx.cwd || home(), "--", "sh", "-c", full])
    .then((r) => {
      if (overlayId) closeOverlay(overlayId);
      if (r.code !== 0) return;
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
    this.ctx = activeContext();
    this.handle = cx.focus_handle();
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

  handleResizeModeKey(e, cx) {
    const k = (e.key || "").toLowerCase();
    if (k === "escape" || k === "enter" || k === "q") {
      this.dismiss();
      cx.stop_propagation();
      return;
    }
    const dirMap = { h: "left", left: "left", j: "down", down: "down", k: "up", up: "up", l: "right", right: "right" };
    const dir = dirMap[k];
    if (dir) {
      runDetachedScript(null, `hc-preset --backend hc resize-pane ${dir}`, this.ctx);
      cx.stop_propagation();
      return;
    }
    if (k === "=") {
      runDetachedScript(props().overlay, "~/.config/herdr/scripts/even-layout.sh", this.ctx);
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
      cx.notify();
      return;
    }

    // 1. Ctrl+Space again -> send literal Ctrl+Space to terminal
    if (ks === "ctrl-space" || (ctrl && key === "space")) {
      if (ctx.terminal) {
        hc(["keys", ctx.terminal, "ctrl+space"]).finally(() => this.dismiss());
      } else {
        this.dismiss();
      }
      return;
    }

    // 2. Indexed bindings: 1..9 (tab), shift+1..9 (agent), alt+1..9 (space)
    const shiftedDigit = SHIFTED_DIGITS[ch] ?? (shift && /^[1-9]$/.test(key) ? Number(key) : null);
    if (shiftedDigit && !ctrl && !alt) {
      this.dismiss();
      const list = agents() ?? [];
      const target = list[shiftedDigit - 1];
      if (target?.address) run("agent.focus", { terminal: target.address });
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
      this.dismiss();
      const sp = (spaces() ?? []).find((s) => s.active) ?? null;
      const tb = sp?.tabs?.find((t) => t.active) ?? null;
      const allPanes = panes() ?? [];
      const tabPanes = ctx.tab ? allPanes.filter((x) => x.tab === ctx.tab) : allPanes;
      const p = allPanes.find((x) => x.pane === ctx.pane) ?? tabPanes[0] ?? null;
      const noRoom = Boolean(tb?.zoomed || p?.zoomed || tabPanes.length <= 1);
      const progKey = (p?.program?.key ?? "").toLowerCase();
      const isVim = progKey === "nvim" || progKey === "vim" || (p?.title ?? "").startsWith("nvim:");
      if (noRoom && isVim && ctx.terminal) {
        hc(["keys", ctx.terminal, "ctrl+space", `ctrl+${key}`]);
      } else {
        run("pane.go", { direction: navDirs[key] });
      }
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
      run("agent.prev");
      return;
    }
    if (ks === "ctrl-." || (ctrl && key === ".")) {
      this.dismiss();
      run("agent.next");
      return;
    }

    // 6. Close bindings (smart-close, confirm-close, close tab, close workspace)
    if (key === "backspace" && !ctrl && !alt && !shift) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/smart-close.sh", ctx);
      return;
    }
    if ((key === "backspace" && ctrl && !alt && !shift) || (ks === "x" && !ctrl && !alt && !shift)) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/confirm-close.py close", ctx);
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
        hc(["keys", ctx.terminal, "ctrl+l"]).finally(() => this.dismiss());
      } else {
        this.dismiss();
      }
      return;
    }
    if (ks === "ctrl-r" || (ctrl && key === "r" && !alt && !shift)) {
      runDetachedScript(overlayId, "~/src/dotfiles/bin/resume-agent", ctx);
      return;
    }
    if (ks === "shift-r" || (key === "r" && shift && !ctrl && !alt)) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/reload-config.sh", ctx);
      return;
    }
    if (ks === "a" && !ctrl && !alt && !shift) {
      openTerminalPopup(overlayId, "~/.config/herdr/scripts/ask-agent.sh", ctx, { width: 780, height: 420 });
      return;
    }
    if (ks === "shift-a" || (key === "a" && shift && !ctrl && !alt)) {
      openTerminalPopup(overlayId, "~/.config/herdr/scripts/ask-agent.sh", ctx, {
        width: 780,
        height: 420,
        env: { ASK_AGENT_CONTEXT: "1" },
      });
      return;
    }
    if (ks === "shift-m" || (key === "m" && shift && !ctrl && !alt)) {
      openTerminalPopup(overlayId, "~/.config/herdr/scripts/break-pane.sh", ctx, { width: 620, height: 180 });
      return;
    }

    // 8. Attention Jump & Focus History Jumplist
    if (key === "tab" && !shift && !ctrl && !alt) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/attention-jump.fish", ctx);
      return;
    }
    if ((key === "tab" && shift) || ks === "ctrl-o" || (ctrl && key === "o")) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/focus-jumplist.fish back", ctx);
      return;
    }
    if (ks === "ctrl-i" || (ctrl && key === "i")) {
      runDetachedScript(overlayId, "~/.config/herdr/scripts/focus-jumplist.fish forward", ctx);
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
      const curSort = shared("agents.sort") ?? "priority";
      const nextSort = curSort === "priority" ? "grouped" : "priority";
      setShared("agents.sort", nextSort);
      notify({ title: `Agents panel: ${nextSort}`, timeout: 1500 });
      return;
    }
    if (ks === "i" && !ctrl && !alt && !shift) {
      openTerminalPopup(overlayId, "python3 ~/.config/herdr/scripts/herdr-recap.py picker", ctx, { width: 920, height: 620 });
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
        env: { HERDR_SNOOZE_SCREEN: "list", SNOOZE_SCREEN: "list" },
      });
      return;
    }
    if (ks === "ctrl-z" || (key === "z" && ctrl && !shift && !alt)) {
      const curSort = shared("agents.sort") ?? "priority";
      setShared("agents.sort", curSort === "priority" ? "grouped" : "priority");
      runDetachedScript(overlayId, "~/.config/herdr/scripts/herdr-snooze.py toggle", ctx);
      return;
    }
    if (ks === "alt-s" || (key === "s" && alt && !shift && !ctrl)) {
      openTerminalPopup(overlayId, "python3 ~/.config/herdr/scripts/herdr-settled.py picker", ctx, { width: 920, height: 620 });
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
          { width: 0.85, height: 0.8 },
        );
      } else {
        this.dismiss();
      }
      return;
    }
    if (ks === "shift-o" || (key === "o" && shift && !ctrl && !alt)) {
      this.dismiss();
      run("agent.next");
      return;
    }
    if (ks === "y" && !ctrl && !alt && !shift) {
      const target = ctx.pane || ctx.terminal;
      if (target) {
        openTerminalPopup(
          overlayId,
          `~/.config/herdr/scripts/pick-selection.sh copy ${JSON.stringify(target)}`,
          ctx,
          { width: 0.85, height: 0.8 },
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
                  .child(isResize ? "h/l resize sidebar · = equalize · Esc done" : "Ctrl-Space active — press key"),
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
