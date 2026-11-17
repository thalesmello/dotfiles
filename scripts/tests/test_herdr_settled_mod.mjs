import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const mods = new URL('../../stow_modules/main/dot-config/herdr-app/mods/', import.meta.url);
function load(name, klass, globals) {
  const source = fs.readFileSync(new URL(`${name}/main.js`, mods), 'utf8')
    .replace(/^import\b[\s\S]*?from\s+"[^"]+";\s*/gm, '')
    .replace(`export default class ${klass}`, `class ${klass}`)
    .replace(/^export function /gm, 'function ') + `\nthis.${klass} = ${klass};`;
  const context = vm.createContext({ View: class {}, console, ...globals });
  vm.runInContext(source, context);
  return context[klass];
}

// Alt+S coordinates on the desktop; Alt+Shift+S preserves the originating machine.
for (const machine of ['', 'devserver']) for (const localMode of [false, true]) {
  const launches = [], overlays = [];
  const Prefix = load('prefix', 'Prefix', {
    hc: async args => { launches.push(args); return { code: 0, stdout: '{"address":"picker"}' }; },
    props: () => ({ overlay: 'prefix' }), closeOverlay: () => {},
    openOverlay: spec => overlays.push(spec), home: () => '/Users/local',
    notify: () => {},
    focused: () => ({ pane: machine ? 'devserver/p1' : 'p1', terminal: machine ? 'devserver/t1' : 't1' }),
    spaces: () => [{ id: machine ? 'devserver/sp1' : 'sp1', active: true, machine, tabs: [{ id: machine ? 'devserver/tb1' : 'tb1', active: true }] }],
    panes: () => [{ pane: machine ? 'devserver/p1' : 'p1', terminal: machine ? 'devserver/t1' : 't1', tab: machine ? 'devserver/tb1' : 'tb1', cwd: machine ? '/home/remote/src' : '/Users/local/src' }],
    appHome: () => '/nonexistent-check-home', readTextFile: async () => null,
  });
  const prefix = new Prefix();
  prefix.mode = 'prefix';
  prefix.init({}, { focus_handle: () => ({ focus() {} }), timer: { after() {} }, spawn: fn => fn({}) });
  assert.equal(prefix.ctx.machine, machine, 'capture the focused space machine when prefix opens');
  prefix.onKey({ keystroke: localMode ? 'alt-shift-s' : 'alt-s', key: 's', modifiers: { alt: true, shift: localMode } }, { stop_propagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(launches.length, 1);
  const args = launches[0];
  const remote = Boolean(machine && localMode);
  assert.equal(args.includes('--on'), remote);
  if (remote) assert.equal(args[args.indexOf('--on') + 1], machine);
  assert.equal(args[args.indexOf('--cwd') + 1], machine && !localMode ? '/Users/local' : prefix.ctx.cwd);
  assert.match(args.at(-1), /herdr-settled.py picker/);
  assert.equal(args.at(-1).includes('--all-machines'), !localMode);
  assert.match(args.at(-1), /HC_PRESET_BACKEND="hc"/);
  assert.equal(/\bHC_TERMINAL_ID=/.test(args.at(-1)), localMode, 'combined picker must retain its own Core terminal identity');
  const expectedPrefix = machine && !localMode ? 'devserver/' : '';
  assert.ok(args.at(-1).includes(`HERDR_ACTIVE_TERMINAL_ID="${expectedPrefix}t1"`));
  assert.ok(args.at(-1).includes(`HERDR_ACTIVE_PANE_ID="${expectedPrefix}p1"`));
  assert.equal(overlays[0].layout.children[0].content.terminal, 'picker');
}

// The personal sidebar ensures an event watcher on each connected machine.
let checking = false, now = 100000;
const calls = [], tasks = [], pending = [];
const Spaces = load('spaces-reconnect', 'Spaces', {
  checking: () => checking, Date: { now: () => now },
  hc: async () => ({ code: 0, stdout: JSON.stringify({ machines: sidebar.machines }) }),
  exec: (_cmd, args, opts) => { assert.match(args[1], /herdr-settled.py.*ensure-watch/); calls.push(opts.on); return new Promise(resolve => pending.push(resolve)); },
});
const sidebar = new Spaces();
sidebar.machines = [{ name: 'devserver', state: 'connected' },
  { name: 'offline', state: 'unreachable' }, { name: 'scratch', state: 'connected', temporary: true }];
const cx = { spawn: fn => tasks.push(fn({})) };
sidebar.ensureSettledWatchers(cx);
sidebar.ensureSettledWatchers(cx);
assert.deepEqual(calls, [null, 'devserver'], 'dedupe concurrent starts and skip disconnected/temporary machines');
pending.splice(0).forEach(resolve => resolve({ code: 0 }));
await Promise.all(tasks.splice(0));
sidebar.ensureSettledWatchers(cx);
assert.equal(calls.length, 2, 'a successful ensure helper is not relaunched on every sidebar refresh');
now += 60001;
sidebar.refreshMachines({ spawn: fn => tasks.push(fn({ spawn: cx.spawn, notify() {} })) });
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(calls, [null, 'devserver', null, 'devserver'], 'refreshMachines rechecks watcher health after the cooldown');
pending.splice(0).forEach(resolve => resolve({ code: 0 }));
await Promise.all(tasks.splice(0));
checking = true;
sidebar.ensureSettledWatchers(cx);
assert.equal(calls.length, 4, 'checks must never start helpers');
console.log('Settled machine-routing and watcher assertions passed');
