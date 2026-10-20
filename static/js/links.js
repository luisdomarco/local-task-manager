// Every item has an address, so anything that opens an item can open it in a new browser tab
// instead: ⌘/Ctrl-click or a middle click. The types with a page (rules.js hasPage: an initiative; in Ticketing a
// project and a PRD too) have it at #/<type>/<id or project key>; the rest open as their card over their own list
// (#/item/ID, see main.js route). Only rules.js imported: ui.js and datatable.js use this.
import { hasPage, pageRef } from './rules.js';

/** The address of an item's page, or null for one that opens as a card. */
export const pageHref = (item) => (hasPage(item) ? `#/${item.type}/${encodeURIComponent(pageRef(item))}` : null);

/** The in-app address of an item. */
export const itemHref = (item) => pageHref(item) || `#/item/${encodeURIComponent(item.id || item.key)}`;

/** ⌘/Ctrl-click or the middle button: the user asks for a new tab. */
export const wantsNewTab = (e) => !!e && (e.metaKey || e.ctrlKey || e.button === 1);

export const openInNewTab = (item) => window.open(itemHref(item), '_blank', 'noopener');

/**
 * The handlers for an element that opens `item`, to spread into its h() attributes: a plain
 * click runs open(item, event); ⌘/Ctrl-click or a middle click opens the item in a new tab.
 * A subject drawn as an <a class="item-link"> (for "Open in new tab" in the context menu) is
 * kept from navigating on a plain click: the open() is the click.
 */
export function opener(item, open) {
  const go = (e) => {
    if (wantsNewTab(e)) { e.preventDefault(); e.stopPropagation(); openInNewTab(item); return; }
    if (e.target.closest?.('a.item-link')) e.preventDefault();
    open(item, e);
  };
  return {
    onclick: go,
    onauxclick: (e) => { if (e.button === 1) go(e); },
    onmousedown: (e) => { if (e.button === 1) e.preventDefault(); }, // no autoscroll on a middle click
  };
}
