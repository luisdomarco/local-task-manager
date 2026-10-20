// The global search's logic (TSK-042), pure so node can test it: how well an item matches what was typed, the
// items found grouped by type in the sidebar's order, and the text search's lines turned into the items they are in.
// The palette (palette.js) draws it; ⌘K and the 🔍 button in the top bar both open it.

/** Lower case, accents off: «Configuración» finds «configuracion». */
export const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Every word of the query appears in the text. */
export function matches(q, text) {
  const t = norm(text);
  return norm(q).split(/\s+/).filter(Boolean).every((w) => t.includes(w));
}

/** How well an item answers the query, best first: 0 its id exactly, 1 its id starts with it, 2 its title starts with
 *  it, 3 every word starts a word of the title, 4 every word is somewhere in the id or title. null: not a match. */
export function rank(query, item) {
  const q = norm(query.trim());
  if (!q) return null;
  const id = norm(item.id);
  const title = norm(item.title);
  if (id && id === q) return 0;
  if (id && id.startsWith(q)) return 1;
  if (title.startsWith(q)) return 2;
  const words = q.split(/\s+/).filter(Boolean);
  const starts = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.every((w) => starts.some((s) => s.startsWith(w)))) return 3;
  return matches(q, `${item.id || ''} ${item.title}`) ? 4 : null;
}

/** The types in the sidebar's order: its nav groups top to bottom, each by its order; types with no link last. */
export function typeOrder(types) {
  const GROUPS = ['capture', 'types', 'tools'];
  const at = (t) => (t.nav ? GROUPS.indexOf(t.nav.group) : GROUPS.length);
  return [...types].sort((a, b) => at(a) - at(b) || (a.nav?.order ?? 0) - (b.nav?.order ?? 0)).map((t) => t.name);
}

/** The items that match, by type in `order`: [{type, items, total}], each group best first, closed ones last, then the
 *  most recently updated; `per` items shown of each (all of them for a type in `expanded`). */
export function groupByType(query, items, { order = [], isClosed = () => false, per = 5, expanded = new Set() } = {}) {
  const found = new Map();
  for (const it of items) {
    const r = rank(query, it);
    if (r === null) continue;
    if (!found.has(it.type)) found.set(it.type, []);
    found.get(it.type).push({ it, r, closed: isClosed(it) ? 1 : 0 });
  }
  const pos = (t) => (order.includes(t) ? order.indexOf(t) : order.length);
  return [...found.entries()].sort(([a], [b]) => pos(a) - pos(b) || a.localeCompare(b)).map(([type, rows]) => {
    rows.sort((a, b) => a.closed - b.closed || a.r - b.r
      || String(b.it.fields?.updated_at || '').localeCompare(String(a.it.fields?.updated_at || '')));
    return { type, items: rows.slice(0, expanded.has(type) ? rows.length : per).map((x) => x.it), total: rows.length };
  });
}

/** The text search's lines (GET /api/files/search, for `query`) that are in an item's file → [{item, line, text}], one
 *  per item, in the order found, leaving out the items already shown (`shown`: their keys) and those not in `items`
 *  (the archived ones). A `key: value` line counts only by its value — not by its key («re» is in every `related_to:`), nor by the
 *  `# comment` a template leaves after it. */
export function bodyHits(query, results, items, shown = new Set()) {
  const q = norm(query.trim());
  const byPath = new Map(items.map((i) => [i.path, i]));
  const out = [];
  const seen = new Set(shown);
  for (const r of results || []) {
    const it = byPath.get(r.path);
    if (!it || seen.has(it.key)) continue;
    const field = String(r.text || '').match(/^\s*[A-Za-z_][\w-]*:\s*(.*)$/);
    if (field && !norm(field[1].replace(/\s#.*$/, '')).includes(q)) continue; // its value, not the template's # comment
    seen.add(it.key);
    out.push({ item: it, line: r.line, text: r.text });
  }
  return out;
}
