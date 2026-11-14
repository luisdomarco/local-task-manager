import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bumpVersion, nextBase, versionText } from '../../static/js/versionmodel.js';

describe('bumpVersion (tm/versions.py bump)', () => {
  it('a minor one', () => { assert.equal(bumpVersion('1.2'), '1.3'); assert.equal(bumpVersion('1.9'), '1.10'); });
  it('a major one', () => assert.equal(bumpVersion('1.2', true), '2.0'));
  it('anything else starts at 1.0', () => { for (const v of [null, '', 'v2', '1', '1.2.3']) assert.equal(bumpVersion(v), '1.0'); });
});

describe('nextBase and versionText', () => {
  it('the last version kept wins over the field', () => {
    assert.equal(nextBase({ version: '1.1', versions: [{ version: '1.4' }, { version: '1.3' }] }), '1.4');
    assert.equal(nextBase({ version: '1.1', versions: [] }), '1.1');
    assert.equal(nextBase(null), null);
  });
  it('names an edit after the last version', () => {
    assert.equal(versionText({ version: '1.2', edited: false }), 'v1.2');
    assert.equal(versionText({ version: '1.2', edited: true }), 'v1.2 · edited');
    assert.equal(versionText({ version: null }), null);
  });
});
