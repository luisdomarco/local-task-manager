// What a link is called when nothing else names it: the subject of an item added from a link alone (Inbox → a share
// with no title, or a pasted address), for you to write over. Pure, tested in tests/js/sitename.test.mjs.

// Sites better known by another name than their address's, by their address (a subdomain of one is the same site).
const NAMES = {
  'x.com': 'X', 'twitter.com': 'X', 't.co': 'X',
  'youtube.com': 'YouTube', 'youtu.be': 'YouTube',
  'github.com': 'GitHub', 'linkedin.com': 'LinkedIn', 'lnkd.in': 'LinkedIn',
  'instagram.com': 'Instagram', 'facebook.com': 'Facebook', 'fb.watch': 'Facebook',
  'reddit.com': 'Reddit', 'tiktok.com': 'TikTok', 'threads.net': 'Threads', 'bsky.app': 'Bluesky',
  'news.ycombinator.com': 'Hacker News', 'wikipedia.org': 'Wikipedia', 'medium.com': 'Medium',
};

// The second level of a two-part country ending (bbc.co.uk, abc.com.au): the name is the part before it.
const SECOND = new Set(['co', 'com', 'org', 'net', 'gov', 'gob', 'ac', 'edu']);

/** The site a link is on, as a name: 'X' for x.com, 'pepita' for www.pepita.com or blog.pepita.co.uk, the address
 *  itself for a machine (localhost, an IP); '' when it is no link. */
export function siteName(url) {
  let host;
  try { host = new URL(String(url || '').trim()).hostname.toLowerCase(); } catch { return ''; }
  host = host.replace(/\.$/, '').replace(/^www\d*\./, '');
  if (!host) return '';
  const parts = host.split('.');
  for (let i = 0; i < parts.length; i++) {
    const known = NAMES[parts.slice(i).join('.')];
    if (known) return known;
  }
  if (parts.length < 2 || host.includes(':') || /^[\d.]+$/.test(host)) return host;
  const n = parts.length;
  const country = n >= 3 && parts[n - 1].length === 2 && SECOND.has(parts[n - 2]);
  return parts[n - (country ? 3 : 2)];
}
