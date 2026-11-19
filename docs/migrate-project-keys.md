# Bringing a vault's project notes to today's shape

This guide is for Claude, working with the owner of the vault. It brings the **project notes** of a **Projects**
(`ticketing`) vault to the shape a project created today has. The tool is `tools/migrate_project_keys.py`; its tests
are in `tests/test_project_template.py`.

**Two rules hold at every step:**

- **Nothing is written that was not shown.** `--plan` prints the unified diff of every file and a digest; `--apply`
  refuses any other digest.
- **The owner says when.** `--apply` is run only with the owner's OK, after they have read the plan.

## 1. Why a vault needs it

A project's frontmatter is written from `tm/structures/ticketing/templates/Ticket Project.md` with its `{{…}}` filled
in. That template changed four times while the notes already on disk were never revisited, so a vault holds projects
of as many shapes as it had template versions:

| When the project was created | It has | It lacks |
|---|---|---|
| before 2026-10-20 | `{{living_specs}}` unsubstituted in its body, `![[.base#Open]]` (an empty name) | — |
| before 2026-11-07 | — | `area`, `objective` |
| before 2026-11-14 | `project_kind`, `enabled_types` | — |
| any, until this fix | `living_specs`, `areas`, `related_initiatives` | — |

The two defects in the body come from two commits: `{{project}}` resolved to the empty string for a project until
`daa9fdd` (2026-10-20), and the body stopped using `{{living_specs}}` in `dbe8973` the same day — `fill` leaves a
placeholder it does not know exactly as it is.

## 2. What it changes, and what it does not

Changed, in a project note only:

- **`enabled_types`, `areas`, `living_specs` and `related_initiatives` go.** No code reads any of them on a project:
  what a project holds follows from its initiatives' kinds (`tm/structures/kinds.py`), the closed list of areas was
  never implemented, the specs are the Spec items in the project's `Specs/` folder, and a link to another note is a
  relation now. Check before telling the owner nothing is lost: `grep -rn '<key>' --include='*.py' tm tools`, the
  vault's `.base` files (an Obsidian base can filter on a property), and whether any note has a value at all.
  `premise_max_age_days` is **not** in this list — `rules._check_premise` reads it, so it is declared and stays.
- **`area` and `objective` are added, empty,** where the note has none. Both are fields of the app since 2026-11-07,
  shown in the note's own *Area and objective* section. They are appended after the note's last key, not inserted at
  the template's position: `fm.patch` keeps every other byte, and the key order carries no meaning.
- **A `## Board` section whose only content is `![[….base#Open]]` goes.** No `.base` of a project has ever existed in
  any vault: the app reads bases, it never writes one (`tm/bases.py`), so that embed has always been dead. A `## Board`
  section with anything else in it is **left alone and reported** (`!` in the plan).
- **A body line still holding `{{living_specs}}`** takes the value that note's own `living_specs` had, so the path is
  kept as text before the key goes.

Not changed: every other key, its order and its `#` comment; `project_kind` (a project from before kinds moved to
initiatives says one, and its initiatives that say none read it); the rest of the body; every file that is not a
project note. Nothing is created, renamed or deleted.

## 3. Before anything

1. **Close the app** on that vault, and Obsidian (or leave it open but do not edit). `--apply` holds the vault's
   write lock; a write of the app's meanwhile would wait, then fail.
2. **Let iCloud finish**: every file downloaded, nothing waiting to upload.
3. **Take a backup**: Settings → Export → the vault's zip, or `cp -R "<vault>" "<vault>.bak-<date>"`.

## 4. Plan

```bash
python3 tools/migrate_project_keys.py --plan "<vault>"
```

It writes nothing: a line per project with what would change, the unified diff of each file, and a digest. Read the
diffs with the owner. Anything marked `!` is left alone on purpose — decide it with them by hand.

## 5. Apply

Only with the owner's OK, and with the digest the plan just gave:

```bash
python3 tools/migrate_project_keys.py --apply "<vault>" --digest <digest>
```

If the vault changed in between (the owner or the app wrote something), the digest no longer matches and the tool
refuses: run `--plan` again and read it again. Each note is written with `atomic_write`, under the vault's lock.

## 6. Check

```bash
python3 tools/migrate_project_keys.py --check "<vault>"
python3 tools/vault.py -C "<vault>" check
```

`--check` exits 1 while any project note still carries a retired key, misses `area` or `objective`, holds a
`{{placeholder}}`, or embeds a `.base` that is not in the vault. The vault's own check must stay clean too.

## 7. The template the owner edits

The body a new project starts with is the vault's own copy, `.task-manager/templates/project.md`, edited in
**Settings → Vaults → Item types**. It was seeded from this app once and is the owner's since: this migration does
not touch it. If that copy still has the `## Board` section with `![[{{project}}.base#Open]]`, every project created
from now on gets the dead embed again — the owner removes it there, or writes the `.base` by hand per project and
keeps the embed.
