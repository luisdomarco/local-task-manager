// Settings, in tabs (#/settings/<tab>, the last one remembered): Vaults (the folders this app can show,
// each with its structure; the default; for a folder-per-type vault, the folders new items go to), Item type status (each
// type's statuses in the three groups, views/statuses.js), General (work
// kinds), Claude, Maintenance, Keyboard, Export (the system, the agents or a vault, as zips), App and Documentation (the
// user guide, docs/user-guide.md). Vaults, General and
// Claude are one config form: Save, at the foot of any of them, saves all three.
import { api } from '../api.js';
import { fixedColumns } from '../datatable.js';
import { pref, setPref } from '../prefs.js';
import { warningGroups } from '../housekeeping.js';
import { saveConfig, state, assignIds, toast } from '../state.js';
import { CLAUDE_EFFORTS, claudeModelOptions } from '../claude.js';
import { keyboardHelp } from '../shortcuts.js';
import { h, icon, renderMarkdown, select, tabPanels } from '../ui.js';
import { vaultId } from '../vault.js';
import { hasUnsaved } from '../panel.js';
import { filesUnsaved } from './files.js';
import { statusPanel } from './statuses.js';

const TABS = [['vaults', 'Vaults'], ['statuses', 'Item type status'], ['general', 'General'], ['claude', 'Claude'], ['maintenance', 'Maintenance'], ['keyboard', 'Keyboard'], ['export', 'Export'], ['app', 'App'], ['documentation', 'Documentation']];

const since = (s) => { // seconds → "3 h 12 min"
  const m = Math.floor(s / 60);
  return m < 1 ? 'less than a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/** The whole page, once the server is stopped: what happened and how it comes back. */
function showStopped(onDemand) {
  const again = h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Open it again');
  document.body.replaceChildren(h('div', { class: 'server-stopped' },
    h('h1', {}, 'The server is off'),
    h('p', { class: 'muted' }, onDemand
      ? 'Nothing runs now. Opening the app again (or the button below) starts it in a moment.'
      : 'It was started by hand: start it again with python3 server.py.'),
    onDemand ? again : null));
}

/** Settings → Documentation: the user guide (docs/user-guide.md), read once when the tab is first shown. */
function guidePanel() {
  const el = h('div', { class: 'md guide' }, h('p', { class: 'muted' }, 'Loading the guide…'));
  let loaded = false;
  const load = async () => {
    if (loaded) return;
    try {
      const { markdown } = await api.guide();
      el.innerHTML = renderMarkdown(markdown); // sanitized by renderMarkdown (DOMPurify)
      loaded = true;
    } catch (e) {
      el.replaceChildren(h('p', { class: 'muted' }, `The guide could not be loaded: ${e.message}`));
    }
  };
  return { el, load };
}

/** Settings → App: the server this page talks to — the installed app (started on demand) or one started by hand —
 *  and stopping or restarting it. */
function appPanel() {
  const el = h('div', {});
  const stop = async (restart) => {
    if ((hasUnsaved() || filesUnsaved()) && !confirm('There is text not saved yet. Stop the server anyway?')) return;
    let out;
    try { out = await api.stopServer(); } catch (e) { toast(e.message, true); return; }
    if (!restart || !out.on_demand) { setTimeout(() => showStopped(out.on_demand), 600); return; }
    // Restart: once it is gone, the next request is what starts it again (launchd); then the page loads afresh.
    toast('Restarting…');
    await new Promise((r) => setTimeout(r, 1200));
    for (let i = 0; i < 30; i += 1) {
      try { await api.serverStatus(); location.reload(); return; } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    showStopped(true);
  };
  const load = async () => {
    let s;
    try { s = await api.serverStatus(); } catch (e) { el.replaceChildren(h('p', { class: 'muted' }, `Cannot reach the server: ${e.message}`)); return; }
    const row = (k, v) => h('tr', {}, h('th', {}, k), h('td', { class: 'mono' }, v));
    el.replaceChildren(
      h('section', { class: 'group' },
        h('header', {}, h('h3', {}, 'Server')),
        h('p', { class: 'muted' }, s.on_demand
          ? 'This is the installed app (tools/install_app.py): it starts when you open it, and runs until you stop it here. Stopped, nothing runs; opening the app again starts it.'
          : 'Started by hand (python3 server.py): stopped here, it stays off until it is started again the same way.'),
        h('table', { class: 'files-props server-props' }, h('tbody', {},
          row('Runs as', s.on_demand ? 'the app, started on demand' : 'started by hand'),
          row('Address', `http://localhost:${s.port}`),
          row('Running for', since(s.uptime_s || 0)),
          row('Process', String(s.pid)),
          row('Folder', s.app_dir))),
        h('div', { class: 'server-actions' },
          s.on_demand ? h('button', { class: 'btn', onclick: () => stop(true) }, icon('restore', 14), 'Restart') : null,
          h('button', { class: 'btn danger', onclick: () => stop(false) }, icon('ban', 14), 'Stop server'))));
  };
  return { el, load };
}

let warningsOpen = false; // the warnings stay unfolded across re-renders once opened

/** The check's warnings for the vault this page shows, folded and grouped by kind: they never block it, so they
 *  only show here (the page itself shows nothing of them). null when there are none. */
function vaultWarnings(warnings) {
  const groups = warningGroups(warnings);
  if (!groups.length) return null;
  return h('details', { class: 'vault-warnings', open: warningsOpen, ontoggle: (e) => { warningsOpen = e.target.open; } },
    h('summary', {}, icon('alert', 13), `${warnings.length} warning${warnings.length === 1 ? '' : 's'} in its folder`),
    h('p', { class: 'muted small' }, 'Things in the folder the app leaves alone. None of them keeps the vault from being shown or written to.'),
    ...groups.map((g) => h('div', { class: 'vault-warning-group', 'data-kind': g.kind },
      h('h4', {}, `${g.label} (${g.findings.length})`),
      h('ul', { class: 'vault-findings' }, g.findings.map((f) => h('li', {}, h('code', {}, f.path), h('span', { class: 'muted small' }, f.detail)))))));
}

/** The Vaults tab: one row per vault (name, folder, structure, default, remove), and Add. `edit` is the list
 *  being edited, saved with the rest of the form; removing a vault only takes it out of the list. */
function vaultsEditor(c, edit) {
  const box = h('div', { class: 'vault-rows' });
  const structures = Object.entries(c.structures || { folders: 'Folder per type' });
  const render = () => box.replaceChildren(
    ...edit.vaults.map((v, i) => {
      // No autocomplete on either: a browser's suggestion must never fill one vault's field with another's.
      const name = h('input', { type: 'text', class: 'vault-name', autocomplete: 'off', value: v.name || '', placeholder: 'Name', 'aria-label': 'Vault name',
        oninput: (e) => { v.name = e.target.value; } });
      const path = h('input', { type: 'text', class: 'vault-path', autocomplete: 'off', spellcheck: 'false', value: v.path || '', placeholder: '/absolute/path or ~/… to an existing folder',
        'aria-label': `Folder of ${v.name || 'the vault'}`, oninput: (e) => { v.path = e.target.value; } });
      // Another structure has other types: what was turned off in the old one means nothing there.
      const structure = select(structures.map(([k, label]) => [k, label]), v.structure || 'folders', (s) => { v.structure = s; v.disabled_types = []; render(); },
        { class: 'small', 'aria-label': 'Structure' });
      // Which of its structure's types this vault shows. Off only hides: the files stay, and come back when turned on.
      const choices = (c.structure_types || {})[v.structure || 'folders'] || { types: [], required: [] };
      const off = new Set(v.disabled_types || []);
      const typesBox = h('details', { class: 'vault-types', open: !!v.typesOpen, ontoggle: (e) => { v.typesOpen = e.target.open; } },
        h('summary', {}, `Item types · ${choices.types.length - off.size} of ${choices.types.length} on`),
        h('p', { class: 'muted small' }, 'A type turned off leaves the sidebar, its list, the other items’ cards and every relation picker. Its files are not touched: turn it on again and everything is back. Hours already logged on its items stay in the work log.'),
        h('div', { class: 'vault-type-list' }, choices.types.map(([t, label]) => {
          const required = choices.required.includes(t);
          return h('label', { class: 'vault-type', title: required ? 'Needed by this structure: it cannot be turned off' : '' },
            h('input', { type: 'checkbox', checked: !off.has(t), disabled: required, 'data-type': t,
              onchange: (e) => {
                const now = new Set(v.disabled_types || []);
                if (e.target.checked) now.delete(t); else now.add(t);
                v.disabled_types = choices.types.map(([x]) => x).filter((x) => now.has(x));
                render();
              } }), label, required ? h('span', { class: 'muted small' }, '(required)') : null);
        })));
      const isDefault = h('label', { class: 'cp-default', title: 'The vault a page shows when its address names none' },
        h('input', { type: 'radio', name: 'vault-default', checked: edit.default === v, onchange: () => { edit.default = v; } }), 'Default');
      const remove = v.confirm
        ? [h('span', { class: 'muted small' }, 'Take it out of the list? Its files are not touched.'),
          h('button', { class: 'btn small danger', onclick: () => { edit.vaults.splice(i, 1); render(); } }, 'Remove'),
          h('button', { class: 'btn small', onclick: () => { v.confirm = false; render(); } }, 'Cancel')]
        : [h('button', { class: 'btn icon', title: `Remove ${v.name || 'this vault'} from the list`, disabled: edit.vaults.length < 2,
          onclick: () => { v.confirm = true; render(); } }, icon('x', 14))];
      const folders = (v.structure || 'folders') === 'folders'
        ? h('details', {}, h('summary', {}, 'Folders for new items'),
          h('p', { class: 'muted small' }, 'Relative to the vault. Every one must exist for the vault to match its structure.'),
          h('div', { class: 'fields' }, Object.entries(v.folders || {}).map(([t, f]) => h('label', { class: 'field' }, h('span', {}, t),
            h('input', { type: 'text', value: f, oninput: (e) => { v.folders[t] = e.target.value.trim(); } })))))
        : null;
      return h('div', { class: 'vault-row' },
        h('div', { class: 'vault-row-head' }, name, path, structure, isDefault, ...remove),
        v.id === vaultId() ? h('span', { class: 'muted small' }, 'Shown in this page.') : null,
        v.id === vaultId() ? vaultWarnings(state.vaultCheck?.warnings) : null,
        typesBox,
        folders);
    }),
    h('div', {}, h('button', { class: 'btn small', onclick: () => {
      edit.vaults.push({ id: '', name: '', path: '', structure: 'folders', folders: { ...(c.vaults?.[0]?.folders || {}) } });
      render();
    } }, icon('plus', 13), 'Add vault')));
  render();
  return box;
}

export function mount(root, param) {
  const form = h('div', { class: 'settings' });
  root.replaceChildren(h('header', { class: 'view-head' }, h('h1', {}, 'Settings')), form);
  const known = (k) => TABS.some(([t]) => t === k);
  let tab = known(param) ? param : known(pref('settings.tab')) ? pref('settings.tab') : 'general';
  const exportsTab = exportPanel();
  const appTab = appPanel();
  const guideTab = guidePanel();
  const statusesTab = statusPanel();
  // The vault list being edited outlives a re-render (coming back to the window reloads everything): a vault
  // half added is not lost. It starts again from the config only when the saved vaults change (a save).
  let edit = null;
  let editedFrom = '';
  return {
    update() {
      const c = state.config;
      const saved = JSON.stringify([c.vaults, c.default_vault]);
      if (!edit || saved !== editedFrom) {
        edit = { vaults: (c.vaults || []).map((v) => ({ ...v, folders: { ...(v.folders || {}) } })) };
        edit.default = edit.vaults.find((v) => v.id === c.default_vault) || edit.vaults[0];
        editedFrom = saved;
      }
      const kinds = h('input', { type: 'text', class: 'wide', 'aria-label': 'Work kinds', value: (c.work_kinds || []).join(', ') });
      // Saved folders: as many as you like, one of them the default (or none: the project folder of this app).
      const paths = [...(c.claude_paths || [])];
      const names = { ...(c.claude_path_names || {}) }; // path → its public name: what the Claude dialog shows instead of the path
      let defaultPath = c.claude_cwd || '';
      const pathsBox = h('div', { class: 'claude-paths' });
      const addInput = h('input', { type: 'text', class: 'wide', placeholder: 'Add a folder — /absolute/path or ~/…', 'aria-label': 'Folder to add' });
      const addPath = () => {
        const p = addInput.value.trim().replace(/\/+$/, '');
        if (!p) return;
        if (!paths.includes(p)) paths.push(p);
        addInput.value = '';
        renderPaths();
        addInput.focus();
      };
      addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addPath(); } });
      const radio = (value, text) => h('label', { class: 'cp-default', title: 'Where Claude starts when nothing else says' },
        h('input', { type: 'radio', name: 'claude-default', checked: value === defaultPath, onchange: () => { defaultPath = value; } }), text);
      const nameInput = (p, what) => h('input', { type: 'text', class: 'cp-name', value: names[p] || '', placeholder: 'Public name', 'aria-label': `Public name of ${what}`,
        title: 'What the Claude dialog shows for this folder (empty: the path)', oninput: (e) => { names[p] = e.target.value; } });
      const renderPaths = () => pathsBox.replaceChildren(
        h('div', { class: 'cp-row' }, radio('', 'Default'), nameInput('', 'the project folder'), h('span', { class: 'cp-path muted' }, 'The project folder of this app')),
        ...paths.map((p, i) => h('div', { class: 'cp-row' }, radio(p, 'Default'), nameInput(p, p),
          h('code', { class: 'cp-path', title: p }, p),
          h('button', { class: 'btn icon', title: `Remove ${p}`, onclick: () => { paths.splice(i, 1); delete names[p]; if (defaultPath === p) defaultPath = ''; renderPaths(); } }, icon('x', 14)))),
        h('div', { class: 'cp-add' }, addInput, h('button', { class: 'btn small', onclick: addPath }, 'Add')));
      renderPaths();
      const claudeCmd = h('input', { type: 'text', class: 'wide', value: c.claude_command || 'claude', placeholder: 'claude' });
      let terminal = c.terminal || 'Terminal';
      let editorApp = c.editor_app || 'Cursor';
      const editorSel = select((c.editors || ['Cursor']).map((e) => [e, e]), editorApp, (v) => { editorApp = v; }, { 'aria-label': 'Editor app' });
      const terminalSel = select([['Terminal', 'Terminal'], ['iTerm', 'iTerm']], terminal, (v) => { terminal = v; }, { 'aria-label': 'Terminal app' });
      let model = c.claude_model || '';
      let effort = c.claude_effort || '';
      const modelSel = select(claudeModelOptions(model), model, (v) => { model = v || ''; }, { 'aria-label': 'Default model' });
      const effortSel = select(CLAUDE_EFFORTS, effort, (v) => { effort = v || ''; }, { 'aria-label': 'Default effort' });
      const missing = state.items.filter((i) => !i.id);
      const doSave = async () => {
        // A new vault gets its id here, from its name, once (the server checks it): it never changes after.
        const taken = new Set(edit.vaults.map((v) => v.id).filter(Boolean));
        for (const v of edit.vaults.filter((x) => !x.id)) {
          const base = (v.name || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'vault';
          let id = base;
          for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
          taken.add(id);
          v.id = id;
        }
        const vaults = edit.vaults.map(({ confirm, typesOpen, ...v }) => ({ ...v, name: (v.name || '').trim(), path: (v.path || '').trim() }));
        // The types this page's vault has on: the page builds its sidebar, lists and pickers from them once, so a
        // change to them loads the page again (as switching vault does).
        const typesHere = () => JSON.stringify((state.config.vaults || []).find((v) => v.id === vaultId())?.disabled_types || []);
        const before = typesHere();
        await saveConfig({
          vaults,
          default_vault: (edit.default || edit.vaults[0])?.id || '',
          work_kinds: kinds.value.split(',').map((k) => k.trim()).filter(Boolean),
          claude_cwd: defaultPath,
          claude_paths: paths,
          claude_path_names: Object.fromEntries(['', ...paths].map((p) => [p, (names[p] || '').trim()]).filter(([, n]) => n)), // '': the project folder
          claude_command: claudeCmd.value.trim() || 'claude',
          terminal,
          editor_app: editorApp,
          claude_model: model,
          claude_effort: effort,
        }).then(() => {
          toast('Settings saved');
          if (typesHere() !== before) location.reload();
        }).catch(() => {});
      };
      const saveBar = () => h('div', { class: 'settings-save' }, h('button', { class: 'btn primary', onclick: doSave }, 'Save settings'),
        h('span', { class: 'muted small' }, 'Saves Vaults, General and Claude together.'));
      const vaultsTab = [
        h('section', { class: 'group' },
          h('header', {}, h('h3', {}, 'Vaults')),
          h('p', { class: 'muted' }, 'The folders this app can show, each on its own: switch between them at the foot of the sidebar. A vault is shown only while its folder matches its structure; until then nothing is read from it or written to it. Taking a vault out of the list leaves its files as they are.'),
          vaultsEditor(c, edit)),
        saveBar(),
      ];
      const general = [
        h('section', { class: 'group' },
          h('header', {}, h('h3', {}, 'Work kinds')),
          h('p', { class: 'muted' }, 'Options offered by "Log work", comma separated.'),
          kinds),
        h('section', { class: 'group' },
          h('header', {}, h('h3', {}, 'Editor')),
          h('p', { class: 'muted' }, 'The app the Explorer\'s "Open in…" hands a file or folder to, to edit it there.'),
          h('div', { class: 'field' }, h('span', {}, 'Editor app'), editorSel)),
        saveBar(),
      ];
      const claude = [
        h('section', { class: 'group' },
          h('header', {}, h('h3', {}, 'Work with Claude')),
          h('p', { class: 'muted' }, 'The button on every item (and the terminal in the top bar) opens a terminal and starts Claude. It runs in the item\'s Local path, or its parent\'s, else in the default folder below; the dialog can pick any saved folder for one launch. It starts with the model and effort chosen here, and can change them for one launch too.'),
          h('div', { class: 'field claude-paths-field' }, h('span', {}, 'Saved folders'), pathsBox)),
        h('section', { class: 'group' },
          h('header', {}, h('h3', {}, 'How Claude starts')),
          h('p', { class: 'muted' }, `The command, the app for "Open in Terminal", and the model and effort every launch starts with. The terminal inside the app takes Claude Code's own theme (now ${c.claude_theme === 'light' ? 'light' : 'dark'}; /theme in Claude changes it).`),
          h('div', { class: 'fields' },
            h('label', { class: 'field' }, h('span', {}, 'Command'), claudeCmd),
            h('div', { class: 'field' }, h('span', {}, 'Terminal app'), terminalSel),
            h('div', { class: 'field' }, h('span', {}, 'Default model'), modelSel),
            h('div', { class: 'field' }, h('span', {}, 'Default effort'), effortSel))),
        saveBar(),
      ];
      const maintenance = [
        h('section', { class: 'group' },
          h('header', {}, h('h3', {}, 'Items without ID', h('span', { class: 'count' }, missing.length || ''))),
          missing.length
            ? h('div', {}, h('p', { class: 'muted' }, 'Found by type but missing an id (hand-written or from another tool). Relations need ids.'),
              h('ul', {}, missing.map((i) => h('li', { class: 'mono' }, i.path))),
              h('button', { class: 'btn', onclick: () => assignIds().then((r) => toast(`Assigned ${r.assigned.length} ids`)).catch(() => {}) }, 'Assign IDs'))
            : h('p', { class: 'muted' }, 'All items have an id.')),
      ];
      const keyboard = [h('section', { class: 'group' },
        h('header', {}, h('h3', {}, 'Keyboard')),
        h('p', { class: 'muted' }, keyboardHelp()))];
      const content = { vaults: vaultsTab, general, claude, maintenance, keyboard, export: [exportsTab.el], app: [appTab.el], statuses: [statusesTab.el],
        documentation: [guideTab.el] };
      form.replaceChildren(...tabPanels(TABS.map(([key, label]) => ({ key, label, content: content[key] })), tab, (key) => {
        tab = key;
        setPref('settings.tab', key);
        // The address follows the tab without a hashchange: a remount would drop what is being typed.
        history.replaceState(null, '', `#/settings/${key}`);
        if (key === 'export') exportsTab.load();
        if (key === 'app') appTab.load();
        if (key === 'statuses') statusesTab.load();
        if (key === 'documentation') guideTab.load();
      }));
      if (tab === 'export') exportsTab.load();
      if (tab === 'app') appTab.load();
      if (tab === 'statuses') statusesTab.load();
      if (tab === 'documentation') guideTab.load();
    },
  };
}

// ── Export: versions as zips in versions/, of three kinds, each with its own button and list ──
// The system (the app: code, docs, the sample vault), the agents (.claude/ and every CLAUDE.md) and the
// vault this page shows. Never config.json (each machine has its own paths), .env (secrets) or Claude's local
// permissions. The installed app (tools/install_app.py) makes them from the checkout it came from, and lists the
// same zips as that checkout (tm/export.py home()).
const EXPORT_COLUMNS = (kind) => ['exported', ...(kind === 'vault' ? ['vault'] : []), 'host', 'version', 'note', 'size', 'actions'];
const EXPORT_FIXED = Object.fromEntries(['system', 'agents', 'vault'].map((k) => [k, fixedColumns(EXPORT_COLUMNS(k).map((key) => ({ key })))]));
const vaultName = (id) => (state.config.vaults || []).find((v) => v.id === id)?.name || id;
const fileSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const EXPORT_KINDS = [
  { kind: 'system', title: 'System', button: 'Export system',
    about: 'The app as it is now — server, code, tests, tools, docs and the sample vault — to carry it to another machine. Not the agents (below), not the vault you work in, config.json or .env.' },
  { kind: 'agents', title: 'Agents', button: 'Export agents',
    about: 'What Claude works with here: .claude/ (commands, settings, launch configs; not its worktrees) and every CLAUDE.md. Nothing else of the app.' },
  { kind: 'vault', title: 'Vault', button: 'Export vault',
    about: () => `The vault this page shows (${vaultName(vaultId())}), whole: every item, people, labels, pins, ids and the trash. Under vault-<its id>/ inside the zip, its structure named in VERSION.json; none of the app.` },
];

function exportPanel() {
  let rows = null; // every export, null until loaded
  let from = null; // where they are made and kept: { from, installed, limited } (the installed app: its checkout)
  let confirming = null; // the export whose delete asks first
  let allVaults = pref('export.allVaults', false) === true; // the Vault list: this page's vault only, or every one
  const run = async (fn) => { try { await fn(); } catch (e) { toast(e.message, true); } };
  const load = () => run(async () => { const out = await api.exports(); rows = out.exports; from = out; render(); });

  const row = (r) => {
    const cols = EXPORT_COLUMNS(r.kind || 'system').length;
    if (confirming === r.name) {
      return h('tr', { class: 'tag-edit' }, h('td', { colspan: cols }, h('div', { class: 'tag-edit-row' },
        h('span', { class: 'small' }, `Delete ${r.name}? It cannot be undone.`), h('span', { class: 'spacer' }),
        h('button', { class: 'btn small ghost', onclick: () => { confirming = null; render(); } }, 'Cancel'),
        h('button', { class: 'btn small danger', onclick: () => run(async () => { confirming = null; await api.deleteExport(r.name); await load(); }) }, icon('trash', 13), 'Delete'))));
    }
    return h('tr', { class: 'export-row' },
      h('td', { title: r.name }, String(r.created_at || '').replace('T', ' ').slice(0, 16) || '—'),
      r.kind === 'vault' ? h('td', { title: [r.vault_id, r.structure, r.vault_root].filter(Boolean).join(' · ') || null },
        r.vault_id ? vaultName(r.vault_id) : h('span', { class: 'muted' }, '—')) : null,
      h('td', {}, r.host || '—'),
      h('td', { title: (r.changes || []).join('\n') || null },
        h('span', { class: 'mono' }, `${r.branch || '?'}@${r.sha || '?'}`), r.dirty ? h('span', { class: 'chip warn' }, 'uncommitted') : null),
      h('td', { class: 'c-note', title: r.note || null }, r.note || h('span', { class: 'muted' }, '—')),
      h('td', { class: 'num' }, fileSize(r.size)),
      h('td', { class: 'c-actions' },
        h('a', { class: 'btn icon', href: `${location.origin}/api/exports/file?name=${encodeURIComponent(r.name)}`, download: r.name, title: `Download ${r.name}` }, icon('down', 15)),
        h('button', { class: 'btn icon', title: 'Show in Finder', onclick: () => run(() => api.revealExport(r.name)) }, icon('folder', 15)),
        h('button', { class: 'btn icon', title: `Delete ${r.name}`, onclick: () => { confirming = r.name; render(); } }, icon('trash', 15))));
  };
  const table = (list, kind) => (rows === null ? h('p', { class: 'muted' }, 'Loading…')
    : !list.length ? h('p', { class: 'muted' }, `No ${kind} exports yet.`)
      : h('div', { class: 'table-wrap' }, h('table', { class: 'grid fixed export-grid', style: EXPORT_FIXED[kind].style, 'aria-label': `${kind} exports` },
        EXPORT_FIXED[kind].colgroup.cloneNode(true),
        h('thead', {}, h('tr', {}, ['Exported', ...(kind === 'vault' ? ['Vault'] : []), 'PC', 'Version', 'Note', 'Size'].map((c) => h('th', { scope: 'col', class: c === 'Size' ? 'num' : '' }, c)),
          h('th', { scope: 'col', class: 'c-actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', {}, list.map(row)))));

  // One section per kind: what it holds, a note and its button, then its versions, folded by default
  // (export.open.<kind> remembers it unfolded); exporting unfolds it, to show the new one.
  const sections = EXPORT_KINDS.map((k) => {
    let open = pref(`export.open.${k.kind}`, false) === true;
    const toggle = h('button', { type: 'button', class: 'export-versions group-toggle', 'aria-controls': `export-${k.kind}-versions` });
    const setOpen = (v) => { open = v; setPref(`export.open.${k.kind}`, v || null); render(); };
    toggle.addEventListener('click', () => setOpen(!open));
    const note = h('input', { type: 'text', class: 'wide', maxlength: '500', placeholder: 'Note — what changed, why you export now (optional)', 'aria-label': `${k.title} export note` });
    const btn = h('button', { class: 'btn primary' }, icon('archive', 15), k.button);
    const box = h('div', { id: `export-${k.kind}-versions` });
    let busy = false;
    btn.addEventListener('click', () => run(async () => {
      if (busy) return;
      busy = true; btn.disabled = true;
      try {
        const r = await api.exportVersion(note.value.trim(), k.kind);
        note.value = '';
        toast(`Exported ${r.name} · ${r.files} files`);
        if (!open) setOpen(true);
        await load();
      } finally { busy = false; btn.disabled = false; }
    }));
    note.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
    // The Vault list: this page's vault, or every vault's zips (each named in its Vault column).
    const scope = k.kind === 'vault' ? h('label', { class: 'toggle export-scope' },
      h('input', { type: 'checkbox', checked: allVaults, onchange: (e) => { allVaults = e.target.checked; setPref('export.allVaults', allVaults || null); render(); } }),
      'Every vault') : null;
    const limited = h('p', { class: 'muted small', hidden: true });
    const el = h('section', { class: 'group export-kind' },
      h('header', {}, h('h3', {}, k.title)),
      h('p', { class: 'muted' }, typeof k.about === 'function' ? k.about() : k.about),
      limited,
      h('div', { class: 'export-new' }, note, btn),
      h('h4', { class: 'export-head' }, toggle, scope),
      box);
    return { k, el, box, btn, limited, toggle, isOpen: () => open };
  });
  const render = () => {
    origin.replaceChildren(...whereText());
    sections.forEach(({ k, box, btn, limited, toggle, isOpen }) => {
      // The installed app whose checkout is gone exports only vaults: say why instead of failing on the button.
      const blocked = k.kind !== 'vault' && !!from?.limited;
      btn.disabled = blocked;
      limited.hidden = !blocked;
      limited.textContent = blocked ? `Not here: ${from.limited}.` : '';
      const list = (rows || []).filter((r) => (r.kind || 'system') === k.kind && (k.kind !== 'vault' || allVaults || !r.vault_id || r.vault_id === vaultId()));
      toggle.setAttribute('aria-expanded', String(isOpen()));
      toggle.replaceChildren(icon(isOpen() ? 'down' : 'right', 14), 'Versions', rows === null ? '' : h('span', { class: 'count' }, String(list.length)));
      box.hidden = !isOpen();
      if (isOpen()) box.replaceChildren(table(list, k.kind));
    });
  };
  // Where the zips are: the app's versions/, or — the installed app — the versions/ of the checkout it came from.
  const whereText = () => [
    'Zips in ', h('span', { class: 'mono' }, from?.from ? `${from.from}/versions/` : 'versions/'),
    ', each with a VERSION.json saying where, when and from which commit. ',
    from?.installed && !from?.limited ? 'This is the installed app: the system and the agents are taken from that checkout, as it is now (its commit and uncommitted changes), not from the copy that runs here. ' : '',
    'On the other machine, unzip the system and the agents over a checkout of the app, then run tools/install_app.py; unzip a vault anywhere and add its folder in Settings → Vaults.',
  ];
  const origin = h('p', { class: 'muted' });

  const el = h('div', { class: 'stack' }, origin, ...sections.map((x) => x.el));
  render();
  return { el, load };
}
