// A file brought into a doc (pasted, dropped or picked in the editor: mdeditor.js `attach`): the name it is kept under
// and the text that links or embeds it, as Obsidian writes them. Pure, so it is tested on its own (tests/js/attachtext.test.mjs).
import { IMAGE_FILE } from './filetree.js';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/heic': 'heic' };
// What the browser calls a picture with no name of its own (a screenshot on the clipboard, a picture from another page)
const NAMELESS = /^(image|blob|untitled|clipboard)?(\.\w+)?$/i;
const pad = (n) => String(n).padStart(2, '0');

/** The name a file is uploaded under: its own, or for a nameless picture Obsidian's "Pasted image 20261114153012.png". */
export function keptName(name, type, now = new Date()) {
  const own = String(name || '').trim();
  if (own && !NAMELESS.test(own)) return own;
  const ext = EXT[type] || own.split('.').slice(1).pop() || 'png';
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `Pasted image ${stamp}.${ext}`;
}

/** The text for a file kept at `path` (its vault path): embedded (`![[name.png|300]]`, a picture at 300px wide;
 *  `![[name.pdf]]`) or linked (`[[name.pdf]]`). By name, as Obsidian's shortest form; a name a wikilink cannot hold
 *  (`[ ] # ^ |`) is a Markdown link to the path instead. `embed` left out: pictures embed, other files link. */
export function attachText(path, { embed = null } = {}) {
  const name = String(path).split('/').pop();
  const image = IMAGE_FILE.test(name);
  const inline = embed ?? image;
  if (/[[\]#^|]/.test(name)) {
    const href = `<${path}>`;
    return inline && image ? `![${name}](${href})` : `[${name}](${href})`;
  }
  return inline ? `![[${name}${image ? '|300' : ''}]]` : `[[${name}]]`;
}

/** `text` to put over `value`'s `from`–`to`: an embed (`block`) gets a line of its own — a line break before it when
 *  something is before it on its line, and after it when something follows — so `![[x.png]]` never glues onto a
 *  heading or a sentence; a link goes in as it is. → the text to insert. */
export function placed(value, from, to, text, block) {
  if (!block) return text;
  const before = from > 0 && value[from - 1] !== '\n' ? '\n' : '';
  const after = to < value.length && value[to] !== '\n' ? '\n' : '';
  return before + text + after;
}

/** Whether a drag or a paste carries files from the computer (not text, not a link dragged from the page). */
export const carriesFiles = (dt) => !!dt && [...(dt.types || [])].includes('Files');
