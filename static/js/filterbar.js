// The filters shared by Board and All items: one set of controls, one rule for what matches.
// Each view keeps its own filter state (what you narrow down on the Board does not leak into All items).
import { PARENT_TYPES, PLANNABLE, PLAN_FILTERS, labelsPass, planFilter, statusPasses } from './rules.js';
import { state } from './state.js';
import { dropdown, h, labelFilter, openStatuses, parentOptions, planSelect, select, selectButton, statusTreeSelect, typeIcon } from './ui.js';

/** Sentinel of the relation filter: items that can be related to something but are not. */
export const NOT_RELATED = '__none__';
const canBeRelated = (i) => i.type !== 'initiative' && PARENT_TYPES[i.type].length > 0;

/** What an item can be related to, for the relation filter. */
const PARENTS = ['initiative', 'story', 'task'];
const cap = (t) => t[0].toUpperCase() + t.slice(1);

/**
 * createFilters({ types, selected, showDone })
 *   types    — the item types the type filter offers
 *   selected — the ones that start ticked (all of them by default; the Board starts with tasks only)
 *   showDone — whether closed items start visible (the Board shows its Done list; All items starts on the open ones)
 * → { f, matches(item), source(), bar(onChange), relatedDefault() }
 */
export function createFilters({ types, selected = types, showDone = false }) {
  // `status`: the statuses ticked in the Group → Status filter (none: any); null until touched, which is every status on
  // the Board and the open groups' (Not started + In progress) in All items — read from the vault's structure when used.
  const f = { types: new Set(selected), text: '', parent: null, plan: 'any', labels: [], labelMode: 'or', status: null, showArchived: false };
  const ticked = () => new Set(f.status ?? (showDone ? [] : openStatuses(types)));

  const matches = (i) => f.types.has(i.type)
    && (f.plan === 'any' || (PLANNABLE.has(i.type) && planFilter(f.plan)(i)))
    && labelsPass(i, f.labels, f.labelMode)
    && statusPasses(i, ticked())
    && (!f.parent || (f.parent === NOT_RELATED ? canBeRelated(i) && !i.fields.related_to
      : i.fields.related_to === f.parent || i.id === f.parent))
    && (!f.text || `${i.id || ''} ${i.title}`.toLowerCase().includes(f.text.toLowerCase()));

  /** The items the view starts from: archived ones only when asked for. */
  const source = () => (f.showArchived ? state.all : state.items);

  /** The relation a new item should start with, when the filter points at one it can hang from. */
  const relatedDefault = (type = 'task') => {
    const p = f.parent && f.parent !== NOT_RELATED ? state.byId.get(f.parent) : null;
    return p && PARENT_TYPES[type].includes(p.type) ? { related_to: p.id } : {};
  };

  /** The control row; `onChange()` runs after every change, and `.refresh()` redraws the selects. */
  function bar(onChange) {
    const typeSel = h('span');
    const parentSel = h('span');
    const planSel = h('span');
    const labelSel = h('span');
    const text = h('input', { type: 'search', placeholder: 'Filter by subject or ID…', value: f.text, 'data-filter': '', 'aria-label': 'Filter by subject or ID' });
    text.addEventListener('input', () => { f.text = text.value; onChange(); });
    const toggle = (key, label) => h('label', { class: 'toggle' },
      h('input', { type: 'checkbox', checked: f[key], onchange: (e) => { f[key] = e.target.checked; onChange(); } }), label);
    // Four to a row on a desktop: the four selects, then the search (two wide) and the two toggles.
    /** The type filter: a button that opens a list of ticks, and stays open while you tick. */
    const typeFilter = () => {
      const label = f.types.size === types.length ? 'All types' : f.types.size === 1 ? cap([...f.types][0]) : f.types.size ? `${f.types.size} types` : 'No type';
      const btn = selectButton(h('span', { class: 'select-label' }, label), { 'aria-label': 'Item type' });
      btn.addEventListener('click', () => {
        const row = (text, on, set, ico) => {
          const box = h('input', { type: 'checkbox', checked: on, onchange: () => { set(box.checked); onChange(); } });
          return h('label', { class: 'menu-item menu-check' }, box, ico, h('span', {}, text));
        };
        dropdown(btn, [
          row('All types', f.types.size === types.length, (on) => { f.types = new Set(on ? types : []); }, null),
          '-',
          ...types.map((t) => row(cap(t), f.types.has(t), (on) => { on ? f.types.add(t) : f.types.delete(t); }, typeIcon(t, 14))),
        ], { width: Math.max(btn.offsetWidth, 190) });
      });
      return btn;
    };
    const statusSel = h('span');
    const el = h('div', { class: 'toolbar filter-bar' }, typeSel, statusSel, parentSel, planSel, labelSel, text,
      toggle('showArchived', 'Show archived'));
    el.refresh = () => {
      typeSel.replaceChildren(typeFilter());
      statusSel.replaceChildren(statusTreeSelect(types, [...ticked()], (v) => { f.status = v; onChange(); }, { 'aria-label': 'Status' }));
      const [anyRelation, ...parents] = parentOptions(PARENTS, 'Any relation', { current: f.parent });
      parentSel.replaceChildren(select([anyRelation, [NOT_RELATED, 'Not related'], ...parents], f.parent,
        (v) => { f.parent = v; onChange(); }, { 'aria-label': 'Related to' }));
      planSel.replaceChildren(planSelect(f.plan, (v) => { f.plan = v; onChange(); }, PLAN_FILTERS));
      labelSel.replaceChildren(labelFilter(f.labels, f.labelMode, (v) => { f.labels = v.labels; f.labelMode = v.mode; onChange(); }));
    };
    return el;
  }

  return { f, matches, source, relatedDefault, bar };
}
