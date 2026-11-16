import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const file = new URL('../../stow_modules/main/dot-config/herdr-app/mods/agents-snooze/main.js', import.meta.url);
const source = fs.readFileSync(file, 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace('export default class Agents', 'class Agents') + '\nthis.Agents = Agents;';
const ctx = vm.createContext({ View: class {}, Object, Date, Set, Map, console });
vm.runInContext(source, ctx);
const panel = new ctx.Agents();
const now = Date.now();
const local = { pane: 'p1', address: 't1', status: 'idle', focused: false };
const remote = { ...local, pane: 'remote/p1', address: 'remote/t1' };
panel.snooze = { panes: { p1: { until: now + 60000, terminal_id: 't1' } }, view: {} };
assert.equal(panel.visibleAgent(local, now), false);
assert.equal(panel.visibleAgent(remote, now), true, 'machine-qualified IDs must not collide');
assert.equal(panel.visibleAgent({ ...local, pane: 'p-moved' }, now), false, 'follow the terminal after a move');
assert.equal(panel.visibleAgent({ ...local, status: 'blocked' }, now), true, 'never hide needs-you agents');
assert.equal(panel.visibleAgent(local, now + 60001), true, 'expire even if the timer is late');
panel.snooze.view.showing = 'snoozed';
assert.equal(panel.visibleAgent(local, now), true);
assert.equal(panel.visibleAgent(remote, now), false);
assert.equal(panel.visibleAgent({ ...remote, status: 'blocked' }, now), true);
panel.snooze.view.showing = 'all';
assert.equal(panel.visibleAgent(local, now), true);
assert.equal(panel.visibleAgent(remote, now), true);
panel.snooze.hide_working = true;
assert.equal(panel.visibleAgent({ ...remote, status: 'working' }, now), false);
assert.equal(panel.visibleAgent({ ...remote, status: 'working', focused: true }, now), true);
const child = [{ address: 't1', parent: 'parent', state: 'live' }];
assert.equal(panel.tree(child, 'parent').length, 1, 'all-live mode also shows snoozed children');
panel.snooze.view = {};
assert.equal(panel.tree(child, 'parent').length, 0);

// Priority rank order: blocked (4) > done (3) > idle (2) > working (1)
assert.ok(panel.rank({ status: 'blocked' }) > panel.rank({ status: 'done' }));
assert.ok(panel.rank({ status: 'done' }) > panel.rank({ status: 'idle' }));
assert.ok(panel.rank({ status: 'idle' }) > panel.rank({ status: 'working' }), 'working sorts below idle');
assert.equal(
  ctx.Agents.computeLiveRank({ status: 'working' }, ['idle']),
  panel.rank({ status: 'working' }),
  'idle sub-agent does not promote working parent to idle',
);
assert.equal(
  ctx.Agents.computeLiveRank({ status: 'working' }, ['blocked']),
  panel.rank({ status: 'blocked' }),
  'blocked sub-agent promotes parent to blocked',
);

// Frozen focused agent sort: does not resort until focus switches to another agent or pane
panel.changed = {
  t1: { s: 'idle', at: 1000 },
  t2: { s: 'idle', at: 2000 },
};
panel.frozenSort = {};
panel.unfocusedSort = {};
const list1 = [
  { address: 't1', pane: 'p1', status: 'done', seq: 10, focused: false },
  { address: 't2', pane: 'p2', status: 'idle', seq: 20, focused: false },
];
const urgency1 = new Map(list1.map((a) => [a.address, panel.rank(a)]));
panel.updateFrozenSort(list1, urgency1, { pane: 'p9', terminal: 't9' });
assert.equal(panel.frozenSort.t1, undefined);
assert.deepEqual({ ...panel.unfocusedSort.t1 }, { rank: 3, since: 1000, seq: 10 });

// User focuses t1: herdr-app flips t1 from done -> idle, and user submits a prompt (idle -> working, at: 5000, seq: 30)
panel.changed.t1 = { s: 'working', at: 5000 };
const list2 = [
  { address: 't1', pane: 'p1', status: 'working', seq: 30, focused: true },
  { address: 't2', pane: 'p2', status: 'idle', seq: 20, focused: false },
];
const urgency2 = new Map(list2.map((a) => [a.address, panel.rank(a)]));
panel.updateFrozenSort(list2, urgency2, { pane: 'p1', terminal: 't1' });
assert.deepEqual(
  { ...panel.frozenSort.t1 },
  { rank: 3, since: 1000, seq: 10 },
  'focused agent stays frozen at its pre-focus Done rank/timestamp while working',
);

// Focus moves to a different pane (p2 / t2): t1 unfreezes and resorts to working
panel.updateFrozenSort(list2, urgency2, { pane: 'p2', terminal: 't2' });
assert.equal(panel.frozenSort.t1, undefined, 't1 unfreezes after focus leaves p1');
assert.deepEqual({ ...panel.unfocusedSort.t1 }, { rank: 1, since: 5000, seq: 30 });
assert.deepEqual({ ...panel.frozenSort.t2 }, { rank: 2, since: 2000, seq: 20 });

console.log('24 snooze/sort panel assertions passed');
