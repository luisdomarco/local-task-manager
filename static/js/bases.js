// An Obsidian base's view as the page draws it (baseview.js), pure: the server works the rows out (tm/bases.py,
// GET /api/bases); here a click on a column sorts them, a cell is read as its property type (props.js) and what is
// typed into one goes back as that type.
import { emptyValue, propType } from './props.js';

/** The key a column's values are typed by (props.js): a note's property without `note.`, `file.tags` as tags. */
export const columnKey = (col) => (col.id.startsWith('note.') ? col.id.slice(5) : col.id === 'file.tags' ? 'tags' : col.id);

/** A column that names the row's file: drawn as a link to it. */
export const isNameColumn = (col) => ['file.name', 'file.basename', 'file.path'].includes(col.id);

/** A file's name as a table shows it: a note without its .md. */
export const shownName = (path) => String(path || '').split('/').pop().replace(/\.md$/i, '');

const DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;

/** A key that orders mixed values: nothing last (either way), numbers and dates by value, text case aside. */
export function sortKey(v) {
  if (v === null || v === undefined || emptyValue(v)) return [2, 0, ''];
  if (typeof v === 'boolean') return [0, v ? 1 : 0, ''];
  if (typeof v === 'number') return [0, v, ''];
  if (Array.isArray(v)) return sortKey(v[0]);
  const s = String(v);
  if (DATE.test(s)) return [0, Date.parse(s.length === 10 ? `${s}T00:00:00` : s) || 0, ''];
  if (/^-?\d+(\.\d+)?$/.test(s)) return [0, Number(s), ''];
  return [1, 0, s.toLocaleLowerCase()];
}

function compareKeys(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * The rows' indexes in the order of column `col` (`dir` 'asc' · 'desc'; none: as the server sent them). Empty cells
 * stay last either way; equal ones keep the server's order.
 */
export function sortedIndexes(rows, col, dir) {
  const idx = rows.map((_, i) => i);
  if (col === null || col === undefined || !dir) return idx;
  const sign = dir === 'desc' ? -1 : 1;
  return idx.sort((a, b) => {
    const ka = sortKey(rows[a].cells[col]);
    const kb = sortKey(rows[b].cells[col]);
    if (ka[0] === 2 || kb[0] === 2) return (ka[0] === 2) - (kb[0] === 2) || a - b;
    return sign * compareKeys(ka, kb) || a - b;
  });
}

/** What a click on a column's head does next: unsorted → ascending → descending → unsorted (the base's own order). */
export function nextSort(sort, col) {
  if (!sort || sort.col !== col) return { col, dir: 'asc' };
  if (sort.dir === 'asc') return { col, dir: 'desc' };
  return null;
}

/** The type a cell is edited as: its value's (props.js), else the column's other values', else text. */
export function cellType(col, rows) {
  const key = columnKey(col);
  const ci = col.index;
  const seen = rows.map((r) => r.cells[ci]).find((v) => !emptyValue(v ?? ''));
  return seen === undefined ? propType(key, '') : propType(key, Array.isArray(seen) ? seen : String(seen));
}

/** A value as the text an editor starts with: a list's items joined by ", ". */
export const editText = (v) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v));

/**
 * What is typed into a cell, as the value written (Store.set_note_property): '' → null (the key is removed), a number
 * for a number, true/false for a checkbox, a list (split by commas) for a list or tags, else the text.
 */
export function parseCell(text, type) {
  if (typeof text === 'boolean') return text;
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (type === 'list' || type === 'tags') return s.split(',').map((x) => x.trim()).filter(Boolean);
  if (type === 'number' && /^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (type === 'checkbox' && /^(true|false)$/i.test(s)) return /^true$/i.test(s);
  return s;
}

/** `x.base#View` of an embed: { path, view }. */
export function embedOf(target) {
  const [path, ...rest] = String(target || '').split('#');
  return { path: path.trim(), view: rest.join('#').trim() || null };
}

/** A summary as its cell reads: "Sum 22", "Average 3.5". */
export const summaryText = (s) => (s ? `${s.name} ${s.value === null || s.value === undefined ? '—' : Array.isArray(s.value) ? s.value.join(', ') : s.value}` : '');
