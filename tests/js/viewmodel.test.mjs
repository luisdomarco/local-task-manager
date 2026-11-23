import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { NONE } from '../../static/js/grouping.js';
import {
  cardShows, closedLast, closedShown, columnOn, columnOrder, displayProps, emptyKeys, filterFields, filterText, fitView, groupItems, groupOptions, hiddenColumns, matches, migrateView, phoneExtraOrder, phoneLines, planText, plannedFor, sortColumn, stackOf, valueCounts,
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

    it('a responsible filter offers the vault\'s people and the names on the rows, Nobody last', () => {
      const f = fields.find((x) => x.key === 'responsible');
      const rows = [task('TSK-9', { responsible: 'Zoe' }), task('TSK-8')];
      assert.deepEqual(f.values({ ...ctx, people: ['Ana', 'Luis'] }, rows).map((v) => v.label), ['Ana', 'Luis', 'Zoe', 'Nobody']);
      // Contacts → You: your own name comes first, said so
      assert.deepEqual(f.values({ ...ctx, people: ['Ana', 'Luis'], me: 'Luis' }, rows).map((v) => v.label),
        ['Luis (you)', 'Ana', 'Zoe', 'Nobody']);
      assert.deepEqual(f.of(rows[0]), ['Zoe']);
      assert.deepEqual(f.of(rows[1]), [NONE]);
      assert.ok(!filterFields(['initiative'], ctx).some((x) => x.key === 'responsible'), 'an initiative is handed to nobody');
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

    it('goes the way picked and by the list\'s types: Projects from Backlog, or reversed', () => {
      const proj = (id, status) => ({ id, key: id, type: 'project', title: id, fields: { status } });
      const ps = [proj(1, 'ToDo'), proj(2, 'InProgress'), proj(3, 'Backlog')];
      assert.deepEqual(groupItems(ps, 'status', { types: ['project'] }).map((g) => g.key), ['Backlog', 'ToDo', 'InProgress']);
      assert.deepEqual(groupItems(ps, 'status', { types: ['project'], desc: true }).map((g) => g.key), ['InProgress', 'ToDo', 'Backlog']);
      const status = filterFields(['project'], ctx).find((f) => f.key === 'status');
      assert.deepEqual(status.values(ctx, ps).map((v) => v.value).slice(0, 2), ['Backlog', 'ToDo']);
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

  it('draws the columns in the one order of properties whatever the structure\'s, the rest after in theirs (TSK-128)', () => {
    const keys = (ks) => columnOrder(ks.map((key) => ({ key }))).map((c) => c.key);
    // Status · Priority · Project / Related to · Planned · Due · Labels · Updated · ID · Type
    assert.deepEqual(keys(['id', 'subject', 'status', 'priority', 'plan', 'due', 'labels', 'project', 'initiative', 'parent', 'updated_at']),
      ['subject', 'status', 'priority', 'project', 'initiative', 'parent', 'plan', 'due', 'labels', 'updated_at', 'id']);
    assert.deepEqual(keys(['pick', 'id', 'subject']), ['pick', 'subject', 'id']); // the box and the Subject first
    assert.deepEqual(keys(['subjectPlain', 'prop:kind', 'project']), ['subjectPlain', 'project', 'prop:kind']);
    assert.deepEqual(keys(['id', 'subject', 'status', 'type', 'updated_at']), ['subject', 'status', 'updated_at', 'id', 'type']); // the List page's Type, last
    // a type's own columns right after the dates, then Progress, Labels, its sources, Created / Updated, ID and Type
    assert.deepEqual(keys(['id', 'subject', 'labels', 'project', 'created_at', 'updated_at', 'prop:size', 'date']),
      ['subject', 'project', 'date', 'prop:size', 'labels', 'created_at', 'updated_at', 'id']);
    assert.deepEqual(keys(['subject', 'source', 'from', 'priority', 'labels', 'date', 'resolved', 'extref', 'progress']),
      ['subject', 'priority', 'date', 'progress', 'labels', 'source', 'from', 'extref', 'resolved']);
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

  describe('a phone\'s agenda row: when it is planned', () => {
    // freezeDate: Thursday 2026-10-15, week 2026-W42
    it('its day, week or month, with its time after a day', () => {
      assert.deepEqual(plannedFor({ plan_day: '2026-10-15' }), { text: 'Today', late: false });
      assert.deepEqual(plannedFor({ plan_day: '2026-10-15', plan_time: '13:30' }), { text: 'Today 13:30', late: false });
      assert.deepEqual(plannedFor({ plan_day: '2026-10-20', plan_time: '09:00' }), { text: 'Tue 20 09:00', late: false });
      assert.deepEqual(plannedFor({ plan_week: '2026-W42' }), { text: 'This week', late: false });
      assert.deepEqual(plannedFor({}), { text: '', late: false });
    });
    it('past it, the day it was for and how late', () => {
      assert.deepEqual(plannedFor({ plan_day: '2026-09-26' }), { text: 'Sep 26 · 19 d late', late: true });
      assert.deepEqual(plannedFor({ plan_day: '2026-10-14', plan_time: '07:43' }), { text: 'Oct 14 07:43 · Yesterday', late: true });
    });
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

  describe('Display → Show properties (a list\'s columns, a board\'s cards)', () => {
    it('offers the list\'s columns, in the one order, without the box and the Subject (the same on a board, TSK-128)', () => {
      const col = (key, label = key) => ({ key, label });
      const cols = [{ key: 'pick', label: {} }, col('id', 'ID'), col('subject', 'Subject'), col('type', 'Type'), col('status', 'Status'),
        col('priority', 'Priority'), col('project', 'Project'), col('parent', 'Related to'), col('plan', 'Planned'), col('due', 'Due date'),
        col('labels', 'Labels'), col('updated_at', 'Updated')];
      assert.deepEqual(displayProps(cols).map(([, l]) => l),
        ['Status', 'Priority', 'Project', 'Related to', 'Planned', 'Due date', 'Labels', 'Updated', 'ID', 'Type']);
      assert.deepEqual(displayProps([col('subjectPlain', 'Subject'), col('prop:size', 'Size'), col('state', 'State')]).map(([k]) => k), ['state', 'prop:size']);
    });

    it('a board shows status, priority, plan and where it hangs by default (no id, no labels), and what the view says over that', () => {
      const view = migrateView(null);
      assert.deepEqual(['status', 'priority', 'id', 'plan', 'labels', 'parent', 'initiative', 'due', 'project', 'extref', 'updated_at', 'type', 'prop:size'].map((k) => cardShows(view, k)),
        [true, true, false, true, false, true, true, false, false, false, false, false, false]);
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

describe("a phone's row", () => {
  it('splits what Display shows into where it hangs, status + priority, the dates, and the rest, each once', () => {
    const story = ['status', 'priority', 'project', 'initiative', 'plan', 'due', 'labels', 'updated_at', 'id'];
    assert.deepEqual(phoneLines(story), { where: ['initiative', 'project'], main: ['status', 'priority'], when: ['plan', 'due'], extra: ['labels', 'updated_at', 'id'] });
    const keys = (r) => [...r.where, ...r.main, ...r.when, ...r.extra].sort();
    assert.deepEqual(keys(phoneLines(story)), [...story].sort());
  });

  it('offers a meeting its Date, and nothing for nothing', () => {
    assert.deepEqual(phoneLines(['date', 'parent']), { where: ['parent'], main: [], when: ['date'], extra: [] });
    assert.deepEqual(phoneLines([]), { where: [], main: [], when: [], extra: [] });
  });
  it("orders a phone row's last line alike for every type: dates, the type's own, progress, labels, sources, then made and changed", () => {
    assert.deepEqual(phoneExtraOrder(['labels', 'prop:size', 'progress', 'updated_at', 'due']), ['due', 'prop:size', 'progress', 'labels', 'updated_at']);
    assert.deepEqual(phoneExtraOrder(['source', 'from', 'labels', 'time', 'resolved', 'updated_at', 'created_at']),
      ['time', 'labels', 'source', 'from', 'resolved', 'created_at', 'updated_at']);
    assert.deepEqual(phoneExtraOrder(['extref', 'labels', 'prop:initiative_kind', 'progress']), ['prop:initiative_kind', 'progress', 'labels', 'extref']);
    assert.deepEqual(phoneExtraOrder(['prop:severity', 'prop:impact', 'updated_at']), ['prop:severity', 'prop:impact', 'updated_at']);
  });

  it('starts with the ID off on a phone only, and keeps what was picked', () => {
    assert.equal(columnOn({}, 'id'), true);
    assert.equal(columnOn({}, 'id', { narrow: true }), false);
    assert.equal(columnOn({ id: true }, 'id', { narrow: true }), true);
    assert.equal(columnOn({ id: false }, 'id'), false);
    assert.equal(columnOn({}, 'goal', { narrow: true }), false);
    assert.equal(columnOn({}, 'due', { narrow: true }), true);
  });

  it('lays out the rest side by side unless One per line is picked', () => {
    assert.equal(stackOf({}), 'wrap');
    assert.equal(stackOf({ stack: 'lines' }), 'lines');
    assert.equal(stackOf({ stack: 'nonsense' }), 'wrap');
  });
});
