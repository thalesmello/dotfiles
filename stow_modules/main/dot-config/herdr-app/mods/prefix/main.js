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

function activeContext() {
  const f = focused() ?? {};
  const allPanes = panes() ?? [];
  const p = allPanes.find((x) => x.pane === f.pane) ?? allPanes.find((x) => x.focused) ?? allPanes[0] ?? null;
  const sp = (spaces() ?? []).find((s) => s.active) ?? null;
  const tb = sp?.tabs?.find((t) => t.active) ?? null;
  return {
    pane: p?.pane ?? f.pane ?? "",
    terminal: p?.terminal ?? f.terminal ?? "",
    cwd: p?.cwd ?? f.cwd ?? sp?.folder ?? home(),
    space: sp?.id ?? f.space ?? "",
    spaceName: sp?.name ?? "",
    tab: tb?.id ?? f.tab ?? "",
    tabName: tb?.name ?? "",
  };
}

function buildEnv(ctx, extra = {}) {
  const env = {
    HC_PRESET_BACKEND: "hc",
    HERDR_ACTIVE_PANE_ID: ctx.pane || ctx.terminal || "",
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

function runDetachedScript(scriptCmd, ctx, extraEnv = {}) {
  const envExports = buildEnv(ctx, extraEnv);
  const full = `export PATH="$HOME/src/dotfiles/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" ${envExports}; ${scriptCmd}`;
  exec("sh", ["-c", full], { cwd: ctx.cwd || home() }).catch((err) => {
    console.log(`prefix script failed (${scriptCmd}): ${err}`);
  });
}

function openTerminalPopup(scriptCmd, ctx, opts = {}) {
  const width = opts.width ?? 680;
  const height = opts.height ?? 360;
  const envExports = buildEnv(ctx, opts.env ?? {});
  const full = `export PATH="$HOME/src/dotfiles/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" ${envExports}; ${scriptCmd}`;
  hc(["run", "--bg", "--rm", "--no-notify", "--cwd", ctx.cwd || home(), "--", "sh", "-c", full])
    .then((r) => {
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
        if (raw) {
          const req = JSON.parse(raw);
          await writeTextFile(reqPath, "");
          if (req?.terminal && Date.now() - (req.ts ?? 0) < 5000) {
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
      } catch {}
    });
  }

  close() {
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
      this.close();
      cx.stop_propagation();
      return;
    }
    const dirMap = { h: "left", left: "left", j: "down", down: "down", k: "up", up: "up", l: "right", right: "right" };
    const dir = dirMap[k];
    if (dir) {
      runDetachedScript(`hc-preset --backend hc resize-pane ${dir}`, this.ctx);
      cx.stop_propagation();
      return;
    }
    if (k === "=") {
      runDetachedScript("~/.config/herdr/scripts/even-layout.sh", this.ctx);
      this.close();
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

    // Ignore bare modifier presses
    if (["shift", "control", "alt", "platform", "cmd", "super", " capslock"].includes(key)) {
      return;
    }

    cx.stop_propagation();

    // Escape cancels prefix mode
    if (key === "escape" || ks === "ctrl-[") {
      if (ks === "ctrl-[") {
        this.close();
        run("tab.prev");
        return;
      }
      this.close();
      return;
    }

    // Enter resize mode (stays open until Esc)
    if (ks === "r" && !ctrl && !alt && !shift) {
      this.mode = "resize";
      cx.notify();
      return;
    }

    // Close the prefix overlay before running the target command
    this.close();

    // 1. Ctrl+Space again -> send literal Ctrl+Space to terminal
    if (ks === "ctrl-space" || (ctrl && key === "space")) {
      if (ctx.terminal) hc(["keys", ctx.terminal, "ctrl+space"]);
      return;
    }

    // 2. Indexed bindings: 1..9 (tab), shift+1..9 (agent), alt+1..9 (space)
    const shiftedDigit = SHIFTED_DIGITS[ch] ?? (shift && /^[1-9]$/.test(key) ? Number(key) : null);
    if (shiftedDigit && !ctrl && !alt) {
      const list = agents() ?? [];
      const target = list[shiftedDigit - 1];
      if (target?.address) run("agent.focus", { terminal: target.address });
      return;
    }
    if (/^[1-9]$/.test(key) && alt && !ctrl && !shift) {
      run("space.select", { index: Number(key) });
      return;
    }
    if (/^[1-9]$/.test(key) && !ctrl && !alt && !shift) {
      run("tab.select", { index: Number(key) });
      return;
    }

    // 3. Splits & Layout
    if (ks === "v" && !ctrl && !alt && !shift) {
      run("pane.split", { direction: "right", pane: ctx.pane || undefined });
      return;
    }
    if ((key === "-" && !shift && !ctrl && !alt) || ch === '"' || ks === 'shift-\'' || ks === '"') {
      run("pane.split", { direction: "down", pane: ctx.pane || undefined });
      return;
    }
    if ((ks === "z" && !ctrl && !alt && !shift) || ks === "ctrl-enter" || (ctrl && key === "enter")) {
      run("pane.zoom", { pane: ctx.pane || undefined });
      return;
    }
    if (ks === "=" && !shift && !ctrl && !alt) {
      runDetachedScript("~/.config/herdr/scripts/even-layout.sh", ctx);
      return;
    }
    if (ch === "+" || ks === "shift-=" || ks === "+") {
      this.resizeSidebar(16);
      return;
    }
    if (ch === "_" || ks === "shift--" || ks === "_") {
      this.resizeSidebar(-16);
      return;
    }
    if (ks === "b" && !ctrl && !alt && !shift) {
      run("layout.toggle", { id: "sidebar" });
      return;
    }

    // 4. Pane Navigation
    const navDirs = { h: "left", j: "down", k: "up", l: "right", left: "left", down: "down", up: "up", right: "right" };
    if (navDirs[key] && !ctrl && !alt && !shift) {
      run("pane.go", { direction: navDirs[key] });
      return;
    }
    if (navDirs[key] && ctrl && !alt && !shift) {
      runDetachedScript(`~/.config/herdr/scripts/smart-pane-nav.sh ${navDirs[key]} ${key}`, ctx);
      return;
    }

    // 5. Tab & Workspace Navigation / Creation / Rename / Close
    if (ks === "t" || ks === "ctrl-t") {
      openOverlay({
        mod: "prompt",
        kind: "dialog",
        width: 420,
        props: { title: "New Tab", command: { name: "tab.new", args: {} } },
      });
      return;
    }
    if (ks === "shift-t" || (key === "t" && shift && !ctrl && !alt)) {
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
      run("space.new");
      return;
    }
    if (ks === "shift-w" || (key === "w" && shift && !ctrl && !alt)) {
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
      run("mod.open", { name: "picker" });
      return;
    }
    if (ks === "shift-g" || (key === "g" && shift && !ctrl && !alt)) {
      openOverlay({
        mod: "worktree",
        kind: "dialog",
        width: 520,
        props: { space: ctx.space, folder: ctx.cwd, action: "new" },
      });
      return;
    }
    if (key === "]" && !ctrl && !alt && !shift) {
      runDetachedScript("~/.config/herdr/scripts/smart-tab-nav.sh next", ctx);
      return;
    }
    if (key === "[" && !ctrl && !alt && !shift) {
      runDetachedScript("~/.config/herdr/scripts/smart-tab-nav.sh prev", ctx);
      return;
    }
    if (ks === "ctrl-]" || (ctrl && key === "]")) {
      run("tab.next");
      return;
    }
    if (ks === "ctrl-n" || (ctrl && key === "n")) {
      run("space.next");
      return;
    }
    if (ks === "ctrl-p" || (ctrl && key === "p")) {
      run("space.prev");
      return;
    }
    if (ks === "ctrl-," || (ctrl && key === ",")) {
      run("agent.prev");
      return;
    }
    if (ks === "ctrl-." || (ctrl && key === ".")) {
      run("agent.next");
      return;
    }

    // 6. Close bindings (smart-close, confirm-close, close tab, close workspace)
    if (key === "backspace" && !ctrl && !alt && !shift) {
      runDetachedScript("~/.config/herdr/scripts/smart-close.sh", ctx);
      return;
    }
    if ((key === "backspace" && ctrl && !alt && !shift) || (ks === "x" && !ctrl && !alt && !shift)) {
      runDetachedScript("~/.config/herdr/scripts/confirm-close.py close", ctx);
      return;
    }
    if (key === "backspace" && shift && !ctrl && !alt) {
      run("tab.close", { id: ctx.tab || undefined });
      return;
    }
    if (key === "backspace" && alt && !ctrl && !shift) {
      run("space.close", { id: ctx.space || undefined });
      return;
    }

    // 7. Agent Launchers & Session Management (Pi split, Pi tab, Ask Agent, Resume Agent, Break Pane)
    if (ks === "c" && !ctrl && !alt && !shift) {
      runDetachedScript("~/.config/herdr/scripts/pi-split.sh", ctx);
      return;
    }
    if (ks === "shift-c" || (key === "c" && shift && !ctrl && !alt)) {
      openTerminalPopup("~/.config/herdr/scripts/pi-tab.sh", ctx, { width: 520, height: 180 });
      return;
    }
    if (ks === "ctrl-c" || (ctrl && key === "c" && !alt && !shift)) {
      if (ctx.terminal) hc(["keys", ctx.terminal, "ctrl+l"]);
      return;
    }
    if (ks === "ctrl-r" || (ctrl && key === "r" && !alt && !shift)) {
      runDetachedScript("~/src/dotfiles/bin/resume-agent", ctx);
      return;
    }
    if (ks === "shift-r" || (key === "r" && shift && !ctrl && !alt)) {
      runDetachedScript("~/.config/herdr/scripts/reload-config.sh", ctx);
      return;
    }
    if (ks === "a" && !ctrl && !alt && !shift) {
      openTerminalPopup("~/.config/herdr/scripts/ask-agent.sh", ctx, { width: 780, height: 420 });
      return;
    }
    if (ks === "shift-a" || (key === "a" && shift && !ctrl && !alt)) {
      openTerminalPopup("~/.config/herdr/scripts/ask-agent.sh", ctx, {
        width: 780,
        height: 420,
        env: { ASK_AGENT_CONTEXT: "1" },
      });
      return;
    }
    if (ks === "shift-m" || (key === "m" && shift && !ctrl && !alt)) {
      openTerminalPopup("~/.config/herdr/scripts/break-pane.sh", ctx, { width: 620, height: 180 });
      return;
    }

    // 8. Attention Jump & Focus History Jumplist
    if (key === "tab" && !shift && !ctrl && !alt) {
      runDetachedScript("~/.config/herdr/scripts/attention-jump.fish", ctx);
      return;
    }
    if ((key === "tab" && shift) || ks === "ctrl-o" || (ctrl && key === "o")) {
      runDetachedScript("~/.config/herdr/scripts/focus-jumplist.fish back", ctx);
      return;
    }
    if (ks === "ctrl-i" || (ctrl && key === "i")) {
      runDetachedScript("~/.config/herdr/scripts/focus-jumplist.fish forward", ctx);
      return;
    }

    // 9. Agent Pin, Unread, Panel Sort, Recap, Snooze, Settled, Settle Review
    if (ks === "p" && !ctrl && !alt && !shift) {
      if (ctx.terminal) {
        const curAgent = (agents() ?? []).find((a) => a.address === ctx.terminal);
        run("terminal.pin", { terminal: ctx.terminal, pinned: !curAgent?.pinned });
      }
      runDetachedScript("~/.config/herdr/scripts/agent-handler.py pin", ctx);
      return;
    }
    if (ks === "shift-p" || (key === "p" && shift && !ctrl && !alt)) {
      run("app.palette");
      return;
    }
    if (ks === "u" && !ctrl && !alt && !shift) {
      runDetachedScript("~/.config/herdr/scripts/agent-handler.py toggle", ctx);
      return;
    }
    if (ks === "w" && !ctrl && !alt && !shift) {
      const curSort = shared("agents.sort") ?? "priority";
      const nextSort = curSort === "priority" ? "grouped" : "priority";
      setShared("agents.sort", nextSort);
      notify({ title: `Agents panel: ${nextSort}`, timeout: 1500 });
      return;
    }
    if (ks === "i" && !ctrl && !alt && !shift) {
      openTerminalPopup("python3 ~/.config/herdr/scripts/herdr-recap.py picker", ctx, { width: 920, height: 620 });
      return;
    }
    if (ks === "shift-z" || (key === "z" && shift && !ctrl && !alt)) {
      runDetachedScript("~/.config/herdr/scripts/herdr-snooze.py action agent", ctx);
      return;
    }
    if (key === "z" && shift && alt && !ctrl) {
      runDetachedScript("~/.config/herdr/scripts/herdr-snooze.py action workspace", ctx);
      return;
    }
    if (ks === "alt-z" || (key === "z" && alt && !shift && !ctrl)) {
      openTerminalPopup("python3 ~/.config/herdr/scripts/herdr-snooze.py picker", ctx, {
        width: 820,
        height: 560,
        env: { HERDR_SNOOZE_SCREEN: "list", SNOOZE_SCREEN: "list" },
      });
      return;
    }
    if (ks === "ctrl-z" || (key === "z" && ctrl && !shift && !alt)) {
      const curSort = shared("agents.sort") ?? "priority";
      setShared("agents.sort", curSort === "priority" ? "grouped" : "priority");
      runDetachedScript("~/.config/herdr/scripts/herdr-snooze.py toggle", ctx);
      return;
    }
    if (ks === "alt-s" || (key === "s" && alt && !shift && !ctrl)) {
      openTerminalPopup("python3 ~/.config/herdr/scripts/herdr-settled.py picker", ctx, { width: 920, height: 620 });
      return;
    }
    if (ks === "alt-d" || (key === "d" && alt && !shift && !ctrl)) {
      runDetachedScript("~/.config/herdr/scripts/settle-review.sh", ctx);
      return;
    }

    // 10. Output Picker, Copy IDs, Copy Last Output, Edit Config, Search, Help, Settings
    if (ks === "o" && !ctrl && !alt && !shift) {
      runDetachedScript("~/.config/herdr/scripts/pick-selection.sh open", ctx);
      return;
    }
    if (ks === "shift-o" || (key === "o" && shift && !ctrl && !alt)) {
      run("agent.next");
      return;
    }
    if (ks === "y" && !ctrl && !alt && !shift) {
      runDetachedScript("~/.config/herdr/scripts/pick-selection.sh copy", ctx);
      return;
    }
    if (ks === "shift-y" || (key === "y" && shift && !ctrl && !alt)) {
      const id = ctx.pane || ctx.terminal;
      if (id) {
        exec("sh", ["-c", `printf '%s' ${JSON.stringify(id)} | pbcopy`]);
        notify({ title: "Copied pane id", body: id, timeout: 2000 });
      }
      return;
    }
    if (ks === "ctrl-y" || (key === "y" && ctrl && !shift && !alt)) {
      if (ctx.tab) {
        exec("sh", ["-c", `printf '%s' ${JSON.stringify(ctx.tab)} | pbcopy`]);
        notify({ title: "Copied tab id", body: ctx.tab, timeout: 2000 });
      }
      return;
    }
    if (ks === "shift-b" || (key === "b" && shift && !ctrl && !alt)) {
      runDetachedScript("hc-preset popup-open prompt-popups copy-last-output 20 1", ctx);
      return;
    }
    if (ks === "shift-e" || (key === "e" && shift && !ctrl && !alt)) {
      runDetachedScript("~/.config/herdr/scripts/edit-config.sh", ctx);
      return;
    }
    if ((ks === "e" && !shift && !ctrl && !alt) || ks === "shift-v" || (key === "v" && shift && !ctrl && !alt)) {
      if (ctx.terminal) {
        runDetachedScript(
          `tmp=$(mktemp -t herdr-scrollback.XXXXXX) && hc read ${ctx.terminal} --lines 2000 > "$tmp" && hc-preset pane split "${ctx.pane || ctx.terminal}" --direction right --focus && sleep 0.1`,
          ctx,
        );
      }
      return;
    }
    if (ks === "alt-l" || (key === "l" && alt && !ctrl && !shift)) {
      runDetachedScript("~/.config/herdr/scripts/refresh-screen.sh", ctx);
      return;
    }
    if (key === "space" && !ctrl && !alt && !shift) {
      run("terminal.search");
      return;
    }
    if (ch === "?" || ks === "shift-/" || ks === "?") {
      run("app.help");
      return;
    }
    if (ks === "s" && !ctrl && !alt && !shift) {
      run("app.settings");
    }
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
