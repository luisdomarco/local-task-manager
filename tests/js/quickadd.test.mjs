import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { linkSubject, parseQuick, splitLinks, withKept } from '../../static/js/quickadd.js';
import { setStructure } from '../../static/js/rules.js';
import { FOLDER_PER_TYPE, PROJECTS } from '../../static/js/structure.js';
import { state } from '../../static/js/state.js';
import { freezeDate, unfreezeDate } from './helpers.mjs';

describe('quick add parser', () => {
  beforeEach(() => {
    freezeDate();
    state.byId = new Map([
      ['INI-0001', { id: 'INI-0001', type: 'initiative' }],
      ['TSK-0001', { id: 'TSK-0001', type: 'task' }],
      ['MTG-0001', { id: 'MTG-0001', type: 'meeting' }],
    ]);
  });
  afterEach(unfreezeDate);

  it('reads a task with its tokens', () => {
    const p = parseQuick('Fix login !high @today due:fri +auth #INI-0001 session:s1');
    assert.equal(p.type, 'task');
    assert.equal(p.title, 'Fix login');
    assert.equal(p.values.priority, 'P1'); // !high: the second priority, whatever the structure calls it
    assert.equal(p.values.plan_day, '2026-10-15');
    assert.equal(p.values.plan_week, '2026-W42');
    assert.equal(p.values.due, '2026-10-16');
    assert.deepEqual(p.values.labels, ['auth']);
    assert.equal(p.values.related_to, 'INI-0001');
    assert.equal(p.values.session_name, 's1');
    assert.deepEqual(p.errors, []);
  });

  it('plans for this month with @month, clearing a week or day typed before it', () => {
    const p = parseQuick('Plan Q4 review @week @month');
    assert.equal(p.title, 'Plan Q4 review');
    assert.equal(p.values.plan_month, '2026-10');
    assert.equal(p.values.plan_week, null);
    assert.equal(p.values.plan_day, null);
  });

  it('reads numeric priorities and the first link as the main one', () => {
    const p = parseQuick('Read this !1 https://a.io www.b.io');
    assert.equal(p.values.priority, 'P0');
    assert.equal(p.values.url, 'https://a.io');
    assert.deepEqual(p.values.links, [{ url: 'https://www.b.io' }]);
  });

  it('reads a priority word by its rank in each structure', () => {
    for (const [s, want] of [[PROJECTS, ['P0', 'P1', 'P2', 'P3']], [FOLDER_PER_TYPE, ['Urgent', 'High', 'Normal', 'Low']]]) {
      setStructure(s);
      assert.deepEqual(['!urgent', '!high', '!normal', '!LOW'].map((w) => parseQuick(`X ${w}`).values.priority), want, s.id);
    }
    setStructure(PROJECTS);
  });

  it('types an item with a slash word', () => {
    assert.equal(parseQuick('Call notes /note').type, 'note');
    assert.equal(parseQuick('Kickoff /meeting').type, 'meeting');
    assert.equal(parseQuick('Kickoff text /trn #MTG-0001').type, 'transcription');
    assert.equal(parseQuick('Kickoff text /transcription').type, 'transcription');
  });

  it('drops planning for types that cannot be planned', () => {
    const p = parseQuick('Remember this /note @today !high due:fri', { values: { list: 'doing' } });
    assert.equal(p.type, 'note');
    for (const k of ['plan_day', 'plan_week', 'priority', 'due', 'status', 'list']) assert.equal(p.values[k], undefined, k);
  });

  it('checks the relation it was asked for', () => {
    assert.match(parseQuick('x #INI-9999').errors[0], /not found/);
    assert.match(parseQuick('transcript /trn #TSK-0001').errors[0], /can't hang from a task/);
    assert.deepEqual(parseQuick('transcript /trn #MTG-0001').errors, []);
  });

  it('lets the defaults of the place it is typed in apply', () => {
    const p = parseQuick('Add a card', { type: 'task', values: { related_to: 'INI-0001', list: 'todo' } });
    assert.equal(p.values.related_to, 'INI-0001');
    assert.equal(p.values.list, 'todo');
  });
});

it('a link alone is named after its site, the link in its url (a share with no title of its own, a pasted address)', () => {
  const p = parseQuick('https://x.com/someone/status/1857?s=46&t=AbC', { type: 'inbox' });
  assert.equal(p.title, 'X');
  assert.equal(p.values.url, 'https://x.com/someone/status/1857?s=46&t=AbC');
  assert.equal(parseQuick('www.pepita.com/ofertas', { type: 'inbox' }).title, 'pepita');
  assert.equal(parseQuick('https://pepita.com +read', { type: 'inbox' }).title, 'pepita'); // a token is no title either
  // a link in the box's defaults (not typed) names nothing: no words, no title
  assert.equal(parseQuick('', { type: 'inbox', values: { url: 'https://x.com/a' } }).title, '');
  const titled = parseQuick('A thread on caching https://x.com/someone/status/1857', { type: 'inbox' });
  assert.equal(titled.title, 'A thread on caching');
  assert.equal(titled.values.url, 'https://x.com/someone/status/1857');
});

it('TSK-128: a pasted or shared link leaves the Subject: its words stay, its links go apart', () => {
  assert.deepEqual(splitLinks('Read later https://x.com/a/status/1 www.pepita.com/b'), { rest: 'Read later', urls: ['https://x.com/a/status/1', 'https://www.pepita.com/b'] });
  assert.deepEqual(splitLinks(''), { rest: '', urls: [] });
  assert.equal(linkSubject('https://x.com/a/status/1'), 'X — ');
});

it('TSK-128: the links kept apart become the url and links; an untouched "X —" loses its dash', () => {
  const kept = ['https://x.com/a/status/1'];
  const bare = withKept(parseQuick('X —', { type: 'inbox' }), kept);
  assert.equal(bare.title, 'X');
  assert.equal(bare.values.url, 'https://x.com/a/status/1');
  const written = withKept(parseQuick('X — a thread on caching', { type: 'inbox' }), kept);
  assert.equal(written.title, 'X — a thread on caching');
  const empty = withKept(parseQuick('', { type: 'inbox' }), kept);
  assert.equal(empty.title, 'X'); // nothing written: the site's name
  // a link typed in the box stays the url; the kept one is a second link, never twice
  const both = withKept(parseQuick('Docs https://a.io', { type: 'inbox' }), ['https://b.io', 'https://a.io']);
  assert.equal(both.values.url, 'https://a.io');
  assert.deepEqual(both.values.links, [{ url: 'https://b.io' }]);
  assert.equal(withKept(parseQuick('A - B', { type: 'inbox' }), []).title, 'A - B'); // a dash inside is kept
});
