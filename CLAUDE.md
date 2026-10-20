# CLAUDE.md — Local Task Manager

A task manager whose only storage is Markdown vaults. [README.md](README.md) is the full guide: setup (§2), vault
structures (§5), development (§6) and the reference of every screen (§7). This file is what an agent must not get wrong.

## Commands

```bash
python3 tools/serve_sample.py [--ticketing]    # try a change: temp copy of sample-vault/ (+ sample-vault-ticketing/) on :3101
python3 -m unittest discover -s tests -t .     # Python suite (~30 s)
TZ=UTC node --test tests/js/*.test.mjs         # frontend logic (Node 20+)
python3 server.py                              # the user's own config.json and vaults on :3100 — not for testing
```

Preview servers live in `.claude/launch.json`: `task-manager-sample` (3101) and `task-manager-sample-3103`
(`--ticketing`) are the safe ones; `task-manager` (3100) and `task-manager-3102` serve the user's real vaults.

## Invariants

- **Python stdlib only, no build.** No `pip install`, no npm dependency, no bundler: `static/js/` is plain ES modules
  served as they are. Third-party code is vendored in `static/vendor/` (marked, DOMPurify, highlight.js, xterm.js, Inter).
- **Python 3.9 is the floor** (the stock macOS `/usr/bin/python3`): no `match`, no 3.10+ stdlib calls, no 3.11+ APIs
  such as `unittest`'s `enterContext`. Run the Python suite with `/usr/bin/python3` too before calling it green.
- **Never touch a real vault.** `vault/`, `vault-*/`, `tickets-vault/` and any folder in the user's `config.json` are
  personal data. To run the server against something, use `tools/serve_sample.py`; in a test, write a temp folder
  and point `server.CONFIG_PATH` at a temp `config.json` (as `serve_sample.setup` and `tests/test_vaults.py` do).
  Never edit `config.json` in the checkout.
- **`tm/structures/` decides folders and types.** What a vault looks like (its folders, item types, id format,
  statuses, fields, which file is an item) is data in `tm/structures/` (the folder-per-type
  structure's module, `ticketing/definition.py`, `agents.py`). How to add a type or a structure: README §6. The Store, the server and the page read it from there (`GET /api/structure`): never hard-code a
  folder name, a type or a status elsewhere.
- **Ticketing writes only changed keys.** `tm/structures/ticketing/codec.py` `encode` patches just the keys the app
  changed; key order, comments, unknown keys and the body stay byte for byte (these files are also edited in
  Obsidian). Keep it that way; `tests/test_ticketing.py` checks it.
- **A change to the folder-per-type structure is mirrored in `static/js/structure.js`.** It is that structure's
  `Structure.public()`, verbatim (`python3 tools/sync_structure_js.py` rewrites it; `--check` only checks). `tests/test_structures.py` fails until both agree.
- **Writes are atomic** (`tm/fsutil.atomic_write`), deletes go to the trash, ids are never reused, and a
  description save carries `body_rev` so an outside edit is never overwritten (README → *Safe against edits*).
- The server listens on 127.0.0.1 only and every POST needs the `X-Task-Manager` header (`static/js/api.js` adds it).

## Where things go

| Change | Goes in |
|---|---|
| An HTTP route | `server.py` (`ROUTES`); the vault logic it calls in `tm/store.py` |
| A type, field, folder or status | `tm/structures/…` (+ `static/js/structure.js` for folder per type) |
| Ticketing file format or rules | `tm/structures/ticketing/` (`codec.py`, `rules.py`, `check.py`, `templates/`) |
| A view | `static/js/views/<view>.js`; state and mutations in `static/js/state.js`; API calls in `api.js` |
| Pure logic of the page | its own module, tested in `tests/js/<module>.test.mjs` |
| A script run by hand or by a command | `tools/`; the Claude Code commands in `.claude/commands/` |
| A design note of work in progress | `plans/` |
| A test | `tests/test_<area>.py` (stdlib `unittest`, temp folders) |

Behaviour a user sees is documented in README §7 in the same PR; a new top-level file that must travel with the
system zip goes in `tm/export.py` `INCLUDE`.

## Done means

1. Both suites green: `python3 -m unittest discover -s tests -t .` and `TZ=UTC node --test tests/js/*.test.mjs`.
2. Seen in the browser on a sample server (3101 / 3103): the change works, no console errors, and for CSS the
   widths in README §6 *Checking a layout change*.

## PR flow

A `feat/<topic>` or `fix/<topic>` branch off `main` (a git worktree for risky work), one or two commits, a PR against
`main`. Merging is the owner's call: never merge without an explicit OK. Merges are titled `merge: <title> (#N)`.
Never `git push --force`.
