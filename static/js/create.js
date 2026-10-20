// Creating items: a form modal per type ("Add task" in a list view, the sidebar
// menu) and the sidebar "Add item" dropdown. The one-line quick add (Inbox) stays
// in quickadd.js.
//
// The form modal is the item card's dialog (itemform.js: same frame, same property
// fields in the same order), bound to the form state instead of to a saved item.
import { today } from './dates.js';
import { itemFields, linkLabelControl, modalFrame, modalTitle, planValues, projectAndRelated, propField, relatedControl, relatedLabel } from './itemform.js';
import {
  EXTERNAL_REF, PARENT_TYPES, PLANNABLE, STRUCTURE, TYPE_DEFS, defaultOf, hasExternalRef, hasField, onStructure, propsIn, statusesOf,
} from './rules.js';
import { mdEditor } from './mdeditor.js';
import { openQuickModal } from './quickadd.js';
import { createItem, state, toast } from './state.js';
import { dropdown, h, icon, typeIcon } from './ui.js';

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

/** What the text block of each type is called, and its placeholder (the others are "Description"). */
export const BODY_LABEL = { activity: 'Message', prompt: 'Prompt', transcription: 'Transcript' };
const BODY_PLACEHOLDER = { activity: 'Paste the email / Slack message / comment here', prompt: 'The prompt, as it will be sent to Claude', transcription: 'Paste the transcript of the meeting',
  agent: 'Leave it empty to start from its sections: Purpose · Inputs · Outputs · Tools · Prompt · Evaluation · Runbook' };

let lastFocus = null;

function closeModal() {
  const backdrop = document.getElementById('modal-backdrop');
  backdrop.hidden = true;
  const modal = document.getElementById('modal');
  modal.className = '';
  modal.replaceChildren();
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

/**
 * Form modal to create one item. `values` pre-fills fields (e.g. related_to from
 * the initiative being filtered); the type can still be switched in the form — unless `fixedType`: opened from a
 * list's own Add button, it offers that list's type only.
 */
export function openCreateModal(type = 'task', values = {}, { onCreated, fixedType = false } = {}) {
  lastFocus = document.activeElement;
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  const form = { type, subject: '', status: values.status || defaultOf('status', 'ToDo'), priority: values.priority || defaultOf('priority', 'Normal'), priority_reason: '',
    project: values.project || null, project_key: '', project_kind: 'product',
    related_to: values.related_to || null, planned: values.plan || null, due: '', date: today(), time: '', duration: '', attendees: [], labels: [...(values.labels || [])], url: '', body: '',
    source: values.source || 'Email', from: [], session_name: values.session_name || '', url_label: '',
    [EXTERNAL_REF.id_key]: '', [EXTERNAL_REF.url_key]: '', local_path: '' };

  const input = (key, attrs = {}) => {
    const el = h('input', { id: `cf-${key}`, value: form[key] || '', ...attrs });
    el.addEventListener('input', () => { form[key] = el.value; });
    return el;
  };
  let submitting = false;
  const submit = async () => {
    if (submitting) return;
    const subject = form.subject.trim();
    if (!subject) { modal.querySelector('#cf-subject').focus(); toast('A subject is required', true); return; }
    const v = {};
    const statuses = statusesOf(form.type);
    if (PLANNABLE.has(form.type)) {
      Object.assign(v, { status: statuses.includes(form.status) ? form.status : statuses[0] }, planValues(form.planned)); // `planned`: a Ticketing initiative's own `plan` is a link
      if (hasField(form.type, 'priority')) {
        v.priority = form.priority;
        if (form.priority_reason.trim()) v.priority_reason = form.priority_reason.trim();
      }
      if (form.due) v.due = form.due;
    } else if (hasField(form.type, 'status')) {
      v.status = statuses.includes(form.status) ? form.status : statuses[0];
    }
    // A Ticketing item: its project (a project itself: its key and kind), and the fields of its own type.
    if (hasField(form.type, 'project') && form.project) v.project = form.project;
    if (form.type === 'project') Object.assign(v, { project_key: form.project_key.trim().toUpperCase(), project_kind: form.project_kind });
    for (const p of TYPE_DEFS[form.type]?.props || []) {
      if (p.kind === 'readonly' || p.readonly) continue;
      const x = form[p.key];
      if (x !== undefined && x !== null && x !== '' && !(Array.isArray(x) && !x.length)) v[p.key] = x;
    }
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
    const standsAlone = form.type === 'prompt'; // a prompt has no session, no links and no relation
    if (!standsAlone && form.session_name.trim()) v.session_name = form.session_name.trim();
    // Switching type can leave a parent this type may not hang from: drop it rather than fail.
    if (form.related_to && PARENT_TYPES[form.type].includes(state.byId.get(form.related_to)?.type)) v.related_to = form.related_to;
    if (form.labels.length) v.labels = form.labels;
    if (!standsAlone && form.url.trim()) { v.url = form.url.trim(); if (form.url_label) v.url_label = form.url_label; }
    if (hasExternalRef(form.type)) {
      for (const k of [EXTERNAL_REF.id_key, EXTERNAL_REF.url_key, 'local_path']) if (form[k].trim()) v[k] = form[k].trim();
    }
    submitting = true;
    let item;
    try { item = await createItem(form.type, subject, v, form.body); } catch { submitting = false; return; } // toasted
    toast(`Created ${item.id || item.title}`);
    closeModal();
    onCreated && onCreated(item);
  };

  const render = () => {
    const label = TYPE_LABEL[form.type];
    const bodyLabel = BODY_LABEL[form.type] || 'Description';
    const typeSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Type' }, (fixedType ? [type] : CREATE_TYPES).map((t) => h('button', {
      class: `btn small ${form.type === t ? 'active' : ''}`, role: 'radio', 'aria-checked': String(form.type === t), 'aria-label': TYPE_LABEL[t], title: TYPE_LABEL[t],
      onclick: () => { form.type = t; render(); modal.querySelector('#cf-subject').focus(); },
    }, typeIcon(t, 14), h('span', { class: 'seg-label' }, TYPE_LABEL[t]))));
    const subject = input('subject', { type: 'text', class: 'title-input', placeholder: `${label} subject`, autocomplete: 'off', 'aria-required': 'true', 'aria-label': 'Subject' });
    subject.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    const [mainCombo, mainCustom] = linkLabelControl(form.url_label, (v) => { form.url_label = v; });
    mainCustom.addEventListener('input', () => { form.url_label = mainCustom.value.trim(); }); // ⌘↵ may submit before the field is committed
    // Project, Session, and a type's own fields of Delivery and Relations sit in the right column, as on the item's
    // card (Relations; under Local path; their tabs).
    const binding = { type: form.type, live: true, creating: true, exclude: new Set(),
      aside: new Set(['project', 'related_to', 'session_name', 'tab:delivery', 'tab:relations']), get: (key) => form[key],
      set: (key, value) => { form[key] = value; if (key === 'project') folderEl.textContent = whereText(); } };
    const hasProject = hasField(form.type, 'project') && form.type !== 'project';
    const hasParent = PARENT_TYPES[form.type].length > 0;
    // A type's own fields of one side tab, as a section of the right column (none: no section). Read-only ones
    // (a support ticket's Promoted to) are set by the app later: nothing to fill in yet.
    const tabSection = (tab, title, ico) => {
      const props = propsIn(form.type, tab).filter((p) => p.kind !== 'readonly' && !p.readonly);
      return props.length ? h('section', { class: 'panel-section' }, h('h4', {}, ico ? icon(ico, 14) : null, title),
        h('div', { class: 'fields' }, props.map((p) => propField(binding, p)))) : null;
    };
    const session = h('label', { class: 'field' }, h('span', {}, 'Session'), input('session_name', { type: 'text', placeholder: 'Claude session handling this' }));
    const body = mdEditor({
      value: form.body, minHeight: '220px', fk: 'cf-body', label: bodyLabel, placeholder: BODY_PLACEHOLDER[form.type] || 'Markdown — "- [ ] step" for a checklist',
      onInput: (v) => { form.body = v; },
    }).el;
    // Where it lands: the vault's folder for the type, or (Ticketing) its folder inside the chosen project.
    const tdef = TYPE_DEFS[form.type] || {};
    const scoped = (STRUCTURE.project_scoped || []).includes(form.type);
    // This vault's own folders (a folder-per-type vault may move them; a Ticketing one has its layout fixed), not the default vault's.
    const vaultFolders = (state.config.vaults || []).find((v) => v.id === state.vault?.id)?.folders || {};
    // Recomputed when the project is picked: the folder depends on it.
    const whereText = () => {
      const projectDir = state.items.find((i) => i.type === 'project' && i.fields.project_key === form.project)?.path?.split('/')[0];
      const folder = form.type === 'project' ? `${form.subject.trim() || '<name>'}`
        : scoped ? `${projectDir || '<project>'}/${tdef.folder}` : (vaultFolders[form.type] || tdef.folder || form.type);
      return `Will be saved as a new file in ${folder}/`;
    };
    const folderEl = h('span', {}, whereText());

    modal.className = form.type === 'prompt' ? 'card-modal is-prompt' : 'card-modal';
    modal.setAttribute('aria-label', `New ${label.toLowerCase()}`);
    modal.replaceChildren(...modalFrame({
      head: [
        typeSeg,
        h('span', { class: 'mono muted' }, 'new'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn icon', title: 'Close (Esc)', onclick: closeModal }, icon('x', 16)),
      ],
      title: modalTitle(form.type, subject),
      main: [
        h('div', { class: 'im-props' }, itemFields(binding)),
        form.type === 'transcription' ? h('p', { class: 'muted small' }, 'A transcription belongs to a meeting: pick the one it transcribes.') : null,
        h('section', { class: 'im-section' },
          h('div', { class: 'body-tabs' }, h('h4', {}, icon('text', 15), bodyLabel)),
          body),
      ],
      // The actions sit in a bar under both columns, so they stay in view however long the form is.
      foot: [
        h('span', { class: 'muted small' }, '↵ in the subject creates · ⌘↵ anywhere · Esc cancels'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: submit }, icon('plus', 16), `Create ${label.toLowerCase()}`),
      ],
      // Like the card of an item, in the right column: its project (Ticketing: where it lives, chosen here for a
      // ticket) and what it is related to, the outside tracker & local (Redmine in the folder-per-type structure: initiatives and stories) with the session under
      // Local path (alone where there is none), its own fields of Delivery and Relations (Ticketing), then Links.
      side: form.type === 'prompt' ? [] : [ // a prompt has nothing for a side column: it is one column
        // Where it lives and what it hangs from: its project (Ticketing), then the item it is related to.
        hasProject ? h('section', { class: 'panel-section' },
          h('h4', {}, icon('folder', 14), 'Project'),
          ...projectAndRelated(binding))
          : hasParent ? h('section', { class: 'panel-section' }, h('h4', {}, icon('up', 14), relatedLabel(form.type)),
            h('div', { class: 'field' }, relatedControl(binding))) : null,
        hasExternalRef(form.type) ? h('section', { class: 'panel-section' },
          h('h4', {}, `${EXTERNAL_REF.label} & local`),
          h('label', { class: 'field' }, h('span', {}, `${EXTERNAL_REF.label} ID`), input(EXTERNAL_REF.id_key, { type: 'text', placeholder: EXTERNAL_REF.id_placeholder })),
          h('label', { class: 'field' }, h('span', {}, `${EXTERNAL_REF.label} URL`), input(EXTERNAL_REF.url_key, { type: 'text', inputmode: 'url', placeholder: EXTERNAL_REF.url_placeholder })),
          h('label', { class: 'field' }, h('span', {}, 'Local path'), input('local_path', { type: 'text', placeholder: '~/work/pricing' })),
          session)
          : h('section', { class: 'panel-section' }, h('h4', {}, 'Session'), session),
        tabSection('delivery', 'Delivery', null),
        tabSection('relations', 'Relations', 'up'),
        h('section', { class: 'panel-section' },
          h('h4', {}, icon('link', 14), 'Links'),
          h('div', { class: 'link-item' },
            h('div', { class: 'link-row main' }, mainCombo,
              input('url', { type: 'text', inputmode: 'url', placeholder: form.type === 'activity' ? 'Link to the message' : 'dominio.com or https://…' }),
              h('span', { class: 'link-main-mark', title: 'Main link', 'aria-label': 'Main link', role: 'img' }, icon('star', 14))))),
        h('footer', { class: 'drawer-foot' },
          folderEl,
          h('span', { class: 'mono' }, `${TYPE_LABEL[form.type]} · next id assigned on save`)),
      ],
    }));
    showType();
  };
  // The types scroll sideways when they do not fit (app.css): keep the picked one in view, also after switching.
  const showType = () => modal.querySelector('.im-head .seg .active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  render();
  backdrop.hidden = false;
  backdrop.onmousedown = (e) => { if (e.target === backdrop) closeModal(); };
  modal.onkeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeModal(); } // only the top layer
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    if (e.key === 'Tab') trapFocus(modal, e);
  };
  setTimeout(() => { showType(); modal.querySelector('#cf-subject').focus(); }, 0); // shown now: it can scroll
}

/** Keep Tab inside a dialog. */
export function trapFocus(root, e) {
  const els = [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!els.length) return;
  const first = els[0]; const last = els[els.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** Sidebar "Add item": Inbox capture or a form for each type. */
export function addMenu(anchor) {
  dropdown(anchor, [
    { label: 'Capture to Inbox', icon: 'inbox', kbd: 'Q', onSelect: () => openQuickModal() },
    '-',
    { heading: 'New' },
    ...CREATE_TYPES.map((t) => ({ label: TYPE_LABEL[t], icon: TYPE_ICON[t], onSelect: () => openCreateModal(t) })),
  ], { width: 232 });
}
