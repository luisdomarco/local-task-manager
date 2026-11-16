#!/usr/bin/env python3
"""Move a Projects vault's comments out of their items' frontmatter (`comments:`) into files of their own,
`Comments/<ref>/<at>.md` (TSK-128, tm/comments.py). docs/migrate-comments.md is the guide, written for Claude.

    python3 tools/migrate_comments.py --plan VAULT
    python3 tools/migrate_comments.py --copy VAULT --to COPY
    python3 tools/migrate_comments.py --compare VAULT COPY
    python3 tools/migrate_comments.py --apply VAULT --digest DIGEST
    python3 tools/migrate_comments.py --check VAULT

--plan reads VAULT through the app's Store and writes nothing: each item with comments in its file, the file each
comment becomes, and a digest of all that (the items' files' bytes and the files to write). --apply refuses another
digest, so what is written is what was shown.

--copy copies VAULT to COPY (a folder that must not exist) and migrates the copy. --compare then reads every comment of
COPY back through the Store and checks it against VAULT's: the same comments in the same order, each with its text,
`edited` and author, and its moment within the second it had; every item's file byte for byte as it was but for its
`comments:` lines; every other file as it was.

--apply migrates VAULT in place, holding the vault's write lock (stop the app first: its writes would wait on it).
For each item, its comments' files first, then its `comments:` key goes (tm/frontmatter.drop: every other byte stays).
A run that stops leaves `.task-manager/migrate-comments.partial`, holding the digest: the same command again goes on
from where it stopped (a file already written with the same bytes counts as done).

--check says whether VAULT has no comment left in an item's file (exit 1 if it has).

A comment's file is named after its moment to the millisecond; one from before kept only the minute or the second,
so it gets zeros (`2026-10-01T10-00-00-000.md`). Two with the same name are kept apart by one millisecond each, in the
list's order. A comment with no moment takes its item's `created_at`. Comments from before had no author: they become
`by: owner`, as Activity showed them (*You*).

Python stdlib only. It never reads config.json: the caller passes the vault folder.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
from datetime import datetime

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)
from tm import comments as tc  # noqa: E402
from tm import frontmatter as fm  # noqa: E402
from tm.fsutil import atomic_write, vault_lock  # noqa: E402
from tm.store import META_DIR, Store  # noqa: E402
from tm.structures.check import PLACEHOLDER_RE  # noqa: E402

STRUCTURE = 'ticketing'
PARTIAL = 'migrate-comments.partial'  # in the vault's .task-manager, while --apply runs
IGNORED = {'.DS_Store', 'Icon\r'}


class PlanError(Exception):
    """Something the vault or the arguments do not allow: said to the user as it is, exit 2."""


# ── reading ──────────────────────────────────────────────────────────────────

def folder_of(path):
    path = os.path.abspath(os.path.expanduser(path))
    if not os.path.isdir(path):
        raise PlanError(f'not a folder: {path}')
    return path


def open_store(root):
    """The vault's Store, refusing one that is not a Projects vault or that iCloud has not downloaded whole."""
    waiting = [os.path.relpath(os.path.join(h, f), root) for h, _, fs in os.walk(root) for f in fs if PLACEHOLDER_RE.search(f)]
    if waiting:
        raise PlanError(f"not downloaded from iCloud yet: {', '.join(sorted(waiting)[:5])}: open the folder in Finder first")
    store = Store(root, structure=STRUCTURE)
    found = store.check(docs=False)
    if not found.get('ok'):
        raise PlanError(f"{root} does not match the Projects structure: "
                        f"{'; '.join(b['path'] + ': ' + b['detail'] for b in found['blocking'][:5])}")
    return store


def read_bytes(path):
    with open(path, 'rb') as f:
        return f.read()


def moment(c, it, root):
    """A frontmatter comment's moment as a file names it: its `at`, else its item's `created_at`, else its item's
    file's last change."""
    for at in (c.get('at'), it['fields'].get('created_at')):
        at = str(at or '').strip().replace(' ', 'T')
        if len(at) == 10:  # a day alone
            at += 'T00:00'
        try:
            return tc.at_of(tc.stem_of(at))
        except ValueError:
            continue
    when = datetime.fromtimestamp(os.path.getmtime(os.path.join(root, it['path'])))
    return when.isoformat(timespec='milliseconds')


def kept(it):
    """An item's frontmatter comments, each a dict ({text} for a bare string)."""
    return [c if isinstance(c, dict) else {'text': str(c if c is not None else '')} for c in it['fields'].get('comments') or []]


def files_for(it, root):
    """[{stem, at, text, file, written}] — the file each of an item's frontmatter comments becomes, in the list's order.
    A name its folder already has goes one millisecond on, unless that file holds these very bytes (a run that stopped
    wrote it: `written`)."""
    folder = os.path.join(root, tc.DIR, tc.folder_name(it))
    there, used, out = set(tc.names(folder)), set(), []
    link = tc.item_link(it)
    for c in kept(it):
        at = moment(c, it, root)
        text = str(c.get('text') or '')
        while True:
            stem = tc.stem_of(at)
            body = tc.render(link, at, text, str(c.get('by') or 'owner'), c.get('edited'))
            name = stem + '.md'
            same = name in there and read_bytes(os.path.join(folder, name)) == body.encode('utf-8')
            if stem not in used and (name not in there or same):
                break
            at = tc.next_at(at)
        used.add(stem)
        out.append({'stem': stem, 'at': at, 'text': text, 'file': body, 'written': same})
    return out


def make_plan(root):
    """{root, items: [{path, ref, sha, comments: [...]}], digest} of the items that still keep comments in their file."""
    store = open_store(root)
    items, _ = store.scan()
    plan = []
    for it in sorted(items, key=lambda x: x['path']):
        if 'comments' not in it['fields']:
            continue
        sha = hashlib.sha256(read_bytes(os.path.join(root, it['path']))).hexdigest()
        plan.append({'path': it['path'], 'ref': tc.folder_name(it), 'sha': sha, 'item': it, 'comments': files_for(it, root)})
    h = hashlib.sha256()
    for p in plan:
        h.update(f"{p['path']}\0{p['sha']}\0".encode('utf-8'))
        for c in p['comments']:
            h.update(f"{c['stem']}\0{c['file']}\0".encode('utf-8'))
    return {'root': root, 'items': plan, 'digest': h.hexdigest()[:16]}


def summary(plan, out):
    n = sum(len(p['comments']) for p in plan['items'])
    folders = {p['ref'] for p in plan['items'] if p['comments']}
    print(f"{plan['root']}: {n} comments in {len(plan['items'])} items' files → {n} files in {len(folders)} folders "
          f"of {tc.DIR}/", file=out)
    for p in plan['items'][:10]:
        names = ', '.join(c['stem'] for c in p['comments'][:3]) + (' …' if len(p['comments']) > 3 else '')
        print(f"  {p['ref']}: {len(p['comments'])} ({names or 'an empty list: the key goes'})", file=out)
    if len(plan['items']) > 10:
        print(f"  … and {len(plan['items']) - 10} more", file=out)
    bumped = sum(1 for p in plan['items'] for c in p['comments'] if not c['stem'].endswith('-000'))
    if bumped:
        print(f'  {bumped} kept apart from another of the same moment by a millisecond', file=out)
    print(f"Digest: {plan['digest']}", file=out)


# ── writing ──────────────────────────────────────────────────────────────────

def apply(root, digest, out):
    """Migrate `root` in place, if its plan's digest is `digest` (or a run with it stopped half way)."""
    meta = os.path.join(root, META_DIR)
    os.makedirs(meta, exist_ok=True)
    marker = os.path.join(meta, PARTIAL)
    with vault_lock(meta):
        plan = make_plan(root)
        resuming = os.path.isfile(marker) and read_bytes(marker).decode('utf-8').strip() == digest
        if plan['digest'] != digest and not resuming:
            raise PlanError(f"the vault is not as planned (digest {plan['digest']}, not {digest}): run --plan again")
        atomic_write(marker, digest + '\n')
        n = 0
        for p in plan['items']:
            path = os.path.join(root, p['path'])
            raw = read_bytes(path)
            if hashlib.sha256(raw).hexdigest() != p['sha']:  # edited outside the app meanwhile (Obsidian)
                raise PlanError(f"{p['path']} changed while migrating: run the same command again")
            folder = os.path.join(root, tc.DIR, p['ref'])
            if p['comments']:
                os.makedirs(folder, exist_ok=True)
            for c in p['comments']:
                if not c['written']:
                    atomic_write(os.path.join(folder, c['stem'] + '.md'), c['file'], exclusive=True)
                n += 1
            atomic_write(path, fm.drop(raw.decode('utf-8'), ['comments']))
        os.remove(marker)
    print(f"✓ {n} comments of {len(plan['items'])} items moved to {tc.DIR}/", file=out)


def copy(root, target, out):
    target = os.path.abspath(os.path.expanduser(target))
    if os.path.exists(target):
        raise PlanError(f'{target} exists: --to takes a folder that does not')
    plan = make_plan(root)
    shutil.copytree(root, target, symlinks=True)
    apply(target, plan['digest'], out)
    print(f'Copy at {target}: now --compare {root} {target}', file=out)


# ── checking ─────────────────────────────────────────────────────────────────

def within_a_second(at, of):
    try:
        gap = (datetime.fromisoformat(at) - datetime.fromisoformat(of)).total_seconds()
    except ValueError:
        return False
    return 0 <= gap < 1


def all_files(root):
    """Every file under `root` but the app's own folder and the comments', relative to it."""
    for here, dirs, files in os.walk(root):
        rel = os.path.relpath(here, root)
        if rel == '.':
            dirs[:] = [d for d in dirs if d not in (META_DIR, tc.DIR)]
        for name in files:
            if name not in IGNORED:
                yield os.path.normpath(os.path.join(rel, name))


def compare(source, migrated, out):
    """What differs between `source` and its migrated copy beyond the move (a list of lines; [] when none)."""
    plan = make_plan(source)
    store = open_store(migrated)
    problems = []
    changed = {p['path'] for p in plan['items']}
    for p in plan['items']:
        it = p['item']
        before = kept(it)
        got = [c for c in store.item_comments(it['key'])['comments'] if not c.get('legacy')]
        if len(got) != len(before):
            problems.append(f"{p['ref']}: {len(before)} comments, {len(got)} after")
        for i, (b, a) in enumerate(zip(before, got)):
            want = {'text': str(b.get('text') or '').strip(), 'edited': str(b.get('edited') or ''), 'by': str(b.get('by') or 'owner')}
            have = {'text': a['text'], 'edited': a.get('edited', ''), 'by': a['by']}
            if want != have or not within_a_second(a['at'], moment(b, it, source)):
                problems.append(f"{p['ref']} comment {i + 1}: {want} at {b.get('at')} became {have} at {a['at']}")
        text = read_bytes(os.path.join(source, p['path'])).decode('utf-8')
        if read_bytes(os.path.join(migrated, p['path'])).decode('utf-8') != fm.drop(text, ['comments']):
            problems.append(f"{p['path']}: more than its comments changed")
    a, b = set(all_files(source)), set(all_files(migrated))
    problems += [f'{rel}: missing' for rel in sorted(a - b)] + [f'{rel}: new' for rel in sorted(b - a)]
    for rel in sorted(a & b - changed):
        if read_bytes(os.path.join(source, rel)) != read_bytes(os.path.join(migrated, rel)):
            problems.append(f'{rel}: changed')
    for line in problems[:30]:
        print(f'  ✗ {line}', file=out)
    n = sum(len(p['comments']) for p in plan['items'])
    print(f'✓ {n} comments of {len(plan["items"])} items read back as they were' if not problems
          else f'✗ {len(problems)} differences', file=out)
    return problems


def check(root, out):
    """The items of `root` that still keep comments in their file ([] when none), and the vault check's comment
    warnings."""
    store = open_store(root)
    items, _ = store.scan()
    left = sorted(tc.folder_name(it) for it in items if 'comments' in it['fields'])
    warnings = [w for w in store.check(docs=True).get('warnings', []) if 'comment' in str(w.get('kind', ''))]
    for w in warnings[:10]:
        print(f"  ! {w['path']}: {w['detail']}", file=out)
    print(f"✗ {len(left)} items keep comments in their file: {', '.join(left[:10])}" if left
          else f'✓ no comment left in an item\'s file ({len(warnings)} comment warnings)', file=out)
    return left


def main(argv=None, out=sys.stdout):
    p = argparse.ArgumentParser(description=__doc__.split('\n', 1)[0])
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument('--plan', metavar='VAULT', help='say what would move, and its digest; write nothing')
    g.add_argument('--copy', metavar='VAULT', help='copy VAULT to --to and migrate the copy')
    g.add_argument('--compare', nargs=2, metavar=('VAULT', 'COPY'), help='check a migrated copy against its vault')
    g.add_argument('--apply', metavar='VAULT', help='migrate VAULT in place (needs --digest)')
    g.add_argument('--check', metavar='VAULT', help='say whether any comment is left in an item\'s file')
    p.add_argument('--to', help='with --copy: the new folder')
    p.add_argument('--digest', help="with --apply: the digest --plan gave")
    a = p.parse_args(argv)
    try:
        if a.plan:
            summary(make_plan(folder_of(a.plan)), out)
            return 0
        if a.copy:
            if not a.to:
                raise PlanError('--copy needs --to')
            copy(folder_of(a.copy), a.to, out)
            return 0
        if a.compare:
            return 1 if compare(folder_of(a.compare[0]), folder_of(a.compare[1]), out) else 0
        if a.apply:
            if not a.digest:
                raise PlanError('--apply needs the --digest that --plan gave')
            apply(folder_of(a.apply), a.digest, out)
            return 0
        return 1 if check(folder_of(a.check), out) else 0
    except PlanError as e:
        print(f'✗ {e}', file=out)
        return 2


if __name__ == '__main__':
    sys.exit(main())
