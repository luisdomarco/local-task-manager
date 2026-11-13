// Markdown editor: a toolbar over one of two surfaces. Live (the default for Markdown) is the text drawn formatted
// as you write it, as in Obsidian's Live Preview (livemd.js, on CodeMirror); Source is the Markdown in a textarea,
// coloured as typed, with Both (a preview beside it) and View on demand. The text is saved byte for byte: buttons only wrap or
// prefix the selection, so a file edited here and in Obsidian never gets rewritten behind your back.
import { dictation } from './dictation.js';
import { highlight as colour } from './highlight.js';
import { liveLoaded, liveSurface, loadLive } from './livemd.js';
import { HIGHLIGHTS, TEXT_COLOURS, colourRange } from './mdcolour.js';
import { pref, setPref } from './prefs.js';
import { closeMenu, dropdown, h, icon, renderMarkdown, seg } from './ui.js';
import { isRef, linkRefs, linkVault, liveSources, openLink } from './vaultlinks.js';

const ACTIONS = [
  { key: 'heading', label: 'Heading', icon: 'heading', run: (ed) => ed.prefixLines('## ') },
  { key: 'bold', label: 'Bold', icon: 'bold', kbd: '⌘B', run: (ed) => ed.wrap('**', 'bold') },
  { key: 'italic', label: 'Italic', icon: 'italic', kbd: '⌘I', run: (ed) => ed.wrap('_', 'italic') },
  { key: 'strike', label: 'Strikethrough', icon: 'strike', run: (ed) => ed.wrap('~~', 'strike') },
  { key: 'colour', label: 'Text colour', icon: 'textcolour', run: (ed, btn) => ed.palette(btn, 'text') },
  { key: 'highlight', label: 'Highlight', icon: 'highlighter', run: (ed, btn) => ed.palette(btn, 'highlight') },
  '-',
  { key: 'ul', label: 'Bullet list', icon: 'list', run: (ed) => ed.prefixLines('- ') },
  { key: 'ol', label: 'Numbered list', icon: 'listnum', run: (ed) => ed.prefixLines('1. ', { numbered: true }) },
  { key: 'task', label: 'Checklist', icon: 'checklist', run: (ed) => ed.prefixLines('- [ ] ') },
  '-',
  { key: 'link', label: 'Link', icon: 'link', kbd: '⌘K', run: (ed) => ed.link() },
  { key: 'code', label: 'Code', icon: 'code', kbd: '⌘⇧C', run: (ed) => ed.code() },
  { key: 'quote', label: 'Quote', icon: 'quote', run: (ed) => ed.prefixLines('> ') },
];

// Layout switch in the toolbar: [mode, label, tooltip]. The one picked last is remembered (MODE_PREF) for every
// Markdown editor; Live is the default. "Source" as in Obsidian (and the Explorer's Preview · Source · Edit).
const MODES = [
  ['live', 'Live', 'Formatted as you write it: the Markdown shows on the line you are on'],
  ['write', 'Source', 'The Markdown as it is saved, coloured'],
  ['split', 'Both', 'The Markdown and how it reads, side by side'],
  ['preview', 'View', 'How it reads'],
];
export const MODE_PREF = 'editor.mode';

const LIST_RE = /^(\s*)([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/;

/** Where the character at `pos` sits on screen, measured on the coloured copy of the text behind the textarea. */
function caretRect(code, pos) {
  if (!code) return null;
  const walk = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(), seen = 0; n; n = walk.nextNode()) {
    if (seen + n.length >= pos) {
      const r = document.createRange();
      r.setStart(n, pos - seen);
      r.setEnd(n, Math.min(n.length, pos - seen + 1));
      const rect = [...r.getClientRects()][0] || r.getBoundingClientRect();
      return rect.height ? rect : null;
    }
    seen += n.length;
  }
  return null;
}

/** The elements around `el` that scroll vertically (the nearest first), the page's own scroller included. */
function scrollers(el) {
  const out = [];
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) out.push(p);
  }
  if (document.scrollingElement) out.push(document.scrollingElement);
  return out;
}

/**
 * mdEditor({ value, onInput, minHeight, preview, placeholder, label, onEscape, highlight, markdown, wrap, trailing,
 *   completions }) → { el, get(), set(text), focus(), select(from, to, { scroll }), rectAt(pos), on(type, fn), mode() }.
 * `preview: false` gives no Both / View. `onEscape` is what Esc does in the text (an autosaving block: save, then leave
 * the editor); without it Esc only leaves the text. `highlight: '<language>'` (highlight.js) shows the Markdown
 * coloured as it is typed: the colours are drawn behind a transparent textarea that grows with its text, so both wrap
 * alike. `markdown: false` (a code file) drops Live, the formatting bar and the Markdown keys; `wrap: false` keeps long
 * lines on one line, scrolled sideways. The bar ends with a dictation mic where the browser can transcribe speech
 * (dictation.js), then `trailing` (a node of the caller's). `completions`: CodeMirror completion sources for Live
 * (default: vaultlinks.js, the / menu, [[ and @; [] for none).
 * Positions (`select`, `rectAt`) count a line break as one character (livemd.js lfOffset turns an offset in the saved
 * text into one). `on('blur' | 'keydown' | …, fn)` listens to whichever surface is in use; blur is the text losing
 * the focus to something outside the editor.
 */
export function mdEditor({ value = '', onInput = () => {}, minHeight = '320px', preview = true, placeholder = 'Markdown… use "- [ ] step" for checklists', label = 'Description', fk = 'body', onEscape = null,
  highlight = null, markdown = true, wrap = true, trailing = null, completions = null } = {}) {
  const ta = h('textarea', { class: 'mde-text', spellcheck: 'false', placeholder, 'aria-label': label, wrap: wrap ? null : 'off' });
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
    if (!hl || S !== text) return;
    if (ta.scrollHeight > ta.clientHeight) { // longer: grow to fit, never through a shorter height
      ta.style.height = `${ta.scrollHeight}px`;
      return;
    }
    // Maybe shorter (a line deleted): measuring needs it short for a moment, and that clips the scroll of whatever
    // scrolls around it (the card's column, full screen, the Explorer). Put each one back where it was.
    const kept = scrollers(ta).map((el) => [el, el.scrollTop]);
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
    for (const [el, top] of kept) el.scrollTop = top;
  };
  const prev = preview ? h('div', { class: 'mde-preview md', 'aria-label': 'Preview', 'aria-live': 'polite' }) : null;
  const modes = MODES.filter(([m]) => (m === 'live' ? markdown : m === 'write' || !!prev));

  // ── the two surfaces: the same calls on the textarea and on the Live editor ──
  const write = hl ? h('div', { class: `mde-code ${wrap ? '' : 'nowrap'}` }, h('pre', { class: 'mde-hl', 'aria-hidden': 'true' }, hl), ta) : ta;
  const text = {
    kind: 'text', el: write, input: ta,
    value: () => ta.value,
    saved: () => ta.value,
    sel: () => [ta.selectionStart, ta.selectionEnd],
    select(from, to = from, { scroll = true } = {}) { ta.focus({ preventScroll: !scroll }); ta.setSelectionRange(from, to); },
    replace(from, to, t, selFrom = null, selTo = null) {
      ta.focus();
      ta.setRangeText(t, from, to, 'end');
      if (selFrom !== null) ta.setSelectionRange(selFrom, selTo ?? selFrom);
      changed();
    },
    focus: (opts) => ta.focus(opts),
    hasFocus: () => document.activeElement === ta,
    rectAt: (pos) => caretRect(hl, pos),
  };
  const livePane = markdown ? h('div', { class: 'mde-live-pane' }) : null;
  let live = null;
  /** The Live surface, made the first time (null: CodeMirror not loaded, or a text Live would not keep as it is). */
  const ensureLive = (from = S ? S.saved() : value) => {
    if (live) {
      if (live.setValue(from)) return live;
      live.destroy(); live = null; // other line breaks than it was made with
    }
    live = liveSurface({
      value: from, minHeight, placeholder: placeholder || '', label,
      onChange: () => changed(), onKey: (e) => handleKey(e), completions: completions ?? liveSources(), isRef, onOpen: openLink,
    });
    if (live) livePane.replaceChildren(live.el);
    return live;
  };
  let S = null; // the surface in use
  const markFk = () => { // the field's data-fk on the surface in use only (panel.js keepFocus finds it by it)
    for (const s of [text, live]) if (s) { if (s === S) s.input.dataset.fk = fk; else delete s.input.dataset.fk; }
  };

  let timer = null;
  const refresh = () => {
    if (!prev) return;
    const v = S ? S.saved() : value;
    // renderMarkdown() sanitizes with DOMPurify (fails closed without it).
    prev.innerHTML = v.trim() ? renderMarkdown(linkVault(v)) : '<p class="muted">Preview</p>';
    linkRefs(prev);
    prev.querySelectorAll('input[type=checkbox]').forEach((b) => { b.disabled = true; });
  };
  function changed() {
    if (S === text) { recolour(); grow(); }
    onInput(S.saved());
    if (mode === 'split' || mode === 'preview') { clearTimeout(timer); timer = setTimeout(refresh, 120); }
  }
  const lineBounds = (start, end) => {
    const v = S.value();
    const from = v.lastIndexOf('\n', start - 1) + 1;
    let to = v.indexOf('\n', end);
    if (to < 0) to = v.length;
    return [from, to];
  };
  const replaceRange = (start, end, t) => S.replace(start, end, t);

  const api = {
    el: null,
    get: () => (S ? S.saved() : value),
    set: (t) => {
      ta.value = t;
      if (live && S === live && !ensureLive(t)) { S = text; setModeView('write'); }
      refresh(); recolour(); grow();
    },
    focus: (opts) => S.focus(opts),
    select: (from, to = from, opts) => S.select(from, to, opts),
    rectAt: (pos) => S.rectAt(pos),
    mode: () => mode,
    /** Listens on the editor as a whole: `blur` when the focus leaves it, any other event as it bubbles out of it. */
    on(type, fn, opts) {
      if (type === 'blur') api.el.addEventListener('focusout', (e) => { if (!api.el.contains(e.relatedTarget)) fn(e); }, opts);
      else api.el.addEventListener(type, fn, opts);
    },
    /** Wrap the selection with `mark`; with nothing selected, insert the mark pair around a placeholder. */
    wrap(mark, ph) {
      const [s, e] = S.sel(); const v = S.value();
      const inner = v.slice(s, e) || ph;
      const already = v.slice(s - mark.length, s) === mark && v.slice(e, e + mark.length) === mark;
      if (already) S.replace(s - mark.length, e + mark.length, inner, s - mark.length, s - mark.length + inner.length); // toggle off
      else S.replace(s, e, mark + inner + mark, s + mark.length, s + mark.length + inner.length);
    },
    /** Prefix every selected line (toggle: strip the prefix if all lines already have it). */
    prefixLines(prefix, { numbered = false } = {}) {
      const [from, to] = lineBounds(...S.sel());
      const lines = S.value().slice(from, to).split('\n');
      const has = (l) => (numbered ? /^\s*\d+\.\s/.test(l) : l.startsWith(prefix));
      const all = lines.every((l) => has(l) || !l.trim());
      const out = lines.map((l, i) => {
        if (all) return numbered ? l.replace(/^(\s*)\d+\.\s/, '$1') : l.slice(prefix.length);
        const bare = l.replace(LIST_RE, '$1'); // switching list kinds replaces the marker
        return numbered ? `${i + 1}. ${bare}` : prefix + bare;
      }).join('\n');
      S.replace(from, to, out, from, from + out.length);
    },
    link() {
      const [s, e] = S.sel();
      const sel = S.value().slice(s, e);
      const isUrl = /^(https?:\/\/|www\.)\S+$/i.test(sel);
      const t = isUrl ? `[${sel}](${sel})` : `[${sel || 'text'}](url)`;
      if (isUrl) S.replace(s, e, t, s + 1, s + 1 + sel.length);
      else S.replace(s, e, t, s + t.length - 4, s + t.length - 1); // select "url"
    },
    code() {
      const [s, e] = S.sel();
      const sel = S.value().slice(s, e);
      if (sel.includes('\n')) S.replace(s, e, `\`\`\`\n${sel}\n\`\`\``, s + 4, s + 4 + sel.length);
      else api.wrap('`', 'code');
    },
    /** The selection in a colour (mdcolour.js), or with it taken off (`colour` null). Only the part that changes is replaced. */
    colour(kind, c) {
      const v = S.value();
      const r = colourRange(v, ...S.sel(), kind, c);
      let a = 0;
      while (a < v.length && a < r.value.length && v[a] === r.value[a]) a++;
      let b = 0;
      while (b < v.length - a && b < r.value.length - a && v[v.length - 1 - b] === r.value[r.value.length - 1 - b]) b++;
      if (r.value !== v) S.replace(a, v.length - b, r.value.slice(a, r.value.length - b), r.start, r.end);
      else S.select(r.start, r.end);
    },
    /** The colours to pick from under a toolbar button: swatches, None, and any colour from the system picker. */
    palette(anchor, kind) {
      const keep = (e) => e.preventDefault(); // the text keeps its selection and focus
      const pickColour = (c) => { closeMenu(); api.colour(kind, c); };
      const custom = h('input', { type: 'color', value: kind === 'text' ? '#d93025' : '#fff3a3', 'aria-label': 'Any colour' });
      custom.addEventListener('input', () => api.colour(kind, kind === 'text' ? custom.value : `${custom.value}a6`)); // a highlight stays translucent
      const grid = h('div', { class: 'mde-swatches', role: 'group', 'aria-label': kind === 'text' ? 'Text colour' : 'Highlight' },
        (kind === 'text' ? TEXT_COLOURS : HIGHLIGHTS).map(([name, c]) => h('button', {
          type: 'button', class: `mde-swatch ${kind}`, title: name, 'aria-label': name, style: `--swatch: ${c}`,
          onmousedown: keep, onclick: () => pickColour(c),
        }, kind === 'text' ? 'A' : '')));
      dropdown(anchor, [
        { heading: kind === 'text' ? 'Text colour' : 'Highlight' }, grid,
        h('label', { class: 'mde-custom', onmousedown: (e) => { if (e.target !== custom) keep(e); } }, custom, 'Other colour…'),
        '-',
        { label: kind === 'text' ? 'No colour' : 'No highlight', icon: 'x', onSelect: () => api.colour(kind, null) },
      ], { width: 212 });
    },
  };

  /** The editor's own keys, on either surface → true when it took the key. */
  function handleKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') { // first Esc leaves the editor, the next closes the dialog
      e.stopPropagation();
      if (onEscape) onEscape(); else S.input.blur();
      return true;
    }
    if (!markdown && e.key !== 'Tab') return false; // a code file: only indenting is the editor's; Enter, ⌘B… are the browser's
    const take = (fn) => { e.preventDefault(); fn(); return true; };
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') return take(() => api.wrap('**', 'bold'));
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'i') return take(() => api.wrap('_', 'italic'));
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') return take(() => api.link());
    if (mod && e.shiftKey && e.key.toLowerCase() === 'c') return take(() => api.code());
    if (e.key === 'Tab' && !mod && !e.altKey) { // indent / outdent the selected lines (never leaves the editor by Tab: Esc first)
      return take(() => {
        const [s, end] = S.sel();
        const [from, to] = lineBounds(s, end);
        const lines = S.value().slice(from, to).split('\n');
        const out = lines.map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, '') : `  ${l}`)).join('\n');
        S.replace(from, to, out, from, from + out.length);
      });
    }
    if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey && !e.isComposing) { // continue a list / checklist; an empty item ends it
      const [s, end] = S.sel();
      if (s !== end) return false;
      const v = S.value();
      const from = v.lastIndexOf('\n', s - 1) + 1;
      const line = v.slice(from, s);
      const m = line.match(LIST_RE);
      if (!m) return false;
      return take(() => {
        if (!line.slice(m[0].length).trim()) { replaceRange(from, s, ''); return; }
        const marker = /^\d+\.$/.test(m[2]) ? `${Number(m[2]) + 1}.` : m[2];
        replaceRange(s, s, `\n${m[1]}${marker} ${m[3] ? '[ ] ' : ''}`);
      });
    }
    return false;
  }

  ta.addEventListener('input', changed);
  ta.addEventListener('keydown', (e) => { handleKey(e); });
  // A line too long to wrap scrolls the textarea sideways: the colours behind it follow.
  if (hl) ta.addEventListener('scroll', () => { hl.parentElement.scrollLeft = ta.scrollLeft; });
  // keep the preview roughly in step with the textarea
  ta.addEventListener('scroll', () => {
    if (!prev) return;
    const max = ta.scrollHeight - ta.clientHeight;
    if (max > 0) prev.scrollTop = (ta.scrollTop / max) * (prev.scrollHeight - prev.clientHeight);
  });

  // Dictation types at the cursor through replaceRange, so it counts as typing (onInput, autosave, preview). It sees
  // the editor as one field, whichever surface is in use.
  const field = {
    get value() { return S.value(); },
    get selectionStart() { return S.sel()[0]; },
    get selectionEnd() { return S.sel()[1]; },
    get isConnected() { return !!api.el?.isConnected; },
    focus: () => S.focus(),
    hasFocus: () => S.hasFocus(),
    addEventListener: (type, fn, opts) => api.el.addEventListener(type === 'blur' ? 'focusout' : type, fn, opts),
    removeEventListener: (type, fn, opts) => api.el.removeEventListener(type === 'blur' ? 'focusout' : type, fn, opts),
    dispatchEvent: () => true,
  };
  const mic = markdown ? dictation(field, { insert: replaceRange }) : null;

  // ── modes ──
  const wanted = markdown ? pref(MODE_PREF, 'live') : 'write';
  let mode = modes.some(([m]) => m === wanted) ? wanted : 'write';
  const setModeView = (m) => {
    mode = m;
    if (!api.el) return;
    api.el.dataset.mode = m;
    bar?.querySelectorAll('[data-mode]').forEach((b) => { const on = b.dataset.mode === m; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('active', on); });
  };
  /** Shows mode `m`, the text and the caret carried over from the surface in use; `remember`: the user picked it. */
  const setMode = (m, { remember = false } = {}) => {
    const from = S;
    let to = text;
    if (m === 'live') {
      to = ensureLive();
      if (!to) { to = text; m = 'write'; } // CodeMirror missing, or a text Live would not keep byte for byte
    }
    if (remember && markdown) setPref(MODE_PREF, m);
    setModeView(m);
    if (from && to !== from) {
      const [a, b] = from.sel();
      const had = from.hasFocus();
      if (to === text) { ta.value = from.saved(); recolour(); } // Live made with this text's line breaks: the same text
      S = to;
      markFk();
      if (to === text) requestAnimationFrame(grow);
      if (had) to.select(a, b);
    } else { S = to; markFk(); }
    if (m === 'split' || m === 'preview') refresh();
  };

  const bar = !markdown ? null : h('div', { class: 'mde-bar', role: 'toolbar', 'aria-label': `${label} formatting` },
    ACTIONS.map((a) => (a === '-' ? h('span', { class: 'mde-sep' }) : h('button', {
      type: 'button', class: 'btn icon', title: a.kbd ? `${a.label} (${a.kbd})` : a.label,
      onmousedown: (e) => e.preventDefault(), // keep the text's selection
      onclick: (e) => a.run(api, e.currentTarget),
    }, icon(a.icon, 16)))),
    mic ? [h('span', { class: 'mde-sep' }), mic.el] : null,
    modes.length > 1 ? seg(modes.map(([m, t, tip]) => [m, t, { attrs: { 'data-mode': m, title: tip, onmousedown: (e) => e.preventDefault() } }]), mode,
      (m) => setMode(m, { remember: true }), { aria: 'Layout', cls: 'mde-modes' }) : null,
    trailing); // the caller's, last (mdblock.js: Saved / ● unsaved)

  api.el = h('div', { class: `mde ${prev ? 'with-preview' : ''} ${hl ? 'coloured' : ''}`, 'data-mode': mode }, bar,
    h('div', { class: 'mde-panes' }, write, livePane, prev));
  // Live, if CodeMirror is here already (it is loaded once the page is idle: main.js); else Source now and Live as
  // soon as it comes, if nothing has been typed meanwhile.
  const wantLive = mode === 'live';
  setMode(wantLive && !liveLoaded() ? 'write' : mode);
  if (wantLive && S === text && !liveLoaded()) {
    loadLive().then((cm) => {
      if (cm && api.el.isConnected && mode === 'write' && ta.value === value) {
        const had = text.hasFocus(); const sel = text.sel();
        setMode('live');
        if (had && S === live) live.select(...sel);
      }
    });
  }
  refresh();
  recolour();
  requestAnimationFrame(grow); // its height once it is on the page
  // …or at once, for whoever just put it on the page and restores a scroll next (a card re-rendered after a save): a
  // scroll restored over the editor's minimum height is clipped, and the caret's line lands at the bottom (TSK-055).
  api.el.addEventListener('mde:fit', grow);
  return api;
}
