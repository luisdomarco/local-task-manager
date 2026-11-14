// Properties (#/properties), as Obsidian's Properties view: every frontmatter key of the vault's notes — Docs, notes,
// items — with its type (props.js, from a value of it), how many notes have it and its values. A key opens to rename
// it, rename or merge one of its values, or remove it; the server rewrites only that key's line in each note
// (Store.properties). A note that keeps the key for the app — an item's field, a doc's own, what a note is
// (fileClass, type, id), its tags (Labels) — is left as it is, and the page says how many.
import { api } from '../api.js';
import { LIST_PAGE, fixedColumns, paged } from '../datatable.js';
import { isPhone } from '../phone.js';
import { pref, saveSort, savedSort, setPref } from '../prefs.js';
import { PROP_ICONS, propType } from '../props.js';
import { reload, toast } from '../state.js';
import { formActions, h, icon, labelChip, pageCount, pageEmpty, pageHead, propRow, rowAction, searchBox, seg } from '../ui.js';
import { onVaultChange } from '../vaultwatch.js';

const TYPE_LABELS = { text: 'Text', list: 'List', tags: 'Tags', number: 'Number', checkbox: 'Checkbox', date: 'Date', datetime: 'Date & time' };
const VALUES_SHOWN = 3; // in the table's Values cell; the open row lists them all
const notes = (n) => `${n} note${n === 1 ? '' : 's'}`;
const FIXED = fixedColumns([{ key: 'name' }, { key: 'proptype' }, { key: 'count' }, { key: 'values' }, { key: 'edit' }],
  { values: 200 }, { proptype: 140 });

/** What a write did, in a line: "Renamed in 4 notes · 2 keep it as the app's · 1 had that name already". */
function summary(verb, out) {
  return [out.changed ? `${verb} in ${notes(out.changed)}` : `Nothing to change`,
    out.kept ? `${out.kept} keep${out.kept === 1 ? 's' : ''} it as the app's` : '',
    out.clashed ? `${out.clashed} had that name already, or keep${out.clashed === 1 ? 's' : ''} it` : ''].filter(Boolean).join(' · ');
}

/** Whether `p` can be changed here at all: some note has it as its own (not the app's), and it is not the tags. */
const editable = (p) => p.key !== 'tags' && p.kept < p.count;

let mounted = null; // the open view's api, for onVaultChange
onVaultChange(() => mounted?.refresh());

export const properties = {
  mount(root) {
    let props = null; // GET /api/properties: { properties, notes }
    let failed = null;
    let search = '';
    let open = null; // { key, mode: 'edit' | 'delete', value: the value being renamed }
    const sort = savedSort('properties', { col: 'count', dir: -1 });
    const count = pageCount();
    const filter = h('input', { type: 'search', placeholder: 'Filter properties or values…', 'aria-label': 'Filter properties', 'data-filter': '' });
    filter.addEventListener('input', () => { search = filter.value.trim().toLowerCase(); view.update(); });
    const table = h('div', { class: 'tag-table props-table' });
    // Editable (the default) leaves out the keys only the app writes: in a Projects vault most keys are its items'
    let show = pref('properties.show') === 'all' ? 'all' : 'editable';
    const showBox = h('span', {});
    const drawShow = () => showBox.replaceChildren(seg([['editable', 'Editable'], ['all', 'All']], show,
      (v) => { show = v; setPref('properties.show', v); drawShow(); view.update(); }, { aria: 'Which properties' }));
    drawShow();
    root.replaceChildren(pageHead({ title: 'Properties', count }), h('div', { class: 'view-bar' }, searchBox(filter), h('span', { class: 'spacer' }), showBox), table);

    const load = () => api.properties().then((r) => { props = r; failed = null; }, (e) => { failed = e.message; }).then(() => view.update());

    // A write: the list as the server has it now, a line saying what it did; the items again when notes changed (an
    // item's own keys are part of its card).
    const run = async (verb, call) => {
      open = null;
      try {
        const out = await call();
        props = out;
        toast(summary(verb, out));
        if (out.changed) reload();
      } catch (e) { toast(e.message, true); }
      view.update();
    };

    const th = (col, label, cls = '') => h('th', { scope: 'col', class: `${cls} ${sort.col === col ? 'sorted' : ''}`.trim(), 'aria-sort': sort.col === col ? (sort.dir > 0 ? 'ascending' : 'descending') : null },
      h('button', { class: 'th-btn', onclick: () => { sort.dir = sort.col === col ? -sort.dir : (col === 'count' ? -1 : 1); sort.col = col; saveSort('properties', sort); view.update(); } },
        label, sort.col === col ? icon(sort.dir > 0 ? 'up' : 'down', 13) : null));

    const typeOf = (p) => propType(p.key, p.sample ?? '');
    const valueChip = (p, v) => (typeOf(p) === 'tags' ? labelChip(v.value.replace(/^#/, '')) : h('span', { class: 'chip' }, v.value));
    const where = (p) => (p.kept ? `${notes(p.count)} · the app keeps it in ${p.kept}` : notes(p.count));

    // The open row: the name to rename, every value (each renamed on its own, onto another to merge them), Delete.
    const editRow = (p) => {
      const close = () => { open = null; view.update(); };
      if (!editable(p)) {
        return h('div', { class: 'props-edit' }, h('p', { class: 'muted small' }, p.key === 'tags'
          ? ['Tags are labels: rename or delete one in ', h('a', { href: '#/labels' }, 'Labels'), '.']
          : 'The app keeps it in every note that has it — an item\'s field, a doc\'s own, or what a note is: change it on the item or the doc.'),
        formActions({ small: true, onCancel: close, cancelLabel: 'Close' }));
      }
      const name = h('input', { type: 'text', value: p.key, class: 'tag-rename', 'aria-label': `Rename ${p.key}`, autocomplete: 'off', spellcheck: 'false' });
      const rename = () => {
        const next = name.value.trim();
        if (!next || next === p.key) { close(); return; }
        run('Renamed', () => api.renameProperty(p.key, next));
      };
      name.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); rename(); }
        if (e.key === 'Escape') { e.stopPropagation(); close(); }
      });
      if (!open.value) queueMicrotask(() => { name.focus(); name.select(); });
      const valueRow = (v) => {
        if (open.value === v.value) {
          const input = h('input', { type: 'text', value: v.value, class: 'tag-rename', 'aria-label': `Rename the value ${v.value}`, autocomplete: 'off' });
          const save = () => {
            const next = input.value.trim();
            if (!next || next === v.value) { open = { ...open, value: null }; view.update(); return; }
            run('Changed', () => api.renamePropertyValue(p.key, v.value, next));
          };
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') { e.stopPropagation(); open = { ...open, value: null }; view.update(); }
          });
          queueMicrotask(() => { input.focus(); input.select(); });
          return h('li', { class: 'props-value editing' }, input, h('span', { class: 'muted small' }, `${notes(v.count)}: onto a value they have already, the two merge`),
            formActions({ small: true, onCancel: () => { open = { ...open, value: null }; view.update(); }, actions: h('button', { class: 'btn small primary', onclick: save }, 'Save') }));
        }
        const edit = () => { open = { ...open, value: v.value }; view.update(); };
        return h('li', { class: 'props-value hover-host', tabindex: '0', title: 'Click to rename this value in every note', onclick: edit,
          onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); edit(); } } },
        valueChip(p, v), h('span', { class: 'muted small num' }, String(v.count)),
        rowAction('pencil', `Rename the value ${v.value}`, (e) => { e.stopPropagation(); edit(); }));
      };
      return h('div', { class: 'props-edit' },
        h('div', { class: 'fields prop-rows' },
          propRow('Name', h('div', { class: 'tag-edit-row' }, name, h('button', { class: 'btn small primary', onclick: rename }, 'Rename')),
            { tag: 'div', help: p.kept ? `In ${notes(p.count - p.kept)}; the ${p.kept} that keep it as the app's stay as they are.` : `In ${notes(p.count)}.` }),
          propRow(`Values · ${p.values.length + p.more}`, p.values.length
            ? h('ul', { class: 'props-values' }, p.values.map(valueRow), p.more ? h('li', { class: 'muted small' }, `…and ${p.more} more`) : null)
            : h('span', { class: 'muted small' }, 'None: every note leaves it empty.'), { tag: 'div' })),
        formActions({ small: true, onCancel: close, cancelLabel: 'Close',
          lead: h('button', { class: 'btn small ghost danger-text', onclick: () => { open = { key: p.key, mode: 'delete' }; view.update(); } }, icon('trash', 13), 'Delete property') }));
    };

    const deleteRow = (p) => formActions({ cls: 'tag-edit-row', small: true,
      lead: [h('span', { class: 'prop-key' }, icon(PROP_ICONS[typeOf(p)], 14), h('span', {}, p.key)),
        h('span', { class: 'small' }, `Remove it from ${notes(p.count - p.kept)}${p.kept ? ` (${p.kept} keep it as the app's)` : ''}? It cannot be undone here.`)],
      onCancel: () => { open = null; view.update(); },
      actions: h('button', { class: 'btn small danger', onclick: () => run('Removed', () => api.deleteProperty(p.key)) }, icon('trash', 13), 'Delete property') });

    const rowView = (p) => {
      const span = 5;
      if (open && open.key === p.key) {
        return h('tr', { class: 'tag-edit' }, h('td', { colspan: span }, open.mode === 'delete' ? deleteRow(p) : editRow(p)));
      }
      const type = typeOf(p);
      const edit = () => { open = { key: p.key, mode: 'edit', value: null }; view.update(); };
      const shown = p.values.slice(0, VALUES_SHOWN);
      const rest = p.values.length + p.more - shown.length;
      return h('tr', { class: 'hover-host', tabindex: '0', title: editable(p) ? 'Click to rename it or its values' : 'Kept by the app', 'aria-label': `${p.key}, ${where(p)}`, onclick: edit,
        onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); edit(); } } },
      h('td', { class: 'c-name' }, h('span', { class: 'prop-key', title: p.key }, icon(PROP_ICONS[type], 14), h('span', {}, p.key)),
        editable(p) ? null : h('span', { class: 'muted small props-kept', title: 'The app keeps it: an item\'s field, a doc\'s own, what a note is, or its tags' }, icon('lock', 12))),
      h('td', { class: 'c-proptype muted' }, TYPE_LABELS[type]),
      h('td', { class: 'num c-count', title: where(p) }, show === 'all' ? p.count : p.count - p.kept), // Editable: where it can change
      h('td', { class: 'c-values' }, h('span', { class: 'chips-inline' }, shown.map((v) => valueChip(p, v)), rest > 0 ? h('span', { class: 'muted small' }, `+${rest}`) : null)),
      h('td', { class: 'c-actions' }, editable(p) ? [
        rowAction('pencil', `Rename ${p.key}`, (e) => { e.stopPropagation(); edit(); }),
        rowAction('trash', `Delete ${p.key}`, (e) => { e.stopPropagation(); open = { key: p.key, mode: 'delete' }; view.update(); })] : null));
    };

    const view = {
      refresh: load,
      update() {
        if (failed) { table.replaceChildren(pageEmpty(`Could not read the properties (${failed}).`)); return; }
        if (!props) { table.replaceChildren(pageEmpty('Reading the notes…')); return; }
        const all = props.properties;
        count.textContent = `${all.length} in ${notes(props.notes)}`;
        const shown = (p) => (show === 'all' ? p.count : p.count - p.kept);
        const matching = all
          .filter((p) => show === 'all' || editable(p))
          .filter((p) => !search || p.key.toLowerCase().includes(search) || p.values.some((v) => v.value.toLowerCase().includes(search)))
          .sort((a, b) => (sort.col === 'name' ? a.key.localeCompare(b.key) * sort.dir
            : sort.col === 'proptype' ? TYPE_LABELS[typeOf(a)].localeCompare(TYPE_LABELS[typeOf(b)]) * sort.dir || a.key.localeCompare(b.key)
              : (shown(a) - shown(b)) * sort.dir || a.key.localeCompare(b.key)));
        const page = paged({ key: 'properties', rows: matching, size: LIST_PAGE, always: true, onChange: () => view.update() });
        table.replaceChildren(...[matching.length || search
          ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid fixed tag-grid', style: isPhone() ? null : FIXED.style, 'aria-label': 'Properties' }, FIXED.colgroup.cloneNode(true),
            h('thead', {}, h('tr', {}, th('name', 'Property'), th('proptype', 'Type'), th('count', 'Notes', 'num'), h('th', { scope: 'col' }, 'Values'), h('th', { scope: 'col', class: 'c-actions' }))),
            h('tbody', {}, page.rows.length ? page.rows.map(rowView) : h('tr', {}, h('td', { colspan: 5, class: 'empty' }, 'No properties match.')))))
          : pageEmpty(all.length ? 'Every property here is the app\'s: All lists them.' : 'No note has properties yet: a note\'s frontmatter (the --- lines at its top) is where they go.'), page.pager].filter(Boolean));
      },
      unmount() { if (mounted === view) mounted = null; },
    };
    mounted = view;
    load();
    return view;
  },
};
