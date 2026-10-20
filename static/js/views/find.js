// The vault's text files searched for a phrase (#/find/<phrase>): the Explorer's "Search in files…" and the command
// palette lead here. Each line found, under its file, opens that file at that line (views/files.js openFileAtLine).
import { api } from '../api.js';
import { filesHref } from '../filetree.js';
import { state } from '../state.js';
import { h, icon } from '../ui.js';
import { openFileAtLine } from './files.js';

export const findHref = (q) => `#/find/${encodeURIComponent(q)}`;

/** `text` with every occurrence of `q` (case and accents aside) marked. */
function marked(text, q) {
  const fold = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const hay = fold(text);
  const needle = fold(q);
  // Folding can change a string's length (ñ → n + ˜ → n): map positions back through each character's fold.
  const starts = [];
  let acc = 0;
  for (const ch of text) { starts.push(acc); acc += fold(ch).length; }
  starts.push(acc);
  const out = [];
  let from = 0;
  let at = hay.indexOf(needle);
  const chars = [...text];
  const toChar = (pos) => starts.findIndex((s) => s >= pos);
  while (needle && at >= 0) {
    const a = toChar(at);
    const b = toChar(at + needle.length);
    out.push(chars.slice(from, a).join(''), h('mark', {}, chars.slice(a, b).join('')));
    from = b;
    at = hay.indexOf(needle, at + needle.length);
  }
  out.push(chars.slice(from).join(''));
  return out;
}

export function mount(root, param) {
  let q = '';
  try { q = decodeURIComponent(param || ''); } catch { q = param || ''; }
  const input = h('input', { type: 'search', class: 'find-input', value: q, placeholder: 'Search in the vault\'s files…', 'aria-label': 'Search in files',
    onkeydown: (e) => { if (e.key === 'Enter' && input.value.trim()) location.hash = findHref(input.value.trim()); } });
  const body = h('div', { class: 'find-results' }, h('p', { class: 'muted' }, q ? 'Searching…' : 'Type at least 2 characters and press Enter.'));
  root.replaceChildren(h('div', { class: 'files-page find-page' },
    h('div', { class: 'files-head' }, h('h1', {}, icon('search', 20), 'Search in files'), h('span', { class: 'spacer' }),
      h('span', { class: 'muted small' }, state.vault?.name || '')),
    input, body));
  requestAnimationFrame(() => { input.focus(); input.select(); });
  let live = true;
  if (q.length >= 2) {
    api.searchFiles(q).then((out) => {
      if (!live) return;
      if (!out.results.length) { body.replaceChildren(h('p', { class: 'muted' }, `Nothing found for “${q}”.`)); return; }
      const groups = new Map();
      for (const r of out.results) groups.set(r.path, [...(groups.get(r.path) || []), r]);
      body.replaceChildren(
        h('p', { class: 'muted small' }, `${out.results.length}${out.truncated ? '+' : ''} lines in ${out.files} file${out.files === 1 ? '' : 's'}${out.truncated ? ' (the first ones)' : ''}.`),
        ...[...groups].map(([path, rows]) => h('section', { class: 'find-file' },
          h('a', { class: 'find-path', href: filesHref(path) }, icon('file', 14), path),
          h('ul', {}, rows.map((r) => h('li', {}, h('button', { class: 'find-line', onclick: () => openFileAtLine(r.path, r.line, q) },
            h('span', { class: 'find-n mono' }, String(r.line)), h('span', { class: 'find-text' }, ...marked(r.text, q)))))))));
    }, (e) => { if (live) body.replaceChildren(h('p', { class: 'muted' }, `Could not search: ${e.message}`)); });
  }
  // A reload of the items changes nothing found here: searching again is Enter.
  return { update() {}, unmount() { live = false; } };
}
