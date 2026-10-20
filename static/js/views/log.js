// Work log: a table grouped by day, with the time of each day totalled. Two kinds of rows:
// what you logged (click one to edit or delete it), and what the app suggests you did but
// did not log (accept it, adjust it first, or dismiss it). A from–to filter picks the days.
import { addDays, relDay, shiftWeek, thisWeek, today, weekDays } from '../dates.js';
import { fixedColumns } from '../datatable.js';
import { logForm } from '../logform.js';
import { opener } from '../links.js';
import { openItem } from '../panel.js';
import { logWork, state, unlogWork, updateLog } from '../state.js';
import { loadDismissed, saveDismissed, suggestLog } from '../suggestions.js';
import { emptyState, h, icon } from '../ui.js';
import { sumTime } from '../worktime.js';

const LOG_FIXED = fixedColumns(['time', 'kind', 'item', 'note', 'actions'].map((key) => ({ key }))); // the shared column widths

const PRESETS = {
  week: ['This week', () => [weekDays(thisWeek())[0], today()]],
  last: ['Last week', () => { const d = weekDays(shiftWeek(thisWeek(), -1)); return [d[0], d[6]]; }],
  d30: ['Last 30 days', () => [addDays(today(), -29), today()]],
  all: ['All', () => ['', '']],
};

// Kept while you move around the app.
let [from, to] = PRESETS.week[1]();
let kind = null;
let itemFilter = '';
let showSuggestions = true;
const dismissed = loadDismissed();

export function mount(root) {
  let open = null; // `entry:${date}#${index}` or `suggestion:${key}`: the row that is open

  const fromInput = h('input', { type: 'date', value: from, 'aria-label': 'From' });
  const toInput = h('input', { type: 'date', value: to, 'aria-label': 'To' });
  const onRange = () => { from = fromInput.value; to = toInput.value; if (from && to && from > to) { [from, to] = [to, from]; fromInput.value = from; toInput.value = to; } api.update(); };
  fromInput.addEventListener('change', onRange);
  toInput.addEventListener('change', onRange);
  const presets = h('div', { class: 'seg' });
  const search = h('input', { type: 'search', placeholder: 'Filter by item…', value: itemFilter, 'aria-label': 'Filter by item', 'data-filter': '' });
  search.addEventListener('input', () => { itemFilter = search.value.toLowerCase(); api.update(); });
  const suggestToggle = h('label', { class: 'toggle' }, h('input', {
    type: 'checkbox', checked: showSuggestions, onchange: (e) => { showSuggestions = e.target.checked; api.update(); },
  }), 'Suggestions');
  const restore = h('button', { class: 'btn small ghost', hidden: true, onclick: () => { dismissed.clear(); saveDismissed(dismissed); api.update(); } });
  const summary = h('div', { class: 'log-summary' });
  const table = h('div', { class: 'log-table' });
  root.replaceChildren(
    h('header', { class: 'view-head row' }, h('h1', {}, 'Work log'),
      h('div', { class: 'filters' }, presets, h('span', { class: 'range' }, fromInput, '–', toInput), search, suggestToggle, restore)),
    summary, table);

  const itemOf = (id) => state.byId.get(id);
  // The item an entry is about. One that no longer exists (deleted for good) is not a link: it shows the title the entry
  // remembered, and says so.
  const itemLink = (id, title) => {
    const item = itemOf(id);
    if (!item) {
      return h('span', { class: 'gone', title: 'This item was deleted; the time stays in the log' },
        h('span', { class: 'mono' }, id), ' ', title || '', ' ', h('span', { class: 'chip warn' }, 'deleted'));
    }
    return h('button', { class: 'link', ...opener(item, (it, e) => { e.stopPropagation(); openItem(it); }) }, h('span', { class: 'mono' }, id), ' ', item.title); // a live item shows its current title
  };
  const kindChip = (k) => h('span', { class: `chip kind k-${String(k).toLowerCase()}` }, k);
  const COLS = 5;
  const openRow = (key) => { open = key; api.update(); };
  const closeRow = () => { open = null; api.update(); };
  const rowKeys = (e) => (ev) => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); e(); } };

  const entryRows = (e) => {
    const key = `entry:${e.date}#${e.index}`;
    if (open === key) {
      return h('tr', { class: 'wl-edit' }, h('td', { colspan: COLS }, h('div', { class: 'log-edit-head' }, itemLink(e.id, e.title)), logForm(
        { kind: e.kind, time: e.time, date: e.date, note: e.note || '' }, {
          submitLabel: 'Save', fk: 'wl-edit',
          onSubmit: async (v) => { open = null; try { await updateLog(e.date, e.index, { kind: v.kind, time: v.time, note: v.note, new_date: v.date }); } catch { /* toasted */ } },
          onCancel: closeRow,
          onDelete: async () => { open = null; try { await unlogWork(e.date, e.index); } catch { /* toasted */ } },
        })));
    }
    return h('tr', { class: 'wl-row', tabindex: '0', title: 'Click to edit', 'aria-label': `${e.kind} ${e.time} on ${e.id}`, onclick: () => openRow(key), onkeydown: rowKeys(() => openRow(key)) },
      h('td', { class: `wl-time ${e.time === '00:00' ? 'zero' : ''}` }, e.time),
      h('td', {}, kindChip(e.kind)),
      h('td', { class: 'wl-item' }, itemLink(e.id, e.title)),
      h('td', { class: 'wl-note', title: e.note || null }, e.note || ''),
      h('td', { class: 'c-actions' }, h('span', { class: 'muted small', title: 'Logged at' }, e.at || '')));
  };

  const accept = async (s, values) => {
    open = null;
    try { await logWork(s.id, values.kind, values.note, values.date, values.time); } catch { /* toasted */ }
  };
  const dismiss = (s) => { dismissed.add(s.key); saveDismissed(dismissed); open = null; api.update(); };
  const suggestionRows = (s) => {
    const key = `suggestion:${s.key}`;
    if (open === key) {
      return h('tr', { class: 'wl-edit wl-suggest-edit' }, h('td', { colspan: COLS }, h('div', { class: 'log-edit-head' }, h('span', { class: 'chip suggested' }, icon('sparkles', 12), 'Suggested'), itemLink(s.id, s.title)),
        logForm({ kind: s.kind, time: '00:00', date: s.date, note: s.note }, {
          submitLabel: 'Add', fk: 'wl-suggest', deleteLabel: 'Dismiss', deleteIcon: 'x',
          onSubmit: (v) => accept(s, v), onCancel: closeRow, onDelete: () => dismiss(s),
        })));
    }
    return h('tr', { class: 'wl-row wl-suggest', tabindex: '0', title: 'Click to adjust before adding', onclick: () => openRow(key), onkeydown: rowKeys(() => openRow(key)) },
      h('td', { class: 'wl-time zero' }, '00:00'),
      h('td', {}, kindChip(s.kind)),
      h('td', { class: 'wl-item' }, h('span', { class: 'chip suggested', title: 'Suggested from your activity' }, icon('sparkles', 12)), itemLink(s.id, s.title)),
      h('td', { class: 'wl-note', title: s.note }, s.note),
      h('td', { class: 'c-actions' },
        h('button', { class: 'btn small', title: 'Add it as it is', onclick: (e) => { e.stopPropagation(); accept(s, { kind: s.kind, time: '00:00', date: s.date, note: s.note }); } }, icon('plus', 13), 'Add'),
        h('button', { class: 'btn icon', title: 'Dismiss this suggestion', 'aria-label': `Dismiss ${s.id}`, onclick: (e) => { e.stopPropagation(); dismiss(s); } }, icon('x', 14))));
  };

  const api = {
    update() {
      presets.replaceChildren(...Object.entries(PRESETS).map(([k, [label, range]]) => {
        const [f, t] = range();
        return h('button', {
          class: `btn small ${from === f && to === t ? 'active' : ''}`,
          onclick: () => { [from, to] = [f, t]; fromInput.value = f; toInput.value = t; api.update(); },
        }, label);
      }));
      const inRange = (d) => (!from || d >= from) && (!to || d <= to);
      const matches = (id, title) => !itemFilter || `${id} ${title || itemOf(id)?.title || ''}`.toLowerCase().includes(itemFilter);
      const entries = state.worklog.filter((e) => inRange(e.date) && matches(e.id));
      const shownEntries = entries.filter((e) => !kind || e.kind === kind);
      const suggestions = showSuggestions
        ? suggestLog({ items: state.all, worklog: state.worklog, from, to, today: today(), dismissed })
          .filter((s) => matches(s.id, s.title) && (!kind || s.kind === kind)) : [];
      restore.hidden = !dismissed.size;
      restore.textContent = `Restore ${dismissed.size} dismissed`;

      const kinds = [...new Set([...state.config.work_kinds, ...entries.map((e) => e.kind)])];
      const minutes = sumTime(entries);
      summary.replaceChildren(
        h('div', { class: 'kind-legend' }, kinds.map((k) => {
          const of = entries.filter((e) => e.kind === k);
          return h('button', {
            class: `chip kind k-${k.toLowerCase()} ${kind === k ? 'on' : ''} ${of.length ? '' : 'off'}`,
            title: `${of.length} entr${of.length === 1 ? 'y' : 'ies'}`,
            onclick: () => { kind = kind === k ? null : k; api.update(); },
          }, `${k} · ${sumTime(of)}`);
        }),
        h('span', { class: 'muted' }, `${entries.length} entries · ${minutes} · ${new Set(entries.map((e) => e.id)).size} items · ${new Set(entries.map((e) => e.date)).size} days`
          + (suggestions.length ? ` · ${suggestions.length} suggested` : ''))));

      const days = new Map();
      const day = (d) => days.get(d) || days.set(d, { entries: [], suggestions: [] }).get(d);
      for (const e of shownEntries) day(e.date).entries.push(e);
      for (const s of suggestions) day(s.date).suggestions.push(s);
      const ordered = [...days].sort((a, b) => b[0].localeCompare(a[0]));
      if (!ordered.length) { table.replaceChildren(emptyState(showSuggestions ? 'No work logged in this range, and nothing to suggest.' : 'No work logged in this range.')); return; }

      const body = [];
      for (const [d, { entries: es, suggestions: ss }] of ordered) {
        es.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
        body.push(h('tr', { class: 'day-head' }, h('td', { colspan: COLS }, h('strong', {}, relDay(d)), h('span', { class: 'muted' }, ` ${d}`),
          h('span', { class: 'count' }, es.length + ss.length))));
        body.push(...es.map(entryRows), ...ss.map(suggestionRows));
        body.push(h('tr', { class: 'day-total' },
          h('td', { class: 'wl-time' }, sumTime(es)),
          h('td', { colspan: COLS - 1 }, `Total · ${es.length} entr${es.length === 1 ? 'y' : 'ies'}`,
            ss.length ? h('span', { class: 'muted' }, ` · ${ss.length} suggested, not counted`) : null)));
      }
      table.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'grid fixed log-grid', style: LOG_FIXED.style, 'aria-label': 'Work log' }, LOG_FIXED.colgroup.cloneNode(true),
        h('thead', {}, h('tr', {}, ['Time', 'Type', 'Item', 'Notes'].map((c) => h('th', { scope: 'col' }, c)), h('th', { scope: 'col', class: 'c-actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', {}, body))));
    },
  };
  return api;
}
