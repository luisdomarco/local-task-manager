// App state + every mutation. Each mutation hits the API, reloads, and notifies
// listeners, so views stay dumb: they read `state` and call these functions.
import { api } from './api.js';
import { today, thisMonth, thisWeek, isoWeek } from './dates.js';
import { isArchived, isDone, placement, setStructure, statusFor } from './rules.js';
import { pickVault } from './vault.js';
import { isTentative } from './worktime.js';

export const state = {
  all: [],      // every item, archived included (Table "Show archived")
  items: [],    // what every other view sees: archived items left out
  byId: new Map(),
  board: { lists: [] },
  today: { lists: [] },   // Today board columns (<root>/.task-manager/today.md)
  weekBoard: { lists: [] }, // Free board columns of Week and Next week (<root>/.task-manager/week.md)
  pins: [],      // ordered ids fixed to the top bar (<root>/.task-manager/pins.md)
  sidebar: [],   // initiative ids in their sidebar order (<root>/.task-manager/sidebar.md)
  config: { work_kinds: [] },
  worklog: [],
  trash: [], // [{ trashed, id, type, title, original_path, deleted_at, unlinked }], most recently deleted first
  trashFiles: 0, // files taken off an item, waiting in trash/attachments/ for the trash to be emptied
  trashedFiles: [], // [{ trashed, path, kind, deleted_at }]: files and folders the Explorer deleted (trash/files/)
  people: [], // [{ name, count, sender, attendee, calendar_name, emails, redmine, slack, notes, when_to_use }], most used first: the history behind the person suggestions
  groups: [], // [{ name, channel, address, members, notes, when_to_use }], by name (Contacts → Groups, TSK-050)
  labels: [], // [{ name, count, types }], most used first
  vault: null,      // { id, name, structure, path, root }: the vault this page shows (vault.js)
  vaultCheck: null, // whether its folder matches its structure (tm/structures/check.py); when not, nothing else is loaded
  vaultMatches: [], // when it does not: the other structures its folder does match, if any [{ id, label }]
  claudeModels: [], // the models claude offers ({ value, label, description, resolved, efforts }), as the latest chat to
                    // start was told: every model menu shows them (chat-model.js modelOptions, launchModelOptions)
  error: null,
};

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn());
// Settled once the first reload has gone through (with the items, or not): what a page opened by its address
// waits for when only the loaded items can name its item (a project, by its key).
let loadedOnce;
export const firstLoad = new Promise((resolve) => { loadedOnce = resolve; });

/** What this page knew of the vault, emptied: a vault that does not match shows nothing of itself. */
function forgetVaultData() {
  state.all = [];
  state.items = [];
  state.byId = new Map();
  state.board = { lists: [] };
  state.today = { lists: [] };
  state.weekBoard = { lists: [] };
  state.pins = [];
  state.sidebar = [];
  state.worklog = [];
  state.people = [];
  state.groups = [];
  state.labels = [];
  state.trash = [];
  state.trashFiles = 0;
  state.trashedFiles = [];
}

let structureLoaded = false;

export async function reload() {
  try {
    // The config first: it says which vaults there are, and so which one this page shows (every request after
    // this one names it). A vault that vanished from Settings while this page showed it: start again, clean.
    const config = await api.config();
    state.config = config;
    if (pickVault(config)) { location.reload(); return; }
    // The vault's structure, once: a page shows one vault (switching loads the page again), and the views build
    // their types, nav and lists from it.
    if (!structureLoaded) {
      setStructure(await api.structure());
      structureLoaded = true;
    }
    const status = await api.vaultStatus();
    state.vault = status.vault;
    state.vaultCheck = status.check;
    state.vaultMatches = status.matches || []; // other structures its folder does have the shape of (a vault given the wrong one)
    if (!status.check.ok) {
      forgetVaultData();
      state.error = null;
      notify();
      loadedOnce(); // its files still show (the Explorer), and what waits for the first load must not wait forever
      return;
    }
    const [items, board, log, pins, sidebar, todayLists, weekLists, people, groups, labels, trash] = await Promise.all([
      api.items(), api.board(), api.worklog(), api.pins(), api.sidebar(), api.today(), api.weekBoard(), api.people(), api.groups(),
      api.labels(), api.trash(),
    ]);
    state.all = items.items;
    state.items = state.all.filter((i) => !isArchived(i));
    state.byId = new Map(state.all.filter((i) => i.id).map((i) => [i.id, i]));
    state.board = board;
    state.pins = pins.items;
    state.sidebar = sidebar.items;
    state.today = todayLists;
    state.weekBoard = weekLists;
    state.worklog = log.entries;
    state.people = people.people;
    state.groups = groups.groups;
    state.labels = labels.labels;
    state.trash = trash.entries;
    state.trashFiles = trash.attachments || 0;
    state.trashedFiles = trash.files || [];
    state.error = null;
  } catch (e) {
    state.error = e.message;
  }
  notify();
  loadedOnce();
}

/** Run API calls, then reload once. Errors surface as a toast, never silently. */
async function mutate(fn) {
  try {
    const out = await fn();
    await reload();
    return out;
  } catch (e) {
    toast(e.message, true);
    await reload();
    throw e;
  }
}

// ── queries ──────────────────────────────────────────────────────────────────
/** Every label created or in use, most used first — the suggestions for label inputs. */
export const allLabels = () => state.labels.map((l) => l.name);
/** Every person ever named on an item, most used first — the suggestions for person inputs. */
export const allPeople = () => state.people.map((p) => p.name);
/** People and groups (Contacts), for a field that takes either: an item's watchers (TSK-051), a meeting's attendees, an activity's sender. */
export const allContacts = () => [...allPeople(), ...state.groups.map((g) => g.name)];
export const byType = (type) => state.items.filter((i) => i.type === type);
export const childrenOf = (id) => state.items.filter((i) => i.fields.related_to === id);

/**
 * The board column a task sits in: its own `list` when that list still maps to
 * the task's status, otherwise the first list mapped to that status (so changing
 * status anywhere moves the card). null → "No list" column.
 */
export function listOf(task) {
  const lists = state.board.lists;
  const own = lists.find((l) => l.id === task.fields.list);
  if (own && own.status === task.fields.status) return own;
  return lists.find((l) => l.status === task.fields.status) || null;
}

/** Tasks closed out of tasks, for an initiative (its own tasks and those of its stories) or for a story. */
export function progress(id) {
  const tasks = [];
  const collect = (parentId) => childrenOf(parentId).forEach((c) => {
    if (c.type === 'task') tasks.push(c);
    else if (c.type === 'story') collect(c.id);
  });
  collect(id);
  const done = tasks.filter(isDone).length;
  return { done, total: tasks.length, pct: tasks.length ? Math.round((100 * done) / tasks.length) : 0 };
}

// An item's work log: what was logged, without what is only proposed (tentative, until confirmed in the Work log).
export const logOf = (id) => state.worklog.filter((e) => e.id === id && !isTentative(e));

// ── mutations ────────────────────────────────────────────────────────────────
export function createItem(type, subject, values = {}, body = '') {
  const list = values.list && state.board.lists.find((l) => l.id === values.list);
  if (list) values = { ...values, status: list.status }; // "+ Add card" in a list
  return mutate(() => api.create(type, subject, values, body));
}

/** `baseBodyRev`: the version of the description the caller started from; a 409 says it changed on disk meanwhile. */
export const updateItem = (key, values, body, baseBodyRev) => mutate(() => api.update(key, values, body, baseBodyRev));
/** One of the structure's actions on an item (Ticketing: 'promote' or 'escalate' a support ticket). → { support, created } */
export const itemAction = (action, key) => mutate(() => api.itemAction(action, key));
/** Attach files to an item, one after the other; one that fails says why and the rest still go. */
export async function addAttachments(key, files) {
  let added = 0;
  for (const file of files) {
    try { await api.addAttachment(key, file); added += 1; } catch (e) { toast(`${file.name}: ${e.message}`, true); }
  }
  await reload();
  if (added) toast(added === 1 ? `${files.length === 1 ? files[0].name : '1 file'} attached` : `${added} files attached`);
  return added;
}
/** Take a file off an item (to the trash), with an Undo in the toast that puts it back. */
export async function removeAttachment(key, path) {
  const out = await mutate(() => api.removeAttachment(key, path));
  const name = path.split('/').pop();
  toast(`${name} moved to the trash`, false, out.trashed ? { label: 'Undo', run: () => mutate(() => api.restoreAttachment(key, out.trashed, path)) } : null);
  return out;
}
/** Delete (to the trash) with an Undo in the toast that restores the file. */
export async function deleteItem(key) {
  const out = await mutate(() => api.remove(key));
  toast(out.unlinked ? `Moved to the trash · ${out.unlinked} related item${out.unlinked > 1 ? 's' : ''} unlinked` : 'Moved to the trash', false, { label: 'Undo', run: () => mutate(() => api.restore(out.trashed, out.restore_to)) });
  return out;
}
/** Inbox item → task / initiative / note / meeting (new id, new folder). */
export const convertItem = (key, type, values = {}) => mutate(() => api.convert(key, type, values));
export const addComment = (key, text) => mutate(() => api.addComment(key, text));
export const deleteComment = (key, index) => mutate(() => api.deleteComment(key, index));
export const editComment = (key, index, text, was) => mutate(() => api.editComment(key, index, text, was));
/** Open Terminal with claude on the item (or on a bare prompt, key null); the launch is recorded, so the state reloads. */
export const claudeLaunch = (key, instruction, model, effort, cwd, target) => mutate(() => api.claudeLaunch(key, instruction, model, effort, cwd, target));
export const claudeForget = (key, index) => mutate(() => api.claudeForget(key, index));
/** A session's record to another item's list (toKey), or to the general one (null): the state reloads, so an open
 * card's AI tab shows it there. → { session_id, session? } (session: the dock's chat or terminal of it, renamed). */
export const claudeAssociate = (sessionId, fromKey, toKey) => mutate(() => api.claudeAssociate(sessionId, fromKey, toKey));
/** The same launch, in the dock instead of Terminal.app: recorded all the same, so the state reloads. */
export const claudeTermOpen = (key, instruction, model, effort, cwd, cols, rows, empty = false) =>
  mutate(() => api.termOpen(key, instruction, model, effort, cwd, cols, rows, empty));
/** …or as a chat in the dock: recorded the same way. */
export const claudeChatOpen = (key, instruction, model, effort, cwd, mode, empty = false) =>
  mutate(() => api.chatOpen(key, instruction, model, effort, cwd, mode, empty));

/** Status is the single source of truth; clearing `list` lets listOf() re-place the card. */
export const setStatus = (item, status) =>
  updateItem(item.key, item.type === 'task' ? { status, list: null } : { status });

/** Complete / reopen with an Undo that puts the previous status back. */
export async function setCompleted(item, done) {
  const was = item.fields.status || 'Backlog';
  // Its type's first closed status (Done), or its last not started one (ToDo): an agent closes as Retired, an error as resolved.
  const out = await setStatus(item, statusFor(item.type, done) || (done ? 'Done' : 'ToDo'));
  toast(done ? `Completed ${item.id || item.title}` : `Reopened ${item.id || item.title}`, false,
    { label: 'Undo', run: () => updateItem(item.key, item.type === 'task' ? { status: was, list: null } : { status: was }) });
  return out;
}

/** Archive / unarchive with Undo. */
export async function setArchived(item, archived) {
  const out = await updateItem(item.key, { archived });
  toast(archived ? `Archived ${item.id || item.title}` : `Unarchived ${item.id || item.title}`, false,
    { label: 'Undo', run: () => updateItem(item.key, { archived: !archived }) });
  return out;
}

export function moveToList(item, list, order) {
  const values = { list: list.id, status: list.status };
  if (order !== undefined) values.order = order;
  return updateItem(item.key, values);
}

/** Batch several patches with a single reload (board reordering). */
export const updateMany = (patches) =>
  mutate(async () => { for (const [key, values] of patches) await api.update(key, values); });

/**
 * A day or a week says more than a month: planning one clears `plan_month`. Only when the item has one, so a Ticketing
 * file (also edited in Obsidian) never gets an empty key it did not have.
 */
export const noMonth = (item) => (item.fields.plan_month ? { plan_month: null } : {});
export const planDay = (item, day) =>
  updateItem(item.key, { plan_day: day, plan_week: day ? isoWeek(day) : item.fields.plan_week, ...(day ? noMonth(item) : {}) });
export const planWeek = (item, week = thisWeek()) => updateItem(item.key, { plan_week: week, plan_day: null, ...noMonth(item) });
/** Planned for a month ('YYYY-MM'), no week nor day yet. */
export const planMonth = (item, month = thisMonth()) => updateItem(item.key, { plan_month: month, plan_week: null, plan_day: null });
export const unplan = (item) => updateItem(item.key, { plan_week: null, plan_day: null, ...noMonth(item) });

/**
 * A card dropped on a column of Today or Week (TSK-053): `values` move it there (its day, its week, its Today column…; {}
 * when it stays), and it takes the place it was dropped at, `index` among `cards` (the column as shown, without it) — its
 * `plan_order`, and the column's when it has to be numbered (rules.js placement). One reload for all of it.
 */
export function placeInPlan(item, values, cards, index) {
  const patches = placement(item, cards.filter((c) => c.key !== item.key), index, 'plan_order');
  const others = patches.filter(([c, o]) => c.key !== item.key && c.fields.plan_order !== o).map(([c, o]) => [c.key, { plan_order: o }]);
  const mine = { ...values, plan_order: patches.find(([c]) => c.key === item.key)[1] };
  return updateMany([...others, [item.key, mine]]).catch(() => {});
}

/** A list id from its name, unique among `taken`: "In review" → "in-review", "in-review-2"… */
export function slugId(name, taken) {
  const base = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

export const saveBoard = (lists) => mutate(() => api.saveBoard(lists));

// ── Today board ──────────────────────────────────────────────────────────────
export const TODAY_DEFAULT = 'uncategorized';
export const saveTodayLists = (lists) => mutate(() => api.saveToday(lists));
/** The Today column an item sits in: its own when that column still exists, else the default. */
export const todayListOf = (item) =>
  state.today.lists.find((l) => l.id === item.fields.today_list) || state.today.lists.find((l) => l.id === TODAY_DEFAULT) || state.today.lists[0];
export const setTodayList = (item, listId) => updateItem(item.key, { today_list: listId === TODAY_DEFAULT ? null : listId });

// ── Free board of Week and Next week ─────────────────────────────────────────
export const saveWeekLists = (lists) => mutate(() => api.saveWeekBoard(lists));
/** The Free board column an item sits in: its own when that column still exists, else the default (Uncategorized). */
export const weekListOf = (item) =>
  state.weekBoard.lists.find((l) => l.id === item.fields.week_list) || state.weekBoard.lists.find((l) => l.id === TODAY_DEFAULT) || state.weekBoard.lists[0];
/**
 * A card dropped on a Free board column (`listId`) at `index` among `cards`: its `week_list` and `week_order`, and the
 * column's when it has to be numbered (rules.js placement). Its day and week stay as they are.
 */
export function placeInWeekList(item, listId, cards, index) {
  const patches = placement(item, cards.filter((c) => c.key !== item.key), index, 'week_order');
  const others = patches.filter(([c, o]) => c.key !== item.key && c.fields.week_order !== o).map(([c, o]) => [c.key, { week_order: o }]);
  const move = weekListOf(item)?.id !== listId ? { week_list: listId === TODAY_DEFAULT ? null : listId } : {};
  const mine = { ...move, week_order: patches.find(([c]) => c.key === item.key)[1] };
  return updateMany([...others, [item.key, mine]]).catch(() => {});
}

// ── pins (top bar) ───────────────────────────────────────────────────────────
export const isPinned = (id) => state.pins.includes(id);
const savePins = (ids) => mutate(() => api.savePins(ids));
/** Pin at the end of the bar (or at `index`); pinning again moves it there. */
export function pin(id, index = null) {
  if (!id) return Promise.resolve();
  const ids = state.pins.filter((p) => p !== id);
  ids.splice(index === null ? ids.length : Math.max(0, Math.min(index, ids.length)), 0, id);
  return savePins(ids);
}
export const unpin = (id) => savePins(state.pins.filter((p) => p !== id));
export const togglePin = (id) => (isPinned(id) ? unpin(id) : pin(id));
/** The sidebar's initiatives, in the order they now show (every id, so new ones get a place too). */
export const saveSidebarOrder = (ids) => mutate(() => api.saveSidebar(ids));
export const saveConfig = (cfg) => mutate(() => api.saveConfig(cfg));
/** Creates the folders the vault's structure is missing (only those; the server refuses anything else). */
export const createVaultFolders = () => mutate(() => api.createVaultFolders());
export const assignIds = () => mutate(() => api.assignIds());
export const logWork = (id, kind, note, date, time) => mutate(() => api.logWork(id, kind, note, date, time));
export const updateLog = (date, index, values) => mutate(() => api.updateLog(date, index, values));
// Labels and people live on items and in their own history: renaming or deleting one reaches every item that has it.
export const addLabel = (name) => mutate(() => api.addLabel(name));
export const renameLabel = (old, name) => mutate(() => api.renameLabel(old, name));
export const deleteLabel = (name) => mutate(() => api.deleteLabel(name));
export const addPerson = (name, values) => mutate(() => api.addPerson(name, values));
export const renamePerson = (old, name) => mutate(() => api.renamePerson(old, name));
export const deletePerson = (name) => mutate(() => api.deletePerson(name));
export const updatePerson = (name, values) => mutate(() => api.updatePerson(name, values));
export const personToGroup = (name) => mutate(() => api.personToGroup(name));
export const addGroup = (name, values) => mutate(() => api.addGroup(name, values));
export const updateGroup = (name, values) => mutate(() => api.updateGroup(name, values));
export const deleteGroup = (name) => mutate(() => api.deleteGroup(name));
export const unlogWork = (date, index) => mutate(() => api.unlogWork(date, index));
export const confirmLog = (date, index = null) => mutate(() => api.confirmLog(date, index));
export const discardLog = (date, index = null) => mutate(() => api.discardLog(date, index));
// The trash: what was deleted, kept in <root>/.task-manager/trash until it is restored or emptied.
export const restoreFromTrash = (trashed) => mutate(() => api.restoreTrashed(trashed));
// The Explorer's operations on the vault's files (explorer.js); a deleted file or folder waits in the trash.
export const makeFolder = (path, parents = false) => mutate(() => api.makeFolder(path, parents));
export const renamePath = (path, name) => mutate(() => api.renamePath(path, name));
export const movePath = (path, to, order) => mutate(() => api.movePath(path, to, order));
export const createFile = (path, text) => mutate(() => api.createFile(path, text));
// A note turned into a doc (TSK-039): its text in a Docs folder, its links following it, the note in the trash.
export const noteToDoc = (key, folder) => mutate(() => api.noteToDoc(key, folder));
export const duplicateFile = (path) => mutate(() => api.duplicateFile(path));
/** Files from the computer into a vault folder, one after the other; one that fails says why and the rest still go.
 *  → the paths they got. */
export async function uploadFiles(folder, files) {
  const paths = [];
  for (const file of files) {
    try { paths.push((await api.uploadFile(folder, file)).path); } catch (e) { toast(`${file.name}: ${e.message}`, true); }
  }
  await reload();
  if (paths.length) toast(paths.length === 1 ? `${paths[0].split('/').pop()} added` : `${paths.length} files added`);
  return paths;
}
export async function deletePath(path) {
  const out = await mutate(() => api.deletePath(path));
  // An item's file went the way of any deleted item; anything else to trash/files/. Either comes back with Undo.
  const undo = out.item ? () => mutate(() => api.restore(out.trashed, out.restore_to)) : () => mutate(() => api.restoreFile(out.trashed));
  toast(`${path.split('/').pop()} moved to the trash`, false, { label: 'Undo', run: undo });
  return out;
}
export const restoreFile = (trashed) => mutate(() => api.restoreFile(trashed));
export const purgeFile = (trashed) => mutate(() => api.purgeFile(trashed));
export const purgeFromTrash = (trashed) => mutate(() => api.purgeTrashed(trashed));
export const emptyTrash = () => mutate(() => api.emptyTrash());

// ── toast ────────────────────────────────────────────────────────────────────
let toastTimer;
/** Show a toast; `action` = { label, run } adds a button (e.g. Undo) and keeps it longer. */
export function toast(msg, isError = false, action = null) {
  const el = document.getElementById('toast');
  el.replaceChildren(document.createTextNode(msg));
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'btn small toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { el.hidden = true; Promise.resolve(action.run()).catch(() => {}); });
    el.append(btn);
  }
  el.className = isError ? 'error' : '';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 6000 : action ? 7000 : 2500);
}
