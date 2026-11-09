// The form for one work-log entry: type, time spent and day side by side, the notes below.
// It adds entries (the item's Log work), edits them (the Work log table) and accepts suggestions.
import { dateInput } from './datepicker.js';
import { select, h, icon } from './ui.js';
import { state, toast } from './state.js';
import { cleanTime } from './worktime.js';

/** The fields of one work-log entry: type, time spent and day side by side, the notes below. Adds and edits. */
// The quick amounts of an item's Log work: one click puts that much in its Time, to finish the entry and Add it.
export const QUICK_TIMES = [['00:15', '15m'], ['00:30', '30m'], ['01:00', '1h'], ['02:00', '2h']];

/**
 * `quick: true` (an item's Log work) adds a row of QUICK_TIMES, each filling the time, and refuses an empty time on Add: a typed entry needs
 * its time. Elsewhere (a suggestion taken as it is) 00:00 is still an entry.
 * `rows: true` (the side panel's Time tab) lays it out as the Properties tab does: one field per row, its name on the
 * left (Time with the quick amounts beside it, Type, Day, Notes), the buttons under the values. Otherwise compact: no
 * visible names, two lines (the Work log table).
 */
export function logForm(values, { submitLabel, onSubmit, onChange = () => {}, onCancel = null, onDelete = null, deleteLabel = 'Delete', deleteIcon = 'trash', fk = 'log', quick = false, rows = false }) {
  const kinds = [...new Set([...state.config.work_kinds, values.kind].filter(Boolean))]; // keep a kind that is no longer configured
  const kind = select(kinds.map((k) => [k, k]), values.kind, (v) => onChange({ kind: v }),
    { class: 'kind-select', 'aria-label': 'Activity type', 'data-fk': `${fk}-kind` });
  const time = h('input', {
    type: 'text', class: 'log-time', value: values.time === '00:00' && quick ? '' : values.time, placeholder: '00:00', maxlength: '6', inputmode: 'numeric',
    'aria-label': 'Time spent, HH:MM', title: 'Time spent, HH:MM (1:30, 130 or 0130 all mean 01:30)', 'data-fk': `${fk}-time`,
  });
  time.addEventListener('input', () => onChange({ time: time.value }));
  // Always typed, never nudged: focusing the field selects its value, so typing replaces it (a click must not undo that).
  let pressedToFocus = false;
  time.addEventListener('focus', () => time.select());
  time.addEventListener('mousedown', () => { pressedToFocus = document.activeElement !== time; });
  time.addEventListener('mouseup', (e) => { if (pressedToFocus) { e.preventDefault(); pressedToFocus = false; } });
  time.addEventListener('keydown', (e) => { // Enter tidies the time and moves on to the notes
    if (e.key !== 'Enter') return;
    e.preventDefault();
    time.dispatchEvent(new Event('change'));
    note.focus();
  });
  time.addEventListener('change', () => { // tidy what was typed, or flag it
    const t = cleanTime(time.value);
    time.classList.toggle('invalid', t === null);
    if (t !== null) { time.value = t; onChange({ time: t }); } else toast('Time must be HH:MM, for example 01:30', true);
  });
  const date = dateInput(values.date, { clearable: false, 'aria-label': 'Day worked', 'data-fk': `${fk}-date` });
  date.addEventListener('change', () => onChange({ date: date.value }));
  const note = h('input', { type: 'text', class: 'log-note', value: values.note || '', placeholder: 'Notes (optional)', 'aria-label': 'Notes', 'data-fk': `${fk}-note` });
  note.addEventListener('input', () => onChange({ note: note.value }));
  const submit = () => {
    const t = cleanTime(time.value);
    if (t === null) { time.classList.add('invalid'); time.focus(); toast('Time must be HH:MM, for example 01:30', true); return; }
    if (quick && t === '00:00') { time.classList.add('invalid'); time.focus(); toast('How long? Pick 15m, 30m, 1h, 2h or type the time', true); return; }
    onSubmit({ kind: kind.value, time: t, date: date.value || values.date, note: note.value.trim() });
  };
  const setQuick = (t) => { time.value = t; time.classList.remove('invalid'); onChange({ time: t }); }; // never adds by itself
  note.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  // No visible labels (each control has an aria-label and a placeholder): the form stays two lines tall when adding.
  const submitBtn = h('button', { class: 'btn small primary', onclick: submit }, submitLabel);
  const editing = onCancel || onDelete;
  const quickRow = quick ? h('div', { class: 'log-quick', role: 'group', 'aria-label': 'Time spent' },
    ...QUICK_TIMES.map(([t, label]) => h('button', { type: 'button', class: 'btn small', title: `Set the time to ${t}`, 'data-fk': `${fk}-quick-${label}`, onclick: () => setQuick(t) }, label))) : null;
  const actions = editing ? h('div', { class: 'log-actions' },
    onDelete ? h('button', { class: 'btn small danger', onclick: onDelete }, icon(deleteIcon, 13), deleteLabel) : null,
    h('span', { class: 'spacer' }),
    onCancel ? h('button', { class: 'btn small ghost', onclick: onCancel }, 'Cancel') : null,
    submitBtn) : null;
  if (rows) {
    const row = (tag, name, ...controls) => h(tag, { class: 'field' }, h('span', {}, name), ...controls);
    return h('div', { class: 'log-form log-rows fields prop-rows quiet' },
      row('div', 'Time', h('div', { class: 'log-time-row' }, time, quickRow)),
      row('label', 'Type', kind),
      row('label', 'Day', date),
      row('label', 'Notes', note),
      row('div', '', actions || h('div', { class: 'log-actions' }, submitBtn)));
  }
  return h('div', { class: 'log-form' },
    quickRow,
    h('div', { class: 'log-fields' }, kind, time, date),
    h('div', { class: 'log-notes' }, note, editing ? null : submitBtn),
    actions);
}
