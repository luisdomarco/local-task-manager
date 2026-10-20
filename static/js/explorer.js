// The sidebar's Explorer mode: the vault's folders and files as a tree (filetree.js builds it, treepane.js draws it),
// with a filter. A file opens in the middle (#/files/<path>, views/files.js); a folder folds and shows what it holds
// there too. Which folders are open is remembered per vault (explorer.open). The list comes from the server
// (/api/files) whenever the page reloads its items, and only while the Explorer is shown (Docs, views/docs.js, asks for
// it itself and draws its own pane from the same list).
import { api } from './api.js';
import { buildTree } from './filetree.js';
import { onSidebarMode, sidebarMode } from './sidebar.js';
import { firstLoad, onChange } from './state.js';
import { h, icon } from './ui.js';
import { currentPath, treePane } from './treepane.js';

let tree = null;      // buildTree of the latest list
let truncated = false;
let sig = '';         // that list, to skip a redraw when nothing changed
let loading = null;

/** The vault's tree as the latest load left it (views/files.js lists a folder from it), or null before one. */
export const fileTree = () => tree;
const listeners = new Set();
/** Calls `fn()` after each load that changed the tree. */
export const onFiles = (fn) => listeners.add(fn);

const box = () => document.getElementById('side-explorer');
const pane = treePane({
  box, tree: fileTree, openKey: 'explorer.open', label: 'Vault files', rootDrop: true, empty: 'This vault is empty.',
  truncated: () => truncated,
  sections: (t) => [{ id: '', path: '', node: t }],
  bar: [
    h('button', { class: 'btn icon', title: 'New file in the vault (.md if no extension)', 'aria-label': 'New file', onclick: () => pane.startNew('', 'file') }, icon('file', 15)),
    h('button', { class: 'btn icon', title: 'New folder in the vault', 'aria-label': 'New folder', onclick: () => pane.startNew('', 'folder') }, icon('folder', 15)),
  ],
});

/** Fetches the list again; draws the tree when it changed. */
export function loadFiles() {
  if (loading) return loading;
  // Not before the page knows its vault (every request names it): the first load waits for it.
  loading = firstLoad.then(() => api.files()).then((res) => {
    const next = JSON.stringify(res);
    if (next === sig) return;
    sig = next;
    tree = buildTree(res.entries);
    truncated = res.truncated;
    pane.render(); // a name being typed is not swept away (treepane.js waits for it)
    listeners.forEach((fn) => fn());
  }).catch((e) => {
    box().replaceChildren(h('p', { class: 'muted small side-explorer-msg' }, `Cannot list the files: ${e.message}`));
  }).finally(() => { loading = null; });
  return loading;
}

/** A folder in the middle (views/files.js) takes drops like its row in the tree. */
export const dropTarget = (el, folder) => pane.dropTarget(el, folder);

export function initExplorer() {
  const listed = () => sidebarMode() === 'explorer';
  onSidebarMode((mode) => { if (mode === 'explorer') loadFiles().then(() => pane.reveal(currentPath())); });
  onChange(() => { if (listed()) loadFiles(); });
  window.addEventListener('hashchange', () => { if (sidebarMode() === 'explorer' && tree) pane.reveal(currentPath()); });
  if (listed()) loadFiles().then(() => { if (sidebarMode() === 'explorer') pane.reveal(currentPath()); });
}
