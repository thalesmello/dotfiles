// Exercise the live prefix key handlers; all window/process APIs are mocked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../stow_modules/main/dot-config/herdr-app/mods/prefix/main.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ["'][^"']+["'];\n/gm, '')
  .replace('export default class Prefix', 'class Prefix');

function fixture(machine, check = false) {
  const prefix = machine ? `${machine}/` : '';
  const pane = { pane: `${prefix}p1`, terminal: `${prefix}t1`, tab: `${prefix}tb1`,
    cwd: machine ? '/home/remote/src/repo' : '/Users/local/src/repo' };
  let focus = { pane: pane.pane, terminal: pane.terminal, tab: pane.tab };
  let tasks = 0;
  const calls = [], launches = [], closed = [];
  const context = vm.createContext({ View: class {}, console,
    checking: () => check,
    focused: () => focus, panes: () => [pane], terminals: () => [],
    spaces: () => [{ id: `${prefix}sp1`, machine, active: true, tabs: [{ id: pane.tab, active: true }] }],
    home: () => '/Users/local', appHome: () => '/Users/local/.config/herdr-app',
    props: () => ({ overlay: 'prefix-overlay' }), readTextFile: async () => null,
    closeOverlay: id => closed.push(id), notify: () => {},
    exec: async (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { code: 0 }; },
    hc: async args => { launches.push(args); return { code: 0, stdout: '{}' }; },
  });
  vm.runInContext(source + '\nthis.Prefix = Prefix;', context);
  const instance = new context.Prefix();
  instance.init({}, { focus_handle: () => ({ focus() {} }), timer: { after() {} },
    spawn: fn => { tasks++; return fn({}); } });
  return { calls, launches, closed, instance, pane,
    get tasks() { return tasks; },
    moveFocus() { focus = { pane: 'p-other', terminal: 't-other', tab: 'tb-other' }; },
  };
}

for (const machine of ['', 'devserver']) for (const shift of [false, true]) {
  const f = fixture(machine);
  f.moveFocus(); // The captured pane remains the source during asynchronous launch.
  f.instance.onKey({ key: 'a', keystroke: shift ? 'shift-a' : 'a', modifiers: { shift } },
                   { stop_propagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.cmd, 'sh');
  assert.equal(call.opts.on, undefined, 'the launcher must run on the desktop, never the source remote');
  assert.equal(call.opts.cwd, machine ? '/Users/local' : f.pane.cwd);
  const inner = JSON.parse(call.args[1].match(/^nohup sh -c ("(?:\\.|[^"\\])*") /)[1]);
  assert.match(inner, /hc-preset --backend hc popup-open prompt-popups ask-agent 65% 52\.5%/);
  assert.ok(inner.includes(`ASK_AGENT_SOURCE_PANE_ID=${JSON.stringify(f.pane.pane)}`));
  assert.ok(inner.includes(`ASK_AGENT_SOURCE_TERMINAL_ID=${JSON.stringify(f.pane.terminal)}`));
  assert.equal(inner.includes('ASK_AGENT_CONTEXT="1"'), shift);
  if (shift) assert.ok(inner.includes(`ASK_AGENT_CWD=${JSON.stringify(f.pane.cwd)}`));
  assert.equal(f.launches.length, 0, 'prefix must not launch a remote ask script directly');
}

const checking = fixture('devserver', true);
assert.equal(checking.tasks, 0, 'mod validation must not consume popup requests or start work');
assert.deepEqual(checking.calls, []);
assert.deepEqual(checking.launches, []);
console.log('Ask prefix routing: local coordinator, captured local/remote source, Shift+A context, safe checks passed');
