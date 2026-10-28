// The chat composer's pickers, as data: `/` offers the session's commands at the start of a message, `@` the files
// and folders of the session's folder anywhere in it, `#` the vault's items, to attach to the message. No DOM here
// (chat.js draws the menu), and how a pasted image is sized; tested in tests/js/composer.test.mjs.
import { rank } from './search.js';

const MAX = 8;

/**
 * The picker the caret is in: { kind: '/' | '@' | '#', query, start } (`start`: where its character is), or null.
 * `/` only as the first thing in the message (claude reads a command there and nowhere else); `@` and `#` at the start
 * or after a space or bracket, so an address (a@b.c) or a word with a # in it does not open them.
 */
export function tokenAt(text, caret = text.length) {
  const before = String(text).slice(0, caret);
  const slash = /^\/([\w:.-]*)$/.exec(before);
  if (slash) return { kind: '/', query: slash[1], start: 0 };
  const at = /(?:^|[\s([{"'])([@#])([^\s@#"'`]*)$/.exec(before);
  if (at) return { kind: at[1], query: at[2], start: caret - at[2].length - 1 };
  return null;
}

/** Items for a # query, best first (search.js `rank`: the id, then the title), open ones before closed ones. None
 *  for no query: the vault is too big to list from its first item. */
export function matchItems(items, query, { isClosed = () => false, limit = MAX } = {}) {
  if (!String(query).trim()) return [];
  return items.map((it) => ({ it, r: rank(query, it), closed: isClosed(it) ? 1 : 0 }))
    .filter((x) => x.r !== null)
    .sort((a, b) => a.closed - b.closed || a.r - b.r || String(a.it.id || a.it.title).localeCompare(String(b.it.id || b.it.title)))
    .slice(0, limit).map((x) => x.it);
}

/** The message without the picker's token (a # whose item went to the attachments) — and where the caret goes. */
export function dropToken(text, token, caret) {
  const head = String(text).slice(0, token.start).replace(/ $/, '');
  const tail = String(text).slice(caret);
  const glue = head && tail && !/^\s/.test(tail) ? ' ' : '';
  return { text: head + glue + tail, caret: head.length + glue.length };
}

/** Commands starting with the query, then those containing it, alphabetically within each; claude's internal ones
 *  (a leading _) left out. */
export function matchCommands(commands, query, limit = MAX) {
  const q = String(query).toLowerCase();
  const all = [...new Set(commands)].filter((c) => !c.startsWith('_')).sort();
  return [...all.filter((c) => c.toLowerCase().startsWith(q)), ...all.filter((c) => !c.toLowerCase().startsWith(q) && c.toLowerCase().includes(q))]
    .slice(0, limit);
}

/**
 * Paths (folders end in /) for an @ query, best first. Every word of the query must be in the path; a path scores
 * higher when its name (the last part) starts with the last word, then when the name contains it, then when only the
 * path does. Within a score, shorter paths first: the file at the top of the tree before the one buried in it.
 * No query: the folders and files at the top of the tree; a query ending in / (a folder just picked): what is in it.
 */
export function matchFiles(paths, query, limit = MAX) {
  const inFolder = (dir) => paths.filter((p) => p.toLowerCase().startsWith(dir) && p.length > dir.length && !p.slice(dir.length, -1).includes('/'));
  const q = String(query).toLowerCase();
  if (!q || q.endsWith('/')) {
    const children = inFolder(q);
    if (children.length || !q) return children.slice(0, limit);
  }
  const words = q.split(/[\s/]+/).filter(Boolean);
  const last = words[words.length - 1];
  const scored = [];
  for (const p of paths) {
    const lower = p.toLowerCase();
    if (!words.every((w) => lower.includes(w))) continue;
    const name = lower.replace(/\/$/, '').split('/').pop();
    const score = name.startsWith(last) ? 0 : name.includes(last) ? 1 : 2;
    scored.push([score, p.length, p]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : 1));
  return scored.slice(0, limit).map((s) => s[2]);
}

/** The message with the picked entry in place of the token: `/command ` or `@path ` — and where the caret goes. */
export function insertPick(text, token, caret, value) {
  const head = String(text).slice(0, token.start);
  const tail = String(text).slice(caret).replace(/^\S*/, ''); // the rest of a word being edited mid-way goes too
  const put = `${token.kind}${value}${token.kind === '@' && value.endsWith('/') ? '' : ' '}`; // a folder: keep typing into it
  return { text: head + put + tail.replace(/^ /, ''), caret: head.length + put.length };
}

// ── images ───────────────────────────────────────────────────────────────────
/** The image types a message takes (tm/chat.py IMAGE_MAGIC reads them from the bytes again). */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** An image's size scaled to fit `side` on its longer edge, its shape kept; never made larger. → [width, height]. */
export function imageFit(width, height, side) {
  const scale = Math.min(1, side / Math.max(width, height, 1));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}
