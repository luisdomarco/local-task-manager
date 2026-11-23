#!/usr/bin/env python3
"""Bring a Projects vault's project notes to the shape a project created today has (SUP-391).
docs/migrate-project-keys.md is the guide.

    python3 tools/migrate_project_keys.py --plan VAULT
    python3 tools/migrate_project_keys.py --apply VAULT --digest DIGEST
    python3 tools/migrate_project_keys.py --check VAULT

A project's frontmatter is written from `tm/structures/ticketing/templates/Ticket Project.md`, and that template
changed four times between 2026-10-17 and 2026-11-14 while the notes already on disk were never revisited. So a vault
holds projects of as many shapes as it had template versions. This brings every one to today's:

* `enabled_types`, `areas`, `living_specs` and `related_initiatives` go. No code reads any of them on a project:
  what a project holds follows from its initiatives' kinds (tm/structures/kinds.py), the closed list of areas was
  never implemented, the specs are the `Spec` items in the project's `Specs/` folder, and a link to another note is
  a relation now. `related_initiatives` is also a property convention of the owner's own Obsidian notes, read by a
  base of theirs — on Notes and Meetings, never on a project note, which this leaves untouched.
  `living_specs` is the one that ever holds a value worth keeping, so its path is written into the body first.
* `area` and `objective` are added, empty, where the note has none: both are fields of the app since 2026-11-07
  (the `aimed` trait), shown in the note's own "Area and objective" section.
* A `## Board` section whose only content is `![[….base#Open]]` goes. No `.base` of a project has ever existed: the
  app reads bases, it never writes one (tm/bases.py), so that embed has always been dead. A `## Board` section with
  anything else in it is left alone and reported.
* A body line still holding `{{living_specs}}` takes the value the note's own `living_specs` had (the placeholder was
  filled in by nobody before 2026-10-20), so the path is kept as text before the key goes.

Every other byte stays: the keys, their order, their `#` comments and the rest of the body (tm/frontmatter.patch and
`drop`). No file is created, renamed or deleted, and no item but a project note is read.

--plan writes nothing: a line per project, the unified diff of each file, and a digest of what would be written.
--apply refuses any other digest, so what is written is what was shown. It holds the vault's write lock, so stop the
app first (its writes would wait on it).

--check says whether any project note still carries a retired key, a dead `.base` embed or a `{{placeholder}}`
(exit 1 if one does).

Python stdlib only. It never reads config.json: the caller passes the vault folder.
"""
import argparse
import difflib
import hashlib
import os
import re
import sys

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)
from tm import frontmatter as fm  # noqa: E402
from tm.fsutil import atomic_write, vault_lock  # noqa: E402
from tm.store import Store  # noqa: E402

STRUCTURE = 'ticketing'
# Written by the template until 2026-11-14 (`enabled_types`) or until this fix (the other three); no code reads any
# of them on a project (`premise_max_age_days`, which rules.py does read, is declared instead and stays).
RETIRED = ('enabled_types', 'areas', 'living_specs', 'related_initiatives')
# Fields of the app a project has carried since 2026-11-07, missing from every note written before it.
ADDED = ('area', 'objective')
PLACEHOLDER_RE = re.compile(r'\{\{([^}]*)\}\}')
# A `## Board` section and what is under it, up to the next heading or the end.
BOARD_RE = re.compile(r'(?m)^## Board\n(?P<body>.*?)(?=^## |\Z)', re.S)
DEAD_EMBED_RE = re.compile(r'^!\[\[[^\]]*\.base#[^\]]*\]\]$')


class PlanError(Exception):
    """Something the vault or the arguments do not allow: said to the user as it is, exit 2."""


def folder_of(path):
    path = os.path.abspath(os.path.expanduser(path))
    if not os.path.isdir(path):
        raise PlanError(f'not a folder: {path}')
    return path


def project_notes(root):
    """[(path relative to the vault, its text)] for every project note of the vault, by key."""
    store = Store(root, None, STRUCTURE, enforce_structure=False)
    if store.structure.id != STRUCTURE:
        raise PlanError(f'{root} is not a Projects vault (it is {store.structure.label})')
    out = []
    for it in store.items():
        if it['type'] != 'project':
            continue
        with open(os.path.join(root, it['path']), encoding='utf-8') as f:
            out.append((str(it['fields'].get('project_key') or it['title']), it['path'], f.read()))
    return sorted(out)


def migrated(text):
    """→ (the note's new text, [what changed], [what was left alone and why]). Nothing to change: the same text."""
    raw = fm.parse(fm.split(text)[0] or '')
    changed, left = [], []
    out = text

    # The body first, every byte of it but the two defects (fm.patch with `body` keeps the frontmatter as it is).
    specs = str(raw.get('living_specs') or '').strip() or 'Specs/'
    body = fm.split(out)[1]
    names = sorted(set(PLACEHOLDER_RE.findall(body)))
    if 'living_specs' in names:
        body = body.replace('{{living_specs}}', specs)
        changed.append(f'{{{{living_specs}}}} → {specs}')
    for name in names:
        if name != 'living_specs':
            left.append(f'{{{{{name}}}}} in the body: filled in by nobody, left as it is')
    for m in reversed(list(BOARD_RE.finditer(body))):
        lines = [l for l in m.group('body').strip().split('\n') if l.strip()]
        if lines and all(DEAD_EMBED_RE.match(l.strip()) for l in lines):
            body = body[:m.start()] + body[m.end():]
            changed.append(f"## Board dropped ({' '.join(lines)}: no such file in the vault)")
        else:
            left.append('## Board holds more than the embed: left as it is')
    if body != fm.split(out)[1]:
        out = fm.patch(out, {}, body=body)

    gone = [k for k in RETIRED if k in raw]
    if gone:
        out = fm.drop(out, gone)
        changed += [f'{k} dropped' for k in gone]
    new = {k: '' for k in ADDED if k not in raw}
    if new:
        out = fm.patch(out, new)
        changed += [f'{k} added, empty' for k in new]
    return out, changed, left


def plan(root):
    """[(key, path, old text, new text, what changed, what was left)] for the notes that change, and the digest."""
    rows = []
    for key, path, text in project_notes(root):
        new, changed, left = migrated(text)
        if new != text or left:
            rows.append((key, path, text, new, changed, left))
    return rows, digest_of(rows)


def digest_of(rows):
    h = hashlib.sha256()
    for _, path, old, new in ((r[0], r[1], r[2], r[3]) for r in rows):
        h.update(path.encode('utf-8') + b'\0' + old.encode('utf-8') + b'\0' + new.encode('utf-8') + b'\0')
    return h.hexdigest()[:16]


def show(rows, dig, out):
    if not rows:
        print('every project note is already the shape a project created today has.', file=out)
        return
    print(f'{len(rows)} project note(s):\n', file=out)
    for key, path, old, new, changed, left in rows:
        print(f'{key} — {path}', file=out)
        for what in changed:
            print(f'  · {what}', file=out)
        for what in left:
            print(f'  ! {what}', file=out)
        print('', file=out)
    print('--- the bytes ---\n', file=out)
    for _, path, old, new, _, _ in rows:
        if old != new:
            diff = difflib.unified_diff(old.split('\n'), new.split('\n'), f'a/{path}', f'b/{path}', lineterm='', n=2)
            print('\n'.join(diff) + '\n', file=out)
    print(f'digest: {dig}\n\nto write it: --apply <VAULT> --digest {dig}', file=out)


def apply(root, dig, out):
    rows, now = plan(root)
    if not rows:
        print('nothing to do.', file=out)
        return 0
    if dig != now:
        raise PlanError(f'the vault changed since --plan (digest {now}, not {dig}): run --plan again and read it')
    with vault_lock(root):
        for key, path, old, new, _, _ in rows:
            if old == new:
                continue
            atomic_write(os.path.join(root, path), new)
            print(f'written: {path}', file=out)
    print(f'\n{sum(1 for r in rows if r[2] != r[3])} project note(s) written. Run `vault.py -C <VAULT> check`.', file=out)
    return 0


def check(root, out):
    bad = 0
    for key, path, text in project_notes(root):
        raw = fm.parse(fm.split(text)[0] or '')
        says = [f'{k} is still there' for k in RETIRED if k in raw]
        says += [f'{k} is missing' for k in ADDED if k not in raw]
        body = fm.split(text)[1]
        says += [f'{{{{{n}}}}} is unsubstituted' for n in sorted(set(PLACEHOLDER_RE.findall(body)))]
        says += [f'{m.group(0)} is embedded but no such file exists' for m in re.finditer(r'!\[\[[^\]]*\.base#[^\]]*\]\]', body)
                 if not _base_exists(root, m.group(0))]
        if says:
            bad += 1
            print(f'{key} — {path}: ' + '; '.join(says), file=out)
    if not bad:
        print('every project note is the shape a project created today has.', file=out)
    return 1 if bad else 0


def _base_exists(root, embed):
    target = embed[3:-2].split('#')[0].split('|')[0].strip()
    if not target:
        return False
    want = os.path.basename(target)
    for here, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        if want in files:
            return True
    return False


def main(argv=None, out=sys.stdout):
    p = argparse.ArgumentParser(description='Bring a Projects vault\'s project notes to today\'s shape (SUP-391).')
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument('--plan', metavar='VAULT', help='say what would change, and its digest; write nothing')
    g.add_argument('--apply', metavar='VAULT', help='write it (needs --digest)')
    g.add_argument('--check', metavar='VAULT', help='say whether any project note is still of an older shape')
    p.add_argument('--digest', help='with --apply: the digest --plan gave')
    args = p.parse_args(argv)
    try:
        if args.plan:
            show(*plan(folder_of(args.plan)), out=out)
            return 0
        if args.apply:
            if not args.digest:
                raise PlanError('--apply needs the --digest that --plan gave')
            return apply(folder_of(args.apply), args.digest, out)
        return check(folder_of(args.check), out)
    except PlanError as e:
        print(f'error: {e}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
