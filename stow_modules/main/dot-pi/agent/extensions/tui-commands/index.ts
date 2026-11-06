/**
 * TUI Commands — interactive / command registry with binary checks
 *
 * Register any executable as a /command that suspends pi's TUI while it runs.
 * Persists across sessions. Add commands from within pi itself.
 *
 * Usage:
 *   /tuicmd                 Open interactive manager
 *   /tuicmd add <n> [cmd]   Quick-register a command
 *   /tuicmd rm <n>          Remove a command
 *   /lazygit                (once enabled) runs lazygit
 *
 * Install:
 *   pi install git:github.com/<user>/pi-extensions
 *
 * Config: ~/.pi/agent/tui-commands.json
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { KNOWN_TOOLS, loadConfig, saveConfig, binaryExists } from './config.js';
import { registerTuiCommand, syncEnabled } from './runner.js';
import { showManager } from './ui.js';

export default function (pi: ExtensionAPI) {
  let config = loadConfig();
  syncEnabled(pi, config.enabled, KNOWN_TOOLS, config.customs);

  pi.registerCommand('tuicmd', {
    description: 'Manage TUI commands (interactive UI)',
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase();

      // ── Quick subcommands ──────────────────────────────────────

      if (sub === 'add') {
        const name = parts[1];
        if (!name) {
          ctx.ui.notify('Usage: /tuicmd add <name> [command]', 'error');
          return;
        }
        const cmd = parts.slice(2).join(' ').trim() || name;
        if (!/^[a-z0-9_-]+$/.test(name)) {
          ctx.ui.notify('Name must be alphanumeric with - or _', 'error');
          return;
        }
        if (KNOWN_TOOLS.some((t) => t.name === name)) {
          ctx.ui.notify(`${name} is a known tool — enable via /tuicmd UI`, 'warning');
          return;
        }
        config = loadConfig();
        config.customs[name] = cmd;
        if (!config.enabled.includes(name)) config.enabled.push(name);
        saveConfig(config);
        registerTuiCommand(pi, name, cmd);
        ctx.ui.notify(`/${name} → ${cmd} registered`, 'info');
        return;
      }

      if (sub === 'rm' || sub === 'remove') {
        const name = parts[1];
        if (!name) {
          ctx.ui.notify('Usage: /tuicmd rm <name>', 'error');
          return;
        }
        config = loadConfig();
        config.enabled = config.enabled.filter((e) => e !== name);
        delete config.customs[name];
        saveConfig(config);
        ctx.ui.notify(`Removed ${name}. /reload to fully clear.`, 'info');
        return;
      }

      if (
        sub === 'help' ||
        sub === '--help' ||
        sub === '-h' ||
        (sub && sub !== 'add' && sub !== 'rm' && sub !== 'remove')
      ) {
        ctx.ui.notify(
          '/tuicmd — open interactive UI\n' +
            '/tuicmd add <name> [cmd] — quick-register\n' +
            '/tuicmd rm <name> — remove',
          'info',
        );
        return;
      }

      // ── Interactive UI ──────────────────────────────────────────

      if (ctx.mode !== 'tui') {
        ctx.ui.notify('/tuicmd requires TUI mode', 'error');
        return;
      }

      config = loadConfig();
      await showManager(pi, ctx, KNOWN_TOOLS, config);
    },
  });
}
