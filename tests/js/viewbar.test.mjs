import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
// Loaded with no DOM (ui.js's load-time effects skip themselves); h() reads `document` only when called, so the fake
// below is assigned after this hoisted import — as tests/js/removebutton.test.mjs does.
import { viewBar } from '../../static/js/viewbar.js';

// Just enough of a DOM for h(), icon() and the bar's own painting.
class FakeNode {}
class FakeEl extends FakeNode {
  constructor(tag) {
    super();
    this.tag = tag; this.className = ''; this.attrs = {}; this.children = []; this.style = {}; this.value = ''; this.hidden = false;
    this.classList = { add: (c) => { this.className = `${this.className} ${c}`.trim(); }, toggle: () => {} };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener() {}
  append(...c) { this.children.push(...c); }
  replaceChildren(...c) { this.children = c; }
  querySelector() { return null; }
  get textContent() { return this.children.map((c) => c.textContent || '').join(''); }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (tag) => new FakeEl(tag),
  createElementNS: (_ns, tag) => new FakeEl(tag),
  createTextNode: (text) => Object.assign(new FakeNode(), { textContent: text }),
};

const barWith = (opts) => viewBar({
  view: { filters: [], groupBy: null, props: {}, closed: 'none' },
  save: () => {}, fields: () => [], ctx: () => ({}), items: () => [],
  onText: () => {}, onChange: () => {}, ...opts,
});

// SUP-5289: the bar is built afresh every time a page is mounted, while a page's filter text can outlive it (a list's
// does: main.js builds listView once and mounts it again on every visit). A box born empty over a filtered list is
// state with nothing on screen to undo it — no text, so no native ✕ either, and only a reload clears the filter.
describe('the view bar’s search box', () => {
  it('is born carrying the filter the page is already filtering by', () => {
    const search = barWith({ text: () => 'proj' }).search;
    assert.equal(search.value, 'proj');
    assert.equal(search.attrs.type, 'search'); // a value is what gives it the native ✕ to clear
  });

  it('asks the page for it each time it is built, so a second mount shows what the first was left filtering by', () => {
    let text = ''; // as a view's own text lives on while its bar is rebuilt
    const mount = () => barWith({ text: () => text, onText: (t) => { text = t; } });
    mount().search.value; // a first visit: nothing typed yet
    text = 'proj'; // typed into that bar
    assert.equal(mount().search.value, 'proj', 'the box came back blank over a filtered list');
  });

  it('is empty, and shows its placeholder, for a page that keeps no text', () => {
    const search = barWith({ placeholder: 'Search runs' }).search;
    assert.equal(search.value, '');
    assert.equal(search.attrs.placeholder, 'Search runs');
  });
});

// The other half of SUP-5289, and the one a new view would fall into: the bar can only restore what it is given, so a
// page that draws a search box has to hand its text back. Pinned over the sources because it is the call that is wrong,
// not the bar.
describe('every page with a search box hands its text back', () => {
  const dir = new URL('../../static/js/views/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));

  /** The text of the object literal a file passes to viewBar — its braces matched, so a `search: false` belonging to
   *  some select() further down the file is not read as the bar's. */
  function options(src) {
    const at = src.indexOf('viewBar({');
    if (at < 0) return null;
    const open = src.indexOf('{', at);
    let depth = 1;
    let i = open + 1;
    while (depth && i < src.length) { if (src[i] === '{') depth += 1; else if (src[i] === '}') depth -= 1; i += 1; }
    assert.equal(depth, 0, 'the view bar’s options are not a closed object literal');
    return src.slice(open + 1, i - 1);
  }

  const bars = files.map((f) => [f, readFileSync(new URL(f, dir), 'utf8')])
    .filter(([, s]) => s.includes('viewBar({'))
    .map(([f, s]) => [f, options(s), s]);

  it('is the seven pages that have one, each with a single bar, and each block read whole', () => {
    assert.deepEqual(bars.map(([f]) => f).sort(), ['goals.js', 'list.js', 'log.js', 'month.js', 'runs.js', 'today.js', 'week.js']);
    for (const [f, opts, src] of bars) {
      assert.equal(src.split('viewBar({').length - 1, 1, `${f} has more than one view bar`);
      assert.match(opts, /onChange:/, `${f}: the options block was not read whole`); // every bar redraws its page
    }
  });

  for (const [file, opts] of bars) {
    it(`${file}`, () => {
      if (/\bsearch: false\b/.test(opts)) { // Today and Goals: no search box at all, so no text to keep
        assert.ok(!/\btext: \(\) =>/.test(opts), `${file} has no search box but gives the bar a text`);
        return;
      }
      assert.match(opts, /\btext: \(\) =>/, `${file} draws a search box and never tells the bar what is in it (SUP-5289)`);
      assert.match(opts, /\bonText:/);
    });
  }
});
