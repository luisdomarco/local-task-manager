# Moving a Projects vault to short ids

This guide is for Claude, working with the owner of the vaults. It moves a **Projects** (`ticketing`) vault whose items
still have long ids (`ACME-INI-001`, `TSK-001`) to **short ids**: one number per item from a counter the whole vault
shares, drawn with its type's prefix (`INI-482`, README §5). The tool is `tools/migrate_short_ids.py`; the design is
[plans/short-ids.md](../plans/short-ids.md). Its tests (`tests/test_migrate_short_ids.py`) run it on a vault they build
with every kind of link.

**Two rules hold at every step:**

- **The source folder is never written.** The tool writes a **new** folder, and the old one stays as it was until the
  owner decides otherwise.
- **The owner decides about the texts.** The plan lists the item texts that name an old id in passing (`see
  ACME-SUP-001`); ask before `--apply --rewrite-bodies`.

## 1. When it applies

Read `config.json` (only read it, never edit it by hand) and list each vault with its `structure`:

- **`ticketing`** whose items have long ids: this guide applies, one vault at a time.
- **`ticketing`** with short ids already (`.task-manager/ids.json` has `"number"`): nothing to do. (Its plans and
  analyses from before they had ids, if any, keep working without one; this tool does not number them there.)
- **`folders` or `tasks`**: first [docs/migrate-structures.md](migrate-structures.md) (it writes a Projects vault with
  long ids), then this guide on the new vault.

A vault on long ids keeps working as it is: the app hands out long ids there until it is moved. Nothing forces the move.

## 2. Before anything

1. **Close the app**, or at least stop editing that vault, and close Obsidian on it. The plan records a hash of the
   whole source folder, and `--apply` refuses if anything changed after the plan.
2. **Take a backup** of the source folder: Settings → Export → the vault's zip, or a plain copy
   (`cp -R "<vault>" "<vault>.bak-<date>"`).
3. **Download every file.** In iCloud, a file not downloaded yet is a `.icloud` placeholder. Open the folder in Finder
   until there are none (right-click → *Download Now*). `--plan` refuses while there is one.
4. **The vault check is clean.** `--plan` runs the same check as the app and refuses on a blocking problem: fix what the
   app's notice says first.

## 3. Plan

```bash
python3 tools/migrate_short_ids.py --plan "<vault>"
python3 tools/migrate_short_ids.py --plan "<vault>" --out "<new folder>" --start 500
```

The new vault defaults to `<vault>-short-ids`, next to the source; the plan is JSON next to it
(`<new>.short-ids-plan.json`; `--plan-file` puts it elsewhere). The tool prints a summary:

| Key | What it is |
|---|---|
| `start`, `top` | The numbers handed out. `start` is one above the highest number any old id used — live items, the trash, the work log, converted inbox items and `ids.json` — so `TSK-12` is never read as an old `TSK-012`. `--start` may go higher, never lower. |
| `id_map`, `refs` | Old id → its number, and → how it is drawn (`ACME-STY-001` → `482` → `STY-482`). Oldest first (`creation_date`, then the old id). |
| `annexes` | Each plan and analysis from before they had ids (no `id`): its path, its type and the number it gets, in the same oldest-first order as the rest. |
| `renames` | Each file named after a long id → its new name (`ACME-STY-001 One page.md` → `STY-482 One page.md`), and each of `annexes` → its name by its new ref: a plan keeps its item's after it (`ACME-INI-001 Plan.md` → `PLN-490 INI-482 Plan.md`), an analysis its title (`2026-10-12 Revisión P1.md` → `ANL-491 Revisión P1.md`). |
| `linked` | Files with a wikilink to a renamed file: every one follows its new name. |
| `mentions` | Item texts that name an old id in passing, outside a wikilink and the template's heading. |
| `counts`, `dangling`, `source_digest` | What `--check` compares against. |

Show the owner the summary and the `mentions`, and ask whether to rewrite them (`--rewrite-bodies`) or leave them as
written (the old id still finds the item: search and the address bar take it).

## 4. What changes

| Before | After |
|---|---|
| `id: ACME-STY-001  # KEY-STY-NNN` | `id: 482  # its number, drawn STY-<n>` (only that line: key order, comments, unknown keys and the body stay byte for byte) |
| `aliases: []` / `aliases: [US-0001]` | `aliases: ["ACME-STY-001"]` / `aliases: ["US-0001", "ACME-STY-001"]`: Obsidian searches them, the app finds the item by them |
| `Acme Web/Stories/ACME-STY-001 One page.md` | `Acme Web/Stories/STY-482 One page.md` |
| `[[ACME-STY-001 One page]]`, `[[ACME-STY-001 One page\|alias]]` anywhere (items, Docs, notes) | `[[STY-482 One page]]`, `[[STY-482 One page\|alias]]` |
| the template's heading `# ACME-STY-001 — One page` | `# STY-482 — One page` |
| `see ACME-SUP-001` in a text | as written, or `see SUP-483` with `--rewrite-bodies` |
| a work log entry `"id": "ACME-STY-001"` | `"id": "482"`, its line drawn `· STY-482 One page` |
| a plan or an analysis with no `id` (from before they had ids) | `id: 490  # its number, drawn PLN-<n>` on a new line after `fileClass`, renamed by its ref (above); nothing else of it changes. An analysis's `title:` stays; its subject is now read from its file name, which has no `:` `/` `#` `[` `]` or `\|` |
| `.task-manager/history/ACME-STY-001.md` | `.task-manager/history/482.md` (a plan's or an analysis's with no id, named after its path: by its number too) |
| `.task-manager/pins.md`, `sidebar.md` | their ids through the id map |
| `.task-manager/ids.json` | gains `"number": <top>`; the old per-prefix marks stay |
| `.task-manager/legacy-ids.json` | the id map, merged with an older one (an `INI-0001` from `migrate_structures` now leads to the number too) |
| `.task-manager/trash/` | copied as it is: a trashed item keeps its long id, which still counts |
| `.task-manager/backup/` | not carried over (copies by old names) |
| `Attachments/ACME-SUP-001/` | as it is: each item's `attachments` paths still point there; new files go to `Attachments/SUP-483/` |

A project's note and anything else without a long id (or a plan or analysis to number) are copied as they are, but
for their wikilinks.

## 5. Apply

```bash
python3 tools/migrate_short_ids.py --apply "<new>.short-ids-plan.json"
python3 tools/migrate_short_ids.py --apply "<new>.short-ids-plan.json" --rewrite-bodies   # only if the owner says so
```

`--apply` refuses, and writes nothing, when the plan is from another version of the tool, the source changed since the
plan, the new folder exists and is not empty, `<new>.partial` is there (left by a run that stopped: delete it), or
the source has short ids already. It writes the new vault into `<new>.partial` and moves it into place only once
whole.

## 6. Check

```bash
python3 tools/migrate_short_ids.py --check "<new>.short-ids-plan.json"
```

It prints ✓ and exits 0 when the new vault matches the Projects structure on short ids, has as many items of each type
as the source, has no long id left on a live item and none above the mark, every relation resolves, every old id finds
its item, every plan and analysis numbered for the first time is found by its number, no wikilink leads nowhere that did not in the source, and the source is unchanged. Otherwise it prints each
problem with ✗ and exits 1. Do not go on until it passes.

## 7. Switch

1. In the app: Settings → Vaults → add the new folder with the structure **Projects**, and open it.
2. Spot-check it with the owner: a project page, an initiative with its stories, Today and Week, the work log of a
   recent day, a pinned item, and an old address (`#/item/ACME-STY-001`) that opens its item.
3. **Only after the owner's OK:** make the new vault the default and remove the old vault's entry. The old folder is
   kept; deleting it is the owner's call, later. A git repo or worktree named after an old id (`feat/acme-sty-001-…`)
   keeps its name; new ones take the short ref (`feat/sty-482-…`).

## 8. Troubleshooting

| What you see | What to do |
|---|---|
| `does not match the Projects structure` | The vault has a problem the app would show too. Fix what its notice says, then plan again. |
| `not downloaded from iCloud yet` | Download the folder in Finder (§2), then plan again. |
| `has short ids already` | Nothing to move. |
| `has no item with a long id` | A new vault: it numbers its items from the start. |
| `changed since the plan` | Something wrote to the source (the app, a sync, Obsidian). Plan again. |
| `--check`: `does not find …` | An item lost its old id from `aliases`. Look at the item in the new vault. |
| `--check`: `a wikilink to "…" leads nowhere` | A link the rename missed (an unusual form). Fix it in the new vault, then check again. |
