import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyValue, propRows, propType, valuePieces } from '../../static/js/props.js';

describe('props', () => {
  it('infers each type as Obsidian does', () => {
    assert.equal(propType('tags', 'a'), 'tags');
    assert.equal(propType('Aliases', ['x']), 'list');
    assert.equal(propType('related', ['[[A]]', '[[B]]']), 'list');
    assert.equal(propType('done', 'true'), 'checkbox');
    assert.equal(propType('done', 'False'), 'checkbox');
    assert.equal(propType('rating', '4'), 'number');
    assert.equal(propType('ratio', '-0.5'), 'number');
    assert.equal(propType('created', '2026-11-14'), 'date');
    assert.equal(propType('at', '2026-11-14T09:54'), 'datetime');
    assert.equal(propType('at', '2026-11-14 09:54:10+01:00'), 'datetime');
    assert.equal(propType('version', '1.2.3'), 'text');
    assert.equal(propType('owner', '[[Ana]]'), 'text');
    assert.equal(propType('when', '2026-11'), 'text');
  });

  it('cuts a value into text, notes and web addresses', () => {
    assert.deepEqual(valuePieces('See [[Setup#Install|the setup]] and https://x.io/a?b=1.'), [
      { text: 'See ' }, { text: 'the setup', wiki: 'Setup', heading: 'Install' }, { text: ' and ' },
      { text: 'https://x.io/a?b=1', url: 'https://x.io/a?b=1' }, { text: '.' }]);
    assert.deepEqual(valuePieces('[[Ana]]'), [{ text: 'Ana', wiki: 'Ana', heading: null }]);
    assert.deepEqual(valuePieces('[[#Notes]]'), [{ text: 'Notes', wiki: '', heading: 'Notes' }]);
    assert.deepEqual(valuePieces('plain'), [{ text: 'plain' }]);
    assert.deepEqual(valuePieces(''), []);
  });

  it('leaves out the empty properties', () => {
    for (const v of ['', '[]', '{}', 'null', '~', [], ['', '']]) assert.equal(emptyValue(v), true, JSON.stringify(v));
    for (const v of ['0', 'false', ['a']]) assert.equal(emptyValue(v), false, JSON.stringify(v));
    assert.deepEqual(propRows([['a', ''], ['b', []], ['c', 'x']]).map((r) => r.key), ['c']);
  });

  it('draws a row per property: tags without their #, a list item by item, a checkbox as true or false', () => {
    const rows = propRows([['tags', ['#ux', 'web']], ['tags2', 'x'], ['related', ['[[A]]', '', 'b']], ['done', 'TRUE'], ['url', 'https://a.io']]);
    assert.deepEqual(rows[0], { key: 'tags', type: 'tags', icon: 'tag', value: ['#ux', 'web'], items: [[{ text: 'ux' }], [{ text: 'web' }]] });
    assert.equal(rows[1].type, 'text');
    assert.deepEqual(rows[2].items, [[{ text: 'A', wiki: 'A', heading: null }], [{ text: 'b' }]]);
    assert.equal(rows[3].type, 'checkbox');
    assert.equal(rows[3].value, true);
    assert.deepEqual(rows[4].items, [[{ text: 'https://a.io', url: 'https://a.io' }]]);
    // A string of tags, as an older note writes them
    assert.deepEqual(propRows([['tags', '#a, b c']])[0].items.map((p) => p[0].text), ['a', 'b', 'c']);
  });
});
