// Today: the items of the day (planned today, carried over from past days, due
// today) on a board whose columns you create yourself — Uncategorized by default,
// then "Morning", "Waiting"… — or as a plain list. Columns organise the day; they
// never change an item's status; their cards keep the order you drop them in (TSK-053: `plan_order`, shared with the
// Week's day), those never placed following, carried over first and then by priority. The board opens with a fixed Meetings column: today's meetings, by date. Tomorrow (same module, dayView(1)) is the list
// of what is planned or due for tomorrow and what you could pull in from its week.
import { openCreateModal } from '../create.js';
import { addDays, isoWeek, relDay, thisWeek, today } from '../dates.js';
import { addListColumn, listDropZone, listHeader, moveEntries, moveList, startRename } from '../kanban.js';
import { openItem } from '../panel.js';
import { quickAddBar } from '../quickadd.js';
import { PLANNABLE, byManualOrder, carriedOverDay, isDone, isEnabled, isPlannedToday } from '../rules.js';
import { TODAY_DEFAULT, placeInPlan, planDay, saveTodayLists, slugId, state, todayListOf, updateMany } from '../state.js';
import { byPriority, dropZone, dropdown, emptyState, h, icon, itemCard } from '../ui.js';

const MODE_KEY = 'tm-today-mode';
const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'list' ? 'list' : 'board'; } catch { return 'board'; } };
let mode = readMode();
let hideDone = false;

const toToday = (item) => h('button', { class: 'btn small', title: 'Move to today', onclick: () => planDay(item, today()) }, '→ Today');
const withToToday = { onOpen: openItem, extraFor: toToday };

/** Days late, for the carried-over marker: "Yesterday" or "3 days". */
function lateLabel(item) {
  const d = item.fields.plan_day;
  const days = Math.round((new Date(`${today()}T12:00`) - new Date(`${d}T12:00`)) / 86400000);
  return days === 1 ? 'Yesterday' : `${days} days`;
}

/** A card of the day: carried-over ones carry a red marker and a one-click → Today. */
function dayCard(item, opts = {}) {
  const carried = carriedOverDay(item);
  return itemCard(item, {
    onOpen: openItem, draggable: true, hideParent: false, ...opts,
    cls: carried ? 'carried' : '',
    titleAction: carried ? h('button', { class: 'btn small card-today', title: `Planned for ${relDay(item.fields.plan_day)} · ${lateLabel(item)} late`, onclick: (e) => { e.stopPropagation(); planDay(item, today()); } }, '→ Today') : null,
  });
}

function cards(items, opts) {
  return items.map((i) => itemCard(i, { onOpen: opts.onOpen, extra: opts.extraFor ? opts.extraFor(i) : null }));
}

function group(title, items, opts, { cls = '', empty = null, action = null } = {}) {
  if (!items.length && !empty) return null;
  return h('section', { class: `group ${cls}` },
    h('header', {}, h('h3', {}, title, h('span', { class: 'count' }, items.length || '')), action),
    items.length ? h('div', { class: 'cards' }, cards(items, opts)) : emptyState(empty));
}

/** Items that belong to today's board: planned for today, or carried over from a past day. Nothing else. */
function itemsOfToday() {
  return state.items.filter((i) => PLANNABLE.has(i.type)
    && (isPlannedToday(i) || carriedOverDay(i)))
    .filter((i) => !(hideDone && isDone(i)))
    .sort(byManualOrder((a, b) => carriedOverDay(b) - carriedOverDay(a) || byPriority(a, b)));
}

// ── board mode ───────────────────────────────────────────────────────────────
function editLists(fn) {
  const next = state.today.lists.map((l) => ({ ...l }));
  fn(next);
  return saveTodayLists(next).catch(() => {});
}

function todayListMenu(anchor, list, idx, nameEl) {
  const last = state.today.lists.length - 1;
  dropdown(anchor, [
    { heading: list.name },
    { label: 'Rename', icon: 'pencil', onSelect: () => startRename(nameEl, list.name, (v) => editLists((ls) => { ls[idx].name = v; })) },
    ...moveEntries(idx, last, (from, to) => editLists((ls) => moveList(ls, from, to))),
    '-',
    list.id === TODAY_DEFAULT
      ? { label: 'Default column — cannot be deleted', icon: 'inbox', onSelect: () => {} }
      : { label: 'Delete column (its cards go to Uncategorized)', icon: 'trash', danger: true, onSelect: () => editLists((ls) => ls.splice(idx, 1)) },
  ], { width: 280 });
}

function todayColumn(list, idx, items) {
  const zone = h('div', { class: 'col-cards' }, items.map((i) => dayCard(i)));
  dropZone(zone, (key, index) => {
    const item = state.items.find((i) => i.key === key);
    if (!item) return;
    const move = todayListOf(item)?.id !== list.id ? { today_list: list.id === TODAY_DEFAULT ? null : list.id } : {};
    placeInPlan(item, move, items, index);
  });
  const open = items.filter((i) => !isDone(i)).length;
  return h('section', { class: `board-col today-col ${list.id === TODAY_DEFAULT ? 'default' : ''}`, 'data-list': list.id, 'aria-label': `${list.name} column` },
    listHeader({
      list, idx, count: open || '', countTitle: `${open} open`,
      menu: (anchor, nameEl) => todayListMenu(anchor, list, idx, nameEl),
      onRename: (v) => editLists((ls) => { ls[idx].name = v; }),
    }),
    zone,
    quickAddBar({ type: 'task', values: { plan_day: today(), plan_week: thisWeek(), ...(list.id === TODAY_DEFAULT ? {} : { today_list: list.id }) } },
      { placeholder: '+ Add a card' }));
}

/**
 * The board's first column: the meetings dated today. Meetings have no "planned", only a date, so they
 * show here by that date. Fixed: no menu, no rename, no reordering, nothing drops in and its cards do not drag.
 */
function meetingsColumn() {
  const t = today();
  const meetings = state.items.filter((i) => i.type === 'meeting' && i.fields.date === t)
    .sort((a, b) => String(a.fields.time || '').localeCompare(String(b.fields.time || '')) || a.title.localeCompare(b.title));
  return h('section', { class: 'board-col today-col meetings-col', 'aria-label': 'Meetings column' },
    h('header', { class: 'list-head fixed' },
      icon('users', 15),
      h('h2', { class: 'list-name' }, 'Meetings'),
      h('span', { class: 'count', title: `${meetings.length} meetings today` }, meetings.length || '')),
    h('div', { class: 'col-cards' }, meetings.length
      ? meetings.map((m) => itemCard(m, { onOpen: openItem }))
      : h('p', { class: 'muted small col-empty' }, 'No meetings today')));
}

function renderBoard(cols) {
  const items = itemsOfToday();
  const placed = new Map(state.today.lists.map((l) => [l.id, []]));
  for (const it of items) placed.get(todayListOf(it)?.id ?? TODAY_DEFAULT)?.push(it);
  cols.replaceChildren(
    ...(isEnabled('meeting') ? [meetingsColumn()] : []), // a vault with meetings turned off has no Meetings column
    ...state.today.lists.map((l, i) => todayColumn(l, i, placed.get(l.id) || [])),
    addListColumn({
      label: 'Add a column', placeholder: 'Column name… (Morning, Waiting, Deep work)',
      onAdd: (name) => editLists((ls) => ls.push({ id: slugId(name, ls.map((l) => l.id)), name })),
    }));
}

// ── list mode (the former Today) ─────────────────────────────────────────────
function renderList(body) {
  const t = today();
  const open = { onOpen: openItem };
  const carried = state.items.filter(carriedOverDay).sort(byManualOrder(byPriority));
  const planned = state.items.filter((i) => isPlannedToday(i) && !(hideDone && isDone(i))).sort(byManualOrder(byPriority));
  body.replaceChildren(...[
    group('Carried over', carried, withToToday, {
      cls: 'warn',
      action: h('button', { class: 'btn small', onclick: () => updateMany(carried.map((i) => [i.key, { plan_day: t, plan_week: thisWeek() }])) }, 'Move all to today'),
    }),
    group('Today', planned, open, { empty: 'Nothing planned for today yet.' }),
  ].filter(Boolean));
}

function mountToday(root) {
  const subtitle = h('p', { class: 'muted' });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Layout' });
  const doneToggle = h('label', { class: 'toggle' },
    h('input', { type: 'checkbox', checked: hideDone, onchange: (e) => { hideDone = e.target.checked; api.update(); } }), 'Hide closed');
  const board = h('div', { class: 'board today-board' });
  listDropZone(board, (from, to) => editLists((ls) => moveList(ls, from, to)));
  const list = h('div', { class: 'stack' });
  root.replaceChildren(
    h('header', { class: 'view-head row' },
      h('div', {}, h('h1', {}, 'Today'), subtitle),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => openCreateModal('task', { plan: 'today' }, { fixedType: true }) }, icon('plus', 16), 'Add task')),
    h('div', { class: 'toolbar' }, seg, doneToggle),
    quickAddBar({ values: { plan_day: today(), plan_week: thisWeek() } }, { placeholder: 'Add a task for today…' }),
    board, list);
  const api = {
    update() {
      subtitle.textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      seg.replaceChildren(...[['board', 'kanban', 'Board'], ['list', 'text', 'List']].map(([m, ico, label]) => h('button', {
        class: `btn small ${mode === m ? 'active' : ''}`, 'aria-pressed': String(mode === m),
        onclick: () => { mode = m; try { localStorage.setItem(MODE_KEY, m); } catch { /* fine */ } api.update(); },
      }, icon(ico, 14), label)));
      board.hidden = mode !== 'board';
      list.hidden = mode !== 'list';
      if (mode === 'board') renderBoard(board); else renderList(list);
    },
  };
  return api;
}

// ── tomorrow ─────────────────────────────────────────────────────────────────
function mountDay(root, offset) {
  const title = offset === 0 ? 'Today' : 'Tomorrow';
  const day = () => addDays(today(), offset);
  const body = h('div', { class: 'stack' });
  const subtitle = h('p', { class: 'muted' });
  root.replaceChildren(
    h('header', { class: 'view-head' }, h('h1', {}, title), subtitle),
    quickAddBar({ values: { plan_day: day(), plan_week: isoWeek(day()) } }, { placeholder: `Add a task for ${title.toLowerCase()}…` }),
    body);
  return {
    update() {
      const d = day();
      const week = isoWeek(d);
      subtitle.textContent = new Date(`${d}T12:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      const toDay = (item) => h('button', { class: 'btn small', title: `Plan for ${relDay(d)}`, onclick: () => planDay(item, d) }, `→ ${title}`);
      const withToDay = { onOpen: openItem, extraFor: toDay };
      const planned = state.items.filter((i) => i.fields.plan_day === d && !isDone(i)).sort(byManualOrder(byPriority));
      const due = state.items.filter((i) => PLANNABLE.has(i.type) && !isDone(i) && i.fields.plan_day !== d && i.fields.due === d).sort(byPriority);
      const pool = state.items.filter((i) => i.fields.plan_week === week && !i.fields.plan_day && !isDone(i)).sort(byPriority);
      body.replaceChildren(...[
        group(title, planned, { onOpen: openItem }, { empty: `Nothing planned for ${title.toLowerCase()} yet — pull something from the week below.` }),
        group(`Due ${title.toLowerCase()}`, due, withToDay),
        group(week === thisWeek() ? 'Pick from this week' : `Pick from ${week}`, pool, withToDay, { cls: 'pool' }),
      ].filter(Boolean));
    },
  };
}

export const mount = (root) => mountToday(root);
export const tomorrow = { mount: (root) => mountDay(root, 1) };
