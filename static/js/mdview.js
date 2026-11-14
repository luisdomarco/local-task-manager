// What rendered Markdown gets once its HTML is in the page (drawRendered), wherever a note is read: the Explorer and
// Docs (views/files.js), a description (mdblock.js) and the editor's preview (mdeditor.js).
// - ```mermaid diagrams, ![[x.base]] views and ![[x.drawio]] diagrams (diagrams.js, baseview.js, drawioview.js).
// - ![[Note]], ![[Note#Heading]], ![[Note#^block]]: that note, or that part of it, drawn in a box with its name over
//   it (renderEmbeds), as Obsidian embeds a note; a note embedded in itself, or past EMBED_DEPTH, is named, not drawn.
// - A Copy button on each code block (copyButtons).
// And, for the whole page (once): a footnote's mark scrolls to its note and its ↩ back; a link to a note shows that
// note in a card when the pointer rests on it (hover preview, mouse only), as Obsidian's page preview.
import { renderDiagrams } from './diagrams.js';
import { renderBases } from './baseview.js';
import { renderDrawios } from './drawioview.js';
import { fileUrl } from './api.js';
import { fileTree } from './explorer.js';
import { headingOfParam, linkWikilinks, noteSection, pathOfParam, splitFrontmatter, wikiTarget } from './filetree.js';
import { toast } from './state.js';
import { h, icon, renderMarkdown } from './ui.js';
import { linkHref, linkPaths, linkRefs } from './vaultlinks.js';

/** How deep a note embedded in an embedded note is still drawn (Obsidian stops on a loop; this stops on depth too). */
export const EMBED_DEPTH = 3;

// A note's text, read once for the embeds and previews of a few seconds (a page draws the same note's embeds together).
const READ_FOR = 4000;
const reads = new Map();
function readNote(path) {
  const hit = reads.get(path);
  if (hit && Date.now() - hit.at < READ_FOR) return hit.text;
  const text = fetch(fileUrl(path)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status === 404 ? 'not found' : `${r.status}`))));
  reads.set(path, { at: Date.now(), text });
  text.catch(() => reads.delete(path));
  return text;
}

const stemOf = (path) => path.split('/').pop().replace(/\.md$/i, '');

/** The Markdown of `md` (a note at `self`, else none) rendered into `el`, and everything drawn after it. */
function fill(el, md, { self, href, seen }) {
  const tree = fileTree();
  const linked = tree?.children?.length ? linkWikilinks(md, (t) => wikiTarget(tree, t), { self, href, src: fileUrl }) : md;
  el.innerHTML = renderMarkdown(linked); // sanitized by renderMarkdown (DOMPurify)
  linkPaths(el, { self, href });
  linkRefs(el);
  drawRendered(el, { self, href, seen });
}

/**
 * Each ![[Note]] placeholder in `root` (filetree.js linkWikilinks leaves a `.md-note-embed`) drawn as that note, or the
 * part of it its #heading or #^block names, under a head that links to it. `seen`: the notes it is already inside.
 */
export function renderEmbeds(root, { href = linkHref(), seen = [] } = {}) {
  for (const box of root?.querySelectorAll('.md-note-embed[data-embed]:not([data-drawn])') || []) {
    box.dataset.drawn = '1';
    const path = box.dataset.embed;
    const heading = box.dataset.heading || null;
    const head = h('div', { class: 'note-embed-head' },
      h('a', { href: href(path, heading), class: 'note-embed-name' }, icon('note', 14), heading ? `${stemOf(path)} › ${heading.replace(/^\^/, '')}` : stemOf(path)));
    const say = (text) => box.replaceChildren(head, h('p', { class: 'muted small' }, text));
    if (seen.includes(path)) { say('This note is embedded in itself: it is not drawn again.'); continue; }
    if (seen.length >= EMBED_DEPTH) { say('Embedded too deep to draw here: open it.'); continue; }
    say('Loading…');
    readNote(path).then((text) => {
      if (!box.isConnected) return;
      const part = noteSection(splitFrontmatter(text).body, heading);
      if (part === null) { say(`It has no ${heading.startsWith('^') ? 'block' : 'heading'} “${heading}”.`); return; }
      if (!part.trim()) { say('Empty.'); return; }
      const body = h('div', { class: 'md note-embed-body' });
      fill(body, part, { self: path, href, seen: [...seen, path] });
      box.replaceChildren(head, body);
    }, (e) => { if (box.isConnected) say(`This note could not be read (${e.message}).`); });
  }
}

/** Copies `text`, saying so (as the app's other Copy actions do). */
function copyText(text) {
  Promise.resolve().then(() => navigator.clipboard.writeText(text)).then(() => toast('Code copied'), () => toast('Could not copy', true));
}

/** A Copy button on each code block of `root` (a ```mermaid one is a diagram: none). */
export function copyButtons(root) {
  for (const code of root?.querySelectorAll('pre > code:not(.language-mermaid)') || []) {
    const pre = code.parentElement;
    if (pre.parentElement?.classList.contains('md-code')) continue;
    const wrap = h('div', { class: 'md-code' });
    pre.replaceWith(wrap);
    wrap.append(pre, h('button', {
      type: 'button', class: 'btn icon md-copy', title: 'Copy', 'aria-label': 'Copy code',
      onclick: () => copyText(code.textContent.replace(/\n$/, '')),
    }, icon('copy', 14)));
  }
}

/** A footnote's mark tells its note on hover (its `title`, drawn as the app's tooltip). */
function footTitles(root) {
  for (const a of root?.querySelectorAll('.fn-link[data-fn]:not([title])') || []) {
    const note = a.closest('.md')?.querySelector(`.footnotes [data-fn-note="${a.dataset.fn}"]`);
    if (note) a.title = note.textContent.replace(/↩\s*$/, '').trim().slice(0, 300);
  }
}

/**
 * What rendered Markdown (`root`, filled from renderMarkdown) gets once it is in: diagrams, bases, draw.io diagrams,
 * embedded notes, Copy on code, its footnotes' tooltips. `self`: the note it is (for `this` in a base, and loops of
 * embeds); `href`: where its links open (#/files/… or, in Docs, #/docs/…).
 */
export function drawRendered(root, { self = null, href = linkHref(), seen = null } = {}) {
  if (!root) return;
  hookPage();
  renderDiagrams(root);
  renderBases(root, { self, href });
  renderDrawios(root, { href });
  renderEmbeds(root, { href, seen: seen || (self ? [self] : []) });
  copyButtons(root);
  footTitles(root);
}

// ── for the whole page, once ───────────────────────────────────────────────
let hooked = false;
function hookPage() {
  if (hooked) return;
  hooked = true;
  document.addEventListener('click', onFootnote);
  document.addEventListener('pointerover', onHoverIn);
  document.addEventListener('pointerout', onHoverOut);
  document.addEventListener('pointerdown', (e) => { if (card && !card.contains(e.target)) hideCard(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && card) hideCard(); });
  window.addEventListener('hashchange', () => hideCard());
}

/** The nearest element of `selector` around `from` (in its rendered note, or the note around that one). */
function nearest(from, selector) {
  for (let el = from.parentElement; el && el !== document.body; el = el.parentElement) {
    const found = el.querySelector(selector);
    if (found) return found;
  }
  return null;
}
function onFootnote(e) {
  const mark = e.target.closest?.('.fn-link[data-fn], .fn-back[data-fn-back]');
  if (!mark) return;
  e.preventDefault();
  const to = mark.dataset.fn
    ? nearest(mark, `.footnotes [data-fn-note="${mark.dataset.fn}"]`)
    : nearest(mark, `.fn-link[data-fn="${mark.dataset.fnBack}"]`);
  if (!to) return;
  to.scrollIntoView({ block: 'center', behavior: 'smooth' });
  to.classList.remove('fn-lit');
  void to.offsetWidth; // the flash again, on a second click
  to.classList.add('fn-lit');
}

// Hover preview: one card for the page, shown after the pointer rests on a link to a note.
const HOVER_WAIT = 450;
const HOVER_LEAVE = 250;
let card = null;
let cardLink = null;
let waitTimer = null;
let leaveTimer = null;

/** The note (and heading) a rendered link opens, or null: only a link in read Markdown to a vault note. */
function noteOfLink(a) {
  if (!a?.closest('.md') || a.closest('.md-hover')) return null;
  const m = /^#\/(?:files|docs)\/(.+)$/.exec(a.getAttribute('href') || '');
  if (!m) return null;
  const path = pathOfParam(m[1]);
  return /\.md$/i.test(path) ? { path, heading: headingOfParam(m[1]) } : null;
}
function onHoverIn(e) {
  if (e.pointerType !== 'mouse') return;
  if (card?.contains(e.target)) { clearTimeout(leaveTimer); return; }
  const a = e.target.closest?.('a[href]');
  if (!a || a === cardLink) { if (a) clearTimeout(leaveTimer); return; }
  const note = noteOfLink(a);
  if (!note) return;
  clearTimeout(waitTimer);
  waitTimer = setTimeout(() => showCard(a, note), HOVER_WAIT);
}
function onHoverOut(e) {
  if (e.pointerType !== 'mouse') return;
  const to = e.relatedTarget;
  const a = e.target.closest?.('a[href]');
  if (a && !a.contains(to)) clearTimeout(waitTimer);
  if (!card) return;
  if (card.contains(to) || cardLink?.contains(to)) return;
  if (card.contains(e.target) || cardLink?.contains(e.target)) {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(hideCard, HOVER_LEAVE);
  }
}
function hideCard() {
  clearTimeout(waitTimer);
  clearTimeout(leaveTimer);
  card?.remove();
  card = null;
  cardLink = null;
}
/** Where the card goes: under the link (over it when there is no room), inside the window. */
function place(el, a) {
  const r = a.getBoundingClientRect();
  const w = Math.min(420, window.innerWidth - 16);
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  el.style.width = `${w}px`;
  el.style.left = `${left}px`;
  const below = window.innerHeight - r.bottom - 8;
  const max = Math.min(360, Math.max(below, r.top - 8) - 8);
  el.style.maxHeight = `${Math.max(120, max)}px`;
  if (below >= Math.min(240, max) || below >= r.top) el.style.top = `${r.bottom + 6}px`;
  else el.style.bottom = `${window.innerHeight - r.top + 6}px`;
}
function showCard(a, { path, heading }) {
  if (!a.isConnected) return;
  hideCard();
  const body = h('div', { class: 'md md-hover-body' }, h('p', { class: 'muted small' }, 'Loading…'));
  card = h('div', { class: 'md-hover', role: 'dialog', 'aria-label': `Preview of ${stemOf(path)}` },
    h('div', { class: 'md-hover-head' }, icon('note', 14), heading ? `${stemOf(path)} › ${heading}` : stemOf(path)),
    body);
  cardLink = a;
  document.body.append(card);
  place(card, a);
  const shown = card;
  readNote(path).then((text) => {
    if (card !== shown) return;
    const part = noteSection(splitFrontmatter(text).body, heading) ?? splitFrontmatter(text).body;
    if (!part.trim()) { body.replaceChildren(h('p', { class: 'muted small' }, 'Empty.')); return; }
    fill(body, part, { self: path, href: linkHref(), seen: [path] });
  }, (e) => { if (card === shown) body.replaceChildren(h('p', { class: 'muted small' }, `It could not be read (${e.message}).`)); });
}
