/**
 * Config — known tools list, persistence, binary checks
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Known TUI tools ───────────────────────────────────────────────────

export interface KnownTool {
  /** Short command name used as the /command slug */
  name: string;
  /** The actual binary/command to run */
  cmd: string;
}

export const KNOWN_TOOLS: KnownTool[] = [
  // Git
  { name: 'lazygit', cmd: 'lazygit' },
  { name: 'gitui', cmd: 'gitui' },
  { name: 'hunk', cmd: 'hunk' },
  // Editors
  { name: 'nvim', cmd: 'nvim' },
  { name: 'vim', cmd: 'vim' },
  { name: 'helix', cmd: 'hx' },
  { name: 'micro', cmd: 'micro' },
  // Monitors
  { name: 'htop', cmd: 'htop' },
  { name: 'btop', cmd: 'btop' },
  // Files
  { name: 'ranger', cmd: 'ranger' },
  { name: 'ncdu', cmd: 'ncdu' },
  { name: 'yazi', cmd: 'yazi' },
  { name: 'mc', cmd: 'mc' },
  // Docker
  { name: 'lazydocker', cmd: 'lazydocker' },
  // Remote
  { name: 'ssh', cmd: 'ssh' },
  { name: 'lazyssh', cmd: 'lazyssh' },
];

export const ISSUE_URL = 'https://github.com/earendil-works/pi-coding-agent/issues';

// ── Persistence ───────────────────────────────────────────────────────

export interface Config {
  enabled: string[];
  customs: Record<string, string>;
}

const CONFIG_FILENAME = 'tui-commands.json';

function getConfigPath(): string {
  const home = process.env.HOME || '/tmp';
  return join(home, '.pi/agent', CONFIG_FILENAME);
}

export function loadConfig(): Config {
  const path = getConfigPath();
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return { enabled: ['lazygit', 'nvim'], customs: {} };
  }
}

export function saveConfig(config: Config): void {
  const path = getConfigPath();
  const dir = join(process.env.HOME || '/tmp', '.pi/agent');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
}

// ── Binary check ──────────────────────────────────────────────────────

export function binaryExists(bin: string): boolean {
  try {
    execSync(`which "${bin}"`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
