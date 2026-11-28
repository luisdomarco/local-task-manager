// Settings, its sections in a column of their own on the left grouped by theme (settingsnav.js NAV_GROUPS; on a phone a list that
// opens each), one shown at a time (#/settings/<tab>, the last one remembered): Vaults (the folders this app can show, as a table; each
// one added or edited in its own dialog, views/vaults.js), Statuses (each type's statuses in the three groups,
// views/statuses.js), Themes (how the app looks in this browser, views/themes.js), General (work kinds), Claude,
// Agents, Maintenance, Keyboard (views/keyboard.js), Export (the system, the agents or a vault, as zips), Desktop app
// and Documentation (the user guide, docs/user-guide.md). General, Claude and Agents are one config form: Save, at the
// foot of any of them, saves all three.
import { scheduleList } from '../agentschedules.js';
import { agentHref } from '../agentsmodel.js';
import { api } from '../api.js';
import { fixedColumns } from '../datatable.js';
import { has } from '../features.js';
import { folderButton } from '../folderpick.js';
import { pref, setPref } from '../prefs.js';
import { saveConfig, state, assignIds, toast } from '../state.js';
import { CLAUDE_EFFORTS, claudeModelOptions } from '../claude.js';
import { keyboardPanel } from './keyboard.js';
import { groupSections } from '../settingsnav.js';
import { checkSelect, countOf, emptyLine, foldHead, formActions, h, icon, loadingLine, pageHead, propRow, renderMarkdown, select } from '../ui.js';
import { OFFSETS, loadDefaults as loadReminderDefaults, offsetsText, setDefaults as setReminderDefaults, sortOffsets } from '../reminders.js';
import { cleanTime } from '../worktime.js';
import { vaultId } from '../vault.js';
import { hasUnsaved } from '../panel.js';
import { filesUnsaved } from './files.js';
import { statusPanel } from './statuses.js';
import { themesPanel } from './themes.js';
import { vaultsSection } from './vaults.js';
import { isTouch } from '../phone.js';
import { versionLine } from '../appbuild.js';

const ALL_TABS = [['vaults', 'Vaults'], ['statuses', 'Statuses'], ['reminders', 'Reminders'], ['themes', 'Themes'], ['general', 'General'], ['claude', 'Claude'], ['agents', 'Agents'], ['maintenance', 'Maintenance'], ['keyboard', 'Keyboard'], ['export', 'Export'], ['app', 'Desktop app'], ['documentation', 'Documentation']];
// The tabs only a computer has (features.js): a phone shows the others; Reminders goes with the vault's feature
// (Settings → Vaults → Features). Keyboard only where there is one to speak of: a touch screen (phone.js) leaves it out.
const TAB_FEATURE = { claude: 'terminal', agents: 'agents', export: 'export', app: 'server', reminders: 'reminders' };
const tabs = () => ALL_TABS.filter(([key]) => (!TAB_FEATURE[key] || has(TAB_FEATURE[key])) && !(key === 'keyboard' && isTouch()));
const NAV_ICONS = { vaults: 'folder', statuses: 'checklist', reminders: 'clock', general: 'sliders', maintenance: 'lifebuoy', themes: 'sun', keyboard: 'text',
  claude: 'terminal', agents: 'bot', app: 'monitor', export: 'download', documentation: 'book' };
const PHONE_NAV = '(max-width: 760px)';
const onPhone = () => typeof matchMedia === 'function' && matchMedia(PHONE_NAV).matches;

/**
 * The sections (`entries`: [{ key, label, content }]) beside a column of their names, grouped (NAV_GROUPS; one in no
 * group goes last: settingsnav.js), the one shown `active`. On a phone, `null` shows the list alone, and a section shows with
 * *‹ Settings* over it. `onChange(key)` runs when another is picked.
 */
function settingsNav(entries, active, onChange) {
  const byKey = new Map(entries.map((t) => [t.key, t]));
  const grouped = groupSections(entries.map((t) => t.key));
  const order = grouped.flatMap(([, keys]) => keys);
  const items = new Map();
  const panels = new Map(entries.map((t) => [t.key, h('div', { class: 'tab-panel', role: 'region', 'aria-label': t.label, 'data-tab': t.key }, ...[t.content].flat())]));
  const layout = h('div', { class: 'settings-layout' });
  const show = (key, { focus = false, quiet = false } = {}) => {
    layout.classList.toggle('has-section', !!key);
    layout.classList.toggle('no-section', !key);
    for (const [k, el] of items) { if (k === key) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); }
    for (const [k, el] of panels) el.hidden = k !== key;
    if (focus && key) items.get(key)?.focus();
    if (key) { panels.get(key).dispatchEvent(new Event('tabshow')); if (!quiet) onChange(key); }
  };
  const nav = h('nav', { class: 'settings-nav', 'aria-label': 'Settings sections' }, grouped.map(([name, keys]) => h('div', { class: 'settings-nav-group' },
    h('div', { class: 'settings-nav-head' }, name),
    keys.map((k) => {
      const el = h('a', { class: 'settings-nav-item', href: `#/settings/${k}`, 'data-tab': k,
        onclick: (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return; // a new tab: the browser's
          e.preventDefault();
          // On a phone the list goes back to by Back (a step of history); on a computer the address just follows.
          if (onPhone()) history.pushState({ settingsSection: true }, '', `#/settings/${k}`); else history.replaceState(null, '', `#/settings/${k}`);
          show(k);
          if (onPhone()) window.scrollTo(0, 0);
        },
        onkeydown: (e) => {
          const i = order.indexOf(k);
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = order[(i + (e.key === 'ArrowDown' ? 1 : order.length - 1)) % order.length];
            history.replaceState(null, '', `#/settings/${next}`);
            show(next, { focus: true });
          }
        } }, icon(NAV_ICONS[k] || 'settings', 15), h('span', {}, byKey.get(k).label));
      items.set(k, el);
      return el;
    }))));
  // Back to the list: the step of history the list pushed, when it did (no pile of entries); else the list's address.
  const back = h('a', { class: 'docs-back settings-back', href: '#/settings',
    onclick: (e) => { if (history.state?.settingsSection) { e.preventDefault(); history.back(); } } }, icon('left', 14), 'Settings');
  layout.append(nav, h('div', { class: 'settings-main' }, back, ...panels.values()));
  show(active, { quiet: true });
  layout.show = show;
  return layout;
}

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

/** Where the app is published: its code, README (the full reference) and changelog. */
export const PUBLIC_REPO = 'https://github.com/luisdomarco/local-task-manager';

/** Settings → Documentation: the public repository (the README, the changelog, the version this is) over the user
 *  guide (docs/user-guide.md), read once when the tab is first shown. */
function guidePanel() {
  const out = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text, icon('external', 12));
  const version = h('span', { class: 'muted' });
  const head = h('section', { class: 'group guide-head' },
    h('header', {}, h('h3', {}, 'Local Task Manager'), version),
    h('p', { class: 'muted' }, 'The whole reference — every screen, the vault’s files, the command line — is the README on GitHub. Below, the user guide.'),
    h('p', { class: 'guide-links' },
      out(PUBLIC_REPO, 'Repository'),
      out(`${PUBLIC_REPO}#readme`, 'README'),
      out(`${PUBLIC_REPO}/blob/main/CHANGELOG.md`, 'Changelog'),
      out(`${PUBLIC_REPO}/issues`, 'Report a problem')));
  const guide = h('div', { class: 'md guide' }, loadingLine('Loading the guide…'));
  const el = h('div', {}, head, guide);
  let loaded = false;
  const load = async () => {
    if (loaded) return;
    try {
      const { markdown, version: v, build } = await api.guide();
      guide.innerHTML = renderMarkdown(markdown); // sanitized by renderMarkdown (DOMPurify)
      version.textContent = versionLine(v, build);
      loaded = true;
    } catch (e) {
      guide.replaceChildren(h('p', { class: 'muted' }, `The guide could not be loaded: ${e.message}`));
    }
  };
  return { el, load };
}

/** Settings → Desktop app: the server this page talks to — the installed app (started on demand) or one started by hand —
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
    const row = (k, v) => propRow(k, h('span', { class: 'mono set-value' }, v), { tag: 'div' }); // a value, read
    el.replaceChildren(
      h('section', { class: 'group' },
        h('header', {}, h('h3', {}, 'Server')),
        h('p', { class: 'muted' }, s.on_demand
          ? 'This is the installed app (tools/install_app.py): it starts when you open it, and runs until you stop it here. Stopped, nothing runs; opening the app again starts it.'
          : 'Started by hand (python3 server.py): stopped here, it stays off until it is started again the same way.'),
        h('div', { class: 'fields prop-rows server-props' },
          row('Runs as', s.on_demand ? 'the app, started on demand' : 'started by hand'),
          row('Address', `http://localhost:${s.port}`),
          row('Running for', since(s.uptime_s || 0)),
          row('Process', String(s.pid)),
          row('Folder', s.app_dir)),
        h('div', { class: 'server-actions' },
          s.on_demand ? h('button', { class: 'btn small', onclick: () => stop(true) }, icon('restore', 14), 'Restart') : null,
          h('button', { class: 'btn small ghost danger-text', onclick: () => stop(false) }, icon('ban', 14), 'Stop server'))));
  };
  return { el, load };
}

export { legacyNote } from './vaults.js'; // main.js's note on a legacy vault says what its Settings row says

export function mount(root, param) {
  const form = h('div', { class: 'settings' });
  root.replaceChildren(pageHead({ title: 'Settings' }), form);
  const known = (k) => tabs().some(([t]) => t === k);
  // A phone at #/settings shows the list of sections; a computer the one last open.
  let tab = known(param) ? param : onPhone() ? null : known(pref('settings.tab')) ? pref('settings.tab') : 'general';
  const exportsTab = exportPanel();
  const appTab = appPanel();
  const guideTab = guidePanel();
  const statusesTab = statusPanel();
  const schedTab = schedulesPanel();
  const remindersTab = remindersPanel();
  let nav = null;
  // Back (or ‹ Settings) changes the address without a new route when it stays on Settings: follow it here. A phone at
  // #/settings goes back to the list; a computer keeps the section it shows.
  const onHash = () => {
    const m = location.hash.match(/^#\/settings(?:\/(\w+))?$/);
    if (!m || !nav?.isConnected) return;
    const k = known(m[1]) ? m[1] : null;
    if (k === tab || (!k && !onPhone())) return;
    tab = k;
    nav.show(k);
  };
  window.addEventListener('hashchange', onHash);
  return {
    unmount() { window.removeEventListener('hashchange', onHash); },
    update() {
      const c = state.config;
      const kinds = h('input', { type: 'text', class: 'wide', 'aria-label': 'Work kinds', value: (c.work_kinds || []).join(', ') });
      // Saved folders: as many as you like, one of them the default (or none: the project folder of this app).
      const paths = [...(c.claude_paths || [])];
      // A saved folder that is gone (moved or deleted outside the app) stays listed, marked, to be removed or kept.
      const gone = new Set(c.missing_dirs || []);
      const goneChip = (p) => gone.has(p) ? h('span', { class: 'chip warn', title: 'Moved or deleted outside the app: remove it, or put the folder back' }, 'Folder not found') : null;
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
          h('code', { class: 'cp-path', title: p }, p), goneChip(p),
          h('button', { class: 'btn icon row-action', title: `Remove ${p}`, onclick: () => { paths.splice(i, 1); delete names[p]; if (defaultPath === p) defaultPath = ''; renderPaths(); } }, icon('x', 14)))),
        h('div', { class: 'cp-add' }, addInput, folderButton(addInput, { prompt: 'Choose a folder Claude can start in', onPick: addPath }),
          h('button', { class: 'btn small ghost', onclick: addPath }, icon('plus', 13), 'Add')));
      renderPaths();
      // Agent folders (the sidebar's Agents mode): their own list, each with the name the sidebar shows for it.
      const agentPaths = [...(c.agent_dirs || [])];
      const agentNames = { ...(c.agent_dir_names || {}) };
      const agentsBox = h('div', { class: 'claude-paths' });
      const agentInput = h('input', { type: 'text', class: 'wide', placeholder: 'Add a folder — /absolute/path or ~/…', 'aria-label': 'Agent folder to add' });
      const addAgentPath = () => {
        const p = agentInput.value.trim().replace(/\/+$/, '');
        if (!p) return;
        if (!agentPaths.includes(p)) agentPaths.push(p);
        agentInput.value = '';
        renderAgentPaths();
        agentInput.focus();
      };
      agentInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addAgentPath(); } });
      const renderAgentPaths = () => agentsBox.replaceChildren(
        ...(agentPaths.length ? [] : [emptyLine('None yet.')]),
        ...agentPaths.map((p, i) => h('div', { class: 'cp-row agents-dir-row' },
          h('input', { type: 'text', class: 'cp-name', value: agentNames[p] || '', placeholder: p.split('/').pop() || 'Name', 'aria-label': `Name of ${p}`,
            title: 'What the sidebar shows for this folder (empty: its last part)', oninput: (e) => { agentNames[p] = e.target.value; } }),
          h('code', { class: 'cp-path', title: p }, p), goneChip(p),
          h('button', { class: 'btn icon row-action', title: `Remove ${p} (its files stay as they are)`, onclick: () => { agentPaths.splice(i, 1); delete agentNames[p]; renderAgentPaths(); } }, icon('x', 14)))),
        h('div', { class: 'cp-add' }, agentInput, folderButton(agentInput, { prompt: 'Choose a folder whose .claude/commands holds agents', onPick: addAgentPath }),
          h('button', { class: 'btn small ghost', onclick: addAgentPath }, icon('plus', 13), 'Add')));
      renderAgentPaths();
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
        await saveConfig({
          work_kinds: kinds.value.split(',').map((k) => k.trim()).filter(Boolean),
          claude_cwd: defaultPath,
          claude_paths: paths,
          claude_path_names: Object.fromEntries(['', ...paths].map((p) => [p, (names[p] || '').trim()]).filter(([, n]) => n)), // '': the project folder
          claude_command: claudeCmd.value.trim() || 'claude',
          terminal,
          editor_app: editorApp,
          claude_model: model,
          claude_effort: effort,
          agent_dirs: agentPaths,
          agent_dir_names: Object.fromEntries(agentPaths.map((p) => [p, (agentNames[p] || '').trim()]).filter(([, n]) => n)),
        }).then(() => toast('Settings saved')).catch(() => {});
      };
      const saveBar = () => h('div', { class: 'settings-save' }, h('button', { class: 'btn primary', onclick: doSave }, 'Save settings'),
        h('span', { class: 'muted small' }, `Saves ${tabs().filter(([key]) => ['general', 'claude', 'agents'].includes(key)).map(([, label]) => label)
          .join(', ').replace(/, ([^,]*)$/, ' and $1')} together.`));
      const vaultsTab = [vaultsSection()]; // its own dialog saves each vault (views/vaults.js)
      // A setting as a row (its name, then its control with what it does under it), as a card's properties.
      const setRow = (label, control, help) => propRow(label, control, { tag: 'div', help });
      const general = [
        h('section', { class: 'group' },
          h('div', { class: 'fields prop-rows' },
            setRow('Work kinds', kinds, 'Options offered by "Log work", comma separated.'),
            has('open_in') && setRow('Editor app', editorSel, 'The app the Explorer\'s "Open in…" hands a file or folder to, to edit it there.'))),
        saveBar(),
      ];
      const claude = [
        h('section', { class: 'group' },
          h('header', {}, h('h3', {}, 'Work with Claude')),
          h('p', { class: 'muted' }, 'The button on every item (and the terminal in the top bar) opens a terminal and starts Claude. It runs in the item\'s Local path, or its parent\'s, else in the default folder below; the dialog can pick any saved folder for one launch. It starts with the model and effort chosen here, and can change them for one launch too.'),
          propRow('Saved folders', pathsBox, { tag: 'div', cls: 'claude-paths-field' })),
        h('section', { class: 'group' },
          h('header', {}, h('h3', {}, 'How Claude starts')),
          h('p', { class: 'muted' }, `The command, the app for "Open in Terminal", and the model and effort every launch starts with. The terminal inside the app takes Claude Code's own theme (now ${c.claude_theme === 'light' ? 'light' : 'dark'}; /theme in Claude changes it).`),
          h('div', { class: 'fields prop-rows' },
            propRow('Command', claudeCmd),
            propRow('Terminal app', terminalSel, { tag: 'div' }),
            propRow('Default model', modelSel, { tag: 'div' }),
            propRow('Default effort', effortSel, { tag: 'div' }))),
        saveBar(),
      ];
      const agents = [
        h('section', { class: 'group' },
          h('header', {}, h('h3', {}, 'Agent folders')),
          h('p', { class: 'muted' }, 'The folders the sidebar\'s Agents mode reads (⌘⇧E goes round the modes). Every command in a folder\'s .claude/commands is an agent, run from its page as a chat in the dock, in that folder, so Claude loads that folder\'s commands, settings and CLAUDE.md. A folder may be anywhere: a repository, a system, outside every vault. Taking one out of the list leaves its files as they are.'),
          propRow('Folders', agentsBox, { tag: 'div', cls: 'claude-paths-field' })),
        saveBar(),
        h('section', { class: 'group' },
          h('header', {}, h('h3', {}, 'Scheduled runs')),
          h('p', { class: 'muted' }, 'Every agent\'s schedules (Schedule… on an agent\'s page). They run in the app whether it is open or not: the installed app is woken a few minutes before one is due. A run that comes due while the Mac is off runs once when it is back, within 12 hours.'),
          schedTab.el),
      ];
      const maintenance = [
        h('section', { class: 'group' },
          h('header', {}, h('h3', {}, 'Items without ID', countOf(missing.length || null))),
          missing.length
            ? h('div', {}, h('p', { class: 'muted' }, 'Found by type but missing an id (hand-written or from another tool). Relations need ids.'),
              h('ul', {}, missing.map((i) => h('li', { class: 'mono' }, i.path))),
              h('button', { class: 'btn small', onclick: () => assignIds().then((r) => toast(`Assigned ${r.assigned.length} ids`)).catch(() => {}) }, 'Assign IDs'))
            : h('p', { class: 'muted' }, 'All items have an id.')),
      ];
      // Every key the app answers, grouped, with a search: the same list as ? anywhere (views/keyboard.js).
      const keyboard = [h('p', { class: 'muted' }, 'Every key the app answers. ', h('kbd', {}, '?'), ' shows this list on any page.'), keyboardPanel().el];
      const content = { vaults: vaultsTab, reminders: [remindersTab.el], general, claude, agents, maintenance, keyboard, export: [exportsTab.el], app: [appTab.el], statuses: [statusesTab.el],
        themes: [themesPanel().el],
        documentation: [guideTab.el] };
      // The address follows the section without a hashchange (settingsNav): a remount would drop what is being typed.
      form.replaceChildren(nav = settingsNav(tabs().map(([key, label]) => ({ key, label, content: content[key] })), tab, (key) => {
        tab = key;
        setPref('settings.tab', key);
        if (key === 'export') exportsTab.load();
        if (key === 'app') appTab.load();
        if (key === 'statuses') statusesTab.load();
        if (key === 'documentation') guideTab.load();
        if (key === 'agents') schedTab.load();
        if (key === 'reminders') remindersTab.load();
      }));
      if (tab === 'export') exportsTab.load();
      if (tab === 'app') appTab.load();
      if (tab === 'statuses') statusesTab.load();
      if (tab === 'documentation') guideTab.load();
      if (tab === 'agents') schedTab.load();
      if (tab === 'reminders') remindersTab.load();
    },
  };
}

// ── Reminders: the vault's defaults (tm/reminders.py), kept in the vault so every device reads them, saved as they change ──
function remindersPanel() {
  const el = h('div', {}, loadingLine('Reading…'));
  let d = null;
  // `redraw: false` while a menu is still open on the control (the offsets' ticks): drawn again only if the save fails.
  const save = async (changes, { redraw = true } = {}) => {
    try {
      const out = await api.saveVaultSettings({ reminders: { ...d, ...changes } });
      d = out.reminders;
      setReminderDefaults(d);
      toast('Reminders saved');
      if (redraw) render();
    } catch (e) { toast(e.message, true); render(); }
  };
  const toggle = (checked, text, onchange) => h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), text);
  const render = () => {
    const offsets = checkSelect(OFFSETS.map(([k, , words]) => [k, words]), d.offsets, (picked) => {
      if (picked.length) save({ offsets: sortOffsets(picked) }, { redraw: false });
      else { toast('Pick at least one, or turn reminders off', true); render(); }
    }, { any: 'None', text: (picked) => offsetsText(sortOffsets(picked)), 'aria-label': 'Default reminders', disabled: !d.on });
    const duration = h('input', { type: 'text', value: d.duration, placeholder: '00:30', inputmode: 'numeric', 'aria-label': 'Default duration' });
    duration.addEventListener('change', () => {
      const clean = cleanTime(duration.value.trim()) ?? duration.value.trim();
      duration.value = clean;
      if (clean !== d.duration) save({ duration: clean });
    });
    const setRow = (label, control, help) => propRow(label, control, { tag: 'div', help });
    el.replaceChildren(h('section', { class: 'group reminders-settings' },
      h('header', {}, h('h3', {}, 'Reminders')),
      h('p', { class: 'muted' }, 'A task planned for a day at a time — or a meeting at its time — rings before it starts: in the iPhone app, and on this Mac. These are the defaults of this vault, kept inside it so every device reads the same. A task with reminders of its own keeps them; one without follows these, even when they change.'),
      h('div', { class: 'fields prop-rows' },
        setRow('Remind by default', toggle(d.on, 'On', (v) => save({ on: v })), 'Off: only a task given reminders of its own rings.'),
        setRow('When', offsets, 'Before its time; several at once.'),
        setRow('Urgent', toggle(d.urgent, 'Ring as an alarm', (v) => save({ urgent: v })), 'Full screen on the iPhone, even silent or in a Focus; an alert that stays on the Mac.'),
        setRow('Duration', duration, 'How long a task with a time takes when it does not say.'))));
  };
  const load = async () => {
    try { d = await loadReminderDefaults(true); } catch (e) { el.replaceChildren(h('p', { class: 'muted small' }, e.message)); return; }
    render();
  };
  return { el, load };
}

// ── Agents → Scheduled runs: every agent's schedules (agentschedules.js), read apart from the save above ──
function schedulesPanel() {
  const el = h('div', { class: 'agents-sched-all' }, loadingLine('Reading…'));
  let stamp = 0;
  const load = async () => {
    const mine = ++stamp;
    let items;
    try { items = (await api.agentSchedules()).schedules || []; } catch (e) { el.replaceChildren(h('p', { class: 'muted small' }, e.message)); return; }
    if (mine !== stamp) return;
    el.replaceChildren(items.length
      ? scheduleList(items, { showAgent: true, changed: load, openAgent: (x) => { location.hash = agentHref(x.dir, x.cmd); } })
      : emptyLine('None yet.'));
  };
  return { el, load };
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
      return h('tr', { class: 'tag-edit' }, h('td', { colspan: cols }, formActions({ cls: 'tag-edit-row', small: true,
        lead: h('span', { class: 'small' }, `Delete ${r.name}? It cannot be undone.`),
        onCancel: () => { confirming = null; render(); },
        actions: h('button', { class: 'btn small danger', onclick: () => run(async () => { confirming = null; await api.deleteExport(r.name); await load(); }) }, icon('trash', 13), 'Delete') })));
    }
    return h('tr', { class: 'export-row hover-host' },
      h('td', { title: r.name }, String(r.created_at || '').replace('T', ' ').slice(0, 16) || '—'),
      r.kind === 'vault' ? h('td', { title: [r.vault_id, r.structure, r.vault_root].filter(Boolean).join(' · ') || null },
        r.vault_id ? vaultName(r.vault_id) : h('span', { class: 'muted' }, '—')) : null,
      h('td', {}, r.host || '—'),
      h('td', { title: (r.changes || []).join('\n') || null },
        h('span', { class: 'mono' }, `${r.branch || '?'}@${r.sha || '?'}`), r.dirty ? h('span', { class: 'chip warn' }, 'uncommitted') : null),
      h('td', { class: 'c-note', title: r.note || null }, r.note || h('span', { class: 'muted' }, '—')),
      h('td', { class: 'num' }, fileSize(r.size)),
      h('td', { class: 'c-actions' },
        h('a', { class: 'btn icon row-action', href: `${location.origin}/api/exports/file?name=${encodeURIComponent(r.name)}`, download: r.name, title: `Download ${r.name}`, 'aria-label': `Download ${r.name}` }, icon('down', 14)),
        h('button', { type: 'button', class: 'btn icon row-action', title: 'Show in Finder', 'aria-label': `Show ${r.name} in Finder`, onclick: () => run(() => api.revealExport(r.name)) }, icon('folder', 14)),
        h('button', { type: 'button', class: 'btn icon row-action', title: `Delete ${r.name}`, 'aria-label': `Delete ${r.name}`, onclick: () => { confirming = r.name; render(); } }, icon('trash', 14))));
  };
  const table = (list, kind) => (rows === null ? loadingLine()
    : !list.length ? emptyLine(`No ${kind} exports yet.`)
      : h('div', { class: 'table-wrap' }, h('table', { class: 'grid fixed export-grid', style: EXPORT_FIXED[kind].style, 'aria-label': `${kind} exports` },
        EXPORT_FIXED[kind].colgroup.cloneNode(true),
        h('thead', {}, h('tr', {}, ['Exported', ...(kind === 'vault' ? ['Vault'] : []), 'PC', 'Version', 'Note', 'Size'].map((c) => h('th', { scope: 'col', class: c === 'Size' ? 'num' : '' }, c)),
          h('th', { scope: 'col', class: 'c-actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', {}, list.map(row)))));

  // One section per kind: what it holds, a note and its button, then its versions, folded by default
  // (export.open.<kind> remembers it unfolded); exporting unfolds it, to show the new one.
  const sections = EXPORT_KINDS.map((k) => {
    let open = pref(`export.open.${k.kind}`, false) === true;
    const setOpen = (v) => { open = v; setPref(`export.open.${k.kind}`, v || null); render(); };
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
    const head = h('h4', { class: 'export-head' }); // Versions (a foldHead, drawn with its count by render) and the scope
    const el = h('section', { class: 'group export-kind' },
      h('header', {}, h('h3', {}, k.title)),
      h('p', { class: 'muted' }, typeof k.about === 'function' ? k.about() : k.about),
      limited,
      h('div', { class: 'export-new' }, note, btn),
      head,
      box);
    return { k, el, box, btn, limited, head, scope, setOpen, isOpen: () => open };
  });
  const render = () => {
    origin.replaceChildren(...whereText());
    sections.forEach(({ k, box, btn, limited, head, scope, setOpen, isOpen }) => {
      // The installed app whose checkout is gone exports only vaults: say why instead of failing on the button.
      const blocked = k.kind !== 'vault' && !!from?.limited;
      btn.disabled = blocked;
      limited.hidden = !blocked;
      limited.textContent = blocked ? `Not here: ${from.limited}.` : '';
      const list = (rows || []).filter((r) => (r.kind || 'system') === k.kind && (k.kind !== 'vault' || allVaults || !r.vault_id || r.vault_id === vaultId()));
      head.replaceChildren(foldHead({ open: isOpen(), title: 'Versions', count: rows === null ? null : list.length, class: 'group-toggle export-versions',
        attrs: { 'aria-controls': `export-${k.kind}-versions` }, onToggle: setOpen }), scope);
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
