// Creating items: a form modal per type ("Add task" in a list view, the sidebar
// menu) and the sidebar "Add item" dropdown. The one-line quick add (Inbox) stays
// in quickadd.js.
//
// The form modal is the item card's dialog (itemform.js: same frame, same property
// fields in the same order), bound to the form state instead of to a saved item.
import { today } from './dates.js';
import {
  aimFields, blocksOf, breakBlocks, itemFields, kindOfBinding, modalFrame, modalTitle, parentControl, planValues, propField, quietBlanks, settingsBody, statusSelect,
} from './itemform.js';
import {
  EXTERNAL_REF, PARENT_TYPES, PLANNABLE, STRUCTURE, TYPE_DEFS, askedOnCreate, defaultOf, hasExternalRef, hasField, addMenuGroups, inSomeProject, kindDefaultTypes, leavesProject, missingOnCreate, parentLabel, onStructure, projectHas, projectOf, propsIn, propsOf, statusesOf,
} from './rules.js';
import { mdBlock } from './mdblock.js';
import { openQuickModal } from './quickadd.js';
import { createItem, state, toast } from './state.js';
import { dropdown, formActions, h, icon, openDialog, propRow, sectionLabel, select, stackGroup } from './ui.js';
import { refOf } from './shownid.js';
import { isPhone } from './phone.js';

// From the vault's structure (rules.js), in its order. Live bindings: they change with it.
export let TYPE_LABEL = {};
/** Types an item can be created as (or converted to from the inbox). */
export let TYPES = [];
/** Types the create form offers: those, and the prompts (which an inbox item is never converted to). */
export let CREATE_TYPES = [];
export let TYPE_ICON = {};
onStructure((s) => {
  TYPE_LABEL = Object.fromEntries(s.types.map((t) => [t.name, t.label]));
  TYPES = s.types.filter((t) => t.convertible).map((t) => t.name);
  CREATE_TYPES = s.types.filter((t) => t.creatable).map((t) => t.name);
  TYPE_ICON = Object.fromEntries(s.types.map((t) => [t.name, t.icon]));
});

/** What the text block of each type is called, and what it says while empty (the others: "Description"). */
export const BODY_LABEL = { activity: 'Message', prompt: 'Prompt', transcription: 'Transcript' };
const BODY_PLACEHOLDER = { activity: 'Paste the email / Slack message / comment here', prompt: 'The prompt, as it will be sent to Claude', transcription: 'Paste the transcript of the meeting',
  agent: 'Leave it empty to start from its sections: Purpose · Inputs · Outputs · Tools · Prompt · Evaluation · Runbook' };

// What is worth saying when it is known, not what every new item needs (by field key). Every property is in view; an
// optional select starts on none (itemform.js propField: b.optional), so the new file keeps its template's value until
// one is picked.
const OPTIONAL = new Set(['priority_reason', 'level_reason', 'planned', 'start', 'size', 'regime', 'origin', 'area', 'affected', 'rollback_plan',
  'written', 'author', 'local_path']);

/**
 * Form modal to create one item of `type` (the list it is opened from, or the one picked in the sidebar's "Add item"),
 * which its head's picker can still switch. `values` pre-fills fields (e.g. related_to from the initiative being
 * filtered).
 */
// The width under which a card's two columns stack (app.css, max-width: 860px).
const NARROW = typeof matchMedia === 'function' ? matchMedia('(max-width: 860px)') : { matches: false };

export function openCreateModal(type = 'task', values = {}, { onCreated } = {}) {
  let closeModal = () => {};
  const modal = document.getElementById('modal');
  const form = { type, subject: '', status: values.status || defaultOf('status', 'ToDo'), priority: values.priority || defaultOf('priority', 'Normal'), priority_reason: '',
    project: values.project || null, project_key: '', project_kind: 'simple', // a new project starts simple: initiatives and tasks
    related_to: values.related_to || null, planned: values.plan || null, start: '', due: '', area: '', objective: '', date: today(), time: '', duration: '', attendees: [], labels: [...(values.labels || [])], body: '',
    source: values.source || 'Email', from: [], session_name: values.session_name || '',
    [EXTERNAL_REF.id_key]: '', [EXTERNAL_REF.url_key]: '', ...(EXTERNAL_REF.tracker_key ? { [EXTERNAL_REF.tracker_key]: '' } : {}), local_path: '' };

  const input = (key, attrs = {}) => {
    const el = h('input', { id: `cf-${key}`, value: form[key] || '', ...attrs });
    el.addEventListener('input', () => { form[key] = el.value; recheck(); });
    return el;
  };
  // Its description, as on the item's page (mdblock.js): a box that opens the editor on a click. Made once, so what is
  // being written stays when the form is drawn again (another type, another project).
  const body = mdBlock({ fk: 'cf-body', minHeight: '220px', write: async (text) => { form.body = text; return text; } });
  // What a create was refused for, before it was sent (rules.js missingOnCreate): each field marked in red until it is
  // filled in, no toast; a value given but wrong (a key taken) says why under it. A field is never marked before a
  // create is tried.
  let invalid = new Map();
  const mark = () => {
    modal.querySelectorAll('.field-error').forEach((el) => el.remove());
    modal.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    modal.querySelectorAll('[aria-invalid]').forEach((el) => { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); });
    for (const [key, why] of invalid) {
      const control = key === 'subject' ? modal.querySelector('#cf-subject') : modal.querySelector(`[data-fk="${key}"]`);
      if (!control) continue;
      control.setAttribute('aria-invalid', 'true');
      const row = control.closest('.field');
      row?.classList.add('is-invalid');
      if (!why) continue;
      const err = h('span', { class: 'field-error', id: `cf-err-${key}` }, why);
      control.setAttribute('aria-describedby', err.id);
      if (row) row.append(err); else (control.closest('.im-title') || control).after(err);
    }
  };
  // Once marked, each change looks again at those marked only: one filled in (or fixed: a key no longer taken) lets go.
  const recheck = () => {
    if (!invalid.size) return;
    invalid = new Map(missingOnCreate(form.type, form, state.all).filter(([key]) => invalid.has(key)));
    mark();
  };
  let submitting = false;
  const submit = async () => {
    if (submitting) return;
    if (!(await body.flush())) return; // what is being typed in the description, before it is read
    const missing = missingOnCreate(form.type, form, state.all);
    if (missing.length) {
      invalid = new Map(missing);
      mark();
      const first = modal.querySelector('[aria-invalid="true"]');
      if (first) { first.scrollIntoView({ block: 'nearest' }); first.focus(); }
      return;
    }
    const subject = form.subject.trim();
    const v = {};
    const statuses = statusesOf(form.type);
    if (PLANNABLE.has(form.type)) {
      Object.assign(v, { status: statuses.includes(form.status) ? form.status : statuses[0] }, planValues(form.planned)); // `planned`: a Ticketing initiative's own `plan` is a link
      if (hasField(form.type, 'priority')) {
        v.priority = form.priority;
        if (form.priority_reason.trim()) v.priority_reason = form.priority_reason.trim();
      }
      if (form.due) v.due = form.due;
      if (form.start && hasField(form.type, 'start')) v.start = form.start;
    } else if (hasField(form.type, 'status')) {
      v.status = statuses.includes(form.status) ? form.status : statuses[0];
    }
    // A Ticketing item: its project (a project itself: its key and kind), and the fields of its own type.
    if (hasField(form.type, 'project') && form.project) v.project = form.project;
    if (form.type === 'project') Object.assign(v, { project_key: form.project_key.trim().toUpperCase(), project_kind: form.project_kind });
    for (const p of propsOf(form.type, kindOfBinding(binding))) { // not those its project's kind hides
      if (p.kind === 'readonly' || p.readonly) continue;
      const x = form[p.key];
      if (x !== undefined && x !== null && x !== '' && !(Array.isArray(x) && !x.length)) v[p.key] = x;
    }
    for (const key of ['area', 'objective']) if (hasField(form.type, key) && form[key]?.trim()) v[key] = form[key].trim();
    if (form.type === 'meeting') {
      if (form.date) v.date = form.date;
      if (form.time) v.time = form.time;
      if (form.duration) v.duration = form.duration;
      if (form.attendees.length) v.attendees = form.attendees;
    }
    if (form.type === 'activity') {
      v.source = form.source;
      if (form.from.length) v.from = form.from;
      if (form.date) v.date = form.date;
      if (form.time) v.time = form.time;
    }
    const standsAlone = form.type === 'prompt'; // a prompt has no session and no relation
    if (!standsAlone && form.session_name.trim()) v.session_name = form.session_name.trim();
    // Switching type can leave a parent this type may not hang from: drop it rather than fail.
    if (form.related_to && PARENT_TYPES[form.type].includes(state.byId.get(form.related_to)?.type)) v.related_to = form.related_to;
    if (form.labels.length) v.labels = form.labels;
    if (hasExternalRef(form.type)) {
      for (const k of [EXTERNAL_REF.id_key, EXTERNAL_REF.tracker_key, EXTERNAL_REF.url_key]) if (k && hasField(form.type, k) && form[k].trim()) v[k] = form[k].trim();
    }
    if (hasField(form.type, 'local_path') && form.local_path.trim()) v.local_path = form.local_path.trim(); // empty unless shown
    submitting = true;
    let item;
    try { item = await createItem(form.type, subject, v, form.body); } catch { submitting = false; return; } // toasted
    toast(`Created ${refOf(item) || item.title}`);
    closeModal();
    onCreated && onCreated(item);
  };

  let binding;
  const render = () => {
    const label = TYPE_LABEL[form.type];
    // A new project starts with the Types its kind starts with, on screen as it will be saved.
    if (form.type === 'project' && STRUCTURE.kind_key && !form[STRUCTURE.types_key]) form[STRUCTURE.types_key] = kindDefaultTypes(kindOfBinding({ type: 'project', get: (k) => form[k] }));
    // The types it can be: those with a place in the vault (a vault of simple projects has no stories), and once a
    // project is chosen, those its kind holds.
    const project = form.type === 'project' ? null : projectOf({ type: 'task', fields: { project: form.project } }, state.all);
    const offered = CREATE_TYPES.filter((t) => t === form.type || (inSomeProject(t, state.all) && (!project || projectHas(project, t))));
    const bodyLabel = BODY_LABEL[form.type] || 'Description';
    // The type it creates, picked in the head: the one it was opened for, and any other the vault (and the chosen
    // project) holds. A type the chosen project does not hold leaves the project to choose again (it would be refused).
    const typePick = select(offered.map((t) => [t, TYPE_LABEL[t], TYPE_ICON[t]]), form.type, (t) => {
      if (!t || t === form.type) return;
      form.type = t;
      if (project && !projectHas(project, t)) form.project = null;
      render();
      modal.querySelector('#cf-subject').focus();
    }, { class: 'type-pick', 'aria-label': 'Type', 'data-fk': 'cf-type', search: !isPhone() }); // a phone: a short list, no keyboard
    const subject = input('subject', { type: 'text', class: 'title-input', placeholder: `${label} subject`, autocomplete: 'off', 'aria-required': 'true', 'aria-label': 'Subject' });
    subject.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    // Project and a type's own fields of Relations sit in the right column, as on the item's card; a project's
    // Settings is a section of the main column, as there. What a ticket's Delivery asks for on creation (its size, its
    // regime: the rest is written later, rules.js askedOnCreate) is among its properties.
    binding = { type: form.type, live: true, creating: true, exclude: new Set(), propList: true, titleStatus: hasField(form.type, 'status'),
      optional: OPTIONAL, aside: new Set(['project', 'related_to', 'session_name', 'tab:settings', 'tab:relations']), get: (key) => form[key],
      set: (key, value) => {
        const before = kindOfBinding(binding)?.id;
        form[key] = value;
        recheck();
        if (key === 'related_to') folderEl.textContent = whereText();
        if (key === 'project') {
          folderEl.textContent = whereText();
          // The types offered follow the project (its kind and its Types): one it does not hold goes back to a task.
          const now = projectOf({ type: 'task', fields: { project: value } }, state.all);
          if (now && !projectHas(now, form.type)) { form.type = 'task'; render(); return; }
          if (now !== project) { render(); return; }
        }
        if (kindOfBinding(binding)?.id === before) return;
        // Another kind keeps other fields (and a new project, other Types): draw the form again for it.
        if (key === STRUCTURE.kind_key) form[STRUCTURE.types_key] = null;
        render();
      } };
    const hasProject = hasField(form.type, 'project') && form.type !== 'project';
    const hasParent = PARENT_TYPES[form.type].length > 0;
    // Its own link fields asked on creation (an initiative's origin, a PRD's supersedes…), as the card's Relations
    // draws them: each a group under its name with its picker, no frame. Not "+ Add relation": that needs its id.
    const relationsSection = () => {
      const props = propsIn(form.type, 'relations', kindOfBinding(binding)).filter(askedOnCreate);
      return props.length ? h('section', { class: 'panel-section relations quiet', 'aria-label': 'Relations' },
        sectionLabel('Relations'),
        ...props.map((p) => stackGroup(p.label, h('div', { class: 'rel-pick picks-quiet' }, quietBlanks(propField(binding, { ...p, label: '' })))))) : null;
    };
    const localPath = () => propRow('Local path', input('local_path', { type: 'text', placeholder: '~/work/pricing' }), { cls: 'ext-ref' });
    // As on its card (panel.js externalRef): a type without ids of its own (a Ticketing plan) has no ticket, nothing
    // there — but a project, named by its key, has its ticket and local path; one with a folder and no ticket (a Tasks
    // project, an agent) has its local path on its own.
    const ownId = TYPE_DEFS[form.type]?.has_id !== false || form.type === 'project';
    const ticketRef = ownId && hasExternalRef(form.type);
    const ownLocal = ownId && !ticketRef && hasField(form.type, 'local_path');
    // Its copy and full-screen buttons over the box's corner and no title of its own (`tabbed`, as in a page's Overview):
    // the section's names it.
    body.configure({ label: bodyLabel, tabbed: true, title: form.subject.trim() || `New ${label.toLowerCase()}`,
      emptyText: BODY_PLACEHOLDER[form.type] || 'Add a more detailed description…', placeholder: BODY_PLACEHOLDER[form.type] || 'Markdown — "- [ ] step" for a checklist' });
    if (!body.isEditing() || !body.ready()) body.render();
    // Where it lands: the vault's folder for the type, or (Ticketing) its folder inside the chosen project.
    const tdef = TYPE_DEFS[form.type] || {};
    const scoped = (STRUCTURE.project_scoped || []).includes(form.type);
    // This vault's own folders (a folder-per-type vault may move them; a Ticketing one has its layout fixed), not the default vault's.
    const vaultFolders = (state.config.vaults || []).find((v) => v.id === state.vault?.id)?.folders || {};
    // Recomputed when the project is picked: the folder depends on it.
    const whereText = () => {
      const projectDir = state.items.find((i) => i.type === 'project' && i.fields.project_key === form.project)?.path?.split('/')[0];
      // A Ticketing project is a folder of its own (its type has none); a Tasks one is a file in projects/.
      // A ticket in no project (or a sub-document of an item in none) lands in its type's folder at the vault's top.
      const atTop = !projectDir && (leavesProject(form.type) || !!form.related_to);
      const folder = form.type === 'project' && !tdef.folder ? `${form.subject.trim() || '<name>'}`
        : scoped ? (atTop ? tdef.folder : `${projectDir || '<project>'}/${tdef.folder}`) : (vaultFolders[form.type] || tdef.folder || form.type);
      return `Will be saved as a new file in ${folder}/`;
    };
    const folderEl = h('span', {}, whereText());

    // The right column, like the card of an item: its properties one per row — its fields, its Parent (its project and
    // what it hangs from, one field), the outside ticket & local or its local path —
    // then its own fields of Relations. Every one is in view.
    const ref = EXTERNAL_REF;
    const propsList = form.type === 'prompt' ? null : itemFields(binding);
    if (propsList) {
      propsList.append(...[
        // Its Parent: one field for its project and what it hangs from (itemform.js parentControl).
        ...(hasProject || hasParent ? [propRow(parentLabel(form.type), parentControl(binding), { tag: 'div' })] : []),
        ...(ticketRef ? [
          propRow(`${ref.label} ID`, input(ref.id_key, { type: 'text', placeholder: ref.id_placeholder }), { cls: 'ext-ref' }),
          ref.tracker_key && hasField(form.type, ref.tracker_key) ? propRow('Tracker', [input(ref.tracker_key, { type: 'text', placeholder: ref.tracker_placeholder || '', list: 'cf-trackers', autocomplete: 'off' }), h('datalist', { id: 'cf-trackers' }, [...new Set(state.items.map((i) => i.fields[ref.tracker_key]).filter(Boolean))].sort()
              .map((t) => h('option', { value: t })))], { cls: 'ext-ref' }) : null,
          propRow(`${ref.label} URL`, input(ref.url_key, { type: 'text', inputmode: 'url', placeholder: ref.url_placeholder }), { cls: 'ext-ref' }),
          localPath(),
        ] : ownLocal ? [localPath()] : []),
      ].filter(Boolean));
    }
    if (propsList) {
      // As on its card: one per row, no frame, in blocks (priority · dates · labels · the rest; the outside ticket last).
      const rows = [...propsList.children].filter((el) => el.classList.contains('field'));
      const ext = rows.filter((el) => el.matches('.ext-ref'));
      breakBlocks([...blocksOf(rows.filter((el) => !ext.includes(el))), ...ext.map((el) => [el, 99])]);
      quietBlanks(propsList);
    }
    const propsSection = propsList ? h('section', { class: 'panel-section prop-list prop-rows quiet', 'aria-label': 'Properties' },
      sectionLabel('Properties'), propsList) : null;
    const sideSections = form.type === 'prompt' ? [] : [propsSection, relationsSection()];
    const saveFoot = h('footer', { class: 'drawer-foot' },
      folderEl,
      h('span', { class: 'mono' }, `${TYPE_LABEL[form.type]} · next id assigned on save`));
    modal.className = form.type === 'prompt' ? 'card-modal is-create is-prompt' : 'card-modal is-create';
    modal.setAttribute('aria-label', `New ${label.toLowerCase()}`);
    modal.replaceChildren(...modalFrame({
      head: [
        h('span', { class: 'muted' }, 'New'),
        typePick,
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn icon', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => closeModal() }, icon('x', 16)),
      ],
      title: modalTitle(form.type, subject, statusSelect(binding)),
      // Its sections one under another, each under a small grey title (as PROPERTIES), none folding: a project's, an
      // initiative's Area and objective first, then a project's Settings, then the description. Its links are added
      // on its card (the Links tab), once it exists.
      main: [
        form.type === 'prompt' ? h('div', { class: 'im-props' }, itemFields({ ...binding, propList: false, titleStatus: false })) : null,
        section('Area and objective', aimFields(binding)),
        section('Settings', settingsBody(binding)), // a project's kind, types, execution, code and support due days
        form.type === 'transcription' ? h('p', { class: 'muted small' }, 'A transcription belongs to a meeting: pick the one it transcribes.') : null,
        section(bodyLabel, body.el),
      ],
      // The actions sit in a bar under both columns, so they stay in view however long the form is.
      foot: [formActions({
        lead: h('span', { class: 'muted small create-keys' }, '↵ in the subject creates · ⌘↵ anywhere · Esc cancels'),
        onCancel: () => closeModal(),
        actions: h('button', { class: 'btn primary', onclick: submit }, icon('plus', 16), `Create ${label.toLowerCase()}`),
      })],
      // The right column (sideSections). With none of them (a prompt) the form is one column, and where it will be
      // saved goes under the main column instead.
      side: sideSections.some(Boolean) ? [...sideSections, saveFoot] : [],
    }));
    if (!sideSections.some(Boolean)) modal.querySelector('.im-main').append(saveFoot);
    // Narrow (the columns stacked): the properties move under the title, as on a card; back to the side when wider.
    if (propsSection) {
      const place = () => {
        if (!propsSection.isConnected && !modal.contains(propsSection)) return;
        if (NARROW.matches) modal.querySelector('.im-main .im-title')?.after(propsSection);
        else modal.querySelector('.im-side .side-fold')?.after(propsSection);
      };
      place();
      NARROW.onchange = place;
    }
    recheck(); // drawn again (another type, another project): what is still missing, marked again
  };
  // A section of the main column: its title small and grey, never folding; null without a body.
  const section = (title, content) => (content ? h('section', { class: 'im-section create-section', 'aria-label': title }, sectionLabel(title), content) : null);

  // Its own frame (modalFrame, as the item card): the dialog only opens, traps and closes it; render() draws it.
  ({ close: closeModal } = openDialog({
    onKey: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } },
    focus: () => modal.querySelector('#cf-subject')?.focus(),
    onClose: () => body.reset(), // lets go of its description's editor (full screen, the outside-click watch)
  }));
  render();
}

/** Sidebar "Add item": the Inbox capture and the forms of the types made most often, in their groups (rules.js
 *  ADD_MENU), as wide as the button. Every other type is a pick away in the form's own type picker, its list's
 *  "+ Add" and the ⌘K palette. */
export function addMenu(anchor) {
  // Only the types this vault creates and has a place for (a vault of simple projects has no stories to add).
  const groups = addMenuGroups(CREATE_TYPES.filter((t) => inSomeProject(t, state.all)));
  const item = (t) => ({ label: TYPE_LABEL[t], icon: TYPE_ICON[t], onSelect: () => openCreateModal(t) });
  dropdown(anchor, [
    { label: 'Capture to Inbox', icon: 'inbox', kbd: 'Q', onSelect: () => openQuickModal() },
    ...groups.flatMap((g, i) => [...(i ? ['-'] : []), ...g.map(item)]),
  ], { width: Math.max(232, Math.round(anchor.getBoundingClientRect().width)) });
}
