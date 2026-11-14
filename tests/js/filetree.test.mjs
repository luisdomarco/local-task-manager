import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  ancestorPaths, buildTree, isHiddenPath, codeLanguage, codeLanguages, compareEntries, fenceLanguage, fileKind, filesHref, filterTree, findNode, headingIndex, headingOfParam, linkWikilinks, pathOfParam, relativeTarget, resolveRelative, splitFrontmatter, wikiTarget,
  ZOOM_MAX, ZOOM_MIN, fitScale, zoomScroll, zoomStep, parseTable, tableKind,
} from '../../static/js/filetree.js';

const ENTRIES = [
  { path: 'Attachments', kind: 'dir' },
  { path: 'Attachments/TSK-1', kind: 'dir' },
  { path: 'Attachments/TSK-1/shot.png', kind: 'file', size: 10 },
  { path: 'Tasks', kind: 'dir' },
  { path: 'Tasks/TSK-1 Primera.md', kind: 'file', size: 5, item: { key: 'TSK-1', type: 'task', title: 'Primera', status: 'ToDo' } },
  { path: 'readme.md', kind: 'file', size: 3 },
];
const names = (node) => node.children.map((c) => c.name).sort();

describe('filetree', () => {
  it('builds the folders from the flat list, files under their folder', () => {
    const tree = buildTree(ENTRIES);
    assert.deepEqual(names(tree), ['Attachments', 'Tasks', 'readme.md']);
    assert.equal(findNode(tree, 'Attachments/TSK-1/shot.png').size, 10);
    assert.equal(findNode(tree, 'Tasks/TSK-1 Primera.md').item.key, 'TSK-1');
    assert.equal(findNode(tree, 'Tasks/nope.md'), null);
    assert.equal(findNode(tree, ''), tree);
  });

  it('reads a folder top to bottom: its 00 index file, the folders, then the files, numbers as numbers', () => {
    const tree = buildTree([
      { path: 'P/TSK-10 Diez.md', kind: 'file' },
      { path: 'P/b-notes.md', kind: 'file' },
      { path: 'P/Plans', kind: 'dir' },
      { path: 'P/TSK-2 Dos.md', kind: 'file' },
      { path: 'P/00 Proyecto.md', kind: 'file' },
      { path: 'P/archive', kind: 'dir' },
      { path: 'P/A-notes.md', kind: 'file' },
      { path: 'P/000 not an index.md', kind: 'file' },
    ]);
    assert.deepEqual(findNode(tree, 'P').children.map((c) => c.name),
      ['00 Proyecto.md', 'archive', 'Plans', '000 not an index.md', 'A-notes.md', 'b-notes.md', 'TSK-2 Dos.md', 'TSK-10 Diez.md']);
  });

  it('keeps a folder named 00 among the folders', () => {
    const dir = { kind: 'dir', name: '00 Inbox' };
    const file = { kind: 'file', name: 'a.md' };
    assert.ok(compareEntries(dir, file) < 0);
    assert.ok(compareEntries({ kind: 'file', name: '00 Index.md' }, dir) < 0);
  });

  it('makes the folders a file names even when the list does not', () => {
    const tree = buildTree([{ path: 'a/b/c.md', kind: 'file' }]);
    assert.equal(findNode(tree, 'a/b').kind, 'dir');
  });

  it('filters by name, item id or title, keeping the folders on the way', () => {
    const tree = buildTree(ENTRIES);
    const byId = filterTree(tree, 'tsk-1 ');
    assert.deepEqual(names(byId), ['Attachments', 'Tasks']); // the folder TSK-1 matches by name, the task by id
    assert.deepEqual(names(filterTree(tree, 'primera')), ['Tasks']);
    assert.equal(findNode(filterTree(tree, 'attach'), 'Attachments/TSK-1/shot.png').name, 'shot.png'); // a matching folder keeps it all
    assert.deepEqual(filterTree(tree, 'zzz').children, []);
    assert.equal(filterTree(tree, '  '), tree);
  });

  it('names the folders that hold a path', () => {
    assert.deepEqual(ancestorPaths('a/b/c.md'), ['a', 'a/b']);
    assert.deepEqual(ancestorPaths('c.md'), []);
  });

  it('tells how a file is shown by its name', () => {
    assert.deepEqual(['x.md', 'x.PNG', 'x.pdf', 'x.json', 'x.tsx', 'a/Makefile', 'LICENSE', 'x.zip', 'noext', 'x.svg'].map(fileKind),
      ['markdown', 'image', 'pdf', 'text', 'text', 'text', 'text', 'other', 'other', 'image']);
  });

  it('names the language a code file is coloured as, plain text as none', () => {
    const cases = {
      'src/App.tsx': 'typescript', 'a.jsx': 'javascript', 'main.go': 'go', 'lib.rs': 'rust', 'X.java': 'java',
      'app.rb': 'ruby', 'Gemfile': 'ruby', 'Dockerfile': 'dockerfile', 'Dockerfile.dev': 'dockerfile', 'GNUmakefile': 'makefile',
      'page.html': 'xml', 'Comp.vue': 'xml', 'pyproject.toml': 'ini', 'x.yml': 'yaml', 'a.PY': 'python', 'nginx.conf': 'nginx',
      'notes.txt': '', 'data.csv': '', 'README': '',
    };
    for (const [path, lang] of Object.entries(cases)) assert.equal(codeLanguage(path), lang, path);
    assert.equal(codeLanguage('x.zip'), undefined);
  });

  it('names the language of a fenced block by its info string: a name, an extension or a common alias', () => {
    const cases = { python: 'python', py: 'python', JS: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash', yml: 'yaml', html: 'xml', golang: 'go' };
    for (const [tag, lang] of Object.entries(cases)) assert.equal(fenceLanguage(tag), lang, tag);
    for (const none of ['', 'text', 'mermaid', undefined]) assert.equal(fenceLanguage(none), null, String(none));
  });

  it('has every language it names vendored, and each one loads', async () => {
    const hljs = (await import('../../static/vendor/highlight/core.js')).default;
    for (const lang of codeLanguages()) {
      const file = new URL(`../../static/vendor/highlight/languages/${lang}.js`, import.meta.url);
      assert.ok(existsSync(file), `${lang} is not vendored`);
      hljs.registerLanguage(lang, (await import(file)).default);
    }
    for (const extra of ['markdown', 'css', 'javascript']) hljs.registerLanguage(extra, (await import(`../../static/vendor/highlight/languages/${extra}.js`)).default);
    const html = hljs.highlight('<p class="a">hi</p><script>let x = 1</script>', { language: 'xml' }).value;
    assert.match(html, /hljs-tag/);
    assert.match(html, /hljs-keyword">let</); // the <script> part handed to JavaScript
    assert.doesNotMatch(html, /<p class/); // the code itself comes out escaped
  });

  it('round-trips a path through its address', () => {
    const path = 'Google Ads/Plans/PLN-1 #2 ¿ok?.md';
    const href = filesHref(path);
    assert.equal(href, '#/files/Google%20Ads/Plans/PLN-1%20%232%20%C2%BFok%3F.md');
    assert.equal(pathOfParam(href.slice('#/files/'.length)), path);
    assert.equal(filesHref(''), '#/files');
  });

  it('carries a heading after the path, which the path itself never mistakes for its own', () => {
    const path = 'Docs/Why? #1.md';
    const href = filesHref(path, 'Risks & costs?');
    assert.equal(href, '#/files/Docs/Why%3F%20%231.md?heading=Risks%20%26%20costs%3F');
    const param = href.slice('#/files/'.length);
    assert.equal(pathOfParam(param), path);
    assert.equal(headingOfParam(param), 'Risks & costs?');
    assert.equal(headingOfParam(filesHref(path).slice('#/files/'.length)), null);
  });

  it('finds the heading a link names as Obsidian does: case and spacing aside, the first one', () => {
    const heads = ['Intro', 'Next  steps', 'Café', 'Next steps'];
    assert.equal(headingIndex(heads, 'next steps'), 1);
    assert.equal(headingIndex(heads, 'Cafe\u0301'), 2); // the same é, written as e + accent
    assert.equal(headingIndex(heads, 'Outro'), -1);
    assert.equal(headingIndex(heads, ''), -1);
  });

  it('reads the frontmatter as rows, lists joined', () => {
    const { props, body } = splitFrontmatter('---\nid: TSK-1\nsubject: "Hola: mundo"\nlabels:\n  - a\n  - b\n---\n# Body\n');
    assert.deepEqual(props, [['id', 'TSK-1'], ['subject', 'Hola: mundo'], ['labels', 'a, b']]);
    assert.equal(body, '# Body\n');
    assert.deepEqual(splitFrontmatter('no frontmatter'), { props: [], body: 'no frontmatter' });
  });

  it('turns the wikilinks that name a file into links to it', () => {
    const pathOf = (stem) => ({ 'TSK-1 Primera': 'Tasks/TSK-1 Primera.md' })[stem] || null;
    assert.equal(linkWikilinks('ver [[TSK-1 Primera]] y [[TSK-1 Primera#Notas|la tarea]] o [[Nada]]', pathOf),
      'ver [TSK-1 Primera](#/files/Tasks/TSK-1%20Primera.md) y [la tarea](#/files/Tasks/TSK-1%20Primera.md?heading=Notas) o <span class="md-missing" title="Not found: Nada">Nada</span>');
    // No alias: shown as Obsidian shows it, the note and its heading
    assert.equal(linkWikilinks('[[TSK-1 Primera#Notas]]', pathOf), '[TSK-1 Primera > Notas](#/files/Tasks/TSK-1%20Primera.md?heading=Notas)');
  });

  it('links a heading of the same note, an alias after an escaped bar, and leaves code alone', () => {
    const pathOf = (t) => ({ Note: 'Docs/Note.md' })[t] || null;
    const self = 'Docs/Here.md';
    assert.equal(linkWikilinks('[[#AR-1 · Bucle|Bucle]]', pathOf, { self }), '[Bucle](#/files/Docs/Here.md?heading=AR-1%20%C2%B7%20Bucle)');
    assert.equal(linkWikilinks('| [[Note\\|Alias]] |', pathOf), '| [Alias](#/files/Docs/Note.md) |');
    assert.equal(linkWikilinks('`[[Note]]` and\n```\n[[Note]]\n```', pathOf), '`[[Note]]` and\n```\n[[Note]]\n```');
    assert.equal(linkWikilinks('[[Nope|<b>x</b>]]', pathOf), '<span class="md-missing" title="Not found: Nope">&lt;b&gt;x&lt;/b&gt;</span>');
    const href = (p, h) => `#/docs/${p}${h ? `@${h}` : ''}`; // a view's own links (Docs)
    assert.equal(linkWikilinks('[[Note]]', pathOf, { href }), '[Note](#/docs/Docs/Note.md)');
  });

  it('takes the heading of [[#Part\\|alias]] (a table cell) without the escape of its bar', () => {
    const self = 'Docs/Here.md';
    assert.equal(linkWikilinks('| [[#AR-1 · Bucle\\|Bucle]] |', () => null, { self }), '| [Bucle](#/files/Docs/Here.md?heading=AR-1%20%C2%B7%20Bucle) |');
    assert.equal(linkWikilinks('| [[Note#Part\\|p]] |', (t) => (t === 'Note' ? 'Note.md' : null)), '| [p](#/files/Note.md?heading=Part) |');
  });

  it('draws ![[picture]] from the vault, at the width asked; a note embedded reads as a link', () => {
    const pathOf = (t) => ({ 'orbit.png': 'Docs/img/orbit.png', Note: 'Docs/Note.md' })[t] || null;
    const src = (p) => `/api/files/raw?path=${encodeURIComponent(p)}`;
    assert.equal(linkWikilinks('![[orbit.png]]', pathOf, { src }), '<img class="md-embed" src="/api/files/raw?path=Docs%2Fimg%2Forbit.png" alt="orbit.png">');
    assert.equal(linkWikilinks('![[orbit.png|300]]', pathOf, { src }), '<img class="md-embed" src="/api/files/raw?path=Docs%2Fimg%2Forbit.png" alt="orbit.png" width="300">');
    assert.equal(linkWikilinks('![[orbit.png|300x200]]', pathOf, { src }), '<img class="md-embed" src="/api/files/raw?path=Docs%2Fimg%2Forbit.png" alt="orbit.png" width="300" height="200">');
    assert.equal(linkWikilinks('![[orbit.png|The orbit]]', pathOf, { src }), '<img class="md-embed" src="/api/files/raw?path=Docs%2Fimg%2Forbit.png" alt="The orbit">');
    assert.equal(linkWikilinks('![[gone.png]]', pathOf, { src }), '<span class="md-missing" title="Not found: gone.png">gone.png</span>');
    assert.equal(linkWikilinks('![[Note]]', pathOf, { src }), '![Note](#/files/Docs/Note.md)'.slice(1)); // the "!" stays out: a link
    assert.equal(linkWikilinks('![[orbit.png]]', pathOf), '![orbit.png](#/files/Docs/img/orbit.png)'.slice(1), 'no src: a link to it');
  });

  it('resolves a Markdown link from the note it is in', () => {
    assert.deepEqual(resolveRelative('Docs/Guides/Start.md', 'Setup.md'), { path: 'Docs/Guides/Setup.md', heading: null });
    assert.deepEqual(resolveRelative('Docs/Guides/Start.md', '../img/a%20b.png'), { path: 'Docs/img/a b.png', heading: null });
    assert.deepEqual(resolveRelative('Docs/Guides/Start.md', './Setup.md#Install%20it'), { path: 'Docs/Guides/Setup.md', heading: 'Install it' });
    assert.deepEqual(resolveRelative('Docs/Guides/Start.md', '/Readme.md'), { path: 'Readme.md', heading: null }, '/: the vault\'s top');
    assert.deepEqual(resolveRelative(null, 'Docs/x.md'), { path: 'Docs/x.md', heading: null });
    for (const away of ['https://x.org/a.md', 'mailto:a@b.c', '#Part', '//cdn/x.png', '../../../out.md', '', null]) {
      assert.equal(resolveRelative('Docs/Guides/Start.md', away), null, String(away));
    }
  });

  it('finds what a Markdown link names: from the note\'s folder, then the top, with .md or without, then by name', () => {
    const tree = buildTree([
      { path: 'Docs', kind: 'dir' }, { path: 'Docs/Guides', kind: 'dir' }, { path: 'Docs/Guides/Setup.md', kind: 'file' },
      { path: 'Docs/Guides/Start.md', kind: 'file' }, { path: 'Readme.md', kind: 'file' }, { path: 'Docs/img', kind: 'dir' }, { path: 'Docs/img/a.png', kind: 'file' },
    ]);
    const from = 'Docs/Guides/Start.md';
    assert.deepEqual(relativeTarget(tree, from, 'Setup.md'), { path: 'Docs/Guides/Setup.md', heading: null });
    assert.deepEqual(relativeTarget(tree, from, 'Setup#Two'), { path: 'Docs/Guides/Setup.md', heading: 'Two' }, 'no .md');
    assert.deepEqual(relativeTarget(tree, from, 'Readme.md'), { path: 'Readme.md', heading: null }, 'from the top');
    assert.deepEqual(relativeTarget(tree, from, '../img/a.png'), { path: 'Docs/img/a.png', heading: null });
    assert.deepEqual(relativeTarget(tree, from, 'elsewhere/Setup.md'), { path: 'Docs/Guides/Setup.md', heading: null }, 'by its name');
    assert.equal(relativeTarget(tree, from, 'Nothing.md'), null);
    assert.equal(relativeTarget(tree, from, 'https://x.org'), null);
  });

  it('finds what a [[link]] names: a note by path or name, then a folder', () => {
    const tree = buildTree([
      { path: 'Docs', kind: 'dir' }, { path: 'Docs/Knowledge base', kind: 'dir' }, { path: 'Docs/Knowledge base/Agents', kind: 'dir' },
      { path: 'Docs/Knowledge base/Agents/Architect.md', kind: 'file' }, { path: 'Docs/Readme.md', kind: 'file' }, { path: 'Readme.md', kind: 'file' },
    ]);
    assert.equal(wikiTarget(tree, 'Docs/Knowledge base/Agents/Architect'), 'Docs/Knowledge base/Agents/Architect.md');
    assert.equal(wikiTarget(tree, 'architect'), 'Docs/Knowledge base/Agents/Architect.md'); // by name, any case
    assert.equal(wikiTarget(tree, 'Readme'), 'Readme.md'); // two of a name: the shortest path
    assert.equal(wikiTarget(tree, 'Docs/Knowledge base/Agents'), 'Docs/Knowledge base/Agents'); // a folder
    assert.equal(wikiTarget(tree, 'Agents/'), 'Docs/Knowledge base/Agents');
    assert.equal(wikiTarget(tree, 'Nothing'), null);
  });
});

describe('image zoom', () => {
  it('fits an image in its stage, never past its own size', () => {
    assert.equal(fitScale(2000, 1000, 800, 600), 0.4);
    assert.equal(fitScale(400, 300, 800, 600), 1);
    assert.equal(fitScale(0, 0, 800, 600), 1); // not loaded yet
  });
  it('steps in and out within its limits', () => {
    assert.equal(zoomStep(1, 1), 1.25);
    assert.equal(zoomStep(1, -1), 0.8);
    assert.equal(zoomStep(ZOOM_MAX, 1), ZOOM_MAX);
    assert.equal(zoomStep(ZOOM_MIN, -1), ZOOM_MIN);
  });
  it('keeps the point under the pointer where it is', () => {
    assert.deepEqual(zoomScroll(0, 0, 100, 50, 1, 2), { x: 100, y: 50 });
    assert.deepEqual(zoomScroll(200, 0, 100, 0, 2, 1), { x: 50, y: 0 });
  });
});

describe('CSV / TSV', () => {
  it('knows a table by its extension', () => {
    assert.equal(tableKind('a/b.CSV'), 'csv');
    assert.equal(tableKind('x.tsv'), 'tsv');
    assert.equal(tableKind('x.txt'), null);
  });
  it('splits quoted cells with commas, quotes and newlines (RFC 4180)', () => {
    const { rows, delim } = parseTable('name,note\r\n"Ana","said ""hi"", twice"\nLuis,"two\nlines"\n');
    assert.equal(delim, ',');
    assert.deepEqual(rows, [['name', 'note'], ['Ana', 'said "hi", twice'], ['Luis', 'two\nlines']]);
  });
  it('takes semicolons when the first line has more of them, and tabs for TSV', () => {
    assert.deepEqual(parseTable('a;b;c\n1,5;2;3').rows, [['a', 'b', 'c'], ['1,5', '2', '3']]);
    assert.deepEqual(parseTable('a\tb\n1\t2', 'tsv').rows, [['a', 'b'], ['1', '2']]);
  });
  it('stops at its maximum and says there was more', () => {
    const out = parseTable('h\n1\n2\n3\n', 'csv', 2);
    assert.deepEqual(out.rows, [['h'], ['1']]);
    assert.equal(out.more, true);
  });
});

describe('hidden files (Show hidden files)', () => {
  it('a path is hidden when any part of it starts with a dot', () => {
    assert.equal(isHiddenPath('.obsidian/app.json'), true);
    assert.equal(isHiddenPath('Docs/.order'), true);
    assert.equal(isHiddenPath('notes/a.b.md'), false);
    assert.equal(isHiddenPath(''), false);
  });

  it('a sealed folder (.git, .task-manager) keeps its mark in the tree, with nothing under it', () => {
    const tree = buildTree([{ path: '.git', kind: 'dir', sealed: true }, { path: '.obsidian', kind: 'dir' }, { path: '.obsidian/app.json', kind: 'file' }]);
    assert.equal(findNode(tree, '.git').sealed, true);
    assert.deepEqual(findNode(tree, '.git').children, []);
    assert.equal(findNode(tree, '.obsidian').sealed, undefined);
  });
});
