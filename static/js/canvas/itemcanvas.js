// An item's own canvases (its Canvas tab, panel.js canvasTab): where they are kept, and which items its side column
// offers to put on them as cards. Pure: no DOM, no state (tests/js/itemcanvas.test.mjs).

// What a canvases folder may be named (tm/store.py Store._CANVAS_HOST).
const HOST_RE = /^[A-Za-z][A-Za-z0-9 _-]{0,40}$/;
// What is never a card on an item's canvas: what is not work nor a record of it.
const LEFT_OUT = new Set(['activity', 'inbox', 'transcription']);

/** The folder an item's canvases are kept in (<Docs>/Canvases/<host>): its ref (STY-482), a project's key (ACME).
 *  '' when it has none a folder can be named after (an item not saved yet). */
export function canvasHost(item) {
  const host = String((item?.type === 'project' ? item.fields?.project_key : item?.ref || item?.id) || '');
  return HOST_RE.test(host) ? host : '';
}

/** What a canvas of no item offers (the Canvas page's General ones): every open item with an id, but records of
 *  activity, in `items`' order. */
export const openItems = (items, isDone) => items.filter((k) => k.id && !LEFT_OUT.has(k.type) && !isDone(k));

/**
 * What hangs from `item`, at any depth, still open: a project's tickets (those in it), an initiative's stories and
 * the tasks under them, a meeting's tasks… in `items`' order. `byId`: id → item, for the chain of `related_to`;
 * `isDone(item)`: whether it is closed (rules.js).
 */
export function canvasItems(item, items, byId, isDone) {
  const under = (k) => {
    const seen = new Set([k.id]);
    for (let p = byId.get(k.fields.related_to); p && !seen.has(p.id); p = byId.get(p.fields.related_to)) {
      if (p.id === item.id) return true;
      seen.add(p.id);
    }
    return false;
  };
  const holds = item.type === 'project' ? (k) => k.fields.project === item.fields.project_key : under;
  return items.filter((k) => k.key !== item.key && k.id && !LEFT_OUT.has(k.type) && !isDone(k) && holds(k));
}
