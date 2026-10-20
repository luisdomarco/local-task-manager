// DOM helpers and shared components. Everything is built with createElement:
// titles come from files on disk, so nothing user-provided goes through innerHTML
// except rendered markdown, which is sanitized with DOMPurify.
import { relDay } from './dates.js';
import { PLANNABLE, PRIORITY_RANK, isDone, isOverdue, onStructure, statusTree } from './rules.js';
import { fitChips } from './chipfit.js';
import { opener } from './links.js';
import { allLabels, state, setCompleted } from './state.js';

// Links come from files anyone may have written: only these schemes become an href.
// In-app routes (#/initiative/INI-0001) are safe too: they are what the sidebar and breadcrumbs link to.
const SAFE_URL = /^(https?:|mailto:|obsidian:|#\/)/i;
export const safeUrl = (u) => (SAFE_URL.test(String(u || '').trim()) ? String(u).trim() : null);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'href' || k === 'src') { const u = safeUrl(v); if (u) el.setAttribute(k, u); }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  // Icon-only buttons and links: their title becomes the accessible name.
  if (attrs && attrs.title && !attrs['aria-label'] && (tag === 'button' || tag === 'a') && !el.textContent.trim()) {
    el.setAttribute('aria-label', attrs.title);
  }
  return el;
}

// Stroke icons (lucide paths, 24×24 grid). Static markup, never user input.
const ICONS = {
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  kanban: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7M12 7v4M16 7v9"/>',
  table: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  // Ticketing's types: support (lifebuoy), hotfix (flame), error (alert), learning (lightbulb)
  lifebuoy: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.93 4.93 4.24 4.24M14.83 9.17l4.24-4.24M14.83 14.83l4.24 4.24M9.17 14.83l-4.24 4.24"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  sunrise: '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
  calendarplus: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M10 16h4"/><path d="M12 14v4"/>',
  calendardays: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
  calendarsearch: '<path d="M16 2v4"/><path d="M21 11.75V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7.25"/><path d="m22 22-1.875-1.875"/><path d="M3 10h18"/><path d="M8 2v4"/><circle cx="18" cy="18" r="3"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  checklist: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  note: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  task: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  external: '<path d="M7 7h10v10M7 17 17 7"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  text: '<path d="M21 6H3M15 12H3M17 18H3"/>',
  pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>',
  heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
  bold: '<path d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z"/>',
  italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
  strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  listnum: '<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2H4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .01-1 1 1 1 1 1zM15 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2h-4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m12 19-7-7 7-7M19 12H5"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  // attachments (attachments.js)
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  minimize: '<path d="M6 18h12"/>',
  maximize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  restore: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  filter: '<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/>',
  sidebar: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  // the sidebar's two modes and the Explorer's tree (sidebar.js, explorer.js)
  project: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><path d="M14 4h7M14 9h7M14 15h7M14 20h7"/>',
  foldertree: '<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M3 5a2 2 0 0 0 2 2h3"/><path d="M3 3v13a2 2 0 0 0 2 2h3"/>',
  folderopen: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  grip: '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
};

export function icon(name, size = 16) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'icon', 'aria-hidden': 'true',
  })) el.setAttribute(k, v);
  el.innerHTML = ICONS[name] || '';
  return el;
}

/** Each type's icon, from the vault's structure (a live binding). */
export let TYPE_ICON_NAME = {};
onStructure((s) => { TYPE_ICON_NAME = Object.fromEntries(s.types.map((t) => [t.name, t.icon])); });
export function typeIcon(type, size = 14) {
  const el = icon(TYPE_ICON_NAME[type] || 'note', size);
  el.classList.add(`t-${type}`); // tinted per type in app.css
  return el;
}

// ── labels ───────────────────────────────────────────────────────────────────
/** A stable hue (0–359) per label name, so "#billing" is the same colour everywhere. */
export function labelHue(name) {
  let x = 0;
  for (const ch of String(name).toLowerCase()) x = (x * 31 + ch.codePointAt(0)) >>> 0;
  return x % 360;
}
export const labelChip = (name, extra = null) =>
  h('span', { class: 'chip label', style: `--h:${labelHue(name)}` }, `#${name}`, extra);
/** A person: a neutral chip with the people icon. */
/** A person by their public name; on hover, the name Calendar gives them and their emails. */
export const personChip = (name, extra = null) => {
  const p = state.people.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  const about = [name, p?.calendar_name && p.calendar_name !== name ? `Calendar: ${p.calendar_name}` : null, ...(p?.emails || []),
    p?.redmine ? `Redmine: ${p.redmine}` : null, p?.slack ? `Slack: ${p.slack}` : null].filter(Boolean);
  return h('span', { class: 'chip person', title: about.join('\n') }, icon('users', 12), name, extra);
};

/**
 * A tag input: chips in front of a text field, suggestions from `suggest()` as you type, Enter or
 * comma to add, Backspace to remove the last one. `kind` is 'label' (#tags, coloured) or 'person'
 * (names; repeats are ignored whatever the case). `onChange(list)` gets the whole list.
 * It keeps to one line: the chips that do not fit wait behind a "+N" chip (chipfit.js), and a click on it, on the
 * field or a Tab into it opens the whole list over the field, to add and remove; leaving it folds it back. Open is
 * where its text field has the focus, so it is open again after a save re-renders the card (panel.js keepFocus).
 */
export function tagInput(values, onChange, { suggest = () => [], id = null, placeholder = null, kind = 'label', fk = null } = {}) {
  const person = kind === 'person';
  const what = person ? 'People' : 'Labels';
  let labels = [...values];
  const box = h('div', { class: `label-input ${person ? 'person-input' : ''}`, role: 'group', 'aria-label': what });
  const wrap = h('div', { class: 'tag-field' }, box); // holds the line's place while the list is open over it
  const input = h('input', {
    id, type: 'text', autocomplete: 'off', placeholder: placeholder || (person ? 'Add person…' : 'Add label…'),
    'aria-autocomplete': 'list', 'data-fk': fk || (person ? 'people' : 'labels'),
  });
  const more = h('button', { type: 'button', class: 'chip tag-more', onclick: (e) => { e.stopPropagation(); open(); } });
  box.append(more, input);
  const same = (a, b) => (person ? a.toLowerCase() === b.toLowerCase() : a === b);
  const clean = (name) => (person ? name.replace(/,/g, ' ').replace(/\s+/g, ' ').trim() : name.trim().replace(/^#/, '').replace(/[,\s]+$/, ''));
  const has = (name) => labels.some((l) => same(l, name));
  const commit = () => { onChange(labels); render(); };
  const add = (name) => {
    name = clean(name);
    if (!name || has(name)) { input.value = ''; closeMenu(); return; }
    labels = [...labels, name];
    input.value = '';
    closeMenu();
    commit();
  };
  const remove = (name) => { labels = labels.filter((l) => l !== name); commit(); };
  const chip = (name, x) => (person ? personChip(name, x) : labelChip(name, x));
  const chips = () => [...box.querySelectorAll('.chip:not(.tag-more)')];

  let expanded = false;
  // One line: as many chips as fit, then "+N" (or every chip and the field). Open: all of them and the field.
  const fit = () => {
    for (const c of chips()) c.hidden = false;
    input.hidden = false;
    more.hidden = true;
    const css = getComputedStyle(box);
    const room = box.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    if (expanded || !(room > 0)) return; // not laid out yet (detached: NaN), the ResizeObserver comes back
    more.hidden = false;
    more.textContent = `+${labels.length}`; // the widest it can be, to measure
    const r = fitChips(chips().map((c) => c.getBoundingClientRect().width), room,
      { gap: parseFloat(css.columnGap) || 4, more: more.getBoundingClientRect().width });
    const rest = labels.length - r.shown;
    // Typing in it while it does not fit (a save re-rendered the card, Tab came in): open, never a hidden field.
    if ((rest || !r.input) && wrap.contains(document.activeElement)) { open(); return; }
    chips().forEach((c, i) => { c.hidden = i >= r.shown; });
    input.hidden = !r.input;
    more.hidden = !rest;
    more.textContent = `+${rest}`;
    more.title = `${rest} more — show all ${what.toLowerCase()}`;
    more.setAttribute('aria-label', more.title);
  };
  const open = () => {
    if (!expanded) { expanded = true; box.classList.add('expanded'); fit(); }
    input.focus();
  };
  const fold = () => { expanded = false; box.classList.remove('expanded'); fit(); };

  // Chips are rebuilt in front of "+N" and the input, which stays attached so it never loses focus.
  const render = () => {
    for (const c of chips()) c.remove();
    for (const l of labels) {
      box.insertBefore(chip(l,
        // mousedown keeps the focus in the field: open, it stays open through the save's re-render
        h('button', { class: 'x', type: 'button', title: `Remove ${l}`, onmousedown: (e) => e.preventDefault(), onclick: (e) => { e.stopPropagation(); remove(l); } }, icon('x', 11))), more);
    }
    fit();
  };
  const showSuggestions = () => {
    const q = clean(input.value).toLowerCase();
    const opts = suggest().filter((l) => !has(l) && (!q || l.toLowerCase().includes(q))).slice(0, 8);
    if (!opts.length) { closeMenu(); return; }
    dropdown(input, opts.map((l) => ({ label: person ? l : `#${l}`, onSelect: () => { add(l); input.focus(); } })), { width: 240, focus: false });
  };
  input.addEventListener('input', showSuggestions);
  input.addEventListener('focus', showSuggestions);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      if (menuIsOpen() && e.key === 'Enter') { const first = document.querySelector('.menu .menu-item'); if (first && !input.value.trim()) { first.click(); e.preventDefault(); return; } }
      e.preventDefault(); add(input.value);
    } else if (e.key === 'ArrowDown' && menuIsOpen()) {
      e.preventDefault(); document.querySelector('.menu .menu-item')?.focus();
    } else if (e.key === 'Backspace' && !input.value && labels.length) {
      remove(labels[labels.length - 1]);
    } else if (e.key === 'Escape') {
      if (menuIsOpen()) closeMenu();
      else if (expanded) { e.stopPropagation(); input.blur(); fold(); } // the list first; the card on the next Esc
    }
  });
  input.addEventListener('blur', () => { setTimeout(() => { if (!menuIsOpen() && input.value.trim()) add(input.value); }, 150); });
  // Leaving it folds it, unless to its suggestions (they hand the focus back).
  wrap.addEventListener('focusout', () => setTimeout(() => {
    if (expanded && !wrap.contains(document.activeElement) && !menuIsOpen()) fold();
  }, 150));
  box.addEventListener('click', (e) => {
    if (e.target.closest('.x, .tag-more')) return;
    if (input.hidden) open(); else input.focus();
  });
  new ResizeObserver(() => { if (!expanded) fit(); }).observe(wrap);
  render();
  return wrap;
}

/** The label version of tagInput (kept for its callers). */
export const labelInput = (values, onChange, opts = {}) => tagInput(values, onChange, { ...opts, kind: 'label' });

/** Select for filtering by one label (every label in use); null = any. */
export function labelSelect(value, onChange) {
  const labels = allLabels();
  if (!labels.length && !value) return h('span');
  return select([[null, 'Any label'], ...labels.map((l) => [l, `#${l}`])], value, onChange, { 'aria-label': 'Label' });
}
export const hasLabel = (item, label) => !label || (item.fields.labels || []).includes(label);

/**
 * A multiple choice filter: a button that opens a list of ticks and stays open while you tick.
 * `options` are [value, node-or-text]; `values` the ticked ones (none ticked = any);
 * onChange(values) gets the new array. attrs: `any` (the label for none ticked), `text(values)` (the label for some),
 * `fixed` (values always ticked), aria-label…
 */
export function checkSelect(options, values, onChange, { any = 'Any', text = null, fixed = [], ...attrs } = {}) {
  const ticked = new Set(values);
  const picked = () => options.map(([o]) => o).filter((o) => ticked.has(o));
  // `text(picked)` names what is ticked (default: the one value, or how many); the label follows each tick.
  const label = () => (!ticked.size ? any : text ? text(picked()) : ticked.size === 1 ? String([...ticked][0]) : `${ticked.size} selected`);
  const face = h('span', { class: 'select-label' }, label());
  const btn = selectButton(face, attrs);
  btn.addEventListener('click', () => {
    const row = (v, rowFace) => {
      // A `fixed` value is always ticked: shown, never untickable.
      const box = h('input', { type: 'checkbox', checked: ticked.has(v), disabled: fixed.includes(v), onchange: () => {
        if (box.checked) ticked.add(v); else ticked.delete(v);
        face.textContent = label();
        onChange(picked());
      } });
      return h('label', { class: 'menu-item menu-check' }, box, rowFace);
    };
    dropdown(btn, options.map(([v, rowFace]) => row(v, rowFace)), { width: Math.max(btn.offsetWidth, 190) });
  });
  return btn;
}

/** Select for the plan filters shared by Board, lists and All items (rules.PLAN_FILTERS). */
export function planSelect(value, onChange, filters) {
  return select(Object.entries(filters).map(([k, f]) => [k === 'any' ? null : k, f.label]), value === 'any' ? null : value,
    (v) => onChange(v || 'any'), { 'aria-label': 'Plan' });
}

/** Sanitized HTML for markdown; fails closed (escaped <pre>) if a CDN lib is missing. */
let linksHooked = false;
let noSetext = false;

/**
 * No "setext" headings: in Markdown a line with "-" or "=" under it becomes a heading, so a note's
 * "text" + a "-" started on the next line showed up big and bold. Here the line stays text (and
 * "---" under it stays a rule). Headings are written with #.
 */
function plainUnderlines(marked) {
  marked.use({
    tokenizer: {
      lheading(src) {
        const cap = this.rules.block.lheading.exec(src);
        if (!cap) return false;
        const lines = cap[0].replace(/\n+$/, '').split('\n');
        const under = lines.pop();
        const rule = /^ {0,3}-{3,}\s*$/.test(under); // "---": leave it to the lexer, as a rule
        const text = (rule ? lines : [...lines, under]).join('\n');
        return { type: 'paragraph', raw: rule ? `${lines.join('\n')}\n` : cap[0], text, tokens: this.lexer.inline(text) };
      },
    },
  });
}

export function renderMarkdown(md) {
  if (window.DOMPurify && !linksHooked) {
    // A link in a note opens in a new tab: clicking one must not replace the app. (DOMPurify drops `target` on its own; set after it ran.)
    window.DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') || '')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    linksHooked = true;
  }
  if (!window.marked || !window.DOMPurify) {
    const pre = document.createElement('pre');
    pre.textContent = md || '';
    return pre.outerHTML;
  }
  if (!noSetext) { plainUnderlines(window.marked); noSetext = true; }
  // Sanitize last: what DOMPurify returns goes to the page as is, never parsed and serialized again (mutation XSS).
  return window.DOMPurify.sanitize(mentionChips(window.marked.parse(md || '', { breaks: true })));
}

const MENTION_RE = /@\[([^[\]\n]{1,80})\]/g;
const NO_CHIPS = 'code, pre, a, textarea, title, style, script, noscript, xmp, iframe, noembed, noframes, plaintext';

/**
 * @[Name] in rendered Markdown → the person's chip (dashed when nobody in People has that name); never inside code,
 * a link or an element whose text is not markup. Runs on the HTML before it is sanitized: a <template> is inert.
 */
function mentionChips(html) {
  if (!html.includes('@[')) return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.includes('@[') && !n.parentElement?.closest(NO_CHIPS) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) node.replaceWith(...withMentions(node.nodeValue));
  return tpl.innerHTML;
}

/** Plain text with each @[Name] as the person's chip: [text, chip, text…] (a comment shows its mentions this way). */
export function withMentions(text) {
  const parts = [];
  let last = 0;
  for (const m of String(text || '').matchAll(MENTION_RE)) {
    const name = m[1].replace(/\s+/g, ' ').trim();
    parts.push(text.slice(last, m.index));
    const known = state.people.some((p) => p.name.toLowerCase() === name.toLowerCase());
    const chip = personChip(name);
    chip.classList.add('mention');
    if (!known) { chip.classList.add('unknown'); chip.title = `${name} — not in People`; }
    parts.push(chip);
    last = m.index + m[0].length;
  }
  parts.push(String(text || '').slice(last));
  return parts.filter((p) => p !== '');
}

/**
 * The app's select. The browser's own <select> popup cannot be styled, so this is a
 * button that opens the app's menu instead: a check on the current option, status and
 * priority options drawn as their coloured pills, keyboard navigation, and a search
 * field once the list is long.
 *
 * It keeps the contract callers had with <select>: options are [value, label] pairs, or
 * [value, label, iconName] to draw an icon beside the label (a null value is the "none / any" row), `.value` reads and writes the selected value
 * ('' for none) and onChange(value | null) fires when the user picks a different one.
 * attrs: class, aria-label, data-fk… as on any element, plus `search: true | false` to
 * force the search field on or off (default: on from 11 options), and `clearable: true` for an × beside
 * the button that empties it (shown only while something is picked; the returned element is then a
 * wrapper with the same `.value`).
 */
export function select(options, value, onChange, attrs = {}) {
  const { class: cls = '', search, clearable = false, ...rest } = attrs;
  const tone = /\bstatus-select\b/.test(cls) ? { prefix: 's-', kind: 'status' }
    : /\bprio-select\b/.test(cls) ? { prefix: 'pr-', kind: 'prio' }
      : /\bkind-select\b/.test(cls) ? { prefix: 'k-', kind: 'kind' } : null; // work-log kinds: the coloured square
  let current = value ?? null;
  const optionOf = (v) => options.find(([ov]) => (ov ?? null) === (v ?? null)) || [null, ''];
  const face = ([, text, ico]) => [ico ? icon(ico, 14) : null, text]; // an option's icon + label

  const label = h('span', { class: 'select-label' });
  // Hidden copy of every label: the button is as wide as the longest one, so it never resizes on pick.
  const sizer = h('span', { class: 'select-sizer', 'aria-hidden': 'true' }, options.map((o) => h('span', {}, ...face(o))));
  const btn = h('button', { type: 'button', 'aria-haspopup': 'listbox', ...rest, class: `select-btn ${cls}` },
    h('span', { class: 'select-text' }, label, sizer));

  const clear = clearable ? h('button', { type: 'button', class: 'btn icon select-clear', title: 'Clear', 'aria-label': 'Clear' }, icon('x', 12)) : null;
  const paint = () => {
    label.replaceChildren(...face(optionOf(current)).filter((x) => x !== null));
    if (clear) clear.hidden = current == null;
    if (!tone) return;
    [...btn.classList].filter((c) => /^(s|pr|k)-/.test(c)).forEach((c) => btn.classList.remove(c));
    btn.classList.add(`${tone.prefix}${cssKey(current || (tone.kind === 'status' ? 'Backlog' : 'Normal'))}`);
  };
  Object.defineProperty(btn, 'value', {
    get: () => current ?? '',
    set: (v) => { current = v === '' || v == null ? null : v; paint(); },
  });
  paint();

  const open = () => {
    const searchable = search ?? options.length > 10;
    const list = h('div', { class: 'menu-list', role: 'listbox', 'aria-label': rest['aria-label'] || null });
    const input = searchable
      ? h('input', { type: 'search', class: 'small', placeholder: 'Search…', 'aria-label': 'Search options', autocomplete: 'off' }) : null;
    const choose = (v) => {
      closeMenu();
      btn.focus();
      if ((v ?? null) === current) return;
      btn.value = v;
      onChange(v);
    };
    const rows = () => [...list.querySelectorAll('.menu-item')];
    const render = () => {
      const q = input ? input.value.trim().toLowerCase() : '';
      const shown = options.filter(([v, l]) => !q || v == null || l.toLowerCase().includes(q)); // the none row stays: a way out while searching
      list.replaceChildren(...(shown.length ? shown.map(([v, l, ico]) => {
        const picked = (v ?? null) === current;
        const text = tone ? h('span', {}, h('span', { class: `chip ${tone.kind} ${tone.prefix}${cssKey(v)}` }, l)) : h('span', {}, l);
        const lead = ico ? icon(ico, 15) : null;
        return h('button', {
          type: 'button', role: 'option', 'aria-selected': String(picked), class: `menu-item ${picked ? 'current' : ''}`,
          onclick: () => choose(v),
        }, lead, text, picked ? icon('check', 14) : null);
      }) : [h('div', { class: 'menu-empty' }, 'No matches')]));
    };
    let typed = ''; let typedAt = 0;
    list.addEventListener('keydown', (e) => {
      const items = rows(); const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0 && input) input.focus(); else items[Math.max(i - 1, 0)]?.focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
      else if (!input && e.key.length === 1 && !e.metaKey && !e.ctrlKey) { // type to jump, like a native select
        typed = (Date.now() - typedAt < 700 ? typed : '') + e.key.toLowerCase(); typedAt = Date.now();
        items.find((b) => b.textContent.trim().toLowerCase().startsWith(typed))?.focus();
      }
    });
    if (input) {
      input.addEventListener('input', render);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); (list.querySelector('.current') || rows()[0])?.focus(); }
        else if (e.key === 'Enter') { e.preventDefault(); rows()[0]?.click(); }
      });
    }
    render();
    dropdown(btn, [input ? h('div', { class: 'menu-search' }, input) : null, list].filter(Boolean),
      { width: Math.max(btn.offsetWidth, 180), focus: false });
    (input || list.querySelector('.current') || rows()[0])?.focus();
    list.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  };
  btn.addEventListener('click', open);
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); } });
  if (!clear) return btn;
  clear.addEventListener('click', (e) => {
    e.preventDefault(); // inside a <label>: not a click on the select
    btn.value = null;
    btn.focus();
    onChange(null);
  });
  const wrap = h('span', { class: 'select-clearable' }, btn, clear);
  Object.defineProperty(wrap, 'value', { get: () => btn.value, set: (v) => { btn.value = v; } });
  return wrap;
}

/** Options for a related_to select; keeps `current` even if it is closed/archived. */
export const parentOptions = (types, empty = '— none —', { exclude = new Set(), current = null, where = () => true } = {}) => [
  [null, empty],
  ...state.all.filter((i) => i.id && types.includes(i.type) && !exclude.has(i.id) && where(i)
      && ((!isDone(i) && i.fields.archived !== true) || i.id === current))
    .map((i) => [i.id, `${i.id} · ${i.title}`]),
];

// ── chips ────────────────────────────────────────────────────────────────────
/** A status or priority as a class name: `s-${cssKey(status)}` ("In QA" → s-in-qa). */
export const cssKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ── status colours (TSK-037) ─────────────────────────────────────────────────
// The eight statuses the folder-per-type structure was built with have their pill colours in app.css (.s-*, light and dark). Any other status
// (an agent's, an error's, one a vault added) and any a vault gave a colour (Settings → Item type status) get theirs
// here, from one hue: the fill is the hue over the background, the text the hue towards the foreground, so it reads
// in both themes.
const BUILT_IN = { backlog: '#8a8f98', todo: '#1a73e8', onhold: '#e3a008', blocked: '#d93025', inprogress: '#e8710a',
  review: '#8e44ad', done: '#1e8e3e', discarded: '#6e4a33' };
const PALETTE = ['#1a73e8', '#e8710a', '#8e44ad', '#0d9488', '#db2777', '#65a30d', '#0891b2', '#b45309'];
const hash = (s) => [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
/** The hue a status shows in (what Settings → Item type status starts its colour picker at). */
export function statusColor(status, group, colors = {}) {
  if (colors[status]) return colors[status];
  const key = cssKey(status);
  if (BUILT_IN[key]) return BUILT_IN[key];
  if (group === 'not_started') return BUILT_IN.backlog;
  if (group === 'closed') return BUILT_IN.done;
  return PALETTE[hash(key) % PALETTE.length];
}
/** The CSS of the statuses app.css does not colour, and of those the vault gave a colour. */
export function statusCss(structure) {
  const colors = structure.colors || {};
  const seen = new Map();
  for (const t of structure.types) {
    for (const st of t.statuses || []) {
      const key = cssKey(st);
      if (seen.has(key) || (BUILT_IN[key] && !colors[st])) continue;
      seen.set(key, statusColor(st, t.groups?.[st], colors));
    }
  }
  return [...seen].map(([key, c]) => `.s-${key}{--st-bg:color-mix(in srgb,${c} 22%,var(--background));`
    + `--st-fg:color-mix(in srgb,${c} 78%,var(--foreground))}`).join('\n');
}
if (typeof document !== 'undefined') {
  onStructure((s) => {
    let style = document.getElementById('status-colors');
    if (!style) style = document.head.appendChild(Object.assign(document.createElement('style'), { id: 'status-colors' }));
    style.textContent = statusCss(s);
  });
}

/**
 * The Group → Status filter: a button that opens the vault's three groups with the statuses of `types` under each;
 * ticking a group ticks its statuses (half-ticked when only some are). `values` are the statuses ticked (none: any).
 * `onChange(statuses)` after every tick.
 */
export function statusTreeSelect(types, values, onChange, { any = 'Any status', ...attrs } = {}) {
  const ticked = new Set(values);
  const tree = () => statusTree(types).filter(([, , names]) => names.length);
  const label = () => {
    if (!ticked.size) return any;
    const whole = tree().filter(([, , names]) => names.every((n) => ticked.has(n)));
    const count = tree().reduce((n, [, , names]) => n + names.filter((x) => ticked.has(x)).length, 0);
    if (whole.length && whole.reduce((n, [, , names]) => n + names.length, 0) === count) return whole.map(([, l]) => l).join(' + ');
    return ticked.size === 1 ? String([...ticked][0]) : `${ticked.size} statuses`;
  };
  const face = h('span', { class: 'select-label' }, label());
  const btn = selectButton(face, attrs);
  const changed = () => { face.textContent = label(); onChange([...ticked]); };
  btn.addEventListener('click', () => {
    const boxes = [];
    const paint = () => boxes.forEach((b) => b());
    const rows = [];
    for (const [, groupLabel, names] of tree()) {
      const gbox = h('input', { type: 'checkbox', onchange: () => {
        names.forEach((n) => (gbox.checked ? ticked.add(n) : ticked.delete(n)));
        paint(); changed();
      } });
      boxes.push(() => {
        const n = names.filter((x) => ticked.has(x)).length;
        gbox.checked = n === names.length;
        gbox.indeterminate = n > 0 && n < names.length;
      });
      rows.push(h('label', { class: 'menu-item menu-check status-group' }, gbox, h('strong', {}, groupLabel)));
      for (const name of names) {
        const box = h('input', { type: 'checkbox', onchange: () => {
          if (box.checked) ticked.add(name); else ticked.delete(name);
          paint(); changed();
        } });
        boxes.push(() => { box.checked = ticked.has(name); });
        rows.push(h('label', { class: 'menu-item menu-check status-leaf' }, box, statusChip(name)));
      }
    }
    paint();
    dropdown(btn, rows.length ? rows : [h('span', { class: 'menu-item muted' }, 'No statuses')], { width: Math.max(btn.offsetWidth, 210) });
  });
  return btn;
}
/** The statuses of the open groups (Not started + In progress) of `types`: what "open" ticks. */
export const openStatuses = (types) => statusTree(types).filter(([g]) => g !== 'closed').flatMap(([, , names]) => names);

export const statusChip = (status) => h('span', { class: `chip status s-${cssKey(status)}` }, status);
export const priorityChip = (p) => h('span', { class: `chip prio pr-${cssKey(p)}` }, p);

/**
 * What a card shows besides its subject: status, priority and due date (a meeting its date, an activity
 * whether it is resolved). The parent is its own line (see itemCard); everything else lives in the item's card.
 */
export function chips(item, { hideStatus = false } = {}) {
  const f = item.fields;
  const out = [];
  if (PLANNABLE.has(item.type)) {
    if (!hideStatus && f.status) out.push(statusChip(f.status));
    out.push(priorityChip(f.priority || 'Normal'));
    if (f.due) out.push(h('span', { class: `chip due ${isOverdue(item) ? 'late' : ''}` }, icon('flag', 12), relDay(f.due)));
  }
  if (item.type === 'meeting' && f.date) out.push(h('span', { class: 'chip' }, icon('users', 12), relDay(f.date)));
  if (item.type === 'meeting' && f.time) out.push(h('span', { class: 'chip', title: `Starts at ${f.time}` }, icon('clock', 12), f.time));
  if (item.type === 'activity') {
    out.push(f.resolved_at ? h('span', { class: 'chip ok', title: `Resolved ${f.resolved_at}` }, icon('check', 12), 'resolved')
      : h('span', { class: 'chip warn' }, 'unresolved'));
  }
  return out;
}

/** The item this one hangs from, as a link that opens it (panel.js is loaded on click: it imports this file). */
function parentLink(item) {
  const p = item.fields.related_to && state.byId.get(item.fields.related_to);
  if (!p) return null;
  return h('button', {
    class: 'card-parent', title: `Open ${p.id} · ${p.title}`,
    ...opener(p, (it, e) => { e.stopPropagation(); import('./panel.js').then((m) => m.openItem(it.id)); }),
  }, typeIcon(p.type, 12), h('span', {}, p.title));
}

// ── item row / card ──────────────────────────────────────────────────────────
export function checkbox(item) {
  if (!PLANNABLE.has(item.type)) return h('span', { class: 'type-ico' }, typeIcon(item.type, 16));
  return h('button', {
    class: `check pr-${cssKey(item.fields.priority || 'Normal')} ${isDone(item) ? 'on' : ''}`,
    title: isDone(item) ? 'Reopen' : 'Close',
    onclick: (e) => { e.stopPropagation(); setCompleted(item, !isDone(item)); },
  }, isDone(item) ? icon('check', 12) : '');
}

export function itemCard(item, { onOpen, draggable = false, extra = null, hideParent = false, hideStatus = false, cls = '', titleAction = null } = {}) {
  const el = h('div', {
    class: `card t-${item.type} ${isDone(item) ? 'done' : ''} ${cls}`,
    'data-key': item.key,
    draggable: draggable ? 'true' : null,
    ...(onOpen ? opener(item, onOpen) : {}), // ⌘/Ctrl or middle click: in a new tab
  },
  checkbox(item),
  h('div', { class: 'card-body' },
    h('div', { class: 'card-head' },
      h('div', { class: 'card-title', title: item.title }, // the board truncates it: the full subject on hover
        item.type !== 'task' && PLANNABLE.has(item.type) ? h('span', { class: 'type-ico' }, typeIcon(item.type)) : null,
        item.title),
      titleAction),
    hideParent ? null : parentLink(item),
    h('div', { class: 'chips' }, chips(item, { hideStatus }))),
  extra ? h('div', { class: 'card-extra', onclick: (e) => e.stopPropagation() }, extra) : null);
  if (draggable) {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', item.key);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  }
  return el;
}

/**
 * Make `zone` accept dropped cards. onDrop(key, index) gets the position among
 * the zone's other `.card` children, computed from the pointer's Y.
 */
// Card drags carry the item key as text/plain; list drags (board) use their own type
// and must not light up card zones.
const isCardDrag = (e) => [...e.dataTransfer.types].includes('text/plain');

export function dropZone(zone, onDrop) {
  // Where the card would land among the zone's other cards, from the pointer's Y.
  const slot = (e, key = null) => {
    const cards = [...zone.querySelectorAll('.card')].filter((c) => !c.classList.contains('dragging') && c.dataset.key !== key);
    const index = cards.findIndex((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    return { cards, index: index < 0 ? cards.length : index };
  };
  const clear = () => {
    zone.classList.remove('drop-over', 'drop-end');
    zone.querySelectorAll('.drop-before').forEach((c) => c.classList.remove('drop-before'));
  };
  zone.addEventListener('dragover', (e) => {
    if (!isCardDrag(e)) return;
    e.preventDefault();
    const { cards, index } = slot(e);
    zone.querySelectorAll('.drop-before').forEach((c) => c !== cards[index] && c.classList.remove('drop-before'));
    zone.classList.add('drop-over');
    if (cards[index]) { cards[index].classList.add('drop-before'); zone.classList.remove('drop-end'); }
    else zone.classList.add('drop-end');
  });
  zone.addEventListener('dragleave', (e) => {
    if (!zone.contains(e.relatedTarget)) clear();
  });
  zone.addEventListener('drop', (e) => {
    if (!isCardDrag(e)) return;
    e.preventDefault();
    clear();
    const key = e.dataTransfer.getData('text/plain');
    if (!key) return;
    onDrop(key, slot(e, key).index);
  });
}

// ── dropdown menu (shadcn DropdownMenu) ─────────────────────────────────────
let openMenu = null;

export function closeMenu() {
  if (!openMenu) return;
  openMenu.el.remove();
  document.removeEventListener('mousedown', openMenu.outside, true);
  document.removeEventListener('keydown', openMenu.esc, true);
  openMenu.anchor.setAttribute('aria-expanded', 'false');
  openMenu = null;
}

/** A button that opens a menu but looks like a select (see select()); `label` is its text. */
export function selectButton(label, attrs = {}) {
  const { class: cls = '', ...rest } = attrs;
  return h('button', { type: 'button', 'aria-haspopup': 'menu', ...rest, class: `select-btn ${cls}` }, h('span', { class: 'select-text' }, label));
}

/**
 * Horizontal tabs. tabs: [{ key, label, count?, fill?, content: node | node[] }] (`fill`: the panel does not scroll,
 * its content fills it — a list that scrolls above a fixed composer). Returns the
 * tab bar followed by one panel per tab; switching only hides / shows panels, so
 * nothing re-renders and drafts survive. `active` is the tab shown first and
 * `onChange(key)` lets the caller remember the choice.
 */
export function tabPanels(tabs, active, onChange = () => {}) {
  const first = tabs.some((t) => t.key === active) ? active : tabs[0].key;
  const buttons = new Map();
  const panels = new Map();
  const show = (key, focus = false) => {
    for (const t of tabs) {
      const on = t.key === key;
      buttons.get(t.key).setAttribute('aria-selected', String(on));
      buttons.get(t.key).tabIndex = on ? 0 : -1;
      panels.get(t.key).hidden = !on;
      if (on) panels.get(t.key).dispatchEvent(new Event('tabshow'));
    }
    if (focus) buttons.get(key).focus();
    onChange(key);
  };
  const bar = h('div', { class: 'tabs-bar', role: 'tablist' }, tabs.map((t) => {
    const btn = h('button', { type: 'button', class: 'tab-btn', role: 'tab', 'aria-selected': 'false', onclick: () => show(t.key) },
      t.label, t.count ? h('span', { class: 'tab-count' }, t.count) : null);
    btn.addEventListener('keydown', (e) => {
      const i = tabs.findIndex((x) => x.key === t.key);
      if (e.key === 'ArrowRight') { e.preventDefault(); show(tabs[(i + 1) % tabs.length].key, true); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(tabs[(i - 1 + tabs.length) % tabs.length].key, true); }
    });
    buttons.set(t.key, btn);
    return btn;
  }));
  for (const t of tabs) panels.set(t.key, h('div', { class: `tab-panel ${t.fill ? 'fill' : ''}`, role: 'tabpanel' }, ...[t.content].flat()));
  for (const t of tabs) { // initial state without calling onChange
    buttons.get(t.key).setAttribute('aria-selected', String(t.key === first));
    buttons.get(t.key).tabIndex = t.key === first ? 0 : -1;
    panels.get(t.key).hidden = t.key !== first;
  }
  return [bar, ...panels.values()];
}

export const menuIsOpen = () => openMenu !== null;

/**
 * Open a menu under `anchor`. `items` are nodes, or { label, icon, kbd, onSelect,
 * danger, keepOpen } entries, or '-' for a separator. Clicking the anchor again closes it.
 */
export function dropdown(anchor, items, { align = 'start', width = null, focus = true, side = 'auto' } = {}) {
  if (openMenu && openMenu.anchor === anchor) { closeMenu(); return; }
  closeMenu();
  const el = h('div', { class: 'menu', role: 'menu', style: width ? `width:${width}px` : null });
  for (const it of items) {
    if (it === '-') el.append(h('div', { class: 'menu-sep' }));
    else if (it instanceof Node) el.append(it);
    else if (it && it.heading) el.append(h('div', { class: 'menu-label' }, it.heading));
    else if (it) {
      // `disabled`: shown greyed with its `title` saying why, still hoverable and focusable (aria-disabled, not
      // the attribute: a disabled button gets no hover, so no tooltip), and a click does nothing.
      const btn = h('button', {
        class: `menu-item ${it.danger ? 'danger' : ''}`, role: 'menuitem', title: it.title || null,
        'aria-disabled': it.disabled ? 'true' : null,
        onclick: (e) => { e.stopPropagation(); if (it.disabled) return; if (!it.keepOpen) closeMenu(); it.onSelect(btn); },
      }, it.icon ? icon(it.icon, 15) : null, h('span', {}, it.label), it.kbd ? h('kbd', {}, it.kbd) : null);
      el.append(btn);
    }
  }
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const left = align === 'end' ? r.right - w : r.left;
  el.style.left = `${Math.max(8, Math.min(left, innerWidth - w - 8))}px`;
  const below = r.bottom + 6;
  const above = Math.max(8, r.top - el.offsetHeight - 6);
  // `side: 'top'` always opens above (a button at a dialog's foot); else below, unless there is no room there.
  el.style.top = `${side === 'top' || below + el.offsetHeight > innerHeight - 8 ? above : below}px`;
  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); anchor.focus(); } };
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', esc, true);
  anchor.setAttribute('aria-expanded', 'true');
  openMenu = { el, anchor, outside, esc };
  if (focus) el.querySelector('button, input, select')?.focus();
}

export function emptyState(text) {
  return h('div', { class: 'empty' }, text);
}

export function section(title, items, opts = {}, actions = null) {
  if (!items.length && !opts.showEmpty) return null;
  return h('section', { class: `group ${opts.class || ''}` },
    h('header', {}, h('h3', {}, title, h('span', { class: 'count' }, items.length || '')), actions),
    items.length ? h('div', { class: 'cards' }, items.map((i) => itemCard(i, opts))) : emptyState(opts.emptyText || 'Nothing here.'));
}

export const byPriority = (a, b) =>
  (PRIORITY_RANK[a.fields.priority] || 3) - (PRIORITY_RANK[b.fields.priority] || 3) ||
  String(a.fields.due || '9999').localeCompare(String(b.fields.due || '9999')) ||
  String(a.fields.created_at || '').localeCompare(String(b.fields.created_at || ''));
