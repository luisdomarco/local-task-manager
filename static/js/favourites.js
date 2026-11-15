// The sidebar's Favourites: the projects and initiatives starred on their page (panel.js sidebarButton), in the order
// dragged there (<root>/.task-manager/sidebar.md). Pure (no DOM, no state), tested on its own
// (tests/js/favourites.test.mjs); main.js draws them.

/** The types that can be a favourite. */
export const FAVOURITE_TYPES = ['project', 'initiative'];

/** Whether it is starred. An initiative's file without the key, from before the default changed, still is one; a
 *  project's is not (projects got the star later: each existing one would turn into one at once). */
export function isFavourite(item) {
  if (!item?.id) return false;
  if (item.type === 'project') return item.fields.sidebar === true;
  if (item.type === 'initiative') return item.fields.sidebar !== false;
  return false;
}

/**
 * The favourites in the order the sidebar shows them: first those placed in `order` (ids, as dragged), then the rest —
 * projects before initiatives, each by `rank` (a number, lower first: main.js gives closed, then under way, then not
 * started), then by title.
 */
export function favourites(items, order = [], rank = () => 0) {
  const placed = (i) => { const r = order.indexOf(i.id); return r < 0 ? Infinity : r; };
  const typeRank = (i) => FAVOURITE_TYPES.indexOf(i.type);
  return items.filter((i) => FAVOURITE_TYPES.includes(i.type) && isFavourite(i))
    .sort((a, b) => (placed(a) - placed(b)) || typeRank(a) - typeRank(b) || rank(a) - rank(b) || a.title.localeCompare(b.title));
}

/** A project's progress, as an initiative's ring draws it: its tasks closed of all its tasks. */
export function projectProgress(items, projectId, isDone) {
  const tasks = items.filter((i) => i.type === 'task' && i.fields.project === projectId);
  const done = tasks.filter(isDone).length;
  return { done, total: tasks.length, pct: tasks.length ? Math.round((100 * done) / tasks.length) : 0 };
}
