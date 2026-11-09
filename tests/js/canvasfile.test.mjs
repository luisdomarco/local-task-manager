import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CARD, DOTS, cardSig, cardSkeleton, cardsOn, clip, dotOf, emptyDrawing, fileName, parse, partSkeletons, priorityOf, serialize, staleCards, staleLinks, unplaced } from '../../static/js/canvas/canvasfile.js';
import { LIBRARY } from '../../static/js/canvas/library.js';

const rect = (id, item, textId, extra = {}) => ({ id, type: 'rectangle', customData: { tmItem: item }, boundElements: textId ? [{ type: 'text', id: textId }] : [], ...extra });
const text = (id, t, extra = {}) => ({ id, type: 'text', text: t, originalText: t, ...extra });

describe('canvasfile', () => {
  it('writes the file Obsidian\'s Excalidraw plugin reads, and reads it back', () => {
    const drawing = { ...emptyDrawing(), elements: [rect('r1', 'G1', 't1'), text('t1', 'Launch\nBacklog'), text('t2', 'gone', { isDeleted: true })], appState: { viewBackgroundColor: '#fff' } };
    const file = serialize(drawing, { host: 'Goals' });
    assert.match(file, /^---\nexcalidraw-plugin: parsed\ntask-manager-canvas: Goals\ntags: \[excalidraw\]\n---\n/);
    assert.match(file, /## Text Elements\nLaunch\nBacklog \^t1\n\n%%\n## Drawing\n```json\n/);
    assert.ok(!file.includes('gone ^t2')); // a deleted text is not listed
    const back = parse(file);
    assert.deepEqual(back.drawing.elements, drawing.elements);
    assert.deepEqual(back.drawing.appState, drawing.appState);
    // Its own front matter (Obsidian's keys) is kept as it was.
    const fm = 'excalidraw-plugin: parsed\ntags: [excalidraw]\ncssclasses: wide';
    assert.ok(serialize(back.drawing, { frontmatter: fm }).startsWith(`---\n${fm}\n---\n`));
    assert.equal(parse(serialize(back.drawing, { frontmatter: back.frontmatter })).frontmatter, back.frontmatter);
  });

  it('reads a bare .excalidraw file, an empty one, and refuses a compressed drawing with a way out', () => {
    assert.deepEqual(parse('{"type":"excalidraw","elements":[{"id":"a"}]}').drawing.elements, [{ id: 'a' }]);
    assert.deepEqual(parse('---\nexcalidraw-plugin: parsed\n---\n').drawing.elements, []);
    assert.throws(() => parse('# Excalidraw Data\n%%\n## Drawing\n```compressed-json\nN4Ig\n```\n%%'), /Decompress/);
  });

  it('names a canvas file, or refuses the name', () => {
    assert.equal(fileName('  Q1   roadmap '), 'Q1 roadmap.excalidraw.md');
    for (const bad of ['', '  ', 'a/b', '.hidden', 'what?', 'x'.repeat(81), '[[x]]']) assert.equal(fileName(bad), null, bad);
  });

  it('draws a card as a board\'s card: a frame, then its parts', () => {
    const card = { title: 'Launch', kicker: 'GOL-1', status: { label: 'In progress', key: 'InProgress' }, priority: 'P1', note: '1 of 4 closed', progress: { done: 1, total: 4 }, link: '[[Goals/G1]]' };
    const [frame, ...parts] = cardSkeleton({ id: 'G1' }, card, { x: 10.4, y: 20.6 }, 'goal');
    assert.deepEqual([frame.type, frame.x, frame.y, frame.width, frame.height, frame.link], ['rectangle', 10, 21, CARD.width, CARD.height, '[[Goals/G1]]']);
    assert.deepEqual(frame.customData, { tmItem: 'G1', tmKind: 'goal', tmSig: cardSig(card), tmTitle: 'Launch' });
    // The title, its ref, then status before priority (as a list's columns), the note, the progress.
    assert.deepEqual(parts.map((p) => p.customData.tmPart), ['title', 'kicker', 'dot', 'status', 'bar1', 'bar2', 'bar3', 'priority', 'note', 'track', 'done']);
    assert.ok(parts.every((p) => p.customData.tmOf === 'G1' && !p.customData.tmItem)); // a part is never taken for a card
    const part = (n) => parts.find((p) => p.customData.tmPart === n);
    assert.equal(part('dot').backgroundColor, DOTS.inprogress);
    assert.ok(part('priority').x > part('status').x + 60, 'the priority after the status\'s name');
    assert.deepEqual([part('priority').strokeColor, part('bar3').backgroundColor], [priorityOf('P1').ink, priorityOf('P1').ink]);
    assert.equal(part('done').width, (CARD.width - 2 * CARD.pad) / 4);
    // A bare card: a title and nothing else; an unknown status is the quiet one; P2 fills two bars of three.
    assert.deepEqual(partSkeletons('G2', { title: 'Only' }, frame).map((p) => p.customData.tmPart), ['title']);
    assert.equal(dotOf('Whatever'), DOTS.backlog);
    assert.equal(priorityOf('Normal').bars, 2);
    assert.equal(clip('x'.repeat(80)).length, 56);
  });

  it('finds the cards on a canvas, and the items not on it', () => {
    const els = [rect('r1', 'G1', null), rect('r2', 'G2', null, { isDeleted: true }), text('t1', 'x', { customData: { tmItem: 'G1' } }), { id: 'p1', type: 'rectangle', customData: { tmPart: 'title', tmOf: 'G3' } }];
    assert.deepEqual([...cardsOn(els).keys()], ['G1']); // not a deleted card, not a text, not a part
    assert.deepEqual(unplaced([{ id: 'G1' }, { id: 'G2' }, { id: 'G3' }], els).map((i) => i.id), ['G2', 'G3']);
  });

  it('finds the cards whose item changed, and marks a deleted one once', () => {
    const card = (i) => ({ title: i.title, status: { label: i.status, key: i.status } });
    const items = new Map([['G1', { id: 'G1', title: 'Launch', status: 'Backlog' }], ['G2', { id: 'G2', title: 'New name', status: 'Done' }]]);
    const frame = (id, item, sig, title) => rect(id, item, null, { customData: { tmItem: item, tmSig: sig, tmTitle: title } });
    const els = [frame('r1', 'G1', cardSig(card(items.get('G1'))), 'Launch'), frame('r2', 'G2', cardSig({ title: 'Old', status: { label: 'Done', key: 'Done' } }), 'Old'), frame('r3', 'G3', 'x', 'Gone')];
    const gone = { title: 'Gone', status: { label: 'Deleted', key: 'discarded' } };
    assert.deepEqual(staleCards(els, items, card), [{ id: 'r2', item: 'G2', card: card(items.get('G2')) }, { id: 'r3', item: 'G3', card: gone }]);
    const after = [els[0], frame('r2', 'G2', cardSig(card(items.get('G2'))), 'New name'), frame('r3', 'G3', cardSig(gone), 'Gone')];
    assert.deepEqual(staleCards(after, items, card), []);
  });

  it('finds the cards whose note was renamed, and leaves a deleted item\'s link as it was', () => {
    const card = (i) => ({ title: i.title, link: `[[Goals/${i.title}]]` });
    const els = [rect('r1', 'G1', null, { link: '[[Goals/Launch]]' }), rect('r2', 'G2', null, { link: '[[Goals/Old]]' }), rect('r3', 'G3', null, { link: '[[Goals/Gone]]' })];
    const items = new Map([['G1', { id: 'G1', title: 'Launch' }], ['G2', { id: 'G2', title: 'New' }]]);
    assert.deepEqual(staleLinks(els, items, card), [{ id: 'r2', link: '[[Goals/New]]' }]);
  });

  it('ships a library of shapes, a figure of several in one group', () => {
    assert.ok(LIBRARY.length >= 8);
    assert.equal(new Set(LIBRARY.map((l) => l.id)).size, LIBRARY.length);
    for (const l of LIBRARY.filter((x) => x.skeleton.length > 1)) assert.equal(new Set(l.skeleton.map((e) => e.groupIds?.[0])).size, 1, l.name);
    assert.ok(LIBRARY.some((l) => l.name === 'Sticky note') && LIBRARY.some((l) => l.name === 'Parallel gateway'));
  });
});
