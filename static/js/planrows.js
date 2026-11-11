// Planning's pieces (Today, Week, Month; docs/design.md §3 Planning): the period switch over them, a section's head, a
// row of the agenda and a card of the boards — so the three say the same thing the same way.
//
//   Planning [Day | Week | Month]  ‹ [This week] ›  W46 · Nov 9 – Nov 15                       [+ Add task]
//   ● Carried over 2                                                      Move all to this week
//   ☐ Map the current checkout steps      ◎ Checkout redesign       ▂▄ 19 d late          →
//
// A row is 42px: its done box, the subject (a meeting's time first), where it belongs (its initiative or parent, else its
// project; a meeting: its attendees), then what is worth saying of it — its priority's bars, how late, its due day,
// the day it was done — and, carried over, one arrow that plans it for now. Rows drag as cards do (ui.js dropZone).
import { dayLabel, isoWeek, lateBy, relDay, shiftWeek, thisWeek, today } from './dates.js';
import { projectName } from './datatable.js';
import { opener } from './links.js';
import { pref, setPref } from './prefs.js';
import { PLANNABLE, isDone, isEnabled, isOverdue } from './rules.js';
import { state } from './state.js';
import { checkbox, countOf, h, icon, itemCard, priorityChip, statusChip, typeIcon } from './ui.js';
import { fresh } from './viewmodel.js';

/** Where an item belongs, for its row or card: its parent (initiative, story…), else its project. */
function whereOf(item) {
  const p = item.fields.related_to && state.byId.get(item.fields.related_to);
  if (p) return { ico: typeIcon(p.type, 12), text: p.title };
  if (item.fields.project) return { ico: typeIcon('project', 12), text: projectName(item.fields.project) };
  return null;
}

/** A meeting's length, from its `duration` (HH:MM): "30 min", "1 h", "1 h 30". */
export function durationLabel(d) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(d || '').trim());
  if (!m) return '';
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (!hours) return mins ? `${mins} min` : '';
  return mins ? `${hours} h ${mins}` : `${hours} h`;
}

/** How long until a meeting of today starts ("in 2 h", "in 20 min"), or '' once it has. `now` is 'HH:MM'. */
export function startsIn(time, now) {
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  const n = /^(\d{1,2}):(\d{2})$/.exec(String(now || ''));
  if (!t || !n) return '';
  const diff = (Number(t[1]) * 60 + Number(t[2])) - (Number(n[1]) * 60 + Number(n[2]));
  if (diff <= 0) return '';
  return diff < 60 ? `in ${diff} min` : `in ${Math.round(diff / 60)} h`;
}

const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** What a row or card says of an item, after its subject: its status, its priority (bars and name), how late, its due
 *  day, when it was done. */
export function planMeta(item, { late = true, due = true, done = true, priority = true, status = true } = {}) {
  const f = item.fields;
  const out = [];
  if (status && f.status) out.push(statusChip(f.status));
  if (priority && f.priority) out.push(priorityChip(f.priority));
  const l = late && !isDone(item) ? lateBy(f) : null;
  if (l) out.push(h('span', { class: 'late-text', title: `Planned for ${l.since}` }, l.text));
  if (due && f.due && !isDone(item)) {
    out.push(h('span', { class: isOverdue(item) ? 'late-text' : '', title: `Due ${f.due}` }, `Due ${relDay(f.due).replace(/^(Today|Tomorrow|Yesterday)$/, (w) => w.toLowerCase())}`));
  }
  if (done && isDone(item) && f.completed_at) out.push(h('span', { title: `Closed ${f.completed_at}` }, `Done ${dayLabel(String(f.completed_at).slice(0, 10))}`));
  return out;
}

/** A row's meta as three columns of fixed width — Status · Priority · Date (how late, its due day, when it was done) —,
 *  each there even when empty, so they line up from row to row as the Overview's work rows do (app.css .plan-meta). */
function rowMeta(item) {
  const f = item.fields;
  const when = planMeta(item, { status: false, priority: false });
  return [
    h('span', { class: 'pm-status' }, f.status ? statusChip(f.status) : null),
    h('span', { class: 'pm-prio' }, f.priority ? priorityChip(f.priority) : null),
    h('span', { class: 'pm-when' }, ...when),
  ];
}

/** A meeting's few words: its length, and on today how soon it starts. */
function meetingMeta(m) {
  const f = m.fields;
  return [durationLabel(f.duration), f.date === today() ? startsIn(f.time, nowHM()) : ''].filter(Boolean).join(' · ');
}

/** The one arrow that plans a carried-over item for now (`to`: "today", "this week"). */
export function moveNow(item, to, onMove) {
  return h('button', {
    type: 'button', class: 'btn icon small plan-move', title: `Move to ${to}`, 'aria-label': `Move ${item.title} to ${to}`,
    onclick: (e) => { e.stopPropagation(); onMove(item); },
  }, icon('arrow', 14));
}

/** Makes a row or card draggable: its key on the drag, faded while it moves. */
function dragging(el, item) {
  el.setAttribute('draggable', 'true');
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', item.key);
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  return el;
}

/**
 * A row of Planning's agenda: [box] subject · where · meta · action. A meeting has no box and its time leads its
 * subject; a closed item reads grey. `action`: the move of a carried-over one.
 */
export function planRow(item, { onOpen, action = null, draggable = true, meta = null } = {}) {
  const meeting = item.type === 'meeting';
  const where = meeting
    ? { ico: typeIcon('meeting', 12), text: ['Meeting', (item.fields.attendees || []).join(', ')].filter(Boolean).join(' · ') }
    : whereOf(item);
  const el = h('div', {
    class: `plan-row t-${item.type} ${isDone(item) ? 'done' : ''}`, 'data-key': item.key, tabindex: '0',
    ...(onOpen ? opener(item, onOpen) : {}),
    onkeydown: (e) => { if (e.key === 'Enter' && e.target === el) onOpen?.(item, e); },
  },
  PLANNABLE.has(item.type) ? checkbox(item) : h('span', { class: 'plan-lead' }, meeting ? null : typeIcon(item.type, 14)),
  h('span', { class: 'plan-subject', title: item.title },
    meeting && item.fields.time ? h('span', { class: 'plan-time' }, item.fields.time) : null,
    item.type !== 'task' && PLANNABLE.has(item.type) ? h('span', { class: 'type-ico' }, typeIcon(item.type, 13)) : null,
    h('span', { class: 'plan-title' }, item.title)),
  h('span', { class: 'plan-where' }, ...(where ? [where.ico, h('span', {}, where.text)] : [])),
  h('span', { class: `plan-meta ${meta || meeting ? '' : 'cols'}` }, ...(meta || (meeting ? [meetingMeta(item)] : rowMeta(item)))),
  h('span', { class: 'plan-act' }, action));
  return draggable && !meeting ? dragging(el, item) : el;
}

/**
 * A card of Planning's boards: the list's board card (ui.js itemCard variant 'board') without the ID, its plan only
 * where the column does not say it (`plan`), its due and done day, and the move of a carried-over one.
 */
export function planCard(item, { onOpen, plan = false, action = null, draggable = true } = {}) {
  return itemCard(item, {
    onOpen, variant: 'board', projectName, draggable,
    board: { id: false, plan, action, status: true, meta: item.type === 'meeting' ? [item.fields.time || '', meetingMeta(item)].filter(Boolean).map((t) => h('span', {}, t)) : planMeta(item, { priority: false, status: false, late: !plan }) },
  });
}

/**
 * A section's head in the agenda (36px, a line under it): an optional dot (carried over: red), its name, a count or
 * a word in grey, a tag (Today), and an action at its right. `cls`: 'past' greys it, 'today' draws its line dark.
 */
export function planSection({ title, count = '', dot = null, tag = null, action = null, cls = '' }) {
  return h('header', { class: `plan-sec ${cls}` },
    dot ? h('span', { class: `plan-dot ${dot}` }) : null,
    h('h3', {}, title),
    tag ? h('span', { class: 'plan-tag' }, tag) : null,
    count !== '' && count !== null ? countOf(count, { plain: true, cls: 'plan-count' }) : null,
    action ? h('span', { class: 'plan-sec-act' }, action) : null);
}

/** An action in a section's head ("Move all to today"): text, no frame. */
export const sectionAction = (label, onClick) => h('button', { type: 'button', class: 'btn ghost small plan-sec-btn', onclick: onClick }, label);

/** The line of a slot with nothing in it (consecutive empty days in one: "Tue 10 · Wed 11   Nothing planned"). */
export function emptySlot(names, text = 'Nothing planned') {
  return h('div', { class: 'plan-empty' }, h('span', { class: 'plan-empty-names' }, ...names), h('span', {}, text));
}

/**
 * Planning's head: its title, the period switch (Day is Today, #/today), the move through the period (‹ This week ›)
 * and its range, then the page's Add. The Planning link of the sidebar goes back to the period last opened.
 * `nav`: { prev(), now(), next(), label: 'This week', away: bool } — null for a period that does not move.
 */
export function periodHead({ period, range = '', nav = null, add = null }) {
  if (period !== 'day') setPref('section.planning', period === 'month' ? 'month' : 'week');
  const seg = h('nav', { class: 'seg period-seg', 'aria-label': 'Period' },
    ...[['day', 'Day', '#/today'], ['week', 'Week', '#/week'], ['month', 'Month', '#/month']].map(([k, l, href]) => h('a', {
      class: `btn small ${period === k ? 'active' : ''}`, href, ...(period === k ? { 'aria-current': 'page' } : {}),
    }, l)));
  const step = (dir, label, onClick) => h('button', { type: 'button', class: 'btn ghost icon period-step', title: label, 'aria-label': label, onclick: onClick }, icon(dir, 15));
  const unit = period === 'month' ? 'month' : 'week';
  return h('header', { class: 'view-head row period-head' },
    h('h1', {}, 'Planning'),
    seg,
    nav ? h('div', { class: 'period-nav' },
      step('left', `Previous ${unit}`, nav.prev),
      h('button', { type: 'button', class: `btn small period-now ${nav.away ? '' : 'here'}`, onclick: nav.now }, nav.label),
      step('right', `Next ${unit}`, nav.next)) : null,
    range ? h('span', { class: 'period-range' }, range) : null,
    h('span', { class: 'spacer' }),
    add);
}

/**
 * A Planning page's view (filters, Show closed, layout, a board's folds…), saved per page and vault (prefs.js
 * `plan.<page>`), from `defaults` the first time.
 */
export function planViewOf(page, defaults = {}) {
  const saved = pref(`plan.${page}`, null);
  const view = { ...fresh(), ...defaults, ...(saved || {}) };
  view.filters = Array.isArray(view.filters) ? view.filters : [];
  return { view, save: () => setPref(`plan.${page}`, view) };
}

/** The meetings dated `day`, by time (none where meetings are turned off). */
export const meetingsOn = (day) => (isEnabled('meeting')
  ? state.items.filter((i) => i.type === 'meeting' && i.fields.date === day)
    .sort((a, b) => String(a.fields.time || '').localeCompare(String(b.fields.time || '')) || a.title.localeCompare(b.title))
  : []);

/** A week's footer on Week (this week only): next week in a line — what is planned there, and the days still free. */
export function nextWeekLine(items) {
  const next = shiftWeek(thisWeek(), 1);
  const planned = items.filter((i) => PLANNABLE.has(i.type) && !isDone(i) && (i.fields.plan_week === next || (i.fields.plan_day && isoWeek(i.fields.plan_day) === next)));
  const busy = new Set(planned.map((i) => i.fields.plan_day).filter(Boolean));
  const free = 7 - busy.size;
  return h('a', { class: 'plan-next', href: '#/nextweek' },
    icon('calendarplus', 15), h('b', {}, 'Next week'),
    h('span', {}, `${next.split('-')[1]} · ${planned.length} planned, ${free} ${free === 1 ? 'day' : 'days'} free`),
    icon('right', 14));
}
