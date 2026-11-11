// Docs (TSK-039): the vault's documents — files in its Docs folders, never items. A view (#/docs, #/docs/<path>), opened
// from its link in the sidebar: a panel on its left with the trees, one section per project (Ticketing: <Project>/Docs)
// and the vault's own (Docs/, folder-per-type docs/), and the doc picked on its right, as the Explorer shows a file
// (views/files.js mountFiles: Preview · Source · Edit, and a doc's own properties). Each folder in a Docs folder is a
// root; "+" on a section starts a doc or a folder at its top, making the Docs folder too when it is not there yet
// ("No project" is the vault's own: docs that belong to no project). A new Markdown doc starts with the Doc
// frontmatter (filetree.js docText). The rows, their menu, renaming, dragging and the keys are
// treepane.js's, as in the Explorer; here each folder also keeps the order its entries are dragged in (.order).
import { api } from '../api.js';
import { today } from '../dates.js';
import { fileTree, loadFiles, onFiles } from '../explorer.js';
import { docText, docsGroupOf, docsGroups, docsHref, findNode, pathOfParam } from '../filetree.js';
import { isPhone } from '../phone.js';
import { pref, setPref } from '../prefs.js';
import { cssWidth, wireResizer } from '../resizer.js';
import { onChange } from '../state.js';
import { treePane } from '../treepane.js';
import { dropdown, emptyState, foldHead, h, icon } from '../ui.js';
import { mountFiles } from './files.js';

let groups = null; // docsGroups of the latest /api/docs/roots
let panel = null;  // the trees' element, while the view is shown
let shown = '';    // the path the view shows ('' none)
let live = false;
const folded = () => new Set(pref('docs.folded', []));
// The panel's width: dragged on the grip at its right (or ←/→ there), double-click back to the default; for every vault.
const width = cssWidth({ cssVar: '--docs-w', key: 'docs.w', def: 270, min: 200, max: 520,
  measure: () => document.querySelector('.docs-panel')?.getBoundingClientRect().width || 270 });

function toggleFold(path) {
  const set = folded();
  if (set.has(path)) set.delete(path); else set.add(path);
  setPref('docs.folded', set.size ? [...set] : null);
  pane.render();
}

/** Types the name of a new doc (`what` 'file') or folder at the top of section `g`, unfolding it first. */
function newAtTop(g, what) {
  const set = folded();
  if (set.delete(g.path)) setPref('docs.folded', set.size ? [...set] : null);
  pane.startNew(g.path, what, true); // <Project>/Docs is made with it when it is not there yet
}

/** "+" on a section: a new doc (Markdown unless named otherwise) or a new folder at its top. */
function addMenu(anchor, g) {
  dropdown(anchor, [
    { label: 'New doc', icon: 'file', onSelect: () => newAtTop(g, 'file') },
    { label: 'New folder', icon: 'folder', onSelect: () => newAtTop(g, 'folder') },
  ], { width: 170 });
}

/** A section's head: its title (folds it; the project's key and path in its tooltip), and "+" for a new doc or folder. */
function head(g) {
  const isFolded = folded().has(g.path);
  return h('div', { class: `docs-head ${g.dim ? 'dim' : ''}`, 'data-docs': g.path },
    foldHead({ open: !isFolded, title: g.title, small: true, class: 'docs-title', tip: g.project ? `${g.project} · ${g.path}` : g.path, onToggle: () => toggleFold(g.path) }),
    h('button', { class: 'btn icon docs-add', title: `New in ${g.title}`, 'aria-label': `New doc or folder in ${g.title}`, 'aria-haspopup': 'menu', onclick: (e) => addMenu(e.currentTarget, g) }, icon('plus', 14)));
}

const pane = treePane({
  box: () => panel, tree: fileTree, openKey: 'docs.open', label: 'Docs', rootDrop: false, href: docsHref, current: () => shown, ordered: true,
  reload: () => load(),
  empty: 'No Docs yet: “+” on a section starts a doc or a folder.',
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
  const grip = h('div', { class: 'docs-resizer', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': 'Resize the Docs panel', title: 'Drag to resize · double-click to reset' });
  width.apply();
  wireResizer(grip, { ...width, cls: 'docs-resizing' });
  // On a phone, with a doc open, the trees fold away under one button, so the doc starts at the top of the screen
  const folds = isPhone() && !!shown;
  const page = h('div', { class: folds ? 'docs-page tree-folded' : 'docs-page' });
  const fold = folds ? h('button', { class: 'btn docs-fold', type: 'button', 'aria-expanded': 'false', onclick(e) {
    const open = !page.classList.toggle('tree-folded');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  } }, icon('foldertree', 16), 'Browse docs', icon('down', 14)) : null;
  page.replaceChildren(
    h('aside', { class: 'docs-panel', 'aria-label': 'Docs' }, h('h2', { class: 'docs-panel-title' }, icon('book', 16), 'Docs', fold), panel),
    grip, main);
  root.replaceChildren(page);
  const file = shown ? mountFiles(main, param, { href: docsHref }) : null;
  if (!file) {
    main.replaceChildren(h('div', { class: 'docs-empty' }, emptyState('Pick a doc on the left, or start a doc or a folder with “+” on a section.')));
  }
  pane.render();
  load().then(() => { if (shown && live) pane.reveal(shown); });
  return {
    update() { file?.update(); },
    unmount() { live = false; panel = null; return file?.unmount(); },
  };
}
