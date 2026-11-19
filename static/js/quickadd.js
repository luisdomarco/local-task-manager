// Quick add, Todoist-style: one line, tokens become fields.
//   /note /meeting /initiative   type (default: task)
//   #INI-0003                    related_to
//   !1 … !4 | !urgent !high !normal !low   priority, by rank: Urgent…Low (Initiatives), P0…P3 (Projects)
//   https://… | www.…            main url (a second one goes to links); with no other words, the title is its
//                                site's name (X, pepita), for you to write over
//   @today @week @nextweek @month @mon…@sun   plan (a weekday: its next date)
//   due:2026-10-20 | due:today | due:tomorrow | due:fri
//   +label                       label
//   session:name                 session_name (the Claude session handling it)
import { addDays, isoWeek, monthLabel, nextDow, relDay, shiftWeek, thisMonth, thisWeek, today } from './dates.js';
import { PARENT_TYPES, PLANNABLE, PRIORITIES, TYPE_DEFS, onStructure } from './rules.js';
import { addAttachments, createItem, state, toast } from './state.js';
import { carriesFiles, keptName } from './attachtext.js';
import { h, icon, keyboardShy, labelChip, openDialog, priorityChip } from './ui.js';
import { withMic } from './dictation.js';
import { isPhone, isTouch } from './phone.js';
import { refOf } from './shownid.js';
import { siteName } from './sitename.js';
import { longText } from './share.js';

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
  // A link alone (a share with no title of its own, a pasted address): named after its site, the link in its url.
  if (!out.title && out.values.url) out.title = siteName(out.values.url);
  out.values = { ...defaults.values, ...out.values };
  if (!PLANNABLE.has(out.type)) {
    for (const k of ['plan_day', 'plan_week', 'plan_month', 'priority', 'due', 'status', 'list']) delete out.values[k];
  }
  const parent = out.values.related_to && state.byId.get(out.values.related_to);
  if (out.values.related_to && !parent) out.errors.push(`${out.values.related_to} not found`);
  else if (parent && !PARENT_TYPES[out.type].includes(parent.type)) out.errors.push(`a ${out.type} can't hang from a ${parent.type}`);
  return out;
}

const LINK = /^(?:https?:\/\/|www\.)\S+$/i;
const fullUrl = (w) => (/^www\./i.test(w) ? `https://${w}` : w);

/** `text` without its links: `rest` (the other words, spaces made one) and `urls` (each link, `www.` made https). */
export function splitLinks(text) {
  const urls = [];
  const rest = [];
  for (const w of String(text || '').split(/\s+/).filter(Boolean)) (LINK.test(w) ? urls : rest).push(LINK.test(w) ? fullUrl(w) : w);
  return { rest: rest.join(' '), urls };
}

/** The Subject a link starts with when nothing else is written: its site's name and a dash, to write after. */
export const linkSubject = (url) => `${siteName(url)} — `;

/**
 * A parse (parseQuick) with the links the box keeps apart (`kept`: pasted or shared, shown as chips, never in the
 * Subject): the first is the url when none was typed, the rest go to links. No words: the site's name. A Subject
 * left as it started ("X —") loses its dash.
 */
export function withKept(p, kept = []) {
  const values = { ...p.values };
  for (const url of kept) {
    if (!values.url) values.url = url;
    else if (values.url !== url && !(values.links || []).some((l) => l.url === url)) values.links = [...(values.links || []), { url }];
  }
  let title = p.title.replace(/\s+[—–-]$/, '').trim();
  if (!title && values.url) title = siteName(values.url);
  return { ...p, title, values };
}

function preview(p, kept = [], drop = () => {}) {
  const v = p.values;
  const parts = [h('span', { class: `chip t-${p.type}` }, TYPE_DEFS[p.type]?.label || p.type)];
  if (v.related_to) parts.push(h('span', { class: 'chip parent' }, state.byId.get(v.related_to)?.title || v.related_to));
  if (v.priority) parts.push(priorityChip(v.priority));
  // A link kept apart (pasted, shared) can be left out with its ×; one typed in the box goes by deleting it there.
  const unkeep = (url) => (kept.includes(url) ? h('button', { type: 'button', class: 'btn icon qa-file-x', 'aria-label': `Leave out ${url}`,
    onclick: () => drop(url) }, icon('x', 12)) : null);
  if (v.url) parts.push(h('span', { class: 'chip link qa-link', title: v.url }, icon('link', 12), h('span', { class: 'qa-link-url' }, v.url), unkeep(v.url)));
  for (const l of v.links || []) parts.push(h('span', { class: 'chip qa-link', title: l.url }, h('span', { class: 'qa-link-url' }, `+ ${l.url}`), unkeep(l.url)));
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
/**
 * The quick add box: a line of text parsed as it is typed (parseQuick), Enter creates. `files` (the Inbox's): a picture
 * or file pasted or dropped on it, or picked with its paperclip (on a phone, a photo), waits as a chip and is attached to
 * the item created (with no text, the item is named after the first file). `value`: the text it opens with (a share);
 * `links`: addresses it opens with (a share's), kept apart; `attach`: files it opens with, or a promise of them (a
 * picture shared from the iPhone's Photos, fetched from the app).
 * A link pasted or shared never stays in the Subject: it waits as a chip (×: leave it out) and becomes the item's url,
 * and an empty Subject starts with its site's name ("X — ") for the rest to be written after it.
 * A text too long for a Subject (share.js longText), pasted or shared (`body`), is not cut: it waits whole as a
 * *Description* chip (×: leave it out) and becomes the item's description, its lines kept; its first line starts the
 * Subject.
 */
export function quickAddBar(defaults = {}, { placeholder, autofocus = false, onCreated, mic = true, files = false, value = '', links = [], attach = null, body = '' } = {}) {
  const prev = h('div', { class: 'chips qa-preview' });
  const phone = isPhone();
  const hint = placeholder || 'Add a task…  #INI-0001  !high  @today  due:fri  +label  https://…  /note';
  const input = h('input', {
    class: 'qa-input', type: 'text', autocomplete: 'off',
    // A phone's box is narrow: what to type, not the tokens after it (they still work); its keyboard says Done.
    placeholder: phone ? hint.split('  ')[0] : hint, enterkeyhint: phone ? 'done' : null,
  });
  const opening = splitLinks(value);
  const kept = [...new Set([...links.filter(Boolean), ...opening.urls])]; // links kept apart, as chips
  input.value = opening.rest || (kept.length ? linkSubject(kept[0]) : '');
  let desc = body || ''; // a long text pasted or shared: the description of what Enter creates
  const waiting = []; // files to attach to what Enter creates
  const filesRow = files ? h('div', { class: 'chips qa-files' }) : null;
  const drawFiles = () => filesRow?.replaceChildren(...waiting.map((f, i) => h('span', { class: 'chip qa-file', title: f.name },
    icon(f.type.startsWith('image/') ? 'image' : 'paperclip', 12), h('span', { class: 'qa-file-name' }, f.name),
    h('button', { type: 'button', class: 'btn icon qa-file-x', 'aria-label': `Leave out ${f.name}`, onclick: () => { waiting.splice(i, 1); drawFiles(); } }, icon('x', 12)))));
  const take = (list, { focus = true } = {}) => {
    for (const f of list) {
      const name = keptName(f.name, f.type);
      waiting.push(name === f.name ? f : new File([f], name, { type: f.type }));
    }
    drawFiles();
    if (focus) input.focus();
  };
  const drop = (url) => {
    kept.splice(kept.indexOf(url), 1);
    if (!kept.length && input.value === linkSubject(url)) input.value = ''; // the Subject it started, untouched
    refresh();
  };
  const descChip = () => h('span', { class: 'chip qa-file qa-desc', title: desc.slice(0, 400) },
    icon('text', 12), h('span', { class: 'qa-file-name' }, `Description · ${desc.length.toLocaleString()} characters`),
    h('button', { type: 'button', class: 'btn icon qa-file-x', 'aria-label': 'Leave out the description',
      onclick: () => { desc = ''; refresh(); input.focus(); } }, icon('x', 12)));
  const refresh = () => {
    prev.replaceChildren(...(input.value.trim() || kept.length ? preview(withKept(parseQuick(input.value, defaults), kept), kept, drop) : []),
      ...(desc ? [descChip()] : []));
  };
  input.addEventListener('input', refresh);
  // Text pasted with a link in it: the link goes to the chips, the rest where the cursor is. A Subject left empty
  // starts with the link's site.
  input.addEventListener('paste', (e) => {
    if (e.clipboardData?.files?.length) return; // a file: the Inbox's own paste (files) takes it
    const long = longText(e.clipboardData?.getData('text/plain') || '');
    if (long) { // too long for a Subject: kept whole as the description, its first line in the Subject when empty
      e.preventDefault();
      desc = long.body;
      if (!input.value.trim()) input.value = splitLinks(long.subject).rest;
      input.setSelectionRange(input.value.length, input.value.length);
      refresh();
      return;
    }
    const { rest, urls } = splitLinks(e.clipboardData?.getData('text/plain') || '');
    if (!urls.length) return;
    e.preventDefault();
    for (const u of urls) if (!kept.includes(u)) kept.push(u);
    input.setRangeText(rest, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, 'end');
    if (!input.value.trim()) input.value = linkSubject(kept[0]);
    input.setSelectionRange(input.value.length, input.value.length);
    refresh();
  });
  const submit = async () => {
    const text = input.value.trim() || (waiting.length ? waiting[0].name.replace(/\.[^.]+$/, '') : '');
    const p = withKept(parseQuick(text || (desc ? 'Pasted text' : ''), defaults), kept);
    if (!p.title && !p.values.url) return; // a link alone has its site's name (withKept); one with none, no subject
    if (p.errors.length) return toast(p.errors[0], true);
    let item;
    try { item = await createItem(p.type, p.title, p.values, desc || null); } catch { return; } // already toasted
    toast(`Created ${refOf(item)}`);
    input.value = '';
    kept.length = 0;
    desc = '';
    refresh();
    if (waiting.length) {
      const sent = waiting.splice(0);
      drawFiles();
      await addAttachments(item.key, sent); // its own toasts (what could not go, and why)
    }
    onCreated && onCreated(item);
  };
  // Not while a word is still being composed (an accent, a suggestion, Japanese): that Enter only ends it.
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) submit(); });
  // Not on a phone or a touch screen: its keyboard would cover the page as it opens, and the first tap elsewhere would
  // only put it away. A tap on the field brings it up.
  if (autofocus && !keyboardShy()) setTimeout(() => input.focus(), 0);
  // A phone's keyboard may not show Enter as "add": a button that does (phone.css). Its mic is the keyboard's own.
  const add = phone ? h('button', { type: 'button', class: 'btn qa-add', onclick: submit }, 'Add') : null;
  let clip = null;
  if (files) {
    input.addEventListener('paste', (e) => {
      const list = [...(e.clipboardData?.files || [])];
      if (!list.length) return;
      e.preventDefault();
      take(list);
    });
    const picker = h('input', { type: 'file', multiple: true, hidden: true });
    picker.addEventListener('change', () => { take([...picker.files]); picker.value = ''; });
    clip = h('button', { type: 'button', class: 'btn icon ghost qa-clip', title: 'Attach a picture or file (or paste or drop it here)', 'aria-label': 'Attach a picture or file',
      onclick: () => picker.click() }, icon('paperclip', 16), picker);
  }
  const box = h('div', { class: `quick-add ${add ? 'has-add' : ''} ${clip ? 'has-clip' : ''}`.trim() },
    mic && !isTouch() ? withMic(input) : input, clip, add, filesRow, prev);
  if (files) {
    box.addEventListener('dragover', (e) => { if (carriesFiles(e.dataTransfer)) { e.preventDefault(); box.classList.add('qa-drop'); } });
    box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove('qa-drop'); });
    box.addEventListener('drop', (e) => {
      box.classList.remove('qa-drop');
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      take([...e.dataTransfer.files]);
    });
  }
  if (value || kept.length || desc) setTimeout(refresh, 0);
  // Not focused: on a phone that would raise the keyboard over the picture you came to see (autofocus decides).
  if (files && attach) Promise.resolve(attach).then((list) => { if (list?.length) take(list, { focus: false }); });
  return box;
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
