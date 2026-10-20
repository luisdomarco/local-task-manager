// UI preferences remembered between visits: sidebar width, how each table is sorted, a list's
// filters and grouping. A per-browser convenience in localStorage (like the theme), never vault
// data: if the browser forgets, everything falls back to its default.
const NS = 'tm.ui.';

// Some preferences hold one vault's own things: a list's filters name its items and labels, the cards
// minimized to the top bar are its items, the dismissed work-log suggestions its ids, the Explorer's open folders, the sidebar's
// mode. Those are kept per vault (tm.v.<vault>.<key>), so another vault never sees them; the rest (sorts, sizes, tabs) is shared.
const VAULT_KEYS = [/^list\./, /^minimized$/, /^logDismissed$/, /^explorer\./, /^sidebar\.mode$/];
// Where those lived before there were vaults: copied (never moved) into the first vault this browser uses.
const LEGACY = { logDismissed: 'tm.logDismissed' };
const OWNER = 'tm.v.legacyOwner';
let vault = '';

const isVaultKey = (key) => VAULT_KEYS.some((re) => re.test(key));
const storageKey = (key) => (vault && isVaultKey(key) ? `tm.v.${vault}.${key}` : NS + key);

/** The vault whose preferences pref/setPref read and write (vault.js sets it before anything renders). */
export function setPrefsVault(id) {
  vault = id || '';
  try {
    if (vault && !localStorage.getItem(OWNER)) localStorage.setItem(OWNER, vault);
  } catch { /* storage unavailable: nothing to copy either */ }
}

/** A vault key with nothing saved yet, in the vault that inherits the old keys: copy the old value over. */
function legacyValue(key) {
  try {
    if (!vault || !isVaultKey(key) || localStorage.getItem(OWNER) !== vault) return null;
    const raw = localStorage.getItem(LEGACY[key] || NS + key);
    if (raw !== null) localStorage.setItem(storageKey(key), raw);
    return raw;
  } catch { return null; }
}

/** The value saved under `key`, or `fallback` when there is none (or storage is unavailable). */
export function pref(key, fallback = null) {
  try {
    const raw = localStorage.getItem(storageKey(key)) ?? legacyValue(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

/** Saves `value` under `key`; `null` / `undefined` forgets it. */
export function setPref(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(storageKey(key));
    else localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch { /* private mode or full storage: it just resets next time */ }
}

/** A table's sort ({ col, dir }), remembered under sort.<name>. */
export const savedSort = (name, fallback) => {
  const s = pref(`sort.${name}`);
  return s && typeof s.col === 'string' && (s.dir === 1 || s.dir === -1) ? s : fallback;
};
export const saveSort = (name, sort) => setPref(`sort.${name}`, sort);
