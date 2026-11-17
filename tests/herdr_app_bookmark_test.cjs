// Native-mod regression tests with mocked host data; no live terminals touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const rendererSource = fs.readFileSync(path.join(__dirname,
  '../stow_modules/main/dot-config/herdr-app/mods/agent-render/agent-render.js'), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/export function /g, 'function ');
const source = rendererSource + '\n' + fs.readFileSync(path.join(__dirname,
  '../stow_modules/main/dot-config/herdr-app/mods/agent-render/main.js'), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace('export default class Agents', 'class Agents') + '\nglobalThis.Agents = Agents;';

// Builder methods return the same element, and conditional children run eagerly.
function builder(kind, asset) {
  const node = { kind, asset, childNodes: [], styles: {} };
  const proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === 'child') target.childNodes.push(args[0]);
      else if (key === 'children') target.childNodes.push(...args[0]);
      else if (key === 'when') { if (args[0]) args[1](proxy); }
      else target.styles[key] = args;
      return proxy;
    };
  }});
  return proxy;
}

function setup() {
  const data = { agents: [], terminals: [], shared: {}, width: 268 };
  const storage = new Map();
  const cx = { timer: { every() {} }, notify() {} };
  const context = {
    View: class {}, div: () => builder('div'), image: p => builder('image', p),
    svg: p => builder('svg', p), h_flex: () => builder('row'), v_flex: () => builder('column'),
    agents: () => data.agents, terminals: () => data.terminals, panes: () => [], spaces: () => [],
    machines: () => [], focused: () => null, checking: () => true, props: () => ({}),
    shared: k => data.shared[k], setShared: (k, v) => { data.shared[k] = v; },
    setAgentOrder() {}, run() { throw new Error('Unexpected host mutation'); },
    theme: () => ({ accent: '#aabbcc', dim: '#777777', muted: '#888888', idle: '#777777' }),
    layout: () => ({ id: 'sidebar', size: { px: data.width } }),
    appHome: () => '/mock', readTextFile: async () => JSON.stringify(data.legacyStore ?? {}),
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }, Date,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const view = new context.Agents();
  view.init({}, cx);
  return { data, view, cx, storage, hasBookmark: context.hasBookmark, renderAgentIndicators: context.renderAgentIndicators, theme: context.theme() };
}

function nodes(root) {
  return root && typeof root === 'object' ? [root, ...root.childNodes.flatMap(nodes)] : [];
}
function bookmarks(root) {
  return nodes(root).filter(n => n.styles.id?.[0]?.startsWith('bookmark-'));
}
function agent(address) {
  return { address, pane: `p-${address}`, tab: `tab-${address}`, space: 'sp',
    space_name: 'repo', title: 'Publish change', status: 'idle', seq: 1 };
}

test('metadata labels set and clear the bookmark, with compatibility fallback', () => {
  const { hasBookmark } = setup();
  for (const labels of [undefined, {}, { 'token.book': '' }, { 'herdr.book': '' },
    { 'token.book': '', 'herdr.book': 'old' }]) assert.equal(hasBookmark(labels), false);
  for (const labels of [{ 'token.book': '󰂺' }, { 'herdr.book': '󰂺' }])
    assert.equal(hasBookmark(labels), true);
});

test('live labels update independently of status, focus, and sort timestamps', () => {
  const { data, view, cx } = setup();
  data.agents = [agent('t1')];
  data.terminals = [{ address: 't1', state: 'live', labels: {} }];
  assert.equal(bookmarks(view.render(cx)).length, 0);
  const stamp = view.since(data.agents[0]);
  data.terminals[0].labels['token.book'] = '󰂺';
  const marked = bookmarks(view.render(cx));
  assert.equal(marked.length, 1);
  assert.equal(marked[0].styles.tooltip[0], 'Published · ready to settle');
  assert.equal(view.since(data.agents[0]), stamp);
  data.terminals[0].labels['token.book'] = '';
  assert.equal(bookmarks(view.render(cx)).length, 0);
});

test('qualified addresses do not leak marks to a same-ID local agent', () => {
  const { data, view, cx } = setup();
  data.agents = [agent('t1'), agent('devserver/t1')];
  data.terminals = [{ address: 'devserver/t1', state: 'live', labels: { 'herdr.book': '󰂺' } }];
  assert.deepEqual(bookmarks(view.render(cx)).map(n => n.styles.id[0]), ['bookmark-devserver/t1']);
});

test('bookmark coexists with every status and snooze, in grouped and rail views', () => {
  const { data, view, cx, theme } = setup();
  const a = agent('t1');
  data.agents = [a];
  data.terminals = [{ address: 't1', state: 'live', labels: { 'token.book': '󰂺' } }];
  for (const width of [268, 76, 44]) for (const sort of ['priority', 'grouped']) {
    data.width = width;
    data.shared['agents.sort'] = sort;
    for (const status of ['working', 'blocked', 'done', 'idle']) {
      a.status = status;
      const root = view.render(cx);
      const marked = bookmarks(root);
      assert.equal(marked.length, 1);
      const wrapper = nodes(root).find(n => n.childNodes[0] === marked[0]);
      const compact = width < 160 || sort === 'priority';
      assert.equal(JSON.stringify(wrapper.childNodes[1]), JSON.stringify(view.statusIndicator(theme, a, compact)),
        `${status} indicator must remain beside the bookmark`);
      const glyph = marked[0].childNodes[0];
      assert.equal(glyph.asset, 'mods/agent-render/bookmark.svg');
      assert.equal(glyph.styles.size[0], compact ? 10 : 13);
      assert.equal(glyph.styles.text_color[0], theme.accent);
    }
  }
  view.snooze = { panes: { [a.pane]: { until: Date.now() + 60000 } }, view: { showing: 'all' } };
  const root = view.render(cx);
  assert.equal(bookmarks(root).length, 1);
  assert.ok(nodes(root).some(n => n.childNodes.includes('z')));
});

test('sub-agent rows use their own mark, not the parent or section mark', () => {
  const { data, view, cx } = setup();
  data.agents = [agent('t1')];
  data.terminals = [{ address: 't2', parent: 't1', state: 'live', status: 'idle',
    labels: { 'token.book': '󰂺' } }];
  assert.deepEqual(bookmarks(view.render(cx)).map(n => n.styles.id[0]), ['bookmark-t2']);
});

test('common renderer works without a snooze mod or host data', () => {
  const { renderAgentIndicators, theme } = setup();
  const a = agent('t1');
  const root = renderAgentIndicators(theme, a, { bookmarked: true });
  assert.equal(bookmarks(root).length, 1);
  assert.equal(root.childNodes[1].styles.border[0], 1.5, 'idle ring remains');
  const alternative = builder('custom-status');
  assert.equal(renderAgentIndicators(theme, a, { indicator: alternative }), alternative);
  assert.equal(renderAgentIndicators(theme, a, { bookmarked: true, indicator: alternative }).childNodes[1], alternative);
});

test('mod rename migrates durations, frozen order, and pending pins', async () => {
  const { data, view, cx, storage } = setup();
  view.changed = { t1: { s: 'idle', at: 1000 }, t2: { s: 'working', at: 2000 } };
  data.legacyStore = {
    changed: JSON.stringify({ t1: { s: 'idle', at: 100 }, t2: { s: 'idle', at: 200 } }),
    frozenSort: JSON.stringify({ t1: { rank: 3, since: 100, seq: 5 } }),
    pins: JSON.stringify(['offline/t1']),
  };
  await view.migrateRendererState(cx);
  assert.equal(view.changed.t1.at, 100);
  assert.equal(view.changed.t2.at, 2000, 'do not overwrite a real state change');
  assert.equal(view.frozenSort.t1.rank, 3);
  assert.deepEqual(Array.from(view.pendingPins), ['offline/t1']);
  assert.equal(storage.get('rendererStateVersion'), '1');
});
