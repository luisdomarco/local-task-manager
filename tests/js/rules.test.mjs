import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  PARENT_TYPES, PLANNABLE, PLAN_FILTERS, carriedOverDay, carriedOverWeek, isArchived, isDone, isOverdue, isPlannedToday, planFilter,
} from '../../static/js/rules.js';
import { freezeDate, unfreezeDate } from './helpers.mjs';

const task = (fields) => ({ type: 'task', fields });

describe('rules', () => {
  beforeEach(freezeDate);
  afterEach(unfreezeDate);

  it('closes by status, and activities by resolution', () => {
    assert.equal(isDone(task({ status: 'Done' })), true);
    assert.equal(isDone(task({ status: 'Discarded' })), true);
    assert.equal(isDone(task({ status: 'InProgress' })), false);
    assert.equal(isDone({ type: 'activity', fields: { resolved_at: '2026-10-14T10:00' } }), true);
    assert.equal(isDone({ type: 'activity', fields: { status: 'Done' } }), false); // an activity has no status
  });

  it('archives only on an explicit true', () => {
    assert.equal(isArchived(task({ archived: true })), true);
    assert.equal(isArchived(task({ archived: false })), false);
    assert.equal(isArchived(task({})), false);
  });

  it('carries over open planned items from past days and weeks', () => {
    assert.equal(carriedOverDay(task({ plan_day: '2026-10-12', status: 'ToDo' })), true);
    assert.equal(carriedOverDay(task({ plan_day: '2026-10-12', status: 'Done' })), false);
    assert.equal(carriedOverDay(task({ plan_day: '2026-10-15', status: 'ToDo' })), false); // today is not carried over
    assert.equal(carriedOverDay({ type: 'note', fields: { plan_day: '2026-10-01' } }), false); // only plannable types
    assert.equal(carriedOverWeek(task({ plan_week: '2026-W40', status: 'ToDo' })), true);
    assert.equal(carriedOverWeek(task({ plan_week: '2026-W42', status: 'ToDo' })), false);
  });

  it('tells overdue from due', () => {
    assert.equal(isOverdue(task({ due: '2026-10-14', status: 'ToDo' })), true);
    assert.equal(isOverdue(task({ due: '2026-10-15', status: 'ToDo' })), false);
    assert.equal(isOverdue(task({ due: '2026-10-14', status: 'Done' })), false);
    assert.equal(isPlannedToday(task({ plan_day: '2026-10-15' })), true);
  });

  it('filters by plan', () => {
    assert.equal(planFilter('today')(task({ plan_day: '2026-10-15' })), true);
    assert.equal(planFilter('today')(task({ plan_day: '2026-10-12', status: 'ToDo' })), true); // carried over counts
    assert.equal(planFilter('tomorrow')(task({ plan_day: '2026-10-16' })), true);
    assert.equal(planFilter('nextweek')(task({ plan_week: '2026-W43' })), true);
    assert.equal(planFilter('overdue')(task({ due: '2026-10-01', status: 'ToDo' })), true);
    assert.equal(planFilter('whatever')(task({})), true); // an unknown key means "any"
    assert.ok(Object.keys(PLAN_FILTERS).includes('any'));
  });

  it('keeps the relation table consistent', () => {
    const types = Object.keys(PARENT_TYPES);
    for (const [type, parents] of Object.entries(PARENT_TYPES)) {
      for (const p of parents) assert.ok(types.includes(p), `${type} may hang from ${p}, which is not a type`);
      assert.ok(!parents.includes('inbox') && !parents.includes('prompt'), `${type} cannot hang from an inbox item or a prompt`);
    }
    assert.deepEqual(PARENT_TYPES.transcription, ['meeting']);
    assert.deepEqual(PARENT_TYPES.prompt, []);
    assert.deepEqual([...PLANNABLE].sort(), ['initiative', 'story', 'task']);
  });
});

describe('status groups (TSK-037)', () => {
  it('groups a status by its type: the vault\'s arrangement, else closed · not started · under way', async () => {
    const { groupOf, statusFor, statusRank, statusTree } = await import('../../static/js/rules.js');
    assert.equal(groupOf('task', 'ToDo'), 'not_started');
    assert.equal(groupOf('task', 'Blocked'), 'in_progress');
    assert.equal(groupOf('task', 'Discarded'), 'closed');
    assert.equal(groupOf('agent', 'Live'), 'in_progress');
    assert.equal(groupOf('agent', 'Retired'), 'closed');
    // closing takes the first closed status, reopening the last one not started
    assert.equal(statusFor('task', true), 'Done');
    assert.equal(statusFor('task', false), 'ToDo');
    assert.equal(statusFor('agent', true), 'Retired');
    assert.equal(statusFor('agent', false), 'Idea');
    assert.ok(statusRank('task', 'Backlog') < statusRank('task', 'Review'));
    assert.ok(statusRank('task', 'Review') < statusRank('task', 'Done'));
    const tree = statusTree(['task', 'agent']);
    assert.deepEqual(tree.map(([g]) => g), ['not_started', 'in_progress', 'closed']);
    assert.deepEqual(tree[2][2], ['Done', 'Discarded', 'Retired']);
  });

  it('follows a vault that moved a status to another group', async () => {
    const { groupOf, isDone, setStructure, statusFor, statusPasses } = await import('../../static/js/rules.js');
    const { FOLDER_PER_TYPE } = await import('../../static/js/structure.js');
    const moved = {
      ...FOLDER_PER_TYPE,
      types: FOLDER_PER_TYPE.types.map((t) => (t.name !== 'task' ? t : {
        ...t, statuses: ['Backlog', 'Doing', 'Shipped'], closed: ['Shipped'],
        groups: { Backlog: 'not_started', Doing: 'in_progress', Shipped: 'closed' },
      })),
    };
    setStructure(moved);
    try {
      assert.equal(groupOf('task', 'Doing'), 'in_progress');
      assert.equal(isDone(task({ status: 'Shipped' })), true);
      assert.equal(isDone(task({ status: 'Done' })), false); // not a task's status any more
      assert.equal(statusFor('task', true), 'Shipped');
      assert.equal(statusFor('task', false), 'Backlog');
      const open = new Set(['Backlog', 'Doing']);
      assert.equal(statusPasses(task({ status: 'Doing' }), open), true);
      assert.equal(statusPasses(task({ status: 'Shipped' }), open), false);
      assert.equal(statusPasses(task({ status: 'Shipped' }), new Set()), true); // none ticked: any
      // a note has no status: it passes while its open/closed state has a status of that group ticked
      assert.equal(statusPasses({ type: 'note', fields: {} }, open), true);
      assert.equal(statusPasses({ type: 'note', fields: {} }, new Set(['Shipped'])), false);
    } finally {
      setStructure(FOLDER_PER_TYPE);
    }
  });
});
