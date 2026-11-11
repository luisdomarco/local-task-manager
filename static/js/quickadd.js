// Quick add, Todoist-style: one line, tokens become fields.
//   /note /meeting /initiative   type (default: task)
//   #INI-0003                    related_to
//   !1 … !4 | !urgent !high !normal !low   priority, by rank: Urgent…Low (Initiatives), P0…P3 (Projects)
//   https://… | www.…            main url (a second one goes to links)
//   @today @week @nextweek @month @mon…@sun   plan (a weekday: its next date)
//   due:2026-10-20 | due:today | due:tomorrow | due:fri
//   +label                       label
//   session:name                 session_name (the Claude session handling it)
import { addDays, isoWeek, monthLabel, nextDow, relDay, shiftWeek, thisMonth, thisWeek, today } from './dates.js';
import { PARENT_TYPES, PLANNABLE, PRIORITIES, TYPE_DEFS, onStructure } from './rules.js';
import { createItem, state, toast } from './state.js';
import { h, icon, keyboardShy, labelChip, openDialog, priorityChip } from './ui.js';
import { withMic } from './dictation.js';
import { isPhone, isTouch } from './phone.js';
import { refOf } from './shownid.js';

// '/task' → 'task': each type of the vault's structure brings its own tokens (none for a type that has none).
let TYPE_TOKENS = {};
onStructure((s) => { TYPE_TOKENS = Object.fromEntries(s.types.flatMap((t) => t.tokens.map((tok) => [tok, t.name]))); });

function resolveDay(word) {
  if (word === 'today') return today();
  if (word === 'tomorrow') return addDays(today(), 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(word)) return word;
  return nextDow(word);
}

export function parseQuick(text, defaults = {}) {
  const out = { type: defaults.type || 'task', values: {}, errors: [] };
  const words = [];
  for (const w of text.trim().split(/\s+/)) {
    const lw = w.toLowerCase();
    let m;
    if (TYPE_TOKENS[lw]) out.type = TYPE_TOKENS[lw];
    else if ((m = w.match(/^#([A-Za-z]+-\d+)$/))) out.values.related_to = m[1].toUpperCase();
    else if ((m = w.match(/^!([1-4])$/))) out.values.priority = PRIORITIES[m[1] - 1];
    else if ((m = lw.match(/^!(urgent|high|normal|low)$/))) out.values.priority = PRIORITIES[['urgent', 'high', 'normal', 'low'].indexOf(m[1])];
    else if (/^(https?:\/\/|www\.)\S+$/i.test(w)) {
      const url = /^www\./i.test(w) ? `https://${w}` : w;
      if (!out.values.url) out.values.url = url;
      else (out.values.links ||= []).push({ url });
    }
    else if (lw === '@week') { out.values.plan_week = thisWeek(); out.values.plan_day = null; }
    else if (lw === '@nextweek') { out.values.plan_week = shiftWeek(thisWeek(), 1); out.values.plan_day = null; }
    else if (lw === '@month') { out.values.plan_month = thisMonth(); out.values.plan_week = null; out.values.plan_day = null; }
    else if ((m = lw.match(/^@(\w[\w-]*)$/)) && m[1] !== 'tomorrow' && resolveDay(m[1])) { // no Tomorrow to plan for
      out.values.plan_day = resolveDay(m[1]);
      out.values.plan_week = isoWeek(out.values.plan_day);
    } else if ((m = lw.match(/^due:(\S+)$/)) && resolveDay(m[1])) out.values.due = resolveDay(m[1]);
    else if ((m = w.match(/^\+([\w-]+)$/))) (out.values.labels ||= []).push(m[1]);
    else if ((m = w.match(/^session:(\S+)$/i))) out.values.session_name = m[1];
    else words.push(w);
  }
  out.title = words.join(' ');
  out.values = { ...defaults.values, ...out.values };
  if (!PLANNABLE.has(out.type)) {
    for (const k of ['plan_day', 'plan_week', 'plan_month', 'priority', 'due', 'status', 'list', 'today_list']) delete out.values[k];
  }
  const parent = out.values.related_to && state.byId.get(out.values.related_to);
  if (out.values.related_to && !parent) out.errors.push(`${out.values.related_to} not found`);
  else if (parent && !PARENT_TYPES[out.type].includes(parent.type)) out.errors.push(`a ${out.type} can't hang from a ${parent.type}`);
  return out;
}

function preview(p) {
  const v = p.values;
  const parts = [h('span', { class: `chip t-${p.type}` }, TYPE_DEFS[p.type]?.label || p.type)];
  if (v.related_to) parts.push(h('span', { class: 'chip parent' }, state.byId.get(v.related_to)?.title || v.related_to));
  if (v.priority) parts.push(priorityChip(v.priority));
  if (v.url) parts.push(h('span', { class: 'chip link' }, icon('link', 12), v.url));
  for (const l of v.links || []) parts.push(h('span', { class: 'chip' }, `+ ${l.url}`));
  if (v.plan_day) parts.push(h('span', { class: 'chip plan today' }, icon('sun', 12), relDay(v.plan_day)));
  else if (v.plan_week) parts.push(h('span', { class: 'chip plan week' }, icon('calendar', 12), v.plan_week));
  else if (v.plan_month) parts.push(h('span', { class: 'chip plan week' }, icon('calendar', 12), monthLabel(v.plan_month, true)));
  if (v.due) parts.push(h('span', { class: 'chip due' }, icon('flag', 12), relDay(v.due)));
  for (const l of v.labels || []) parts.push(labelChip(l));
  if (v.session_name) parts.push(h('span', { class: 'chip session' }, icon('terminal', 12), v.session_name));
  for (const e of p.errors) parts.push(h('span', { class: 'chip late' }, e));
  return parts;
}

/** Input + live preview. `defaults` = { type, values } applied under the tokens. `mic: false` inside an item, where
 *  only the description dictates. */
export function quickAddBar(defaults = {}, { placeholder, autofocus = false, onCreated, mic = true } = {}) {
  const prev = h('div', { class: 'chips qa-preview' });
  const phone = isPhone();
  const hint = placeholder || 'Add a task…  #INI-0001  !high  @today  due:fri  +label  https://…  /note';
  const input = h('input', {
    class: 'qa-input', type: 'text', autocomplete: 'off',
    // A phone's box is narrow: what to type, not the tokens after it (they still work); its keyboard says Done.
    placeholder: phone ? hint.split('  ')[0] : hint, enterkeyhint: phone ? 'done' : null,
  });
  const refresh = () => {
    prev.replaceChildren(...(input.value.trim() ? preview(parseQuick(input.value, defaults)) : []));
  };
  input.addEventListener('input', refresh);
  const submit = async () => {
    const p = parseQuick(input.value, defaults);
    if (!p.title) return;
    if (p.errors.length) return toast(p.errors[0], true);
    let item;
    try { item = await createItem(p.type, p.title, p.values); } catch { return; } // already toasted
    toast(`Created ${refOf(item)}`);
    input.value = '';
    refresh();
    onCreated && onCreated(item);
  };
  // Not while a word is still being composed (an accent, a suggestion, Japanese): that Enter only ends it.
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) submit(); });
  // Not on a phone or a touch screen: its keyboard would cover the page as it opens, and the first tap elsewhere would
  // only put it away. A tap on the field brings it up.
  if (autofocus && !keyboardShy()) setTimeout(() => input.focus(), 0);
  // A phone's keyboard may not show Enter as "add": a button that does (phone.css). Its mic is the keyboard's own.
  const add = phone ? h('button', { type: 'button', class: 'btn qa-add', onclick: submit }, 'Add') : null;
  return h('div', { class: `quick-add ${add ? 'has-add' : ''}`.trim() }, mic && !isTouch() ? withMic(input) : input, add, prev);
}

/** Quick capture: lands as an inbox item unless a /task, /note… token says otherwise. */
export function openQuickModal(defaults = { type: 'inbox' }) {
  let close = () => {};
  const bar = quickAddBar(defaults, {
    onCreated: () => close(true),
    placeholder: defaults.type === 'inbox' ? 'Capture anything…  (/task, /note… to file it straight away)' : undefined,
  });
  ({ close } = openDialog({
    title: 'Capture to Inbox', ico: 'inbox', body: [bar,
      h('p', { class: 'hint' }, 'Enter to create · Esc to close · leave it unplanned and unrelated to triage it later from Inbox')],
    focus: () => bar.querySelector('input, textarea')?.focus(),
  }));
}
