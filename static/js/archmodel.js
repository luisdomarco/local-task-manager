// An architecture's entities, as its page draws them (P8; the owner's knowledge base: *00 Index Entities*, *Entidades
// por tipo de harness*, *Arquitecturas de referencia*). `info` is the structure's `agents` (tm/structures/agents.py
// public): its levels, each entity type's level, canon and prefix, and the architectures each harness comes out as.
// No DOM here; tested in tests/js/archmodel.test.mjs.

/** The KB's shape language for the Map: what has a model is a box, what is deterministic a hexagon, state a cylinder,
 *  an event a circle; the rest (a workflow, a command, a rule…) a rounded box. */
export const SHAPES = {
  agent: 'model', subagent: 'model',
  tool: 'deterministic', gate: 'deterministic', script: 'deterministic', hook: 'deterministic',
  memory: 'state', 'knowledge-base': 'state',
  event: 'event',
};

/** An entity type's definition ({ id, label, level, canon, prefix }), or null for none or an unknown one. */
export const entityType = (info, id) => (info?.entity_types || []).find((t) => t.id === id) || null;

/** An entity's level ('N2'), from its type; '' when it has none. */
export const levelOf = (info, id) => entityType(info, id)?.level || '';

/**
 * Its entities by level, N0 (harness) to N5 (quality), each level with the types that sit there (to add one) and the
 * entities of those types; those with no type, or one this structure does not know, in a last group ('' level).
 * → [{ level, label, types: [type], items: [entity] }]
 */
export function byLevel(entities, info) {
  const groups = (info?.levels || []).map(([level, label]) => ({
    level, label, types: (info.entity_types || []).filter((t) => t.level === level), items: [],
  }));
  const loose = { level: '', label: 'No type', types: [], items: [] };
  for (const e of entities) {
    const g = groups.find((x) => x.level === levelOf(info, e.fields.entity_type));
    (g || loose).items.push(e);
  }
  return loose.items.length ? [...groups, loose] : groups;
}

/**
 * What the page says about an architecture's harness and architecture, never a rule: AP-1 is the anti-pattern (an
 * error); a harness that usually comes out as another architecture is a grey hint (the evidence goes in its Decision).
 * `labels` names them ({ harness: { assistant: 'Assistant' }, architecture: { 'AR-1': 'AR-1 · …' } }).
 * → { tone: 'error' | 'hint', text } or null.
 */
export function archHint(fields, info, labels = {}) {
  const arch = String(fields?.architecture || '').trim();
  const harness = String(fields?.harness || '').trim();
  if (arch && (info?.anti_patterns || []).includes(arch)) {
    return { tone: 'error', text: `${arch} is an anti-pattern: a central LLM supervisor that routes every turn. Prefer an owner with specialists (AR-2) or a governed process (AR-4).` };
  }
  const usual = (info?.harness_architectures || {})[harness];
  if (!arch || !usual || usual.includes(arch)) return null;
  const name = labels.harness?.[harness] || harness;
  return { tone: 'hint', text: `${name} usually comes out as ${usual.join(' or ')}: say in its Decision what evidence asks for ${arch}.` };
}

/** A new entity's name with its type's prefix (`ski-`; an agent's by its role, `age-spe-` / `age-sup-`), unless it
 *  already has one; a proposed type has none, so its name stays as typed. */
export function withPrefix(name, typeId, role, info) {
  const text = String(name || '').trim();
  const t = entityType(info, typeId);
  if (!text || !t) return text;
  const prefix = typeId === 'agent' ? (info.agent_prefix || {})[role] || t.prefix : t.prefix;
  if (!prefix) return text;
  const known = typeId === 'agent' ? ['age-', ...Object.values(info.agent_prefix || {})] : [prefix];
  return known.some((p) => text.startsWith(p)) ? text : `${prefix}${text}`;
}

// Mermaid's own entities for what would end a label or open a tag; a label's lines are joined with <br/>.
const esc = (s) => String(s).replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');
const quote = (...lines) => `"${lines.map(esc).join('<br/>')}"`;
const SHAPE_OF = {
  model: (id, l) => `${id}[${l}]`,
  deterministic: (id, l) => `${id}{{${l}}}`,
  state: (id, l) => `${id}[(${l})]`,
  event: (id, l) => `${id}((${l}))`,
};

/**
 * The Map: a Mermaid flowchart of its entities, a box per level from N5 (top) down to N0 (each level depends only on
 * those below), each entity in its shape, and a line for each relation between two of them. `refOf(e)` names one.
 * → its source, or '' when it has no entity.
 */
export function mapSource(entities, info, refOf = (e) => e.id) {
  if (!entities.length) return '';
  const node = (e) => `e${String(e.id).replace(/\W/g, '_')}`;
  const lines = ['flowchart TB'];
  for (const g of byLevel(entities, info).slice().reverse()) {
    if (!g.items.length) continue;
    lines.push(`  subgraph ${g.level || 'none'}[${quote(g.level ? `${g.level} · ${g.label}` : g.label)}]`);
    for (const e of g.items) {
      const draw = SHAPE_OF[SHAPES[e.fields.entity_type]] || ((id, l) => `${id}(${l})`);
      lines.push(`    ${draw(node(e), quote(e.title, refOf(e)))}`);
    }
    lines.push('  end');
  }
  const ids = new Set(entities.map((e) => e.id));
  const seen = new Set();
  for (const e of entities) {
    for (const other of e.fields.relations || []) {
      const pair = [e.id, other].sort().join('|');
      if (!ids.has(other) || other === e.id || seen.has(pair)) continue;
      seen.add(pair);
      lines.push(`  ${node(e)} --- ${node({ id: other })}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** The entity whose `path` is this file of a Claude Code agent (`.claude/commands/x.md`, as the agent's folder lists
 *  it): the same path, or one of the two ending in the other (an entity may name it from the repo's root, or a deeper
 *  folder), never by a bare file name. Null when none does; the first one when several do. */
export function entityForFile(entities, file) {
  const norm = (p) => String(p || '').trim().replace(/^\.\//, '').replace(/\/+$/, '');
  const f = norm(file);
  if (!f) return null;
  return entities.find((e) => {
    const p = norm(e.fields.path);
    return p && (p === f || (f.includes('/') && p.endsWith(`/${f}`)) || (p.includes('/') && f.endsWith(`/${p}`)));
  }) || null;
}
