// The vault's graph (GET /api/graph), asked once per load of the items: the Graph view and every item's local graph
// share it. A reload (an edit here, in Obsidian, by an agent) gives state.all anew, and the next ask fetches it again.
import { api } from './api.js';
import { DOC_TYPE, describeNode } from './graphmodel.js';
import { STRUCTURE, TYPE_DEFS } from './rules.js';
import { state } from './state.js';
import { statusLabel } from './ui.js';

let forItems = null; // the state.all the graph below was asked for
let pending = null;
let graph = null;

/** The graph as the server has it now → Promise of { nodes, edges } (the same one until the items reload). */
export function loadGraph() {
  if (forItems !== state.all || !pending) {
    forItems = state.all;
    pending = api.graph().then((g) => { graph = g; return g; }, (err) => { pending = null; throw err; });
  }
  return pending;
}

/** The last graph fetched, at once (null before the first): what a view draws while a newer one is on its way. */
export const graphNow = () => graph;

/** Each link field's name as its type's form has it (Origin, PRD…), by its key; the parent's, Parent. */
function fieldLabel(f) {
  if (f === 'related_to') return 'Parent';
  for (const t of STRUCTURE.types) {
    const p = (t.props || []).find((x) => x.key === f && (x.kind === 'link' || x.kind === 'links'));
    if (p) return p.label;
  }
  return f;
}

/** A node's tooltip (graphcanvas.js describe), in this vault's names. */
export const describe = (n, graph) => describeNode(n, graph, {
  relationKinds: STRUCTURE.relation_kinds, fieldLabel, statusLabel,
  typeLabel: (t) => (t === DOC_TYPE ? 'Doc' : TYPE_DEFS[t]?.label || t),
});
