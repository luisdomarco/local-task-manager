// Graph (#/graph): every item and doc of the vault as a node, every link between them as an edge — its parent, its
// project, its link fields (plan, origin…), its typed relations (Blocked by, Precedes…) and the [[wikilinks]] in its
// text (tm/graph.py). #/graph/<ref> centres it on one node: what is within a few steps of it.
//
// As Obsidian's graph: the canvas fills the page under its title, grey nodes sized by their links, names that come in
// as you zoom, a hover lighting a node's ties in the accent. A panel floats over its top right (docs/design.md §3
// Graph), four folding sections:
//   Filters — a search (graphmodel.js nodeMatcher: words, type:, status:, path:, project:, -not), Closed, Orphans,
//             a project, the types and the kinds of link shown, and around a centre how many steps;
//   Groups  — colour by type, and groups: a search and a colour, the first that matches a node colouring it;
//   Display — arrows, the text fade threshold, node size, link thickness, and Animate (lay it out again);
//   Forces  — center, repel, link and distance (graphlayout.js forceOptions).
// All of it is kept per vault (prefs.js graph.view). Click a node to open it, double-click it to centre on it.
import { graphCanvas } from '../graphcanvas.js';
import { describe, graphNow, loadGraph } from '../graphdata.js';
import { FORCE_DEFAULTS } from '../graphlayout.js';
import { DOC_TYPE, EDGE_KINDS, filterGraph, nodeAddress, nodeByAddress, nodeMatcher } from '../graphmodel.js';
import { DEFAULT_KINDS, GROUP_COLORS, LOOK_DEFAULTS } from '../graphstyle.js';
import { docsHref } from '../filetree.js';
import { openItem } from '../panel.js';
import { pref, setPref } from '../prefs.js';
import { STRUCTURE, TYPE_DEFS } from '../rules.js';
import { setPageTitle } from '../tabtitle.js';
import { state } from '../state.js';
import { countOf, emptyLine, foldHead, h, icon, seg, select } from '../ui.js';

const KIND_LABEL = { parent: 'Parent', project: 'Project', link: 'Link fields', relation: 'Relations', mention: 'Mentions' };
const KIND_HELP = {
  parent: 'What each item hangs from (a story’s initiative, a task’s ticket)',
  project: 'The project each item lives in',
  link: 'Its link fields: plan, PRD, origin, fixed by…',
  relation: 'Its relations: Related to, Blocked by, Precedes…',
  mention: 'A [[link]] in its text to another item or doc',
};
const DEPTHS = [1, 2, 3];
const PREF = 'graph.view'; // per vault (prefs.js): its types and projects are its own
const SECTIONS = [['filters', 'Filters'], ['groups', 'Groups'], ['display', 'Display'], ['forces', 'Forces']];
const SLIDERS = {
  fade: ['Text fade threshold', 0, 1, 0.01],
  nodeSize: ['Node size', 0.4, 3, 0.05],
  linkWidth: ['Link thickness', 0.4, 3, 0.05],
  center: ['Center force', 0, 3, 0.05],
  repel: ['Repel force', 0, 4, 0.05],
  link: ['Link force', 0, 3, 0.05],
  distance: ['Link distance', 0.2, 4, 0.05],
};

const typeName = (t) => (t === DOC_TYPE ? 'Docs' : TYPE_DEFS[t]?.plural || t);
const typeLabel = (t) => (t === DOC_TYPE ? 'doc' : TYPE_DEFS[t]?.plural || t);
const narrow = () => window.matchMedia?.('(max-width: 640px)').matches;

/** The view as saved, every key filled in (a key new to this version takes its default). */
function loadSettings() {
  const s = pref(PREF, {}) || {};
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  return {
    hidden: new Set(s.hidden || []), // the types left out (a type new to the vault is shown)
    kinds: new Set((s.kinds || DEFAULT_KINDS).filter((k) => EDGE_KINDS.includes(k))),
    done: s.done ?? true,
    orphans: s.orphans ?? true,
    project: s.project || null,
    depth: s.depth || 2,
    query: s.query || '',
    colorBy: s.colorBy === 'type' ? 'type' : LOOK_DEFAULTS.colorBy,
    groups: Array.isArray(s.groups) ? s.groups.filter((g) => g && typeof g.q === 'string' && g.color) : [],
    arrows: s.arrows ?? LOOK_DEFAULTS.arrows,
    fade: num(s.fade, LOOK_DEFAULTS.fade),
    nodeSize: num(s.nodeSize, LOOK_DEFAULTS.nodeSize),
    linkWidth: num(s.linkWidth, LOOK_DEFAULTS.linkWidth),
    forces: { ...FORCE_DEFAULTS, ...(s.forces || {}) },
    panel: narrow() ? false : s.panel ?? true, // a phone opens it shut, whatever a wider screen left: the canvas first
    open: { filters: true, groups: false, display: false, forces: false, ...(s.open || {}) },
  };
}

export function mount(root, param) {
  const f = loadSettings();
  const save = () => setPref(PREF, {
    hidden: [...f.hidden], kinds: [...f.kinds], done: f.done, orphans: f.orphans, project: f.project, depth: f.depth, query: f.query,
    colorBy: f.colorBy, groups: f.groups, arrows: f.arrows, fade: f.fade, nodeSize: f.nodeSize, linkWidth: f.linkWidth,
    forces: f.forces, panel: f.panel, open: f.open,
  });
  const address = param ? decodeURIComponent(param) : null;

  /** The look the canvas draws: the groups' searches compiled once. */
  const look = () => ({
    colorBy: f.colorBy, arrows: f.arrows, fade: f.fade, nodeSize: f.nodeSize, linkWidth: f.linkWidth,
    groups: f.groups.filter((g) => g.q.trim()).map((g) => ({ color: g.color, match: nodeMatcher(g.q, { typeLabel }) })),
  });
  const canvas = graphCanvas({
    label: 'The vault as a graph',
    onOpen: (n) => {
      if (n.type === DOC_TYPE) { location.hash = docsHref(n.path); return; }
      const it = state.byId.get(n.id) || state.all.find((i) => i.key === n.id);
      if (it) openItem(it);
    },
    onFocus: (n) => { location.hash = `#/graph/${encodeURIComponent(nodeAddress(n))}`; },
    describe,
    look: look(),
    forces: f.forces,
  });

  const title = h('h1', {});
  const count = countOf(null, { plain: true, cls: 'view-count' });
  const back = h('a', { href: '#/graph', class: 'graph-back', hidden: true }, icon('back', 13), 'Whole vault');
  const empty = emptyLine('', { cls: 'graph-empty' });
  empty.hidden = true;
  const panel = h('aside', { class: 'graph-panel', 'aria-label': 'Graph settings' });
  const opener = h('button', {
    type: 'button', class: 'btn icon graph-panel-open', title: 'Graph settings', 'aria-label': 'Open the graph settings',
    onclick: () => { f.panel = true; save(); paintPanel(); },
  }, icon('sliders', 16));
  root.replaceChildren(h('div', { class: 'graph-page' },
    h('header', { class: 'view-head row' }, h('div', { class: 'view-title' }, title, count), back),
    h('div', { class: 'graph-stage' }, canvas.el, empty, panel, opener)));

  let graph = null; // the vault's, as fetched
  let shown = { nodes: [], edges: [] };
  let focus = null; // the node id the view is centred on
  let lastFilter = '';

  // ── the panel's parts ──
  const toggle = (on, label, aria = label) => h('button', {
    type: 'button', class: `vb-switch ${on ? 'on' : ''}`, role: 'switch', 'aria-checked': String(on), 'aria-label': aria,
  }, h('span', {}));
  /** A row: its name (a dot and a count where it has them) and a switch; the whole row flips it. */
  const switchRow = (label, on, set, { dot = null, n = null, tip = null } = {}) => {
    const sw = toggle(on, label);
    const row = h('label', { class: 'gp-row gp-switch', title: tip },
      dot ? h('span', { class: 'gp-dot', style: `background:${dot}` }) : null,
      h('span', { class: 'gp-name' }, label), n != null ? countOf(n, { plain: true, cls: 'gp-n' }) : null, sw);
    row.addEventListener('click', (e) => { e.preventDefault(); set(!on); });
    return row;
  };
  /** A slider: its name above, its value at the left of the track, as Obsidian's. `live` runs while dragging. */
  const slider = (key, value, live) => {
    const [label, min, max, step] = SLIDERS[key];
    const out = h('span', { class: 'gp-val' }, value.toFixed(2));
    const input = h('input', { type: 'range', class: 'gp-range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
    const fill = () => input.style.setProperty('--p', `${((Number(input.value) - min) / (max - min)) * 100}%`);
    fill();
    input.addEventListener('input', () => { out.textContent = Number(input.value).toFixed(2); fill(); live(Number(input.value)); });
    input.addEventListener('change', save);
    return h('div', { class: 'gp-slider' }, h('div', { class: 'gp-label' }, label), h('div', { class: 'gp-track' }, out, input));
  };
  const sub = (text) => h('div', { class: 'gp-sub' }, text);

  function section(key, label, body, actions = []) {
    const open = f.open[key];
    const head = h('div', { class: 'gp-head' },
      foldHead({ open, title: label, class: 'gp-fold', onToggle: (next) => { f.open[key] = next; save(); paintPanel(); } }),
      ...actions);
    return h('section', { class: `gp-section ${open ? 'open' : ''}` }, head, open ? h('div', { class: 'gp-body' }, ...body) : null);
  }

  // The search keeps its box (and the caret) across repaints: only the graph is drawn again as you type.
  const searchInput = h('input', {
    type: 'search', class: 'gp-search-input', placeholder: 'Search…', value: f.query, 'data-filter': '',
    'aria-label': 'Search the graph', title: 'Words to find; type:story, status:done, path:Docs/, project:ACME; -word to leave out',
  });
  const clearSearch = h('button', {
    type: 'button', class: 'gp-clear', title: 'Clear the search', 'aria-label': 'Clear the search', hidden: !f.query,
    onclick: () => { searchInput.value = ''; onSearch(); searchInput.focus(); },
  }, icon('x', 11));
  let searchTimer = 0;
  function onSearch() {
    f.query = searchInput.value;
    clearSearch.hidden = !f.query;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { save(); paint(true); }, 140);
  }
  searchInput.addEventListener('input', onSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchInput.value) { e.stopPropagation(); searchInput.value = ''; onSearch(); }
    if (e.key === 'Enter' && shown.nodes.length === 1) { // one left: centre on it
      e.preventDefault(); location.hash = `#/graph/${encodeURIComponent(nodeAddress(shown.nodes[0]))}`;
    }
  });
  const searchBox = h('label', { class: 'gp-search' }, icon('search', 14), searchInput, clearSearch);

  function filtersBody() {
    const counts = new Map();
    for (const n of graph?.nodes || []) counts.set(n.type, (counts.get(n.type) || 0) + 1);
    const order = [...STRUCTURE.types.map((t) => t.name), DOC_TYPE];
    const types = order.filter((t) => counts.has(t)).concat([...counts.keys()].filter((t) => !order.includes(t)));
    const projects = (graph?.nodes || []).filter((n) => n.type === 'project').sort((a, b) => a.title.localeCompare(b.title));
    if (f.project && !projects.some((p) => p.id === f.project)) f.project = null;
    const cs = getComputedStyle(document.documentElement);
    const dot = (t) => cs.getPropertyValue(`--t-${t}`).trim() || 'var(--muted-foreground)';
    const set = (fn) => (v) => { fn(v); save(); paint(true); };
    return [
      searchBox,
      switchRow('Closed items', f.done, set((v) => { f.done = v; }), { tip: 'Show closed items too' }),
      switchRow('Orphans', f.orphans, set((v) => { f.orphans = v; }), { tip: 'Show what is tied to nothing on show' }),
      projects.length ? h('div', { class: 'gp-row' }, h('span', { class: 'gp-name' }, 'Project'),
        select([[null, 'Every project'], ...projects.map((p) => [p.id, p.title, 'folder'])], f.project,
          (v) => { f.project = v; save(); paint(true); }, { class: 'small', 'aria-label': 'Project' })) : null,
      focus ? h('div', { class: 'gp-row' }, h('span', { class: 'gp-name' }, 'Steps from the centre'),
        seg(DEPTHS.map((d) => [d, String(d)]), f.depth, (d) => { f.depth = d; save(); paint(true); }, { aria: 'Steps from the centre' })) : null,
      sub('Types'),
      h('div', { class: 'gp-chips', role: 'group', 'aria-label': 'Types' }, ...types.map((t) => {
        const on = !f.hidden.has(t);
        return h('button', {
          type: 'button', class: `gp-chip ${on ? 'on' : ''}`, 'aria-pressed': String(on), title: on ? `Hide ${typeName(t)}` : `Show ${typeName(t)}`,
          onclick: () => set((v) => { v ? f.hidden.delete(t) : f.hidden.add(t); })(!on),
        }, h('span', { class: 'gp-dot', style: `background:${dot(t)}` }), typeName(t), countOf(counts.get(t), { plain: true, cls: 'gp-n' }));
      })),
      sub('Links'),
      ...EDGE_KINDS.map((k) => switchRow(KIND_LABEL[k], f.kinds.has(k), set((v) => { v ? f.kinds.add(k) : f.kinds.delete(k); }), { tip: KIND_HELP[k] })),
    ].filter(Boolean);
  }

  function groupsBody() {
    const relook = () => { save(); canvas.setLook(look()); };
    return [
      switchRow('Colour by type', f.colorBy === 'type', (v) => { f.colorBy = v ? 'type' : 'none'; relook(); paintPanel(); }),
      ...f.groups.map((g, i) => {
        const q = h('input', { type: 'text', class: 'gp-group-q', value: g.q, placeholder: 'Search… (type:story, path:Docs/)', 'aria-label': `Group ${i + 1}: what it holds` });
        q.addEventListener('input', () => { g.q = q.value; canvas.setLook(look()); });
        q.addEventListener('change', save);
        return h('div', { class: 'gp-group' },
          h('button', {
            type: 'button', class: 'gp-swatch', style: `background:${g.color}`, title: 'Another colour', 'aria-label': `Group ${i + 1}: another colour`,
            onclick: () => { g.color = GROUP_COLORS[(GROUP_COLORS.indexOf(g.color) + 1) % GROUP_COLORS.length]; relook(); paintPanel(); },
          }),
          q,
          h('button', {
            type: 'button', class: 'btn icon small', title: 'Remove this group', 'aria-label': `Remove group ${i + 1}`,
            onclick: () => { f.groups.splice(i, 1); relook(); paintPanel(); },
          }, icon('x', 12)));
      }),
      h('button', {
        type: 'button', class: 'btn block gp-wide',
        onclick: () => {
          f.groups.push({ q: '', color: GROUP_COLORS[f.groups.length % GROUP_COLORS.length] });
          save(); paintPanel();
          panel.querySelector('.gp-group:last-of-type .gp-group-q')?.focus();
        },
      }, 'New group'),
    ];
  }

  function displayBody() {
    const live = (key) => (v) => { f[key] = v; canvas.setLook({ [key]: v }); };
    return [
      switchRow('Arrows', f.arrows, (v) => { f.arrows = v; save(); canvas.setLook({ arrows: v }); paintPanel(); }),
      slider('fade', f.fade, live('fade')),
      slider('nodeSize', f.nodeSize, live('nodeSize')),
      slider('linkWidth', f.linkWidth, live('linkWidth')),
      h('div', { class: 'gp-actions' }, h('button', { type: 'button', class: 'btn small', onclick: () => canvas.animate() }, 'Animate')),
    ];
  }

  function forcesBody() {
    const live = (key) => (v) => { f.forces[key] = v; canvas.setForces({ [key]: v }); };
    return ['center', 'repel', 'link', 'distance'].map((k) => slider(k, f.forces[k], live(k)));
  }

  function reset() {
    const d = loadSettingsFrom({});
    Object.assign(f, { ...d, panel: true, open: f.open });
    searchInput.value = '';
    clearSearch.hidden = true;
    save();
    canvas.setLook(look());
    canvas.setForces(f.forces);
    paint(true);
  }

  function paintPanel() {
    panel.hidden = !f.panel;
    opener.hidden = f.panel;
    if (!f.panel) return;
    const keepFocus = document.activeElement === searchInput;
    const bodies = { filters: filtersBody, groups: groupsBody, display: displayBody, forces: forcesBody };
    const scroll = panel.scrollTop;
    panel.replaceChildren(...SECTIONS.map(([key, label]) => section(key, label, f.open[key] ? bodies[key]() : [],
      key === 'filters' ? [
        h('button', { type: 'button', class: 'btn icon small', title: 'Reset every setting', 'aria-label': 'Reset every graph setting', onclick: reset }, icon('reset', 14)),
        h('button', { type: 'button', class: 'btn icon small', title: 'Close the settings', 'aria-label': 'Close the graph settings', onclick: () => { f.panel = false; save(); paintPanel(); } }, icon('x', 14)),
      ] : [])));
    panel.scrollTop = scroll;
    if (keepFocus) searchInput.focus();
  }

  /** Draw what passes the filters; `refit` frames it again (a filter changed), else the view stays (a reload). */
  function paint(refit = false) {
    if (!graph) return;
    const at = address ? nodeByAddress(graph, address) : null;
    focus = at?.id || null;
    const sig = JSON.stringify([focus, [...f.hidden], [...f.kinds], f.done, f.orphans, f.project, f.depth, f.query]);
    const changed = sig !== lastFilter;
    lastFilter = sig;
    const types = new Set(graph.nodes.map((n) => n.type).filter((t) => !f.hidden.has(t)));
    shown = filterGraph(graph, { types, kinds: f.kinds, done: f.done, orphans: f.orphans, project: f.project, focus, depth: f.depth, query: f.query });
    canvas.setGraph(shown, { focus, refit: refit || changed });
    paintPanel();
    const n = shown.nodes.length;
    const m = shown.edges.length;
    title.textContent = at ? at.title : 'Graph';
    setPageTitle(at ? `${at.title} · Graph` : 'Graph');
    back.hidden = !at;
    count.textContent = `${n} ${n === 1 ? 'node' : 'nodes'} · ${m} ${m === 1 ? 'link' : 'links'}${at && at.ref !== at.title ? ` · around ${at.ref}` : ''}`;
    empty.hidden = !!n;
    empty.textContent = address && !at ? `Nothing in this vault is called ${address}.`
      : f.query ? `Nothing matches “${f.query}”.` : 'Nothing to show: the filters leave every node out.';
  }

  const take = (g) => { if (g !== graph) { graph = g; paint(false); } };
  paintPanel();
  if (graphNow()) take(graphNow());
  const fetchIt = () => loadGraph().then(take, () => { empty.hidden = false; empty.textContent = 'The graph could not be loaded.'; });
  fetchIt();

  return {
    update: fetchIt, // the items reloaded (an edit, here or outside): the graph again, the view where it was
    unmount: () => { clearTimeout(searchTimer); canvas.destroy(); },
  };
}

/** Every setting at its default (Filters → ↺). */
function loadSettingsFrom(s) {
  return {
    hidden: new Set(s.hidden || []), kinds: new Set(DEFAULT_KINDS), done: true, orphans: true, project: null, depth: 2, query: '',
    colorBy: LOOK_DEFAULTS.colorBy, groups: [], arrows: LOOK_DEFAULTS.arrows, fade: LOOK_DEFAULTS.fade,
    nodeSize: LOOK_DEFAULTS.nodeSize, linkWidth: LOOK_DEFAULTS.linkWidth, forces: { ...FORCE_DEFAULTS },
  };
}
