import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { findByPageRef, hasPage, pageRef, propsIn, setStructure, tabOf } from '../../static/js/rules.js';
import { itemHref, pageHref } from '../../static/js/links.js';
import { FOLDER_PER_TYPE } from '../../static/js/structure.js';

// The folder-per-type structure plus two Ticketing-like types: a project (a page, named by its key: it has no id) and a ticket whose own
// fields sit in different places (its properties, the Delivery tab, Relations).
const WITH_PROJECTS = {
  ...FOLDER_PER_TYPE,
  types: [
    ...FOLDER_PER_TYPE.types,
    { ...FOLDER_PER_TYPE.types.find((t) => t.name === 'note'), name: 'project', has_id: false, page: true, children: ['ticket'] },
    {
      ...FOLDER_PER_TYPE.types.find((t) => t.name === 'task'), name: 'ticket',
      props: [
        { key: 'size', label: 'Size', kind: 'select', options: [['S', 'S']] },
        { key: 'branch', label: 'Branch', kind: 'text', tab: 'delivery' },
        { key: 'prd', label: 'PRD', kind: 'link', types: ['ticket'] },
        { key: 'depends_on', label: 'Depends on', kind: 'links', types: ['ticket'] },
        { key: 'repo', label: 'Repo', kind: 'readonly', tab: 'details' },
      ],
    },
  ],
};
const item = (type, id, fields = {}) => ({ type, id, key: id || `${type}.md`, fields });

describe('pages', () => {
  after(() => setStructure(FOLDER_PER_TYPE));

  it('in the folder-per-type structure, only an initiative with an id has a page; the rest open as a card over their list', () => {
    setStructure(FOLDER_PER_TYPE);
    assert.equal(hasPage(item('initiative', 'INI-0001')), true);
    assert.equal(pageHref(item('initiative', 'INI-0001')), '#/initiative/INI-0001'); // the address it always had
    assert.equal(hasPage(item('initiative', null)), false);
    assert.equal(hasPage(item('task', 'TSK-0001')), false);
    assert.equal(pageHref(item('task', 'TSK-0001')), null);
    assert.equal(itemHref(item('task', 'TSK-0001')), '#/item/TSK-0001');
  });

  it('a type with a page has one, and a project is named by its key', () => {
    setStructure(WITH_PROJECTS);
    const hb = item('project', null, { project_key: 'HB' });
    assert.equal(pageRef(hb), 'HB');
    assert.equal(hasPage(hb), true);
    assert.equal(itemHref(hb), '#/project/HB');
    assert.equal(hasPage(item('project', null, {})), false); // nothing to name it by: a card
    assert.equal(findByPageRef('project', 'HB', [item('ticket', 'HB-TKT-001'), hb]), hb);
    assert.equal(findByPageRef('project', 'XX', [hb]), null);
    assert.equal(findByPageRef('ticket', 'HB-TKT-001', [hb]), null);
  });

  it("puts each of a type's own fields where it says, and every link in Relations", () => {
    setStructure(WITH_PROJECTS);
    assert.deepEqual(propsIn('ticket', 'main').map((p) => p.key), ['size']);
    assert.deepEqual(propsIn('ticket', 'delivery').map((p) => p.key), ['branch']);
    assert.deepEqual(propsIn('ticket', 'relations').map((p) => p.key), ['prd', 'depends_on']);
    assert.deepEqual(propsIn('ticket', 'details').map((p) => p.key), ['repo']);
    assert.equal(tabOf({ kind: 'link' }), 'relations');
    assert.equal(tabOf({ kind: 'link', tab: 'main' }), 'main'); // a link may say otherwise
    assert.deepEqual(propsIn('task', 'delivery'), []); // the folder-per-type structure's types have none: no Delivery tab
  });
});
