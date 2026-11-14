// The vault as a tree of folders and files, from the flat list the server gives (/api/files, Store.files): built,
// sorted and filtered here, drawn by explorer.js and views/files.js. No DOM: the tests import it as it is.

/** A node: { name, path, kind: 'dir' | 'file', size?, mtime?, item?, children? (a folder's), sealed? (.git, .task-manager:
 *  listed, never opened) }. '' is the vault. */
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
    if (e.kind === 'dir') { Object.assign(dirOf(e.path), { mtime: e.mtime }, e.order ? { order: e.order } : {}, e.sealed ? { sealed: true } : {}); continue; }
    const cut = e.path.lastIndexOf('/');
    dirOf(cut < 0 ? '' : e.path.slice(0, cut)).children.push({ ...e, name: e.path.slice(cut + 1) });
  }
  sortTree(root);
  return root;
}

/** Whether a path is hidden: one of its parts starts with '.' (.obsidian/app.json, Docs/.order). */
export const isHiddenPath = (path) => String(path || '').split('/').some((p) => p.startsWith('.'));

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
  // A node may say what else finds it (`search`: an agent's name and description, agentsmodel.js).
  const hit = (n) => n.name.toLowerCase().includes(q) || (n.item && `${n.item.key} ${n.item.title}`.toLowerCase().includes(q))
    || (n.search && n.search.toLowerCase().includes(q));
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

/** The heading of a `[[Note#heading]]` (`#A#B`, a heading under a heading, is its last one), or null. */
export const wikiHeading = (part) => (part ? part.split('#').map((s) => s.trim()).filter(Boolean).pop() || null : null);

// A [[link]] (`![[…]]` an embed): its target (a name, a path, or nothing for a heading of the same note), `#heading`,
// and `|alias` — the bar escaped (`\|`) when the link sits in a table cell, as Obsidian writes it there.
const WIKILINK = /(!?)\[\[([^\]|#\n]*?)(#[^\]|\n]*)?(?:\\?\|([^\]\n]*))?\]\]/g;
/** A file the page shows as a picture (an embed `![[x.png]]`, a Markdown image). */
export const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;
const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** What a `[[target]]` names in the vault's file tree, as Obsidian resolves it: a note by its path or its name (the
 *  shortest path among those with that name), then any other file by its path or its name with its extension
 *  (`[[diagram.png]]`), else a folder by its path or name. → its path, or null. */
export function wikiTarget(tree, target) {
  const want = String(target || '').trim().replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!want || !tree) return null;
  const notes = [];
  const files = [];
  const dirs = [];
  const walk = (n) => n.children?.forEach((c) => {
    if (c.kind === 'dir') { dirs.push(c.path); walk(c); } else (/\.md$/i.test(c.path) ? notes : files).push(c.path);
  });
  walk(tree);
  const shortest = (list) => list.sort((a, b) => a.length - b.length)[0] || null;
  const name = (p) => p.split('/').pop().replace(/\.md$/i, '').toLowerCase();
  const full = (p) => p.split('/').pop().toLowerCase();
  return notes.find((p) => p.replace(/\.md$/i, '').toLowerCase() === want)
    || shortest(notes.filter((p) => name(p) === want))
    || files.find((p) => p.toLowerCase() === want)
    || shortest(files.filter((p) => full(p) === want))
    || dirs.find((p) => p.toLowerCase() === want)
    || shortest(dirs.filter((p) => name(p) === want));
}

/**
 * Where a Markdown link's or image's `href` (`[t](Guides/Setup.md)`, `![](img/a.png)`, `../x.md#Part`) points in the
 * vault, read from the note at `from`: { path, heading } — the path relative to the note's folder (or to the vault
 * when it starts with `/`), %-escapes decoded — or null for a web address, an anchor or a path that climbs out.
 */
export function resolveRelative(from, href) {
  let raw = String(href || '').trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  const decode = (t) => { try { return decodeURIComponent(t); } catch { return t; } };
  let heading = null;
  const hash = raw.indexOf('#');
  if (hash >= 0) { heading = decode(raw.slice(hash + 1)).trim() || null; raw = raw.slice(0, hash); }
  raw = decode(raw.replace(/\?.*$/, ''));
  const parts = raw.startsWith('/') || !from ? [] : String(from).split('/').slice(0, -1);
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts.length ? { path: parts.join('/'), heading } : null;
}

/** The file or folder a Markdown link from the note at `from` names, as Obsidian finds it: the path from the note's
 *  folder, then from the vault's top, with `.md` or without, then by its name (wikiTarget). → { path, heading } or null. */
export function relativeTarget(tree, from, href) {
  const r = resolveRelative(from, href);
  if (!r || !tree) return null;
  const top = resolveRelative(null, href);
  for (const p of [r.path, top?.path]) {
    if (!p) continue;
    for (const c of [p, `${p}.md`]) if (findNode(tree, c)) return { path: c, heading: r.heading };
  }
  const named = wikiTarget(tree, r.path.split('/').pop());
  return named ? { path: named, heading: r.heading } : null;
}

/** Each run of `md` outside code — fenced blocks and `inline code` — through `fn`; code is left as written. */
function outsideCode(md, fn) {
  const parts = String(md || '').split(/(^[ ]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ ]{0,3}\2[ \t]*$|(?![\s\S])))/m);
  let out = '';
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === undefined) continue;
    if (i % 3 === 1) { out += part; continue; } // a fenced block
    if (i % 3 === 2) continue; // the fence's own capture
    out += part.split(/(`+[^`\n]*?`+)/).map((t, j) => (j % 2 ? t : fn(t))).join('');
  }
  return out;
}

/**
 * `[[Note]]`, `[[Note|alias]]`, `[[Note#heading]]`, `[[folder/Note]]`, `[[#heading]]` (in this note) → a Markdown link
 * to what it names, opening at the heading when it names one; one that names nothing reads as its label, marked as not
 * found (.md-missing). `pathOf(target)` → its path, or null. `self`: this note's path (for `[[#heading]]`); `href(path,
 * heading)`: the address of a file (#/files/… by default, #/docs/… in Docs). `src(path)`: the address of a file's bytes;
 * with it, `![[picture.png|300]]` is drawn as the picture (else as a link). Code is left as written.
 */
export function linkWikilinks(md, pathOf, { self = null, href = filesHref, src = null } = {}) {
  return outsideCode(md, (text) => text.replace(WIKILINK, (all, bang, rawTarget, part, alias) => {
    const target = rawTarget.trim().replace(/\\$/, '').trim();
    const heading = wikiHeading(part?.replace(/\\$/, '')); // `[[#Part\|alias]]` in a table: the bar's escape is not the heading's
    if (!target && !heading) return all;
    const path = target ? pathOf(target) : self;
    // `![[picture.png]]`, `![[picture.png|300]]` (its width, or 300x200): the picture itself, from the vault
    if (bang && src && IMAGE_FILE.test(target)) {
      const size = /^\s*(\d+)(?:x(\d+))?\s*$/.exec(alias || '');
      const alt = escapeHtml(size || !alias ? target.split('/').pop() : alias.trim());
      if (!path) return `<span class="md-missing" title="${escapeHtml(`Not found: ${target}`)}">${alt}</span>`;
      return `<img class="md-embed" src="${escapeHtml(src(path))}" alt="${alt}"${size ? ` width="${size[1]}"` : ''}${size?.[2] ? ` height="${size[2]}"` : ''}>`;
    }
    const label = (alias?.trim() || (target && heading ? `${target} > ${heading}` : target || heading)).replace(/[[\]]/g, ''); // as Obsidian shows it
    if (!path) return `<span class="md-missing" title="${escapeHtml(`Not found: ${target || `#${heading}`}`)}">${escapeHtml(label)}</span>`;
    return `[${label}](${href(path, heading)})`; // an embed of a note (![[note]]) reads as a link to it, for now
  }));
}

const routeOf = (view, path, heading) => `#/${view}${path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''}${
  heading ? `?heading=${encodeURIComponent(heading)}` : ''}`;
/** A file route's address: #/files/<path>, each part URI-encoded (a name may hold '#', '?', '%'), and `?heading=…`
 *  to open a note at that heading (an encoded name holds no bare '?'). */
export const filesHref = (path, heading = null) => routeOf('files', path, heading);
/** A doc's address in Docs (views/docs.js): its tree beside it. */
export const docsHref = (path, heading = null) => routeOf('docs', path, heading);
/** The path of a #/files/… route's parameter (without its ?heading=). */
export const pathOfParam = (param) => (param ? param.replace(/\?.*$/, '').split('/').map((p) => { try { return decodeURIComponent(p); } catch { return p; } }).join('/') : '');
/** The heading a #/files/… route's parameter asks to open at, or null. */
export function headingOfParam(param) {
  const q = String(param || '').match(/\?(.*)$/);
  return q ? new URLSearchParams(q[1]).get('heading') || null : null;
}

/** Which of a note's headings (their text, in order) `wanted` names: the first that reads the same, case, spacing and
 *  accents' composition aside (as Obsidian matches them), else -1. */
export function headingIndex(texts, wanted) {
  const norm = (s) => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  const want = norm(wanted);
  return want ? texts.findIndex((t) => norm(t) === want) : -1;
}

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

/** An item's Docs tab as Docs draws it (its sections, cut down): for each section holding one of `paths` (a doc's file
 *  or a folder), the section's folder with only the branches that lead to them. A folder in `paths` keeps all it holds,
 *  and a section whose own folder is in `paths` is whole. A path in no section goes under "Other folders", from the
 *  vault's top. → { sections: [{ group, node }], counts: Map(folder path → how many of `paths` are below it) } */
export function docsSubtrees(tree, groups, paths) {
  const want = new Set((paths || []).filter((p) => typeof p === 'string' && p));
  const counts = new Map();
  if (!tree || !want.size) return { sections: [], counts };
  for (const p of want) ancestorPaths(p).forEach((a) => counts.set(a, (counts.get(a) || 0) + 1));
  // Only the branches that lead to `mine`: a wanted folder as it is, whole.
  const prune = (n, mine) => {
    const kids = [];
    for (const c of n.children || []) {
      if (mine.has(c.path)) kids.push(c);
      else if (c.kind === 'dir' && [...mine].some((p) => p.startsWith(`${c.path}/`))) kids.push(prune(c, mine));
    }
    return { ...n, children: kids };
  };
  const bySection = new Map();
  for (const p of want) {
    const g = docsGroupOf(groups, p);
    const key = g ? g.path : null;
    if (!bySection.has(key)) bySection.set(key, { group: g || { title: 'Other folders', path: '', project: null }, paths: new Set() });
    bySection.get(key).paths.add(p);
  }
  const order = [...(groups || []).map((g) => g.path), null]; // as Docs lists its sections, the others last
  const sections = order.filter((k) => bySection.has(k)).map((k) => {
    const { group, paths: mine } = bySection.get(k);
    const root = findNode(tree, group.path);
    if (!root) return null;
    return { group, node: mine.has(group.path) ? root : prune(root, mine) };
  }).filter(Boolean);
  return { sections, counts };
}
