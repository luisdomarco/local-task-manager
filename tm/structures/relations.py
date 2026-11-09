"""Relations between equals, the same in every structure: what one item is to another (Related to, Blocked by,
Precedes…), as Redmine names them (its API's relation_type), in the order the panel offers them.

A relation is kept on one of the two items (`relations`, its kind in `relation_kinds`: {id: kind}, an id it does not
name being `relates`); the other sees its inverse (Blocks ↔ Blocked by). A structure may keep a kind in a field of its
own instead (`fields`): the Projects vault keeps "Blocked by" in `depends_on`, which its templates and devflow read.
"""

KINDS = (('relates', 'Related to'), ('blocked', 'Blocked by (depends on)'), ('blocks', 'Blocks'),
         ('precedes', 'Precedes'), ('follows', 'Follows'), ('duplicates', 'Duplicates'), ('duplicated', 'Duplicated by'),
         ('copied_to', 'Copied to'), ('copied_from', 'Copied from'))
INVERSE = {'relates': 'relates', 'blocked': 'blocks', 'blocks': 'blocked', 'precedes': 'follows', 'follows': 'precedes',
           'duplicates': 'duplicated', 'duplicated': 'duplicates', 'copied_to': 'copied_from', 'copied_from': 'copied_to'}


def relation_kinds(types, fields=None):
    """A structure's `extras['relation_kinds']`: the kinds, their inverses, the types whose relations have them (every
    type that can be related) and, when it has any, the kinds kept in a field of their own ({kind: field}): `A` is
    `kind` to `B` when `B` is in `A`'s field, and the inverse to `B`."""
    return {'kinds': [list(k) for k in KINDS], 'inverse': dict(INVERSE),
            'types': [name for name, t in types.items() if 'relations' in t.fields],
            **({'fields': dict(fields)} if fields else {})}


def _refs(item):
    return [r for r in (item.get('id'), item.get('key')) if r]


def _empty(key):
    return {} if key == 'relation_kinds' else []


def relation_writes(item, other, kind, rk, has):
    """The writes that make `item` be `kind` to `other` — or no longer related, with `kind` None — wherever that is
    kept: [(holder, values, was)], one per item that changes (a kind moving between `relations` and its own field
    changes both). `has(type, field, other_type)` says whether an item of `type` can name one of `other_type` in that
    field. Items are the Store's ({id, key, type, fields}); `rk` the structure's relation_kinds.

    The mirror of static/js/relkinds.js relationWrites, which the panel uses: a change written here (tools/vault.py)
    lands where one made in the app would. Keep the two alike (tests/test_vault_cli.py runs the JS cases here too)."""
    rk = rk or {}
    fields = rk.get('fields') or {}
    inverse = rk.get('inverse') or {}
    writes = {}  # holder key → (holder, values, was), in the order first edited
    def edit(holder, key, change):
        _, values, was = writes.setdefault(holder['key'], (holder, {}, {}))
        if key not in was:
            current = holder['fields'].get(key)
            was[key] = _copy(current)
            values[key] = _copy(current) if current is not None else _empty(key)
        values[key] = change(values[key] if values[key] is not None else _empty(key))

    def relations_of(i):
        return i['fields'].get('relations') or []

    kept = item if other['id'] in relations_of(item) else other if item['id'] in relations_of(other) else None
    for a, b in ((item, other), (other, item)):  # out of wherever it is now
        if b['id'] in relations_of(a):
            edit(a, 'relations', lambda l, b=b: [v for v in l if v != b['id']])
            if b['id'] in (a['fields'].get('relation_kinds') or {}):
                edit(a, 'relation_kinds', lambda m, b=b: {k: v for k, v in m.items() if k != b['id']})
        for field in fields.values():
            if any(v in _refs(b) for v in a['fields'].get(field) or []):
                edit(a, field, lambda l, b=b: [v for v in l if v not in _refs(b)])
    if kind:
        own = next(((k, f) for k, f in fields.items()
                    if (k == kind and has(item['type'], f, other['type'])) or (inverse.get(kind) == k and has(other['type'], f, item['type']))), None)
        if own:
            k, field = own
            holder, target = (item, other) if k == kind and has(item['type'], field, other['type']) else (other, item)
            edit(holder, field, lambda l: [*l, target['id']])
        else:
            holder = kept or item
            target = other if holder is item else item
            stored = kind if holder is item else inverse.get(kind, 'relates')
            had = relations_of(holder)
            edit(holder, 'relations', lambda l: list(had) if target['id'] in had else [*l, target['id']])  # back in its place
            if stored != 'relates':
                edit(holder, 'relation_kinds', lambda m: {**m, target['id']: stored})
    out = []
    for holder, values, was in writes.values():
        keys = [k for k in values if _norm(k, values[k]) != _norm(k, was[k])]
        if keys:
            out.append((holder, {k: values[k] for k in keys}, {k: was[k] for k in keys}))
    return out


def _copy(v):
    return list(v) if isinstance(v, list) else dict(v) if isinstance(v, dict) else v


def _norm(key, v):
    return _empty(key) if v is None else v
