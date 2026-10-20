// Markdown editor: a toolbar, the textarea and a live preview (Markdown only by default; Both / View on demand). The
// text is saved byte for byte — buttons only wrap or prefix the selection, so a
// file edited here and in Obsidian never gets rewritten behind your back.
import { dictation } from './dictation.js';
import { highlight as colour } from './highlight.js';
import { h, icon, renderMarkdown } from './ui.js';

const ACTIONS = [
  { key: 'heading', label: 'Heading', icon: 'heading', run: (ed) => ed.prefixLines('## ') },
  { key: 'bold', label: 'Bold', icon: 'bold', kbd: '⌘B', run: (ed) => ed.wrap('**', 'bold') },
  { key: 'italic', label: 'Italic', icon: 'italic', kbd: '⌘I', run: (ed) => ed.wrap('_', 'italic') },
  { key: 'strike', label: 'Strikethrough', icon: 'strike', run: (ed) => ed.wrap('~~', 'strike') },
  '-',
  { key: 'ul', label: 'Bullet list', icon: 'list', run: (ed) => ed.prefixLines('- ') },
  { key: 'ol', label: 'Numbered list', icon: 'listnum', run: (ed) => ed.prefixLines('1. ', { numbered: true }) },
  { key: 'task', label: 'Checklist', icon: 'checklist', run: (ed) => ed.prefixLines('- [ ] ') },
  '-',
  { key: 'link', label: 'Link', icon: 'link', kbd: '⌘K', run: (ed) => ed.link() },
  { key: 'code', label: 'Code', icon: 'code', kbd: '⌘⇧C', run: (ed) => ed.code() },
  { key: 'quote', label: 'Quote', icon: 'quote', run: (ed) => ed.prefixLines('> ') },
];

// Layout switch in the toolbar: [mode, label].
const MODES = [['write', 'Markdown'], ['split', 'Both'], ['preview', 'View']];

const LIST_RE = /^(\s*)([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/;

/**
 * mdEditor({ value, onInput, minHeight, preview, placeholder, label, onEscape, highlight, markdown, wrap }) →
 * { el, textarea, get(), set(text), focus() }. `preview: false` gives toolbar + textarea only. `onEscape` is what
 * Esc does in the textarea (an autosaving block: save, then leave the editor); without it Esc only leaves the textarea.
 * `highlight: '<language>'` (highlight.js) shows the text coloured as it is typed: the colours are drawn behind a
 * transparent textarea that grows with its text, so both wrap alike. `markdown: false` (a code file) drops the
 * formatting bar and the Markdown keys; `wrap: false` keeps long lines on one line, scrolled sideways. The bar ends
 * with a dictation mic where the browser can transcribe speech (dictation.js).
 */
export function mdEditor({ value = '', onInput = () => {}, minHeight = '320px', preview = true, placeholder = 'Markdown… use "- [ ] step" for checklists', label = 'Description', fk = 'body', onEscape = null,
  highlight = null, markdown = true, wrap = true } = {}) {
  const ta = h('textarea', { class: 'mde-text', spellcheck: 'false', placeholder, 'aria-label': label, 'data-fk': fk, wrap: wrap ? null : 'off' });
  ta.value = value;
  ta.style.minHeight = minHeight;
  // Coloured: the text again, behind the textarea, in the same font, padding and wrapping. Each change shows it plain
  // at once and coloured as soon as highlight.js answers (the same frame, once its language is loaded).
  const hl = highlight ? h('code', { class: `hljs language-${highlight}` }) : null;
  let paint = 0;
  const recolour = () => {
    if (!hl) return;
    const text = ta.value;
    hl.textContent = `${text}\n`; // the last line, even empty, takes its height
    const n = ++paint;
    colour(text, highlight).then((html) => { if (html !== null && n === paint) hl.innerHTML = `${html}\n`; }); // sanitized by highlight()
  };
  const grow = () => { // no scrollbar of its own, so the colours behind it and the text wrap at the same width
    if (!hl) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };
  const prev = preview ? h('div', { class: 'mde-preview md', 'aria-label': 'Preview', 'aria-live': 'polite' }) : null;
  let mode = 'write'; // write (Markdown only) | split (both) | preview (rendered only); Markdown is the default

  const setSel = (start, end) => { ta.focus(); ta.setSelectionRange(start, end); };
  const replaceRange = (start, end, text) => {
    ta.setRangeText(text, start, end, 'end');
    changed();
  };
  const lineBounds = (start, end) => {
    const v = ta.value;
    const from = v.lastIndexOf('\n', start - 1) + 1;
    let to = v.indexOf('\n', end);
    if (to < 0) to = v.length;
    return [from, to];
  };

  const api = {
    el: null, textarea: ta,
    get: () => ta.value,
    set: (text) => { ta.value = text; refresh(); recolour(); grow(); },
    focus: () => ta.focus(),
    /** Wrap the selection with `mark`; with nothing selected, insert the mark pair around a placeholder. */
    wrap(mark, ph) {
      const { selectionStart: s, selectionEnd: e, value: v } = ta;
      const inner = v.slice(s, e) || ph;
      const already = v.slice(s - mark.length, s) === mark && v.slice(e, e + mark.length) === mark;
      if (already) { // toggle off
        ta.setRangeText(inner, s - mark.length, e + mark.length, 'select');
        setSel(s - mark.length, s - mark.length + inner.length);
      } else {
        ta.setRangeText(mark + inner + mark, s, e, 'select');
        setSel(s + mark.length, s + mark.length + inner.length);
      }
      changed();
    },
    /** Prefix every selected line (toggle: strip the prefix if all lines already have it). */
    prefixLines(prefix, { numbered = false } = {}) {
      const [from, to] = lineBounds(ta.selectionStart, ta.selectionEnd);
      const lines = ta.value.slice(from, to).split('\n');
      const has = (l) => (numbered ? /^\s*\d+\.\s/.test(l) : l.startsWith(prefix));
      const all = lines.every((l) => has(l) || !l.trim());
      const out = lines.map((l, i) => {
        if (all) return numbered ? l.replace(/^(\s*)\d+\.\s/, '$1') : l.slice(prefix.length);
        const bare = l.replace(LIST_RE, '$1'); // switching list kinds replaces the marker
        return numbered ? `${i + 1}. ${bare}` : prefix + bare;
      }).join('\n');
      ta.setRangeText(out, from, to, 'select');
      setSel(from, from + out.length);
      changed();
    },
    link() {
      const { selectionStart: s, selectionEnd: e, value: v } = ta;
      const sel = v.slice(s, e);
      const isUrl = /^(https?:\/\/|www\.)\S+$/i.test(sel);
      const text = isUrl ? `[${sel}](${sel})` : `[${sel || 'text'}](url)`;
      ta.setRangeText(text, s, e, 'select');
      if (isUrl) setSel(s + 1, s + 1 + sel.length);
      else setSel(s + text.length - 4, s + text.length - 1); // select "url"
      changed();
    },
    code() {
      const { selectionStart: s, selectionEnd: e, value: v } = ta;
      const sel = v.slice(s, e);
      if (sel.includes('\n')) {
        const block = `\`\`\`\n${sel}\n\`\`\``;
        ta.setRangeText(block, s, e, 'select');
        setSel(s + 4, s + 4 + sel.length);
        changed();
      } else api.wrap('`', 'code');
    },
  };

  let timer = null;
  const refresh = () => {
    if (!prev) return;
    // renderMarkdown() sanitizes with DOMPurify (fails closed without it).
    prev.innerHTML = ta.value.trim() ? renderMarkdown(ta.value) : '<p class="muted">Preview</p>';
    prev.querySelectorAll('input[type=checkbox]').forEach((b) => { b.disabled = true; });
  };
  const changed = () => {
    recolour();
    grow();
    onInput(ta.value);
    clearTimeout(timer);
    timer = setTimeout(refresh, 120);
  };
  ta.addEventListener('input', changed);
  ta.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') { e.stopPropagation(); if (onEscape) onEscape(); else ta.blur(); return; } // first Esc leaves the editor, the next closes the dialog
    if (!markdown && e.key !== 'Tab') return; // a code file: only indenting is the editor's; Enter, ⌘B… are the browser's
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); api.wrap('**', 'bold'); return; }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); api.wrap('_', 'italic'); return; }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); api.link(); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); api.code(); return; }
    if (e.key === 'Tab') { // indent / outdent the selected lines (never leaves the editor by Tab: Esc first)
      e.preventDefault();
      const [from, to] = lineBounds(ta.selectionStart, ta.selectionEnd);
      const lines = ta.value.slice(from, to).split('\n');
      const out = lines.map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, '') : `  ${l}`)).join('\n');
      ta.setRangeText(out, from, to, 'select');
      changed();
      return;
    }
    if (e.key === 'Enter' && !mod && !e.shiftKey) { // continue a list / checklist; an empty item ends it
      const { selectionStart: s, value: v } = ta;
      const from = v.lastIndexOf('\n', s - 1) + 1;
      const line = v.slice(from, s);
      const m = line.match(LIST_RE);
      if (!m) return;
      e.preventDefault();
      if (!line.slice(m[0].length).trim()) { replaceRange(from, s, ''); return; }
      const marker = /^\d+\.$/.test(m[2]) ? `${Number(m[2]) + 1}.` : m[2];
      replaceRange(s, s, `\n${m[1]}${marker} ${m[3] ? '[ ] ' : ''}`);
    }
  });
  // A line too long to wrap scrolls the textarea sideways: the colours behind it follow.
  if (hl) ta.addEventListener('scroll', () => { hl.parentElement.scrollLeft = ta.scrollLeft; });
  // keep the preview roughly in step with the textarea
  ta.addEventListener('scroll', () => {
    if (!prev) return;
    const max = ta.scrollHeight - ta.clientHeight;
    if (max > 0) prev.scrollTop = (ta.scrollTop / max) * (prev.scrollHeight - prev.clientHeight);
  });

  // Dictation types at the cursor through replaceRange, so it counts as typing (onInput, autosave, preview).
  const mic = markdown ? dictation(ta, { insert: replaceRange }) : null;
  const bar = !markdown ? null : h('div', { class: 'mde-bar', role: 'toolbar', 'aria-label': `${label} formatting` },
    ACTIONS.map((a) => (a === '-' ? h('span', { class: 'mde-sep' }) : h('button', {
      type: 'button', class: 'btn icon', title: a.kbd ? `${a.label} (${a.kbd})` : a.label,
      onmousedown: (e) => e.preventDefault(), // keep the textarea's selection
      onclick: () => a.run(api),
    }, icon(a.icon, 16)))),
    mic ? [h('span', { class: 'mde-sep' }), mic.el] : null,
    prev ? h('div', { class: 'seg mde-modes', role: 'group', 'aria-label': 'Layout' }, MODES.map(([m, text]) => h('button', {
      type: 'button', class: 'btn small', 'aria-pressed': String(m === mode), 'data-mode': m,
      onmousedown: (e) => e.preventDefault(),
      onclick: () => { mode = m; api.el.dataset.mode = m; bar.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m))); },
    }, text))) : null);

  const write = hl ? h('div', { class: `mde-code ${wrap ? '' : 'nowrap'}` }, h('pre', { class: 'mde-hl', 'aria-hidden': 'true' }, hl), ta) : ta;
  api.el = h('div', { class: `mde ${prev ? 'with-preview' : ''} ${hl ? 'coloured' : ''}`, 'data-mode': mode }, bar,
    h('div', { class: 'mde-panes' }, write, prev));
  refresh();
  recolour();
  requestAnimationFrame(grow); // its height once it is on the page
  return api;
}
