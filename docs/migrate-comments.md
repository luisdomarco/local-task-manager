# Moving a Projects vault's comments to files

This guide is for Claude, working with the owner of the vaults. It moves the comments of a **Projects** (`ticketing`)
vault out of their items' frontmatter (`comments: [...]`) into files of their own, `Comments/<ref>/<at>.md`, as the
app writes every new comment since TSK-128 (README → *Comments*). The tool is `tools/migrate_comments.py`; its tests
(`tests/test_migrate_comments.py`) run it on a vault they build.

**Two rules hold at every step:**

- **First on a copy.** `--copy` migrates a copy and `--compare` reads it back; the vault itself is migrated only after
  the copy compares clean.
- **The owner says when.** `--apply` on the vault is run only with the owner's OK, after they have seen the plan.

## 1. When it applies

- A **Projects** vault whose check warns *comments still in an item's file* (`comments_in_file`:
  `python3 tools/vault.py -C "<vault>" check`). Until it is moved those comments show in
  Activity, marked *in its file*, read only; new ones are files already.
- **Initiatives** and **Tasks** vaults keep their comments in the frontmatter: there is nothing to move. A vault moved
  to Projects by [migrate-structures](migrate-structures.md) brings them along in the frontmatter, and then this guide
  applies to the new vault.

## 2. Before anything

1. **Close the app** on that vault, and Obsidian (or leave it open but do not edit). `--apply` holds the vault's write
   lock; a write of the app's meanwhile would wait, then fail.
2. **Let iCloud finish.** Every file downloaded (no `.icloud` placeholders: `--plan` refuses while there is one) and
   nothing waiting to upload.
3. **Take a backup**: Settings → Export → the vault's zip, or `cp -R "<vault>" "<vault>.bak-<date>"`.

## 3. Plan

```bash
python3 tools/migrate_comments.py --plan "<vault>"
```

It writes nothing. It says how many comments, in how many items' files, become how many files in how many folders,
the first names of each item's (`TSK-482: 3 (2026-10-01T10-00-00-000, …)`), how many were kept apart from another of
the same moment, and a **digest**. How a comment's file is named:

- after its `at`, to the millisecond; a comment from before kept only the minute or the second, so its name ends in
  zeros (`2026-10-01T10-00-00-000.md`) and its `at` gains them (`2026-10-01T10:00:00.000`);
- two with the same moment (two in one minute, from before seconds) are one millisecond apart, in the list's order,
  so Activity keeps their order; so is one whose name a comment written as a file already has;
- a comment with no `at` takes its item's `created_at`; `by: owner` for all (comments from before had no author, and
  Activity showed them as *You*); `edited` is kept.

An item with `comments: []` only loses the key. Show the owner the summary.

## 4. On a copy, then compare

```bash
python3 tools/migrate_comments.py --copy "<vault>" --to "<scratch>/vault-copy"
python3 tools/migrate_comments.py --compare "<vault>" "<scratch>/vault-copy"
```

`--compare` reads each comment of the copy back through the app's Store and checks it against the vault's: the same
comments in the same order, each with its text, `edited` and author, and its moment within the second it had. Each
item's file must be byte for byte what it was but for its `comments:` line, and every other file as it was. Exit 0 and
*✓ … read back as they were*, or the differences, one per line. Delete the copy afterwards.

## 5. Apply

With the owner's OK, and the digest `--plan` gave:

```bash
python3 tools/migrate_comments.py --apply "<vault>" --digest <digest>
```

It refuses another digest: something changed since the plan (run `--plan` again and show the owner the new one). For
each item it writes its comments' files first, then removes its `comments:` key (only those lines change). A run that
stops (a full disk, a crash) leaves `.task-manager/migrate-comments.partial`; **the same command again goes on** from
where it stopped: a file already written with the same bytes counts as done, and nothing is written twice.

## 6. Check

```bash
python3 tools/migrate_comments.py --check "<vault>"
python3 tools/vault.py -C "<vault>" check
```

`--check` exits 0 when no item keeps comments in its file, and prints the vault check's comment warnings (a folder
whose ref no item has, a file in `Comments/` that is not a comment). Open the app: Activity shows the comments without
*in its file*, and they can be edited and deleted. Let iCloud upload the new files before opening the vault elsewhere.

## If something goes wrong

The backup of step 2 is the way back: the tool never deletes a comment, it moves it, and the item's other lines are as
they were. A vault half migrated works too: what moved shows as files, what did not as *in its file*.
