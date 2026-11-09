import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { matches, valueCounts } from '../../static/js/viewmodel.js';
import {
  INBOX_GROUPS, INBOX_ORDERS, INBOX_PROPS, filtersFromOld, groupName, groupRuns, groupTone, inboxFields, inboxGroupLabel, orderValue, runMs,
  runSource, sortRuns, sourceLabel,
} from '../../static/js/inboxview.js';
import { freezeDate, unfreezeDate } from './helpers.mjs';

const T = Date.parse('2026-11-09T12:00:00Z');
const run = (id, extra = {}) => ({ id, dir: 'aaaa0001', dir_name: 'demo', cmd: 'hello', args: '', at: '2026-11-09T10:00:00', started_ts: T - 3_600_000, ...extra });
const RUNS = [
  run('wait', { live: true, busy: true, pending: 1, started_ts: T - 60_000 }),                        // needs you
  run('busy', { live: true, busy: true, cmd: 'qa:list', started_ts: T - 120_000 }),                    // working
  run('new', { outcome: 'success', ended_ts: T - 3_000_000, cost: 0.5, source: 'schedule' }),          // done, unread
  run('seen', { outcome: 'error', ended_ts: T - 3_590_000, cost: 0.1, read_at: 'x', dir: 'bbbb0002', dir_name: 'other', at: '2026-11-08T09:00:00', started_ts: T - 90_000_000 }),
  run('term', { target: 'terminal', source: 'terminal', worktree: '/w', at: '2026-11-07T09:00:00', started_ts: T - 200_000_000 }), // started
];
const ctx = { dirs: [{ id: 'bbbb0002', name: 'other' }, { id: 'aaaa0001', name: 'demo' }] };
const ids = (rows) => rows.map((r) => r.id);

describe('inboxview', () => {
  before(() => freezeDate());
  after(() => unfreezeDate());

  it('says where a run started and how long it took', () => {
    assert.equal(runSource(run('a')), 'here');
    assert.equal(runSource(run('a', { target: 'terminal' })), 'terminal'); // a record from before `source`
    assert.equal(sourceLabel(RUNS[2]), 'Scheduled');
    assert.equal(runMs(RUNS[2], T), 600_000);
    assert.equal(runMs(RUNS[1], T), 120_000); // still going: up to now
    assert.equal(runMs({}, T), null);
    assert.equal(runMs(RUNS[4], T), null); // in Terminal: this app does not see it end
  });

  it('filters by status, folder, agent, source, seen and where', () => {
    const fs = inboxFields(ctx);
    assert.deepEqual(fs.map((f) => f.key), ['status', 'folder', 'agent', 'source', 'seen', 'where']);
    const keep = (filters) => ids(RUNS.filter((r) => matches(r, filters, fs, ctx)));
    assert.deepEqual(keep([{ field: 'status', op: 'is', values: ['needs_you', 'working'] }]), ['wait', 'busy']);
    assert.deepEqual(keep([{ field: 'folder', op: 'isnot', values: ['aaaa0001'] }]), ['seen']);
    assert.deepEqual(keep([{ field: 'agent', op: 'is', values: ['qa:list'] }]), ['busy']);
    assert.deepEqual(keep([{ field: 'source', op: 'is', values: ['schedule', 'terminal'] }]), ['new', 'term']);
    assert.deepEqual(keep([{ field: 'seen', op: 'is', values: ['unread'] }]), ['new']);
    assert.deepEqual(keep([{ field: 'where', op: 'is', values: ['worktree'] }]), ['term']);
    // what Filter offers: every status with its dot's tone, the folders of Settings first, the agents A–Z
    const status = fs.find((f) => f.key === 'status');
    assert.deepEqual(status.values().slice(0, 2), [{ value: 'needs_you', label: 'Needs you', tone: 'warning' }, { value: 'working', label: 'Working', tone: 'accent' }]);
    assert.deepEqual(fs.find((f) => f.key === 'folder').values(ctx, [...RUNS, run('x', { dir: 'cccc0003', dir_name: 'gone' })]).map((v) => v.label), ['other', 'demo', 'gone']);
    assert.deepEqual(fs.find((f) => f.key === 'agent').values(ctx, RUNS).map((v) => v.label), ['/hello', '/qa:list']);
    assert.deepEqual(valueCounts(RUNS, status, ctx), { needs_you: 1, working: 1, done: 1, failed: 1, started: 1 });
  });

  it('sorts by each order, equal ones kept in the order they came', () => {
    assert.ok(INBOX_ORDERS.every(([k]) => typeof orderValue(k, RUNS[0], T) !== 'undefined'));
    assert.deepEqual(ids(sortRuns(RUNS, 'started', -1, T)), ['wait', 'busy', 'new', 'seen', 'term']);
    assert.deepEqual(ids(sortRuns(RUNS, 'started', 1, T)), ['term', 'seen', 'new', 'busy', 'wait']);
    assert.deepEqual(ids(sortRuns(RUNS, 'status', 1, T)), ['wait', 'busy', 'new', 'seen', 'term']); // the Inbox's order
    assert.deepEqual(ids(sortRuns(RUNS, 'cost', -1, T)), ['new', 'seen', 'wait', 'busy', 'term']);
    assert.deepEqual(ids(sortRuns(RUNS, 'time', -1, T)), ['seen', 'new', 'busy', 'wait', 'term']); // not known: last
    assert.deepEqual(ids(sortRuns(RUNS, 'run', 1, T)), ['wait', 'new', 'seen', 'term', 'busy']);
  });

  it('groups by attention, status, folder, agent, day and source', () => {
    const keys = (by) => groupRuns(RUNS, by, ctx).map(([k, rows]) => `${k}:${rows.length}`);
    assert.deepEqual(keys(null), ['null:5']);
    assert.deepEqual(keys('attention'), ['needs_you:1', 'running:1', 'unread:1', 'earlier:2']);
    assert.deepEqual(keys('status'), ['needs_you:1', 'working:1', 'done:1', 'failed:1', 'started:1']);
    assert.deepEqual(keys('folder'), ['bbbb0002:1', 'aaaa0001:4']); // Settings' order
    assert.deepEqual(keys('agent'), ['hello:4', 'qa:list:1']);
    assert.deepEqual(keys('day'), ['2026-11-09:3', '2026-11-08:1', '2026-11-07:1']); // newest first
    assert.deepEqual(keys('source'), ['here:3', 'terminal:1', 'schedule:1']); // RUN_SOURCES's order
    // a group keeps the order its rows came in
    assert.deepEqual(ids(groupRuns(sortRuns(RUNS, 'started', 1, T), 'agent', ctx)[0][1]), ['term', 'seen', 'new', 'wait']);
  });

  it('names a group and gives a status its dot', () => {
    assert.equal(groupName('attention', 'needs_you'), 'Needs you');
    assert.equal(groupName('status', 'failed'), 'Failed');
    assert.equal(groupName('folder', 'bbbb0002', ctx), 'other');
    assert.equal(groupName('folder', 'cccc0003', ctx, [{ dir_name: 'gone' }]), 'gone');
    assert.equal(groupName('agent', 'hello'), '/hello');
    assert.equal(groupName('source', 'terminal'), 'Terminal');
    assert.equal(groupName('day', '2026-10-15'), 'Today'); // helpers.mjs freezes the day
    assert.equal(groupTone('status', 'done'), 'success');
    assert.equal(groupTone('attention', 'needs_you'), 'warning');
    assert.equal(groupTone('attention', 'earlier'), null);
    assert.equal(groupTone('folder', 'x'), null);
    assert.equal(inboxGroupLabel('attention'), 'Attention');
    assert.equal(inboxGroupLabel(null), 'None');
    assert.ok(INBOX_GROUPS.every(([k]) => groupRuns(RUNS, k, ctx).length));
    assert.ok(INBOX_PROPS.every(([k]) => k !== 'run')); // the run itself always shows
  });

  it('turns the old selects into filters', () => {
    assert.deepEqual(filtersFromOld({ status: 'failed', dir: 'aaaa0001', source: '' }), [
      { field: 'status', op: 'is', values: ['failed'] }, { field: 'folder', op: 'is', values: ['aaaa0001'] }]);
    assert.deepEqual(filtersFromOld(null), []);
    assert.deepEqual(filtersFromOld('x'), []);
  });
});
