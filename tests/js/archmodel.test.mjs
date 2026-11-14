import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { archHint, byLevel, entityForFile, levelOf, mapSource, withPrefix } from '../../static/js/archmodel.js';
import { PROJECTS } from '../../static/js/structure.js';

const INFO = PROJECTS.agents; // tm/structures/agents.py public, as the page reads it
const ent = (id, type, title, relations = []) => ({ id, title, fields: { entity_type: type, relations } });

describe('levels', () => {
  it('each type sits at its level', () => {
    assert.equal(levelOf(INFO, 'hook'), 'N0');
    assert.equal(levelOf(INFO, 'skill'), 'N2');
    assert.equal(levelOf(INFO, 'agent'), 'N3');
    assert.equal(levelOf(INFO, 'eval'), 'N5');
    assert.equal(levelOf(INFO, 'nope'), '');
  });
  it('byLevel: N0 to N5, every level with its types, then those with no type', () => {
    const groups = byLevel([ent('1', 'skill', 'ski-a'), ent('2', 'tool', 'b'), ent('3', '', 'loose')], INFO);
    assert.deepEqual(groups.map((g) => g.level), ['N0', 'N1', 'N2', 'N3', 'N4', 'N5', '']);
    const n2 = groups.find((g) => g.level === 'N2');
    assert.deepEqual(n2.items.map((e) => e.id), ['1', '2']);
    assert.deepEqual(n2.types.map((t) => t.id), ['skill', 'resource', 'script', 'tool']);
    assert.deepEqual(groups.at(-1).items.map((e) => e.id), ['3']);
    assert.equal(byLevel([ent('1', 'skill', 'x')], INFO).length, 6); // no loose group when none is loose
  });
});

describe('archHint', () => {
  it('AP-1 is an error, whatever the harness', () => assert.equal(archHint({ architecture: 'AP-1', harness: 'assistant' }, INFO).tone, 'error'));
  it('a harness that usually comes out as another architecture is a hint', () => {
    const hint = archHint({ architecture: 'AR-3', harness: 'assistant' }, INFO, { harness: { assistant: 'Assistant' } });
    assert.equal(hint.tone, 'hint');
    assert.match(hint.text, /^Assistant usually comes out as AR-1 or AR-2/);
  });
  it('nothing to say when they agree, or one is missing', () => {
    assert.equal(archHint({ architecture: 'AR-2', harness: 'assistant' }, INFO), null);
    assert.equal(archHint({ architecture: 'AR-4', harness: 'governed_process' }, INFO), null);
    assert.equal(archHint({ architecture: '', harness: 'assistant' }, INFO), null);
    assert.equal(archHint({ architecture: 'AR-3' }, INFO), null);
  });
});

describe('withPrefix', () => {
  it('adds its type\'s prefix once', () => {
    assert.equal(withPrefix('dedupe-leads', 'skill', '', INFO), 'ski-dedupe-leads');
    assert.equal(withPrefix('ski-dedupe-leads', 'skill', '', INFO), 'ski-dedupe-leads');
  });
  it('an agent\'s by its role', () => {
    assert.equal(withPrefix('router', 'agent', 'supervisor', INFO), 'age-sup-router');
    assert.equal(withPrefix('router', 'agent', '', INFO), 'age-router');
    assert.equal(withPrefix('age-spe-router', 'agent', 'supervisor', INFO), 'age-spe-router');
  });
  it('a proposed type has none', () => assert.equal(withPrefix('catalog-search', 'tool', '', INFO), 'catalog-search'));
});

describe('mapSource', () => {
  it('nothing for no entity', () => assert.equal(mapSource([], INFO), ''));
  it('levels top down, shapes by kind, one line per relation', () => {
    const src = mapSource([ent('1', 'agent', 'age-spe-a', ['2']), ent('2', 'tool', 'search "x"', ['1']), ent('3', 'memory', 'dossier'),
      ent('4', 'event', 'order-placed'), ent('5', 'command', 'com-run')], INFO, (e) => `ENT-${e.id}`);
    assert.ok(src.startsWith('flowchart TB\n'));
    assert.ok(src.indexOf('N4 · Procedures') < src.indexOf('N3 · Actors') && src.indexOf('N3 · Actors') < src.indexOf('N1 · Context'));
    assert.match(src, /e1\["age-spe-a<br\/>ENT-1"\]/); // a box: it has a model
    assert.match(src, /e2\{\{"search #quot;x#quot;<br\/>ENT-2"\}\}/); // a hexagon, its quotes escaped
    assert.match(src, /e3\[\("dossier<br\/>ENT-3"\)\]/); // a cylinder
    assert.match(src, /e4\(\("order-placed<br\/>ENT-4"\)\)/); // a circle
    assert.match(src, /e5\("com-run<br\/>ENT-5"\)/);
    assert.equal(src.match(/---/g).length, 1); // 1↔2 once, though both name it
  });
});

describe('entityForFile', () => {
  const e = (id, path) => ({ id, fields: { path } });
  const all = [e('1', '.claude/commands/run-checks.md'), e('2', 'apps/shop/.claude/agents/age-spe-a.md'), e('3', '')];
  it('the same path, or one ending in the other', () => {
    assert.equal(entityForFile(all, '.claude/commands/run-checks.md').id, '1');
    assert.equal(entityForFile(all, './.claude/commands/run-checks.md').id, '1');
    assert.equal(entityForFile(all, '.claude/agents/age-spe-a.md').id, '2');
  });
  it('none for another file, or no file', () => {
    assert.equal(entityForFile(all, '.claude/commands/other.md'), null);
    assert.equal(entityForFile(all, ''), null);
    assert.equal(entityForFile(all, 'run-checks.md'), null); // a bare name is not a path
  });
});
