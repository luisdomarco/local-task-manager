import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { groupLinks, linkIcon, shortUrl, fileKind } = await import('../../static/js/linkgroups.js');

describe('groupLinks', () => {
  it('puts the usual services first in their order, other labels A–Z, the unlabelled last', () => {
    const links = [{ url: 'a' }, { url: 'b', label: 'Slack' }, { url: 'c', label: 'zeta' }, { url: 'd', label: 'Redmine' },
      { url: 'e', label: 'Alpha' }, { url: 'f', label: 'Slack' }];
    const groups = groupLinks(links);
    assert.deepEqual(groups.map((g) => g.label), ['Redmine', 'Slack', 'Alpha', 'zeta', null]);
    assert.deepEqual(groups[1].items.map((x) => x.index), [1, 5]); // each keeps its place in the list
  });

  it('takes a blank label as none', () => {
    assert.deepEqual(groupLinks([{ url: 'a', label: '  ' }]).map((g) => g.label), [null]);
    assert.deepEqual(groupLinks([]), []);
  });
});

describe('linkIcon', () => {
  it('names a service\'s icon, a plain link otherwise', () => {
    assert.equal(linkIcon('G. Sheet'), 'table');
    assert.equal(linkIcon('Mine'), 'link');
    assert.equal(linkIcon(null), 'link');
  });
});

describe('shortUrl', () => {
  it('drops the protocol and a last slash', () => {
    assert.equal(shortUrl('https://redmine.example.com/issues/4521/'), 'redmine.example.com/issues/4521');
  });
  it('keeps the host and the last part of a long address', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit';
    assert.equal(shortUrl(url), 'docs.google.com/…/edit');
  });
  it('cuts at the end when there is no path to keep', () => {
    const s = shortUrl(`https://${'x'.repeat(80)}.com`, 20);
    assert.equal(s.length, 20);
    assert.ok(s.endsWith('…'));
  });
});

describe('fileKind', () => {
  it('knows images, PDFs, text, sheets, docs and archives', () => {
    assert.deepEqual(['a.PNG', 'b.pdf', 'c.md', 'd.xlsx', 'e.docx', 'f.zip', 'g.bin', 'noext'].map(fileKind),
      ['image', 'pdf', 'text', 'sheet', 'doc', 'archive', 'file', 'file']);
  });
});
