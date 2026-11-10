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
  const [path, query = ''] = String(param || '').split('?');
  const [dir = '', ...rest] = path.split('/');
  const name = rest.length ? decodeURIComponent(rest.join('/')) : '';
  const run = new URLSearchParams(query).get('run') || '';
  return { dir, name, run };
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

// Where a run starts (server.py AGENT_WHERE): in the agent's folder, or in a new worktree of it on a branch of its own.
export const RUN_PLACES = [
  ['here', 'This folder', 'folder'],
  ['worktree', 'New worktree', 'branch'],
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
  return [RUN_WHERE[run.target] || run.target || null, run.worktree ? 'Worktree' : null, mode, run.model || null, run.effort ? `${run.effort} effort` : null].filter(Boolean);
}

// A file's frontmatter as Preview shows it (agentfile.js): rows of a name and a value over the body, never the YAML.
// `name` and `description` first, then the rest in the file's order, then where the file is. Its tools (`allowed-tools`,
// a subagent's `tools`) are a list, a string split on the commas outside parentheses as tm/commands.py split_tools does.
const PROP_FIRST = ['name', 'description'];
const TOOL_KEYS = new Set(['allowed-tools', 'tools', 'disallowed-tools', 'disallowedTools']);

/** A frontmatter key as a label: `argument-hint` → "Argument hint", `disallowedTools` → "Disallowed tools". */
export const propLabel = (key) => {
  const words = String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** `Read, Bash(git add *, git commit *)` → ['Read', 'Bash(git add *, git commit *)']. */
export function splitTools(raw) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of String(raw ?? '')) {
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') depth = Math.max(0, depth - 1);
    cur += c;
  }
  out.push(cur);
  return out.map((t) => t.trim()).filter(Boolean);
}

const propText = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.map(propText).filter(Boolean).join(', ');
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${propText(x)}`).join(', ');
  return String(v).trim();
};

/**
 * fileProps(fields, path) → [{ key, label, value }]: `value` a string, or a list of strings (shown as chips) for a list
 * or for its tools. Only the keys with something in them; then `path` (where the file is) as "Path" — not for a file with
 * no frontmatter, where it would only repeat the card's head.
 */
export function fileProps(fields, path = '') {
  const f = fields && typeof fields === 'object' ? fields : {};
  const keys = [...PROP_FIRST.filter((k) => k in f), ...Object.keys(f).filter((k) => !PROP_FIRST.includes(k))];
  const out = [];
  for (const key of keys) {
    const raw = f[key];
    const list = TOOL_KEYS.has(key) ? (Array.isArray(raw) ? raw.map(propText) : splitTools(raw))
      : Array.isArray(raw) && raw.every((x) => x === null || typeof x !== 'object') ? raw.map(propText) : null;
    const value = list ? list.filter(Boolean) : propText(raw);
    if (value.length) out.push({ key, label: propLabel(key), value });
  }
  if (path && out.length) out.push({ key: 'path', label: 'Path', value: path });
  return out;
}
