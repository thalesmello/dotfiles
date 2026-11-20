// Attention navigation regressions: mocked app host and isolated fish scripts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const config = path.join(__dirname, '../stow_modules/main/dot-config');
const source = fs.readFileSync(path.join(config, 'herdr-app/mods/tabs-shortcuts/focus-history.js'), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export class', 'class') + '\nglobalThis.Controller = FocusHistoryController;';

function app(list, { snooze = {}, current = 'current' } = {}) {
  const calls = [], state = { 'agents.snooze': snooze };
  const ps = list.map(a => ({ pane: a.pane, terminal: a.address, tab: a.tab }));
  ps.push({ pane: 'current', terminal: 'current', tab: 'tab' });
  const context = vm.createContext({
    agents: () => list, checking: () => true,
    shared: k => state[k], setShared: (k, v) => { state[k] = v; },
    localStorage: { getItem: () => null, setItem() {} },
    run: (cmd, args) => calls.push([cmd, args]), notify() {},
  });
  vm.runInContext(source, context);
  const controller = new context.Controller();
  controller.focusJumplist = direction => { calls.push(['history', direction]); return false; };
  controller.attentionJump(100, [], ps, { terminal: current });
  return calls;
}
function agent(id, status, extra = {}) {
  return { address: id, pane: id, tab: 'tab', status, seq: 1, ...extra };
}
function focused(calls) {
  return calls.filter(([cmd]) => cmd === 'pane.focus').map(([, args]) => args.pane ?? args.terminal);
}

test('app attention wins over pinned idle; focused attention falls back to idle', () => {
  assert.deepEqual(focused(app([agent('idle', 'idle', { pinned: true }), agent('done', 'done')])), ['done']);
  assert.deepEqual(focused(app([agent('current', 'blocked'), agent('idle', 'idle')])), ['idle']);
  assert.deepEqual(focused(app([agent('current', 'blocked'), agent('done', 'done'), agent('idle', 'idle')])), ['done']);
});
test('app first idle is pinned then newest, skipping snoozed and missing panes', () => {
  const list = [agent('old', 'idle'), agent('new', 'idle', { seq: 8 }), agent('pin', 'idle', { pinned: true })];
  assert.deepEqual(focused(app(list)), ['pin']);
  assert.deepEqual(focused(app(list, { snooze: { panes: { pin: { until: 200 } } } })), ['new']);
  assert.deepEqual(focused(app([agent('missing', 'idle', { pane: null, address: null }), agent('new', 'idle')])), ['new']);
});
test('app first idle stays focused, remote targets remain qualified, empty uses history', () => {
  assert.deepEqual(app([agent('current', 'idle'), agent('other', 'idle')]), []);
  assert.deepEqual(focused(app([agent('devserver/t1', 'idle')])), ['devserver/t1']);
  assert.deepEqual(app([agent('busy', 'working')]), [['history', 'forward']]);
});

function fish(list) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-attention-'));
  try {
    // No live CLI, daemon, notification, or focus-history files are used.
    fs.writeFileSync(path.join(dir, 'herdr-lib.fish'), 
      'function herdr_ensure_focus_history; end\nfunction herdr_current_pane; echo current; end\n' +
      'function herdr_bin; echo $MOCK_BIN; end\nfunction herdr_notify; end\n' +
      'function herdr_focus_history_record; end\n');
    fs.copyFileSync(path.join(config, 'herdr/scripts/attention-jump.fish'), path.join(dir, 'attention-jump.fish'));
    fs.writeFileSync(path.join(dir, 'focus-jumplist.fish'), '#!/usr/bin/env fish\necho history-$argv[1] >> $MOCK_LOG\n', { mode: 0o755 });
    const bin = path.join(dir, 'herdr');
    fs.writeFileSync(bin, '#!/bin/sh\nif [ "$2" = list ]; then printf "%s" "$MOCK_AGENTS"; else echo "$*" >> "$MOCK_LOG"; fi\n', { mode: 0o755 });
    const log = path.join(dir, 'log');
    const result = spawnSync('fish', [path.join(dir, 'attention-jump.fish')], { encoding: 'utf8',
      env: { ...process.env, MOCK_BIN: bin, MOCK_LOG: log, MOCK_AGENTS: JSON.stringify({ agents: list }) } });
    assert.equal(result.status, 0, result.stderr);
    return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() : '';
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function legacy(id, status, extra = {}) {
  return { pane_id: id, agent_status: status, state_change_seq: 1, tokens: {}, ...extra };
}
test('TUI attention precedence, rotation, and idle fallback match app', () => {
  assert.equal(fish([legacy('idle', 'idle', { tokens: { um_pin: 'yes' } }), legacy('done', 'done')]), 'agent focus done');
  assert.equal(fish([legacy('current', 'blocked', { focused: true }), legacy('idle', 'idle')]), 'agent focus idle');
  assert.equal(fish([legacy('current', 'blocked', { focused: true }), legacy('done', 'done'), legacy('idle', 'idle')]), 'agent focus done');
});
test('TUI picks first idle by pin/recency, excludes snoozed and missing panes', () => {
  const list = [legacy('old', 'idle'), legacy('new', 'idle', { state_change_seq: 8 }), legacy('pin', 'idle', { tokens: { um_pin: 'yes' } })];
  assert.equal(fish(list), 'agent focus pin');
  list[2].tokens.herdr_snooze = 'z';
  assert.equal(fish(list), 'agent focus new');
  assert.equal(fish([legacy(null, 'idle'), legacy('idle', 'idle')]), 'agent focus idle');
});
test('TUI does not cycle idle conversations, and no idle uses forward history', () => {
  assert.equal(fish([legacy('current', 'idle', { focused: true }), legacy('other', 'idle')]), 'agent focus current');
  assert.equal(fish([legacy('busy', 'working')]), 'history-forward');
});
