// List views — Initiatives, User stories, Tasks, Notes, Meetings, Activity: one sortable table per type.
// On top, Open / Closed / All and the search; the other filters and the grouping live in a panel on the
// right (the filter button). "Add <type>" top right (form modal). A row opens the item: initiatives
// their page, the rest the card modal.
import { TYPE_LABEL, openCreateModal } from '../create.js';
import { addDays, isoWeek, thisWeek, today } from '../dates.js';
import { LIST_PAGE, columnOf, dataTable, projectName } from '../datatable.js';
import { openItem } from '../panel.js';
import { GROUPS, NONE, ancestorsOf, planLabel, projectOf } from '../grouping.js';
import { pref, saveSort, savedSort, setPref } from '../prefs.js';
import {
  ACTIVITY_SOURCES, PLANNABLE, PLAN_FILTERS, PRIORITIES, TYPE_DEFS, hasField, inProject, isDone, planFilter,
} from '../rules.js';
import { byType, state } from '../state.js';
import {
  checkSelect, h, hasLabel, statusTreeSelect, icon, labelSelect, parentOptions, planSelect, priorityChip, select, statusChip, typeIcon,
} from '../ui.js';

const SCOPES = { open: 'Open', closed: 'Closed', all: 'All' };
const ACTIVITY_SCOPES = { open: 'Unresolved', closed: 'Resolved', all: 'All' };
const PROMPT_SCOPES = { open: 'Active', closed: 'Archived', all: 'All' };
// Meetings have no open / closed: the scope is when they are (their date).
const DATE_SCOPES = { today: 'Today', tomorrow: 'Tomorrow', week: 'Week', all: 'All' };
/** On or between the two days (either may be empty; given the wrong way round, they are swapped). */
const inRange = (d, from, to) => {
  if (!from && !to) return true;
  if (!d) return false;
  const [lo, hi] = from && to && from > to ? [to, from] : [from, to];
  return (!lo || d >= lo) && (!hi || d <= hi);
};
const inDateScope = (scope, d) => scope === 'all' || (!!d && (scope === 'today' ? d === today()
  : scope === 'tomorrow' ? d === addDays(today(), 1) : isoWeek(d) === thisWeek()));

const SCOPE_NAMES = { status: SCOPES, resolution: ACTIVITY_SCOPES, archive: PROMPT_SCOPES, date: DATE_SCOPES };

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

// A list's scope, grouping and filters are remembered per type (prefs.js); the search text is not.
const DEFAULT_VIEW = {
  scope: 'open', groupBy: null, status: [], priority: [], related: null, project: null, initiative: null, plan: 'any', label: null, from: null, to: null,
  source: null, // an activity's source (Email, Slack…): its own select beside the scope
};
function loadView(type) {
  const saved = pref(`list.${type}`, null);
  if (saved) return { ...DEFAULT_VIEW, ...saved };
  // Before prefs.js: "Group by initiative" was an on/off switch of its own.
  let legacy = false;
  const cfg = listConfig(type);
  try { legacy = localStorage.getItem(cfg.groupKey || `tm.group.${type}`) === 'on'; } catch { /* none */ }
  return { ...DEFAULT_VIEW, groupBy: legacy && cfg.groupOptions.includes('initiative') ? 'initiative' : null };
}

/** How many filters narrow the list (the badge on the filter button); the scope and the search are on show. */
const activeFilters = (v) => (v.status.length ? 1 : 0) + (v.priority.length ? 1 : 0) + (v.related ? 1 : 0)
  + (v.project ? 1 : 0) + (v.initiative ? 1 : 0) + (v.plan !== 'any' ? 1 : 0) + (v.label ? 1 : 0) + (v.from || v.to ? 1 : 0)
  + (v.source ? 1 : 0);
const CLEARED = {
  status: [], priority: [], related: null, project: null, initiative: null, plan: 'any', label: null, from: null, to: null, source: null,
};

/** The list view of a type (main.js mounts one per type of the vault's structure, at #/<its route>). */
export function listView(type) {
  const cfg = listConfig(type);
  const view = loadView(type);
  let text = '';
  const folded = new Set(); // groups folded away, for this visit
  let sort = savedSort(`list.${type}`, cfg.sort);
  if (sort.col === 'redmine') sort = { ...sort, col: 'extref' }; // the column's key before it was the structure's tracker
  const plannable = PLANNABLE.has(type);
  const hasStatuses = !!TYPE_DEFS[type]?.statuses?.length; // an agent's or an error's too: its own Group → Status filter
  const closable = ['status', 'resolution', 'archive'].includes(cfg.scopes); // open / closed (resolved, archived) scope
  const archivable = cfg.scopes === 'archive'; // a prompt is closed by archiving it, and its list shows the archived ones too
  const isClosed = archivable ? (i) => i.fields.archived === true : isDone;
  const dated = cfg.scopes === 'date'; // meetings: scoped by date, and a from–to range in the panel
  const scopes = SCOPE_NAMES[cfg.scopes] || SCOPES;
  if (!(view.scope in scopes)) view.scope = dated ? 'all' : 'open';
  const label = TYPE_LABEL[type];
  const { groupOptions } = cfg;
  if (view.groupBy && !groupOptions.includes(view.groupBy)) view.groupBy = null;
  const save = () => setPref(`list.${type}`, view);
  const noun = (n) => (n === 1 ? cfg.noun : cfg.title).toLowerCase();
  // Grouped by initiative, a type whose only parent is the initiative (a story) drops its parent column: the
  // group header already says it.
  const parentIsGroup = TYPE_DEFS[type].parents.join() === 'initiative';
  // Ticketing filters by project, and by initiative where the list groups by it (its items can reach one). The folder-per-type structure has
  // no projects, and its own relation filter already picks an initiative.
  const byProject = hasField(type, 'project');
  const byInitiative = byProject && groupOptions.includes('initiative');
  if (!byProject) view.project = null;
  if (!byInitiative) view.initiative = null;
  const bySource = hasField(type, 'source'); // an activity: filtered by where it came from
  if (!bySource || !ACTIVITY_SOURCES.includes(view.source)) view.source = null;

  return {
    mount(root) {
      const scopeBar = h('div', { class: 'seg', role: 'group', 'aria-label': 'Show' });
      const sourceSel = bySource ? select([[null, 'All sources'], ...ACTIVITY_SOURCES.map((s) => [s, s])], view.source,
        (v) => change({ source: v }), { class: 'small', 'aria-label': 'Source', title: 'Source' }) : null;
      const tableBox = h('div', { class: 'list-main' });
      const side = h('aside', { class: 'filter-side', 'aria-label': 'Filters and grouping' });
      const body = h('div', { class: 'list-body' }, tableBox, side);
      const subtitle = h('p', { class: 'muted' });
      const badge = h('span', { class: 'filter-count' });
      const filterBtn = h('button', { class: 'btn icon toggle filter-toggle', title: 'Filters and grouping', 'aria-label': 'Filters and grouping' }, icon('filter', 16), badge);
      const paintPanel = (open) => {
        body.classList.toggle('collapsed', !open);
        filterBtn.classList.toggle('on', open);
        filterBtn.setAttribute('aria-pressed', String(open));
      };
      paintPanel(false); // closed on every visit: the badge on the button says when filters are on
      filterBtn.addEventListener('click', () => paintPanel(body.classList.contains('collapsed')));
      const search = h('input', { type: 'search', placeholder: 'Filter by subject or ID…', value: text, 'data-filter': '', 'aria-label': `Filter ${cfg.title.toLowerCase()}` });
      search.addEventListener('input', () => { text = search.value; api.update(); });
      const add = h('button', {
        class: 'btn primary',
        // What the list is narrowed to comes in the new item: its project, and what it hangs from.
        onclick: () => openCreateModal(type, {
          ...(view.project ? { project: view.project } : {}),
          ...(view.related || view.initiative ? { related_to: view.related || view.initiative } : {}),
        }, { fixedType: true }),
      }, icon('plus', 16), `Add ${label.toLowerCase()}`);
      root.replaceChildren(
        h('header', { class: 'view-head row' },
          h('div', {}, h('h1', {}, cfg.title), subtitle),
          h('span', { class: 'spacer' }),
          add),
        h('div', { class: 'toolbar list-toolbar' }, closable || dated ? scopeBar : null, sourceSel, search, h('span', { class: 'spacer' }), filterBtn),
        body);

      const change = (patch) => { Object.assign(view, patch); save(); api.update(); };
      const field = (name, control) => (control ? h('div', { class: 'field' }, h('span', {}, name), control) : null);

      /** The right panel: group by, then the filters; redrawn on every update. */
      function renderSide() {
        // A relation filter that only picks initiatives (a PRD's) is the Initiative filter again: left out.
        const relation = cfg.relation && !(byInitiative && cfg.relation.join() === 'initiative') ? select(
          parentOptions(cfg.relation, cfg.relationAny, { current: view.related }),
          view.related, (v) => change({ related: v }), { 'aria-label': 'Related to' }) : null;
        const projects = byProject ? select([[null, 'Any project'], ...state.items
          .filter((i) => i.type === 'project' && i.fields.project_key)
          .map((p) => [p.fields.project_key, `${p.fields.project_key} · ${p.title}`, 'folder'])], view.project,
        // An initiative of another project would leave the list empty: picking a project lets it go.
        (v) => change({ project: v, initiative: v && state.byId.get(view.initiative)?.fields.project !== v ? null : view.initiative }),
        { 'aria-label': 'Project' }) : null;
        const initiatives = byInitiative ? select(
          parentOptions(['initiative'], 'Any initiative', { current: view.initiative, where: inProject(view.project) }),
          view.initiative, (v) => change({ initiative: v }), { 'aria-label': 'Initiative' }) : null;
        const labels = labelSelect(view.label, (v) => change({ label: v }));
        // From – to on the meeting's date; the same day in both is that day.
        const day = (key, label) => {
          const input = h('input', { type: 'date', value: view[key] || '', 'aria-label': label });
          input.addEventListener('change', () => change({ [key]: input.value || null }));
          return input;
        };
        side.replaceChildren(...[
          h('header', { class: 'filter-head' }, h('h4', {}, icon('filter', 14), 'Filters'),
            h('span', { class: 'spacer' }),
            h('button', { class: 'btn icon', title: 'Hide the panel', onclick: () => filterBtn.click() }, icon('x', 15))),
          groupOptions.length ? field('Group by', select([[null, 'None'], ...groupOptions.map((g) => [g, GROUPS[g].label])], view.groupBy,
            (v) => { folded.clear(); change({ groupBy: v }); }, { 'aria-label': 'Group by' })) : null,
          hasStatuses ? field('Status', statusTreeSelect([type], view.status,
            (v) => change({ status: v }), { any: 'Any status', 'aria-label': 'Status' })) : null,
          plannable ? field('Priority', checkSelect(PRIORITIES.map((p) => [p, priorityChip(p)]), view.priority,
            (v) => change({ priority: v }), { any: 'Any priority', 'aria-label': 'Priority' })) : null,
          field('Project', projects),
          field('Initiative', initiatives),
          field(cfg.relationLabel, relation),
          plannable ? field('Planned', planSelect(view.plan, (v) => change({ plan: v }), PLAN_FILTERS)) : null,
          dated ? field('Date', h('div', { class: 'date-range' }, day('from', 'From'), h('span', { class: 'muted' }, '–'), day('to', 'To'))) : null,
          labels.tagName === 'SPAN' ? null : field('Label', labels),
          h('button', {
            class: 'btn small ghost', disabled: !activeFilters(view),
            onclick: () => change(CLEARED),
          }, 'Clear filters'),
        ].filter(Boolean)); // a filter that does not apply to this list is null: left out, not drawn as "null"
      }

      /** The group headers: what the rows share, and how many there are. */
      const groupHeader = (key, members) => {
        const n = members.length;
        const count = h('span', { class: 'muted' }, `${n} ${noun(n)}${plannable ? ` · ${members.filter(isDone).length} closed` : ''}`);
        if (view.groupBy === 'initiative') {
          const ini = key === NONE ? null : state.byId.get(key);
          return h('span', { class: 'group-title' },
            ini ? typeIcon('initiative', 14) : typeIcon(type, 14),
            h('strong', {}, ini ? ini.title : 'No initiative'),
            ini ? h('span', { class: 'mono' }, ini.id) : null,
            ini ? statusChip(ini.fields.status || 'Backlog') : null,
            count);
        }
        if (view.groupBy === 'project') {
          return h('span', { class: 'group-title' },
            typeIcon(key === NONE ? type : 'project', 14),
            h('strong', {}, key === NONE ? 'No project' : projectName(key)),
            key === NONE ? null : h('span', { class: 'mono' }, key),
            count);
        }
        const face = view.groupBy === 'status' ? statusChip(key) : view.groupBy === 'priority' ? priorityChip(key)
          : h('strong', {}, icon('calendar', 14), planLabel(key));
        return h('span', { class: 'group-title' }, face, count);
      };

      const api = {
        update() {
          const all = archivable ? state.all.filter((i) => i.type === type) : byType(type); // prompts: archived ones too, the scope picks
          if (closable) {
            const open = all.filter((i) => !isClosed(i)).length;
            subtitle.textContent = `${open} ${scopes.open.toLowerCase()} · ${all.length - open} ${scopes.closed.toLowerCase()}`;
            scopeBar.replaceChildren(...Object.entries(scopes).map(([k, l]) => h('button', {
              class: `btn small ${view.scope === k ? 'active' : ''}`, 'aria-pressed': String(view.scope === k),
              onclick: () => change({ scope: k }),
            }, l)));
          } else {
            subtitle.textContent = `${all.length} ${noun(all.length)}`;
          }
          if (dated) {
            scopeBar.replaceChildren(...Object.entries(scopes).map(([k, l]) => h('button', {
              class: `btn small ${view.scope === k ? 'active' : ''}`, 'aria-pressed': String(view.scope === k),
              onclick: () => change({ scope: k }),
            }, l)));
          }
          renderSide();
          if (sourceSel) sourceSel.value = view.source || ''; // "Clear filters" empties it too
          const n = activeFilters(view);
          badge.textContent = n || '';
          filterBtn.title = n ? `Filters and grouping · ${n} active` : 'Filters and grouping';
          const q = text.toLowerCase();
          const status = new Set(view.status);
          const priority = new Set(view.priority);
          const rows = all
            .filter((i) => !plannable || planFilter(view.plan)(i))
            .filter((i) => hasLabel(i, view.label))
            .filter((i) => !closable || view.scope === 'all' || (view.scope === 'open') !== isClosed(i))
            .filter((i) => !view.source || i.fields.source === view.source)
            .filter((i) => !dated || inDateScope(view.scope, i.fields.date))
            .filter((i) => !dated || inRange(i.fields.date, view.from, view.to))
            .filter((i) => !status.size || status.has(i.fields.status || 'Backlog'))
            .filter((i) => !priority.size || priority.has(i.fields.priority || 'Normal'))
            // An initiative takes in everything under it: its stories, and the tasks of those stories.
            .filter((i) => !view.related || ancestorsOf(i, state.byId).some((p) => p.id === view.related))
            .filter((i) => !view.project || projectOf(i) === view.project)
            // Under the initiative at any depth: through a task, or a sub-initiative of it.
            .filter((i) => !view.initiative || ancestorsOf(i, state.byId).some((p) => p.id === view.initiative))
            .filter((i) => !q || `${i.id} ${i.title}`.toLowerCase().includes(q));
          const g = view.groupBy ? GROUPS[view.groupBy] : null;
          const group = g ? {
            by: (i) => g.by(i, state.byId),
            order: (a, b) => g.order(a, b, state.byId, projectName),
            collapsed: folded,
            onToggle: (key) => { if (!folded.delete(key)) folded.add(key); api.update(); },
            header: groupHeader,
          } : null;
          // The column the group header already says goes: a story's parent (its initiative; the rest may hang from a
          // story or task), Ticketing's Initiative column, or its Project column.
          const said = view.groupBy === 'initiative' ? (parentIsGroup ? 'parent' : 'initiative')
            : view.groupBy === 'project' ? 'project' : null;
          tableBox.replaceChildren(dataTable({
            columns: said ? cfg.columns.filter((c) => c.key !== said) : cfg.columns,
            rows, sort, label: cfg.title, group, paging: { key: `list.${type}`, size: LIST_PAGE },
            onSort: (st) => { sort = st; saveSort(`list.${type}`, st); api.update(); },
            onRow: openItem,
            empty: all.length ? `No ${cfg.title.toLowerCase()} match.` : `No ${cfg.title.toLowerCase()} yet — “Add ${label.toLowerCase()}” to create one.`,
          }));
        },
      };
      return api;
    },
  };
}

