// Settings → Item type status (TSK-037): each type's statuses, in the three fixed groups — Not started, In progress,
// Closed — with their colour. Open is the first two groups, closed the last: every list, the Board and the counts
// read it from here. Saved per vault, in <vault>/.task-manager/statuses.json (tm/store.py save_status_config).
//
// A status renamed takes its items with it. One removed while items have it opens a dialog that asks where they go, and
// confirming it saves there and then (statusremap.js picks the targets); one no item has waits for Save. Ticketing
// fixes its statuses' names and order (they are its file format: "5. Review"), so there only colours change, and a
// status moves between Not started and In progress.
import { api } from '../api.js';
import { trapFocus } from '../create.js';
import { toast } from '../state.js';
import { defaultTarget, remapTargets } from '../statusremap.js';
import { h, icon, select, statusChip, statusColor } from '../ui.js';

const blank = () => ({ name: '', group: 'in_progress', from: null, count: 0, removed: false, to: null });

export function statusPanel() {
  const el = h('div', { class: 'stack status-settings' });
  let cfg = null; // what the server has: { types, colors, groups, locked, structure, error, saved }
  let work = null; // the copy being edited: { type: [row] }, row = { name, group, from, count, removed, to }
  let colors = {};
  let busy = false;

  const load = async () => {
    try { cfg = await api.statuses(); } catch (e) { el.replaceChildren(h('p', { class: 'muted' }, e.message)); return; }
    work = Object.fromEntries(cfg.types.map((t) => [t.type, t.statuses.map((s) => ({ ...s, from: s.name, removed: false, to: null }))]));
    colors = { ...cfg.colors };
    render();
  };

  const groupLabel = (g) => (cfg.groups.find(([k]) => k === g) || [g, g])[1];
  // What a type's statuses will be once saved: the ones not removed, named as typed.
  const kept = (type) => work[type].filter((r) => !r.removed && r.name.trim());

  function rowEl(type, r, rows) {
    const locked = cfg.locked;
    const inGroup = rows.filter((x) => x.group === r.group);
    const at = inGroup.indexOf(r);
    const move = (d) => {
      const other = inGroup[at + d];
      if (!other) return;
      const i = rows.indexOf(r); const j = rows.indexOf(other);
      [rows[i], rows[j]] = [rows[j], rows[i]];
      render();
    };
    const color = h('input', {
      type: 'color', value: statusColor(r.name, r.group, colors), title: 'Its colour (one per status name, in every type)',
      'aria-label': `Colour of ${r.name || 'the new status'}`,
      oninput: (e) => { if (r.name.trim()) colors[r.name.trim()] = e.target.value; },
      onchange: () => render(),
    });
    const name = h('input', {
      type: 'text', value: r.name, maxlength: '40', disabled: locked || r.removed, placeholder: 'Status name',
      'aria-label': 'Status name', title: locked ? `Fixed by the ${cfg.structure} format` : r.from && r.from !== r.name ? `Renamed from ${r.from}: its items follow` : '',
      oninput: (e) => { r.name = e.target.value; },
      onchange: () => {
        // A renamed status keeps the colour it showed in (a new name would get another from the palette).
        const was = r.from || '';
        const now = r.name.trim();
        if (was && now && now !== was && !colors[now]) colors[now] = statusColor(was, r.group, colors);
        render();
      },
    });
    // In a locked structure a status may only move between the two open groups; its closed ones stay closed.
    const groups = cfg.groups.filter(([g]) => !locked || (r.group === 'closed' ? g === 'closed' : g !== 'closed'));
    const group = select(groups.map(([g, l]) => [g, l]), r.group, (v) => { r.group = v; render(); },
      { class: 'small', 'aria-label': `Group of ${r.name}`, disabled: locked && r.group === 'closed' });
    const count = r.count ? h('span', { class: 'count', title: `${r.count} item${r.count > 1 ? 's' : ''} have it` }, String(r.count)) : null;
    if (r.removed) {
      // Removed while no item has it (one with items goes through the dialog, and is saved there): gone on Save.
      return h('div', { class: 'status-row removed' },
        h('span', { class: 'status-name' }, statusChip(r.from || r.name)),
        h('span', { class: 'small muted' }, 'removed'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn icon', title: 'Keep it', onclick: () => { r.removed = false; r.to = null; render(); } }, icon('back', 14)));
    }
    return h('div', { class: 'status-row' },
      color, name, count,
      h('span', { class: 'spacer' }),
      locked ? null : h('button', { class: 'btn icon', title: 'Up', disabled: at === 0, onclick: () => move(-1) }, icon('up', 14)),
      locked ? null : h('button', { class: 'btn icon', title: 'Down', disabled: at === inGroup.length - 1, onclick: () => move(1) }, icon('down', 14)),
      group,
      locked ? null : h('button', {
        class: 'btn icon', title: 'Remove it',
        onclick: () => {
          if (r.from && r.count) { openRemapModal(type, r, rows); return; }
          if (r.from) r.removed = true; else rows.splice(rows.indexOf(r), 1);
          render();
        },
      }, icon('trash', 14)));
  }

  function typeEl(t) {
    const rows = work[t.type];
    return h('section', { class: 'group status-type' },
      h('header', {}, h('h3', {}, t.label)),
      t.unknown.length ? h('p', { class: 'small warn' }, `Items with statuses this type does not have: ${t.unknown.map((u) => `${u.name} (${u.count})`).join(', ')}. Add them here, or change those items.`) : null,
      ...cfg.groups.map(([g, label]) => h('div', { class: `status-group g-${g}` },
        h('h4', {}, label),
        ...rows.filter((r) => r.group === g).map((r) => rowEl(t.type, r, rows)),
        cfg.locked ? null : h('button', {
          class: 'btn small ghost', onclick: () => { rows.push({ ...blank(), group: g }); render(); },
        }, icon('plus', 13), `Add a status to ${label}`))));
  }

  // → true once saved (the page then reloads), false when it was not.
  async function save() {
    if (busy) return false;
    const types = {}; const remap = {};
    for (const [type, rows] of Object.entries(work)) {
      types[type] = kept(type).map((r) => ({ name: r.name.trim(), group: r.group }));
      const moves = {};
      for (const r of rows) {
        if (r.removed && r.count && r.to) moves[r.from] = r.to;
        if (!r.removed && r.from && r.name.trim() && r.name.trim() !== r.from) moves[r.from] = r.name.trim();
      }
      if (Object.keys(moves).length) remap[type] = moves;
    }
    const stuck = Object.entries(work).flatMap(([, rows]) => rows.filter((r) => r.removed && r.count && !r.to).map((r) => r.from));
    if (stuck.length) { toast(`Say where the items of ${stuck.join(', ')} go first`, true); return false; }
    const names = new Set(Object.values(types).flatMap((rows) => rows.map((r) => r.name)));
    const keepColors = Object.fromEntries(Object.entries(colors).filter(([n]) => names.has(n)));
    busy = true;
    try {
      const out = await api.saveStatuses(types, keepColors, remap);
      toast(`Statuses saved${out.moved ? ` · ${out.moved} item${out.moved > 1 ? 's' : ''} moved` : ''}`);
      // Every view reads the statuses from the structure: the page loads it afresh, here.
      setTimeout(() => location.reload(), 600);
      return true;
    } catch (e) {
      toast(e.message, true);
      return false;
    } finally { busy = false; }
  }

  // Anything in the draft other than removing `except` that differs from what the server has: the dialog saves it too.
  function pendingBesides(except) {
    const key = (name, group) => `${name}|${group}`;
    const typeChanged = ({ type, statuses }) => {
      const rows = work[type];
      const now = rows.filter((r) => r !== except && !r.removed).map((r) => key(r.name.trim(), r.group));
      const was = statuses.filter((s) => !(rows.includes(except) && s.name === except.from)).map((s) => key(s.name, s.group));
      return now.join() !== was.join() || rows.some((r) => r !== except && r.removed);
    };
    return cfg.types.some(typeChanged) || Object.entries(colors).some(([n, c]) => cfg.colors[n] !== c);
  }

  // Removing a status items have: where they go, then saved at once.
  function openRemapModal(type, r, rows) {
    const opener = document.activeElement;
    const backdrop = document.getElementById('modal-backdrop');
    const modal = document.getElementById('modal');
    const close = () => {
      backdrop.hidden = true; modal.className = ''; modal.replaceChildren();
      if (opener && document.contains(opener)) opener.focus();
    };
    const label = cfg.types.find((t) => t.type === type).label;
    const targets = remapTargets(rows, r);
    const n = `${r.count} item${r.count > 1 ? 's' : ''}`;
    let to = defaultTarget(targets, r, rows);
    let saving = false;
    const go = h('button', { class: 'btn danger', disabled: !to, onclick: () => confirm() }, icon('trash', 15), `Delete and move ${n}`);
    const pick = select([[null, 'Pick a status…'], ...targets.map((x) => [x.name, `${groupLabel(x.group)} · ${x.name}`])], to,
      (v) => { to = v; go.disabled = !to; }, { 'aria-label': `Where the ${n} of ${r.from} go` });
    const confirm = async () => {
      if (!to || saving) return;
      saving = true; go.disabled = true;
      r.removed = true; r.to = to;
      if (await save()) { close(); return; }
      r.removed = false; r.to = null; // not saved (toasted): the status stays, the dialog too
      saving = false; go.disabled = false;
    };
    modal.className = 'tag-modal remap-modal';
    modal.setAttribute('aria-label', `Delete status ${r.from}`);
    modal.replaceChildren(...[
      h('div', { class: 'modal-head' }, h('h2', {}, icon('trash', 18), 'Delete status ', statusChip(r.from)),
        h('button', { class: 'btn icon', title: 'Close (Esc)', onclick: close }, icon('x', 16))),
      h('p', {}, `${n} of ${label} ${r.count > 1 ? 'have it. Where do they go?' : 'has it. Where does it go?'}`),
      h('label', { class: 'field' }, h('span', {}, 'Move them to'), pick),
      targets.length ? null : h('p', { class: 'small warn' }, `${label} keeps no other status: add one first.`),
      pendingBesides(r) ? h('p', { class: 'small muted' }, 'Your other unsaved changes here are saved with it.') : null,
      h('div', { class: 'modal-foot' }, h('span', { class: 'muted small' }, 'Esc cancels'), h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost', onclick: close }, 'Cancel'), go)].filter(Boolean));
    backdrop.hidden = false;
    backdrop.onmousedown = (e) => { if (e.target === backdrop && !saving) close(); };
    modal.onkeydown = (e) => {
      if (e.key === 'Escape' && !saving) { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'Tab') trapFocus(modal, e);
    };
    // With a status already picked, ↵ on the focused button confirms; without one, the choice comes first.
    setTimeout(() => (to ? go : pick).focus(), 0);
  }

  function render() {
    if (!cfg) { el.replaceChildren(h('p', { class: 'muted' }, 'Loading…')); return; }
    el.replaceChildren(...[
      h('p', { class: 'muted' }, 'Each type\'s statuses, in three fixed groups. ',
        h('strong', {}, 'Open'), ' is Not started and In progress; ', h('strong', {}, 'Closed'), ' is the last group: lists, the Board, Today, Week and the counts read them from here. A new item starts in the first status; closing one sets the first Closed status, reopening it the last Not started one. Colours are per status name. ',
        cfg.locked ? `${cfg.structure} fixes the statuses' names and order (they are its file format): here you change their colour, and move them between Not started and In progress.` : 'Renaming a status takes its items with it.'),
      cfg.error ? h('p', { class: 'small warn' }, cfg.error) : null,
      ...cfg.types.map(typeEl),
      h('div', { class: 'row save-bar' },
        h('button', { class: 'btn ghost', onclick: () => load() }, 'Discard changes'),
        h('button', { class: 'btn primary', onclick: save }, icon('check', 14), 'Save statuses'))].filter(Boolean));
  }

  render();
  return { el, load };
}
