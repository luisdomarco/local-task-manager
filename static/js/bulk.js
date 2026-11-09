// Acting on several items at once (the type lists' bulk bar): what each one's file gets, and what puts it back.
// Pure: the page passes in how a plan reads (itemform.js planValues), so this is tested on its own (tests/js/bulk.test.mjs).

/** The keys an action writes: what Undo puts back, read from the item before the change. */
const KEYS = {
  status: ['status', 'list'],
  priority: ['priority'],
  plan: ['plan_day', 'plan_week', 'plan_month'],
  archive: ['archived'],
  label: ['labels'],
  project: ['project', 'related_to'],
};

/**
 * The patches of one bulk action — [key, values] per item — and the ones that undo it.
 *   status  → the status (a task's board list cleared, as setStatus does, so the Board places it again)
 *   priority → the priority
 *   plan    → `planValues(value)` over a cleared day and week (and month, where it has one)
 *   archive → archived: true
 *   label   → the label added to the item's labels
 *   project → the project (`null`: none); what it hangs from is let go when that lives in another project, so an
 *             item never hangs from one outside its project (as rules.js parentPick when it is picked in the panel)
 * Items the action would not change are left out. (Moving to the trash is not a patch: state.js deleteMany.)
 */
export function bulkPatches(items, action, value, { planValues = () => ({}), projectOf = () => null } = {}) {
  const patch = (i) => {
    if (action === 'status') return i.type === 'task' ? { status: value, list: null } : { status: value };
    if (action === 'priority') return { priority: value };
    if (action === 'plan') return { plan_day: null, plan_week: null, ...(i.fields.plan_month ? { plan_month: null } : {}), ...planValues(value) };
    if (action === 'archive') return { archived: true };
    if (action === 'label') {
      const had = Array.isArray(i.fields.labels) ? i.fields.labels : [];
      return had.includes(value) ? {} : { labels: [...had, value] };
    }
    if (action === 'project') {
      const parent = i.fields.related_to;
      return { project: value || null, ...(parent && projectOf(parent) !== (value || null) ? { related_to: null } : {}) };
    }
    return null;
  };
  const doing = [];
  const undoing = [];
  for (const i of items) {
    const values = patch(i);
    if (!values) continue;
    const changes = Object.entries(values).some(([k, v]) => JSON.stringify(i.fields[k] ?? null) !== JSON.stringify(v ?? null));
    if (!changes) continue;
    doing.push([i.key, values]);
    // archived goes back to false (as setArchived's Undo), the rest to what they were or to nothing
    undoing.push([i.key, Object.fromEntries(KEYS[action].filter((k) => k in values).map((k) => [k, i.fields[k] ?? (k === 'archived' ? false : null)]))]);
  }
  return { doing, undoing };
}
