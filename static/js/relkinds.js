// Relation kinds (folder per type): what a relation between equals is, as Redmine names it — Related to, Blocks,
// Precedes, Is duplicate of… The relation is kept on one of the two items (`relations`) with its kind in that item's
// `relation_kinds` ({id: kind}, an id it does not name being `relates`); the other item sees the inverse (Blocks ↔
// Blocked by). `rk` is the structure's `relation_kinds`: { kinds: [[value, label]], inverse: {value: value}, types }.
// Pure: the panel passes the items and the structure's data.

/** Whether a relation between items of these two types can be of a kind other than `relates`. */
export const kinded = (rk, a, b) => !!rk && rk.types.includes(a) && rk.types.includes(b);

/** A kind's name, as Redmine shows it ("Blocked by"). */
export const kindLabel = (rk, kind) => ((rk?.kinds || []).find(([v]) => v === kind) || [kind, kind])[1];

/** What `other` is to `item`: its own kind when `item` keeps the relation, the inverse of `other`'s when `other` does. */
export function kindOf(item, other, rk) {
  if ((item.fields.relations || []).includes(other.id)) return (item.fields.relation_kinds || {})[other.id] || 'relates';
  const kind = (other.fields.relation_kinds || {})[item.id] || 'relates';
  return rk?.inverse?.[kind] || 'relates';
}

/**
 * What makes `other` be `kind` to `item`, written on whichever of the two keeps the relation:
 * { holder, values: { relation_kinds }, was: { relation_kinds } } — `was` puts it back (Undo).
 */
export function kindChange(item, other, kind, rk) {
  const holder = (item.fields.relations || []).includes(other.id) ? item : other;
  const target = holder === item ? other.id : item.id;
  const stored = holder === item ? kind : rk.inverse[kind] || 'relates';
  const was = { ...(holder.fields.relation_kinds || {}) };
  const now = { ...was };
  if (stored === 'relates') delete now[target];
  else now[target] = stored;
  return { holder, values: { relation_kinds: now }, was: { relation_kinds: was } };
}
