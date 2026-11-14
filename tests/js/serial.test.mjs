// INB-012b: reloads never overlap, and none answers older than its call (static/js/serial.js, state.js reload).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serial } from '../../static/js/serial.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

test('a call while a run is going runs once more after it, the calls in between sharing it', async () => {
  let runs = 0;
  let live = 0;
  let most = 0;
  const load = serial(async () => {
    runs += 1; live += 1; most = Math.max(most, live);
    const n = runs;
    await tick();
    live -= 1;
    return n;
  });
  const first = load();
  const second = load();
  const third = load();
  assert.equal(second, third, 'one queued run for both');
  assert.deepEqual(await Promise.all([first, second, third]), [1, 2, 2]);
  assert.equal(runs, 2);
  assert.equal(most, 1, 'never two at once');
  assert.equal(await load(), 3, 'once idle, a call runs at once');
});

test('a run that fails does not stop the next one', async () => {
  let n = 0;
  const load = serial(async () => { n += 1; await tick(); if (n === 1) throw new Error('down'); return n; });
  const first = load();
  const second = load();
  await assert.rejects(first, /down/);
  assert.equal(await second, 2);
});
