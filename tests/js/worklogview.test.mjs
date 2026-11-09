import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { matches, valueCounts } from '../../static/js/viewmodel.js';
import { LOG_GROUPS, groupName, groupSummary, logFields, logGroupLabel, logGroups, rowState } from '../../static/js/worklogview.js';
import { freezeDate, unfreezeDate } from './helpers.mjs';

const e = (id, date, kind, time, extra = {}) => ({ id, date, kind, time, at: `${date}T10:00`, ...extra });
const ROWS = [
  e('TSK-1', '2026-11-09', 'Analysis', '01:00'),
  e('TSK-1', '2026-11-03', 'Testing', '00:30', { at: '2026-11-03T09:00' }),
  e('STY-2', '2026-11-09', 'Meeting', '00:45', { at: '2026-11-09T12:00', status: 'tentative' }),
  { id: 'STY-2', date: '2026-11-08', kind: 'Definition', time: '00:00', suggested: true },
];
const ctx = { kinds: ['Analysis', 'Definition', 'Testing', 'Meeting'], typeOf: (id) => ({ 'TSK-1': 'task', 'STY-2': 'story' })[id], typeName: (t) => `${t}s` };

describe('worklogview', () => {
  before(() => freezeDate());
  after(() => unfreezeDate());

  it('tells a logged row from a tentative and a suggested one', () => {
    assert.deepEqual(ROWS.map(rowState), ['logged', 'logged', 'tentative', 'suggested']);
  });

  it('filters by kind, entry and item type, as the lists do', () => {
    const fs = logFields(ctx);
    assert.deepEqual(fs.map((f) => f.key), ['kind', 'entry', 'type']);
    const pick = (filters) => ROWS.filter((r) => matches(r, filters, fs)).map((r) => `${r.id}/${r.kind}`);
    assert.deepEqual(pick([{ field: 'kind', op: 'is', values: ['Analysis', 'Meeting'] }]), ['TSK-1/Analysis', 'STY-2/Meeting']);
    assert.deepEqual(pick([{ field: 'entry', op: 'isnot', values: ['suggested', 'tentative'] }]), ['TSK-1/Analysis', 'TSK-1/Testing']);
    assert.deepEqual(pick([{ field: 'type', op: 'is', values: ['story'] }]), ['STY-2/Meeting', 'STY-2/Definition']);
    assert.deepEqual(valueCounts(ROWS, fs[2]), { task: 2, story: 2 });
    // The item types offered are the ones the rows have, named by the vault.
    assert.deepEqual(fs[2].values(null, ROWS).map((v) => v.label), ['storys', 'tasks']);
    // A kind no longer in the vault's list still shows while a row holds it.
    assert.deepEqual(fs[0].values(null, [...ROWS, e('X', '2026-11-01', 'Old', '00:10')]).map((v) => v.value), [...ctx.kinds, 'Old']);
  });

  it('groups by day, week, item and kind, newest first', () => {
    const keys = (by) => logGroups(ROWS, by, ctx).map(([k, rs]) => `${k}:${rs.length}`);
    assert.deepEqual(keys('day'), ['2026-11-09:2', '2026-11-08:1', '2026-11-03:1']);
    assert.deepEqual(keys('week'), ['2026-W46:2', '2026-W45:2']); // Nov 9 is a Monday
    assert.deepEqual(keys('item'), ['STY-2:2', 'TSK-1:2']); // by its latest row: STY-2 was logged later on the 9th
    assert.deepEqual(keys('kind'), ['Analysis:1', 'Definition:1', 'Testing:1', 'Meeting:1']);
    const [[none, all]] = logGroups(ROWS, null);
    assert.equal(none, null);
    assert.deepEqual(all.map((r) => r.date), ['2026-11-09', '2026-11-09', '2026-11-08', '2026-11-03']);
    assert.equal(all[0].kind, 'Meeting'); // the same day: the latest logged first
  });

  it('names a group and sums only what counts', () => {
    assert.deepEqual(LOG_GROUPS.map(([k]) => logGroupLabel(k)), ['Day', 'Week', 'Item', 'Kind']);
    assert.equal(logGroupLabel(null), 'None');
    assert.equal(groupName('week', '2026-W45'), 'W45 · Nov 2 – Nov 8');
    assert.equal(groupName('kind', 'Testing'), 'Testing');
    // Tentative and suggested rows are not counted.
    assert.equal(groupSummary(ROWS), '2 entries · 01:30');
    assert.equal(groupSummary([ROWS[0]]), '1 entry · 01:00');
  });
});
