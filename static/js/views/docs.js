// Docs (TSK-039): the vault's documents — files in its Docs folders, never items. A view (#/docs, #/docs/<path>), opened
// from its link in the sidebar: a panel on its left with the trees, one section per project (Ticketing: <Project>/Docs)
// and the vault's own (Docs/, folder-per-type docs/), and the doc picked on its right, as the Explorer shows a file
// (views/files.js mountFiles: Preview · Source · Edit, and a doc's own properties). Each folder in a Docs folder is a
// root; "+" on a section starts one, making the Docs folder too when it is not there yet. A new Markdown doc starts
// with the Doc frontmatter (filetree.js docText). The rows, their menu, renaming, dragging and the keys are
// treepane.js's, as in the Explorer; here each folder also keeps the order its entries are dragged in (.order).
import { api } from '../api.js';
import { today } from '../dates.js';
import { fileTree, loadFiles, onFiles } from '../explorer.js';
import { docText, docsGroupOf, docsGroups, docsHref, findNode, pathOfParam } from '../filetree.js';
import { pref, setPref } from '../prefs.js';
import { onChange } from '../state.js';
import { treePane } from '../treepane.js';
import { h, icon } from '../ui.js';
import { mountFiles } from './files.js';

let groups = null; // docsGroups of the latest /api/docs/roots
let panel = null;  // the trees' element, while the view is shown
let shown = '';    // the path the view shows ('' none)
let live = false;
const folded = () => new Set(pref('docs.folded', []));

function toggleFold(path) {
  const set = folded();
  if (set.has(path)) set.delete(path); else set.add(path);
  setPref('docs.folded', set.size ? [...set] : null);
  pane.render();
}

function newRoot(g) {
  const set = folded();
  if (set.delete(g.path)) setPref('docs.folded', set.size ? [...set] : null);
  pane.startNew(g.path, 'folder', true); // <Project>/Docs is made with it when it is not there yet
}

/** A section's head: its title (folds it; the project's key and path in its tooltip), and "+" for a new root. */
function head(g) {
  const isFolded = folded().has(g.path);
  return h('div', { class: `docs-head ${g.dim ? 'dim' : ''}`, 'data-docs': g.path },
    h('button', { class: 'docs-title', 'aria-expanded': String(!isFolded), title: g.project ? `${g.project} · ${g.path}` : g.path, onclick: () => toggleFold(g.path) },
      icon(isFolded ? 'right' : 'down', 12), h('span', {}, g.title)),
    h('button', { class: 'btn icon docs-add', title: `New root in ${g.title}`, 'aria-label': `New root in ${g.title}`, onclick: () => newRoot(g) }, icon('plus', 14)));
}

const pane = treePane({
  box: () => panel, tree: fileTree, openKey: 'docs.open', label: 'Docs', rootDrop: false, href: docsHref, current: () => shown, ordered: true,
  empty: 'No Docs yet: “+” on a section starts one.',
  sections: (t) => (groups || []).map((g) => ({ id: g.path, path: g.path, head: head(g), node: folded().has(g.path) ? null : findNode(t, g.path) })),
  newText: (path) => {
    const g = docsGroupOf(groups, path);
    const folder = g?.project ? g.path.split('/')[0] : '';
    return docText(path.split('/').pop().replace(/\.md$/i, ''), folder, today());
  },
});

/** The Docs folders again (a project added, a root made) and the files they hold. */
function load() {
  return Promise.all([api.docsRoots(), loadFiles()]).then(([res]) => {
    groups = docsGroups(res.containers);
    if (panel) pane.render();
  }).catch(() => {});
}
onFiles(() => { if (live) load(); });
onChange(() => { if (live) load(); });

export function mount(root, param) {
  shown = pathOfParam(param);
  live = true;
  panel = h('div', { class: 'docs-tree' });
  const main = h('div', { class: 'docs-main' });
  root.replaceChildren(h('div', { class: 'docs-page' },
    h('aside', { class: 'docs-panel', 'aria-label': 'Docs' }, h('h2', { class: 'docs-panel-title' }, icon('book', 16), 'Docs'), panel),
    main));
  const file = shown ? mountFiles(main, param, { href: docsHref }) : null;
  if (!file) {
    main.replaceChildren(h('div', { class: 'empty docs-empty' }, icon('book', 22),
      h('p', {}, 'Pick a doc on the left, or start a root with “+” on a section.'),
      h('p', { class: 'muted small' }, 'Docs are Markdown files in each project’s Docs folder: not items, just documents.')));
  }
  pane.render();
  load().then(() => { if (shown && live) pane.reveal(shown); });
  return {
    update() { file?.update(); },
    unmount() { live = false; panel = null; return file?.unmount(); },
  };
}
