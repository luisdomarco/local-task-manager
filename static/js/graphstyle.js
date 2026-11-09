// How the graph draws each kind of edge, and which kinds it shows until you pick others: a product decision, kept apart
// from the renderer (graphcanvas.js) so it can change without touching how the canvas works.
//
// An edge (tm/graph.py): { source, target, kind, field?, relation? }
//   kind 'parent'   — the item hangs from the other (`related_to`: a story's initiative, a task's ticket);
//   kind 'project'  — the project it lives in;
//   kind 'link'     — one of its type's link fields (`field`: plan, prd, origin, fixed_by…);
//   kind 'relation' — a typed relation (`relation`: relates, blocked, blocks, precedes, follows, duplicates…);
//   kind 'mention'  — a [[wikilink]] in its text.
//
// A style: {
//   tone:  'strong' | 'soft' | 'faint' | 'alert' — its colour, from the theme (--foreground, --muted-foreground,
//          --border, --destructive), so light and dark both work;
//   width: its line, in screen pixels (1–2.5 reads well);
//   dash:  [] for a solid line, [4, 3] for dashes (screen pixels);
//   arrow: false, true (a head at its target) or 'back' (at its source). Every arrow runs the way the work flows,
//          from what must happen first to what comes after — the blocker to the blocked, what precedes to what
//          follows — whichever of the two items keeps the relation (Blocked by is kept on the blocked one: 'back');
//   pull:  how hard it pulls its ends together in the layout (1 as any; 0.2 barely; 0 draws it but leaves the layout
//          alone). A weak pull for the project edges keeps a project from crushing everything it holds into one ball.
// }

/** The kinds the graph shows when you open it (the Links menu turns the others on). */
export const DEFAULT_KINDS = ['parent', 'link', 'relation', 'mention'];

// Relations by what they say: an order between the two (who goes first), a copy of the other, or only "related".
const FLOW = { blocks: true, blocked: 'back', precedes: true, follows: 'back' }; // where the head goes: the later one
const COPIES = new Set(['duplicates', 'duplicated', 'copied_to', 'copied_from']);

/** How `edge` is drawn. */
export function edgeStyle(edge) {
  switch (edge.kind) {
    // Where an item hangs from: the bones of the graph, solid and the strongest pull.
    case 'parent': return { tone: 'soft', width: 1.5, dash: [], arrow: false, pull: 1 };
    // Its project, when shown: barely there, and a weak pull, or the project crushes all it holds into one ball.
    case 'project': return { tone: 'faint', width: 1, dash: [], arrow: false, pull: 0.15 };
    // A link field (its plan, PRD, origin, what fixed it): a pointer from the item to what it names.
    case 'link': return { tone: 'soft', width: 1, dash: [], arrow: true, pull: 0.7 };
    case 'relation': {
      const r = edge.relation || 'relates';
      // A block is what you look for in a graph of work: it stands out, in the destructive tone.
      if (r === 'blocks' || r === 'blocked') return { tone: 'alert', width: 1.5, dash: [], arrow: FLOW[r], pull: 0.6 };
      if (r in FLOW) return { tone: 'soft', width: 1.25, dash: [], arrow: FLOW[r], pull: 0.6 };
      if (COPIES.has(r)) return { tone: 'soft', width: 1, dash: [2, 3], arrow: false, pull: 0.4 };
      return { tone: 'soft', width: 1, dash: [], arrow: false, pull: 0.5 }; // Related to
    }
    // A [[link]] in the text: the loosest tie, dashed and faint, a light pull.
    case 'mention': return { tone: 'faint', width: 1, dash: [3, 3], arrow: false, pull: 0.3 };
    default: return { tone: 'soft', width: 1, dash: [], arrow: false, pull: 0.5 };
  }
}

// ── how the nodes and names look (Display and Groups in the Graph's panel) ──────
/** The Graph view's look as it opens, Obsidian's: grey nodes, no arrows, names that come in as you zoom. The panel's
 *  local graph keeps its type colours and arrows (graphcanvas.js's default). */
export const LOOK_DEFAULTS = Object.freeze({ colorBy: 'none', groups: [], arrows: false, fade: 0.5, nodeSize: 1, linkWidth: 1 });

/** The colours a group can take (Groups → New group cycles through them): light enough on dark, deep enough on white. */
export const GROUP_COLORS = ['#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1'];

/** How much of the names show at zoom `k`, 0 to 1: Display → Text fade threshold (`fade`, 0 to 1) sets the zoom where
 *  they are whole (0.25 at 0, 1.75 at 1); they come in over the 30% below it. */
export function labelAlpha(k, fade = LOOK_DEFAULTS.fade) {
  const full = 0.25 + 1.5 * Math.min(1, Math.max(0, fade));
  const from = full * 0.7;
  return Math.min(1, Math.max(0, (k - from) / (full - from)));
}

/** A node's colour: the first group whose query it matches (`groups`: [{ color, match(node) }]), else its type's when
 *  `colorBy` is 'type', else `base` (the theme's grey). */
export function nodeColor(node, { colorBy = 'none', groups = [], typeColor = () => null, base = null } = {}) {
  const g = groups.find((x) => x.match(node));
  if (g) return g.color;
  if (colorBy === 'type') return typeColor(node.type) || base;
  return base;
}
