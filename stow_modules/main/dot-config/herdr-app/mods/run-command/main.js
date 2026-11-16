// Interactive command runner popup (ctrl-alt-shift-;) for herdr-app.

import { View, div } from "gpui-kit";
import { panes, focused, spaces, home, hc, openOverlay, closeOverlay, props } from "herdr";

export default class RunCommand extends View {
  init(_props, cx) {
    if (!props()?.overlay) return;
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
    const rawTerm = p?.terminal ?? f.terminal ?? "";
    const termMachine = rawTerm.includes("/") ? rawTerm.split("/")[0] : "";
    const machine = sp?.machine ?? p?.machine ?? f.machine ?? termMachine ?? "";
    const localTerm = machine && rawTerm.startsWith(`${machine}/`) ? rawTerm.slice(machine.length + 1) : rawTerm;
    const cwd = p?.cwd ?? f.cwd ?? sp?.folder ?? (machine ? "" : home());
    const env = [
      `HC_PRESET_BACKEND="hc"`,
      `HERDR_ACTIVE_PANE_ID=${JSON.stringify(p?.pane ?? f.pane ?? localTerm ?? "")}`,
      `HERDR_ACTIVE_TAB_ID=${JSON.stringify(tabId)}`,
      `HERDR_ACTIVE_WORKSPACE_ID=${JSON.stringify(sp?.id ?? f.space ?? "")}`,
      `HERDR_ACTIVE_MACHINE=${JSON.stringify(machine)}`,
      `HC_TERMINAL_ID=${JSON.stringify(localTerm)}`,
    ].join(" ");

    cx.spawn(async () => {
      try {
        const cmd = `export PATH="$HOME/src/dotfiles/bin:$HOME/.local/bin:/opt/homebrew/bin:/opt/chef/embedded/bin:/usr/local/bin:$PATH" ${env}; ~/.config/herdr/scripts/run-command.sh`;
        const args = ["run", "--bg", "--rm", "--no-notify", "--json"];
        if (machine) {
          args.push("--on", machine);
          if (cwd) args.push("--cwd", cwd);
        } else {
          args.push("--cwd", cwd || home());
        }
        args.push("--", "sh", "-c", cmd);
        const r = await hc(args);
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
    return div().id("run-command-loading").size_full();
  }
}
