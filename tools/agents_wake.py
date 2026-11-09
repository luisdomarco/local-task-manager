#!/usr/bin/env python3
"""Wakes the installed app when a scheduled agent run is due: the second LaunchAgent of tools/install_app.py runs this
every 5 minutes. The app runs on demand — launchd starts it on the first connection to its port — so after a restart,
or once stopped in Settings → App, nothing would run its schedules until it is opened. This reads agent-schedules.json
next to the app's config.json and only when a schedule fires within the next few minutes (or should have already)
connects to the app's port, which starts it; its scheduler (server.py tick) does the rest. With no schedule due it
does nothing, and the app stays off. Stdlib only.

    python3 tools/agents_wake.py            # from the app's folder (the LaunchAgent's way)
    python3 tools/agents_wake.py --dry-run  # say whether it would wake it
"""
import argparse
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from tm import schedules  # noqa: E402

INTERVAL = 300                       # seconds: the LaunchAgent's StartInterval
WITHIN_MS = (INTERVAL + 60) * 1000   # due before the next look, with a minute to spare
SCHEDULES = 'agent-schedules.json'


def port_of(app):
    try:
        with open(os.path.join(app, 'config.json'), encoding='utf-8') as f:
            return int(json.load(f).get('port') or 3200)
    except (OSError, ValueError, TypeError):
        return 3200


def due(app, now_ms=None):
    """Whether a schedule of the app at `app` is due by the next look."""
    now = int(time.time() * 1000) if now_ms is None else now_ms
    return schedules.due_soon(os.path.join(app, SCHEDULES), now, WITHIN_MS)


def wake(app, now_ms=None, connect=None):
    """Connects to the app (starting it) when a schedule is due. → True when it did."""
    if not due(app, now_ms):
        return False
    url = f'http://127.0.0.1:{port_of(app)}/api/server'
    (connect or (lambda u: urllib.request.urlopen(u, timeout=30).read()))(url)
    return True


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    p.add_argument('--dry-run', action='store_true', help='say whether a schedule is due, connect to nothing')
    a = p.parse_args(argv)
    if a.dry_run:
        print('A schedule is due: it would wake the app.' if due(HERE) else 'Nothing due: it would leave the app as it is.')
        return
    try:
        if wake(HERE):
            print(time.strftime('%Y-%m-%d %H:%M:%S'), 'woke the app for a scheduled run', flush=True)
    except OSError as e:  # the app not installed as it should be: said in the log, tried again at the next look
        print(time.strftime('%Y-%m-%d %H:%M:%S'), f'could not reach the app: {e}', flush=True)


if __name__ == '__main__':
    main()
