// Entry point: hash router, sidebar (type links + counts + initiatives), keyboard shortcuts.
import { addMenu } from './create.js';
import { closePalette, openPalette, paletteIsOpen } from './palette.js';
import { closeItem, hasUnsaved, isExpanded, isOpen, openItem, renderPanel } from './panel.js';
import { renderPinbar, setBarTitle } from './pinbar.js';
import { initSidebar, onSidebarMode, setSidebarMode, sidebarMode, syncSidebarMode, toggleSidebar, revealActiveLink } from './sidebar.js';
import { handleItemKey } from './itemkeys.js';
import { initExplorer } from './explorer.js';
import { filesHref } from './filetree.js';
import { restoreTerms } from './term.js';
import { openQuickModal } from './quickadd.js';
import { STRUCTURE, anyStatusRank, carriedOverDay, carriedOverWeek, hasPage, inSomeProject, isDone, isEnabled, isPlannedToday, isPlannedWeek, onStructure } from './rules.js';
import { shiftWeek, thisWeek, weekDays } from './dates.js';
import { byType, createVaultFolders, firstLoad, onChange, progress, reload, saveSidebarOrder, state, toast } from './state.js';
import { cssKey, h, icon, menuIsOpen, select, typeIcon } from './ui.js';
import { lastTab, sectionOf, sectionRoutes, sections, setTabCounts } from './sections.js';
import { switchVault, vaultId } from './vault.js';
import { pageHref } from './datatable.js';
import { GO } from './shortcuts.js';
import { initMentions } from './mentions.js';
import { initTheme } from './theme.js';
import * as board from './views/board.js';
import * as files from './views/files.js';
import * as find from './views/find.js';
import { filesUnsaved } from './views/files.js';
import { pageView } from './views/detail.js';
import * as inbox from './views/inbox.js';
import { boardTypes, listView } from './views/list.js';
import * as log from './views/log.js';
import { contacts, labels } from './views/tags.js';
import { setPageTitle } from './tabtitle.js';
import * as trash from './views/trash.js';
import * as settings from './views/settings.js';
import * as table from './views/table.js';
import * as today from './views/today.js';
import * as week from './views/week.js';
import { nextWeek as nextweek } from './views/week.js';
import * as month from './views/month.js';
import * as docs from './views/docs.js';
import * as canvas from './views/canvases.js';
import * as graph from './views/graph.js';
import * as goals from './views/goals.js';
import * as runs from './views/runs.js';
import { initAgents } from './agentspane.js';
import { refOf } from './shownid.js';
import { applyView, isShowing, onSavedViews, removeView, restoreView, savedViews } from './savedviews.js';

// The views every vault has; each type of the vault's structure adds its list (#/<route>), and its page
// (#/<type>/<ref>) when it has one.
const FIXED_VIEWS = { inbox, today, week, nextweek, month, board, table, log, labels, contacts, trash, settings, files, find, docs, canvas, graph, runs };
// What the browser tab calls each of them (tabtitle.js); a type's list is its plural, an item's page the item's title.
const FIXED_TITLES = {
  inbox: 'Inbox', today: 'Today', week: 'Week', nextweek: 'Next week', month: 'Month', board: 'Board', table: 'List', log: 'Work log',
  labels: 'Labels', contacts: 'Contacts', trash: 'Trash', settings: 'Settings', files: 'Explorer', find: 'Search', docs: 'Docs', canvas: 'Canvas', graph: 'Graph',
  runs: 'Agents',
};
let VIEW_TITLES = { ...FIXED_TITLES };
let VIEWS = FIXED_VIEWS;
// The list an item's address (#/item/ID) opens over: its type's.
let LIST_OF = {};
let FIRST_LIST = 'tasks'; // for an address whose item is not there: the first type's list
// An item's page lights up its type's list in the sidebar (an initiative's, Initiatives).
let NAV_OF = {};
// The sidebar's count of each type with a link: all of them, or the open ones. Today shows its count even at 0
// ("nothing left today" is news too), and so do the types whose link says so (Inbox, Activity); the rest — the weeks,
// the month — only when there is something.
let COUNTED = [];
const ALWAYS_COUNTED = new Set(['today']);

onStructure((s) => {
  VIEWS = {
    ...FIXED_VIEWS,
    // A type's list, at its route; Projects' goals have a view of their own (views/goals.js: each goal and what it holds).
    ...Object.fromEntries(s.types.filter((t) => t.list).map((t) => [t.route, t.name === 'goal' ? goals : listView(t.name)])),
    ...Object.fromEntries(s.types.filter((t) => t.page).map((t) => [t.name, pageView(t.name)])),
  };
  LIST_OF = Object.fromEntries(s.types.map((t) => [t.name, t.route]));
  VIEW_TITLES = {
    ...FIXED_TITLES,
    ...Object.fromEntries(s.types.filter((t) => t.list).map((t) => [t.route, t.plural])),
    ...Object.fromEntries(s.types.filter((t) => t.page).map((t) => [t.name, t.label])), // until the item has loaded
  };
  FIRST_LIST = s.types[0]?.route || 'today';
  NAV_OF = Object.fromEntries(s.types.filter((t) => t.page).map((t) => [t.name, t.route]));
  COUNTED = s.types.filter((t) => t.nav && t.counted).map((t) => [t.route, t.name, t.counted]);
  for (const t of s.types) if (t.nav?.always) ALWAYS_COUNTED.add(t.route);
  renderNav(s);
});

// A function declaration, not a const: onStructure draws the nav as soon as it is registered, above this line.
function DOCS_LINK() {
  return h('a', { href: '#/docs', 'data-view': 'docs', title: 'Docs — the vault\'s documents (⌘⇧D)' }, icon('book', 16), 'Docs');
}
// Canvas (views/canvases.js): every canvas of the vault, right after Docs (they are files in Docs/Canvases).
function CANVAS_LINK() {
  return h('a', { href: '#/canvas', 'data-view': 'canvas', title: 'Canvas — every whiteboard of the vault' }, icon('canvas', 16), 'Canvas');
}

/** Each type's link, in its nav group's box (index.html), by its order there, with a line where its `section`
 *  changes. Only between links that are there: a type the vault turned off leaves no line of its own. */
function renderNav(s) {
  const inSection = sectionRoutes();
  for (const box of document.querySelectorAll('[data-nav-group]')) {
    const types = s.types.filter((t) => t.nav?.group === box.dataset.navGroup && !inSection.has(t.route)).sort((a, b) => a.nav.order - b.nav.order);
    box.replaceChildren(...types.flatMap((t, i) => [
      i && t.nav.section !== types[i - 1].nav.section ? h('div', { class: 'nav-sep', role: 'separator' }) : null,
      h('a', { href: `#/${t.route}`, 'data-view': t.route }, icon(t.icon, 16), t.plural, h('span', { class: 'count', 'data-count': t.route })),
      // Docs (views/docs.js) — documents, not a type — sits under Notes, ending their section; Canvas right after it
      ...(t.name === 'note' ? [DOCS_LINK(), CANVAS_LINK()] : []),
    ]).filter(Boolean));
    if (box.dataset.navGroup === 'types' && !types.some((t) => t.name === 'note')) box.append(DOCS_LINK(), CANVAS_LINK());
    // Then the structure's sections (Meetings, Brief…), one link each after a line; renderSidebar points each at its tab.
    if (box.dataset.navGroup === 'types') {
      box.append(...(s.sections || []).flatMap((sec, i) => [i ? null : h('div', { class: 'nav-sep', role: 'separator' }),
        h('a', { href: '#/', 'data-view': `section-${sec.key}`, 'data-section': sec.key }, icon(sec.icon, 16), sec.label)]).filter(Boolean));
    }
  }
}
/** A type that lives in a project's folder has no link while no project of the vault may hold it (rules.js
 *  inSomeProject: a vault of simple projects lists no stories) and the vault has none; a line between sections goes
 *  with the links around it. */
function hideHomelessTypes() {
  for (const box of document.querySelectorAll('[data-nav-group]')) {
    for (const t of STRUCTURE.types) {
      const a = t.nav && box.querySelector(`a[data-view="${t.route}"]`);
      if (a) a.hidden = !inSomeProject(t.name, state.all) && !state.all.some((i) => i.type === t.name); // its items stay reachable
    }
    // A section's link goes to the tab it was left on; with no tab left (none of its types here), it is not there.
    const shown = sections();
    for (const a of box.querySelectorAll('a[data-section]')) {
      const sec = shown.find((x) => x.key === a.dataset.section);
      a.hidden = !sec;
      if (sec) a.href = `#/${lastTab(sec)}`;
    }
    // A line only between links shown: one where sections meet, none at either end.
    let before = false;
    let pending = null;
    for (const el of box.children) {
      if (el.classList.contains('nav-sep')) { el.hidden = true; if (before) pending = el; continue; }
      if (el.hidden) continue;
      if (pending) pending.hidden = false;
      pending = null;
      before = true;
    }
  }
}
let current = null;
let currentRoute = null;

// A vault whose folder does not match its structure shows only what does not match (and the fix, when there
// is one): no list, no item, no count of it. Settings stays reachable, to point the vault elsewhere; and in the
// Explorer, its files, which need nothing of the structure (any other address there goes to the vault's root).
const vaultBlocked = () => !!state.vaultCheck && !state.vaultCheck.ok;
let noticeShown = false;

function showVaultNotice() {
  const v = state.vault || {};
  const c = state.vaultCheck;
  const structure = (state.config.structures || {})[v.structure] || v.structure || '';
  const fix = c.can_create_folders
    ? h('button', { class: 'btn primary', onclick: () => createVaultFolders().then(() => toast('Folders created')).catch(() => {}) },
      icon('plus', 14), c.missing_folders.length === 1 ? 'Create the missing folder' : `Create the ${c.missing_folders.length} missing folders`)
    : null;
  const root = document.getElementById('view');
  root.className = 'view-vault-notice';
  root.replaceChildren(h('section', { class: 'vault-notice', role: 'alert' },
    h('h1', {}, `${v.name || 'This vault'} does not match its structure`),
    h('p', { class: 'muted' }, `Its folder does not have the shape of the ${structure} structure, so nothing of it is shown and nothing is written to it until it does.`),
    h('p', { class: 'mono small' }, v.root || v.path || ''),
    // The likeliest cause first: the folder is a vault of another structure (the wrong one picked, or two folders
    // swapped between vaults). Then what does not match, folded: it is long, and it only restates that.
    ...(state.vaultMatches.length ? [
      h('p', { class: 'vault-match' }, icon('alert', 14),
        `This folder holds a vault of the ${state.vaultMatches.map((m) => m.label).join(' or ')} structure. If that is what it is, pick ${state.vaultMatches[0].label} for “${v.name}” in Settings → Vaults, or point this vault at another folder.`),
      h('details', {}, h('summary', {}, `What does not match the ${structure} structure (${c.blocking.length})`),
        h('ul', { class: 'vault-findings' }, c.blocking.map((f) => h('li', {}, h('code', {}, f.path), h('span', {}, f.detail))))),
    ] : [h('ul', { class: 'vault-findings' }, c.blocking.map((f) => h('li', {}, h('code', {}, f.path), h('span', {}, f.detail))))]),
    c.can_create_folders ? h('p', { class: 'muted small' }, 'Creating the folders touches no file: it only adds the empty folders the structure expects.') : null,
    h('div', { class: 'vault-notice-actions' }, fix, h('a', { class: 'btn', href: '#/settings/vaults' }, 'Vaults in Settings'))));
  noticeShown = true;
}

async function route() {
  // An address followed while the page still loads (its vault's structure names the views: a project's page…)
  // waits for it, rather than being sent home as a view that does not exist.
  await firstLoad;
  const [, name, param] = location.hash.match(/^#\/(\w+)(?:\/(.+))?/) || [];
  const explorerOnly = vaultBlocked() && sidebarMode() === 'explorer';
  if (explorerOnly && !['settings', 'files', 'find'].includes(name)) { location.replace(filesHref('')); return; }
  // Settings and the Agents section are not about the vault: they open whatever it holds.
  if (vaultBlocked() && !explorerOnly && name !== 'settings' && name !== 'runs') {
    if (current?.unmount) await current.unmount();
    current = null;
    currentRoute = null; // whatever was asked for mounts afresh once the vault matches
    showVaultNotice();
    renderSidebar();
    renderPinbar();
    return;
  }
  // An item's address (#/item/TSK-1, links.js; #/task/… from before): its list, with its card open on top.
  if ((name === 'item' || name === 'task') && param) {
    const ref = decodeURIComponent(param);
    // By its id or key, its ref (TSK-482), or an id it had before (an old link: ACME-INI-001, in its aliases).
    const it = state.byId.get(ref) || state.all.find((i) => i.key === ref || i.ref === ref || (i.aliases || []).includes(ref));
    if (hasPage(it)) { location.replace(pageHref(it)); return; }
    history.replaceState(null, '', `#/${LIST_OF[it?.type] || FIRST_LIST}`);
    await route();
    openItem(it || ref); // an unknown one says so (toast) over the list
    return;
  }
  // A view whose items this vault turned off (the Board shows a type with a status; the day views, what can be planned) goes home.
  // A type turned off has no list or page view at all.
  const planning = STRUCTURE.types.some((t) => t.plannable);
  const off = (name === 'board' && !boardTypes().length) || (['today', 'week', 'nextweek', 'month'].includes(name) && !planning);
  if (name === 'people') { location.replace('#/contacts'); return; } // People is Contacts' first tab (TSK-050)
  if (name === 'tomorrow') { location.replace('#/week'); return; } // Tomorrow is gone: an old link lands on its week
  if (!VIEWS[name] || off) { location.hash = planning ? '#/today' : '#/table'; return; }
  const key = `${name}/${param || ''}`;
  if (key === currentRoute) return;
  currentRoute = key;
  if (current?.unmount) await current.unmount();
  const root = document.getElementById('view');
  root.className = `view-${name}`;
  document.getElementById('main').scrollTop = 0;
  setPageTitle(VIEW_TITLES[name] || '');
  current = VIEWS[name].mount(root, param);
  const own = NAV_OF[name] || name;
  const sec = sectionOf(own);
  const nav = sec ? `section-${sec.key}` : own; // a tab lights up its section's link
  document.querySelectorAll('[data-view]').forEach((a) => {
    a.classList.toggle('active', a.dataset.view === nav);
    if (a.dataset.view === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  revealActiveLink();
  renderSavedViews(); // which saved view (if any) the page now shows
  current.update();
  setBarTitle(root.querySelector(':scope > .view-head h1')?.textContent || VIEW_TITLES[name] || ''); // a phone's top bar
  renderSidebar();
  renderPinbar();
}

// The vault picker at the foot of the sidebar. Built again only when the vaults change: rebuilding it on every
// render would close its menu under the pointer.
let vaultSwitchSig = '';
function renderVaultSwitch() {
  const box = document.getElementById('vault-switch');
  const vaults = state.config.vaults || [];
  const sig = JSON.stringify([vaultId(), vaults.map((v) => [v.id, v.name, v.structure])]);
  if (!box || sig === vaultSwitchSig) return;
  vaultSwitchSig = sig;
  // A vault of a legacy structure (Initiatives, Tasks) works as ever; one quiet line says it can be moved to
  // Projects, and its row in Settings → Vaults says how (settings.js legacyNote).
  const shown = vaults.find((v) => v.id === vaultId());
  const legacy = shown && (state.config.legacy_structures || []).includes(shown.structure);
  box.replaceChildren(select(vaults.map((v) => [v.id, v.name, 'folder']), vaultId(), (id) => switchVault(id),
    { class: 'small vault-select', 'aria-label': 'Vault', title: 'The vault this page shows' }),
  legacy ? h('a', { class: 'vault-legacy-hint small', href: '#/settings/vaults',
    title: `${(state.config.structures || {})[shown.structure] || shown.structure} is a legacy structure: see how to move this vault to Projects` },
  icon('alert', 12), 'Legacy · move to Projects') : '');
}

function renderSidebar() {
  const days = weekDays(thisWeek());
  const next = shiftWeek(thisWeek(), 1);
  const nextDays = weekDays(next);
  const counts = {
    // Archived items are left out of byType: the prompts counted are the active ones.
    ...Object.fromEntries(COUNTED.map(([route, type, counted]) => [route, byType(type).filter((i) => counted === 'all' || !isDone(i)).length])),
    today: state.items.filter((i) => (isPlannedToday(i) || carriedOverDay(i)) && !isDone(i)).length,
    // What the Week view lists: planned for the week or one of its days, plus what is carried over from past weeks.
    week: state.items.filter((i) => !isDone(i) && (isPlannedWeek(i) || days.includes(i.fields.plan_day) || carriedOverWeek(i))).length,
    nextweek: state.items.filter((i) => !isDone(i) && (isPlannedWeek(i, next) || nextDays.includes(i.fields.plan_day))).length,
    month: month.openCount(),
    trash: state.trash.length + state.trashedFiles.length,
  };
  for (const [k, n] of Object.entries(counts)) {
    const el = document.querySelector(`[data-count="${k}"]`);
    if (el) el.textContent = vaultBlocked() ? '' : n || ALWAYS_COUNTED.has(k) ? String(n) : '';
  }
  // A section's tabs count what each holds: Planning's, what is planned there (as above); a type's, its open items.
  const tabCounts = { week: counts.week, nextweek: counts.nextweek, month: counts.month };
  for (const sec of sections()) {
    for (const t of sec.tabs) if (t.type) tabCounts[t.route] = byType(t.type).filter((i) => !isDone(i)).length;
  }
  setTabCounts(vaultBlocked() ? {} : tabCounts);
  renderVaultSwitch();
  // Favourites: the initiatives starred on their page (a new one is not; a file from before without the key is), in the
  // order dragged there, then the ones never placed, by status: closed first, then under way, then not started (as the
  // vault groups them).
  const rank = (i) => { const r = anyStatusRank(i.fields.status || 'Backlog'); return r >= 1000 ? Infinity : -r; };
  const placed = (i) => { const r = state.sidebar.indexOf(i.id); return r < 0 ? Infinity : r; };
  const inis = byType('initiative').filter((i) => i.id && i.fields.sidebar !== false)
    .sort((a, b) => (placed(a) - placed(b)) || rank(a) - rank(b) || a.title.localeCompare(b.title));
  const ids = inis.map((i) => i.id);
  const move = (from, to) => {
    if (to < 0 || to >= ids.length || to === from) return;
    const next = ids.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    // Hidden initiatives keep their place for when they come back.
    saveSidebarOrder([...next, ...state.sidebar.filter((id) => !next.includes(id))]);
  };
  const box = document.getElementById('side-initiatives');
  // A vault with initiatives turned off has no Favourites section; the Board (tasks) and the day views (what can be
  // planned) go when what they show is turned off too.
  document.getElementById('side-favs').hidden = !isEnabled('initiative');
  renderSavedViews();
  document.querySelector('#sidebar a[data-view="board"]').hidden = !boardTypes().length;
  document.querySelector('#sidebar a[data-view="today"]').hidden = !STRUCTURE.types.some((t) => t.plannable);
  // Planning goes to the tab it was left on (sections.js), and is not there where nothing can be planned.
  const planning = sections().find((s) => s.key === 'planning');
  const planLink = document.querySelector('#sidebar a[data-section="planning"]');
  planLink.hidden = !planning;
  if (planning) planLink.href = `#/${lastTab(planning)}`;
  hideHomelessTypes();
  wireSidebarDrop(box, move);
  box.replaceChildren(...(inis.length ? inis.map((i, idx) => {
    const p = progress(i.id);
    const href = pageHref(i);
    const status = i.fields.status || 'Backlog';
    const el = h('a', {
      class: `side-ini ${location.hash === href ? 'active' : ''}`, href, draggable: 'true', 'data-id': i.id,
      title: `${i.title}\n${refOf(i)} · ${status} · ${p.done}/${p.total} tasks — drag (or Shift+↑/↓) to reorder`, 'aria-label': `${i.title}, ${status}, ${p.pct}% closed`,
      onkeydown: (e) => {
        if (!e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        move(idx, idx + (e.key === 'ArrowUp' ? -1 : 1));
      },
    },
    h('span', { class: 'ini-title' }, i.title),
    h('span', { class: `ring s-${cssKey(status)}`, style: `--pct:${p.pct}` }));
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.clearData(); // not the link's URL: the pin bar would take it for a card
      e.dataTransfer.setData(SIDE_MIME, String(idx));
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => el.classList.add('dragging'));
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    return el;
  }) : [h('p', { class: 'muted small' }, 'No favourites — star an initiative on its page.')]));
}

/** Views: the ones saved from a list's bar (savedviews.js), each a link to its page drawn as it was saved; × forgets it
 *  (with Undo). The section shows while there are favourites or views. */
function renderSavedViews() {
  const views = savedViews();
  const box = document.getElementById('side-views');
  document.getElementById('side-views-box').hidden = !views.length;
  box.closest('.side-section').hidden = !views.length && document.getElementById('side-favs').hidden;
  const iconOf = (route) => {
    const r = route.replace(/^#\//, '').split(/[/?]/)[0];
    if (r === 'board') return icon('kanban', 15);
    if (r === 'table') return icon('table', 15);
    const t = STRUCTURE.types.find((x) => x.route === r);
    return t ? typeIcon(t.name, 15) : icon('list', 15);
  };
  box.replaceChildren(...views.map((v) => {
    const open = (e) => {
      if (e.metaKey || e.ctrlKey || e.button === 1) return; // a new tab opens the page as it is
      e.preventDefault();
      applyView(v);
      if (location.hash === v.route) { currentRoute = null; route(); } else location.hash = v.route; // its page mounts afresh, reading it
      renderSavedViews();
    };
    const drop = (e) => {
      e.preventDefault(); e.stopPropagation();
      const gone = removeView(v.id);
      if (gone) toast(`Removed the view “${v.name}”`, false, { label: 'Undo', run: () => restoreView(gone) });
    };
    return h('a', { class: `side-ini side-view ${isShowing(v) ? 'active' : ''}`, href: v.route, title: `${v.name} — the saved view`, onclick: open },
      h('span', { class: 'side-view-ico', 'aria-hidden': 'true' }, iconOf(v.route)),
      h('span', { class: 'ini-title' }, v.name),
      h('button', { type: 'button', class: 'btn icon small side-view-x', title: 'Remove this view', 'aria-label': `Remove the view ${v.name}`, onclick: drop }, icon('x', 12)));
  }));
}
onSavedViews(renderSavedViews);

// Sidebar initiatives reorder by dragging: a line shows where the dragged one will land.
const SIDE_MIME = 'application/x-tm-side';
let sideMove = null; // the latest render's move(from, to); the listeners are wired once
function wireSidebarDrop(box, move) {
  sideMove = move;
  if (box.dataset.wired) return;
  box.dataset.wired = '1';
  const isSideDrag = (e) => [...e.dataTransfer.types].includes(SIDE_MIME);
  const marker = h('div', { class: 'side-marker', 'aria-hidden': 'true' });
  const slot = (e) => {
    const rows = [...box.querySelectorAll('.side-ini')];
    const i = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
    return { rows, index: i < 0 ? rows.length : i };
  };
  box.addEventListener('dragover', (e) => {
    if (!isSideDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const { rows, index } = slot(e);
    const ref = rows[index] || null;
    if (ref ? marker.nextSibling !== ref : marker !== box.lastChild) box.insertBefore(marker, ref);
  });
  box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) marker.remove(); });
  box.addEventListener('drop', (e) => {
    if (!isSideDrag(e)) return;
    e.preventDefault();
    marker.remove();
    const from = Number(e.dataTransfer.getData(SIDE_MIME));
    let to = slot(e).index;
    if (to > from) to -= 1;
    if (Number.isInteger(from)) sideMove(from, to);
  });
  box.addEventListener('dragend', () => marker.remove());
}

function renderAll() {
  const onSettings = /^#\/(settings|runs)(\/|$)/.test(location.hash);
  if (state.error) {
    document.getElementById('view').replaceChildren(h('div', { class: 'empty error' },
      `Cannot load items: ${state.error}. Check the vault in Settings.`));
  } else if (vaultBlocked() && !onSettings && !(sidebarMode() === 'explorer' && /^#\/(files|find)(\/|$)/.test(location.hash))) {
    route();
    return;
  } else if (noticeShown) {
    noticeShown = false; // it matches now: the view that was asked for, mounted afresh
    route();
    return;
  } else if (current) {
    current.update();
  }
  renderSidebar();
  renderPinbar();
  if (isOpen()) renderPanel(); // restores focus itself
}

// ── keyboard ─────────────────────────────────────────────────────────────────
let pendingG = false;
document.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) { e.preventDefault(); openPalette(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === '\\' && !e.shiftKey && !e.altKey) { e.preventDefault(); toggleSidebar(); return; }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'e' && !e.altKey) { e.preventDefault(); toggleSidebar(false); setSidebarMode(); return; }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd' && !e.altKey) { e.preventDefault(); location.hash = '#/docs'; return; }
  if (e.key === 'Escape') {
    if (paletteIsOpen()) { closePalette(); return; }
    if (menuIsOpen() || !document.getElementById('modal-backdrop').hidden) return;
    if (isOpen()) closeItem();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (pendingG) { pendingG = false; if (GO[e.key]) { location.hash = `#/${GO[e.key]}`; } return; }
  if (e.key === 'g') { pendingG = true; setTimeout(() => { pendingG = false; }, 1000); return; }
  if (handleItemKey(e)) return; // x · t · w · s · p on the open card, or the card or row focused or under the pointer
  if (e.key === 'q') { e.preventDefault(); openQuickModal(); }
  if (e.key === '/') {
    const f = document.querySelector('#view [data-filter], #view .qa-input');
    if (f) { e.preventDefault(); f.focus(); }
  }
});

const addBtn = document.getElementById('btn-quick');
addBtn.addEventListener('click', () => addMenu(addBtn));
// An expanded card leaves the sidebar in reach: going to another view from it closes the card (its edits saved, as Esc).
window.addEventListener('hashchange', async () => {
  if (isOpen() && isExpanded()) await closeItem(); // unsaved and not saved: the card stays, over the new view
  route();
});
window.addEventListener('beforeunload', (e) => {
  if (hasUnsaved() || filesUnsaved()) e.preventDefault();
});
// Pick up edits made outside the app (Obsidian, an editor, an agent) when you come back.
window.addEventListener('focus', () => reload());

initTheme();
initMentions();
initSidebar();
firstLoad.then(syncSidebarMode); // the vault's own mode, now that the page knows which vault it is
// On a vault that does not match, the mode decides what the middle shows: its files, or the notice.
onSidebarMode(() => { if (vaultBlocked()) route(); });
initExplorer();
initAgents();
onChange(renderAll);
reload().then(route).then(restoreTerms); // terminals the server still runs get their tabs back
