import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
// Loaded with no DOM (its load-time effects skip themselves); h() reads `document` only when called.
import { itemCard } from '../../static/js/ui.js';

// Just enough of a DOM for h() and icon(): elements that keep their class, attributes and children.
class FakeNode {}
class FakeEl extends FakeNode {
  constructor(tag) { super(); this.tag = tag; this.className = ''; this.attrs = {}; this.children = []; this.style = {}; this.dataset = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener() {}
  append(...c) { this.children.push(...c); }
  prepend(...c) { this.children.unshift(...c); }
  get textContent() { return this.children.map((c) => c.textContent || '').join(''); }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (tag) => new FakeEl(tag),
  createElementNS: (_ns, tag) => new FakeEl(tag),
  createTextNode: (text) => Object.assign(new FakeNode(), { textContent: text }),
};

/** The element whose class list holds `cls`, depth first. */
const find = (el, cls) => {
  if (String(el.className || el.attrs?.class || '').split(/\s+/).includes(cls)) return el;
  for (const c of el.children || []) { const hit = c instanceof FakeEl && find(c, cls); if (hit) return hit; }
  return null;
};
/** The text of each child of a card's line. */
const parts = (line) => (line ? line.children.filter((c) => c && c.textContent).map((c) => c.textContent) : []);

describe("a list's board card (TSK-128)", () => {
  const item = { id: 'TSK-7', key: 'TSK-7', type: 'task', title: 'Ship it',
    fields: { status: 'In progress', priority: 'P1', due: '2099-01-02', labels: ['infra'], size: 'M', updated_at: '2099-01-01T10:00' } };
  const on = new Set(['status', 'priority', 'due', 'labels', 'id', 'prop:size', 'updated_at']);
  const card = (order, cell) => itemCard(item, { variant: 'board', shows: (k) => on.has(k), board: { order, cell } });

  it('draws status, priority and plan first, then the rest in the list\'s order', () => {
    const order = ['status', 'priority', 'project', 'plan', 'due', 'labels', 'prop:size', 'updated_at', 'id'];
    const cell = (k, i) => Object.assign(new FakeEl('span'), { children: [{ textContent: k === 'prop:size' ? `Size ${i.fields.size}` : 'Jan 1' }] });
    const el = card(order, cell);
    assert.deepEqual(parts(find(el, 'card-main')), ['In progress', 'P1']);
    assert.deepEqual(parts(find(el, 'card-meta')), ['Due Jan 2 2099', '#infra', 'Size M', 'Jan 1', 'TSK-7']);
  });

  it('leaves out what the list has no column for, and what it was not asked for', () => {
    const el = card(['priority', 'id'], () => null);
    assert.deepEqual(parts(find(el, 'card-main')), ['P1']); // no status: not in this list's order
    assert.deepEqual(parts(find(el, 'card-meta')), ['TSK-7']);
  });
});

describe("a phone's row: its status and priority chips", () => {
  const css = readFileSync(new URL('../../static/css/app.css', import.meta.url), 'utf8');
  it('stay unframed while their menu is open (the open state\'s chevron repeated under the word)', () => {
    const rule = css.match(/\.list-main \.grid td \.pm-cell \.select-btn\.small:is\(\*, :hover, :focus-visible, \[aria-expanded="true"\]\) \{([^}]*)\}/);
    assert.ok(rule, 'the rule for an open chip');
    for (const decl of ['padding: 0', 'border-color: transparent', 'background: none', 'box-shadow: none']) assert.ok(rule[1].includes(decl), decl);
  });
});
