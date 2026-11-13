// Settings → Vaults: the vaults this app can show, as a table (name, folder, structure, item types, default), and one
// dialog to add or edit a vault, in tabs: General (its name and folder here, its structure, the default, its guide for
// agents), Item types (which of its structure's types it shows), Features (what it turns off as a whole:
// tm/vaultsettings.py FEATURES, with the types that go with each) and Default texts (in Projects, the text each type
// starts with).
//
// Where each thing is kept: the name, the folder and the default are this device's (config.json, POST /api/config);
// what the vault shows is the vault's own (.task-manager/settings.json, POST /api/vault/settings, tm/vaultsettings.py),
// so the Mac and the iPhone that open the same folder see the same vault.
import { api } from '../api.js';
import { fixedColumns } from '../datatable.js';
import { has, onPlatform } from '../features.js';
import { folderButton } from '../folderpick.js';
import { warningGroups } from '../housekeeping.js';
import { reload, saveConfig, state, toast } from '../state.js';
import { emptyLine, formActions, h, icon, loadingLine, openDialog, propRow, select, tabPanels } from '../ui.js';
import { vaultId } from '../vault.js';
import { isPhone } from '../phone.js';
import { mdBlock } from '../mdblock.js';

// Name and folder share what is left (their least here); the rest keep their widths.
const COLUMNS = fixedColumns([{ key: 'name' }, { key: 'path' }, { key: 'structure' }, { key: 'types' }, { key: 'features' }, { key: 'default' }, { key: 'actions' }],
  { name: 180, path: 200 }, { structure: 130, types: 96, features: 96, default: 88, actions: 76 });

/** What a vault of a legacy structure is told: it keeps working, and how it moves to the current one. */
export function legacyNote(structure, current) {
  return h('p', { class: 'small warn vault-legacy' }, icon('alert', 13),
    h('span', {}, `${structure} is a legacy structure: this vault keeps working, but new vaults use ${current}, which holds every kind of project. `
      + 'To move it, ask Claude to follow ', h('code', {}, 'docs/migrate-structures.md'),
      ' in this app’s folder: it writes the vault into a new folder, asks you about each project, and leaves this one as it is.'));
}

/** The check's warnings for a vault's folder, folded and grouped by kind: they never block it. null when there are none. */
function vaultWarnings(warnings) {
  const groups = warningGroups(warnings || []);
  if (!groups.length) return null;
  return h('details', { class: 'vault-warnings' },
    h('summary', {}, icon('alert', 13), `${warnings.length} warning${warnings.length === 1 ? '' : 's'} in its folder`),
    h('p', { class: 'muted small' }, 'Things in the folder the app leaves alone. None of them keeps the vault from being shown or written to.'),
    ...groups.map((g) => h('div', { class: 'vault-warning-group', 'data-kind': g.kind },
      h('h4', {}, `${g.label} (${g.findings.length})`),
      h('ul', { class: 'vault-findings' }, g.findings.map((f) => h('li', {}, h('code', {}, f.path), h('span', { class: 'muted small' }, f.detail)))))));
}

/** A vault's guide for agents (tm/agentsmd.py): AGENTS.md at its top. On or off at once, not with Save: it writes a file
 *  in the vault. `status` is GET /api/vault/status of that vault ({agents}); null while it is read. */
function agentsToggle(id, status) {
  const a = status?.agents;
  if (!a) return null;
  const box = h('input', { type: 'checkbox', checked: a.on, 'aria-label': 'Guide for agents',
    onchange: async (e) => {
      const on = e.target.checked;
      e.target.disabled = true;
      try {
        const now = await api.vaultAgents(on, id);
        if (id === vaultId()) state.vaultAgents = now;
        toast(on ? 'AGENTS.md written at the top of the vault' : 'The guide for agents is gone from the vault');
      } catch (err) {
        e.target.checked = !on;
        toast(err.message, true);
      } finally {
        e.target.disabled = false;
      }
    } });
  return propRow('Guide for agents', h('label', { class: 'vault-type' }, box, 'Keep an AGENTS.md at its top'), { tag: 'div',
    help: h('span', {}, 'With a ', h('code', {}, 'CLAUDE.md'),
      ' that points to it, if it has none: it tells any agent opened in the folder — Claude Code, Codex, Cursor — what the vault holds and how to read and write it with ',
      h('code', {}, 'tools/vault.py'), ', with or without the app open. Written from the vault’s types and projects, and again when they change; your own text in the file is kept. Saved at once.') });
}

/** A new vault's id, from its name, free among `taken` (the server checks it again): it never changes after. */
export function newVaultId(name, taken) {
  const base = (name || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'vault';
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

/** The vaults as config.json keeps them, for a save: only what POST /api/config takes. */
const plain = (v) => ({ id: v.id, name: (v.name || '').trim(), path: (v.path || '').trim(), structure: v.structure,
  folders: { ...(v.folders || {}) }, disabled_types: [...(v.disabled_types || [])] });

/** The types this page's vault has on: the page builds its sidebar, lists and pickers from them once, so a change to
 *  them loads the page again (as switching vault does). */
const typesHere = () => {
  const v = (state.config.vaults || []).find((x) => x.id === vaultId());
  return JSON.stringify([v?.disabled_types || [], v?.features_off || []]);
};

/** The dialog that adds a vault (`vault` null) or edits one. Its own Save: General goes to config.json, Item types to
 *  the vault. */
export function openVaultEditor(vault) {
  const c = state.config;
  const structures = Object.entries(c.structures || { ticketing: 'Projects' });
  const legacy = new Set(c.legacy_structures || []);
  const fresh = c.default_structure || 'ticketing';
  const labelOf = (k) => (c.structures || {})[k] || k;
  const isNew = !vault;
  const v = vault ? { ...plain(vault), missing: vault.missing } : { id: '', name: '', path: '', structure: fresh, folders: {}, disabled_types: [] };
  v.disabled_features = [...(vault?.disabled_features || [])]; // the vault's own (.task-manager/settings.json), never config.json
  const typesBefore = JSON.stringify(v.disabled_types);
  const featuresBefore = JSON.stringify(v.disabled_features);
  const FEATURES = c.vault_features || [];
  const structureBefore = v.structure; // its default texts are of the structure it is saved with
  let isDefault = isNew ? false : c.default_vault === v.id;
  let status = null; // that vault's GET /api/vault/status: its guide for agents and its folder's warnings
  let busy = false;

  const general = h('div', { class: 'vault-general' });
  const typesPane = h('div', { class: 'vault-types' });

  const name = h('input', { type: 'text', autocomplete: 'off', value: v.name, placeholder: 'Name', 'aria-label': 'Vault name',
    oninput: (e) => { v.name = e.target.value; } });
  // No autocomplete: a browser's suggestion must never fill one vault's field with another's.
  const path = h('input', { type: 'text', class: 'wide', autocomplete: 'off', spellcheck: 'false', value: v.path,
    placeholder: '/absolute/path or ~/… to an existing folder', 'aria-label': 'Folder of the vault', oninput: (e) => { v.path = e.target.value; } });
  const offered = [...structures.filter(([k]) => !legacy.has(k)),
    ...structures.filter(([k]) => legacy.has(k)).map(([k, label]) => [k, `${label} (legacy)`])];

  const drawGeneral = () => {
    // Another structure has other types: what was turned off in the old one means nothing there.
    const pick = (s) => {
      v.structure = s; v.disabled_types = [];
      if (isNew && legacy.has(s)) v.folders = { ...((c.vaults || []).find((x) => x.structure === s)?.folders || {}) };
      drawGeneral(); drawTypes(); drawTexts();
    };
    const choices = (c.structure_types || {})[v.structure] || { folders: {} };
    // Only a structure of one folder per type lets a vault move them: its own, else the structure's default.
    const movable = Object.entries(choices.folders || {});
    general.replaceChildren(...[h('div', { class: 'prop-rows' }, ...[
      propRow('Name', name, { tag: 'div', help: 'What the app calls it, on this device.' }),
      propRow('Folder', h('div', { class: 'vault-path-row' }, path, folderButton(path, { prompt: `Choose the folder of ${v.name || 'the vault'}` })),
        { tag: 'div', help: v.missing && !isNew ? h('span', {}, h('strong', {}, 'Folder not found. '), 'It was moved or deleted outside the app: give its new place, or remove the vault.')
          : 'Where it is on this device. Another device keeps its own path to the same folder.' }),
      propRow('Structure', select(offered, v.structure, pick, { 'aria-label': 'Structure' }),
        { tag: 'div', help: 'How its folders and items are laid out. A new vault starts as Projects.' }),
      !isNew && legacy.has(v.structure) ? legacyNote(labelOf(v.structure), labelOf(fresh)) : null,
      propRow('Default', h('label', { class: 'vault-type' },
        h('input', { type: 'checkbox', checked: isDefault, disabled: !isNew && c.default_vault === v.id, 'aria-label': 'Default vault',
          onchange: (e) => { isDefault = e.target.checked; } }), 'Open this one when the address names none'),
      { tag: 'div', help: !isNew && c.default_vault === v.id ? 'To change it, make another vault the default.' : null }),
      isNew || !has('agents') ? null : status ? agentsToggle(v.id, status) : propRow('Guide for agents', loadingLine(), { tag: 'div' })].filter(Boolean)),
      movable.length ? h('details', {}, h('summary', {}, 'Folders for new items'),
        h('p', { class: 'muted small' }, 'Relative to the vault. Every one must exist for the vault to match its structure.'),
        h('div', { class: 'fields' }, movable.map(([t, def]) => propRow(t, h('input', { type: 'text', value: v.folders?.[t] || def,
          oninput: (e) => { v.folders = { ...v.folders, [t]: e.target.value.trim() }; } }))))) : null,
      isNew ? null : vaultWarnings(status?.check?.warnings)].filter(Boolean)); // a null child would be the text "null"
  };

  const drawTypes = () => {
    const choices = (c.structure_types || {})[v.structure] || { types: [], required: [] };
    const off = new Set(v.disabled_types);
    // A type a feature turned off goes with it (Features): shown off, its box locked, saying which.
    const byFeature = new Map(FEATURES.filter((f) => v.disabled_features.includes(f.id)).flatMap((f) => f.types.map((t) => [t, f.label])));
    const shownOff = choices.types.filter(([t]) => off.has(t) || byFeature.has(t)).length;
    typesPane.replaceChildren(
      h('p', { class: 'muted small' }, 'A type turned off leaves the sidebar, its list, the other items’ cards and every relation picker. Its files are not touched: turn it on again and everything is back. Hours already logged on its items stay in the work log. Kept in the vault, so every device that opens it shows the same types.'),
      h('p', { class: 'small' }, `${choices.types.length - shownOff} of ${choices.types.length} on`),
      h('div', { class: 'vault-type-list' }, choices.types.map(([t, label]) => {
        const required = choices.required.includes(t);
        const feature = byFeature.get(t);
        return h('label', { class: 'vault-type', title: required ? 'Needed by this structure: it cannot be turned off' : feature ? `Off with ${feature} (Features)` : '' },
          h('input', { type: 'checkbox', checked: !off.has(t) && !feature, disabled: required || !!feature, 'data-type': t,
            onchange: (e) => {
              const now = new Set(v.disabled_types);
              if (e.target.checked) now.delete(t); else now.add(t);
              v.disabled_types = choices.types.map(([x]) => x).filter((x) => now.has(x));
              drawTypes();
              drawTexts();
              drawFeatures();
            } }), label, required ? h('span', { class: 'muted small' }, '(required)') : feature ? h('span', { class: 'muted small' }, `(with ${feature})`) : null);
      })));
  };

  // Features: what the vault turns off as a whole, each with what it hides and the types that go with it. One the
  // platform has none of (a phone: AI Agents, Canvas) is off here whatever the vault says, and is left as it is:
  // changing it on a phone would change the Mac too.
  const featuresPane = h('div', { class: 'vault-features' });
  const drawFeatures = () => {
    const types = new Map(((c.structure_types || {})[v.structure] || { types: [] }).types);
    const off = new Set(v.disabled_features);
    featuresPane.replaceChildren(
      h('p', { class: 'muted small' }, 'A feature turned off leaves every screen of this vault, with the item types that go with it. Nothing is deleted: turn it on again and everything is back. Kept in the vault, so every device that opens it shows the same.'),
      h('div', { class: 'vault-feature-list' }, FEATURES.map((f) => {
        const here = onPlatform(f.id);
        const mine = f.types.filter((t) => types.has(t));
        // Off already because Item types turned all its types off (the Activity tab goes with the Activity type)
        const byTypes = f.follows_types && mine.length > 0 && mine.every((t) => v.disabled_types.includes(t));
        // Not on this device: the box shows what the vault keeps (the Mac's), and stays as it is
        const on = !off.has(f.id) && !byTypes;
        const why = !here ? 'Not on this device' : byTypes ? 'Off: its types are off in Item types' : null;
        return h('label', { class: 'vault-feature', 'data-feature-id': f.id },
          h('input', { type: 'checkbox', checked: on, disabled: !here || byTypes, 'aria-label': f.label,
            onchange: (e) => {
              const now = new Set(v.disabled_features);
              if (e.target.checked) now.delete(f.id); else now.add(f.id);
              v.disabled_features = FEATURES.map((x) => x.id).filter((x) => now.has(x));
              drawFeatures();
              drawTypes();
              drawTexts();
            } }),
          h('span', { class: 'vault-feature-text' },
            h('span', { class: 'vault-feature-name' }, f.label, why ? h('span', { class: 'muted small' }, ` · ${why}`) : null),
            h('span', { class: 'muted small' }, `Hides ${f.hides}.`),
            mine.length ? h('span', { class: 'muted small' }, `Types: ${mine.map((t) => types.get(t)).join(', ')}`) : null));
      })));
  };

  // Default texts (a tab of its own): in Projects, the text a new item of each type starts with, kept in the vault
  // (.task-manager/templates/<type>.md) and saved as it is typed, apart from the dialog's Save. Only for a vault already
  // added whose folder is there; otherwise the tab says why it has nothing to set.
  const textsPane = h('div', { class: 'vault-texts' });
  let texts = null; // GET /api/vault/default-texts of that vault: { texts, editable, placeholders }
  let textType = null;
  const textBlock = mdBlock({ fk: 'vault-default-text', minHeight: '160px', write: async (text) => {
    const t = textType;
    const out = await api.setDefaultText(t, text, v.id);
    texts = { ...texts, texts: out.texts };
    drawPick(); // only its picker's "(empty)": the editor stays as it is, focused
    return text;
  } });
  const showText = (t) => {
    textType = t;
    textBlock.reset(texts.texts[t] || '');
    textBlock.configure({ label: 'Default text', tabbed: true, title: `${labelOf(v.structure)} · ${typeLabel(t)}`,
      emptyText: 'Empty: a new one starts with no text. Click to write one.', placeholder: 'Markdown — the sections a new one starts with' });
  };
  const typeLabel = (t) => (((c.structure_types || {})[v.structure] || { types: [] }).types.find(([x]) => x === t) || [t, t])[1];
  const pickHolder = h('div', { class: 'vault-text-type' });
  const shownTypes = () => {
    const gone = new Set(FEATURES.filter((f) => v.disabled_features.includes(f.id)).flatMap((f) => f.types));
    const off = new Set([...v.disabled_types, ...gone]);
    const order = ((c.structure_types || {})[v.structure] || { types: [] }).types.map(([t]) => t); // as the list above
    return order.filter((t) => t in texts.texts && !off.has(t));
  };
  const drawPick = () => {
    pickHolder.replaceChildren(select(shownTypes().map((t) => [t, texts.texts[t].trim() ? typeLabel(t) : `${typeLabel(t)} (empty)`]), textType, async (t) => {
      if (!t || t === textType || !(await textBlock.flush())) return;
      showText(t);
      drawPick();
      textBlock.render();
    }, { 'aria-label': 'Type of the default text', search: !isPhone() }));
  };
  let textsShown = false; // the picker and the editor are in the tab (drawn once, so an open editor keeps its focus)
  const textsNote = (text) => { textsShown = false; textsPane.replaceChildren(h('p', { class: 'muted small' }, text)); };
  const drawTexts = () => {
    if (isNew) return textsNote('Add the vault first: its default texts are kept in its folder.');
    if (v.missing) return textsNote('The vault’s folder is not found: its default texts are kept there.');
    if (v.structure !== structureBefore) return textsNote(`Save the vault as ${labelOf(v.structure)} first: its default texts are that structure’s.`);
    if (!texts) { textsPane.replaceChildren(loadingLine()); return; }
    if (!texts.editable) return textsNote(`A ${labelOf(v.structure)} vault has no default texts: a new item starts with its type’s own.`);
    const shown = shownTypes();
    if (!shown.length) return textsNote('Every type with a default text is off (Item types, Features).');
    if (!shown.includes(textType)) showText(shown[0]);
    drawPick();
    if (!textsShown) {
      textsShown = true;
      textsPane.replaceChildren(
        h('p', { class: 'muted small' }, 'What a new item of each type starts with, here and in what agents and the vault’s command line create. Empty, it starts with no text. Kept in the vault, saved as you type.'),
        pickHolder,
        textBlock.el,
        h('p', { class: 'muted small vault-placeholders' }, 'Filled in when the item is made: ',
          ...texts.placeholders.flatMap((p, i) => [i ? ' ' : null, h('code', {}, `{{${p}}}`)]).filter(Boolean)));
    }
    if (!textBlock.isEditing() || !textBlock.ready()) textBlock.render();
  };

  const save = async () => {
    if (busy) return;
    busy = true;
    saveBtn.disabled = true;
    try {
      const vaults = (c.vaults || []).map(plain);
      if (isNew) v.id = newVaultId(v.name, new Set(vaults.map((x) => x.id)));
      const mine = plain(v);
      const list = isNew ? [...vaults, mine] : vaults.map((x) => (x.id === v.id ? mine : x));
      const before = typesHere();
      await api.saveConfig({ vaults: list, default_vault: isDefault ? v.id : c.default_vault });
      const changes = {};
      if (JSON.stringify(v.disabled_types) !== typesBefore || (isNew && v.disabled_types.length)) changes.disabled_types = v.disabled_types;
      if (JSON.stringify(v.disabled_features) !== featuresBefore || (isNew && v.disabled_features.length)) changes.disabled_features = v.disabled_features;
      if (Object.keys(changes).length) await api.saveVaultSettings(changes, v.id);
      close(true);
      await reload(); // the page reads the config again
      if (typesHere() !== before) { location.reload(); return; }
      toast(isNew ? `${v.name.trim()} added` : 'Vault saved');
    } catch (e) {
      if (isNew) v.id = '';
      toast(e.message, true);
    } finally {
      busy = false;
      saveBtn.disabled = false;
    }
  };

  const saveBtn = h('button', { type: 'button', class: 'btn primary', onclick: save }, isNew ? 'Add vault' : 'Save');
  drawGeneral();
  drawTypes();
  drawFeatures();
  drawTexts();
  const tabs = tabPanels([
    { key: 'general', label: 'General', content: general },
    { key: 'types', label: 'Item types', content: typesPane },
    { key: 'features', label: 'Features', content: featuresPane },
    { key: 'texts', label: 'Default texts', content: textsPane },
  ], 'general');
  const { close } = openDialog({
    title: isNew ? 'New vault' : v.name || 'Vault', ico: 'folder', cls: 'vault-modal', label: isNew ? 'New vault' : `Vault ${v.name}`,
    body: h('div', { class: 'vault-tabs' }, ...tabs),
    foot: formActions({ lead: h('span', { class: 'muted small kbd-hint' }, '⌘↵ saves · Esc cancels'), onCancel: () => close(), actions: saveBtn }),
    focus: isNew ? name : null,
    dismissable: () => !busy,
    onClose: () => { textBlock.flush().finally(() => textBlock.reset()); }, // what is being typed is saved, then let go
    onKey: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } },
  });
  if (!isNew && !v.missing) {
    api.defaultTexts(v.id).then((r) => { texts = r; drawTexts(); })
      .catch(() => { texts = { editable: false, texts: {} }; drawTexts(); }); // not its structure's: nothing to set
  }
  if (!isNew) {
    api.vaultStatusOf(v.id).then((s) => { status = s; drawGeneral(); })
      .catch(() => { status = {}; drawGeneral(); }); // a folder gone or not its structure's: no guide to offer
  }
}

/** The Vaults tab: the table, and New vault. `confirming` is the vault whose removal asks first. */
export function vaultsSection() {
  let confirming = null;
  const box = h('div', { class: 'vaults-table' });
  const remove = async (id) => {
    const c = state.config;
    const rest = (c.vaults || []).filter((x) => x.id !== id).map(plain);
    confirming = null;
    try {
      await saveConfig({ vaults: rest, default_vault: c.default_vault === id ? rest[0].id : c.default_vault });
      toast('Vault taken out of the list. Its files are as they were.');
    } catch { /* mutate said why */ }
  };
  const draw = () => {
    const c = state.config;
    const list = c.vaults || [];
    const labelOf = (k) => (c.structures || {})[k] || k;
    const legacy = new Set(c.legacy_structures || []);
    const row = (v) => {
      if (confirming === v.id) {
        return h('tr', { class: 'tag-edit' }, h('td', { colspan: 7 }, formActions({ cls: 'tag-edit-row', small: true,
          lead: h('span', { class: 'small' }, `Take ${v.name} out of the list? Its files are not touched.`),
          onCancel: () => { confirming = null; draw(); },
          actions: h('button', { class: 'btn small danger', onclick: () => remove(v.id) }, 'Remove') })));
      }
      const choices = (c.structure_types || {})[v.structure] || { types: [] };
      const total = choices.types.length;
      // A type is off by Item types or with a feature turned off (Features)
      const gone = new Set([...(v.disabled_types || []), ...(c.vault_features || []).filter((f) => (v.disabled_features || []).includes(f.id)).flatMap((f) => f.types)]);
      const on = total - choices.types.filter(([x]) => gone.has(x)).length;
      const features = (c.vault_features || []).length;
      const featuresOn = features - (v.features_off || []).length;
      const edit = () => openVaultEditor(v);
      // A click anywhere on the row edits it, as a list's row opens its item; its own buttons do their own thing, and a
      // drag that selected text (a folder's path, to copy) is not a click. The name is the row's keyboard way in.
      const rowClick = (e) => {
        if (e.target.closest('button, a, input, select, textarea') || String(window.getSelection?.() || '')) return;
        edit();
      };
      return h('tr', { class: 'vault-tr hover-host', 'data-vault': v.id, onclick: rowClick },
        h('td', { class: 'c-name' }, h('div', { class: 'c-name' }, h('button', { type: 'button', class: 'link vault-open', onclick: edit, title: `Edit ${v.name}` }, v.name),
          v.id === vaultId() ? h('span', { class: 'chip vault-here', title: 'The vault this page shows' }, 'This page') : null,
          // On a phone the Default column is gone (phone.css): the chip goes by the name, as This page does
          c.default_vault === v.id ? h('span', { class: 'chip vault-default', title: 'The vault the app opens with' }, 'Default') : null)),
        h('td', { class: 'c-path', title: v.path }, h('div', { class: 'c-path' }, h('code', {}, v.path),
          v.missing ? h('span', { class: 'chip warn', title: 'Moved or deleted outside the app: edit it to give its new place, or remove it' }, 'Folder not found') : null)),
        h('td', { class: 'c-structure' }, labelOf(v.structure), legacy.has(v.structure) ? h('span', { class: 'muted small' }, ' (legacy)') : null),
        h('td', { class: 'num c-types' }, total ? `${on} of ${total}` : h('span', { class: 'muted' }, '—')),
        h('td', { class: 'num c-features' }, features ? `${featuresOn} of ${features}` : h('span', { class: 'muted' }, '—')),
        h('td', { class: 'c-default' }, c.default_vault === v.id ? h('span', { class: 'chip' }, 'Default') : h('span', { class: 'blank' })),
        h('td', { class: 'c-actions' },
          h('button', { type: 'button', class: 'btn icon row-action', title: `Edit ${v.name}`, 'aria-label': `Edit ${v.name}`, onclick: edit }, icon('pencil', 14)),
          h('button', { type: 'button', class: 'btn icon row-action', title: list.length < 2 ? 'The only vault: it cannot be removed' : `Remove ${v.name} from the list`,
            'aria-label': `Remove ${v.name}`, disabled: list.length < 2, onclick: () => { confirming = v.id; draw(); } }, icon('x', 14))));
    };
    box.replaceChildren(list.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid fixed vault-grid', style: isPhone() ? null : COLUMNS.style, 'aria-label': 'Vaults' },
        COLUMNS.colgroup.cloneNode(true),
        h('thead', {}, h('tr', {}, ['Name', 'Folder', 'Structure', 'Item types', 'Features', 'Default'].map((t) => h('th', { scope: 'col', class: ['Item types', 'Features'].includes(t) ? 'num' : '' }, t)),
          h('th', { scope: 'col', class: 'c-actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', {}, list.map(row))))
      : emptyLine('No vaults yet.'));
  };
  draw();
  return h('section', { class: 'group' },
    h('header', {}, h('h3', {}, 'Vaults'), h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => openVaultEditor(null) }, icon('plus', 13), 'New vault')),
    h('p', { class: 'muted' }, 'The folders this app can show, each on its own: switch between them at the foot of the sidebar. A vault is shown only while its folder matches its structure; until then nothing is read from it or written to it. Taking a vault out of the list leaves its files as they are.'),
    box);
}
