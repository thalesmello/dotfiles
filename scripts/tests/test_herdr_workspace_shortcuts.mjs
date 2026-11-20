// Mock command delivery. Never sends keys or closes a real pane.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const home = new URL('../../stow_modules/main/dot-config/herdr-app/', import.meta.url);
const keys = JSON.parse(fs.readFileSync(new URL('keys.json', home)));
const layout = JSON.parse(fs.readFileSync(new URL('layouts/transition.json', home)));
const prefix = fs.readFileSync(new URL('mods/prefix/main.js', home), 'utf8');
const sidebar = fs.readFileSync(new URL('mods/spaces-reconnect/main.js', home), 'utf8');
const source = fs.readFileSync(new URL('mods/tabs-shortcuts/main.js', home), 'utf8')
  .replace(/^import[^\n]+\n/gm, '').replace('export default class Tabs', 'class Tabs');
const find = (node, id) => node.id === id ? node : (node.children ?? []).map(n => find(n, id)).find(Boolean);
assert.equal(find(layout, 'tabs').content.mod, 'tabs-shortcuts');
assert.notEqual(find(layout, 'tabs').hidden, true);
for (const section of Object.values(keys)) {
  for (const action of Object.values(section)) {
    assert.ok(typeof action !== 'string' || !action.startsWith('spaces-reconnect.'), 'no key depends on sidebar command delivery');
  }
}
for (const [letter, direction] of [['h','left'], ['j','down'], ['k','up'], ['l','right']]) {
  for (const modifiers of ['cmd-ctrl', 'ctrl-alt']) {
    assert.equal(keys.global[`${modifiers}-${letter}`], `tabs-shortcuts.pane_${direction}`);
  }
}
assert.equal(keys.global['cmd-w'], 'tabs-shortcuts.smart_close');
assert.equal(keys.global['cmd-['], 'tabs-shortcuts.focus_back');
assert.equal(keys.global['cmd-]'], 'tabs-shortcuts.focus_forward');
assert.equal(keys.global['ctrl-tab'], 'agent.next');
assert.equal(keys.global['ctrl-shift-tab'], 'agent.prev');
assert.equal(keys['layout:transition']['ctrl-tab'], 'agent-render.next');
assert.equal(keys['layout:transition']['ctrl-shift-tab'], 'agent-render.prev');
for (const section of ['terminal', 'layout:transition']) {
  assert.equal(keys[section]['cmd-['], undefined, 'history shortcut is not overridden');
  assert.equal(keys[section]['cmd-]'], undefined, 'history shortcut is not overridden');
}
assert.ok(!prefix.includes('run("spaces-reconnect.'));
assert.ok(!sidebar.includes('await nextCommand()'), 'sidebar no longer dispatches keyboard commands');
assert.ok(!sidebar.includes('this.syncFocusHistory(now, sp, ps, focused())'), 'only one history recorder');

const actions = {
  smart_close: ['close'], pane_left: ['pane', 'left', 'h'], pane_down: ['pane', 'down', 'j'],
  pane_up: ['pane', 'up', 'k'], pane_right: ['pane', 'right', 'l'],
  tab_next: ['tab', 'next'], tab_prev: ['tab', 'prev'], tab_new: ['new'],
  scroll_top: ['scroll', 'top'], scroll_bottom: ['scroll', 'bottom'],
  focus_back: ['history', 'focus_back'], focus_forward: ['history', 'focus_forward'],
  attention_jump: ['history', 'attention_jump'],
};
for (const [command, expected] of Object.entries(actions)) {
  for (const checking of [false, true]) {
    const calls = [], queue = [command];
    const context = vm.createContext({
      View: class {}, ScrollHandle: { new: () => ({}) },
      localStorage: { getItem: () => null }, checking: () => checking,
      nextCommand: () => queue.length ? Promise.resolve(queue.shift()) : new Promise(() => {}),
      smartClose: () => calls.push(['close']), smartPaneNav: (...args) => calls.push(['pane', ...args]),
      smartTabNav: dir => calls.push(['tab', dir]), openNewTabPrompt: () => calls.push(['new']),
      smartScroll: to => calls.push(['scroll', to]),
      FocusHistoryController: class {
        init() {}
        handle(cmd) { if (!['focus_back', 'focus_forward', 'attention_jump'].includes(cmd)) return false;
          calls.push(['history', cmd]); return true; }
      },
    });
    vm.runInContext(source + '\nthis.TabClass = Tabs;', context);
    const tab = new context.TabClass();
    tab.init({}, { spawn: task => task() });
    await new Promise(setImmediate);
    assert.deepEqual(calls, checking ? [] : [expected], command);
  }
}
// Exercise the real extracted history controller, not just its dispatcher.
const historySource = fs.readFileSync(new URL('mods/tabs-shortcuts/focus-history.js', home), 'utf8')
  .replace(/^import[^\n]+\n/gm, '').replace('export class FocusHistoryController', 'class FocusHistoryController');
const historyState = { focusHistory: { journal: ['p1', 'p2'], seq: 2, walk: [], walkState: null } };
let focus = { pane: 'p2', terminal: 't2', tab: 'tb1' }, tick;
const historyCalls = [], writes = [], notifications = [];
const historyContext = vm.createContext({
  console, checking: () => false,
  spaces: () => [{ id: 'sp1', active: true, tabs: [{ id: 'tb1', active: true }] }],
  panes: () => [1, 2].map(i => ({ pane: `p${i}`, terminal: `t${i}`, tab: 'tb1' })),
  focused: () => focus, agents: () => [],
  shared: key => historyState[key] ?? null, setShared: (key, value) => { historyState[key] = value; },
  localStorage: { getItem: () => null, setItem: (key, value) => writes.push([key, value]) },
  run: (cmd, args) => { historyCalls.push([cmd, args]);
    if (cmd === 'pane.focus') focus = { pane: args.pane, terminal: args.pane.replace('p', 't'), tab: 'tb1' }; },
  exec: () => Promise.resolve({ code: 0 }), home: () => '/tmp',
  notify: notification => notifications.push(notification),
});
vm.runInContext(historySource + '\nthis.Controller = FocusHistoryController;', historyContext);
const history = new historyContext.Controller();
history.init({ timer: { every: (interval, callback) => { assert.equal(interval, 250); tick = callback; } } });
assert.equal(history.focusHistory.journal.join(','), 'p1,p2', 'history migrated from shared sidebar state');
assert.equal(history.handle('focus_back'), true);
assert.equal(historyCalls.at(-1)[1].pane, 'p1');
assert.equal(notifications.length, 0, 'successful backward navigation is silent');
assert.equal(history.handle('focus_back'), true);
assert.equal(notifications.at(-1).title, 'Start of focus history');
notifications.length = 0;
assert.equal(history.handle('focus_forward'), true);
assert.equal(historyCalls.at(-1)[1].pane, 'p2');
assert.equal(notifications.length, 0, 'successful forward navigation is silent');
assert.equal(history.handle('focus_forward'), true);
assert.equal(notifications.at(-1).title, 'End of focus history');
tick(); // Acknowledge the asynchronous forward focus before another change.
focus = { pane: 'p1', terminal: 't1', tab: 'tb1' }; tick();
assert.equal(history.focusHistory.journal.at(-1), 'p1');
assert.ok(writes.length > 0, 'history persists without a sidebar instance');
assert.equal(history.handle('unknown'), false);
console.log('Workspace shortcuts: sidebar-independent bindings, visible host, dispatch, history migration/navigation and check guards passed');
