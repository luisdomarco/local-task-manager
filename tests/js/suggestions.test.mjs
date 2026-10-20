import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { guessKind, suggestLog } from '../../static/js/suggestions.js';

const item = (over) => ({ id: 'TSK-0001', key: 'TSK-0001', title: 'Thing', type: 'task', fields: { created_at: '2026-10-14T09:00', updated_at: '2026-10-14T09:00' }, ...over });
const run = (items, extra = {}) => suggestLog({ items, worklog: [], from: '2026-10-01', to: '2026-10-15', today: '2026-10-15', ...extra });

describe('work log suggestions', () => {
  it('suggests a day with activity and no work logged', () => {
    const [s] = run([item({})]);
    assert.equal(s.date, '2026-10-14');
    assert.equal(s.id, 'TSK-0001');
    assert.match(s.note, /Created/);
  });

  it('stays quiet when the day already has an entry for the item', () => {
    assert.deepEqual(run([item({})], { worklog: [{ date: '2026-10-14', id: 'TSK-0001' }] }), []);
  });

  it('honours dismissed suggestions', () => {
    assert.deepEqual(run([item({})], { dismissed: new Set(['2026-10-14|TSK-0001']) }), []);
  });

  it('never suggests the future, inbox items, prompts or archived items', () => {
    const future = item({ fields: { created_at: '2026-10-20T09:00', updated_at: '2026-10-20T09:00' } });
    assert.deepEqual(run([future]), []);
    for (const type of ['inbox', 'prompt']) assert.deepEqual(run([item({ type })]), []);
    assert.deepEqual(run([item({ fields: { created_at: '2026-10-14T09:00', archived: true } })]), []);
  });

  it('counts comments and merges reasons into one suggestion per day', () => {
    const it = item({ fields: { created_at: '2026-10-14T09:00', updated_at: '2026-10-14T11:00', comments: [{ at: '2026-10-14T10:00', text: 'a' }, { at: '2026-10-14T10:30', text: 'b' }] } });
    const out = run([it]);
    assert.equal(out.length, 1);
    assert.match(out[0].note, /Created/);
    assert.match(out[0].note, /2 comments/);
    assert.doesNotMatch(out[0].note, /Edited/); // "edited" adds nothing next to the others
  });

  it('guesses the kind of work from the type', () => {
    assert.equal(guessKind({ type: 'meeting', fields: {} }, new Set()), 'Meeting');
    assert.equal(guessKind({ type: 'transcription', fields: {} }, new Set()), 'Meeting');
    assert.equal(guessKind({ type: 'activity', fields: {} }, new Set()), 'Management');
    assert.equal(guessKind({ type: 'note', fields: {} }, new Set()), 'Definition');
    assert.equal(guessKind({ type: 'task', fields: { status: 'Review' } }, new Set()), 'Testing');
    assert.equal(guessKind({ type: 'task', fields: { status: 'ToDo' } }, new Set(['closed'])), 'Testing');
    assert.equal(guessKind({ type: 'task', fields: { status: 'ToDo' } }, new Set()), 'Analysis');
  });
});
