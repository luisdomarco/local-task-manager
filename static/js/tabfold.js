// Which of an item's tabs its bar shows, and which fold into its "+" menu (panel.js itemTabs, ui.js tabPanels). Pure:
// no DOM, no state (tests/js/tabfold.test.mjs).
//
//   Overview  Settings  Files  Links  Docs │ Initiatives  Issues  +  │ Canvas
//                                                          └ Briefs 0, Records 0
//
// Each tab says what it is:
//   own     one of the item's own sections (Overview, Settings, Files, Links, Docs…): always shown
//   pinned  Canvas: always shown, last, and never one of the `max`
//   used    a group of what hangs from it (Initiatives, Issues, Briefs…) holding at least one item of its kinds,
//           any status (archived ones aside)
// A group that is none of those shows while there is room for it, in the bar's order, up to `max` tabs (the pinned
// one aside). The rest go to "+", unless used, open now (`active`) or picked from "+" while the detail stays open
// (`opened`): those show anyway, beyond `max`.
//
// Example, a project: Overview, Settings, Files, Links, Docs, Initiatives, Issues (7) | Canvas; "+" Briefs, Records.
// Once it has an analysis, Briefs is used: it shows too (8), Records stays in "+".

export const MAX_TABS = 7;

/**
 * @param {{ key: string, own?: boolean, pinned?: boolean, used?: boolean }[]} tabs  in the bar's order
 * @param {{ max?: number, active?: string|null, opened?: Set<string> }} [opts]
 * @returns {{ shown: string[], hidden: string[] }}  the keys of each, in the bar's order
 */
export function foldTabs(tabs, { max = MAX_TABS, active = null, opened = new Set() } = {}) {
  // The room left by its own sections; each group in turn takes a place while there is one, used or not (so a used
  // one never pushes an earlier one out). Past it, only a group with a reason of its own shows.
  let room = max - tabs.filter((t) => t.own && !t.pinned).length;
  const shown = [];
  const hidden = [];
  for (const t of tabs) {
    const group = !t.own && !t.pinned;
    const fits = group && room > 0;
    if (fits) room -= 1;
    const keep = !group || fits || t.used || t.key === active || opened.has(t.key);
    (keep ? shown : hidden).push(t.key);
  }
  return { shown, hidden };
}
