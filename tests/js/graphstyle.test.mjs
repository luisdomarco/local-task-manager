import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EDGE_KINDS } from '../../static/js/graphmodel.js';
import { DEFAULT_KINDS, GROUP_COLORS, LOOK_DEFAULTS, edgeStyle, labelAlpha, nodeColor } from '../../static/js/graphstyle.js';

const rel = (relation) => edgeStyle({ source: 'a', target: 'b', kind: 'relation', relation });

describe('how each kind of edge is drawn', () => {
  it('every kind has a whole style, in a theme tone', () => {
    for (const kind of [...EDGE_KINDS, 'unknown']) {
      const s = edgeStyle({ source: 'a', target: 'b', kind });
      assert.ok(['strong', 'soft', 'faint', 'alert'].includes(s.tone), kind);
      assert.ok(s.width > 0 && Array.isArray(s.dash) && s.pull >= 0 && s.pull <= 1, kind);
    }
  });

  it('arrows run the way the work flows, whichever item keeps the relation', () => {
    // A blocked by B is kept on A (source A, target B): the head goes back to A, the blocked one.
    assert.equal(rel('blocked').arrow, 'back');
    assert.equal(rel('blocks').arrow, true);
    assert.equal(rel('precedes').arrow, true);
    assert.equal(rel('follows').arrow, 'back');
    assert.equal(rel('relates').arrow, false);
    assert.equal(rel(undefined).arrow, false, 'a relation with no kind is Related to');
  });

  it('a block stands out; a project barely pulls; a mention is the loosest tie', () => {
    assert.equal(rel('blocked').tone, 'alert');
    assert.equal(rel('relates').tone, 'soft');
    const project = edgeStyle({ kind: 'project' });
    const parent = edgeStyle({ kind: 'parent' });
    const mention = edgeStyle({ kind: 'mention' });
    assert.ok(project.pull < mention.pull && mention.pull < parent.pull);
    assert.ok(mention.dash.length > 0);
  });

  it('the graph opens without the project edges, every other kind on', () => {
    assert.deepEqual(DEFAULT_KINDS, EDGE_KINDS.filter((k) => k !== 'project'));
  });
});

describe('the look of the nodes and names', () => {
  it('names fade in as the zoom nears the threshold, whole at it', () => {
    assert.equal(labelAlpha(0.2, 0.5), 0);
    assert.equal(labelAlpha(1, 0.5), 1);
    const mid = labelAlpha(0.85, 0.5);
    assert.ok(mid > 0 && mid < 1, String(mid));
    assert.ok(labelAlpha(0.5, 0) > labelAlpha(0.5, 1), 'a lower threshold shows them sooner');
  });

  it('a node takes its first matching group\'s colour, else its type\'s when coloured by type, else the base', () => {
    const groups = [{ color: 'red', match: (n) => n.type === 'story' }, { color: 'blue', match: () => true }];
    assert.equal(nodeColor({ type: 'story' }, { groups, base: 'grey' }), 'red');
    assert.equal(nodeColor({ type: 'task' }, { groups, base: 'grey' }), 'blue');
    assert.equal(nodeColor({ type: 'task' }, { colorBy: 'type', typeColor: () => 'green', base: 'grey' }), 'green');
    assert.equal(nodeColor({ type: 'task' }, { base: 'grey' }), 'grey');
  });

  it('opens as Obsidian\'s: grey, no arrows', () => {
    assert.equal(LOOK_DEFAULTS.colorBy, 'none');
    assert.equal(LOOK_DEFAULTS.arrows, false);
    assert.ok(GROUP_COLORS.length >= 6);
  });
});
