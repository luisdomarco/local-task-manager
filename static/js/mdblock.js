// A markdown text block (the item's description, an activity's resolution, the create form's description): rendered
// in a bordered box that opens the editor on a click, and back to the text once left. Out of panel.js so the create form
// (create.js, which panel.js imports) draws its description the same way.
import { sourceOffset } from './clickmap.js';
import { mdEditor } from './mdeditor.js';
import { isTouch } from './phone.js';
import { pref, setPref } from './prefs.js';
import { toast } from './state.js';
import { foldHead, h, icon, renderMarkdown } from './ui.js';

// Height at which a rendered description gets clipped behind "See more" (keep in sync with .md-wrap.clamped).
const CLAMP_PX = 240;

/** The text node and offset under a point (each browser has its own call), or null. */
function caretAtPoint(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

/** A click on rendered Markdown → { offset in its source, y of the click }, or null when it cannot be placed. */
function clickInSource(rendered, source, e) {
  const at = caretAtPoint(e.clientX, e.clientY);
  if (!at || at.node.nodeType !== Node.TEXT_NODE || !rendered.contains(at.node)) return null;
  const before = document.createRange();
  before.setStart(rendered, 0);
  before.setEnd(at.node, at.offset);
  const ratio = before.toString().length / Math.max(1, rendered.textContent.length);
  const offset = sourceOffset(source, at.node.textContent, at.offset, ratio);
  return offset < 0 ? null : { offset, y: e.clientY };
}

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

/** The nearest element around `el` that scrolls vertically. */
function scrollerOf(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

/**
 * A markdown text block: rendered in a bordered box that opens the editor on click (with
 * Markdown / Both / View and Done — or a click outside it), long text clipped behind "See more". What you type saves
 * itself AUTOSAVE_MS after you stop (and on blur); the title row says Saving… / Saved. The
 * item's description and an activity's resolution are two instances of it.
 *   configure({ label, emptyText, placeholder, title })  what to call it, set per item (title: the item's, for full screen)
 *   write(text) → Promise<string>                 saves a draft, returns the saved text
 *   heading() → nodes                             the title row's content (default: icon + label)
 *   fold: key                                     its title folds the block (the item's description), open or folded
 *                                                 kept under `<key>.open` for every item (its head: ui.js foldHead)
 */
const AUTOSAVE_MS = 800;
const RETRY_MS = [2000, 5000, 10000, 30000]; // a save that failed for any reason but a conflict (server down…) tries again, then every 30s

export function mdBlock({ fk, minHeight, write, fetchTheirs = null, heading = null, cls = '', fold = null }) {
  let saved = '';
  let autosave = null; // the pending save of what is being typed
  let retries = 0; // failed saves in a row (not conflicts): how long until the next try
  let changed = false; // the file changed on disk while a draft was open: the user picks which text wins
  let inflight = null; // the save in progress: a second flush waits for it instead of sending the same text again
  let draft = null; // unsaved text, or null when clean
  let editing = false;
  let expanded = false; // long text shown in full ("See less") instead of clipped ("See more")
  let outside = null; // while editing: a press anywhere outside the block finishes, as Done does
  // On a touch screen a tap, not a press: a finger that scrolls the card presses outside the block too.
  const OUTSIDE = isTouch() ? 'click' : 'pointerdown';
  const stopOutside = () => { if (outside) document.removeEventListener(OUTSIDE, outside, true); outside = null; };
  let cfg = { label: 'Description', emptyText: 'Add a more detailed description…', placeholder: '', title: '' };
  const el = h('div', { class: `body-wrap ${cls}` }); // kept across re-renders so the textarea never loses focus
  // Full screen: the block covers the card (on a page, the window) until Close or Esc. Only a class on `el`,
  // never a re-render, so an open editor keeps its text, caret and focus. The first Esc still leaves the
  // editor (mdeditor.js onEscape: Done); the next one, caught here before the card's own Esc, leaves full screen.
  const escFull = (e) => {
    if (!el.isConnected) { document.removeEventListener('keydown', escFull, true); return; }
    if (e.key !== 'Escape' || e.target.closest?.('textarea')) return;
    e.preventDefault(); e.stopPropagation();
    setFull(false);
  };
  const setFull = (on, focus = true) => {
    el.classList.toggle('full', on);
    if (on) document.addEventListener('keydown', escFull, true);
    else document.removeEventListener('keydown', escFull, true);
    if (focus) (el.querySelector('textarea') || el.querySelector(on ? '.body-full-close' : '.full-btn'))?.focus({ preventScroll: true });
  };

  const setStatus = (text) => { const s = el.querySelector('.unsaved'); if (s) s.textContent = text; };
  const blk = {
    el,
    configure(next) { cfg = { ...cfg, ...next }; },
    reset(text = '') { stopOutside(); clearTimeout(autosave); retries = 0; saved = text || ''; draft = null; editing = false; expanded = false; changed = false; setFull(false, false); el.replaceChildren(); },
    /** The file changed on disk under an open draft: show the choice instead of silently overwriting. */
    markChanged() { if (!changed) { changed = true; blk.render(); } },
    isChanged: () => changed,
    clearDraft() { clearTimeout(autosave); draft = null; },
    hasUnsaved: () => draft !== null && draft !== saved,
    isEditing: () => editing,
    ready: () => el.childNodes.length > 0,
    async flush() {
      // A blur and a click can both ask to save the same text. Only one goes out: the other waits for it and then
      // looks again, because the file's version has moved on and a second send would conflict with the first.
      clearTimeout(autosave);
      if (inflight) { await inflight; return blk.flush(); }
      if (!blk.hasUnsaved()) { draft = null; return true; }
      const sending = draft;
      setStatus('Saving…');
      inflight = (async () => {
        try {
          saved = await write(sending);
          if (draft === sending) draft = null; // typed more meanwhile: that stays a draft
          changed = false;
          retries = 0;
          setStatus(blk.hasUnsaved() ? '● unsaved' : 'Saved');
          return true;
        } catch (e) {
          if (e.status === 409) { setStatus('● unsaved'); blk.markChanged(); return false; }
          // Not saved and nothing to choose: keep the draft and try again on our own, without waiting for a keystroke.
          const wait = RETRY_MS[Math.min(retries++, RETRY_MS.length - 1)];
          setStatus(`● not saved — retrying in ${wait / 1000}s`);
          clearTimeout(autosave);
          autosave = setTimeout(() => { if (blk.hasUnsaved() && el.isConnected) blk.flush(); }, wait);
          return false;
        } finally { inflight = null; }
      })();
      return inflight;
    },
    render() {
      const text = draft ?? saved;
      const touch = isTouch(); // a tap on the text scrolls or follows a link: an Edit button opens the editor
      stopOutside();
      // `at` ({ offset, y }): opened by a click on the text — the caret goes where it was, and that line stays under
      // the pointer. Without it (an empty block) the editor opens at the top.
      const startEdit = (at = null) => {
        editing = true;
        blk.render();
        const ta = el.querySelector('textarea');
        if (!ta) return;
        const pos = at ? at.offset : 0; // the value was set after creation, so the caret would sit at the end and scroll there
        ta.setSelectionRange(pos, pos);
        ta.focus({ preventScroll: true });
        ta.scrollTop = 0;
        if (!at) { el.scrollIntoView({ block: 'nearest' }); return; }
        requestAnimationFrame(() => { // once the editor has its height
          const line = caretRect(el.querySelector('.mde-hl code'), pos);
          const box = line ? scrollerOf(ta) : null;
          if (box) box.scrollTop += line.top - at.y;
          else el.scrollIntoView({ block: 'nearest' });
        });
      };
      // "Reload" takes what is on disk and drops the draft; "Keep mine" saves the draft over it.
      const notice = changed ? h('div', { class: 'body-conflict', role: 'alert' },
        h('span', {}, `This ${cfg.label.toLowerCase()} changed on disk while you were editing it.`),
        h('button', { class: 'btn small', onmousedown: (e) => e.preventDefault(), onclick: async () => {
          const theirs = fetchTheirs ? await fetchTheirs() : null;
          if (theirs === null) return;
          saved = theirs; draft = null; changed = false; editing = false; blk.render();
        } }, 'Reload (drop mine)'),
        h('button', { class: 'btn small primary', onmousedown: (e) => e.preventDefault(), onclick: async () => {
          try { saved = await write(draft ?? saved, true); draft = null; changed = false; editing = false; blk.render(); } catch { /* toasted */ }
        } }, 'Keep mine')) : null;
      // Folded (`fold`), only this row shows; its title is the ▸/▾ that opens it (leaving the editor first, saving).
      // In a tab of its own (a project's page: cfg.tabbed) it never folds, and the tab names it.
      const foldKey = cfg.tabbed ? null : fold;
      el.classList.toggle('in-tab', !!cfg.tabbed); // its copy and full-screen buttons over the box's corner (app.css)
      const open = !foldKey || pref(`${foldKey}.open`, true) !== false;
      const title = cfg.tabbed ? [] : heading ? heading() : [icon('text', 15), cfg.label];
      const toggle = h('div', { class: 'body-tabs' },
        h('h4', {}, ...(foldKey ? [foldHead({
          open, class: 'body-fold', what: `the ${cfg.label.toLowerCase()}`,
          title: title.map((n) => (typeof n === 'string' ? h('span', { class: 'fold-title' }, n) : n)),
          onToggle: async (next) => {
            if (editing && !(await blk.flush())) return; // a save that needs a choice keeps it open
            editing = false;
            setPref(`${foldKey}.open`, next);
            blk.render();
          },
        })] : title)),
        h('span', { class: 'muted unsaved small' }, blk.hasUnsaved() ? '● unsaved' : ''),
        touch && !editing && text.trim() ? h('button', { class: 'btn small body-edit', onclick: () => startEdit() }, icon('pencil', 14), 'Edit') : null,
        text.trim() ? h('button', {
          class: 'btn icon', title: `Copy the ${cfg.label.toLowerCase()} (Markdown)`,
          onmousedown: (e) => e.preventDefault(), // while editing: no blur, no save
          onclick: async () => {
            const now = el.querySelector('textarea')?.value ?? draft ?? saved; // what is on screen, typed or not
            try { await navigator.clipboard.writeText(now); toast(`${cfg.label} copied`); } catch { toast(`Could not copy the ${cfg.label.toLowerCase()}`, true); }
          },
        }, icon('copy', 14)) : null,
        h('button', { class: 'btn icon full-btn', title: 'Full screen', onmousedown: (e) => e.preventDefault(), onclick: () => setFull(true) }, icon('maximize', 14)));
      // Shown only in full screen (CSS): the item's title and the way back.
      const fullHead = h('div', { class: 'body-full-head' }, h('h2', {}, cfg.title || cfg.label),
        h('button', { class: 'btn ghost body-full-close', title: 'Exit full screen (Esc)', onmousedown: (e) => e.preventDefault(), onclick: () => setFull(false) },
          'Close', icon('restore', 14)));
      if (!open) { el.replaceChildren(fullHead, toggle); return; }
      let content;
      if (editing) {
        const mde = mdEditor({
          value: text, minHeight, label: cfg.label, fk, highlight: 'markdown',
          placeholder: cfg.placeholder,
          // Esc is Done: back to the text as it reads once all is saved, waiting for a save still on its way.
          onEscape: () => done(),
          onInput: (v) => {
            draft = v;
            setStatus('● unsaved');
            clearTimeout(autosave);
            autosave = setTimeout(() => blk.flush(), AUTOSAVE_MS); // a 409 here shows the Reload / Keep mine choice
          },
        });
        content = mde.el;
        mde.textarea.addEventListener('blur', () => blk.flush());
        mde.textarea.addEventListener('keydown', (e) => {
          if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'Enter')) { e.preventDefault(); done(); }
        });
        // Everything typed is already saved (or about to be): leaving saves what is pending and closes the editor.
        const done = () => blk.flush().then((ok) => { if (ok) { editing = false; blk.render(); } });
        // A press outside the block (not in full screen, where the block is all there is) saves and leaves the
        // editor, back to the text as it reads. A save that needs a choice (changed on disk) keeps it open.
        outside = (e) => {
          if (!el.isConnected) { stopOutside(); return; }
          if (el.contains(e.target) || el.classList.contains('full') || e.target.closest?.('.menu')) return; // a menu of its toolbar (colours)
          stopOutside();
          done();
        };
        document.addEventListener(OUTSIDE, outside, true);
        el.replaceChildren(fullHead, toggle, ...(notice ? [notice] : []), content, h('div', { class: 'body-actions' }, touch
          ? h('button', { class: 'btn primary body-done', onmousedown: (e) => e.preventDefault(), onclick: () => done() }, 'Done')
          : h('span', { class: 'muted small' }, 'Markdown · saves as you type · a click outside, ⌘↵ or Esc leaves the editor')));
        return;
      } else if (!text.trim()) {
        content = h('button', { class: 'body-empty', onclick: () => startEdit() }, cfg.emptyText);
      } else {
        content = h('div', { class: 'md' });
        // renderMarkdown() sanitizes with DOMPurify (and fails closed without it).
        content.innerHTML = renderMarkdown(text);
        // Make checklist boxes clickable: the n-th box toggles the n-th "[ ]"/"[x]" marker.
        content.querySelectorAll('input[type=checkbox]').forEach((box, n) => {
          box.disabled = false;
          box.addEventListener('change', () => {
            let i = -1;
            draft = text.replace(/^(\s*[-*+]\s+)\[([ xX])\]/gm, (m, pre, mark) =>
              (++i === n ? `${pre}[${mark === ' ' ? 'x' : ' '}]` : m));
            blk.flush();
          });
        });
      }
      if (editing || !text.trim()) { el.replaceChildren(fullHead, toggle, ...(notice ? [notice] : []), content); return; }

      // A long description is clipped with a "See more" toggle; measured before the next paint.
      const wrap = h('div', { class: 'md-wrap', title: touch ? null : 'Click to edit' }, content);
      // One click anywhere in the box opens the editor, unless it was a link, a checklist box, or the end of a text selection.
      if (!touch) {
        wrap.addEventListener('click', (e) => {
          if (e.target.closest('input, a') || window.getSelection().toString()) return;
          startEdit(clickInSource(content, text, e));
        });
      }
      const more = h('button', { class: 'btn small ghost see-more', hidden: true, onclick: () => {
        expanded = !expanded;
        wrap.classList.toggle('clamped', !expanded);
        more.textContent = expanded ? 'See less' : 'See more';
      } });
      el.replaceChildren(fullHead, toggle, ...(notice ? [notice] : []), wrap, more);
      // Measured whenever the text gets a size, not once on the next frame: drawn in a tab not shown yet or a page not
      // yet in the window it measures 0 then, and would stay unclipped. Its own height is the same clipped or not, so
      // clipping it never measures it again.
      const measure = () => {
        const tall = content.scrollHeight > CLAMP_PX + 48; // not worth hiding a few lines
        wrap.classList.toggle('clamped', tall && !expanded);
        more.textContent = expanded ? 'See less' : 'See more';
        more.hidden = !tall;
      };
      new ResizeObserver(measure).observe(content);
    }
  };
  return blk;
}
