#!/usr/bin/env python3
"""Task Manager as a Mac app, without a developer account or a database (TSK-030): a copy of the app in its own
folder, started on demand by a LaunchAgent — launchd listens on its port while it is off and starts it on the first
connection, which is opening the app — and opened from the Dock as a web app (Safari: File → Add to Dock; Chrome:
⋮ → Cast, save and share → Install page as app). Settings → App stops it; the next opening starts it again.

    python3 tools/install_app.py             # install (or reinstall) and start it — http://localhost:3200
    python3 tools/install_app.py --update    # copy this checkout's code over the app's, and restart it
    python3 tools/install_app.py --uninstall # stop it and take it out; its config.json stays
    python3 tools/install_app.py --dry-run   # say what it would do, do nothing

Its own folder, so nothing of this checkout is touched: ~/Library/Application Support/TaskManager/app holds the code
(copied, never linked: work in progress here never reaches the app until --update) and its own config.json, made once
from this checkout's with its own port (3200, so both can run at once) and never overwritten after. The vaults stay
where they are: both see the same files. Logs: ~/Library/Logs/TaskManager/.
"""
import argparse
import json
import os
import plistlib
import shutil
import socket
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from tm import export  # noqa: E402  (its exclusions: what never travels with the code)

LABEL = 'com.taskmanager.app'
PORT = 3200
# What the app needs to run: the server, the page, the tools it may call, and the sample vault (the default root).
APP_FILES = ('server.py', 'tm', 'static', 'docs', 'tools', 'sample-vault', 'sample-vault-ticketing', 'README.md', 'package.json', 'config.example.json')


def locations(home):
    base = os.path.join(home, 'Library', 'Application Support', 'TaskManager')
    return {
        'app': os.path.join(base, 'app'),
        'plist': os.path.join(home, 'Library', 'LaunchAgents', f'{LABEL}.plist'),
        'logs': os.path.join(home, 'Library', 'Logs', 'TaskManager'),
    }


def _ignore(src, names):
    rel = os.path.relpath(src, HERE).replace(os.sep, '/')
    out = set()
    for n in names:
        path = n if rel == '.' else f'{rel}/{n}'
        if n in export.EXCLUDE_DIRS or path in export.EXCLUDE_DIRS or n in export.EXCLUDE_FILES or n.endswith(export.EXCLUDE_SUFFIXES):
            out.add(n)
    return out


def copy_code(src, app):
    """This checkout's code into the app's folder: each of APP_FILES replaced whole; anything else there (its
    config.json and its backups) left alone."""
    os.makedirs(app, exist_ok=True)
    for name in APP_FILES:
        s, d = os.path.join(src, name), os.path.join(app, name)
        if not os.path.exists(s):
            continue
        if os.path.isdir(d) and not os.path.islink(d):
            shutil.rmtree(d)
        elif os.path.lexists(d):
            os.remove(d)
        if os.path.isdir(s):
            shutil.copytree(s, d, ignore=_ignore)
        else:
            shutil.copy2(s, d)


def mark_source(src, app):
    """install.json: the checkout this copy came from. Settings → Export makes the system and agents zips from it
    (the copy has no .git, tests or .claude) and keeps every zip in its versions/ (tm/export.py home())."""
    with open(os.path.join(app, export.INSTALL_FILE), 'w', encoding='utf-8') as f:
        json.dump({'source': os.path.realpath(src)}, f, indent=2)
        f.write('\n')


def first_config(src, app, port=PORT):
    """The app's config.json, made once from this checkout's (its vaults, its Claude settings) with its own port, and
    the vault paths made absolute (a relative one would point inside the app's folder). → True when made now."""
    target = os.path.join(app, 'config.json')
    if os.path.exists(target):
        return False
    cfg = {}
    source = os.path.join(src, 'config.json')
    if os.path.exists(source):
        with open(source, encoding='utf-8') as f:
            cfg = json.load(f)
    absolute = lambda p: p if not p or os.path.isabs(os.path.expanduser(p)) else os.path.join(src, p)  # noqa: E731
    if cfg.get('root'):
        cfg['root'] = absolute(cfg['root'])
    for v in cfg.get('vaults') or []:
        v['path'] = absolute(v.get('path') or '')
    cfg['port'] = port
    with open(target, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
        f.write('\n')
    return True


def agent(python, app, logs, home, port=PORT):
    """The LaunchAgent: launchd listens on the app's port (127.0.0.1 only) and starts its server on the first
    connection, handing it that socket (tm/launchd.py). Nothing runs while the app is off; a server that stops
    (Settings → App) is started again by the next connection. A LaunchAgent starts with a bare PATH, so it gets the
    folders `claude` and node usually live in (the embedded terminal runs `claude`)."""
    return {
        'Label': LABEL,
        'ProgramArguments': [python, os.path.join(app, 'server.py')],
        'WorkingDirectory': app,
        'Sockets': {'Listeners': {'SockNodeName': '127.0.0.1', 'SockServiceName': str(port), 'SockType': 'stream',
                                  'SockFamily': 'IPv4'}},
        'ProcessType': 'Interactive',
        'EnvironmentVariables': {
            'PATH': f'{home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
            'LANG': 'en_US.UTF-8',
            'HOME': home,
        },
        'StandardOutPath': os.path.join(logs, 'server.log'),
        'StandardErrorPath': os.path.join(logs, 'server.log'),
    }


def _domain():
    return f'gui/{os.getuid()}'


def settle(port, timeout=10.0):
    """Waits for a booted-out agent to be gone and its port free: `launchctl bootout` returns before launchd has let
    the old one go, and a bootstrap made meanwhile fails (5: Input/output error) on the port it still holds."""
    end = time.time() + timeout
    while time.time() < end:
        loaded = subprocess.run(['launchctl', 'print', f'{_domain()}/{LABEL}'], capture_output=True).returncode == 0
        free = True
        with socket.socket() as s:
            try:
                s.bind(('127.0.0.1', port))
            except OSError:
                free = False
        if not loaded and free:
            return True
        time.sleep(0.2)
    return False


def install(src, home, python, run, port=PORT, wait=settle):
    where = locations(home)
    copy_code(src, where['app'])
    mark_source(src, where['app'])
    made = first_config(src, where['app'], port)
    os.makedirs(where['logs'], exist_ok=True)
    os.makedirs(os.path.dirname(where['plist']), exist_ok=True)
    with open(os.path.join(where['app'], 'config.json'), encoding='utf-8') as f:
        app_port = int(json.load(f).get('port') or port)  # its own, kept from an earlier install
    with open(where['plist'], 'wb') as f:
        plistlib.dump(agent(python, where['app'], where['logs'], home, app_port), f)
    run(['launchctl', 'bootout', f'{_domain()}/{LABEL}'], check=False)  # a previous install: stopped first
    wait(app_port)
    try:
        run(['launchctl', 'bootstrap', _domain(), where['plist']], check=True)
    except subprocess.CalledProcessError:  # launchd still letting the old one go: once more, a moment later
        time.sleep(2)
        wait(app_port)
        run(['launchctl', 'bootstrap', _domain(), where['plist']], check=True)
    return {'app': where['app'], 'config_made': made, 'plist': where['plist'], 'port': app_port}


def update(src, home, run):
    where = locations(home)
    if not os.path.exists(where['plist']):
        raise SystemExit('Not installed yet: run it without --update first.')
    copy_code(src, where['app'])
    mark_source(src, where['app'])
    # Running: stopped, so the next opening starts the new code. Off: nothing to do, it starts on the next opening.
    run(['launchctl', 'kill', 'SIGTERM', f'{_domain()}/{LABEL}'], check=False)
    return {'app': where['app']}


def uninstall(home, run):
    where = locations(home)
    run(['launchctl', 'bootout', f'{_domain()}/{LABEL}'], check=False)
    if os.path.exists(where['plist']):
        os.remove(where['plist'])
    for name in (*APP_FILES, export.INSTALL_FILE):  # the code goes; its config.json (and backups) stay, for a later install
        d = os.path.join(where['app'], name)
        if os.path.isdir(d) and not os.path.islink(d):
            shutil.rmtree(d)
        elif os.path.lexists(d):
            os.remove(d)
    return {'kept': os.path.join(where['app'], 'config.json')}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    g = p.add_mutually_exclusive_group()
    g.add_argument('--update', action='store_true', help="copy this checkout's code over the app's and restart it")
    g.add_argument('--uninstall', action='store_true', help='stop it and take it out (its config.json stays)')
    p.add_argument('--dry-run', action='store_true', help='say what it would do, do nothing')
    p.add_argument('--port', type=int, default=PORT, help=f'the port of a new install (default {PORT})')
    a = p.parse_args(argv)
    if sys.platform != 'darwin':
        raise SystemExit('This installs a macOS LaunchAgent: macOS only.')
    home = os.path.expanduser('~')
    python = os.path.realpath(sys.executable)
    where = locations(home)
    if a.dry_run:
        what = 'update' if a.update else 'uninstall' if a.uninstall else 'install'
        print(f'Would {what}:\n  code    {where["app"]}\n  agent   {where["plist"]} ({LABEL})\n  logs    {where["logs"]}\n'
              f'  python  {python}\n  url     http://localhost:{a.port}')
        return
    run = subprocess.run
    if a.uninstall:
        out = uninstall(home, run)
        print(f'Uninstalled. Its settings stay in {out["kept"]}.')
    elif a.update:
        update(HERE, home, run)
        print('Updated: the next opening runs the new code.')
    else:
        out = install(HERE, home, python, run, a.port)
        print(f'Installed in {out["app"]}' + (' (its config.json made from this checkout\'s)' if out['config_made'] else ''))
        print(f'It starts when opened: http://localhost:{out["port"]} — in Safari, File → Add to Dock. Settings → App stops it.')


if __name__ == '__main__':
    main()
