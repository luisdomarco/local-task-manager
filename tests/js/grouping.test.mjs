import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GROUPS, NONE, ancestorsOf, directed, initiativeOf, planBucket, projectOf, topInitiativeOf } from '../../static/js/grouping.js';

const item = (id, type, related_to) => ({ id, type, fields: { related_to } });
const byIdOf = (...items) => new Map(items.map((i) => [i.id, i]));

describe('grouping', () => {
  const ini = item('INI-1', 'initiative');
  const story = item('US-1', 'story', 'INI-1');
  const task = item('TSK-1', 'task', 'US-1');
  const byId = byIdOf(ini, story, task);

  it('walks up the parents, nearest first', () => {
    assert.deepEqual(ancestorsOf(task, byId).map((p) => p.id), ['US-1', 'INI-1']);
    assert.deepEqual(ancestorsOf(ini, byId), []);
  });

  it('stops on a loop in the data', () => {
    const a = item('TSK-A', 'task', 'TSK-B');
    const b = item('TSK-B', 'task', 'TSK-A');
    assert.deepEqual(ancestorsOf(a, byIdOf(a, b)).map((p) => p.id), ['TSK-B']);
  });

  it('finds the initiative through a story', () => {
    assert.equal(initiativeOf(task, byId), 'INI-1');
    assert.equal(initiativeOf(item('TSK-2', 'task'), byId), NONE);
  });

  it('orders groups: status by workflow, priority by rank, no initiative last', () => {
    assert.deepEqual(['Done', 'Backlog', 'InProgress'].sort(GROUPS.status.order), ['Backlog', 'InProgress', 'Done']);
    assert.deepEqual(['P3', 'P0', 'P2'].sort(GROUPS.priority.order), ['P0', 'P2', 'P3']);
    const two = byIdOf({ id: 'INI-2', title: 'Beta' }, { id: 'INI-3', title: 'Alpha' });
    assert.deepEqual([NONE, 'INI-2', 'INI-3'].sort((a, b) => GROUPS.initiative.order(a, b, two)), ['INI-3', 'INI-2', NONE]);
  });

  it('groups by who the work is handed to, by name, with nobody last', () => {
    const of = (name) => GROUPS.responsible.by({ fields: name ? { responsible: name } : {} });
    assert.equal(of('Ana'), 'Ana');
    assert.equal(of(), NONE);
    assert.deepEqual([NONE, 'Luis', 'Ana'].sort(GROUPS.responsible.order), ['Ana', 'Luis', NONE]);
  });

  it('orders status groups as the list\'s own type lists them, whatever another type says', () => {
    // A goal starts at ToDo, a project at Backlog: in Projects, Backlog goes first.
    const inList = (types) => (a, b) => GROUPS.status.order(a, b, new Map(), undefined, types);
    assert.deepEqual(['InProgress', 'ToDo', 'Backlog'].sort(inList(['project'])), ['Backlog', 'ToDo', 'InProgress']);
    assert.deepEqual(['InProgress', 'ToDo', 'Done'].sort(inList(['goal'])), ['ToDo', 'InProgress', 'Done']);
    // a status the list's types do not have still sorts, by any type's
    assert.deepEqual(['Review', 'Backlog'].sort(inList(['project'])), ['Backlog', 'Review']);
  });

  it('reverses groups on descending, the one with no value still last', () => {
    const gs = [{ key: 'a' }, { key: 'b' }, { key: NONE }];
    assert.deepEqual(directed(gs, true).map((g) => g.key), ['b', 'a', NONE]);
    assert.equal(directed(gs, false), gs);
    assert.deepEqual(directed([['x', []], ['y', []]], true, (g) => g[0]).map((g) => g[0]), ['y', 'x']);
  });

  it('groups a Ticketing item by its project key, by name, no project last', () => {
    assert.equal(projectOf({ fields: { project: 'HB' } }), 'HB');
    assert.equal(projectOf(item('TSK-3', 'task')), NONE);
    const names = { HB: 'Internal Tools', ECD: 'Acme Web' };
    assert.deepEqual([NONE, 'HB', 'ECD'].sort((a, b) => GROUPS.project.order(a, b, byId, (k) => names[k])), ['ECD', 'HB', NONE]);
    assert.deepEqual(['HB', NONE, 'ECD'].sort((a, b) => GROUPS.project.order(a, b, byId)), ['ECD', 'HB', NONE]); // no names: by key
  });

  it('finds a Ticketing note\'s initiative through the task it hangs from', () => {
    const tk = item('TSK-9', 'task', 'INI-1');
    const note = item('NOTE-1', 'note', 'TSK-9');
    assert.equal(initiativeOf(note, byIdOf(ini, tk, note)), 'INI-1');
  });

  it('groups an initiative with its epics, under the top one, which leads its group', () => {
    const epic = item('INI-2', 'initiative', 'INI-1');
    const sub = item('INI-3', 'initiative', 'INI-2');
    const us = item('US-2', 'story', 'INI-2');
    const all = byIdOf(ini, epic, sub, us);
    assert.deepEqual([ini, epic, sub].map((i) => topInitiativeOf(i, all)), ['INI-1', 'INI-1', 'INI-1']);
    assert.deepEqual([ini, epic, sub].map((i) => GROUPS.initiative.by(i, all)), ['INI-1', 'INI-1', 'INI-1']);
    assert.equal(GROUPS.initiative.by(us, all), 'INI-2'); // a story still falls under its nearest one
    assert.equal(GROUPS.initiative.lead('INI-1', ini), true);
    assert.equal(GROUPS.initiative.lead('INI-1', epic), false);
  });

  it('puts an item with no status or priority in the defaults', () => {
    assert.equal(GROUPS.status.by(item('T', 'task')), 'Backlog');
    assert.equal(GROUPS.priority.by(item('T', 'task')), 'Normal');
  });

  describe('planBucket (today: Thursday 2026-10-15, week 2026-W42)', () => {
    const NOW = '2026-10-15';
    const plan = (fields, status = 'ToDo') => planBucket({ type: 'task', fields: { status, ...fields } }, NOW);

    it('by the day when there is one, the week ignored', () => {
      assert.equal(plan({ plan_day: '2026-10-15', plan_week: '2026-W44' }), 'today');
      assert.equal(plan({ plan_day: '2026-10-16' }), 'week'); // tomorrow is no group of its own: its week's
      assert.equal(plan({ plan_day: '2026-10-18' }), 'week'); // Sunday of this week
      assert.equal(plan({ plan_day: '2026-10-21' }), 'nextweek');
      assert.equal(plan({ plan_day: '2026-11-30' }), 'later');
    });

    it('a past plan: overdue while open, planned before once closed', () => {
      assert.equal(plan({ plan_day: '2026-10-14', plan_week: '2026-W43' }), 'overdue');
      assert.equal(plan({ plan_day: '2026-10-14' }, 'Done'), 'past');
      assert.equal(plan({ plan_week: '2026-W40' }), 'overdue');
      assert.equal(plan({ plan_week: '2026-W40' }, 'Discarded'), 'past');
    });

    it('a week alone: this week whatever the day, then next week, then later', () => {
      assert.equal(plan({ plan_week: '2026-W42' }), 'week');
      assert.equal(plan({ plan_week: '2026-W43' }), 'nextweek');
      assert.equal(plan({ plan_week: '2026-W50' }), 'later');
      assert.equal(plan({}), NONE);
    });

    it('after next week, what falls in this month is Later this month; a month alone counts too', () => {
      assert.equal(plan({ plan_week: '2026-W44' }), 'month'); // its Thursday, Oct 29
      assert.equal(plan({ plan_day: '2026-10-28' }), 'month');
      assert.equal(plan({ plan_month: '2026-10' }), 'month');
      assert.equal(plan({ plan_month: '2026-11' }), 'later');
      assert.equal(plan({ plan_month: '2026-09' }), 'overdue');
      assert.equal(plan({ plan_month: '2026-09' }, 'Done'), 'past');
      assert.equal(plan({ plan_day: '2026-10-16', plan_month: '2026-09' }), 'week'); // the day wins
    });
  });
});
