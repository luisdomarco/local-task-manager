// Relation kinds: what a relation between equals is, as Redmine names it — Related to, Blocked by, Precedes,
// Duplicates… — the same in every structure (tm/structures/relations.py). The relation is kept on one of the two items
// (`relations`) with its kind in that item's `relation_kinds` ({id: kind}, an id it does not name being `relates`);
// the other item sees the inverse (Blocks ↔ Blocked by). A structure may keep a kind in a field of its own
// (`rk.fields`, {kind: field}): in the Projects vault "Blocked by" is `depends_on` — A is blocked by B when B is in
// A's depends_on. `rk` is the structure's `relation_kinds`: { kinds: [[value, label]], inverse: {value: value}, types,
// fields? }. Pure: the panel passes the items and the structure's data.

/** Whether a relation between items of these two types can be of a kind other than `relates`. */
export const kinded = (rk, a, b) => !!rk && rk.types.includes(a) && rk.types.includes(b);

/** A kind's name, as the panel shows it ("Blocked by (depends on)"). */
export const kindLabel = (rk, kind) => ((rk?.kinds || []).find(([v]) => v === kind) || [kind, kind])[1];

const refs = (i) => [i.id, i.key].filter(Boolean);
const names = (list, i) => (list || []).some((v) => refs(i).includes(v));
const fieldKinds = (rk) => Object.entries(rk?.fields || {});

/** What `item` is to `other` through a kind kept in a field of its own, or null. */
function fieldKind(item, other, rk) {
  for (const [kind, field] of fieldKinds(rk)) {
    if (names(item.fields[field], other)) return kind;
    if (names(other.fields[field], item)) return rk.inverse[kind] || 'relates';
  }
  return null;
}

/** Whether the two are related as equals, either way, in `relations` or in a kind's own field. */
export const linked = (item, other, rk) => (item.fields.relations || []).includes(other.id)
  || (other.fields.relations || []).includes(item.id) || fieldKind(item, other, rk) !== null;

/** The items `item` is related to as equals, among `items` (each with an id). */
export const relatedIn = (item, items, rk) => (item.id ? items.filter((i) => i.id && i.id !== item.id && linked(item, i, rk)) : []);

/** What `item` is to `other`: a kind's own field first, then its own kind when `item` keeps the relation, the
 *  inverse of `other`'s when `other` does. */
export function kindOf(item, other, rk) {
  const own = fieldKind(item, other, rk);
  if (own) return own;
  if ((item.fields.relations || []).includes(other.id)) return (item.fields.relation_kinds || {})[other.id] || 'relates';
  const kind = (other.fields.relation_kinds || {})[item.id] || 'relates';
  return rk?.inverse?.[kind] || 'relates';
}

const EMPTY = { relations: [], relation_kinds: {} };
const empty = (key, sample) => (key in EMPTY ? EMPTY[key] : Array.isArray(sample) || sample == null ? [] : {});
const clone = (v) => (Array.isArray(v) ? [...v] : v && typeof v === 'object' ? { ...v } : v);
const same = (key, a, b) => JSON.stringify(a ?? empty(key, b)) === JSON.stringify(b ?? empty(key, a));

/**
 * The writes that make `item` be `kind` to `other` — or no longer related, with `kind` null — wherever that is kept:
 * [{ holder, values, was }], one per item that changes (a kind moving between `relations` and its own field changes
 * both); `was` puts it back (Undo). `has(type, field, otherType)` says whether an item of `type` can name one of
 * `otherType` in that field (Projects: a story's depends_on names stories, support and hotfixes). A kind with a field of
 * its own goes there when the item that would keep it can (the inverse: the other one); any other, in `relations`
 * and `relation_kinds` of whichever kept the relation before (else `item`), as that side sees it.
 */
export function relationWrites(item, other, kind, rk, has) {
  const writes = new Map(); // holder → { values, was }
  const edit = (holder, key, change) => {
    const w = writes.get(holder) || { values: {}, was: {} };
    if (!(key in w.was)) { w.was[key] = clone(holder.fields[key] ?? null); w.values[key] = clone(holder.fields[key] ?? empty(key)); }
    w.values[key] = change(w.values[key] ?? empty(key));
    writes.set(holder, w);
  };
  const kept = (item.fields.relations || []).includes(other.id) ? item : (other.fields.relations || []).includes(item.id) ? other : null;
  // Out of wherever it is now: either side's `relations` (with its kind) and either side's kind fields.
  for (const [a, b] of [[item, other], [other, item]]) {
    if ((a.fields.relations || []).includes(b.id)) {
      edit(a, 'relations', (l) => l.filter((v) => v !== b.id));
      if (b.id in (a.fields.relation_kinds || {})) edit(a, 'relation_kinds', (m) => { const n = { ...m }; delete n[b.id]; return n; });
    }
    for (const [, field] of fieldKinds(rk)) if (names(a.fields[field], b)) edit(a, field, (l) => l.filter((v) => !refs(b).includes(v)));
  }
  if (kind) {
    const own = fieldKinds(rk).find(([k, field]) => (k === kind && has(item.type, field, other.type)) || (rk.inverse[kind] === k && has(other.type, field, item.type)));
    if (own) {
      const [k, field] = own;
      const [holder, target] = k === kind && has(item.type, field, other.type) ? [item, other] : [other, item];
      edit(holder, field, (l) => [...l, target.id]);
    } else {
      const holder = kept || item;
      const target = holder === item ? other : item;
      const stored = holder === item ? kind : rk?.inverse?.[kind] || 'relates';
      // Back in its place when it was there: the list keeps its order.
      edit(holder, 'relations', (l) => ((holder.fields.relations || []).includes(target.id) ? [...holder.fields.relations] : [...l, target.id]));
      if (stored !== 'relates') edit(holder, 'relation_kinds', (m) => ({ ...m, [target.id]: stored }));
    }
  }
  return [...writes].map(([holder, { values, was }]) => {
    const keys = Object.keys(values).filter((k) => !same(k, values[k], was[k]));
    return { holder, values: Object.fromEntries(keys.map((k) => [k, values[k]])), was: Object.fromEntries(keys.map((k) => [k, was[k]])) };
  }).filter((w) => Object.keys(w.values).length);
}
