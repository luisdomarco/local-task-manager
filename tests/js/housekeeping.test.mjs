import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { trashSummary, warningGroups } from '../../static/js/housekeeping.js';

describe('trashSummary', () => {
  it('keeps Empty trash while only files taken off an item wait', () => {
    const s = trashSummary(0, 2);
    assert.equal(s.canEmpty, true);
    assert.equal(s.note, '2 files taken off items wait here too. Emptying the trash deletes them.');
    assert.equal(s.confirm, 'Delete all 2 files taken off items in the trash for good? It cannot be undone.');
  });

  it('counts what the Explorer deleted, and keeps Empty trash for it alone', () => {
    assert.equal(trashSummary(0, 0, 1).canEmpty, true);
    assert.equal(trashSummary(0, 0, 1).confirm, 'Delete 1 deleted file or folder in the trash for good? It cannot be undone.');
    assert.equal(trashSummary(2, 1, 3).confirm,
      'Delete all 2 items, 1 file taken off an item and 3 deleted files and folders in the trash for good? It cannot be undone.');
    assert.equal(trashSummary(0, 0, 0).canEmpty, false);
  });

  it('names the items and the files in the confirm', () => {
    assert.equal(trashSummary(3, 1).confirm, 'Delete all 3 items and 1 file taken off an item in the trash for good? It cannot be undone.');
    assert.equal(trashSummary(3, 1).note, '1 file taken off an item waits here too. Emptying the trash deletes it.');
    assert.equal(trashSummary(1, 0).confirm, 'Delete 1 item in the trash for good? It cannot be undone.');
  });

  it('says nothing of files when none waits, and hides the button on an empty trash', () => {
    assert.deepEqual(trashSummary(2, 0), { canEmpty: true, note: '', confirm: 'Delete all 2 items in the trash for good? It cannot be undone.' });
    assert.equal(trashSummary(0, 0).canEmpty, false);
  });
});

describe('warningGroups', () => {
  const w = (kind, path) => ({ kind, path, detail: `${kind} ${path}` });

  it('groups by kind, the known kinds first and an unknown one last', () => {
    const groups = warningGroups([w('untyped', 'a.md'), w('zzz_new', 'b'), w('unlisted_attachment', 'Attachments/x.pdf'), w('untyped', 'c.md')]);
    assert.deepEqual(groups.map((g) => [g.kind, g.label, g.findings.map((f) => f.path)]), [
      ['unlisted_attachment', 'Files no item lists', ['Attachments/x.pdf']],
      ['untyped', 'Files without a type', ['a.md', 'c.md']],
      ['zzz_new', 'zzz_new', ['b']],
    ]);
  });

  it('is empty without warnings', () => {
    assert.deepEqual(warningGroups([]), []);
    assert.deepEqual(warningGroups(undefined), []);
  });
});
