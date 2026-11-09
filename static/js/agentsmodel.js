// The Agents section's pure logic: what the sidebar lists and where each agent lives in the address. An agent is a
// command of an agent folder (Settings → Agents), as the server lists it (GET /api/agents, tm/commands.py): named like
// Claude Code names it (`dev/start.md` is `dev:start`). The sidebar draws them as a tree (filetree.js buildTree), one
// folder per agent folder (its id) and one subfolder per namespace; the page of one is #/runs/<folder id>/<name>.

/** An agent's path in the tree: its folder's id, then its name with each `:` as a folder (`ab12cd34/dev/start`). */
export const agentPath = (dirId, name) => `${dirId}/${String(name).split(':').join('/')}`;

/** The address of an agent's page, or of the Agents page (no folder). */
export const agentHref = (dirId = '', name = '') => (dirId && name ? `#/runs/${dirId}/${encodeURIComponent(name)}` : '#/runs');

/** #/runs/<param> → { dir, name } ('' when not there). */
export function parseRunsParam(param) {
  const [dir = '', ...rest] = String(param || '').split('/');
  const name = rest.length ? decodeURIComponent(rest.join('/')) : '';
  return { dir, name };
}

/** The tree path of the agent the address shows (null when none): what the sidebar lights up. */
export function agentPathOfHash(hash) {
  const m = String(hash || '').match(/^#\/runs\/(.+)$/);
  if (!m) return null;
  const { dir, name } = parseRunsParam(m[1]);
  return dir && name ? agentPath(dir, name) : null;
}

/** The key an agent is pinned or hidden by: its folder and its name (`ab12cd34 dev:start`). */
export const agentKey = (dirId, name) => `${dirId} ${name}`;

/**
 * The entries buildTree takes for the agent folders: each folder (its id), each namespace under it, and each agent as a
 * file carrying `agent` ({ dir, ...command }). `hidden` (a Set of agentKey) leaves those out unless `showHidden`.
 */
export function agentEntries(dirs, { hidden = new Set(), showHidden = false } = {}) {
  const out = [];
  for (const d of dirs || []) {
    out.push({ path: d.id, kind: 'dir' });
    for (const c of d.commands || []) {
      const isHidden = hidden.has(agentKey(d.id, c.name));
      if (isHidden && !showHidden) continue;
      out.push({ path: agentPath(d.id, c.name), kind: 'file', agent: { ...c, dir: d.id, hidden: isHidden }, search: `/${c.name} ${c.description || ''}` });
    }
  }
  return out;
}

/** The pinned agents that are still there, in the order they were pinned: [{ dir, ...command }]. */
export function pinnedAgents(dirs, pinned = []) {
  const byKey = new Map();
  for (const d of dirs || []) for (const c of d.commands || []) byKey.set(agentKey(d.id, c.name), { ...c, dir: d.id });
  return pinned.map((k) => byKey.get(k)).filter(Boolean);
}

/** How many agents a folder has, and how many of them are hidden. */
export function folderCounts(dir, hidden = new Set()) {
  const all = (dir.commands || []).length;
  const off = (dir.commands || []).filter((c) => hidden.has(agentKey(dir.id, c.name))).length;
  return { all, hidden: off, shown: all - off };
}

/** What a run sends, as the server builds it (server.py agent_message): `/<name> <args>`, the arguments on one line. */
export function runMessage(name, args = '') {
  const line = String(args || '').split(/\s+/).filter(Boolean).join(' ');
  return `/${name}${line ? ` ${line}` : ''}`;
}

/** The modes a run starts in (tm/chat.py CHAT_MODES): never bypassPermissions. */
export const RUN_MODES = [
  ['default', 'Ask before edits', 'user'],
  ['acceptEdits', 'Accept edits', 'pencil'],
  ['plan', 'Plan first', 'note'],
  ['auto', 'Auto', 'target'],
];

/** Toggles `key` in a list kept as a pref (pinned or hidden agents): the new list, null when empty. */
export function toggled(list, key) {
  const set = new Set(list || []);
  if (set.has(key)) set.delete(key); else set.add(key);
  return set.size ? [...set] : null;
}

// Where a run was started (tm/agentruns.py `target`): in the dock, or by Open in ▾ (only Terminal is recorded).
const RUN_WHERE = { here: 'In the app', terminal: 'Terminal' };

/** The words under a run in its agent's Runs panel: where it ran, then what it ran with when that was not the default
 *  (a mode other than Ask before edits, a model, an effort). The time is the panel's (it comes from Claude Code). */
export function runMeta(run) {
  const mode = run.mode && run.mode !== 'default' ? RUN_MODES.find(([m]) => m === run.mode)?.[1] || run.mode : null;
  return [RUN_WHERE[run.target] || run.target || null, mode, run.model || null, run.effort ? `${run.effort} effort` : null].filter(Boolean);
}
