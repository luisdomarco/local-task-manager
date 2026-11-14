// An architecture's page (P8): its Entities by level, its Map, and what the knowledge base says about its harness and
// architecture. The logic is archmodel.js's; this draws it.
import { SHAPES, archHint, byLevel, entityType, mapSource } from './archmodel.js';
import { openCreateModal } from './create.js';
import { renderDiagrams } from './diagrams.js';
import { itemHref, opener } from './links.js';
import { STRUCTURE, TYPE_DEFS } from './rules.js';
import { refOf } from './shownid.js';
import { state } from './state.js';
import { dropdown, emptyLine, h, icon, rowItem, rowList, stackGroup, statusChip, tabAddButton } from './ui.js';

const info = () => STRUCTURE.agents || null;
const optionLabels = (key) => Object.fromEntries((TYPE_DEFS.agent?.props || []).find((p) => p.key === key)?.options || []);

/** Its entities (the items that hang from it), in the vault's order. */
export const entitiesOf = (arch) => state.items.filter((e) => e.type === 'entity' && e.fields.related_to === arch.id);

/** What the page says about its harness and architecture: AP-1 in red, a mismatch with the KB's table in grey. */
export function archNotice(item) {
  if (item.type !== 'agent' || !info()) return null;
  const hint = archHint(item.fields, info(), { harness: optionLabels('harness') });
  if (!hint) return null;
  return h('p', { class: `arch-notice ${hint.tone}`, role: hint.tone === 'error' ? 'alert' : null },
    icon(hint.tone === 'error' ? 'alert' : 'info', 14), h('span', {}, hint.text));
}

/** The Entities tab: a group per level, N0 (harness) to N5 (quality), each with "+ Add" (its types to pick from). */
export function entitiesTab(item, open) {
  if (item.type !== 'agent' || !item.id || !info()) return null;
  const all = entitiesOf(item);
  const add = (types) => (e) => dropdown(e.currentTarget, types.map((t) => ({
    label: t.canon ? t.label : `${t.label} · proposed`, icon: TYPE_DEFS.entity?.icon || 'zap',
    title: t.prefix ? `Named ${t.prefix}…` : 'Not canon yet: no prefix',
    onSelect: () => openCreateModal('entity', { related_to: item.id, entity_type: t.id }),
  })));
  const groups = byLevel(all, info()).map((g) => stackGroup(g.level ? `${g.level} · ${g.label}` : g.label,
    g.items.length ? rowList(g.items.map((e) => {
      const t = entityType(info(), e.fields.entity_type);
      return rowItem({
        text: e.title, textMono: true, href: itemHref(e), linkAttrs: open ? opener(e, open) : {},
        ico: h('span', { class: `arch-shape ${SHAPES[e.fields.entity_type] || 'other'}`, 'aria-hidden': 'true' }),
        meta: h('span', { class: 'arch-meta' }, t ? t.label : 'no type', t && !t.canon ? h('span', { class: 'chip muted' }, 'proposed') : null,
          statusChip(e.fields.status), h('span', { class: 'mono' }, refOf(e))),
      });
    })) : emptyLine(g.types.length ? `No ${g.types.map((t) => t.label.toLowerCase()).join(', ')}.` : 'None.'),
    { class: 'arch-level', aside: g.types.length ? tabAddButton('Add', add(g.types), { title: `Add an entity at ${g.level}` }) : null }));
  return { key: 'entities', label: 'Entities', count: all.length || null, content: [h('div', { class: 'arch-entities' }, ...groups)] };
}

/** The Map tab: its entities drawn with the KB's shapes (box: has a model · hexagon: deterministic · cylinder: state ·
 *  circle: event), read only. */
export function mapTab(item) {
  if (item.type !== 'agent' || !item.id || !info()) return null;
  const source = mapSource(entitiesOf(item), info(), refOf);
  if (!source) return { key: 'map', label: 'Map', content: [emptyLine('No entity yet: add them in Entities and they are drawn here.')] };
  const code = h('code', { class: 'language-mermaid' });
  code.textContent = source;
  const box = h('div', { class: 'md arch-map' }, h('pre', {}, code));
  const legend = h('p', { class: 'muted small arch-legend' }, ...[['model', 'has a model'], ['deterministic', 'deterministic'],
    ['state', 'state'], ['event', 'event']].flatMap(([k, text]) => [h('span', { class: `arch-shape ${k}`, 'aria-hidden': 'true' }), text, ' ']));
  // Drawn when its tab shows (tabPanels onShow), or at once when it is the tab showing: Mermaid measures text, which a
  // hidden panel cannot.
  let drawn = false;
  const draw = () => {
    if (drawn || !box.isConnected || box.offsetParent === null) return;
    drawn = true;
    renderDiagrams(box);
  };
  setTimeout(draw, 0);
  return { key: 'map', label: 'Map', content: [legend, box], onShow: () => setTimeout(draw, 0) };
}
