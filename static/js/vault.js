// Which vault this page shows. It is in the address (?vault=<id>), so every tab shows its own vault and a
// reload keeps it; without one, the last vault picked in this browser, else the default from Settings.
// Every request names it (api.js, X-TM-Vault): a tab can only ever read or write the vault it shows.
// Switching vault loads the page again: nothing of the vault left behind stays in memory.
import { setPrefsVault } from './prefs.js';

const LAST = 'tm.lastVault';
let current = '';

export const vaultId = () => current;

/** Picks the vault from the address, the last one used, or the config's default; puts it in the address.
 *  → true when it is not the one this page was showing (it was removed in Settings): the page must reload. */
export function pickVault(config) {
  const ids = (config.vaults || []).map((v) => v.id);
  const asked = new URLSearchParams(location.search).get('vault');
  let last = null;
  try { last = localStorage.getItem(LAST); } catch { /* private window */ }
  const picked = [asked, last, config.default_vault, ids[0]].find((id) => id && ids.includes(id)) || '';
  const lost = !!current && current !== picked;
  current = picked;
  if (asked !== picked) {
    const url = new URL(location.href);
    url.searchParams.set('vault', picked);
    history.replaceState(null, '', url);
  }
  try { localStorage.setItem(LAST, picked); } catch { /* it is in the address anyway */ }
  setPrefsVault(picked);
  return lost;
}

/** Shows another vault: the same view, in a fresh page. An item's address belongs to the vault it came from,
 *  so from one the new vault opens on Today. */
export function switchVault(id) {
  if (!id || id === current) return;
  try { localStorage.setItem(LAST, id); } catch { /* the address carries it */ }
  const url = new URL(location.href);
  url.searchParams.set('vault', id);
  if (/^#\/(item|task|initiative)\//.test(url.hash)) url.hash = '#/today';
  location.assign(url);
}
