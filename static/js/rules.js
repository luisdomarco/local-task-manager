// Business rules: which item shows up where. Views only ask these questions;
// they never inspect frontmatter fields to decide membership themselves.
import { isoWeek, monthOf, shiftWeek, thisMonth, today, thisWeek, weekDays, weekMonth } from './dates.js';
import { PROJECTS } from './structure.js';
import { refOf } from './shownid.js';

// Catalogs: the vault's structure (GET /api/structure, tm/structures; the server validates against the same
// lists). Live bindings, set by setStructure() before anything renders: importers always read the current one.
// Until then they are the default structure's, Projects (structure.js); a node test of the legacy folder-per-type
// structure sets that one first (`setStructure(FOLDER_PER_TYPE)`).
export let STRUCTURE = PROJECTS;
export let TYPE_DEFS = {}; // name → the type as the structure describes it
export let STATUSES = [];
export let CLOSED = new Set();
export let PRIORITIES = [];
export let PRIORITY_RANK = {}; // Urgent: 1 … Low: 4
/** The outside tracker items point at: { id_key, url_key, label, id_placeholder, url_placeholder } (Redmine in the folder-per-type structure). */
export let EXTERNAL_REF = {};
// Which types each type may be related to (its parent). Mirrors the structure's `parents` server-side.
export let PARENT_TYPES = {};
/** Types with status / priority / planning (the actionable ones). */
export let PLANNABLE = new Set();
/** A Ticketing project's kinds (tm/structures/kinds.py), by id: the types each has and the fields it hides. */
export let KINDS = {};
let closedOf = {}; // type → the statuses that close it
// The three groups every status falls in (tm/structures GROUPS, TSK-037): fixed, never edited. Open = the first two.
export let STATUS_GROUPS = [['not_started', 'Not started'], ['in_progress', 'In progress'], ['closed', 'Closed']];
export const OPEN_GROUPS = new Set(['not_started', 'in_progress']);
const NOT_STARTED = new Set(['Backlog', 'ToDo', 'Idea', 'open']); // where a status goes when no vault said (as the server)
export const ACTIVITY_SOURCES = ['Email', 'Slack', 'Comment', 'Other'];

const listeners = [];
/** Runs `fn(structure)` now and again whenever the structure changes: how other modules derive their own tables. */
export function onStructure(fn) {
  listeners.push(fn);
  fn(STRUCTURE);
}

export function setStructure(s) {
  STRUCTURE = s;
  TYPE_DEFS = Object.fromEntries(s.types.map((t) => [t.name, t]));
  STATUSES = s.statuses;
  CLOSED = new Set(s.closed);
  PRIORITIES = s.priorities;
  PRIORITY_RANK = Object.fromEntries(s.priorities.map((p, i) => [p, i + 1]));
  EXTERNAL_REF = s.external_ref;
  PARENT_TYPES = Object.fromEntries(s.types.map((t) => [t.name, t.parents]));
  PLANNABLE = new Set(s.types.filter((t) => t.plannable).map((t) => t.name));
  closedOf = Object.fromEntries(s.types.map((t) => [t.name, t.closed.length ? new Set(t.closed) : CLOSED]));
  KINDS = Object.fromEntries((s.kinds || []).map((k) => [k.id, k]));
  if (s.groups) STATUS_GROUPS = s.groups;
  listeners.forEach((fn) => fn(s));
}
setStructure(PROJECTS);

/** Whether this vault has the type turned on: a type turned off in Settings → Vaults is not in its structure. */
export const isEnabled = (type) => !!TYPE_DEFS[type];

/** The statuses an item of this type may have: its own (an error's open · mitigated · resolved), else the structure's. */
export const statusesOf = (type) => (TYPE_DEFS[type]?.statuses?.length ? TYPE_DEFS[type].statuses : STATUSES);
/** The group of a status in a type: as the vault arranged it (Settings → Statuses), else closed if it closes
 *  the type, not started for Backlog · ToDo · Idea · open, under way for the rest. */
export function groupOf(type, status) {
  const g = TYPE_DEFS[type]?.groups?.[status];
  if (g) return g;
  if ((closedOf[type] || CLOSED).has(status)) return 'closed';
  return NOT_STARTED.has(status) ? 'not_started' : 'in_progress';
}
/** Where a status sorts: by its group, then where the type lists it. Unknown ones last. */
export function statusRank(type, status) {
  const list = statusesOf(type);
  const at = list.indexOf(status);
  if (at < 0) return 1000;
  return STATUS_GROUPS.findIndex(([g]) => g === groupOf(type, status)) * 100 + at;
}
/** Where a status sorts when no type is given (the board's lists, a group of mixed types): its best place in any type. */
export function anyStatusRank(status) {
  return Math.min(1000, ...STRUCTURE.types.filter((t) => t.statuses?.length).map((t) => statusRank(t.name, status)));
}
/** Whether a status closes the types that have it (the board's Done list). */
export const isClosedStatus = (status) => closedName(status) || CLOSED.has(status);
/** The statuses of `types` under each group, for the Group → Status filters: [[group, label, [status…]]], each status
 *  once per group, in the types' order. */
export function statusTree(types) {
  return STATUS_GROUPS.map(([g, label]) => {
    const names = [];
    for (const t of types) for (const st of statusesOf(t)) if (groupOf(t, st) === g && !names.includes(st)) names.push(st);
    return [g, label, names];
  });
}
/** What closing (`closed`) or reopening a type's item sets: its first closed status (Done), or its last one not started
 *  (ToDo: ready to be picked up again). */
export function statusFor(type, closed) {
  const list = statusesOf(type).filter((st) => groupOf(type, st) === (closed ? 'closed' : 'not_started'));
  return closed ? list[0] : list[list.length - 1];
}
/** Whether an item passes a status filter (statuses ticked; none ticked = any). A type without statuses (a note, an
 *  activity) passes while its open/closed state has a status of that group ticked. */
export function statusPasses(it, ticked) {
  if (!ticked || !ticked.size) return true;
  const own = TYPE_DEFS[it.type]?.statuses;
  if (own?.length) return ticked.has(it.fields.status || own[0]);
  const done = isDone(it);
  return [...ticked].some((st) => closedName(st) === done);
}
const closedName = (st) => STRUCTURE.types.some((t) => t.statuses?.includes(st) && groupOf(t.name, st) === 'closed');
/** Whether a type carries that field (a support ticket has no priority; only a Ticketing item has a project). */
export const hasField = (type, key) => !!TYPE_DEFS[type]?.fields.includes(key);
/** Whether an item is in a page table that takes only some of its type (TypeDef.child_tables `where`): each field
 *  holds that value, in any case and with spaces around. No `where`: every item is. */
export const matchesWhere = (item, where) => Object.entries(where || {})
  .every(([k, v]) => String(item.fields[k] ?? '').trim().toLowerCase() === String(v).toLowerCase());
/** What an item may hang from, by project (Ticketing): with a project chosen, only items of that project; with
 *  none, any. A parent's project comes with it (parentProject), so an item and what it hangs from share one. */
export const inProject = (project) => (parent) => !project || parent.fields.project === project;
export const parentProject = (parent) => parent?.fields.project || null;
/** Whether a type picks what it hangs from in two fields (Ticketing): Initiative, and Related to for the rest (a support
 *  ticket, a hotfix, a PRD…). Still one parent: picking in one empties the other. */
export const splitsInitiative = (type) => hasField(type, 'project') && (PARENT_TYPES[type] || []).includes('initiative')
  && PARENT_TYPES[type].length > 1;
/** A new item's value for a field where the structure has its own default (P2 in Ticketing, Normal in the folder-per-type structure). */
export const defaultOf = (key, fallback) => STRUCTURE.defaults?.[key] ?? fallback;

/** What names an item in its page's address: its id, or a Ticketing project's key (a project note has no id). */
export const pageRef = (item) => item?.ref || item?.id || (item?.type === 'project' ? item.fields.project_key || '' : '');
/** Whether an item opens as a page of its own (its type's `page`: an initiative; in Ticketing a project and a PRD
 *  too) rather than as a card over its list. One with nothing to name it by opens as a card. */
export const hasPage = (item) => !!item && !!TYPE_DEFS[item.type]?.page && !!pageRef(item);
/** The item a page's address names, among `items`: by its ref (INI-482) or id, a project by its key, and an address
 *  from before short ids by the item's old id (aliases). */
export const findByPageRef = (type, ref, items) => items.find((i) => i.type === type
  && (pageRef(i) === ref || i.id === ref || (i.aliases || []).includes(ref))) || null;
/** Where an item shows one of its type's own fields: 'main' (its properties), or a tab of the side panel. */
export const tabOf = (p) => p.tab || (p.kind === 'link' || p.kind === 'links' ? 'relations' : 'main');
/** A type's own fields, as `kind` keeps them (none: all of them): the ones it hides go (kindFor: a simple
 *  initiative's readiness, a project's delivery settings while it has no delivering initiative). */
export function propsOf(type, kind = null) {
  const props = TYPE_DEFS[type]?.props || [];
  return kind ? props.filter((p) => !hides(kind, type, p.key)) : props;
}
/** Whether the create form asks for a type's own field. Not the ones the app sets (readonly), nor the ones a later
 *  step writes (`later`: how it is carried out and released, its triage, a pause, its outcome: the template's value
 *  until then); but those chosen once, on creation (`once`). */
export const askedOnCreate = (p) => !p.later && ((p.kind !== 'readonly' && !p.readonly) || !!p.once);
/** A type's own fields shown in one place (tabOf), as `kind` keeps them. */
export const propsIn = (type, tab, kind = null) => propsOf(type, kind).filter((p) => tabOf(p) === tab);

// ── initiative kinds (tm/structures/kinds.py, mirrored) ─────────────────────
/** An initiative kind by its id; null for an unknown one, and in a structure without kinds (folder per type). */
export const kindById = (id) => (STRUCTURE.kinds?.length ? KINDS[String(id ?? '').trim()] || null : null);
/** An initiative's kind: its own, else its project's from before kinds moved to initiatives (`projectFields`), else
 *  the kind a project from before kinds had (a product). Null without kinds. */
export function initiativeKindOf(fields, projectFields = null) {
  if (!STRUCTURE.kinds?.length) return null;
  return kindById(fields?.[STRUCTURE.kind_key]) || kindById(projectFields?.[STRUCTURE.legacy_kind_key])
    || KINDS[STRUCTURE.legacy_kind_default] || STRUCTURE.kinds[0];
}
/** The project note an item belongs to, among `items`: itself for a project, else the one its `project` names. */
export const projectOf = (item, items) => (item?.type === 'project' ? item
  : item?.fields?.project ? items.find((i) => i.type === 'project' && i.fields.project_key === item.fields.project) || null : null);
/** Whether a project has delivery work: one of its initiatives (`items`), of any status, is of a delivering kind; or
 *  its note says a delivering kind from before. `fields`: the project's. */
export function projectDelivers(fields, items = []) {
  if (!STRUCTURE.kinds?.length) return true;
  if (kindById(fields?.[STRUCTURE.legacy_kind_key])?.delivers) return true;
  const key = fields?.project_key;
  return !!key && items.some((i) => i.type === 'initiative' && i.fields?.project === key && initiativeKindOf(i.fields, fields)?.delivers);
}
// What a project hides while it has no delivering initiative: its delivery settings (execution, support due days, code).
/** What a project does not show: its delivery settings while it has no delivering initiative, and the kind its note
 *  said before kinds moved to initiatives when it says none (a project made since). */
const projectHidden = (project, items) => {
  const hidden = [...(projectDelivers(project.fields, items) ? [] : STRUCTURE.delivery_settings || []),
    ...(String(project.fields?.[STRUCTURE.legacy_kind_key] || '').trim() ? [] : [STRUCTURE.legacy_kind_key])];
  return hidden.length ? { id: '', delivers: false, hidden: { project: hidden } } : null;
};
/** What hides an item's fields (propsOf): an initiative's kind; for a project, projectHidden; none else (a task, a
 *  vault without kinds). */
export const kindFor = (item, items) => {
  if (!STRUCTURE.kinds?.length || !item) return null;
  if (item.type === 'initiative') return initiativeKindOf(item.fields, projectOf(item, items)?.fields);
  if (item.type === 'project') return projectHidden(item, items);
  return null;
};
/** Whether a kind hides one of a type's fields (a simple initiative has no size). */
export const hides = (kind, type, key) => !!kind?.hidden?.[type]?.includes(key);
/** The kinds an initiative of kind `id` may become, itself first: only wider, never back to simple. */
export const widensTo = (id) => (id ? [id, ...(kindById(id)?.widens || [])] : []);
const scoped = (type) => (STRUCTURE.project_scoped || []).includes(type);
/** Whether a project may get a new item of a type (made, or moved in). One that lives at the root (a task, a note) any
 *  project may; a support ticket or a hotfix, while it delivers (projectDelivers); every other one of its folders
 *  always (a story's, a PRD's, a plan's own initiative is checked apart: initiativeHas). The ones a project holds when
 *  it stops delivering stay listed (the page shows a type it has), with nothing to add. */
export function projectHas(project, type, items = []) {
  if (!scoped(type)) return true;
  if (!STRUCTURE.kinds?.length) return true;
  if (!(STRUCTURE.project_delivery_types || []).includes(type)) return true;
  return projectDelivers(project?.fields, items);
}
/** Whether an item of a type may hang from `parent`: a story, a PRD or a plan only from an initiative that delivers;
 *  added on a project's page, only while one of its initiatives does (it goes under one). */
export function initiativeHas(type, parent, items = []) {
  if (!(STRUCTURE.initiative_delivery_types || []).includes(type)) return true;
  if (parent?.type === 'project' && STRUCTURE.kinds?.length) return projectDelivers(parent.fields, items);
  if (parent?.type !== 'initiative') return true;
  return !!initiativeKindOf(parent.fields, projectOf(parent, items)?.fields)?.delivers;
}
/** Whether a type has a place in this vault: one that lives in a project's folder needs a project that may hold it
 *  (a vault whose initiatives are all simple has no support tickets). A vault with no project yet keeps every type. */
export function inSomeProject(type, items) {
  if (!scoped(type)) return true;
  const projects = items.filter((i) => i.type === 'project');
  return !projects.length || projects.some((p) => projectHas(p, type, items));
}

/** The sidebar's Add item, under the Inbox capture: the types made most often, by group, in order. Not a fact of a
 *  vault but of the menu: a structure without one of them (no projects, no stories) just leaves it out. */
export const ADD_MENU = [['activity'], ['note', 'task', 'meeting'], ['project', 'initiative', 'story']];
/** ADD_MENU's groups with only the types `offered` (those the vault creates), an empty group dropped. The first
 *  stays with the Inbox capture; the rest each after a line. */
export const addMenuGroups = (offered) => {
  const [first, ...rest] = ADD_MENU.map((g) => g.filter((t) => offered.includes(t)));
  return [first, ...rest.filter((g) => g.length)];
};

/**
 * What the create form still needs before the server would take it (tm/store.py create, _create_project,
 * _create_coded): `[[key, why], …]` in the order the fields are drawn, empty when it can be sent. `why` is null for a
 * required field left empty (the form only marks it) and says what is wrong with a value given (a key taken). `form`
 * holds the form's values by field key; `items` the vault's, for the keys taken and a parent's project.
 */
export function missingOnCreate(type, form, items) {
  const out = [];
  if (!String(form.subject || '').trim()) out.push(['subject', null]);
  if (type === 'project') {
    const key = String(form.project_key || '').trim().toUpperCase();
    const taken = key && items.find((i) => i.type === 'project' && i.fields.project_key === key);
    if (!key) out.push(['project_key', null]);
    else if (!/^[A-Z]{2,4}$/.test(key)) out.push(['project_key', 'A key is 2 to 4 capital letters']);
    else if (taken) out.push(['project_key', `${key} is the key of ${taken.title}`]);
    return out;
  }
  const parent = form.related_to ? items.find((i) => i.id === form.related_to) : null;
  // Its Parent (one field for its project and what it hangs from): a ticket may be in no project (leavesProject); a
  // sub-document (an analysis, an error…) is in its item's project, none included, or in one it is given; a plan always
  // hangs from an item (needsParent).
  if ((scoped(type) && !leavesProject(type) && !form.project && !parent) || (needsParent(type) && !parent)) out.push(['parent', null]);
  return out;
}

/** Whether an item of this type chooses its project (a task, a note, a meeting…) rather than living in a project's
 *  folder (a ticket: see leavesProject). */
export const movesProject = (type) => hasField(type, 'project') && !scoped(type);
/** Whether a ticket of this type may be in no project, and change or drop its own (STRUCTURE.leaves_project: an
 *  initiative, a story, a spec, a support ticket, a hotfix, a PRD). Its sub-documents (a plan, an analysis, an error, a
 *  learning) never do on their own: their project is their item's. */
export const leavesProject = (type) => (STRUCTURE.leaves_project || []).includes(type);
/** Whether an id is a short one (`482`, drawn INI-482): a long one (ACME-INI-001) carries its project's key. */
export const isShortId = (id) => /^\d+$/.test(String(id ?? ''));
/** Whether an item's project can change now (its Parent offers projects and none, and an item of any project brings
 *  its own): a task's, a note's…; a ticket's that may leave its project, when its id is short (`id`; a long one carries
 *  its project's key: docs/migrate-short-ids.md); any one's while it is being created (`creating`). */
export const projectFree = (type, { id = null, creating = false } = {}) => movesProject(type)
  || (creating && hasField(type, 'project')) || (leavesProject(type) && isShortId(id));
/** Whether a type always hangs from another item, never from its project alone (a plan: STRUCTURE.needs_parent): its
 *  Parent never offers a project, is required on creation, and is changed, never let go. */
export const needsParent = (type) => (STRUCTURE.needs_parent || []).includes(type);
/** An item's Parent as one value: the item it hangs from (its id), else, where it has one, its project as `project:KEY`. */
export const PROJECT_PICK = 'project:';
export const parentValue = (fields) => fields.related_to || (fields.project ? `${PROJECT_PICK}${fields.project}` : null);
/** What its Parent field is called: Parent, or, for a type with no project that hangs from one type only, that type's
 *  name (a transcription's Meeting). */
export const parentLabel = (type) => {
  const types = PARENT_TYPES[type] || [];
  return hasField(type, 'project') || types.length !== 1 ? 'Parent' : TYPE_DEFS[types[0]]?.label || 'Parent';
};
/**
 * The options of an item's Parent (one field for its project and what it hangs from: `related_to` and `project` in the
 * file): the projects, where its project can change (projectFree: a task, a note…, a ticket with a short id `id`, or
 * one being created), then the items it may hang from — of any project or none where its project can change, else only
 * those of its own (`project`: a sub-document, a ticket with a long id); never one of its own descendants (`exclude`),
 * nor a closed or archived one unless it is the `current` parent. → [{ value, label, type }]
 */
export function parentChoices(type, { project = null, exclude = new Set(), current = null, creating = false, id = null } = {}, items) {
  const free = projectFree(type, { id, creating });
  // A ticket goes only to a project that holds its type (a support ticket, one that delivers), or to none.
  const holds = (p) => !scoped(type) || projectHas(p, type, items);
  const projects = free && !needsParent(type) ? items.filter((i) => i.type === 'project' && i.fields.project_key && holds(i))
    .map((p) => ({ value: PROJECT_PICK + p.fields.project_key, label: `${p.fields.project_key} · ${p.title}`, type: 'project' })) : [];
  const types = PARENT_TYPES[type] || [];
  const fixed = scoped(type) && !free; // it hangs only from what is in its own project (none included)
  const home = (key) => !key || !scoped(type) || items.some((p) => p.type === 'project' && p.fields.project_key === key && holds(p));
  const parents = items.filter((i) => i.id && types.includes(i.type) && !exclude.has(i.id)
      && (fixed ? (i.fields.project || null) === (project || null) : home(i.fields.project))
      && (initiativeHas(type, i, items) || i.id === current) // a story, a PRD, a plan: a delivering initiative
      && ((!isDone(i) && i.fields.archived !== true) || i.id === current))
    .map((i) => ({ value: i.id, label: `${refOf(i)} · ${i.title}`, type: i.type }));
  return [...projects, ...parents];
}
/**
 * What picking `value` in the Parent field writes, given its `fields` now: a project hangs it from that project alone;
 * an item hangs it from that item, and, where its project can change (projectFree), brings the item's project along —
 * none included, where that item's type has one; none lets go of what it hangs from (an item first, keeping its
 * project; then, where it can, its project).
 */
export function parentPick(type, value, items, fields = {}, { creating = false, id = null } = {}) {
  const free = projectFree(type, { id, creating });
  if (!value) return fields.related_to && !needsParent(type) ? { related_to: null } : free && !fields.related_to && fields.project ? { project: null } : {};
  if (value.startsWith(PROJECT_PICK)) return { related_to: null, project: value.slice(PROJECT_PICK.length) };
  const parent = free ? items.find((i) => i.id === value) : null;
  const project = parent && hasField(parent.type, 'project') ? parent.fields?.project || null : undefined;
  return { related_to: value, ...(project !== undefined && project !== (fields.project || null) ? { project } : {}) };
}

/** Whether a type can be linked to others at all (parent, child, related): it carries `relations`. */
export const RELATABLE = (type) => TYPE_DEFS[type]?.relatable ?? true;

/** Whether an item of this type carries the outside tracker's reference (an initiative or a story points at a Redmine issue). */
export const hasExternalRef = (type) => !!TYPE_DEFS[type]?.fields.includes(EXTERNAL_REF.id_key);

/** Closed: one of its type's closed statuses (Done/Discarded), or, for a type closed by a field (an activity's
 *  resolution), that field set. */
export const isDone = (it) => {
  const by = TYPE_DEFS[it.type]?.closed_when;
  return by ? !!it.fields[by] : (closedOf[it.type] || CLOSED).has(it.fields.status);
};
export const isArchived = (it) => it.fields.archived === true;
export const isPlannedToday = (it) => it.fields.plan_day === today();
export const isPlannedWeek = (it, week = thisWeek()) => it.fields.plan_week === week;

/** Planned for a past day and still open → shows as "Carried over" in Today. */
export const carriedOverDay = (it) =>
  PLANNABLE.has(it.type) && !isDone(it) && !!it.fields.plan_day && it.fields.plan_day < today();

/** Planned for a past week and still open → shows as "Carried over" in Week. */
export const carriedOverWeek = (it) =>
  PLANNABLE.has(it.type) && !isDone(it) && !!it.fields.plan_week && it.fields.plan_week < thisWeek();

/** The Week view's buckets, for its list and its board alike (TSK-043): what was planned for an earlier week and is
 *  still open (shown only on this week), what is planned for the week with no day, and what is planned on each of its
 *  days. `hideDone` leaves the closed ones out; `sort` orders each bucket. → { days, carried, anytime, byDay }. */
export function weekBuckets(items, week, { hideDone = false, sort = () => 0 } = {}) {
  const days = weekDays(week);
  const shown = (i) => !(hideDone && isDone(i));
  const inWeek = items.filter((i) => shown(i) && (i.fields.plan_week === week || days.includes(i.fields.plan_day)));
  return {
    days,
    carried: week === thisWeek() ? items.filter(carriedOverWeek).sort(sort) : [],
    anytime: inWeek.filter((i) => !i.fields.plan_day).sort(sort),
    byDay: Object.fromEntries(days.map((d) => [d, inWeek.filter((i) => i.fields.plan_day === d).sort(sort)])),
  };
}

/** The Week board's day filter: `days` (Mon…Sun dates) kept to the weekdays picked, 0 = Mon … 6 = Sun; none picked = all. */
export const pickDays = (days, picked = []) => (picked.length ? days.filter((_, n) => picked.includes(n)) : days);

export const isOverdue = (it) => !isDone(it) && !!it.fields.due && it.fields.due < today();

/** Planned for a past month with no week nor day yet, and still open → "Carried over" in Month. */
export const carriedOverMonth = (it) =>
  PLANNABLE.has(it.type) && !isDone(it) && !it.fields.plan_day && !it.fields.plan_week && !!it.fields.plan_month
  && it.fields.plan_month < thisMonth();

/** Late: planned for a day, a week or a month gone by, and still open. */
export const isLate = (it) => carriedOverDay(it) || carriedOverWeek(it) || carriedOverMonth(it);

/** The Month board's columns, in order (rules.planHorizon names them). */
export const MONTH_HORIZONS = [['carried', 'Carried over'], ['today', 'Today'], ['week', 'This week'],
  ['nextweek', 'Next week'], ['month', 'Later this month']];

/**
 * Where a plannable item falls on the Month board, by what it is planned for — its day, else its week, else its month
 * (`plan_month`, kept for what has no week yet): 'today' (also a past day still open, as on Today), 'week'
 * (the rest of this week, or any other day of it), 'nextweek', 'month' (later this month: a week or day after next week whose
 * month is this one, or the month itself), 'carried' (a past week or month, still open), or null — unplanned, closed in
 * the past, or further out than this month and next week.
 */
export function planHorizon(it) {
  if (!PLANNABLE.has(it.type)) return null;
  const { plan_day: day, plan_week: week, plan_month: month } = it.fields;
  const open = !isDone(it);
  const t = today();
  if (day) {
    if (day < t) return open ? 'today' : null;
    if (day === t) return 'today';
  }
  if (day || week) {
    const w = day ? isoWeek(day) : week;
    if (w < thisWeek()) return open ? 'carried' : null;
    if (w === thisWeek()) return 'week';
    if (w === shiftWeek(thisWeek(), 1)) return 'nextweek';
    return (day ? monthOf(day) : weekMonth(w)) === thisMonth() ? 'month' : null;
  }
  if (!month) return null;
  if (month < thisMonth()) return open ? 'carried' : null;
  return month === thisMonth() ? 'month' : null;
}

/** The Month board's buckets (a key of MONTH_HORIZONS → its items), `hideDone` leaving the closed ones out, each sorted by `sort`. */
export function monthBuckets(items, { hideDone = false, sort = () => 0 } = {}) {
  const out = Object.fromEntries(MONTH_HORIZONS.map(([k]) => [k, []]));
  for (const it of items) {
    const k = planHorizon(it);
    if (k && !(hideDone && isDone(it))) out[k].push(it);
  }
  for (const k of Object.keys(out)) out[k].sort(sort);
  return out;
}

/** Planned within this month: its day, its week (by its Thursday) or the month itself, or carried over from a past month. */
export const isPlannedMonth = (it) => {
  const { plan_day: day, plan_week: week, plan_month: month } = it.fields;
  const m = day ? monthOf(day) : week ? weekMonth(week) : month;
  return m === thisMonth() || carriedOverMonth(it);
};

/** Plan filters shared by Board, Tasks, Initiatives and All items. */
export const PLAN_FILTERS = {
  any: { label: 'Any plan', test: () => true },
  today: { label: 'Today', test: (it) => it.fields.plan_day === today() || carriedOverDay(it) },
  week: { label: 'This week', test: (it) => it.fields.plan_week === thisWeek() || carriedOverWeek(it) },
  nextweek: { label: 'Next week', test: (it) => it.fields.plan_week === shiftWeek(thisWeek(), 1) },
  month: { label: 'This month', test: isPlannedMonth },
  overdue: { label: 'Overdue', test: (it) => isOverdue(it) || carriedOverDay(it) },
  unplanned: { label: 'Unplanned', test: (it) => !it.fields.plan_day && !it.fields.plan_week && !it.fields.plan_month },
};
export const planFilter = (key) => (PLAN_FILTERS[key] || PLAN_FILTERS.any).test;

/**
 * Cards in a column you order by hand (TSK-053): those placed (a number in `key`) first, in that order, then the rest as
 * `fallback` sorts them. The Board orders by `order` (within its list); Today and Week by `plan_order` (within the day,
 * or the week when no day), so moving a card on one never reorders the other.
 */
export const byManualOrder = (fallback = () => 0, key = 'plan_order') => (a, b) => {
  const x = typeof a.fields[key] === 'number' ? a.fields[key] : Infinity;
  const y = typeof b.fields[key] === 'number' ? b.fields[key] : Infinity;
  return (x === y ? 0 : x - y) || fallback(a, b);
};

/**
 * Where `item` lands when dropped at `index` among `cards` (the column as shown, the dragged card left out): the values
 * of `key` to write, [[card, value]]. Between two placed cards it takes the middle, so only it is written; when a
 * neighbour has no place yet (or there is no room left between them) the whole column is numbered in steps of 10, as shown.
 */
export function placement(item, cards, index, key = 'order') {
  const orders = cards.map((c) => c.fields[key]);
  const prev = index > 0 ? orders[index - 1] : null;
  const next = index < cards.length ? orders[index] : null;
  const gapless = (index > 0 && typeof prev !== 'number') || (index < cards.length && typeof next !== 'number')
    || (typeof prev === 'number' && typeof next === 'number' && next - prev < 1e-6);
  if (gapless) {
    const seq = [...cards.slice(0, index), item, ...cards.slice(index)];
    return seq.map((c, i) => [c, i * 10]);
  }
  const order = prev === null && next === null ? 0 : prev === null ? next - 10 : next === null ? prev + 10 : (prev + next) / 2;
  return [[item, order]];
}

/**
 * The label filter of every list that shows labels (TSK-052): `labels` picked, and how several combine — 'or' (any of
 * them, the default) or 'and' (all of them). None picked lets every item through.
 */
export const LABEL_MODES = { or: 'Any (OR)', and: 'All (AND)' };
export function labelsPass(item, labels, mode = 'or') {
  if (!labels?.length) return true;
  const have = new Set(item.fields.labels || []);
  return mode === 'and' ? labels.every((l) => have.has(l)) : labels.some((l) => have.has(l));
}

/** A saved filter from before TSK-052 held one label (`label`): it becomes a list of one. */
export const labelsOf = (saved) => (Array.isArray(saved?.labels) ? saved.labels : saved?.label ? [saved.label] : []);
