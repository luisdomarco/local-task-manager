// The vault as a tree of folders and files, from the flat list the server gives (/api/files, Store.files): built,
// sorted and filtered here, drawn by explorer.js and views/files.js. No DOM: the tests import it as it is.

/** A node: { name, path, kind: 'dir' | 'file', size?, mtime?, item?, children? (a folder's) }. '' is the vault. */
export function buildTree(entries) {
  const root = { name: '', path: '', kind: 'dir', children: [] };
  const dirs = new Map([['', root]]);
  const dirOf = (path) => {
    if (dirs.has(path)) return dirs.get(path);
    const cut = path.lastIndexOf('/');
    const node = { name: path.slice(cut + 1), path, kind: 'dir', children: [] };
    dirOf(cut < 0 ? '' : path.slice(0, cut)).children.push(node);
    dirs.set(path, node);
    return node;
  };
  for (const e of entries) {
    if (e.kind === 'dir') { Object.assign(dirOf(e.path), { mtime: e.mtime }, e.order ? { order: e.order } : {}); continue; }
    const cut = e.path.lastIndexOf('/');
    dirOf(cut < 0 ? '' : e.path.slice(0, cut)).children.push({ ...e, name: e.path.slice(cut + 1) });
  }
  sortTree(root);
  return root;
}

function sortTree(node) {
  if (!node.children) return;
  node.children.sort(compareEntries);
  node.children.forEach(sortTree);
}

/**
 * The order of the nodes of one folder, as Array.prototype.sort takes it (< 0: `a` first).
 * Both are nodes of buildTree: `kind` ('dir' | 'file'), `name` ("00 Proyecto.md", "TSK-10 Algo.md", "Plans"…) and, for
 * an item's file, `item` ({ key, type, title, status }).
 */
export function compareEntries(a, b) {
  return rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

// A folder's index file ("00 Proyecto.md", a Ticketing project's own page) at the very top, then the folders, then the
// rest of the files. Within each, by name with its numbers read as numbers: TSK-2 before TSK-10, case aside.
const INDEX = /^00[\s_-]/;
const rank = (n) => (n.kind === 'file' && INDEX.test(n.name) ? 0 : n.kind === 'dir' ? 1 : 2);

/** The tree with only what matches `query` (a file's name, or its item's id or title) and the folders on the way to
 * it; a folder whose own name matches keeps all it holds. The same tree when `query` is blank. */
export function filterTree(node, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return node;
  const hit = (n) => n.name.toLowerCase().includes(q) || (n.item && `${n.item.key} ${n.item.title}`.toLowerCase().includes(q));
  const walk = (n) => {
    if (n.kind === 'file') return hit(n) ? n : null;
    if (n.path && hit(n)) return n;
    const children = n.children.map(walk).filter(Boolean);
    return children.length || !n.path ? { ...n, children } : null;
  };
  return walk(node);
}

/** The node at `path`, or null. */
export function findNode(root, path) {
  if (!path) return root;
  let node = root;
  for (const name of path.split('/')) {
    node = node.children?.find((c) => c.name === name);
    if (!node) return null;
  }
  return node;
}

/** The folders that hold `path`, outermost first ('a/b/c.md' → ['a', 'a/b']). */
export function ancestorPaths(path) {
  const parts = String(path || '').split('/').slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

// The text files shown as text, by extension → the highlight.js language that colours them (static/vendor/highlight/
// languages/), or '' for plain text. HTML and the like are shown as their code, never rendered: a page in a vault could
// run anything.
const CODE = {
  ...Object.fromEntries(['txt', 'text', 'log', 'csv', 'tsv', 'out', 'lock'].map((e) => [e, ''])),
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  py: 'python', pyw: 'python', pyi: 'python', rb: 'ruby', rake: 'ruby', gemspec: 'ruby',
  go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', sc: 'scala', swift: 'swift',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hh: 'cpp', hpp: 'cpp', hxx: 'cpp', cs: 'csharp',
  m: 'objectivec', mm: 'objectivec', php: 'php', pl: 'perl', pm: 'perl', lua: 'lua', r: 'r', dart: 'dart',
  ex: 'elixir', exs: 'elixir', hs: 'haskell',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', command: 'bash', ps1: 'powershell', psm1: 'powershell',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  json: 'json', jsonc: 'json', json5: 'json', webmanifest: 'json', ipynb: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', env: 'ini', properties: 'ini', editorconfig: 'ini',
  xml: 'xml', html: 'xml', htm: 'xml', xhtml: 'xml', vue: 'xml', svelte: 'xml', plist: 'xml', xsd: 'xml', rss: 'xml',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  diff: 'diff', patch: 'diff', mk: 'makefile', dockerfile: 'dockerfile',
};
// Files known by their whole name (no extension, or one that says nothing).
const NAMED = {
  makefile: 'makefile', gnumakefile: 'makefile', dockerfile: 'dockerfile', containerfile: 'dockerfile',
  gemfile: 'ruby', rakefile: 'ruby', podfile: 'ruby', procfile: 'bash', 'nginx.conf': 'nginx',
  license: '', licence: '', readme: '', changelog: '', authors: '', notice: '', copying: '',
};

/** Every highlight.js language a file may be coloured as (the tests check each is vendored). */
export const codeLanguages = () => [...new Set([...Object.values(CODE), ...Object.values(NAMED)].filter(Boolean))].sort();

/** The highlight.js language of a text file ('' for plain text), or undefined when it is not shown as text. */
export function codeLanguage(path) {
  const name = String(path).split('/').pop().toLowerCase();
  if (name in NAMED) return NAMED[name];
  const ext = (name.match(/\.([^.]+)$/) || [])[1] || '';
  if (ext && ext in CODE) return CODE[ext];
  if (/^dockerfile\./.test(name)) return 'dockerfile';
  return undefined;
}

// Info strings a fenced block uses that are neither a language's name nor a file extension.
const FENCE = { shell: 'bash', console: 'bash', golang: 'go' };

/** The highlight.js language of a fenced block's info string (```py, ```python, ```sh…), or null when it names none. */
export function fenceLanguage(tag) {
  const t = String(tag || '').toLowerCase();
  if (!t) return null;
  if (codeLanguages().includes(t)) return t;
  return FENCE[t] || CODE[t] || null; // '' (```text) is plain: null too
}

/** How a file is shown, by its name: 'markdown', 'image', 'pdf', 'text' (code too) or 'other'. */
export function fileKind(path) {
  const ext = (String(path).match(/\.([^./]+)$/) || [])[1]?.toLowerCase() || '';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (/^(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/.test(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return codeLanguage(path) === undefined ? 'other' : 'text';
}

/** A Markdown file's frontmatter as [key, value] rows for a properties table (top-level keys; a list's items joined
 * with ", "), and its body. Only to show it: the server's frontmatter.py is what reads it for real. */
export function splitFrontmatter(text) {
  const m = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { props: [], body: String(text || '') };
  const props = [];
  const unquote = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2');
  for (const line of m[1].split(/\r?\n/)) {
    const key = line.match(/^([^\s#:][^:]*):(?:\s+(.*))?$/);
    const item = line.match(/^\s*-\s+(.*)$/);
    if (key) props.push([key[1].trim(), unquote(key[2] || '')]);
    else if (item && props.length) {
      const last = props[props.length - 1];
      last[1] = last[1] ? `${last[1]}, ${unquote(item[1])}` : unquote(item[1]);
    }
  }
  return { props, body: String(text).slice(m[0].length) };
}

/** `[[Note]]`, `[[Note|alias]]` and `[[Note#heading]]` → a Markdown link to the vault file whose name (without .md) is
 * `Note`, as Obsidian resolves them; one that names no file stays as it is. `pathOf(stem)` → its path, or null. */
export function linkWikilinks(md, pathOf) {
  return String(md || '').replace(/\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (all, target, alias) => {
    const path = pathOf(target.trim());
    return path ? `[${(alias || target).trim().replace(/[[\]]/g, '')}](${filesHref(path)})` : all;
  });
}

/** A file route's address: #/files/<path>, each part URI-encoded (a name may hold '#', '?', '%'). */
export const filesHref = (path) => `#/files${path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''}`;
/** A doc's address in Docs (views/docs.js): its tree beside it. */
export const docsHref = (path) => `#/docs${path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''}`;
/** The path of a #/files/… route's parameter. */
export const pathOfParam = (param) => (param ? param.split('/').map((p) => { try { return decodeURIComponent(p); } catch { return p; } }).join('/') : '');

// ── image zoom (zoom.js): the arithmetic, apart from the page ───────────────
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 8;
/** The scale that fits an image of `nw`×`nh` in a `sw`×`sh` stage, never enlarged past its own size. */
export const fitScale = (nw, nh, sw, sh) => (nw > 0 && nh > 0 && sw > 0 && sh > 0 ? Math.min(1, sw / nw, sh / nh) : 1);
/** `scale` one step in (`dir` > 0) or out, by a factor (1.25 a click; a wheel's own, smaller), within the limits. */
export const zoomStep = (scale, dir, factor = 1.25) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, dir > 0 ? scale * factor : scale / factor));
/** Where to scroll so the point under (`px`, `py`) in the stage stays under it when `from` becomes `to`: the scroll
 *  offsets (`sx`, `sy`) for the new scale. */
export const zoomScroll = (sx, sy, px, py, from, to) => ({ x: ((sx + px) / from) * to - px, y: ((sy + py) / from) * to - py });

// ── CSV / TSV (views/files.js shows them as a table) ─────────────────────────
/** Whether a file is a table of values: .csv (commas, or the semicolons a Spanish spreadsheet writes) or .tsv. */
export const tableKind = (path) => (/\.tsv$/i.test(path) ? 'tsv' : /\.csv$/i.test(path) ? 'csv' : null);

/** The rows of a CSV/TSV text, each an array of its cells: quoted cells may hold the delimiter, newlines and "" for
 *  a quote (RFC 4180). `delim` null: a tab for TSV, else whichever of , ; occurs more on the first line. At most
 *  `max` rows; `more` says there were others. */
export function parseTable(text, kind = 'csv', max = 1000) {
  const src = String(text || '').replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] || '';
  const delim = kind === 'tsv' ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let more = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      rows.push(row); row = [];
      if (rows.length >= max) { more = i + 1 < src.length; break; }
    } else cell += c;
  }
  if (!more && (cell !== '' || row.length)) { row.push(cell); rows.push(row); }
  return { rows, delim, more };
}

// ── Docs (TSK-039): the sidebar's Docs mode (docs.js) ───────────────────────────────────────────────────────────────

/** The sections of the Docs pane, from GET /api/docs/roots ({project, title, path, exists, archived, roots}): every
 *  project's (dimmed while its Docs folder is not there yet; an archived one only when it holds docs), then the vault's
 *  own — titled "No project", or "Docs" when it is the only one (a structure with no projects). */
export function docsGroups(containers) {
  const list = (containers || []).filter((c) => c.project === null || !c.archived || (c.exists && c.roots.length));
  const projects = list.some((c) => c.project !== null);
  return list.map((c) => ({ ...c, title: c.project === null ? (projects ? 'No project' : 'Docs') : c.title, dim: !c.exists }));
}

/** The Docs section `path` is in (the longest container path that holds it), or null. */
export const docsGroupOf = (groups, path) => (groups || []).filter((g) => path === g.path || String(path).startsWith(`${g.path}/`))
  .sort((a, b) => b.path.length - a.path.length)[0] || null;

/** A new doc's text: the Doc frontmatter (plans/TSK-039 §3.6) — its project as Obsidian links it, by the project's folder
 *  (its note is "00 <folder>.md"), '' with none — and its name as the heading. `date` is YYYY-MM-DD. */
export function docText(name, projectFolder, date) {
  const q = (s) => JSON.stringify(s);
  return ['---', 'fileClass: Doc', `project: ${q(projectFolder ? `[[00 ${projectFolder}]]` : '')}`, 'doc_status: draft', 'owner: ""', 'tags: []',
    `creation_date: ${date}`, `updated_date: ${date}`, '---', '', `# ${name}`, ''].join('\n');
}

/** A folder's children as Docs shows them (TSK-039 phase 2): the names its `.order` lists first, in that order, then
 *  the rest as everywhere else (compareEntries). Without an order, as everywhere else. */
export function orderedChildren(node) {
  const kids = node?.children || [];
  if (!node?.order?.length) return kids;
  const at = new Map(node.order.map((n, i) => [n, i]));
  const pos = (c) => (at.has(c.name) ? at.get(c.name) : at.size); // the unlisted after (not Infinity: ∞ − ∞ is NaN)
  return [...kids].sort((a, b) => pos(a) - pos(b) || compareEntries(a, b));
}

/** The names of a folder after `moving` is dropped just before `before` (at the end when null or not there): what
 *  POST /api/files/move sends as its order. `names` is the folder as shown; `moving` may or may not be in it yet. */
export function dropOrder(names, moving, before) {
  const rest = names.filter((n) => n !== moving);
  const i = before === null || before === undefined ? -1 : rest.indexOf(before);
  return i < 0 ? [...rest, moving] : [...rest.slice(0, i), moving, ...rest.slice(i)];
}

// ── Docs linked from items (TSK-039 phase 3): an item's `docs` holds [[a doc]] or a folder/ ────────────────────────

const stemOf = (path) => path.split('/').pop().replace(/\.md$/i, '');
const inGroups = (groups, path) => (groups || []).some((g) => path === g.path || path.startsWith(`${g.path}/`));

/** Every Markdown file and folder in the Docs folders (`groups`, docsGroups) of `tree` → [{ path, kind, value }], a
 *  doc's value its [[name]], a folder's its path and "/": what an item's `docs` can link. By path. */
export function docChoices(tree, groups) {
  const out = [];
  const walk = (n) => (n.children || []).forEach((c) => {
    if (!inGroups(groups, c.path)) { if (c.kind === 'dir') walk(c); return; }
    if (c.kind === 'dir') {
      if (!groups.some((g) => g.path === c.path)) out.push({ path: c.path, kind: 'folder', value: `${c.path}/` });
      walk(c);
    } else if (/\.md$/i.test(c.name)) out.push({ path: c.path, kind: 'doc', value: `[[${stemOf(c.path)}]]` });
  });
  if (tree) walk(tree);
  return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
}

/** An item's `docs` entries as the page shows them → [{ value, kind, path (null when not found), name }]. A doc is found
 *  by its name as Obsidian does (the one in a Docs folder first, then anywhere); a folder by its path. */
export function resolveDocs(docs, tree, groups) {
  const byStem = new Map();
  const walk = (n) => (n.children || []).forEach((c) => {
    if (c.kind === 'dir') walk(c);
    else if (/\.md$/i.test(c.name)) {
      const stem = stemOf(c.path);
      if (!byStem.has(stem) || (inGroups(groups, c.path) && !inGroups(groups, byStem.get(stem)))) byStem.set(stem, c.path);
    }
  });
  if (tree) walk(tree);
  return (docs || []).filter((d) => typeof d === 'string').map((value) => {
    const m = value.match(/^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
    if (m) return { value, kind: 'doc', path: byStem.get(m[1].trim()) || null, name: m[1].trim() };
    const folder = value.replace(/\/+$/, '');
    return { value, kind: 'folder', path: tree && findNode(tree, folder)?.kind === 'dir' ? folder : null, name: folder.split('/').pop() };
  });
}

/** The items whose `docs` link `path` — the doc itself by its name, or a folder that holds it (or is it). */
export function itemsLinking(path, items) {
  const stem = stemOf(path);
  return (items || []).filter((it) => (it.fields?.docs || []).some((d) => typeof d === 'string' && (
    d === `[[${stem}]]` || d.startsWith(`[[${stem}|`) || d.startsWith(`[[${stem}#`)
    || (d.endsWith('/') && (path === d.slice(0, -1) || path.startsWith(d))))));
}
