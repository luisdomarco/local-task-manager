// An item's comments, as the page knows them (TSK-128). Where the structure keeps them as files (STRUCTURE
// comments_folder: Projects, `Comments/<ref>/<at>.md`, tm/comments.py) the items carry only when each was written
// (`comment_ats`) and a version of them (`comments_rev`); Activity reads the comments themselves when it shows them
// (GET /api/item/comments). Elsewhere they are the item's `fields.comments`. Pure but `commentStore`'s fetch, which it is
// given; tested in tests/js/comments.test.mjs.

/** The comments in an item's frontmatter, each with its place in the list as its id (how a legacy vault names one). */
export const keptComments = (item) =>
  (item?.fields?.comments || []).map((c, i) => ({ ...(c && typeof c === 'object' ? c : { text: String(c ?? '') }), id: i }));

/** When an item's comments were written, oldest first: its files' (`comment_ats`) and any in its frontmatter. No
 *  comment is read for it. */
export function commentAts(item) {
  const kept = keptComments(item).map((c) => c.at).filter(Boolean);
  return [...kept, ...(item?.comment_ats || [])].sort();
}

/** How many comments an item has. */
export const commentCount = (item) => (item?.comment_ats?.length || 0) + (item?.fields?.comments?.length || 0);

/** A version of an item's comments: when it changes, they are read again. */
export const commentsRev = (item) => `${item?.comments_rev || ''}|${item?.fields?.comments?.length || 0}`;

/** Who wrote a comment, as Activity names them: an agent (a script, a command), else you. */
export const authorOf = (comment) => (comment?.by === 'agent' ? 'Agent' : 'You');

/**
 * Where comments are files: `commentsOf(item, onChange)` → the item's comments, oldest first, each `{ id, at, text, by,
 * edited?, legacy? }` — read once per version of them with `fetch(key)` (→ the list), the last list (or null, the first
 * time) while a new one is on its way, and `onChange()` once it is in. An item with none is not asked about.
 */
export function commentStore(fetch) {
  const cache = new Map(); // item key → { rev, list }
  return function commentsOf(item, onChange = null) {
    const rev = commentsRev(item);
    const had = cache.get(item.key);
    if (had && had.rev === rev) return had.list;
    if (!commentCount(item)) {
      cache.set(item.key, { rev, list: [] });
      return [];
    }
    const entry = { rev, list: had?.list ?? null };
    cache.set(item.key, entry);
    fetch(item.key).then((list) => {
      if (cache.get(item.key) !== entry) return; // a newer version is being read
      entry.list = list;
      onChange?.();
    }, () => {
      if (cache.get(item.key) === entry && entry.list === null) entry.list = [];
      onChange?.();
    });
    return entry.list;
  };
}
