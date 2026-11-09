// One file of an agent, as its page shows it — its own instructions, or a skill, subagent or file it works with: a card
// with its path and the Explorer's Preview · Source · Edit (views/files.js), so every Markdown file reads the same in
// the app. Preview renders it (its body, without the frontmatter), Source shows it whole, Edit writes it — saved as you
// type, against the version it was read at (server.py agent_file_save, tm/agentfiles.py): a file changed meanwhile on
// disk is never written over, it asks. Preview or Source is remembered in this browser; Edit never is. A `summary` (a
// skill's or subagent's description, unfolded under its row) goes between its path and its text.
import { api } from './api.js';
import { codeLanguage } from './filetree.js';
import { highlight } from './highlight.js';
import { mdEditor } from './mdeditor.js';
import { pref, setPref } from './prefs.js';
import { toast } from './state.js';
import { h, icon, renderMarkdown } from './ui.js';

const MODE_KEY = 'agents.fileMode';
const AUTOSAVE_MS = 800;
const MODES = { markdown: [['preview', 'eye', 'Preview'], ['source', 'code', 'Source'], ['edit', 'pencil', 'Edit']],
  text: [['source', 'code', 'Source'], ['edit', 'pencil', 'Edit']] };

/**
 * agentFile({ dir, cmd, path, summary, onSaved }) → { el }. `path` empty is the command's own file. The file is read when the
 * card is built; `onSaved(file)` after each save (the page reads its fields again).
 */
export function agentFile({ dir, cmd, path = '', summary = '', onSaved = () => {} }) {
  let file = null;      // { path, text, body, markdown, rev } as last read or saved
  let mode = pref(MODE_KEY, 'preview');
  let back = mode;      // where Done goes back to
  let ed = null;        // the editor while in Edit: { mde, wrap, status, notice }
  let draft = null;     // typed and not saved yet
  let timer = null;
  let saving = null;    // the save on its way
  let conflict = false;

  const pathEl = h('span', { class: 'mono agents-file-path', title: path || '' }, path || '…');
  const seg = h('div', { class: 'seg agents-file-seg', role: 'group', 'aria-label': 'Show as' });
  const body = h('div', { class: 'agents-file-body' }, h('p', { class: 'muted small' }, 'Reading…'));
  const el = h('section', { class: 'agents-doc' }, h('div', { class: 'agents-doc-head' }, icon('text', 13), pathEl, seg),
    summary ? h('p', { class: 'muted agents-file-summary' }, summary) : null, body);

  const kind = () => (file?.markdown ? 'markdown' : 'text');
  const shown = () => (mode === 'preview' && kind() !== 'markdown' ? 'source' : mode);

  function paintSeg() {
    const now = shown();
    seg.replaceChildren(...MODES[kind()].map(([m, ico, label]) => h('button', {
      class: `btn small ${now === m ? 'active' : ''}`, type: 'button', 'aria-pressed': String(now === m), disabled: !file,
      title: m === 'edit' ? 'Edit it here (saved as you type)' : null, onclick: () => setMode(m),
    }, icon(ico, 13), label)));
  }

  function setMode(m) {
    if (m === shown()) return;
    if (shown() === 'edit') { flush().then((ok) => { if (ok) { leaveEdit(); setMode(m); } }); return; }
    if (m === 'edit') back = shown();
    else { setPref(MODE_KEY, m); back = m; }
    mode = m;
    paint();
  }

  const source = () => {
    const lang = file.markdown ? 'markdown' : codeLanguage(file.path);
    const code = h('code', { class: lang ? `hljs language-${lang}` : '' }, file.text);
    if (lang) highlight(file.text, lang).then((html) => { if (html) code.innerHTML = html; }); // sanitized by highlight()
    return h('pre', { class: 'files-source agents-file-source' }, code);
  };

  function editor() {
    if (ed) return ed.wrap;
    const md = file.markdown;
    const mde = mdEditor({
      value: file.text, minHeight: '360px', label: file.path, fk: 'agent-file', placeholder: '', preview: md,
      markdown: md, highlight: md ? 'markdown' : codeLanguage(file.path), wrap: true, onEscape: done,
      onInput: (v) => { draft = v; status('● unsaved'); clearTimeout(timer); timer = setTimeout(flush, AUTOSAVE_MS); },
    });
    mde.textarea.addEventListener('blur', () => { flush(); });
    mde.textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'Enter')) { e.preventDefault(); e.stopPropagation(); done(); }
    });
    const st = h('span', { class: 'muted small' }, '');
    const notice = h('div', {});
    const wrap = h('div', { class: 'files-edit agents-file-edit' }, notice, mde.el, h('div', { class: 'body-actions' },
      h('span', { class: 'muted small' }, 'Saves as you type · ⌘↵ to finish · Esc leaves the editor'), st,
      h('button', { class: 'btn small primary', type: 'button', onmousedown: (e) => e.preventDefault(), onclick: done }, 'Done')));
    ed = { mde, wrap, status: st, notice };
    requestAnimationFrame(() => mde.textarea.focus({ preventScroll: true }));
    return wrap;
  }
  const status = (text) => { if (ed) ed.status.textContent = text; };

  /** Saves what is typed; → true when nothing is left unsaved. */
  async function flush(force = false) {
    clearTimeout(timer);
    if (saving) await saving;
    if (draft === null || draft === file.text || (conflict && !force)) return draft === null || draft === file.text;
    const text = draft;
    status('Saving…');
    saving = api.agentFileSave(dir, cmd, path, text, file.rev).then((out) => {
      file = out;
      if (draft === text) draft = null;
      conflict = false;
      ed?.notice.replaceChildren();
      status('Saved');
      onSaved(out);
      return true;
    }, (e) => {
      if (e.status === 409 && e.data?.rev) { askOnConflict(e.data.rev); return false; }
      if (e.status === 409 || e.status === 400) { status('● not saved'); toast(e.message, true); return false; }
      status('');
      toast(e.message, true);
      return false;
    }).finally(() => { saving = null; });
    return saving;
  }

  /** Changed on disk while being edited: read it again (what is typed is dropped), or keep what is typed (over it). */
  function askOnConflict(rev) {
    conflict = true;
    status('');
    ed?.notice.replaceChildren(h('div', { class: 'body-conflict', role: 'alert' },
      h('span', {}, 'This file changed on disk while you were editing it (an editor, or an agent).'),
      h('button', { class: 'btn small', type: 'button', onmousedown: (e) => e.preventDefault(),
        onclick: () => { draft = null; conflict = false; ed = null; load(); } }, 'Reload (drop mine)'),
      h('button', { class: 'btn small primary', type: 'button', onmousedown: (e) => e.preventDefault(),
        onclick: () => { file = { ...file, rev }; flush(true); } }, 'Keep mine')));
  }

  const done = () => flush().then((ok) => { if (ok) { leaveEdit(); paint(); } });
  function leaveEdit() { clearTimeout(timer); ed = null; draft = null; conflict = false; mode = back; }

  function paint() {
    paintSeg();
    if (!file) return;
    pathEl.textContent = file.path;
    pathEl.title = file.path;
    const m = shown();
    if (m === 'edit') { body.replaceChildren(editor()); return; }
    if (m === 'source') { body.replaceChildren(source()); return; }
    const md = h('div', { class: 'md agents-prompt' });
    md.innerHTML = file.body.trim() ? renderMarkdown(file.body) : '<p class="muted">Empty.</p>'; // sanitized by renderMarkdown (DOMPurify)
    body.replaceChildren(md);
  }

  function load() {
    return api.agentFile(dir, cmd, path).then((f) => { file = f; paint(); },
      (e) => { body.replaceChildren(h('p', { class: 'muted small' }, e.message)); paintSeg(); });
  }

  paintSeg();
  load();
  return { el };
}
