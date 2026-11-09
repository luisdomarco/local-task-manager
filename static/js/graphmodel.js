// What the graph view draws of the vault's graph (GET /api/graph, tm/graph.py), pure: which nodes and edges pass its
// filters, the part around one node, and how an edge reads. No DOM: views/graph.js and the panel's local graph call it,
// tests/js/graphmodel.test.mjs checks it.
//
// A node: { id, ref, type, title, path, status, done, project }; a doc's type is 'doc'. An edge: { source, target,
// kind, field?, relation? }, kept as the vault keeps it: from the item that names the other. Its kinds:
export const EDGE_KINDS = ['parent', 'project', 'link', 'relation', 'mention'];
// What an item's local graph follows (tm/graph.py NEIGHBOR_KINDS): not the project, which ties it to all of its own.
export const NEIGHBOR_KINDS = ['parent', 'link', 'relation', 'mention'];
export const DOC_TYPE = 'doc';

const undirected = (edges) => {
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source).push(e.target);
    adj.get(e.target).push(e.source);
  }
  return adj;
};

/**
 * The part of `graph` within `depth` steps of `start`, following `edges` of `kinds` either way (tm/graph.py
 * neighbors, the same rule): → { nodes (each with its `depth`, 0 for start), edges }. An unknown start: empty.
 */
export function neighborhood(graph, start, depth = 1, kinds = EDGE_KINDS) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!byId.has(start)) return { nodes: [], edges: [] };
  const on = new Set(kinds);
  const edges = graph.edges.filter((e) => on.has(e.kind));
  const adj = undirected(edges);
  const dist = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    if (dist.get(cur) >= depth) continue;
    for (const next of adj.get(cur) || []) {
      if (!dist.has(next)) { dist.set(next, dist.get(cur) + 1); queue.push(next); }
    }
  }
  return {
    nodes: graph.nodes.filter((n) => dist.has(n.id)).map((n) => ({ ...n, depth: dist.get(n.id) })),
    edges: edges.filter((e) => dist.has(e.source) && dist.has(e.target)),
  };
}

/**
 * What the view shows of `graph` → { nodes, edges }:
 *   types    — a Set of the node types shown (null: every one);
 *   kinds    — a Set of the edge kinds shown;
 *   done     — closed items too (false: only the open ones; a node with no status is never closed);
 *   project  — a project's key: its items and the project itself, and the docs linked to them (null: every one);
 *   orphans  — nodes with no edge left on show (false: left out; the focus always stays);
 *   focus    — a node id: only what is within `depth` steps of it, through what is on show;
 *   depth    — the steps from the focus (1 by default);
 *   query    — a search (nodeMatcher): only the nodes it matches, as Obsidian's graph filter.
 * A node a filter leaves out takes its edges with it; the focus is kept whatever the filters say.
 */
export function filterGraph(graph, { types = null, kinds = new Set(EDGE_KINDS), done = true, project = null, orphans = true, focus = null, depth = 1, query = '' } = {}) {
  const asked = nodeMatcher(query);
  const passes = (n) => n.id === focus || ((!types || types.has(n.type)) && (done || !n.done)
    && (!project || n.project === project || n.id === project || n.type === DOC_TYPE) && asked(n));
  let nodes = graph.nodes.filter(passes);
  let ids = new Set(nodes.map((n) => n.id));
  let edges = graph.edges.filter((e) => kinds.has(e.kind) && ids.has(e.source) && ids.has(e.target));
  if (project) {
    // A doc belongs to no project: it stays where it links to (or is linked from) what does.
    const isDoc = new Map(nodes.map((n) => [n.id, n.type === DOC_TYPE]));
    const tied = new Set();
    for (const e of edges) {
      if (isDoc.get(e.source) && !isDoc.get(e.target)) tied.add(e.source);
      if (isDoc.get(e.target) && !isDoc.get(e.source)) tied.add(e.target);
    }
    nodes = nodes.filter((n) => n.type !== DOC_TYPE || n.id === focus || tied.has(n.id));
    ids = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  }
  if (focus && ids.has(focus)) {
    const around = neighborhood({ nodes, edges }, focus, depth, [...kinds]);
    return orphans ? around : dropOrphans(around, focus);
  }
  if (focus) return { nodes: [], edges: [] }; // the focus is not in the vault (any more)
  return orphans ? { nodes, edges } : dropOrphans({ nodes, edges }, null);
}

function dropOrphans({ nodes, edges }, keep) {
  const linked = new Set();
  for (const e of edges) { linked.add(e.source); linked.add(e.target); }
  return { nodes: nodes.filter((n) => linked.has(n.id) || n.id === keep), edges };
}

/**
 * A search over the graph's nodes, as Obsidian's graph filter reads one: words that must all match (any case), each
 * against the title, the ref or the path; `type:story`, `status:done`, `path:Docs/`, `project:ACME` match that field
 * (a type by its name or its plural label via `typeLabel`; `status:done` / `status:open` by whether it is closed);
 * a "quoted phrase" is one word; a leading `-` turns a word into one that must not match. → (node) → bool; an empty
 * search matches every node.
 */
export function nodeMatcher(query, { typeLabel = (t) => t } = {}) {
  const words = String(query || '').match(/-?(?:\w+:)?(?:"[^"]*"|\S+)/g) || [];
  const tests = words.map((w) => {
    const not = w.startsWith('-') && w.length > 1;
    const body = not ? w.slice(1) : w;
    const m = body.match(/^(type|status|path|project):(.*)$/i);
    const val = (m ? m[2] : body).replace(/^"|"$/g, '').toLowerCase();
    let ok;
    if (!val) ok = () => true;
    else if (!m) ok = (n) => [n.title, n.ref, n.path].some((x) => String(x || '').toLowerCase().includes(val));
    else if (m[1].toLowerCase() === 'type') ok = (n) => String(n.type).toLowerCase() === val || String(typeLabel(n.type) || '').toLowerCase() === val;
    else if (m[1].toLowerCase() === 'status') {
      ok = val === 'done' || val === 'closed' ? (n) => !!n.done : val === 'open' ? (n) => !n.done : (n) => String(n.status || '').toLowerCase() === val;
    } else if (m[1].toLowerCase() === 'path') ok = (n) => String(n.path || '').toLowerCase().includes(val);
    else ok = (n) => String(n.project || (n.type === 'project' ? n.id : '')).toLowerCase() === val;
    return not ? (n) => !ok(n) : ok;
  });
  return (n) => tests.every((t) => t(n));
}

/** How many edges each node has in `graph` → Map id → n. */
export function degrees(graph) {
  const d = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) {
    d.set(e.source, (d.get(e.source) || 0) + 1);
    d.set(e.target, (d.get(e.target) || 0) + 1);
  }
  return d;
}

/** The node an address names (#/graph/<that>): its id, its ref (STY-482), or its path. */
export const nodeByAddress = (graph, ref) => graph.nodes.find((n) => n.id === ref)
  || graph.nodes.find((n) => n.ref === ref) || graph.nodes.find((n) => n.path === ref) || null;

/** The address of a node in the graph: its ref when it has one that is its own, else its id. */
export const nodeAddress = (n) => (n.type !== DOC_TYPE && n.ref && n.ref !== n.title ? n.ref : n.id);

/**
 * How an edge reads, from `from` (one of its ends) → '<what from is to the other>': a story's parent reads "Child of"
 * from the story and "Parent of" from its initiative; a relation, its kind's label as `relationKinds` names it
 * ("Blocked by", and from the other end its inverse, "Blocks"); a link field, its name ("plan", "origin") or "Linked
 * from" it; a mention, "Mentions" or "Mentioned by". `relationKinds` is the structure's relation_kinds
 * ({ kinds: [[value, label]], inverse }).
 */
export function edgeReading(edge, from, relationKinds = null, fieldLabel = (f) => f) {
  const forward = from === edge.source;
  switch (edge.kind) {
    case 'parent': return forward ? 'Child of' : 'Parent of';
    case 'project': return forward ? 'In project' : 'Project of';
    case 'mention': return forward ? 'Mentions' : 'Mentioned by';
    case 'link': return forward ? fieldLabel(edge.field) : `${fieldLabel(edge.field)} of`;
    case 'relation': {
      const kind = forward ? edge.relation : relationKinds?.inverse?.[edge.relation] || edge.relation;
      const label = (relationKinds?.kinds || []).find(([v]) => v === kind)?.[1] || kind || 'Related to';
      return label.replace(/\s*\(.*\)$/, ''); // "Blocked by (depends on)" reads "Blocked by"
    }
    default: return edge.kind;
  }
}

/**
 * What a node's tooltip says → { title, meta, lines }: its name; its ref, type and status; and up to `max` of its ties,
 * each read from it ("Blocked by STY-3 Checkout"), then "and N more". `typeLabel`, `statusLabel` and `fieldLabel` name
 * things as the page does; `relationKinds` is the structure's.
 */
export function describeNode(n, graph, { relationKinds = null, fieldLabel = (f) => f, typeLabel = (t) => t, statusLabel = (s) => s, max = 6 } = {}) {
  const byId = new Map(graph.nodes.map((m) => [m.id, m]));
  const ties = graph.edges.filter((e) => e.source === n.id || e.target === n.id);
  const named = (m) => (m ? `${m.ref && m.ref !== m.title ? `${m.ref} ` : ''}${m.title}` : '');
  const lines = ties.slice(0, max).map((e) => `${edgeReading(e, n.id, relationKinds, fieldLabel)} ${named(byId.get(e.source === n.id ? e.target : e.source))}`);
  if (ties.length > max) lines.push(`and ${ties.length - max} more`);
  const meta = [n.ref && n.ref !== n.title ? n.ref : null, typeLabel(n.type), n.status ? statusLabel(n.status) : null].filter(Boolean).join(' · ');
  return { title: n.title, meta, lines };
}
