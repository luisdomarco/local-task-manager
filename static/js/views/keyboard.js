// The keys, as Settings → Keyboard and the ? dialog show them: keymap.js keymap(), a group per section and a key per
// row (its keys as `kbd`, what it does), and a search over both. The same list in both places.
import { keymap } from '../keymap.js';
import { h, openDialog, propRow } from '../ui.js';

/** The keys drawn as kbd chips: "⌘↵ · ⌘S" two keys, "g t" one after the other. */
const keysEl = (text) => h('span', { class: 'keys' }, ...text.split(' · ').flatMap((alt, i) => [
  i ? h('span', { class: 'muted small' }, ' or ') : null,
  ...alt.split(' ').map((k) => h('kbd', {}, k)),
]).filter(Boolean));

/** → { el, search }: the groups under a search; typing hides the rows (and the groups) that do not match. */
export function keyboardPanel({ autofocus = false } = {}) {
  const search = h('input', { type: 'search', class: 'keys-search', placeholder: 'Search keys', 'aria-label': 'Search keys', 'data-filter': '' });
  const groups = keymap().map(({ group, about, rows }) => {
    const items = rows.map(([keys, label]) => {
      const row = propRow(keysEl(keys), h('span', {}, label), { tag: 'div', cls: 'key-row' });
      row.dataset.text = `${group} ${keys} ${label}`.toLowerCase();
      return row;
    });
    const sec = h('section', { class: 'group keys-group' },
      h('header', {}, h('h3', {}, group)),
      about ? h('p', { class: 'muted small' }, about) : null,
      h('div', { class: 'fields prop-rows' }, ...items));
    return { sec, items };
  });
  const none = h('p', { class: 'muted', hidden: true }, 'No key does that.');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const { sec, items } of groups) {
      let here = 0;
      for (const row of items) { const on = !q || row.dataset.text.includes(q); row.hidden = !on; here += on; }
      sec.hidden = !here;
      shown += here;
    }
    none.hidden = shown > 0;
  });
  if (autofocus) requestAnimationFrame(() => search.focus());
  return { el: h('div', { class: 'keys-panel' }, search, ...groups.map((g) => g.sec), none), search };
}

/** The ? dialog: the same list, over any page. */
export function openKeys() {
  const { el, search } = keyboardPanel();
  openDialog({ title: 'Keyboard', ico: 'slash', cls: 'keys-modal', body: h('div', { class: 'keys-body' }, el), focus: search });
}
