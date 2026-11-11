import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { has, offList, setFeatures } from '../../static/js/features.js';

// What this platform has (server.py features()): the page hides what a phone has none of.
describe('features', () => {
  it('has everything until a config says otherwise, and with a server from before features', () => {
    setFeatures(null);
    assert.equal(has('terminal'), true);
    assert.equal(offList(), '');
    setFeatures({ vaults: [] });
    assert.equal(has('agents'), true);
    assert.equal(has('anything'), true);
  });

  it('lists what a phone turns off, sorted, for <html data-off>', () => {
    const off = setFeatures({ features: { terminal: false, agents: false, canvas: false, export: true } });
    assert.equal(off, 'agents canvas terminal');
    assert.equal(has('terminal'), false);
    assert.equal(has('export'), true);
    assert.equal(has('reveal'), true); // one it does not name stays on
  });

  it('takes each config afresh', () => {
    setFeatures({ features: { terminal: false } });
    setFeatures({ features: { terminal: true } });
    assert.equal(has('terminal'), true);
    assert.equal(offList(), '');
  });
});
