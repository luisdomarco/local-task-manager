// Scheduled agent runs, the page's part (server.py tick, tm/schedules.py): the Schedule dialog of an agent's composer
// (a new schedule with the composer's arguments and choices, or one changed), and a list of schedules — an agent's in
// its side panel's Schedules tab, every one in Settings → Agents — each with its rule in words, when it fires next,
// and Run now, Pause, Edit, Delete. A scheduled run starts with nobody there: it is a run like any other (the Inbox
// tells when it ends or needs you), and its chat ends once its turn is over unless the dock has it open.
import { RUN_MODES, RUN_PLACES } from './agentsmodel.js';
import { refreshActivity } from './agentactivity.js';
import { api } from './api.js';
import { CLAUDE_EFFORTS, claudeModelOptions } from './claude.js';
import { trapFocus } from './create.js';
import { DAY_NAMES, REPEATS, fieldsOf, inLabel, nextLabel, ruleFrom, scheduleState } from './schedmodel.js';
import { state, toast } from './state.js';
import { dropdown, h, icon, select } from './ui.js';

/** The Schedule dialog. `agent`/`folder` of the agent's page; `preset` the composer's { args, mode, model, effort,
 *  where } for a new one; `existing` a schedule to change instead. `onSaved(schedule)` once the server took it. */
export function scheduleDialog({ folder, agent, preset = {}, existing = null, onSaved = () => {} }) {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  const opener = document.activeElement;
  const close = () => {
    backdrop.hidden = true; modal.className = ''; modal.replaceChildren();
    if (opener && document.contains(opener)) opener.focus();
  };
  const src = existing || preset;
  const f = fieldsOf(existing?.rule);
  const v = { mode: src.mode || 'default', model: src.model ?? (state.config.claude_model || ''), effort: src.effort ?? (state.config.claude_effort || ''),
    where: folder.git && src.where === 'worktree' ? 'worktree' : 'here' };

  const repeat = select(REPEATS, f.every, (x) => { f.every = x || 'day'; paint(); }, { class: 'small', 'aria-label': 'Repeats' });
  const at = h('input', { type: 'time', class: 'input small agents-sched-at', value: f.at, required: true, 'aria-label': 'At (this Mac\'s time)',
    oninput: () => { f.at = at.value; } });
  const hours = h('input', { type: 'number', class: 'input small agents-sched-hours', min: 1, max: 24, step: 1, value: f.hours, 'aria-label': 'Every how many hours',
    oninput: () => { f.hours = hours.value; } });
  const days = h('div', { class: 'agents-sched-days', role: 'group', 'aria-label': 'Days' }, DAY_NAMES.map((d, i) => {
    const box = h('input', { type: 'checkbox', checked: f.days.includes(i), onchange: () => {
      f.days = box.checked ? [...f.days, i] : f.days.filter((x) => x !== i);
    } });
    return h('label', { class: 'agents-sched-day' }, box, h('span', {}, d));
  }));
  const args = h('input', { type: 'text', class: 'input', value: src.args || '', placeholder: agent.argument_hint || 'No arguments',
    spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Arguments' });
  const pick = (options, value, onPick, label) => select(options, value, (x) => { onPick(x || ''); paint(); }, { class: 'small', 'aria-label': label });
  const mode = pick(RUN_MODES, v.mode, (x) => { v.mode = x || 'default'; }, 'Mode');
  const model = pick(claudeModelOptions(v.model), v.model, (x) => { v.model = x; }, 'Model');
  const effort = pick(CLAUDE_EFFORTS.map(([val, l]) => [val, val ? l : 'Default effort', 'flame']), v.effort, (x) => { v.effort = x; }, 'Effort');
  const where = folder.git ? pick(RUN_PLACES, v.where, (x) => { v.where = x || 'here'; }, 'Where') : null;

  const row = (label, control, tag = 'label') => h(tag, { class: 'field' }, h('span', {}, label), control);
  const daysRow = row('Days', days, 'div');
  const hoursRow = row('Every', h('span', { class: 'agents-sched-inline' }, hours, h('span', { class: 'muted small' }, 'hours, from the time above')));
  function paint() {
    daysRow.hidden = f.every !== 'week';
    hoursRow.hidden = f.every !== 'hours';
  }
  paint();

  const save = h('button', { class: 'btn primary', type: 'submit' }, icon('clock', 14), existing ? 'Save' : 'Schedule');
  const form = h('form', { class: 'agents-add-form agents-sched-form', onsubmit: async (e) => {
    e.preventDefault();
    if (f.every === 'week' && !f.days.length) { toast('Pick at least one day', true); return; }
    save.disabled = true;
    try {
      const out = await api.agentScheduleSave({ id: existing?.id, dir: folder.id, cmd: agent.name, args: args.value, rule: ruleFrom(f),
        mode: v.mode, model: v.model, effort: v.effort, where: v.where });
      close();
      toast(`/${agent.name} scheduled: ${out.schedule.label} — next ${nextLabel(out.schedule.next_ts)}`);
      onSaved(out.schedule);
    } catch (err) { toast(err.message, true); save.disabled = false; }
  } },
  // Two groups of rows, as Settings: when it fires, and how it runs — one choice a row, each its own width.
  h('section', { class: 'agents-sched-group' }, h('h4', {}, 'When', h('span', { class: 'agents-sched-note' }, 'this Mac\'s time')),
    h('div', { class: 'fields prop-rows' },
      row('Repeats', repeat, 'div'),
      row('At', at),
      daysRow, hoursRow)),
  h('section', { class: 'agents-sched-group' }, h('h4', {}, 'Run'),
    h('div', { class: 'fields prop-rows' },
      row('Arguments', h('span', { class: 'agents-sched-inline agents-sched-args' }, h('code', {}, `/${agent.name}`), args)),
      row('Mode', mode, 'div'),
      row('Model', model, 'div'),
      row('Effort', effort, 'div'),
      where ? row('Where', where, 'div') : null)),
  h('div', { class: 'agents-add-actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), save));
  modal.className = 'agents-modal';
  modal.setAttribute('aria-label', `Schedule /${agent.name}`);
  modal.replaceChildren(h('div', { class: 'modal-head' }, h('h2', {}, icon('clock', 18), existing ? `Schedule of /${agent.name}` : `Schedule /${agent.name}`),
    h('button', { class: 'btn icon', type: 'button', title: 'Close (Esc)', onclick: close }, icon('x', 16))), form);
  backdrop.hidden = false;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  modal.onkeydown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') trapFocus(modal, e);
  };
  at.focus();
}

/** One schedule's facts under its rule: when next (or why not), the last run, what went wrong. */
function metaOf(s, showAgent) {
  const st = scheduleState(s);
  const bits = [];
  if (showAgent) bits.push(h('span', { class: 'mono' }, `/${s.cmd}`), ' · ', s.dir_name || 'a folder no longer listed', ' · ');
  if (s.paused) bits.push('Paused');
  else if (s.next_ts) bits.push(h('span', { title: new Date(s.next_ts).toLocaleString() }, `Next ${nextLabel(s.next_ts)} (${inLabel(s.next_ts)})`));
  if (s.last_ts) bits.push(' · ', h('span', { title: new Date(s.last_ts).toLocaleString() }, `last ran ${nextLabel(s.last_ts)}`));
  if (s.args) bits.push(' · ', h('span', { class: 'mono' }, s.args));
  const notes = [];
  if (st.key === 'error') notes.push(h('span', { class: 'agents-sched-error' }, icon('alert', 12), `Could not start: ${s.error}`));
  else if (s.missed_ts && s.missed_ts > (s.last_ts || 0)) notes.push(h('span', {}, `Missed ${nextLabel(s.missed_ts)}: the Mac was off for longer than 12 h`));
  else if (s.skipped_ts && s.skipped_ts > (s.last_ts || 0)) notes.push(h('span', {}, 'Skipped one: its last run was still going'));
  return [h('span', { class: 'cs-item-meta muted' }, ...bits), ...notes.map((n) => h('span', { class: 'cs-item-meta muted' }, n))];
}

/** A list of schedules as cards (.cs-item). `showAgent`: Settings' list, every agent's. `edit(s)` opens the dialog
 *  for one (an agent's tab only); `changed()` reloads after a pause, a delete, a run. */
export function scheduleList(items, { showAgent = false, edit = null, changed = () => {}, openAgent = null } = {}) {
  const act = async (fn, done) => {
    try { await fn(); if (done) toast(done); changed(); } catch (e) { toast(e.message, true); }
  };
  const runNow = (s) => act(async () => { await api.agentScheduleRun(s.id); refreshActivity(); }, `/${s.cmd} started — it shows in the Inbox`);
  const more = (anchor, s) => dropdown(anchor, [
    { label: 'Run now', icon: 'play', title: 'One run at once; its next time stays as it is', onSelect: () => runNow(s) },
    edit ? { label: 'Edit…', icon: 'pencil', onSelect: () => edit(s) } : null,
    openAgent ? { label: 'Go to its agent', icon: 'zap', onSelect: () => openAgent(s) } : null,
    { label: s.paused ? 'Resume' : 'Pause', icon: s.paused ? 'play' : 'pause', onSelect: () => act(() => api.agentSchedulePause(s.id, !s.paused)) },
    '-',
    { label: 'Delete schedule', icon: 'trash', danger: true, title: 'The runs it made stay', onSelect: () => act(() => api.agentScheduleDelete(s.id), 'Schedule deleted') },
  ].filter(Boolean), { align: 'end' });
  return h('ul', { class: 'cs-list agents-scheds', 'aria-label': 'Schedules' }, items.map((s) => {
    const st = scheduleState(s);
    const moreBtn = h('button', { class: 'btn icon small ghost', type: 'button', title: 'More', 'aria-haspopup': 'menu', onclick: (e) => { e.stopPropagation(); more(moreBtn, s); } }, icon('more', 15));
    return h('li', { class: `cs-item surface-card agents-sched${s.paused ? ' paused' : ''}` },
      h('span', { class: `td-dot tone-${st.tone}`, title: st.label }),
      h('span', { class: 'cs-item-text' }, h('span', { class: 'cs-item-title' }, s.label), ...metaOf(s, showAgent)),
      h('span', { class: 'cs-item-actions' },
        h('button', { class: 'btn icon small ghost', type: 'button', title: 'Run now', onclick: () => runNow(s) }, icon('play', 14)), moreBtn));
  }));
}
