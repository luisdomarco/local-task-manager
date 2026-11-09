import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentMarks, costLabel, durationLabel, filterRuns, groupActivity, inboxCount, isUnread, runLabel, runStatus } from '../../static/js/runmodel.js';

describe('runmodel', () => {
  it('reads what a run is doing now first', () => {
    assert.equal(runStatus({ live: true, busy: true, pending: 1 }), 'needs_you');
    assert.equal(runStatus({ live: true, busy: true, pending: 0 }), 'working');
    assert.equal(runStatus({ live: true, busy: false, pending: 0 }), 'working'); // starting: no turn ended yet
    assert.equal(runStatus({ live: true, busy: false, pending: 0, outcome: 'success' }), 'done'); // open for a reply, but done
    assert.equal(runStatus({ live: true, busy: false, outcome: 'error' }), 'failed');
    assert.equal(runStatus({ target: 'terminal' }), 'started');
    assert.equal(runStatus(null), 'stopped');
  });

  it('says how a run that is over ended', () => {
    assert.equal(runStatus({ outcome: 'success', exit_code: 0 }), 'done');
    assert.equal(runStatus({ outcome: 'error' }), 'failed');
    assert.equal(runStatus({ outcome: 'success', exit_code: 1 }), 'done'); // its turn finished: the work is done
    assert.equal(runStatus({ outcome: 'success', exit_code: -15 }), 'done'); // closed in the dock after its turn
    assert.equal(runStatus({ outcome: 'error', stopped: true }), 'stopped'); // Stop mid-turn: claude answers with an error
    assert.equal(runStatus({ outcome: 'error', exit_code: 0 }), 'failed');
    assert.equal(runStatus({ target: 'terminal', outcome: 'success' }), 'done');
  });

  it('never calls done a run that did not finish a turn', () => {
    assert.equal(runStatus({ exit_code: 1 }), 'failed');   // it crashed before finishing one
    assert.equal(runStatus({ exit_code: 0 }), 'stopped');  // it ended cleanly before finishing one
    assert.equal(runStatus({}), 'stopped');                // this app lost sight of it (the server restarted)
    assert.equal(runStatus({ stopped: true, exit_code: 1 }), 'stopped');
  });

  it('writes durations and costs short', () => {
    assert.equal(durationLabel(400), '');
    assert.equal(durationLabel(42_000), '42s');
    assert.equal(durationLabel(190_000), '3m 10s');
    assert.equal(durationLabel(3_900_000), '1h 05m');
    assert.equal(costLabel(0), '');
    assert.equal(costLabel(0.004), '<$0.01');
    assert.equal(costLabel(0.4211), '$0.42');
  });

  it('puts a run in plain words', () => {
    const t = 1_000_000;
    assert.equal(runLabel({ live: true, pending: 1, waiting_for: 'Bash' }), 'Needs your OK to run Bash');
    assert.equal(runLabel({ live: true, pending: 1, waiting_for: 'question' }), 'Has a question for you');
    assert.equal(runLabel({ live: true, busy: true, started_ts: t - 65_000 }, t), 'Working for 1m 05s');
    assert.equal(runLabel({ outcome: 'success', started_ts: t, ended_ts: t + 190_000, cost: 0.42 }), 'Done in 3m 10s · $0.42');
    assert.equal(runLabel({ outcome: 'error', started_ts: t, ended_ts: t + 41_000 }), 'Failed after 41s');
    assert.equal(runLabel({ target: 'terminal' }), 'Opened in Terminal');
  });

  it('groups the activity and filters it', () => {
    const runs = [
      { id: 'a', live: true, busy: true, pending: 1, cmd: 'dev:start', dir: 'd1', dir_name: 'App' },
      { id: 'b', live: true, busy: true, cmd: 'qa:ask', dir: 'd2', source: 'schedule' },
      { id: 'c', outcome: 'success', cmd: 'hello', args: 'World', dir: 'd1' },
      { id: 'd', outcome: 'success', read_at: 'x', cmd: 'hello', dir: 'd1' },
    ];
    assert.deepEqual(groupActivity(runs).map((g) => [g.key, g.runs.map((r) => r.id)]),
      [['needs_you', ['a']], ['running', ['b']], ['unread', ['c']], ['earlier', ['d']]]);
    assert.equal(isUnread(runs[2]), true);
    assert.deepEqual(filterRuns(runs, { q: 'world' }).map((r) => r.id), ['c']);
    assert.deepEqual(filterRuns(runs, { q: 'app' }).map((r) => r.id), ['a']);
    assert.deepEqual(filterRuns(runs, { dir: 'd1', status: 'done' }).map((r) => r.id), ['c', 'd']);
    assert.deepEqual(filterRuns(runs, { source: 'schedule' }).map((r) => r.id), ['b']);
  });

  it('marks each agent with its most pressing run', () => {
    const runs = [
      { dir: 'd1', cmd: 'hello', outcome: 'success' },
      { dir: 'd1', cmd: 'hello', live: true, pending: 2 },
      { dir: 'd1', cmd: 'qa:ask', live: true, busy: true },
      { dir: 'd1', cmd: 'qa:ask', outcome: 'error' },
      { dir: 'd2', cmd: 'hello', outcome: 'success', read_at: 'x' },
    ];
    assert.deepEqual(agentMarks(runs), { 'd1 hello': 'needs_you', 'd1 qa:ask': 'working' });
    assert.deepEqual(agentMarks(runs.slice(3)), { 'd1 qa:ask': 'unread' });
    assert.equal(inboxCount({ needs_you: 1, running: 4, unread: 2 }), 3);
    assert.equal(inboxCount(null), 0);
  });
});
