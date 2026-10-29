import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HIGHLIGHTS, TEXT_COLOURS, colourRange } from '../../static/js/mdcolour.js';

const pick = (r) => r.value.slice(r.start, r.end);

describe('text colour and highlight in Markdown (mdcolour.js)', () => {
  const v = 'Say hello world.';
  const s = v.indexOf('hello'); const e = s + 'hello'.length;

  it('wraps the selection and keeps it selected', () => {
    const r = colourRange(v, s, e, 'text', '#d93025');
    assert.equal(r.value, 'Say <span style="color: #d93025">hello</span> world.');
    assert.equal(pick(r), 'hello');
    const m = colourRange(v, s, e, 'highlight', '#fff3a3a6');
    assert.equal(m.value, 'Say <mark style="background: #fff3a3a6">hello</mark> world.');
  });

  it('recolours instead of nesting, whether the tags are selected or just outside', () => {
    const r = colourRange(v, s, e, 'text', '#d93025');
    const again = colourRange(r.value, r.start, r.end, 'text', '#1a73e8');
    assert.equal(again.value, 'Say <span style="color: #1a73e8">hello</span> world.');
    const whole = colourRange(r.value, 4, r.value.indexOf(' world'), 'text', '#188038');
    assert.equal(whole.value, 'Say <span style="color: #188038">hello</span> world.');
    assert.equal(pick(whole), 'hello');
  });

  it('reads the Highlightr form, with its semicolon and no space', () => {
    const h = 'a <mark style="background:#FFB8EBA6;">b</mark> c';
    const r = colourRange(h, h.indexOf('b<'), h.indexOf('b<') + 1, 'highlight', '#bbfabba6');
    assert.equal(r.value, 'a <mark style="background: #bbfabba6">b</mark> c');
  });

  it('takes a colour off, and leaves plain text alone', () => {
    const r = colourRange(v, s, e, 'highlight', '#fff3a3a6');
    const off = colourRange(r.value, r.start, r.end, 'highlight', null);
    assert.deepEqual(off, { value: v, start: s, end: e });
    assert.deepEqual(colourRange(v, s, e, 'text', null), { value: v, start: s, end: e });
  });

  it('keeps text colour and highlight apart, so both can apply', () => {
    const r = colourRange(v, s, e, 'text', '#d93025');
    const both = colourRange(r.value, r.start, r.end, 'highlight', '#adccffa6');
    assert.equal(both.value, 'Say <span style="color: #d93025"><mark style="background: #adccffa6">hello</mark></span> world.');
  });

  it('wraps a placeholder with nothing selected, and refuses what is not a colour', () => {
    const r = colourRange('ab', 1, 1, 'text', '#80868b');
    assert.equal(r.value, 'a<span style="color: #80868b">text</span>b');
    assert.equal(pick(r), 'text');
    assert.throws(() => colourRange(v, s, e, 'text', 'red;" onclick="x'));
  });

  it('offers colours that are all #hex', () => {
    for (const [, c] of [...TEXT_COLOURS, ...HIGHLIGHTS]) assert.match(c, /^#[0-9a-f]{6}([0-9a-f]{2})?$/);
  });
});
