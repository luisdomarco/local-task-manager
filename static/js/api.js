import { vaultId } from './vault.js';

async function call(method, url, body, file = null) {
  // Every request names the vault this page shows (vault.js): the server never guesses it.
  const vault = vaultId() ? { 'X-TM-Vault': vaultId() } : {};
  // A file goes as its own bytes (an attachment), its name URI-encoded in a header; anything else as JSON.
  const type = file ? { 'Content-Type': file.type || 'application/octet-stream', 'X-TM-Filename': encodeURIComponent(file.name) }
    : { 'Content-Type': 'application/json' };
  let res;
  try {
    res = await fetch(url, {
      method,
      // X-TM-Actor: what the page does is yours, in the activity journal (tm/journal.py); a script says who it is.
      headers: method === 'POST' ? { ...type, 'X-Task-Manager': '1', 'X-TM-Actor': 'app', ...vault } : vault,
      body: file || (body ? JSON.stringify(body) : undefined),
    });
  } catch {
    // No answer at all (the server stopped, the Mac asleep): say so, not the browser's "Failed to fetch".
    const err = new Error("Can't reach the app's server: is it running?");
    err.status = 0;
    throw err;
  }
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
  vaultAgents: (on) => post('/api/vault/agents', { on }),
  // Its structure: the types, statuses, priorities and lists the page builds itself from (rules.js setStructure).
  structure: () => get('/api/structure'),
  // Each type's statuses in the three groups, with colours (Settings → Statuses); `remap` {type: {old: new}}
  // moves the items of a status renamed or removed.
  statuses: () => get('/api/statuses'),
  saveStatuses: (types, colors, remap) => post('/api/statuses', { types, colors, remap }),
  items: () => get('/api/items'),
  // The vault as a graph (tm/graph.py): { nodes: [{ id, ref, type, title, path, status, done, project }], edges: [{ source, target, kind, field?, relation? }] }.
  graph: () => get('/api/graph'),
  // The vault as files, for the sidebar's Explorer: { entries: [{ path, kind, size, mtime, item? }], truncated }.
  // The vault's folders and files; `hidden`: dotfiles too (.obsidian, .gitignore), .git and .task-manager sealed.
  files: (hidden = false) => get(`/api/files${hidden ? '?hidden=1' : ''}`),
  // The Explorer's operations (Store.make_folder…): each answers { path } (the new one), a delete { trashed, path, item? }.
  makeFolder: (path, parents = false) => post('/api/files/mkdir', { path, parents }),
  docsRoots: () => get('/api/docs/roots'),
  // A page's canvases (canvas/): Obsidian Excalidraw files in <Docs>/Canvases/<host>, read and saved as any file.
  canvases: (host) => get(`/api/canvases?host=${encodeURIComponent(host)}`),
  canvasAll: () => get('/api/canvases/all'), // { folder, canvases: [{ host, name, path, rev, mtime }] }: the Canvas page
  canvasIndex: () => get('/api/canvases/index'), // { hosts: { <host>: its canvases } }: an item's Canvas tab counts by its ref
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
  createFile: (path, text = '', parents = false) => post('/api/files/create', { path, text, parents }),
  // The lines of the vault's text files that hold `q`. → { results: [{ path, line, text }], files, truncated }
  searchFiles: (q) => get(`/api/files/search?q=${encodeURIComponent(q)}`),
  // The Markdown files that link to `path` with a [[wikilink]]. → { links: [{ path, line, text, count }] }
  backlinks: (path) => get(`/api/files/backlinks?path=${encodeURIComponent(path)}`),
  // What changed on an item's followed fields (tm/history.py). → { entries: [{ at, by, field, from, to }] }, oldest first
  itemHistory: (key) => get(`/api/item/history?key=${encodeURIComponent(key)}`),
  // A vault file or folder handed to the editor of Settings (Cursor by default) to edit there.
  openInEditor: (path) => post('/api/files/open-in-editor', { path }),
  // macOS's folder dialog, opened by the server, starting at `start`. → { path } or { cancelled: true } (folderpick.js)
  pickFolder: (start, prompt) => post('/api/folder/pick', { start, prompt }),
  // The app this Mac opens a vault file with, and whether it will here (server.py opener_policy). → { app, ok, why? }
  opener: (path) => get(`/api/files/opener?path=${encodeURIComponent(path)}`),
  // A vault file opened in that app. → { opened, app }
  openDefault: (path) => post('/api/files/open-default', { path }),
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
  termOpen: (key, instruction, model, effort, cwd, cols, rows, empty = false) =>
    post('/api/term/open', { key, instruction, model, effort, cwd, cols, rows, empty }),
  termResume: (key, sessionId, cols, rows) => post('/api/term/resume', { key, session_id: sessionId, cols, rows }),
  termInput: (id, data) => post('/api/term/input', { id, data }),
  termResize: (id, cols, rows) => post('/api/term/resize', { id, cols, rows }),
  termClose: (id) => post('/api/term/close', { id }),
  // The dock's chats: claude -p in stream-json inside the server (its messages come on /api/chat/stream, an EventSource).
  chatList: () => get('/api/chat/list'),
  chatFiles: (id) => get(`/api/chat/files?id=${encodeURIComponent(id)}`),
  chatOpen: (key, instruction, model, effort, cwd, mode, empty = false) => post('/api/chat/open', { key, instruction, model, effort, cwd, mode, empty }),
  // The Agents section (server.py list_agents…): the agent folders of Settings and their commands, one command's page,
  // running one as a chat in the dock, and its file or folder opened. A folder is named by its id, never by its path.
  agents: () => get('/api/agents'),
  agentCommand: (dir, cmd) => get(`/api/agents/command?dir=${encodeURIComponent(dir)}&cmd=${encodeURIComponent(cmd)}`),
  agentRun: (dir, cmd, args, mode, model, effort, where = 'here') => post('/api/agents/run', { dir, cmd, args, mode, model, effort, where }),
  // Run on an agent's page: its chat in the dock, nothing sent (server.py open_agent_chat) → { chat, draft, … }
  agentOpen: (dir, cmd, args, mode, model, effort, where = 'here') => post('/api/agents/open', { dir, cmd, args, mode, model, effort, where }),
  agentRelated: (dir, cmd) => get(`/api/agents/related?dir=${encodeURIComponent(dir)}&cmd=${encodeURIComponent(cmd)}`),
  // Its own file (no path) or one it works with, whole, and Edit's save of it against the version read (tm/agentfiles.py).
  agentFile: (dir, cmd, path = '') => get(`/api/agents/file?dir=${encodeURIComponent(dir)}&cmd=${encodeURIComponent(cmd)}&path=${encodeURIComponent(path)}`),
  agentFileSave: (dir, cmd, path, text, rev) => post('/api/agents/file', { dir, cmd, path, text, rev }),
  // Open in ▾ of an agent's page: Terminal (recorded) or Claude Desktop, Cursor, Antigravity (server.py launch_agent).
  agentLaunch: (dir, cmd, args, mode, model, effort, target, where = 'here') => post('/api/agents/launch', { dir, cmd, args, mode, model, effort, target, where }),
  // Its Runs panel: the runs on record (this computer's list, tm/agentruns.py), newest first; resumed like any session.
  agentRuns: (dir = '', cmd = '') => get(`/api/agents/runs?dir=${encodeURIComponent(dir)}&cmd=${encodeURIComponent(cmd)}`),
  agentRunForget: (sessionId) => post('/api/agents/runs/forget', { session_id: sessionId }),
  agentRunRemoveWorktree: (id, force = false) => post('/api/agents/runs/worktree/remove', { id, force }),
  agentRunChanges: (id) => get(`/api/agents/runs/changes?id=${encodeURIComponent(id)}`),
  agentRunDiff: (id, path) => get(`/api/agents/runs/diff?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`),
  // Activity and the sidebar's Inbox: every agent's runs (the newest), and what needs you / runs / is unread.
  agentActivity: () => get('/api/agents/activity'),
  agentRunsRead: (ids) => post('/api/agents/runs/read', { ids }),
  // Scheduled runs (server.py tick, tm/schedules.py): of one agent, or all; saved (new, or changed by id), paused, run now.
  agentSchedules: (dir = '', cmd = '') => get(`/api/agents/schedules?dir=${encodeURIComponent(dir)}&cmd=${encodeURIComponent(cmd)}`),
  agentScheduleSave: (body) => post('/api/agents/schedules', body),
  agentSchedulePause: (id, paused) => post('/api/agents/schedules/pause', { id, paused }),
  agentScheduleDelete: (id) => post('/api/agents/schedules/delete', { id }),
  agentScheduleRun: (id) => post('/api/agents/schedules/run', { id }),
  agentOpenFile: (dir, cmd) => post('/api/agents/open-file', { dir, cmd }),
  agentReveal: (dir) => post('/api/agents/reveal', { dir }),
  chatResume: (key, sessionId, mode) => post('/api/chat/resume', { key, session_id: sessionId, mode }),
  // items: keys in this vault; images: [{ data: base64, thumb: data URL }]
  chatSend: (id, text, items = [], images = []) => post('/api/chat/send', { id, text, items, images, vault: vaultId() }),
  // behavior: 'allow' | 'deny'; always: allow the same again for the rest of this session.
  // extra: { message } with a deny, { answers } for a question, { mode } for a plan approved
  chatPermission: (id, requestId, behavior, always = false, extra = {}) => post('/api/chat/permission',
    { id, request_id: requestId, behavior, always, ...extra }),
  chatInterrupt: (id) => post('/api/chat/interrupt', { id }),
  chatControl: (id, { mode, model, effort } = {}) => post('/api/chat/control', { id, mode, model, effort }),
  chatClose: (id) => post('/api/chat/close', { id }),
  claudeResume: (key, sessionId, target = 'terminal') => post('/api/claude/resume', { key, session_id: sessionId, target }),
  claudeForget: (key, index) => post('/api/claude/forget', { key, index }),
  // The AI tab's Add existing session: the newest conversations on this computer (Terminal, Claude Desktop, Cursor…), and adding
  // one to an item by its id (the server reads its folder from its transcript); main stars one of an item's sessions.
  claudeRecent: (cwd = '') => get(`/api/claude/recent${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),
  claudeFolders: () => get('/api/claude/folders'),
  claudeAdd: (key, sessionId) => post('/api/claude/add', { key, session_id: sessionId }),
  claudeMain: (key, sessionId) => post('/api/claude/main', { key, session_id: sessionId }),
  // Moves a session's record to another item (toKey) or to the general history (null); a live one takes its name.
  claudeAssociate: (sessionId, fromKey, toKey) => post('/api/claude/associate', { session_id: sessionId, from_key: fromKey, to_key: toKey }),
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
  editComment: (key, index, text, was) => post('/api/item/comment/edit', { key, index, text, was }),
  assignIds: () => post('/api/assign-ids'),
  board: () => get('/api/board'),
  saveBoard: (lists) => post('/api/board', { lists }),
  today: () => get('/api/today'),
  saveToday: (lists) => post('/api/today', { lists }),
  weekBoard: () => get('/api/week-board'), // the Free board columns of Week and Next week
  saveWeekBoard: (lists) => post('/api/week-board', { lists }),
  pins: () => get('/api/pins'),
  people: () => get('/api/people'),
  addPerson: (name, values) => post('/api/people', { name, values }), // values: as updatePerson takes them, for a new person
  renamePerson: (old, name) => post('/api/people/rename', { old, new: name }),
  deletePerson: (name) => post('/api/people/delete', { name }),
  // { name (the public one), calendar_name, emails, redmine, slack, notes, when_to_use }: any of them
  updatePerson: (name, values) => post('/api/people/update', { name, values }),
  // A person who is really a group (an email list a meeting invited): a group under the same name from now on
  personToGroup: (name) => post('/api/people/to-group', { name }),
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
  // Tentative entries (proposed by the worklog proposal command): one by its index, or every one of the day (index null)
  confirmLog: (date, index = null) => post('/api/worklog/confirm', { date, ...(index === null ? {} : { index }) }),
  discardLog: (date, index = null) => post('/api/worklog/discard', { date, ...(index === null ? {} : { index }) }),
  openPath: (path) => post('/api/open', { path }),
  // The server itself (Settings → App): how it runs, and stopping it (started on demand, it starts again when opened).
  serverStatus: () => get('/api/server'),
  stopServer: () => post('/api/server/stop'),
};

/** Where the page loads one attachment from (an <img src>, the viewer, a download link). */
export const attachmentUrl = (path) => `/api/attachments/file?vault=${encodeURIComponent(vaultId() || '')}&path=${encodeURIComponent(path)}`;
/** The same for any file of the vault the Explorer shows. */
export const fileUrl = (path) => `/api/files/raw?vault=${encodeURIComponent(vaultId() || '')}&path=${encodeURIComponent(path)}`;
