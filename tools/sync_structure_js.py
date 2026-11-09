#!/usr/bin/env python3
"""Rewrite the page's copy of the structures from the server's.

static/js/structure.js holds Structure.public() of the default structure (Projects) and of the legacy folder-per-type
one, verbatim: what the page draws before it has its vault's structure, and what the node tests run on.
tests/test_structures.py fails while they differ, so after changing a type of either (tm/structures/) run this once:

    python3 tools/sync_structure_js.py           # rewrite static/js/structure.js
    python3 tools/sync_structure_js.py --check   # exit 1 if it is out of date, writing nothing

The whole file is written from here: one line for each structure, one per type.
"""
import argparse
import json
import os
import sys

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)

from tm.structures import DEFAULT_STRUCTURE, REGISTRY  # noqa: E402

JS_PATH = os.path.join(APP_DIR, 'static', 'js', 'structure.js')
# The constants the page imports (static/js/rules.js), by the structure's id as config.json names it.
CONSTANTS = (
    (DEFAULT_STRUCTURE, 'PROJECTS',
     "// The default structure (Projects: projects as folders, each of a kind) as GET /api/structure answers it\n"
     "// (Structure.public()): what the page uses until it has its vault's."),
    ('folders', 'FOLDER_PER_TYPE',
     "// The legacy folder-per-type structure (Initiatives), what most node tests run on until it is retired."),
)
HEAD = ("// Written by tools/sync_structure_js.py: do not edit by hand. tests/test_structures.py checks that each constant\n"
        "// is the server's exactly, so a change to a structure there fails until it is synced here too.\n")


def literal(structure_id):
    public = REGISTRY[structure_id].public()
    types = public.pop('types')
    body = json.dumps(public, ensure_ascii=False)[:-1]
    rows = ',\n'.join('    ' + json.dumps(t, ensure_ascii=False) for t in types)
    return f'{body},\n  "types": [\n{rows}\n  ]\n}}'


def render():
    return HEAD + ''.join(f'\n{note}\nexport const {name} = {literal(sid)};\n' for sid, name, note in CONSTANTS)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--check', action='store_true', help='only say whether it is up to date (exit 1 if not)')
    args = ap.parse_args(argv)
    try:
        with open(JS_PATH, encoding='utf-8') as f:
            text = f.read()
    except FileNotFoundError:
        text = ''
    new = render()
    if args.check:
        if new != text:
            print(f'{os.path.relpath(JS_PATH, APP_DIR)} is out of date: run python3 tools/sync_structure_js.py')
            return 1
        print('up to date')
        return 0
    if new == text:
        print('already up to date')
        return 0
    with open(JS_PATH, 'w', encoding='utf-8') as f:
        f.write(new)
    print(f'rewrote {os.path.relpath(JS_PATH, APP_DIR)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
