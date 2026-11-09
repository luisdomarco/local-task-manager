import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  agentEntries, agentHref, agentKey, agentPath, agentPathOfHash, folderCounts, parseRunsParam, pinnedAgents, runMessage, runMeta, toggled,
} from '../../static/js/agentsmodel.js';
import { buildTree, filterTree, findNode } from '../../static/js/filetree.js';

const DIRS = [
  { id: 'ab12cd34', name: 'Task Manager', commands: [
    { name: 'dev:start', ns: 'dev', description: 'Start' },
    { name: 'dev:pr', ns: 'dev', description: 'PR' },
    { name: 'wor-triage', ns: '', description: 'Triage' },
  ] },
  { id: 'ffff0000', name: 'Empty', commands: [] },
];

describe('agentsmodel', () => {
  it('places each agent under its folder and namespaces', () => {
    assert.equal(agentPath('ab12cd34', 'dev:start'), 'ab12cd34/dev/start');
    const tree = buildTree(agentEntries(DIRS));
    assert.deepEqual(tree.children.map((c) => c.name), ['ab12cd34', 'ffff0000']);
    const dev = findNode(tree, 'ab12cd34/dev');
    assert.equal(dev.kind, 'dir');
    assert.deepEqual(dev.children.map((c) => c.name), ['pr', 'start']);
    assert.equal(findNode(tree, 'ab12cd34/wor-triage').agent.dir, 'ab12cd34');
    assert.deepEqual(findNode(tree, 'ffff0000').children, []);
  });

  it('filters by name and description', () => {
    const tree = buildTree(agentEntries(DIRS));
    const paths = (n) => (n.kind === 'file' ? [n.path] : n.children.flatMap(paths));
    assert.deepEqual(paths(filterTree(tree, 'dev:st')), ['ab12cd34/dev/start']);
    assert.deepEqual(paths(filterTree(tree, 'triage')), ['ab12cd34/wor-triage']);
    assert.deepEqual(paths(filterTree(tree, 'PR')), ['ab12cd34/dev/pr']);
  });

  it('leaves hidden agents out unless asked, and counts them', () => {
    const hidden = new Set([agentKey('ab12cd34', 'dev:pr')]);
    const tree = buildTree(agentEntries(DIRS, { hidden }));
    assert.deepEqual(findNode(tree, 'ab12cd34/dev').children.map((c) => c.name), ['start']);
    const all = buildTree(agentEntries(DIRS, { hidden, showHidden: true }));
    assert.equal(findNode(all, 'ab12cd34/dev/pr').agent.hidden, true);
    assert.deepEqual(folderCounts(DIRS[0], hidden), { all: 3, hidden: 1, shown: 2 });
  });

  it('keeps the pinned agents that are still there, in their order', () => {
    const got = pinnedAgents(DIRS, [agentKey('ab12cd34', 'wor-triage'), 'gone x', agentKey('ab12cd34', 'dev:start')]);
    assert.deepEqual(got.map((a) => a.name), ['wor-triage', 'dev:start']);
    assert.equal(got[0].dir, 'ab12cd34');
  });

  it('round-trips the address of an agent', () => {
    const href = agentHref('ab12cd34', 'dev:start');
    assert.equal(href, '#/runs/ab12cd34/dev%3Astart');
    assert.deepEqual(parseRunsParam(href.replace('#/runs/', '')), { dir: 'ab12cd34', name: 'dev:start' });
    assert.equal(agentPathOfHash(href), 'ab12cd34/dev/start');
    assert.equal(agentPathOfHash('#/runs/ab12cd34/dev:start'), 'ab12cd34/dev/start'); // typed by hand
    assert.equal(agentPathOfHash('#/runs'), null);
    assert.equal(agentPathOfHash('#/files/x'), null);
    assert.equal(agentHref(), '#/runs');
  });

  it('builds the message as the server does (server.py agent_message)', () => {
    assert.equal(runMessage('dev:status'), '/dev:status');
    assert.equal(runMessage('dev:status', '  STY-1 "a b"\n$(rm -rf ~) `x` '), '/dev:status STY-1 "a b" $(rm -rf ~) `x`');
  });

  it('says where a run ran and what it ran with, leaving out the defaults', () => {
    assert.deepEqual(runMeta({ target: 'here', mode: 'default', model: '', effort: '' }), ['In the app']);
    assert.deepEqual(runMeta({ target: 'terminal', mode: 'plan', model: 'haiku', effort: 'high' }), ['Terminal', 'Plan first', 'haiku', 'high effort']);
    assert.deepEqual(runMeta({ mode: 'weird' }), ['weird']);
  });

  it('toggles a key in a pref list', () => {
    assert.deepEqual(toggled(null, 'a'), ['a']);
    assert.deepEqual(toggled(['a', 'b'], 'a'), ['b']);
    assert.equal(toggled(['a'], 'a'), null);
  });
});
