import assert from 'node:assert/strict';
import { it } from 'node:test';
import { siteName } from '../../static/js/sitename.js';

it('a known site goes by its usual name, a subdomain or a short address of it too', () => {
  assert.equal(siteName('https://x.com/someone/status/1857?s=46&t=AbC'), 'X');
  assert.equal(siteName('https://mobile.twitter.com/someone'), 'X');
  assert.equal(siteName('https://youtu.be/abc'), 'YouTube');
  assert.equal(siteName('https://www.youtube.com/watch?v=abc'), 'YouTube');
  assert.equal(siteName('https://es.wikipedia.org/wiki/Gato'), 'Wikipedia');
  assert.equal(siteName('https://news.ycombinator.com/item?id=1'), 'Hacker News');
});

it('any other site is the main part of its address, as written', () => {
  assert.equal(siteName('https://pepita.com/ofertas'), 'pepita');
  assert.equal(siteName('https://www.pepita.com'), 'pepita');
  assert.equal(siteName('http://blog.pepita.es/a'), 'pepita');
  assert.equal(siteName('https://www.bbc.co.uk/news'), 'bbc');
  assert.equal(siteName('https://shop.abc.com.au/'), 'abc');
  assert.equal(siteName('https://WWW.Pepita.COM.'), 'pepita');
});

it('a machine is its address, and what is no link is nothing', () => {
  assert.equal(siteName('http://localhost:3100/x'), 'localhost');
  assert.equal(siteName('http://192.168.1.4/x'), '192.168.1.4');
  assert.equal(siteName('http://[::1]:3100/'), '[::1]');
  assert.equal(siteName('not a link'), '');
  assert.equal(siteName(''), '');
  assert.equal(siteName(undefined), '');
});
