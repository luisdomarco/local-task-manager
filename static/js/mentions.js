// Mentions: @ in any textarea (a description, a comment, a prompt) offers the people and groups in Contacts; picking one
// writes @[Public name] — plain text that reads well in any editor and that a rename rewrites (tm/people.py).
// Nobody is notified: a mention is for you, and for Claude, whose prompt lists who is mentioned and how to reach them.
// One listener for the whole document, so every textarea has it, including those made later.
import { state } from './state.js';
import { GROUP_ICON, h, icon } from './ui.js';

const MAX = 8;
const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
// What is being typed: an @ at the start or after a space or bracket, then up to four words, up to the caret.
const QUERY_RE = /(?:^|[\s([{>])@([^\s@[\]()]{0,30}(?: [^\s@[\]()]{0,30}){0,3})$/;

let menu = null; // { el, ta, start, matches, active }

/** People (and groups) whose public or calendar name has a word starting with the query (all of them, people most used
 *  first and then the groups, for none). */
export function matchPeople(query, people = [...state.people, ...(state.groups || [])]) {
  const q = norm(query).trim();
  const starts = (name) => norm(name).split(/[\s.\-_]+/).some((w, i, ws) => ws.slice(i).join(' ').startsWith(q));
  return people.filter((p) => !q || starts(p.name) || starts(p.calendar_name)).slice(0, MAX);
}

/** Where the caret of `ta` is on screen: a hidden copy of the textarea up to the caret, measured. */
function caretPoint(ta) {
  const cs = getComputedStyle(ta);
  const mirror = h('div');
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom',
    'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'tabSize']) mirror.style[p] = cs[p];
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: `${ta.offsetWidth}px`, top: '0', left: '-9999px' });
  mirror.textContent = ta.value.slice(0, ta.selectionStart);
  const mark = h('span', {}, '​');
  mirror.append(mark);
  document.body.append(mirror);
  const r = ta.getBoundingClientRect();
  const x = r.left + mark.offsetLeft - ta.scrollLeft;
  const y = r.top + mark.offsetTop - ta.scrollTop + mark.offsetHeight;
  mirror.remove();
  return { x: Math.min(x, r.right - 8), y: Math.min(y, r.bottom) };
}

function close() {
  menu?.el.remove();
  menu = null;
}

function pick(i) {
  const { ta, start, matches } = menu;
  const p = matches[i];
  if (!p) return;
  close();
  ta.focus();
  ta.setRangeText(`@[${p.name}] `, start, ta.selectionStart, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true })); // the editor (and whatever saves it) sees the new text
}

function paint() {
  menu.el.querySelectorAll('.menu-item').forEach((b, i) => b.classList.toggle('active', i === menu.active));
}

function open(ta, start, matches) {
  menu?.el.remove();
  const el = h('div', { class: 'menu mention-menu', role: 'listbox', 'aria-label': 'Mention someone' },
    h('div', { class: 'menu-label' }, 'Mention'),
    matches.map((p, i) => h('button', {
      type: 'button', class: 'menu-item', role: 'option', tabindex: '-1',
      onmousedown: (e) => { e.preventDefault(); menu.active = i; pick(i); }, // mousedown: the textarea keeps the focus
    }, icon(p.channel ? GROUP_ICON[p.channel] || 'users' : 'users', 14), h('span', {}, p.name), p.calendar_name && p.calendar_name !== p.name ? h('span', { class: 'muted small' }, p.calendar_name) : null)));
  document.body.append(el);
  menu = { el, ta, start, matches, active: 0 };
  paint();
  const { x, y } = caretPoint(ta);
  el.style.left = `${Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8))}px`;
  el.style.top = `${y + 4 + el.offsetHeight > innerHeight - 8 ? Math.max(8, y - el.offsetHeight - 24) : y + 4}px`;
}

function update(ta) {
  if (ta.readOnly || ta.disabled || ta.dataset.mentions === 'off' || ta.selectionStart !== ta.selectionEnd) { close(); return; } // off: its own @ (chat.js)
  const m = QUERY_RE.exec(ta.value.slice(0, ta.selectionStart));
  const matches = m ? matchPeople(m[1]) : [];
  if (!m || !matches.length) { close(); return; }
  open(ta, ta.selectionStart - m[1].length - 1, matches);
}

export function initMentions() {
  const isTa = (t) => t instanceof HTMLTextAreaElement;
  document.addEventListener('input', (e) => { if (isTa(e.target)) update(e.target); }, true);
  // Captured, so the menu's keys win over the textarea's own (Enter adds a comment, Esc closes a dialog).
  document.addEventListener('keydown', (e) => {
    if (!menu || e.target !== menu.ta) return;
    const n = menu.matches.length;
    const take = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === 'ArrowDown') { take(); menu.active = (menu.active + 1) % n; paint(); }
    else if (e.key === 'ArrowUp') { take(); menu.active = (menu.active - 1 + n) % n; paint(); }
    else if ((e.key === 'Enter' || e.key === 'Tab') && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { take(); pick(menu.active); }
    else if (e.key === 'Escape') { take(); close(); }
  }, true);
  document.addEventListener('focusout', (e) => { if (menu && e.target === menu.ta) close(); }, true);
  document.addEventListener('mousedown', (e) => { if (menu && !menu.el.contains(e.target)) close(); }, true);
  addEventListener('resize', close);
  document.addEventListener('scroll', (e) => { if (menu && !menu.el.contains(e.target)) close(); }, true);
}
