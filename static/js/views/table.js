// All items: every item, sortable by any column, with the filters it shares with the Board (filterbar.js).
import { relDay, shortDate } from '../dates.js';
import { LIST_PAGE, fixedColumns, paged } from '../datatable.js';
import { itemHref, opener } from '../links.js';
import { openItem } from '../panel.js';
import { createFilters } from '../filterbar.js';
import { saveSort, savedSort } from '../prefs.js';
import { PLANNABLE, PRIORITY_RANK, isArchived, isDone, statusRank } from '../rules.js';
import { progress, state } from '../state.js';
import { checkbox, h, icon, typeIcon, priorityChip, statusChip } from '../ui.js';

const TYPES = ['inbox', 'initiative', 'story', 'task', 'note', 'transcription', 'meeting', 'activity'];
const flt = createFilters({ types: TYPES });
let sort = savedSort('items', { col: 'updated_at', dir: -1 });

const parentTitle = (id) => (id ? state.byId.get(id)?.title || id : '');

const COLUMNS = [
  { key: 'check', label: '', get: (i) => (isDone(i) ? 1 : 0), cell: (i) => checkbox(i) },
  { key: 'id', label: 'ID', get: (i) => i.id || '', cell: (i) => h('span', { class: 'mono' }, i.id || '—') },
  { key: 'subject', label: 'Subject', get: (i) => i.title.toLowerCase(),
    cell: (i) => h('span', { class: 'title-cell' }, i.title, isArchived(i) ? h('span', { class: 'chip warn' }, 'archived') : null) },
  { key: 'type', label: 'Type', get: (i) => i.type, cell: (i) => h('span', { class: `chip t-${i.type}` }, typeIcon(i.type, 12), i.type) },
  { key: 'status', label: 'Status', get: (i) => (PLANNABLE.has(i.type) ? statusRank(i.type, i.fields.status) : 9999),
    cell: (i) => (PLANNABLE.has(i.type) && i.fields.status ? statusChip(i.fields.status) : '') },
  { key: 'priority', label: 'Priority', get: (i) => (PLANNABLE.has(i.type) ? PRIORITY_RANK[i.fields.priority] || 3 : 9),
    cell: (i) => (PLANNABLE.has(i.type) ? priorityChip(i.fields.priority || 'Normal') : '') },
  { key: 'related', label: 'Related to', get: (i) => parentTitle(i.fields.related_to).toLowerCase(), cell: (i) => (i.fields.related_to ? h('span', { class: 'chip parent', title: parentTitle(i.fields.related_to) }, parentTitle(i.fields.related_to)) : '') },
  { key: 'plan', label: 'Plan', get: (i) => i.fields.plan_day || i.fields.plan_week || '~', cell: (i) => (i.fields.plan_day ? relDay(i.fields.plan_day) : i.fields.plan_week || '') },
  { key: 'due', label: 'Due / Date', get: (i) => i.fields.due || i.fields.date || '~', cell: (i) => shortDate(i.fields.due || i.fields.date) },
  { key: 'progress', label: 'Progress', get: (i) => (i.type === 'initiative' ? progress(i.id).pct : i.checklist.total ? (100 * i.checklist.done) / i.checklist.total : -1),
    cell: (i) => (i.type === 'initiative' ? `${progress(i.id).pct}%` : i.checklist.total ? `${i.checklist.done}/${i.checklist.total}` : '') },
  { key: 'session', label: 'Session', get: (i) => String(i.fields.session_name || '~').toLowerCase(),
    cell: (i) => (i.fields.session_name ? h('span', { class: 'chip session', title: i.fields.session_name }, i.fields.session_name) : '') },
  { key: 'created_at', label: 'Created at', get: (i) => String(i.fields.created_at || ''), cell: (i) => shortDate(i.fields.created_at) },
  { key: 'updated_at', label: 'Updated at', get: (i) => String(i.fields.updated_at || ''), cell: (i) => shortDate(i.fields.updated_at) },
];

export function mount(root) {
  const fixed = fixedColumns(COLUMNS);
  const table = h('table', { class: 'grid fixed', style: fixed.style });
  const bar = flt.bar(() => api.update());
  const pagerSlot = h('div');
  root.replaceChildren(
    h('header', { class: 'view-head row' }, h('h1', {}, 'All items')),
    bar,
    h('div', { class: 'table-wrap' }, table),
    pagerSlot);

  const api = {
    update() {
      bar.refresh();
      const col = COLUMNS.find((c) => c.key === sort.col) || COLUMNS.find((c) => c.key === 'updated_at');
      const all = flt.source().filter(flt.matches)
        .sort((a, b) => { const x = col.get(a); const y = col.get(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
      const page = paged({ key: 'items', rows: all, size: LIST_PAGE, onChange: () => api.update() });
      const { rows } = page;
      pagerSlot.replaceChildren(...(page.pager ? [page.pager] : []));
      table.replaceChildren(
        fixed.colgroup,
        // The same header as every other table (datatable.js): a button per column, the arrow on the sorted one.
        h('thead', {}, h('tr', {}, COLUMNS.map((c) => h('th', {
          class: sort.col === c.key ? 'sorted' : '', scope: 'col',
          'aria-sort': sort.col === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : null,
        }, h('button', {
          class: 'th-btn', onclick: () => { sort = { col: c.key, dir: sort.col === c.key ? -sort.dir : 1 }; saveSort('items', sort); api.update(); },
        }, c.label, sort.col === c.key ? icon(sort.dir > 0 ? 'up' : 'down', 13) : null))))),
        h('tbody', {}, rows.length ? rows.map((i) => h('tr', { class: isDone(i) ? 'done' : '', ...opener(i, openItem) },
          COLUMNS.map((c) => h('td', { class: `c-${c.key}` }, c.cell(i)))))
          : h('tr', {}, h('td', { colspan: COLUMNS.length, class: 'empty' }, 'No items match.'))),
      );
    },
  };
  return api;
}
