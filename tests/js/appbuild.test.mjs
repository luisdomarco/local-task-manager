// Settings → Documentation's head: the version and the commit this copy runs (server.py app_build).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { versionLine } from '../../static/js/appbuild.js';

const SHA = 'c698a38cc647f4f42c866e2ce623b7ff27fc15ac';

test('the version and the engine, short, with its day', () => {
  assert.equal(versionLine('1.5.0', { commit: SHA, built_at: '2026-11-27T22:30:00' }), 'Version 1.5.0 · engine c698a38 · 2026-11-27');
});

test('what it cannot say, it leaves out', () => {
  assert.equal(versionLine('1.5.0', null), 'Version 1.5.0');
  assert.equal(versionLine(null, { commit: SHA }), 'engine c698a38');
  assert.equal(versionLine(null, null), '');
});
