# Contributing

Thanks for wanting to help. A few things keep this project easy to run and easy to trust.

## The rules of the code

- **Python standard library only, no build.** No `pip install`, no npm dependency, no bundler: `static/js/` is plain
  ES modules served as they are. Third-party browser code is vendored in `static/vendor/`.
- **Python 3.9 is the floor** (the one that ships with macOS): no `match`, no 3.10+ syntax or APIs.
- **Your vaults are data, not fixtures.** To try a change, run `python3 tools/serve_sample.py --ticketing`: it serves
  temporary copies of the two sample vaults on http://127.0.0.1:3101 and never touches your own.
- **What a vault looks like is data** in `tm/structures/` (folders, types, ids, statuses, fields). Read it from there;
  never hard-code a folder name, a type or a status elsewhere.
- **Writes are atomic, deletes go to the trash, ids are never reused**, and a description save never overwrites an
  edit made outside the app.

[`CLAUDE.md`](CLAUDE.md) says the same for coding agents, and the [README](README.md#6-development) explains the code
layout, how to add an item type or a structure, and how to check a layout change.

## Before you open a pull request

```bash
python3 -m unittest discover -s tests -t .     # Python suite (~30 s)
TZ=UTC node --test tests/js/*.test.mjs         # frontend logic (Node 20+)
```

Both must pass, and the change must be seen working in the browser on the sample server, with no console errors.
Behaviour a user sees is documented in the README (§7) in the same pull request.

Branches are `feat/<topic>` or `fix/<topic>` off `main`, with one or two commits each.
