import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the real mod render/lifecycle with all native commands mocked.
function element() {
  let proxy;
  proxy = new Proxy({}, { get: (_target, key) => key === 'when'
    ? (condition, apply) => condition ? apply(proxy) : proxy
    : () => proxy });
  return proxy;
}
const source = fs.readFileSync(new URL('../../stow_modules/main/dot-config/herdr-app/mods/agents-snooze/main.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace('export default class Agents', 'class Agents') + '\nthis.Agents = Agents;';
const agent = (address, seq, tab = `tab-${address}`) => ({
  address, pane: `pane-${address}`, tab, space: `space-${address}`, space_name: 'Test',
  status: 'idle', seq, title: address, program: { key: 'pi', name: 'Pi', agent: true }, pinned: false,
});
function fixture(initial, current = initial[0]?.address) {
  let list = initial.map(a => ({ ...a }));
  let ps = list.map(a => ({ ...a, terminal: a.address }));
  let foc;
  let checking = true;
  let machineList = [{ name: null, layout: 'ready' }, { name: 'remote', layout: 'ready' }];
  const state = new Map([['agents.sort', 'grouped']]);
  const storage = new Map();
  const commands = [];
  function focus(address) {
    const a = ps.find(p => p.terminal === address);
    foc = a ? { terminal: address, pane: a.pane, tab: a.tab, space: a.space, agent: address } : null;
    for (const row of list) row.focused = row.address === address;
  }
  focus(current);
  const cx = { notify() {}, timer: { every() {} } };
  const context = vm.createContext({
    View: class {}, console,
    div: element, h_flex: element, v_flex: element, image: element, svg: element,
    props: () => ({}), checking: () => checking, agents: () => list, panes: () => ps,
    terminals: () => [], spaces: () => [], machines: () => machineList, focused: () => foc,
    layout: () => ({ id: 'sidebar', size: { px: 268 } }), window: () => ({ platform: 'macos' }), theme: () => ({}),
    shared: key => state.get(key), setShared: (key, value) => state.set(key, value), setAgentOrder() {},
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    run: (name, args) => { commands.push([name, { ...args }]); if (name === 'agent.focus') focus(args.terminal); },
  });
  vm.runInContext(source, context);
  const panel = new context.Agents();
  panel.init({}, cx); // checking skips process/watch side effects
  checking = false;
  const render = () => panel.render(cx);
  render();
  return {
    panel, render, commands, state, focus,
    close(...addresses) { list = list.filter(a => !addresses.includes(a.address)); ps = ps.filter(p => !addresses.includes(p.terminal)); },
    loseStatus(address) { list = list.filter(a => a.address !== address); },
    addPane(p) { ps.push(p); },
    patch(address, attrs) { Object.assign(list.find(a => a.address === address), attrs); },
    popup() { foc = { ...foc, pane: null, terminal: 'popup' }; },
    machine(name, layout) { machineList = machineList.map(m => m.name === name ? { ...m, layout } : m); },
    checking(value) { checking = value; },
    order: () => Array.from(state.get('agents.visibleOrder')),
  };
}

// Identical bare IDs on two machines must never collide in either direction.
for (const [from, to, fallback] of [['t1', 'remote/t1', 't2'], ['remote/t1', 't1', 'remote/t2']]) {
  const f = fixture([agent(from, 30), agent(to, 20), agent(fallback, 10)]);
  f.popup(); f.render(); // confirmation overlays preserve the underlying snapshot
  f.close(from); f.focus(fallback); f.render();
  assert.deepEqual(f.commands, [['agent.focus', { terminal: to }]]);
  f.render(); f.render();
  assert.equal(f.commands.length, 1, 'a completed close never keeps stealing focus');
}

// Capture the visible frozen order, not the reordered live statuses after exit.
{
  const f = fixture([agent('t1', 30), { ...agent('remote/t1', 20), status: 'done' }, agent('t2', 10)], 'remote/t1');
  f.state.set('agents.sort', 'priority'); f.render();
  assert.deepEqual(f.order(), ['remote/t1', 't1', 't2']);
  f.patch('remote/t1', { status: 'working', seq: 100 }); f.render();
  assert.deepEqual(f.order(), ['remote/t1', 't1', 't2'], 'focused Done row stays frozen');
  f.close('remote/t1'); f.patch('t2', { status: 'working', seq: 200 }); f.focus('t2'); f.render();
  assert.deepEqual(f.commands, [['agent.focus', { terminal: 't1' }]], 'follow the pre-close list');
}

// At the bottom use the preceding row; skip rows closed in the same event.
{
  const f = fixture([agent('t1', 30), agent('remote/t1', 20), agent('t2', 10)], 't2');
  f.close('t2'); f.focus('t1'); f.render();
  assert.deepEqual(f.commands, [['agent.focus', { terminal: 'remote/t1' }]]);
}
{
  const f = fixture([agent('t1', 30), agent('remote/t1', 20), agent('t2', 10)]);
  f.close('t1', 'remote/t1'); f.focus('t2'); f.render();
  assert.deepEqual(f.commands, [], 'already on the next surviving row');
}

// Keep focus within a split tab, including non-agent and mod siblings.
for (const sibling of [{ terminal: 'shell' }, { terminal: null, mod: 'files' }]) {
  const f = fixture([agent('t1', 20), agent('remote/t1', 10)]);
  f.addPane({ pane: 'sibling', tab: 'tab-t1', ...sibling });
  f.close('t1'); f.render();
  assert.deepEqual(f.commands, []);
}

// Status disappearing alone isn't a pane close. Preserve its old position
// through return-to-shell so closing that shell still focuses the successor.
{
  const f = fixture([agent('t1', 20), agent('remote/t1', 10), agent('t2', 5)]);
  f.loseStatus('t1'); f.render();
  assert.deepEqual(f.commands, []);
  f.close('t1'); f.focus('t2'); f.render();
  assert.deepEqual(f.commands, [['agent.focus', { terminal: 'remote/t1' }]]);
}

// Explicitly navigating away before a background close must not steal focus.
{
  const f = fixture([agent('t1', 20), agent('remote/t1', 10), agent('t2', 5)]);
  f.focus('t2'); f.render(); f.close('t1'); f.render();
  assert.deepEqual(f.commands, []);
}

// A remote disconnect/reconnect is never mistaken for an agent close.
{
  const f = fixture([agent('remote/t1', 20), agent('t1', 10)]);
  f.machine('remote', 'unavailable'); f.close('remote/t1'); f.focus('t1'); f.render();
  f.machine('remote', 'ready'); f.render();
  assert.deepEqual(f.commands, []);
}
{
  const f = fixture([agent('t1', 20), agent('remote/t1', 10), agent('t2', 5), agent('t3', 1)]);
  f.machine('remote', 'unavailable'); f.close('t1'); f.focus('t3'); f.render();
  assert.deepEqual(f.commands, [['agent.focus', { terminal: 't2' }]], 'skip unreachable successors');
}
{
  const f = fixture([agent('t1', 20)]);
  f.close('t1'); f.focus(null); f.render();
  assert.deepEqual(f.commands, [], 'no agent remains');
}
{
  const f = fixture([agent('t1', 20), agent('remote/t1', 10)]);
  f.checking(true); f.close('t1'); f.render();
  assert.deepEqual(f.commands, [], 'mod checks cannot focus live terminals');
}
// Confirmation helpers run on the window's machine even for a remote pane.
// Custom app homes must follow them rather than reading another window's order.
for (const [name, className] of [['prefix', 'Prefix'], ['spaces-reconnect', 'Spaces']]) {
  const modSource = fs.readFileSync(new URL(`../../stow_modules/main/dot-config/herdr-app/mods/${name}/main.js`, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from ["'][^"']+["'];\n/gm, '')
    .replace(`export default class ${className}`, `class ${className}`)
    .replace(/^export (?=(?:async )?(?:function|const|let|class)\b)/gm, '');
  const calls = [];
  const customHome = '/tmp/custom app home';
  const context = vm.createContext({ View: class {}, console,
    appHome: () => customHome, home: () => '/tmp/home', closeOverlay() {},
    panes: () => [{ pane: 'remote/p1', terminal: 'remote/t1' }],
    hc: args => { calls.push(args); return Promise.resolve({ code: 1 }); },
  });
  vm.runInContext(modSource + '\nthis.confirm = openConfirmClosePopup;' + (name === 'prefix' ? '\nthis.buildEnv = buildEnv;' : ''), context);
  const pane = { pane: 'remote/p1', terminal: 'remote/t1', app: 'pi' };
  if (name === 'prefix') context.confirm('popup', pane, 'pi');
  else context.confirm(pane, 'pi');
  assert.equal(calls.length, 1);
  const command = calls[0].at(-1);
  assert.ok(command.includes(`HERDR_APP_HOME=${JSON.stringify(customHome)}`));
  assert.ok(command.includes('ASCONFIRMCLOSE_PANE_ID="remote/p1"'));
  assert.ok(command.includes('prompt --local-app'), 'close controller uses local window/core IPC, not hc-preset');
  assert.equal(calls[0].includes('--on'), false, 'confirmation runs locally, keeping qualified target IDs');
  if (name === 'prefix') {
    assert.ok(context.buildEnv({ pane: 'remote/p1', terminal: 'remote/t1', machine: 'remote' }).includes('HERDR_APP_HOME='));
    assert.equal(context.buildEnv({ pane: 'remote/p1', terminal: 'remote/t1', machine: 'remote' }, {}, { remote: true }).includes('HERDR_APP_HOME='), false);
  }
}
console.log('Close/exit focus: frozen sidebar order, local/remote IDs, siblings, overlays, custom app homes, background closes, and disconnect safety passed');
