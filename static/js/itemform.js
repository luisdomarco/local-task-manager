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
//                           // (Relations; under Local path), and its own fields in their tab
//     aside,                // Set of keys the caller shows in its own right column instead ('project', 'related_to', 'session_name',
//                           // 'tab:<tab>' for a type's own fields of that tab: rules.js tabOf)
//   }
//
// Keys: status, priority, related_to, project, session_name, planned, due, date, time, duration, attendees,
// source, from, labels. `planned` is one of 'today' | 'tomorrow' | 'week' | 'nextweek'
// | 'YYYY-MM-DD' | 'YYYY-Www' | null.
import { addDays, isoWeek, relDay, shiftWeek, thisWeek, today } from './dates.js';
import { ACTIVITY_SOURCES, PARENT_TYPES, PLANNABLE, PRIORITIES, STRUCTURE, TYPE_DEFS, defaultOf, hasField, inProject, parentProject, splitsInitiative, statusesOf, tabOf } from './rules.js';
import { peopleOf } from './people.js';
import { cleanTime } from './worktime.js';
import { allContacts, allLabels, state } from './state.js';
import { checkSelect, h, icon, labelInput, parentOptions, select, tagInput, typeIcon } from './ui.js';

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
export const modalTitle = (type, subjectInput) =>
  h('div', { class: 'im-title' }, h('span', { class: 'type-ico' }, typeIcon(type, 16)), subjectInput);

// ── planning ─────────────────────────────────────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The plan key an item's plan_day / plan_week stand for. */
export function planKey(f) {
  if (f.plan_day) {
    if (f.plan_day === today()) return 'today';
    if (f.plan_day === addDays(today(), 1)) return 'tomorrow';
    return f.plan_day;
  }
  if (f.plan_week === thisWeek()) return 'week';
  if (f.plan_week === shiftWeek(thisWeek(), 1)) return 'nextweek';
  return f.plan_week || null;
}

/** plan_day / plan_week values for a plan key (the create form sends these). */
export function planValues(plan) {
  if (plan === 'today') return { plan_day: today(), plan_week: thisWeek() };
  if (plan === 'tomorrow') { const d = addDays(today(), 1); return { plan_day: d, plan_week: isoWeek(d) }; }
  if (plan === 'week') return { plan_week: thisWeek() };
  if (plan === 'nextweek') return { plan_week: shiftWeek(thisWeek(), 1) };
  if (plan && DAY_RE.test(plan)) return { plan_day: plan, plan_week: isoWeek(plan) };
  if (plan) return { plan_week: plan };
  return {};
}

const PLAN_CHOICES = [[null, 'Not planned', 'ban'], ['today', 'Today', 'sun'], ['tomorrow', 'Tomorrow', 'sunrise'], ['week', 'This week', 'calendar'], ['nextweek', 'Next week', 'calendarplus']];
const PICK = '__pick__';

/** Options for the Planned select; a plan outside the presets (a given day, another week) gets its own row (`short`: a day without its week). */
function planOptions(current, short = false) {
  const custom = current && !PLAN_CHOICES.some(([k]) => k === current)
    ? [[current, DAY_RE.test(current) ? (short ? relDay(current) : `${relDay(current)} · ${isoWeek(current)}`) : current, 'calendardays']] : [];
  return [...PLAN_CHOICES, ...custom, [PICK, 'Pick a date…', 'calendarsearch']];
}

/**
 * The Planned select: Today / Tomorrow / This week / Next week, or a given day through the date picker.
 * get() → the current plan key, set(key) saves a new one; the control redraws itself after each pick.
 * Shared by the item's fields and the Planned column of the tables (datatable.js), which passes `short`.
 */
export function planControl(get, set, attrs = {}, { short = false } = {}) {
  const wrap = h('span', { class: 'plan-control' });
  const render = () => {
    const current = get();
    const picker = h('input', { type: 'date', class: 'plan-date', tabindex: -1, 'aria-hidden': 'true' });
    const sel = select(planOptions(current, short), current, (v) => {
      if (v === PICK) {
        sel.value = current ?? '';
        if (picker.showPicker) picker.showPicker(); else picker.focus();
        return;
      }
      set(v);
      render();
    }, { 'aria-label': 'Planned', ...attrs });
    picker.addEventListener('change', () => { if (picker.value) { set(picker.value); render(); } });
    wrap.replaceChildren(sel, picker);
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

  const text = (key, attrs = {}) => {
    const el = h('input', { type: 'text', value: b.get(key) || '', 'data-fk': key, ...attrs });
    el.addEventListener(b.live ? 'input' : 'change', () => b.set(key, el.value));
    return el;
  };
  // Who: tags like the labels, suggested from the people and the groups of Contacts (an email list invited to a meeting).
  const person = (label, key) => h('div', { class: 'field' }, h('span', {}, label),
    tagInput(peopleOf(b.get(key)), (names) => b.set(key, names), { kind: 'person', suggest: allContacts, placeholder: 'Add a person or a group…', fk: key }));
  const date = (key) => {
    const el = h('input', { type: 'date', value: b.get(key) || '', 'data-fk': key });
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
  // planned type, after Source · From on an activity. Drawn once, wherever it comes first.
  let prioritized = false;
  const priorityFields = () => {
    if (prioritized || !hasField(type, 'priority')) return;
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

  if (type === 'project' && b.creating) { // a Ticketing project: its key names every ticket's id, so it is set once, here
    out.push(field('Key', text('project_key', { placeholder: 'HB — 2 to 4 capital letters', 'aria-label': 'Project key' })));
    out.push(field('Kind', select([['product', 'Product (with hotfixes and PRDs)'], ['system', 'System']], b.get('project_kind') || 'product',
      (v) => b.set('project_kind', v), { 'data-fk': 'project_kind' })));
  }

  // A Ticketing item's project. On an item's card or page it is the first row of the Relations tab instead, and
  // on the create form the first section of its right column (b.aside).
  if (hasField(type, 'project') && type !== 'project' && !aside('project')) out.push(field('Project', projectControl(b)));

  if (plannable) {
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

  if (plannable) {
    // Today / Tomorrow / This week / Next week, or a given day through the date picker.
    out.push(h('label', { class: 'field plan-field' }, h('span', {}, 'Planned'),
      planControl(() => b.get('planned'), (v) => b.set('planned', v), { 'data-fk': 'planned' })));
    out.push(field('Due', date('due')));
  }

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
  // create form moves the tabs it names (b.aside: 'tab:delivery', 'tab:relations') to its right column.
  for (const p of TYPE_DEFS[type]?.props || []) {
    if (b.creating && (p.kind === 'readonly' || p.readonly)) continue; // set by the app, nothing to fill in yet
    const tab = tabOf(p);
    if (tab === 'hidden' || (tab !== 'main' && aside(`tab:${tab}`))) continue;
    out.push(propField(b, p));
  }

  return h('div', { class: 'fields' }, out);
}

/** What an item's parent is called on its form: what an activity is about, the meeting a transcription transcribes. */
export const relatedLabel = (type) => (type === 'activity' ? 'About' : type === 'transcription' ? 'Meeting' : 'Related to');

/** The item it hangs from (related_to), among those of the types it may hang from (rules.js PARENT_TYPES) — and, for
 *  an item with a project (Ticketing), of that project. `types` narrows it (the Initiative field, or the rest): the
 *  field then shows the parent only when it is one of them. */
export function relatedControl(b, { types = PARENT_TYPES[b.type], label = relatedLabel(b.type), fk = 'related_to' } = {}) {
  const where = hasField(b.type, 'project') ? inProject(b.get('project')) : undefined;
  const parent = state.byId.get(b.get('related_to'));
  const current = parent ? (types.includes(parent.type) ? parent.id : null) : b.get('related_to') || null;
  return select(parentOptions(types, '— none —', { exclude: b.exclude || new Set(), current, where }),
    current, (v) => b.set('related_to', v), { 'data-fk': fk, 'aria-label': label, clearable: true });
}

/** The fields an item picks its parent in: one (Related to), or Initiative and Related to (rules.js splitsInitiative). */
export const parentFields = (type) => (!PARENT_TYPES[type].length ? []
  : splitsInitiative(type) ? [{ types: ['initiative'], label: 'Initiative', fk: 'initiative' },
    { types: PARENT_TYPES[type].filter((t) => t !== 'initiative'), label: relatedLabel(type), fk: 'related_to' }]
    : [{ types: PARENT_TYPES[type], label: relatedLabel(type), fk: 'related_to' }]);

/**
 * Project and Related to, kept to one project (Ticketing): picking what it hangs from picks that item's project too;
 * picking a project lists only what is in it, and lets go of a pick from another one. → [projectNode, …parentNodes]
 * (rules.js splitsInitiative: Initiative and Related to; none for a type that hangs from nothing).
 */
export function projectAndRelated(b) {
  const projectSlot = h('div', { class: 'field' });
  const fields = parentFields(b.type);
  const slots = fields.map(() => h('div', { class: 'field' }));
  const paint = () => {
    projectSlot.replaceChildren(projectControl({ ...b, set: (k, v) => {
      b.set(k, v);
      const parent = state.byId.get(b.get('related_to'));
      if (parent && !inProject(v)(parent)) b.set('related_to', null);
      paint();
    } }));
    fields.forEach((pf, n) => slots[n].replaceChildren(h('span', {}, pf.label), relatedControl({ ...b, set: (k, v) => {
      b.set(k, v);
      const project = parentProject(state.byId.get(v));
      if (project && project !== b.get('project')) b.set('project', project);
      paint();
    } }, pf)));
  };
  paint();
  return [projectSlot, ...slots];
}

/**
 * Where a Ticketing item lives: its project. A ticket (a type that lives in a project) lives in its project's folder
 * and its id carries the key, so it is chosen once, on creation, and read-only after; a task, a note, a meeting or an
 * activity may have none, and change it.
 */
export function projectControl(b) {
  const scoped = (STRUCTURE.project_scoped || []).includes(b.type);
  const projects = state.items.filter((i) => i.type === 'project' && i.fields.project_key);
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
const itemLabel = (i) => `${i.id || ''}${i.id ? ' · ' : ''}${i.title}`;

/** One field of a type's own (TypeDef.props): kind text · textarea · select · checks · number · date · link · links · readonly · map. */
export function propField(b, p) {
  const value = b.get(p.key);
  const fk = { 'data-fk': p.key };
  const input = (attrs) => {
    const el = h('input', { value: value ?? '', placeholder: p.placeholder || '', ...fk, ...attrs });
    el.addEventListener(b.live ? 'input' : 'change', () => b.set(p.key, el.value));
    return el;
  };
  if (p.kind === 'readonly' || (p.readonly && p.kind !== 'link')) return field(p.label, h('span', { class: 'prop-readonly' }, shown(value)));
  if (p.kind === 'select') {
    const opts = p.options.map(([v, l]) => [v || null, l || '—']);
    const current = value ?? p.default ?? opts[0][0];
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
    const el = h('textarea', { rows: 2, placeholder: p.placeholder || '', ...fk }, value ?? '');
    el.addEventListener(b.live ? 'input' : 'change', () => b.set(p.key, el.value));
    return h('label', { class: 'field span2' }, h('span', {}, p.label), el);
  }
  if (p.kind === 'number') return field(p.label, input({ type: 'number' }));
  if (p.kind === 'date') return field(p.label, input({ type: 'date' }));
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
    return h('div', { class: 'field span2 prop-map' }, h('span', {}, p.label),
      h('div', { class: 'prop-map-row' }, (p.keys || []).map((k) => {
        const el = h('input', { type: p.number ? 'number' : 'text', min: p.number ? 0 : null, value: cur[k] ?? '', placeholder: k.replace('_', ' '),
          'aria-label': `${p.label} ${k}`, 'data-fk': `${p.key}.${k}` });
        // A number map (a project's support due days) keeps numbers; blank leaves it to the server's default.
        const read = () => (p.number && el.value.trim() !== '' ? Number(el.value) : el.value.trim());
        el.addEventListener('change', () => b.set(p.key, { ...(b.get(p.key) || {}), [k]: read() }));
        // Its key over it: the placeholder alone goes once the box has a value.
        return h('label', { class: 'prop-map-cell' }, h('span', { class: 'prop-map-key' }, k.replace('_', ' ')), el);
      })));
  }
  return field(p.label, input({ type: 'text' }));
}

// ── link labels ──────────────────────────────────────────────────────────────

// The label of a link: one of the usual services, or free text under "Other".
const LINK_LABELS = ['Redmine', 'G. Drive', 'G. Sheet', 'G. Doc', 'Slack', 'Gmail'];
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
