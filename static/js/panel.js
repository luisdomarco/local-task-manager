// Item editor: every field of one item, its plan, its links, its work log, its
// related items and its markdown content. Field edits save immediately; the
// content saves on blur / Ctrl+S.
//
// The same editor renders in two places: a Trello-style card modal (openItem, for
// tasks, notes and meetings) and an item's own page for the types that have one (createPageEditor,
// route #/<type>/:ref: an initiative; in Ticketing a project and a PRD too). Each instance keeps its
// own open item, content draft and focus.
import { api } from './api.js';
import { historyText } from './historytext.js';
import { COL, DETAIL_PAGE, FILL_COLUMN, columnOf, dataTable, paged } from './datatable.js';
import { relDay, shiftWeek, stampLabel, thisMonth, thisWeek, today } from './dates.js';
import { TYPES, TYPE_ICON, TYPE_LABEL, trapFocus } from './create.js';
import { aimFields, blocksOf, breakBlocks, PROP_BLOCKS, deliveryBody, quietBlanks, itemFields, settingsBody, linkLabelControl, modalFrame, modalTitle, planKey, propField, sideFold, statusSelect } from './itemform.js';
import { ancestorsOf } from './grouping.js';
import { fileTree, loadFiles } from './explorer.js';
import { docChoices, docsGroups, docsHref, resolveDocs } from './filetree.js';
import { itemHref, opener, pageHref } from './links.js';
import { mdBlock } from './mdblock.js';
import { pref, saveSort, savedSort, setPref } from './prefs.js';
import { attachmentsBody } from './attachments.js';
import { shownKinds } from './kindgroups.js';
import { groupLinks, linkIcon, shortUrl } from './linkgroups.js';
import { quickAddBar } from './quickadd.js';
import {
  EXTERNAL_REF, PARENT_TYPES, RELATABLE, STRUCTURE, TYPE_DEFS, hasExternalRef, hasField, hasPage, isDone, isEnabled, isShortId, kindFor, leavesProject, matchesWhere, needsParent, pageRef, parentChoices, parentLabel, parentPick, projectFree, projectHas, projectOf, propsIn, statusesOf,
} from './rules.js';
import { peopleOf } from './people.js';
import { logForm } from './logform.js';
import { itemName, setCardTitle, setPageTitle } from './tabtitle.js';
import { sumTime } from './worktime.js';
import { kindLabel, kindOf, kinded, relatedIn, relationWrites } from './relkinds.js';
import {
  addComment, allContacts, childrenOf, convertItem, deleteComment, deleteItem, editComment, itemAction, setArchived, isPinned, logOf, logWork, planDay, planMonth, planWeek, setStatus, updateLog,
  noteToDoc, state, toast, togglePin, unlogWork, unplan, updateItem,
} from './state.js';
import { addSessionPicker, openClaudeDialog, sessionList } from './claude.js';
import { closeMenu, dropdown, h, icon, rowAction, rowItem, rowList, secondaryButton, select, stackGroup, statusLabel, tabPanels, tagInput, typeIcon, withMentions } from './ui.js';
import { refOf } from './shownid.js';
import { MEMBER_TYPES, byGoalOrder, goalCandidates, goalProgress, inGoal, nextGoalOrder } from './goals.js';
import { mountCanvasView } from './canvas/canvasview.js';
import { canvasHost, canvasItems } from './canvas/itemcanvas.js';
import { foldTabs } from './tabfold.js';
import { itemPicker } from './itempicker.js';

/** A phone's width, where the card's head keeps only its essentials (app.css matches it). */
const PHONE = '(max-width: 640px)';

const modal = () => document.getElementById('item-modal');
const backdrop = () => document.getElementById('item-backdrop');
const editors = new Set();

const save = (item, values) => updateItem(item.key, values).catch(() => {});
const field = (label, control, cls = '') => h('label', { class: `field ${cls}` }, h('span', {}, label), control);

/** Ids that may not become this item's related_to: itself and everything under it. */
function descendants(id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const i of state.all) {
      if (i.id && !out.has(i.id) && out.has(i.fields.related_to)) { out.add(i.id); grew = true; }
    }
  }
  return out;
}

/** What the shared property fields (itemform.js) read and write for an existing item: every change saves at once. */
function editBinding(item) {
  const f = item.fields;
  const apply = (plan) => {
    if (!plan) return unplan(item);
    if (plan === 'today') return planDay(item, today());
    if (plan === 'week') return planWeek(item, thisWeek());
    if (plan === 'nextweek') return planWeek(item, shiftWeek(thisWeek(), 1));
    if (plan === 'month') return planMonth(item, thisMonth());
    if (/^\d{4}-\d{2}$/.test(plan)) return planMonth(item, plan);
    return /^\d{4}-\d{2}-\d{2}$/.test(plan) ? planDay(item, plan) : planWeek(item, plan);
  };
  return {
    type: item.type,
    exclude: item.id ? descendants(item.id) : new Set(),
    // Everything but a prompt has the side panel: its parent and project in Relations, its Claude sessions in the AI
    // tab, its own fields in their tab (rules.js tabOf).
    sidePanel: item.type !== 'prompt',
    get: (key) => {
      if (key === 'planned') return planKey(f); // not `plan`: a Ticketing initiative has a field of that name (its Plan)
      if (key === 'from') return peopleOf(f.from);
      if (key === 'attendees') return f.attendees || [];
      return f[key];
    },
    set(key, value) {
      // Like save(): a change the server refuses (a status a rule does not allow yet…) was already said in a
      // toast by mutate(); nothing is left to handle, so it must not surface as an unhandled rejection.
      if (key === 'status') return setStatus(item, value).catch(() => {});
      if (key === 'planned') return Promise.resolve(apply(value)).catch(() => {});
      return save(item, { [key]: typeof value === 'string' ? value.trim() || null : value });
    },
  };
}


/** Opens the "work on it with Claude" dialog for this item. */
function claudeButton(item) {
  if (!item.id || item.type === 'prompt') return null; // a prompt is what you load into the dialog, not something to work on
  return h('button', {
    class: 'btn icon', title: 'Work on it with Claude', 'aria-label': 'Work on it with Claude',
    onclick: () => openClaudeDialog(item),
  }, icon('terminal', 16));
}

/** The AI tab: the Claude sessions of this item — started here (Work on it with Claude), or elsewhere (Terminal,
 * Claude Desktop, Cursor…) and added by hand (Add existing session) — each resumed the same way: in the dock, or Open in ▾.
 * One can be starred as its main one (the row's ⋯). */
function aiTab(item) {
  // The main action filled; bringing in one started elsewhere, a frame alone (app.css .ai-start).
  const add = secondaryButton('Add existing session', { ico: 'plus', class: 'ai-add', title: 'Add a conversation started in Terminal, Claude Desktop, Cursor…',
    'aria-haspopup': 'dialog', onclick: () => addSessionPicker(add, item.key) });
  return [
    h('div', { class: 'ai-start' },
      h('button', { class: 'btn primary', onclick: () => openClaudeDialog(item) }, icon('terminal', 14), 'Work on it with Claude'), add),
    sessionList(item.fields.claude_sessions, { key: item.key,
      empty: 'No conversations yet — start one, or add one you started in Terminal, Claude Desktop or Cursor. Each one resumes from here.' }),
  ];
}

/** Copies the item file's full path on disk (the vault's folder + the item's own path): Copy path, in its ⋯ menu. */
async function copyPath(item) {
  const full = `${String(state.config.root_resolved || '').replace(/\/+$/, '')}/${item.path}`;
  try {
    await navigator.clipboard.writeText(full);
    toast(`Copied ${full}`);
  } catch {
    toast('Could not copy the path', true);
  }
}

/** Initiatives: whether this one is a favourite, listed under Favourites in the sidebar (a new one is not: store.py). */
function sidebarButton(item) {
  if (item.type !== 'initiative' || !item.id) return null;
  const on = item.fields.sidebar !== false;
  return h('button', {
    class: `btn icon toggle fav ${on ? 'on' : ''}`, 'aria-pressed': String(on),
    title: on ? 'In Favourites — click to remove' : 'Not in Favourites — click to add',
    onclick: () => save(item, { sidebar: !on }),
  }, icon('star', 16)); // filled while on (app.css .btn.fav.on)
}

/** Activities: resolved or not is its own action, apart from writing a resolution. */
function resolveButton(item) {
  if (item.type !== 'activity' || !item.id) return null;
  const done = !!item.fields.resolved_at;
  return h('button', {
    class: `btn small ${done ? '' : 'primary'}`, title: done ? 'Mark as not resolved' : 'Mark as resolved',
    onclick: () => save(item, { resolved: !done }),
  }, icon(done ? 'back' : 'check', 14), done ? 'Reopen' : 'Mark resolved');
}

/** Minimize: the card closes into a chip on the top bar, and comes back as it was (minimizeItem). */
const minimizeButton = () => h('button', {
  class: 'btn icon minimize', title: 'Minimize to the top bar', onclick: () => minimizeItem(),
}, icon('minimize', 16));

// ── the card expanded: over the whole content (beside the sidebar, under the top bar) instead of floating on it ──
// Remembered (prefs.js `card.expanded`): the next card opens the way the last one was left. A prompt's small card
// does not expand. Expand / Back to its size is in the card's ⋯ menu (expandAction).
export const isExpanded = () => pref('card.expanded', false) === true;
const paintExpanded = () => backdrop().classList.toggle('expanded', isExpanded() && !modal().classList.contains('is-prompt'));
const expandAction = () => (isExpanded()
  ? { label: 'Back to its size', icon: 'restore', onSelect: () => { setPref('card.expanded', null); paintExpanded(); } }
  : { label: 'Expand', icon: 'maximize', onSelect: () => { setPref('card.expanded', true); paintExpanded(); } });

function pinButton(item) {
  if (!item.id) return null;
  const on = isPinned(item.id);
  return h('button', {
    class: `btn icon pin ${on ? 'on' : ''}`, title: on ? 'Unpin from top bar' : 'Pin to top bar', 'aria-pressed': String(on),
    onclick: () => togglePin(item.id).then(() => toast(on ? `Unpinned ${refOf(item)}` : `Pinned ${refOf(item)} to the top bar`)).catch(() => {}),
  }, icon('pin', 16));
}

// ── relations ────────────────────────────────────────────────────────────────
// What the item is linked to, in the side panel: the row that adds a relation (the kind, then the item, from a
// searchable list), its project, its parent (a picker, with the chain above it to open), the items its own link
// fields name (a Ticketing initiative's origin…), and what it is related to as an equal, one section per kind (both
// ways: the link is kept on one of the two, shown on both). Each row opens that item (⌘/Ctrl-click, in a new tab);
// its ⋯ changes the kind or unrelates it, with Undo in the toast. What hangs from it is not here: those are the tabs
// of its card or page. An item without an id (a Ticketing plan, an analysis) can only be given a parent.
const relatedOf = (item) => relatedIn(item, state.items, STRUCTURE.relation_kinds);
const titled = (i) => (i.id ? `${refOf(i)} · ${i.title}` : i.title);
/** The items a link field holds (item keys; one, or a list), or the value itself when it names none we have. */
const linkTargets = (item, p) => {
  const raw = item.fields[p.key];
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((v) => state.all.find((i) => i.key === v) || state.byId.get(v) || String(v));
};
/** A change of links with an Undo in its toast: `undo` puts back what `change` replaced. */
function relink(change, undo, message) {
  change().then(() => toast(message, false, { label: 'Undo', run: undo })).catch(() => {});
}
/** Whether an item of `type` can name one of `other` in a link field (relkinds.js relationWrites: Projects keeps Blocked
 *  by in depends_on only towards the types its file allows there, hidden from the panel or not). */
const canLink = (type, field, other) => {
  const p = (TYPE_DEFS[type]?.props || []).find((x) => x.key === field);
  return !!p && (!p.types || p.types.includes(other));
};
/** relkinds.js relationWrites, one item after the other, with an Undo that puts each back (last first). */
function rewrite(writes, message) {
  const run = (list, pick) => list.reduce((p, w) => p.then(() => updateItem(w.holder.key, pick(w))), Promise.resolve());
  if (writes.length) relink(() => run(writes, (w) => w.values), () => run([...writes].reverse(), (w) => w.was), message);
}

const hasProject = (type) => type !== 'project' && hasField(type, 'project');
/** An item's own link fields (its Relations), as its project's kind keeps them: a simple initiative has no PRD nor plan. */
const relationProps = (item) => propsIn(item.type, 'relations', kindFor(item, state.all));

/** How many links the Relations tab shows: the project, the parent, the link fields, the related. */
const relationsCount = (item) => (hasProject(item.type) && item.fields.project ? 1 : 0)
  + (item.fields.related_to && state.byId.get(item.fields.related_to) ? 1 : 0)
  + relationProps(item).reduce((n, p) => n + linkTargets(item, p).length, 0)
  + relatedOf(item).length;

/** The Relations tab of the side panel, or null for an item that cannot be linked (an inbox item, a prompt). A
 *  Ticketing project is related by its key, its id here (store._item); a plan, without an id, can only get a parent. */
function relationsTab(item, rerender) {
  if ((item.type === 'project' && !item.id) || !(RELATABLE(item.type) || hasProject(item.type) || relationProps(item).length)) return null;
  return { key: 'relations', label: 'Relations', count: relationsCount(item), content: [relationsSection(item, rerender)] };
}

// Docs (TSK-039 phase 3): what this initiative or task links in the vault's Docs — docs by their [[name]], folders by
// their path — to open, to unlink (with Undo) or to add from the Docs folders; and below, the docs whose text mentions
// it. A link whose doc or folder is gone (moved or deleted outside the app) says so and is never dropped by itself.
let docGroups = null;  // docsGroups of /api/docs/roots, asked once
const mentions = new Map(); // item key → { rev, paths }: the docs that link it, asked once per version of it
function docsTab(item, rerender) {
  if (!hasField(item.type, 'docs')) return null;
  if (!docGroups) {
    docGroups = [];
    api.docsRoots().then((r) => { docGroups = docsGroups(r.containers); rerender(); }, () => {});
  }
  if (!fileTree()) loadFiles().then(rerender);
  const docs = item.fields.docs || [];
  const name = refOf(item) || item.title;
  const entries = resolveDocs(docs, fileTree(), docGroups);
  // Each a row, as in Relations (ui.js rowItem): its icon and name, its folder muted at the right, an × to unlink it.
  const where = (path) => path.split('/').slice(0, -1).join('/');
  const rows = entries.map((d) => rowItem({
    ico: icon(d.kind === 'folder' ? 'folder' : 'note', 14),
    ...(d.path ? { href: docsHref(d.path), linkAttrs: { title: d.path }, text: d.kind === 'folder' ? `${d.name}/` : d.name, meta: where(d.path) || null }
      : { text: `${d.value} · not found`, tip: 'Not found: moved or deleted outside the app' }),
    actions: rowAction('x', `Unlink ${d.value}`, () => relink(() => updateItem(item.key, { docs: docs.filter((x) => x !== d.value) }),
      () => updateItem(item.key, { docs }), `${d.value} unlinked from ${name}`)),
  }));
  const choices = docChoices(fileTree(), docGroups).filter((c) => !docs.includes(c.value));
  // "+ Link a doc" at the top right, as Links' and Files' "+ Add": it opens the list of docs and folders to search.
  const pick = choices.length
    ? select(choices.map((c) => [c.value, c.kind === 'folder' ? `${c.path}/` : c.path, c.kind === 'folder' ? 'folder' : 'note']),
      null, (v) => { if (v) updateItem(item.key, { docs: [...docs, v] }).catch(() => {}); },
      { class: 'ghost tab-add', face: ['plus', 'Link a doc'], 'aria-label': 'Link a doc or folder', title: 'Link a doc or folder', search: true,
        menuWidth: (btn) => Math.min(btn.closest('.stack-group')?.offsetWidth || 0, 560) }) // wide for its paths, not the whole column
    : null;
  // The docs that mention it ([[its id …]] in their text): the backlinks of its file, those in a Docs folder.
  const seen = mentions.get(item.key);
  if (!seen || seen.rev !== item.rev) {
    mentions.set(item.key, { rev: item.rev, paths: seen?.paths || [] });
    api.backlinks(item.path).then((out) => {
      const paths = [...new Set((out.links || []).map((l) => l.path))].filter((p) => docGroups.some((g) => p.startsWith(`${g.path}/`)));
      mentions.set(item.key, { rev: item.rev, paths });
      if (paths.length || seen?.paths?.length) rerender();
    }, () => {});
  }
  const mentioned = mentions.get(item.key).paths;
  // As Relations (ui.js stackGroup, rowList): each group its name above its rows, "+ Link a doc" on the first's line.
  // The linked ones need no name unless the docs that mention it follow (the tab already says Docs).
  const none = choices.length ? 'No docs linked yet' : 'No docs to link yet'; // on the button's line, as a group's name
  return { key: 'docs', label: 'Docs', count: docs.length, // a number: 0 hides the badge (ui.js tabPanels)
    content: [h('section', { class: 'panel-section relations quiet docs-links' },
    stackGroup(mentioned.length ? 'Linked' : rows.length ? null : none, rows.length ? rowList(rows) : mentioned.length ? h('p', { class: 'muted small rel-none' }, none) : null, { aside: pick }),
    mentioned.length ? stackGroup('Mentioned in', rowList(mentioned.map((p) => rowItem({ ico: icon('note', 14), href: docsHref(p), linkAttrs: { title: p },
      text: p.split('/').pop().replace(/\.md$/i, ''), meta: where(p) || null })))) : null)] };
}

// Canvas: the item's own whiteboards, in <Docs>/Canvases/<its ref> (canvas/itemcanvas.js), and beside them the open
// items that hang from it, to put on them as cards. Built the first time the tab shows, and kept by its editor while the
// item stays open (createEditor: a save draws the tabs again, and the same view goes into the new panel).
let canvasHosts = null; // /api/canvases/index: { host: its canvases }, asked once; a listed host's count is kept in step
function canvasTab(item, c) {
  if (!TYPE_DEFS[item.type]?.canvas || !c.canvas) return null;
  const host = canvasHost(item);
  if (!host) return null;
  if (!canvasHosts) {
    canvasHosts = {};
    api.canvasIndex().then((r) => { canvasHosts = r.hosts || {}; c.rerender(); }, () => {});
  }
  const slot = c.canvas(item.key);
  slot.view?.update();
  const listed = (n) => { if ((canvasHosts[host] || 0) !== n) { canvasHosts[host] = n; c.rerender(); } };
  const items = () => canvasItems(state.all.find((k) => k.key === item.key) || item, state.items, state.byId, isDone);
  return {
    key: 'canvas', label: 'Canvas', count: canvasHosts[host] || 0, pinned: true, apart: true, content: slot.el,
    // Once its panel is in the page (the first onShow comes while the tabs are being drawn): right after.
    onShow: () => { if (!slot.view) queueMicrotask(() => { if (!slot.view && slot.el.isConnected) slot.view = mountCanvasView(slot.el, { host, provider: itemCanvasProvider({ items, whose: refOf(item) || item.title, listed }) }); }); },
  };
}

/** What items are on a canvas (whiteboard.js's provider): a card each — title, ref, status, priority and kind —
 *  linked to its file. `items()`: the side column's (an item's tree on its Canvas tab, every open one on the Canvas
 *  page); `whose`: what its empty state names; `listed(n)`: its host's canvases counted. */
export function itemCanvasProvider({ items, whose = 'this page', listed = null }) {
  return {
    kind: 'task', label: 'Items', whose, listed,
    all: () => state.byId,
    items,
    card: (k) => ({
      title: k.title, kicker: refOf(k), note: TYPE_DEFS[k.type]?.label || k.type,
      status: k.fields.status ? { label: statusLabel(k.fields.status), key: k.fields.status } : null, priority: k.fields.priority || null,
      link: k.path ? `[[${k.path.replace(/\.md$/, '')}]]` : null,
    }),
    line: (k) => [TYPE_DEFS[k.type]?.label, k.fields.status && statusLabel(k.fields.status)].filter(Boolean).join(' · '),
    open: (k) => (modalEd.isOpen() ? openFromItem(k) : openItemCard(k)), // a card: close it and go on drawing
  };
}

/** A note's "Convert to doc…": where it goes, a Docs folder (its project's first), then the conversion; the page
 *  follows it to its new place in Docs. `done()` closes the card the note was open in. */
async function convertToDoc(item, anchor, done) {
  if (!docGroups?.length) docGroups = docsGroups((await api.docsRoots().catch(() => ({ containers: [] }))).containers);
  if (!fileTree()) await loadFiles();
  const mine = (g) => (g.project && g.project === item.fields.project ? 0 : 1);
  const groups = [...docGroups].sort((a, b) => mine(a) - mine(b));
  const folders = docChoices(fileTree(), docGroups).filter((c) => c.kind === 'folder');
  const options = groups.flatMap((g) => [
    { label: `${g.title} · ${g.path}/`, icon: 'book', onSelect: () => run(g.path) },
    ...folders.filter((c) => c.path.startsWith(`${g.path}/`)).map((c) => ({ label: `${c.path}/`, icon: 'folder', onSelect: () => run(c.path) })),
  ]);
  async function run(folder) {
    try {
      const out = await noteToDoc(item.key, folder);
      done();
      toast(`${item.title} is now a doc`);
      location.hash = docsHref(out.path);
    } catch { /* mutate toasted why */ }
  }
  dropdown(anchor, options.length ? options : [{ label: 'No Docs folder yet', icon: 'book', disabled: true }], { align: 'end', width: 300 });
}

function relationsSection(item, rerender) {
  const f = item.fields;
  const chain = ancestorsOf(item, state.byId);
  const related = relatedOf(item);
  const open = (p) => (hasPage(p) ? closeAll().then((ok) => { if (ok) location.hash = pageHref(p); }) : openFromItem(p));
  // A row (ui.js rowItem): its icon and title, its id muted at the right; an item we do not have (turned off, or
  // gone) by its name as the file has it.
  const row = (p, { depth = 0, lead = null, remove = null, menu = null } = {}) => rowItem({
    depth, lead, actions: menu || (remove ? rowAction('x', remove.title, () => remove.run()) : null),
    ...(typeof p === 'string' ? { text: p, textMono: true, tip: 'Not in this vault' }
      : { text: p.title, ico: typeIcon(p.type, 14), meta: refOf(p), mono: true, href: itemHref(p), linkAttrs: { class: 'item-link', title: `Open ${titled(p)}`, ...opener(p, open) } }),
  });
  // Each group (ui.js stackGroup): its name above, then its rows and its control.
  const group = (label, rows, title = null) => stackGroup(label, rows, { title });

  // Out of wherever it is kept (either item's relations, with its kind, or a kind's own field); Undo brings it back.
  const RK = STRUCTURE.relation_kinds;
  const unrelate = (r) => rewrite(relationWrites(item, r, null, RK, canLink), `${refOf(item)} and ${refOf(r)} are no longer related`);
  // What this item is to each related one (it Blocks it, it Precedes it…: Redmine's kinds, read as "<this> Blocks
  // <that>"), where both types have kinds. Each kind is a section of its own (relatedGroups); a row's ⋯ moves it to
  // another kind, on whichever of the two keeps the relation (or in the kind's own field), or unrelates it.
  const relMenu = (r) => rowAction('more', `${r.title}: relation actions`, (e, btn) => {
    const cur = kinded(RK, item.type, r.type) ? kindOf(item, r, RK) : null;
    dropdown(btn, [
      ...(cur ? [{ heading: `What ${refOf(item)} is to it` }, ...RK.kinds.map(([v, l]) => ({ label: l, icon: v === cur ? 'check' : null, onSelect: () => {
        if (v === cur) return;
        rewrite(relationWrites(item, r, v, RK, canLink), `${refOf(item)}: ${kindLabel(RK, v)} ${refOf(r)}`);
      } })), '-'] : []),
      { label: 'Unrelate', icon: 'x', danger: true, onSelect: () => unrelate(r) },
    ], { align: 'end' });
  }, { 'aria-haspopup': 'menu' });
  // Its related items, one section per kind, in the kinds' order ("Related to", "Blocks"…); those without kinds (a
  // note's) under Related.
  const relatedGroups = () => {
    const byKind = new Map();
    for (const r of related) {
      const k = kinded(RK, item.type, r.type) ? kindOf(item, r, RK) : '';
      byKind.set(k, [...(byKind.get(k) || []), r]);
    }
    const order = [...(RK?.kinds || []).map(([v]) => v), ''];
    return order.filter((k) => byKind.has(k)).map((k) => group(k ? kindLabel(RK, k) : 'Related',
      rowList(byKind.get(k).map((r) => row(r, { menu: relMenu(r) })))));
  };

  // One row per link, shown once: its name opens it; on hover ✎ picks another (the item picker, only what it may name)
  // and × lets it go (Undo in the toast). Both are always there: one that cannot act now is drawn faint, and a click
  // says why. `choices`: the items it may name now, `onPick(item)`.
  const off = (ico, label, why) => rowAction(ico, `${label} — ${why}`, () => toast(why), { class: 'is-off', 'aria-disabled': 'true' });
  const changer = (label, choices, onPick, why = 'There is nothing else it can be now.') => (choices.length
    ? rowAction('pencil', label, (e, btn) => itemPicker(btn, null, (it) => it && onPick(it),
      { keeps: (it) => choices.includes(it), first: () => choices.slice(0, 40), none: null, label }))
    : off('pencil', label, why));

  // Its Parent, first: where it lives, one field for its project and what it hangs from (`project`, `related_to`). Set,
  // the chain as rows — what it hangs from and on up, closed by its project (`in`) —; the first row changes it (✎) and,
  // where it may hang from nothing, lets it go (×). A ticket that may leave its project (rules.js leavesProject) with a
  // short id changes it as a task does — to another project, to none, or to what an item of any project brings —: the
  // file moves to that project's folder (none: its type's folder at the vault's top), with what hangs from it there
  // (store._project_move_plan). A sub-document's follows its item. While it hangs from nothing, the picker: only what
  // may be its parent.
  let parentGroup = null;
  const withProject = hasProject(item.type);
  if (withProject || PARENT_TYPES[item.type].length) {
    const free = projectFree(item.type, { id: item.id });
    const what = refOf(item) || item.title;
    const setParent = (v) => {
      const now = parentPick(item.type, v, state.all, { related_to: f.related_to || null, project: f.project || null }, { id: item.id });
      if (!Object.keys(now).length) return;
      // Undo writes back what it had: its parent and its project, as they were (the store moves the file back).
      const was = Object.fromEntries(Object.keys(now).map((k) => [k, f[k] || null]));
      const named = (k) => refOf(state.byId.get(k)) || k; // the item it hangs from, as drawn (INI-482)
      const where = 'project' in now ? (now.project ? `, in ${now.project}` : ', in no project') : '';
      relink(() => updateItem(item.key, now), () => updateItem(item.key, was),
        now.related_to ? `${what} now hangs from ${named(now.related_to)}${where}` : now.project ? `${what} is now in ${now.project}`
          : 'related_to' in now ? `${what} no longer hangs from ${named(f.related_to)}` : `${what} is in no project now`);
    };
    const project = withProject ? projectOf(item, state.all) || f.project || null : null;
    const ups = f.related_to ? (chain.length ? chain : [f.related_to]) : [];
    const letGo = (title) => rowAction('x', title, () => setParent(null));
    const exclude = item.id ? descendants(item.id) : new Set();
    const asItem = (c) => (c.type === 'project' ? state.items.find((i) => i.type === 'project' && i.fields.project_key === c.value.slice('project:'.length))
      : state.byId.get(c.value));
    const pickable = parentChoices(item.type, { project: f.project || null, exclude, current: f.related_to || null, id: item.id }, state.all)
      .filter((c) => c.value !== f.related_to && c.value !== `project:${f.project}`)
      .map((c) => [c, asItem(c)]).filter(([, it]) => it);
    const valueOf = new Map(pickable.map(([c, it]) => [it, c.value]));
    const kind = TYPE_DEFS[item.type]?.label?.toLowerCase() || item.type;
    const aKind = `${/^[aeiou]/.test(kind) ? 'An' : 'A'} ${kind}`; // "An initiative"
    const toParent = changer(`Change ${parentLabel(item.type).toLowerCase()}`, pickable.map(([, it]) => it), (it) => setParent(valueOf.get(it)),
      `Nothing else can be its ${parentLabel(item.type).toLowerCase()} now.`);
    // A sub-document hanging from no item (an analysis of its project alone) moves to another project that holds its
    // type, never to none; a ticket with a long id does neither (its id carries its project's key).
    const longId = !free && leavesProject(item.type);
    const movable = !free && !longId && project && !ups.length && isShortId(item.id);
    const others = movable ? state.items.filter((p) => p.type === 'project' && p.fields.project_key && p.fields.project_key !== f.project
      && !isDone(p) && projectHas(p, item.type)) : [];
    const carried = `Its id (${what}) carries its project: it moves once its vault has short ids (docs/migrate-short-ids.md).`;
    const toProject = changer('Move to another project', others, (p) => {
      const key = p.fields.project_key;
      relink(() => updateItem(item.key, { project: key }), () => updateItem(item.key, { project: f.project }), `${what} is now in ${key}`);
    }, movable ? `No other open project holds ${kind}s.` : longId ? carried
      : `Its id (${what}) carries its project: move it after its vault has short ids.`);
    const rows = [
      ...ups.map((p, i) => row(p, { depth: i, lead: i ? 'in' : null,
        menu: i ? null : [toParent, needsParent(item.type) ? off('x', `Unlink from ${refOf(p) || p}`, `${aKind} always hangs from one: ✎ picks another.`)
          : letGo(`Unlink from ${refOf(p) || p}`)] })),
      ...(project ? [row(project, { depth: ups.length, lead: ups.length ? 'in' : null,
        menu: ups.length ? null : [free ? toParent : toProject, free ? letGo(`Take it out of ${f.project}`)
          : off('x', `Take it out of ${f.project}`, longId ? carried : `${aKind} is in its item's project, or in one: ✎ moves it to another.`)] })] : []),
    ];
    const pick = !rows.length && pickable.length
      ? h('div', { class: 'rel-pick picks-quiet' }, select([[null, 'Pick a parent…'],
        ...pickable.map(([c]) => [c.value, c.label, c.type === 'project' ? 'folder' : TYPE_ICON[c.type] || null])],
        null, (v) => v && setParent(v), { class: 'small', 'aria-label': parentLabel(item.type), 'data-fk': 'rel-parent', search: true }))
      : null;
    parentGroup = group(parentLabel(item.type), [rows.length ? rowList(rows, { ordered: true }) : null, pick].filter(Boolean));
  }

  // The item's own link fields, each under its name: what it links to as rows (to open it, ✎ to change a single one, ×
  // to let it go); with none, the picker (as in Delivery).
  const b = editBinding(item);
  const linkGroups = relationProps(item).map((p) => {
    const targets = linkTargets(item, p);
    const many = p.kind === 'links';
    const pool = state.items.filter((i) => (p.types || []).includes(i.type) && i.key !== item.key && !isDone(i) && i.fields.archived !== true);
    const keys = many ? (f[p.key] || []) : [];
    const set = (v, message) => { const was = f[p.key] ?? (many ? [] : null); relink(() => updateItem(item.key, { [p.key]: v }), () => updateItem(item.key, { [p.key]: was }), message); };
    const name = (t) => (typeof t === 'string' ? t : refOf(t) || t.title);
    const rows = targets.map((t) => row(t, { menu: p.readonly ? null : [
      many ? null : changer(`Change ${p.label.toLowerCase()}`, pool.filter((i) => i !== t), (it) => set(it.key, `${p.label}: ${name(it)}`),
        `There is no other open ${p.label.toLowerCase()} to pick.`),
      rowAction('x', `Remove ${name(t)}`, () => set(many ? keys.filter((k) => k !== (typeof t === 'string' ? t : t.key)) : null, `${name(t)} is no longer its ${p.label.toLowerCase()}`)),
    ] }));
    const addMore = many && !p.readonly ? pool.filter((i) => !keys.includes(i.key)) : [];
    return group(p.label, [
      targets.length ? rowList(rows) : p.readonly ? h('p', { class: 'muted small rel-none' }, '—')
        : many ? null : h('div', { class: 'rel-pick picks-quiet' }, propField(b, { ...p, label: '' })),
      addMore.length ? h('div', { class: 'rel-pick picks-quiet' }, select([[null, `Add ${p.label.toLowerCase()}…`], ...addMore.map((i) => [i.key, `${refOf(i)} · ${i.title}`, TYPE_ICON[i.type] || null])],
        null, (v) => v && set([...keys, v], `${p.label}: ${name(state.items.find((i) => i.key === v) || v)}`), { class: 'small', search: true, 'aria-label': `Add ${p.label.toLowerCase()}` })) : null,
    ].filter(Boolean));
  });

  // Where it lives (project, parent), its own link fields, and what it is related to, one section per kind, each
  // its name above its items; last, "+ Add relation", a secondary button (as Docs' "+ Link a doc or folder") that
  // opens the row that adds one.
  const add = RELATABLE(item.type) ? addRelation(item, { related }) : null;
  const addRow = !add ? null : addingRelation.has(item.key) ? stackGroup('Add relation', add)
    : stackGroup(null, secondaryButton('Add relation', { ico: 'plus', 'data-fk': 'add-relation',
      onclick: () => { addingRelation.add(item.key); rerender(); requestAnimationFrame(() => document.querySelector('[data-fk="relation-target"]')?.focus()); } }));
  return h('section', { class: 'panel-section relations quiet' },
    parentGroup,
    ...linkGroups,
    ...relatedGroups(),
    addRow);
}

// The items whose Relations tab shows the row that adds one (opened with "+ Add relation"), for as long as the page is open.
const addingRelation = new Set();

/**
 * The head of the Relations section: the kind + a searchable item list + Add. Where the item's relations have kinds
 * (relation_kinds), the kinds are Redmine's: Related to, Blocked by… Copied from, a kind other than Related to offering
 * only items whose relations have kinds too; elsewhere, Related. Its parent is picked in its own line, and a child
 * is added from its tab: neither is a kind here. An item without an id (a plan) has none: a relation names its id.
 */
function addRelation(item, { related }) {
  const RK = STRUCTURE.relation_kinds;
  const typed = RK && RK.types.includes(item.type);
  if (!item.id) return null;
  const kinds = typed ? RK.kinds.map(([k, label]) => [`rel:${k}`, label]) : [['related', 'Related']];
  const relKind = () => (kind.startsWith('rel:') ? kind.slice(4) : 'relates');
  let kind = kinds[0][0];
  let picked = null;
  const candidates = () => {
    const have = new Set(related.map((r) => r.id));
    const fits = relKind() === 'relates' ? () => true : (i) => kinded(RK, item.type, i.type); // a note only ever "relates"
    // Those of its own project first (a stable sort keeps each part in the order they come), then the rest of the vault.
    const home = item.type === 'project' ? item.fields.project_key : item.fields.project;
    return state.items.filter((i) => i.id && RELATABLE(i.type) && i.id !== item.id && !have.has(i.id) && fits(i))
      .sort((a, b) => Number(!home || a.fields.project !== home) - Number(!home || b.fields.project !== home))
      .map((i) => [i.id, titled(i)]);
  };
  const addBtn = h('button', { class: 'btn small primary rel-add-btn', type: 'button', disabled: true }, 'Add');
  const targetSlot = h('span', { class: 'rel-target' });
  const fillTarget = () => {
    picked = null;
    addBtn.disabled = true;
    targetSlot.replaceChildren(select([[null, 'Search an item…'], ...candidates()], null, (v) => { picked = v; addBtn.disabled = !v; },
      { search: true, class: 'small', 'aria-label': 'Item to link', 'data-fk': 'relation-target' }));
  };
  const kindSel = select(kinds, kind, (v) => { kind = v; fillTarget(); }, { class: 'small rel-kind', 'aria-label': 'Kind of link', 'data-fk': 'relation-kind' });
  addBtn.addEventListener('click', () => {
    const other = picked && state.byId.get(picked);
    if (!other) return;
    const rk = relKind();
    rewrite(relationWrites(item, other, rk, RK, canLink),
      rk === 'relates' ? `${refOf(item)} and ${refOf(other)} are now related` : `${refOf(item)}: ${kindLabel(RK, rk)} ${refOf(other)}`);
  });
  fillTarget();
  return h('div', { class: 'rel-add picks-quiet' }, kindSel, targetSlot, addBtn);
}

// The items whose Links tab shows the row that adds one (opened with "+ Add link"), and the link each has open to
// edit (its place in the list), for as long as the page is open.
const addingLink = new Set();
const editingLink = new Map();

function links(item, rerender) {
  const f = item.fields;
  // One list, the main first: the item's url is its main link, its links the others. With one link, that one is the
  // main; with several, a star marks the main and any other can take its place (its ☆ on hover).
  const all = [...(f.url ? [{ url: f.url, ...(f.url_label ? { label: f.url_label } : {}) }] : []), ...(f.links || []).map((l) => ({ ...l }))];
  const close = () => { addingLink.delete(item.key); editingLink.delete(item.key); };
  const commit = () => {
    close();
    const kept = all.filter((l) => l.url);
    const next = { url: kept[0]?.url || null, url_label: kept[0]?.label || null, links: kept.slice(1) };
    const was = { url: f.url || null, url_label: f.url_label || null, links: (f.links || []).filter((l) => l.url) };
    const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(was[k])));
    if (Object.keys(changed).length) save(item, changed); // only what changed: a Ticketing file keeps the rest byte for byte
    else rerender();
  };
  const focusUrl = () => requestAnimationFrame(() => document.querySelector('[data-fk="link-url"]')?.focus());
  // The row that adds or edits one: its label (the usual services or "Other"), its address, the primary button.
  const editor = (l, done, verb) => {
    let label = l.label || '';
    const [slot, custom] = linkLabelControl(label, (v) => { label = v; });
    const url = h('input', { type: 'text', inputmode: 'url', value: l.url || '', placeholder: 'dominio.com', 'aria-label': 'Link', 'data-fk': 'link-url' });
    const ok = h('button', { type: 'button', class: 'btn small primary', disabled: !l.url }, verb);
    const submit = () => {
      const u = url.value.trim();
      const lb = custom.hidden ? label : custom.value.trim();
      if (u) done({ url: u, ...(lb ? { label: lb } : {}) });
    };
    url.addEventListener('input', () => { ok.disabled = !url.value.trim(); });
    url.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') { e.stopPropagation(); close(); rerender(); }
    });
    ok.addEventListener('click', submit);
    return h('div', { class: 'link-row link-edit' }, slot, url, ok,
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => { close(); rerender(); } }, 'Cancel'));
  };
  const several = all.length > 1;
  const editing = editingLink.get(item.key);
  // Each a row, as Relations' and Docs' (ui.js rowItem): its service's icon and its address (with several, the main's
  // star right after it), opened in a new tab; on hover ☆ to make it the main and ⋯ for Edit, Copy link and Delete.
  const row = (l, i) => (i === editing ? h('li', { class: 'row-edit' }, editor(l, (v) => { all[i] = v; commit(); }, 'Save')) : rowItem({
    ico: icon(linkIcon(l.label), 14),
    meta: i === 0 && several ? h('span', { class: 'link-main-mark', title: 'Main link', 'aria-label': 'Main link', role: 'img' }, icon('star', 12)) : null, // after it
    text: shortUrl(l.url),
    href: /^[a-z][\w+.-]*:/i.test(l.url) ? l.url : `https://${l.url}`, // "dominio.com" as typed: a web address
    linkAttrs: { target: '_blank', rel: 'noopener', title: l.url },
    actions: [
      i > 0 ? rowAction('star', 'Mark as main', () => { all.unshift(...all.splice(i, 1)); commit(); }) : null, // the old main stays, second
      rowAction('more', 'Link actions', (e, btn) => dropdown(btn, [
        { label: 'Edit', icon: 'pencil', onSelect: () => { addingLink.delete(item.key); editingLink.set(item.key, i); rerender(); focusUrl(); } },
        { label: 'Copy link', icon: 'copy', onSelect: () => navigator.clipboard.writeText(l.url).then(() => toast('Link copied'), () => toast('Could not copy the link', true)) },
        { label: 'Delete', icon: 'trash', danger: true, onSelect: () => { all.splice(i, 1); commit(); } },
      ], { align: 'end' }), { 'aria-haspopup': 'menu' }),
    ],
  }));
  // A group per label (linkgroups.js: the usual services, the others A–Z, the unlabelled last), its name above its
  // rows; with only unlabelled links, no name. "+ Add link" at the right of the first group's name; it opens the row
  // that adds one, above the groups.
  const adding = addingLink.has(item.key);
  const addBtn = adding ? null : h('button', { type: 'button', class: 'btn small ghost tab-add', 'data-fk': 'add-link',
    onclick: () => { editingLink.delete(item.key); addingLink.add(item.key); rerender(); focusUrl(); } }, icon('plus', 14), 'Add link');
  const groups = groupLinks(all);
  const named = groups.length > 1 || groups[0]?.label;
  const blocks = groups.map((g, n) => stackGroup(named ? g.label || 'Other links' : null, rowList(g.items.map(({ link, index }) => row(link, index))),
    { aside: n === 0 ? addBtn : null }));
  return h('section', { class: 'panel-section relations links-tab' },
    adding ? stackGroup('Add link', editor({}, (v) => { all.push(v); commit(); }, 'Add')) : null, // the first one added is the main
    ...(blocks.length ? blocks : [adding ? null : stackGroup('No links yet', null, { aside: addBtn })])); // on the button's line
}

function openPathBtn(path) {
  if (!path) return null;
  return h('button', {
    class: 'btn icon', title: `Open ${path}`,
    onclick: (e) => { e.preventDefault(); api.openPath(path).catch((err) => toast(err.message, true)); },
  }, icon('folder', 14));
}

const openUrlBtn = (url) => (url ? h('a', { class: 'btn icon', href: url, target: '_blank', rel: 'noopener', title: `Open ${url}` }, icon('external', 14)) : null);

/**
 * The ticket's tracker (Story, Epic, Technical subtask…: what the Redmine sync brings), as free text suggesting the
 * trackers the vault's items already have. `input(key, attrs)` is the block's own text input (saves on change).
 */
export function trackerInput(input, ext) {
  const used = [...new Set(state.items.map((i) => i.fields[ext.tracker_key]).filter(Boolean))].sort();
  return h('span', { class: 'tracker-input' },
    input(ext.tracker_key, { type: 'text', placeholder: ext.tracker_placeholder || '', list: 'tm-trackers', autocomplete: 'off' }),
    h('datalist', { id: 'tm-trackers' }, used.map((t) => h('option', { value: t }))));
}

// The top of the side panel: where the work happens. An initiative or a story points at an issue of the vault's
// outside tracker (`ext`: Redmine in the folder-per-type structure) and a folder; an item with a folder and no ticket (a
// Tasks project, an agent) has its folder alone. The Claude sessions handling it are in the AI tab (aiTab).
function externalRef(item, ext) {
  if (item.type === 'prompt') return []; // a prompt has no side panel
  const f = item.fields;
  const input = (key, attrs) => {
    const el = h('input', { value: f[key] || '', 'data-fk': key, ...attrs });
    el.addEventListener('change', () => save(item, { [key]: el.value.trim() || null }));
    return el;
  };
  const local = field('Local path', h('div', { class: 'inline' }, input('local_path', { type: 'text', placeholder: '~/work/pricing' }), openPathBtn(f.local_path)), 'span2');
  // A project is named by its key (a Ticketing project's note has no id) and has its ticket and folder as any work does;
  // any other item without an id (a Ticketing plan) has no ticket of its own.
  const named = !!item.id || item.type === 'project';
  if (!named || !hasExternalRef(item.type)) {
    // Its folder, where it has one without a ticket: where Claude starts for it.
    return named && hasField(item.type, 'local_path') ? [local] : [];
  }
  return [ // the tracker first: it says what the ticket is
    ext.tracker_key && hasField(item.type, ext.tracker_key) ? field('Tracker', trackerInput(input, ext)) : null,
    field(`${ext.label} ID`, input(ext.id_key, { type: 'text', placeholder: ext.id_placeholder })),
    field(`${ext.label} URL`, h('div', { class: 'inline' }, input(ext.url_key, { type: 'text', inputmode: 'url', placeholder: ext.url_placeholder }), openUrlBtn(f[ext.url_key]))),
    local].filter(Boolean);
}

/**
 * Watchers (TSK-051): the people and groups of Contacts to tell when the item changes status — by email, Slack…, as
 * each one's "When to use" says. Only the types that have the field (initiatives, user stories, tasks); a prompt for
 * Claude lists them with how to reach each.
 */
function watchers(item) {
  if (!item.id || !hasField(item.type, 'watchers')) return null;
  const names = item.fields.watchers || [];
  return h('div', { class: 'field span2 watchers', title: 'People and groups to tell when its status changes' }, h('span', {}, 'Watchers'),
    tagInput(names, (list) => save(item, { watchers: list }), { kind: 'person', suggest: allContacts, placeholder: 'Add a person or a group…', fk: 'watchers' }));
}


/**
 * An item's properties, on its card and its page: the first tab of the side panel (sideTabs), one per row — its fields
 * (status aside: it sits by the title), its outside ticket and local path, its watchers, in blocks (PROP_BLOCKS). Every
 * one is shown, an empty one saying so (quietBlanks).
 */
function propertiesSection(item, { inline = false } = {}) {
  const b = { ...editBinding(item), propList: true, titleStatus: hasField(item.type, 'status') };
  const list = itemFields(b);
  const own = [...list.children].filter((el) => el.classList.contains('field'));
  const ext = externalRef(item, EXTERNAL_REF);
  const watch = [watchers(item)].filter(Boolean);
  list.append(...ext, ...watch);
  breakBlocks([
    ...blocksOf(own),
    ...ext.map((el) => [el, PROP_BLOCKS.length]),
    ...watch.map((el) => [el, PROP_BLOCKS.length + 1]),
  ]);
  quietBlanks(list);
  // `inline`: the copy under the title that narrow screens show instead of the tab (app.css), where the side column
  // would come last. It keeps a heading; the tab is named by its button.
  return h('section', { class: `panel-section prop-list prop-rows quiet ${inline ? 'prop-inline' : ''}`, 'aria-label': 'Properties' },
    inline ? h('h4', {}, 'Properties') : null, list);
}

// Unsent "Log work" forms, per item: a re-render (a comment, a status change) must not wipe what was typed.
const logDrafts = new Map();
let editingLog = null; // which entry is open for editing: `${item id}|${date}#${index}`

/** Every item can have work logged on it (an inbox item, a note, a meeting too); only an item without an id cannot. */
/**
 * The element that scrolls an item's main column inside `root`: the column itself on a wide screen (.im-main), the modal
 * body (.im-body) once the two columns stack. On the narrow initiative page the scroller is #main, outside `root`; it
 * keeps its own scroll across a re-render (only `root`'s children are replaced), so nothing needs restoring there.
 */
function mainScroller(root) {
  const col = root.querySelector('.im-main, .page-main');
  if (!col) return null;
  for (let el = col; el && el !== root.parentElement; el = el.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
  }
  return col;
}

function workLog(item, rerender) {
  if (!item.id) return null;
  const draft = logDrafts.get(item.id) || { kind: state.config.work_kinds[0], time: '00:00', date: today(), note: '' };
  const addForm = logForm(draft, {
    submitLabel: 'Add', quick: true, rows: true,
    onChange: (patch) => logDrafts.set(item.id, Object.assign(draft, patch)),
    onSubmit: async (v) => {
      logDrafts.set(item.id, { ...v, time: '00:00', note: '' }); // keeps the type and the day for the next one
      try { await logWork(item.id, v.kind, v.note, v.date, v.time); } catch { return; }
      toast(`Logged ${v.kind} · ${v.time} on ${refOf(item)}`);
    },
  });

  const entries = logOf(item.id).slice().sort((a, b) => (b.date + (b.at || '')).localeCompare(a.date + (a.at || '')));
  const days = new Set(entries.map((e) => e.date)).size;
  // The records, as the properties are: one per row, its day on the left, then its time, type and notes; a click opens
  // its fields for editing in its place.
  const row = (e) => {
    const key = `${item.id}|${e.date}#${e.index}`;
    if (editingLog === key) {
      return h('div', { class: 'wl-edit' }, logForm({ kind: e.kind, time: e.time, date: e.date, note: e.note || '' }, {
        submitLabel: 'Save', fk: 'log-edit', rows: true,
        onSubmit: async (v) => {
          editingLog = null;
          try { await updateLog(e.date, e.index, { kind: v.kind, time: v.time, note: v.note, new_date: v.date }); } catch { return; }
          toast('Entry updated');
        },
        onCancel: () => { editingLog = null; rerender(); },
        onDelete: async () => { editingLog = null; try { await unlogWork(e.date, e.index); } catch { /* toasted */ } },
      }));
    }
    const open = () => { editingLog = key; rerender(); };
    return h('div', {
      class: 'field wl-entry', role: 'button', tabindex: '0', title: 'Click to edit', 'aria-label': `${e.kind} ${e.time} on ${e.date}`,
      onclick: open,
      onkeydown: (ev) => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); open(); } },
    },
    h('span', { class: `wl-day ${e.date === today() ? 'today' : ''}`, title: `${e.date} · logged at ${e.at || '—'}` }, relDay(e.date)),
    h('div', { class: 'wl-value' },
      h('span', { class: `wl-time ${e.time === '00:00' ? 'zero' : ''}` }, e.time),
      h('span', { class: `chip kind k-${String(e.kind).toLowerCase()}` }, e.kind),
      e.note ? h('span', { class: 'wl-note', title: e.note }, e.note) : null));
  };
  // In blocks, as the properties: the form · how much in all · the records.
  return h('section', { class: 'panel-section log-panel' },
    addForm,
    entries.length ? h('div', { class: 'fields prop-rows quiet wl-rows', 'aria-label': 'Work log entries' },
      h('div', { class: 'field prop-break wl-total' }, h('span', {}, 'Logged'),
        h('span', {}, h('span', { class: 'wl-time' }, sumTime(entries)), h('span', { class: 'muted' }, ` · ${days} day${days > 1 ? 's' : ''}`))),
      ...entries.map((e, i) => {
        const el = row(e);
        if (i === 0) el.classList.add('prop-break');
        return el;
      })) : null);
}

// Remembered per kind of table (prefs.js): the type of the item it sits on and the type it lists — a task's
// notes, an initiative's notes — so every task shares one choice, never one item alone. A type not named here
// starts as its own list does.
const childSorts = { story: { col: 'status', dir: -1 }, task: { col: 'status', dir: -1 }, note: { col: 'updated_at', dir: -1 }, transcription: { col: 'updated_at', dir: -1 }, meeting: { col: 'date', dir: -1 }, activity: { col: 'updated_at', dir: -1 } };
const childSort = (type) => childSorts[type] || TYPE_DEFS[type]?.list?.sort || { col: 'updated_at', dir: -1 };

// The types whose items close (rules.js isDone): their tables show the open ones unless you pick otherwise.
const childScope = (type) => (type === 'activity' ? 'resolved' : TYPE_DEFS[type]?.statuses?.length ? 'status' : null);

/** What hangs from an item: its children (related_to), or, for a Ticketing project, the tickets that live in it; for
 *  a goal, the items that name it (goals.js) and its notes. */
const heldBy = (item) => (item.type === 'project'
  ? (k) => k.fields.project === item.fields.project_key
  : item.type === 'goal' ? (k) => (k.type === 'note' ? k.fields.related_to === item.id : inGoal(item.id)(k))
    : (k) => k.fields.related_to === item.id);
const SCOPE_LABELS = { status: { open: 'Open', closed: 'Closed', all: 'All' }, resolved: { open: 'Unresolved', closed: 'Resolved', all: 'All' } };
/**
 * The items related to `item` of one type, as a group of its page or card (workGroups, from its `group`): all of
 * them (`all`; archived ones out, `archived` says how many), its quick add's placeholder (`qa`; null for none) and
 * the values it writes, the words for its closed ones (`labels`, for types that close), and for an issue kind's table
 * its columns and its sort, remembered per kind of table (child.<item type>.<type>; before, per listed type alone:
 * what was chosen then is where each starts). It counts all of them.
 * `where` (TypeDef.child_tables) keeps only the items whose fields hold those values, and its quick add writes them.
 */
function childTable(item, rerender, { type, title, cols, qa = null, where = null }) {
  const hangs = heldBy(item);
  const holds = (k) => hangs(k) && matchesWhere(k, where);
  const all = state.items.filter((k) => k.type === type && holds(k));
  const labels = SCOPE_LABELS[childScope(type)];
  const kind = `${item.type}.${type}`;
  // Archived items are out of every list; say how many are hidden here so the table does not look short.
  const archived = state.all.filter((k) => k.type === type && holds(k) && k.fields.archived === true).length;
  const defaults = item.type === 'project' ? { project: item.fields.project_key }
    : item.type === 'goal' && type !== 'note' ? { goal: item.id, goal_order: nextGoalOrder(state.items, item.id) } : { related_to: item.id, ...where };
  const sort = savedSort(`child.${kind}`, savedSort(`child.${type}`, childSort(type)));
  const onSort = (s) => { saveSort(`child.${kind}`, s); rerender(); };
  return {
    key: type, label: title, count: String(labels ? all.filter((k) => !isDone(k)).length : all.length), // its open ones (a kind that closes)
    group: { type, title, all, qa, defaults, labels, cols, sort, onSort, archived }, // workGroups (an issue group: its table)
  };
}

/**
 * An item's own sections as one tab bar, what hangs from it among them, on its card and its page alike:
 * Overview (its description, then its work and records stacked: Tasks, Notes, Meetings… (workGroups); an activity's Message, then its
 * Resolution) · Settings (Area and objective first — a project's, an initiative's —, then a project's own settings, then
 * a ticket's Delivery groups) · Files (its attachments) · Links · Docs (docsTab) · Issues (what hangs from it but its work
 * and records: groupTabs — Issues, in Projects Initiatives · Issues · Briefs · Records), each with its count but the first ones. Only the ones its type has. A
 * detail opens on the first one; the one picked (`current`, `onPick`) holds while it stays open (a save re-renders it).
 */
function itemTabs(item, c, { work = [], groups = [] } = {}, current = null, onPick = () => {}) {
  const b = editBinding(item);
  const f = item.fields;
  // Settings: Area and objective first (a project's, an initiative's), as one more group, then a project's settings,
  // then how a ticket is carried out (its Delivery groups: Readiness, Execution… Paused or discarded).
  const aim = aimFields(b);
  const own = settingsBody(b);
  const delivery = deliveryBody(b);
  // One list of groups (a line between each, as the side panel's blocks): the aim's, the project's own, the ticket's.
  const settings = aim || own || delivery ? h('div', { class: 'fold-groups settings-body prop-rows quiet settings-tab' },
    aim ? h('section', { class: 'panel-section prop-group aim', 'aria-label': 'Area and objective' }, aim) : null, // its fields, no title
    ...(own ? own.children : []), ...(delivery ? delivery.children : [])) : null;
  const files = (f.attachments || []).length;
  const linked = (f.url ? 1 : 0) + (f.links || []).filter((l) => l.url).length;
  const tabs = [
    // Overview: its description, then its work and records in groups (Tasks, Notes, Meetings…), first.
    { key: 'description', label: item.type === 'activity' ? 'Message' : 'Overview',
      content: [item.type === 'goal' ? goalHead(item, b, c.rerender) : c.bodyEl, workGroups(item, work, c.rerender)].filter(Boolean) },
    c.resolutionEl ? { key: 'resolution', label: 'Resolution', content: c.resolutionEl } : null,
    settings ? { key: 'settings', label: 'Settings', content: settings } : null,
    // Its attachments and its links, a tab each (the tab names them). Counts as numbers: a 0 shows none, as the side panel's.
    { key: 'files', label: 'Files', count: files, content: h('section', { class: 'files-group' }, attachmentsBody(item)) },
    { key: 'links', label: 'Links', count: linked, content: links(item, c.rerender) },
    docsTab(item, c.rerender), // the docs it links and those that mention it
  ].filter(Boolean).map((t) => ({ ...t, own: true }));
  const all = [...tabs, ...groupTabs(item, groups, c.rerender), canvasTab(item, c)].filter(Boolean);
  // Seven at most, its own sections and Canvas always; the groups past them in "+" until they hold an item (tabfold.js).
  const opened = c.openedTabs || new Set();
  const fold = foldTabs(all, { active: current, opened });
  const shown = all.filter((t) => fold.shown.includes(t.key));
  const firstGroup = shown.find((t) => !t.own && !t.pinned);
  for (const t of shown) if (!t.own && !t.pinned) t.apart = t === firstGroup; // the line before the first group shown
  const more = all.filter((t) => fold.hidden.includes(t.key));
  const onMore = (key) => { opened.add(key); onPick(key); c.rerender(); };
  return h('section', { class: 'item-tabs' }, ...tabPanels(shown, current, onPick, { more, onMore })); // an unknown `current`: the first
}

/** A goal's Overview head, where another item has its description: its description (a plain text field), how far
 *  along it is (its items closed of all) and "Add items…", a search over what can join it (goals.js goalCandidates). */
function goalHead(item, b, rerender) {
  const desc = TYPE_DEFS.goal?.props?.find((p) => p.key === 'description');
  const p = goalProgress(state.items, item.id, isDone);
  const add = secondaryButton('Add items', { ico: 'plus', class: 'small', 'data-fk': 'goal-add', 'aria-haspopup': 'dialog',
    title: 'Add projects, initiatives, stories or tasks to this goal',
    onclick: (e) => itemPicker(e.currentTarget, null, (it) => it && updateItem(it.key, { goal: item.id, goal_order: nextGoalOrder(state.items, item.id) }),
      { keeps: (k) => goalCandidates([k], isDone).length > 0, first: () => goalCandidates(state.items, isDone).slice(0, 12),
        none: null, label: 'Add an item to this goal' }) });
  return h('section', { class: 'goal-head' },
    desc ? h('div', { class: 'goal-desc prop-rows quiet' }, propField(b, { ...desc, label: 'Description' })) : null,
    h('div', { class: 'goal-progress' },
      h('div', { class: 'progress', title: `${p.done} of ${p.total} closed` }, h('div', { style: `width:${p.pct}%` })),
      h('span', { class: 'muted small' }, p.total ? `${p.done} of ${p.total} closed` : 'Nothing in it yet'),
      h('span', { class: 'spacer' }), add));
}

// The kinds that stay in the bar under an item's sections: its work and its records. Every other kind that hangs from
// it is in a tab of its group (the structure's `child_groups`: in Projects Initiatives · Issues · Briefs · Records),
// or, in a structure without groups, of Issues (user stories, Epics…).
const WORK_KINDS = ['task', 'note', 'transcription', 'meeting', 'activity'];

/** Its child tables (relatedSections, pageTables) → { work, groups: [{ key, label, tables }] } (childTable's key is
 *  its type). A table no group names goes to a last one, More. */
function splitChildren(tables, { flat = false } = {}) {
  const all = tables.filter(Boolean);
  if (flat) return { work: all, groups: [] }; // a goal: what it is made of, all in its Overview
  const rest = all.filter((t) => !WORK_KINDS.includes(t.key));
  const defs = STRUCTURE.child_groups || [['issues', 'Issues', rest.map((t) => t.key)]];
  const groups = defs.map(([key, label, types]) => ({ key, label, tables: rest.filter((t) => types.includes(t.key)) }));
  const loose = rest.filter((t) => !defs.some(([, , types]) => types.includes(t.key)));
  if (loose.length) groups.push({ key: 'more', label: 'More', tables: loose });
  return { work: all.filter((t) => WORK_KINDS.includes(t.key)), groups: groups.filter((g) => g.tables.length) };
}

/** A tab per group of what hangs from it (Issues; in Projects Initiatives · Issues · Briefs · Records), the first
 *  set apart from its own sections by a short line. In each, its kinds stacked as Overview's work (workGroups), each
 *  unfolding into its table. A group counts its kinds' open ones (all of a kind that does not close). */
function groupTabs(item, groups, rerender) {
  return groups.map((g, n) => ({
    key: g.key, label: g.label, apart: n === 0,
    count: g.tables.reduce((k, t) => k + Number(t.count || 0), 0),
    used: g.tables.some((t) => t.group?.all?.length > 0), // an item of its kinds, any status: never folded into "+"
    content: workGroups(item, g.tables, rerender, { table: true }),
  }));
}

// For as long as the page is open: the kinds whose quick add is open, those showing their closed items too, and those
// showing every row (`${item key}|${type}`).
const workAdding = new Set();
// The click outside an open quick add that shuts it: one per group at a time (each drawing replaces its own).
const outsideClicks = new Map();
function closeOutside(id, onClick = null) {
  document.removeEventListener('click', outsideClicks.get(id), true);
  outsideClicks.delete(id);
  if (onClick) { outsideClicks.set(id, onClick); document.addEventListener('click', onClick, true); }
}
// An issue kind's table on an item's page: the columns of its list (but ISSUE_LEFT_OUT), its id and subject as wide in every kind's table
// (so the subjects line up from one kind to the next), what is left to an empty last column; past the page's width it
// scrolls sideways. Its ids are drawn without their project's key (shownid.js: SPEC-001), so a narrower column.
const ISSUE_TABLE = { flex: { subject: null }, widths: { id: 90, subject: 260 } };
// What a kind's list has that its table on the page leaves out: its outside ticket's id, its progress (its own page has them).
const ISSUE_LEFT_OUT = ['extref', 'progress'];
const workClosed = new Set();

/**
 * Its work and records under its description (Overview): one group per kind (childTable's `group`), stacked as the
 * side panel's, never tabs — its name and count, "+ Add …" at the right of its line, its rows: its id muted, its
 * subject, its status and priority (or its date) at the right, in workOrder; a click opens it. An empty kind is its line alone. A kind that
 * closes lists its open ones and offers "Show N closed"; a long one pages as the tables do (datatable.js paged: the
 * same page size, remembered per kind of table). Its name folds it, remembered per item type and kind
 * (work.fold.<item type>.<type>).
 */
const hasStatuses = (type) => !!TYPE_DEFS[type]?.statuses?.length;
/** When a row of the kind happened, for its order and its date: a meeting's date (else when it last changed), the
 *  rest when it last changed. ISO text, so it sorts as it reads. */
const workWhen = (type, k) => String((type === 'meeting' && k.fields.date) || k.fields.updated_at || k.fields.created_at || '');
/** A group's order: a kind with statuses the furthest on first (its statuses' order, last first), then the latest
 *  changed; the rest the latest first (workWhen). */
function workOrder(type) {
  const latest = (a, b) => workWhen(type, b).localeCompare(workWhen(type, a));
  if (!hasStatuses(type)) return latest;
  const list = statusesOf(type);
  return (a, b) => list.indexOf(b.fields.status) - list.indexOf(a.fields.status) || latest(a, b);
}

function workGroups(item, tables, rerender, { table = false } = {}) {
  const kinds = tables.filter((t) => t?.group);
  // In a tab of groups, only the kinds that hold something (or whose quick add is open) get a group; the empty ones
  // wait on one "+ Add" line at its foot (kindgroups.js). Overview keeps all its kinds of work, empty or not.
  const { shown, empty } = table ? shownKinds(kinds, (type) => workAdding.has(`${item.key}|${type}`)) : { shown: kinds, empty: [] };
  if (!shown.length && !empty.length) return null;
  const startAdding = (type) => {
    setPref(`${table ? 'issue' : 'work'}.fold.${item.type}.${type}`, false);
    workAdding.add(`${item.key}|${type}`);
    rerender();
    requestAnimationFrame(() => document.querySelector(`[data-fk="page-${type}-qa"]`)?.focus());
  };
  const addKinds = empty.length ? h('div', { class: 'add-kinds' }, ...empty.map((t) => {
    const name = TYPE_DEFS[t.group.type]?.label || t.group.title;
    return secondaryButton(name, { ico: 'plus', class: 'small', 'data-fk': `add-${t.group.type}`, title: `Add ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name === name.toUpperCase() ? name : name.toLowerCase()}`,
      onclick: () => startAdding(t.group.type) });
  })) : null;
  return h('section', { class: `work-groups relations ${table ? 'issue-groups' : ''}` }, ...shown.map((t) => {
    const g = t.group;
    const id = `${item.key}|${g.type}`;
    const name = TYPE_DEFS[g.type]?.label || g.title;
    const noun = name === name.toUpperCase() ? name : name.toLowerCase(); // "Add PRD", "Add task"
    const adding = workAdding.has(id);
    // Folded as last left (work.fold / issue.fold.<item type>.<type>); never so, an issue kind starts folded when it
    // has nothing open, the rest unfolded.
    const foldKey = `${table ? 'issue' : 'work'}.fold.${item.type}.${g.type}`;
    const left = pref(foldKey);
    const folded = !adding && (left == null ? table && !g.all.some((k) => !isDone(k)) : !!left);
    // A goal's projects, initiatives and stories are born in their project: its "+ Add" picks one that is in no goal.
    const joins = !g.qa && item.type === 'goal' && MEMBER_TYPES.includes(g.type);
    const addBtn = (g.qa || joins) && !adding ? h('button', { type: 'button', class: 'btn small ghost tab-add', 'data-fk': `add-${g.type}`,
      onclick: (e) => (joins ? itemPicker(e.currentTarget, null, (it) => it && updateItem(it.key, { goal: item.id, goal_order: nextGoalOrder(state.items, item.id) }),
        { keeps: (k) => k.type === g.type && goalCandidates([k], isDone).length > 0, first: () => goalCandidates(state.items, isDone).filter((k) => k.type === g.type).slice(0, 12),
          none: null, label: `Add ${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun} to this goal` })
        : startAdding(g.type)),
    }, icon('plus', 14), `Add ${noun}`) : null;
    // Its quick add, framed, opened by "+ Add": Enter adds (and it stays open for the next one), Esc or Close shuts it,
    // and so does a click anywhere else while nothing is written in it.
    const qa = adding ? (() => {
      const fk = `page-${g.type}-qa`;
      const bar = withFk(fk, quickAddBar({ type: g.type, values: g.defaults }, { placeholder: g.qa, mic: false }));
      const close = () => { closeOutside(id); workAdding.delete(id); rerender(); };
      bar.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
      closeOutside(id, (e) => {
        const input = document.querySelector(`[data-fk="${fk}"]`);
        if (!input) { closeOutside(id); workAdding.delete(id); return; } // its page is gone: nothing to draw again
        if (e.target.closest?.('.work-add') || !e.target.isConnected || input.value.trim()) return;
        close();
      });
      return h('div', { class: 'work-add' }, bar, h('button', { type: 'button', class: 'btn small ghost', onclick: close }, 'Close'));
    })() : null;
    const showClosed = workClosed.has(id);
    const closed = g.labels ? g.all.filter(isDone) : [];
    const listed = g.labels && !showClosed ? g.all.filter((k) => !isDone(k)) : g.all;
    const sorted = listed.slice().sort(item.type === 'goal' && g.type !== 'note' ? byGoalOrder : workOrder(g.type))
      .sort((a, b) => Number(isDone(a)) - Number(isDone(b))); // the closed ones, when shown, after the open (a stable sort)
    const prio = hasField(g.type, 'priority');
    const more = [
      closed.length ? h('button', { type: 'button', class: 'btn small ghost work-more', onclick: () => { (showClosed ? workClosed.delete(id) : workClosed.add(id)); rerender(); } },
        showClosed ? `Hide ${g.labels.closed.toLowerCase()}` : `Show ${closed.length} ${g.labels.closed.toLowerCase()}`) : null,
    ].filter(Boolean);
    // Its name, a button that folds it: a chevron before it, its count after.
    const label = h('button', { type: 'button', class: 'work-fold', 'aria-expanded': String(!folded), title: folded ? `Show ${g.title.toLowerCase()}` : `Hide ${g.title.toLowerCase()}`,
      onclick: () => { setPref(foldKey, !folded); rerender(); } },
    icon(folded ? 'right' : 'down', 14), g.title, Number(t.count) ? h('span', { class: 'tab-count' }, t.count) : null); // its open ones
    const group = (body) => stackGroup(label, folded ? [] : body, { aside: addBtn, class: `work-group ${table ? 'issue-group' : ''} ${folded ? 'folded' : ''}` });
    // An issue kind: its table (its columns, its sort, its pages; the closed ones, when shown, after the open), with
    // "Show N closed" on its pager's line.
    if (table) {
      return group([qa, g.archived ? h('p', { class: 'muted small work-archived', title: 'Archived items are hidden from lists and from progress' }, `${g.archived} archived, not listed`) : null,
        listed.length || more.length ? h('div', { class: 'issue-body' },
          listed.length ? dataTable({
            columns: [...g.cols.filter((c) => !ISSUE_LEFT_OUT.includes(c.key)), FILL_COLUMN], ...ISSUE_TABLE,
            rows: listed, sort: g.sort, onSort: g.onSort, label: g.title, onRow: openFromItem, doneLast: true,
            paging: { key: `child.${item.type}.${g.type}`, at: `child.${item.key}.${g.type}`, size: DETAIL_PAGE },
          }) : null, ...more) : null]);
    }
    const page = paged({ key: `child.${item.type}.${g.type}`, at: `child.${item.key}.${g.type}`, rows: sorted, size: DETAIL_PAGE, onChange: rerender });
    const rows = page.rows.map((k) => {
      const f = k.fields;
      const when = workWhen(g.type, k).slice(0, 10);
      // A kind with statuses: its status, then its priority (at the right edge), edited in place as a list's columns
      // (datatable.js COL); a meeting its date (or when it last changed); the rest when it last changed.
      const cells = hasStatuses(g.type) ? h('span', { class: `work-meta ${prio ? 'with-prio' : ''}` }, // two columns, level row to row
        f.status ? COL.status.cell(k) : h('span'), prio ? COL.priority.cell(k) : null) : null;
      return rowItem({ // a link as Relations' rows: a click opens it here, ⌘/Ctrl or the middle button in a new tab
        ico: k.id ? h('span', { class: 'row-id mono' }, refOf(k)) : null,
        text: k.title, href: itemHref(k),
        meta: cells ? null : when ? relDay(when) : null,
        linkAttrs: { class: 'item-link', title: k.id ? `${refOf(k)} · ${k.title}` : k.title, 'data-key': k.key, ...opener(k, openFromItem) },
        actions: cells, // beside the link, not in it: a select in a link would open the row
        class: isDone(k) ? 'done' : '',
      });
    });
    return group([qa, rows.length ? rowList(rows) : null,
      page.pager || more.length ? h('div', { class: 'work-foot' }, ...more, page.pager) : null]);
  }), addKinds);
}



/**
 * What hangs from an item, one table per kind, for every kind PARENT_TYPES lets hang from it: a story has
 * Tasks, Notes and Meetings, a task Notes and Meetings, and any of them Activities once there are some.
 * A type with a page (an initiative…) shows its own tables there (pageTables).
 */
function relatedSections(item, rerender) {
  if (!item.id || TYPE_DEFS[item.type]?.page) return [];
  const has = (type) => childrenOf(item.id).some((k) => k.type === type);
  // Every type that can hang from it and is turned on (a Ticketing support: its hotfixes, plans, analyses…): the
  // app's own first, in this order, then the structure's in its order; activities only once there are some.
  const FIRST = ['task', 'story', 'note', 'transcription', 'meeting'];
  // Of a project's own types, only those its kind holds (a system's support has no hotfixes), or that it already has.
  const home = projectOf(item, state.all);
  const holds = (t) => !home || projectHas(home, t);
  const kinds = Object.keys(PARENT_TYPES).filter((t) => isEnabled(t) && (PARENT_TYPES[t] || []).includes(item.type) && (t !== 'activity' || has(t))
    && (holds(t) || has(t)));
  return [...FIRST.filter((t) => kinds.includes(t)), ...kinds.filter((t) => !FIRST.includes(t) && t !== 'activity'), ...kinds.filter((t) => t === 'activity')]
    .map((t) => kindTable(item, rerender, t, {}, { addable: holds(t) }));
}

// The quick add of a kind on an item's page, for the types the app always had (any other: "Add <its noun>…"). Every
// kind's table takes its list's columns (tm/structures), without the ones a table under its parent would only repeat.
const PAGE_TABLES = {
  story: { qa: 'Add user story…  !high  @today  due:fri' },
  task: { qa: 'Add task…  !high  @today  due:fri' },
  note: { qa: 'Add note…' },
  transcription: { qa: 'Add transcription…' },
  meeting: { qa: 'Add meeting…  (@fri for its date)' },
  activity: { qa: null }, // they come in (mail, Slack…): none is added here
};

/** The table of one kind that hangs from `item`, on its card or its page; `some` narrows it (child_tables: Epics). */
function kindTable(item, rerender, t, some = {}, { addable = true } = {}) {
  const def = TYPE_DEFS[t];
  const known = PAGE_TABLES[t];
  const { label, noun, where } = some;
  // Without the columns every row of it shares: its parent, its project, the field its `where` fixes.
  const across = item.type === 'goal'; // a goal's items come from every project: their project and parent are news
  const cols = (def.list?.columns || ['id', 'subject', 'updated']).map(columnOf)
    .filter((c) => c && (across || (c.key !== 'parent' && c.key !== 'project')) && !(c.key === 'initiative' && item.type === 'initiative')
      && !(where && c.key in where));
  // On a project's page a plan cannot be added from here: it is born under an initiative or a support ticket.
  // Nor one its project's kind lacks (a system's hotfixes from before kinds: listed, not added to).
  // On a goal's, only its tasks and notes are written here (a project, an initiative, a story is born in its project:
  // "Add items…" brings it in).
  const qa = !addable || (item.type === 'project' && t === 'plan') || (across && !['task', 'note'].includes(t)) ? null
    : known ? known.qa : `Add ${(noun || def.label).toLowerCase()}…`;
  return childTable(item, rerender, { type: t, title: label || def.plural, cols, qa, where });
}

/** One table per type its structure lists for its page (TypeDef.children), each turned on and able to hang from it.
 *  A table of only some of a type (child_tables: an initiative's Epics) shows once it holds one, archived or not. */
function pageTables(item, rerender) {
  const project = item.type === 'project' || item.type === 'goal'; // what lives in it, whatever it hangs from
  const home = projectOf(item, state.all); // its project (Ticketing): only the types its kind holds, or it already has
  const holds = (t) => !home || projectHas(home, t);
  const held = (t) => state.all.some((k) => k.type === t && heldBy(item)(k));
  const some = TYPE_DEFS[item.type]?.child_tables || {};
  const kinds = TYPE_DEFS[item.type]?.children || [];
  // Its activities too (mail, Slack… that came in about it), last, once there are some: as on a card (relatedSections).
  const activity = !project && !kinds.includes('activity') && held('activity') ? ['activity'] : [];
  return [...kinds, ...activity]
    .filter((t) => isEnabled(t) && (project || (PARENT_TYPES[t] || []).includes(item.type)) && (holds(t) || held(t)))
    .filter((t) => !some[t] || state.all.some((k) => k.type === t && heldBy(item)(k) && matchesWhere(k, some[t].where)))
    .map((t) => kindTable(item, rerender, t, some[t], { addable: holds(t) }));
}

// Narrow (the columns stacked): the properties sit under the title (propertiesSection `inline`), so the side panel
// hides its Properties tab (app.css) and opens on the next one.
const NARROW = typeof matchMedia === 'function' ? matchMedia('(max-width: 860px)') : { matches: false };

/**
 * The side panel, the same on an item's card and on its page: one row of tabs, Properties first.
 *   Properties · its fields, its outside ticket and local path, its watchers
 *   Activity · comments · AI Agents · its Claude conversations
 *   Relations · its project, parent, link fields, children and related (Docs is a tab of its own sections: itemTabs)
 *   Time · its work log, last
 * On a narrow screen Properties sits under the title instead (app.css), so the first tab there is Activity.
 */
function sideTabs(item, rerender, current, onPick) {
  const f = item.fields;
  const start = current === 'properties' && NARROW.matches ? 'activity' : current;
  return tabPanels([
    { key: 'properties', label: 'Properties', content: [propertiesSection(item)] },
    { key: 'activity', label: 'Activity', count: (f.comments || []).length, fill: true, content: activity(item, { heading: false, rerender }) },
    { key: 'ai', label: 'AI Agents', count: (f.claude_sessions || []).length, content: aiTab(item) },
    relationsTab(item, rerender),
    // The time logged on it, last.
    item.id ? { key: 'details', label: 'Time', content: [workLog(item, rerender)] } : null,
  ].filter(Boolean), start, onPick);
}

/**
 * Drafts outlive the Activity tab: any save or refresh of the card rebuilds it, and a click elsewhere often sets one
 * off. The new comment's text is kept per item, an open edit per item and comment (with the text it started from,
 * so an edit whose comment changed meanwhile is dropped instead of shown on another one). Gone on a reload.
 */
const commentDrafts = new Map(); // item key → text of the comment being written
const commentEdits = new Map(); // `${key}#${index}` → { was, text }

/** A comment box: grows with its text, Enter sends, Shift+Enter or Alt+Enter breaks the line. */
function commentBox(attrs, onEnter) {
  const input = h('textarea', { rows: 1, class: 'comment-input', ...attrs });
  const grow = () => {
    input.style.height = 'auto';
    const borders = input.offsetHeight - input.clientHeight; // height is border-box, scrollHeight is not
    input.style.height = `${input.scrollHeight + borders}px`;
    input.style.overflowY = input.scrollHeight > input.clientHeight ? 'auto' : 'hidden'; // scrollbar only at max height
  };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (e.shiftKey || e.altKey) { // browsers only break the line on Shift+Enter, so do it by hand
      input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end');
      grow();
    } else onEnter();
  });
  queueMicrotask(grow); // a kept draft can be longer than one line
  return { input, grow };
}

/**
 * Activity: what happened to the item (created, converted, closed) and your
 * comments, oldest first, with the composer at the bottom — Enter adds one. ✎ edits a comment in place.
 */
/** Activity's entries (oldest first) cut by day, in order: [{ day: 'YYYY-MM-DD' | '', list }]. */
function byDay(entries) {
  const out = [];
  for (const e of entries) {
    const day = String(e.at || '').slice(0, 10);
    if (out.length && out[out.length - 1].day === day) out[out.length - 1].list.push(e);
    else out.push({ day, list: [e] });
  }
  return out;
}

// item key → { rev, entries }: its history (GET /api/item/history), asked once per version of it.
const histories = new Map();

function activity(item, { heading = true, rerender = null } = {}) {
  const f = item.fields;
  // What changed on its status, priority, dates, plan, ticket and local path (tm/history.py), asked again when it changes.
  const had = histories.get(item.key);
  if (item.id && (!had || had.rev !== item.rev)) {
    histories.set(item.key, { rev: item.rev, entries: had?.entries || [] });
    api.itemHistory(item.key).then((out) => {
      const entries = out.entries || [];
      histories.set(item.key, { rev: item.rev, entries });
      if (rerender && entries.length !== (had?.entries || []).length) rerender();
    }, () => {});
  }
  const changes = histories.get(item.key)?.entries || [];
  const when = (stamp) => {
    const [d, t] = String(stamp || '').split('T');
    return d ? `${relDay(d)}${t ? ` · ${t}` : ''}` : '';
  };
  // Its entries go under the name of their day (Today, Oct 20…): each says only its time, the whole moment on hover.
  const clock = (stamp) => String(stamp || '').split('T')[1]?.slice(0, 5) || '';
  const events = [
    f.created_at ? { at: f.created_at, text: f.converted_from ? `Captured as ${f.converted_from}, converted to ${item.type}` : `Created as ${item.type}` } : null,
    // Closing, unless its history already says so (the status change at that moment).
    f.completed_at && !changes.some((c) => c.field === 'status' && c.at === f.completed_at) ? { at: f.completed_at, text: `Closed · ${statusLabel(f.status)}` } : null,
    f.resolved_at ? { at: f.resolved_at, text: 'Resolved' } : null,
    ...changes.map((c) => ({ at: c.at, text: historyText(c, EXTERNAL_REF || {}) })),
  ].filter(Boolean);
  const comments = (f.comments || []).map((c, index) => ({ ...c, index }));
  const entries = [...events.map((e) => ({ ...e, system: true })), ...comments].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const { input, grow } = commentBox({
    placeholder: 'Write a comment…', title: 'Enter adds the comment · Shift+Enter or Alt+Enter starts a new line', 'aria-label': 'New comment', 'data-fk': 'comment',
  }, () => add());
  input.value = commentDrafts.get(item.key) || '';
  input.addEventListener('input', () => { if (input.value) commentDrafts.set(item.key, input.value); else commentDrafts.delete(item.key); });
  const add = async () => {
    const text = input.value.trim();
    if (!text || !item.id) return;
    commentDrafts.delete(item.key); // before the save: the card re-renders while it is on its way
    try { await addComment(item.key, text); } catch { // toasted; the text stays where it was
      if (!commentDrafts.has(item.key)) commentDrafts.set(item.key, input.value);
      return;
    }
    input.value = '';
    grow();
  };

  const commentCard = (e) => {
    const k = `${item.key}#${e.index}`;
    const open = commentEdits.get(k);
    if (open && open.was !== e.text) commentEdits.delete(k); // the comment changed under the edit (elsewhere, or a delete shifted it)
    const editing = commentEdits.get(k);
    const redraw = () => card.replaceWith(commentCard(e));
    const head = h('header', {}, h('span', { class: 'activity-author' }, 'You'),
      h('time', { class: 'muted small', datetime: e.at, title: e.edited ? `${when(e.at)} · edited ${when(e.edited)}` : when(e.at) }, clock(e.at)),
      e.edited ? h('span', { class: 'muted small', title: `Edited ${when(e.edited)}` }, '· edited') : null,
      editing ? null : h('button', { class: 'btn icon hover-reveal', title: 'Edit comment', onclick: () => {
        commentEdits.set(k, { was: e.text, text: e.text });
        redraw();
        const ta = list.querySelector(`[data-fk="comment-${e.index}"]`);
        ta?.focus();
        ta?.setSelectionRange(ta.value.length, ta.value.length);
      } }, icon('pencil', 13)),
      h('button', { class: 'btn icon hover-reveal', title: 'Delete comment', onclick: () => { commentEdits.delete(k); deleteComment(item.key, e.index); } }, icon('x', 13)));
    let card;
    if (!editing) {
      card = h('article', { class: 'activity-card surface-card hover-host' }, head, h('p', {}, ...withMentions(e.text)));
      return card;
    }
    const cancel = () => { commentEdits.delete(k); redraw(); };
    const save = async () => {
      const text = box.input.value.trim();
      if (!text) return;
      if (text === e.text) { cancel(); return; }
      commentEdits.delete(k); // before the save: the card re-renders with the new text while it is on its way
      try { await editComment(item.key, e.index, text, e.text); } catch { commentEdits.set(k, editing); } // toasted; the edit stays open
    };
    const box = commentBox({
      'aria-label': 'Edit comment', title: 'Enter saves · Esc cancels · Shift+Enter or Alt+Enter starts a new line', 'data-fk': `comment-${e.index}`,
    }, save);
    box.input.value = editing.text;
    box.input.addEventListener('input', () => { editing.text = box.input.value; });
    box.input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); cancel(); } }); // not the card's Esc
    card = h('article', { class: 'activity-card surface-card hover-host editing' }, head, box.input,
      h('div', { class: 'activity-edit-actions' },
        h('button', { class: 'btn small', onclick: cancel }, 'Cancel'),
        h('button', { class: 'btn small primary', onclick: save }, 'Save')));
    return card;
  };

  const section = h('section', { class: 'panel-section activity' },
    heading ? h('h4', {}, icon('message', 14), 'Activity', comments.length ? h('span', { class: 'muted' }, ` · ${comments.length}`) : null) : null,
    h('div', { class: 'activity-list', role: 'log', 'aria-label': 'Activity' },
      entries.length ? byDay(entries).map(({ day, list: dayEntries }) => h('div', { class: 'activity-day' },
        h('span', { class: 'activity-day-name' }, day ? relDay(day) : 'Undated'),
        ...dayEntries.map((e) => (e.system
          ? h('div', { class: 'activity-event' }, h('span', {}, e.text), h('time', { class: 'muted small', datetime: e.at, title: when(e.at) }, clock(e.at)))
          : commentCard(e)))))
        : h('p', { class: 'muted small' }, 'No activity yet.')),
    h('div', { class: 'activity-compose' }, input,
      h('button', { class: 'btn small primary', title: 'Add comment', onclick: add }, icon('arrow', 14))));
  // Newest at the bottom, next to the composer: show it, also when the Activity tab is opened later.
  const list = section.querySelector('.activity-list');
  const toEnd = () => { list.scrollTop = list.scrollHeight; };
  requestAnimationFrame(() => { toEnd(); list.closest('.tab-panel')?.addEventListener('tabshow', toEnd); });
  return section;
}

function withFk(fk, bar) {
  bar.querySelector('input').dataset.fk = fk;
  return bar;
}



const FOCUSABLE = 'input, select, textarea, button, a[href]';

/**
 * Re-rendering rebuilds the editor, which would drop focus after every save.
 * Remember the focused control (by data-fk, else by position) and restore it.
 */
function keepFocus(root, render) {
  const el = document.activeElement;
  const inside = el && root.contains(el);
  const fk = inside ? el.dataset.fk : null;
  const idx = inside ? [...root.querySelectorAll(FOCUSABLE)].indexOf(el) : -1;
  let sel = null;
  try { sel = inside ? [el.selectionStart, el.selectionEnd] : null; } catch { /* not a text control */ }
  render();
  if (!inside) return;
  const target = fk ? root.querySelector(`[data-fk="${fk}"]`) : root.querySelectorAll(FOCUSABLE)[idx];
  if (!target) return;
  target.focus({ preventScroll: true }); // the render put the scroll back where it was: focusing must not move it
  try { if (sel && sel[0] !== null) target.setSelectionRange(...sel); } catch { /* not a text control */ }
}



/**
 * One editor instance. `host()` is the element it renders into, `layout` arranges
 * the shared sections, `onGone` runs when the item is deleted or disappears.
 */
// `onTitle(name)`: what the item shown is called, on every render, and '' once it is gone (the browser tab's title).
function createEditor({ host, layout, onGone, editorMinHeight = '320px', onTitle = () => {} }) {
  let current = null;   // key of the open item
  let bodyRev = null;   // version of the description this editor started from (item.body_rev); a save sends it back
  let listRev = null;   // the version the last list reload reported; an outside edit is a change in THIS, not a gap between the two
  let savingBody = false; // true while our own save is in flight, so its reload is not mistaken for an outside edit
  const ownRevs = new Set(); // every body_rev our saves produced: a late reload reporting one of them is not an outside edit
  let scrollFor = null; // key whose column scroll positions are being kept across re-renders

  // The description (a "message" for an activity) saves as the file's content; an activity's resolution as a field.
  const body = mdBlock({
    fk: 'body', minHeight: editorMinHeight, fold: 'description',
    write: async (text, force = false) => {
      savingBody = true;
      try {
        const out = await updateItem(current, {}, text, force ? undefined : bodyRev);
        bodyRev = out.body_rev ?? bodyRev;
        if (out.body_rev) ownRevs.add(out.body_rev);
        return out.body;
      } finally { savingBody = false; }
    },
    fetchTheirs: async () => {
      try { const full = await api.item(current); bodyRev = full.body_rev ?? null; return full.body || ''; } catch (e) { toast(e.message, true); return null; }
    },
  });
  const resolution = mdBlock({
    fk: 'resolution', minHeight: '200px', cls: 'resolution',
    heading: () => {
      const f = (state.all.find((i) => i.key === current) || {}).fields || {};
      return [icon('check', 15), 'Resolution',
        f.resolved_at ? h('span', { class: 'chip ok' }, `resolved ${String(f.resolved_at).replace('T', ' ')}`) : h('span', { class: 'chip warn' }, 'unresolved')];
    },
    write: async (text) => (await updateItem(current, { resolution: text.trim() || null })).fields.resolution || '',
  });
  resolution.configure({
    label: 'Resolution', emptyText: 'What was done about it? Writing a resolution marks the activity resolved…',
    placeholder: 'What was done about it? Writing a resolution marks the activity resolved.',
  });
  const blocks = [body, resolution];
  // While one item stays open: its Canvas tab's view (canvasTab: { key, el, view }), and the tabs picked from "+".
  let canvas = null;
  const openedTabs = new Set();
  const dropCanvas = () => { canvas?.view?.destroy(); canvas = null; }; // its last strokes saved first
  const forget = () => { dropCanvas(); openedTabs.clear(); };

  const ed = {
    get key() { return current; },
    isOpen: () => current !== null,
    hasUnsaved: () => blocks.some((b) => b.hasUnsaved()),
    async load(itemOrKey) {
      const key = typeof itemOrKey === 'string' ? itemOrKey : itemOrKey.key;
      if (ed.hasUnsaved() && current !== key && !(await ed.flush())) return false;
      try {
        const full = await api.item(key);
        if (full.key !== current) forget();
        current = full.key;
        bodyRev = full.body_rev ?? null;
        ownRevs.clear();
        listRev = state.all.find((i) => i.key === full.key)?.body_rev ?? bodyRev;
        body.reset(full.body);
        resolution.reset(full.fields?.resolution);
        return true;
      } catch (e) {
        toast(e.message, true);
        return false;
      }
    },
    async flush() {
      let ok = true;
      for (const b of blocks) ok = (await b.flush()) && ok;
      return ok;
    },
    reset() { current = null; forget(); blocks.forEach((b) => b.clearDraft()); onTitle(''); },
    currentKey: () => current,
    render() { if (current) keepFocus(host(), doRender); },
  };
  editors.add(ed);

  function doRender() {
    const item = state.all.find((i) => i.key === current) || state.byId.get(current);
    if (!item) { current = null; onTitle(''); onGone(); return; }
    current = item.key;
    onTitle(itemName(item));
    const f = item.fields;
    body.configure(item.type === 'activity'
      ? { label: 'Message', emptyText: 'Paste the message…', placeholder: 'Paste the email / Slack message / comment here' }
      : item.type === 'prompt'
        ? { label: 'Prompt', emptyText: 'Write the prompt…', placeholder: 'The prompt, as it will be sent to Claude' }
        : item.type === 'transcription'
          ? { label: 'Transcript', emptyText: 'Paste the transcript…', placeholder: 'Paste the transcript of the meeting' }
          : { label: 'Description', emptyText: 'Add a more detailed description…', placeholder: 'Markdown… use "- [ ] step" for checklists' });
    body.configure({ title: item.title, tabbed: item.type !== 'prompt' }); // in its Description tab (a prompt has no tabs)
    const remove = async () => {
      blocks.forEach((b) => b.clearDraft());
      try { await deleteItem(item.key); } catch { return; }
      current = null;
      onGone();
    };
    const more = h('button', { class: 'btn icon', title: 'More actions', 'aria-haspopup': 'menu' }, icon('more', 16));
    // Copy path, Expand (on a card, not a prompt's: a page has none), Archive (and a note's Convert to doc…), Delete.
    more.addEventListener('click', () => {
      let armed = false;
      const onCard = modal().contains(more) && !modal().classList.contains('is-prompt'); // the card, not a page
      // On a phone the head keeps Claude, ⋯ and × only: Pin and Minimize move in here.
      const phone = typeof matchMedia === 'function' && matchMedia(PHONE).matches;
      const pinBtn = phone ? more.parentElement?.querySelector('.btn.pin') : null;
      const minBtn = phone ? more.parentElement?.querySelector('.btn.minimize') : null;
      dropdown(more, [
        pinBtn ? { label: pinBtn.title, icon: 'pin', onSelect: () => pinBtn.click() } : null,
        minBtn ? { label: 'Minimize to the top bar', icon: 'minimize', onSelect: () => minBtn.click() } : null,
        pinBtn || minBtn ? '-' : null,
        item.path ? { label: 'Copy path', icon: 'copy', title: 'Copy the full path of this item', onSelect: () => copyPath(item) } : null,
        onCard ? expandAction() : null,
        item.path || onCard ? '-' : null,
        { label: f.archived ? 'Unarchive' : 'Archive', icon: 'archive', onSelect: () => setArchived(item, !f.archived).catch(() => {}) },
        item.type === 'note' ? { label: 'Convert to doc…', icon: 'book', onSelect: () => setTimeout(() => convertToDoc(item, more, () => { current = null; onGone(); })) } : null,
        '-',
        { label: 'Delete', icon: 'trash', danger: true, keepOpen: true, onSelect: (btn) => {
          if (armed) { closeMenu(); remove(); return; }
          armed = true;
          btn.querySelector('span').textContent = 'Click again to delete';
        } },
      ], { align: 'end' });
    });
    // The subject wraps instead of being cut (a phone, a long subject): a one-line textarea that grows with its text.
    // Enter still ends it, and a line break pasted in becomes a space — a subject is one line in the file.
    const subject = h('textarea', { class: 'title-input', rows: '1', 'aria-label': 'Subject', 'data-fk': 'subject', spellcheck: 'false' });
    subject.value = item.title;
    const fit = () => { if (!subject.isConnected) return; subject.style.height = 'auto'; if (subject.scrollHeight) subject.style.height = `${subject.scrollHeight + 2}px`; };
    subject.addEventListener('input', () => {
      if (/[\r\n]/.test(subject.value)) subject.value = subject.value.replace(/[\r\n]+/g, ' ');
      fit();
    });
    requestAnimationFrame(fit);
    subject.addEventListener('change', () => subject.value.trim() && save(item, { subject: subject.value.trim() }));
    subject.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); subject.blur(); } });
    // Someone else (Claude, Obsidian, an editor) changed the description on disk: show it if nothing is being written, else ask.
    // Acted on once per new version the list reports (never in a loop: `bodyRev` comes from a fresh read, the list from an
    // older one, and the two may differ until the next reload without anything having changed since).
    if (!savingBody && item.body_rev && item.body_rev !== listRev) {
      listRev = item.body_rev;
      if (bodyRev !== null && item.body_rev !== bodyRev && !ownRevs.has(item.body_rev)) {
        if (!body.hasUnsaved() && !body.isEditing()) {
          const key = current;
          api.item(key).then((full) => {
            if (current !== key || body.hasUnsaved() || body.isEditing()) return;
            bodyRev = full.body_rev ?? null;
            body.reset(full.body);
            body.render();
          }).catch(() => {});
        } else body.markChanged();
      }
    }
    if (!body.isEditing() || !body.ready()) body.render();
    if (item.type === 'activity' && (!resolution.isEditing() || !resolution.ready())) resolution.render();

    const ctx = {
      subject, bodyEl: body.el, resolutionEl: item.type === 'activity' ? resolution.el : null, more, pin: pinButton(item), minimize: minimizeButton(), sidebar: sidebarButton(item), claude: claudeButton(item), rerender: () => ed.render(),
      openedTabs, canvas: (key) => {
        if (canvas?.key !== key) { dropCanvas(); canvas = { key, el: h('div', { class: 'item-canvas' }), view: null }; }
        return canvas;
      },
      foot: h('footer', { class: 'drawer-foot' },
        h('span', { title: [`Created ${f.created_at || '—'}`, `Updated ${f.updated_at || '—'}`, f.completed_at ? `Closed ${f.completed_at}` : ''].filter(Boolean).join('\n') },
          `Created ${stampLabel(f.created_at) || '—'} · Updated ${stampLabel(f.updated_at) || '—'}`
          + (f.completed_at ? ` · Closed ${stampLabel(f.completed_at)}` : ''))), // its file: ⋯ → Copy path
    };
    // The columns scroll inside the modal and are rebuilt on every render: put their scroll back (a new item starts at the top).
    const keepScroll = scrollFor === current;
    const mainTop = keepScroll ? mainScroller(host())?.scrollTop || 0 : 0;
    const panelTop = keepScroll ? host().querySelector('.tab-panel:not([hidden])')?.scrollTop || 0 : 0;
    // A full-screen editor scrolls inside itself (.mde-code): its scroll too, in the order the editors come.
    const editorTops = keepScroll ? [...host().querySelectorAll('.mde-code')].map((e) => e.scrollTop) : [];
    // replaceChildren() would print a skipped section as the text "null".
    host().replaceChildren(...layout(item, ctx).flat().filter((x) => x !== null && x !== undefined && x !== false));
    scrollFor = current;
    // The rebuilt editors take their full height before the scroll goes back, or it is clipped to their minimum.
    host().querySelectorAll('.mde.coloured').forEach((e) => e.dispatchEvent(new Event('mde:fit')));
    host().querySelectorAll('.mde-code').forEach((e, i) => { if (editorTops[i]) e.scrollTop = editorTops[i]; });
    const newMain = mainScroller(host());
    if (newMain) newMain.scrollTop = mainTop;
    const newPanel = host().querySelector('.tab-panel:not([hidden])');
    if (newPanel) newPanel.scrollTop = panelTop;
  }

  return ed;
}

/** Inbox → task / initiative / note / meeting; the converted item opens right away. */
export async function convertTo(item, type, values = {}) {
  let out;
  try { out = await convertItem(item.key, type, values); } catch { return; } // toasted
  toast(`${refOf(item)} is now ${refOf(out)}`);
  show(out.id, { parent: parentView }); // the converted item takes the place of the inbox one
}

function convertButton(item) {
  const btn = h('button', { class: 'btn small primary', 'aria-haspopup': 'menu' }, 'Convert to', icon('down', 14));
  btn.addEventListener('click', () => dropdown(btn, TYPES.map((t) => ({
    label: TYPE_LABEL[t], icon: TYPE_ICON[t], onSelect: () => convertTo(item, t),
  })), { align: 'end' }));
  return btn;
}

/** A Ticketing support ticket still being worked on: promote it to an initiative, or escalate it to a hotfix
 *  (when its project has hotfixes). The server creates the new ticket and puts this one on hold. */
function ticketActions(item) {
  const f = item.fields;
  if (item.type !== 'support' || isDone(item) || f.promoted_to || f.escalated_to) return [];
  const project = state.items.find((i) => i.type === 'project' && i.fields.project_key === f.project);
  const run = (action) => itemAction(action, item.key).then((out) => {
    toast(`${refOf(item)} ${action === 'promote' ? 'promoted to' : 'escalated to'} ${refOf(out.created)}`);
    openItem(out.created.key);
  }).catch(() => {});
  return [
    isEnabled('initiative') ? h('button', { class: 'btn small', title: 'Create an initiative from it (origin: this ticket); this one waits on hold until it is done',
      onclick: () => run('promote') }, icon('target', 13), 'Promote') : null,
    isEnabled('hotfix') && !!project && projectHas(project, 'hotfix')
      ? h('button', { class: 'btn small', title: 'Create a hotfix from it (born in ToDo); this one waits on hold until it is done',
        onclick: () => run('escalate') }, icon('flame', 13), 'Escalate') : null,
  ];
}

// ── item modal ───────────────────────────────────────────────────────────────
// One layout for every item type (modalFrame, itemFields): the type decides which
// properties and sections show up, not where they sit.
//   main: title · properties · description · related tables · (activity: resolution) · foot
//   side: tabs (sideTabs) — Properties · Activity · AI Agents · Relations · Time
// The tabs in use, main and side: kept while the card re-renders, back to the first ones whenever an item is opened
// (a minimized card or Back brings its own back: snapshot).
let sideTab = 'properties';
let mainTab = null;

function modalLayout(item, c) {
  const f = item.fields;
  modal().classList.toggle('is-prompt', item.type === 'prompt'); // a prompt keeps the smaller card: one column, nothing beside it
  const parent = f.related_to ? state.byId.get(f.related_to) : null;
  const back = parentView ? state.all.find((i) => i.key === parentView.key) : null;
  const kids = item.type === 'prompt' ? { work: [], groups: [] } : splitChildren(relatedSections(item, c.rerender));
  return modalFrame({
    head: [
      back ? h('button', { class: 'btn small ghost im-back', title: 'Back', onclick: goBack },
        icon('left', 14), `${refOf(back)} ${back.title}`.trim()) : null,
      h('span', { class: `chip t-${item.type}` }, typeIcon(item.type, 12), TYPE_DEFS[item.type]?.label || item.type),
      h('span', { class: 'mono' }, refOf(item) || pageRef(item) || 'no id'),
      parent ? h('span', { class: 'muted small im-in' }, 'in ',
        h('button', { class: 'link', ...opener(parent, openFromItem) }, parent.title)) : null,
      f.archived ? h('span', { class: 'chip warn' }, 'archived') : null,
      item.type === 'activity' ? (f.resolved_at ? h('span', { class: 'chip ok' }, icon('check', 12), 'resolved') : h('span', { class: 'chip warn' }, 'unresolved')) : null,
      h('span', { class: 'spacer' }),
      // An inbox item's Convert to and an activity's Mark resolved first, then Claude, left of the rest (on the page too,
      // with the Favourites star right after Claude).
      item.type === 'inbox' ? convertButton(item) : resolveButton(item), c.claude, ...ticketActions(item), c.pin, c.minimize, c.more,
      h('button', { class: 'btn icon', title: 'Close (Esc)', onclick: closeItem }, icon('x', 16)),
    ],
    title: modalTitle(item.type, c.subject, item.type === 'prompt' ? null : statusSelect(editBinding(item))),
    main: [
      // A prompt keeps its few fields here (it has no side column); everything else has them at the top of its side.
      item.type === 'prompt' ? h('div', { class: 'im-props' }, itemFields(editBinding(item))) : propertiesSection(item, { inline: true }),
      // Its own sections in one tab bar (a prompt has only what it says), then what hangs from it.
      item.type === 'prompt' ? h('section', { class: 'im-section' }, c.bodyEl) : itemTabs(item, c, kids, mainTab, (k) => { mainTab = k; }),
      c.foot,
    ],
    sideClass: 'tabbed',
    // A prompt has no links, work or comments: one column.
    side: item.type === 'prompt' ? [] : sideTabs(item, c.rerender, sideTab, (key) => { sideTab = key; }),
  });
}

let returnFocus = null;

// Where the open item was reached from: opening an item from inside another one (a row in its
// Notes table, its parent link) remembers the first, and the "back" button in the header returns to it.
// Closing (X, Esc, click outside) always closes the modal. Two levels at most: a third item replaces
// the second and "back" still returns to the first.
let parentView = null; // { key, tab, mainTop, panelTop }

const snapshot = () => ({
  key: modalEd.key,
  tab: sideTab,
  main: mainTab,
  mainTop: mainScroller(modal())?.scrollTop || 0,
  panelTop: modal().querySelector('.tab-panel:not([hidden])')?.scrollTop || 0,
});
const exists = (key) => state.all.some((i) => i.key === key);

// ── minimized cards: closed into a chip on the top bar (pinbar.js), back with their tab and scroll ──
// Remembered between visits (prefs.js `minimized`, the snapshot of each); the newest last, at most MIN_MAX.
const MIN_MAX = 8;
export const minimizedList = () => (pref('minimized', []) || []).filter((m) => m && typeof m.key === 'string');
function saveMinimized(list) {
  setPref('minimized', list.length ? list.slice(-MIN_MAX) : null);
  dispatchEvent(new Event('tm:minimized')); // the top bar redraws its chips
}
const unminimize = (key) => { const list = minimizedList(); if (list.some((m) => m.key === key)) saveMinimized(list.filter((m) => m.key !== key)); };

/** The open card goes to the top bar: its edits saved first, then closed. */
export async function minimizeItem() {
  if (!modalEd.isOpen() || !(await modalEd.flush())) return;
  const snap = snapshot();
  saveMinimized([...minimizedList().filter((m) => m.key !== snap.key), snap]);
  await closeAll();
}
/** A minimized card, back as it was (or simply opened if its snapshot is gone). */
export const restoreItem = (key) => {
  const snap = minimizedList().find((m) => m.key === key);
  return show(key, snap ? { restore: snap } : {});
};
export const discardMinimized = unminimize;

/** The open item was deleted or disappeared: go back to where it was opened from, if that is still there. */
function modalGone() {
  const back = parentView;
  parentView = null;
  if (back && exists(back.key)) {
    show(back.key, { restore: back }).then((ok) => { if (!ok) backdrop().hidden = true; });
    return;
  }
  backdrop().hidden = true;
}

const modalEd = createEditor({
  host: modal,
  layout: modalLayout,
  onGone: modalGone,
  onTitle: setCardTitle,
});

/**
 * Shows an item in the modal; a type with a page (rules.js hasPage) opens it instead, unless `card` (it opens as a card
 * over the view, as from a canvas). `parent` is the snapshot to go back to, `restore` one to come back to.
 */
async function show(itemOrKey, { parent = null, restore = null, card = false } = {}) {
  const known = typeof itemOrKey === 'string'
    ? state.byId.get(itemOrKey) || state.all.find((i) => i.key === itemOrKey) : itemOrKey;
  if (hasPage(known) && !card) {
    if (modalEd.isOpen()) await closeAll();
    location.hash = pageHref(known); // a route, not a modal: there is nothing to go back to
    return true;
  }
  const wasOpen = modalEd.isOpen();
  if (!(await modalEd.load(itemOrKey))) return false;
  unminimize(modalEd.key); // open again, from its chip or from anywhere: no longer minimized
  parentView = parent;
  sideTab = restore?.tab || 'properties';
  mainTab = restore?.main || null;
  if (!wasOpen) returnFocus = document.activeElement;
  backdrop().hidden = false;
  backdrop().onmousedown = (e) => { if (e.target === backdrop()) closeItem(); };
  modal().onkeydown = (e) => { if (e.key === 'Tab') trapFocus(modal(), e); };
  modalEd.render();
  paintExpanded();
  if (restore) { // come back to the same place in the column
    const main = mainScroller(modal());
    if (main) main.scrollTop = restore.mainTop;
    const panel = modal().querySelector('.tab-panel:not([hidden])');
    if (panel) panel.scrollTop = restore.panelTop;
  }
  modal().setAttribute('aria-label', `${known?.type || 'Item'}: ${known?.title || ''}`);
  modal().focus({ preventScroll: true });
  return true;
}

/** Opens an item from anywhere in the app (a list, the palette, a pin): no history. */
export const openItem = (itemOrKey) => show(itemOrKey);

/** Opens an item as a card over the view even when its type has a page (a goal from a canvas): closing it, you are where you were. */
export const openItemCard = (itemOrKey) => show(itemOrKey, { card: true });

/** Opens an item from inside the open one: closing it comes back here. */
export async function openFromItem(itemOrKey) {
  if (!modalEd.isOpen()) return show(itemOrKey);
  const known = typeof itemOrKey === 'string'
    ? state.byId.get(itemOrKey) || state.all.find((i) => i.key === itemOrKey) : itemOrKey;
  if (known && known.key === modalEd.key) return true;
  if (known && parentView && known.key === parentView.key) return goBack(); // back to the first, not a third level
  return show(itemOrKey, { parent: parentView || snapshot() });
}

async function closeAll() {
  if (!(await modalEd.flush())) return false;
  parentView = null;
  modalEd.reset();
  backdrop().hidden = true;
  if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  returnFocus = null;
  return true;
}

/** The "back" button: return to the item this one was opened from. */
async function goBack() {
  if (!parentView) return false;
  if (!(await modalEd.flush())) return false;
  const back = parentView;
  if (exists(back.key) && await show(back.key, { restore: back })) return true;
  return closeAll();
}

/** Close (X, Esc, click outside): closes the modal, whatever it was opened from. */
export const closeItem = closeAll;

export const isOpen = () => modalEd.isOpen();
/** The key of the item open in the modal, if any. */
export const openItemKey = () => (modalEd.isOpen() ? modalEd.currentKey() : null);
export const hasUnsaved = () => [...editors].some((e) => e.hasUnsaved());
export const renderPanel = () => modalEd.render();

// ── an item's page (#/<type>/:ref) ───────────────────────────────────────────
// A page's tabs, main and side: kept while it re-renders, back to the first ones when a page is opened (createPageEditor).
let pageTab = 'properties';
let pageMainTab = null;
const SIDE_KEY = 'tm.iniSidePanel'; // its side panel folded or not: one choice for every page (named when only initiatives had one)


/**
 * An item's page (#/<type>/<ref>), for every type with one (an initiative; in Ticketing a project and a PRD too):
 * two panels. Left, everything about the item and a table of each kind that hangs from it; right, the same tabbed
 * panel as its card (sideTabs), which can be folded away. Same blocks, same components as the card.
 */
function pageLayout(item, c, rerender) {
  const f = item.fields;
  const def = TYPE_DEFS[item.type] || {};
  const parent = f.related_to ? state.byId.get(f.related_to) : null;
  const project = hasProject(item.type) ? projectOf(item, state.all) : null;
  const up = parent || project; // where the crumbs lead: its parent, else the project it lives in
  const body = h('div', { class: 'page-body' });
  const crumbs = h('nav', { class: 'crumbs' },
    h('a', { href: `#/${def.route || 'today'}` }, def.plural || item.type),
    up ? [icon('right', 13), h('a', { href: itemHref(up) }, up.title)] : null,
    icon('right', 13),
    h('span', { class: 'mono' }, refOf(item) || pageRef(item) || 'no id'),
    f.archived ? h('span', { class: 'chip warn' }, 'archived') : null,
    h('span', { class: 'spacer' }),
    c.claude, c.sidebar, c.pin, c.more); // Claude first, then the Favourites star, as on the card; Copy path in ⋯

  // What hangs from it, one table per kind its structure lists for its page, turned on and able to hang from it: its
  // issues in tabs of their groups (Initiatives, Issues, Briefs, Records), its work and records in Overview under its description (splitChildren). Every other link
  // (sub-initiatives, its PRD, its plan…) lives in the Relations tab of the side panel.
  const kids = splitChildren(pageTables(item, rerender), { flat: item.type === 'goal' });
  const main = [
    h('div', { class: 'page-title' }, c.subject, statusSelect(editBinding(item))), // its properties are in the side column
    propertiesSection(item, { inline: true }), // …or here, on a narrow screen
    itemTabs(item, c, kids, pageMainTab, (k) => { pageMainTab = k; }), // its own sections in one tab bar, its children among them
    c.foot,
  ];
  const side = sideTabs(item, rerender, pageTab, (key) => { pageTab = key; });
  body.append(h('div', { class: 'page-main' }, ...main), h('aside', { class: 'page-side im-side tabbed' }, sideFold(body, SIDE_KEY), ...[side].flat()));
  return [crumbs, body];
}

/** An editor that renders an item as a full page inside `container`. */
export function createPageEditor(container, { onGone }) {
  pageTab = 'properties';
  pageMainTab = null;
  const ed = createEditor({
    host: () => container,
    layout: (item, c) => { container.classList.add('two-panel'); return pageLayout(item, c, () => ed.render()); },
    onGone, editorMinHeight: '420px', onTitle: (name) => { if (name) setPageTitle(name); },
  });
  return ed;
}

export const disposeEditor = (ed) => editors.delete(ed);
