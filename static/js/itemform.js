// The item dialog, shared by every item type and by both ways of opening it:
// the card of an existing item (panel.js) and the form that creates one (create.js).
//
//   modalFrame()   the shell: header, title, main column, side column
//   modalTitle()   the title row: type icon + subject input
//   itemFields()   the property fields, in ONE order for all items
//
// itemFields() never touches the data itself. It talks to a `binding`, which each
// caller supplies: the card's binding saves every change at once, the create
// form's binding only updates the form state.
//
//   binding = {
//     type,                 // 'task' | 'initiative' | 'note' | 'transcription' | 'meeting' | 'activity' | 'inbox' | 'prompt'
//     get(key),             // current value of a field
//     set(key, value),      // a field changed
//     live,                 // true → fire set() on every keystroke, not only on commit
//     exclude,              // Set of ids that may not become related_to
//     sidePanel,            // true → no Related to, Project nor Session: an existing item has them in its side panel
//                           // (Relations; the AI tab), and its own fields in their tab
//     aside,                // Set of keys the caller shows in its own right column instead ('project', 'related_to', 'session_name',
//                           // 'tab:<tab>' for a type's own fields of that tab: rules.js tabOf)
//   }
//
// Keys: status, priority, related_to, project, session_name, planned, due, date, time, duration, attendees,
// source, from, labels. `planned` is one of 'today' | 'week' | 'nextweek'
// | 'YYYY-MM-DD' | 'YYYY-Www' | null.
import { dateInput, pickDate } from './datepicker.js';
import { isoWeek, monthLabel, relDay, shiftWeek, thisMonth, thisWeek, today } from './dates.js';
import { ACTIVITY_SOURCES, PARENT_TYPES, PLANNABLE, PRIORITIES, STRUCTURE, TYPE_DEFS, defaultOf, hasField, inProject, kindFor, movesProject, needsParent, parentChoices, parentLabel, parentPick, parentValue, projectHas, propsIn, askedOnCreate, propsOf, statusesOf, tabOf } from './rules.js';
import { LINK_LABELS } from './linkgroups.js';
import { peopleOf } from './people.js';
import { cleanTime } from './worktime.js';
import { allContacts, allLabels, state } from './state.js';
import { TYPE_ICON_NAME, checkSelect, dropdown, h, icon, labelInput, parentOptions, select, tagInput, typeIcon } from './ui.js';
import { refOf } from './shownid.js';

/** The kind a binding's item falls under (Ticketing): a project's own, else its project's; none for an item with no
 *  project. What it hides (rules.js propsOf) is not drawn, on the card, the page or the create form. */
export const kindOfBinding = (b) => kindFor({ type: b.type, fields: { project: b.get('project'), [STRUCTURE.kind_key]: b.get(STRUCTURE.kind_key) } }, state.all);

// ── the shell ────────────────────────────────────────────────────────────────

// The right column of a card, a form or a page folds to a narrow strip. It starts open, and the choice is kept per kind
// of screen (this browser only): `tm.modalSide` for cards and forms, `tm.iniSidePanel` for pages.
const MODAL_SIDE_KEY = 'tm.modalSide';

/**
 * The button that folds a right column (`body` holds it: the class `collapsed` goes on it). It goes first inside the
 * column, top right, level with its tabs; folded, the column is a strip with only this button, to open it again.
 */
export function sideFold(body, key) {
  const btn = h('button', { class: 'btn icon side-fold' }, icon('panel', 16));
  const show = (open) => {
    body.classList.toggle('collapsed', !open);
    btn.setAttribute('aria-pressed', String(open));
    btn.title = open ? 'Hide the side panel' : 'Show the side panel';
  };
  let open = true;
  try { open = localStorage.getItem(key) !== 'closed'; } catch { /* storage off: open */ }
  show(open);
  btn.addEventListener('click', () => {
    const now = body.classList.contains('collapsed'); // folded: the click opens it
    show(now);
    try { localStorage.setItem(key, now ? 'open' : 'closed'); } catch { /* it just opens again next time */ }
  });
  return btn;
}

/** Header + two columns. Every part is a list of nodes; null entries are skipped. The right column folds (sideFold). */
export function modalFrame({ head = [], title, main = [], side = [], sideClass = '', foot = null }) {
  const solo = !side.some(Boolean); // nothing for a side column (a prompt): one column, and no button to fold it
  const body = h('div', { class: `im-body ${solo ? 'solo' : ''}` }, h('div', { class: 'im-main' }, title, ...main));
  if (!solo) body.append(h('aside', { class: `im-side ${sideClass}` }, sideFold(body, MODAL_SIDE_KEY), ...side));
  return [
    h('header', { class: 'im-head' }, ...head.filter(Boolean)),
    body,
    foot ? h('footer', { class: 'im-foot' }, ...foot) : null, // pinned under both columns
  ].filter(Boolean);
}

/** The title row: the type's icon beside the subject input. */
export const modalTitle = (type, subjectInput, after = null) =>
  h('div', { class: 'im-title' }, h('span', { class: 'type-ico' }, typeIcon(type, 16)), subjectInput, after);

// ── planning ─────────────────────────────────────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

/** The plan key an item's plan_day / plan_week / plan_month stand for (the day wins, then the week). */
export function planKey(f) {
  if (f.plan_day) {
    if (f.plan_day === today()) return 'today';
    return f.plan_day;
  }
  if (f.plan_week === thisWeek()) return 'week';
  if (f.plan_week === shiftWeek(thisWeek(), 1)) return 'nextweek';
  if (f.plan_week) return f.plan_week;
  if (f.plan_month === thisMonth()) return 'month';
  return f.plan_month || null;
}

/** plan_day / plan_week / plan_month values for a plan key (the create form sends these). */
export function planValues(plan) {
  if (plan === 'today') return { plan_day: today(), plan_week: thisWeek() };
  if (plan === 'week') return { plan_week: thisWeek() };
  if (plan === 'nextweek') return { plan_week: shiftWeek(thisWeek(), 1) };
  if (plan === 'month') return { plan_month: thisMonth() };
  if (plan && MONTH_RE.test(plan)) return { plan_month: plan };
  if (plan && DAY_RE.test(plan)) return { plan_day: plan, plan_week: isoWeek(plan) };
  if (plan) return { plan_week: plan };
  return {};
}

const PLAN_CHOICES = [[null, 'Not planned', 'ban'], ['today', 'Today', 'sun'], ['week', 'This week', 'calendar'], ['nextweek', 'Next week', 'calendarplus'], ['month', 'This month', 'calendardays']];
const PICK = '__pick__';

/** Options for the Planned select; a plan outside the presets (a given day, another week) gets its own row (`short`: a day without its week). */
function planOptions(current, short = false) {
  const custom = current && !PLAN_CHOICES.some(([k]) => k === current)
    ? [[current, DAY_RE.test(current) ? (short ? relDay(current) : `${relDay(current)} · ${isoWeek(current)}`)
      : MONTH_RE.test(current) ? monthLabel(current) : short && /^\d{4}-W\d\d$/.test(current) ? current.slice(5) : current, 'calendardays']] : [];
  return [...PLAN_CHOICES, ...custom, [PICK, 'Pick a date…', 'calendarsearch']];
}

/**
 * The Planned select: Today / This week / Next week / This month, or a given day through the date picker.
 * get() → the current plan key, set(key) saves a new one; the control redraws itself after each pick.
 * Shared by the item's fields and the Planned column of the tables (datatable.js), which passes `short`.
 */
export function planControl(get, set, attrs = {}, { short = false } = {}) {
  const wrap = h('span', { class: 'plan-control' });
  const render = () => {
    const current = get();
    const sel = select(planOptions(current, short), current, (v) => {
      if (v === PICK) { // our calendar, under the select; a day already planned opens on it
        sel.value = current ?? '';
        pickDate(sel, DAY_RE.test(current || '') ? current : null, (day) => { set(day); render(); }, { clearable: false });
        return;
      }
      set(v);
      render();
    }, { 'aria-label': 'Planned', ...attrs });
    wrap.replaceChildren(sel);
  };
  render();
  return wrap;
}

// ── the fields ───────────────────────────────────────────────────────────────

const field = (label, control) => h('label', { class: 'field' }, h('span', {}, label), control);

/**
 * The property fields, two per row (Labels takes the whole row), always in this order (a type skips the ones
 * that do not apply to it):
 *   [activity: source · from · date · time] · status · priority · priority reason (whole row) · related to · session
 *   · planned · due · [meeting: date · time · duration · attendees] · labels
 */
export function itemFields(b) {
  const { type } = b;
  const plannable = PLANNABLE.has(type);
  const out = [];
  // Fields the right column shows instead: all of them on a card (sidePanel), the ones the create form names (aside).
  const aside = (key) => b.sidePanel || !!b.aside?.has(key);
  const props = propsOf(type, kindOfBinding(b)); // its own fields, as its project's kind keeps them

  const text = (key, attrs = {}) => {
    const el = h('input', { type: 'text', value: b.get(key) || '', 'data-fk': key, ...attrs });
    el.addEventListener(b.live ? 'input' : 'change', () => b.set(key, el.value));
    return el;
  };
  // Who: tags like the labels, suggested from the people and the groups of Contacts (an email list invited to a meeting).
  const person = (label, key) => h('div', { class: 'field' }, h('span', {}, label),
    tagInput(peopleOf(b.get(key)), (names) => b.set(key, names), { kind: 'person', suggest: allContacts, placeholder: 'Add a person or a group…', fk: key }));
  const date = (key) => {
    const el = dateInput(b.get(key) || '', { 'data-fk': key });
    el.addEventListener(b.live ? 'input' : 'change', () => b.set(key, el.value));
    return el;
  };
  // A meeting's or an activity's day and time: when it starts, or when it came. A blank time is "not known" (an all-day event).
  const dateTime = () => {
    out.push(field('Date', date('date')));
    const time = h('input', { type: 'time', value: b.get('time') || '', 'data-fk': 'time' });
    time.addEventListener('change', () => b.set('time', time.value));
    out.push(field('Time', time));
  };

  // Priority, then why it has it (free text, a row of its own), on any type that has one: right after Status on a
  // planned type, after Source · From on an activity. Drawn once, wherever it comes first. A type whose own props take
  // priority's slot (`slot: 'priority'`: a Ticketing support ticket's level and why) shows those there instead.
  let prioritized = false;
  const slotted = props.filter((p) => p.slot === 'priority');
  const priorityFields = () => {
    if (prioritized) return;
    if (slotted.length) {
      prioritized = true;
      for (const p of slotted) if (!b.creating || askedOnCreate(p)) out.push(propField(b, p));
      return;
    }
    if (!hasField(type, 'priority')) return;
    prioritized = true;
    out.push(field('Priority', select(PRIORITIES.map((p) => [p, p]), PRIORITIES.includes(b.get('priority')) ? b.get('priority') : defaultOf('priority', 'Normal'),
      (v) => b.set('priority', v), { class: 'prio-select', 'aria-label': 'Priority', 'data-fk': 'priority' })));
    out.push(h('label', { class: 'field span2' }, h('span', {}, 'Priority reason'),
      text('priority_reason', { placeholder: 'Why this priority', 'aria-label': 'Priority reason' })));
  };

  if (type === 'activity') { // where the message came from comes before what it is about
    out.push(field('Source', select(ACTIVITY_SOURCES.map((s) => [s, s]), b.get('source') || 'Email', (v) => b.set('source', v), { 'data-fk': 'source' })));
    out.push(person('From', 'from'));
    dateTime();
    priorityFields();
  }

  // A project's key is set once, here: every item of it names it (and in Ticketing every ticket's id carries it). A
  // Ticketing project's kind is chosen once too, among its Settings (a field of its own with `once`).
  if (type === 'project' && b.creating) {
    out.push(field('Key', text('project_key', { placeholder: 'HB — 2 to 4 capital letters', 'aria-label': 'Project key' })));
  }

  // A Ticketing item's project. On an item's card or page it is the first row of the Relations tab instead, and
  // on the create form the first section of its right column (b.aside).
  if (hasField(type, 'project') && type !== 'project' && !aside('project')) out.push(field('Project', projectControl(b)));

  if (b.titleStatus) { // a card's or page's status sits beside its title (statusSelect); priority keeps its place here
    priorityFields();
  } else if (plannable) {
    // select() recolours the status / priority pill itself, so the create form (which never re-renders) stays right too.
    const statuses = statusesOf(type);
    out.push(field('Status', select(statuses.map((s) => [s, s]), statuses.includes(b.get('status')) ? b.get('status') : statuses[0],
      (v) => b.set('status', v), { class: 'status-select', 'aria-label': 'Status', 'data-fk': 'status' })));
    priorityFields();
  } else if (hasField(type, 'status')) { // a status without planning (a Ticketing error, an agent)
    const statuses = statusesOf(type);
    out.push(field('Status', select(statuses.map((s) => [s, s]), statuses.includes(b.get('status')) ? b.get('status') : statuses[0],
      (v) => b.set('status', v), { class: 'status-select', 'aria-label': 'Status', 'data-fk': 'status' })));
    if (hasField(type, 'priority')) priorityFields(); // an agent's, as a task's: Status · Priority, then why
  }
  priorityFields(); // a type with a priority and no status

  if (PARENT_TYPES[type].length && !aside('related_to')) out.push(field(relatedLabel(type), relatedControl(b)));

  if (type !== 'prompt' && !aside('session_name')) out.push(field('Session', text('session_name', { placeholder: 'Claude session handling this' })));

  // When, on one row: Planned (Today / This week / Next week / This month, or a day through the date picker), Start (a
  // project's) and Due.
  const when = [
    plannable ? h('label', { class: 'field plan-field' }, h('span', {}, 'Planned'),
      planControl(() => b.get('planned'), (v) => b.set('planned', v), { 'data-fk': 'planned' })) : null,
    hasField(type, 'start') ? field('Start', date('start')) : null,
    hasField(type, 'due') ? field('Due', date('due')) : null,
  ].filter(Boolean);
  if (when.length && b.propList) out.push(...when); // one row each in the list of properties
  else if (when.length) out.push(h('div', { class: `field-row${when.length > 2 ? ' cols-3' : ''}` }, when));

  if (type === 'meeting') {
    dateTime();
    // How long it lasts, as HH:MM, typed as loosely as a work-log time ("130" → 01:30, a bare "2" is hours); blank is "not known".
    const duration = h('input', { type: 'text', value: b.get('duration') || '', placeholder: 'HH:MM', inputmode: 'numeric', 'data-fk': 'duration' });
    duration.addEventListener('change', () => {
      const v = duration.value.trim();
      const clean = v ? cleanTime(v) ?? v : ''; // not a time: sent as typed, and the server says why it is refused
      duration.value = clean;
      b.set('duration', clean);
    });
    out.push(field('Duration', duration));
    out.push(person('Attendees', 'attendees'));
  }
  out.push(h('div', { class: 'field span2' }, h('span', {}, 'Labels'),
    labelInput(b.get('labels') || [], (labels) => b.set('labels', labels), { suggest: allLabels })));

  // The type's own fields (a Ticketing support ticket's level, origin, disposition…), as its structure lists them.
  // An item's card or page shows here only its properties (tab 'main'); the rest sit in their side tab (panel.js). The
  // create form moves the tabs it names (b.aside: 'tab:details', 'tab:delivery', 'tab:relations') to its right column.
  for (const p of props) {
    if (p.slot === 'priority') continue; // drawn in priority's slot, above
    if (b.creating && !askedOnCreate(p)) continue; // set by the app, nothing to fill in yet
    const tab = tabOf(p);
    if (tab === 'hidden' || (tab !== 'main' && aside(`tab:${tab}`))) continue;
    out.push(propField(b, p));
  }

  return h('div', { class: 'fields' }, out);
}

// The properties in blocks, a line between one and the next: its priority, its dates, its labels (by field key); then its
// outside ticket and local path, and its watchers. Any other field of its type goes with the one before it.
export const PROP_BLOCKS = [['priority', 'priority_reason', 'level', 'level_reason'], ['planned', 'start', 'due'], ['labels']];

/** Marks the first row of each block after the first (`prop-break`, app.css draws the line). `rows`: [row, its block number],
 *  in order. */
export function breakBlocks(rows) {
  let last = null;
  for (const [el, n] of rows) {
    if (last !== null && n !== last) el.classList.add('prop-break');
    last = n;
  }
}

/** The block (PROP_BLOCKS) of each of a list's own rows, by the key of its field: a row of no block goes with the one
 *  before it. → [row, block number] */
export function blocksOf(rows) {
  let n = 0;
  return rows.map((el) => {
    const at = PROP_BLOCKS.findIndex((keys) => keys.includes(el.querySelector('[data-fk]')?.dataset.fk));
    if (at >= 0) n = at;
    return [el, n];
  });
}

/** Quiet fields have no frame: an empty one says so ("Empty"), so it still reads as a place to write. */
export function quietBlanks(el) {
  // A field with no helper text of its own says Empty, never nothing (an empty placeholder counts as none).
  const blank = ':is(:not([placeholder]), [placeholder=""])';
  for (const f of el.querySelectorAll(`input[type=text]${blank}, input:not([type])${blank}, textarea${blank}, input[type=number]${blank}`)) f.placeholder = 'Empty';
  return el;
}

/** The status as a small pill beside an item's title (card and page), the same select the fields used to have. */
export function statusSelect(b) {
  if (!hasField(b.type, 'status')) return null; // a note, a meeting, an activity… have none (statusesOf falls back to the work's)
  const statuses = statusesOf(b.type);
  if (!statuses.length) return null;
  return select(statuses.map((s) => [s, s]), statuses.includes(b.get('status')) ? b.get('status') : statuses[0],
    (v) => b.set('status', v), { class: 'status-select small title-status', 'aria-label': 'Status', 'data-fk': 'status' });
}

/**
 * Area and Objective (tm/structures/traits.py `aimed`: a project's, an initiative's): first in their Settings tab, and the
 * create form's first section. null for a type without them.
 */
export function aimFields(b) {
  if (!hasField(b.type, 'area') || !hasField(b.type, 'objective')) return null;
  const area = h('input', { type: 'text', value: b.get('area') || '', placeholder: 'Where it belongs: checkout, billing…', 'data-fk': 'area' });
  area.addEventListener(b.live ? 'input' : 'change', () => b.set('area', area.value));
  const objective = h('textarea', { rows: 2, placeholder: 'The observable end state that lets it close', 'data-fk': 'objective' }, b.get('objective') || '');
  objective.addEventListener(b.live ? 'input' : 'change', () => b.set('objective', objective.value));
  return h('div', { class: 'fields prop-rows quiet' }, h('label', { class: 'field span2' }, h('span', {}, 'Area'), area),
    h('label', { class: 'field span2' }, h('span', {}, 'Objective'), objective));
}

/** The groups of one tab's props without a title of their own (a tab of the page holds them); null without any. */
function groupedBody(b, tab) {
  const props = propsIn(b.type, tab, kindOfBinding(b)).filter((p) => !b.creating || askedOnCreate(p));
  if (!props.length) return null;
  return quietBlanks(h('div', { class: `fold-groups ${tab}-body prop-rows quiet`, id: `${tab}-${String(b.key || 'new').replace(/[^\w-]/g, '-')}` }, propGroups(props, b)));
}
export const settingsBody = (b) => groupedBody(b, 'settings');
export const deliveryBody = (b) => groupedBody(b, 'delivery');

/** What an item's parent is called, by the one rule of every structure (tm/structures/traits.py parent_label): the type
 *  it hangs from when it can hang from one ("Meeting", "Initiative"), "Parent" when from several. `types`: the ones a
 *  field offers (the Initiative field, or the rest). */
export const relatedLabel = (type, types = PARENT_TYPES[type]) => (types.length === 1 ? TYPE_DEFS[types[0]]?.label || 'Parent' : 'Parent');

/** The item it hangs from (related_to), among those of the types it may hang from (rules.js PARENT_TYPES) — and, for
 *  an item with a project (Ticketing), of that project. `types` narrows it (the Initiative field, or the rest): the
 *  field then shows the parent only when it is one of them. `empty` names its none row ("Pick an initiative…" in
 *  the side panel's Relations). */
export function relatedControl(b, { types = PARENT_TYPES[b.type], label = relatedLabel(b.type), fk = 'related_to', empty = '— none —' } = {}) {
  const where = hasField(b.type, 'project') ? inProject(b.get('project')) : undefined;
  const parent = state.byId.get(b.get('related_to'));
  const current = parent ? (types.includes(parent.type) ? parent.id : null) : b.get('related_to') || null;
  return select(parentOptions(types, empty, { exclude: b.exclude || new Set(), current, where }),
    current, (v) => b.set('related_to', v), { 'data-fk': fk, 'aria-label': label, clearable: true });
}

/**
 * Its Parent: one field for where it lives — its project and what it hangs from (`project` and `related_to` in the
 * file, rules.js parentChoices / parentPick). It offers only what may be its parent: the projects where it chooses
 * one (a task, a note…, or a ticket being created), never to one that always hangs from an item (a plan, a story…);
 * then the items its type may hang from. Picking an item brings that item's project where it can change.
 */
export function parentControl(b, { empty = null } = {}) {
  const fields = { related_to: b.get('related_to') || null, project: b.get('project') || null };
  const free = movesProject(b.type) || (b.creating && hasField(b.type, 'project'));
  const current = free ? parentValue(fields) : fields.related_to;
  const choices = parentChoices(b.type, { project: fields.project, exclude: b.exclude || new Set(), current: fields.related_to, creating: !!b.creating }, state.all);
  const label = parentLabel(b.type).toLowerCase();
  const none = empty || `Pick ${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}…`;
  return select([[null, none], ...choices.map((c) => [c.value, c.label, c.type === 'project' ? 'folder' : TYPE_ICON_NAME[c.type] || null])],
    current, (v) => {
      const w = parentPick(b.type, v, state.all, fields, { creating: !!b.creating });
      // What it hangs from first, its project last: the form draws itself again for the project it lands in.
      if ('related_to' in w) b.set('related_to', w.related_to);
      if ('project' in w) b.set('project', w.project);
    }, { 'data-fk': 'parent', 'aria-label': parentLabel(b.type), search: true, clearable: !needsParent(b.type) || !fields.related_to });
}

/**
 * Where a Ticketing item lives: its project. A ticket (a type that lives in a project) lives in its project's folder
 * and its id carries the key, so it is chosen once, on creation, and read-only after; a task, a note, a meeting or an
 * activity may have none, and change it.
 */
export function projectControl(b) {
  const scoped = (STRUCTURE.project_scoped || []).includes(b.type);
  // A ticket is offered only the projects whose kind (and Types) hold its type: a story, no simple project.
  const projects = state.items.filter((i) => i.type === 'project' && i.fields.project_key && (!b.creating || projectHas(i, b.type)));
  if (scoped && !b.creating) {
    const p = projects.find((i) => i.fields.project_key === b.get('project'));
    return h('span', { class: 'prop-readonly' }, p ? `${p.fields.project_key} · ${p.title}` : (b.get('project') || '—'));
  }
  return select([[null, scoped ? 'Choose a project…' : '— none —'],
    ...projects.map((p) => [p.fields.project_key, `${p.fields.project_key} · ${p.title}`, 'folder'])], b.get('project') || null,
  (v) => b.set('project', v), { 'data-fk': 'project', 'aria-label': 'Project', clearable: !scoped });
}

const shown = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(' · ') || '—';
  return String(v);
};
const itemLabel = (i) => `${refOf(i)}${refOf(i) ? ' · ' : ''}${i.title}`;

/**
 * A side tab's own fields in the groups the structure gives them (`group`, `group_icon`, in order: Delivery; a
 * project's Details), each a section under its title. Fields with no group (another structure's) make one section
 * without a title. A group of one field named as the group (Support due days) drops the field's own label.
 */
export function propGroups(props, b) {
  const groups = [];
  for (const p of props) {
    if (groups.at(-1)?.title !== (p.group || '')) groups.push({ title: p.group || '', icon: p.group_icon, props: [] });
    groups.at(-1).props.push(p);
  }
  // One field per row (app.css): `delivery-group`, a map's keys too; `details-group` (a project's), C1 · C2 · C3 in a row.
  return groups.map((g) => h('section', { class: `panel-section prop-group ${g.props[0].tab ? `${g.props[0].tab}-group` : ''}` },
    g.title ? h('h4', {}, g.icon ? icon(g.icon, 14) : null, g.title) : null,
    h('div', { class: 'fields' }, g.props.map((p) => {
      const el = propField(b, p);
      if (g.props.length === 1 && p.label === g.title) el.querySelector(':scope > span')?.remove();
      return el;
    }))));
}

/** One field of a type's own (TypeDef.props): kind text · textarea · select · checks · number · date · link · links · readonly · map. */
export function propField(b, p) {
  // Chosen once, on creation: the create form offers its options; after, it is read-only (its option's label).
  if (p.once && b.creating) p = { ...p, kind: p.options ? 'select' : 'text', readonly: false };
  else if (p.once && p.options) return field(p.label, h('span', { class: 'prop-readonly' }, p.options.find(([v]) => v === b.get(p.key))?.[1] || shown(b.get(p.key))));
  const value = b.get(p.key);
  const fk = { 'data-fk': p.key };
  const input = (attrs) => {
    const el = h('input', { value: value ?? '', placeholder: p.placeholder || null, ...fk, ...attrs });
    el.addEventListener(b.live ? 'input' : 'change', () => b.set(p.key, el.value));
    return el;
  };
  if (p.kind === 'readonly' || (p.readonly && p.kind !== 'link')) return field(p.label, h('span', { class: 'prop-readonly' }, shown(value)));
  if (p.kind === 'select') {
    // One the create form marks optional (b.optional) starts on none: nothing is written until it is picked, and the
    // new file keeps its template's value.
    const unpicked = b.creating && value === undefined && !!b.optional?.has(p.key);
    const opts = [...(unpicked && p.options.every(([v]) => v) ? [[null, '—']] : []), ...p.options.map(([v, l]) => [v || null, l || '—'])];
    const current = unpicked ? null : value ?? p.default ?? opts[0][0];
    // What the form shows is what it creates: a new item gets the value on screen, not the server's own default.
    if (b.creating && value === undefined && current) b.set(p.key, current);
    return field(p.label, select(opts, current, (v) => b.set(p.key, v ?? ''), fk));
  }
  // Several of its options, ticked in a menu; the `fixed` ones always on (a project's core types).
  if (p.kind === 'checks') {
    const fixed = p.fixed || [];
    const ticked = [...new Set([...fixed, ...(Array.isArray(value) ? value : [])])];
    return field(p.label, checkSelect(p.options.map(([v, l]) => [v, l || v]), ticked,
      (v) => b.set(p.key, [...new Set([...fixed, ...v])]), { any: '—', text: (v) => v.join(', '), fixed, ...fk }));
  }
  if (p.kind === 'textarea') {
    const el = h('textarea', { rows: 2, placeholder: p.placeholder || null, ...fk }, value ?? '');
    el.addEventListener(b.live ? 'input' : 'change', () => b.set(p.key, el.value));
    return h('label', { class: 'field span2' }, h('span', {}, p.label), el);
  }
  if (p.kind === 'number') return field(p.label, input({ type: 'number' }));
  if (p.kind === 'date') {
    const el = dateInput(value || '', { placeholder: p.placeholder || 'Pick a date', ...fk });
    el.addEventListener('change', () => b.set(p.key, el.value));
    return field(p.label, el);
  }
  if (p.kind === 'link' || p.kind === 'links') {
    const pool = state.items.filter((i) => (p.types || []).includes(i.type) && i.key !== b.key);
    if (p.readonly) {
      const target = pool.find((i) => i.key === value);
      return field(p.label, h('span', { class: 'prop-readonly' }, target ? itemLabel(target) : shown(value)));
    }
    if (p.kind === 'link') {
      return field(p.label, select([[null, '— none —'], ...pool.map((i) => [i.key, itemLabel(i)])], value || null,
        (v) => b.set(p.key, v || ''), { ...fk, search: true, clearable: true }));
    }
    // Several: the ids, comma separated (as the list shows them).
    const el = h('input', { type: 'text', value: (value || []).join(', '), placeholder: 'ACME-INI-012, ACME-SUP-003', ...fk });
    el.addEventListener('change', () => b.set(p.key, el.value.split(',').map((x) => x.trim()).filter(Boolean)));
    return field(p.label, el);
  }
  if (p.kind === 'map') {
    const cur = value && typeof value === 'object' ? value : {};
    // With a name per key (On hold: On hold by · Why on hold · Resume when) each key is a row of its own, its name on
    // the left as every other field's (app.css: a map with no name of its own); else its keys side by side under it.
    const named = p.key_labels || null;
    return h('div', { class: 'field span2 prop-map' }, named ? null : h('span', {}, p.label),
      h('div', { class: 'prop-map-row' }, (p.keys || []).map((k) => {
        const el = h('input', { type: p.number ? 'number' : 'text', min: p.number ? 0 : null, value: cur[k] ?? '', placeholder: b.creating ? 'Default' : 'Empty', // blank: the server's default
          'aria-label': `${p.label} ${k}`, 'data-fk': `${p.key}.${k}` });
        // A number map (a project's support due days) keeps numbers; blank leaves it to the server's default.
        const read = () => (p.number && el.value.trim() !== '' ? Number(el.value) : el.value.trim());
        el.addEventListener('change', () => b.set(p.key, { ...(b.get(p.key) || {}), [k]: read() }));
        // Its key over it: the placeholder alone goes once the box has a value.
        return h('label', { class: 'prop-map-cell' }, h('span', { class: 'prop-map-key' }, named?.[k] || k.replace('_', ' ')), el);
      })));
  }
  return field(p.label, input({ type: 'text' }));
}

// ── link labels ──────────────────────────────────────────────────────────────

// The label of a link: one of the usual services, or free text under "Other".
const LINK_OTHER = 'Other';

/**
 * A combo of LINK_LABELS plus "Other". "Other" turns the combo, in its own place and width, into a
 * text field for a custom label, with a ▾ in it to go back to the list: the link stays one row.
 * `onPick(label)` gets the label to save ('' for none). Returns [slot, customInput]: the slot goes in
 * the row, the input is inside it (read it, never place it elsewhere).
 * A custom label is saved when the text is committed, not when "Other" is picked.
 */
export function linkLabelControl(label, onPick) {
  const preset = LINK_LABELS.includes(label);
  const other = !!label && !preset;
  const custom = h('input', { type: 'text', class: 'link-custom', placeholder: 'Custom label', 'aria-label': 'Custom label', value: other ? label : '' });
  const slot = h('span', { class: `link-label-slot ${other ? 'other' : ''}` });
  const setOther = (on) => { slot.classList.toggle('other', on); custom.hidden = !on; };
  const combo = select([[null, 'No label'], ...LINK_LABELS.map((l) => [l, l]), [LINK_OTHER, 'Other']],
    preset ? label : other ? LINK_OTHER : null, (v) => {
      if (v === LINK_OTHER) { setOther(true); custom.focus(); return; }
      setOther(false);
      custom.value = '';
      onPick(v || '');
    }, { 'aria-label': 'Link label' });
  custom.addEventListener('change', () => onPick(custom.value.trim()));
  // The combo stays under the field (invisible), so its list opens right there.
  const back = h('button', { type: 'button', class: 'link-custom-list', title: 'Pick a label from the list', 'aria-label': 'Pick a label from the list', onclick: () => combo.click() }, icon('down', 14));
  slot.append(combo, h('span', { class: 'link-custom-wrap' }, custom, back));
  setOther(other);
  return [slot, custom];
}
