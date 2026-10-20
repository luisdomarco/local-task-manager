#!/usr/bin/env python3
"""Statuses per item type, in three groups (TSK-037): put each vault's current statuses in its statuses.json, and
rename or merge one later.

    python3 tools/migrate_statuses.py                    # plan: every vault, its statuses by group, what uses them
    python3 tools/migrate_statuses.py --apply            # write .task-manager/statuses.json where a vault has none
    python3 tools/migrate_statuses.py --vault my-vault --remap task:Review=InReview            # plan a rename
    python3 tools/migrate_statuses.py --vault my-vault --remap task:Review=InReview --apply    # do it (backup first)

The seed rewrites no item: it writes down the statuses each type already has, in the default groups (Backlog, ToDo,
Idea and open have not started; the type's closed ones are closed; the rest are under way) — exactly what the app
shows without the file. A vault where an item has a status its type does not (written by hand) is reported and left
alone: say where those items go first (--remap, or in the app).

--remap TYPE:OLD=NEW renames OLD to NEW in that type (merges it into NEW when the type has NEW already): every item and
board list with OLD moves to NEW, through the app's own update (completed_at kept while it stays closed). Before
writing, the vault folder is copied to backups/ next to config.json (<folder>.backup-<date>), unless --no-backup. Ticketing fixes its
statuses' names (they are its file format): there only the groups and colours change, from the app.

The vaults are config.json's (CONFIG_PATH, or --config), opened as the server opens them: one that does not match its
structure is refused.
"""
import argparse
import json
import os
import shutil
import sys
from datetime import datetime

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)
import server  # noqa: E402
from tm.store import StoreError  # noqa: E402


def plan(store):
    """What the vault has now: {saved, error, types: [{type, label, statuses: [{name, group, count}], unknown}]}."""
    return store.status_config()


def drift(cfg):
    """{type label: [status (count)]} for statuses items have that their type does not."""
    return {t['label']: [f"{u['name']} ({u['count']})" for u in t['unknown']] for t in cfg['types'] if t['unknown']}


def seed(store):
    """statuses.json with what the vault has now, when it has none. → 'kept' | 'written'."""
    if os.path.exists(store._statuses_path()):
        return 'kept'
    cfg = store.structure.status_config()
    store.save_status_config(cfg)
    return 'written'


def parse_remap(text):
    """'task:Review=InReview' → ('task', 'Review', 'InReview')."""
    try:
        type_name, rest = text.split(':', 1)
        old, new = rest.split('=', 1)
    except ValueError:
        raise SystemExit(f'--remap: expected TYPE:OLD=NEW, not {text}')
    if not (type_name.strip() and old.strip() and new.strip()):
        raise SystemExit(f'--remap: expected TYPE:OLD=NEW, not {text}')
    return type_name.strip(), old.strip(), new.strip()


def remap(store, type_name, old, new):
    """Renames (or merges) `old` into `new` in that type: the arrangement and every item and board list using it."""
    cfg = store.structure.status_config()
    rows = cfg['types'].get(type_name)
    if rows is None:
        raise SystemExit(f'{type_name}: not a type with statuses in this vault')
    if store.structure.statuses_locked:
        raise SystemExit(f'{store.structure.label} fixes its statuses\' names: nothing to rename')
    if old not in [r['name'] for r in rows]:
        raise SystemExit(f"{type_name}: no status {old} (it has {', '.join(r['name'] for r in rows)})")
    if new in [r['name'] for r in rows]:
        rows = [r for r in rows if r['name'] != old]  # merged into the one it has
    else:
        rows = [{**r, 'name': new} if r['name'] == old else r for r in rows]
    colors = dict(cfg['colors'])
    if old in colors and new not in colors:
        colors[new] = colors.pop(old)
    colors.pop(old, None)
    return store.save_status_config({'types': {**cfg['types'], type_name: rows}, 'colors': colors}, {type_name: {old: new}})


def backup(root):
    dest = server.backup_path(f"{os.path.basename(root)}.backup-{datetime.now().strftime('%Y-%m-%d_%H%M%S')}")
    shutil.copytree(root, dest, symlinks=True)
    return dest


def show(vault_id, cfg, out):
    out.write(f"\n{vault_id} ({cfg['structure']}{', names fixed' if cfg['locked'] else ''}) — statuses.json: "
              f"{'saved' if cfg['saved'] else 'none yet'}{' · ' + cfg['error'] if cfg['error'] else ''}\n")
    for t in cfg['types']:
        groups = {}
        for s in t['statuses']:
            groups.setdefault(s['group'], []).append(f"{s['name']} {s['count']}" if s['count'] else s['name'])
        out.write(f"  {t['label']}: " + ' | '.join(f"{g}: {', '.join(v)}" for g, v in groups.items()) + '\n')
        if t['unknown']:
            unknown = ', '.join(f"{u['name']} ({u['count']})" for u in t['unknown'])
            out.write(f'    ! not its statuses: {unknown}\n')


def main(argv=None, out=sys.stdout):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--config', help='config.json to read the vaults from (default: the app\'s)')
    ap.add_argument('--vault', help='only this vault (its id)')
    ap.add_argument('--remap', help='TYPE:OLD=NEW — rename OLD to NEW in that type (needs --vault)')
    ap.add_argument('--apply', action='store_true', help='write (without it: only say what is there and what would change)')
    ap.add_argument('--no-backup', action='store_true', help='with --remap --apply: no copy of the vault first')
    ap.add_argument('--json', action='store_true', help='the plan as JSON')
    a = ap.parse_args(argv)
    if a.config:
        server.CONFIG_PATH = os.path.abspath(a.config)
    cfg = server.load_config()
    ids = [a.vault] if a.vault else [v['id'] for v in cfg['vaults']]
    if a.remap and not a.vault:
        raise SystemExit('--remap needs --vault')
    report, failed = {}, False
    for vid in ids:
        try:
            store = server.open_vault_store(vid, structures=tuple(server.REGISTRY))
        except ValueError as e:
            report[vid] = {'refused': str(e)}
            out.write(f'\n{vid}: refused — {e}\n')
            failed = True
            continue
        if a.remap:
            type_name, old, new = parse_remap(a.remap)
            if not a.apply:
                show(vid, plan(store), out)
                out.write(f'\n  would rename {type_name}: {old} → {new} (run again with --apply)\n')
                continue
            if not a.no_backup:
                out.write(f'  backup: {backup(store.root)}\n')
            try:
                done = remap(store, type_name, old, new)
            except StoreError as e:
                raise SystemExit(f'{vid}: {e}')
            out.write(f"  {type_name}: {old} → {new}, {done['moved']} item(s) moved\n")
            continue
        now = plan(store)
        report[vid] = now
        if not a.json:
            show(vid, now, out)
        if a.apply:
            if drift(now):
                out.write(f'  left alone: items with statuses their type does not have — move them first ({drift(now)})\n')
                failed = True
                continue
            out.write(f'  statuses.json: {seed(store)}\n')
    if a.json:
        json.dump(report, out, indent=2, ensure_ascii=False)
        out.write('\n')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
