// The browser tab's title: where you are. The router names the page (a view: "Tasks", "Board"; an item's page: its
// title), the card names the item it shows while it is open over the page, and the tab shows the card's, else the page's
// ("Draft pricing tiers", then "Tasks" once the card closes); a page with no title leaves the app's name. The open item's
// editor reports every render, so a renamed item renames the tab.
export const APP_NAME = 'Task Manager';

const layers = { page: '', card: '' };

/** The tab's title for a page and an open card (either may be empty): the card's, else the page's, else the app's name. */
export function tabTitle(page, card) {
  return String(card || page || '').replace(/\s+/g, ' ').trim() || APP_NAME;
}

/** An item as the tab names it: its title, else its id, else its type. */
export const itemName = (item) => (item ? item.title || item.id || item.type || '' : '');

function paint() {
  if (typeof document !== 'undefined') document.title = tabTitle(layers.page, layers.card);
}

/** What the page shown is called (the router, or an item's page once it has loaded). */
export function setPageTitle(text) { layers.page = text || ''; paint(); }
/** The item open in the card, or '' / null once it closes. */
export function setCardTitle(text) { layers.card = text || ''; paint(); }
