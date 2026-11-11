import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { NONE } from '../../static/js/grouping.js';
import {
  cardProps, cardShows, closedLast, closedShown, columnOrder, emptyKeys, filterFields, filterText, fitView, groupItems, groupOptions, hiddenColumns, matches, migrateView, planText, sortColumn, valueCounts,
} from '../../static/js/viewmodel.js';
import { freezeDate, unfreezeDate } from './helpers.mjs';

const task = (id, fields = {}) => ({ id, key: id, type: 'task', title: id, fields: { status: 'Backlog', ...fields } });
const ini = (id, title, fields = {}) => ({ id, key: id, type: 'initiative', title, fields: { status: 'Backlog', ...fields } });

describe('viewmodel', () => {
  before(() => freezeDate());
  after(() => unfreezeDate());

  const acme = ini('INI-1', 'Checkout', { project: 'ACME' });
  const office = ini('INI-2', 'Office', { project: 'HQ' });
  const story = { id: 'STY-1', key: 'STY-1', type: 'story', title: 'Cart', fields: { status: 'ToDo', related_to: 'INI-1', project: 'ACME' } };
  const a = task('TSK-1', { related_to: 'STY-1', project: 'ACME', priority: 'P1', labels: ['infra', 'checkout'] });
  const b = task('TSK-2', { related_to: 'INI-2', project: 'HQ', status: 'InProgress', labels: ['infra'] });
  const c = task('TSK-3', { status: 'Done', completed_at: '2026-10-14T10:00:00' });
  const items = [a, b, c];
  const ctx = { byId: new Map([acme, office, story, a, b, c].map((i) => [i.id, i])), labels: ['infra', 'checkout', 'docs'], projectName: (k) => k };

  describe('fields', () => {
    const fields = filterFields(['task'], ctx);
    const keys = fields.map((f) => f.key);

    it('come from the structure: a task filters by status, priority, project, initiative, parent, plan, labels', () => {
      for (const k of ['status', 'priority', 'project', 'initiative', 'parent', 'plan', 'labels']) assert.ok(keys.includes(k), k);
      assert.ok(!keys.includes('type'), 'one type: no Type field');
      assert.ok(!keys.includes('source'), 'a task has no source');
    });

    it('a page of several types adds Type; a meeting adds Date, a support its Level', () => {
      assert.ok(filterFields(['task', 'note'], ctx).some((f) => f.key === 'type'));
      const date = filterFields(['meeting'], ctx).find((f) => f.key === 'date');
      assert.deepEqual(date.values().map((v) => v.value), ['today', 'week', 'nextweek', 'month']);
      const on = (d) => date.of({ fields: { date: d } }, ctx);
      assert.deepEqual(on('2026-10-15'), ['today', 'week', 'month']);
      assert.deepEqual(on('2026-10-16'), ['week', 'month']); // tomorrow: this week
      assert.deepEqual(on('2026-10-20'), ['nextweek', 'month']);
      assert.deepEqual(on('2026-11-02'), []);
      const sup = filterFields(['support'], ctx);
      assert.ok(sup.some((f) => f.key === 'prop:level'));
      assert.ok(!sup.some((f) => f.key === 'priority'), 'a support has a level, no priority');
    });

    it('an initiative filter takes in what hangs from it at any depth', () => {
      const f = fields.find((x) => x.key === 'initiative');
      assert.deepEqual(f.of(a, ctx), ['INI-1']); // task → story → initiative
      assert.deepEqual(f.of(c, ctx), [NONE]);
    });
  });

  describe('matches', () => {
    const fields = filterFields(['task'], ctx);
    const pass = (filters) => items.filter((i) => matches(i, filters, fields, ctx)).map((i) => i.id);

    it('"is" keeps the items holding any picked value', () => {
      assert.deepEqual(pass([{ field: 'status', op: 'is', values: ['Backlog', 'InProgress'] }]), ['TSK-1', 'TSK-2']);
      assert.deepEqual(pass([{ field: 'labels', op: 'is', values: ['checkout'] }]), ['TSK-1']);
    });

    it('"is not" keeps the items holding none of them', () => {
      assert.deepEqual(pass([{ field: 'labels', op: 'isnot', values: ['infra'] }]), ['TSK-3']);
      assert.deepEqual(pass([{ field: 'project', op: 'isnot', values: ['ACME'] }]), ['TSK-2', 'TSK-3']);
    });

    it('several filters all apply; an empty one or a field the page lacks lets everything through', () => {
      assert.deepEqual(pass([{ field: 'labels', op: 'is', values: ['infra'] }, { field: 'status', op: 'isnot', values: ['InProgress'] }]), ['TSK-1']);
      assert.deepEqual(pass([{ field: 'status', op: 'is', values: [] }, { field: 'source', op: 'is', values: ['Email'] }]), ['TSK-1', 'TSK-2', 'TSK-3']);
    });

    it('an old "All (AND)" label filter wants every label', () => {
      assert.deepEqual(pass([{ field: 'labels', op: 'is', values: ['infra', 'checkout'], all: true }]), ['TSK-1']);
    });

    it('says itself as its chip does', () => {
      assert.equal(filterText({ field: 'labels', op: 'isnot', values: ['infra', NONE] }, fields, ctx, items), 'Labels is not infra, No labels');
    });
  });

  it('counts how many items hold each value (one item counts once per value)', () => {
    const fields = filterFields(['task'], ctx);
    assert.deepEqual(valueCounts(items, fields.find((f) => f.key === 'labels'), ctx), { infra: 2, checkout: 1, [NONE]: 1 });
    assert.deepEqual(valueCounts(items, fields.find((f) => f.key === 'status'), ctx), { Backlog: 1, InProgress: 1, Done: 1 });
  });

  describe('grouping', () => {
    it('offers the structure\'s groups and Label', () => {
      const opts = groupOptions(['task']);
      assert.ok(opts.includes('status') && opts.includes('label'));
    });

    it('puts an item in each of its labels\' groups, the unlabelled last', () => {
      const groups = groupItems(items, 'label', ctx);
      assert.deepEqual(groups.map((g) => [g.key, g.items.map((i) => i.id)]), [['checkout', ['TSK-1']], ['infra', ['TSK-1', 'TSK-2']], [NONE, ['TSK-3']]]);
    });

    it('keeps the empty groups when asked, in the group\'s order', () => {
      const fields = filterFields(['task'], ctx);
      const keys = emptyKeys('status', fields, ctx, items);
      const groups = groupItems(items, 'status', { ...ctx, showEmpty: true, keys });
      assert.ok(groups.some((g) => g.key === 'ToDo' && g.items.length === 0));
      assert.equal(groups[0].key, 'Backlog');
      assert.equal(groupItems(items, 'status', ctx).some((g) => g.key === 'ToDo'), false);
    });

    it('keeps Planned\'s empty groups by its buckets, not by the filter\'s values', () => {
      const keys = emptyKeys('plan', filterFields(['task'], ctx), ctx, items);
      assert.deepEqual(keys.slice(0, 3), ['overdue', 'today', 'week']);
      assert.ok(keys.includes(NONE) && !keys.includes('past'));
    });

    it('sorts inside each group', () => {
      const two = [task('TSK-8', { priority: 'P3' }), task('TSK-9', { priority: 'P0' })];
      const [g] = groupItems(two, 'status', { sort: (x, y) => x.fields.priority.localeCompare(y.fields.priority) });
      assert.deepEqual(g.items.map((i) => i.id), ['TSK-9', 'TSK-8']);
    });
  });

  describe('closed items', () => {
    const now = Date.parse('2026-10-15T12:00:00');
    const old = task('TSK-4', { status: 'Done', completed_at: '2026-09-01T10:00:00' });
    const all = [...items, old];

    it('None hides them and says how many', () => {
      const r = closedShown(all, 'none', { now });
      assert.deepEqual(r.items.map((i) => i.id), ['TSK-1', 'TSK-2']);
      assert.equal(r.hidden, 2);
    });

    it('Last week shows those closed in the last seven days; All every one', () => {
      assert.deepEqual(closedShown(all, 'week', { now }).items.map((i) => i.id), ['TSK-1', 'TSK-2', 'TSK-3']);
      assert.equal(closedShown(all, 'all', { now }).hidden, 0);
    });

    it('go after the open ones', () => {
      assert.deepEqual(closedLast([c, a, b]).map((i) => i.id), ['TSK-1', 'TSK-2', 'TSK-3']);
    });
  });

  describe('columns on a narrow window', () => {
    const cols = [
      { key: 'pick', width: 40 }, { key: 'id', width: 64 }, { key: 'subject', width: 0 }, { key: 'status', width: 116 },
      { key: 'priority', width: 90 }, { key: 'initiative', width: 180 }, { key: 'plan', width: 120 }, { key: 'due', width: 90 },
      { key: 'updated_at', width: 100 },
    ];
    const total = 40 + 64 + 220 + 116 + 90 + 180 + 120 + 90 + 100;

    it('hides nothing when everything fits', () => assert.deepEqual(hiddenColumns(cols, total), []));
    it('gives way in order: extra columns, Due, a parent, Labels, Project, Initiative, Planned', () => {
      const all = [...cols, { key: 'project', width: 120 }, { key: 'parent', width: 150 }, { key: 'labels', width: 140 }];
      const sum = total + 120 + 150 + 140;
      assert.deepEqual(hiddenColumns(all, sum), []);
      assert.deepEqual(hiddenColumns(all, sum - 1), ['updated_at']);
      assert.deepEqual(hiddenColumns(all, sum - 101), ['updated_at', 'due']);
      assert.deepEqual(hiddenColumns(all, sum - 191), ['updated_at', 'due', 'parent']);
      assert.deepEqual(hiddenColumns(all, sum - 341), ['updated_at', 'due', 'parent', 'labels']);
      assert.deepEqual(hiddenColumns(all, 300), ['updated_at', 'due', 'parent', 'labels', 'project', 'initiative', 'plan']);
    });
    it('keeps the List page\'s Type to the last: it says what each row is', () => {
      const all = [...cols, { key: 'type', width: 112 }];
      assert.deepEqual(hiddenColumns(all, total + 112 - 1), ['updated_at']);
      assert.deepEqual(hiddenColumns(all, 300), ['updated_at', 'due', 'initiative', 'plan', 'type']);
    });
  });

  it('draws the columns in the list\'s order whatever the structure\'s, the rest after in theirs', () => {
    const keys = (ks) => columnOrder(ks.map((key) => ({ key }))).map((c) => c.key);
    assert.deepEqual(keys(['id', 'subject', 'status', 'priority', 'plan', 'due', 'labels', 'project', 'initiative', 'parent', 'updated_at']),
      ['id', 'subject', 'status', 'priority', 'initiative', 'project', 'parent', 'plan', 'due', 'labels', 'updated_at']); // labels: a column of its own
    assert.deepEqual(keys(['subjectPlain', 'prop:kind', 'project']), ['subjectPlain', 'project', 'prop:kind']);
    assert.deepEqual(keys(['id', 'subject', 'status', 'type', 'updated_at']), ['id', 'subject', 'type', 'status', 'updated_at']); // the List page's Type
    // a type's own columns between the common ones and Created / Updated, which close every list
    assert.deepEqual(keys(['id', 'subject', 'labels', 'project', 'created_at', 'updated_at', 'prop:size', 'date']),
      ['id', 'subject', 'project', 'date', 'labels', 'prop:size', 'created_at', 'updated_at']);
  });

  it('sorts by the sort\'s column even when it is not shown, never by the ticks', () => {
    const pick = { key: 'pick' };
    const all = [{ key: 'id' }, { key: 'subject' }, { key: 'updated_at' }, pick];
    // Updated left out for width: the table draws [pick, id, subject] but still orders by Updated
    assert.equal(sortColumn({ col: 'updated_at', dir: -1 }, all).key, 'updated_at');
    assert.equal(sortColumn({ col: 'pick', dir: 1 }, all), pick); // the ticks, when that is what was clicked
    // a sort by a column that is gone: the first one the list has, not the ticks drawn first
    assert.equal(sortColumn({ col: 'redmine', dir: 1 }, all).key, 'id');
    assert.equal(sortColumn(undefined, all).key, 'id');
  });

  describe('a row\'s Planned', () => {
    // freezeDate: Thursday 2026-10-15, week 2026-W42
    it('says the day, the week or the month, short', () => {
      assert.equal(planText({ plan_day: '2026-10-15' }).text, 'Today');
      assert.equal(planText({ plan_day: '2026-10-16' }).text, 'Fri 16'); // tomorrow by its day, as any other
      assert.equal(planText({ plan_day: '2026-10-20' }).text, 'Tue 20');
      assert.equal(planText({ plan_week: '2026-W42' }).text, 'This week');
      assert.equal(planText({ plan_week: '2026-W45' }).text, 'W45');
      assert.deepEqual(planText({}), { text: 'Not planned', late: false, none: true });
    });

    it('past its plan, how late, marked late', () => {
      assert.deepEqual(planText({ plan_day: '2026-09-26' }), { text: '19 d late', late: true, since: 'Sep 26' });
      assert.equal(planText({ plan_week: '2026-W40' }).late, true);
    });
  });

  describe('a board\'s cards (Display → Show on cards)', () => {
    it('offer what the type has, in Display\'s order', () => {
      const keys = cardProps(['task']).map(([k]) => k);
      for (const k of ['parent', 'priority', 'id', 'plan', 'labels']) assert.ok(keys.includes(k), k);
      assert.deepEqual(keys.slice(0, 3), ['status', 'priority', 'id']); // status before priority, as a list's columns
      assert.ok(keys.indexOf('labels') < keys.indexOf('parent'), 'the meta row first, then where it hangs');
      assert.ok(!cardProps(['note']).some(([k]) => k === 'priority'), 'a note has no priority');
    });

    it('show status, priority, plan and parent by default (no id, no labels), and what the view says over that', () => {
      const view = migrateView(null);
      assert.deepEqual(['status', 'priority', 'id', 'plan', 'labels', 'parent', 'due', 'project', 'extref'].map((k) => cardShows(view, k)),
        [true, true, false, true, false, true, false, false, false]);
      const mine = { ...view, cards: { id: true, due: true } };
      assert.equal(cardShows(mine, 'id'), true);
      assert.equal(cardShows(mine, 'due'), true);
    });

    it('a saved view keeps its cards', () => {
      assert.deepEqual(migrateView({ ...migrateView(null), cards: { due: true } }).cards, { due: true });
    });
  });

  describe('a saved view from before', () => {
    it('keeps its filters, grouping and scope', () => {
      const v = migrateView({ scope: 'open', groupBy: 'project', status: ['ToDo'], priority: [], project: 'ACME', plan: 'week', labels: ['infra'], labelMode: 'and' });
      assert.equal(v.v, 2);
      assert.equal(v.closed, 'none');
      assert.equal(v.groupBy, 'project');
      assert.deepEqual(v.filters.map((f) => [f.field, f.values]), [['status', ['ToDo']], ['project', ['ACME']], ['plan', ['week']], ['labels', ['infra']]]);
      assert.equal(v.filters.find((f) => f.field === 'labels').all, true);
    });

    it('turns a meeting\'s date scope into a Date filter, and All into every closed one', () => {
      assert.deepEqual(migrateView({ scope: 'week' }).filters, [{ field: 'date', op: 'is', values: ['week'] }]);
      assert.deepEqual(migrateView({ scope: 'tomorrow' }).filters, [], 'Tomorrow is gone: every date shows');
      assert.equal(migrateView({ scope: 'all' }).closed, 'all');
      assert.equal(migrateView(null).closed, 'none');
    });

    it('drops Tomorrow from a saved Planned or Date filter, and the filter with nothing left', () => {
      const v = migrateView({ v: 2, filters: [{ field: 'plan', op: 'is', values: ['tomorrow', 'week'] }, { field: 'date', op: 'is', values: ['tomorrow'] },
        { field: 'status', op: 'is', values: ['ToDo'] }] });
      assert.deepEqual(v.filters.map((f) => [f.field, f.values]), [['plan', ['week']], ['status', ['ToDo']]]);
    });

    it('drops what the page no longer has', () => {
      const fields = filterFields(['task'], ctx);
      const v = fitView({ ...migrateView(null), filters: [{ field: 'source', op: 'is', values: ['Email'] }, { field: 'status', op: 'is', values: ['ToDo'] }], groupBy: 'kind' }, fields, groupOptions(['task']));
      assert.deepEqual(v.filters.map((f) => f.field), ['status']);
      assert.equal(v.groupBy, null);
    });
  });
});
