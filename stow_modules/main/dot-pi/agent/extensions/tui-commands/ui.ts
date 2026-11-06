/**
 * UI — interactive SettingsList for enabling/disabling TUI commands
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getSettingsListTheme } from '@earendil-works/pi-coding-agent';
import { type SettingItem, SettingsList } from '@earendil-works/pi-tui';
import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { type Config, type KnownTool, binaryExists, saveConfig, ISSUE_URL } from './config.js';
import { registerTuiCommand } from './runner.js';

// ── Build SettingItems from config + availability map ─────────────────

export function buildItems(
  knownTools: KnownTool[],
  config: Config,
  availability: Map<string, boolean>,
): SettingItem[] {
  const enabledSet = new Set(config.enabled);
  const items: SettingItem[] = [];

  items.push({
    id: '__header_known',
    label: '─── Known Tools ───',
    currentValue: '',
    values: [],
  });

  for (const tool of knownTools) {
    const avail = availability.get(tool.name) ?? false;
    const on = enabledSet.has(tool.name);
    items.push({
      id: tool.name,
      label: `${tool.name}  ${avail ? '✓' : '✗'}`,
      currentValue: on ? 'ON' : 'OFF',
      values: ['OFF', 'ON'],
      description: avail ? `${tool.cmd} found on PATH` : `"${tool.cmd}" not found on PATH`,
    });
  }

  const customNames = Object.keys(config.customs);
  if (customNames.length > 0) {
    items.push({
      id: '__header_custom',
      label: '─── Custom ───',
      currentValue: '',
      values: [],
    });
    for (const name of customNames) {
      const cmd = config.customs[name];
      const bin = cmd.split(/\s+/)[0];
      const avail = binaryExists(bin);
      const on = enabledSet.has(name);
      items.push({
        id: `__custom:${name}`,
        label: `${name}  ${avail ? '✓' : '✗'}`,
        currentValue: on ? 'ON' : 'OFF',
        values: ['OFF', 'ON'],
        description: cmd,
      });
    }
  }

  return items;
}

// ── Helpers ───────────────────────────────────────────────────────────

function extractName(id: string): string {
  return id.startsWith('__custom:') ? id.slice(9) : id;
}

function lookupBin(name: string, config: Config, knownTools: KnownTool[]): string | undefined {
  const known = knownTools.find((t) => t.name === name);
  if (known) return known.name;
  const custom = config.customs[name];
  if (custom) return custom.split(/\s+/)[0];
  return undefined;
}

// ── Render the interactive manager ────────────────────────────────────

export async function showManager(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  knownTools: KnownTool[],
  config: Config,
): Promise<void> {
  const availability = new Map(knownTools.map((t) => [t.name, binaryExists(t.name)]));

  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    const enabledSet = new Set(config.enabled);
    const items = buildItems(knownTools, config, availability);

    const settingsList = new SettingsList(
      items,
      20,
      getSettingsListTheme(),
      (id, newValue) => {
        if (id.startsWith('__header_')) return;
        if (newValue !== 'ON' && newValue !== 'OFF') return;

        const name = extractName(id);
        const bin = lookupBin(name, config, knownTools);

        if (newValue === 'ON') {
          if (bin && !binaryExists(bin)) {
            ctx.ui.notify(
              `${name} not found on PATH. Install it or report at ${ISSUE_URL}`,
              'error',
            );
            return;
          }
          enabledSet.add(name);
          const known = knownTools.find((t) => t.name === name);
          const cmd = known ? known.cmd : config.customs[name];
          if (cmd) registerTuiCommand(pi, name, cmd);
        } else {
          enabledSet.delete(name);
        }

        config.enabled = Array.from(enabledSet);
        saveConfig(config);
        settingsList.updateValue(id, newValue);
        tui.requestRender();
      },
      () => done(),
      { enableSearch: true },
    );

    return {
      render: (w: number) => {
        const lines: string[] = [];
        lines.push(theme.fg('accent', theme.bold('TUI Commands')));
        lines.push('');
        lines.push(...settingsList.render(w));
        lines.push('');
        lines.push(
          theme.fg('dim', '✓ installed  ✗ not found  enter  toggle  /  search  esc  close'),
        );
        lines.push(theme.fg('dim', 'add custom: /tuicmd add <name> [command]'));
        return lines;
      },
      invalidate: () => settingsList.invalidate(),
      handleInput: (d: string) => {
        settingsList.handleInput?.(d);
        tui.requestRender();
      },
    };
  });
}
