import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MEMBER_TYPES, byGoalOrder, goalCandidates, goalMembers, goalProgress, inGoal, nextGoalOrder } from '../../static/js/goals.js';

const item = (key, type, fields = {}) => ({ key, id: key, type, title: `Title ${key}`, fields: { status: 'ToDo', ...fields } });
const isDone = (k) => ['Done', 'Discarded'].includes(k.fields.status);
// Goal 27 holds an initiative (2nd), a story (1st), a closed task (no place) and a project; a note hangs from it;
// a task is in goal 28; another in none.
const ITEMS = [
  item('27', 'goal'),
  item('1', 'initiative', { goal: '27', goal_order: 2 }),
  item('5', 'story', { goal: '27', goal_order: 1 }),
  item('9', 'task', { goal: '27', status: 'Done' }),
  item('OPS', 'project', { goal: '27', goal_order: 3 }),
  item('40', 'note', { related_to: '27', goal: '27' }),
  item('11', 'task', { goal: '28', goal_order: 1 }),
  item('12', 'task'),
  item('13', 'task', { archived: true }),
  item('14', 'story', { status: 'Discarded' }),
];

describe('what a goal holds', () => {
  it('its projects, initiatives, stories and tasks: not its notes, not another goal\'s', () => {
    assert.deepEqual(MEMBER_TYPES, ['project', 'initiative', 'story', 'task']);
    assert.deepEqual(ITEMS.filter(inGoal('27')).map((k) => k.key), ['1', '5', '9', 'OPS']);
    assert.deepEqual(ITEMS.filter(inGoal(null)).length, 0, 'no goal holds what names none');
  });

  it('in their place, those with none last', () => {
    assert.deepEqual(goalMembers(ITEMS, '27').map((k) => k.key), ['5', '1', 'OPS', '9']);
    const unplaced = [item('b', 'task', { goal: 'g' }), item('a', 'task', { goal: 'g' })];
    assert.deepEqual(unplaced.sort(byGoalOrder).map((k) => k.key), ['a', 'b'], 'by title when neither has a place');
  });

  it('how far along: closed of all, archived ones out', () => {
    assert.deepEqual(goalProgress(ITEMS, '27', isDone), { done: 1, total: 4, pct: 25 });
    assert.deepEqual(goalProgress(ITEMS, 'none', isDone), { done: 0, total: 0, pct: 0 });
  });

  it('a new item goes after its last; one in no goal starts at 1', () => {
    assert.equal(nextGoalOrder(ITEMS, '27'), 4);
    assert.equal(nextGoalOrder(ITEMS, 'empty'), 1);
  });

  it('what can be added: open, unarchived, of its types, in no goal', () => {
    assert.deepEqual(goalCandidates(ITEMS, isDone).map((k) => k.key), ['12']);
  });
});

describe('goals in a Projects list: Group: Goal, the Goal filter, the Goal column', async () => {
  const { setStructure } = await import('../../static/js/rules.js');
  const { FOLDER_PER_TYPE, PROJECTS } = await import('../../static/js/structure.js');
  const { NONE } = await import('../../static/js/grouping.js');
  const { byGoalRank } = await import('../../static/js/goals.js');
  const { columnOn, emptyKeys, filterFields, groupItems, groupOptions } = await import('../../static/js/viewmodel.js');
  const { before, after } = await import('node:test');
  before(() => setStructure(PROJECTS));
  after(() => setStructure(FOLDER_PER_TYPE));

  const goal = (key, title, fields = {}) => ({ key, id: key, type: 'goal', title, fields: { status: 'ToDo', priority: 'P2', ...fields } });
  const urgent = goal('30', 'Urgent one', { priority: 'P0' });
  const first = goal('31', 'First by hand', { order: 1 });
  const second = goal('32', 'Second by hand', { order: 2 });
  const loose = goal('33', 'A loose one');
  const done = goal('34', 'Met already', { status: 'Done' });

  it('goals go by priority, then their own order, then title', () => {
    assert.deepEqual([loose, second, done, first, urgent].sort(byGoalRank).map((g) => g.key), ['30', '31', '32', '33', '34']);
  });

  it('a task, a story, an initiative and a project group by goal; a goal heads its own group, No goal last', () => {
    for (const t of ['task', 'story', 'initiative', 'project']) assert.ok(groupOptions([t]).includes('goal'), t);
    const t1 = item('t1', 'task', { goal: '32' });
    const t2 = item('t2', 'task', { goal: '30' });
    const t3 = item('t3', 'task');
    const byId = new Map([urgent, first, second, t1, t2, t3].map((i) => [i.id, i]));
    const groups = groupItems([t3, t1, second, t2], 'goal', { byId });
    assert.deepEqual(groups.map((g) => g.key), ['30', '32', NONE]);
    assert.deepEqual(groups[1].items.map((i) => i.key), ['32', 't1'], 'the goal leads its own group');
  });

  it('the Goal filter offers the open goals in their order and No goal; Show empty groups takes those', () => {
    const byId = new Map([urgent, first, second, loose, done].map((g) => [g.id, g]));
    const field = filterFields(['task'], { byId }).find((f) => f.key === 'goal');
    assert.deepEqual(field.values({ byId }).map((v) => v.value), ['30', '31', '32', '33', NONE]);
    assert.deepEqual(field.of(item('t', 'task', { goal: '31' })), ['31']);
    assert.deepEqual(field.of(item('t', 'task')), [NONE]);
    assert.deepEqual(emptyKeys('goal', [field], { byId }), ['30', '31', '32', '33', NONE]);
  });

  it('the Goal column is off until Show columns turns it on; the rest on until turned off', () => {
    assert.equal(columnOn({}, 'goal'), false);
    assert.equal(columnOn({ goal: true }, 'goal'), true);
    assert.equal(columnOn({}, 'labels'), true);
    assert.equal(columnOn({ labels: false }, 'labels'), false);
  });
});

describe('the Goals view: moving goals and items', async () => {
  const { setStructure } = await import('../../static/js/rules.js');
  const { FOLDER_PER_TYPE, PROJECTS } = await import('../../static/js/structure.js');
  const { dropInGoal, moveGoal } = await import('../../static/js/goals.js');
  const { before, after } = await import('node:test');
  before(() => setStructure(PROJECTS));
  after(() => setStructure(FOLDER_PER_TYPE));
  const goal = (key, priority, order) => ({ key, id: key, type: 'goal', title: key, fields: { priority, ...(order === undefined ? {} : { order }) } });
  const values = (patches) => patches.map(([g, v]) => [g.key, v]);

  it('a goal moved among goals of its priority takes a place between its neighbours', () => {
    const goals = [goal('a', 'P1', 10), goal('b', 'P1', 20), goal('c', 'P1', 30)];
    assert.deepEqual(values(moveGoal(goals, 2, 0)), [['c', { order: 0 }]]);
    assert.deepEqual(values(moveGoal(goals, 0, 1)), [['a', { order: 25 }]]);
  });

  it('dropped among goals of another priority, it takes theirs', () => {
    const goals = [goal('a', 'P0', 10), goal('b', 'P2', 10), goal('c', 'P2', 20)];
    assert.deepEqual(values(moveGoal(goals, 0, 2)), [['a', { order: 30, priority: 'P2' }]], 'after c: P2, last');
    assert.deepEqual(values(moveGoal(goals, 2, 0)), [['c', { order: 0, priority: 'P0' }]], 'first: the P0 it lands before');
  });

  it('goals never placed are numbered as shown, only those that move written', () => {
    const goals = [goal('a', 'P2'), goal('b', 'P2'), goal('c', 'P2')];
    assert.deepEqual(values(moveGoal(goals, 2, 0)), [['c', { order: 0 }], ['a', { order: 10 }], ['b', { order: 20 }]]);
  });

  const member = (key, goalId, n) => ({ key, id: key, type: 'task', title: key, fields: { goal: goalId, ...(n === undefined ? {} : { goal_order: n }) } });
  it('an item dropped in a goal joins it at that place; moved within it, only its place changes', () => {
    const cards = [member('x', 'g', 10), member('y', 'g', 20)];
    assert.deepEqual(values(dropInGoal(member('t', null), cards, 1, 'g')), [['t', { goal: 'g', goal_order: 15 }]]);
    assert.deepEqual(values(dropInGoal(cards[1], cards, 0, 'g')), [['y', { goal_order: 0 }]]);
    assert.deepEqual(values(dropInGoal(cards[0], cards, 0, 'g')), [], 'back where it was: nothing to write');
  });

  it('dropped in No goal, it leaves its goal', () => {
    assert.deepEqual(values(dropInGoal(member('x', 'g', 10), [], 0, null)), [['x', { goal: null, goal_order: null }]]);
    assert.deepEqual(dropInGoal(member('t', null), [], 0, null), []);
  });
});
