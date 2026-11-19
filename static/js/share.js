// "Share to Task Manager": what another app shares lands in the Inbox's capture box, written out, for Enter to keep.
// The installed web app's manifest (static/manifest.json share_target) opens `/?share_title=…&share_text=…&share_url=…`
// (where a platform has share targets: Android, ChromeOS; not Safari or a Mac's Chrome); an iOS or macOS Shortcut can
// open the same address. Nothing is written until you press Enter: a page address alone never adds to the vault.
// A picture (the iPhone app's share extension, from Photos) cannot ride in an address: the app keeps its bytes and
// names them `share_file=<token>` (and `share_name`); the page asks the app for them at `/__share/<token>` (its scheme
// handler serves them, once) and they wait in the capture box as a file to attach. Anywhere else that address is a 404.
// Pure but `takeShare` and `pendingSharedFiles` (they read the page's address and the app), tested in
// tests/js/share.test.mjs.

const KEYS = ['share_title', 'share_text', 'share_url', 'share_file', 'share_name'];

export const SUBJECT_MAX = 120; // what the server keeps of a title (tm/structures/ticketing/codec.py safe_title)

/** Text too long for a Subject (past SUBJECT_MAX once its lines are joined): `{ subject, body }` — a Subject from its
 *  first line with words in it (markup such as ``` or # aside, cut at a word with …), and the whole text, its lines
 *  kept, for the item's description. null when it fits in a Subject. */
export function longText(text, max = SUBJECT_MAX) {
  const all = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (all.replace(/\s+/g, ' ').length <= max) return null;
  const first = all.split('\n').map((l) => l.replace(/^[\s`#>*_~-]+/, '').replace(/\s+/g, ' ').trim()).find(Boolean) || '';
  const cut = first.length > 80 ? `${first.slice(0, 80).replace(/\s+\S*$/, '')}…` : first;
  return { subject: cut, body: all };
}

/** What was shared, apart: `text`, its title (or its text, or both: "title — text") with its address taken out, and
 *  `url`, its address ('' for none). The capture box writes the text in its Subject and keeps the address as a chip.
 *  A text too long for a Subject (longText) comes whole as `body`, for the item's description, and its first line (or
 *  the title) is the Subject. */
export function shareParts({ title = '', text = '', url = '' } = {}) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const t = clean(title);
  const long = longText(text);
  if (long) return { text: t || long.subject, url: clean(url), body: long.body };
  const body = clean(text);
  let u = clean(url);
  const found = !u && body.match(/(?:https?:\/\/|www\.)\S+/i); // Android often puts the address in the text
  if (found) u = found[0];
  let words = t && body && !body.includes(t) ? `${t} — ${body}` : t || body;
  if (u && words.includes(u)) words = words.replace(u, '').replace(/\s+/g, ' ').replace(/\s*—\s*$/, '').trim();
  return { text: words, url: u };
}

/** The capture text for what was shared: its title (or its text), then its address if the text does not hold it
 *  already. Lines joined by spaces; '' when nothing came. */
export function shareText(shared = {}) {
  const { text, url } = shareParts(shared);
  return [text, url].filter(Boolean).join(' ');
}

const partsIn = (q) => shareParts({ title: q.get('share_title'), text: q.get('share_text'), url: q.get('share_url') });
// (shareText, and sharedIn with it, leave a long text's `body` out: they are the one line the capture box opens with)

/** What `search` (a page address's query) shares as text, or null ('' for a picture alone). */
export function sharedIn(search) {
  const q = new URLSearchParams(search || '');
  if (!KEYS.some((k) => q.has(k))) return null;
  return shareText({ title: q.get('share_title'), text: q.get('share_text'), url: q.get('share_url') });
}

/** What `search` shares, apart (shareParts), or null when it shares nothing. */
export function sharedPartsIn(search) {
  const q = new URLSearchParams(search || '');
  return KEYS.some((k) => q.has(k)) ? partsIn(q) : null;
}

/** The picture `search` shares, or null: `{ token, name }`. The token is the app's (letters, digits and -, so it can
 *  only name a share, never another path); the name is the file's own, its folders and odd characters left out. */
export function sharedFile(search) {
  const q = new URLSearchParams(search || '');
  const token = q.get('share_file') || '';
  if (!/^[A-Za-z0-9-]{1,64}$/.test(token)) return null;
  const name = String(q.get('share_name') || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, '').trim().slice(0, 120);
  return { token, name: name && !/^\.+$/.test(name) ? name : 'Shared picture.jpg' };
}

let pending = null;
let pendingFile = null;

/** On load: the share in the page's address, kept for the Inbox, and the address made clean (#/inbox). → whether one came. */
export function takeShare() {
  const shared = sharedPartsIn(location.search);
  if (shared === null) return false;
  pending = shared;
  pendingFile = sharedFile(location.search);
  const q = new URLSearchParams(location.search);
  KEYS.forEach((k) => q.delete(k));
  const rest = q.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}#/inbox`);
  return true;
}

/** The share waiting for the capture box, once: `{ text, url }` (shareParts), or null. */
export function pendingShare() {
  const out = pending;
  pending = null;
  return out;
}

/** The shared picture, fetched from the app, as files for the capture box ([] when there is none), once. One that
 *  cannot be read is said, and the box opens without it. */
export async function pendingSharedFiles({ onError = () => {} } = {}) {
  const f = pendingFile;
  pendingFile = null;
  if (!f) return [];
  try {
    const res = await fetch(`/__share/${f.token}`);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    return [new File([blob], f.name, { type: blob.type || 'application/octet-stream' })];
  } catch {
    onError('The shared picture could not be read: share it again');
    return [];
  }
}
