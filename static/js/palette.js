// Command palette (⌘K / Ctrl+K, or the 🔍 in the top bar): the global search (TSK-042). Open an item by id or title —
// grouped by type, in the sidebar's order — or by what its text says; jump to a view; or create something. Arrow keys
// move, Enter runs, Esc closes. What matches and in what order is search.js's.
import { api } from './api.js';
import { CREATE_TYPES, TYPE_LABEL, openCreateModal } from './create.js';
import { openClaudeDialog } from './claude.js';
import { openItem, openItemKey } from './panel.js';
import { openQuickModal } from './quickadd.js';
import { STRUCTURE, TYPE_DEFS, findByPageRef, isDone } from './rules.js';
import { bodyHits, groupByType, matches, norm, typeOrder } from './search.js';
import { fileTree, loadFiles } from './explorer.js';
import { docChoices, docsGroups, docsHref, filesHref } from './filetree.js';
import { state } from './state.js';
import { TYPE_ICON_NAME, h, icon, typeIcon } from './ui.js';

// The views every vault has (main.js FIXED_VIEWS); each type's list joins them from the vault's structure (views()).
const DAYS = [['today', 'Today', 'sun'], ['tomorrow', 'Tomorrow', 'sun'], ['week', 'Week', 'calendar'], ['board', 'Board', 'kanban'], ['table', 'All items', 'table']];
const TOOLS = [['log', 'Work log', 'clock'], ['labels', 'Labels', 'tag'], ['contacts', 'Contacts', 'user']];
const LAST = [['trash', 'Trash', 'trash'], ['settings', 'Settings', 'settings']];
const PER_TYPE = 5; // items shown of each type until its "Show all"
const BODY_DELAY = 250; // ms of no typing before the text is searched

let el = null;
let lastFocus = null;
let expanded = new Set(); // the types whose every match is shown
let body = { q: '', hits: [] }; // the last text search, for the query it answered
let docGroups = []; // the Docs folders (docsGroups of /api/docs/roots), asked when the palette opens

/** [route, label, icon] of every view, in the sidebar's order: capture, the days, the types, the tools, the rest. */
function views() {
  const of = (group) => STRUCTURE.types.filter((t) => t.list && t.nav?.group === group)
    .sort((a, b) => a.nav.order - b.nav.order).map((t) => [t.route, t.plural, t.icon]);
  const unlinked = STRUCTURE.types.filter((t) => t.list && !t.nav).map((t) => [t.route, t.plural, t.icon]);
  return [...of('capture'), ...DAYS, ...of('types'), ['docs', 'Docs', 'book'], ...unlinked, ...TOOLS, ...of('tools'), ...LAST];
}

function results(query) {
  const q = norm(query.trim());
  const out = [];
  const shown = new Set();
  if (q) {  // what you came for first: the items, by type, then the ones whose text says it
    const groups = groupByType(q, state.items, { order: typeOrder(STRUCTURE.types), isClosed: isDone, per: PER_TYPE, expanded });
    for (const g of groups) {
      const name = TYPE_DEFS[g.type]?.plural || g.type;
      for (const i of g.items) {
        shown.add(i.key);
        out.push({ group: name, label: i.title, meta: `${i.id || ''}${isDone(i) ? ' · closed' : ''}`, type: i.type, run: () => openItem(i) });
      }
      if (g.total > g.items.length) {
        out.push({ group: name, label: `Show all ${g.total}`, icon: 'down', keep: true, run: () => expanded.add(g.type) });
      }
    }
    if (body.q === q) {
      for (const b of bodyHits(q, body.hits, state.items, shown).slice(0, 8)) {
        out.push({ group: 'In the text', label: b.item.title, meta: `${b.item.id || ''} · “${b.text.slice(0, 80)}”`, type: b.item.type, run: () => openItem(b.item) });
      }
    }
  }
  // Docs (TSK-039): by their name, then by what their text says; opened in Docs.
  const inDocs = (p) => docGroups.some((g) => p.startsWith(`${g.path}/`));
  if (q && fileTree() && docGroups.length) {
    const named = docChoices(fileTree(), docGroups).filter((c) => c.kind === 'doc' && matches(q, c.path.split('/').pop())).slice(0, 6);
    const shownDocs = new Set(named.map((c) => c.path));
    const said = body.q === q ? body.hits.filter((r) => inDocs(r.path) && !shownDocs.has(r.path) && shownDocs.add(r.path)).slice(0, 6) : []; // a doc's first line
    for (const c of named) out.push({ group: 'Docs', label: c.path.split('/').pop().replace(/\.md$/i, ''), meta: c.path, icon: 'note', run: () => { location.hash = docsHref(c.path); } });
    for (const r of said) out.push({ group: 'Docs', label: r.path.split('/').pop().replace(/\.md$/i, ''), meta: `“${r.text.slice(0, 80)}”`, icon: 'note', run: () => { location.hash = docsHref(r.path); } });
  }
  const all = views();
  if (!q || 'go to'.includes(q) || all.some(([, l]) => norm(l).includes(q))) {
    for (const [hash, label, ico] of all) {
      if (!q || norm(label).includes(q)) out.push({ group: 'Go to', label, icon: ico, run: () => { location.hash = `#/${hash}`; } });
    }
  }
  // The item in front of you (its card, or its page: an initiative's, a project's…) can be handed to Claude from here.
  const here = openItemKey();
  const [, pageType, ref] = location.hash.match(/^#\/(\w+)\/([^/?]+)/) || [];
  const open = here ? state.byId.get(here) || state.all.find((i) => i.key === here)
    : TYPE_DEFS[pageType]?.page ? findByPageRef(pageType, decodeURIComponent(ref), state.all) : null;
  if (open && open.id && (!q || /claude|terminal|work/.test(q))) {
    out.push({ group: 'This item', label: `Work on ${open.id} with Claude`, meta: open.title, icon: 'terminal', run: () => openClaudeDialog(open) });
  }
  // The top bar's terminal: a prompt with no item, in the default folder.
  if (!q || /claude|terminal/.test(q)) {
    out.push({ group: 'Claude', label: 'Claude terminal', meta: 'a prompt with no item', icon: 'terminal', run: () => openClaudeDialog(null) });
  }
  // The vault's files by name (an item's file is already among the items), and their text searched (views/find.js).
  if (q && fileTree()) {
    const found = [];
    const walk = (n) => n.children?.forEach((c) => { if (c.kind === 'dir') walk(c); else if (!c.item && !inDocs(c.path) && matches(q, c.path)) found.push(c); }); // docs: their own group
    walk(fileTree());
    for (const f of found.slice(0, 8)) out.push({ group: 'Files', label: f.name, meta: f.path, icon: 'file', run: () => { location.hash = filesHref(f.path); } });
  }
  if (q.length >= 2) out.push({ group: 'Files', label: `Search “${query.trim()}” in files`, icon: 'search', run: () => { location.hash = `#/find/${encodeURIComponent(query.trim())}`; } });
  const newQ = q.replace(/^(new|create|add)\s*/, '');
  for (const t of CREATE_TYPES) {
    if (!q || norm(`new ${TYPE_LABEL[t]}`).includes(q) || norm(TYPE_LABEL[t]).startsWith(newQ)) {
      out.push({ group: 'Create', label: `New ${TYPE_LABEL[t].toLowerCase()}`, icon: TYPE_ICON_NAME[t], run: () => openCreateModal(t) });
    }
  }
  if (!q || 'capture to inbox'.includes(q)) out.push({ group: 'Create', label: 'Capture to Inbox', icon: 'inbox', kbd: 'Q', run: () => openQuickModal() });
  return out.slice(0, 60);
}

/** The text of the vault searched for the query, a moment after the typing stops; `then` redraws if it still applies. */
let bodyTimer = null;
function searchBody(query, then) {
  clearTimeout(bodyTimer);
  const q = norm(query.trim());
  if (q.length < 2 || body.q === q) return;
  bodyTimer = setTimeout(() => {
    api.searchFiles(query.trim()).then((r) => { body = { q, hits: r.results || [] }; then(); }).catch(() => {});
  }, BODY_DELAY);
}

export function closePalette() {
  if (!el) return;
  el.remove();
  el = null;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

export const paletteIsOpen = () => el !== null;

export function openPalette() {
  if (el) { closePalette(); return; }
  lastFocus = document.activeElement;
  expanded = new Set();
  body = { q: '', hits: [] };
  api.docsRoots().then((r) => { docGroups = docsGroups(r.containers); if (el) el.querySelector('.palette-input')?.dispatchEvent(new Event('input')); }, () => {});
  if (!fileTree()) loadFiles(); // its files, for the Files group, even when the Explorer was never opened
  const input = h('input', { type: 'text', class: 'palette-input', placeholder: 'Search items by id, title or text — go to a view, create…', 'aria-label': 'Search', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list' });
  const list = h('div', { class: 'palette-list', id: 'palette-list', role: 'listbox' });
  let active = 0;
  let current = [];
  const render = () => {
    current = results(input.value);
    active = Math.min(active, Math.max(0, current.length - 1));
    const groups = [];
    current.forEach((r, i) => {
      if (!groups.length || groups[groups.length - 1].name !== r.group) groups.push({ name: r.group, rows: [] });
      groups[groups.length - 1].rows.push(h('div', {
        class: `palette-row ${i === active ? 'active' : ''}`, role: 'option', 'aria-selected': String(i === active), id: `palette-opt-${i}`,
        onmousedown: (e) => e.preventDefault(), onclick: () => pick(i), onmousemove: () => { if (active !== i) { active = i; render(); } },
      }, r.type ? typeIcon(r.type, 15) : icon(r.icon || 'arrow', 15),
      h('span', { class: 'palette-label' }, r.label), r.meta ? h('span', { class: 'muted small' }, r.meta) : null, r.kbd ? h('kbd', {}, r.kbd) : null));
    });
    list.replaceChildren(...(groups.length ? groups.map((g) => h('div', { class: 'palette-group' }, h('div', { class: 'menu-label' }, g.name), g.rows))
      : [h('p', { class: 'muted small palette-empty' }, 'Nothing matches.')]));
    input.setAttribute('aria-activedescendant', current.length ? `palette-opt-${active}` : '');
    list.querySelector('.palette-row.active')?.scrollIntoView({ block: 'nearest' });
  };
  const pick = (i) => {
    const r = current[i];
    if (!r) return;
    if (r.keep) { r.run(); render(); return; } // "Show all": the palette stays, with the rest of that type
    closePalette();
    r.run();
  };
  input.addEventListener('input', () => {
    active = 0;
    render();
    searchBody(input.value, () => { if (el && norm(input.value.trim()) === body.q) render(); });
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, current.length); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + current.length) % Math.max(1, current.length); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
  });
  el = h('div', { class: 'palette-backdrop', onmousedown: (e) => { if (e.target === el) closePalette(); } },
    h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' },
      h('div', { class: 'palette-head' }, icon('search', 16), input, h('kbd', {}, 'esc')), list));
  document.body.append(el);
  render();
  input.focus();
}
