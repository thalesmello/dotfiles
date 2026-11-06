/**
 * Runner — register /<name> commands and execute them with TUI suspend/resume
 */

import { spawnSync } from 'node:child_process';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const registeredNames = new Set<string>();

export function registerTuiCommand(pi: ExtensionAPI, name: string, command: string): void {
  if (registeredNames.has(name)) return;
  registeredNames.add(name);

  pi.registerCommand(name, {
    description: `Run: ${command}`,
    handler: async (args, ctx) => {
      if (ctx.mode !== 'tui') {
        ctx.ui.notify('Interactive commands require TUI mode', 'error');
        return;
      }

      const fullCmd = args ? `${command} ${args}` : command;

      await ctx.ui.custom((tui, _theme, _kb, done) => {
        tui.stop();
        process.stdout.write('\x1b[2J\x1b[H');

        const shell = process.env.SHELL || '/bin/sh';
        const result = spawnSync(shell, ['-c', fullCmd], {
          stdio: 'inherit',
          env: process.env,
        });

        tui.start();
        tui.requestRender(true);

        const msg =
          result.status === 0
            ? `"${fullCmd}" done`
            : `"${fullCmd}" exited with code ${result.status}`;
        ctx.ui.notify(msg, result.status === 0 ? 'info' : 'error');

        done(undefined);
        return { render: () => [], invalidate: () => {} };
      });
    },
  });
}

export function syncEnabled(
  pi: ExtensionAPI,
  enabled: string[],
  knownTools: { name: string; cmd: string }[],
  customs: Record<string, string>,
): void {
  for (const name of enabled) {
    const known = knownTools.find((t) => t.name === name);
    if (known) {
      registerTuiCommand(pi, name, known.cmd);
    } else if (customs[name]) {
      registerTuiCommand(pi, name, customs[name]);
    }
  }
}
