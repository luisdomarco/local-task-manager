import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { PHONE_TOUCH, SWIPE_CLOSE, TOUCH, isPhone, isTouch, swipeCloses } from '../../static/js/phone.js';

// The phone layer (css/phone.css, docs/design.md §2 *The phone layer*): what keeps a computer from ever seeing one of
// its rules, and the page's layer order that lets it win over Classic and the themes.
const read = (p) => readFileSync(new URL(`../../static/${p}`, import.meta.url), 'utf8');
const css = read('css/phone.css').replace(/\/\*[\s\S]*?\*\//g, ''); // without its comments

/** The top-level blocks of a stylesheet: [{ prelude, body }] (a block's braces matched, nested ones skipped). */
function blocks(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) { assert.equal(text.slice(i).trim(), '', 'nothing after the last block'); break; }
    let depth = 1; let j = open + 1;
    while (depth && j < text.length) { if (text[j] === '{') depth += 1; else if (text[j] === '}') depth -= 1; j += 1; }
    out.push({ prelude: text.slice(i, open).trim(), body: text.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

describe('phone.css', () => {
  const top = blocks(css);

  it('is only its two media blocks: a phone, and any touch screen', () => {
    assert.ok(top.length >= 2);
    for (const b of top) assert.ok([`@media ${PHONE_TOUCH}`, `@media ${TOUCH}`].includes(b.prelude), `a rule outside the two blocks: ${b.prelude}`);
  });

  it('never names a theme and never needs !important (its layer wins)', () => {
    assert.ok(!css.includes('[data-skin'), 'a [data-skin] selector');
    assert.ok(!css.includes('!important'), 'an !important');
  });

  it('gives a field 16px or more on a touch screen (under it iOS zooms in)', () => {
    const m = css.match(/--fs-field:\s*(\d+(?:\.\d+)?)px/);
    assert.ok(m && Number(m[1]) >= 16, `--fs-field is ${m?.[1]}`);
  });

  it('raises the targets to 44px on a phone', () => {
    const phone = top.find((b) => b.prelude === `@media ${PHONE_TOUCH}`).body;
    assert.match(phone, /--tap:\s*44px/);
    assert.match(phone, /--control-h:\s*44px/);
  });
});

describe('the layers', () => {
  const layers = (text) => text.match(/@layer\s+([^;{]+);/)?.[1].split(',').map((s) => s.trim());

  it('are the same in main.css and modern.css (the first sheet to name them fixes the order), phone last', () => {
    const main = layers(read('css/main.css'));
    assert.deepEqual(layers(read('css/themes/modern.css')), main);
    assert.equal(main.at(-1), 'phone');
  });

  it('main.css loads phone.css in its layer', () => {
    assert.match(read('css/main.css'), /@import url\("phone\.css"\) layer\(phone\);/);
  });
});

describe('the viewport', () => {
  const meta = read('index.html').match(/<meta name="viewport" content="([^"]+)"/)[1];
  it('reaches under the notch and the home indicator (the safe areas are padded in phone.css)', () => {
    assert.match(meta, /viewport-fit=cover/);
  });
  it('lets the page be pinched: the fields are 16px, so nothing needs maximum-scale to stop a zoom', () => {
    assert.doesNotMatch(meta, /maximum-scale|user-scalable/);
  });
});

describe('phone.js', () => {
  it('is no phone and no touch screen where there is no matchMedia (node)', () => {
    assert.equal(isPhone(), false);
    assert.equal(isTouch(), false);
  });
});

describe('swipeCloses', () => {
  it('closes on a slow pull far enough down', () => {
    assert.equal(swipeCloses(0, SWIPE_CLOSE.distance, 2000), true);
    assert.equal(swipeCloses(10, SWIPE_CLOSE.distance - 1, 2000), false);
  });
  it('closes on a short, fast flick, not on a short, slow one', () => {
    assert.equal(swipeCloses(0, 60, 50), true);
    assert.equal(swipeCloses(0, 60, 400), false);
    assert.equal(swipeCloses(0, SWIPE_CLOSE.flick - 1, 1), false);
  });
  it('never closes going up or more sideways than down', () => {
    assert.equal(swipeCloses(0, -200, 100), false);
    assert.equal(swipeCloses(150, 120, 100), false);
    assert.equal(swipeCloses(0, 0, 0), false);
  });
});
