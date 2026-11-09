// List views: a type's list (Initiatives, Tasks, Notes, Meetings…), the List page (every type, #/table) and the Board
// page (one type, #/board), one sortable table each, or a board (boardview.js) of the same rows.
// On top, the view bar (viewbar.js): the search, Filter (a popover of the fields), Order, Group, Display and List |
// Board, and under it the filters on as chips. "Add <type>" top right (form modal) on a type's page and the Board. A row
// opens the item: initiatives their page, the rest the card modal.
import { TYPE_LABEL, openCreateModal } from '../create.js';
import { COL, FILL_COLUMN, LIST_PAGE, columnOf, columnWidth, dataTable, projectName } from '../datatable.js';
import { isOpen, openItem } from '../panel.js';
import { NONE, planLabel } from '../grouping.js';
import { pref, saveSort, savedSort, setPref } from '../prefs.js';
import {
  PLANNABLE, PRIORITIES, TYPE_DEFS, byManualOrder, hasField, isClosedStatus, isDone, movesProject, placement, projectHas, statusesOf,
} from '../rules.js';
import { byType, deleteMany, listOf, moveToList, state, toast, updateItem, updateMany } from '../state.js';
import { bulkPatches } from '../bulk.js';
import { saveView, viewsChanged } from '../savedviews.js';
import { planValues } from '../itemform.js';
import { sectionHead } from '../sections.js';
import { cssKey, h, statusLabel, icon, priorityChip, select, statusChip, typeIcon } from '../ui.js';
import { nextGoalOrder } from '../goals.js';
import { cardProps, cardShows, closedShown, columnOn, columnOrder, emptyKeys, filterFields, fitView, fresh, groupItems, groupOptions as groupsOf, hiddenColumns, matches, migrateView } from '../viewmodel.js';
import { viewBar } from '../viewbar.js';
import { addList, boardOf, editLists, listHead } from '../boardview.js';
import { applyOrder, reorderColumns } from '../colorder.js';
import { idMatches, idTip, refOf, shownId } from '../shownid.js';

// How a type's open and closed items are called (the subtitle: "3 open · 2 closed").
const SCOPE_NAMES = {
  status: { open: 'Open', closed: 'Closed' }, resolution: { open: 'Unresolved', closed: 'Resolved' }, archive: { open: 'Active', closed: 'Archived' },
};

/** How the list of a type shows it: its structure's list config (columns, sort, scopes, grouping, the relation
 *  filter), with its columns as datatable.js columns. */
export function listConfig(type) {
  const t = TYPE_DEFS[type];
  const l = t.list;
  return {
    title: t.plural, noun: l.noun || t.label, sort: l.sort, relation: l.relation, groupKey: l.group_key,
    relationLabel: l.relation_label || 'Related to', relationAny: l.relation_any || 'Related to anything',
    scopes: l.scopes || null, columns: l.columns.map(columnOf), groupOptions: l.group_by || [],
  };
}

/** The types the List page shows: every type of the vault with a list. */
export const listTypes = () => Object.keys(TYPE_DEFS).filter((t) => TYPE_DEFS[t].list);
/** The types the Board page can show: those with a status. */
export const boardTypes = () => listTypes().filter((t) => hasField(t, 'status'));

// A column of the List page, blank on a row whose type does not have that field (a note's status).
const only = (has, c) => ({ ...c, cell: (i) => (has(i) ? c.cell(i) : '') });
const TYPE_COLUMN = {
  key: 'type', label: 'Type', get: (i) => TYPE_DEFS[i.type]?.label || i.type,
  cell: (i) => h('span', { class: 'ref-text' }, typeIcon(i.type, 13), h('span', {}, TYPE_DEFS[i.type]?.label || i.type)),
};
/** The List page's config: every type's items, the columns they share. */
function itemsConfig(types) {
  const any = (f) => types.some((t) => hasField(t, f));
  const has = (f) => (i) => hasField(i.type, f);
  return {
    title: 'Items', noun: 'item', sort: { col: 'updated_at', dir: -1 }, scopes: 'status', groupOptions: [],
    columns: [COL.id, COL.subject, TYPE_COLUMN, only(has('status'), COL.status), only(has('priority'), COL.priority),
      any('project') ? only(has('project'), COL.project) : null, COL.parent('Related to'),
      only((i) => PLANNABLE.has(i.type), COL.plan), only(has('due'), COL.due), any('labels') ? COL.labels : null, COL.updated].filter(Boolean),
  };
}

// A list's view (its filters, grouping, which closed items show, its columns, list or board) is remembered per type and
// vault (prefs.js); the search text is not. A view saved before the view bar is read as the bar's (viewmodel.js
// migrateView). The Board page keeps its own per type, grouped by status with last week's closed ones from the start.
function loadView(type, key, page) {
  const saved = pref(key, null);
  if (saved) return migrateView(saved);
  if (page === 'board') return { ...fresh(), groupBy: 'status', closed: 'week', layout: 'board' };
  if (!type) return fresh();
  // Before prefs.js: "Group by initiative" was an on/off switch of its own.
  let legacy = false;
  const cfg = listConfig(type);
  try { legacy = localStorage.getItem(cfg.groupKey || `tm.group.${type}`) === 'on'; } catch { /* none */ }
  return { ...fresh(), groupBy: legacy && cfg.groupOptions.includes('initiative') ? 'initiative' : null };
}

// A list's columns (quiet rows, design.md §3): one width per column in every list, so going from one list to another
// nothing moves. The subject too: SUBJECT_WIDTH, what is left over going to an empty last column; only where that
// does not fit does it take what there is, down to 120. The ID's is the vault's: wider where its ids are long
// (ACME-INI-001).
const LIST_WIDTHS = { pick: 36, id: 72, type: 112, status: 144, priority: 104, plan: 124, start: 88, due: 88, labels: 140, initiative: 150, goal: 150, project: 120, parent: 150, meetingOf: 150, updated_at: 88, created_at: 88 };
const SUBJECT_WIDTH = 320;
const CORE_WIDTH = 340; // the box, ID, Status and Priority, which never give way
/** The subject's least in a table `width` wide: SUBJECT_WIDTH, less on a narrow one (down to 120) before it scrolls. */
const subjectLeast = (width) => Math.max(120, Math.min(SUBJECT_WIDTH, width - CORE_WIDTH));
/** The ID column's width in this vault: wide when any of its ids is long. */
const idWidth = () => (state.all.some((i) => shownId(i, { full: true }).length > 8) ? 116 : LIST_WIDTHS.id);
const PHONE = '(max-width: 640px)'; // a phone's rows are cards (app.css): no column is left out for width

/** What the view's fields need from the vault (viewmodel.js filterFields). */
export const vaultCtx = () => ({
  byId: state.byId,
  labels: (state.labels || []).map((l) => l.name),
  projects: state.all.filter((i) => i.type === 'project' && i.fields.project_key).map((p) => p.fields.project_key),
  projectName,
});

// A task's board keeps its cards in the order they were dropped (`order`), else as they were created.
const byOrder = byManualOrder((a, b) => String(a.fields.created_at || '').localeCompare(String(b.fields.created_at || '')), 'order');

/**
 * The list view of a type (main.js mounts one per type of the vault's structure, at #/<its route>). `type` null: the
 * List page, every type's items with Type as a filter and no Add. `page: 'board'`: the Board page, `type` as a board.
 */
export function listView(type, { page = null } = {}) {
  const many = !type;
  const asBoard = page === 'board';
  const types = many ? listTypes() : [type];
  const cfg = many ? itemsConfig(types) : listConfig(type);
  const plannable = !many && PLANNABLE.has(type);
  const closable = many || ['status', 'resolution', 'archive'].includes(cfg.scopes); // its items close (resolve, archive)
  const archivable = cfg.scopes === 'archive'; // a prompt is closed by archiving it, and its list shows the archived ones too
  const isClosed = many ? (i) => isDone(i) || i.fields.archived === true : archivable ? (i) => i.fields.archived === true : isDone;
  const scopes = SCOPE_NAMES[cfg.scopes] || SCOPE_NAMES.status;
  const label = many ? 'Item' : TYPE_LABEL[type];
  // "Add task", but "Add PRD" and "3 PRDs": a name in capitals is an acronym and keeps them (as panel.js does)
  const lower = (s) => (/^[A-Z]{2,}s?$/.test(s) ? s : s.toLowerCase());
  const groups = groupsOf(types); // the structure's, and Label
  const fields = () => filterFields(types, vaultCtx());
  const key = asBoard ? `list.board.${type}` : many ? 'list.items' : `list.${type}`;
  const sortKey = asBoard ? `board.${type}` : many ? 'items' : `list.${type}`;
  const view = fitView(loadView(type, key, page), fields(), groups);
  if (asBoard) { view.layout = 'board'; if (!view.groupBy) view.groupBy = groups.includes('status') ? 'status' : groups[0] || null; }
  let text = '';
  let sort = savedSort(sortKey, cfg.sort);
  if (sort.col === 'redmine') sort = { ...sort, col: 'extref' }; // the column's key before it was the structure's tracker
  const save = () => { setPref(key, view); viewsChanged(); }; // the sidebar's Views light the one it now matches
  const noun = (n) => lower(n === 1 ? cfg.noun : cfg.title);
  // Grouped by initiative, a type whose only parent is the initiative (a story) drops its parent column: the
  // group header already says it.
  const parentIsGroup = !many && TYPE_DEFS[type].parents.join() === 'initiative';
  /** The one value a filter picks ("Project is Acme Web"), for what a new item starts with; none when it picks several. */
  const onlyValue = (k) => { const f = view.filters.find((x) => x.field === k && x.op === 'is'); return f?.values.length === 1 && f.values[0] ? f.values[0] : null; };
  const all = () => (many ? state.all.filter((i) => types.includes(i.type))
    : archivable ? state.all.filter((i) => i.type === type) : byType(type)); // prompts: archived ones too
  /** A project key that can hold this type (its kind, its Types), else none: the form asks for one. */
  const holding = (k) => (k && projectHas(state.all.find((i) => i.type === 'project' && i.fields.project_key === k), type) ? k : null);
  /** What a new item starts with: what the list is narrowed to (its project, what it hangs from), and `group`, the
   *  value of the group its "+" was clicked in. */
  const startWith = (group = {}) => {
    const project = holding(group.project ?? onlyValue('project'));
    const related = group.related_to ?? (onlyValue('parent') || onlyValue('initiative'));
    return { ...group, project: project || undefined, ...(related ? { related_to: related } : {}) };
  };
  /** The values of the group `k` (grouped by `by`) a new item takes. */
  const groupValues = (by, k) => {
    if (k === NONE) return {};
    if (by === 'status' || by === 'priority' || by === 'project') return { [by]: k };
    if (by === 'initiative') return { related_to: k };
    if (by === 'goal') return { goal: k };
    if (by === 'plan') return ['today', 'week', 'nextweek', 'month'].includes(k) ? { plan: k } : {};
    if (by === 'label') return { labels: [k] };
    return {};
  };
  /** The same, for a board's "+ Add a card" (quickadd.js): Planned as its fields. */
  const quickValues = (by, k) => {
    const { plan, project, ...rest } = startWith(groupValues(by, k));
    return { ...rest, ...(project ? { project } : {}), ...(plan ? planValues(plan) : {}) };
  };

  return {
    mount(root) {
      // What is saved, read again: a saved view opened from the sidebar (savedviews.js) wrote it since the last visit.
      const now = fitView(loadView(type, key, page), fields(), groups);
      if (asBoard) { now.layout = 'board'; if (!now.groupBy) now.groupBy = groups.includes('status') ? 'status' : groups[0] || null; }
      for (const k of Object.keys(view)) delete view[k];
      Object.assign(view, now);
      sort = savedSort(sortKey, cfg.sort);
      if (sort.col === 'redmine') sort = { ...sort, col: 'extref' };
      const tableBox = h('div', { class: 'list-main' });
      const hiddenLine = h('p', { class: 'vb-hidden muted', hidden: true });
      const count = h('span', { class: 'view-count' });
      // Rows ticked for a bulk action (the first column): their keys, kept while they are still in the list.
      const picked = new Set();
      const bulkBar = h('div', { class: 'bulk-bar', role: 'toolbar', 'aria-label': 'Selected rows', hidden: true });
      const board = () => view.layout === 'board' && groups.length > 0;
      // Grouped by status, a task's board is board.md's lists, which keep their order there; any other board's columns
      // keep the order they are dragged to with the view (view.colOrder, per grouping).
      const boardBy = () => view.groupBy || groups[0];
      const boardLists = () => boardBy() === 'status' && type === 'task' && state.board?.lists?.length > 0;
      // A board's cards have an order of their own (Order on a board): Manual, the default, is where they were dropped
      // (`order`, one per item whatever the board groups by), else one of the list's columns.
      const boardSort = () => view.boardSort || { col: 'manual', dir: 1 };
      const manual = () => boardSort().col === 'manual';
      // Columns left out so the table never scrolls sideways (viewmodel.js hiddenColumns): redrawn when the width
      // changes which.
      let narrowed = '';
      const narrow = (cols) => {
        const width = tableBox.clientWidth;
        if (!width || matchMedia(PHONE).matches || board()) return [];
        return hiddenColumns(cols.map((c) => ({ key: c.key, width: /^subject/.test(c.key) ? 0 : columnWidth(c, { subject: null }, widthsNow) })), width, { subjectMin: subjectLeast(width) });
      };
      let widthsNow = LIST_WIDTHS;
      let lastCols = [];
      const resized = new ResizeObserver(() => {
        if (!tableBox.isConnected) { resized.disconnect(); return; }
        if (narrow(lastCols).join() !== narrowed) api.update();
      });
      resized.observe(tableBox);
      // Esc lets go of the ticked rows, unless a menu or a card is open (theirs first).
      const onEsc = (e) => {
        if (!bulkBar.isConnected) { document.removeEventListener('keydown', onEsc); return; }
        if (e.key !== 'Escape' || !picked.size || isOpen() || document.querySelector('.menu') || !document.getElementById('modal-backdrop')?.hidden) return;
        picked.clear(); api.update();
      };
      document.addEventListener('keydown', onEsc);
      const add = many || asBoard ? null : h('button', { // the Board page adds from its columns, not from its head
        class: 'btn primary',
        onclick: () => openCreateModal(type, startWith()),
      }, icon('plus', 16), `Add ${lower(label)}`);
      const columns = cfg.columns.filter((c) => c.key !== 'id' && !/^subject/.test(c.key) && c.label);
      // List | Board: a type's page switches in place; the List page goes to the Board (the type it is filtered to);
      // the Board page goes to the List, filtered to its type.
      const layout = groups.length ? {
        current: () => (board() ? 'board' : 'list'),
        pick: (l) => {
          if (many && l === 'board') {
            const t = onlyValue('type');
            if (t && boardTypes().includes(t)) setPref('list.board', t);
            location.hash = '#/board';
          } else if (asBoard && l === 'list') {
            const items = migrateView(pref('list.items', null));
            setPref('list.items', { ...items, layout: 'list', filters: [...items.filters.filter((f) => f.field !== 'type'), { field: 'type', op: 'is', values: [type] }] });
            location.hash = '#/table';
          } else change({ layout: l, ...(l === 'board' && !view.groupBy ? { groupBy: groups.includes('status') ? 'status' : groups[0] } : {}) });
        },
      } : null;
      const vb = viewBar({
        view, save, fields, ctx: vaultCtx, items: all, groups, closable, layout,
        placeholder: 'Filter by subject or ID…',
        onText: (t) => { text = t; api.update(); },
        onChange: () => api.update(),
        // On a board, Order is its cards' (Manual first, the default); on a list, the rows'.
        orders: cfg.columns.filter((c) => c.label && typeof c.label === 'string').map((c) => [c.key, c.label]),
        boardOrders: [['manual', 'Manual']],
        order: () => (board() ? boardSort().col : sort.col),
        onOrder: (k) => {
          if (board()) { change({ boardSort: k ? { col: k, dir: boardSort().col === k ? boardSort().dir : 1 } : null }); return; }
          sort = k ? { col: k, dir: sort.col === k ? sort.dir : 1 } : cfg.sort; saveSort(sortKey, sort); api.update();
        },
        dir: () => (board() ? boardSort().dir : sort.dir),
        onDir: (d) => {
          if (board()) { change({ boardSort: { ...boardSort(), dir: d } }); return; }
          sort = { ...sort, dir: d }; saveSort(sortKey, sort); api.update();
        },
        props: columns.map((c) => [c.key, c.label]),
        cardProps: cardProps(types),
        columnOrder: {
          on: () => board() && !boardLists(),
          custom: () => (view.colOrder?.[boardBy()] || []).length > 0,
          reset: () => { const { [boardBy()]: _, ...rest } = view.colOrder || {}; change({ colOrder: rest }); },
        },
        // Kept with what draws it: the view, the rows' order, and on the Board which type it shows.
        saveAs: (name) => {
          save(); saveSort(sortKey, sort);
          saveView({ name, route: location.hash.split('?')[0], prefs: { [key]: view, [`sort.${sortKey}`]: sort, ...(asBoard ? { 'list.board': type } : {}) } });
          toast(`Saved “${name}” in Views`);
        },
      });
      // A type in a section (Brief, Issues…) is one of its tabs: the section's name above, its tabs under it. The Board
      // says which type it shows, one at a time: "Board  Tasks ▾".
      const head = many || asBoard ? { title: many ? 'List' : 'Board', tabs: null } : sectionHead(TYPE_DEFS[type].route, cfg.title);
      const typePick = asBoard && boardTypes().length > 1 ? select(boardTypes().map((t) => [t, TYPE_DEFS[t].plural]), type,
        (t) => { setPref('list.board', t); page === 'board' && root.dispatchEvent(new CustomEvent('board-type', { detail: t })); },
        { class: 'ghost board-type', 'aria-label': 'The type the board shows', search: false }) : null;
      root.replaceChildren(
        h('header', { class: 'view-head row' },
          h('div', { class: 'view-title' }, h('h1', {}, head.title), typePick || (head.tabs ? null : count)), // the count on the title's baseline
          h('span', { class: 'spacer' }),
          add),
        ...(head.tabs ? [head.tabs] : []), // none outside a section: replaceChildren would write "null"
        vb.bar, vb.chips,
        tableBox, hiddenLine,
        bulkBar); // floats at the bottom (app.css)

      /** One action on every ticked row, as one change with one Undo (bulk.js). */
      let bulkBusy = false;
      const runBulk = async (action, value, say) => {
        if (bulkBusy) return;
        bulkBusy = true;
        try { await bulkRun(action, value, say); } finally { bulkBusy = false; }
      };
      const manyOf = (n) => `${n} ${n === 1 ? lower(label) : lower(cfg.title)}`;
      /** say(n) → the toast: "Set Done on 3 tasks", "Added #ux to 2 tasks". */
      const bulkRun = async (action, value, say) => {
        const items = [...picked].map((k) => state.all.find((i) => i.key === k)).filter(Boolean);
        if (action === 'trash') {
          await deleteMany(items.map((i) => i.key)).catch(() => {});
          picked.clear(); api.update();
          return;
        }
        const { doing, undoing } = bulkPatches(items, action, value, { planValues, projectOf: (id) => state.byId.get(id)?.fields.project || null });
        if (!doing.length) { toast('Nothing to change'); return; }
        try { await updateMany(doing); } catch { return; }
        toast(say(manyOf(doing.length)), false, { label: 'Undo', run: () => updateMany(undoing) });
      };
      /** The dark bar floating at the bottom while rows are ticked: how many, then what can be done to all of them
       *  at once (bulk.js, each with its Undo), and × (or Esc) to let them go. On the List page, Status only while the
       *  ticked rows are of one type (each type has its statuses), and the rest only where they all have the field. */
      const NO_PROJECT = '__none__'; // the menu's "No project" (a select's null is its face, not a choice)
      const paintBulk = () => {
        bulkBar.hidden = !picked.size;
        tableBox.classList.toggle('picking', picked.size > 0);
        if (!picked.size) { bulkBar.replaceChildren(); return; }
        const pickedTypes = [...new Set([...picked].map((k) => state.all.find((i) => i.key === k)?.type).filter(Boolean))];
        const allHave = (f) => pickedTypes.length > 0 && pickedTypes.every((t) => hasField(t, f));
        const statuses = pickedTypes.length === 1 && hasField(pickedTypes[0], 'status') ? statusesOf(pickedTypes[0]) : [];
        const labels = allHave('labels') ? (state.labels || []).map((l) => [l.name, `#${l.name}`]) : [];
        // Project: only where every ticked type may change it (a ticket lives in its project's folder: rules.js movesProject).
        const projects = pickedTypes.length && pickedTypes.every(movesProject)
          ? state.items.filter((i) => i.type === 'project' && i.fields.project_key).map((p) => [p.fields.project_key, p.title]) : [];
        // Each a button of its name alone (no width of its longest option), the choices in its menu.
        const pick = ([[, name], ...options], onPick, aria) => select(options, null, (v) => v && onPick(v), { class: 'small', 'aria-label': aria, search: options.length > 10, face: [null, name] });
        bulkBar.replaceChildren(...[ // filtered: replaceChildren writes a null as the text "null"
          h('span', { class: 'bulk-count' }, `${picked.size} selected`),
          statuses.length ? pick([[null, 'Status'], ...statuses.map((st) => [st, statusLabel(st)])], (v) => runBulk('status', v, (n) => `Set ${statusLabel(v)} on ${n}`), 'Set the status of the selected rows') : null,
          allHave('priority') ? pick([[null, 'Priority'], ...PRIORITIES.map((p) => [p, p])], (v) => runBulk('priority', v, (n) => `Set ${v} on ${n}`), 'Set the priority of the selected rows') : null,
          (many ? pickedTypes.length && pickedTypes.every((t) => PLANNABLE.has(t)) : plannable) ? pick([[null, 'Plan'], ['today', 'Today'], ['week', 'This week'], ['nextweek', 'Next week'], ['month', 'This month'], ['none', 'Not planned']],
            (v) => runBulk('plan', v === 'none' ? null : v, (n) => (v === 'none' ? `Unplanned ${n}` : `Planned ${n}`)), 'Plan the selected rows') : null,
          labels.length ? pick([[null, 'Labels'], ...labels], (v) => runBulk('label', v, (n) => `Added #${v} to ${n}`), 'Add a label to the selected rows') : null,
          projects.length ? pick([[null, 'Project'], ...projects, [NO_PROJECT, 'No project']], (v) => runBulk('project', v === NO_PROJECT ? null : v,
            (n) => (v === NO_PROJECT ? `Took ${n} out of their project` : `Moved ${n} to ${projectName(v)}`)), 'Move the selected rows to a project') : null,
          h('button', { type: 'button', class: 'btn icon small bulk-trash', title: 'Move to trash', 'aria-label': 'Move the selected rows to the trash', onclick: () => runBulk('trash') }, icon('trash', 14)),
          h('button', { type: 'button', class: 'btn icon small bulk-close', title: 'Let go of the selected rows (Esc)', 'aria-label': 'Clear the selection',
            onclick: () => { picked.clear(); api.update(); } }, icon('x', 14)),
        ].filter(Boolean));
      };

      const change = (patch) => { Object.assign(view, patch); save(); api.update(); };

      /** A group's name ("No initiative", a project's name, a status's label). */
      const groupName = (by, k) => (by === 'status' ? statusLabel(k) : by === 'priority' ? k
        : by === 'initiative' ? (k === NONE ? 'No initiative' : state.byId.get(k)?.title || k)
          : by === 'goal' ? (k === NONE ? 'No goal' : state.byId.get(k)?.title || k)
          : by === 'project' ? (k === NONE ? 'No project' : projectName(k))
            : by === 'label' ? (k === NONE ? 'No labels' : k) : planLabel(k));
      /** A group's face (design.md §3): its dot or icon and its name. */
      const groupFace = (by, k) => {
        const named = (ico, tip = null) => [ico, h('span', { class: `group-name ${k === NONE ? 'muted' : ''}`, title: tip }, groupName(by, k))];
        return by === 'status' ? [statusChip(k)]
          : by === 'priority' ? [priorityChip(k)]
            : by === 'initiative' ? named(typeIcon('initiative', 14), k === NONE ? null : refOf(state.byId.get(k)))
            : by === 'goal' ? named(typeIcon('goal', 14), k === NONE ? null : refOf(state.byId.get(k)))
              : by === 'project' ? named(typeIcon('project', 14), k === NONE ? null : k)
                : by === 'label' ? named(icon('tag', 14))
                  : named(icon('calendar', 14));
      };
      /** A group's header in the list: its face and how many rows. */
      const groupHeader = (k, members) => h('span', { class: 'group-title' }, ...groupFace(view.groupBy, k), h('span', { class: 'group-count' }, String(members.length)));
      /** The "+" beside a group's header: a new item with that group's value. */
      const groupAdd = (k) => (many ? null : h('button', {
        type: 'button', class: 'btn icon small group-add', title: `Add ${lower(label)} here`, 'aria-label': `Add ${lower(label)} to this group`,
        onclick: (e) => { e.stopPropagation(); openCreateModal(type, startWith(groupValues(view.groupBy, k))); },
      }, icon('plus', 14)));
      /** Ordered by `by` ({ col, dir }), the closed ones last. */
      const orderBy = (by) => {
        const get = (cfg.columns.find((c) => c.key === by.col) || cfg.columns[0]).get;
        return (a, b) => Number(isClosed(a)) - Number(isClosed(b)) || ((x, y) => (x < y ? -1 : x > y ? 1 : 0))(get(a), get(b)) * by.dir;
      };
      /** The order inside a list's group: Order in groups, else the list's. */
      const innerSort = () => orderBy(view.orderInGroups ? { col: view.orderInGroups, dir: 1 } : sort);

      // ── the board ──
      const cardSort = () => (manual() ? byOrder : orderBy(boardSort()));
      /**
       * A card dropped at `index` among `cards` (a column as shown). `field`/`values`: what the column sets (its status,
       * priority, project or initiative; none for Planned and Label, whose cards change those in the card), `move`: how
       * (a board.md list's). Manual: it also lands where it was dropped (rules.js placement, only the cards that must
       * move are written). Another order places it: a drop in its own column changes nothing and says so.
       */
      const dropCard = async (key, index, cards, { field = null, values = null, move = null } = {}) => {
        const item = state.all.find((i) => i.key === key);
        if (!item) return;
        const here = cards.some((c) => c.key === key);
        if (!field && !here) { toast(`A card changes its ${view.groupBy === 'label' ? 'labels' : 'plan'} in the card, not by dragging`); return; }
        const changes = field && (item.fields[field] ?? null) !== (values[field] ?? null);
        if (!manual()) {
          if (here) { toast('Pick Order → Manual to place cards by hand'); return; }
          try { if (changes) await (move ? move(item) : updateItem(item.key, values)); } catch { /* already toasted */ }
          return;
        }
        const patches = placement(item, cards.filter((c) => c.key !== key), index);
        const others = patches.filter(([c, o]) => c.key !== key && c.fields.order !== o);
        const order = patches.find(([c]) => c.key === key)[1];
        try {
          if (others.length) await updateMany(others.map(([c, o]) => [c.key, { order: o }]));
          if (move) await move(item, order);
          else await updateItem(item.key, { ...(changes ? values : {}), order });
        } catch { /* already toasted */ }
      };
      /** What a card dropped on column `k` (grouped by `by`) sets: its status, priority, project or initiative. */
      const columnSets = (by, k) => {
        const value = k === NONE ? null : k;
        if (by === 'status') return k === NONE ? null : { field: 'status', values: type === 'task' ? { status: value, list: null } : { status: value } };
        if (by === 'priority') return k === NONE ? null : { field: 'priority', values: { priority: value } };
        if (by === 'project') return { field: 'project', values: { project: value } };
        if (by === 'initiative') return { field: 'related_to', values: { related_to: value } };
        if (by === 'goal') return { field: 'goal', values: { goal: value, goal_order: value ? nextGoalOrder(state.items, value) : null } }; // at its goal's end
        return {}; // Planned, Label: reordered in place only
      };
      const dropFor = (by, k, cards) => {
        const sets = columnSets(by, k);
        if (!sets) return null;
        return async (key, index) => {
          if (by === 'project' && k !== NONE && !holding(k)) { toast(`${projectName(k)} does not hold ${lower(cfg.title)}`, true); return; }
          await dropCard(key, index, cards, sets);
        };
      };
      /** The board of these rows: a column per group of what the view groups by (a task's by status: its board.md
       *  lists). A closed column, and an empty one (Display → Empty columns: fold), starts folded; the user's fold or
       *  unfold of a column is kept with the view. The columns go in the group's order (grouping.js) until one is
       *  dragged: then in the user's, kept with the view per grouping (view.colOrder[by], colorder.js) — Order sorts
       *  only the cards inside each column, never the columns. */
      const paintBoard = (rows, items, fs, ctx) => {
        const by = boardBy();
        const fold = view.boardFold || {};
        const empties = view.emptyCols || 'fold';
        const onFold = (k, f) => change({ boardFold: { ...fold, [k]: f } });
        const folded = (k, closed, empty) => fold[k] ?? (closed || (empty && empties === 'fold'));
        const cols = [];
        let after = null;
        let onReorder = null;
        if (boardLists()) {
          const placed = new Map(state.board.lists.map((l) => [l.id, []]));
          const orphans = [];
          for (const t of rows) { const l = listOf(t); (l ? placed.get(l.id) : orphans).push(t); }
          if (orphans.length) {
            cols.push({ key: NONE, label: 'No list', items: orphans.sort(cardSort()), folded: fold[NONE] ?? false, cls: 'no-list',
              face: [h('span', { class: 'group-name muted', title: 'No list maps to their status — add one for it' }, 'No list')] });
          }
          const shownLists = []; // the lists drawn, in board.md's order: a drag moves the column among them
          state.board.lists.forEach((l, idx) => {
            const its = placed.get(l.id).sort(cardSort());
            const closed = isClosedStatus(l.status);
            if (!its.length && empties === 'hide' && fold[l.id] === undefined) return;
            const total = byType('task').filter((t) => listOf(t)?.id === l.id).length;
            const open = closed ? its.length : its.filter((t) => !isDone(t)).length;
            const name = l.name === l.status ? statusLabel(l.name) : l.name;
            cols.push({
              key: l.id, label: name, items: its, cls: `s-${cssKey(l.status)}`, attrs: { 'data-list': l.id }, movable: true,
              face: [h('span', { class: 'status-dot' }), h('span', { class: 'group-name' }, name)],
              head: listHead(l, idx, open, total, shownLists.push(l.id) - 1),
              // a list sets its status: dropped in another list, the task takes that list (and so its status)
              drop: (k, index) => dropCard(k, index, its, { field: 'list', values: { list: l.id }, move: (item, order) => moveToList(item, l, order) }),
              quick: { type: 'task', values: { list: l.id, ...quickValues(null, NONE) } }, folded: folded(l.id, closed, !its.length),
            });
          });
          after = addList();
          // board.md keeps the order: the lists drawn as moved, a hidden one (Empty columns: Hide) after the one it followed.
          onReorder = (from, to) => {
            const ids = reorderColumns(state.board.lists.map((l) => l.id), shownLists, from, to);
            editLists((ls) => ls.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)));
          };
        } else {
          const keys = empties === 'hide' ? [] : emptyKeys(by, fs, ctx, items);
          const grouped = groupItems(rows, by, { byId: state.byId, projectName, sort: cardSort(), showEmpty: empties !== 'hide', keys });
          const saved = view.colOrder?.[by];
          const byKey = new Map(grouped.map((g) => [g.key, g]));
          const shown = applyOrder(grouped.map((g) => g.key), saved);
          for (const g of shown.map((k) => byKey.get(k))) {
            const closed = by === 'status' && isClosedStatus(g.key);
            cols.push({
              key: g.key, label: groupName(by, g.key), face: groupFace(by, g.key), items: g.items, movable: true,
              cls: by === 'status' ? `s-${cssKey(g.key)}` : '', drop: dropFor(by, g.key, g.items),
              quick: many ? null : { type, values: quickValues(by, g.key) }, folded: folded(g.key, closed, !g.items.length),
            });
          }
          onReorder = (from, to) => change({ colOrder: { ...(view.colOrder || {}), [by]: reorderColumns(saved, shown, from, to) } });
        }
        tableBox.replaceChildren(boardOf({ columns: cols, onFold, onOpen: openItem, projectName, after, onReorder, shows: (k) => (k === 'status' && view.groupBy === 'status' ? false : cardShows(view, k)) })); // its column says its status
      };

      const api = {
        update() {
          const items = all();
          const open = items.filter((i) => !isClosed(i)).length;
          count.textContent = closable ? `${open} ${scopes.open.toLowerCase()} · ${items.length - open} ${scopes.closed.toLowerCase()}`
            : `${items.length} ${noun(items.length)}`;
          vb.update();
          const fs = fields();
          const ctx = vaultCtx();
          const filtered = items.filter((i) => matches(i, view.filters, fs, ctx));
          // Display → Show closed; a closed status the Status filter picks shows whatever that says.
          const asked = new Set(view.filters.filter((f) => f.field === 'status' && f.op === 'is').flatMap((f) => f.values));
          const { items: shownRows, hidden } = closable
            ? closedShown(filtered, view.closed, { isClosed: (i) => isClosed(i) && !asked.has(i.fields.status) }) : { items: filtered, hidden: 0 };
          const q = text.toLowerCase();
          const rows = shownRows.filter((i) => !q || idMatches(i, q) || `${i.title}`.toLowerCase().includes(q));
          hiddenLine.hidden = !hidden;
          hiddenLine.replaceChildren(...(hidden ? [`${hidden} ${scopes.closed.toLowerCase()} ${hidden === 1 ? 'is' : 'are'} hidden · `,
            h('button', { type: 'button', class: 'link-btn', onclick: () => change({ closed: 'all' }) }, `Show ${scopes.closed.toLowerCase()}`)] : []));
          tableBox.classList.toggle('as-board', board());
          root.classList.toggle('board-layout', board());
          if (board()) { picked.clear(); paintBulk(); paintBoard(rows, items, fs, ctx); return; }
          // Grouped: the groups made here (an item in each of its labels'; the empty ones when asked), each in Order in
          // groups (else the list's order), the closed rows last. Folded groups are kept with the view.
          let group = null;
          if (view.groupBy) {
            const folded = new Set(view.folded || []);
            group = {
              list: groupItems(rows, view.groupBy, {
                byId: state.byId, projectName, sort: innerSort(),
                showEmpty: !!view.showEmpty, keys: view.showEmpty ? emptyKeys(view.groupBy, fs, ctx, items) : [],
              }).map((g) => [g.key, g.items]),
              collapsed: folded,
              onToggle: (k) => { if (!folded.delete(k)) folded.add(k); change({ folded: [...folded] }); },
              header: groupHeader,
              action: groupAdd,
            };
          }
          // The column the group header already says goes: a story's parent (its initiative; the rest may hang from a
          // story or task), Ticketing's Initiative column, or its Project column.
          const said = view.groupBy === 'initiative' ? (parentIsGroup ? 'parent' : 'initiative')
            : view.groupBy === 'project' ? 'project' : view.groupBy === 'goal' ? 'goal' : null;
          // Ticked rows that a filter or a change took out of the list are no longer ticked.
          const keys = new Set(rows.map((i) => i.key));
          for (const k of [...picked]) if (!keys.has(k)) picked.delete(k);
          paintBulk();
          const tick = (keysToSet, on) => { keysToSet.forEach((k) => (on ? picked.add(k) : picked.delete(k))); api.update(); };
          const allBox = h('input', { type: 'checkbox', 'aria-label': 'Select every row', checked: rows.length > 0 && picked.size === rows.length,
            onclick: (e) => e.stopPropagation(), onchange: (e) => tick(rows.map((i) => i.key), e.target.checked) });
          allBox.indeterminate = picked.size > 0 && picked.size < rows.length;
          const pickCol = { key: 'pick', label: allBox, get: (i) => (picked.has(i.key) ? 0 : 1),
            cell: (i) => h('input', { type: 'checkbox', class: 'row-pick', checked: picked.has(i.key), 'aria-label': `Select ${refOf(i) || i.title}`,
              onclick: (e) => e.stopPropagation(), onchange: (e) => tick([i.key], e.target.checked) }) };
          const wanted = cfg.columns.filter((c) => c.key !== said && columnOn(view.props, c.key));
          // Nothing else says a row's project (no Project column, not grouped by it): its whole id (ACME-INI-001).
          const full = !wanted.some((c) => c.key === 'project') && view.groupBy !== 'project';
          widthsNow = { ...LIST_WIDTHS, id: idWidth() };
          const quiet = (c) => {
            if (c.key === 'id') return { ...c, cell: (i) => h('span', { class: 'mono', title: idTip(i) }, shownId(i, { full })) };
            // Planned is edited in place (COL.plan); a phone's two-line row reads it as text, else its Due (app.css).
            if (c.key === 'plan' && matchMedia(PHONE).matches) return only((i) => PLANNABLE.has(i.type), COL.planned);
            return c;
          };
          const ordered = columnOrder([pickCol, ...wanted.map(quiet)]);
          lastCols = ordered;
          const left = narrow(ordered);
          narrowed = left.join();
          const visible = ordered.filter((c) => !left.includes(c.key));
          // The subject at its width, an empty column taking the rest; too narrow for that, the subject takes the rest.
          const width = tableBox.clientWidth;
          const others = visible.filter((c) => c.key !== 'subject').reduce((n, c) => n + columnWidth(c, { subject: null }, widthsNow), 0);
          const roomy = width > 0 && !matchMedia(PHONE).matches && width - others >= SUBJECT_WIDTH;
          tableBox.replaceChildren(dataTable({
            columns: roomy ? [...visible, FILL_COLUMN] : visible,
            flex: roomy ? { subject: null } : { subject: subjectLeast(width || 1200) },
            widths: roomy ? { ...widthsNow, subject: SUBJECT_WIDTH } : widthsNow,
            rowClass: (i) => `${isClosed(i) ? 'done' : ''} ${picked.has(i.key) ? 'picked' : ''}`,
            rows, sort, label: cfg.title, group, paging: { key, size: LIST_PAGE }, doneLast: true,
            onSort: (st) => { sort = st; saveSort(sortKey, st); api.update(); },
            onRow: openItem,
            empty: items.length ? `No ${lower(cfg.title)} match.` : many ? 'No items yet.' : `No ${lower(cfg.title)} yet — “Add ${lower(label)}” to create one.`,
          }));
        },
      };
      return api;
    },
  };
}
