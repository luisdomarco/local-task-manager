// "Share to Task Manager": what another app shares lands in the Inbox's capture box, written out, for Enter to keep.
// The installed web app's manifest (static/manifest.json share_target) opens `/?share_title=…&share_text=…&share_url=…`
// (where a platform has share targets: Android, ChromeOS; not Safari or a Mac's Chrome); an iOS or macOS Shortcut can
// open the same address. Nothing is written until you press Enter: a page address alone never adds to the vault.
// Pure but `takeShare` (it reads and clears the page's address), tested in tests/js/share.test.mjs.

const KEYS = ['share_title', 'share_text', 'share_url'];

/** The capture text for what was shared: its title (or its text), then its address if the text does not hold it
 *  already. Lines joined by spaces; '' when nothing came. */
export function shareText({ title = '', text = '', url = '' } = {}) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const t = clean(title);
  const body = clean(text);
  let u = clean(url);
  const found = !u && body.match(/(?:https?:\/\/|www\.)\S+/i); // Android often puts the address in the text
  if (found) u = found[0];
  let words = t && body && !body.includes(t) ? `${t} — ${body}` : t || body;
  if (u && words.includes(u)) words = words.replace(u, '').replace(/\s+/g, ' ').replace(/\s*—\s*$/, '').trim();
  return [words, u].filter(Boolean).join(' ');
}

/** What `search` (a page address's query) shares, or null. */
export function sharedIn(search) {
  const q = new URLSearchParams(search || '');
  if (!KEYS.some((k) => q.has(k))) return null;
  return shareText({ title: q.get('share_title'), text: q.get('share_text'), url: q.get('share_url') });
}

let pending = null;

/** On load: the share in the page's address, kept for the Inbox, and the address made clean (#/inbox). → whether one came. */
export function takeShare() {
  const shared = sharedIn(location.search);
  if (shared === null) return false;
  pending = shared;
  const q = new URLSearchParams(location.search);
  KEYS.forEach((k) => q.delete(k));
  const rest = q.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}#/inbox`);
  return true;
}

/** The share waiting for the capture box, once. */
export function pendingShare() {
  const out = pending;
  pending = null;
  return out;
}
