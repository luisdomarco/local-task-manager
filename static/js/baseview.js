// An Obsidian base (a .base file) drawn: its views as a row of tabs, the one shown as a table, cards or a list, the
// rows the server works out (GET /api/bases, tm/bases.py). A click on a column's head sorts it; a click on a note's
// property cell edits it (Store.set_note_property writes that key of that note, as Obsidian does); what the app does
// not support is said, never guessed. Opened in Docs or the Explorer (views/files.js) and embedded with ![[x.base]] or
// ![[x.base#View]] (renderBases, after any vault Markdown is drawn).
import { api, fileUrl } from './api.js';
import { cellType, columnKey, editText, isNameColumn, nextSort, parseCell, shownName, sortedIndexes, summaryText } from './bases.js';
import { fileTree } from './explorer.js';
import { IMAGE_FILE, filesHref, wikiTarget } from './filetree.js';
import { propRows } from './props.js';
import { propValue } from './propview.js';
import { toast } from './state.js';
import { foldHead, h, icon, loadingLine, emptyLine, seg } from './ui.js';

const SHOWN_MAX = 500; // rows drawn at once; a "Show more" draws the next ones

/** A cell's value as nodes: a note's property as its header draws it (propview.js), the row's name as a link. */
function cellNode(col, value, row, { href }) {
  if (isNameColumn(col)) {
    const text = col.id === 'file.path' ? row.path : shownName(row.path);
    return h('a', { class: 'base-name', href: href(row.path), title: row.path }, text);
  }
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return null;
  const [r] = propRows([[columnKey(col), Array.isArray(value) ? value.map(String) : String(value)]]);
  if (!r) return null;
  if (typeof value === 'boolean') r.value = value;
  return h('span', { class: `prop-value t-${r.type}` }, propValue(r, { self: row.path, href }));
}

/** A card's picture: a web address, a [[picture]] or a path of the vault (a colour like #335 is a swatch). */
function cardImage(value) {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  const s = String(v).trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return h('div', { class: 'base-card-img', style: `background:${s}` });
  let src = null;
  if (/^https?:\/\//i.test(s)) src = s;
  else {
    const target = s.replace(/^!?\[\[|\]\]$/g, '').split('|')[0];
    const path = wikiTarget(fileTree(), target);
    if (path && IMAGE_FILE.test(path)) src = fileUrl(path);
  }
  return src ? h('div', { class: 'base-card-img' }, h('img', { src, alt: '', loading: 'lazy' })) : null;
}

/**
 * A base's view in `el`. `path` the .base file, `view` the view to open (its name; the first when none), `self` the
 * note that embeds it (`this` in its formulas), `href(path, heading)` where a file opens, `compact` for an embed (its
 * head names the base and opens it), `onView(name)` when a tab is picked. → { refresh() }.
 */
export function mountBase(el, { path, view = null, self = null, href = filesHref, compact = false, onView = null }) {
  let data = null;
  let failed = null;
  let current = view;
  let sort = null;             // { col, dir } a click on a head picked: the page's alone, never written
  let editing = null;          // { row: path, col: index }
  let shown = SHOWN_MAX;
  const folded = new Set();
  el.classList.add('base-view');
  if (compact) el.classList.add('base-embed');

  const load = () => api.base(path, current, self).then((out) => { data = out; failed = null; render(); },
    (e) => { failed = e.message; render(); });

  const save = (row, col, value) => {
    editing = null;
    const key = col.id.slice(5);
    api.baseCell(row.path, key, value).then(() => load(), (e) => { toast(e.message, true); render(); });
  };

  /** A cell being edited: a box for true/false, else a text field (Enter or leaving it saves; Esc goes back). */
  const editor = (row, col, value) => {
    const type = cellType(col, data.rows);
    if (type === 'checkbox') {
      const box = h('input', { type: 'checkbox', checked: value === true || value === 'true', 'aria-label': col.label,
        onchange: () => save(row, col, box.checked) });
      requestAnimationFrame(() => box.focus());
      return box;
    }
    let done = false;
    // Enter or leaving the field writes it (once); Esc goes back. Enter commits itself: a blur may never come (a window
    // without the focus fires none).
    const commit = () => {
      if (done) return;
      done = true;
      const next = parseCell(input.value, type);
      if (editText(next) === editText(value) && (next === null) === (value === null || value === undefined || value === '')) { editing = null; render(); return; }
      save(row, col, next);
    };
    const input = h('input', { class: 'base-cell-input', value: editText(value), 'aria-label': col.label,
      placeholder: type === 'list' || type === 'tags' ? 'a, b, c' : type === 'date' ? 'YYYY-MM-DD' : '',
      onkeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done = true; editing = null; render(); }
      },
      onblur: commit });
    requestAnimationFrame(() => { input.focus(); input.select(); });
    return input;
  };

  const cell = (row, col) => {
    const value = row.cells[col.index];
    const locked = (row.locked || []).includes(col.index);
    const open = editing && editing.row === row.path && editing.col === col.index;
    if (open) return h('td', { class: 'base-editing' }, editor(row, col, value));
    const editable = col.editable && !locked;
    return h('td', {
      class: `c-${col.kind}${editable ? ' base-editable' : ''}`,
      title: editable ? null : col.editable ? 'Kept by the app in this note: change it on its card' : null,
      onclick: editable ? (e) => { if (e.target.closest('a')) return; editing = { row: row.path, col: col.index }; render(); } : null,
    }, cellNode(col, value, row, { href }));
  };

  const order = () => sortedIndexes(data.rows, sort?.col, sort?.dir);

  const head = (cols) => h('thead', {}, h('tr', {}, cols.map((c) => h('th', {
    scope: 'col', class: sort?.col === c.index ? 'sorted' : null,
    'aria-sort': sort?.col === c.index ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null,
  }, h('button', { class: 'th-btn', title: 'Sort by this column (again: the other way; a third time: the base’s order)',
    onclick: () => { sort = nextSort(sort, c.index); render(); } },
  c.label, sort?.col === c.index ? icon(sort.dir === 'asc' ? 'up' : 'down', 13) : null)))));

  /** The rows' indexes by group (the server's groups, each sorted as the page sorts), or one group of all. */
  const grouped = () => {
    const ranked = order();
    const rank = new Map(ranked.map((i, n) => [i, n]));
    if (!data.groups) return [[null, ranked]];
    return data.groups.map((g, gi) => [gi, g.rows.slice().sort((a, b) => rank.get(a) - rank.get(b))]);
  };
  const groupTitle = (gi) => {
    const g = data.groups[gi];
    return g.label === null ? `No ${data.group_by?.label || 'value'}` : g.label;
  };
  const groupFold = (gi) => foldHead({ open: !folded.has(gi), class: 'group-toggle', title: groupTitle(gi), count: data.groups[gi].rows.length, what: 'this group',
    onToggle: () => { if (folded.has(gi)) folded.delete(gi); else folded.add(gi); render(); } });

  const table = (cols) => {
    let left = shown;
    const body = grouped().flatMap(([gi, idx]) => {
      const rows = [];
      if (gi !== null) rows.push(h('tr', { class: 'group-head', 'aria-expanded': String(!folded.has(gi)) },
        h('td', { colspan: cols.length }, h('div', { class: 'group-line' }, groupFold(gi)))));
      if (gi !== null && folded.has(gi)) return rows;
      for (const i of idx) {
        if (left-- <= 0) break;
        const row = data.rows[i];
        rows.push(h('tr', { 'data-path': row.path }, cols.map((c) => cell(row, c))));
      }
      return rows;
    });
    const foot = data.summaries?.some(Boolean)
      ? h('tfoot', {}, h('tr', { class: 'base-summaries' }, cols.map((c) => h('td', { class: 'muted' }, summaryText(data.summaries[c.index])))))
      : null;
    return h('div', { class: 'table-wrap base-table' }, h('table', { class: 'grid', 'aria-label': data.views[data.view]?.name || 'Base' },
      head(cols), h('tbody', {}, body), foot));
  };

  const cards = (cols) => {
    const rest = cols.filter((c) => !isNameColumn(c));
    const card = (i) => {
      const row = data.rows[i];
      return h('article', { class: 'base-card', 'data-path': row.path },
        data.image ? cardImage(row.image) || h('div', { class: 'base-card-img is-empty' }) : null,
        h('div', { class: 'base-card-body' },
          h('a', { class: 'base-card-title', href: href(row.path), title: row.path }, shownName(row.path)),
          rest.length ? h('div', { class: 'fields prop-rows quiet base-card-props' }, rest.map((c) => {
            const node = cellNode(c, row.cells[c.index], row, { href });
            return node ? h('div', { class: 'field' }, h('span', {}, c.label), node) : null;
          })) : null));
    };
    return grouped().map(([gi, idx]) => h('section', { class: 'base-group' },
      gi !== null ? h('div', { class: 'group-line base-group-head' }, groupFold(gi)) : null,
      gi !== null && folded.has(gi) ? null : h('div', { class: 'base-cards' }, idx.slice(0, shown).map(card))));
  };

  const list = (cols) => {
    const rest = cols.filter((c) => !isNameColumn(c));
    const item = (i) => {
      const row = data.rows[i];
      const bits = rest.map((c) => cellNode(c, row.cells[c.index], row, { href })).filter(Boolean);
      return h('li', { 'data-path': row.path }, h('a', { href: href(row.path), title: row.path }, shownName(row.path)),
        bits.length ? h('span', { class: 'base-list-meta' }, bits.flatMap((b, n) => (n ? [h('span', { class: 'muted' }, ' · '), b] : [b]))) : null);
    };
    return grouped().map(([gi, idx]) => h('section', { class: 'base-group' },
      gi !== null ? h('div', { class: 'group-line base-group-head' }, groupFold(gi)) : null,
      gi !== null && folded.has(gi) ? null : h('ul', { class: 'base-list' }, idx.slice(0, shown).map(item))));
  };

  function render() {
    if (failed) { el.replaceChildren(h('p', { class: 'base-notice error' }, `This base could not be read: ${failed}`)); return; }
    if (!data) { el.replaceChildren(loadingLine()); return; }
    if (data.error) { el.replaceChildren(h('p', { class: 'base-notice error' }, data.error)); return; }
    const views = data.views || [];
    const name = views[data.view]?.name;
    const tabs = views.length > 1 ? seg(views.map((v, i) => [i, v.name, { ico: v.type === 'cards' ? 'cards' : v.type === 'list' ? 'list' : 'table' }]),
      data.view, (i) => { current = views[i].name; sort = null; editing = null; shown = SHOWN_MAX; folded.clear(); onView?.(current); load(); },
      { aria: 'Views', role: 'tablist', cls: 'base-tabs' }) : null;
    const count = h('span', { class: 'muted small base-count' },
      `${data.total} ${data.total === 1 ? 'result' : 'results'}${data.limit && data.total > data.limit ? ` · first ${data.limit}` : ''}`);
    const title = compact ? h('a', { class: 'base-embed-title', href: href(path), title: path }, icon('table', 14),
      h('span', {}, shownName(path).replace(/\.base$/i, '')), views.length === 1 && name ? h('span', { class: 'muted' }, ` · ${name}`) : null) : null;
    const notices = [
      data.unsupported?.length ? h('p', { class: 'base-notice' }, icon('info', 14), `Not supported here: ${data.unsupported.join(', ')}.`) : null,
      data.errors?.length ? h('p', { class: 'base-notice error' }, icon('alert', 14), `This base has an error: ${data.errors[0]}`) : null,
    ];
    const cols = data.columns.map((c, index) => ({ ...c, index }));
    const body = !data.rows.length ? (data.unsupported?.length || data.errors?.length ? null : emptyLine('No notes match this view.'))
      : data.type === 'cards' ? cards(cols) : data.type === 'list' ? list(cols) : table(cols);
    const more = data.rows.length > shown ? h('button', { class: 'btn small ghost base-more', onclick: () => { shown += SHOWN_MAX; render(); } },
      `Show ${Math.min(SHOWN_MAX, data.rows.length - shown)} more`) : null;
    // replaceChildren writes a null as the text "null": only what there is
    el.replaceChildren(...[h('div', { class: 'base-bar' }, title, tabs, h('span', { class: 'spacer' }), count), ...notices, ...[body].flat(), more].filter(Boolean));
  }

  render();
  load();
  return { refresh: load };
}

/**
 * The ![[x.base]] / ![[x.base#View]] of rendered Markdown (`root`, after renderMarkdown: filetree.js linkWikilinks
 * leaves a `.md-base` for each) drawn as that view, `this` being the note they are in (`self`).
 */
export function renderBases(root, { self = null, href = filesHref } = {}) {
  for (const box of root?.querySelectorAll('.md-base[data-base]:not([data-drawn])') || []) {
    box.dataset.drawn = '1';
    mountBase(box, { path: box.dataset.base, view: box.dataset.view || null, self, href, compact: true });
  }
}
