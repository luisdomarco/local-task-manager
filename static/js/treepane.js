// A tree of the vault's folders and files in the sidebar, with its filter, its row menu, renaming and making things in
// place, dragging to move and the keyboard (↑ ↓ ← → F2 ⌘⌫). The Explorer (explorer.js) shows the whole vault with one;
// Docs (docs.js) shows only its Docs folders, in sections, with another. Each pane keeps its own folds, filter and
// what is being typed; the list of files is the Explorer's (fileTree), loaded once for both.
import { api } from './api.js';
import { ancestorPaths, dropOrder, fileKind, filesHref, filterTree, findNode, orderedChildren, pathOfParam } from './filetree.js';
import { pref, setPref } from './prefs.js';
import { findByPageRef } from './rules.js';
import { createFile, deletePath, duplicateFile, makeFolder, movePath, renamePath, state, toast, updateItem, uploadFiles } from './state.js';
import { cssKey, dropdown, h, icon, typeIcon } from './ui.js';
import { openFileInEdit } from './views/files.js';

const FILE_ICON = { image: 'image', pdf: 'file', text: 'text', markdown: 'note', other: 'file' };
// Dragging a row onto a folder moves it there; files dragged in from the computer (Finder) are brought into it.
const DRAG_MIME = 'application/x-tm-path';
const dragged = (e) => [...(e.dataTransfer?.types || [])].includes(DRAG_MIME);
const fromComputer = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

/** The path the page is showing: a file or folder of #/files/…, or the file of the item whose page it is. */
export function currentPath() {
  const [, name, param] = location.hash.match(/^#\/(\w+)(?:\/(.+))?/) || [];
  if (name === 'files') return pathOfParam(param);
  if (param) return findByPageRef(name, decodeURIComponent(param), state.all)?.path || null;
  return null;
}

/** Where the page is, after `from` became `to`: a file or folder shown in the middle follows its new path. */
function follow(from, to, current = currentPath, href = filesHref) {
  const here = current();
  if (here === from || here?.startsWith(`${from}/`)) location.replace(href(to + here.slice(from.length)));
}

async function run(op) {
  try { return await op(); } catch { return null; /* the state's mutate already toasted why */ }
}

/**
 * A pane. `cfg`:
 *   box()        its element (in the sidebar, or Docs' panel)
 *   href(path)   a row's address (default #/files/…), and current() the path the page shows (default currentPath)
 *   tree()       the vault's tree (buildTree), or null before the first load
 *   openKey      the pref that remembers its open folders
 *   label        the tree's accessible name
 *   sections(tree) → [{ id, path, node, head? }]: what it lists. `node` is the folder whose children are the top rows
 *                (null when it is not there yet), `path` where a new top row goes, `head` an element drawn above them.
 *   bar          the elements next to its filter (new file / new folder…)
 *   rootDrop     whether its empty space takes drops, into the vault itself
 *   newText(path)  what a new Markdown file starts with ('' or undefined: the server's heading)
 *   empty        what it says when there is nothing to list
 *   ordered      each folder shows its own order (.order, Docs) and a row takes a drop above it, below it or — a
 *                folder — inside it: the folder keeps the order it was dropped in (POST /api/files/move {order})
 */
export function treePane(cfg) {
  const href = cfg.href || filesHref;
  const current = cfg.current || currentPath;
  let query = '';
  let list = null;
  let note = null;
  // What is being typed: { kind: 'rename', path } or { kind: 'new', parent, what: 'folder' | 'file', parents? }.
  let editing = null;
  let renderWaiting = false; // a reload that came while typing: drawn once the typing ends
  const open = () => new Set(pref(cfg.openKey, []));
  const saveOpen = (set) => setPref(cfg.openKey, set.size ? [...set] : null);
  const box = () => cfg.box();
  const kids = (n) => (cfg.ordered ? orderedChildren(n) : n.children);

  function toggle(path, force) {
    const set = open();
    const isOpen = force ?? !set.has(path);
    if (isOpen) set.add(path); else set.delete(path);
    saveOpen(set);
    render();
    box().querySelector(`[data-path="${CSS.escape(path)}"]`)?.focus();
  }

  /** Opens the folders that hold `path`, so its row shows, and scrolls it into view. */
  function reveal(path) {
    if (!path) return;
    const set = open();
    const before = set.size;
    ancestorPaths(path).forEach((p) => set.add(p));
    if (set.size !== before) { saveOpen(set); render(); } else markActive();
    box().querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function row(node, depth, set, filtering, siblings = []) {
    const isDir = node.kind === 'dir';
    const expanded = isDir && (filtering || set.has(node.path));
    const mark = isDir ? icon(expanded ? 'folderopen' : 'folder', 15)
      : node.item ? typeIcon(node.item.type, 15) : icon(FILE_ICON[fileKind(node.path)], 15);
    const status = node.item?.status ? h('span', { class: `tree-status s-${cssKey(node.item.status)}`, title: node.item.status }) : null;
    const el = h('a', {
      class: `tree-row ${isDir ? 'is-dir' : ''}`, href: href(node.path), role: 'treeitem', tabindex: '-1',
      'data-path': node.path, style: `--depth:${depth}`, title: node.item ? `${node.item.key} · ${node.item.title}\n${node.path}` : node.path,
      ...(isDir ? { 'aria-expanded': String(expanded) } : {}),
      // A folder unfolds as it opens in the middle; clicked again once shown there, it folds. While filtering,
      // everything that matched stays unfolded.
      onclick: () => { if (isDir && !filtering) toggle(node.path, !(set.has(node.path) && current() === node.path)); },
    },
    h('span', { class: 'tree-chevron', 'aria-hidden': 'true' }, isDir ? icon(expanded ? 'down' : 'right', 12) : null),
    mark,
    editing?.kind === 'rename' && editing.path === node.path ? editField(node) : h('span', { class: 'tree-name' }, node.name),
    status,
    h('button', { class: 'btn icon tree-more', tabindex: '-1', title: `Actions on ${node.name}`, 'aria-haspopup': 'menu',
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); rowMenu(e.currentTarget, node); } }, icon('more', 14)));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); rowMenu(el.querySelector('.tree-more'), node); });
    draggableRow(el, node);
    if (cfg.ordered) orderedDrop(el, node, siblings);
    else if (isDir) dropTarget(el, node.path);
    const fresh = editing?.kind === 'new' && editing.parent === node.path && expanded ? [newRow(depth + 1)] : [];
    const inside = expanded ? kids(node) : [];
    return expanded ? [el, ...fresh, ...inside.flatMap((c) => row(c, depth + 1, set, filtering, inside))] : [el];
  }

  function editField(node) {
    const isTitle = node.item?.rename === 'title';
    const value = isTitle ? node.item.title : node.name;
    const input = h('input', { class: 'tree-edit', value, 'aria-label': isTitle ? `New title of ${node.item.key}` : `New name of ${node.name}` });
    // The name without its extension is what one usually changes: selected first.
    input.dataset.select = isTitle || node.kind === 'dir' ? String(value.length) : String(value.replace(/\.[^.]+$/, '').length || value.length);
    wireEdit(input, async (next) => {
      if (!next || next === value) return;
      if (isTitle) {
        await run(() => updateItem(node.item.key, { subject: next })); // the file follows its title (server)
      } else {
        const out = await run(() => renamePath(node.path, next));
        if (out) follow(node.path, out.path, current, href);
      }
    });
    return input;
  }

  /** The row where a new folder's or file's name is typed. A file named without an extension is Markdown (.md), and
   *  opens in the editor. */
  function newRow(depth) {
    const { parent, what, parents } = editing;
    const file = what === 'file';
    const input = h('input', { class: 'tree-edit', placeholder: file ? 'File name (.md if none)' : 'Folder name', 'aria-label': file ? 'New file name' : 'New folder name' });
    input.dataset.select = '0';
    wireEdit(input, async (name) => {
      if (!name) return;
      const named = file && !/\.[^.\s]+$/.test(name) ? `${name}.md` : name;
      const path = parent ? `${parent}/${named}` : named;
      const text = file && /\.md$/i.test(named) ? cfg.newText?.(path) : undefined;
      const out = await run(() => (file ? createFile(path, text) : makeFolder(path, parents)));
      if (!out) return;
      reveal(out.path);
      if (file) openFileInEdit(out.path, href);
    });
    return h('div', { class: 'tree-row tree-new', style: `--depth:${depth}` }, h('span', { class: 'tree-chevron' }), icon(file ? 'file' : 'folder', 15), input);
  }

  /** Enter (or leaving the field) keeps what was typed, Escape drops it; either way the tree is drawn again. */
  function wireEdit(input, commit) {
    let done = false;
    const end = async (keep) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      editing = null;
      if (keep) await commit(value);
      render();
      if (renderWaiting) { renderWaiting = false; render(); }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // not the tree's keys, nor the app's shortcuts
      if (e.key === 'Enter') { e.preventDefault(); end(true); }
      if (e.key === 'Escape') { e.preventDefault(); end(false); }
    });
    input.addEventListener('blur', () => end(true));
    input.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); }); // not the row's link
  }

  function startRename(node) {
    if (node.item && !node.item.rename) { toast(`${node.name}: this structure names it, so it cannot be renamed`, true); return; }
    editing = { kind: 'rename', path: node.path };
    render();
  }

  /** Types the name of a new file or folder in `parent` ('' the vault); `parents`: the folders above it are made too. */
  function startNew(parent, what, parents = false) {
    if (parent) { const set = open(); set.add(parent); saveOpen(set); }
    editing = { kind: 'new', parent, what, parents };
    render();
  }

  /** Picks files on the computer and brings them into `folder`. */
  function pickUpload(folder) {
    const input = h('input', { type: 'file', multiple: true, hidden: true });
    input.addEventListener('change', async () => {
      const paths = await uploadFiles(folder, [...input.files]);
      input.remove();
      if (paths.length) reveal(paths[0]);
    });
    document.body.append(input);
    input.click();
  }

  async function duplicate(node) {
    const out = await run(() => duplicateFile(node.path));
    if (out) { reveal(out.path); location.hash = href(out.path); }
  }

  async function remove(node) {
    const out = await run(() => deletePath(node.path));
    if (out && (current() === node.path || current()?.startsWith(`${node.path}/`))) location.replace(href(ancestorPaths(node.path).pop() || ''));
  }

  function rowMenu(anchor, node) {
    const root = state.vault?.root;
    const isDir = node.kind === 'dir';
    const renameLabel = node.item?.rename === 'title' ? 'Rename (its title)' : 'Rename';
    dropdown(anchor, [
      isDir ? { label: 'New file inside', icon: 'file', onSelect: () => startNew(node.path, 'file') } : null,
      isDir ? { label: 'New folder inside', icon: 'folder', onSelect: () => startNew(node.path, 'folder') } : null,
      isDir ? { label: 'Upload files…', icon: 'upload', onSelect: () => pickUpload(node.path) } : null,
      !isDir && !node.item ? { label: 'Duplicate', icon: 'copy', onSelect: () => duplicate(node) } : null,
      node.item && !node.item.rename ? null : { label: renameLabel, icon: 'pencil', kbd: 'F2', onSelect: () => startRename(node) },
      { label: 'Delete', icon: 'trash', kbd: '⌘⌫', danger: true, onSelect: () => remove(node) },
      '-',
      root ? { label: 'Show in Finder', icon: 'external', onSelect: () => api.openPath(`${root}/${node.path}`).catch((e) => toast(e.message, true)) } : null,
      { label: `Open in ${state.config.editor_app || 'Cursor'}`, icon: 'code', onSelect: () => api.openInEditor(node.path).catch((e) => toast(e.message, true)) },
      { label: 'Copy path', icon: 'copy', onSelect: () => navigator.clipboard.writeText(node.path).then(() => toast('Path copied'), () => toast('Could not copy', true)) },
      // A Markdown file, as another note links to it (by its name, as Obsidian resolves it).
      !isDir && /\.md$/i.test(node.name) ? { label: 'Copy [[wikilink]]', icon: 'link', onSelect: () => {
        const link = `[[${node.name.replace(/\.md$/i, '')}]]`;
        navigator.clipboard.writeText(link).then(() => toast(`${link} copied`), () => toast('Could not copy', true));
      } } : null,
    ].filter(Boolean), { width: 210 });
  }

  function draggableRow(el, node) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.clearData(); // not the link's URL: the pin bar would take it for a card
      e.dataTransfer.setData(DRAG_MIME, node.path);
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => el.classList.add('dragging'));
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  }

  function dropTarget(el, folder) {
    el.addEventListener('dragover', (e) => {
      if (!dragged(e) && !fromComputer(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = dragged(e) ? 'move' : 'copy';
      el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-target'); });
    el.addEventListener('drop', async (e) => {
      if (!dragged(e) && !fromComputer(e)) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop-target');
      if (!dragged(e)) { // from the computer: into this folder
        const paths = await uploadFiles(folder, [...e.dataTransfer.files]);
        if (paths.length) reveal(paths[0]);
        return;
      }
      const path = e.dataTransfer.getData(DRAG_MIME);
      const parent = ancestorPaths(path).pop() || '';
      if (!path || parent === folder || folder === path || folder.startsWith(`${path}/`)) return; // where it is, or into itself
      const out = await run(() => movePath(path, folder));
      if (out) { follow(path, out.path, current, href); reveal(out.path); }
    });
  }

  /** Where on `el` a drag is: 'before' or 'after' it (its upper or lower part), or 'inside' (a folder's middle). */
  const zoneOf = (e, el, isDir) => {
    const r = el.getBoundingClientRect();
    const y = (e.clientY - r.top) / (r.height || 1);
    if (isDir) return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
    return y < 0.5 ? 'before' : 'after';
  };
  const clearMarks = (el) => el.classList.remove('drop-target', 'drop-before', 'drop-after');

  /** A row of an ordered pane: a drop above or below it places what was dragged there, in this row's folder, in that
   *  order; inside a folder's middle moves it in. Files from the computer come into that folder. */
  function orderedDrop(el, node, siblings) {
    const isDir = node.kind === 'dir';
    const parent = ancestorPaths(node.path).pop() || '';
    el.addEventListener('dragover', (e) => {
      if (!dragged(e) && !fromComputer(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = dragged(e) ? 'move' : 'copy';
      const zone = zoneOf(e, el, isDir);
      el.classList.toggle('drop-target', zone === 'inside');
      el.classList.toggle('drop-before', zone === 'before');
      el.classList.toggle('drop-after', zone === 'after');
    });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) clearMarks(el); });
    el.addEventListener('drop', async (e) => {
      if (!dragged(e) && !fromComputer(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const zone = zoneOf(e, el, isDir);
      clearMarks(el);
      const folder = zone === 'inside' ? node.path : parent;
      if (!dragged(e)) {
        const paths = await uploadFiles(folder, [...e.dataTransfer.files]);
        if (paths.length) reveal(paths[0]);
        return;
      }
      const path = e.dataTransfer.getData(DRAG_MIME);
      if (!path || path === node.path || folder === path || folder.startsWith(`${path}/`)) return; // onto or into itself
      const name = path.split('/').pop();
      let order;
      if (zone !== 'inside') {
        const names = siblings.map((c) => c.name);
        const at = names.indexOf(node.name);
        order = dropOrder(names, name, zone === 'before' ? node.name : names.slice(at + 1).find((n) => n !== name) ?? null);
      } else if ((ancestorPaths(path).pop() || '') === folder) return; // already in it
      const out = await run(() => movePath(path, folder, order));
      if (out) { follow(path, out.path, current, href); reveal(out.path); }
    });
  }

  function render() {
    const el = box();
    const tree = cfg.tree();
    if (!el || !tree) return;
    if (editing && el.contains(document.activeElement) && document.activeElement.classList.contains('tree-edit')) { renderWaiting = true; return; }
    // Built once: only the rows change after, so the filter keeps its focus (moving an element in the DOM blurs it).
    if (!list || !el.contains(list)) {
      const filter = h('input', {
        type: 'search', class: 'side-explorer-filter', placeholder: 'Filter files…', 'aria-label': 'Filter files', value: query,
        oninput: (e) => { query = e.target.value; render(); },
        onkeydown: (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); list.querySelector('.tree-row')?.focus(); } },
      });
      list = h('div', { class: 'tree', role: 'tree', 'aria-label': cfg.label, onkeydown: onTreeKey });
      if (cfg.rootDrop) dropTarget(list, ''); // the tree's empty space is the vault itself
      note = h('p', { class: 'muted small side-explorer-msg', hidden: true }, 'Too many files: only the first ones are listed.');
      // What the files say, not what they are called: Enter searches their text (views/find.js).
      const search = h('input', {
        type: 'search', class: 'side-explorer-filter side-explorer-search', placeholder: 'Search in files… ⏎', 'aria-label': 'Search in files',
        onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim().length >= 2) location.hash = `#/find/${encodeURIComponent(e.target.value.trim())}`; },
      });
      el.replaceChildren(h('div', { class: 'side-explorer-bar' }, filter, ...(cfg.bar || [])), h('div', { class: 'side-explorer-bar' }, search), list, note);
    }
    const filtering = !!query.trim();
    const set = open();
    const rows = cfg.sections(tree).flatMap((s) => {
      const shown = s.node ? filterTree(s.node, query) : null;
      const first = shown ? kids(shown) : [];
      const top = first.flatMap((c) => row(c, 0, set, filtering, first));
      const fresh = editing?.kind === 'new' && editing.parent === s.path ? [newRow(0)] : [];
      if (filtering && !top.length && !fresh.length) return []; // a filter hides the sections it finds nothing in
      return [...(s.head ? [s.head] : []), ...fresh, ...top];
    });
    list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'muted small side-explorer-msg' }, filtering ? 'Nothing matches.' : cfg.empty)]));
    note.hidden = !cfg.truncated?.();
    markActive();
    const field = list.querySelector('.tree-edit');
    if (field) {
      field.focus();
      field.setSelectionRange(0, Number(field.dataset.select) || 0);
      field.scrollIntoView({ block: 'nearest' });
    }
  }

  /** Lights up the row of what the page shows; it alone takes Tab into the tree. */
  function markActive() {
    const path = current();
    let active = null;
    for (const r of list?.querySelectorAll('.tree-row') || []) {
      const on = r.dataset.path === path;
      r.classList.toggle('active', on);
      if (on) { r.setAttribute('aria-current', 'page'); active = r; } else r.removeAttribute('aria-current');
      r.tabIndex = -1;
    }
    const first = active || list?.querySelector('.tree-row');
    if (first) first.tabIndex = 0;
  }

  // ↑/↓ move between the rows shown, → opens a folder (or steps into it), ← folds it (or steps out to its folder);
  // F2 renames the row, Delete (⌘⌫) sends it to the trash.
  function onTreeKey(e) {
    const rows = [...list.querySelectorAll('.tree-row')];
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    const cur = rows[i];
    const path = cur.dataset.path;
    const go = (r) => { if (r) { e.preventDefault(); r.focus(); } };
    const node = findNode(cfg.tree(), path);
    if (e.key === 'F2' && node) { e.preventDefault(); startRename(node); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace' && e.metaKey) && node) { e.preventDefault(); remove(node); return; }
    if (e.key === 'ArrowDown') go(rows[i + 1]);
    else if (e.key === 'ArrowUp') go(rows[i - 1]);
    else if (e.key === 'Home') go(rows[0]);
    else if (e.key === 'End') go(rows[rows.length - 1]);
    else if (e.key === 'ArrowRight' && cur.classList.contains('is-dir')) {
      e.preventDefault();
      if (cur.getAttribute('aria-expanded') === 'true') rows[i + 1]?.focus(); else toggle(path, true);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (cur.getAttribute('aria-expanded') === 'true' && !query.trim()) toggle(path, false);
      else list.querySelector(`[data-path="${CSS.escape(ancestorPaths(path).pop() || '')}"]`)?.focus();
    }
  }

  return { render, reveal, startNew, dropTarget, editing: () => !!editing };
}
