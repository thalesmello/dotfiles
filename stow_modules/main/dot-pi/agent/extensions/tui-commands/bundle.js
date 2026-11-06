// dotfiles/stow_modules/main/dot-pi/agent/extensions/tui-commands/config.ts
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
var KNOWN_TOOLS = [
  { name: "lazygit", cmd: "lazygit" },
  { name: "gitui", cmd: "gitui" },
  { name: "hunk", cmd: "hunk" },
  { name: "nvim", cmd: "nvim" },
  { name: "vim", cmd: "vim" },
  { name: "helix", cmd: "hx" },
  { name: "micro", cmd: "micro" },
  { name: "htop", cmd: "htop" },
  { name: "btop", cmd: "btop" },
  { name: "ranger", cmd: "ranger" },
  { name: "ncdu", cmd: "ncdu" },
  { name: "yazi", cmd: "yazi" },
  { name: "mc", cmd: "mc" },
  { name: "lazydocker", cmd: "lazydocker" },
  { name: "ssh", cmd: "ssh" },
  { name: "lazyssh", cmd: "lazyssh" }
];
var ISSUE_URL = "https://github.com/earendil-works/pi-coding-agent/issues";
var CONFIG_FILENAME = "tui-commands.json";
function getConfigPath() {
  const home = process.env.HOME || "/tmp";
  return join(home, ".pi/agent", CONFIG_FILENAME);
}
function loadConfig() {
  const path = getConfigPath();
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { enabled: ["lazygit", "nvim"], customs: {} };
  }
}
function saveConfig(config) {
  const path = getConfigPath();
  const dir = join(process.env.HOME || "/tmp", ".pi/agent");
  if (!existsSync(dir))
    mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + `
`);
}
function binaryExists(bin) {
  try {
    execSync(`which "${bin}"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/tui-commands/runner.ts
import { spawnSync } from "node:child_process";
var registeredNames = new Set;
function registerTuiCommand(pi, name, command) {
  if (registeredNames.has(name))
    return;
  registeredNames.add(name);
  pi.registerCommand(name, {
    description: `Run: ${command}`,
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("Interactive commands require TUI mode", "error");
        return;
      }
      const fullCmd = args ? `${command} ${args}` : command;
      await ctx.ui.custom((tui, _theme, _kb, done) => {
        tui.stop();
        process.stdout.write("\x1B[2J\x1B[H");
        const shell = process.env.SHELL || "/bin/sh";
        const result = spawnSync(shell, ["-c", fullCmd], {
          stdio: "inherit",
          env: process.env
        });
        tui.start();
        tui.requestRender(true);
        const msg = result.status === 0 ? `"${fullCmd}" done` : `"${fullCmd}" exited with code ${result.status}`;
        ctx.ui.notify(msg, result.status === 0 ? "info" : "error");
        done(undefined);
        return { render: () => [], invalidate: () => {} };
      });
    }
  });
}
function syncEnabled(pi, enabled, knownTools, customs) {
  for (const name of enabled) {
    const known = knownTools.find((t) => t.name === name);
    if (known) {
      registerTuiCommand(pi, name, known.cmd);
    } else if (customs[name]) {
      registerTuiCommand(pi, name, customs[name]);
    }
  }
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/tui-commands/ui.ts
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { SettingsList } from "@earendil-works/pi-tui";
function buildItems(knownTools, config, availability) {
  const enabledSet = new Set(config.enabled);
  const items = [];
  items.push({
    id: "__header_known",
    label: "─── Known Tools ───",
    currentValue: "",
    values: []
  });
  for (const tool of knownTools) {
    const avail = availability.get(tool.name) ?? false;
    const on = enabledSet.has(tool.name);
    items.push({
      id: tool.name,
      label: `${tool.name}  ${avail ? "✓" : "✗"}`,
      currentValue: on ? "ON" : "OFF",
      values: ["OFF", "ON"],
      description: avail ? `${tool.cmd} found on PATH` : `"${tool.cmd}" not found on PATH`
    });
  }
  const customNames = Object.keys(config.customs);
  if (customNames.length > 0) {
    items.push({
      id: "__header_custom",
      label: "─── Custom ───",
      currentValue: "",
      values: []
    });
    for (const name of customNames) {
      const cmd = config.customs[name];
      const bin = cmd.split(/\s+/)[0];
      const avail = binaryExists(bin);
      const on = enabledSet.has(name);
      items.push({
        id: `__custom:${name}`,
        label: `${name}  ${avail ? "✓" : "✗"}`,
        currentValue: on ? "ON" : "OFF",
        values: ["OFF", "ON"],
        description: cmd
      });
    }
  }
  return items;
}
function extractName(id) {
  return id.startsWith("__custom:") ? id.slice(9) : id;
}
function lookupBin(name, config, knownTools) {
  const known = knownTools.find((t) => t.name === name);
  if (known)
    return known.name;
  const custom = config.customs[name];
  if (custom)
    return custom.split(/\s+/)[0];
  return;
}
async function showManager(pi, ctx, knownTools, config) {
  const availability = new Map(knownTools.map((t) => [t.name, binaryExists(t.name)]));
  await ctx.ui.custom((tui, theme, _kb, done) => {
    const enabledSet = new Set(config.enabled);
    const items = buildItems(knownTools, config, availability);
    const settingsList = new SettingsList(items, 20, getSettingsListTheme(), (id, newValue) => {
      if (id.startsWith("__header_"))
        return;
      if (newValue !== "ON" && newValue !== "OFF")
        return;
      const name = extractName(id);
      const bin = lookupBin(name, config, knownTools);
      if (newValue === "ON") {
        if (bin && !binaryExists(bin)) {
          ctx.ui.notify(`${name} not found on PATH. Install it or report at ${ISSUE_URL}`, "error");
          return;
        }
        enabledSet.add(name);
        const known = knownTools.find((t) => t.name === name);
        const cmd = known ? known.cmd : config.customs[name];
        if (cmd)
          registerTuiCommand(pi, name, cmd);
      } else {
        enabledSet.delete(name);
      }
      config.enabled = Array.from(enabledSet);
      saveConfig(config);
      settingsList.updateValue(id, newValue);
      tui.requestRender();
    }, () => done(), { enableSearch: true });
    return {
      render: (w) => {
        const lines = [];
        lines.push(theme.fg("accent", theme.bold("TUI Commands")));
        lines.push("");
        lines.push(...settingsList.render(w));
        lines.push("");
        lines.push(theme.fg("dim", "✓ installed  ✗ not found  enter  toggle  /  search  esc  close"));
        lines.push(theme.fg("dim", "add custom: /tuicmd add <name> [command]"));
        return lines;
      },
      invalidate: () => settingsList.invalidate(),
      handleInput: (d) => {
        settingsList.handleInput?.(d);
        tui.requestRender();
      }
    };
  });
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/tui-commands/index.ts
function tui_commands_default(pi) {
  let config = loadConfig();
  syncEnabled(pi, config.enabled, KNOWN_TOOLS, config.customs);
  pi.registerCommand("tuicmd", {
    description: "Manage TUI commands (interactive UI)",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase();
      if (sub === "add") {
        const name = parts[1];
        if (!name) {
          ctx.ui.notify("Usage: /tuicmd add <name> [command]", "error");
          return;
        }
        const cmd = parts.slice(2).join(" ").trim() || name;
        if (!/^[a-z0-9_-]+$/.test(name)) {
          ctx.ui.notify("Name must be alphanumeric with - or _", "error");
          return;
        }
        if (KNOWN_TOOLS.some((t) => t.name === name)) {
          ctx.ui.notify(`${name} is a known tool — enable via /tuicmd UI`, "warning");
          return;
        }
        config = loadConfig();
        config.customs[name] = cmd;
        if (!config.enabled.includes(name))
          config.enabled.push(name);
        saveConfig(config);
        registerTuiCommand(pi, name, cmd);
        ctx.ui.notify(`/${name} → ${cmd} registered`, "info");
        return;
      }
      if (sub === "rm" || sub === "remove") {
        const name = parts[1];
        if (!name) {
          ctx.ui.notify("Usage: /tuicmd rm <name>", "error");
          return;
        }
        config = loadConfig();
        config.enabled = config.enabled.filter((e) => e !== name);
        delete config.customs[name];
        saveConfig(config);
        ctx.ui.notify(`Removed ${name}. /reload to fully clear.`, "info");
        return;
      }
      if (sub === "help" || sub === "--help" || sub === "-h" || sub && sub !== "add" && sub !== "rm" && sub !== "remove") {
        ctx.ui.notify(`/tuicmd — open interactive UI
` + `/tuicmd add <name> [cmd] — quick-register
` + "/tuicmd rm <name> — remove", "info");
        return;
      }
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/tuicmd requires TUI mode", "error");
        return;
      }
      config = loadConfig();
      await showManager(pi, ctx, KNOWN_TOOLS, config);
    }
  });
}
export {
  tui_commands_default as default
};
