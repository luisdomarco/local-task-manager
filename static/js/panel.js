// Item editor: every field of one item, its plan, its links, its work log, its
// related items and its markdown content. Field edits save immediately; the
// content saves on blur / Ctrl+S.
//
// The same editor renders in two places: a Trello-style card modal (openItem, for
// tasks, notes and meetings) and an item's own page for the types that have one (createPageEditor,
// route #/<type>/:ref: an initiative; in Ticketing a project and a PRD too). Each instance keeps its
// own open item, content draft and focus.
import { api } from './api.js';
import { COL, DETAIL_PAGE, TASK_COLUMNS, columnOf, dataTable, fixedColumns, paged, pagedBox } from './datatable.js';
import { addDays, relDay, shiftWeek, thisWeek, today } from './dates.js';
import { TYPES, TYPE_ICON, TYPE_LABEL, trapFocus } from './create.js';
import { itemFields, linkLabelControl, modalFrame, modalTitle, parentFields, planKey, propField, relatedControl } from './itemform.js';
import { ancestorsOf } from './grouping.js';
import { fileTree, loadFiles } from './explorer.js';
import { docChoices, docsGroups, docsHref, resolveDocs } from './filetree.js';
import { itemHref, opener, pageHref } from './links.js';
import { mdEditor } from './mdeditor.js';
import { pref, saveSort, savedSort, setPref } from './prefs.js';
import { attachmentsSection } from './attachments.js';
import { quickAddBar } from './quickadd.js';
import { STORY_COLUMNS } from './stories.js';
import {
  EXTERNAL_REF, PARENT_TYPES, RELATABLE, STRUCTURE, TYPE_DEFS, hasExternalRef, hasField, hasPage, inProject, isDone, isEnabled, isOverdue, pageRef, parentProject, propsIn, splitsInitiative,
} from './rules.js';
import { peopleOf } from './people.js';
import { logForm } from './logform.js';
import { itemName, setCardTitle, setPageTitle } from './tabtitle.js';
import { sumTime } from './worktime.js';
import {
  addComment, allContacts, childrenOf, convertItem, deleteComment, deleteItem, itemAction, setArchived, isPinned, logOf, logWork, planDay, planWeek, progress, setStatus, updateLog,
  noteToDoc, state, toast, togglePin, unlogWork, unplan, updateItem,
} from './state.js';
import { openClaudeDialog, sessionList } from './claude.js';
import { closeMenu, dropdown, h, icon, select, statusChip as statusPill, tabPanels, tagInput, typeIcon, renderMarkdown, withMentions } from './ui.js';

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
    if (plan === 'tomorrow') return planDay(item, addDays(today(), 1));
    if (plan === 'week') return planWeek(item, thisWeek());
    if (plan === 'nextweek') return planWeek(item, shiftWeek(thisWeek(), 1));
    return /^\d{4}-\d{2}-\d{2}$/.test(plan) ? planDay(item, plan) : planWeek(item, plan);
  };
  return {
    type: item.type,
    exclude: item.id ? descendants(item.id) : new Set(),
    // Everything but a prompt has the side panel: its parent and project in Relations, its session under Details, its
    // own fields in their tab (rules.js tabOf).
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

/** The AI tab: start a conversation with Claude on this item, and the ones already started, each resumable. */
function aiTab(item) {
  return [
    h('div', { class: 'ai-start' },
      h('button', { class: 'btn', onclick: () => openClaudeDialog(item) }, icon('terminal', 14), 'Work on it with Claude')),
    sessionList(item.fields.claude_sessions, { key: item.key, empty: 'No conversations yet — start one above. Each one can be resumed from here.' }),
  ];
}

/** Copies the item file's full path on disk (the vault's folder + the item's own path). */
function copyPathButton(item) {
  if (!item.path) return null;
  const full = `${String(state.config.root_resolved || '').replace(/\/+$/, '')}/${item.path}`;
  return h('button', {
    class: 'btn icon', title: 'Copy the full path of this item', 'aria-label': 'Copy the full path of this item',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(full);
        toast(`Copied ${full}`);
      } catch {
        toast('Could not copy the path', true);
      }
    },
  }, icon('copy', 16));
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
  class: 'btn icon', title: 'Minimize to the top bar', onclick: () => minimizeItem(),
}, icon('minimize', 16));

function pinButton(item) {
  if (!item.id) return null;
  const on = isPinned(item.id);
  return h('button', {
    class: `btn icon pin ${on ? 'on' : ''}`, title: on ? 'Unpin from top bar' : 'Pin to top bar', 'aria-pressed': String(on),
    onclick: () => togglePin(item.id).then(() => toast(on ? `Unpinned ${item.id}` : `Pinned ${item.id} to the top bar`)).catch(() => {}),
  }, icon('pin', 16));
}

// ── relations ────────────────────────────────────────────────────────────────
// What the item is linked to, in the side panel: its project (Ticketing), its parent (and the chain above it), the
// items its own link fields name (a Ticketing initiative's origin, PRD, plan, depends on…), what hangs from it, and
// what it is related to as an equal (both ways: the link is kept on one of the two, shown on both). Each row
// opens that item (⌘/Ctrl-click, in a new tab) and its × undoes the link, with Undo in the toast. The row at
// the foot adds one: the kind (Related unless picked otherwise), then the item, from a searchable list. An item
// has one parent at most: while it has one, Parent is not offered (unlink it first to hang it elsewhere).
// An item without an id (a Ticketing plan, an analysis) shows the same, but can only be given a parent: the
// other links name an item by its id.
const childTypesOf = (type) => Object.keys(PARENT_TYPES).filter((t) => PARENT_TYPES[t].includes(type));
const relatedOf = (item) => {
  if (!item.id) return [];
  const own = new Set(item.fields.relations || []);
  return state.items.filter((i) => i.id && i.id !== item.id && (own.has(i.id) || (i.fields.relations || []).includes(item.id)));
};
const titled = (i) => (i.id ? `${i.id} · ${i.title}` : i.title);
const projectOf = (item) => state.all.find((i) => i.type === 'project' && i.fields.project_key === item.fields.project) || null;
/** The items a link field holds (item keys; one, or a list), or the value itself when it names none we have. */
const linkTargets = (item, p) => {
  const raw = item.fields[p.key];
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((v) => state.all.find((i) => i.key === v) || state.byId.get(v) || String(v));
};
/** A change of links with an Undo in its toast: `undo` puts back what `change` replaced. */
function relink(change, undo, message) {
  change().then(() => toast(message, false, { label: 'Undo', run: undo })).catch(() => {});
}

const hasProject = (type) => type !== 'project' && hasField(type, 'project');

/** How many links the Relations tab shows: the project, the parent, the link fields, the children, the related. */
const relationsCount = (item) => (hasProject(item.type) && item.fields.project ? 1 : 0)
  + (item.fields.related_to && state.byId.get(item.fields.related_to) ? 1 : 0)
  + propsIn(item.type, 'relations').reduce((n, p) => n + linkTargets(item, p).length, 0)
  + (item.id ? childrenOf(item.id).length : 0) + relatedOf(item).length;

/** The Relations tab of the side panel, or null for an item that cannot be linked (an inbox item, a prompt) and for
 *  a Ticketing project (what it holds is the tables of its page). */
function relationsTab(item, rerender) {
  if (item.type === 'project' || !(RELATABLE(item.type) || hasProject(item.type) || propsIn(item.type, 'relations').length)) return null;
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
  const name = item.id || item.title;
  const entries = resolveDocs(docs, fileTree(), docGroups);
  const rows = entries.map((d) => h('li', {},
    d.path
      ? h('a', { class: 'chain-link', href: docsHref(d.path), title: d.path }, icon(d.kind === 'folder' ? 'folder' : 'note', 14),
        h('span', { class: 'chain-title' }, d.kind === 'folder' ? `${d.name}/` : d.name))
      : h('span', { class: 'chain-link muted', title: 'Not found: moved or deleted outside the app' }, icon(d.kind === 'folder' ? 'folder' : 'note', 14),
        h('span', { class: 'chain-title' }, `${d.value} · not found`)),
    h('button', { class: 'btn icon rel-remove', title: `Unlink ${d.value}`, 'aria-label': `Unlink ${d.value}`,
      onclick: (e) => { e.preventDefault(); relink(() => updateItem(item.key, { docs: docs.filter((x) => x !== d.value) }), () => updateItem(item.key, { docs }), `${d.value} unlinked from ${name}`); } },
    icon('x', 14))));
  const choices = docChoices(fileTree(), docGroups).filter((c) => !docs.includes(c.value));
  const pick = select([[null, choices.length ? '+ Link a doc or folder' : 'No docs to link yet'], ...choices.map((c) => [c.value, c.kind === 'folder' ? `${c.path}/` : c.path, c.kind === 'folder' ? 'folder' : 'note'])],
    null, (v) => { if (v) updateItem(item.key, { docs: [...docs, v] }).catch(() => {}); }, { class: 'small', 'aria-label': 'Link a doc or folder', search: true });
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
  const group = (label, content) => h('div', { class: 'rel-group' }, h('span', { class: 'rel-label' }, label), content);
  return { key: 'docs', label: 'Docs', count: docs.length, content: [h('section', { class: 'panel-section relations docs-links' },
    group('Linked docs', [h('div', { class: 'rel-pick' }, pick), rows.length ? h('ul', { class: 'chain' }, rows) : null]),
    mentioned.length ? group('Mentioned in', h('ul', { class: 'chain' }, mentioned.map((p) => h('li', {},
      h('a', { class: 'chain-link', href: docsHref(p), title: p }, icon('note', 14), h('span', { class: 'chain-title' }, p.split('/').pop().replace(/\.md$/i, ''))))))) : null)] };
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
  const kids = item.id ? childrenOf(item.id) : [];
  const related = relatedOf(item);
  const childTypes = childTypesOf(item.type);
  const open = (p) => (hasPage(p) ? closeAll().then((ok) => { if (ok) location.hash = pageHref(p); }) : openFromItem(p));
  const row = (p, { depth = 0, lead = null, remove = null } = {}) => h('li', { style: `--depth:${depth}` },
    lead,
    typeof p === 'string' // a link to an item we do not have (turned off, or gone): its name as the file has it
      ? h('span', { class: 'chain-link muted', title: 'Not in this vault' }, h('span', { class: 'chain-title mono' }, p))
      : h('a', { class: 'chain-link item-link', href: itemHref(p), title: `Open ${titled(p)}`, ...opener(p, open) },
        typeIcon(p.type, 14), h('span', { class: 'chain-title' }, p.title)), // the id only in the tooltip: the side column is narrow
    remove ? h('button', { class: 'btn icon rel-remove', title: remove.title, 'aria-label': remove.title, onclick: (e) => { e.preventDefault(); remove.run(); } }, icon('x', 14)) : null);
  // Each group reads as a field of the other tabs (Details, Delivery): its name above, then its control and its items.
  const group = (label, rows, title = null) => h('div', { class: 'rel-group' }, h('span', { class: 'rel-label', title }, label), rows);
  const name = item.id || item.title;

  const parentRows = chain.map((p, i) => row(p, {
    depth: i, lead: i ? h('span', { class: 'chain-in muted small' }, 'in') : null,
    remove: i ? null : { title: `Unlink from ${p.title}`, run: () => relink(() => updateItem(item.key, { related_to: null }), () => updateItem(item.key, { related_to: p.id }), `${name} no longer hangs from ${p.id}`) },
  }));
  const unlinkChild = (k) => relink(() => updateItem(k.key, { related_to: null }), () => updateItem(k.key, { related_to: item.id }), `${k.id} no longer hangs from ${item.id}`);
  // Who keeps the link (the item or the other one) is the one whose list loses it.
  const unrelate = (r) => {
    const holder = (f.relations || []).includes(r.id) ? item : r;
    const other = holder === item ? r.id : item.id;
    const before = holder.fields.relations || [];
    relink(() => updateItem(holder.key, { relations: before.filter((x) => x !== other) }), () => updateItem(holder.key, { relations: before }), `${item.id} and ${r.id} are no longer related`);
  };

  // Its project: the one it was created in, for good, for a ticket (its id carries the key); a choice, for a task,
  // a note, a meeting or an activity, which may have none.
  let projectGroup = null;
  if (hasProject(item.type)) {
    const p = projectOf(item);
    const scoped = (STRUCTURE.project_scoped || []).includes(item.type);
    const projects = state.items.filter((i) => i.type === 'project' && i.fields.project_key);
    const pick = scoped ? null : select([[null, '— none —'], ...projects.map((x) => [x.fields.project_key, `${x.fields.project_key} · ${x.title}`, 'folder'])],
      f.project || null, (v) => {
        // A parent in another project lets go (Undo puts both back): an item and its parent share one project.
        const parent = state.byId.get(f.related_to);
        if (!parent || inProject(v)(parent)) { save(item, { project: v || null }); return; }
        relink(() => updateItem(item.key, { project: v || null, related_to: null }),
          () => updateItem(item.key, { project: f.project || null, related_to: f.related_to }), `${item.id || item.title} no longer hangs from ${parent.id}: it is in another project`);
      }, { class: 'small', 'aria-label': 'Project', 'data-fk': 'project', clearable: true });
    projectGroup = group('Project', [
      pick ? h('div', { class: 'rel-pick' }, pick) : null,
      p ? h('ul', { class: 'chain' }, row(p)) : f.project ? h('ul', { class: 'chain' }, row(f.project)) : null,
    ], scoped ? 'The project it lives in: its folder, and the key of its id' : null);
  }

  // The item's own link fields, each under its name with its control always there, as in Delivery; what it links to
  // follows, to open it.
  const b = editBinding(item);
  const linkGroups = propsIn(item.type, 'relations').map((p) => {
    const targets = linkTargets(item, p);
    return group(p.label, [
      p.readonly ? null : h('div', { class: 'rel-pick' }, propField(b, { ...p, label: '' })),
      targets.length ? h('ul', { class: 'chain' }, targets.map((t) => row(t))) : p.readonly ? h('p', { class: 'muted small rel-none' }, '—') : null,
    ]);
  });

  // Ticketing: what it hangs from, in the create form's fields — Initiative, and Related to for the rest — each of its
  // project. One parent still: picking in one empties the other; a parent brings its project where that can change.
  const parentPicks = splitsInitiative(item.type) ? parentFields(item.type).map((pf) => {
    const movable = !(STRUCTURE.project_scoped || []).includes(item.type);
    const setParent = (v) => {
      const project = movable ? parentProject(state.byId.get(v)) : null;
      const now = { related_to: v || null, ...(project && project !== f.project ? { project } : {}) };
      const was = { related_to: f.related_to || null, ...('project' in now ? { project: f.project || null } : {}) };
      relink(() => updateItem(item.key, now), () => updateItem(item.key, was),
        v ? `${item.id || item.title} now hangs from ${v}` : `${item.id || item.title} no longer hangs from ${f.related_to}`);
    };
    const binding = { type: item.type, exclude: item.id ? descendants(item.id) : new Set(), get: (k) => f[k], set: (k, v) => setParent(v) };
    return group(pf.label, h('div', { class: 'rel-pick' }, relatedControl(binding, { ...pf, fk: `rel-${pf.fk}` })));
  }) : [];

  const nothing = !projectGroup && !chain.length && !kids.length && !related.length && !linkGroups.length;
  return h('section', { class: 'panel-section relations' },
    projectGroup,
    ...parentPicks,
    chain.length ? group('Parent', h('ol', { class: 'chain' }, parentRows), TYPE_DEFS[item.type]?.parent_label || null) : null,
    ...linkGroups,
    kids.length ? group(`Children · ${kids.length}`, pagedBox((rerenderBox) => {
      const page = paged({ key: `relations.children.${item.type}`, at: `relations.children.${item.key}`, rows: kids, size: DETAIL_PAGE, onChange: rerenderBox });
      return [h('ul', { class: 'chain' }, page.rows.map((k) => row(k, { remove: { title: `Unlink ${k.title}`, run: () => unlinkChild(k) } }))), page.pager];
    })) : null,
    related.length ? group('Related', h('ul', { class: 'chain' }, related.map((r) => row(r, { remove: { title: `Unrelate ${r.title}`, run: () => unrelate(r) } })))) : null,
    nothing ? h('p', { class: 'muted small' }, 'Not linked to anything yet.') : null,
    RELATABLE(item.type) ? addRelation(item, { chain, kids, related, childTypes }) : null);
}

/** The foot of the Relations section: [Related | Parent | Child] + a searchable item list + Add. */
function addRelation(item, { chain, kids, related, childTypes }) {
  const f = item.fields;
  const kinds = [
    item.id ? ['related', 'Related'] : null, // related and children name it by its id: one without can only get a parent
    PARENT_TYPES[item.type].length && !chain.length ? ['parent', 'Parent'] : null, // one parent at most
    item.id && childTypes.length ? ['child', 'Child'] : null,
  ].filter(Boolean);
  if (!kinds.length) return null;
  let kind = kinds[0][0];
  let picked = null;
  const above = new Set(chain.map((p) => p.id));
  const under = descendants(item.id); // itself and everything under it: never its parent
  // Ticketing: a parent of its own project only (any, while it has none); one whose project can change takes its parent's.
  const sameProject = hasField(item.type, 'project') ? inProject(f.project) : () => true;
  const movable = hasField(item.type, 'project') && !(STRUCTURE.project_scoped || []).includes(item.type);
  const inParent = (i) => { const p = i.fields.related_to && state.byId.get(i.fields.related_to); return p ? ` · in ${p.title}` : ''; };
  const candidates = () => {
    if (kind === 'parent') {
      return state.items.filter((i) => i.id && PARENT_TYPES[item.type].includes(i.type) && !under.has(i.id) && !isDone(i) && sameProject(i))
        .map((i) => [i.id, titled(i)]);
    }
    if (kind === 'child') { // one that hangs elsewhere moves here: the label says from where
      const mine = new Set(kids.map((k) => k.id));
      return state.items.filter((i) => i.id && childTypes.includes(i.type) && i.id !== item.id && !above.has(i.id) && !mine.has(i.id) && !isDone(i))
        .map((i) => [i.id, `${titled(i)}${inParent(i)}`]);
    }
    const have = new Set(related.map((r) => r.id));
    return state.items.filter((i) => i.id && RELATABLE(i.type) && i.id !== item.id && !have.has(i.id)).map((i) => [i.id, titled(i)]);
  };
  const addBtn = h('button', { class: 'btn small', type: 'button', disabled: true }, 'Add');
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
    if (kind === 'parent') {
      // Its parent's project comes with it, when it can change (not a ticket, whose project is in its id).
      const was = { related_to: f.related_to || null, ...(movable ? { project: f.project || null } : {}) };
      const project = movable ? parentProject(other) : null;
      const now = { related_to: other.id, ...(project && project !== f.project ? { project } : {}) };
      relink(() => updateItem(item.key, now), () => updateItem(item.key, was), `${item.id || item.title} now hangs from ${other.id}`);
    } else if (kind === 'child') {
      const was = other.fields.related_to || null;
      relink(() => updateItem(other.key, { related_to: item.id }), () => updateItem(other.key, { related_to: was }), `${other.id} now hangs from ${item.id}`);
    } else {
      const before = f.relations || [];
      relink(() => updateItem(item.key, { relations: [...before, other.id] }), () => updateItem(item.key, { relations: before }), `${item.id} and ${other.id} are now related`);
    }
  });
  fillTarget();
  return h('div', { class: 'rel-add' }, kindSel, targetSlot, addBtn);
}

function links(item) {
  const f = item.fields;
  const list = (f.links || []).map((l) => ({ ...l }));
  const saveLinks = () => save(item, { links: list.filter((l) => l.url) });
  const open = (url) => openUrlBtn(url);
  const main = h('input', { type: 'text', inputmode: 'url', value: f.url || '', placeholder: 'Main link — dominio.com or https://…' });
  main.addEventListener('change', () => save(item, { url: main.value.trim() || null }));
  const [mainLabel] = linkLabelControl(f.url_label || '', (v) => save(item, { url_label: v || null }));
  const rows = list.map((l, i) => {
    const [label] = linkLabelControl(l.label || '', (v) => { list[i].label = v || undefined; saveLinks(); });
    const url = h('input', { type: 'text', inputmode: 'url', value: l.url, placeholder: 'dominio.com' });
    url.addEventListener('change', () => { list[i].url = url.value.trim(); saveLinks(); });
    return h('div', { class: 'link-item' },
      h('div', { class: 'link-row' }, label, url, open(l.url),
        h('button', { class: 'btn icon', title: 'Make main link', onclick: () => {
          const promoted = list.splice(i, 1)[0];
          if (f.url) list.unshift({ url: f.url, ...(f.url_label ? { label: f.url_label } : {}) }); // the old main keeps its label
          save(item, { url: promoted.url, url_label: promoted.label || null, links: list });
        } }, icon('star', 14)),
        h('button', { class: 'btn icon', title: 'Remove', onclick: () => { list.splice(i, 1); saveLinks(); } }, icon('x', 14))));
  });
  let newLabel = '';
  const [addLabel, addCustom] = linkLabelControl('', (v) => { newLabel = v; });
  const addUrl = h('input', { type: 'text', inputmode: 'url', placeholder: 'Add link — dominio.com…' });
  const add = () => {
    if (!addUrl.value.trim()) return;
    const label = addCustom.hidden ? newLabel : addCustom.value.trim();
    list.push({ url: addUrl.value.trim(), ...(label ? { label } : {}) });
    saveLinks();
  };
  addUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  return h('section', { class: 'panel-section' },
    h('h4', {}, icon('link', 14), 'Links'),
    // The main link is the first row, marked with a filled star (the others get an outlined one to promote them).
    h('div', { class: 'link-item' },
      h('div', { class: 'link-row main' }, mainLabel, main, open(f.url),
        h('span', { class: 'link-main-mark', title: 'Main link', 'aria-label': 'Main link', role: 'img' }, icon('star', 14)),
        h('span', { class: 'link-spacer' }))),
    rows,
    h('div', { class: 'link-item' },
      h('div', { class: 'link-row' }, addLabel, addUrl, h('button', { class: 'btn small', onclick: add }, 'Add'))));
}

function openPathBtn(path) {
  if (!path) return null;
  return h('button', {
    class: 'btn icon', title: `Open ${path}`,
    onclick: (e) => { e.preventDefault(); api.openPath(path).catch((err) => toast(err.message, true)); },
  }, icon('folder', 14));
}

const openUrlBtn = (url) => (url ? h('a', { class: 'btn icon', href: url, target: '_blank', rel: 'noopener', title: `Open ${url}` }, icon('external', 14)) : null);

// The top of the side panel: where the work happens. An initiative or a story points at an issue of the vault's
// outside tracker (`ext`: Redmine in the folder-per-type structure) and a folder; every item names the session handling it (Session sits
// under Local path; alone where there is none).
function externalRef(item, ext) {
  if (item.type === 'prompt') return null; // a prompt has no side panel
  const f = item.fields;
  const input = (key, attrs) => {
    const el = h('input', { value: f[key] || '', 'data-fk': key, ...attrs });
    el.addEventListener('change', () => save(item, { [key]: el.value.trim() || null }));
    return el;
  };
  const session = field('Session', input('session_name', { type: 'text', placeholder: 'Claude session handling this' }), 'span2');
  if (!item.id || !hasExternalRef(item.type)) { // an item without an id (a Ticketing plan) has no ticket of its own
    return h('section', { class: 'panel-section' }, h('h4', {}, 'Session'), h('div', { class: 'fields' }, session));
  }
  return h('section', { class: 'panel-section' },
    h('h4', {}, `${ext.label} & local`),
    h('div', { class: 'fields' },
      field(`${ext.label} ID`, input(ext.id_key, { type: 'text', placeholder: ext.id_placeholder })),
      field(`${ext.label} URL`, h('div', { class: 'inline' }, input(ext.url_key, { type: 'text', inputmode: 'url', placeholder: ext.url_placeholder }), openUrlBtn(f[ext.url_key]))),
      field('Local path', h('div', { class: 'inline' }, input('local_path', { type: 'text', placeholder: '~/work/pricing' }), openPathBtn(f.local_path)), 'span2'),
      session));
}

/**
 * Watchers (TSK-051): the people and groups of Contacts to tell when the item changes status — by email, Slack…, as
 * each one's "When to use" says. Only the types that have the field (initiatives, user stories, tasks); a prompt for
 * Claude lists them with how to reach each.
 */
function watchers(item) {
  if (!item.id || !hasField(item.type, 'watchers')) return null;
  const names = item.fields.watchers || [];
  return h('section', { class: 'panel-section watchers' },
    h('h4', { title: 'People and groups to tell when its status changes' }, icon('eye', 14), 'Watchers',
      names.length ? h('span', { class: 'muted' }, ` · ${names.length}`) : null),
    tagInput(names, (list) => save(item, { watchers: list }), { kind: 'person', suggest: allContacts, placeholder: 'Add a person or a group…', fk: 'watchers' }));
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
    submitLabel: 'Add',
    onChange: (patch) => logDrafts.set(item.id, Object.assign(draft, patch)),
    onSubmit: async (v) => {
      logDrafts.set(item.id, { ...v, time: '00:00', note: '' }); // keeps the type and the day for the next one
      try { await logWork(item.id, v.kind, v.note, v.date, v.time); } catch { return; }
      toast(`Logged ${v.kind} · ${v.time} on ${item.id}`);
    },
  });

  const entries = logOf(item.id).slice().sort((a, b) => (b.date + (b.at || '')).localeCompare(a.date + (a.at || '')));
  const days = new Set(entries.map((e) => e.date)).size;
  // The records: a table, one row per record; a click opens the row's fields for editing.
  const row = (e) => {
    const key = `${item.id}|${e.date}#${e.index}`;
    if (editingLog === key) {
      return h('tr', { class: 'wl-edit' }, h('td', { colspan: 4 }, logForm({ kind: e.kind, time: e.time, date: e.date, note: e.note || '' }, {
        submitLabel: 'Save', fk: 'log-edit',
        onSubmit: async (v) => {
          editingLog = null;
          try { await updateLog(e.date, e.index, { kind: v.kind, time: v.time, note: v.note, new_date: v.date }); } catch { return; }
          toast('Entry updated');
        },
        onCancel: () => { editingLog = null; rerender(); },
        onDelete: async () => { editingLog = null; try { await unlogWork(e.date, e.index); } catch { /* toasted */ } },
      })));
    }
    const open = () => { editingLog = key; rerender(); };
    return h('tr', {
      class: 'wl-row', tabindex: '0', title: 'Click to edit', 'aria-label': `${e.kind} ${e.time} on ${e.date}`,
      onclick: open,
      onkeydown: (ev) => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); open(); } },
    },
    h('td', { class: `wl-day ${e.date === today() ? 'today' : ''}`, title: `${e.date} · logged at ${e.at || '—'}` }, relDay(e.date)),
    h('td', { class: `wl-time ${e.time === '00:00' ? 'zero' : ''}` }, e.time),
    h('td', {}, h('span', { class: `chip kind k-${String(e.kind).toLowerCase()}` }, e.kind)),
    h('td', { class: 'wl-note', title: e.note || null }, e.note || ''));
  };
  return h('section', { class: 'panel-section' },
    h('h4', {}, icon('clock', 14), 'Log work', entries.length ? h('span', { class: 'muted' }, ` · ${days} day${days > 1 ? 's' : ''} · ${sumTime(entries)}`) : null),
    addForm,
    entries.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid fixed wl-table', style: WL_FIXED.style, 'aria-label': 'Work log entries' }, WL_FIXED.colgroup.cloneNode(true),
      h('thead', {}, h('tr', {}, ['Date', 'Time', 'Type', 'Notes'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, entries.map(row)))) : null);
}

// The side panel's work log: the shared column widths (datatable.js); the notes take the rest.
const WL_FIXED = fixedColumns(['day', 'time', 'kind', 'note'].map((key) => ({ key })));

// Remembered per kind of table (prefs.js): the type of the item it sits on and the type it lists — a task's
// notes, an initiative's notes — so every task shares one choice, never one item alone. A type not named here
// starts as its own list does.
const childSorts = { story: { col: 'status', dir: -1 }, task: { col: 'status', dir: -1 }, note: { col: 'updated_at', dir: -1 }, transcription: { col: 'updated_at', dir: -1 }, meeting: { col: 'date', dir: -1 }, activity: { col: 'updated_at', dir: -1 } };
const childSort = (type) => childSorts[type] || TYPE_DEFS[type]?.list?.sort || { col: 'updated_at', dir: -1 };

// The types whose items close (rules.js isDone): their tables show the open ones unless you pick otherwise.
const childScope = (type) => (type === 'activity' ? 'resolved' : TYPE_DEFS[type]?.statuses?.length ? 'status' : null);

/** What hangs from an item: its children (related_to), or, for a Ticketing project, the tickets that live in it. */
const heldBy = (item) => (item.type === 'project'
  ? (k) => k.fields.project === item.fields.project_key
  : (k) => k.fields.related_to === item.id);
const SCOPE_LABELS = { status: { open: 'Open', closed: 'Closed', all: 'All' }, resolved: { open: 'Unresolved', closed: 'Resolved', all: 'All' } };
const SCOPE_TEST = { open: (k) => !isDone(k), closed: isDone, all: () => true };

/**
 * The items related to `item` of one type, as a tab (childTabs): a sortable table whose rows open the item, with a
 * quick add above it (`qa` is its placeholder; null for no quick add) and, for types that close, Open / Closed / All
 * beside it picking which rows show. The tab counts all of them.
 * All remembered per kind of table (child.scope.<item type>.<type>, the sort, the page size).
 * Before, they were per listed type alone (child.scope.<type>…): what was chosen then is where each starts.
 */
function childTable(item, rerender, { type, title, cols, qa = null }) {
  const holds = heldBy(item);
  const all = state.items.filter((k) => k.type === type && holds(k));
  const labels = SCOPE_LABELS[childScope(type)];
  const kind = `${item.type}.${type}`;
  const remembered = (name, fallback) => pref(`${name}.${kind}`, pref(`${name}.${type}`, fallback));
  const picked = remembered('child.scope', 'open');
  const scope = labels && picked in SCOPE_TEST ? picked : 'all';
  const rows = all.filter(SCOPE_TEST[scope]);
  const closed = labels ? all.filter(isDone).length : 0;
  // Archived items are out of every list; say how many are hidden here so the table does not look short.
  const archived = state.all.filter((k) => k.type === type && holds(k) && k.fields.archived === true).length;
  const scopeBar = labels ? h('div', { class: 'seg section-scope', role: 'group', 'aria-label': `Show ${title.toLowerCase()}` },
    Object.entries(labels).map(([k, l]) => h('button', {
      type: 'button', class: `btn small ${scope === k ? 'active' : ''}`, 'aria-pressed': String(scope === k),
      onclick: () => { setPref(`child.scope.${kind}`, k); rerender(); },
    }, l))) : null;
  const add = qa ? withFk(`page-${type}-qa`, quickAddBar({ type, values: item.type === 'project' ? { project: item.fields.project_key } : { related_to: item.id } }, { placeholder: qa, mic: false })) : null;
  // With items, an empty table is the scope's doing: say so, and how many the default scope hides.
  // (Only types that close have a scope: for the rest, rows are all of them and this is never shown.)
  const none = !all.length || !labels ? `No ${title.toLowerCase()} yet${qa ? ' — add the first one above' : ''}.`
    : `No ${labels[scope].toLowerCase()} ${title.toLowerCase()}${scope === 'open' ? ` — ${closed} ${labels.closed.toLowerCase()}` : ''}.`;
  return {
    key: type, label: title, count: String(all.length), // 0 too: every tab says how many it holds
    content: [
      add || scopeBar ? h('div', { class: 'child-bar' }, add, scopeBar) : null,
      archived ? h('p', { class: 'muted small', title: 'Archived items are hidden from lists and from progress' }, `${archived} archived, not listed`) : null,
      dataTable({
        columns: cols, rows, sort: savedSort(`child.${kind}`, savedSort(`child.${type}`, childSort(type))), label: title,
        paging: { key: `child.${kind}`, at: `child.${item.key}.${type}`, size: DETAIL_PAGE },
        onSort: (s) => { saveSort(`child.${kind}`, s); rerender(); },
        onRow: openFromItem,
        empty: none,
      }),
    ].filter(Boolean),
  };
}

/** What hangs from an item, under its description and files: one tab per table (childTable), each with its count.
 *  The tab shown is remembered per item type (child.tab.<item type>). Nothing when no table applies. */
function childTabs(item, tables) {
  const tabs = tables.filter(Boolean);
  if (!tabs.length) return null;
  const key = `child.tab.${item.type}`;
  return h('section', { class: 'child-tabs' }, ...tabPanels(tabs, pref(key, tabs[0].key), (k) => setPref(key, k)));
}

const NOTE_COLS = [COL.subject, COL.labels, COL.created, COL.updated, COL.id];
const TRANSCRIPTION_COLS = [COL.subject, COL.labels, COL.created, COL.updated, COL.id];
const MEETING_COLS = [COL.subject, COL.labels, COL.date, COL.time, COL.duration, COL.created, COL.updated, COL.attendees, COL.id];
const ACTIVITY_COLS = [COL.subject, COL.labels, COL.source, COL.from, COL.resolved, COL.created, COL.updated, COL.id];

const TASK_TABLE_COLS = TASK_COLUMNS.filter((col) => col.key !== 'parent');

/**
 * What hangs from an item, one table per kind, for every kind PARENT_TYPES lets hang from it: a story has
 * Tasks, Notes and Meetings, a task Notes and Meetings, and any of them Activities once there are some.
 * A type with a page (an initiative…) shows its own tables there (pageTables).
 */
function relatedSections(item, rerender) {
  if (!item.id || TYPE_DEFS[item.type]?.page) return [];
  const can = (type) => (PARENT_TYPES[type] || []).includes(item.type); // a type the vault's structure may not have (Ticketing: no transcriptions)
  const has = (type) => childrenOf(item.id).some((k) => k.type === type);
  return [
    can('task') ? childTable(item, rerender, { type: 'task', title: 'Tasks', cols: TASK_TABLE_COLS, qa: 'Add task…  !high  @today  due:fri' }) : null,
    can('note') ? childTable(item, rerender, { type: 'note', title: 'Notes', cols: NOTE_COLS, qa: 'Add note…' }) : null,
    can('transcription') ? childTable(item, rerender, { type: 'transcription', title: 'Transcriptions', cols: TRANSCRIPTION_COLS, qa: 'Add transcription…' }) : null,
    can('meeting') ? childTable(item, rerender, { type: 'meeting', title: 'Meetings', cols: MEETING_COLS, qa: 'Add meeting…  (@fri for its date)' }) : null,
    can('activity') && has('activity') ? childTable(item, rerender, { type: 'activity', title: 'Activities', cols: ACTIVITY_COLS }) : null,
  ];
}

// The columns and quick add of a table on an item's page, for the types the app always had; any other takes its
// list's columns (tm/structures), without the ones a table under its parent would only repeat.
const PAGE_TABLES = {
  story: { cols: STORY_COLUMNS, qa: 'Add user story…  !high  @today  due:fri' },
  task: { cols: TASK_TABLE_COLS, qa: 'Add task…  !high  @today  due:fri' },
  note: { cols: NOTE_COLS, qa: 'Add note…' },
  meeting: { cols: MEETING_COLS, qa: 'Add meeting…  (@fri for its date)' },
};

/** Whether a Ticketing project has that type: every one, but those it may leave out (hotfixes, PRDs) only when its
 *  note's enabled_types names them (a system project has neither). */
const projectHas = (project, type) => !(STRUCTURE.optional_types || []).includes(type) || (project.fields.enabled_types || []).includes(type);

/** One table per type its structure lists for its page (TypeDef.children), each turned on and able to hang from it. */
function pageTables(item, rerender) {
  const project = item.type === 'project';
  return (TYPE_DEFS[item.type]?.children || [])
    .filter((t) => isEnabled(t) && (project ? projectHas(item, t) : (PARENT_TYPES[t] || []).includes(item.type)))
    .map((t) => {
      const def = TYPE_DEFS[t];
      const known = PAGE_TABLES[t];
      const cols = known?.cols || (def.list?.columns || ['id', 'subject', 'updated']).map(columnOf)
        .filter((c) => c && c.key !== 'parent' && c.key !== 'project' && !(c.key === 'initiative' && item.type === 'initiative'));
      // On a project's page a plan cannot be added from here: it is born under an initiative or a support ticket.
      const qa = project && t === 'plan' ? null : known?.qa || `Add ${def.label.toLowerCase()}…`;
      return childTable(item, rerender, { type: t, title: def.plural, cols, qa });
    });
}

/**
 * The side panel, the same on an item's card and on its page:
 *   Details · the tracker and local folder (or the session), its links, its watchers, its work log, and its settings (a project's)
 *   Delivery · how it is carried out (a Ticketing ticket's executor, branch…): only for a type with such fields
 *   Relations · its project, parent, link fields, children and related
 *   Activity · comments · AI · its Claude conversations
 */
/** The Delivery tab: its fields in the groups the structure gives them (`group`, in order), each under its title, one
 *  field per row. Fields with no group (another structure's) make one section without a title. */
function deliveryGroups(props, b) {
  const groups = [];
  for (const p of props) {
    if (groups.at(-1)?.title !== (p.group || '')) groups.push({ title: p.group || '', icon: p.group_icon, props: [] });
    groups.at(-1).props.push(p);
  }
  return groups.map((g) => h('section', { class: 'panel-section delivery-group' },
    g.title ? h('h4', {}, g.icon ? icon(g.icon, 14) : null, g.title) : null,
    h('div', { class: 'fields' }, g.props.map((p) => propField(b, p)))));
}

function sideTabs(item, rerender, current, onPick) {
  const f = item.fields;
  const b = editBinding(item);
  const settings = propsIn(item.type, 'details');
  const delivery = propsIn(item.type, 'delivery');
  return tabPanels([
    { key: 'details', label: 'Details', content: [
      settings.length ? h('section', { class: 'panel-section' }, h('h4', {}, icon('folder', 14), 'Settings'),
        h('div', { class: 'fields' }, settings.map((p) => propField(b, p)))) : null,
      externalRef(item, EXTERNAL_REF), links(item), watchers(item), workLog(item, rerender)] },
    delivery.length ? { key: 'delivery', label: 'Delivery', content: deliveryGroups(delivery, b) } : null,
    relationsTab(item, rerender),
    docsTab(item, rerender),
    { key: 'activity', label: 'Activity', count: (f.comments || []).length, fill: true, content: activity(item, { heading: false }) },
    { key: 'ai', label: 'AI', count: (f.claude_sessions || []).length, content: aiTab(item) },
  ].filter(Boolean), current, onPick);
}

/**
 * Activity: what happened to the item (created, converted, closed) and your
 * comments, oldest first, with the composer at the bottom — Enter adds one.
 */
function activity(item, { heading = true } = {}) {
  const f = item.fields;
  const when = (stamp) => {
    const [d, t] = String(stamp || '').split('T');
    return d ? `${relDay(d)}${t ? ` · ${t}` : ''}` : '';
  };
  const events = [
    f.created_at ? { at: f.created_at, text: f.converted_from ? `Captured as ${f.converted_from}, converted to ${item.type}` : `Created as ${item.type}` } : null,
    f.completed_at ? { at: f.completed_at, text: `Closed · ${f.status}` } : null,
    f.resolved_at ? { at: f.resolved_at, text: 'Resolved' } : null,
  ].filter(Boolean);
  const comments = (f.comments || []).map((c, index) => ({ ...c, index }));
  const entries = [...events.map((e) => ({ ...e, system: true })), ...comments].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  // A textarea so a comment can span lines: Enter adds it, Shift+Enter or Alt+Enter breaks the line.
  const input = h('textarea', {
    rows: 1, class: 'comment-input', placeholder: 'Write a comment…', title: 'Enter adds the comment · Shift+Enter or Alt+Enter starts a new line', 'aria-label': 'New comment', 'data-fk': 'comment',
  });
  const grow = () => {
    input.style.height = 'auto';
    const borders = input.offsetHeight - input.clientHeight; // height is border-box, scrollHeight is not
    input.style.height = `${input.scrollHeight + borders}px`;
    input.style.overflowY = input.scrollHeight > input.clientHeight ? 'auto' : 'hidden'; // scrollbar only at max height
  };
  const add = async () => {
    const text = input.value.trim();
    if (!text || !item.id) return;
    try { await addComment(item.key, text); } catch { return; } // toasted
    input.value = '';
    grow();
  };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (e.shiftKey || e.altKey) { // browsers only break the line on Shift+Enter, so do it by hand
      input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end');
      grow();
    } else add();
  });
  queueMicrotask(grow); // a re-render can bring back a longer draft
  const section = h('section', { class: 'panel-section activity' },
    heading ? h('h4', {}, icon('message', 14), 'Activity', comments.length ? h('span', { class: 'muted' }, ` · ${comments.length}`) : null) : null,
    h('div', { class: 'activity-list', role: 'log', 'aria-label': 'Activity' },
      entries.length ? entries.map((e) => (e.system
        ? h('div', { class: 'activity-event' }, h('span', {}, e.text), h('time', { class: 'muted small', datetime: e.at }, when(e.at)))
        : h('article', { class: 'activity-card' },
          h('header', {}, h('span', { class: 'activity-author' }, 'You'), h('time', { class: 'muted small', datetime: e.at }, when(e.at)),
            h('button', { class: 'btn icon', title: 'Delete comment', onclick: () => deleteComment(item.key, e.index) }, icon('x', 13))),
          h('p', {}, ...withMentions(e.text)))))
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


// Height at which a rendered description gets clipped behind "See more" (keep in sync with .md-wrap.clamped).
const CLAMP_PX = 240;

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
  target.focus();
  try { if (sel && sel[0] !== null) target.setSelectionRange(...sel); } catch { /* not a text control */ }
}


/**
 * A markdown text block: rendered in a bordered box that opens the editor on click (with
 * Markdown / Both / View and Done — or a click outside it), long text clipped behind "See more". What you type saves
 * itself AUTOSAVE_MS after you stop (and on blur); the title row says Saving… / Saved. The
 * item's description and an activity's resolution are two instances of it.
 *   configure({ label, emptyText, placeholder, title })  what to call it, set per item (title: the item's, for full screen)
 *   write(text) → Promise<string>                 saves a draft, returns the saved text
 *   heading() → nodes                             the title row's content (default: icon + label)
 */
const AUTOSAVE_MS = 800;
const RETRY_MS = [2000, 5000, 10000, 30000]; // a save that failed for any reason but a conflict (server down…) tries again, then every 30s

function mdBlock({ fk, minHeight, write, fetchTheirs = null, heading = null, cls = '' }) {
  let saved = '';
  let autosave = null; // the pending save of what is being typed
  let retries = 0; // failed saves in a row (not conflicts): how long until the next try
  let changed = false; // the file changed on disk while a draft was open: the user picks which text wins
  let inflight = null; // the save in progress: a second flush waits for it instead of sending the same text again
  let draft = null; // unsaved text, or null when clean
  let editing = false;
  let expanded = false; // long text shown in full ("See less") instead of clipped ("See more")
  let outside = null; // while editing: a press anywhere outside the block finishes, as Done does
  const stopOutside = () => { if (outside) document.removeEventListener('pointerdown', outside, true); outside = null; };
  let cfg = { label: 'Description', emptyText: 'Add a more detailed description…', placeholder: '', title: '' };
  const el = h('div', { class: `body-wrap ${cls}` }); // kept across re-renders so the textarea never loses focus
  // Full screen: the block covers the card (on a page, the window) until Close or Esc. Only a class on `el`,
  // never a re-render, so an open editor keeps its text, caret and focus. The first Esc still leaves the
  // editor (mdeditor.js onEscape: Done); the next one, caught here before the card's own Esc, leaves full screen.
  const escFull = (e) => {
    if (!el.isConnected) { document.removeEventListener('keydown', escFull, true); return; }
    if (e.key !== 'Escape' || e.target.closest?.('textarea')) return;
    e.preventDefault(); e.stopPropagation();
    setFull(false);
  };
  const setFull = (on, focus = true) => {
    el.classList.toggle('full', on);
    if (on) document.addEventListener('keydown', escFull, true);
    else document.removeEventListener('keydown', escFull, true);
    if (focus) (el.querySelector('textarea') || el.querySelector(on ? '.body-full-close' : '.full-btn'))?.focus({ preventScroll: true });
  };

  const setStatus = (text) => { const s = el.querySelector('.unsaved'); if (s) s.textContent = text; };
  const blk = {
    el,
    configure(next) { cfg = { ...cfg, ...next }; },
    reset(text = '') { stopOutside(); clearTimeout(autosave); retries = 0; saved = text || ''; draft = null; editing = false; expanded = false; changed = false; setFull(false, false); el.replaceChildren(); },
    /** The file changed on disk under an open draft: show the choice instead of silently overwriting. */
    markChanged() { if (!changed) { changed = true; blk.render(); } },
    isChanged: () => changed,
    clearDraft() { clearTimeout(autosave); draft = null; },
    hasUnsaved: () => draft !== null && draft !== saved,
    isEditing: () => editing,
    ready: () => el.childNodes.length > 0,
    async flush() {
      // A blur and a click can both ask to save the same text. Only one goes out: the other waits for it and then
      // looks again, because the file's version has moved on and a second send would conflict with the first.
      clearTimeout(autosave);
      if (inflight) { await inflight; return blk.flush(); }
      if (!blk.hasUnsaved()) { draft = null; return true; }
      const sending = draft;
      setStatus('Saving…');
      inflight = (async () => {
        try {
          saved = await write(sending);
          if (draft === sending) draft = null; // typed more meanwhile: that stays a draft
          changed = false;
          retries = 0;
          setStatus(blk.hasUnsaved() ? '● unsaved' : 'Saved');
          return true;
        } catch (e) {
          if (e.status === 409) { setStatus('● unsaved'); blk.markChanged(); return false; }
          // Not saved and nothing to choose: keep the draft and try again on our own, without waiting for a keystroke.
          const wait = RETRY_MS[Math.min(retries++, RETRY_MS.length - 1)];
          setStatus(`● not saved — retrying in ${wait / 1000}s`);
          clearTimeout(autosave);
          autosave = setTimeout(() => { if (blk.hasUnsaved() && el.isConnected) blk.flush(); }, wait);
          return false;
        } finally { inflight = null; }
      })();
      return inflight;
    },
    render() {
      const text = draft ?? saved;
      stopOutside();
      const startEdit = () => {
        editing = true;
        blk.render();
        const ta = el.querySelector('textarea');
        if (!ta) return;
        ta.setSelectionRange(0, 0); // the value was set after creation, so the caret would sit at the end and scroll there
        ta.focus({ preventScroll: true });
        ta.scrollTop = 0;
        el.scrollIntoView({ block: 'nearest' });
      };
      // "Reload" takes what is on disk and drops the draft; "Keep mine" saves the draft over it.
      const notice = changed ? h('div', { class: 'body-conflict', role: 'alert' },
        h('span', {}, `This ${cfg.label.toLowerCase()} changed on disk while you were editing it.`),
        h('button', { class: 'btn small', onmousedown: (e) => e.preventDefault(), onclick: async () => {
          const theirs = fetchTheirs ? await fetchTheirs() : null;
          if (theirs === null) return;
          saved = theirs; draft = null; changed = false; editing = false; blk.render();
        } }, 'Reload (drop mine)'),
        h('button', { class: 'btn small primary', onmousedown: (e) => e.preventDefault(), onclick: async () => {
          try { saved = await write(draft ?? saved, true); draft = null; changed = false; editing = false; blk.render(); } catch { /* toasted */ }
        } }, 'Keep mine')) : null;
      const toggle = h('div', { class: 'body-tabs' },
        h('h4', {}, ...(heading ? heading() : [icon('text', 15), cfg.label])),
        h('span', { class: 'muted unsaved small' }, blk.hasUnsaved() ? '● unsaved' : ''),
        text.trim() ? h('button', {
          class: 'btn icon', title: `Copy the ${cfg.label.toLowerCase()} (Markdown)`,
          onmousedown: (e) => e.preventDefault(), // while editing: no blur, no save
          onclick: async () => {
            const now = el.querySelector('textarea')?.value ?? draft ?? saved; // what is on screen, typed or not
            try { await navigator.clipboard.writeText(now); toast(`${cfg.label} copied`); } catch { toast(`Could not copy the ${cfg.label.toLowerCase()}`, true); }
          },
        }, icon('copy', 14)) : null,
        !editing && text.trim() ? h('button', { class: 'btn small', onclick: startEdit }, icon('pencil', 13), 'Edit') : null,
        h('button', { class: 'btn icon full-btn', title: 'Full screen', onmousedown: (e) => e.preventDefault(), onclick: () => setFull(true) }, icon('maximize', 14)));
      // Shown only in full screen (CSS): the item's title and the way back.
      const fullHead = h('div', { class: 'body-full-head' }, h('h2', {}, cfg.title || cfg.label),
        h('button', { class: 'btn ghost body-full-close', title: 'Exit full screen (Esc)', onmousedown: (e) => e.preventDefault(), onclick: () => setFull(false) },
          'Close', icon('restore', 14)));
      let content;
      if (editing) {
        const mde = mdEditor({
          value: text, minHeight, label: cfg.label, fk, highlight: 'markdown',
          placeholder: cfg.placeholder,
          // Esc is Done: back to the text as it reads once all is saved, waiting for a save still on its way.
          onEscape: () => done(),
          onInput: (v) => {
            draft = v;
            setStatus('● unsaved');
            clearTimeout(autosave);
            autosave = setTimeout(() => blk.flush(), AUTOSAVE_MS); // a 409 here shows the Reload / Keep mine choice
          },
        });
        content = mde.el;
        mde.textarea.addEventListener('blur', () => blk.flush());
        mde.textarea.addEventListener('keydown', (e) => {
          if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'Enter')) { e.preventDefault(); done(); }
        });
        // Everything typed is already saved (or about to be): Done saves what is pending and closes the editor.
        const keep = (e) => e.preventDefault();
        const done = () => blk.flush().then((ok) => { if (ok) { editing = false; blk.render(); } });
        // A press outside the block (not in full screen, where the block is all there is) saves and leaves the
        // editor, back to the text as it reads. A save that needs a choice (changed on disk) keeps it open.
        outside = (e) => {
          if (!el.isConnected) { stopOutside(); return; }
          if (el.contains(e.target) || el.classList.contains('full')) return;
          stopOutside();
          done();
        };
        document.addEventListener('pointerdown', outside, true);
        el.replaceChildren(fullHead, toggle, ...(notice ? [notice] : []), content, h('div', { class: 'body-actions' },
          h('span', { class: 'muted small' }, 'Markdown · saves as you type · ⌘↵ to finish · Esc leaves the editor'),
          h('button', { class: 'btn small primary', onmousedown: keep, onclick: done }, 'Done')));
        return;
      } else if (!text.trim()) {
        content = h('button', { class: 'body-empty', onclick: startEdit }, cfg.emptyText);
      } else {
        content = h('div', { class: 'md' });
        // renderMarkdown() sanitizes with DOMPurify (and fails closed without it).
        content.innerHTML = renderMarkdown(text);
        // Make checklist boxes clickable: the n-th box toggles the n-th "[ ]"/"[x]" marker.
        content.querySelectorAll('input[type=checkbox]').forEach((box, n) => {
          box.disabled = false;
          box.addEventListener('change', () => {
            let i = -1;
            draft = text.replace(/^(\s*[-*+]\s+)\[([ xX])\]/gm, (m, pre, mark) =>
              (++i === n ? `${pre}[${mark === ' ' ? 'x' : ' '}]` : m));
            blk.flush();
          });
        });
      }
      if (editing || !text.trim()) { el.replaceChildren(fullHead, toggle, ...(notice ? [notice] : []), content); return; }

      // A long description is clipped with a "See more" toggle; measured before the next paint.
      const wrap = h('div', { class: 'md-wrap', title: 'Click to edit' }, content);
      // One click anywhere in the box opens the editor, unless it was a link, a checklist box, or the end of a text selection.
      wrap.addEventListener('click', (e) => {
        if (e.target.closest('input, a') || window.getSelection().toString()) return;
        startEdit();
      });
      const more = h('button', { class: 'btn small ghost see-more', hidden: true, onclick: () => {
        expanded = !expanded;
        wrap.classList.toggle('clamped', !expanded);
        more.textContent = expanded ? 'See less' : 'See more';
      } });
      el.replaceChildren(fullHead, toggle, ...(notice ? [notice] : []), wrap, more);
      requestAnimationFrame(() => {
        if (content.scrollHeight <= CLAMP_PX + 48) return; // not worth hiding a few lines
        wrap.classList.toggle('clamped', !expanded);
        more.textContent = expanded ? 'See less' : 'See more';
        more.hidden = false;
      });
    }
  };
  return blk;
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
    fk: 'body', minHeight: editorMinHeight,
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

  const ed = {
    get key() { return current; },
    isOpen: () => current !== null,
    hasUnsaved: () => blocks.some((b) => b.hasUnsaved()),
    async load(itemOrKey) {
      const key = typeof itemOrKey === 'string' ? itemOrKey : itemOrKey.key;
      if (ed.hasUnsaved() && current !== key && !(await ed.flush())) return false;
      try {
        const full = await api.item(key);
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
    reset() { current = null; blocks.forEach((b) => b.clearDraft()); onTitle(''); },
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
    body.configure({ title: item.title });
    const remove = async () => {
      blocks.forEach((b) => b.clearDraft());
      try { await deleteItem(item.key); } catch { return; }
      current = null;
      onGone();
    };
    const more = h('button', { class: 'btn icon', title: 'More actions', 'aria-haspopup': 'menu' }, icon('more', 16));
    more.addEventListener('click', () => {
      let armed = false;
      dropdown(more, [
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
    const subject = h('input', { type: 'text', class: 'title-input', value: item.title, 'aria-label': 'Subject', 'data-fk': 'subject' });
    subject.addEventListener('change', () => subject.value.trim() && save(item, { subject: subject.value.trim() }));
    subject.addEventListener('keydown', (e) => { if (e.key === 'Enter') subject.blur(); });
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
      subject, bodyEl: body.el, resolutionEl: item.type === 'activity' ? resolution.el : null, more, pin: pinButton(item), minimize: minimizeButton(), sidebar: sidebarButton(item), copyPath: copyPathButton(item), claude: claudeButton(item), rerender: () => ed.render(),
      foot: h('footer', { class: 'drawer-foot' },
        h('span', {}, `Created ${f.created_at || '—'} · Updated ${f.updated_at || '—'}`
          + (f.completed_at ? ` · Closed ${f.completed_at}` : '')),
        h('span', { class: 'mono', title: item.path }, item.path)),
    };
    // The columns scroll inside the modal and are rebuilt on every render: put their scroll back (a new item starts at the top).
    const keepScroll = scrollFor === current;
    const mainTop = keepScroll ? mainScroller(host())?.scrollTop || 0 : 0;
    const panelTop = keepScroll ? host().querySelector('.tab-panel:not([hidden])')?.scrollTop || 0 : 0;
    // replaceChildren() would print a skipped section as the text "null".
    host().replaceChildren(...layout(item, ctx).flat().filter((x) => x !== null && x !== undefined && x !== false));
    scrollFor = current;
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
  toast(`${item.id} is now ${out.id}`);
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
    toast(`${item.id} ${action === 'promote' ? 'promoted to' : 'escalated to'} ${out.created.id}`);
    openItem(out.created.key);
  }).catch(() => {});
  return [
    isEnabled('initiative') ? h('button', { class: 'btn small', title: 'Create an initiative from it (origin: this ticket); this one waits on hold until it is done',
      onclick: () => run('promote') }, icon('target', 13), 'Promote') : null,
    isEnabled('hotfix') && (project?.fields.enabled_types || []).includes('hotfix')
      ? h('button', { class: 'btn small', title: 'Create a hotfix from it (born in ToDo); this one waits on hold until it is done',
        onclick: () => run('escalate') }, icon('flame', 13), 'Escalate') : null,
  ];
}

// ── item modal ───────────────────────────────────────────────────────────────
// One layout for every item type (modalFrame, itemFields): the type decides which
// properties and sections show up, not where they sit.
//   main: title · properties · description · related tables · (activity: resolution) · foot
//   side: tabs (sideTabs) — Details · Delivery (when the type has it) · Relations · Activity · AI
let sideTab = 'details'; // the side tab in use: kept while the modal re-renders, back to Details whenever an item is opened

function modalLayout(item, c) {
  const f = item.fields;
  modal().classList.toggle('is-prompt', item.type === 'prompt'); // a prompt keeps the smaller card: one column, nothing beside it
  const parent = f.related_to ? state.byId.get(f.related_to) : null;
  const back = parentView ? state.all.find((i) => i.key === parentView.key) : null;
  return modalFrame({
    head: [
      back ? h('button', { class: 'btn small ghost im-back', title: 'Back', onclick: goBack },
        icon('left', 14), `${back.id || ''} ${back.title}`.trim()) : null,
      h('span', { class: `chip t-${item.type}` }, typeIcon(item.type, 12), TYPE_DEFS[item.type]?.label || item.type),
      h('span', { class: 'mono' }, item.id || pageRef(item) || 'no id'),
      parent ? h('span', { class: 'muted small im-in' }, 'in ',
        h('button', { class: 'link', ...opener(parent, openFromItem) }, parent.title)) : null,
      f.archived ? h('span', { class: 'chip warn' }, 'archived') : null,
      item.type === 'activity' ? (f.resolved_at ? h('span', { class: 'chip ok' }, icon('check', 12), 'resolved') : h('span', { class: 'chip warn' }, 'unresolved')) : null,
      h('span', { class: 'spacer' }),
      // Claude first, left of everything else (on the page only the Favourites star goes before it).
      c.claude, item.type === 'inbox' ? convertButton(item) : resolveButton(item), ...ticketActions(item), c.pin, c.minimize, c.copyPath, c.more,
      h('button', { class: 'btn icon', title: 'Close (Esc)', onclick: closeItem }, icon('x', 16)),
    ],
    title: modalTitle(item.type, c.subject),
    main: [
      h('div', { class: 'im-props' }, itemFields(editBinding(item))),
      h('section', { class: 'im-section' }, c.bodyEl),
      item.type === 'prompt' ? null : attachmentsSection(item), // its files, right under what it says
      c.resolutionEl ? h('section', { class: 'panel-section' }, c.resolutionEl) : null,
      childTabs(item, relatedSections(item, c.rerender)),
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

/** Shows an item in the modal; a type with a page (rules.js hasPage) opens it instead. `parent` is the snapshot to go back to, `restore` one to come back to. */
async function show(itemOrKey, { parent = null, restore = null } = {}) {
  const known = typeof itemOrKey === 'string'
    ? state.byId.get(itemOrKey) || state.all.find((i) => i.key === itemOrKey) : itemOrKey;
  if (hasPage(known)) {
    if (modalEd.isOpen()) await closeAll();
    location.hash = pageHref(known); // a route, not a modal: there is nothing to go back to
    return true;
  }
  const wasOpen = modalEd.isOpen();
  if (!(await modalEd.load(itemOrKey))) return false;
  unminimize(modalEd.key); // open again, from its chip or from anywhere: no longer minimized
  parentView = parent;
  sideTab = restore?.tab || 'details';
  if (!wasOpen) returnFocus = document.activeElement;
  backdrop().hidden = false;
  backdrop().onmousedown = (e) => { if (e.target === backdrop()) closeItem(); };
  modal().onkeydown = (e) => { if (e.key === 'Tab') trapFocus(modal(), e); };
  modalEd.render();
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
/** A scorecard: what it measures, the number, an optional bar and a line of detail. */
function stat(label, value, { sub = null, pct = null } = {}) {
  return h('div', { class: 'stat' },
    h('span', { class: 'stat-label' }, label),
    h('b', {}, value),
    pct === null ? null : h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div', { style: `width:${pct}%` })),
    sub ? h('span', { class: 'stat-sub' }, sub) : null);
}

let pageTab = 'details'; // the right panel's tab, kept while the page re-renders
const SIDE_KEY = 'tm.iniSidePanel'; // one choice for every page (named when only initiatives had one)
const sidePanelOpen = () => { try { return localStorage.getItem(SIDE_KEY) !== 'closed'; } catch { return true; } };

/** The scorecards at the top of a page: what is done of it (an initiative, a PRD), or what its project holds open. */
function pageStats(item) {
  if (item.type === 'project') {
    const mine = state.items.filter(heldBy(item));
    const open = (t) => mine.filter((k) => k.type === t && !isDone(k));
    const late = open('support').filter(isOverdue).length;
    return [
      ...['initiative', 'support', 'hotfix'].filter((t) => isEnabled(t) && TYPE_DEFS.project.children.includes(t) && projectHas(item, t)).map((t) => {
        const all = mine.filter((k) => k.type === t).length;
        return stat(TYPE_DEFS[t].plural, open(t).length, { sub: all ? `open of ${all}` : 'None yet' });
      }),
      isEnabled('support') ? stat('Overdue', late, { sub: late ? 'support past its due date' : 'No support overdue' }) : null,
    ];
  }
  const days = new Set(logOf(item.id).map((e) => e.date)).size;
  const p = progress(item.id);
  const stories = childrenOf(item.id).filter((k) => k.type === 'story');
  const storiesClosed = stories.filter(isDone).length;
  return [
    stat('Progress', `${p.pct}%`, { pct: p.pct, sub: p.total ? `${p.done} of ${p.total} closed` : 'No tasks yet' }),
    stat('Open', p.total - p.done, { sub: p.total ? `of ${p.total} task${p.total > 1 ? 's' : ''}` : 'No tasks yet' }),
    stat('Days', days, { sub: days ? `${sumTime(logOf(item.id))} logged` : 'None logged' }),
    isEnabled('story') && (TYPE_DEFS[item.type]?.children || []).includes('story')
      ? stat('Stories', stories.length ? `${storiesClosed}/${stories.length}` : '—', { sub: stories.length ? 'closed' : 'None yet' }) : null,
  ];
}

/** Under the title: its status (or, for a project, its key and kind) and when it last changed. */
function pageMeta(item) {
  const f = item.fields;
  const lead = item.type === 'project'
    ? [h('span', { class: 'chip project-chip mono' }, f.project_key || '—'), f.project_kind ? h('span', { class: 'chip' }, f.project_kind) : null]
    : hasField(item.type, 'status') ? [statusChip(item)] : [];
  return h('div', { class: 'page-meta' }, ...lead, h('span', { class: 'muted small' }, `Updated ${String(f.updated_at || '—').replace('T', ' ')}`));
}

/**
 * An item's page (#/<type>/<ref>), for every type with one (an initiative; in Ticketing a project and a PRD too):
 * two panels. Left, everything about the item and a table of each kind that hangs from it; right, the same tabbed
 * panel as its card (sideTabs), which can be folded away. Same blocks, same components as the card.
 */
function pageLayout(item, c, rerender) {
  const f = item.fields;
  const def = TYPE_DEFS[item.type] || {};
  const parent = f.related_to ? state.byId.get(f.related_to) : null;
  const project = hasProject(item.type) ? projectOf(item) : null;
  const up = parent || project; // where the crumbs lead: its parent, else the project it lives in
  const open = sidePanelOpen();
  const body = h('div', { class: `page-body ${open ? '' : 'collapsed'}` });
  const toggle = h('button', { class: `btn icon toggle ${open ? 'on' : ''}`, 'aria-pressed': String(open), title: open ? 'Hide the side panel' : 'Show the side panel' }, icon('panel', 16));
  toggle.addEventListener('click', () => {
    const folded = body.classList.toggle('collapsed');
    toggle.classList.toggle('on', !folded);
    toggle.setAttribute('aria-pressed', String(!folded));
    toggle.title = folded ? 'Show the side panel' : 'Hide the side panel';
    try { localStorage.setItem(SIDE_KEY, folded ? 'closed' : 'open'); } catch { /* it just opens again next time */ }
  });
  const crumbs = h('nav', { class: 'crumbs' },
    h('a', { href: `#/${def.route || 'today'}` }, def.plural || item.type),
    up ? [icon('right', 13), h('a', { href: itemHref(up) }, up.title)] : null,
    icon('right', 13),
    h('span', { class: 'mono' }, item.id || pageRef(item) || 'no id'),
    f.archived ? h('span', { class: 'chip warn' }, 'archived') : null,
    h('span', { class: 'spacer' }),
    c.sidebar, c.claude, c.pin, c.copyPath, c.more, toggle);

  const main = [
    c.subject,
    pageMeta(item),
    h('div', { class: 'page-stats' }, ...pageStats(item)),
    h('section', { class: 'panel-section props' }, h('h4', {}, 'Properties'), itemFields(editBinding(item))),
    h('section', { class: 'panel-section' }, c.bodyEl),
    attachmentsSection(item),
    // What hangs from it, one tab per kind its structure lists for its page, turned on and able to hang from it.
    // Every other link (sub-initiatives, its PRD, its plan…) lives in the Relations tab of the side panel.
    childTabs(item, pageTables(item, rerender)),
    c.foot,
  ];
  const side = sideTabs(item, rerender, pageTab, (key) => { pageTab = key; });
  body.append(h('div', { class: 'page-main' }, ...main), h('aside', { class: 'page-side im-side tabbed' }, ...side));
  return [crumbs, body];
}

const statusChip = (item) => statusPill(item.fields.status || 'Backlog');

/** An editor that renders an item as a full page inside `container`. */
export function createPageEditor(container, { onGone }) {
  const ed = createEditor({
    host: () => container,
    layout: (item, c) => { container.classList.add('two-panel'); return pageLayout(item, c, () => ed.render()); },
    onGone, editorMinHeight: '420px', onTitle: (name) => { if (name) setPageTitle(name); },
  });
  return ed;
}

export const disposeEditor = (ed) => editors.delete(ed);
