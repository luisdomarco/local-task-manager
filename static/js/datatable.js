// Sortable table shared by the list views and the initiative page, plus the
// column definitions they have in common. A column is
//   { key, label, get(item) → sort value, cell(item) → node/string, cls? }
import { relDay, shortDate } from './dates.js';
import { peopleOf } from './people.js';
import { EXTERNAL_REF, PRIORITIES, PRIORITY_RANK, defaultOf, isDone, isOverdue, statusesOf } from './rules.js';
import { pref, setPref } from './prefs.js';
import { planControl, planKey, planValues } from './itemform.js';
import { progress, setStatus, state, updateItem } from './state.js';
import { itemHref, opener } from './links.js';
import { cssKey, h, icon, labelChip, select } from './ui.js';

export { pageHref } from './links.js'; // the types with a page (rules.js hasPage); everything else opens as a card modal

// One width per column key, shared by every table (lists, the tables on an item, All items, Trash,
// Labels, the work log), so a column looks the same wherever it appears. The subject (and a work
// log's notes) have none: they take what is left, at least their FLEX minimum, and wrap. Wider
// content is cut, with the full text on hover.
const WIDTH = {
  check: 44, id: 100, type: 130, status: 136, priority: 112, labels: 170, parent: 220, related: 220, initiative: 220,
  progress: 150, plan: 150, due: 108, session: 160, project: 180,
  created_at: 108, updated_at: 108, date: 108, duration: 96, attendees: 220, source: 180,
  resolved: 116, state: 100,
  deleted_at: 108, path: 260, unlinked: 96, count: 96, edit: 96, actions: 150,
  day: 84, time: 72, kind: 116, item: 320,
  exported: 140, vault: 160, host: 150, version: 230, size: 90, calendar_name: 220, emails: 280, redmine: 140, extref: 140, slack: 160,
  started: 140, when: 96, folder: 140, model: 80, effort: 80, cs_actions: 196, cs_actions_compact: 132, last: 140, last_short: 96, // Claude sessions (claude.js)
};
const FLEX = { subject: 480, note: 100, name: 200 }; // name: a person's or label's, beside its own columns

/** The <colgroup> and min-width that fix a table's columns to WIDTH (see .grid.fixed). */
export function fixedColumns(columns) {
  const w = (c) => (c.key in FLEX ? 0 : WIDTH[c.key] || 120);
  const min = columns.reduce((sum, c) => sum + (w(c) || FLEX[c.key]), 0);
  return {
    colgroup: h('colgroup', {}, columns.map((c) => h('col', { class: `c-${c.key}`, style: w(c) ? `width:${w(c)}px` : null }))),
    style: `min-width:${min}px`,
  };
}

// ── paging ───────────────────────────────────────────────────────────────────
// Every table shows its rows a page at a time. How many per page is remembered (prefs.js page.<key>)
// per kind of table — the Tasks list, the notes table of any item… — never per item: picking 5 for the
// notes of one task gives 5 on every other task. Which page you are on lasts only this visit.
export const PAGE_SIZES = [5, 10, 15, 20, 50, 100];
export const LIST_PAGE = 20; // a main list: Initiatives, Tasks, All items…
export const DETAIL_PAGE = 5; // a table inside an item's card or page
const pageAt = new Map(); // `at` → { index, total }

/**
 * The page of `rows` to show, and the bar under the table that moves between pages and picks the size.
 *   key      what the size is remembered under (a kind of table)
 *   at       which table it is, for its page (defaults to key; an item's tables pass their item too)
 *   size     the size when none is remembered
 *   onChange re-renders the table after a page or size change
 * The page goes back to the first when the number of rows changes (a filter, a search). No bar while
 * everything fits in the smallest page.
 */
export function paged({ key, at = key, rows, size: fallback, onChange }) {
  const saved = pref(`page.${key}`);
  const size = PAGE_SIZES.includes(saved) ? saved : fallback;
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const was = pageAt.get(at);
  const index = was && was.total === total ? Math.min(was.index, pages - 1) : 0;
  pageAt.set(at, { index, total });
  const from = index * size;
  const go = (i) => { pageAt.set(at, { index: i, total }); onChange(); };
  const pager = total > PAGE_SIZES[0] ? h('div', { class: 'pager', role: 'navigation', 'aria-label': 'Pages' },
    h('span', { class: 'muted small pager-range' }, `${from + 1}–${Math.min(from + size, total)} of ${total}`),
    h('button', { class: 'btn icon', type: 'button', title: 'Previous page', 'aria-label': 'Previous page', 'data-pg': 'prev', disabled: index === 0, onclick: () => go(index - 1) }, icon('left', 15)),
    h('span', { class: 'small pager-page' }, `${index + 1} / ${pages}`),
    h('button', { class: 'btn icon', type: 'button', title: 'Next page', 'aria-label': 'Next page', 'data-pg': 'next', disabled: index >= pages - 1, onclick: () => go(index + 1) }, icon('right', 15)),
    h('span', { class: 'spacer' }),
    h('span', { class: 'muted small' }, 'Rows'),
    select(PAGE_SIZES.map((n) => [n, String(n)]), size, (n) => {
      setPref(`page.${key}`, n === fallback ? null : n);
      pageAt.set(at, { index: 0, total });
      onChange();
    }, { class: 'small pager-size', 'aria-label': 'Rows per page', 'data-pg': 'size' })) : null;
  return { rows: rows.slice(from, from + size), from, size, pager };
}

/** Re-render `box` with build() keeping focus on the pager control that had it (a page button, the size). */
function refocus(box, build) {
  const pg = document.activeElement?.closest?.('[data-pg]')?.dataset.pg;
  box.replaceChildren(...build());
  if (pg) box.querySelector(`[data-pg="${pg}"]:not([disabled])`)?.focus();
}

/** A box that keeps a paged table and its pager: build(rerender) returns [table, pager]. */
export function pagedBox(build) {
  const box = h('div', { class: 'paged' });
  const rerender = () => refocus(box, () => build(rerender).filter(Boolean));
  box.replaceChildren(...build(rerender).filter(Boolean));
  return box;
}

/**
 * dataTable({ columns, rows, sort, onSort, onRow, empty, label, rowClass, group, paging })
 * `group` (optional) arranges the rows under headers: { by(row) → key, header(key, rows) → node,
 * order(a, b)?, collapsed: Set of keys, onToggle(key) }. The sort still applies inside each group.
 * `paging` (optional) shows the rows a page at a time: { key, at?, size } as in paged(). The table
 * then turns its own pages, without its caller re-rendering it.
 */
export function dataTable({ columns, rows, sort, onSort, onRow, empty = 'Nothing here.', label = 'Items', rowClass = null, group = null, paging = null }) {
  const col = columns.find((c) => c.key === sort.col) || columns[0];
  const sorted = rows.slice().sort((a, b) => {
    const x = col.get(a); const y = col.get(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
  const ariaSort = (c) => (sort.col === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : null);
  // Rows are focusable and open on Enter / Space, like the click.
  const row = (i) => h('tr', {
    class: rowClass ? rowClass(i) : (isDone(i) ? 'done' : ''), tabindex: '0', 'aria-label': `${i.id || ''} ${i.title ?? i.subject ?? ''}`.trim(),
    ...opener(i, onRow), // ⌘/Ctrl or middle click: in a new tab
    onkeydown: (e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRow(i); }
    },
  }, columns.map((c) => h('td', { class: c.cls ? `c-${c.key} ${c.cls}` : `c-${c.key}` }, c.cell(i)))); // cls: as its header (num: right-aligned)
  const fixed = fixedColumns(columns);
  const groups = group ? groupsOf(sorted, group) : null;
  // What pages through: the rows in display order (grouped, the unfolded groups' rows).
  const flow = groups ? groups.flatMap(([k, members]) => (group.collapsed.has(k) ? [] : members)) : sorted;
  const table = (page) => h('div', { class: 'table-wrap' }, h('table', { class: 'grid fixed', style: fixed.style, 'aria-label': label },
    fixed.colgroup.cloneNode(true),
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: `${sort.col === c.key ? 'sorted' : ''} ${c.cls || ''}`, 'aria-sort': ariaSort(c), scope: 'col' },
      c.label ? h('button', {
        class: 'th-btn', onclick: () => onSort({ col: c.key, dir: sort.col === c.key ? -sort.dir : 1 }),
      }, c.label, sort.col === c.key ? icon(sort.dir > 0 ? 'up' : 'down', 13) : null) : h('span', { class: 'sr-only' }, 'Done'))))),
    h('tbody', {}, !sorted.length ? h('tr', {}, h('td', { colspan: columns.length, class: 'empty' }, empty))
      : groups ? groupedRows(groups, columns.length, group, row, page) : page.rows.map(row))));
  if (!paging) return table({ rows: flow, from: 0, size: Infinity });
  return pagedBox((rerender) => {
    const page = paged({ ...paging, rows: flow, onChange: rerender });
    return [table(page), page.pager];
  });
}

/** The rows by group, groups in their order: [[key, rows], …]. */
function groupsOf(sorted, group) {
  const groups = new Map();
  for (const r of sorted) {
    const key = group.by(r);
    (groups.get(key) || groups.set(key, []).get(key)).push(r);
  }
  return [...groups.keys()].sort(group.order || (() => 0)).map((k) => [k, groups.get(k)]);
}

/**
 * The rows of this page under their group headers; a header click folds or unfolds its group. A group
 * shows its header on the pages its rows are on (its count is all of them); a folded one, on the page
 * where its rows would start.
 */
function groupedRows(groups, span, group, row, page) {
  const end = page.from + page.size;
  const total = groups.reduce((n, [k, m]) => n + (group.collapsed.has(k) ? 0 : m.length), 0);
  let at = 0; // where this group starts in the flow of unfolded rows
  return groups.flatMap(([key, members]) => {
    const folded = group.collapsed.has(key);
    const start = at;
    if (!folded) at += members.length;
    const shown = folded ? [] : members.slice(Math.max(0, page.from - start), Math.max(0, end - start));
    // A folded group sits where its rows would start; one after the last row, on the last page.
    const here = folded ? start >= page.from && (start < end || end >= total) : shown.length > 0;
    if (!here) return [];
    const head = h('tr', { class: 'group-head', 'aria-expanded': String(!folded) },
      h('td', { colspan: span }, h('button', {
        class: 'group-toggle', type: 'button', 'aria-expanded': String(!folded), onclick: () => group.onToggle(key),
      }, icon(folded ? 'right' : 'down', 14), group.header(key, members))));
    return [head, ...shown.map(row)];
  });
}

// ── shared columns ───────────────────────────────────────────────────────────
// The subject is a real link to the item, so the browser offers "Open in new tab" on it; the row's click opens it here.
const subjectLink = (i) => h('a', { class: 'item-link', href: itemHref(i), tabindex: '-1' }, i.title);
const title = (i) => i.fields.related_to ? state.byId.get(i.fields.related_to)?.title || i.fields.related_to : '';
const isInitiative = (i) => state.byId.get(i.fields.related_to)?.type === 'initiative';
/** A Ticketing project's name, from its key; a key with no project note is its own name. */
export const projectName = (key) => state.all.find((p) => p.type === 'project' && p.fields.project_key === key)?.title || key;

export const COL = {
  id: { key: 'id', label: 'ID', get: (i) => i.id || '', cell: (i) => h('span', { class: 'mono' }, i.id || '—') },
  // Labels have their own column (COL.labels), next to Priority where there is one.
  subject: {
    key: 'subject', label: 'Subject', get: (i) => i.title.toLowerCase(),
    cell: (i) => h('span', { class: 'title-cell' }, subjectLink(i),
      i.fields.archived ? h('span', { class: 'chip warn' }, 'archived') : null),
  },
  // The subject alone: for lists with their own Archived (State) column.
  subjectPlain: { key: 'subject', label: 'Subject', get: (i) => i.title.toLowerCase(), cell: (i) => h('span', { class: 'title-cell' }, subjectLink(i)) },
  // Status and priority are edited in place: the selects swallow the click so the row does not open. The statuses
  // are the item's type's (a Ticketing error: open · mitigated · resolved). A change the server refuses (a status a
  // rule does not allow yet) was already said in a toast: it is not left as an unhandled rejection.
  status: { key: 'status', label: 'Status', get: (i) => statusesOf(i.type).indexOf(i.fields.status || statusesOf(i.type)[0]),
    cell: (i) => select(statusesOf(i.type).map((s) => [s, s]), i.fields.status || statusesOf(i.type)[0], (v) => setStatus(i, v).catch(() => {}),
      { class: `status-select small s-${cssKey(i.fields.status || 'backlog')}`, 'aria-label': `Status of ${i.title}`, onclick: (e) => e.stopPropagation() }) },
  priority: {
    key: 'priority', label: 'Priority', get: (i) => PRIORITY_RANK[i.fields.priority] || 3,
    cell: (i) => select(PRIORITIES.map((p) => [p, p]), i.fields.priority || defaultOf('priority', 'Normal'), (v) => updateItem(i.key, { priority: v }).catch(() => {}),
      { class: `prio-select small pr-${String(i.fields.priority || 'normal').toLowerCase()}`, 'aria-label': `Priority of ${i.title}`, onclick: (e) => e.stopPropagation() }),
  },
  // A transcription's meeting; one without it is flagged (it hangs from nothing).
  meetingOf: {
    key: 'parent', label: 'Meeting', get: (i) => title(i).toLowerCase(),
    cell: (i) => (i.fields.related_to ? h('span', { class: 'chip parent', title: title(i) }, title(i)) : h('span', { class: 'chip warn' }, 'no meeting')),
  },
  parent: (label) => ({
    key: 'parent', label, get: (i) => title(i).toLowerCase(),
    cell: (i) => (i.fields.related_to ? h('span', { class: 'chip parent', title: title(i) }, title(i)) : h('span', { class: 'muted' }, '—')),
  }),
  // Ticketing's two parent columns, as its forms split them (rules.js splitsInitiative): the initiative it hangs from,
  // and (`related:<heading>`) a parent of any other type.
  initiative: {
    key: 'initiative', label: 'Initiative', get: (i) => (isInitiative(i) ? title(i).toLowerCase() : '~'),
    cell: (i) => (isInitiative(i) ? h('span', { class: 'chip parent', title: title(i) }, title(i)) : h('span', { class: 'muted' }, '—')),
  },
  parentOther: (label) => ({
    key: 'parent', label, get: (i) => (i.fields.related_to && !isInitiative(i) ? title(i).toLowerCase() : '~'),
    cell: (i) => (i.fields.related_to && !isInitiative(i) ? h('span', { class: 'chip parent', title: title(i) }, title(i)) : h('span', { class: 'muted' }, '—')),
  }),
  // Edited in place like Status: the same Planned select as the item's card (itemform.js).
  plan: {
    key: 'plan', label: 'Planned', get: (i) => i.fields.plan_day || i.fields.plan_week || '~',
    cell: (i) => {
      let current = planKey(i.fields);
      return h('span', { onclick: (e) => e.stopPropagation() }, planControl(() => current, (v) => {
        current = planKey(planValues(v)); // a picked date that is today reads back as "Today"
        updateItem(i.key, { plan_day: null, plan_week: null, ...planValues(v) }).catch(() => {});
      }, { class: 'small', 'aria-label': `Planned for ${i.title}` }, { short: true }));
    },
  },
  due: {
    key: 'due', label: 'Due date', get: (i) => i.fields.due || '~',
    cell: (i) => (i.fields.due ? h('span', { class: isOverdue(i) ? 'chip late' : '' }, relDay(i.fields.due)) : ''),
  },
  progress: {
    key: 'progress', label: 'Progress', get: (i) => progress(i.id).pct,
    cell: (i) => {
      const p = progress(i.id);
      return h('div', { class: 'cell-progress', title: `${p.done}/${p.total} tasks closed` },
        h('div', { class: 'progress' }, h('div', { style: `width:${p.pct}%` })), h('span', {}, `${p.done}/${p.total}`));
    },
  },
  // The types that carry it only (initiatives and stories in the folder-per-type structure): the issue of the vault's outside tracker
  // they point at (Redmine, rules.js EXTERNAL_REF). Its heading is read when drawn: the structure comes after this.
  // A Ticketing item's project: the field holds its key; the column shows the project's name, cut to the
  // column's width, with "KEY · Name" on hover. A key with no project note shows as itself.
  project: { key: 'project', label: 'Project', get: (i) => (i.fields.project ? projectName(i.fields.project).toLowerCase() : '~'),
    cell: (i) => (i.fields.project
      ? h('span', { class: 'chip parent project-name', title: `${i.fields.project} · ${projectName(i.fields.project)}` }, projectName(i.fields.project))
      : h('span', { class: 'muted' }, '—')) },
  // One of a type's own fields (TypeDef.props), as text.
  prop: (key, label) => ({ key: `prop:${key}`, label, get: (i) => String(i.fields[key] ?? '~'),
    cell: (i) => {
      const v = i.fields[key];
      if (v === null || v === undefined || v === '') return '';
      return h('span', { class: `prop-cell prop-${key} v-${String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-')}` },
        Array.isArray(v) ? v.join(', ') : String(v));
    } }),
  extref: {
    key: 'extref', get label() { return `${EXTERNAL_REF.label} ID`; }, get: (i) => String(i.fields[EXTERNAL_REF.id_key] || '~'),
    cell: (i) => (i.fields[EXTERNAL_REF.id_key] ? h('span', { class: 'mono' }, `#${i.fields[EXTERNAL_REF.id_key]}`) : ''),
  },
  // A meeting's or an activity's day; sorted with its time, so the same day's come in the order they happened.
  date: {
    key: 'date', label: 'Date', get: (i) => `${i.fields.date || '0000'} ${i.fields.time || ''}`,
    cell: (i) => (i.fields.date ? relDay(i.fields.date) : ''),
  },
  time: {
    key: 'time', label: 'Time', cls: 'num', get: (i) => i.fields.time || '',
    cell: (i) => i.fields.time || '',
  },
  duration: {
    key: 'duration', label: 'Duration', cls: 'num', get: (i) => i.fields.duration || '',
    cell: (i) => i.fields.duration || '',
  },
  attendees: {
    key: 'attendees', label: 'Attendees', get: (i) => (i.fields.attendees || []).join(', ').toLowerCase(),
    cell: (i) => h('span', { title: (i.fields.attendees || []).join(', ') || null }, (i.fields.attendees || []).join(', ')),
  },
  // An activity's source (Email, Slack…) and, in a column of its own, who it came from. The source's tooltip still
  // names them, for a table without the From column (an item's Activity tab).
  source: {
    key: 'source', label: 'Source', get: (i) => (i.fields.source || '~').toLowerCase(),
    cell: (i) => (i.fields.source ? h('span', { class: 'chip source', title: peopleOf(i.fields.from).length ? `From ${peopleOf(i.fields.from).join(', ')}` : null }, i.fields.source) : ''),
  },
  from: {
    key: 'from', label: 'From', get: (i) => peopleOf(i.fields.from).join(', ').toLowerCase() || '~',
    cell: (i) => h('span', { title: peopleOf(i.fields.from).join(', ') || null }, peopleOf(i.fields.from).join(', ')),
  },
  resolved: {
    key: 'resolved', label: 'Resolved', get: (i) => String(i.fields.resolved_at || '~'),
    cell: (i) => (i.fields.resolved_at ? h('span', { class: 'chip ok', title: i.fields.resolution || '' }, icon('check', 12), shortDate(i.fields.resolved_at))
      : h('span', { class: 'chip warn' }, 'open')),
  },
  labels: {
    key: 'labels', label: 'Labels', get: (i) => (i.fields.labels || []).join(' ').toLowerCase(),
    cell: (i) => ((i.fields.labels || []).length
      ? h('span', { class: 'chips-inline', title: (i.fields.labels || []).map((l) => `#${l}`).join('  ') }, (i.fields.labels || []).map((l) => labelChip(l)))
      : h('span', { class: 'muted' }, '—')),
  },
  // Active until archived (notes and prompts have no status).
  state: { key: 'state', label: 'State', get: (i) => (i.fields.archived === true ? 1 : 0), cell: (i) => (i.fields.archived === true ? h('span', { class: 'chip warn' }, 'archived') : h('span', { class: 'chip ok' }, 'active')) },
  created: { key: 'created_at', label: 'Created', get: (i) => String(i.fields.created_at || ''), cell: (i) => shortDate(i.fields.created_at) },
  updated: { key: 'updated_at', label: 'Updated', get: (i) => String(i.fields.updated_at || ''), cell: (i) => shortDate(i.fields.updated_at) },
};

// Initiatives, stories and tasks: Planned and Due date (and the tracker's ID, where there is one) right after Priority.
export const TASK_COLUMNS = [COL.id, COL.subject, COL.status, COL.priority, COL.plan, COL.due, COL.labels,
  COL.parent('Related to'), COL.updated];

/** A column of the structure's list config (tm/structures): a COL by its name, `parent:<heading>`, `related:<heading>`
 *  (a parent that is not an initiative, beside an `initiative` column), or
 *  `prop:<field>:<heading>` (one of the type's own fields, as text: a support ticket's level, an error's severity…). */
export function columnOf(name) {
  if (name.startsWith('parent:')) return COL.parent(name.slice('parent:'.length));
  if (name.startsWith('related:')) return COL.parentOther(name.slice('related:'.length));
  if (name.startsWith('prop:')) {
    const [, key, label] = name.split(':');
    return COL.prop(key, label || key);
  }
  return COL[name];
}
