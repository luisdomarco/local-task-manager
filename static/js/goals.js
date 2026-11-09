// Goals (Projects): what a goal holds, in what order, and how far along it is. Pure: the goal's page (panel.js), the
// Progress column (datatable.js) and the Goals view (views/goals.js) read it; tests/js/goals.test.mjs checks it.
//
// A goal holds the projects, initiatives, stories and tasks that name it in their `goal:` (one goal each, at most);
// each keeps its place among them in `goal_order` (a number; none goes last). Its notes hang from it as from any item
// (`related_to`) and are not what it is made of.
import { PRIORITY_RANK, placement } from './rules.js';

/** The types a goal is made of, in the order its page lists them. */
export const MEMBER_TYPES = ['project', 'initiative', 'story', 'task'];

/** item → whether it is one of goal `goalId`'s items. */
export const inGoal = (goalId) => (k) => !!goalId && MEMBER_TYPES.includes(k.type) && k.fields.goal === goalId;

const place = (k) => (typeof k.fields.goal_order === 'number' ? k.fields.goal_order : Infinity);
/** Its items in their place (goal_order); those with none last, by title. A comparator. */
export const byGoalOrder = (a, b) => place(a) - place(b) || String(a.title || '').localeCompare(String(b.title || ''));

/** goal `goalId`'s items of `items`, in their order. */
export const goalMembers = (items, goalId) => items.filter(inGoal(goalId)).sort(byGoalOrder);

/** How far along a goal is: its items closed of all of them (archived ones out). `isDone`: rules.js isDone. */
export function goalProgress(items, goalId, isDone) {
  const all = items.filter((k) => inGoal(goalId)(k) && k.fields.archived !== true);
  const done = all.filter(isDone).length;
  return { done, total: all.length, pct: all.length ? Math.round((100 * done) / all.length) : 0 };
}

/** The place an item added at the end of goal `goalId` takes: one past its last. */
export const nextGoalOrder = (items, goalId) =>
  items.filter(inGoal(goalId)).reduce((top, k) => Math.max(top, Number(k.fields.goal_order) || 0), 0) + 1;

/** What can be added to a goal: open, unarchived projects, initiatives, stories and tasks in no goal yet. */
export const goalCandidates = (items, isDone) =>
  items.filter((k) => MEMBER_TYPES.includes(k.type) && !k.fields.goal && k.fields.archived !== true && !isDone(k));

const urgency = (g) => PRIORITY_RANK[g.fields?.priority] ?? 9;
const rankOf = (g) => (typeof g.fields?.order === 'number' ? g.fields.order : Infinity);
/** Goals in the order the Goals view and Group: Goal show them: by priority (P0 first), then their own order (dragged
 *  on the Goals view), then by title. A comparator. */
export const byGoalRank = (a, b) => urgency(a) - urgency(b) || rankOf(a) - rankOf(b) || String(a.title || '').localeCompare(String(b.title || ''));

/**
 * A goal dragged from `from` to `to` among `goals` (as the Goals view shows them, byGoalRank). Goals go by priority
 * first, so where it lands says its priority: it takes that of the goal it lands after (before, when it lands first),
 * and its place among that priority's goals (rules.js placement on `order`: only what must move is written).
 * → [[goal, values]] to write.
 */
export function moveGoal(goals, from, to) {
  const seq = goals.slice();
  const [goal] = seq.splice(from, 1);
  if (!goal) return [];
  seq.splice(to, 0, goal);
  const near = seq[to - 1] || seq[to + 1];
  const priority = near ? near.fields.priority : goal.fields.priority;
  const peers = seq.filter((g) => g !== goal && g.fields.priority === priority);
  const index = seq.slice(0, to).filter((g) => g.fields.priority === priority).length;
  return placement(goal, peers, index).map(([g, order]) => [g, g === goal && priority !== goal.fields.priority ? { order, priority } : { order }])
    .filter(([g, v]) => g === goal || g.fields.order !== v.order);
}

/**
 * `item` dropped at `index` among `cards` (goal `goalId`'s items as shown, the dragged one left out); `goalId` null is
 * "No goal". It joins the goal (or leaves its own) at that place (goal_order; only what must move is written).
 * → [[item, values]] to write; none when nothing changes.
 */
export function dropInGoal(item, cards, index, goalId) {
  if (!goalId) return item.fields.goal ? [[item, { goal: null, goal_order: null }]] : [];
  const joins = item.fields.goal !== goalId;
  return placement(item, cards.filter((c) => c.key !== item.key), index, 'goal_order')
    .map(([c, n]) => [c, c === item && joins ? { goal: goalId, goal_order: n } : { goal_order: n }])
    .filter(([c, v]) => c.fields.goal_order !== v.goal_order || (c === item && joins));
}
