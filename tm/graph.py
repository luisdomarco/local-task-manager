"""The vault as a graph: its items and docs as nodes, every link between them as an edge. Pure: it reads what the
Store hands it (items with their links resolved, the docs' paths, the stems each file's body links to) and writes
nothing. GET /api/graph answers build(); the panel's local graph and tools read neighbors().

An edge is drawn as it is kept, from the item that names the other (`source`) to the one named (`target`):
- `parent`: the item's parent (`related_to`: a story's initiative, a task's ticket…);
- `project`: the project it belongs to;
- `link`: one of its type's link fields (`field`: plan, prd, origin, fixed_by…);
- `relation`: a typed relation (`relation`: relates, blocked, precedes…, as relations.py names them). The other item
  sees its inverse (Blocks ↔ Blocked by): the page derives it, the edge is never doubled. A structure that keeps a kind
  in a field of its own (Projects: Blocked by in `depends_on`) gives an edge of that kind, `field` naming it;
- `mention`: a [[wikilink]] in the body, drawn only when no other edge already joins the same two nodes from it.
A link to nothing the vault has (a deleted note, a placeholder in a template) is no edge.
"""

from collections import deque

KINDS = ('parent', 'project', 'link', 'relation', 'mention')
# What neighbors() follows unless told otherwise: a project links to everything in it, so through it every item is two
# steps from every other one of its project.
NEIGHBOR_KINDS = ('parent', 'link', 'relation', 'mention')

DOC_TYPE = 'doc'


def node_id(item):
    """How other items name an item in their fields: its id, a project's key, else its path (store._item)."""
    return item.get('id') or item['key']


def _stem(path):
    name = str(path).replace('\\', '/').rsplit('/', 1)[-1]
    return name[:-3] if name.lower().endswith('.md') else name


def build(items, structure, docs=(), mentions=None):
    """→ {nodes, edges}. `items`: the Store's (links resolved); `structure`: the vault's Structure; `docs`: the
    vault-relative paths of its docs; `mentions`: {node id: [stems its body links to]}."""
    mentions = mentions or {}
    codec = structure.codec
    link_fields = getattr(codec, 'link_fields', None) or (lambda t: [])
    kept_in = {f: k for k, f in (structure.extras.get('relation_kinds') or {}).get('fields', {}).items()}

    nodes, by_id = [], {}
    for it in items:
        f = it['fields']
        status = f.get('status')
        n = {'id': node_id(it), 'ref': it.get('ref') or it['title'], 'type': it['type'], 'title': it['title'],
             'path': it['path'], 'status': status, 'done': bool(status) and status in structure.closed_of(it['type']),
             'project': f.get('project') if it['type'] != 'project' else None}
        if n['id'] not in by_id:
            by_id[n['id']] = n
            nodes.append(n)
    for path in docs:
        if path not in by_id:
            n = {'id': path, 'ref': _stem(path), 'type': DOC_TYPE, 'title': _stem(path), 'path': path,
                 'status': None, 'done': False, 'project': None}
            by_id[path] = n
            nodes.append(n)

    edges, seen, joined = [], set(), set()

    def add(source, target, kind, field=None, relation=None):
        if not target or target == source or target not in by_id:
            return
        sig = (source, target, kind, field, relation)
        if sig in seen:
            return
        seen.add(sig)
        joined.add(frozenset((source, target)))
        e = {'source': source, 'target': target, 'kind': kind}
        if field:
            e['field'] = field
        if relation:
            e['relation'] = relation
        edges.append(e)

    for it in items:
        src, f, t = node_id(it), it['fields'], it['type']
        add(src, f.get('related_to'), 'parent', 'related_to')
        if t != 'project':
            add(src, f.get('project'), 'project', 'project')
        for field in link_fields(t):
            if field in ('related_to', 'project', 'relations'):
                continue
            values = f.get(field)
            for v in (values if isinstance(values, list) else [values]):
                if not isinstance(v, str):
                    continue
                if field in kept_in:
                    add(src, v, 'relation', field, kept_in[field])
                else:
                    add(src, v, 'link', field)
        kinds = f.get('relation_kinds') if isinstance(f.get('relation_kinds'), dict) else {}
        for other in f.get('relations') or []:
            if isinstance(other, str):
                add(src, other, 'relation', 'relations', kinds.get(other) or 'relates')

    # Mentions last, so that a body link to what the frontmatter already names is not drawn twice.
    stems = {_stem(n['path']): n['id'] for n in nodes}
    folded = {}
    for s, i in stems.items():
        folded.setdefault(s.casefold(), i)
    for src, linked in mentions.items():
        if src not in by_id:
            continue
        for s in linked:
            target = stems.get(s) or folded.get(s.casefold())
            if target and target != src and frozenset((src, target)) not in joined:
                add(src, target, 'mention')

    return {'nodes': nodes, 'edges': edges}


def neighbors(graph, start, depth=1, kinds=NEIGHBOR_KINDS):
    """The part of `graph` within `depth` steps of `start`, following edges of `kinds` either way. → {nodes, edges},
    each node with its `depth` (0 for `start`); every edge between two of those nodes, of those kinds, is in it.
    An unknown `start` gives an empty graph."""
    kinds = set(kinds or KINDS)
    by_id = {n['id']: n for n in graph['nodes']}
    if start not in by_id:
        return {'nodes': [], 'edges': []}
    adjacent = {}
    for e in graph['edges']:
        if e['kind'] in kinds:
            adjacent.setdefault(e['source'], []).append(e['target'])
            adjacent.setdefault(e['target'], []).append(e['source'])
    dist = {start: 0}
    queue = deque([start])
    while queue:
        cur = queue.popleft()
        if dist[cur] >= depth:
            continue
        for nxt in adjacent.get(cur, ()):
            if nxt not in dist:
                dist[nxt] = dist[cur] + 1
                queue.append(nxt)
    nodes = [{**by_id[i], 'depth': d} for i, d in sorted(dist.items(), key=lambda p: (p[1], p[0]))]
    edges = [e for e in graph['edges'] if e['kind'] in kinds and e['source'] in dist and e['target'] in dist]
    return {'nodes': nodes, 'edges': edges}


def field_label(structure, field):
    """A link field's name as the page shows it (the type's prop label: "Plan", "Blocked by"), `related_to` "Parent"."""
    if field == 'related_to':
        return 'Parent'
    for t in structure.types.values():
        for p in t.props or ():
            if p['key'] == field and p.get('kind') in ('link', 'links'):
                return p.get('label') or field
    return field


def reading(edge, from_id, structure):
    """How `edge` reads from the node `from_id`: "Child of", "Blocked by", "Blocks", "Plan", "Plan of", "Mentioned by"…
    The mirror of static/js/graphmodel.js edgeReading (a relation from the other end reads its inverse)."""
    forward = edge['source'] == from_id
    kind = edge['kind']
    if kind == 'parent':
        return 'Child of' if forward else 'Parent of'
    if kind == 'project':
        return 'In project' if forward else 'Project of'
    if kind == 'mention':
        return 'Mentions' if forward else 'Mentioned by'
    if kind == 'link':
        label = field_label(structure, edge.get('field'))
        return label if forward else f'{label} of'
    if kind == 'relation':
        rk = structure.extras.get('relation_kinds') or {}
        r = edge.get('relation') or 'relates'
        r = r if forward else (rk.get('inverse') or {}).get(r, r)
        label = next((lab for v, lab in rk.get('kinds') or () if v == r), r)
        return label.split(' (')[0]  # "Blocked by (depends on)" reads "Blocked by"
    return kind
