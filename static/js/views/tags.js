// Labels and People: the tags that live on items, as tables you manage from here. Add one,
// rename it, delete it — the change reaches every item that carries it (the server rewrites
// them), so a rename shows up on every task, note, meeting and activity at once.
// A person has more than a name (tm/people.py): the public name the items show, the name Google
// Calendar gives them and their emails, which the calendar sync matches attendees by, and their
// Redmine and Slack users (either may be empty).
import {
  addLabel, addPerson, deleteLabel, deletePerson, renameLabel, state, updatePerson,
} from '../state.js';
import { trapFocus } from '../create.js';
import { LIST_PAGE, fixedColumns, paged } from '../datatable.js';
import { saveSort, savedSort } from '../prefs.js';
import { emptyState, h, icon, labelChip, personChip } from '../ui.js';

/**
 * The "Add …" dialog: the name, then cfg.fields (empty ones are left out). ↵ or ⌘↵ adds, Esc cancels.
 * cfg.create(name, values) adds with the fields; without it (or with none filled), cfg.add(name).
 */
function openAddModal(cfg) {
  const opener = document.activeElement;
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  const close = () => {
    backdrop.hidden = true; modal.className = ''; modal.replaceChildren();
    if (opener && document.contains(opener)) opener.focus();
  };
  const title = `New ${cfg.singular}`;
  const name = h('input', { type: 'text', placeholder: cfg.addPlaceholder, autocomplete: 'off', 'aria-required': 'true' });
  const inputs = (cfg.fields || []).map((f) => [f, h('input', { type: 'text', placeholder: f.placeholder || '', autocomplete: 'off' })]);
  let busy = false;
  const submit = async () => {
    const n = name.value.trim();
    if (!n) { name.focus(); return; }
    if (busy) return;
    busy = true;
    const values = Object.fromEntries(inputs.map(([f, i]) => [f.key, i.value.trim()]).filter(([, v]) => v));
    try {
      if (cfg.create && Object.keys(values).length) await cfg.create(n, values);
      else await cfg.add(n);
      close();
    } catch { busy = false; } // toasted
  };
  modal.className = 'tag-modal';
  modal.setAttribute('aria-label', title);
  modal.replaceChildren(
    h('div', { class: 'modal-head' }, h('h2', {}, icon('plus', 18), title),
      h('button', { class: 'btn icon', title: 'Close (Esc)', onclick: close }, icon('x', 16))),
    h('div', { class: 'person-fields' },
      h('label', { class: 'field' }, h('span', {}, cfg.nameLabel || 'Name'), name),
      inputs.map(([f, i]) => h('label', { class: 'field' }, h('span', {}, f.label), i))),
    h('div', { class: 'modal-foot' }, h('span', { class: 'muted small' }, '↵ adds · Esc cancels'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost', onclick: close }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: submit }, icon('plus', 15), `Add ${cfg.singular}`)));
  backdrop.hidden = false;
  backdrop.onmousedown = (e) => { if (e.target === backdrop) close(); };
  modal.onkeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); }
    if (e.key === 'Tab') trapFocus(modal, e);
  };
  setTimeout(() => name.focus(), 0);
}

/**
 * One screen: a header with the "Add …" button (a dialog), a filter and a sortable table whose rows open for editing or deleting.
 * cfg.extra: more columns after the name, [{ key, label, cell(row), text(row) }] (text: to sort and filter by).
 * cfg.fields: what the edit row edits besides the name, [{ key, label, value(row), placeholder }];
 * cfg.save(row, { name, ...fields }) saves them (without it, cfg.rename(old, new) renames).
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
      const subtitle = h('p', { class: 'muted' });
      const add = h('button', { class: 'btn primary', onclick: () => openAddModal(cfg) }, icon('plus', 16), `Add ${cfg.singular}`);
      const table = h('div', { class: 'tag-table' });
      root.replaceChildren(
        h('header', { class: 'view-head row' }, h('div', {}, h('h1', {}, cfg.title), subtitle), h('span', { class: 'spacer' }), add),
        h('div', { class: 'toolbar list-toolbar' }, filter, h('span', { class: 'spacer' })),
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
          const input = h('input', { type: 'text', value: r.name, class: 'tag-rename', 'aria-label': cfg.fields ? 'Public name' : `Rename ${r.name}`, autocomplete: 'off' });
          const inputs = (cfg.fields || []).map((f) => [f, h('input', { type: 'text', value: f.value(r), placeholder: f.placeholder || '', 'aria-label': f.label, autocomplete: 'off' })]);
          const save = async () => {
            const next = input.value.trim();
            const values = Object.fromEntries(inputs.map(([f, i]) => [f.key, i.value.trim()]));
            const changed = inputs.some(([f, i]) => i.value.trim() !== f.value(r));
            open = null;
            if (!next || (next === r.name && !changed)) { api.update(); return; }
            try {
              if (cfg.save) await cfg.save(r, { ...(next !== r.name ? { name: next } : {}), ...values });
              else await cfg.rename(r.name, next);
            } catch { /* toasted */ }
          };
          [input, ...inputs.map(([, i]) => i)].forEach((el) => el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') { e.stopPropagation(); open = null; api.update(); }
          }));
          queueMicrotask(() => { input.focus(); input.select(); });
          const note = h('span', { class: 'muted small' }, r.count ? `Used by ${r.count} item${r.count > 1 ? 's' : ''}: a new name reaches all of them.` : 'Not used by any item yet.');
          const buttons = [h('button', { class: 'btn small ghost', onclick: () => { open = null; api.update(); } }, 'Cancel'),
            h('button', { class: 'btn small primary', onclick: save }, 'Save')];
          return h('tr', { class: 'tag-edit' }, h('td', { colspan: span }, cfg.fields
            ? h('div', { class: 'person-edit' },
              h('div', { class: 'person-fields' },
                h('label', { class: 'field' }, h('span', {}, 'Public name'), input),
                inputs.map(([f, i]) => h('label', { class: 'field' }, h('span', {}, f.label), i))),
              h('div', { class: 'tag-edit-row' }, note, h('span', { class: 'spacer' }), ...buttons))
            : h('div', { class: 'tag-edit-row' }, input, note, h('span', { class: 'spacer' }), ...buttons)));
        }
        if (isOpen && open.mode === 'delete') {
          return h('tr', { class: 'tag-edit' }, h('td', { colspan: span }, h('div', { class: 'tag-edit-row' },
            cfg.chip(r.name),
            h('span', { class: 'small' }, confirmText(r)),
            h('span', { class: 'spacer' }),
            h('button', { class: 'btn small ghost', onclick: () => { open = null; api.update(); } }, 'Cancel'),
            h('button', { class: 'btn small danger', onclick: async () => {
              open = null;
              try { await cfg.remove(r.name); } catch { /* toasted */ }
            } }, icon('trash', 13), `Delete ${cfg.singular}`))));
        }
        const edit = () => { open = { name: r.name, mode: 'edit' }; api.update(); };
        return h('tr', {
          tabindex: '0', title: cfg.fields ? 'Click to edit' : 'Click to rename', 'aria-label': `${r.name}, used by ${r.count}`, onclick: edit,
          onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); edit(); } },
        },
        h('td', { class: 'c-name' }, cfg.chip(r.name)),
        extra.map((c) => h('td', { class: `c-${c.key}`, title: c.text(r) || null }, c.cell(r))),
        h('td', { class: 'num c-count', title: cfg.breakdown(r) || null }, r.count || h('span', { class: 'muted' }, '0')),
        h('td', { class: 'c-actions' },
          h('button', { class: 'btn icon', title: `${cfg.fields ? 'Edit' : 'Rename'} ${r.name}`, 'aria-label': `${cfg.fields ? 'Edit' : 'Rename'} ${r.name}`, onclick: (e) => { e.stopPropagation(); edit(); } }, icon('pencil', 15)),
          h('button', { class: 'btn icon', title: `Delete ${r.name}`, 'aria-label': `Delete ${r.name}`, onclick: (e) => { e.stopPropagation(); open = { name: r.name, mode: 'delete' }; api.update(); } }, icon('trash', 15))));
      };

      const api = {
        update() {
          const total = cfg.rows().length;
          subtitle.textContent = `${total} ${total === 1 ? cfg.singular : cfg.plural}`;
          const byCol = extra.find((c) => c.key === sort.col);
          const matching = cfg.rows()
            .filter((r) => !search || [r.name, ...extra.map((c) => c.text(r))].join(' ').toLowerCase().includes(search))
            .sort((a, b) => (sort.col === 'name' ? a.name.localeCompare(b.name) * sort.dir
              : byCol ? (byCol.text(a) || '\uffff').localeCompare(byCol.text(b) || '\uffff') * sort.dir || a.name.localeCompare(b.name)
                : (a.count - b.count) * sort.dir || a.name.localeCompare(b.name)));
          const page = paged({ key: `tags.${cfg.plural}`, rows: matching, size: LIST_PAGE, onChange: () => api.update() });
          const { rows } = page;
          table.replaceChildren(...[matching.length || search
            ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid fixed tag-grid', style: FIXED.style, 'aria-label': cfg.title }, FIXED.colgroup.cloneNode(true),
              h('thead', {}, h('tr', {}, th('name', cfg.nameLabel || cfg.singular[0].toUpperCase() + cfg.singular.slice(1)), extra.map((c) => th(c.key, c.label)), th('count', 'Items'), h('th', { scope: 'col', class: 'c-actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
              h('tbody', {}, rows.length ? rows.map(rowView) : h('tr', {}, h('td', { colspan: span, class: 'empty' }, `No ${cfg.plural} match.`)))))
            : emptyState(cfg.empty), page.pager].filter(Boolean));
        },
      };
      return api;
    },
  };
}

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

export const labels = tagScreen({
  title: 'Labels', singular: 'label', plural: 'labels', addPlaceholder: 'New label…',
  empty: 'No labels yet. Add one above, or type #tags on any item.',
  deleteEffect: 'It will be removed from all of them.',
  rows: () => state.labels,
  chip: (name) => labelChip(name),
  add: addLabel, rename: renameLabel, remove: deleteLabel,
  breakdown: (r) => Object.entries(r.types || {}).map(([t, n]) => plural(n, t)).join(' · '),
});

export const people = tagScreen({
  title: 'People', singular: 'person', plural: 'people', addPlaceholder: 'New person…',
  empty: 'No people yet. Add one above, or name them on an activity or a meeting.',
  deleteEffect: 'They will be removed from all of them.',
  rows: () => state.people,
  chip: (name) => personChip(name),
  nameLabel: 'Public name',
  filterPlaceholder: 'Filter by name, email, Redmine or Slack…',
  extra: [
    { key: 'calendar_name', label: 'Calendar name', text: (r) => r.calendar_name || '', cell: (r) => r.calendar_name || h('span', { class: 'muted' }, '—') },
    { key: 'emails', label: 'Email', text: (r) => (r.emails || []).join(', '),
      cell: (r) => ((r.emails || []).length ? h('span', { class: 'mono small' }, r.emails.join(', ')) : h('span', { class: 'muted' }, '—')) },
    { key: 'redmine', label: 'Redmine', text: (r) => r.redmine || '', cell: (r) => (r.redmine ? h('span', { class: 'mono small' }, r.redmine) : h('span', { class: 'muted' }, '—')) },
    { key: 'slack', label: 'Slack', text: (r) => r.slack || '', cell: (r) => (r.slack ? h('span', { class: 'mono small' }, r.slack) : h('span', { class: 'muted' }, '—')) },
  ],
  fields: [
    { key: 'calendar_name', label: 'Name in Google Calendar', value: (r) => r.calendar_name || '', placeholder: 'As Calendar shows it' },
    { key: 'emails', label: 'Emails', value: (r) => (r.emails || []).join(', '), placeholder: 'ana@company.com, ana@gmail.com' },
    { key: 'redmine', label: 'Redmine user', value: (r) => r.redmine || '', placeholder: 'Login or user id — empty if none' },
    { key: 'slack', label: 'Slack user', value: (r) => r.slack || '', placeholder: '@handle or member id (U…) — empty if none' },
  ],
  save: (r, values) => updatePerson(r.name, values),
  create: (name, values) => addPerson(name, values),
  add: addPerson, remove: deletePerson,
  breakdown: (r) => [r.sender ? `${plural(r.sender, 'activity')} as sender`.replace('activitys', 'activities') : '', r.attendee ? `${plural(r.attendee, 'meeting')} as attendee` : ''].filter(Boolean).join(' · '),
});
