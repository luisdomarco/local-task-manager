// A note's properties (its frontmatter) as Obsidian draws them at the top of a note: each key with the icon of its
// type and its value as that type reads — a list as chips, tags as #tags, a date as a day, a checkbox as a box, a
// [[link]] or a web address as a link. Pure: views/files.js draws the rows; the server's frontmatter.py is what reads
// a note for real (this only shows it).

/** Keys whose type is fixed by their name, as in Obsidian (its `tags`, `aliases` and `cssclasses`). */
const NAMED = { tags: 'tags', tag: 'tags', aliases: 'list', alias: 'list', cssclasses: 'list', cssclass: 'list' };

/** The icon (ui.js ICONS) of each type, as Obsidian's. */
export const PROP_ICONS = { text: 'text', list: 'list', tags: 'tag', number: 'hash', checkbox: 'checkbox', date: 'calendar', datetime: 'clock' };

/**
 * The type of a property, from its key and its value (a string, or an array for a list), as Obsidian infers it:
 * 'tags' · 'list' · 'checkbox' · 'number' · 'date' · 'datetime' · 'text'.
 */
export function propType(key, value) {
  const named = NAMED[String(key).toLowerCase()];
  if (named) return named;
  if (Array.isArray(value)) return 'list';
  const v = String(value ?? '').trim();
  if (/^(true|false)$/i.test(v)) return 'checkbox';
  if (/^-?\d+(\.\d+)?$/.test(v)) return 'number';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date';
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(v)) return 'datetime';
  return 'text';
}

// A [[target#heading|label]] or a web address in a value
const PIECE = /\[\[([^\]|#\n]*)(#[^\]|\n]*)?(?:\\?\|([^\]\n]*))?\]\]|(https?:\/\/[^\s<>"'\])]+)/g;

/**
 * A text value cut into what it reads as: plain `{ text }`, a note `{ text, wiki, heading }` ([[Note#Part|label]]: its
 * label, else its name) and a web address `{ text, url }`. "See [[A]] and https://x.io" → three pieces and two joins.
 */
export function valuePieces(text) {
  const s = String(text ?? '');
  const out = [];
  let at = 0;
  for (const m of s.matchAll(PIECE)) {
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    if (m[4]) {
      const url = m[4].replace(/[.,;:!?]+$/, ''); // the full stop of a sentence is not the address's, as GFM reads it
      out.push({ text: url, url });
      at = m.index + url.length;
      continue;
    } else {
      const heading = m[2] ? m[2].slice(1).trim() : null;
      const wiki = m[1].trim();
      out.push({ text: (m[3] || '').trim() || wiki || heading || '', wiki, heading });
    }
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

/** A tags value as its tags: a list, or a string of them split by commas or spaces; without their `#`. */
const tagsOf = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,\s]+/))
  .map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean);

/** Whether a value says nothing: empty, an empty list or map, or `null` / `~`. */
export const emptyValue = (v) => (Array.isArray(v) ? v.every((x) => emptyValue(x)) : /^(|\[\]|\{\}|null|~)$/.test(String(v ?? '').trim()));

/**
 * The rows of a note's properties header, from splitFrontmatter's `props` ([key, value] pairs), the empty ones left
 * out (Source shows them): `{ key, type, icon, value, items }` — `items` the value's parts as pieces to draw (one per
 * list item or tag, else one; each an array of valuePieces), `value` the raw value (a checkbox's true/false, a date's
 * text).
 */
export function propRows(props) {
  return (props || []).filter(([, v]) => !emptyValue(v)).map(([key, v]) => {
    const type = propType(key, v);
    const list = type === 'tags' ? tagsOf(v) : Array.isArray(v) ? v.filter((x) => !emptyValue(x)) : [v];
    const items = type === 'tags' ? list.map((t) => [{ text: t }]) : list.map((x) => valuePieces(x));
    const value = type === 'checkbox' ? /^true$/i.test(String(v).trim()) : v;
    return { key, type, icon: PROP_ICONS[type], value, items };
  });
}
