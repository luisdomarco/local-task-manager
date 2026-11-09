import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { idMatches, idSortKey, idTip, refOf, shownId } from '../../static/js/shownid.js';

const item = (id, project) => ({ id, fields: project === undefined ? {} : { project } });

// A table draws a Projects ticket's id without its project's key, which its row already says.
describe('shownId', () => {
  it('draws the whole id where nothing says the project (full)', () => {
    assert.equal(shownId(item('ACME-INI-001', 'ACME'), { full: true }), 'ACME-INI-001');
    assert.equal(shownId({ id: '482', ref: 'STY-482', fields: { project: 'ACME' } }, { full: true }), 'STY-482');
  });

  it("drops the project's key in front of a ticket's id", () => {
    assert.equal(shownId(item('ACME-INI-001', 'ACME')), 'INI-001');
    assert.equal(shownId(item('FOUR-SPEC-012', 'FOUR')), 'SPEC-012');
  });

  it('keeps an id that does not start with its project key (a task, an id from before, another structure)', () => {
    assert.equal(shownId(item('TSK-002', 'ACME')), 'TSK-002');
    assert.equal(shownId(item('OPS-INI-001', 'ACME')), 'OPS-INI-001');
    assert.equal(shownId(item('ACMEX-INI-001', 'ACME')), 'ACMEX-INI-001');
    assert.equal(shownId(item('TSK-0001', 'PRJ-0001')), 'TSK-0001');
  });

  it('keeps the id whole when there is no project, or nothing would be left', () => {
    assert.equal(shownId(item('ACME-INI-001')), 'ACME-INI-001');
    assert.equal(shownId(item('ACME-INI-001', '')), 'ACME-INI-001');
    assert.equal(shownId(item('ACME-', 'ACME')), 'ACME-');
  });

  it('takes an item with no id as an empty one', () => {
    assert.equal(shownId({ fields: { project: 'ACME' } }), '');
    assert.equal(shownId(undefined), '');
  });
});

// Short ids (plans/short-ids.md): the server sends how an id is drawn as `ref` (TSK-482); `id` stays the key.
describe('short ids', () => {
  const short = { id: '482', ref: 'STY-482', aliases: ['ACME-STY-001'], fields: { project: 'ACME' } };

  it('draws a short id as its ref, in a table and anywhere', () => {
    assert.equal(shownId(short), 'STY-482');
    assert.equal(refOf(short), 'STY-482');
  });

  it('draws an item without a ref by its id, and a long id as it is', () => {
    assert.equal(refOf({ id: 'ACME-INI-001', ref: 'ACME-INI-001' }), 'ACME-INI-001');
    assert.equal(refOf({ id: 'TSK-0001' }), 'TSK-0001');
    assert.equal(refOf(undefined), '');
  });

  it('finds an item by its ref, its number or an old id', () => {
    for (const q of ['sty-482', '482', 'acme-sty-001', 'sty-48']) assert.ok(idMatches(short, q), q);
    assert.ok(!idMatches(short, 'ini-482'));
    assert.ok(!idMatches(short, ''));
  });

  it('sorts short ids as numbers: STY-9 before STY-10', () => {
    const rows = [{ id: '10' }, { id: '9' }, { id: '100' }];
    assert.deepEqual(rows.map(idSortKey).sort().map(Number), [9, 10, 100]);
    assert.equal(idSortKey({ id: 'ACME-INI-001' }), 'ACME-INI-001');
    assert.equal(idSortKey({}), '');
  });

  it('tips the whole long id, or the ids a short one had before', () => {
    assert.equal(idTip({ id: 'ACME-INI-001', fields: { project: 'ACME' } }), 'ACME-INI-001');
    assert.equal(idTip(short), 'Was ACME-STY-001');
    assert.equal(idTip({ id: '9', ref: 'TSK-9', aliases: [] }), null);
  });
});
