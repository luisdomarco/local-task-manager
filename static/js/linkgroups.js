// How an item's Links and Files tabs sort and name what they list (panel.js links, attachments.js): pure, no page.

/** The usual services a link is labelled with (itemform.js linkLabelControl offers them, then "Other"). */
export const LINK_LABELS = ['Redmine', 'G. Drive', 'G. Sheet', 'G. Doc', 'Slack', 'Gmail'];

/**
 * The links in groups by their label: the usual services in LINK_LABELS order, then any other label A–Z, then those
 * with none (label null). `links` are { url, label? }; each group keeps every link's place in that list (`index`), so
 * an action on a row acts on the right one.
 */
export function groupLinks(links) {
  const groups = new Map();
  links.forEach((link, index) => {
    const label = (link.label || '').trim() || null;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push({ link, index });
  });
  const rank = (label) => (label === null ? [2, ''] : LINK_LABELS.includes(label) ? [0, LINK_LABELS.indexOf(label)] : [1, label.toLowerCase()]);
  const cmp = (a, b) => {
    const [ra, ka] = rank(a);
    const [rb, kb] = rank(b);
    return ra - rb || (ka < kb ? -1 : ka > kb ? 1 : 0);
  };
  return [...groups.keys()].sort(cmp).map((label) => ({ label, items: groups.get(label) }));
}

const LABEL_ICONS = { Redmine: 'task', 'G. Drive': 'folder', 'G. Sheet': 'table', 'G. Doc': 'note', Slack: 'message', Gmail: 'mail' };

/** The icon of a link (ui.js ICONS): its service's, or a plain link. */
export const linkIcon = (label) => LABEL_ICONS[label] || 'link';

/**
 * A link's address as a row shows it: without the protocol nor a last "/", and when long, its host, "…" and its last
 * part, so both ends are seen (the whole address is the row's tooltip).
 */
export function shortUrl(url, max = 56) {
  const bare = String(url).replace(/^https?:\/\//i, '').replace(/\/$/, '');
  if (bare.length <= max) return bare;
  const slash = bare.indexOf('/');
  const host = slash < 0 ? bare : bare.slice(0, slash);
  const last = bare.slice(bare.lastIndexOf('/') + 1);
  if (slash < 0 || !last || host.length + last.length + 3 > max) return `${bare.slice(0, max - 1)}…`;
  return `${host}/…/${last}`;
}

/** What kind of file a path is, for its icon and how it opens: 'image' | 'pdf' | 'text' | 'sheet' | 'doc' | 'archive' | 'file'. */
export function fileKind(path) {
  const ext = (String(path).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (/^(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/.test(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (/^(txt|log|md|json|ya?ml)$/.test(ext)) return 'text';
  if (/^(csv|tsv|xlsx?|ods|numbers)$/.test(ext)) return 'sheet';
  if (/^(docx?|odt|pages|rtf|pptx?|key|odp)$/.test(ext)) return 'doc';
  if (/^(zip|gz|tgz|tar|rar|7z)$/.test(ext)) return 'archive';
  return 'file';
}
