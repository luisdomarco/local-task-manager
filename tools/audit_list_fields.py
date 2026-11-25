#!/usr/bin/env python3
"""What two defects of `tools/vault.py` left behind in a vault, found without writing a thing.

Until 2026-11-25 the CLI accepted, for a field that holds a list, text that was no list, and the Store kept it one
character per element (`labels=agentic-system` → `tags: ["a", "g", "e", …]`); and it passed a ref that named no item
straight through, so the file got a link to nothing (`[[XXX/INI-428]]`) while the command said `Updated`. `check` stays
green over both: one is a valid list of labels, the other a valid link to a note that is not there.

This finds them. It runs `find --json` and `types --json` through the CLI it is given and writes nothing at all, so it
is safe against a vault somebody else owns (point it at the installed CLI, not at a checkout being changed):

    python3 tools/audit_list_fields.py "$HOME/Library/Application Support/TaskManager/app/tools/vault.py" ~/Vaults/Work

A list field of more than one element, every one a single character, is the first defect and is not a judgement call.

A link that answers to no item of the vault is not damage by itself, and the two kinds are told apart from the vault's
own data, never from a list of fields written in here:

- its ref's prefix is a type **this vault holds no item of at all** → the link was never meant to resolve here: it
  names an item of another vault (a `goal`, in a vault that keeps all of its goals in another one). Correct as it
  stands, and putting a local item in its place to silence it would be the defect.
- its prefix is a type this vault does keep, or no type of it at all → the item it names is missing. That is the one
  to look at, one line at a time: a link may still name a note that is yet to be written.

Where both are true of one field — some of its links at home, some in the other vault — `--outside FIELD` (repeat it)
says so for that field and its links are read as the other vault's.
"""
import json
import re
import subprocess
import sys

# A ref or an old project-scoped id as they are written: STY-482, XXX/INI-428, ACME-STY-001. A resolved link holds the
# item's id (a number) or its path, never this, so this in a link field is a link that was never resolved.
REF_RE = re.compile(r'^[A-Z]{2,6}[-/]')
LINK_ALWAYS = ('related_to', 'relations')  # link fields every type has, which no prop declares
# The type prefix in a ref. It is never anchored at the end: what a link field holds is a wikilink's stem, and a
# stem is the note's file name — the ref AND its title (`GOL-900 Grow the team`). Reading only the first word
# covers every form a vault writes: GOL-900 Grow the team, GOL-123, XXX/INI-428 (an old project-scoped id),
# ACME-STY-001 (an old long id) → GOL, GOL, INI, STY. The last match of the word is the type's: in a long id the
# project key comes first (`ACME-STY-001` is a story).
PREFIX_RE = re.compile(r'([A-Z]{2,6})-\d+')


def cli(tm, vault, *argv):
    """One read of the vault through the CLI, as data. It never asks for a write."""
    run = subprocess.run([sys.executable, tm, '-C', vault, '--json', *argv], capture_output=True, text=True)
    if run.returncode:
        raise SystemExit(f'audit_list_fields: {" ".join(argv)}: {(run.stderr or run.stdout).strip()}')
    return json.loads(run.stdout)


def prefix_of(name):
    """The id prefix a ref names its type by, '' when its first word holds no ref."""
    word = name.split()[0] if name.split() else ''
    found = PREFIX_RE.findall(word)
    return found[-1] if found else ''


def target(value):
    """What a link field names, a [[wikilink]] unwrapped: a link the app could not resolve is kept as the file has it."""
    text = str(value).strip()
    if text.startswith('[[') and text.endswith(']]'):
        text = text[2:-2]
    return text.split('|')[0].split('#')[0].strip()


def elsewhere_prefixes(tm, vault, items):
    """The id prefixes that cannot name an item of this vault: a type the vault declares and holds not one item of.
    Read from the vault, so a type that fills up later stops being one of these on its own."""
    rows = cli(tm, vault, 'types')
    held = {it['type'] for it in items}
    return {r['prefix'] for r in rows if r.get('prefix') and r['type'] not in held}


def audit(tm, vault, outside=()):
    """→ (items read, [(where, key, the word it was cut into)], [(where, key, the ref whose item is missing)],
    [(where, key, the ref that belongs to another vault)]). `outside`: fields whose links live in another vault."""
    items = cli(tm, vault, 'find', '', '--limit', '100000', '--fields')['items']
    links = {}
    for item_type in sorted({it['type'] for it in items}):
        props = cli(tm, vault, 'types', item_type).get('props') or []
        links[item_type] = {p['key'] for p in props if p.get('kind') in ('link', 'links')} | set(LINK_ALWAYS)
    known = set()
    for it in items:
        f = it['fields'] or {}
        known |= {str(v) for v in (f.get('id'), it.get('path'), f.get('project_key')) if v not in (None, '')}
    away = elsewhere_prefixes(tm, vault, items)
    chopped, missing, elsewhere = [], [], []
    for it in items:
        where = f"{it.get('ref') or it.get('path')} ({it['type']})"
        for key, value in (it['fields'] or {}).items():
            if isinstance(value, list) and len(value) > 1 and all(isinstance(x, str) and len(x) == 1 for x in value):
                chopped.append((where, key, ''.join(value)))
            if key not in links.get(it['type'], ()):
                continue
            for x in (value if isinstance(value, list) else [value]):
                name = target(x) if isinstance(x, str) and x else ''
                if not name or name in known or not REF_RE.match(name):
                    continue
                prefix = prefix_of(name)
                at_home = not (key in outside or (prefix and prefix in away))
                (missing if at_home else elsewhere).append((where, key, name))
    return items, chopped, missing, elsewhere


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    outside = [argv.pop(argv.index('--outside') + 1) for _ in range(argv.count('--outside'))]
    argv = [a for a in argv if a != '--outside']
    if len(argv) != 2:
        raise SystemExit(f'{__doc__.strip().splitlines()[0]}\n\n'
                         'usage: audit_list_fields.py <vault.py> <vault folder> [--outside FIELD]…')
    tm, vault = argv
    items, chopped, missing, elsewhere = audit(tm, vault, outside)
    out = [f'{len(items)} items read from {vault}', '',
           f'A list field kept one character per element: {len(chopped)}']
    out += [f'  {where}  {key} → "{text}"' for where, key, text in chopped]
    out += ['', f'A link whose item is missing from this vault: {len(missing)}']
    out += [f'  {where}  {key} → {name}' for where, key, name in missing]
    if elsewhere:
        out += ['', f'A link to an item of another vault — correct as it stands, nothing to put back: {len(elsewhere)}']
        out += [f'  {where}  {key} → {name}' for where, key, name in elsewhere]
    out += ['', 'Nothing was written. Each line of the first two is a field to put back, with `vault.py set` or in '
                'Obsidian.' if chopped or missing else 'Nothing was written. Nothing to put back.']
    print('\n'.join(out))
    return 0


if __name__ == '__main__':
    sys.exit(main())
