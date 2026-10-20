#!/usr/bin/env python3
"""Serve a throwaway copy of the sample vaults, never your real vaults or config.json.

    python3 tools/serve_sample.py               # → http://127.0.0.1:3101 (TM_PORT=<port> for another)
    python3 tools/serve_sample.py --ticketing   # and sample-vault-ticketing/ next to it

What it serves lives in a fresh folder in the system's temp dir (tm-sample-<port>-…): a copy of sample-vault/, so
trying things never writes into the versioned one, and a config.json of its own, so a save from Settings never
reaches the real one. Nothing of that folder is kept on purpose: the system clears its temp dir now and then.
"""
import argparse
import json
import os
import shutil
import sys
import tempfile

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)
import server  # noqa: E402  (reads the real config.json once, on import: only read, and replaced below)

SAMPLE_VAULT = os.path.join(APP_DIR, 'sample-vault')
SAMPLE_TICKETING = os.path.join(APP_DIR, 'sample-vault-ticketing')
DEFAULT_PORT = 3101
# What a sample keeps in .task-manager/ (its people, labels and used ids): the rest is what the app writes while
# you use a vault, and the copy starts without it.
KEPT = {'people.md', 'labels.md', 'ids.json'}


def copy_sample(src, dst):
    """A copy of a versioned sample vault, without what a run of the app may have left in its .task-manager/."""
    def ignore(folder, names):
        return [n for n in names if os.path.basename(folder) == '.task-manager' and n not in KEPT]
    shutil.copytree(src, dst, ignore=ignore)
    return dst


def setup(port=DEFAULT_PORT, ticketing=False):
    """Point the server at a temp copy of the sample vault (and a temp config.json). → the temp folder.
    Only changes this process's `server` module: nothing on disk outside the temp folder."""
    tmp = tempfile.mkdtemp(prefix=f'tm-sample-{port}-')
    sample = copy_sample(SAMPLE_VAULT, os.path.join(tmp, 'sample-vault'))
    vaults = [{'id': 'sample', 'name': 'Sample', 'path': sample, 'structure': 'folders'}]
    if ticketing:
        tickets = copy_sample(SAMPLE_TICKETING, os.path.join(tmp, 'tickets-vault'))
        vaults.append({'id': 'tickets', 'name': 'Sample tickets', 'path': tickets, 'structure': 'ticketing'})
    config = os.path.join(tmp, 'config.json')
    with open(config, 'w', encoding='utf-8') as f:
        json.dump({'root': sample, 'port': port, 'vaults': vaults, 'default_vault': 'sample'}, f, indent=2)
        f.write('\n')
    # load_config() and every save read CONFIG_PATH when they run, so redirecting it covers both
    server.CONFIG_PATH = config
    server.APP.config = server.load_config()
    server.APP.stores = {}  # nothing opened from the real config survives
    return tmp


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--ticketing', action='store_true', help='also serve a small Ticketing vault')
    args = ap.parse_args()
    port = int(os.environ.get('TM_PORT') or DEFAULT_PORT)
    os.environ['TM_PORT'] = str(port)
    tmp = setup(port, ticketing=args.ticketing)
    print(f'sample copy and its config.json in {tmp}', flush=True)
    server.main()


if __name__ == '__main__':
    main()
