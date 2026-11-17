import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Describe the actual render tree without needing a GPUI window.
function element() {
  const node = { items: [], handlers: {} };
  let proxy;
  proxy = new Proxy(node, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'child') return (child) => { target.items.push(child); return proxy; };
      if (key === 'children') return (children) => { target.items.push(...children); return proxy; };
      if (key === 'when') return (condition, apply) => condition ? apply(proxy) : proxy;
      if (key === 'id') return (id) => { target.elementId = id; return proxy; };
      if (key === 'on_click') return (callback) => { target.handlers.click = callback; return proxy; };
      return () => proxy;
    },
  });
  return proxy;
}
function find(root, id) {
  if (root?.elementId === id) return root;
  for (const child of root?.items ?? []) {
    const found = typeof child === 'object' && find(child, id);
    if (found) return found;
  }
  return null;
}
function loadMod(name, className, host) {
  const file = new URL(`../../stow_modules/main/dot-config/herdr-app/mods/${name}/main.js`, import.meta.url);
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import[\s\S]*?from ["'][^"']+["'];\n/gm, '')
    .replace(`export default class ${className}`, `class ${className}`);
  const context = vm.createContext({ View: class {}, console, ...host });
  vm.runInContext(`${source}\nthis.Mod = ${className};`, context);
  return context.Mod;
}

const state = new Map();
const storage = new Map();
const colors = { chrome: '#222222', border: '#333333', dim: '#888888', foreground: '#ffffff', working: '#ffaa00', idle: '#888888', done: '#00ffaa', blocked: '#ff4444' };
const fixture = (address, status, seq) => ({
  address, pane: `p-${address}`, tab: `tab-${address}`, space: 'space1', space_name: 'Test',
  status, seq, title: address, program: { key: 'pi', name: 'Pi' }, pinned: false, focused: false,
});
let list = [fixture('done', 'done', 40), fixture('idle', 'idle', 30), fixture('blocked', 'blocked', 20), fixture('working', 'working', 10)];
let focus = null;
let rawTerminals = [];
let order;
const cx = { notify() {}, stop_propagation() {}, timer: { every() {} } };
const host = {
  div: element, h_flex: element, v_flex: element, svg: element, image: element,
  props: () => ({}), theme: () => colors, checking: () => true,
  agents: () => list, terminals: () => rawTerminals, panes: () => [], spaces: () => [], focused: () => focus,
  layout: () => ({ id: 'sidebar', size: { px: 268 } }), window: () => ({ platform: 'macos' }),
  shared: (key) => state.get(key), setShared: (key, value) => state.set(key, value),
  setAgentOrder: (addresses) => { order = Array.from(addresses); }, run() {},
  localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
};
const Agents = loadMod('agent-render', 'Agents', host);
const panel = new Agents();
panel.init({}, cx);
let tree = panel.render(cx);
assert.deepEqual(order, ['working', 'blocked', 'done', 'idle']);
assert.deepEqual(find(tree, 'ag-list').items.filter((n) => n.elementId?.startsWith('sec-')).map((n) => n.items[0].items[0]), ['Working', 'Needs you', 'Done', 'Idle']);

// The app's alternative to hide-working really folds the Working section.
find(tree, 'sec-5').handlers.click({}, cx);
tree = panel.render(cx);
assert.ok(find(tree, 'sec-5'), 'folded Working header remains available');
assert.equal(find(tree, 'ag-working'), null, 'folding omits Working rows');
assert.ok(find(tree, 'ag-done'), 'other sections stay expanded');
find(tree, 'sec-5').handlers.click({}, cx);
assert.ok(find(panel.render(cx), 'ag-working'), 'unfolding restores Working rows');

// The most important case: focusing acknowledges Done -> Idle, and submitting
// a prompt changes Idle -> Working, but neither moves the focused row or section.
focus = { pane: 'p-done', terminal: 'done' };
for (const [status, seq] of [['idle', 50], ['working', 60], ['done', 70]]) {
  list[0] = { ...list[0], status, seq, focused: true };
  tree = panel.render(cx);
  assert.deepEqual(order, ['working', 'blocked', 'done', 'idle'], `focused ${status} keeps its captured order`);
  assert.equal(panel.frozenSort.done.rank, 3, 'focused row stays in Done');
  assert.equal(panel.frozenSort.done.seq, 40, 'focused sequence remains frozen');
  assert.ok(find(tree, 'sec-3'));
}
// Leaving focus releases the snapshot, and Working-first applies again.
list[0] = { ...list[0], status: 'working', seq: 80, focused: false };
focus = { pane: 'p-idle', terminal: 'idle' };
panel.render(cx);
assert.equal(panel.frozenSort.done, undefined);
assert.deepEqual(order.slice(0, 2).sort(), ['done', 'working']);
list[0] = { ...list[0], status: 'done', seq: 90 };
focus = null;
panel.render(cx);
assert.deepEqual(order, ['working', 'blocked', 'done', 'idle']);

// Any working descendant promotes its tree into Working, even with a blocked sibling.
rawTerminals = [
  { address: 'worker-child', parent: 'idle', state: 'live', status: 'working' },
  { address: 'blocked-child', parent: 'idle', state: 'live', status: 'blocked' },
];
panel.render(cx);
assert.deepEqual(order.slice(0, 2).sort(), ['idle', 'working']);
rawTerminals = [];

// Explicit pins remain the reserved top section in both clients.
list[0] = { ...list[0], pinned: true };
assert.ok(find(panel.render(cx), 'pinned'));
assert.equal(order[0], 'done');
list[0] = { ...list[0], pinned: false };

// Persisted hidden choices cannot suppress working agents or introduce an app menu option.
state.set('agents.sort', 'hidden');
panel.snooze = { hide_working: true, view: {} };
assert.ok(find(panel.render(cx), 'ag-working'));
assert.ok(find(panel.sortMenu(colors), 'sort-priority'));
assert.equal(find(panel.sortMenu(colors), 'sort-hidden'), null);

// Exercise the actual app prefix+w handler, including migration from the old hidden mode.
const Prefix = loadMod('prefix', 'Prefix', {
  ...host, closeOverlay() {}, notify() {},
});
const prefix = new Prefix();
prefix.mode = 'prefix';
prefix.ctx = {};
const key = { key: 'w', keystroke: 'w', modifiers: {} };
for (const [before, after] of [['priority', 'grouped'], ['grouped', 'priority'], ['hidden', 'grouped'], [undefined, 'grouped']]) {
  state.set('agents.sort', before);
  prefix.onKey(key, cx);
  assert.equal(state.get('agents.sort'), after);
}
// Upgrading persisted ranks preserves the captured status, never re-prefixing
// it from the current agent status while focus remains on that agent.
storage.set('frozenSort', JSON.stringify({ done: { rank: 3, since: 100, seq: 40 }, working: { rank: 1, since: 200, seq: 10 } }));
const migrated = new Agents();
migrated.init({}, cx);
assert.equal(migrated.frozenSort.working.rank, 5, 'legacy Working encoding upgrades to the new Working encoding');
assert.equal(migrated.frozenSort.done.rank, 3, 'captured Done section stays Done');
list[0] = { ...list[0], status: 'working', focused: true };
focus = { pane: 'p-done', terminal: 'done' };
migrated.render(cx);
assert.equal(migrated.frozenSort.done.rank, 3, 'persisted Done snapshot remains Done while prompting');
assert.equal(migrated.frozenSort.done.seq, 40);

console.log('Working-first render, full focused freeze, collapse, migration, and app sort-cycle assertions passed');
