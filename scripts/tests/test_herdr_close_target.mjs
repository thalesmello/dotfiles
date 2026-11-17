// Execute real close handlers with mocked IPC. Never touches a live window.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function fixture(name) {
  const className = name === 'prefix' ? 'Prefix' : 'Spaces';
  const entry = name === 'tabs-shortcuts' ? 'shortcuts.js' : 'main.js';
  const source = fs.readFileSync(new URL(`../../stow_modules/main/dot-config/herdr-app/mods/${name}/${entry}`, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from ["'][^"']+["'];\n/gm, '')
    .replace(`export default class ${className}`, `class ${className}`)
    .replace(/^export (?=(?:async )?(?:function|const|let|class)\b)/gm, '');
  let f = { pane: 'p2', terminal: 't2', tab: 'tb1' };
  let ps = [
    { pane: 'p1', terminal: 't1', tab: 'tb1', status: 'idle', app: 'pi', title: 'First chat' },
    { pane: 'p2', terminal: 't2', tab: 'tb1', status: 'idle', app: 'pi', title: 'Actual chat' },
    { pane: 'remote/p1', terminal: 'remote/t1', tab: 'remote/tb1', status: 'idle', app: 'pi' },
  ];
  const commands = [], launches = [], sends = [], warnings = [], overlays = [];
  let resolveSend, resolveLaunch;
  const context = vm.createContext({ View: class {}, console,
    focused: () => f, panes: () => ps, terminals: () => [],
    spaces: () => [{ id: 'sp1', active: true, tabs: [{ id: 'tb1', active: true }] }],
    home: () => '/tmp/home', appHome: () => '/tmp/app',
    shared: key => key === 'focusHistory' ? { journal: ['p1'] } : null,
    props: () => ({ overlay: 'prefix-overlay' }), closeOverlay() {},
    openOverlay: spec => { overlays.push(spec); return 'confirmation-overlay'; },
    run: (cmd, args) => commands.push([cmd, args]), notify: msg => warnings.push(msg),
    hc: args => {
      if (args[0] === 'kill') { commands.push(['terminal.kill', { terminal: args[1] }]); return Promise.resolve({ code: 0 }); }
      launches.push(args); return new Promise(r => { resolveLaunch = r; });
    },
    exec: (_cmd, args) => { sends.push(args); return new Promise(r => { resolveSend = r; }); },
  });
  vm.runInContext(source + `\nthis.getContext = ${name === 'prefix' ? 'activeContext' : 'activePaneContext'};\nthis.confirm = openConfirmClosePopup;\nthis.PrefixClass = ${name === 'tabs-shortcuts' ? 'View' : className};`
    + '\nthis.perl = PERL_SEND_SCRIPT;'
    + (name === 'prefix' ? '' : '\nthis.close = smartClose;'), context);
  const prefix = name === 'prefix' ? new context.PrefixClass() : null;
  const snapshot = () => {
    const ctx = context.getContext();
    return name === 'prefix' ? ctx : { pane: ctx.p?.pane ?? '', terminal: ctx.termAddr ?? '' };
  };
  const close = (key = 'backspace', ctrl = false) => {
    if (prefix) {
      prefix.ctx ??= context.getContext(); prefix.mode = 'prefix';
      prefix.onKey({ key, keystroke: ctrl ? `ctrl-${key}` : key, modifiers: { control: ctrl } }, { stop_propagation() {} });
    } else context.close();
  };
  return { context, snapshot, close, commands, launches, sends, warnings, overlays,
    launch(value) { resolveLaunch(value); },
    focus(value) { f = value; }, panes(value) { ps = value; },
    resolve(value) { resolveSend(value); }, prefix };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
for (const name of ['prefix', 'spaces-reconnect', 'tabs-shortcuts']) {
  // A split's second pane is the target, not the first pane/history entry.
  const a = fixture(name);
  assert.equal(a.snapshot().pane, 'p2'); a.close();
  assert.equal(a.launches.length, 1);
  assert.ok(a.launches[0].at(-1).includes('ASCONFIRMCLOSE_PANE_ID="p2"'));
  assert.ok(a.launches[0].at(-1).includes('ASCONFIRMCLOSE_TERMINAL_ID="t2"'));
  assert.ok(a.launches[0].at(-1).includes('prompt --local-app'));
  assert.equal(a.launches[0].includes('--on'), false, 'the dialog never executes on a target machine');
  a.close(); assert.equal(a.launches.length, 1, 'popup launch is single-flight');
  a.launch({ code: 0, stdout: '{"address":"popup"}' }); await flush();
  assert.equal(a.overlays.length, 1);

  // Ambiguous focus must not silently select the first pane.
  const b = fixture(name); b.focus({ pane: null, terminal: null, tab: 'tb1' });
  assert.equal(b.snapshot().pane || null, null); b.close(); assert.equal(b.launches.length, 0);

  // A focused popup never becomes the source pane below it. Repeat-close is
  // sent to the popup terminal, not another agent or an inferred model pane.
  const c = fixture(name); c.focus({ pane: null, terminal: 'confirmation', tab: 'tb1' });
  assert.equal(c.snapshot().pane || null, null); c.close();
  assert.equal(c.launches.length, 0); assert.equal(c.commands.length, 0);
  assert.equal(c.sends[0][2], 'confirmation');
  if (name === 'prefix') {
    c.close('x');
    assert.equal(c.sends.at(-1)[3], '0078', 'repeat prefix+x preserves both NUL prefix and x');
    c.close('backspace', true);
    assert.equal(c.sends.at(-1)[3], '0008', 'repeat prefix+ctrl-backspace preserves its prefix');
  }

  // Missing/stale explicit focus never falls back to a currently focused row.
  const d = fixture(name); d.focus({ pane: 'gone', terminal: 'old', tab: 'tb1' });
  assert.equal(d.snapshot().pane || null, null); d.close();
  assert.equal(d.launches.length, 0); assert.equal(d.commands.length, 0);

  // terminal.show replacements may not cause the underlying agent to die.
  const e = fixture(name); e.focus({ pane: 'p2', terminal: 't2', shown: 'remote/t1', tab: 'tb1' });
  e.close(); assert.equal(e.launches.length, 0); assert.equal(e.commands.length, 0);

  // Async shell inspection returning after the pane changed is cancelled.
  const g = fixture(name); g.panes([{ pane: 'p2', terminal: 't2', tab: 'tb1', status: null }]);
  g.close(); g.panes([{ pane: 'p2', terminal: 'different', tab: 'tb1' }]);
  g.resolve({ code: 3, stdout: '' }); await flush();
  assert.equal(g.commands.length, 0);

  // Async inspection keeps its original terminal despite navigation elsewhere.
  const h = fixture(name); h.panes([{ pane: 'p2', terminal: 't2', tab: 'tb1', status: null }]);
  h.close(); h.focus({ pane: 'remote/p1', terminal: 'remote/t1' });
  h.resolve({ code: 3, stdout: '' }); await flush();
  assert.equal(h.commands.length, 1); assert.equal(h.commands[0][0], 'terminal.kill');
  assert.equal(h.commands[0][1].terminal, 't2');

  // Delayed busy popup launch also checks the captured pane/terminal pair.
  const i = fixture(name); i.panes([{ pane: 'p2', terminal: 't2', tab: 'tb1', status: null }]);
  i.close(); i.panes([]); i.resolve({ code: 2, stdout: 'pi' }); await flush();
  assert.equal(i.launches.length, 0);

  // A launched helper whose target vanished is ended without showing a dialog.
  const j = fixture(name); j.close(); j.panes([]);
  j.launch({ code: 0, stdout: '{"address":"stale-popup"}' }); await flush();
  assert.equal(j.overlays.length, 0);
  assert.equal(j.commands[0][1].terminal, 'stale-popup');

  // Navigating away during launch cannot unexpectedly focus an old dialog.
  const k = fixture(name); k.close(); k.focus({ pane: 'remote/p1', terminal: 'remote/t1' });
  k.launch({ code: 0, stdout: '{"address":"navigated-popup"}' }); await flush();
  assert.equal(k.overlays.length, 0);
  assert.equal(k.commands[0][1].terminal, 'navigated-popup');

  // Execute the actual Perl inspector against a fake core, not live IPC.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'close-inspection-'));
  const sock = path.join(tmp, 'core.sock');
  let reply;
  const server = net.createServer(socket => socket.once('data', () => socket.end(JSON.stringify(reply) + '\n')));
  await new Promise(resolve => server.listen(sock, resolve));
  try {
    for (const [response, expected] of [
      [{ error: { kind: 'not_found', message: 'gone' } }, 2],
      [{ result: {} }, 2],
      [{ result: { foreground: null, parent: null, pid: 5, title: 'Pi' } }, 2],
      [{ result: { foreground: { name: 'pi', pid: 5 }, parent: null, pid: 5 } }, 2],
      [{ result: { foreground: { name: 'fish', pid: 5 }, parent: null, pid: 5 } }, 3],
    ]) {
      reply = response;
      const code = await new Promise((resolve, reject) => {
        const child = spawn('/usr/bin/perl', ['-e', a.context.perl, 'fake-terminal', '007f', 'smart', '80', '24'],
          { env: { ...process.env, HC_SOCKET: sock } });
        child.on('error', reject); child.on('close', resolve);
      });
      assert.equal(code, expected, `inspection must only auto-close known shells: ${JSON.stringify(response)}`);
    }
  } finally {
    await new Promise(resolve => server.close(resolve)); fs.rmSync(tmp, { recursive: true });
  }
}
console.log('Close target safety: split focus, ambiguous/stale focus, popup repeats, shown terminals, async changes, exact terminal scope passed');
