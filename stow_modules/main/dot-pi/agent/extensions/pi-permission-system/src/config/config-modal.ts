import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import { type SettingItem, SettingsList } from "@earendil-works/pi-tui";
import type { Ruleset } from "../policy/rule.ts";
import type { CommandConfigStore } from "./config-store.ts";
import {
  DEFAULT_EXTENSION_CONFIG,
  type PermissionSystemExtensionConfig,
} from "./extension-config.ts";

interface PermissionSystemConfigController {
  config: CommandConfigStore;
  /** Precomputed global config file path. */
  configPath: string;
  /** Returns the composed config-layer ruleset for the active agent scope. */
  getActiveAgentConfigRules(): Ruleset;
  /** Reload configStore after writing global config.json. */
  reloadConfig?: () => void;
}

const KNOWN_SURFACES = new Set([
  "bash",
  "path",
  "path_read",
  "path_write",
  "external_directory",
  "external_directory_read",
  "external_directory_write",
  "mcp",
  "skill",
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
]);

export function mutateGlobalPermissionRule(
  configPath: string,
  grants: ReadonlyArray<{ surface: string; pattern: string }>,
  action: "allow" | "ask" | "deny" | "remove",
  reloadConfig?: () => void,
): { ok: boolean; message: string } {
  try {
    let raw: Record<string, any> = {};
    if (existsSync(configPath)) {
      raw = JSON.parse(readFileSync(configPath, "utf8"));
    }
    if (!raw.permission || typeof raw.permission !== "object") {
      raw.permission = { "*": "allow" };
    }
    const updated: string[] = [];
    for (const { surface, pattern } of grants) {
      const currentSurface = raw.permission[surface];
      if (action === "remove") {
        if (currentSurface && typeof currentSurface === "object") {
          delete currentSurface[pattern];
          updated.push(`removed ${surface}["${pattern}"]`);
        }
        continue;
      }
      if (!currentSurface || typeof currentSurface !== "object") {
        const fallback = typeof currentSurface === "string" ? currentSurface : "ask";
        raw.permission[surface] = { "*": fallback };
      }
      // Delete and re-insert so the new rule sits at the end (last-match-wins).
      delete raw.permission[surface][pattern];
      raw.permission[surface][pattern] = action;
      updated.push(`${surface}["${pattern}"] = ${action}`);
    }
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    reloadConfig?.();
    return { ok: true, message: updated.join(", ") };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

const ON_OFF = ["on", "off"];
const COMMAND_ARGUMENTS = [
  {
    value: "allow",
    label: "Allow a command or path globally",
    description: "/permission allow [surface] <pattern> (default surface: bash)",
  },
  {
    value: "ask",
    label: "Ask on a command or path globally",
    description: "/permission ask [surface] <pattern> (default surface: bash)",
  },
  {
    value: "deny",
    label: "Deny a command or path globally",
    description: "/permission deny [surface] <pattern> (default surface: bash)",
  },
  {
    value: "rm",
    label: "Remove a global rule",
    description: "/permission rm [surface] <pattern> (default surface: bash)",
  },
  {
    value: "show",
    label: "Show active settings",
    description: "Display the current permission-system config summary",
  },
  {
    value: "path",
    label: "Show config path",
    description: "Display the config.json path used by pi-permission-system",
  },
  {
    value: "reset",
    label: "Reset defaults",
    description: "Restore default yolo/logging settings and persist them",
  },
  {
    value: "help",
    label: "Show help",
    description: "Display command usage",
  },
] as const;
const USAGE_TEXT =
  "Usage: /permission [allow|ask|deny|rm [surface] <pattern> | show | path | reset | help]";

function cloneDefaultConfig(): PermissionSystemExtensionConfig {
  return {
    debugLog: DEFAULT_EXTENSION_CONFIG.debugLog,
    permissionReviewLog: DEFAULT_EXTENSION_CONFIG.permissionReviewLog,
    yoloMode: DEFAULT_EXTENSION_CONFIG.yoloMode,
    doublePressToConfirm: DEFAULT_EXTENSION_CONFIG.doublePressToConfirm,
  };
}

function toOnOff(value: boolean): string {
  return value ? "on" : "off";
}

function formatRulesSummary(rules: Ruleset): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- origin may be absent despite its type
  const configRules = rules.filter((r) => r.layer === "config" && r.origin);
  if (configRules.length === 0) return "";
  const formatted = configRules
    .map((r) => {
      const key =
        r.pattern === "*" ? r.surface : `${r.surface}["${r.pattern}"]`;
      return `${key}=${r.action} (${r.origin})`;
    })
    .join(", ");
  return `\n  rules: ${formatted}`;
}

function summarizeConfig(
  config: PermissionSystemExtensionConfig,
  rules?: Ruleset,
): string {
  const knobs = [
    `yoloMode=${toOnOff(config.yoloMode)}`,
    `permissionReviewLog=${toOnOff(config.permissionReviewLog)}`,
    `debugLog=${toOnOff(config.debugLog)}`,
  ].join(", ");
  const rulesSuffix = rules ? formatRulesSummary(rules) : "";
  return `${knobs}${rulesSuffix}`;
}

function buildSettingItems(
  config: PermissionSystemExtensionConfig,
): SettingItem[] {
  return [
    {
      id: "yoloMode",
      label: "YOLO mode",
      description:
        "Auto-approve ask-state permission checks, including subagent approval forwarding",
      currentValue: toOnOff(config.yoloMode),
      values: ON_OFF,
    },
    {
      id: "permissionReviewLog",
      label: "Permission review log",
      description:
        "Write permission request and decision audit events to the extension logs directory",
      currentValue: toOnOff(config.permissionReviewLog),
      values: ON_OFF,
    },
    {
      id: "debugLog",
      label: "Debug logging",
      description:
        "Write verbose permission-system diagnostics to the extension logs directory",
      currentValue: toOnOff(config.debugLog),
      values: ON_OFF,
    },
    {
      id: "doublePressToConfirm",
      label: "Double-press to confirm",
      description:
        "Require a confirming second press of a decision hotkey in the inline TUI permission dialog",
      currentValue: toOnOff(config.doublePressToConfirm),
      values: ON_OFF,
    },
  ];
}

function applySetting(
  config: PermissionSystemExtensionConfig,
  id: string,
  value: string,
): PermissionSystemExtensionConfig {
  switch (id) {
    case "yoloMode":
      return { ...config, yoloMode: value === "on" };
    case "permissionReviewLog":
      return { ...config, permissionReviewLog: value === "on" };
    case "debugLog":
      return { ...config, debugLog: value === "on" };
    case "doublePressToConfirm":
      return { ...config, doublePressToConfirm: value === "on" };
    default:
      return config;
  }
}

function syncSettingValues(
  settingsList: SettingsList,
  config: PermissionSystemExtensionConfig,
): void {
  settingsList.updateValue("yoloMode", toOnOff(config.yoloMode));
  settingsList.updateValue(
    "permissionReviewLog",
    toOnOff(config.permissionReviewLog),
  );
  settingsList.updateValue("debugLog", toOnOff(config.debugLog));
  settingsList.updateValue(
    "doublePressToConfirm",
    toOnOff(config.doublePressToConfirm),
  );
}

function getArgumentCompletions(
  argumentPrefix: string,
): Array<{ value: string; label: string; description: string }> | null {
  const normalized = argumentPrefix.trim().toLowerCase();
  if (normalized.includes(" ")) {
    return null;
  }

  const filtered = COMMAND_ARGUMENTS.filter((item) =>
    item.value.startsWith(normalized),
  );
  return filtered.length > 0 ? [...filtered] : null;
}

async function openSettingsModal(
  ctx: ExtensionCommandContext,
  controller: PermissionSystemConfigController,
): Promise<void> {
  const overlayOptions = {
    anchor: "center" as const,
    width: 82,
    maxHeight: "85%" as const,
    margin: 1,
  };

  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- ctx.ui.custom<void> is valid; rule does not allow void in generic fn call type args
  await ctx.ui.custom<void>(
    (_tui, _theme, _keybindings, done) => {
      let current = controller.config.current();
      const settingsList = new SettingsList(
        buildSettingItems(current),
        10,
        getSettingsListTheme(),
        (id, newValue) => {
          current = applySetting(current, id, newValue);
          controller.config.save(current, ctx);
          current = controller.config.current();
          syncSettingValues(settingsList, current);
        },
        () => done(),
      );

      return settingsList;
    },
    { overlay: true, overlayOptions },
  );
}

function parseRuleArgs(rest: string): { surface: string; pattern: string } | null {
  const trimmed = rest.trim();
  if (!trimmed) return null;
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace > 0) {
    const maybeSurface = trimmed.slice(0, firstSpace).trim();
    const remainder = trimmed.slice(firstSpace + 1).trim();
    if (KNOWN_SURFACES.has(maybeSurface) && remainder) {
      return { surface: maybeSurface, pattern: remainder.replace(/^["']|["']$/g, "") };
    }
  }
  return { surface: "bash", pattern: trimmed.replace(/^["']|["']$/g, "") };
}

function handleArgs(
  args: string,
  ctx: ExtensionCommandContext,
  controller: PermissionSystemConfigController,
): boolean {
  const raw = args.trim();
  const normalized = raw.toLowerCase();
  if (!normalized) {
    return false;
  }

  for (const verb of ["allow", "ask", "deny", "rm", "remove"] as const) {
    if (normalized === verb || normalized.startsWith(`${verb} `)) {
      const rest = raw.slice(verb.length).trim();
      const parsed = parseRuleArgs(rest);
      if (!parsed) {
        ctx.ui.notify(`Usage: /permission ${verb} [surface] <pattern>`, "warning");
        return true;
      }
      const action = verb === "rm" || verb === "remove" ? "remove" : verb;
      const res = mutateGlobalPermissionRule(
        controller.configPath,
        [parsed],
        action,
        controller.reloadConfig,
      );
      ctx.ui.notify(
        res.ok
          ? `Saved global rule: ${res.message}`
          : `Failed to update global rule: ${res.message}`,
        res.ok ? "info" : "error",
      );
      return true;
    }
  }

  if (normalized === "show" || normalized === "list") {
    const rules = controller.getActiveAgentConfigRules();
    ctx.ui.notify(
      `permission-system: ${summarizeConfig(controller.config.current(), rules)}`,
      "info",
    );
    return true;
  }

  if (normalized === "path") {
    ctx.ui.notify(`permission-system config: ${controller.configPath}`, "info");
    return true;
  }

  if (normalized === "reset") {
    controller.config.save(cloneDefaultConfig(), ctx);
    ctx.ui.notify("Permission system settings reset to defaults.", "info");
    return true;
  }

  if (normalized === "help") {
    ctx.ui.notify(USAGE_TEXT, "info");
    return true;
  }

  ctx.ui.notify(USAGE_TEXT, "warning");
  return true;
}

export function registerPermissionSystemCommand(
  pi: ExtensionAPI,
  controller: PermissionSystemConfigController,
): void {
  const handler = async (args: string, ctx: ExtensionCommandContext) => {
    if (handleArgs(args, ctx, controller)) {
      return;
    }

    if (!ctx.hasUI) {
      ctx.ui.notify(
        "/permission requires interactive TUI mode.",
        "warning",
      );
      return;
    }

    await openSettingsModal(ctx, controller);
  };

  pi.registerCommand("permission-system", {
    description:
      "Configure pi-permission-system rules (/permission allow|ask|deny|rm <pattern>) and settings",
    getArgumentCompletions,
    handler,
  });

  pi.registerCommand("permission", {
    description:
      "Manage global permission rules (/permission allow|ask|deny|rm [surface] <pattern> | show)",
    getArgumentCompletions,
    handler,
  });
}
