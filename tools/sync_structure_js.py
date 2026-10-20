#!/usr/bin/env python3
"""Rewrite the page's copy of the default (folder-per-type) structure from the server's.

static/js/structure.js holds Structure.public() of the default structure, verbatim: what the page draws before it has
its vault's structure, and what the node tests run on. tests/test_structures.py fails while the two differ, so after
changing a type of that structure (tm/structures/) run this once:

    python3 tools/sync_structure_js.py           # rewrite static/js/structure.js
    python3 tools/sync_structure_js.py --check   # exit 1 if it is out of date, writing nothing

Only the object literal is rewritten (one line for the structure, one per type); the comment above it stays.
"""
import argparse
import json
import os
import sys

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)

from tm.structures import REGISTRY  # noqa: E402

JS_PATH = os.path.join(APP_DIR, 'static', 'js', 'structure.js')
DEFAULT = 'folders'  # the structure's id, as config.json names it
NAME = 'export const FOLDER_PER_TYPE = '  # the constant the page imports (static/js/rules.js)


def render(head):
    public = REGISTRY[DEFAULT].public()
    types = public.pop('types')
    body = json.dumps(public, ensure_ascii=False)[:-1]
    rows = ',\n'.join('    ' + json.dumps(t, ensure_ascii=False) for t in types)
    return f'{head}{NAME}{body},\n  "types": [\n{rows}\n  ]\n}};\n'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--check', action='store_true', help='only say whether it is up to date (exit 1 if not)')
    args = ap.parse_args(argv)
    with open(JS_PATH, encoding='utf-8') as f:
        text = f.read()
    if NAME not in text:
        sys.exit(f'{JS_PATH}: no "{NAME.strip()}" in it')
    new = render(text.split(NAME)[0])
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
