// Automated OSC 52 callback command runner popup (ctrl-alt-shift-\) for Hammerspoon.

import { View, div } from "gpui-kit";
import { panes, focused, spaces, home, hc, openOverlay, closeOverlay, props } from "herdr";

export default class RunCommandCallback extends View {
  init(_props, cx) {
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
    const cwd = p?.cwd ?? f.cwd ?? sp?.folder ?? home();
    const env = [
      `HC_PRESET_BACKEND="hc"`,
      `HERDR_ACTIVE_PANE_ID=${JSON.stringify(p?.pane ?? f.pane ?? "")}`,
      `HERDR_ACTIVE_TAB_ID=${JSON.stringify(tabId)}`,
      `HERDR_ACTIVE_WORKSPACE_ID=${JSON.stringify(sp?.id ?? f.space ?? "")}`,
      `HC_TERMINAL_ID=${JSON.stringify(p?.terminal ?? f.terminal ?? "")}`,
    ].join(" ");

    cx.spawn(async () => {
      try {
        const cmd = `export PATH="$HOME/src/dotfiles/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" ${env}; ~/.config/herdr/scripts/run-command.sh --callback`;
        const r = await hc(["run", "--bg", "--rm", "--no-notify", "--json", "--cwd", cwd, "--", "sh", "-c", cmd]);
        closeOverlay(props().overlay);
        if (r.code === 0 && r.stdout) {
          const data = JSON.parse(r.stdout);
          if (data.address) {
            openOverlay({
              kind: "dialog",
              width: 680,
              height: 340,
              layout: {
                type: "column",
                children: [{ type: "block", content: { terminal: data.address } }],
              },
            });
          }
        }
      } catch {
        closeOverlay(props().overlay);
      }
    });
  }

  render() {
    return div().id("run-command-callback-loading").size_full();
  }
}
