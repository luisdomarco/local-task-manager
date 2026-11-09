// The sidebar's sections: one link that opens a page with a tab per view. Planning (Week · Next week · Month)
// in every vault that plans; and, from the structure's `sections` (Projects: Meetings · Brief · Issues · Records), one
// per group of types, each tab that type's list. A tab keeps its own address (#/week, #/prds), so links, ⌘K and the
// "g then" keys still land on it; the section's link goes to the tab it was left on (remembered per vault).
import { STRUCTURE, inSomeProject } from './rules.js';
import { pref, setPref } from './prefs.js';
import { state } from './state.js';
import { h, icon } from './ui.js';

export const PLANNING = {
  key: 'planning', label: 'Planning', icon: 'calendar',
  tabs: [['week', 'Week', 'calendar'], ['nextweek', 'Next week', 'calendarplus'], ['month', 'Month', 'calendardays']],
};

/** A type's tab is there while the vault may hold it (rules.js inSomeProject: a vault of simple projects has no
 *  stories) or has some: the sidebar's rule for a type's link. Empty, it is still there, so tabs never move. */
const typeShown = (t) => inSomeProject(t.name, state.all) || state.all.some((i) => i.type === t.name);

/** Every section of this vault, with the tabs it shows: [{ key, label, icon, tabs: [{ route, label, icon }] }].
 *  A section with no tab left is not there. */
export function sections() {
  const out = [];
  if (STRUCTURE.types.some((t) => t.plannable)) {
    out.push({ ...PLANNING, tabs: PLANNING.tabs.map(([route, label, ico]) => ({ route, label, icon: ico })) });
  }
  for (const sec of STRUCTURE.sections || []) {
    const tabs = sec.types.map((name) => STRUCTURE.types.find((t) => t.name === name))
      .filter((t) => t && t.list && typeShown(t)).map((t) => ({ route: t.route, label: t.plural, icon: t.icon, type: t.name }));
    if (tabs.length) out.push({ key: sec.key, label: sec.label, icon: sec.icon, tabs });
  }
  return out;
}

/** The routes of the structure's sections' types: they have no link of their own in the sidebar (main.js renderNav),
 *  shown or not. */
export const sectionRoutes = () => new Set((STRUCTURE.sections || []).flatMap((s) => s.types)
  .map((name) => STRUCTURE.types.find((t) => t.name === name)?.route).filter(Boolean));

/** The section a route is a tab of, or null. */
export const sectionOf = (route) => sections().find((s) => s.tabs.some((t) => t.route === route)) || null;

/** The tab a section was left on (its first until one is opened, or when that one is gone). */
export function lastTab(sec) {
  const saved = pref(`section.${sec.key}`);
  return sec.tabs.some((t) => t.route === saved) ? saved : sec.tabs[0].route;
}

// The counts each tab shows, kept by main.js renderSidebar (setTabCounts) and painted wherever a tab bar is.
let counts = {};
export function setTabCounts(next) {
  counts = next;
  for (const el of document.querySelectorAll('.section-tabs [data-tab-count]')) el.textContent = counts[el.dataset.tabCount] || '';
}

/**
 * A view's head, when its route is a tab: the section's name as the page title, and the tabs under it (each its icon,
 * name and count of open items — planned, for Planning's —, a link to its address). Opening one remembers it as the
 * section's. Not a tab (or its section's only one): its own title and no tabs.
 * @returns {{ title: string, tabs: HTMLElement|null }}
 */
export function sectionHead(route, ownTitle) {
  const sec = sectionOf(route);
  if (!sec || sec.tabs.length < 2) return { title: ownTitle, tabs: null };
  setPref(`section.${sec.key}`, route);
  const tabs = h('nav', { class: 'tabs-bar section-tabs', 'aria-label': sec.label },
    sec.tabs.map((t) => h('a', {
      class: `tab-btn ${t.route === route ? 'active' : ''}`, href: `#/${t.route}`,
      ...(t.route === route ? { 'aria-current': 'page' } : {}),
    }, icon(t.icon, 14), t.label, h('span', { class: 'tab-count', 'data-tab-count': t.route }, counts[t.route] || ''))));
  return { title: sec.label, tabs };
}
