// Saved views (the view bar's "Save as view"): a list's or a board's filters, grouping, order and display kept under a
// name, listed in the sidebar's Views and opened from there. A view is the preferences its page reads (prefs.js):
// opening one writes them back and goes to its page, so the page draws it as it was saved. Per vault and per browser,
// like the list views themselves (`list.` keys are a vault's: prefs.js VAULT_KEYS).
import { pref, setPref } from './prefs.js';

const KEY = 'list.saved';
const listeners = new Set();

// ── pure: tested in tests/js/savedviews.test.mjs ──────────────────────────────
/** The list with `entry` kept: a view of the same name on the same page is replaced in place, else it goes last. */
export function upsertView(list, entry) {
  const at = list.findIndex((v) => v.route === entry.route && v.name.toLowerCase() === entry.name.toLowerCase());
  if (at < 0) return [...list, entry];
  return list.map((v, i) => (i === at ? { ...entry, id: v.id } : v));
}

/** The list without the view `id`. */
export const dropView = (list, id) => list.filter((v) => v.id !== id);

/** Whether the page shows that view now: its route, and every preference it keeps as it was saved. */
export const showing = (v, hash, read) => v.route === hash && Object.entries(v.prefs || {}).every(([k, val]) => JSON.stringify(read(k)) === JSON.stringify(val));

// ── storage ───────────────────────────────────────────────────────────────────
/** The saved views, in the order they were made. */
export const savedViews = () => {
  const list = pref(KEY, []);
  return Array.isArray(list) ? list.filter((v) => v && v.id && v.name && v.route) : [];
};

const write = (list) => { setPref(KEY, list); listeners.forEach((fn) => fn()); };

/** Keeps a view: `name`, the page's `route` (#/tasks) and the preferences that draw it ({ 'list.task': view, … }). */
export function saveView({ name, route, prefs }) {
  const id = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  write(upsertView(savedViews(), { id, name: name.trim(), route, prefs: JSON.parse(JSON.stringify(prefs)) }));
}

/** Forgets a view; returns it, for an Undo that puts it back where it was. */
export function removeView(id) {
  const list = savedViews();
  const at = list.findIndex((v) => v.id === id);
  if (at < 0) return null;
  write(dropView(list, id));
  return { view: list[at], at };
}

/** Puts a removed view back at its place. */
export function restoreView({ view, at }) {
  const list = savedViews();
  write([...list.slice(0, at), view, ...list.slice(at)]);
}

/** Writes a view's preferences back, for its page to draw it. */
export const applyView = (v) => Object.entries(v.prefs || {}).forEach(([k, val]) => setPref(k, val));

/** Calls `fn` whenever the saved views change, or a page's view does (the sidebar redraws its Views: which is on). */
export const onSavedViews = (fn) => { listeners.add(fn); };
export const viewsChanged = () => listeners.forEach((fn) => fn());

export const isShowing = (v) => showing(v, location.hash, (k) => pref(k));
