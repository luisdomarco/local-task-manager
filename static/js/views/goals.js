// Goals (Projects; docs/design.md §3 Goals): prioritising, apart from planning. Each open goal, in its order (priority,
// then its own: goals.js byGoalRank), holds its projects, initiatives, stories and tasks in theirs (goal_order):
//
//   Board  a column per goal — its status dot, name, count and ⋯ — its items as cards, then "Add a goal" (as another
//          board's new list): a card dropped in a column joins that goal at that place; a column dragged by its head
//          moves the goal, and takes the priority of the goals it lands among.
//   List   a section per goal, the same rows as Planning's (planrows.js), dragged the same way.
//
//   Canvas a whiteboard (canvas/canvasview.js): open goals beside it, dragged in as cards, and around them arrows,
//          notes, shapes and frames. Its canvases are files in <Docs>/Canvases/Goals.
//
// The view bar filters the items (not the goals): type, status, priority, project…; Display shows closed items, and
// closed goals. Neither applies to a canvas, and both step aside there.
// A goal opens its page; "Add goal" makes one, a column's "+ Add a card" a task in it.
import { boardOf } from '../boardview.js';
import { mountCanvasView } from '../canvas/canvasview.js';
import { openCreateModal } from '../create.js';
import { has } from '../features.js';
import { projectName } from '../datatable.js';
import { MEMBER_TYPES, byGoalOrder, byGoalRank, dropInGoal, goalProgress, moveGoal, nextGoalOrder } from '../goals.js';
import { addListColumn, listHeader, startRename } from '../kanban.js';
import { itemHref } from '../links.js';
import { openItem, openItemCard } from '../panel.js';
import { planRow, planSection, planViewOf } from '../planrows.js';
import { isDone, isEnabled } from '../rules.js';
import { createItem, state, updateItem, updateMany } from '../state.js';
import { refOf } from '../shownid.js';
import { countOf, cssKey, dropdown, dropZone, h, icon, priorityChip, seg, statusLabel, typeIcon } from '../ui.js';
import { viewBar } from '../viewbar.js';
import { cardShows, closedShown, filterFields, matches } from '../viewmodel.js';
import { vaultCtx } from './list.js';

const write = (patches) => (patches.length ? updateMany(patches.map(([i, v]) => [i.key, v])).catch(() => {}) : null);
const find = (key) => state.items.find((i) => i.key === key);

/** The ⋯ of a goal: open it, rename it, move it, close or reopen it. */
function goalMenu(anchor, goal, idx, goals, nameEl) {
  const done = isDone(goal);
  dropdown(anchor, [
    { heading: `${refOf(goal)} · ${goal.title}` },
    { label: 'Open goal', icon: 'right', onSelect: () => openItem(goal) },
    { label: 'Rename', icon: 'pencil', onSelect: () => startRename(nameEl, goal.title, (v) => updateItem(goal.key, { subject: v }).catch(() => {})) },
    idx > 0 ? { label: 'Move earlier', icon: 'left', onSelect: () => write(moveGoal(goals, idx, idx - 1)) } : null,
    idx < goals.length - 1 ? { label: 'Move later', icon: 'right', onSelect: () => write(moveGoal(goals, idx, idx + 1)) } : null,
    '-',
    done ? { label: 'Reopen goal', icon: 'reset', onSelect: () => updateItem(goal.key, { status: 'InProgress' }).catch(() => {}) }
      : { label: 'Mark goal done', icon: 'check', onSelect: () => updateItem(goal.key, { status: 'Done' }).catch(() => {}) },
  ].filter(Boolean), { width: 260 });
}

/** How far along, in a few words: "2 of 5 closed". */
const progressText = (goal) => { const p = goalProgress(state.items, goal.id, isDone); return p.total ? `${p.done} of ${p.total} closed` : 'Empty'; };

// ── board ────────────────────────────────────────────────────────────────────
function paintBoard(box, { goals, byGoal }, view, change) {
  const fold = view.boardFold || {};
  const cols = goals.map((g, idx) => {
    const its = byGoal.get(g.id) || [];
    return {
      key: g.id, label: g.title, items: its, attrs: { 'data-list': g.id }, cls: `goal-col s-${cssKey(g.fields.status)}`,
      face: [typeIcon('goal', 14), h('span', { class: 'group-name' }, g.title)],
      head: listHeader({
        list: { name: g.title }, idx, count: its.length, countTitle: `${its.length} shown · ${progressText(g)}`,
        before: h('span', { class: 'status-dot', title: statusLabel(g.fields.status) }),
        label: h('a', { href: itemHref(g), class: 'goal-name', title: `${refOf(g)} · ${g.title} — ${progressText(g)}`,
          onclick: (e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); openItem(g); } } }, g.title),
        menu: (anchor, nameEl) => goalMenu(anchor, g, idx, goals, nameEl),
        onRename: (v) => updateItem(g.key, { subject: v }).catch(() => {}),
      }),
      drop: (key, index) => { const it = find(key); if (it) write(dropInGoal(it, its, index, g.id)); },
      quick: { type: 'task', values: { goal: g.id, goal_order: nextGoalOrder(state.items, g.id) } },
      empty: 'Drag items here, or add a card',
      folded: fold[g.id] ?? false,
    };
  });
  const board = boardOf({
    columns: cols, onOpen: openItem, projectName, shows: (k) => cardShows(view, k),
    onFold: (k, f) => change({ boardFold: { ...fold, [k]: f } }),
    onReorder: (from, to) => write(moveGoal(goals, from, to)),
    // A new goal, as another board's new list: its name, then it is the last column (to do, no priority).
    after: addListColumn({ label: 'Add a goal', placeholder: 'Goal name… (Launch the new checkout)', button: 'Add goal',
      onAdd: (name) => createItem('goal', name, { status: 'ToDo' }).catch(() => {}) }),
  });
  board.classList.add('goals-board');
  box.replaceChildren(board);
}

// ── list ─────────────────────────────────────────────────────────────────────
function paintList(box, { goals, byGoal }) {
  const rows = (items, goalId) => {
    const zone = h('div', { class: 'plan-rows' }, items.length ? items.map((i) => planRow(i, { onOpen: openItem }))
      : h('p', { class: 'plan-line-empty' }, 'Nothing here yet: add one with +, or from the goal\'s page.'));
    dropZone(zone, (key, index) => { const it = find(key); if (it) write(dropInGoal(it, items, index, goalId)); });
    return zone;
  };
  const sections = goals.map((g, idx) => {
    const its = byGoal.get(g.id) || [];
    const more = h('button', { type: 'button', class: 'btn icon small', title: `${g.title} — actions`, 'aria-haspopup': 'menu' }, icon('more', 16));
    const name = h('a', { href: itemHref(g), class: 'goal-name', onclick: (e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); openItem(g); } } }, g.title);
    more.addEventListener('click', (e) => { e.stopPropagation(); goalMenu(more, g, idx, goals, name); });
    const add = h('button', { type: 'button', class: 'btn icon small', title: `Add a task to ${g.title}`,
      onclick: () => openCreateModal('task', { goal: g.id, goal_order: nextGoalOrder(state.items, g.id) }) }, icon('plus', 14));
    return h('section', { class: `plan-block goal-block s-${cssKey(g.fields.status)}`, 'data-goal': g.id },
      planSection({ title: [typeIcon('goal', 14), name], count: its.length, tag: progressText(g),
        action: [g.fields.priority ? priorityChip(g.fields.priority) : null, add, more] }),
      rows(its, g.id));
  });
  box.replaceChildren(...(goals.length ? sections : [noGoalsLine()]));
}

// ── canvas ───────────────────────────────────────────────────────────────────
/** What a goal is on a canvas (whiteboard.js's provider): a board's card — title, ref, status and priority, progress — linked to its note. */
export const goalsProvider = {
  kind: 'goal', label: 'Goals',
  all: () => new Map(state.items.filter((i) => i.type === 'goal').map((g) => [g.id, g])),
  items: () => state.items.filter((i) => i.type === 'goal' && !isDone(i)).sort(byGoalRank),
  card: (g) => {
    const p = goalProgress(state.items, g.id, isDone);
    return {
      title: g.title, kicker: refOf(g),
      status: g.fields.status ? { label: statusLabel(g.fields.status), key: g.fields.status } : null, priority: g.fields.priority || null,
      note: p.total ? `${p.done} of ${p.total} closed` : 'No items yet', progress: p.total ? p : null,
      link: g.path ? `[[${g.path.replace(/\.md$/, '')}]]` : null,
    };
  },
  line: (g) => [statusLabel(g.fields.status), progressText(g)].join(' · '),
  open: (g) => openItemCard(g), // a card over the canvas: close it and go on drawing
};

const noGoalsLine = () => h('p', { class: 'muted goals-empty' }, 'No open goals. Add one to put your projects, initiatives, stories and tasks behind it.');

export function mount(root) {
  const { view, save } = planViewOf('goals', { layout: 'board', closed: 'none', goalsClosed: false });
  if (view.layout === 'canvas' && !has('canvas')) view.layout = 'board'; // a phone has no canvas (features.js)
  const types = () => MEMBER_TYPES.filter(isEnabled);
  const fields = () => filterFields(types(), vaultCtx());
  const members = () => state.items.filter((i) => types().includes(i.type));
  const change = (patch) => { Object.assign(view, patch); save(); api.update(); };
  const count = countOf(null, { plain: true, cls: 'view-count' });
  const body = h('div', { class: 'plan-list goals-list' });
  const vb = viewBar({
    view, save, fields, ctx: vaultCtx, items: members, closable: true, closedDefault: 'none', search: false,
    layout: { current: () => view.layout, pick: (l) => change({ layout: l }),
      options: [['list', 'List', 'list'], ['board', 'Board', 'kanban'], has('canvas') ? ['canvas', 'Canvas', 'canvas'] : null].filter(Boolean) },
    // Closed goals: left out unless asked (a goal is closed by hand, its items may still be open).
    displayRows: () => [h('div', { class: 'vb-row' }, h('span', {}, 'Closed goals'), seg([[false, 'Hide'], [true, 'Show']], !!view.goalsClosed, (v) => change({ goalsClosed: v }), { aria: 'Closed goals' }))],
    onText: () => {}, onChange: () => api.update(),
  });
  root.replaceChildren(
    h('header', { class: 'view-head row' }, h('h1', {}, 'Goals'), count, h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn primary', 'data-fk': 'add-goal', onclick: () => openCreateModal('goal') }, icon('plus', 14), 'Add goal')),
    vb.bar, vb.chips, body);
  let canvas = null; // the Canvas layout, mounted once: a repaint keeps the whiteboard as it is
  const api = {
    update() {
      vb.update();
      const onCanvas = view.layout === 'canvas';
      root.classList.toggle('canvas-layout', onCanvas);
      const all = state.items.filter((i) => i.type === 'goal');
      const goals = all.filter((g) => view.goalsClosed || !isDone(g)).sort(byGoalRank);
      const open = all.filter((g) => !isDone(g)).length;
      count.textContent = `${open} open${all.length > open ? ` · ${all.length - open} closed` : ''}`;
      const fs = fields();
      const ctx = vaultCtx();
      const shown = closedShown(members().filter((i) => matches(i, view.filters, fs, ctx)), view.closed).items;
      const ids = new Set(all.map((g) => g.id));
      const byGoal = new Map();
      for (const i of shown) {
        const g = i.fields.goal;
        if (g && ids.has(g)) { if (!byGoal.has(g)) byGoal.set(g, []); byGoal.get(g).push(i); }
      }
      for (const its of byGoal.values()) its.sort(byGoalOrder);
      root.classList.toggle('board-layout', view.layout === 'board' || onCanvas);
      body.classList.toggle('list-main', view.layout === 'board' || onCanvas); // the board takes the height left (app.css)
      if (onCanvas) {
        if (canvas) canvas.update(); else canvas = mountCanvasView(body, { host: 'Goals', provider: goalsProvider });
        return;
      }
      if (canvas) { canvas.destroy(); canvas = null; } // its last strokes saved first
      (view.layout === 'board' ? paintBoard : paintList)(body, { goals, byGoal }, view, change);
    },
    unmount: () => canvas?.destroy(),
  };
  return api;
}
