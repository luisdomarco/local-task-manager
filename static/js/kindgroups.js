// Which of the kinds in a tab of an item's page (Initiatives · Issues · Briefs · Records, panel.js groupTabs) get a
// folding group of their own. Every kind there applies to the item (its structure lets it hang from it, its project's
// kind has it); of those, only a kind that holds something is drawn as a group: the empty ones wait on one "+ Add" line
// at the tab's foot, so a project with nothing yet is not a stack of empty headers.

/**
 * → { shown, empty }: the kind tables (panel.js childTable, `group` = its kind) that get a group, in their order, and
 * the empty ones that can be added from the tab (a kind with no quick add, as a plan on a project's page, is in
 * neither). A kind is shown when it holds any item, open, closed or archived, or while its quick add is open
 * (`adding(type)`), so the first one is written in its own group.
 */
export function shownKinds(tables, adding = () => false) {
  const shown = [];
  const empty = [];
  for (const t of tables || []) {
    const g = t?.group;
    if (!g) continue;
    if ((g.all || []).length || Number(g.archived || 0) || adding(g.type)) shown.push(t);
    else if (g.qa) empty.push(t);
  }
  return { shown, empty };
}
