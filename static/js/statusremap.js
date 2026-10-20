// Removing a status that items have (Settings → Item type status): where those items can go, and which of those the
// dialog offers first. Pure, so the node tests reach it (tests/js/statusremap.test.mjs); views/statuses.js draws it.
//
// A row is the Settings draft of one status: { name, group, from, count, removed, to } — `from` its saved name (null
// when it is new), `name` as typed now.

const GROUP_ORDER = ['not_started', 'in_progress', 'closed'];

/** The statuses the type keeps once saved — not removed, with a name, as typed — other than `removed`, in group order
 * then in the order of the rows: [{ name, group }]. */
export function remapTargets(rows, removed) {
  return rows
    .filter((r) => r !== removed && !r.removed && r.name.trim())
    .map((r) => ({ name: r.name.trim(), group: r.group }))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}

/** The name of the target the dialog comes up with, or null to make the user pick one (↵ then does nothing).
 * `rows` are the type's rows as they stand, `removed` among them, so its neighbours can be told. */
// The neighbour in its own group — the one above it, else the one below — so a hasty ↵ keeps the items open or closed
// as they were (and their completed_at). With no other status in that group it offers none: crossing groups is a
// choice the user makes.
export function defaultTarget(targets, removed, rows) {
  const names = new Set(targets.filter((t) => t.group === removed.group).map((t) => t.name));
  const group = rows.filter((r) => r === removed || (r.group === removed.group && names.has(r.name.trim())));
  const at = group.indexOf(removed);
  const near = group[at - 1] || group[at + 1];
  return near ? near.name.trim() : null;
}
