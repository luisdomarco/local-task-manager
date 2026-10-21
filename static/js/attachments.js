// An item's attachments, under its description on its card and its page: a drop zone (or Add files), then the title
// with its count, which folds the table of its files — name · Open · Delete — or says there are none. Open shows the file in a dialog (an image, a PDF, plain text read as text) or offers to download
// it. The files live in the vault's Attachments/ folder and the item names them in `attachments` (tm/attachments.py).
import { zoomableImage } from './zoom.js';
import { attachmentUrl } from './api.js';
import { trapFocus } from './create.js';
import { pref, setPref } from './prefs.js';
import { addAttachments, removeAttachment, toast } from './state.js';
import { h, icon } from './ui.js';

const MAX_BYTES = 25 * 1024 * 1024; // tm/attachments.py MAX_BYTES: said here before sending 25 MB for nothing
const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;
const PDF = /\.pdf$/i; // the browser's own viewer, in a frame (also: Open in new tab)
const TEXT = /\.(txt|log)$/i; // read and shown as text, never as a page

const nameOf = (path) => path.split('/').pop();
// An <a>/<img>/<iframe> pointing at the app's own address: set as a property, as h() only takes outside links.
const at = (el, prop, url) => { el[prop] = url; return el; };

/** The Attachments section of an item. */
export function attachmentsSection(item) {
  const files = item.fields.attachments || [];
  const input = h('input', { type: 'file', multiple: true, hidden: true, 'aria-label': 'Files to attach' });
  const zone = h('div', { class: 'attach-zone', tabindex: '0', role: 'button', 'aria-label': 'Attach files: drop them here or press Enter to pick' },
    icon('upload', 16), h('span', {}, 'Drop files here or '),
    h('button', { type: 'button', class: 'btn small', onclick: (e) => { e.stopPropagation(); input.click(); } }, 'Add files'),
    h('span', { class: 'muted small' }, 'up to 25 MB each'));
  const send = async (list) => {
    const all = [...list];
    const big = all.filter((f) => f.size > MAX_BYTES);
    big.forEach((f) => toast(`${f.name}: an attachment is at most 25 MB`, true));
    const ok = all.filter((f) => f.size <= MAX_BYTES);
    if (!ok.length) return;
    zone.classList.add('busy');
    zone.querySelector('span').textContent = `Attaching ${ok.length === 1 ? ok[0].name : `${ok.length} files`}…`;
    await addAttachments(item.key, ok); // reloads: the section is drawn again with the new rows
  };
  input.addEventListener('change', () => { if (input.files.length) send(input.files); input.value = ''; });
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  // Only a drag that carries files lights the zone up (not a card being dragged around the board).
  const carriesFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  zone.addEventListener('dragover', (e) => { if (!carriesFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; zone.classList.add('over'); });
  zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('over'); });
  zone.addEventListener('drop', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    zone.classList.remove('over');
    send(e.dataTransfer.files);
  });

  const rows = files.map((path) => h('tr', {},
    h('td', { class: 'attach-name' }, IMAGE.test(path) ? at(h('img', { class: 'attach-thumb', alt: '', loading: 'lazy' }), 'src', attachmentUrl(path)) : icon('file', 15),
      h('span', { title: path }, nameOf(path))),
    h('td', { class: 'attach-act' }, h('button', { type: 'button', class: 'btn small', onclick: () => openAttachment(path) }, icon('eye', 13), 'Open')),
    h('td', { class: 'attach-act' }, h('button', { type: 'button', class: 'btn small ghost', title: `Delete ${nameOf(path)}`,
      onclick: () => removeAttachment(item.key, path).catch(() => {}) }, icon('trash', 13), 'Delete'))));
  const list = h('div', { class: 'attach-list', id: `attach-list-${String(item.key).replace(/[^\w-]/g, '-')}` }, // a key may be a path
    files.length ? h('table', { class: 'attach-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', { class: 'sr-only' }, 'Open'), h('th', { class: 'sr-only' }, 'Delete'))),
      h('tbody', {}, rows)) : h('p', { class: 'muted small attach-empty' }, 'No attachments yet'));
  // The title folds the list; the choice is kept for every item (this browser only).
  const head = h('button', { type: 'button', class: 'attach-head', 'aria-controls': list.id });
  const show = (open) => {
    list.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    head.title = open ? 'Hide the attachments' : 'Show the attachments';
    head.replaceChildren(icon(open ? 'down' : 'right', 14), icon('paperclip', 15), h('span', { class: 'attach-title' }, 'Attachments'),
      h('span', { class: 'muted small' }, String(files.length)));
  };
  show(pref('attachments.open', true) !== false);
  head.addEventListener('click', () => { const open = list.hidden; show(open); setPref('attachments.open', open); });
  return h('section', { class: 'panel-section attachments' }, zone, input, head, list);
}

/** A file shown as what it is (`kind`: 'image' | 'pdf' | 'text' | 'other'): an <img>, the browser's PDF viewer in a
 * frame, the text read as text (never as a page), or a line saying it cannot be shown. The dialog below and the
 * Explorer's file view (views/files.js) both use it. */
export function fileViewer(url, name, kind) {
  const view = kind === 'image' ? zoomableImage(url, name) // fitted; a click, the wheel or a pinch to look closer
    : kind === 'pdf' ? at(h('iframe', { class: 'attach-view-frame', title: name }), 'src', url)
      : kind === 'text' ? h('pre', { class: 'attach-view-text' }, 'Loading…')
        : h('p', { class: 'muted attach-view-none' }, 'This file cannot be shown here: download it to open it.');
  if (kind === 'text') {
    fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
      .then((text) => { view.textContent = text; }, (e) => { view.textContent = `Could not read it (${e.message}).`; });
  }
  return view;
}

/** One attachment in a dialog over the card: an image, a PDF or plain text shown; anything else to download. */
export function openAttachment(path) {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('modal');
  const opener = document.activeElement;
  const close = () => {
    backdrop.hidden = true; modal.className = ''; modal.replaceChildren();
    if (opener && document.contains(opener)) opener.focus();
  };
  const url = attachmentUrl(path);
  const name = nameOf(path);
  const view = fileViewer(url, name, IMAGE.test(path) ? 'image' : PDF.test(path) ? 'pdf' : TEXT.test(path) ? 'text' : 'other');
  const download = at(h('a', { class: 'btn small', download: name }, icon('download', 13), 'Download'), 'href', url);
  // A PDF's own tab, where the browser's viewer has the whole window (and works wherever a frame would not).
  const newTab = PDF.test(path) ? at(h('a', { class: 'btn small', target: '_blank', rel: 'noopener' }, icon('external', 13), 'Open in new tab'), 'href', url) : null;
  modal.className = 'attach-modal';
  modal.setAttribute('aria-label', name);
  modal.replaceChildren(
    h('div', { class: 'modal-head' }, h('h2', { title: path }, icon('paperclip', 16), name), h('span', { class: 'spacer' }), newTab, download,
      h('button', { class: 'btn icon', title: 'Close (Esc)', onclick: close }, icon('x', 16))),
    h('div', { class: 'attach-view' }, view));
  backdrop.hidden = false;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  modal.onkeydown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') trapFocus(modal, e);
  };
  modal.querySelector('.modal-head .btn.icon').focus();
}
