// What the Live editor's menus offer, as data (no DOM, no CodeMirror; tests/js/completions.test.mjs). vaultlinks.js
// turns it into CodeMirror completion sources with the vault's docs, items and people.
//   /   at the start of a line: a block to start (a heading, a list, a table…)
//   [[  a doc of the vault, written [[Its name]] as Obsidian links it, or an item, written as its ref (STY-482): plain
//       text any editor and any agent reads, drawn as a link to the item
//   @   a person or a group of Contacts, written @[Public name] (mentions.js)
import { matchItems } from './composer.js';

/** The / menu. `text` is inserted in place of the /…; `caret` is where the cursor goes in it (default: the end). */
export const SLASH = [
  { key: 'h1', label: 'Heading 1', detail: '#', text: '# ' },
  { key: 'h2', label: 'Heading 2', detail: '##', text: '## ' },
  { key: 'h3', label: 'Heading 3', detail: '###', text: '### ' },
  { key: 'ul', label: 'Bullet list', detail: '-', text: '- ' },
  { key: 'ol', label: 'Numbered list', detail: '1.', text: '1. ' },
  { key: 'task', label: 'Checklist', detail: '- [ ]', text: '- [ ] ' },
  { key: 'quote', label: 'Quote', detail: '>', text: '> ' },
  { key: 'code', label: 'Code block', detail: '```', text: '```\n\n```', caret: 4 },
  { key: 'table', label: 'Table', detail: '| |', text: '| Column | Column |\n| --- | --- |\n|  |  |', caret: 2, select: 6 },
  { key: 'rule', label: 'Divider', detail: '---', text: '---\n' },
  { key: 'link', label: 'Link to a doc or an item', detail: '[[', text: '[[', reopen: true },
  { key: 'date', label: 'Today’s date', detail: 'YYYY-MM-DD', text: null },
];

const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The / commands for `query` (what follows the /): those whose name starts with it, then those with a word that does. */
export function slashMatches(query) {
  const q = norm(query).trim();
  if (!q) return SLASH;
  const starts = SLASH.filter((c) => norm(c.label).startsWith(q) || c.key === q);
  const words = SLASH.filter((c) => !starts.includes(c) && norm(c.label).split(/\s+/).some((w) => w.startsWith(q)));
  return [...starts, ...words];
}

/** The text a / command inserts and where the cursor goes: { text, from, to } (from…to selected, offsets in text). */
export function slashText(cmd, today = new Date()) {
  if (cmd.key === 'date') {
    const p = (n) => String(n).padStart(2, '0');
    const t = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
    return { text: t, from: t.length, to: t.length };
  }
  const at = cmd.caret ?? cmd.text.length;
  return { text: cmd.text, from: at, to: at + (cmd.select || 0) };
}

/**
 * Where a menu opens, from the text of the line up to the cursor: { kind: '/' | '[[' | '@', query, start } (`start`:
 * the offset in that text where what gets replaced begins), or null.
 * / only first on its line (after its indent); [[ anywhere, up to a ] or the end of the line; @ at the start or after
 * a space or a bracket, so an address (a@b.c) does not open it.
 */
export function menuAt(before) {
  const s = String(before);
  const slash = /^(\s*)\/([\w-]{0,20})$/.exec(s);
  if (slash) return { kind: '/', query: slash[2], start: slash[1].length };
  const wiki = /\[\[([^\]\n]{0,60})$/.exec(s);
  if (wiki) return { kind: '[[', query: wiki[1], start: wiki.index };
  const at = /(?:^|[\s([{>])@([^\s@[\]()]{0,30}(?: [^\s@[\]()]{0,30}){0,3})$/.exec(s);
  if (at) return { kind: '@', query: at[1], start: s.length - at[1].length - 1 };
  return null;
}

/** A Markdown file's name without its folders and its .md: how Obsidian names it in [[…]]. */
export const docStem = (path) => String(path).split('/').pop().replace(/\.md$/i, '');

/**
 * The docs for a [[ query, best first: names starting with it, then names with a word that does, then paths that
 * contain it; shorter paths first within each. No query: the first `limit` by name.
 * `paths`: the vault's Markdown files that are not items.
 */
export function docMatches(paths, query, limit = 8) {
  const q = norm(query).trim();
  const byLen = (a, b) => a.length - b.length || a.localeCompare(b);
  if (!q) return [...paths].sort((a, b) => docStem(a).localeCompare(docStem(b))).slice(0, limit);
  const name = (p) => norm(docStem(p));
  const starts = paths.filter((p) => name(p).startsWith(q)).sort(byLen);
  const words = paths.filter((p) => !name(p).startsWith(q) && name(p).split(/[\s._-]+/).some((w) => w.startsWith(q))).sort(byLen);
  const seen = new Set([...starts, ...words]);
  const inPath = paths.filter((p) => !seen.has(p) && norm(p).includes(q)).sort(byLen);
  return [...starts, ...words, ...inPath].slice(0, limit);
}

/** The items for a [[ query (composer.js matchItems: by id, then title; open ones first). */
export const itemMatches = (items, query, opts = {}) => matchItems(items, query, { limit: 6, ...opts });
