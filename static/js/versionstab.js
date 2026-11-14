// A definition's Versions (an architecture's, an entity's: tm/versions.py): the side panel's tab, the header's
// `v1.2 · edited` chip, and the dialogs that cut a version, show one and compare it with now, and restore it.
import { api } from './api.js';
import { relDay } from './dates.js';
import { diffBlock } from './diffview.js';
import { refOf } from './shownid.js';
import { cutVersion, restoreVersion, toast } from './state.js';
import { TYPE_DEFS } from './rules.js';
import { parseUnifiedDiff } from './udiff.js';
import { emptyLine, formActions, h, icon, loadingLine, openDialog, propRow, rowAction, rowItem, rowList, secondaryButton, seg, stackGroup } from './ui.js';
import { bumpVersion, nextBase, versionText } from './versionmodel.js';

/** Whether a type is versioned: it has a `version` field (read only, cut from this tab). */
export const hasVersions = (type) => (TYPE_DEFS[type]?.props || []).some((p) => p.key === 'version');

// item key → { rev, info }: its versions (GET /api/item/versions), asked once per rev of its file.
const infos = new Map();

/** Its versions as last asked (null until the first answer), asked again when its file changed; `rerender` redraws. */
function infoOf(item, rerender) {
  const had = infos.get(item.key);
  if (item.id && (!had || had.rev !== item.rev)) {
    infos.set(item.key, { rev: item.rev, info: had?.info || null });
    api.itemVersions(item.key).then((info) => {
      const before = JSON.stringify(infos.get(item.key)?.info);
      infos.set(item.key, { rev: item.rev, info });
      if (rerender && JSON.stringify(info) !== before) rerender();
    }, () => {});
  }
  return infos.get(item.key)?.info || null;
}

const when = (stamp) => {
  const [d, t] = String(stamp || '').split('T');
  return d ? `${relDay(d)}${t ? ` · ${t.slice(0, 5)}` : ''}` : '';
};

/** The header's chip: `v1.2`, and `v1.2 · edited` (amber) when it changed after its last version. */
export function versionChip(item, rerender) {
  if (!hasVersions(item.type)) return null;
  const info = infoOf(item, rerender) || { version: item.fields.version, edited: false };
  const text = versionText(info);
  if (!text) return null;
  return h('span', { class: `chip mono${info.edited ? ' warn' : ''}`, title: info.edited
    ? 'Changed since its last version: cut one from its Versions tab so the change has a name' : 'Its current version' }, text);
}

/** The side panel's Versions tab: the current one and *New version*, then every version, newest first. */
export function versionsTab(item, rerender) {
  if (!hasVersions(item.type) || !item.id) return null;
  const info = infoOf(item, rerender);
  const list = info?.versions || [];
  const head = h('div', { class: 'versions-head' },
    h('span', { class: 'versions-now' }, info ? versionText(info) || 'No version yet' : ''),
    secondaryButton('New version', { ico: 'branch', onclick: () => newVersion(item, info) }));
  const rows = list.map((v, i) => rowItem({
    text: [h('span', { class: 'mono' }, `v${v.version}`), v.note ? ` · ${v.note}` : ''],
    meta: [when(v.at), v.by && v.by !== 'owner' ? ` · ${v.by}` : ''].join(''),
    onClick: () => showVersion(item, v, { compare: false }),
    tip: 'Open it as it was',
    actions: [
      rowAction('columns', i === 0 && !info.edited ? 'Compare with now (nothing changed since)' : 'Compare with now', () => showVersion(item, v, { compare: true })),
      rowAction('restore', `Restore v${v.version}`, () => restore(item, v)),
    ],
  }));
  const body = !info ? loadingLine('Loading versions…')
    : rows.length ? rowList(rows)
      : emptyLine('No version kept yet: New version names what it is now.');
  return { key: 'versions', label: 'Versions', count: list.length || null,
    content: [h('div', { class: 'versions-tab' }, head, stackGroup(null, body))] };
}

/** *New version*: minor or major (it changes a contract), and one line, what changed. */
function newVersion(item, info) {
  const base = nextBase(info) || item.fields.version;
  let major = false;
  const note = h('input', { type: 'text', placeholder: 'What changed', 'aria-label': 'What changed', maxlength: 200 });
  const pickHost = h('div', {});
  const drawPick = () => pickHost.replaceChildren(seg([
    [false, `Minor · v${bumpVersion(base)}`, { tip: 'Anything that keeps its contracts' }],
    [true, `Major · v${bumpVersion(base, true)}`, { tip: 'It changes a contract: what goes in or out across a boundary' }],
  ], major, (v) => { major = v; drawPick(); }, { aria: 'Kind of version', role: 'radiogroup', small: false }));
  drawPick();
  const cut = h('button', { type: 'button', class: 'btn primary', onclick: () => go() }, 'Cut version');
  let close;
  const go = async () => {
    cut.disabled = true;
    try {
      const out = await cutVersion(item.key, major, note.value.trim());
      close(true);
      toast(`${refOf(item)} is now v${out.version}`);
    } catch { cut.disabled = false; } // toasted by state
  };
  const form = h('div', { class: 'versions-form' },
    h('div', { class: 'fields prop-rows' }, propRow('Version', pickHost, { tag: 'div' }), propRow('What changed', note)),
    h('p', { class: 'muted small' }, 'The item as it is now is kept as this version. Later edits show as “edited” until the next one.'),
    formActions({ onCancel: () => close(), actions: cut }));
  ({ close } = openDialog({ title: `New version of ${refOf(item)}`, ico: 'branch', cls: 'versions-modal', body: form, focus: note,
    onKey: (e) => { if (e.key === 'Enter' && !e.isComposing && e.target === note) { e.preventDefault(); go(); } } }));
}

/** One version, read only: its file as it was, or (Compare) a line diff from it to the file now; Restore from here. */
function showVersion(item, v, { compare }) {
  let mode = compare ? 'compare' : 'view';
  let data = null;
  const view = h('div', { class: 'versions-view' }, loadingLine());
  const draw = () => {
    if (!data) return;
    if (mode === 'view') view.replaceChildren(h('pre', { class: 'versions-text mono' }, data.text));
    else {
      const d = parseUnifiedDiff(data.diff);
      view.replaceChildren(d.lines.length
        ? h('div', {}, h('p', { class: 'muted small' }, `${d.del} line${d.del === 1 ? '' : 's'} removed · ${d.add} added since v${v.version}`), diffBlock(d))
        : emptyLine(`Nothing changed since v${v.version}.`));
    }
  };
  const pickHost = h('div', {});
  const drawPick = () => pickHost.replaceChildren(seg([['view', 'As it was', { ico: 'eye' }], ['compare', 'Compare with now', { ico: 'columns' }]],
    mode, (m) => { mode = m; drawPick(); draw(); }, { aria: 'Show', role: 'tablist' }));
  drawPick();
  let close;
  const restoreBtn = h('button', { type: 'button', class: 'btn', onclick: async () => { if (await restore(item, v)) close(); } }, icon('restore', 14), `Restore v${v.version}`);
  ({ close } = openDialog({
    title: `${refOf(item)} · v${v.version}`, ico: 'branch', cls: 'versions-modal wide', head: [pickHost],
    body: h('div', { class: 'versions-form' },
      h('p', { class: 'muted small' }, [when(v.at), v.note || null].filter(Boolean).join(' · ')), view,
      formActions({ onCancel: () => close(), cancelLabel: 'Close', actions: restoreBtn })),
  }));
  api.itemVersion(item.key, v.version).then((out) => { data = out; draw(); },
    (e) => view.replaceChildren(emptyLine(e.message)));
}

/** Put it back as it was at `v`: nothing is lost (what it is now stays the version before, if one was cut; the restore
 *  itself is a new version). → whether it was restored. */
async function restore(item, v) {
  try {
    const out = await restoreVersion(item.key, v.version, item.rev);
    toast(`Restored v${v.version} as v${out.version}`);
    return true;
  } catch { return false; } // toasted by state (a 409: it changed on disk, reopen it first)
}
