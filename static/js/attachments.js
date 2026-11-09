// An item's attachments, in its page's Files tab: "+ Add files" (or a drop anywhere on them), then a row per file —
// its thumbnail or icon, its name, Open and Delete on hover — or a line saying there are none. Open shows the file in a dialog (an image, a PDF, plain text read as text) or offers to download
// it. The files live in the vault's Attachments/ folder and the item names them in `attachments` (tm/attachments.py).
import { zoomableImage } from './zoom.js';
import { attachmentUrl } from './api.js';
import { trapFocus } from './create.js';
import { addAttachments, removeAttachment, toast } from './state.js';
import { fileKind } from './linkgroups.js';
import { foldSection, h, icon, rowAction, rowItem, rowList, stackGroup } from './ui.js';

const MAX_BYTES = 25 * 1024 * 1024; // tm/attachments.py MAX_BYTES: said here before sending 25 MB for nothing
const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;
const PDF = /\.pdf$/i; // the browser's own viewer, in a frame (also: Open in new tab)
const TEXT = /\.(txt|log)$/i; // read and shown as text, never as a page

const nameOf = (path) => path.split('/').pop();
// An <a>/<img>/<iframe> pointing at the app's own address: set as a property, as h() only takes outside links.
const at = (el, prop, url) => { el[prop] = url; return el; };

/** The Attachments section of an item. */
export function attachmentsSection(item) {
  // The title folds the zone and the list; the choice is kept for every item (this browser only).
  return foldSection({ key: 'attachments', title: 'Attachments', ico: 'paperclip', count: (item.fields.attachments || []).length,
    cls: 'panel-section attachments' }, attachmentsBody(item));
}

/** The item's files, without a title (a project page's Files tab holds them under its own): a drop strip with the hint
 *  and "+ Add files", then a row per file, the newest first. A file dropped anywhere on them is added; the strip lights
 *  up while one is dragged over. */
export function attachmentsBody(item) {
  const files = item.fields.attachments || [];
  const input = h('input', { type: 'file', multiple: true, hidden: true, 'aria-label': 'Files to attach' });
  const add = h('button', { type: 'button', class: 'btn small ghost tab-add', onclick: (e) => { e.stopPropagation(); input.click(); } }, icon('plus', 14), 'Add files');
  const text = h('span', {}, 'Drop files here · up to 25 MB each');
  const hint = h('span', { class: 'stack-label attach-hint' }, icon('upload', 14), text);
  const send = async (list) => {
    const all = [...list];
    const big = all.filter((f) => f.size > MAX_BYTES);
    big.forEach((f) => toast(`${f.name}: an attachment is at most 25 MB`, true));
    const ok = all.filter((f) => f.size <= MAX_BYTES);
    if (!ok.length) return;
    box.classList.add('busy');
    add.disabled = true;
    text.textContent = `Attaching ${ok.length === 1 ? ok[0].name : `${ok.length} files`}…`;
    await addAttachments(item.key, ok); // reloads: the tab is drawn again with the new rows
  };
  input.addEventListener('change', () => { if (input.files.length) send(input.files); input.value = ''; });

  // Each a row, as Links' and Docs' (ui.js rowItem): its kind's icon, its name, its extension muted; a click opens
  // it (openAttachment); on hover the eye does the same and the bin deletes it (to the trash, with Undo).
  // An icon per kind, never a thumbnail: at a row's size a screenshot is a white square (the eye shows the file).
  const KIND_ICON = { image: 'image', pdf: 'file', text: 'text', sheet: 'table', doc: 'note', archive: 'archive', file: 'file' };
  const rows = [...files].reverse().map((path) => {
    const name = nameOf(path);
    const kind = fileKind(path);
    const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toUpperCase();
    return rowItem({
      ico: icon(KIND_ICON[kind], 14),
      text: name, meta: ext || null, onClick: () => openAttachment(path), linkAttrs: { title: `Open ${name}` },
      actions: [rowAction('eye', `Open ${name}`, () => openAttachment(path)),
        rowAction('trash', `Delete ${name}`, () => removeAttachment(item.key, path).catch(() => {}))],
    });
  });
  const box = h('div', { class: 'attach-list', id: `attach-list-${String(item.key).replace(/[^\w-]/g, '-')}` }, // a key may be a path
    stackGroup(null, rows.length ? rowList(rows) : null, // none: the strip alone says what to do
      { aside: add }), input);
  // The group's first line is the drop strip: a light well with a dashed edge, the hint at its left, "+ Add files" at its
  // right; a click anywhere on it picks files too.
  const strip = box.querySelector('.stack-head');
  strip.classList.add('attach-drop');
  strip.querySelector('.stack-label').replaceWith(hint);
  strip.addEventListener('click', () => input.click());
  // Only a drag that carries files lights it up (not a card being dragged around the board).
  const carriesFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  box.addEventListener('dragover', (e) => { if (!carriesFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; box.classList.add('over'); });
  box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove('over'); });
  box.addEventListener('drop', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    box.classList.remove('over');
    send(e.dataTransfer.files);
  });
  return box;
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
