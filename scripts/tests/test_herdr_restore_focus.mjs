import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const path = new URL('../../stow_modules/main/dot-config/herdr-app/mods/spaces-reconnect/main.js', import.meta.url);
const source = fs.readFileSync(path, 'utf8')
  .replace(/^import\b[\s\S]*?from\s+"[^"]+";\s*/gm, '')
  .replace('export default class Spaces', 'class Spaces')
  .replace(/^export function /gm, 'function ') + '\nthis.Spaces = Spaces;';

for (const machine of ['', 'devserver/']) {
  const address = `${machine}t-restored`, pane = `${machine}p-restored`, tab = `${machine}tb-restored`, space = `${machine}sp-restored`;
  const state = {}, commands = [], notices = [];
  let current = 'previous', checking = false;
  const context = vm.createContext({
    View: class {}, console,
    checking: () => checking,
    shared: key => state[key], setShared: (key, value) => { state[key] = value; },
    focused: () => ({ terminal: current }),
    spaces: () => [{ id: space, tabs: [{ id: tab }] }],
    terminals: () => [{ address, state: 'live', labels: { 'settled.focus_token': 'request-1', 'settled.focus_at_ms': '100' } }],
    run: (name, args) => commands.push([name, args]), notify: args => notices.push(args),
  });
  vm.runInContext(source, context);
  const panel = new context.Spaces();
  panel.focusRestoredChats({}, [], 100);
  assert.equal(commands.length, 0, 'do not focus before this screen adopts the committed Core pane');
  const panes = [{ pane, terminal: address, tab }];
  panel.focusRestoredChats({}, panes, 101);
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [
    ['space.select', { id: space }], ['tab.select', { id: tab }], ['pane.focus', { pane }],
  ], 'use fully qualified app IDs for local and remote focus');
  assert.equal(state['settled.focusedTokens'], undefined, 'wait for real focus confirmation');
  current = address;
  panel.focusRestoredChats({}, panes, 102);
  panel.focusRestoredChats({}, panes, 103);
  assert.equal(commands.length, 3, 'acknowledged restores do not keep stealing focus');
  assert.deepEqual([...state['settled.focusedTokens']], ['request-1']);
  assert.equal(notices.length, 0);

  const fresh = new context.Spaces();
  fresh.focusRestoredChats({}, panes, 104);
  assert.equal(commands.length, 3, 'hot reload/restart respects persisted consumed requests');
  checking = true;
  delete state['settled.focusedTokens'];
  fresh.focusRestoredChats({}, panes, 105);
  assert.equal(commands.length, 3, 'mod checks must not focus user terminals');
  checking = false;
  current = 'previous';
  const failed = new context.Spaces();
  failed.focusRestoredChats({}, panes, 106);
  failed.focusRestoredChats({}, panes, 3000);
  assert.equal(notices.length, 1, 'bounded failed focus offers a targeted retry instead of stealing focus forever');
  assert.equal(notices[0].action.args.terminal, address);
}
console.log('Local and remote restored-chat focus, adoption delay, acknowledgement, and reload assertions passed');
