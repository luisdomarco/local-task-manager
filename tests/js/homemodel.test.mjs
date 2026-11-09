import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentStats, needingYou, recentResults, runningNow, startedAt, upNext, weekLine, weekStats, yourAgents } from '../../static/js/homemodel.js';

const NOW = Date.UTC(2026, 10, 9, 12, 0);
const H = 3_600_000;
const dirs = [
  { id: 'a1', name: 'Repo', commands: [{ name: 'dev:start' }, { name: 'dev:status' }, { name: 'hello' }] },
  { id: 'b2', name: 'Other', commands: [{ name: 'qa:ask' }] },
];
const run = (cmd, hoursAgo, extra = {}) => ({ id: `${cmd}-${hoursAgo}`, dir: 'a1', cmd, started_ts: NOW - hoursAgo * H, outcome: 'success', ...extra });

describe('homemodel', () => {
  it('offers the pinned agents, then the most run lately', () => {
    const runs = [run('hello', 1), run('dev:status', 2), run('hello', 3), run('dev:status', 4), run('dev:status', 5),
      run('dev:start', 24 * 40), run('gone', 1)];
    const got = yourAgents(dirs, runs, { pinned: ['b2 qa:ask', 'a1 nope'], now: NOW });
    assert.deepEqual(got.map((a) => [a.dir, a.command.name, a.count, a.pinned]),
      [['b2', 'qa:ask', 0, true], ['a1', 'dev:status', 3, false], ['a1', 'hello', 2, false]]); // dev:start: not in 30 days
    assert.equal(got[1].last.id, 'dev:status-2');
    assert.equal(yourAgents(dirs, runs, { limit: 1, now: NOW }).length, 1);
    assert.equal(yourAgents(dirs, runs, { pinned: ['b2 qa:ask', 'a1 hello'], limit: 1, now: NOW }).length, 2); // every pinned one
  });

  it('splits what runs, what waits and what ended', () => {
    const runs = [
      run('hello', 0.1, { live: true, busy: true, outcome: undefined }),
      run('dev:status', 0.5, { live: true, busy: false, outcome: undefined }),
      run('qa:ask', 0.2, { live: true, pending: 1, dir: 'b2' }),
      run('dev:start', 3, { ended_ts: NOW - H }),
      run('hello', 5, { outcome: 'error', ended_ts: NOW - 4 * H }),
      run('hello', 6, { target: 'terminal', outcome: undefined }),
    ];
    assert.deepEqual(runningNow(runs).map((r) => r.id), ['dev:status-0.5', 'hello-0.1']);
    assert.deepEqual(needingYou(runs).map((r) => r.id), ['qa:ask-0.2']);
    assert.deepEqual(recentResults(runs).map((r) => r.id), ['dev:start-3', 'hello-5']);
    assert.equal(recentResults(runs, 1).length, 1);
  });

  it('says what fires next and how the week went', () => {
    assert.deepEqual(upNext([{ id: 'x', next_ts: 30 }, { id: 'y', next_ts: 10 }, { id: 'z', paused: true, next_ts: 5 }, { id: 'w' }]).map((s) => s.id), ['y', 'x']);
    const runs = [run('a', 1, { cost: 0.5 }), run('b', 2, { outcome: 'error', cost: 0.25 }), run('c', 24 * 8, { cost: 9 })];
    assert.deepEqual(weekStats(runs, NOW), { runs: 2, done: 1, failed: 1, cost: 0.75 });
    assert.equal(weekLine(weekStats(runs, NOW)), '2 runs · 1 done · 1 failed · $0.75');
    assert.equal(weekLine(weekStats([], NOW)), '');
    assert.equal(startedAt({ at: '2026-11-09 12:00' }), Date.parse('2026-11-09T12:00'));
  });

  it('sums up one agent\'s last 30 days', () => {
    const runs = [run('hello', 1, { cost: 0.25, ended_ts: NOW - H + 60_000 }), run('hello', 2, { outcome: 'error', ended_ts: NOW - 2 * H + 20_000 }),
      run('hello', 3, { live: true, busy: true, outcome: undefined }), run('hello', 24 * 40, { cost: 5 })];
    const s = agentStats(runs, NOW);
    assert.deepEqual({ ...s, last: s.last.id }, { last: 'hello-1', runs: 3, done: 1, failed: 1, success: 0.5, avgMs: 40_000, cost: 0.25, avgCost: 0.25 }); // the runs without a cost left out of its mean
    assert.deepEqual(agentStats([], NOW), { last: null, runs: 0, done: 0, failed: 0, success: null, avgMs: null, cost: 0, avgCost: null });
  });
});
