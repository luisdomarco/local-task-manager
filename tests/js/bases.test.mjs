import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cellType, columnKey, editText, embedOf, isNameColumn, nextSort, parseCell, shownName, sortKey, sortedIndexes, summaryText } from '../../static/js/bases.js';
import { linkWikilinks } from '../../static/js/filetree.js';

const rows = [
  { path: 'a.md', cells: ['a', 3, '2026-11-02', null] },
  { path: 'b.md', cells: ['B', 10, '2026-01-15', ['x']] },
  { path: 'c.md', cells: ['c', null, '', []] },
  { path: 'd.md', cells: ['d', 3, '2026-11-01T10:00', ['y', 'z']] },
];

describe('bases', () => {
  it('orders mixed values: numbers and dates by value, text case aside, nothing last either way', () => {
    assert.deepEqual(sortedIndexes(rows, 1, 'asc'), [0, 3, 1, 2]);
    assert.deepEqual(sortedIndexes(rows, 1, 'desc'), [1, 0, 3, 2]);
    assert.deepEqual(sortedIndexes(rows, 2, 'asc'), [1, 3, 0, 2]);
    assert.deepEqual(sortedIndexes(rows, 0, 'desc'), [3, 2, 1, 0]);
    assert.deepEqual(sortedIndexes(rows, null, null), [0, 1, 2, 3]);
    assert.deepEqual(sortKey('10'), [0, 10, '']);
    assert.equal(sortKey([])[0], 2);
  });

  it('cycles a column: ascending, descending, the base’s own order', () => {
    assert.deepEqual(nextSort(null, 2), { col: 2, dir: 'asc' });
    assert.deepEqual(nextSort({ col: 2, dir: 'asc' }, 2), { col: 2, dir: 'desc' });
    assert.equal(nextSort({ col: 2, dir: 'desc' }, 2), null);
    assert.deepEqual(nextSort({ col: 1, dir: 'desc' }, 2), { col: 2, dir: 'asc' });
  });

  it('types a cell as its property and reads back what is typed', () => {
    const col = (id, index) => ({ id, index });
    assert.equal(columnKey(col('note.rating')), 'rating');
    assert.equal(columnKey(col('file.tags')), 'tags');
    assert.equal(cellType(col('note.rating', 1), rows), 'number');
    assert.equal(cellType(col('note.when', 2), rows), 'date');
    assert.equal(cellType(col('note.related', 3), rows), 'list');
    assert.equal(cellType(col('note.tags', 3), rows), 'tags');
    assert.equal(parseCell('4', 'number'), 4);
    assert.equal(parseCell('four', 'number'), 'four');
    assert.deepEqual(parseCell(' a, b ,, c', 'list'), ['a', 'b', 'c']);
    assert.equal(parseCell('TRUE', 'checkbox'), true);
    assert.equal(parseCell(false, 'checkbox'), false);
    assert.equal(parseCell('  ', 'text'), null);
    assert.equal(editText(['a', 'b']), 'a, b');
    assert.equal(editText(null), '');
  });

  it('names a row by its file, an embed by its view, a summary in words', () => {
    assert.equal(isNameColumn({ id: 'file.name' }), true);
    assert.equal(isNameColumn({ id: 'note.name' }), false);
    assert.equal(shownName('Docs/Reading/Dune.md'), 'Dune');
    assert.equal(shownName('cover.png'), 'cover.png');
    assert.deepEqual(embedOf('Lists/Books.base#By year'), { path: 'Lists/Books.base', view: 'By year' });
    assert.deepEqual(embedOf('Books.base'), { path: 'Books.base', view: null });
    assert.equal(summaryText({ name: 'Sum', value: 22 }), 'Sum 22');
    assert.equal(summaryText({ name: 'Earliest', value: null }), 'Earliest —');
    assert.equal(summaryText(null), '');
  });

  it('leaves a box for an embedded base, its view named', () => {
    const at = (t) => (t === 'Books.base' ? 'Lists/Books.base' : null);
    assert.equal(linkWikilinks('![[Books.base#By year]]', at), '<div class="md-base" data-base="Lists/Books.base" data-view="By year"></div>');
    assert.equal(linkWikilinks('![[Books.base]]', at), '<div class="md-base" data-base="Lists/Books.base"></div>');
    assert.match(linkWikilinks('![[Gone.base]]', at), /md-missing/);
    assert.equal(linkWikilinks('[[Books.base]]', at), '[Books.base](#/files/Lists/Books.base)');
  });
});
