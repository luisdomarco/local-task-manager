// DOM helpers and shared components. Everything is built with createElement:
// titles come from files on disk, so nothing user-provided goes through innerHTML
// except rendered markdown, which is sanitized with DOMPurify.
import { relDay } from './dates.js';
import { EXTERNAL_REF, LABEL_MODES, PLANNABLE, PRIORITY_RANK, isDone, isOverdue, onStructure, statusTree } from './rules.js';
import { fitChips } from './chipfit.js';
import { tabLabel } from './tablabel.js';
import { pref, setPref } from './prefs.js';
import { opener } from './links.js';
import { allLabels, state, setCompleted } from './state.js';
import { refOf, shownId } from './shownid.js';
import { CARD_OFF, planText } from './viewmodel.js';
import { isPhone, isTouch, viewportHeight } from './phone.js';
import { useExtras } from './mdextras.js';

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
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  kanban: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7M12 7v4M16 7v9"/>',
  table: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  columns: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  // Ticketing's types: support (lifebuoy), hotfix (flame), error (alert), learning (lightbulb)
  lifebuoy: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.93 4.93 4.24 4.24M14.83 9.17l4.24-4.24M14.83 14.83l4.24 4.24M9.17 14.83l-4.24 4.24"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
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
  locate: '<path d="M2 12h3M19 12h3M12 2v3M12 19v3"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>',
  goal: '<path d="M12 13V2l8 4-8 4"/><path d="M20.561 10.222a9 9 0 1 1-12.55-5.29"/><path d="M8.002 9.997a5 5 0 1 0 8.9 2.02"/>',
  task: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  textcolour: '<path d="m6 15 6-12 6 12"/><path d="M8.5 10h7"/>',
  highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
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
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  // attachments (attachments.js)
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  minimize: '<path d="M6 18h12"/>',
  maximize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  zoomIn: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35M11 8v6M8 11h6"/>',
  restore: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  filter: '<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/>',
  sidebar: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  stop: '<rect width="12" height="12" x="6" y="6" rx="2" fill="currentColor"/>',
  // the sidebar's two modes and the Explorer's tree (sidebar.js, explorer.js)
  project: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><path d="M14 4h7M14 9h7M14 15h7M14 20h7"/>',
  foldertree: '<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M3 5a2 2 0 0 0 2 2h3"/><path d="M3 3v13a2 2 0 0 0 2 2h3"/>',
  folderopen: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  canvas: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>', // a whiteboard (canvas/)
  graph: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
  grip: '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
  // The Agents section (agentspane.js): its mode, an agent (a slash command), running one.
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  slash: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 15 6-6"/>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  play: '<path d="M6 4.5v15a1 1 0 0 0 1.5.87l12.5-7.5a1 1 0 0 0 0-1.74L7.5 3.63A1 1 0 0 0 6 4.5z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
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
/** A group of Contacts (TSK-050) by its name, or undefined. */
export const groupNamed = (name) => (state.groups || []).find((g) => g.name.toLowerCase() === String(name).toLowerCase());
/** Its icon: how the group is reached. */
export const GROUP_ICON = { email: 'mail', slack: 'message', other: 'users' };
/** A contact by name: a person (the people icon; on hover, the name Calendar gives them and their emails), or a group
 *  (its channel's icon; on hover, its address and members). Tinted as a label is, one hue per name (labelHue). */
export const personChip = (name, extra = null) => {
  const g = groupNamed(name);
  if (g) {
    const about = [`${name} (group)`, g.address, g.members.length ? `Members: ${g.members.join(', ')}` : null].filter(Boolean);
    return h('span', { class: 'chip person group', style: `--h:${labelHue(name.toLowerCase())}`, title: about.join('\n') }, icon(GROUP_ICON[g.channel] || 'users', 12), name, extra);
  }
  const p = state.people.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  const about = [name, p?.calendar_name && p.calendar_name !== name ? `Calendar: ${p.calendar_name}` : null, ...(p?.emails || []),
    p?.redmine ? `Redmine: ${p.redmine}` : null, p?.slack ? `Slack: ${p.slack}` : null].filter(Boolean);
  return h('span', { class: 'chip person', style: `--h:${labelHue(name.toLowerCase())}`, title: about.join('\n') }, icon('users', 12), name, extra);
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
        removeButton(`Remove ${l}`, (e) => { e.stopPropagation(); remove(l); }, { size: 'chip', keepFocus: true })), more);
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

/**
 * The label filter (TSK-052): a button that opens every label as a tick, and above them how several combine — any of
 * them (OR) or all of them (AND); it stays open while you tick. `labels` the picked ones (none = any label), `mode`
 * 'or' | 'and'; onChange({ labels, mode }). With no label in the vault and none picked, an empty span (callers leave it out).
 */
export function labelFilter(labels, mode, onChange) {
  const names = [...new Set([...allLabels(), ...labels])];
  if (!names.length) return h('span');
  const ticked = new Set(labels);
  let how = mode === 'and' ? 'and' : 'or';
  const picked = () => names.filter((l) => ticked.has(l));
  const label = () => {
    const p = picked();
    if (!p.length) return 'Any label';
    if (p.length === 1) return `#${p[0]}`;
    return p.length === 2 ? `#${p[0]} ${how} #${p[1]}` : `${p.length} labels · ${how === 'and' ? 'all' : 'any'}`;
  };
  const face = h('span', { class: 'select-label' }, label());
  const btn = selectButton(face, { 'aria-label': 'Label', title: 'Filter by labels' });
  const changed = () => { face.textContent = label(); onChange({ labels: picked(), mode: how }); };
  btn.addEventListener('click', () => {
    let modes = h('span');
    const paintModes = () => {
      const next = seg(Object.entries(LABEL_MODES).map(([m, text]) => [m, text,
        { tip: m === 'and' ? 'Items that carry every ticked label' : 'Items that carry at least one ticked label' }]), how,
      (m, e) => { e.stopPropagation(); if (how === m) return; how = m; paintModes(); if (ticked.size > 1) changed(); else face.textContent = label(); },
      { aria: 'When several labels are ticked', role: 'radiogroup', cls: 'label-mode' });
      modes.replaceWith(next);
      modes = next;
    };
    paintModes();
    const row = (l) => {
      const box = h('input', { type: 'checkbox', checked: ticked.has(l), onchange: () => {
        if (box.checked) ticked.add(l); else ticked.delete(l);
        changed();
      } });
      return h('label', { class: 'menu-item menu-check' }, box, labelChip(l));
    };
    dropdown(btn, [h('div', { class: 'menu-field' }, h('span', {}, 'Match'), modes), '-', ...names.map(row)],
      { width: Math.max(btn.offsetWidth, 240) });
  });
  return btn;
}

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
  if (!noSetext) {
    plainUnderlines(window.marked);
    // Obsidian's callouts, ==highlights== and #tags, and each table in a box that scrolls sideways (mdextras.js)
    useExtras(window.marked, { iconSvg: (name) => icon(name, 16).outerHTML });
    noSetext = true;
  }
  // Sanitize last: what DOMPurify returns goes to the page as is, never parsed and serialized again (mutation XSS).
  return window.DOMPurify.sanitize(mentionChips(window.marked.parse(md || '', { breaks: true })));
}

const MENTION_RE = /@\[([^[\]\n]{1,80})\]/g;
const NO_CHIPS = 'code, pre, a, textarea, title, style, script, noscript, xmp, iframe, noembed, noframes, plaintext';

/**
 * @[Name] in rendered Markdown → the person's chip (dashed when nobody in Contacts has that name); never inside code,
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
    const known = state.people.some((p) => p.name.toLowerCase() === name.toLowerCase()) || !!groupNamed(name);
    const chip = personChip(name);
    chip.classList.add('mention');
    if (!known) { chip.classList.add('unknown'); chip.title = `${name} — not in Contacts`; }
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
 * [value, label, iconName] to draw an icon beside the label (a null value is the "none / any" row), or { heading } for
 * a label over the options after it (left out while searching), `.value` reads and writes the selected value
 * ('' for none) and onChange(value | null) fires when the user picks a different one.
 * attrs: class, aria-label, data-fk… as on any element, plus `search: true | false` to
 * force the search field on or off (default: on from 11 options), and `clearable: true` for an × beside
 * the button that empties it (shown only while something is picked; the returned element is then a
 * wrapper with the same `.value`), and `face: [icon, text]` for a menu button: it always reads that, whatever is
 * picked (Docs' "+ Link a doc or folder": pick one and it is linked, the button stays as it was), and
 * `menuWidth: (btn) => px` for a list wider than the button (that one's: the panel's width).
 */
/** The picked option's check. Classic shows it; Modern hides it for Basecoat's, a background of [aria-selected] (app.css). */
const optCheck = () => { const svg = icon('check', 14); svg.classList.add('opt-check'); return svg; };

export function select(options, value, onChange, attrs = {}) {
  const { class: cls = '', search, clearable = false, face: fixed = null, menuWidth = null, ...rest } = attrs;
  const tone = /\bstatus-select\b/.test(cls) ? { prefix: 's-', kind: 'status' }
    : /\bprio-select\b/.test(cls) ? { prefix: 'pr-', kind: 'prio' }
      : /\bkind-select\b/.test(cls) ? { prefix: 'k-', kind: 'kind' } : null; // work-log kinds: the coloured square
  let current = value ?? null;
  const choices = options.filter(Array.isArray); // the headings ({ heading }) are only drawn in the menu
  const optionOf = (v) => choices.find(([ov]) => (ov ?? null) === (v ?? null)) || [null, ''];
  const readable = (text) => (tone?.kind === 'status' ? statusLabel(text) : text); // a status reads as statusLabel says
  const face = ([, text, ico]) => [ico ? icon(ico, 14) : null, readable(text)]; // an option's icon + label

  const label = h('span', { class: 'select-label' });
  // Hidden copy of every label: the button is as wide as the longest one, so it never resizes on pick.
  const sizer = fixed ? null : h('span', { class: 'select-sizer', 'aria-hidden': 'true' }, choices.map((o) => h('span', {}, ...face(o))));
  const btn = h('button', { type: 'button', 'aria-haspopup': 'listbox', ...rest, class: `select-btn ${cls}` },
    h('span', { class: 'select-text' }, label, sizer));

  const clear = clearable ? h('button', { type: 'button', class: 'btn icon select-clear', title: 'Clear', 'aria-label': 'Clear' }, icon('x', 12)) : null;
  const paint = () => {
    label.replaceChildren(...(fixed ? face([null, fixed[1], fixed[0]]) : face(optionOf(current))).filter((x) => x !== null));
    if (clear) clear.hidden = current == null;
    if (!tone) { btn.classList.toggle('is-empty', !fixed && current == null); return; } // "— none —", "Search an item…": grey (app.css)
    [...btn.classList].filter((c) => /^(s|pr|k)-/.test(c)).forEach((c) => btn.classList.remove(c));
    btn.classList.add(`${tone.prefix}${cssKey(current || (tone.kind === 'status' ? 'Backlog' : 'Normal'))}`);
  };
  Object.defineProperty(btn, 'value', {
    get: () => current ?? '',
    set: (v) => { current = v === '' || v == null ? null : v; paint(); },
  });
  paint();

  const open = () => {
    const searchable = search ?? choices.length > 10;
    const list = h('div', { class: 'menu-list', role: 'listbox', 'aria-label': rest['aria-label'] || null });
    const input = searchable
      ? touchSearch(h('input', { type: 'search', class: 'small', placeholder: 'Search…', 'aria-label': 'Search options', autocomplete: 'off' })) : null;
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
      const shown = options.filter((o) => (Array.isArray(o) ? !q || o[0] == null || (o[1].toLowerCase().includes(q) || readable(o[1]).toLowerCase().includes(q)) : !q)); // the none row stays: a way out while searching
      list.replaceChildren(...(shown.some(Array.isArray) ? shown.map((o) => {
        if (!Array.isArray(o)) return h('div', { class: 'menu-label', role: 'presentation' }, o.heading);
        const [v, l, ico] = o;
        const picked = (v ?? null) === current;
        const text = tone ? h('span', {}, h('span', { class: `chip ${tone.kind} ${tone.prefix}${cssKey(v)}` }, readable(l))) : h('span', {}, l);
        const lead = ico ? icon(ico, 15) : null;
        return h('button', {
          type: 'button', role: 'option', 'aria-selected': String(picked), class: `menu-item ${picked ? 'current' : ''}`,
          onclick: () => choose(v),
        }, lead, text, picked ? optCheck() : null);
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
      { width: Math.max(menuWidth?.(btn) || btn.offsetWidth, 180), focus: false });
    // The search when there is one, but not where its keyboard would pop up unasked (a touch screen, a phone):
    // there the picked row (a tap on the search brings the keyboard).
    ((input && !keyboardShy() ? input : null) || list.querySelector('.current') || rows()[0])?.focus();
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
    .map((i) => [i.id, `${refOf(i)} · ${i.title}`]),
];

// ── chips ────────────────────────────────────────────────────────────────────
/** A status or priority as a class name: `s-${cssKey(status)}` ("In QA" → s-in-qa). */
export const cssKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/**
 * How a status reads on screen: its stored name split where the case changes and in sentence case
 * ("InProgress" → "In progress", "ToDo" → "To do", "open" → "Open"; an acronym stays: "In QA"). Only what is shown: the file keeps its own name.
 */
export const statusLabel = (s) => String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim()
  .split(/\s+/).filter(Boolean)
  .map((w, i) => (/^[A-Z0-9]{2,}$/.test(w) ? w : i ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())) // QA stays QA
  .join(' ');

// ── status colours (TSK-037) ─────────────────────────────────────────────────
// The eight statuses the folder-per-type structure was built with have their pill colours in app.css (.s-*, light and dark). Any other status
// (an agent's, an error's, one a vault added) and any a vault gave a colour (Settings → Statuses) get theirs
// here, from one hue: the fill is the hue over the background, the text the hue towards the foreground, so it reads
// in both themes.
const BUILT_IN = { backlog: '#8a8f98', todo: '#1a73e8', onhold: '#e3a008', blocked: '#d93025', inprogress: '#e8710a',
  review: '#8e44ad', done: '#1e8e3e', discarded: '#6e4a33' };
const PALETTE = ['#1a73e8', '#e8710a', '#8e44ad', '#0d9488', '#db2777', '#65a30d', '#0891b2', '#b45309'];
const hash = (s) => [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
/** The hue a status shows in (what Settings → Statuses starts its colour picker at). */
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
    + `--st-fg:color-mix(in srgb,${c} 78%,var(--foreground));--st-dot:${c}}`).join('\n');
}
if (typeof document !== 'undefined') {
  onStructure((s) => {
    let style = document.getElementById('status-colors');
    if (!style) style = document.head.appendChild(Object.assign(document.createElement('style'), { id: 'status-colors' }));
    style.textContent = `@layer app {\n${statusCss(s)}\n}`; // after app.css, in its layer (css/main.css)
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
    return ticked.size === 1 ? statusLabel([...ticked][0]) : `${ticked.size} statuses`;
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

/** A status's chip, its name as statusLabel reads it (`raw`: the stored name, where that name is what is being edited). */
export const statusChip = (status, { raw = false } = {}) => h('span', { class: `chip status s-${cssKey(status)}`, title: raw || statusLabel(status) === String(status || '') ? null : String(status) }, raw ? status : statusLabel(status));
export const priorityChip = (p) => h('span', { class: `chip prio pr-${cssKey(p)}` }, p);

/**
 * What a card shows besides its subject: status, priority and due date (a meeting its date, an activity
 * whether it is resolved). The parent is its own line (see itemCard);
 * everything else lives in the item's card.
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
    class: 'card-parent', title: `Open ${refOf(p)} · ${p.title}`,
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

/**
 * A card of a list's board (views/list.js as a board; docs/design.md §3): its done box, a subject of two lines at
 * most, a grey line with what it hangs from (its initiative or parent, else its project), and one row of priority,
 * ID, planned (red when late), due, the tracker's ticket and labels. No status (its column says it), no framed chips.
 * `shows(key)` says which it carries (Display → Show on cards: viewmodel.js cardProps / cardShows).
 * Planning's boards (planrows.js planCard) leave out the ID (`id: false`) and the plan where the column says it
 * (`plan: false`), add what they say of it (`meta`: due, done) and a move at its right (`action`: carried over → now).
 */
function boardCard(item, { onOpen, projectName = (k) => k, shows = (k) => !CARD_OFF.has(k), id = true, plan: showPlan = true, meta = [], action = null, status = null }) {
  const p = shows('parent') && item.fields.related_to && state.byId.get(item.fields.related_to);
  const proj = item.fields.project && (shows('project') || (shows('parent') && !p)) ? projectName(item.fields.project) : null;
  const where = [
    ...(p ? [typeIcon(p.type, 12), h('span', {}, p.title)] : []),
    ...(proj ? [p ? h('span', { class: 'card-where-sep', 'aria-hidden': 'true' }, '·') : typeIcon('project', 12), h('span', {}, proj)] : []),
  ];
  const plan = planText(item.fields);
  const labels = shows('labels') && Array.isArray(item.fields.labels) ? item.fields.labels : [];
  const ref = shows('extref') && EXTERNAL_REF.id_key ? item.fields[EXTERNAL_REF.id_key] : null;
  return h('div', {
    class: `card board-card t-${item.type} ${isDone(item) ? 'done' : ''}`, 'data-key': item.key,
    ...(onOpen ? opener(item, onOpen) : {}),
  },
  checkbox(item),
  h('div', { class: 'card-body' },
    h('div', { class: 'card-title', title: item.title }, item.title),
    where.length ? h('div', { class: 'card-where', title: [p ? `${refOf(p)} · ${p.title}` : null, proj].filter(Boolean).join(' · ') }, ...where) : null,
    h('div', { class: 'card-meta' }, ...[
      (status ?? shows('status')) && item.fields.status ? statusChip(item.fields.status) : null, // its status, then its priority (as a list's columns)
      shows('priority') && item.fields.priority ? priorityChip(item.fields.priority) : null,
      id && shows('id') ? h('span', { class: 'mono' }, shownId(item)) : null,
      showPlan && shows('plan') && PLANNABLE.has(item.type) && !plan.none ? h('span', { class: plan.late ? 'late-text' : '', title: plan.late ? `Planned ${plan.since}` : null }, plan.text) : null,
      shows('due') && item.fields.due ? h('span', { class: isOverdue(item) ? 'late-text' : '', title: `Due ${item.fields.due}` }, `Due ${relDay(item.fields.due)}`) : null,
      ref ? h('span', { class: 'mono', title: `${EXTERNAL_REF.label} #${ref}` }, `#${ref}`) : null,
      ...meta,
      ...labels.map((l) => h('span', { class: 'card-label' }, `#${l}`)),
      action ? h('span', { class: 'card-act' }, action) : null,
    ].filter(Boolean))));
}

export function itemCard(item, { onOpen, draggable = false, extra = null, hideParent = false, hideStatus = false, cls = '', variant = null, projectName, shows, board = {} } = {}) {
  const el = variant === 'board' ? boardCard(item, { onOpen, projectName, shows, ...board }) : h('div', {
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
        item.title)),
    hideParent ? null : parentLink(item),
    h('div', { class: 'chips' }, chips(item, { hideStatus }))),
  extra ? h('div', { class: 'card-extra', onclick: (e) => e.stopPropagation() }, extra) : null);
  if (draggable) {
    el.setAttribute('draggable', 'true');
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
 * the zone's other cards or rows (anything with a `data-key`: a `.card`, a planrows.js `.plan-row`), from the pointer's Y.
 */
// Card drags carry the item key as text/plain; list drags (board) use their own type
// and must not light up card zones.
const isCardDrag = (e) => [...e.dataTransfer.types].includes('text/plain');

export function dropZone(zone, onDrop) {
  // Where the card would land among the zone's other cards, from the pointer's Y.
  const slot = (e, key = null) => {
    const cards = [...zone.querySelectorAll('[data-key]')].filter((c) => !c.classList.contains('dragging') && c.dataset.key !== key);
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

// ── floating: what opens over the page from a button ───────────────────────────
// Two layers, one open in each: a 'menu' (dropdown(), and select()'s and the date picker's lists, which are one) may
// open from inside a 'panel' (the view bar's popover, itemPicker, Add existing session) and closes alone; opening a
// panel closes whatever was open. One Esc closes the top one and gives the focus back to its button; one click outside
// closes it — a click in a menu the panel opened is not outside the panel.
const layers = { menu: null, panel: null };
/** The phone layout (≤760px, as app.css's): what floats opens centred. */
const PHONE_POP = typeof matchMedia === 'function' ? matchMedia('(max-width: 760px)') : { matches: false };

function onFloatingDown(e) {
  const t = e.target;
  if (t.classList?.contains('float-backdrop')) return; // a phone's backdrop: its click closes what it covers (floating)
  const { menu, panel } = layers;
  if (menu && !menu.el.contains(t) && !menu.anchor.contains(t)) closeFloating('menu');
  if (panel && !panel.el.contains(t) && !panel.anchor.contains(t) && !t.closest?.('.menu')) closeFloating('panel');
}
function onFloatingKey(e) {
  const top = layers.menu || layers.panel;
  if (e.key !== 'Escape' || !top) return;
  e.stopPropagation(); // not the card's or the dialog's Esc
  e.preventDefault();
  if (top.onEsc?.()) return; // it stepped back inside itself
  closeFloating(top.layer);
  top.anchor.focus();
}

/** Close what is open in `layer` ('menu' or 'panel'), if anything. */
export function closeFloating(layer = 'menu') {
  const f = layers[layer];
  if (!f) return;
  layers[layer] = null;
  f.el.remove();
  f.backdrop?.remove();
  f.unwatch?.();
  f.anchor.setAttribute('aria-expanded', 'false');
  if (!layers.menu && !layers.panel) {
    document.removeEventListener('mousedown', onFloatingDown, true);
    document.removeEventListener('keydown', onFloatingKey, true);
  }
  f.onClose?.();
}
export const closeMenu = () => closeFloating('menu');
/** Where a text field focused unasked would bring up a keyboard over what just opened: a narrow window (the phone
 *  layout) or any touch screen. A tap on the field brings it up. */
export const keyboardShy = () => PHONE_POP.matches || isTouch();
/** Focus the first `selector` in something that just opened over the page; on a phone or a touch screen not when it is
 *  a text field, whose keyboard would cover the popup at once (keyboardShy). */
export function focusFirst(el, selector) {
  const target = el.querySelector(selector);
  if (target && !(keyboardShy() && target.matches('input:not([type=checkbox], [type=radio]), textarea'))) target.focus();
}
/** Is what `layer` holds the one `anchor` opened? Its button pressed again closes it (`if (floatingFrom(b)) …`). */
export const floatingFrom = (anchor, layer = 'menu') => layers[layer]?.anchor === anchor;

/**
 * Show `el` (a `.menu`) over the page from `anchor`, in `layer`: the one there before closes (and, for a panel, the open
 * menu too). Placed under the button at its left (`align: 'end'`: its right), above it when there is no room under it
 * (`side: 'top'`: always), else moved up into view. `grow`: its rows change with a search, so it is anchored by the
 * edge nearest the button and grows away from it, keeping `grow` px of room. `onEsc()` → true when Esc was for
 * something inside it; `onClose()` runs however it closes. → { el, place() } (place() again when its size changed).
 */
export function floating(anchor, el, { layer = 'menu', align = 'start', side = 'auto', grow = 0, onEsc = null, onClose = null } = {}) {
  closeFloating('menu');
  if (layer === 'panel') closeFloating('panel');
  // A phone (phone.js): the page under it is dimmed by a real element, not app.css's shadow, so a tap on the dim only
  // closes it — the click it makes lands on the backdrop, never on the row under it. Taps go to it, not the page.
  const backdrop = isPhone() ? h('div', { class: 'float-backdrop', 'aria-hidden': 'true' }) : null;
  if (backdrop) {
    backdrop.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeFloating(layer); });
    document.body.append(backdrop);
  }
  document.body.append(sideSized(el, anchor));
  const place = () => {
    // A phone: in the middle of the screen over the dimmed page (app.css .menu.centered), not under a button a thumb
    // covers; one whose rows change with a search keeps its top still, high enough to stay clear of the keyboard.
    // The height is the visual viewport's: what the keyboard leaves (phone.js).
    el.classList.toggle('centered', PHONE_POP.matches);
    if (PHONE_POP.matches) {
      const high = backdrop ? viewportHeight() : innerHeight;
      el.style.left = `${Math.max(8, (innerWidth - el.offsetWidth) / 2)}px`;
      el.style.bottom = '';
      el.style.top = `${Math.round(grow ? high * 0.12 : Math.max(8, (high - el.offsetHeight) / 2))}px`;
      return;
    }
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    el.style.left = `${Math.max(8, Math.min(align === 'end' ? r.right - w : r.left, innerWidth - w - 8))}px`;
    el.style.top = el.style.bottom = '';
    if (grow) {
      if (r.bottom + 6 + grow > innerHeight - 8) el.style.bottom = `${innerHeight - r.top + 6}px`;
      else el.style.top = `${r.bottom + 6}px`;
      return;
    }
    const tall = el.offsetHeight;
    const below = r.bottom + 6;
    const above = r.top - 6 - tall;
    el.style.top = `${side === 'top' ? Math.max(8, above)
      : below + tall <= innerHeight - 8 ? below
        : above >= 8 ? above
          : Math.max(8, innerHeight - tall - 8)}px`;
  };
  place();
  if (!layers.menu && !layers.panel) {
    document.addEventListener('mousedown', onFloatingDown, true);
    document.addEventListener('keydown', onFloatingKey, true);
  }
  // On a phone the keyboard coming or going moves the middle of what is left: placed again.
  const vv = backdrop ? window.visualViewport : null;
  vv?.addEventListener('resize', place);
  const unwatch = vv ? () => vv.removeEventListener('resize', place) : null;
  layers[layer] = { layer, el, anchor, onEsc, onClose, backdrop, unwatch };
  anchor.setAttribute('aria-expanded', 'true');
  return { el, place };
}

/** A button that opens a menu but looks like a select (see select()); `label` is its text. */
export function selectButton(label, attrs = {}) {
  const { class: cls = '', ...rest } = attrs;
  return h('button', { type: 'button', 'aria-haspopup': 'menu', ...rest, class: `select-btn ${cls}` }, h('span', { class: 'select-text' }, label));
}

/**
 * Horizontal tabs. tabs: [{ key, label, count?, fill?, onShow?, content: node | node[] }] (`fill`: the panel does not
 * scroll, its content fills it — a list that scrolls above a fixed composer; `onShow()`: called each time it shows, the
 * first one too, so a heavy panel is built only once it is looked at). Returns the
 * tab bar followed by one panel per tab; switching only hides / shows panels, so
 * nothing re-renders and drafts survive. `active` is the tab shown first and
 * `onChange(key)` lets the caller remember the choice. A name longer than TAB_LABEL_MAX is cut (tablabel.js), and
 * said whole on hover; each button carries its tab's key (`data-tab`), as its panel does.
 * `more`: the tabs folded out of the bar ([{ key, label, count? }], tabfold.js), offered by a "+" after the others (before
 * a `pinned` one); picking one calls `onMore(key)`, which shows it (the caller draws the bar again with it in).
 */
export function tabPanels(tabs, active, onChange = () => {}, { more = [], onMore = () => {} } = {}) {
  const first = tabs.some((t) => t.key === active) ? active : tabs[0].key;
  const buttons = new Map();
  const panels = new Map();
  const show = (key, focus = false) => {
    for (const t of tabs) {
      const on = t.key === key;
      buttons.get(t.key).setAttribute('aria-selected', String(on));
      buttons.get(t.key).tabIndex = on ? 0 : -1;
      panels.get(t.key).hidden = !on;
      if (on) { panels.get(t.key).dispatchEvent(new Event('tabshow')); t.onShow?.(); }
    }
    if (focus) buttons.get(key).focus();
    buttons.get(key).scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); // a row that scrolls sideways shows the tab picked
    onChange(key);
  };
  const bar = h('div', { class: 'tabs-bar', role: 'tablist' }, tabs.map((t) => {
    const { text, full } = tabLabel(t.label);
    const btn = h('button', {
      type: 'button', class: `tab-btn${t.apart ? ' apart' : ''}`, role: 'tab', 'aria-selected': 'false', 'data-tab': t.key, title: full,
      'aria-label': full && (t.count ? `${full} ${t.count}` : full), // the whole name for a screen reader too
      onclick: () => show(t.key),
    }, h('span', { class: 'tab-label' }, text), t.count ? countOf(t.count, { tab: true }) : null);
    // Short of room a tab narrows and its name is cut by the CSS too: then it is said whole on hover as well.
    const cut = () => { const l = btn.firstChild; btn.title = full || (typeof text === 'string' && l.scrollWidth > l.clientWidth ? text : ''); };
    btn.addEventListener('mouseenter', cut);
    btn.addEventListener('focus', cut);
    btn.addEventListener('keydown', (e) => {
      const i = tabs.findIndex((x) => x.key === t.key);
      if (e.key === 'ArrowRight') { e.preventDefault(); show(tabs[(i + 1) % tabs.length].key, true); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(tabs[(i - 1 + tabs.length) % tabs.length].key, true); }
    });
    buttons.set(t.key, btn);
    return btn;
  }));
  if (more.length) {
    const names = more.map((t) => t.label).join(', ');
    const plus = h('button', {
      type: 'button', class: 'tab-btn tab-more', title: `More tabs: ${names}`, 'aria-label': `More tabs: ${names}`, 'aria-haspopup': 'menu',
      onclick: () => dropdown(plus, more.map((t) => ({ label: t.label, count: t.count || null, onSelect: () => onMore(t.key) })),
        { width: 200 }),
    }, icon('plus', 14));
    bar.insertBefore(plus, [...buttons.values()].find((b) => tabs.find((t) => t.key === b.dataset.tab)?.pinned) || null);
  }
  // A row wider than its room scrolls sideways (its bar hidden): the side with more fades out (app.css), and the wheel
  // scrolls it as well as a trackpad does.
  const edges = () => {
    bar.classList.toggle('more-left', bar.scrollLeft > 1);
    bar.classList.toggle('more-right', bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1);
  };
  bar.addEventListener('scroll', edges, { passive: true });
  bar.addEventListener('wheel', (e) => {
    if (bar.scrollWidth <= bar.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    bar.scrollLeft += e.deltaY;
  }, { passive: false });
  if (typeof ResizeObserver === 'function') new ResizeObserver(edges).observe(bar);
  for (const t of tabs) panels.set(t.key, h('div', { class: `tab-panel ${t.fill ? 'fill' : ''}`, role: 'tabpanel', 'data-tab': t.key }, ...[t.content].flat()));
  for (const t of tabs) { // initial state without calling onChange
    buttons.get(t.key).setAttribute('aria-selected', String(t.key === first));
    buttons.get(t.key).tabIndex = t.key === first ? 0 : -1;
    panels.get(t.key).hidden = t.key !== first;
    if (t.key === first) t.onShow?.();
  }
  return [bar, ...panels.values()];
}

export const menuIsOpen = () => layers.menu !== null;

/** A menu, list or calendar opened from the side panel of a card or page is drawn at the panel's one text size
 *  (app.css .menu-side: Classic's; Modern draws it as any other), though it lives on the body. */
export function sideSized(el, anchor) {
  if (anchor?.closest?.('.im-side.tabbed')) el.classList.add('menu-side');
  return el;
}

/**
 * Open a menu under `anchor`. `items` are nodes, or { label, icon, kbd, count, onSelect,
 * danger, keepOpen } entries, or '-' for a separator. Clicking the anchor again closes it. `kbd` is a shortcut (a
 * keycap); `count` a number of things, the grey `.count` pill the tabs and the sidebar use.
 */
export function dropdown(anchor, items, { align = 'start', width = null, focus = true, side = 'auto' } = {}) {
  if (floatingFrom(anchor)) { closeMenu(); return; }
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
      }, it.icon ? icon(it.icon, 15) : null, h('span', {}, it.label), it.kbd ? h('kbd', {}, it.kbd) : null, it.count ? h('span', { class: 'count' }, String(it.count)) : null);
      el.append(btn);
    }
  }
  floating(anchor, el, { align, side }); // `side: 'top'`: a button at a dialog's foot
  if (focus) focusFirst(el, 'button, input, select');
}

/**
 * A header that folds what is under it (design.md §Fold heads): one button — a chevron (14px; 12 in a sidebar-like
 * tree, `small`), its icon, its name (a string, or nodes), its count — with `aria-expanded` and a tooltip that says
 * what a click does. The caller keeps whether it is open (a pref, a Set, a view's state) and redraws on
 * `onToggle(open)`; `class` names the place (its type size and room in app.css), never another hover or chevron.
 * `attrs` go on the button (aria-controls, disabled…); `what` is the tooltip's noun when the name is not a string.
 */
export function foldHead({ open, title, onToggle, ico = null, count = null, small = false, what = null, tip = null, class: cls = '', attrs = {} }) {
  const noun = what ?? (typeof title === 'string' ? title.toLowerCase() : null);
  return h('button', {
    type: 'button', ...attrs, class: `fold-head ${cls}`.trim(), 'aria-expanded': String(!!open),
    title: tip ?? (noun ? `${open ? 'Hide' : 'Show'} ${noun}` : null),
    onclick: (e) => onToggle(!open, e),
  }, icon(open ? 'down' : 'right', small ? 12 : 14), typeof ico === 'string' ? icon(ico, small ? 13 : 15) : ico,
  typeof title === 'string' ? h('span', { class: 'fold-title' }, title) : title,
  count === null || count === undefined || count === '' ? null : countOf(count, { tab: true }));
}

/**
 * The search of a page's bar (the view bar's): a muted box with a magnifier around a search input — Work log, Labels,
 * Contacts, Trash, Docs. Returns the box; the input keeps its own listeners.
 */
export function searchBox(input) {
  input.classList.add('vb-search');
  touchSearch(input);
  return h('label', { class: 'vb-search-box' }, icon('search', 14), input);
}

/** A search field on a touch screen (phone.js): its key says Search, and nothing is corrected or capitalised (an id, a
 *  name). A computer's field is left as it is. Returns `input`. */
export function touchSearch(input) {
  if (!isTouch()) return input;
  Object.assign(input, { enterKeyHint: 'search', autocapitalize: 'off', spellcheck: false });
  input.setAttribute('autocorrect', 'off');
  return input;
}

/**
 * A page's head, a list's (views/list.js): its title with a grey count on the baseline (`count`, an element the page
 * fills), then its primary action at the right. Work log, Labels, Contacts, Trash, Settings.
 */
export function pageHead({ title, count = null, action = null }) {
  return h('header', { class: 'view-head row' },
    h('div', { class: 'view-title' }, h('h1', {}, title), count), h('span', { class: 'spacer' }), action);
}
/** A page's count, for pageHead: grey, on the title's baseline. */
export const pageCount = () => countOf(null, { plain: true, cls: 'view-count' });
/** A page with nothing to show: a quiet grey line where its rows go, no box (a list's empty row). */
export const pageEmpty = (text) => h('p', { class: 'page-empty' }, text);

export function emptyState(text) {
  return h('div', { class: 'empty' }, text);
}
/** Nothing here, inside a panel, a tab or a group: one grey line, no box (`emptyState` is a whole page's). `cls` only
 *  places it (an indent, an overlay). */
export const emptyLine = (text, { cls = '' } = {}) => h('p', { class: `child-empty ${cls}`.trim() }, text);
/** Being read: the same grey line, announced to a screen reader. A whole page's too (`views/detail.js`). */
export const loadingLine = (text = 'Loading…', { cls = '' } = {}) =>
  h('p', { class: `child-empty is-loading ${cls}`.trim(), role: 'status', 'aria-busy': 'true' }, text);

/**
 * A property row (docs/design.md → Properties): its name in grey, then its control, in a `prop-rows` list. `tag`
 * 'label' when the control is one field (a click on the name focuses it), 'div' for a group of controls or a value
 * that is only read; `help` a grey line under the control (Settings); `wide` takes the whole row of a two-column grid;
 * `attrs` the row's own (a `title`, a `role`).
 */
export function propRow(label, control, { tag = 'label', help = null, wide = false, cls = '', attrs = {} } = {}) {
  return h(tag, { ...attrs, class: `field${wide ? ' wide' : ''} ${cls}`.trim() }, h('span', {}, label),
    help ? h('div', { class: 'set-control' }, control, h('p', { class: 'muted small set-help' }, help)) : control);
}

/**
 * A form's actions, or a confirm's (docs/design.md → Forms): `lead` at the left (the keys, what will happen, a Delete),
 * then Cancel — always a ghost button — and the caller's `actions` at the right, the last one primary (or danger).
 * `small` in a panel, a row or a table; regular in a dialog. → `div.form-actions`.
 */
export function formActions({ lead = null, onCancel = null, cancelLabel = 'Cancel', actions = [], small = false, cls = '' }) {
  return h('div', { class: `form-actions ${cls}`.trim() }, ...[lead].flat(), h('span', { class: 'spacer' }),
    onCancel ? h('button', { type: 'button', class: `btn ghost${small ? ' small' : ''}`, onclick: onCancel }, cancelLabel) : null,
    ...[actions].flat());
}

/** A button that reads as a link: underlined text, no box. `muted` greys it until hover (a line under a table). */
export const linkButton = (text, onClick, { muted = false, cls = '', attrs = {} } = {}) =>
  h('button', { type: 'button', ...(onClick ? { onclick: onClick } : {}), ...attrs, class: `link${muted ? ' muted' : ''} ${cls}`.trim() }, ...[text].flat());

/** *Show 3 closed* / *Hide closed* under a group or a day: `n` closed, `noun` the type's word ("closed", "done"). */
export const closedToggle = ({ n, shown, noun = 'closed', onToggle, cls = '' }) =>
  linkButton(shown ? `Hide ${noun}` : `Show ${n} ${noun}`, () => onToggle(!shown), { muted: true, cls: `closed-toggle ${cls}`.trim(),
    attrs: { 'aria-pressed': String(!!shown) } });

// ── Dialog: the one `#modal` (index.html), opened and closed the same way everywhere (docs/design.md → Dialogs) ──

/** Keep Tab inside a dialog (`#modal`, `#item-modal`). */
export function trapFocus(root, e) {
  const els = [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!els.length) return;
  const first = els[0]; const last = els[els.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

let openOne = null; // the dialog on screen: a new one closes it first, and keeps its opener

/**
 * Open `#modal`: a `.modal-head` (icon, title, `head` nodes, the ✕), `body`, a `.modal-foot` of `foot` nodes. Tab stays
 * inside; Esc, the ✕ and a press on the backdrop close it, unless `dismissable()` says no (a save in flight); the focus
 * goes back to what opened it. `title: null` leaves the head to the caller (the create form's own frame); so does an
 * empty `body`, filled later through `modal`. `onKey(e)` sees every key first (⌘↵ to save). `focus` is the element (or
 * a function) to focus once it's drawn; the ✕ without one. → `{ modal, close(value) }`; `onClose(value)` runs once,
 * after it closes (`value` undefined when dismissed).
 */
export function openDialog({ title = null, ico = null, label = null, cls = '', head = [], body = [], foot = null,
  focus = null, onKey = null, onClose = null, dismissable = () => true }) {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  const opener = openOne ? openOne.opener : document.activeElement;
  if (openOne) openOne.close(undefined, { refocus: false });
  let closed = false;
  const close = (value, { refocus = true } = {}) => {
    if (closed) return;
    closed = true;
    if (openOne === self) openOne = null;
    backdrop.hidden = true;
    backdrop.onmousedown = null;
    modal.onkeydown = null;
    modal.className = '';
    modal.removeAttribute('aria-label');
    modal.replaceChildren();
    if (refocus && opener && document.contains(opener)) opener.focus();
    onClose?.(value);
  };
  const dismiss = () => { if (dismissable()) close(); };
  const self = { modal, close, opener };
  openOne = self;
  const closeBtn = title === null ? null
    : h('button', { type: 'button', class: 'btn icon', title: 'Close (Esc)', 'aria-label': 'Close', onclick: dismiss }, icon('x', 16));
  modal.className = cls;
  modal.setAttribute('aria-label', label || (typeof title === 'string' ? title : '') || 'Dialog');
  modal.replaceChildren(...[
    title === null ? null : h('div', { class: 'modal-head' }, h('h2', {}, ico ? icon(ico, 18) : null, title), ...head, closeBtn),
    ...[body].flat(),
    foot ? h('div', { class: 'modal-foot' }, ...[foot].flat()) : null,
  ].filter(Boolean));
  backdrop.hidden = false;
  backdrop.onclick = null; // an older dialog's
  // On mousedown, not click: a drag that starts in a field and ends outside it is not a press on the backdrop.
  backdrop.onmousedown = (e) => { if (e.target === backdrop) dismiss(); };
  modal.onkeydown = (e) => {
    onKey?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); } // only the top layer
    else if (e.key === 'Tab') trapFocus(modal, e);
  };
  // After the key that opened it is done, or its letter lands in the field.
  setTimeout(() => {
    if (closed) return;
    if (typeof focus === 'function') focus();
    else (focus || closeBtn)?.focus();
  }, 0);
  return self;
}

// ── Panel kit: the side panel's patterns, as components (docs/design.md §3 Panel kit; their CSS in app.css under the
// same name). Built for the side panel, usable anywhere: the size comes from where they sit.

const SEG_ROLES = { group: [null, 'aria-pressed'], tablist: ['tab', 'aria-selected'], radiogroup: ['radio', 'aria-checked'] };
/**
 * A segmented control: one `.seg` of buttons, the picked one `.active` (List | Board, is | is not, Hide | Show).
 * `options` are `[value, label, { ico, tip, disabled, lead, attrs }]`: `label` text or a node, or null for an icon
 * alone (`ico`, its `tip` the name). `role` 'group' (aria-pressed), 'tablist' (tabs, aria-selected) or 'radiogroup'.
 * `onPick(value, event)`. Small buttons unless `small: false` (Settings → Themes).
 */
export function seg(options, current, onPick, { aria = null, role = 'group', cls = '', small = true, disabled = false } = {}) {
  const [itemRole, state] = SEG_ROLES[role] || SEG_ROLES.group;
  return h('div', { class: `seg ${cls}`.trim(), role, 'aria-label': aria }, ...options.map(([value, label, o = {}]) => {
    const on = current === value;
    const iconOnly = o.ico && (label === null || label === undefined || label === '');
    return h('button', {
      type: 'button', ...(o.attrs || {}), role: itemRole, [state]: String(on), disabled: disabled || !!o.disabled,
      class: `btn${small ? ' small' : ''}${iconOnly ? ' icon' : ''}${on ? ' active' : ''}`, title: o.tip ?? null,
      'aria-label': iconOnly ? o.tip : null, onclick: (e) => onPick(value, e),
    }, o.lead ?? null, o.ico ? icon(o.ico, 13) : null, iconOnly ? null : label);
  }));
}

/** A small grey uppercase section title (*PROPERTIES*, *WHEN*): `.section-label`, the recipe app.css shares with the
 *  titles that wear it by place (Settings' groups, Statuses', a card's prop groups). */
export const sectionLabel = (content, tag = 'h4') => h(tag, { class: 'section-label' }, content); // content: text, or [text, …nodes]

/** A tab's or a group's "+ Add …" on its first line (Links, Files, a project's work groups): a small ghost button, the
 *  plus and its words. (Docs' is a `select()` with the same face: `class: 'ghost tab-add'`.) */
/** The × that removes or closes one thing, named by `label` (its tooltip and its name for a screen reader). `size`
 * 'chip' sits inside a chip or a tag and takes its colour; 'row' is a square beside a row, a pinned item or a filter
 * pill. `keepFocus` keeps a field's focus through the click (a tag input). Where it shows (on hover) is its caller's.
 * Its size class is `x-row` / `x-chip`: a bare `chip` would make it a chip to every `.chip` rule and selector. */
export const removeButton = (label, onClick, { size = 'row', cls = '', keepFocus = false, attrs = {} } = {}) => h('button', {
  type: 'button', ...attrs, class: `x-btn x-${size} ${cls}`.trim(), title: label, 'aria-label': label,
  onmousedown: keepFocus ? (e) => e.preventDefault() : null, onclick: onClick,
}, icon('x', size === 'chip' ? 11 : 12));

/** A count. The default is the tinted pill (`.count`, pushed to its row's end; `tab` the one inside a tab, `.tab-count`);
 * `plain` is the muted number beside a group's or a page's title, `cls` naming where it sits. It draws `n` as it is:
 * 0 is "0", and null, undefined or false draw nothing (an empty pill hides) — pass `n || null` to hide a 0. */
export const countOf = (n, { tab = false, plain = false, cls = '', attrs = {} } = {}) =>
  h('span', { ...attrs, class: `${plain ? 'count-plain' : tab ? 'tab-count' : 'count'} ${cls}`.trim() },
    n === null || n === undefined || n === false ? '' : String(n));

export const tabAddButton = (label, onClick, attrs = {}) =>
  h('button', { type: 'button', ...attrs, class: `btn small ghost tab-add ${attrs.class || ''}`.trim(), onclick: onClick }, icon('plus', 14), label);

/** A secondary button: a border and no fill (the accent on hover). "+ Add relation", "Add existing session". */
export const secondaryButton = (label, { ico = null, class: cls = '', ...attrs } = {}) =>
  h('button', { type: 'button', ...attrs, class: `btn secondary ${cls}` }, ico ? icon(ico, 14) : null, label);

/** A group: its name above what it holds (rows, a picker, a button), a line between one group and the next. Without a
 *  name, only the line (Relations' "+ Add relation"). `title` is the name's tooltip. `aside` goes on the name's line, at
 *  the right (an item tab's "+ Add link" on its first group): with no name, that line holds it alone. */
export const stackGroup = (label, content, { title = null, class: cls = '', aside = null } = {}) => {
  const name = label ? h('span', { class: 'stack-label', title }, label) : null;
  return h('div', { class: `stack-group ${cls}` },
    aside ? h('div', { class: 'stack-head' }, name || h('span', { class: 'stack-label' }), aside) : name, content);
};

/** A list of plain rows (rowItem): no box, no line between; `ordered` for a chain (a parent, then its parent…). */
export const rowList = (rows, { ordered = false } = {}) => h(ordered ? 'ol' : 'ul', { class: 'row-list' }, rows);

/**
 * A plain row (Relations, Docs): its icon and title, a muted `meta` at the right (an id: `mono`; a folder), the accent
 * on hover, and its `actions` (rowAction) shown only then. With an `href` it is a link (`linkAttrs` on it: an opener,
 * a title); with an `onClick` instead, a button (a file opened in a dialog); with neither, a muted line (`tip` says why). `depth` steps it in, `lead` goes before it (a chain's "in").
 */
export function rowItem({ text, href = null, ico = null, meta = null, mono = false, textMono = false, tip = null, depth = 0,
  lead = null, actions = [], linkAttrs = {}, onClick = null, class: cls = '' }) {
  const body = [ico, h('span', { class: `row-title ${textMono ? 'mono' : ''}` }, text),
    meta ? h('span', { class: `row-meta ${mono ? 'mono' : ''}` }, meta) : null];
  const link = href ? h('a', { title: tip, ...linkAttrs, class: `row-link ${linkAttrs.class || ''}`, href }, ...body)
    : onClick ? h('button', { type: 'button', title: tip, ...linkAttrs, class: `row-link ${linkAttrs.class || ''}`, onclick: onClick }, ...body)
      : h('span', { class: 'row-link muted', title: tip }, ...body);
  return h('li', { class: `row-item hover-host ${cls}`, style: depth ? `--depth:${depth}` : null },
    lead ? h('span', { class: 'row-lead muted small' }, lead) : null, link, [actions].flat().filter(Boolean));
}

/** A row's action (× to unlink, ⋯ for more): an icon button, shown on the row's hover (always on a touch screen).
 *  `onClick(event, button)`. */
export function rowAction(ico, label, onClick, attrs = {}) {
  const btn = h('button', { type: 'button', ...attrs, class: `btn icon row-action hover-reveal ${attrs.class || ''}`, title: label, 'aria-label': label,
    onclick: (e) => { e.preventDefault(); onClick(e, btn); } }, icon(ico, 14));
  return btn;
}

export function section(title, items, opts = {}, actions = null) {
  if (!items.length && !opts.showEmpty) return null;
  return h('section', { class: `group ${opts.class || ''}` },
    h('header', {}, h('h3', {}, title, countOf(items.length || null)), actions),
    items.length ? h('div', { class: 'cards' }, items.map((i) => itemCard(i, opts))) : emptyState(opts.emptyText || 'Nothing here.'));
}

export const byPriority = (a, b) =>
  (PRIORITY_RANK[a.fields.priority] || 3) - (PRIORITY_RANK[b.fields.priority] || 3) ||
  String(a.fields.due || '9999').localeCompare(String(b.fields.due || '9999')) ||
  String(a.fields.created_at || '').localeCompare(String(b.fields.created_at || ''));
