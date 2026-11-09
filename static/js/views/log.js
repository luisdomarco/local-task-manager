// Work log: the time logged, as a list — the bar of every list (search, Filter, the date range, Group, Display), then a
// table grouped by day (or week, item, kind, or not at all), each group with its entries and time. Three kinds of rows:
// what you logged (click one to edit or delete it); what the worklog proposal command proposed (tentative: dashed,
// not counted until you confirm it — one by one, or the whole day — or discard it); and what the app suggests you
// did but did not log (accept it, adjust it first, or dismiss it). Which rows and columns show is the page's view
// (worklogview.js), kept per vault (prefs.js `worklog.view`); the range lasts while you move around the app.
import { dateInput } from '../datepicker.js';
import { addDays, relDay, shiftWeek, shortDate, thisWeek, today, weekDays } from '../dates.js';
import { fixedColumns } from '../datatable.js';
import { logForm } from '../logform.js';
import { opener } from '../links.js';
import { openItem } from '../panel.js';
import { pref, setPref } from '../prefs.js';
import { TYPE_DEFS } from '../rules.js';
import { confirmLog, discardLog, logWork, state, unlogWork, updateLog } from '../state.js';
import { loadDismissed, saveDismissed, suggestLog } from '../suggestions.js';
import { h, icon, pageCount, pageEmpty, pageHead, rowAction } from '../ui.js';
import { closePopover, popover, viewBar } from '../viewbar.js';
import { columnOn, fresh, matches } from '../viewmodel.js';
import { LOG_GROUPS, LOG_PROPS, groupName, groupSummary, logFields, logGroupLabel, logGroups } from '../worklogview.js';
import { isTentative, sumTime } from '../worktime.js';
import { refOf } from '../shownid.js';

const PRESETS = {
  week: ['This week', () => [weekDays(thisWeek())[0], today()]],
  last: ['Last week', () => { const d = weekDays(shiftWeek(thisWeek(), -1)); return [d[0], d[6]]; }],
  d30: ['Last 30 days', () => [addDays(today(), -29), today()]],
  all: ['All', () => ['', '']],
};

// Kept while you move around the app.
let [from, to] = PRESETS.week[1]();
let itemFilter = '';
const dismissed = loadDismissed();

/** The page's view: a list's (filters, group, columns) plus whether suggestions show; grouped by day at first. */
function viewOf() {
  const view = { ...fresh(), groupBy: 'day', suggestions: true, ...(pref('worklog.view', null) || {}) };
  view.filters = Array.isArray(view.filters) ? view.filters : [];
  view.folded = Array.isArray(view.folded) ? view.folded : [];
  return { view, save: () => setPref('worklog.view', view) };
}

/** The range as the bar's button says it: a preset's name, else its two days. */
function rangeLabel() {
  const preset = Object.values(PRESETS).find(([, range]) => { const [f, t] = range(); return f === from && t === to; });
  if (preset) return preset[0];
  return `${from ? shortDate(from) : '…'} – ${to ? shortDate(to) : '…'}`;
}

export function mount(root) {
  let open = null; // `entry:${date}#${index}` or `suggestion:${key}`: the row that is open
  const { view, save } = viewOf();
  const change = (patch) => { Object.assign(view, patch); save(); api.update(); };

  // ── the date range: a button on the bar, its presets and its two days in a popover ──
  const fromInput = dateInput(from, { clearable: false, placeholder: 'From', 'aria-label': 'From' });
  const toInput = dateInput(to, { clearable: false, placeholder: 'To', 'aria-label': 'To' });
  const onRange = () => { from = fromInput.value; to = toInput.value; if (from && to && from > to) { [from, to] = [to, from]; fromInput.value = from; toInput.value = to; } api.update(); };
  fromInput.addEventListener('change', onRange);
  toInput.addEventListener('change', onRange);
  const rangeText = h('span', {});
  const rangeBtn = h('button', { type: 'button', class: 'btn ghost small vb-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Days shown' },
    icon('calendar', 14), rangeText, icon('down', 12));
  const renderRange = (el) => el.replaceChildren(
    h('div', { class: 'menu-label' }, 'Show'),
    ...Object.values(PRESETS).map(([label, range]) => {
      const [f, t] = range();
      const on = f === from && t === to;
      return h('button', {
        type: 'button', class: `menu-item ${on ? 'current' : ''}`, 'aria-pressed': String(on),
        onclick: () => { [from, to] = [f, t]; fromInput.value = f; toInput.value = t; closePopover(); api.update(); },
      }, h('span', {}, label), on ? icon('check', 14) : null);
    }),
    h('div', { class: 'menu-sep' }),
    h('div', { class: 'vb-row' }, h('span', {}, 'From'), fromInput),
    h('div', { class: 'vb-row' }, h('span', {}, 'To'), toInput));
  rangeBtn.addEventListener('click', () => popover(rangeBtn, renderRange, { width: 280 }));

  // ── the bar ──
  const itemOf = (id) => state.byId.get(id);
  const ctx = () => ({ kinds: state.config.work_kinds, typeOf: (id) => itemOf(id)?.type, typeName: (t) => TYPE_DEFS[t]?.plural || t });
  const fields = () => logFields(ctx());
  let pool = []; // the rows in the range that match the search: what Filter counts over
  const seg = (pairs, current, pick, aria) => h('div', { class: 'seg', role: 'group', 'aria-label': aria }, ...pairs.map(([k, l]) => h('button', {
    type: 'button', class: `btn small ${current === k ? 'active' : ''}`, 'aria-pressed': String(current === k), onclick: () => pick(k),
  }, l)));
  const vb = viewBar({
    view, save, fields, ctx, items: () => pool,
    groups: LOG_GROUPS.map(([k]) => k), groupLabel: logGroupLabel,
    props: LOG_PROPS, lead: [rangeBtn], emptyGroups: false,
    placeholder: 'Filter by item…', onText: (text) => { itemFilter = text.trim().toLowerCase(); api.update(); },
    // Display: suggestions on or off, and the dismissed ones back.
    displayRows: () => [
      h('div', { class: 'vb-row' }, h('span', {}, 'Suggestions'),
        seg([[false, 'Hide'], [true, 'Show']], view.suggestions !== false, (on) => { change({ suggestions: on }); closePopover(); }, 'Suggestions')),
      dismissed.size ? h('div', { class: 'vb-row' }, h('span', { class: 'muted' }, `${dismissed.size} dismissed`),
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => { dismissed.clear(); saveDismissed(dismissed); closePopover(); api.update(); } }, 'Restore')) : null,
      h('div', { class: 'menu-sep' }),
    ].filter(Boolean),
    onReset: () => { view.groupBy = 'day'; view.suggestions = true; view.folded = []; },
    onChange: () => api.update(),
  });
  vb.search.value = itemFilter;
  const count = pageCount();
  const table = h('div', { class: 'log-table' });
  root.replaceChildren(pageHead({ title: 'Work log', count }), vb.bar, vb.chips, table);

  // The item a row is about. One that no longer exists (deleted for good) is not a link: it shows the title the entry
  // remembered, and says so.
  const itemLink = (id, title) => {
    const item = itemOf(id);
    if (!item) {
      return h('span', { class: 'gone', title: 'This item was deleted; the time stays in the log' },
        h('span', { class: 'mono' }, id), ' ', title || '', ' ', h('span', { class: 'chip warn' }, 'deleted'));
    }
    return h('button', { class: 'link', ...opener(item, (it, e) => { e.stopPropagation(); openItem(it); }) }, h('span', { class: 'mono' }, refOf(item)), ' ', item.title); // a live item shows its current title
  };
  const kindChip = (k) => h('span', { class: `chip kind k-${String(k).toLowerCase()}` }, k);
  // A chip before the item's link, in one line that cuts the link's title short (…) rather than hiding it.
  const withChip = (chip, link) => h('span', { class: 'wl-item-in' }, chip, link);
  const openRow = (key) => { open = key; api.update(); };
  const closeRow = () => { open = null; api.update(); };
  const rowKeys = (e) => (ev) => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); e(); } };

  let cols = [];
  /** A row's cells, in the columns on show: `cells` has one per column key. */
  const cellsOf = (cells) => cols.map((c) => cells[c]);

  const entryRow = (e) => {
    const key = `entry:${e.date}#${e.index}`;
    if (open === key) {
      return h('tr', { class: 'wl-edit' }, h('td', { colspan: cols.length }, h('div', { class: 'log-edit-head' }, itemLink(e.id, e.title)), logForm(
        { kind: e.kind, time: e.time, date: e.date, note: e.note || '' }, {
          submitLabel: 'Save', fk: 'wl-edit',
          onSubmit: async (v) => { open = null; try { await updateLog(e.date, e.index, { kind: v.kind, time: v.time, note: v.note, new_date: v.date }); } catch { /* toasted */ } },
          onCancel: closeRow,
          onDelete: async () => { open = null; try { await unlogWork(e.date, e.index); } catch { /* toasted */ } },
        })));
    }
    const tentative = isTentative(e);
    return h('tr', {
      class: `wl-row hover-host ${tentative ? 'wl-tentative' : ''}`, tabindex: '0', title: tentative ? 'Proposed, not counted yet: click to adjust' : 'Click to edit',
      'aria-label': `${tentative ? 'Tentative: ' : ''}${e.kind} ${e.time} on ${e.ref || e.id}`, onclick: () => openRow(key), onkeydown: rowKeys(() => openRow(key)),
    }, ...cellsOf({
      date: h('td', { class: 'muted', title: e.date }, relDay(e.date)),
      time: h('td', { class: `wl-time ${e.time === '00:00' ? 'zero' : ''}` }, e.time),
      kind: h('td', {}, kindChip(e.kind)),
      item: h('td', { class: 'wl-item' }, tentative
        ? withChip(h('span', { class: 'chip tentative', title: 'Tentative: proposed from your activity, not counted until you confirm it', 'aria-label': 'Tentative' }, icon('clock', 12)), itemLink(e.id, e.title))
        : itemLink(e.id, e.title)),
      note: h('td', { class: 'wl-note', title: e.note || null }, e.note || ''),
      actions: h('td', { class: 'c-actions' }, tentative
        ? [h('button', { class: 'btn small ghost', title: 'Confirm: it counts from now on', onclick: (ev) => { ev.stopPropagation(); confirmLog(e.date, e.index).catch(() => {}); } }, icon('check', 13), 'Confirm'),
          rowAction('x', `Discard ${e.ref || e.id}`, (ev) => { ev.stopPropagation(); discardLog(e.date, e.index).catch(() => {}); })]
        : columnOn(view.props, 'at') ? h('span', { class: 'muted small', title: 'Logged at' }, e.at || '') : null),
    }));
  };

  const accept = async (s, values) => {
    open = null;
    try { await logWork(s.id, values.kind, values.note, values.date, values.time); } catch { /* toasted */ }
  };
  const dismiss = (s) => { dismissed.add(s.key); saveDismissed(dismissed); open = null; api.update(); };
  const suggestionRow = (s) => {
    const key = `suggestion:${s.key}`;
    if (open === key) {
      return h('tr', { class: 'wl-edit wl-suggest-edit' }, h('td', { colspan: cols.length }, h('div', { class: 'log-edit-head' }, h('span', { class: 'chip suggested' }, icon('sparkles', 12), 'Suggested'), itemLink(s.id, s.title)),
        logForm({ kind: s.kind, time: '00:00', date: s.date, note: s.note }, {
          submitLabel: 'Add', fk: 'wl-suggest', deleteLabel: 'Dismiss', deleteIcon: 'x',
          onSubmit: (v) => accept(s, v), onCancel: closeRow, onDelete: () => dismiss(s),
        })));
    }
    return h('tr', { class: 'wl-row wl-suggest hover-host', tabindex: '0', title: 'Click to adjust before adding', onclick: () => openRow(key), onkeydown: rowKeys(() => openRow(key)) }, ...cellsOf({
      date: h('td', { class: 'muted', title: s.date }, relDay(s.date)),
      time: h('td', { class: 'wl-time zero' }, '00:00'),
      kind: h('td', {}, kindChip(s.kind)),
      item: h('td', { class: 'wl-item' }, withChip(h('span', { class: 'chip suggested', title: 'Suggested from your activity' }, icon('sparkles', 12)), itemLink(s.id, s.title))),
      note: h('td', { class: 'wl-note', title: s.note }, s.note),
      actions: h('td', { class: 'c-actions' },
        h('button', { class: 'btn small ghost', title: 'Add it as it is', onclick: (e) => { e.stopPropagation(); accept(s, { kind: s.kind, time: '00:00', date: s.date, note: s.note }); } }, icon('plus', 13), 'Add'),
        rowAction('x', `Dismiss ${refOf(itemOf(s.id)) || s.id}`, (e) => { e.stopPropagation(); dismiss(s); })),
    }));
  };
  const rowOf = (r) => (r.suggested ? suggestionRow(r) : entryRow(r));

  // A group's head, as a list's: fold it, its name and how many, then its time; a day with tentative entries (the
  // worklog proposal's) confirms or discards them all at once.
  const groupHead = (key, rows) => {
    const folded = view.folded.includes(key);
    const toggle = () => change({ folded: folded ? view.folded.filter((k) => k !== key) : [...view.folded, key] });
    const name = view.groupBy === 'day' ? [h('strong', {}, relDay(key)), h('span', { class: 'muted' }, key)]
      : view.groupBy === 'item' ? [h('strong', {}, itemOf(key) ? `${refOf(itemOf(key))} ${itemOf(key).title}` : `${key} ${rows[0]?.title || ''}`)]
        : view.groupBy === 'kind' ? [kindChip(key)]
          : [h('strong', {}, groupName(view.groupBy, key))];
    const tentative = view.groupBy === 'day' && rows.some((r) => !r.suggested && isTentative(r));
    return h('tr', { class: 'group-head', 'aria-expanded': String(!folded) }, h('td', { colspan: cols.length }, h('div', { class: 'group-line' },
      h('button', { class: 'group-toggle', type: 'button', 'aria-expanded': String(!folded), onclick: toggle },
        icon(folded ? 'right' : 'down', 14), ...name, h('span', { class: 'group-count' }, String(rows.length))),
      tentative ? h('span', { class: 'day-actions' },
        h('button', { class: 'btn small ghost', onclick: () => confirmLog(key).catch(() => {}) }, icon('check', 13), 'Confirm day'),
        h('button', { class: 'btn small ghost', onclick: () => discardLog(key).catch(() => {}) }, icon('x', 13), 'Discard proposals')) : null,
      h('span', { class: 'wl-group-total muted' }, groupSummary(rows)))));
  };

  const api = {
    update() {
      rangeText.textContent = rangeLabel();
      const inRange = (d) => (!from || d >= from) && (!to || d <= to);
      const byText = (id, title) => !itemFilter || `${id} ${refOf(itemOf(id)) || ''} ${title || itemOf(id)?.title || ''}`.toLowerCase().includes(itemFilter);
      const entries = state.worklog.filter((e) => inRange(e.date) && byText(e.id, e.title));
      const suggestions = view.suggestions !== false
        ? suggestLog({ items: state.all, worklog: state.worklog, from, to, today: today(), dismissed })
          .filter((s) => byText(s.id, s.title)).map((s) => ({ ...s, suggested: true })) : [];
      pool = [...entries, ...suggestions];
      const shown = pool.filter((r) => matches(r, view.filters, fields(), ctx()));
      vb.update(); // its chips name the values over the rows just gathered

      // The head's count: the time of what shows and its entries (tentative and suggested ones do not count).
      const logged = shown.filter((r) => !r.suggested && !isTentative(r));
      count.textContent = `${sumTime(logged)} · ${logged.length} entr${logged.length === 1 ? 'y' : 'ies'}`;

      if (!shown.length) {
        table.replaceChildren(pageEmpty(pool.length ? 'Nothing logged matches.'
          : view.suggestions !== false ? 'No work logged in this range, and nothing to suggest.' : 'No work logged in this range.'));
        return;
      }
      // The columns on show: the date only when the groups are not days, the kind when they are not kinds (the group
      // says it).
      cols = ['date', 'time', 'kind', 'item', 'note', 'actions'].filter((c) => (c === 'date' ? view.groupBy !== 'day' && columnOn(view.props, 'date')
        : c === 'kind' ? view.groupBy !== 'kind' && columnOn(view.props, 'kind')
          : c === 'note' ? columnOn(view.props, 'note') : true));
      const fixed = fixedColumns(cols.map((key) => ({ key })));
      const groups = logGroups(shown, view.groupBy, { kinds: state.config.work_kinds });
      const body = view.groupBy
        ? groups.flatMap(([key, rows]) => [groupHead(key, rows), ...(view.folded.includes(key) ? [] : rows.map(rowOf))])
        : groups[0][1].map(rowOf);
      const LABELS = { date: 'Date', time: 'Time', kind: 'Kind', item: 'Item', note: 'Notes' };
      table.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'grid fixed log-grid', style: fixed.style, 'aria-label': 'Work log' }, fixed.colgroup,
        h('thead', {}, h('tr', {}, cols.map((c) => (c === 'actions'
          ? h('th', { scope: 'col', class: 'c-actions' }, h('span', { class: 'sr-only' }, 'Actions'))
          : h('th', { scope: 'col' }, LABELS[c]))))),
        h('tbody', {}, body))));
    },
  };
  return api;
}
