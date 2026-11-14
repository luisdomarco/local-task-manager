#!/usr/bin/env python3
"""Time what the page asks a vault for, on a large generated one: never a real vault.

    python3 tools/bench_vault.py                  # 3000 docs and 400 tasks over a copy of sample-vault/
    python3 tools/bench_vault.py --docs 8000 --items 1000 --runs 7
    python3 tools/bench_vault.py --keep           # leaves the generated vault in the temp dir, and says where
    python3 tools/bench_vault.py --vault <kept>   # times that one again (only a vault this tool generated)

It copies sample-vault/ into a fresh temp folder, adds `--items` tasks (through the Store, so they are real items) and
`--docs` documents in Docs/Bench/ that link to one another, then times each read cold (a new Store, nothing cached
in memory), warm (the same Store again, walking the folder on every read, as a test or a tool does) and watched (a
page polls the vault, so a read reuses the index's last walk: tm/index.py): the items, the Explorer's file list, a
search, a doc's backlinks, the graph and the Docs roots. Warm and watched are the median of `--runs` runs.
"""
import argparse
import os
import random
import shutil
import statistics
import sys
import tempfile
import time

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)
sys.path.insert(0, os.path.join(APP_DIR, 'tools'))
from serve_sample import SAMPLE_VAULT, copy_sample  # noqa: E402
from tm.store import Store  # noqa: E402

WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore '
         'magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo').split()


def generate(root, docs, items, seed=7):
    """`items` tasks and `docs` linked docs in a copy of the sample at `root`."""
    rnd = random.Random(seed)
    store = Store(root, structure='ticketing')
    for i in range(items):
        store.create('task', f'Bench task {i}', {'status': 'ToDo'})
    names = [f'Bench doc {i}' for i in range(docs)]
    for i, name in enumerate(names):
        folder = os.path.join(root, 'Docs', 'Bench', f'Area {i % 40}', f'Topic {i % 7}')
        os.makedirs(folder, exist_ok=True)
        links = ' '.join(f'[[{rnd.choice(names)}]]' for _ in range(3))
        text = '\n\n'.join(' '.join(rnd.choice(WORDS) for _ in range(40)) for _ in range(6))
        with open(os.path.join(folder, f'{name}.md'), 'w', encoding='utf-8') as f:
            f.write(f'---\ntags: [bench, area-{i % 40}]\ncategory: Topic {i % 7}\n---\n# {name}\n\nSee {links}.\n\n{text}\n')
    return names


def timed(fn, runs):
    out = []
    for _ in range(runs):
        t = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t) * 1000)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--docs', type=int, default=3000)
    ap.add_argument('--items', type=int, default=400)
    ap.add_argument('--runs', type=int, default=5)
    ap.add_argument('--keep', action='store_true', help='keep the generated vault')
    ap.add_argument('--vault', help='time a vault this tool generated and kept before (--keep), not a new one')
    args = ap.parse_args()
    if args.vault:
        tmp, root = None, os.path.realpath(args.vault)
        names = [f'Bench doc {i}' for i in range(2)]
    else:
        tmp = tempfile.mkdtemp(prefix='tm-bench-')
        root = copy_sample(SAMPLE_VAULT, os.path.join(tmp, 'vault'))
        t = time.perf_counter()
        names = generate(root, args.docs, args.items)
        print(f'generated {args.docs} docs and {args.items} tasks in {time.perf_counter() - t:.1f} s → {root}')
    target = os.path.join('Docs', 'Bench', 'Area 1', 'Topic 1', f'{names[1]}.md')
    reads = [
        ('items', lambda s: s.items()),
        ('files', lambda s: s.files()),
        ('search "consectetur"', lambda s: s.search_files('consectetur')),
        ('backlinks of a doc', lambda s: s.backlinks(target)),
        ('graph', lambda s: s.graph()),
        ('docs roots', lambda s: s.docs_roots()),
    ]
    print(f'{"read":24} {"cold ms":>9} {"warm ms":>9} {"watched ms":>11}')
    for label, fn in reads:
        cold = timed(lambda: fn(Store(root, structure='ticketing')), 1)[0]
        warm_store = Store(root, structure='ticketing')
        fn(warm_store)
        warm = statistics.median(timed(lambda: fn(warm_store), args.runs))
        warm_store.index.watch(600)  # a page polls (GET /api/vault/changes): a walk is trusted for max_age
        warm_store.index.max_age = 600
        fn(warm_store)
        watched = statistics.median(timed(lambda: fn(warm_store), args.runs))
        print(f'{label:24} {cold:9.0f} {warm:9.0f} {watched:11.0f}')
    if tmp and args.keep:
        print(f'kept: {root}')
    elif tmp:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
