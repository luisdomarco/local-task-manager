// Labels and Contacts: the tags that live on items, as tables you manage from here. Add one,
// rename it, delete it — the change reaches every item that carries it (the server rewrites
// them), so a rename shows up on every task, note, meeting and activity at once.
// Contacts (TSK-050) has two tabs, People and Groups (#/contacts, #/contacts/groups; #/people is the first).
// A person has more than a name (tm/people.py): the public name the items show, the name Google
// Calendar gives them and their emails, which the calendar sync matches attendees by, their
// Redmine and Slack users (either may be empty), and notes and when to use them (what an agent reads).
// A group is people reached as one: an email list, a Slack channel…, with its members, notes and when to use it.
import {
  addGroup, addLabel, addPerson, allPeople, deleteGroup, deleteLabel, deletePerson, personToGroup, renameLabel, state, updateGroup, updatePerson,
} from '../state.js';
import { LIST_PAGE, fixedColumns, paged } from '../datatable.js';
import { saveSort, savedSort } from '../prefs.js';
import { isPhone } from '../phone.js';
import { countOf, formActions, GROUP_ICON, h, icon, labelChip, openDialog, pageCount, pageEmpty, pageHead, personChip, propRow, rowAction, searchBox, select, tagInput } from '../ui.js';

/**
 * The control of one of cfg.fields, holding `value`: `kind` text (the default), textarea (several lines), select
 * (`options` [value, text]) or people (names, as chips). → { el, get() } — get() the value to save: trimmed text, or the names.
 */
function fieldInput(f, value) {
  if (f.kind === 'people') {
    let names = [...(value || [])];
    const el = tagInput(names, (list) => { names = list; }, { kind: 'person', suggest: allPeople, placeholder: f.placeholder || '' });
    return { el, get: () => names };
  }
  if (f.kind === 'select') { // the app's select, as on every form
    const el = select(f.options, value || f.options[0][0], () => {}, { class: 'small', 'aria-label': f.label, search: false });
    return { el, get: () => el.value };
  }
  const el = f.kind === 'textarea'
    ? h('textarea', { rows: 3, placeholder: f.placeholder || '', 'aria-label': f.label })
    : h('input', { type: 'text', placeholder: f.placeholder || '', 'aria-label': f.label, autocomplete: 'off' });
  el.value = value || '';
  return { el, get: () => el.value.trim() };
}
const same = (a, b) => (Array.isArray(a) || Array.isArray(b) ? (a || []).join('\n') === (b || []).join('\n') : (a || '') === (b || ''));
const isEmpty = (v) => (Array.isArray(v) ? !v.length : !v);
/** A field's label wrapper: several lines and people take the whole row. */
const fieldBox = (f, el) => propRow(f.label, el, { wide: f.kind === 'textarea' || f.kind === 'people' });
/** Enter in a one-line text field (not in a chip field, where it adds a chip) saves; ⌘↵ saves from anywhere. */
const savesOnEnter = (e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey
  || (e.target.tagName === 'INPUT' && e.target.type === 'text' && !e.target.closest('.tag-field')));

/**
 * The "Add …" dialog: the name, then cfg.fields (empty ones are left out). ↵ or ⌘↵ adds, Esc cancels.
 * cfg.create(name, values) adds with the fields; without it (or with none filled), cfg.add(name).
 */
function openAddModal(cfg) {
  let close = () => {};
  const title = `New ${cfg.singular}`;
  const name = h('input', { type: 'text', placeholder: cfg.addPlaceholder, autocomplete: 'off', 'aria-required': 'true' });
  const inputs = (cfg.fields || []).map((f) => [f, fieldInput(f, f.initial ?? '')]);
  let busy = false;
  const submit = async () => {
    const n = name.value.trim();
    if (!n) { name.focus(); return; }
    if (busy) return;
    busy = true;
    const values = Object.fromEntries(inputs.map(([f, i]) => [f.key, i.get()]).filter(([f, v]) => !isEmpty(v) && v !== f.initial));
    try {
      if (cfg.create && Object.keys(values).length) await cfg.create(n, values);
      else await cfg.add(n);
      close();
    } catch { busy = false; } // toasted
  };
  ({ close } = openDialog({
    title, ico: 'plus', cls: 'tag-modal', focus: name,
    body: h('div', { class: 'person-fields' },
      propRow(cfg.nameLabel || 'Name', name),
      inputs.map(([f, i]) => fieldBox(f, i.el))),
    foot: formActions({ lead: h('span', { class: 'muted small' }, '↵ adds · Esc cancels'), onCancel: () => close(),
      actions: h('button', { class: 'btn primary', onclick: submit }, icon('plus', 15), `Add ${cfg.singular}`) }),
    onKey: (e) => { if (savesOnEnter(e)) { e.preventDefault(); submit(); } },
  }));
}

/**
 * One screen: a header with the "Add …" button (a dialog), a filter and a sortable table whose rows open for editing or deleting.
 * cfg.extra: more columns after the name, [{ key, label, cell(row), text(row) }] (text: to sort and filter by).
 * cfg.fields: what the edit row edits besides the name, [{ key, label, value(row), placeholder, kind, options, initial }] (fieldInput);
 * cfg.save(row, { name, ...fields }) saves them (without it, cfg.rename(old, new) renames).
 * cfg.convert: { label, title, icon, run(row) } — one more button in the edit row (People: make it a group).
 * cfg.tabs(): a row of tabs under the title (Contacts: People · Groups), which carry the counts: the head has none then.
 * Without tabs the head's count is N plural.
 */
function tagScreen(cfg) {
  const extra = cfg.extra || [];
  const span = 3 + extra.length;
  // The shared column widths; the name takes what is left (less than a subject needs when there are more columns).
  const FIXED = fixedColumns([extra.length ? 'name' : 'subject', ...extra.map((c) => c.key), 'count', 'edit'].map((key) => ({ key })));
  const sort = savedSort(`tags.${cfg.plural}`, { col: 'count', dir: -1 });
  let search = '';
  let open = null; // { name, mode: 'edit' | 'delete' } — the row that is open

  return {
    mount(root) {
      // Like every list: the title and a count, the Add button on the right, the filter in the toolbar below.
      const filter = h('input', { type: 'search', placeholder: cfg.filterPlaceholder || `Filter ${cfg.plural}…`, 'aria-label': `Filter ${cfg.plural}`, 'data-filter': '' });
      filter.addEventListener('input', () => { search = filter.value.trim().toLowerCase(); api.update(); });
      const subtitle = cfg.tabs ? null : pageCount();
      const add = h('button', { class: 'btn primary', onclick: () => openAddModal(cfg) }, icon('plus', 16), `Add ${cfg.singular}`);
      const table = h('div', { class: 'tag-table' });
      root.replaceChildren(
        pageHead({ title: cfg.title, count: subtitle, action: add }),
        ...(cfg.tabs ? [cfg.tabs()] : []), // replaceChildren would write a null as the text "null"
        h('div', { class: 'view-bar' }, searchBox(filter), h('span', { class: 'spacer' })),
        table);

      const th = (col, label) => h('th', { scope: 'col', class: sort.col === col ? 'sorted' : '', 'aria-sort': sort.col === col ? (sort.dir > 0 ? 'ascending' : 'descending') : null },
        h('button', { class: 'th-btn', onclick: () => { sort.dir = sort.col === col ? -sort.dir : 1; sort.col = col; saveSort(`tags.${cfg.plural}`, sort); api.update(); } },
          label, sort.col === col ? icon(sort.dir > 0 ? 'up' : 'down', 13) : null));

      const confirmText = (r) => (r.count
        ? `Used by ${r.count} item${r.count > 1 ? 's' : ''}. ${cfg.deleteEffect}`
        : `Not used by any item.`);

      const rowView = (r) => {
        const isOpen = open && open.name === r.name;
        if (isOpen && open.mode === 'edit') {
          const input = h('input', { type: 'text', value: r.name, class: 'tag-rename', 'aria-label': cfg.fields ? cfg.nameLabel || 'Name' : `Rename ${r.name}`, autocomplete: 'off' });
          const inputs = (cfg.fields || []).map((f) => [f, fieldInput(f, f.value(r))]);
          const save = async () => {
            const next = input.value.trim();
            const values = Object.fromEntries(inputs.map(([f, i]) => [f.key, i.get()]));
            const changed = inputs.some(([f, i]) => !same(i.get(), f.value(r)));
            open = null;
            if (!next || (next === r.name && !changed)) { api.update(); return; }
            try {
              if (cfg.save) await cfg.save(r, { ...(next !== r.name ? { name: next } : {}), ...values });
              else await cfg.rename(r.name, next);
            } catch { /* toasted */ }
          };
          [input, ...inputs.map(([, i]) => i.el)].forEach((el) => el.addEventListener('keydown', (e) => {
            if (savesOnEnter(e)) { e.preventDefault(); save(); }
            if (e.key === 'Escape') { e.stopPropagation(); open = null; api.update(); }
          }));
          queueMicrotask(() => { input.focus(); input.select(); });
          const note = h('span', { class: 'muted small' }, r.count ? `Used by ${r.count} item${r.count > 1 ? 's' : ''}: a new name reaches all of them.` : 'Not used by any item yet.');
          const buttons = formActions({ small: true, onCancel: () => { open = null; api.update(); },
            lead: cfg.convert ? h('button', { class: 'btn small ghost', title: cfg.convert.title, onclick: async () => {
              open = null;
              try { await cfg.convert.run(r); } catch { /* toasted */ }
            } }, icon(cfg.convert.icon, 13), cfg.convert.label) : null,
            actions: h('button', { class: 'btn small primary', onclick: save }, 'Save') });
          return h('tr', { class: 'tag-edit' }, h('td', { colspan: span }, cfg.fields
            ? h('div', { class: 'person-edit' },
              h('div', { class: 'person-fields' },
                propRow(cfg.nameLabel || 'Name', input),
                inputs.map(([f, i]) => fieldBox(f, i.el))),
              h('div', { class: 'tag-edit-row' }, note, h('span', { class: 'spacer' }), buttons))
            : h('div', { class: 'tag-edit-row' }, input, note, h('span', { class: 'spacer' }), buttons)));
        }
        if (isOpen && open.mode === 'delete') {
          return h('tr', { class: 'tag-edit' }, h('td', { colspan: span }, formActions({ cls: 'tag-edit-row', small: true,
            lead: [cfg.chip(r.name), h('span', { class: 'small' }, confirmText(r))],
            onCancel: () => { open = null; api.update(); },
            actions: h('button', { class: 'btn small danger', onclick: async () => {
              open = null;
              try { await cfg.remove(r.name); } catch { /* toasted */ }
            } }, icon('trash', 13), `Delete ${cfg.singular}`) })));
        }
        const edit = () => { open = { name: r.name, mode: 'edit' }; api.update(); };
        return h('tr', {
          class: 'hover-host', tabindex: '0', title: cfg.fields ? 'Click to edit' : 'Click to rename', 'aria-label': `${r.name}, used by ${r.count || 0}`, onclick: edit,
          onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); edit(); } },
        },
        h('td', { class: 'c-name' }, cfg.chip(r.name)),
        extra.map((c) => h('td', { class: `c-${c.key}`, title: c.text(r) || null }, c.cell(r))),
        h('td', { class: 'num c-count', title: cfg.breakdown(r) || null }, r.count || h('span', { class: 'muted' }, '0')),
        h('td', { class: 'c-actions' }, // on hover, as a list row's
          rowAction('pencil', `${cfg.fields ? 'Edit' : 'Rename'} ${r.name}`, (e) => { e.stopPropagation(); edit(); }),
          rowAction('trash', `Delete ${r.name}`, (e) => { e.stopPropagation(); open = { name: r.name, mode: 'delete' }; api.update(); })));
      };

      const api = {
        update() {
          const total = cfg.rows().length;
          if (subtitle) subtitle.textContent = `${total} ${total === 1 ? cfg.singular : cfg.plural}`;
          const byCol = extra.find((c) => c.key === sort.col);
          const matching = cfg.rows()
            .filter((r) => !search || [r.name, ...extra.map((c) => c.text(r))].join(' ').toLowerCase().includes(search))
            .sort((a, b) => (sort.col === 'name' ? a.name.localeCompare(b.name) * sort.dir
              : byCol ? (byCol.text(a) || '\uffff').localeCompare(byCol.text(b) || '\uffff') * sort.dir || a.name.localeCompare(b.name)
                : (a.count - b.count) * sort.dir || a.name.localeCompare(b.name)));
          const page = paged({ key: `tags.${cfg.plural}`, rows: matching, size: LIST_PAGE, always: true, onChange: () => api.update() });
          const { rows } = page;
          table.replaceChildren(...[matching.length || search
            ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid fixed tag-grid', style: isPhone() ? null : FIXED.style, 'aria-label': cfg.title }, FIXED.colgroup.cloneNode(true),
              h('thead', {}, h('tr', {}, th('name', cfg.nameLabel || cfg.singular[0].toUpperCase() + cfg.singular.slice(1)), extra.map((c) => th(c.key, c.label)), th('count', 'Items'), h('th', { scope: 'col', class: 'c-actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
              h('tbody', {}, rows.length ? rows.map(rowView) : h('tr', {}, h('td', { colspan: span, class: 'empty' }, `No ${cfg.plural} match.`)))))
            : pageEmpty(cfg.empty), page.pager].filter(Boolean));
        },
      };
      return api;
    },
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const labels = tagScreen({
  title: 'Labels', singular: 'label', plural: 'labels', addPlaceholder: 'New label…',
  empty: 'No labels yet. Add one above, or type #tags on any item.',
  deleteEffect: 'It will be removed from all of them.',
  rows: () => state.labels,
  chip: (name) => labelChip(name),
  add: addLabel, rename: renameLabel, remove: deleteLabel,
  breakdown: (r) => Object.entries(r.types || {}).map(([t, n]) => plural(n, t)).join(' · '),
});

// Contacts: People and Groups (TSK-050), two tabs of one section: links, as a sidebar section's (sections.js sectionHead).
const contactTabs = (on) => () => h('nav', { class: 'tabs-bar section-tabs', 'aria-label': 'Contacts' },
  [['people', 'People', 'user', '#/contacts', state.people.length], ['groups', 'Groups', 'users', '#/contacts/groups', state.groups.length]].map(([key, text, ico, href, n]) => h('a', {
    class: `tab-btn ${key === on ? 'active' : ''}`, href, ...(key === on ? { 'aria-current': 'page' } : {}),
  }, icon(ico, 14), text, countOf(n || null, { tab: true }))));

const dash = () => h('span', { class: 'muted' }, '—');
/** Free text in a cell: its first line, the whole of it on hover (the cell's title). */
const firstLine = (text) => (text ? String(text).split('\n')[0] : dash());
// What notes and when to use them say, for a person and a group alike.
const NOTES_FIELDS = [
  { key: 'when_to_use', label: 'When to use', kind: 'textarea', value: (r) => r.when_to_use || '',
    placeholder: 'When to reach them and how: instructions an agent follows (e.g. pricing questions, by Slack; never on Fridays)' },
  { key: 'notes', label: 'Notes', kind: 'textarea', value: (r) => r.notes || '', placeholder: 'Anything worth keeping' },
];
const WHEN_COLUMN = { key: 'when_to_use', label: 'When to use', text: (r) => r.when_to_use || '', cell: (r) => firstLine(r.when_to_use) };

const peopleScreen = tagScreen({
  title: 'Contacts', singular: 'person', plural: 'people', addPlaceholder: 'New person…',
  tabs: contactTabs('people'),
  empty: 'No people yet. Add one above, or name them on an activity or a meeting.',
  deleteEffect: 'They will be removed from all of them, and from their groups.',
  rows: () => state.people,
  chip: (name) => personChip(name),
  nameLabel: 'Public name',
  filterPlaceholder: 'Filter by name, email, Redmine, Slack or when to use…',
  extra: [
    { key: 'calendar_name', label: 'Calendar name', text: (r) => r.calendar_name || '', cell: (r) => r.calendar_name || dash() },
    { key: 'emails', label: 'Email', text: (r) => (r.emails || []).join(', '),
      cell: (r) => ((r.emails || []).length ? h('span', { class: 'mono small' }, r.emails.join(', ')) : dash()) },
    { key: 'redmine', label: 'Redmine', text: (r) => r.redmine || '', cell: (r) => (r.redmine ? h('span', { class: 'mono small' }, r.redmine) : dash()) },
    { key: 'slack', label: 'Slack', text: (r) => r.slack || '', cell: (r) => (r.slack ? h('span', { class: 'mono small' }, r.slack) : dash()) },
    WHEN_COLUMN,
  ],
  fields: [
    { key: 'calendar_name', label: 'Name in Google Calendar', value: (r) => r.calendar_name || '', placeholder: 'As Calendar shows it' },
    { key: 'emails', label: 'Emails', value: (r) => (r.emails || []).join(', '), placeholder: 'ana@company.com, ana@gmail.com' },
    { key: 'redmine', label: 'Redmine user', value: (r) => r.redmine || '', placeholder: 'Login or user id — empty if none' },
    { key: 'slack', label: 'Slack user', value: (r) => r.slack || '', placeholder: '@handle or member id (U…) — empty if none' },
    ...NOTES_FIELDS,
  ],
  save: (r, values) => updatePerson(r.name, values),
  create: (name, values) => addPerson(name, values),
  add: addPerson, remove: deletePerson,
  // An email list Calendar invited becomes a person; this makes it the group it is, under the same name (its items keep it).
  convert: { label: 'Make it a group', icon: 'users', title: 'It is an email list or a channel, not a person: move it to Groups under the same name',
    run: async (r) => { await personToGroup(r.name); location.hash = '#/contacts/groups'; } },
  breakdown: (r) => usedAs(r),
});
/** Where a contact is named: "3 activities as sender · 2 meetings as attendee · watching 1 item". */
function usedAs(r) {
  return [r.sender ? `${plural(r.sender, 'activity')} as sender`.replace('activitys', 'activities') : '', r.attendee ? `${plural(r.attendee, 'meeting')} as attendee` : '', r.watcher ? `watching ${plural(r.watcher, 'item')}` : ''].filter(Boolean).join(' · ');
}

const CHANNELS = [['email', 'Email list'], ['slack', 'Slack channel'], ['other', 'Other']];
const channelName = (c) => (CHANNELS.find(([k]) => k === c) || CHANNELS[2])[1];
const groupsScreen = tagScreen({
  title: 'Contacts', singular: 'group', plural: 'groups', addPlaceholder: 'New group…',
  tabs: contactTabs('groups'),
  empty: 'No groups yet. Add one above: an email list or a Slack channel, with who is in it and when to use it.',
  deleteEffect: 'It will be removed from all of them.',
  rows: () => state.groups,
  chip: (name) => personChip(name),
  nameLabel: 'Name',
  filterPlaceholder: 'Filter by name, address, member or when to use…',
  extra: [
    { key: 'channel', label: 'Channel', text: (r) => channelName(r.channel),
      cell: (r) => h('span', { class: 'inline-icon' }, icon(GROUP_ICON[r.channel] || 'users', 14), channelName(r.channel)) },
    { key: 'address', label: 'Address', text: (r) => r.address || '', cell: (r) => (r.address ? h('span', { class: 'mono small' }, r.address) : dash()) },
    { key: 'members', label: 'Members', text: (r) => (r.members || []).join(', '),
      cell: (r) => ((r.members || []).length ? h('span', { class: 'chips-inline' }, r.members.map((m) => personChip(m))) : dash()) },
    WHEN_COLUMN,
  ],
  fields: [
    { key: 'channel', label: 'Channel', kind: 'select', options: CHANNELS, value: (r) => r.channel || 'other', initial: 'email' },
    { key: 'address', label: 'Address', value: (r) => r.address || '', placeholder: 'team@company.com or #channel' },
    { key: 'members', label: 'Members', kind: 'people', value: (r) => r.members || [], placeholder: 'Add a person' },
    ...NOTES_FIELDS,
  ],
  save: (r, values) => updateGroup(r.name, values),
  create: (name, values) => addGroup(name, values),
  add: (name) => addGroup(name, { channel: 'email' }), remove: deleteGroup,
  breakdown: (r) => usedAs(r),
});

/** The Contacts section: #/contacts (People) and #/contacts/groups. */
export const contacts = {
  mount(root, param) {
    return (param === 'groups' ? groupsScreen : peopleScreen).mount(root);
  },
};
