// Exercise the real Prefix methods with mocked host APIs; never touch the window/core.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../stow_modules/main/dot-config/herdr-app/mods/prefix/main.js'), 'utf8');
const classSource = source.slice(source.indexOf('export default class Prefix')).replace('export default ', '');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(overrides = {}) {
  const launches = [], commands = [], timers = [], notifications = [];
  const context = {
    View: class {}, checking: () => false, appHome: () => '/local/app', home: () => '/local/home',
    readTextFile: async () => JSON.stringify({port: 12345, token: 'secret'}),
    watchFolder: () => { let resolve; const promise = new Promise(r => {resolve = r;}); promise.cancel = () => resolve([]); return promise; },
    hc: async args => { launches.push(args); return {code: 0, stdout: JSON.stringify({address: `worker-${launches.length}`})}; },
    exec: async (command, args) => { commands.push([command, args]); return {code: 0}; },
    fetch: async () => ({ok: true, json: async () => ({ok: true})}),
    notify: notification => notifications.push(notification),
    props: () => ({overlay: 'prefix'}), closeOverlay: () => {},
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(classSource + '; this.Prefix = Prefix;', context);
  const prefix = new context.Prefix();
  Object.assign(prefix, {ctx: {machine: 'devserver', tab: 'devserver/tab', pane: 'devserver/pane'}, resizeQueue: [], resizing: false, resizeReady: null, resizeStartup: null, resizeFinish: null, closed: false});
  const cx = {
    spawn: body => { Promise.resolve().then(() => body(cx)).catch(error => {throw error;}); },
    sleep: () => new Promise(() => {}),
    timer: {after: (_ms, callback) => { const timer = {callback, cancelled: false, cancel() {this.cancelled = true;}}; timers.push(timer); return timer; }},
  };
  return {prefix, cx, launches, commands, timers, notifications};
}

(async () => {
  {
    const h = harness();
    h.prefix.startResizeWorker(h.cx);
    await tick();
    assert.equal(await h.prefix.resizeReady, 'http://127.0.0.1:12345/secret');
    assert.equal(h.launches.length, 1);
    assert(!h.launches[0].includes('--on'), 'worker launch must always be local');
    assert(h.timers[0].cancelled);
    h.prefix.queueResize('right', h.cx);
    await tick();
    h.prefix.queueResize('left', h.cx);
    await tick();
    assert.equal(h.launches.length, 1, 'keys must reuse the warm worker');
    await h.prefix.close();
    assert(h.commands.some(([, args]) => args[0] === 'kill' && args[1] === 'worker-1'));
  }
  {
    let finishLaunch;
    const h = harness({hc: () => new Promise(resolve => {finishLaunch = resolve;})});
    h.prefix.startResizeWorker(h.cx);
    const ready = h.prefix.resizeReady;
    await tick();
    h.timers[0].callback(h.cx);
    await assert.rejects(ready, /startup timed out/);
    finishLaunch({code: 0, stdout: JSON.stringify({address: 'late-worker'})});
    await tick(); await tick();
    assert(h.commands.some(([, args]) => args[0] === 'kill' && args[1] === 'late-worker'), 'late launch must be cleaned up');
  }
  {
    const h = harness({fetch: async () => {throw new Error('worker gone');}});
    h.prefix.queueResize('right', h.cx);
    await tick(); await tick();
    assert.equal(h.prefix.resizeReady, null, 'expired worker must invalidate readiness');
    assert.equal(h.prefix.resizing, false);
    assert.equal(h.notifications.length, 1);
    h.prefix.startResizeWorker(h.cx);
    await tick();
    assert.equal(h.launches.length, 2, 'subsequent key must be able to launch a new worker');
    await h.prefix.close();
  }
  {
    let dismissed = false;
    const h = harness();
    h.prefix.resizing = true;
    h.prefix.dismiss = () => {dismissed = true;};
    h.prefix.finishResize('dismiss');
    assert(dismissed, 'Escape must not wait on a hung resize');
  }
  console.log('4 resize worker lifecycle tests passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
