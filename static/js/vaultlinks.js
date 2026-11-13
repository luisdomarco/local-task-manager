// The vault behind the editor's links: the / [[ @ menus of the Live editor (CodeMirror completion sources, from the
// data in completions.js), and [[doc]] and STY-482 drawn as links wherever a description is read. The docs come from
// the Explorer's file tree (explorer.js, loaded once and kept fresh there); the items and people from the page's state.
import { docMatches, docStem, itemMatches, menuAt, slashMatches, slashText } from './completions.js';
import { fileTree, loadFiles } from './explorer.js';
import { has } from './features.js';
import { filesHref, linkWikilinks } from './filetree.js';
import { itemHref } from './links.js';
import { liveLoaded } from './livemd.js';
import { refsIn } from './livemarks.js';
import { matchPeople } from './mentions.js';
import { TYPE_DEFS, isDone } from './rules.js';
import { refOf } from './shownid.js';
import { state } from './state.js';

/** The vault's Markdown files that are not items (docs, notes, canvases), from the Explorer's tree: [path]. */
function docPaths() {
  const out = [];
  const walk = (n) => n?.children?.forEach((c) => {
    if (c.kind === 'dir') walk(c);
    else if (!c.item && /\.md$/i.test(c.path)) out.push(c.path);
  });
  walk(fileTree());
  return out;
}

let docsAsked = null;
/** The docs, loading the tree the first time it is needed (the Explorer may not have been opened yet). */
export function docsReady() {
  if (fileTree()?.children?.length) return Promise.resolve(true);
  docsAsked ||= loadFiles().then(() => true, () => false);
  return docsAsked;
}

/** The path of the doc a [[stem]] names, as Obsidian resolves it (the shortest path with that name), or null. */
export function docPathOf(stem) {
  const want = String(stem).trim().toLowerCase();
  const found = docPaths().filter((p) => docStem(p).toLowerCase() === want || p.replace(/\.md$/i, '').toLowerCase() === want);
  return found.sort((a, b) => a.length - b.length)[0] || null;
}

let refCache = { items: null, map: new Map() };
/** The vault's items by the ref the page shows (STY-482, or a long id from before short ids). */
function refMap() {
  if (refCache.items !== state.items) {
    const map = new Map();
    for (const it of state.items || []) { const r = refOf(it); if (r && !map.has(r)) map.set(r, it); }
    refCache = { items: state.items, map };
  }
  return refCache.map;
}
export const isRef = (ref) => refMap().has(ref);
const itemOf = (ref) => refMap().get(ref) || null;

/** Opens what the Live editor's ⌘-click is on: a web link in a new tab, a [[doc]] in the Explorer (at its heading, for
 *  a [[doc#heading]]), a ref's item. */
export function openLink({ href = null, target = null, heading = null, ref = null }) {
  if (href) {
    if (/^(https?:|mailto:)/i.test(href)) window.open(href, '_blank', 'noopener');
    else if (href.startsWith('#/')) location.hash = href.slice(1);
    return;
  }
  if (target) { const p = docPathOf(target); if (p) location.hash = filesHref(p, heading).slice(1); return; }
  const it = ref ? itemOf(ref) : null;
  if (it) location.hash = itemHref(it).slice(1);
}

/** Replaces from…to with `text` ('\n' the document's own line break) and selects a…b of it. */
function put(view, from, to, text, a = text.length, b = a) {
  view.dispatch({
    changes: { from, to, insert: text.replace(/\n/g, view.state.lineBreak) },
    selection: { anchor: from + a, head: from + b },
    scrollIntoView: true,
    userEvent: 'input.complete',
  });
}

/** The Live editor's menus: one CodeMirror completion source for /, [[ and @. */
export function liveSources() {
  const source = async (ctx) => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const m = menuAt(ctx.state.doc.sliceString(line.from, ctx.pos));
    if (!m) return null;
    const from = line.from + m.start;
    if (m.kind === '/') {
      const options = slashMatches(m.query).map((c) => ({
        label: c.label, detail: c.detail,
        apply: (view, _c, f, t) => {
          const { text, from: a, to: b } = slashText(c);
          put(view, f, t, text, a, b);
          if (c.reopen) liveLoaded()?.startCompletion(view);
        },
      }));
      return options.length ? { from, options, filter: false } : null;
    }
    if (m.kind === '[[') {
      await docsReady();
      // A ]] already after the cursor (typed, or left from before) is the link's: it is replaced too.
      const after = ctx.state.doc.sliceString(ctx.pos, Math.min(ctx.pos + 2, line.to)) === ']]' ? 2 : 0;
      const docs = docMatches(docPaths(), m.query, 6).map((p) => {
        const folder = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
        return { label: docStem(p), detail: folder || 'Doc', apply: (view, _c, f, t) => put(view, f, t + after, `[[${docStem(p)}]]`) };
      });
      const items = itemMatches(state.items || [], m.query, { isClosed: isDone }).map((it) => ({
        label: `${refOf(it)} ${it.title || ''}`.trim(), detail: TYPE_DEFS[it.type]?.label || it.type,
        apply: (view, _c, f, t) => put(view, f, t + after, refOf(it)),
      }));
      const options = [...docs, ...items];
      return options.length ? { from, options, filter: false } : null;
    }
    if (!has('contacts')) return null; // @: no Contacts in this vault
    const options = matchPeople(m.query).map((p) => ({
      label: p.name, detail: p.calendar_name && p.calendar_name !== p.name ? p.calendar_name : (p.channel ? 'Group' : ''),
      apply: (view, _c, f, t) => put(view, f, t, `@[${p.name}] `),
    }));
    return options.length ? { from, options, filter: false } : null;
  };
  return [source];
}

/** Markdown with its [[links]] to docs made links to them (the Explorer opens them), for renderMarkdown. */
export const linkVault = (md) => linkWikilinks(md, docPathOf);

/**
 * In rendered Markdown (`root`), the refs of items in this vault (STY-482) made links to them: in text only, never
 * inside a link or code.
 */
export function linkRefs(root) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('a, code, pre') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (/[A-Z]-\d/.test(n.data)) nodes.push(n);
  for (const n of nodes) {
    const found = refsIn(n.data, isRef);
    if (!found.length) continue;
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const r of found) {
      frag.append(n.data.slice(at, r.from));
      const it = itemOf(r.ref);
      const a = document.createElement('a');
      a.className = 'ref-link';
      a.href = itemHref(it);
      a.textContent = r.ref;
      a.title = it.title || r.ref;
      frag.append(a);
      at = r.to;
    }
    frag.append(n.data.slice(at));
    n.replaceWith(frag);
  }
}
