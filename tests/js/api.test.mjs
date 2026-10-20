import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Every request names the vault the page shows (vault.js picks it from the address, the last one, or the default).
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.location = { href: 'http://localhost:3100/?vault=b#/today', search: '?vault=b' };
globalThis.history = { replaceState: () => {} };
const sent = [];
globalThis.fetch = async (url, opts) => { sent.push({ url, headers: opts.headers, body: opts.body }); return { ok: true, json: async () => ({}) }; };

const { api, attachmentUrl } = await import('../../static/js/api.js');
const { pickVault, vaultId } = await import('../../static/js/vault.js');

describe('api', () => {
  it('names the page\'s vault in every request, GET and POST', async () => {
    pickVault({ vaults: [{ id: 'a' }, { id: 'b' }], default_vault: 'a' });
    assert.equal(vaultId(), 'b'); // the address wins over the default
    await api.items();
    await api.create('note', 'x', {}, '');
    assert.deepEqual(sent.map((r) => r.headers['X-TM-Vault']), ['b', 'b']);
    assert.equal(sent[1].headers['X-Task-Manager'], '1');
  });

  it('sends an attachment as its own bytes, its name in a header, and loads it by an address naming the vault', async () => {
    pickVault({ vaults: [{ id: 'a' }, { id: 'b' }], default_vault: 'a' });
    const file = { name: 'captura ñ.png', type: 'image/png', size: 3 };
    sent.length = 0;
    await api.addAttachment('TSK-001', file);
    assert.equal(sent[0].url, '/api/attachments/add?key=TSK-001');
    assert.equal(sent[0].body, file); // not JSON, not base64
    assert.deepEqual([sent[0].headers['Content-Type'], sent[0].headers['X-TM-Filename'], sent[0].headers['X-Task-Manager'], sent[0].headers['X-TM-Vault']],
      ['image/png', 'captura%20%C3%B1.png', '1', 'b']);
    assert.equal(attachmentUrl('Attachments/TSK-001/a b.png'), '/api/attachments/file?vault=b&path=Attachments%2FTSK-001%2Fa%20b.png');
  });

  it('falls back to the default when the address names a vault that is gone', () => {
    globalThis.location = { href: 'http://localhost:3100/?vault=gone', search: '?vault=gone' };
    store.clear();
    const lost = pickVault({ vaults: [{ id: 'a' }], default_vault: 'a' });
    assert.equal(vaultId(), 'a');
    assert.equal(lost, true); // the page was showing b: it must load again
  });
});
