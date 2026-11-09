// How the page draws an item's id. The server sends it as `ref` (tm/structures Structure.ref): a short id is a number
// with its type's prefix (TSK-482, plans/short-ids.md); a long id from before short ids is the id as it is. `id` stays
// the item's key for everything else (links, pins, sorting): only what is shown changes.

/** The id as the page shows it anywhere: `ref` (TSK-482), else the id (a project's key, an item from before `ref`). */
export function refOf(item) {
  return item?.ref || item?.id || '';
}

/** The id a table draws. A short id is its ref (STY-482). A long Projects id starts with its project's key
 *  (ACME-INI-001), which the row already says (the project's page, or the Project column of a list): the table draws
 *  the rest (INI-001) and keeps the whole id in its tooltip. Any other id as it is. `full`: a table where nothing says
 *  the project (no Project column) draws the whole id, as INI-001 could be any project's. */
export function shownId(item, { full = false } = {}) {
  const id = String(item?.id || '');
  if (item?.ref && item.ref !== id) return item.ref;
  if (full) return id;
  const key = item?.fields?.project;
  const lead = typeof key === 'string' && key ? `${key}-` : '';
  return lead && id.startsWith(lead) && id.length > lead.length ? id.slice(lead.length) : id;
}

/** What an id column sorts by: a short id as a number (STY-9 before STY-10), padded so it compares as text with the
 *  rest; any other id as it is. */
export function idSortKey(item) {
  const id = String(item?.id || '');
  return /^[1-9]\d*$/.test(id) ? id.padStart(12, '0') : id;
}

/** The tooltip of an id column: the whole id when the table draws less of it (ACME-INI-001 drawn INI-001), else the
 *  ids it had before short ids, if any. */
export function idTip(item) {
  const shown = shownId(item);
  if (item?.id && shown !== String(item.id) && !(item.ref && item.ref !== item.id)) return String(item.id);
  return (item?.aliases || []).length ? `Was ${item.aliases.join(', ')}` : null;
}

/** Whether `q` (what was typed, lower-cased) names the item by an id: its ref, its id or one of its old ids. */
export function idMatches(item, q) {
  if (!q) return false;
  return [item?.ref, item?.id, ...(item?.aliases || [])].some((x) => x && String(x).toLowerCase().includes(q));
}
