// TSK-128: an item's comments as files — the page knows when each was written (comment_ats) and reads them once per
// version of them (comments_rev); a legacy vault keeps them in the item's frontmatter (fields.comments).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { authorOf, commentAts, commentCount, commentStore, commentsRev, keptComments } from '../../static/js/comments.js';

const files = (ats, rev = '2:9') => ({ key: 'TSK-1', fields: {}, comment_ats: ats, comments_rev: rev });
const inFile = (...list) => ({ key: 'TSK-2', fields: { comments: list } });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('comments as files', () => {
  it('knows when each was written without reading them: its files and any still in its frontmatter', () => {
    const it = { ...files(['2026-11-16T09:23:45.123']), fields: { comments: [{ at: '2026-10-01T10:00', text: 'old' }] } };
    assert.deepEqual(commentAts(it), ['2026-10-01T10:00', '2026-11-16T09:23:45.123']);
    assert.equal(commentCount(it), 2);
    assert.deepEqual(commentAts({ fields: {} }), []);
    assert.equal(commentCount({ fields: {} }), 0);
  });

  it('names a legacy comment by its place in the list', () => {
    assert.deepEqual(keptComments(inFile({ at: 'a', text: 'x' }, 'bare')), [{ at: 'a', text: 'x', id: 0 }, { text: 'bare', id: 1 }]);
  });

  it('says who wrote one', () => {
    assert.equal(authorOf({ by: 'agent' }), 'Agent');
    assert.equal(authorOf({ by: 'owner' }), 'You');
    assert.equal(authorOf({}), 'You'); // from before `by`
  });

  it('reads them once per version, the last list while a new one comes', async () => {
    const asked = [];
    let answer = [{ id: 'a', text: 'one' }];
    const commentsOf = commentStore((key) => { asked.push(key); return Promise.resolve(answer); });
    let changed = 0;
    const item = files(['2026-11-16T09:23:45.123'], '1:5');
    assert.equal(commentsOf(item, () => { changed += 1; }), null); // the first time: nothing yet
    await tick();
    assert.equal(changed, 1);
    assert.deepEqual(commentsOf(item), [{ id: 'a', text: 'one' }]);
    assert.deepEqual(asked, ['TSK-1']); // the same version: not asked again
    answer = [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }];
    const newer = { ...item, comments_rev: '2:6' };
    assert.deepEqual(commentsOf(newer, () => { changed += 1; }), [{ id: 'a', text: 'one' }]); // the last list meanwhile
    await tick();
    assert.equal(commentsOf(newer).length, 2);
    assert.deepEqual(asked, ['TSK-1', 'TSK-1']);
  });

  it('asks nothing about an item with none, and keeps a late answer off a newer version', async () => {
    const asked = [];
    const later = [];
    const commentsOf = commentStore((key) => { asked.push(key); return new Promise((r) => later.push(r)); });
    assert.deepEqual(commentsOf({ key: 'TSK-9', fields: {} }), []);
    assert.deepEqual(asked, []);
    commentsOf(files(['x'], '1:1'));
    commentsOf(files(['x', 'y'], '2:2'));
    later[1]([{ id: 'new' }]);
    later[0]([{ id: 'old' }]); // the first answer arrives last
    await tick();
    assert.deepEqual(commentsOf(files(['x', 'y'], '2:2')), [{ id: 'new' }]);
    assert.notEqual(commentsRev(files([], '1:1')), commentsRev(files([], '2:2')));
  });
});
