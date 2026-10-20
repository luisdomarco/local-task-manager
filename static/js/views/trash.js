// Trash: what was deleted, kept in <root>/.task-manager/trash/ as plain files. Restore puts an item back where it
// was (and relinks what the delete detached); deleting from here is for good, so it asks first, in the row.
// The files taken off an item wait in trash/attachments/: only their count shows, and Empty trash deletes them too.
// What the sidebar's Explorer deleted (files and folders that are no item) waits in trash/files/: a section of its own.
import { relDay } from '../dates.js';
import { LIST_PAGE, fixedColumns, paged } from '../datatable.js';
import { trashSummary } from '../housekeeping.js';
import { emptyTrash, purgeFile, purgeFromTrash, restoreFile, restoreFromTrash, state } from '../state.js';
import { saveSort, savedSort } from '../prefs.js';
import { emptyState, h, icon, typeIcon } from '../ui.js';

// Keys of the shared column widths (datatable.js fixedColumns).
const FIXED = fixedColumns(['id', 'subject', 'type', 'deleted_at', 'path', 'unlinked', 'actions'].map((key) => ({ key })));
const COLS = 7;
const sort = savedSort('trash', { col: 'deleted_at', dir: -1 });
let search = '';

/** "Today 11:17": the day relative to today, then the time. */
const when = (stamp) => (stamp ? `${relDay(stamp.slice(0, 10))} ${stamp.slice(11, 16)}` : '—');

export function mount(root) {
  let confirm = null; // a trashed path, or 'all': what is waiting for "yes, for good"

  const filter = h('input', { type: 'search', placeholder: 'Filter the trash…', 'aria-label': 'Filter the trash', 'data-filter': '' });
  filter.addEventListener('input', () => { search = filter.value.trim().toLowerCase(); api.update(); });
  const emptyBtn = h('button', { class: 'btn danger', onclick: () => { confirm = 'all'; api.update(); } }, icon('trash', 15), 'Empty trash');
  const banner = h('div', { class: 'trash-confirm' });
  const note = h('p', { class: 'muted small trash-files', 'data-trash-files': '' });
  const table = h('div', { class: 'tag-table' });
  const filesBox = h('section', { class: 'trash-files-section' });
  root.replaceChildren(
    h('header', { class: 'view-head row' }, h('h1', {}, 'Trash'), h('div', { class: 'filters' }, filter, emptyBtn)),
    banner, note, table, filesBox);

  const th = (col, label) => h('th', { scope: 'col', class: sort.col === col ? 'sorted' : '', 'aria-sort': sort.col === col ? (sort.dir > 0 ? 'ascending' : 'descending') : null },
    h('button', { class: 'th-btn', onclick: () => { sort.dir = sort.col === col ? -sort.dir : (col === 'deleted_at' ? -1 : 1); sort.col = col; saveSort('trash', sort); api.update(); } },
      label, sort.col === col ? icon(sort.dir > 0 ? 'up' : 'down', 13) : null));

  const row = (e) => {
    if (confirm === e.trashed) {
      return h('tr', { class: 'tag-edit' }, h('td', { colspan: COLS }, h('div', { class: 'tag-edit-row' },
        h('span', { class: 'small' }, `Delete ${e.id || e.title} for good? It cannot be undone.`),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn small ghost', onclick: () => { confirm = null; api.update(); } }, 'Cancel'),
        h('button', { class: 'btn small danger', onclick: async () => { confirm = null; try { await purgeFromTrash(e.trashed); } catch { /* toasted */ } } }, icon('trash', 13), 'Delete forever'))));
    }
    return h('tr', { class: 'trash-row' },
      h('td', {}, h('span', { class: 'mono' }, e.id || '—')),
      h('td', { class: 'c-subject' }, e.title),
      h('td', {}, h('span', { class: `chip t-${e.type}` }, typeIcon(e.type, 12), e.type || '—')),
      h('td', { title: e.deleted_at }, when(e.deleted_at)),
      h('td', { class: 'muted trash-path', title: e.original_path }, e.original_path),
      h('td', { class: 'num', title: 'Related items that were detached, and come back with a restore' }, e.unlinked || h('span', { class: 'muted' }, '0')),
      h('td', { class: 'c-actions' },
        h('button', { class: 'btn small', onclick: async () => { try { await restoreFromTrash(e.trashed); } catch { /* toasted */ } } }, icon('back', 13), 'Restore'),
        h('button', { class: 'btn icon', title: `Delete ${e.id || e.title} for good`, 'aria-label': `Delete ${e.title} for good`, onclick: () => { confirm = e.trashed; api.update(); } }, icon('trash', 15))));
  };

  // Files and folders deleted from the Explorer: where they were, when; Restore puts one back there.
  const fileRow = (f) => {
    if (confirm === f.trashed) {
      return h('tr', { class: 'tag-edit' }, h('td', { colspan: 3 }, h('div', { class: 'tag-edit-row' },
        h('span', { class: 'small' }, `Delete ${f.path} for good? It cannot be undone.`),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn small ghost', onclick: () => { confirm = null; api.update(); } }, 'Cancel'),
        h('button', { class: 'btn small danger', onclick: async () => { confirm = null; try { await purgeFile(f.trashed); } catch { /* toasted */ } } }, icon('trash', 13), 'Delete forever'))));
    }
    return h('tr', { class: 'trash-row' },
      h('td', { class: 'trash-file' }, icon(f.kind === 'dir' ? 'folder' : 'file', 15), h('span', { class: 'mono', title: f.path }, f.path)),
      h('td', { title: f.deleted_at }, when(f.deleted_at)),
      h('td', { class: 'c-actions' },
        h('button', { class: 'btn small', onclick: async () => { try { await restoreFile(f.trashed); } catch { /* toasted */ } } }, icon('back', 13), 'Restore'),
        h('button', { class: 'btn icon', title: `Delete ${f.path} for good`, 'aria-label': `Delete ${f.path} for good`, onclick: () => { confirm = f.trashed; api.update(); } }, icon('trash', 15))));
  };
  const filesSection = () => {
    const files = state.trashedFiles.filter((f) => !search || f.path.toLowerCase().includes(search));
    if (!state.trashedFiles.length) return [];
    return [h('h2', { class: 'trash-files-title' }, 'Deleted files and folders', h('span', { class: 'count' }, String(state.trashedFiles.length))),
      h('p', { class: 'muted small' }, 'Deleted from the sidebar\'s Explorer. They are no items: restoring one puts it back where it was.'),
      files.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid tag-grid trash-grid', 'aria-label': 'Deleted files and folders' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Was in'), h('th', { scope: 'col' }, 'Deleted'), h('th', { scope: 'col', class: 'c-actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
          h('tbody', {}, files.map(fileRow))))
        : emptyState('Nothing deleted matches.')];
  };

  const api = {
    update() {
      const all = state.trash;
      const summary = trashSummary(all.length, state.trashFiles, state.trashedFiles.length);
      emptyBtn.hidden = !summary.canEmpty;
      if (!summary.canEmpty && confirm === 'all') confirm = null;
      note.textContent = summary.note;
      note.hidden = !summary.note;
      banner.replaceChildren(...(confirm === 'all' ? [h('div', { class: 'tag-edit-row' },
        h('span', { class: 'small' }, summary.confirm),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn small ghost', onclick: () => { confirm = null; api.update(); } }, 'Cancel'),
        h('button', { class: 'btn small danger', onclick: async () => { confirm = null; try { await emptyTrash(); } catch { /* toasted */ } } }, icon('trash', 13), 'Empty trash'))] : []));
      const key = { id: (e) => e.id || '', title: (e) => e.title.toLowerCase(), type: (e) => e.type || '', deleted_at: (e) => e.deleted_at, original_path: (e) => e.original_path, unlinked: (e) => e.unlinked }[sort.col];
      const matching = all.filter((e) => !search || `${e.id} ${e.title} ${e.type} ${e.original_path}`.toLowerCase().includes(search))
        .sort((a, b) => { const x = key(a); const y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
      const page = paged({ key: 'trash', rows: matching, size: LIST_PAGE, onChange: () => api.update() });
      const { rows } = page;
      table.replaceChildren(...[all.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid fixed tag-grid trash-grid', style: FIXED.style, 'aria-label': 'Trash' }, FIXED.colgroup.cloneNode(true),
          h('thead', {}, h('tr', {}, th('id', 'ID'), th('title', 'Subject'), th('type', 'Type'), th('deleted_at', 'Deleted'), th('original_path', 'Was in'), th('unlinked', 'Unlinked'),
            h('th', { scope: 'col', class: 'c-actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
          h('tbody', {}, rows.length ? rows.map(row) : h('tr', {}, h('td', { colspan: COLS, class: 'empty' }, 'Nothing in the trash matches.')))))
        : emptyState(state.trashFiles || state.trashedFiles.length ? 'No deleted items in the trash.' : 'The trash is empty. What you delete waits here until you restore it or empty the trash.'), page.pager].filter(Boolean));
      filesBox.replaceChildren(...filesSection());
    },
  };
  return api;
}
