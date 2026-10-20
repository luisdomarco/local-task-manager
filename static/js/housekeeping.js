// What the page says about the vault's leftovers, kept apart from the views so it can be tested: the trash (deleted
// items, and the files taken off an item that wait in .task-manager/trash/attachments/) and the vault check's
// warnings (shown, never blocking: tm/structures/check.py, Store.unlisted_attachments).

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The trash view's header line, its Empty trash button and its confirm text. `items`: the deleted items in the
 *  trash; `files`: the files taken off an item waiting there; `deleted`: the files and folders the Explorer deleted.
 *  The button stays while any is there. → { canEmpty, note, confirm } (note: '' when no file taken off an item waits). */
export function trashSummary(items, files, deleted = 0) {
  const parts = [items && count(items, 'item', 'items'), files && count(files, 'file taken off an item', 'files taken off items'),
    deleted && count(deleted, 'deleted file or folder', 'deleted files and folders')].filter(Boolean);
  const what = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join('');
  const total = items + files + deleted;
  return {
    canEmpty: total > 0,
    note: files ? `${count(files, 'file taken off an item waits', 'files taken off items wait')} here too. Emptying the trash deletes ${files === 1 ? 'it' : 'them'}.` : '',
    confirm: `Delete ${total === 1 ? '' : 'all '}${what} in the trash for good? It cannot be undone.`,
  };
}

// The warning kinds the checks give, in the order they are shown; a kind not named here goes last, by its name.
const WARNING_KINDS = [
  ['unlisted_attachment', 'Files no item lists'],
  ['outside_folder', 'Items outside their folder'],
  ['untyped', 'Files without a type'],
  ['not_markdown', 'Files that are not Markdown'],
  ['loose_file', 'Loose files'],
];

/** The vault check's warnings, grouped by kind: [{ kind, label, findings }], the known kinds first. */
export function warningGroups(warnings) {
  const groups = new Map();
  for (const w of warnings || []) {
    if (!groups.has(w.kind)) groups.set(w.kind, []);
    groups.get(w.kind).push(w);
  }
  const rank = (kind) => { const r = WARNING_KINDS.findIndex(([k]) => k === kind); return r < 0 ? WARNING_KINDS.length : r; };
  return [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([kind, findings]) => ({ kind, label: (WARNING_KINDS.find(([k]) => k === kind) || [])[1] || kind, findings }));
}
