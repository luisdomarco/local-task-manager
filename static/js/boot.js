// How the page opens a vault (TSK-128): its items a stage at a time, the Inbox first, so it can be used while the rest
// comes in; meanwhile, with no address to go to, the welcome screen (views/welcome.js). Pure: state.js and main.js
// call it, tests/js/boot.test.mjs checks it.

/**
 * The stages a vault's items load in: its structure's `boot_order` ([[label, [types]]], tm/structures), each with
 * only the types the structure has (a type turned off is gone), a stage left empty dropped, and a type it does not
 * name joining the last one. A structure without one (Initiatives, Tasks) is one stage of every type: loaded in one
 * call, as before. → [{ label, types }]
 */
export function stages(structure) {
  const all = (structure?.types || []).map((t) => t.name);
  const order = structure?.boot_order || [];
  const out = order.map(([label, types]) => ({ label, types: types.filter((t) => all.includes(t)) })).filter((s) => s.types.length);
  const placed = new Set(out.flatMap((s) => s.types));
  const rest = all.filter((t) => !placed.has(t));
  if (!out.length) return all.length ? [{ label: 'Items', types: all }] : [];
  if (rest.length) out[out.length - 1] = { ...out[out.length - 1], types: [...out[out.length - 1].types, ...rest] };
  return out;
}

/** The type the welcome screen's one button opens: the Inbox where the first stage has it, else that stage's first. */
export const entryType = (plan) => (plan[0]?.types.includes('inbox') ? 'inbox' : plan[0]?.types[0] || null);

/** What the welcome screen's bar says, `done` stages in: "Inbox ✓ · Projects…"; every one in, nothing. */
export function progressLabel(plan, done) {
  if (done >= plan.length) return '';
  return plan.slice(0, done + 1).map((s, i) => (i < done ? `${s.label} ✓` : `${s.label}…`)).join(' · ');
}

/** Whether a type's items are in yet: `loaded` is the types loaded so far while the page opens, null once all are. */
export const typeLoaded = (type, loaded) => !loaded || loaded.has(type);

/** Whether the page opens on the welcome screen: with no address (`hash`), or with a share — it goes into the Inbox
 *  once that is in. An address of its own (a view reloaded, a link to an item, Open in App) skips it. */
export const welcomeFor = (hash, shared) => !!shared || !hash || hash === '#' || hash === '#/';

/** Where a page with no address goes once its vault is in, and where an unknown address or a view turned off goes:
 *  Today, or the List in a vault where nothing can be planned. The welcome screen is only for while it loads. */
export const homeHash = (structure) => ((structure?.types || []).some((t) => t.plannable) ? '#/today' : '#/table');
