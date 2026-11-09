"""The runs of the Agents section: every command run from the app (server.py run_agent, launch_agent), to list them on
the agent's page and resume them. One list for this computer, not one per vault — the agent folders are the same in
every vault — kept in a JSON file next to config.json, oldest first, the newest MAX. Stdlib only."""
import json
import os
import threading

from tm.fsutil import atomic_write
from tm.launch import SESSION_RE

MAX = 500
TEXT_MAX = 300  # characters of a run's arguments kept (the message itself is cut at server.py AGENT_ARGS_MAX)
SHORT = ('dir', 'cmd', 'mode', 'model', 'effort', 'target')  # short words: at most 80 characters each
_lock = threading.Lock()


def clean(raw):
    """The runs as stored: id (a session UUID) and cwd (where a resume runs) or the entry is dropped; at, the folder's id
    and the command, its arguments, and how it ran — mode, model, effort, and where (`here`: the dock, or an Open in
    target). Anything else is dropped; a later entry of the same id replaces the earlier one."""
    out = {}
    for r in raw if isinstance(raw, list) else []:
        if not isinstance(r, dict):
            continue
        sid = str(r.get('id') or '').strip().lower()
        cwd = str(r.get('cwd') or '').strip()
        if not SESSION_RE.match(sid) or not cwd:
            continue
        entry = {'id': sid, 'at': str(r.get('at') or '')[:40], 'cwd': cwd, 'args': ' '.join(str(r.get('args') or '').split())[:TEXT_MAX]}
        for k in SHORT:
            if r.get(k):
                entry[k] = str(r[k]).strip()[:80]
        out.pop(sid, None)
        out[sid] = entry
    return list(out.values())[-MAX:]


def load(path):
    """Every run on record, oldest first. A file missing or not readable is no runs, never an error."""
    try:
        with open(path, encoding='utf-8') as f:
            return clean(json.load(f).get('runs'))
    except (OSError, ValueError, AttributeError):
        return []


def _save(path, runs):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    atomic_write(path, json.dumps({'runs': clean(runs)}, indent=1, ensure_ascii=False) + '\n')


def add(path, entry):
    with _lock:
        _save(path, load(path) + [entry])
    return entry


def find(path, session_id):
    sid = str(session_id or '').strip().lower()
    return next((r for r in load(path) if r['id'] == sid), None)


def forget(path, session_id):
    """Drops one run from the list (its conversation stays in Claude Code). → whether it was there."""
    sid = str(session_id or '').strip().lower()
    with _lock:
        runs = load(path)
        kept = [r for r in runs if r['id'] != sid]
        if len(kept) != len(runs):
            _save(path, kept)
    return len(kept) != len(runs)


def of(runs, dir_id=None, name=None):
    """The runs of one folder, or of one of its commands; newest first."""
    return [r for r in reversed(runs) if (not dir_id or r.get('dir') == dir_id) and (not name or r.get('cmd') == name)]
