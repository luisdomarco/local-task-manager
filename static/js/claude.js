// "Work on it with Claude" (an item) and "Claude terminal" (the top bar: a bare prompt). Both show what would be sent
// and where it would run, and only then open Terminal with `claude` started on it under a fresh session id. The launch
// is recorded — on the item, or in the global list — so the conversation can be resumed later (`claude --resume`) from
// the card's AI tab or from the terminal's History tab. Nothing is launched without this look; Copy works everywhere.
import { api } from './api.js';
import { DETAIL_PAGE, LIST_PAGE, fixedColumns, paged } from './datatable.js';
import { saveSort, savedSort } from './prefs.js';
import { trapFocus } from './create.js';
import { byType, claudeForget, claudeLaunch, state, toast } from './state.js';
import { openClaudeHere, resumeClaudeHere, termIsLive } from './term.js';
import { dropdown, h, icon, select, tabPanels } from './ui.js';
import { withMic } from './dictation.js';

const SOURCE = {
  item: () => 'the Local path of this item',
  parent: (r) => `the Local path of ${r.cwd_from}, which this item hangs from`,
  settings: () => 'the default folder in Settings',
  project: () => 'the project folder: neither this item nor what it hangs from has a Local path',
  home: () => 'your home folder — set a Local path on the item (or a default folder in Settings) to start somewhere else',
  chosen: () => 'the folder you picked for this launch',
};
const GLOBAL_SOURCE = { ...SOURCE, project: () => 'the project folder of this app — set a default folder in Settings to start somewhere else' };

/** The item as a plain-text prompt, from the server (key null: the instruction alone).
 * Resolves to { prompt, command, cwd, cwd_source, cwd_from, terminal, launchable, models, efforts }. */
export const previewClaude = (key, instruction = '', model = '', effort = '', cwd = '') => api.claudePreview(key, instruction, model, effort, cwd);

/** A saved folder's public name (Settings), else '' — the path is shown instead. '' is the project folder of this app. */
const folderName = (path) => (state.config.claude_path_names || {})[path] || '';

// The choices for the model and the effort. The dialog starts at what Settings says and can change it for this launch only;
// '' leaves it to Claude's own default.
export const CLAUDE_MODELS = [['', "Claude's default"], ['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']];
export const CLAUDE_EFFORTS = [['', "Claude's default"], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']];

// Open in ▾ (TSK-038): where a session can open besides the dock — Terminal, and Claude Desktop, Cursor and Antigravity
// when they are installed (server.py open_targets: the config's claude_targets, or a preview's targets).
const TARGET_ICON = { terminal: 'terminal', desktop: 'sparkles', cursor: 'code', antigravity: 'code' };
const claudeTargets = () => state.config.claude_targets || [{ key: 'terminal', label: state.config.terminal || 'Terminal' }];

/** The menu of where to open, above `anchor`. Its heading says it is the Claude session that opens there (Cursor here is its
 *  Claude Code extension, not the Explorer's "Open in <editor>", which opens a file). `sessionId`: a recorded session,
 *  which Claude Desktop cannot take while it runs in the dock (`claude --desktop --resume` does not move a live
 *  session; the server answers 409). */
function openInMenu(anchor, targets, onPick, sessionId = null) {
  const live = sessionId && termIsLive(sessionId);
  dropdown(anchor, [{ heading: sessionId ? 'Resume the conversation in' : 'Start the session in' }, ...targets.map((t) => {
    const blocked = live && t.key === 'desktop';
    return { label: t.label, icon: TARGET_ICON[t.key] || 'external', onSelect: () => onPick(t), disabled: blocked,
      title: blocked ? 'Still running in the dock — close it there first' : null };
  })], { side: 'top', align: 'end', width: 220 });
}

/** Reopen a recorded conversation in the folder it ran in: Terminal (`claude --resume <id>`), Claude Desktop
 *  (`claude --desktop --resume <id>`), or the Claude Code extension of Cursor or Antigravity. */
export async function resumeClaude(key, sessionId, target = 'terminal') {
  try {
    const out = await api.claudeResume(key, sessionId, target);
    toast(target === 'terminal' ? `Opened ${out.terminal} in ${out.cwd}` : `Opened in ${out.target_label} — ${out.cwd}`);
    return out;
  } catch (e) { toast(e.message, true); throw e; }
}

const basename = (p) => String(p || '').replace(/\/+$/, '').split('/').pop() || String(p || '');
const when = (at) => String(at || '').replace('T', ' ');

// The columns of the sessions table. On a card (key given) it is narrow and the item says where it ran:
// when it started, when it was last written, what was asked. The global list (History) adds the folder.
// "Updated" is the time of the conversation in Claude Code (its transcript, read by the server): missing
// means Claude never saved it, and there is nothing to resume. Model and effort are on the instruction's hover.
const lastCell = (updated, s, short) => {
  if (!updated) return h('span', { class: 'muted' }, '…');
  const at = updated[s.id];
  if (!at) return h('span', { class: 'chip warn', title: 'Claude Code has no conversation saved for this session: it cannot be resumed' }, 'not saved');
  return h('span', { title: when(at) }, short ? when(at).slice(5) : when(at));
};
const SESSION_COLS = {
  global: [
    { key: 'started', label: 'Started', get: (s) => s.at || '', cell: (s) => when(s.at) },
    { key: 'last', label: 'Updated', get: (s, u) => u?.[s.id] || '', cell: (s, u) => lastCell(u, s, false) },
    { key: 'note', label: 'Instruction', get: (s) => (s.instruction || '').toLowerCase(), cell: (s) => instructionCell(s) },
    { key: 'folder', label: 'Folder', get: (s) => (folderName(s.cwd) || basename(s.cwd)).toLowerCase(), cell: (s) => h('code', { class: 'cs-folder', title: s.cwd }, folderName(s.cwd) || basename(s.cwd)) },
  ],
  item: [
    { key: 'when', label: 'Started', get: (s) => s.at || '', cell: (s) => h('span', { title: when(s.at) }, when(s.at).slice(5)) },
    { key: 'last_short', label: 'Updated', get: (s, u) => u?.[s.id] || '', cell: (s, u) => lastCell(u, s, true) },
    { key: 'note', label: 'Instruction', get: (s) => (s.instruction || '').toLowerCase(), cell: (s) => instructionCell(s) },
  ],
};
const instructionCell = (s) => h('span', {
  class: 'cs-text',
  title: [s.instruction || 'No instruction: Claude was asked to read the item and say what it would do',
    `Model: ${s.model || "Claude's default"} · Effort: ${s.effort || "Claude's default"}`].join('\n'),
}, s.instruction || 'Read and plan');

/** The recorded launches as a table whose columns sort (last updated first by default, remembered): what was asked,
 * when, where, Resume and Forget. `key` null is the global list. Forget goes through the state, so an open card
 * re-renders by itself; `onForget` is for the rest. */
export function sessionList(entries, { key = null, onForget = null, onResume = null, empty = 'No conversations yet.' } = {}) {
  const list = (entries || []).map((s, index) => ({ s, index }));
  if (!list.length) return h('p', { class: 'muted small cs-empty' }, empty);
  const where = key === null ? 'global' : 'item';
  const cols = SESSION_COLS[where];
  // Newest activity first: the last updated on top (not saved ones at the bottom), whatever started first.
  const fallback = { col: cols[1].key, dir: -1 };
  let sort = savedSort(`history.${where}`, fallback);
  let updated = null; // { session id → last written | null }, once the server answers
  const box = h('div', { class: 'claude-sessions' });
  const actions = ({ s, index }) => {
    const unsaved = updated && !updated[s.id];
    // Resume here (the dock), or in Terminal.app.
    // On a card (narrow) Resume is its icon alone; the title says what it does.
    const resume = h('button', { class: where === 'item' ? 'btn icon' : 'btn small', title: `Resume in the app — claude --resume ${s.id}`, onclick: async () => {
      resume.disabled = true;
      try { await resumeClaudeHere(key, s.id); onResume?.(); } catch { /* toasted */ } finally { resume.disabled = false; }
    } }, icon('terminal', 14), where === 'item' ? null : 'Resume');
    if (unsaved) { resume.disabled = true; resume.title = 'Nothing to resume: Claude Code never saved this conversation'; }
    // Elsewhere: Terminal.app, or — when installed — Claude Desktop, Cursor, Antigravity (a menu above the arrow).
    const targets = claudeTargets();
    const resumeIn = async (t) => {
      external.disabled = true;
      try { await resumeClaude(key, s.id, t.key); } catch { /* toasted */ } finally { external.disabled = false; }
    };
    const external = h('button', {
      class: 'btn icon', title: targets.length > 1 ? 'Open in… (Terminal, Claude Desktop, Cursor, Antigravity)' : `Resume in ${targets[0].label}.app`,
      'aria-haspopup': targets.length > 1 ? 'menu' : null,
      onclick: () => (targets.length > 1 ? openInMenu(external, targets, resumeIn, s.id) : resumeIn(targets[0])),
    }, icon('external', 14));
    if (unsaved) { external.disabled = true; external.title = 'Nothing to resume: Claude Code never saved this conversation'; }
    const forget = h('button', { class: 'btn icon', title: 'Forget this session here (the conversation itself stays in Claude Code)', onclick: async () => {
      forget.disabled = true;
      try { await claudeForget(key, index); onForget?.(); } catch { forget.disabled = false; } // toasted
    } }, icon('x', 14));
    return h('td', { class: 'c-actions' }, h('div', { class: 'cs-actions' }, resume, external, forget));
  };
  const render = () => {
    const col = cols.find((c) => c.key === sort.col) || cols[0];
    const sorted = list.slice().sort((a, b) => {
      const x = col.get(a.s, updated); const y = col.get(b.s, updated);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || (a.s.at < b.s.at ? 1 : -1);
    });
    // On an item: a detail table (5 a page); the global history: a main one (20).
    const page = paged({ key: `history.${where}`, at: `history.${where}.${key ?? ''}`, rows: sorted, size: where === 'item' ? DETAIL_PAGE : LIST_PAGE, onChange: render });
    const { rows } = page;
    const fixed = fixedColumns([...cols, { key: where === 'item' ? 'cs_actions_compact' : 'cs_actions' }]);
    box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'grid fixed cs-grid', style: fixed.style, 'aria-label': 'Claude sessions' },
      fixed.colgroup,
      h('thead', {}, h('tr', {}, cols.map((c) => h('th', {
        scope: 'col', class: sort.col === c.key ? 'sorted' : '', 'aria-sort': sort.col === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : null,
      }, h('button', {
        class: 'th-btn', onclick: () => {
          sort = { col: c.key, dir: sort.col === c.key ? -sort.dir : (['started', 'when', 'last', 'last_short'].includes(c.key) ? -1 : 1) };
          saveSort(`history.${where}`, sort);
          render();
        },
      }, c.label, sort.col === c.key ? icon(sort.dir > 0 ? 'up' : 'down', 13) : null))),
      h('th', { scope: 'col', class: 'c-actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
      h('tbody', {}, rows.map((r) => h('tr', { class: 'cs-row' }, cols.map((c) => h('td', { class: `c-${c.key}` }, c.cell(r.s, updated))), actions(r)))))),
    ...(page.pager ? [page.pager] : []));
  };
  render();
  // Unknown if the server cannot say (left as "…", Resume still offered), never taken as "not saved".
  api.claudeUpdated(list.map((x) => x.s)).then((r) => { updated = r.updated || {}; render(); }, () => {});
  return box;
}

/** The request itself: where it runs, model / effort, a saved prompt, the instruction, the preview, and the buttons.
 * `item` null is the top bar's terminal: the prompt is the instruction alone, and it is required. */
function requestPane(item, close) {
  const key = item ? item.key : null;
  const instruction = h('textarea', {
    rows: item ? '2' : '4', class: 'claude-instruction', 'aria-label': item ? 'Extra instruction' : 'Prompt',
    placeholder: item ? 'Optional — what you want done. Left empty, Claude reads it and says what it would do first.'
      : 'What you want Claude to do. Nothing else is sent: no item, just this.',
  });
  const where = h('p', { class: 'claude-where muted small' });
  const choice = { model: state.config.claude_model || '', effort: state.config.claude_effort || '', cwd: '' }; // Settings' defaults
  const command = h('code', { class: 'claude-command' });
  // The saved folders (Settings): pick one for this launch. '' is the automatic choice — the item's Local path chain,
  // else the default folder — which is what the "Runs in" line explains. Without saved folders there is nothing to pick.
  const paths = state.config.claude_paths || [];
  const dflt = state.config.claude_cwd || '';
  const folderOption = (p) => [p, `${folderName(p) || p}${p === dflt ? ' · default' : ''}`, 'folder'];
  const folderOptions = item
    ? [['', 'Automatic — the item\'s Local path, else its parent\'s, else the default folder'], ...paths.map(folderOption)]
    : [...paths.map(folderOption), ['', `${folderName('') || 'The project folder of this app'}${dflt ? '' : ' · default'}`, 'folder']];
  if (!item) choice.cwd = dflt;
  const folderSel = paths.length ? select(folderOptions, choice.cwd, (v) => { choice.cwd = v || ''; refresh(); }, { 'aria-label': 'Folder' }) : null;
  const modelSel = select(CLAUDE_MODELS, choice.model, (v) => { choice.model = v || ''; refresh(); }, { 'aria-label': 'Model' });
  const effortSel = select(CLAUDE_EFFORTS, choice.effort, (v) => { choice.effort = v || ''; refresh(); }, { 'aria-label': 'Effort' });
  const preview = h('textarea', { class: 'claude-preview', readonly: true, 'aria-label': 'Prompt that will be sent', spellcheck: 'false' });
  const copy = h('button', { class: 'btn', disabled: true, onclick: async () => {
    try { await navigator.clipboard.writeText(preview.value); toast('Prompt copied'); } catch { toast('Could not copy the prompt', true); }
  } }, icon('copy', 14), 'Copy prompt');
  // Open in ▾: Terminal, and Claude Desktop, Cursor, Antigravity when installed (a menu, above). Only Terminal: the plain button.
  const launch = h('button', { class: 'btn', disabled: true, 'aria-haspopup': 'menu' }, icon('external', 14), h('span', {}, 'Open in Terminal'));
  const here = h('button', { class: 'btn primary', disabled: true, title: 'Open in a terminal inside the app' }, icon('terminal', 14), 'Open here');

  // The saved prompts that are active (not archived), A to Z. Picking one loads its text as the instruction.
  const saved = byType('prompt').sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  const pickPrompt = saved.length ? select([[null, 'Choose a saved prompt…'], ...saved.map((p) => [p.key, p.title, 'sparkles'])], null, async (k) => {
    if (!k) return;
    try {
      const full = await api.item(k);
      instruction.value = (full.body || '').trim();
      instruction.dispatchEvent(new Event('input', { bubbles: true }));
      instruction.focus();
    } catch (e) { toast(e.message, true); }
  }, { 'aria-label': 'Saved prompt', search: true }) : h('span', { class: 'muted small' }, 'No active prompts yet — add one in Prompts.');

  let last = null;
  let stamp = 0;
  const hasPrompt = () => Boolean(item || instruction.value.trim() !== '');
  const canLaunch = () => !!last?.launchable && hasPrompt();
  const gate = () => {
    launch.disabled = !canLaunch();
    launch.title = !last?.launchable ? 'Launching Terminal.app is only supported on macOS — open it here instead'
      : hasPrompt() ? '' : 'Write a prompt first';
    here.disabled = !last || !hasPrompt(); // the dock works wherever the server runs
  };
  const refresh = async () => {
    const mine = ++stamp;
    let info;
    try { info = await previewClaude(key, instruction.value, choice.model, choice.effort, choice.cwd); } catch (e) { toast(e.message, true); return; }
    if (mine !== stamp) return; // a newer keystroke is already on its way
    last = info;
    preview.value = info.prompt;
    command.textContent = `${info.command} "<prompt>"`;
    // A folder with a public name shows the name (the path on hover); any other shows the path.
    where.replaceChildren('Runs in ', info.cwd_name ? h('strong', { title: info.cwd }, info.cwd_name) : h('code', {}, info.cwd),
      ` — ${(item ? SOURCE : GLOBAL_SOURCE)[info.cwd_source === 'chosen' && choice.cwd === dflt ? 'settings' : info.cwd_source](info)}.`);
    copy.disabled = !info.prompt;
    launch.lastChild.textContent = (info.targets || []).length > 1 ? 'Open in ▾' : `Open in ${info.terminal}`;
    gate();
  };
  let timer;
  instruction.addEventListener('input', () => { gate(); clearTimeout(timer); timer = setTimeout(refresh, 250); });
  const launchIn = async (t) => {
    launch.disabled = true;
    try {
      // Through the state: a Terminal launch is recorded (on the item, or in the global list), so an open card shows it
      // at once. Desktop, Cursor and Antigravity pick their own session: the prompt is written there, sent with Enter.
      const out = await claudeLaunch(key, instruction.value, choice.model, choice.effort, choice.cwd, t.key);
      toast(t.key === 'terminal' ? `Opened ${out.terminal} in ${out.cwd}` : `Prompt ready in ${out.target_label} — press Enter there`);
      close();
    } catch { gate(); } // toasted by the state
  };
  launch.addEventListener('click', () => {
    const targets = last?.targets || [{ key: 'terminal', label: last?.terminal || 'Terminal' }];
    if (targets.length > 1) openInMenu(launch, targets, launchIn); else launchIn(targets[0]);
  });
  here.addEventListener('click', async () => {
    here.disabled = true;
    try {
      await openClaudeHere({ key, instruction: instruction.value, model: choice.model, effort: choice.effort, cwd: choice.cwd });
      close();
    } catch { gate(); } // toasted by the state
  });

  const nodes = [
    item ? h('p', { class: 'claude-item' }, h('span', { class: 'mono' }, item.id || item.type), ' ', item.title) : null,
    folderSel ? h('div', { class: 'field claude-folder' }, h('span', {}, 'Folder'), folderSel) : null,
    where,
    h('div', { class: 'claude-opts' },
      h('div', { class: 'field' }, h('span', {}, 'Model'), modelSel),
      h('div', { class: 'field' }, h('span', {}, 'Effort'), effortSel),
      h('div', { class: 'field claude-cmd' }, h('span', {}, 'Command'), command)),
    h('div', { class: 'field claude-saved' }, h('span', {}, 'Saved prompt'), pickPrompt),
    h('label', { class: 'field' }, h('span', {}, item ? 'Extra instruction' : 'Prompt'), withMic(instruction, { place: 'above' })),
    h('label', { class: 'field' }, h('span', {}, 'What will be sent as the first message'), preview),
    h('div', { class: 'modal-foot' }, h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost', onclick: close }, 'Cancel'), copy, launch, here),
  ].filter(Boolean);
  return { nodes, refresh, focus: () => instruction.focus() };
}

/** Open the dialog on an item (or its key), or with nothing (`null`): the top bar's terminal, with its History tab. */
export async function openClaudeDialog(itemOrKey) {
  const item = itemOrKey == null ? null
    : typeof itemOrKey === 'object' ? itemOrKey : (state.byId.get(itemOrKey) || state.all.find((i) => i.key === itemOrKey));
  if (itemOrKey != null && !item) return;
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  const opener = document.activeElement; // the button that opened it gets the focus back
  const close = () => {
    backdrop.hidden = true; modal.className = ''; modal.replaceChildren();
    if (opener && document.contains(opener)) opener.focus();
  };
  const title = item ? 'Work on it with Claude' : 'Claude terminal';
  const pane = requestPane(item, close);
  const head = h('div', { class: 'modal-head' }, h('h2', {}, icon('terminal', 18), title),
    h('button', { class: 'btn icon', title: 'Close (Esc)', onclick: close }, icon('x', 16)));

  modal.className = 'claude-modal';
  modal.setAttribute('aria-label', title);
  if (item) {
    modal.replaceChildren(head, ...pane.nodes);
  } else {
    // Two tabs: the request, and the terminals already opened from here (resumable).
    let sessions = [];
    try { sessions = (await api.claudeSessions()).sessions; } catch (e) { toast(e.message, true); }
    const history = h('div', { class: 'claude-history' });
    const opts = { key: null, onResume: close, empty: 'No terminals opened from here yet — the New request tab starts one.' }; // resuming shows the dock: the dialog goes
    const fill = async () => {
      try { sessions = (await api.claudeSessions()).sessions; } catch (e) { toast(e.message, true); }
      history.replaceChildren(sessionList(sessions, { ...opts, onForget: fill }));
    };
    history.replaceChildren(sessionList(sessions, { ...opts, onForget: fill }));
    modal.replaceChildren(head, ...tabPanels([
      { key: 'new', label: 'New request', content: pane.nodes },
      { key: 'history', label: 'History', count: sessions.length, content: history },
    ], 'new'));
  }
  backdrop.hidden = false;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  modal.onkeydown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') trapFocus(modal, e); // Tab stays inside the dialog
  };
  pane.focus();
  await pane.refresh();
}
