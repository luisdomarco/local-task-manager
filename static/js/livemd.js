// The Live editor: Markdown written over its formatted look, as in Obsidian's Live Preview. It runs on CodeMirror 6
// (static/vendor/codemirror/, loaded the first time it is needed). The text is the file's, byte for byte: CodeMirror
// edits plain text and keeps the file's line breaks (livemarks.js lineSepOf). What makes it read formatted is drawing
// only: livemarks.js says which marks to hide and which widgets to draw, and this module turns that into decorations.
// mdeditor.js uses it as one of its two surfaces (the other is the Markdown textarea).
import { lineSepOf, liveBlocks, liveMarks } from './livemarks.js';

const BASE = new URL('../vendor/codemirror/', import.meta.url).href;
let CM = null;
let loading = null;

/** CodeMirror, once loaded (else null): what a surface is built with without waiting. */
export const liveLoaded = () => CM;

/** Loads CodeMirror (once) → the module, or null when it cannot be loaded (the editor then stays in Source). */
export function loadLive() {
  if (CM) return Promise.resolve(CM);
  loading ||= import(`${BASE}codemirror.js`).then((m) => { CM = m; return m; }).catch(() => { loading = null; return null; });
  return loading;
}

let language = null;
/** Markdown as the page reads it (ui.js renderMarkdown): GFM, and no "setext" headings (a line underlined by ---). */
function markdownLanguage(cm) {
  language ||= new cm.Language(cm.defineLanguageFacet(), cm.markdownParser.configure([cm.GFM, { remove: ['SetextHeading'] }]), [], 'markdown');
  return language;
}

/** The decorations for what is on screen, from livemarks.js. */
const OPEN_TIP = /Mac|iP(hone|ad)/.test(globalThis.navigator?.platform || '') ? '⌘-click to open' : 'Ctrl-click to open';
const LINKISH = new Set(['cm-link', 'cm-wikilink', 'cm-ref']);
function decorations(cm, view, widgets, isRef, focused) {
  const { state } = view;
  const out = [];
  for (const { from, to } of view.visibleRanges) {
    const r = liveMarks(cm.syntaxTree(state), state.doc, { ranges: state.selection.ranges, focused, from, to, isRef });
    for (const l of r.lines) out.push(cm.Decoration.line({ class: l.cls }).range(l.at));
    for (const m of r.marks) {
      if (m.to <= m.from) continue;
      const attributes = LINKISH.has(m.cls) ? { ...m.attrs, title: OPEN_TIP } : m.attrs || undefined;
      out.push(cm.Decoration.mark({ class: m.cls, attributes }).range(m.from, m.to));
    }
    for (const h of r.hides) out.push(cm.Decoration.replace({}).range(h.from, h.to));
    for (const w of r.widgets) out.push(cm.Decoration.replace({ widget: widgets[w.kind](w) }).range(w.from, w.to));
  }
  return cm.Decoration.set(out, true);
}

/** The widgets: a checklist box that ticks itself in the text, a bullet, a rule. Made once per CodeMirror. */
function widgetKinds(cm) {
  class Check extends cm.WidgetType {
    constructor(checked, box) { super(); this.checked = checked; this.box = box; }
    eq(o) { return o.checked === this.checked && o.box === this.box; }
    toDOM(view) {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'cm-check';
      box.checked = this.checked;
      box.setAttribute('aria-label', this.checked ? 'Done: untick' : 'Tick');
      box.addEventListener('mousedown', (e) => e.preventDefault()); // the caret stays where it is
      box.addEventListener('click', (e) => {
        e.preventDefault();
        const at = view.posAtDOM(box);
        // The box's own character, between its brackets: `[ ]` ↔ `[x]`. Found again from where the widget is drawn,
        // in case the text moved since it was made.
        const line = view.state.doc.lineAt(at);
        const m = /\[([ xX])\]/.exec(view.state.sliceDoc(at, line.to));
        if (!m) return;
        const pos = at + m.index + 1;
        view.dispatch({ changes: { from: pos, to: pos + 1, insert: m[1] === ' ' ? 'x' : ' ' }, userEvent: 'input.check' });
      });
      return box;
    }
    ignoreEvent() { return true; }
  }
  class Bullet extends cm.WidgetType {
    eq() { return true; }
    toDOM() { const s = document.createElement('span'); s.className = 'cm-bullet'; s.textContent = '•'; return s; }
  }
  class Rule extends cm.WidgetType {
    eq() { return true; }
    toDOM() { const s = document.createElement('span'); s.className = 'cm-rule'; s.setAttribute('aria-hidden', 'true'); return s; }
  }
  const bullet = new Bullet(); const rule = new Rule();
  return { check: (w) => new Check(w.checked, w.box), bullet: () => bullet, rule: () => rule };
}

/**
 * Tables, callouts and diagrams drawn whole, as the preview draws them (livemarks.js liveBlocks), when the selection is
 * not on them. CodeMirror takes block widgets only from a StateField, so they live here and not in the ViewPlugin
 * above. `renderBlock(text, el)` (mdeditor.js) fills a block's element; a click on it puts the caret at the block's
 * start, which shows its Markdown to edit. `isFocused()` is the surface's settled focus, and `refresh` an effect that
 * says it changed.
 */
function blockField(cm, renderBlock, isFocused, refresh) {
  class Block extends cm.WidgetType {
    constructor(text, kind) { super(); this.text = text; this.kind = kind; }
    eq(o) { return o.text === this.text && o.kind === this.kind; }
    toDOM(view) {
      const el = document.createElement('div');
      el.className = `cm-block-widget md cm-block-${this.kind}`;
      renderBlock(this.text, el);
      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if ((e.metaKey || e.ctrlKey) && e.target.closest?.('a[href]')) return; // ⌘-click opens the link
        e.preventDefault();
        const at = view.posAtDOM(el);
        view.dispatch({ selection: { anchor: at }, effects: refresh.of(true) });
        view.focus();
      });
      // A plain click on a link inside only edits, as on the text: the link opens with ⌘-click.
      el.addEventListener('click', (e) => { if (!(e.metaKey || e.ctrlKey)) e.preventDefault(); });
      return el;
    }
    ignoreEvent() { return true; }
  }
  const build = (state, focused) => {
    const blocks = liveBlocks(cm.syntaxTree(state), state.doc, { ranges: state.selection.ranges, focused });
    return cm.Decoration.set(blocks.map((b) => cm.Decoration.replace({ widget: new Block(state.sliceDoc(b.from, b.to), b.kind), block: true }).range(b.from, b.to)));
  };
  const field = cm.StateField.define({
    create: (state) => build(state, isFocused()),
    update(deco, tr) {
      const own = tr.effects.find((e) => e.is(refresh));
      if (!tr.docChanged && !tr.selection && !own && cm.syntaxTree(tr.state) === cm.syntaxTree(tr.startState)) return deco;
      return build(tr.state, own ? own.value : isFocused());
    },
    provide: (f) => cm.EditorView.decorations.from(f),
  });
  // ↓ and ↑ step into a drawn block (its first line going down, its last going up), which then shows its Markdown.
  // CodeMirror would move past it, as one piece.
  const stepInto = (down) => (view) => {
    const sel = view.state.selection.main;
    if (!sel.empty) return false;
    const next = view.moveVertically(sel, down).head;
    let hit = null;
    view.state.field(field).between(Math.min(sel.head, next), Math.max(sel.head, next), (from, to) => {
      if (down ? from < sel.head : to > sel.head) return;
      if (!hit || (down ? from < hit.from : from > hit.from)) hit = { from, to };
    });
    if (!hit) return false;
    view.dispatch({ selection: { anchor: down ? hit.from : view.state.doc.lineAt(hit.to).from }, scrollIntoView: true, userEvent: 'select' });
    return true;
  };
  return [field, cm.Prec.high(cm.keymap.of([{ key: 'ArrowDown', run: stepInto(true) }, { key: 'ArrowUp', run: stepInto(false) }]))];
}

// CodeMirror's own parts, in the app's tokens. Here and not in app.css: CodeMirror adds its styles at run time,
// outside the page's cascade layers (css/main.css), so they beat any rule of app.css; a theme of its own comes after
// its base theme and wins. What it draws for the app (.cm-h1, .cm-link…: livemarks.js) is styled in app.css.
const THEME = {
  '&': { color: 'var(--foreground)', backgroundColor: 'transparent', fontSize: 'var(--fs-base)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font)', lineHeight: '1.65', overflow: 'visible' },
  '.cm-content': { padding: '12px 16px', caretColor: 'var(--foreground)', cursor: 'text' },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'var(--muted-foreground)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'color-mix(in srgb, var(--hl-title) 30%, transparent)' },
  '.cm-tooltip': { border: '1px solid var(--border)', backgroundColor: 'var(--popover)', color: 'var(--popover-foreground)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font)', fontSize: 'var(--fs-sm)', maxHeight: '19em', minWidth: '240px', padding: '4px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { display: 'flex', alignItems: 'baseline', gap: '10px', padding: '5px 8px', borderRadius: 'var(--radius-sm)', lineHeight: '1.4' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' },
  '.cm-completionLabel': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  '.cm-completionDetail': { marginLeft: 'auto', paddingLeft: '12px', fontStyle: 'normal', color: 'var(--muted-foreground)', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '600' },
};

// Keys CodeMirror binds by default that the app gives another meaning (⌘↵ finishes, ⌘I is italic, ⌘[ ⌘] are the
// browser's) or that would surprise in prose.
const DROPPED_KEYS = new Set(['Mod-Enter', 'Mod-i', 'Mod-[', 'Mod-]', 'Mod-Alt-\\', 'Shift-Mod-\\', 'Mod-/', 'Alt-A', 'Shift-Alt-a', 'Escape']);

/** An offset in `raw` (the text as saved) → the same place in the text with every line break counted as one. */
export const lfOffset = (raw, offset) => offset - (String(raw).slice(0, offset).match(/\r(?=\n)/g) || []).length;

/**
 * liveSurface({ value, minHeight, placeholder, label, onChange, onKey, completions, isRef, onOpen, renderBlock }) → a surface, or null when
 * CodeMirror is not loaded or the text mixes line breaks (lineSepOf). A surface (mdeditor.js) is
 *   { kind, el, input, value(), saved(), sel() → [from, to], select(from, to, { scroll }), replace(from, to, text, [selFrom, selTo]),
 *     focus(), hasFocus(), rectAt(pos), setValue(text), destroy() }
 * Positions count a line break as one character, as the textarea does; `value()` is the text that way too. `saved()`
 * and `onChange(text)` give it with the file's own line breaks. `setValue(text)` → false when `text` has other line
 * breaks than the surface was made with (make a new one).
 * `onKey(e)` sees every key first and returns true when it took it (mdeditor.js: ⌘B, lists, Esc…), unless the
 * completion menu is open, whose keys come first. `completions`: CodeMirror completion sources (vaultlinks.js: the /,
 * [[ and @ menus). `isRef(ref)`: whether a ref (STY-482) is an item's, drawn as a link; ⌘-click on a link, a [[doc]]
 * (at its heading, when it names one) or a ref calls `onOpen({ href, target, heading, ref })`. With `renderBlock(text, el)`,
 * tables, callouts and diagrams the caret is not on are drawn whole (blockField).
 */
export function liveSurface({ value = '', minHeight = '320px', placeholder = '', label = 'Text', onChange = () => {}, onKey = () => false, completions = [],
  isRef = () => false, onOpen = () => {}, renderBlock = null } = {}) {
  const cm = CM;
  const sep = lineSepOf(value);
  if (!cm || !sep) return null;
  const widgets = widgetKinds(cm);
  // Losing the focus only counts once it is lost for a moment. Saving redraws the card around the editor, and that
  // takes the focus away and gives it back in the same few milliseconds (panel.js keepFocus): the line being typed on
  // would flash formatted and back, and an open menu would close, after every save.
  const settled = cm.StateEffect.define();
  let focused = false; // as drawn: the active line shows its Markdown
  const refresh = cm.StateEffect.define(); // the blocks' field learns the settled focus: value true or false
  const blocks = renderBlock ? blockField(cm, renderBlock, () => focused, refresh) : [];
  const deco = cm.ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = decorations(cm, view, widgets, isRef, focused); }
    update(u) {
      let redraw = u.docChanged || u.viewportChanged || u.selectionSet || cm.syntaxTree(u.state) !== cm.syntaxTree(u.startState);
      if (u.focusChanged && u.view.hasFocus && !focused) {
        focused = true; redraw = true;
        if (renderBlock) queueMicrotask(() => { if (u.view.dom.isConnected) u.view.dispatch({ effects: refresh.of(true) }); });
      }
      if (u.focusChanged && !u.view.hasFocus) {
        setTimeout(() => {
          if (u.view.hasFocus || !focused || !u.view.dom.isConnected) return; // back already, or gone with its card
          u.view.dispatch({ effects: renderBlock ? [settled.of(null), refresh.of(false)] : settled.of(null) });
        }, 150);
      }
      if (u.transactions.some((tr) => tr.effects.some((e) => e.is(settled)))) {
        focused = false; redraw = true;
        cm.closeCompletion(u.view);
      }
      if (redraw) this.decorations = decorations(cm, u.view, widgets, isRef, focused);
    }
  }, { decorations: (p) => p.decorations });
  const keys = cm.Prec.highest(cm.EditorView.domEventHandlers({
    keydown: (e, view) => {
      if (cm.completionStatus(view.state) === 'active' && /^(Enter|Tab|Escape|ArrowUp|ArrowDown|PageUp|PageDown)$/.test(e.key)) return false;
      return onKey(e) === true;
    },
    // ⌘-click (Ctrl-click) on a link, a [[doc]] or a ref opens it; a plain click puts the cursor there, to edit it.
    mousedown: (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return false;
      const el = e.target.closest?.('[data-href], [data-target], [data-ref]');
      if (!el) return false;
      e.preventDefault();
      onOpen({ href: el.dataset.href || null, target: el.dataset.target || null, heading: el.dataset.heading || null, ref: el.dataset.ref || null });
      return true;
    },
  }));
  const view = new cm.EditorView({
    parent: document.createElement('div'),
    state: cm.EditorState.create({
      doc: value,
      extensions: [
        cm.EditorState.lineSeparator.of(sep),
        markdownLanguage(cm),
        cm.history(),
        keys,
        cm.keymap.of([...cm.historyKeymap, ...cm.defaultKeymap.filter((k) => !DROPPED_KEYS.has(k.key) && !DROPPED_KEYS.has(k.mac))]),
        cm.EditorView.lineWrapping,
        placeholder ? cm.placeholder(placeholder) : [],
        cm.EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true', spellcheck: 'true', autocapitalize: 'sentences' }),
        cm.EditorView.theme({ ...THEME, '.cm-content': { ...THEME['.cm-content'], minHeight } }),
        completions.length ? cm.autocompletion({ override: completions, icons: false, closeOnBlur: false, maxRenderedOptions: 12 }) : [], // closed by `settled`
        deco,
        blocks,
        cm.EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.sliceDoc()); }),
      ],
    }),
  });
  const el = view.dom.parentElement;
  el.className = 'mde-live';
  const toDoc = (text) => String(text).replace(/\r?\n/g, view.state.lineBreak);
  const clamp = (p) => Math.max(0, Math.min(p, view.state.doc.length));
  return {
    kind: 'live', el, view, input: view.contentDOM,
    value: () => view.state.doc.toString(),
    saved: () => view.state.sliceDoc(),
    sel: () => { const r = view.state.selection.main; return [r.from, r.to]; },
    select(from, to = from, { scroll = true } = {}) {
      view.dispatch({ selection: { anchor: clamp(from), head: clamp(to) }, scrollIntoView: scroll });
      view.focus(); // never scrolls by itself
    },
    replace(from, to, text, selFrom = null, selTo = null) {
      const insert = toDoc(text);
      const end = from + text.length;
      view.dispatch({
        changes: { from, to, insert },
        selection: selFrom === null ? { anchor: end } : { anchor: selFrom, head: selTo ?? selFrom },
        scrollIntoView: true,
        userEvent: 'input',
      });
      view.focus();
    },
    focus: (opts) => { view.focus(); if (opts?.preventScroll === false) view.dispatch({ scrollIntoView: true }); },
    hasFocus: () => view.hasFocus,
    rectAt: (pos) => { const r = view.coordsAtPos(clamp(pos)); return r ? { top: r.top, bottom: r.bottom, left: r.left, height: r.bottom - r.top } : null; },
    /** The whole text replaced (an outside edit reloaded): one change, so undo can bring the old one back. */
    setValue(text) {
      if (text === view.state.sliceDoc()) return true;
      if (lineSepOf(text) !== view.state.lineBreak) return false; // other line breaks: the caller makes a new surface
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: toDoc(text) } });
      return true;
    },
    destroy: () => view.destroy(),
  };
}
