// A vault file or folder, as the sidebar's Explorer opens it: #/files/<path> (#/files alone: the vault itself). A folder
// lists what it holds; a Markdown file shows rendered (Preview) or as it is written (Source), the choice remembered;
// code and text show as text, code coloured (highlight.js); an image (to zoom into) or a PDF shows in the attachments'
// viewer; anything else offers a download. Edit opens a text file (Markdown, code, plain text) in the editor of the
// descriptions, coloured as it is typed, saved as you type against the version it was opened at (a file changed on
// disk meanwhile asks which text wins). An item's file can be edited too, as Obsidian would; its card stays the
// place for its fields.
import { fileUrl, api } from '../api.js';
import { fileViewer } from '../attachments.js';
import { dropTarget, fileTree, loadFiles, onFiles } from '../explorer.js';
import { codeLanguage, docsGroupOf, docsGroups, fileKind, itemsLinking, filesHref, findNode, linkWikilinks, parseTable, pathOfParam, splitFrontmatter, tableKind } from '../filetree.js';
import { highlight } from '../highlight.js';
import { itemHref, pageHref } from '../links.js';
import { mdEditor } from '../mdeditor.js';
import { openItem } from '../panel.js';
import { pref, setPref } from '../prefs.js';
import { TYPE_DEFS, hasPage } from '../rules.js';
import { allLabels, allPeople, reload, state, toast } from '../state.js';
import { cssKey, h, icon, renderMarkdown, select, tagInput, typeIcon } from '../ui.js';

const MAX_TEXT = 2 * 1024 * 1024; // larger text is not read into the page: download it (nor edited: Store.SAVE_MAX)
const AUTOSAVE_MS = 800;
let editNext = null; // a file to open in Edit (a new one: explorer.js)
let lineNext = null; // { path, line }: a file to open at a line (a search's result: views/find.js)
let unsaved = () => false; // whether the file being edited has text not saved yet (the page asks before leaving)

/** Open `path` in the Explorer's editor (`href`: the address of a file, #/docs/… in Docs). */
export function openFileInEdit(path, href = filesHref) {
  editNext = path;
  location.hash = href(path);
}
/** Open `path` in its Source, scrolled to `line` (1-based) and that line lit. */
export function openFileAtLine(path, line) {
  lineNext = { path, line };
  location.hash = filesHref(path);
}

/** Lights line `line` of the text in `code` (coloured or not: it walks the text nodes) and scrolls it into the middle
 *  of the view. The CSS Custom Highlight API: nothing in the DOM changes. */
function lightLine(code, text, line) {
  if (!code || !window.CSS?.highlights || !window.Highlight) return;
  const lines = text.split('\n');
  const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  const end = start + (lines[line - 1] || '').length;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let pos = 0;
  let started = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.textContent.length;
    if (!started && start <= pos + len) { range.setStart(n, start - pos); started = true; }
    if (started && end <= pos + len) { range.setEnd(n, Math.max(0, end - pos)); break; }
    pos += len;
  }
  if (!started) return;
  CSS.highlights.set('tm-line', new Highlight(range));
  (range.startContainer.parentElement || code).scrollIntoView({ block: 'center' });
}

/** Whether the Explorer's editor holds text not saved yet (main.js asks before the page is left). */
export const filesUnsaved = () => unsaved();
const at = (el, prop, url) => { el[prop] = url; return el; }; // the app's own address, set as a property (h() takes outside links only)

const size = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
const when = (s) => (s ? new Date(s * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

function crumbs(path, href = filesHref) {
  const parts = path ? path.split('/') : [];
  return h('nav', { class: 'crumbs files-crumbs', 'aria-label': 'Path' },
    h('a', { href: href('') }, icon('folder', 13), state.vault?.name || 'Vault'),
    parts.map((name, i) => [icon('right', 13), i === parts.length - 1
      ? h('span', { 'aria-current': 'page' }, name)
      : h('a', { href: href(parts.slice(0, i + 1).join('/')) }, name)]));
}

function reveal(path) {
  const root = state.vault?.root;
  const editor = state.config.editor_app || 'Cursor';
  return [root ? h('button', { class: 'btn small', title: 'Show it in Finder',
    onclick: () => api.openPath(path ? `${root}/${path}` : root).catch((e) => toast(e.message, true)) }, icon('folder', 13), 'Show in Finder') : null,
  h('button', { class: 'btn small', title: `Open it in ${editor} (Settings → General)`,
    onclick: () => api.openInEditor(path).catch((e) => toast(e.message, true)) }, icon('code', 13), `Open in ${editor}`)];
}

function folderView(node, href = filesHref) {
  const rows = node.children.map((c) => h('tr', { onclick: (e) => { if (!e.target.closest('a')) location.hash = href(c.path); } },
    h('td', { class: 'files-name' }, c.kind === 'dir' ? icon('folder', 15) : c.item ? typeIcon(c.item.type, 15) : icon('file', 15),
      h('a', { href: href(c.path) }, c.name)),
    h('td', { class: 'muted' }, c.kind === 'dir' ? 'Folder' : c.item ? (TYPE_DEFS[c.item.type]?.label || c.item.type) : (c.name.match(/\.([^.]+)$/)?.[1] || 'File').toUpperCase()),
    h('td', { class: 'muted' }, when(c.mtime)),
    h('td', { class: 'muted files-size' }, c.kind === 'dir' ? `${c.children.length}` : size(c.size))));
  // Files dropped from the computer anywhere on the folder come into it (explorer.js dropTarget).
  const zone = h('div', { class: 'files-drop' },
    node.children.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid files-grid', 'aria-label': 'Files' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Kind'), h('th', {}, 'Modified'), h('th', { class: 'files-size' }, 'Size / items'))),
        h('tbody', {}, rows)))
      : h('p', { class: 'muted' }, 'This folder is empty.'),
    h('p', { class: 'muted small files-drop-hint' }, icon('upload', 13), 'Drop files here to add them to this folder.'));
  dropTarget(zone, node.path);
  return [
    h('div', { class: 'files-head' }, h('h1', {}, icon('folderopen', 20), node.path ? node.name : state.vault?.name || 'Vault'),
      h('span', { class: 'spacer' }), reveal(node.path)),
    zone,
  ];
}

/** The item a file is, as the page knows it (for its card or page). */
const itemOf = (node) => node.item && (state.byId.get(node.item.key) || state.all.find((i) => i.key === node.item.key));

function itemBar(node) {
  if (!node.item) return null;
  const it = itemOf(node);
  const status = node.item.status;
  return h('div', { class: 'files-item' }, typeIcon(node.item.type, 15), h('span', { class: 'mono' }, node.item.key),
    status ? h('span', { class: `chip s-${cssKey(status)}` }, status) : null,
    h('button', { class: 'btn small primary', disabled: !it, title: it ? 'Open it to edit it' : 'Not loaded yet',
      onclick: () => { if (hasPage(it)) location.hash = pageHref(it); else openItem(it); } }, icon('external', 13), 'Open item'));
}

// Markdown: Preview · Source · Edit. Code and text: Source · Edit. Edit only once the text is read (and not too large).
const MODES = { markdown: [['preview', 'eye', 'Preview'], ['source', 'code', 'Source'], ['edit', 'pencil', 'Edit']],
  text: [['source', 'code', 'Source'], ['edit', 'pencil', 'Edit']],
  table: [['preview', 'table', 'Table'], ['source', 'code', 'Source'], ['edit', 'pencil', 'Edit']] };
const TABLE_MAX = 1000; // rows shown; Source has them all

function fileView(node, mode, setMode, body, editable) {
  const kind = fileKind(node.path);
  const url = fileUrl(node.path);
  const download = at(h('a', { class: 'btn small', download: node.name }, icon('download', 13), 'Download'), 'href', url);
  const modes = tableKind(node.path) ? MODES.table : MODES[kind];
  const shown = kind === 'text' && mode === 'preview' && !tableKind(node.path) ? 'source' : mode;
  const toggle = modes ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Show as' },
    modes.map(([m, ico, label]) => h('button', {
      class: `btn small ${shown === m ? 'active' : ''}`, 'aria-pressed': String(shown === m), onclick: () => setMode(m),
      disabled: m === 'edit' && !editable, title: m === 'edit' ? (editable ? 'Edit it here (saved as you type)' : 'Not readable as text here') : null,
    }, icon(ico, 13), label))) : null;
  return [
    h('div', { class: 'files-head' }, h('h1', { title: node.path }, node.item ? typeIcon(node.item.type, 20) : icon(kind === 'image' ? 'image' : 'file', 20),
      node.item?.title || node.name), h('span', { class: 'spacer' }), toggle, reveal(node.path), download),
    h('p', { class: 'muted small files-meta' }, `${size(node.size)} · modified ${when(node.mtime)}`),
    itemBar(node),
    body,
  ];
}

/** A file or folder of the vault in `root`. `href(path)` is the address of another one: #/files/… (the default), or
 *  #/docs/… when Docs (views/docs.js) shows it beside its tree. */
export function mountFiles(root, param, { href = filesHref } = {}) {
  const path = pathOfParam(param);
  let mode = pref('files.mdMode', 'preview');
  let back = mode;      // where Done goes back to from Edit (Edit itself is never remembered)
  if (editNext === path) { mode = 'edit'; editNext = null; }
  let jump = null; // the line a search opened it at: shown in Source (not remembered), lit until another mode
  if (lineNext?.path === path) { jump = lineNext.line; lineNext = null; if (mode !== 'edit') mode = 'source'; }
  let text = null;      // the file's text (Markdown or code), once read
  let rev = null;       // its version when read (X-TM-Rev): a save goes against it
  let textSig = '';     // its size and mtime when read: read again when they change
  let failed = null;
  // Edit: the editor, kept across redraws (they come with every reload) so its caret and scroll stay.
  let ed = null;        // { mde, wrap, notice, status }
  let draft = null;     // typed and not saved yet, or null
  let inflight = null;  // the save on its way: another waits for it instead of sending the same text again
  let timer = null;
  let conflict = false; // the file changed on disk under a draft: Reload or Keep mine
  unsaved = () => draft !== null && draft !== text;
  let colored = null;   // that text coloured (highlight.js), once done: { lang, html }; until then, or when it cannot be, plain

  /** The text as code: coloured when the colours are ready, plain until then (and for a plain text file). */
  const codeBlock = (lang, wrap) => {
    const code = h('code', { class: lang ? `hljs language-${lang}` : '' });
    if (lang && colored?.lang === lang && colored.html) code.innerHTML = colored.html; // sanitized by highlight()
    else code.textContent = text;
    if (lang && colored?.lang !== lang) {
      colored = { lang, html: null };
      highlight(text, lang).then((html) => { if (colored?.lang === lang && html) { colored.html = html; render(); } });
    }
    return h('pre', { class: `files-source ${wrap ? '' : 'wrap-off'}` }, code);
  };

  /** A CSV/TSV as a table: its first row the header, the first TABLE_MAX rows. */
  const tableBody = (kind) => {
    const { rows, more } = parseTable(text, kind, TABLE_MAX + 1);
    if (!rows.length) return h('p', { class: 'muted' }, 'No rows.');
    const [head, ...data] = rows;
    const width = Math.max(...rows.map((r) => r.length));
    const cells = (r, tag) => Array.from({ length: width }, (_, i) => h(tag, {}, r[i] ?? ''));
    return [h('div', { class: 'table-wrap files-table' }, h('table', { class: 'grid', 'aria-label': 'Rows' },
      h('thead', {}, h('tr', {}, h('th', { class: 'files-rownum' }, '#'), ...cells(head, 'th'))),
      h('tbody', {}, data.slice(0, TABLE_MAX).map((r, i) => h('tr', {}, h('td', { class: 'files-rownum muted' }, String(i + 1)), ...cells(r, 'td')))))),
    h('p', { class: 'muted small' }, `${Math.min(data.length, TABLE_MAX)} rows${more || data.length > TABLE_MAX ? ` shown — the first ${TABLE_MAX}; Source has them all` : ''}.`)];
  };

  const stemPath = () => {
    const map = new Map();
    const walk = (n) => n.children?.forEach((c) => { if (c.kind === 'dir') walk(c); else if (fileKind(c.path) === 'markdown' && !map.has(c.name.replace(/\.md$/i, ''))) map.set(c.name.replace(/\.md$/i, ''), c.path); });
    walk(fileTree());
    return (stem) => map.get(stem) || null;
  };

  // The files that link here ([[its name]]), fetched once per version of it read: { sig, links } or null.
  let backlinks = null;
  const linkedFrom = () => {
    if (backlinks?.sig !== textSig) {
      backlinks = { sig: textSig, links: null };
      api.backlinks(path).then((out) => { if (backlinks?.sig === textSig) { backlinks.links = out.links; render(); } }, () => {});
    }
    const viaDocs = new Set(itemsLinking(path, state.items).map((it) => it.path)); // shown above, as items
    const links = backlinks.links?.filter((l) => !viaDocs.has(l.path));
    if (!links?.length) return null;
    return h('section', { class: 'files-backlinks' }, h('h3', {}, icon('link', 14), `Linked from · ${links.length}`),
      h('ul', {}, links.map((l) => h('li', {},
        h('button', { class: 'find-line', title: `${l.path} · line ${l.line}`, onclick: () => openFileAtLine(l.path, l.line) },
          h('span', { class: 'find-path-sm' }, l.path.split('/').pop().replace(/\.md$/i, '')),
          h('span', { class: 'find-text muted' }, l.text), l.count > 1 ? h('span', { class: 'chip' }, `×${l.count}`) : null)))));
  };
  // The headings of a long note, to jump to (two or more).
  const outline = (md) => {
    const heads = [...md.querySelectorAll('h1, h2, h3, h4')];
    if (heads.length < 2) return null;
    return h('details', { class: 'files-outline', open: heads.length <= 12 },
      h('summary', {}, `On this page · ${heads.length}`),
      h('ul', {}, heads.map((el) => h('li', { style: `--lvl:${Number(el.tagName[1]) - 1}` },
        h('button', { class: 'link', onclick: () => el.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, el.textContent)))));
  };

  // A doc (TSK-039: `fileClass: Doc`, plans/TSK-039 §3.6): its own properties as fields, each saved as it changes
  // (Store.update_doc). Its project is where it is: picking another moves it to that project's Docs (the page follows).
  let docGroups = null; // docsGroups of /api/docs/roots, asked once per page
  const docProps = (all) => {
    if (!docGroups) {
      docGroups = [];
      api.docsRoots().then((r) => { docGroups = docsGroups(r.containers); render(); }, () => {});
    }
    const get = (k) => (all.find(([key]) => key === k) || [])[1] || '';
    const save = (values) => api.docProps(path, values, rev).then((out) => {
      if (out.path !== path) loadFiles().then(() => location.replace(href(out.path))); // the tree knows it there first
      else loadFiles();
    }, (e) => toast(e.message, true));
    const owner = get('owner').replace(/^\[\[|\]\]$/g, '');
    const people = [...new Set([...allPeople(), owner].filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const tags = get('tags').replace(/^\[|\]$/g, '').split(',').map((t) => t.trim().replace(/^(['"])(.*)\1$/, '$2')).filter(Boolean); // "ux" in a [..] list
    const here = docsGroupOf(docGroups, path);
    const field = (label, control) => h('div', { class: 'doc-prop' }, h('span', { class: 'doc-prop-label' }, label), control);
    return h('div', { class: 'doc-props', role: 'group', 'aria-label': 'Doc properties' },
      field('Status', select([['draft', 'Draft'], ['published', 'Published']], get('doc_status') || 'draft',
        (v) => save({ doc_status: v || 'draft' }), { 'aria-label': 'Doc status', search: false })),
      field('Owner', select([[null, '—'], ...people.map((p) => [p, p])], owner || null, (v) => save({ owner: v || '' }), { 'aria-label': 'Owner' })),
      // × clears it: no project, so the doc goes to the vault's own Docs
      field('Project', docGroups.length ? select([[null, 'No project'], ...docGroups.filter((g) => g.project).map((g) => [g.project, g.title])],
        here?.project ?? null, (v) => save({ project: v || null }), { 'aria-label': 'Project', search: false, clearable: true }) : h('span', { class: 'muted' }, '…')),
      field('Tags', tagInput(tags, (list) => save({ tags: list }), { suggest: allLabels, placeholder: 'Add a tag' })),
      field('Updated', h('span', { class: 'muted' }, get('updated_date') || '—')));
  };

  // The initiatives and tasks whose `docs` link this doc, or a folder that holds it (TSK-039 phase 3).
  const linkedItems = () => {
    const items = itemsLinking(path, state.items);
    if (!items.length) return null;
    return h('section', { class: 'files-backlinks' }, h('h3', {}, icon('link', 14), `Linked from items · ${items.length}`),
      h('ul', {}, items.map((it) => h('li', {}, h('a', { class: 'find-line', href: itemHref(it), title: it.key },
        typeIcon(it.type, 14), h('span', { class: 'find-path-sm' }, it.id || ''), h('span', { class: 'find-text' }, it.title))))));
  };

  const markdownBody = (node) => {
    if (failed) return h('p', { class: 'muted' }, `Could not read it (${failed}).`);
    if (text === null) return h('p', { class: 'muted' }, 'Loading…');
    if (mode === 'source') return codeBlock('markdown', true);
    const { props: all, body } = splitFrontmatter(text);
    const isDoc = all.some(([k, v]) => k === 'fileClass' && v === 'Doc');
    const props = isDoc ? [] : all.filter(([, v]) => v && v !== '[]' && v !== '{}'); // Source shows the empty ones
    const md = h('div', { class: 'md files-md' });
    md.innerHTML = body.trim() ? renderMarkdown(linkWikilinks(body, stemPath())) : '<p class="muted">No content.</p>'; // sanitized by renderMarkdown
    return [isDoc ? docProps(all) : null, linkedItems(), props.length ? h('table', { class: 'files-props', 'aria-label': 'Properties' },
      h('tbody', {}, props.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v))))) : null, outline(md), md, linkedFrom()];
  };

  const fetchText = () => fetch(fileUrl(path)).then((r) => (r.ok ? r.text().then((t) => [t, r.headers.get('X-TM-Rev')]) : Promise.reject(new Error(`${r.status}`))));
  const read = (node) => {
    if (ed) return; // while editing, the editor's text is the file's (a change on disk shows when saving)
    const sig = `${node.size}:${node.mtime}`;
    if (sig === textSig) return;
    textSig = sig;
    fetchText().then(([t, r]) => { text = t; rev = r; failed = null; colored = null; }, (e) => { failed = e.message; })
      .then(render);
  };

  // ── Edit ──────────────────────────────────────────────────────────────────
  const setStatus = (t) => { if (ed) ed.status.textContent = t; };
  const saved = (out, sending) => {
    text = sending;
    rev = out.rev;
    textSig = `${out.size}:${out.mtime}`;
    colored = null;
    if (draft === sending) draft = null; // typed more meanwhile: that stays a draft
    conflict = false;
    if (ed) ed.notice.replaceChildren();
    setStatus(draft === null ? 'Saved' : '● unsaved');
    // An item's file: the app reads it again (its card, its lists); any other: the tree's size and date.
    if (findNode(fileTree(), path)?.item) reload(); else loadFiles();
  };
  const flush = async () => {
    clearTimeout(timer);
    if (inflight) { await inflight; return flush(); }
    if (draft === null || draft === text) { draft = null; return true; }
    if (conflict) return false; // waits for Reload or Keep mine
    const sending = draft;
    setStatus('Saving…');
    inflight = (async () => {
      try {
        saved(await api.saveFile(path, sending, rev), sending);
        return true;
      } catch (e) {
        if (e.status === 409 && e.data?.rev) { conflict = true; showConflict(); setStatus('● unsaved'); return false; }
        if (e.status === 400 || e.status === 409) { setStatus('● not saved'); toast(e.message, true); return false; } // it would break the vault, or cannot be saved: the draft stays
        setStatus(`● not saved (${e.message}) — retrying`);
        timer = setTimeout(() => { if (unsaved()) flush(); }, 5000);
        return false;
      } finally { inflight = null; }
    })();
    return inflight;
  };
  // A 409 that is not a change on disk (a save that would break the vault's structure) says why and keeps the draft.
  function showConflict() {
    if (!ed) return;
    ed.notice.replaceChildren(h('div', { class: 'body-conflict', role: 'alert' },
      h('span', {}, 'This file changed on disk while you were editing it.'),
      h('button', { class: 'btn small', onmousedown: (e) => e.preventDefault(), onclick: async () => {
        try {
          const [t, r] = await fetchText();
          text = t; rev = r; draft = null; conflict = false; colored = null;
          ed.notice.replaceChildren();
          ed.mde.set(t);
          setStatus('Reloaded');
        } catch (e) { toast(`Could not read it: ${e.message}`, true); }
      } }, 'Reload (drop mine)'),
      h('button', { class: 'btn small primary', onmousedown: (e) => e.preventDefault(), onclick: async () => {
        const sending = draft ?? text;
        try { saved(await api.saveFile(path, sending, rev, true), sending); } catch (e) { toast(e.message, true); }
      } }, 'Keep mine')));
  }
  const leaveEdit = () => {
    clearTimeout(timer);
    ed = null;
    conflict = false;
    mode = back;
    render();
  };
  // Done, ⌘↵, ⌘S and Esc: what is typed is saved (or about to be): save what is pending, then back to reading it.
  const done = () => flush().then((ok) => { if (ok) leaveEdit(); });
  const editorOf = (node, kind) => {
    if (ed) return ed.wrap;
    const md = kind === 'markdown';
    const lang = md ? 'markdown' : codeLanguage(node.path);
    const mde = mdEditor({
      value: text, minHeight: 'calc(100dvh - 330px)', label: node.name, fk: 'file-text', placeholder: '', preview: md,
      markdown: md, highlight: lang, wrap: md || !lang, // code keeps its lines; prose wraps
      onEscape: done,
      onInput: (v) => {
        draft = v;
        setStatus('● unsaved');
        clearTimeout(timer);
        timer = setTimeout(flush, AUTOSAVE_MS);
      },
    });
    mde.textarea.addEventListener('blur', () => { flush(); });
    mde.textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'Enter')) { e.preventDefault(); done(); }
    });
    const status = h('span', { class: 'muted small' }, '');
    const notice = h('div', {});
    const wrap = h('div', { class: 'files-edit' }, notice, mde.el, h('div', { class: 'body-actions' },
      h('span', { class: 'muted small' }, `${md ? 'Markdown' : 'Text'} · saves as you type · ⌘↵ to finish · Esc leaves the editor`), status,
      h('button', { class: 'btn small primary', onmousedown: (e) => e.preventDefault(), onclick: done }, 'Done')));
    ed = { mde, wrap, notice, status };
    requestAnimationFrame(() => mde.textarea.focus({ preventScroll: true }));
    return wrap;
  };

  function render() {
    const tree = fileTree();
    if (!tree) { root.replaceChildren(h('p', { class: 'muted' }, 'Loading…')); return; }
    const node = findNode(tree, path);
    if (!node) {
      root.replaceChildren(crumbs(path, href), h('div', { class: 'empty' }, 'This file is not in the vault any more.'));
      return;
    }
    let body = null;
    if (node.kind === 'dir') {
      root.replaceChildren(h('div', { class: 'files-page' }, crumbs(path, href), folderView(node, href)));
      return;
    }
    const kind = fileKind(node.path);
    if ((kind === 'markdown' || kind === 'text') && node.size > MAX_TEXT) {
      body = h('p', { class: 'muted' }, 'This file is too large to show here: download it to open it.');
    } else if ((kind === 'markdown' || kind === 'text') && mode === 'edit' && (ed || (text !== null && !failed))) {
      body = editorOf(node, kind);
    } else if (kind === 'markdown') {
      read(node);
      body = markdownBody(node);
    } else if (kind === 'text') {
      read(node);
      const lang = codeLanguage(node.path);
      const table = tableKind(node.path);
      body = failed ? h('p', { class: 'muted' }, `Could not read it (${failed}).`)
        : text === null ? h('p', { class: 'muted' }, 'Loading…')
          : table && mode === 'preview' ? tableBody(table)
            : codeBlock(lang, !lang); // code scrolls sideways; prose wraps
    } else {
      body = h('div', { class: 'files-view' }, fileViewer(fileUrl(node.path), node.name, kind));
    }
    const editable = ed !== null || (text !== null && !failed && node.size <= MAX_TEXT);
    const setMode = (m) => {
      if (m === mode) return;
      jump = null;
      if (mode === 'edit') { back = m; done(); return; } // leaving Edit saves first, then shows `m`
      if (m === 'edit') { back = mode; mode = 'edit'; render(); return; }
      mode = m;
      setPref('files.mdMode', m === 'preview' ? null : m);
      render();
    };
    root.replaceChildren(h('div', { class: 'files-page' }, crumbs(path, href), fileView(node, mode, setMode, body, editable)));
    if (jump && text !== null && (mode === 'source' || kind === 'text')) lightLine(root.querySelector('.files-source code'), text, jump);
    else if (window.CSS?.highlights) CSS.highlights.delete('tm-line');
  }

  let live = true;
  // While editing, nothing redraws the page under the editor: moving it would take its focus (and the caret) away
  // after every save, whose reload is what calls here.
  onFiles(() => { if (live && !ed) render(); });
  if (!fileTree()) loadFiles();
  render();
  return {
    // A reload of the items (and so of the list: explorer.js) redraws through onFiles; this only keeps the item bar
    // current. Not the file itself: an image or a PDF would flicker.
    update() { if (ed) return; const node = fileTree() && findNode(fileTree(), path); if (node?.kind === 'file' && ['markdown', 'text'].includes(fileKind(node.path))) render(); },
    unmount() { live = false; if (unsaved()) flush(); }, // what was typed is saved on the way out
  };
}

export const mount = (root, param) => mountFiles(root, param);
