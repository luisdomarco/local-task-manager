import { vaultId } from './vault.js';

async function call(method, url, body, file = null) {
  // Every request names the vault this page shows (vault.js): the server never guesses it.
  const vault = vaultId() ? { 'X-TM-Vault': vaultId() } : {};
  // A file goes as its own bytes (an attachment), its name URI-encoded in a header; anything else as JSON.
  const type = file ? { 'Content-Type': file.type || 'application/octet-stream', 'X-TM-Filename': encodeURIComponent(file.name) }
    : { 'Content-Type': 'application/json' };
  const res = await fetch(url, {
    method,
    headers: method === 'POST' ? { ...type, 'X-Task-Manager': '1', ...vault } : vault,
    body: file || (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `${res.status} ${res.statusText}`);
    err.status = res.status; // a 409 means the file changed on disk: the caller decides what to offer
    err.data = data;
    throw err;
  }
  return data;
}

const get = (url) => call('GET', url);
const post = (url, body) => call('POST', url, body || {});

export const api = {
  config: () => get('/api/config'),
  guide: () => get('/api/guide'), // docs/user-guide.md, for Settings → Documentation
  saveConfig: (cfg) => post('/api/config', cfg),
  // The vault this page shows and whether its folder matches its structure; the fix the app may offer.
  vaultStatus: () => get('/api/vault/status'),
  createVaultFolders: () => post('/api/vault/create-folders'),
  // Its structure: the types, statuses, priorities and lists the page builds itself from (rules.js setStructure).
  structure: () => get('/api/structure'),
  // Each type's statuses in the three groups, with colours (Settings → Item type status); `remap` {type: {old: new}}
  // moves the items of a status renamed or removed.
  statuses: () => get('/api/statuses'),
  saveStatuses: (types, colors, remap) => post('/api/statuses', { types, colors, remap }),
  items: () => get('/api/items'),
  // The vault as files, for the sidebar's Explorer: { entries: [{ path, kind, size, mtime, item? }], truncated }.
  files: () => get('/api/files'),
  // The Explorer's operations (Store.make_folder…): each answers { path } (the new one), a delete { trashed, path, item? }.
  makeFolder: (path, parents = false) => post('/api/files/mkdir', { path, parents }),
  docsRoots: () => get('/api/docs/roots'),
  noteToDoc: (key, folder) => post('/api/docs/from-note', { key, folder }),
  docProps: (path, values, rev) => post('/api/docs/props', { path, values, rev }),
  renamePath: (path, name) => post('/api/files/rename', { path, name }),
  movePath: (path, to, order) => post('/api/files/move', { path, to, ...(order ? { order } : {}) }),
  deletePath: (path) => post('/api/files/delete', { path }),
  restoreFile: (trashed) => post('/api/files/restore', { trashed }),
  purgeFile: (trashed) => post('/api/files/purge', { trashed }),
  // The Explorer's editor: a file's new text, against the version it was opened at (`rev`, the X-TM-Rev of its raw
  // file); a 409 means it changed on disk since. → { path, rev, size, mtime }.
  saveFile: (path, text, baseRev, force = false) => post('/api/files/save', { path, text, base_rev: baseRev, force }),
  createFile: (path, text = '') => post('/api/files/create', { path, text }),
  // The lines of the vault's text files that hold `q`. → { results: [{ path, line, text }], files, truncated }
  searchFiles: (q) => get(`/api/files/search?q=${encodeURIComponent(q)}`),
  // The Markdown files that link to `path` with a [[wikilink]]. → { links: [{ path, line, text, count }] }
  backlinks: (path) => get(`/api/files/backlinks?path=${encodeURIComponent(path)}`),
  // A vault file or folder handed to the editor of Settings (Cursor by default) to edit there.
  openInEditor: (path) => post('/api/files/open-in-editor', { path }),
  duplicateFile: (path) => post('/api/files/duplicate', { path }),
  // A file from the computer into a vault folder, as its own bytes (like an attachment). → { path }
  uploadFile: (folder, file) => call('POST', `/api/files/upload?folder=${encodeURIComponent(folder)}`, null, file),
  item: (key) => get(`/api/item?key=${encodeURIComponent(key)}`),
  create: (type, subject, values, body) => post('/api/item/create', { type, subject, values, body }),
  itemAction: (action, key) => post('/api/item/action', { action, key }),
  update: (key, values, body, baseBodyRev) => post('/api/item/update', { key, values, body, base_body_rev: baseBodyRev }),
  remove: (key) => post('/api/item/delete', { key }),
  restore: (trashed, to) => post('/api/item/restore', { trashed, to }),
  claudePreview: (key, instruction, model, effort, cwd) => post('/api/item/claude/preview', { key, instruction, model, effort, cwd }),
  // `target`: terminal (default), desktop, cursor or antigravity — Open in ▾ (server.py open_targets).
  claudeLaunch: (key, instruction, model, effort, cwd, target = 'terminal') => post('/api/item/claude', { key, instruction, model, effort, cwd, target }),
  claudeSessions: () => get('/api/claude/sessions'),
  claudeUpdated: (sessions) => post('/api/claude/updated', { sessions: sessions.map(({ id, cwd }) => ({ id, cwd })) }),
  // The dock: claude in a pty inside the server (its output comes on /api/term/stream, an EventSource).
  termList: () => get('/api/term/list'),
  termOpen: (key, instruction, model, effort, cwd, cols, rows) => post('/api/term/open', { key, instruction, model, effort, cwd, cols, rows }),
  termResume: (key, sessionId, cols, rows) => post('/api/term/resume', { key, session_id: sessionId, cols, rows }),
  termInput: (id, data) => post('/api/term/input', { id, data }),
  termResize: (id, cols, rows) => post('/api/term/resize', { id, cols, rows }),
  termClose: (id) => post('/api/term/close', { id }),
  claudeResume: (key, sessionId, target = 'terminal') => post('/api/claude/resume', { key, session_id: sessionId, target }),
  claudeForget: (key, index) => post('/api/claude/forget', { key, index }),
  // Versions of the system as zips (Settings → Export, tm/export.py); the download is a plain link to /api/exports/file.
  exports: () => get('/api/exports'),
  exportVersion: (note, kind) => post('/api/exports', { note, kind }), // kind: 'system' | 'agents' | 'vault'
  deleteExport: (name) => post('/api/exports/delete', { name }),
  revealExport: (name) => post('/api/exports/reveal', { name }),
  // An item's files (tm/attachments.py): added as their bytes; shown through attachmentUrl, which names the vault in
  // the address, as an <img> cannot send the header.
  addAttachment: (key, file) => call('POST', `/api/attachments/add?key=${encodeURIComponent(key)}`, null, file),
  removeAttachment: (key, path) => post('/api/attachments/remove', { key, path }),
  restoreAttachment: (key, trashed, path) => post('/api/attachments/restore', { key, trashed, path }),
  trash: () => get('/api/trash'),
  restoreTrashed: (trashed) => post('/api/trash/restore', { trashed }),
  purgeTrashed: (trashed) => post('/api/trash/purge', { trashed }),
  emptyTrash: () => post('/api/trash/empty'),
  convert: (key, type, values) => post('/api/item/convert', { key, type, values }),
  addComment: (key, text) => post('/api/item/comment', { key, text }),
  deleteComment: (key, index) => post('/api/item/comment/delete', { key, index }),
  assignIds: () => post('/api/assign-ids'),
  board: () => get('/api/board'),
  saveBoard: (lists) => post('/api/board', { lists }),
  today: () => get('/api/today'),
  saveToday: (lists) => post('/api/today', { lists }),
  pins: () => get('/api/pins'),
  people: () => get('/api/people'),
  addPerson: (name, values) => post('/api/people', { name, values }), // values: as updatePerson takes them, for a new person
  renamePerson: (old, name) => post('/api/people/rename', { old, new: name }),
  deletePerson: (name) => post('/api/people/delete', { name }),
  // { name (the public one), calendar_name, emails, redmine, slack, notes, when_to_use }: any of them
  updatePerson: (name, values) => post('/api/people/update', { name, values }),
  // Groups (Contacts → Groups, TSK-050): { name, channel, address, members, notes, when_to_use }
  groups: () => get('/api/groups'),
  addGroup: (name, values) => post('/api/groups', { name, values }),
  updateGroup: (name, values) => post('/api/groups/update', { name, values }),
  deleteGroup: (name) => post('/api/groups/delete', { name }),
  labels: () => get('/api/labels'),
  addLabel: (name) => post('/api/labels', { name }),
  renameLabel: (old, name) => post('/api/labels/rename', { old, new: name }),
  deleteLabel: (name) => post('/api/labels/delete', { name }),
  savePins: (items) => post('/api/pins', { items }),
  sidebar: () => get('/api/sidebar'),
  saveSidebar: (items) => post('/api/sidebar', { items }),
  worklog: () => get('/api/worklog'),
  logWork: (id, kind, note, date, time) => post('/api/worklog', { id, kind, note, date, time }),
  updateLog: (date, index, values) => post('/api/worklog/update', { date, index, ...values }),
  unlogWork: (date, index) => post('/api/worklog/delete', { date, index }),
  openPath: (path) => post('/api/open', { path }),
  // The server itself (Settings → App): how it runs, and stopping it (started on demand, it starts again when opened).
  serverStatus: () => get('/api/server'),
  stopServer: () => post('/api/server/stop'),
};

/** Where the page loads one attachment from (an <img src>, the viewer, a download link). */
export const attachmentUrl = (path) => `/api/attachments/file?vault=${encodeURIComponent(vaultId() || '')}&path=${encodeURIComponent(path)}`;
/** The same for any file of the vault the Explorer shows. */
export const fileUrl = (path) => `/api/files/raw?vault=${encodeURIComponent(vaultId() || '')}&path=${encodeURIComponent(path)}`;
