"""The activity journal: what was done in the Task Manager, day by day, to know later what you worked on.

One Markdown file per day, <vault>/.task-manager/journal/YYYY/YYYY-MM-DD.md: a hidden folder, so neither the item
scan nor the vault check sees it. Its frontmatter keeps the entries; its body lists them to be read:

    type: journal
    date: 2026-10-23
    entries: [{"at": "09:42", "until": "09:55", "actor": "app", "action": "edited", "id": "TSK-0012",
               "type": "task", "title": "…", "detail": "description", "count": 14}]

Only the server writes it, after a request that went well (server.py calls record()): what the page does (actor
`app`, sent as X-TM-Actor), and anything else that calls the API (`api`, or the X-TM-Actor it sends, such as
`claude:<session>`). The syncs and the commands write through a Store of their own, in their own process, and never
pass through here: by design they are not in the journal. Nor are the page's own arrangements (pins, sidebar, the
Board's and Today's columns, settings) or the terminal's input.

The same thing done again and again within MERGE_MINUTES (the description saving as you type, a doc's autosave) is
one entry: `until` and `count` grow. A status change is never merged: each one says from what to what.
"""
import os
import re
import threading
from datetime import datetime, timedelta

from . import frontmatter as fm
from .fsutil import atomic_write

JOURNAL_DIR = 'journal'  # in the vault's META_DIR
MERGE_MINUTES = 10
ACTOR_RE = re.compile(r'^[A-Za-z0-9:._-]{1,80}$')
_lock = threading.Lock()
# Fields that change on every write, or that a person never edits as such: not "what was edited".
QUIET_FIELDS = {'updated_at', 'completed_at', 'resolved_at', 'rev', 'body_rev', 'plan_order', 'week_order', 'order'}


def actor_of(header):
    """Who made a request, from its X-TM-Actor header: `app` (the page), `claude:<session>`…; `api` without one."""
    value = str(header or '').strip()
    return value if ACTOR_RE.match(value) else 'api'


def day_path(meta_root, day):
    return os.path.join(meta_root, JOURNAL_DIR, day[:4], f'{day}.md')


def _item(it):
    return {'id': it.get('id') or None, 'type': it.get('type'), 'title': it.get('title') or (it.get('fields') or {}).get('subject')}


def _changed(before, after):
    """The fields an update changed (names; `status` as "status: A → B"), and whether the description did."""
    b, a = (before or {}).get('fields') or {}, (after or {}).get('fields') or {}
    names = sorted(k for k in set(a) | set(b) if k not in QUIET_FIELDS and a.get(k) != b.get(k))
    return [f"status: {b.get('status')} → {a.get('status')}" if k == 'status' else k for k in names]


def _text(value, size=80):
    value = ' '.join(str(value or '').split())
    return value if len(value) <= size else value[:size - 1] + '…'


def describe(path, body, before, result):
    """The journal entry of a request to `path` (a POST route) that went well, or None when it is not one to keep.
    `before` is the item as it was (an update, a delete…), `result` what the route answered."""
    body = body or {}
    res = result if isinstance(result, dict) else {}
    if path == '/api/item/create':
        return {'action': 'created', **_item(res), 'detail': ''}
    if path == '/api/item/update':
        changed = _changed(before, res)
        if body.get('body') is not None and (before or {}).get('body_rev') != res.get('body_rev'):
            changed.append('description')
        return {'action': 'edited', **_item(res), 'detail': ', '.join(changed)} if changed else None
    if path == '/api/item/delete':
        return {'action': 'deleted', **_item(before or {}), 'detail': ''}
    if path in ('/api/item/restore', '/api/trash/restore'):
        return {'action': 'restored', 'id': None, 'type': None, 'title': _text(body.get('trashed')), 'detail': ''}
    if path == '/api/item/comment':
        return {'action': 'commented', **_item(before or res), 'detail': _text(body.get('text'))}
    if path == '/api/item/comment/delete':
        return {'action': 'deleted a comment', **_item(before or res), 'detail': ''}
    if path == '/api/item/convert':
        return {'action': 'converted', **_item(res), 'detail': f"{(before or {}).get('type')} → {res.get('type')}"}
    if path == '/api/item/action':
        return {'action': _text(body.get('action'), 40) or 'action', **_item(before or res), 'detail': ''}
    if path in ('/api/attachments/add', '/api/attachments/remove', '/api/attachments/restore'):
        verb = {'add': 'attached a file', 'remove': 'removed a file', 'restore': 'restored a file'}[path.rsplit('/', 1)[1]]
        return {'action': verb, **_item(before or {}), 'detail': _text(body.get('filename') or body.get('path'))}
    if path in ('/api/worklog', '/api/worklog/update', '/api/worklog/delete', '/api/worklog/confirm', '/api/worklog/discard'):
        verb = {'worklog': 'logged work', 'update': 'edited a work log entry', 'delete': 'deleted a work log entry',
                'confirm': 'confirmed work log', 'discard': 'discarded tentative work log'}[path.rsplit('/', 1)[1]]
        it = before or {}
        detail = ' · '.join(x for x in (body.get('kind'), body.get('time'), body.get('date'), _text(body.get('note'), 60)) if x)
        return {'action': verb, **_item(it), 'detail': detail}
    if path in ('/api/item/claude', '/api/term/open', '/api/claude/resume', '/api/term/resume'):
        verb = 'resumed Claude' if 'resume' in path else 'started Claude'
        return {'action': verb, **_item(before or {}), 'detail': _text(body.get('instruction'), 100)}
    if path.startswith('/api/files/') or path.startswith('/api/docs/'):
        verb = {'save': 'edited a file', 'create': 'created a file', 'rename': 'renamed a file', 'move': 'moved a file',
                'delete': 'deleted a file', 'duplicate': 'duplicated a file', 'upload': 'uploaded a file',
                'mkdir': 'created a folder', 'restore': 'restored a file', 'props': 'edited a doc',
                'from-note': 'made a doc from a note'}.get(path.rsplit('/', 1)[1])
        if not verb:
            return None
        where = body.get('path') or body.get('key') or body.get('filename') or ''
        return {'action': verb, 'id': None, 'type': 'file', 'title': _text(where, 120), 'detail': _text(body.get('name') or body.get('to'))}
    for kind in ('people', 'groups', 'labels'):
        if path.startswith(f'/api/{kind}'):
            what = {'people': 'contact', 'groups': 'group', 'labels': 'label'}[kind]
            verb = {'': 'added', 'rename': 'renamed', 'delete': 'deleted', 'update': 'edited', 'to-group': 'made a group of'}.get(
                path[len(f'/api/{kind}'):].lstrip('/'))
            if not verb:
                return None
            name = body.get('name') or body.get('old')
            return {'action': f'{verb} {what}', 'id': None, 'type': what, 'title': _text(name),
                    'detail': _text(body.get('new') or ((body.get('values') or {}).get('name') if verb == 'edited' else ''))}
    return None


# The routes that read the item first, to say what changed or what was deleted: where its key is in the request.
BEFORE_KEY = {'/api/item/update': 'key', '/api/item/delete': 'key', '/api/item/comment': 'key', '/api/item/comment/delete': 'key',
              '/api/item/convert': 'key', '/api/item/action': 'key', '/api/attachments/remove': 'key',
              '/api/attachments/restore': 'key', '/api/worklog': 'id', '/api/item/claude': 'key', '/api/term/open': 'key',
              '/api/claude/resume': 'key', '/api/term/resume': 'key'}


def _merge_key(e):
    """What makes two entries the same thing done again: a status change never is."""
    if e['action'] == 'edited' and 'status:' in (e.get('detail') or ''):
        return None
    return (e.get('actor'), e['action'], e.get('id') or e.get('title'), e.get('detail'))


def record(meta_root, actor, entry, now=None):
    """Add `entry` (describe()'s) to the day's journal, by `actor`; merged into the last one when it is the same
    thing done again within MERGE_MINUTES."""
    if not entry:
        return
    now = now or datetime.now()
    day, clock = now.strftime('%Y-%m-%d'), now.strftime('%H:%M')
    entry = {'at': clock, 'actor': actor, **{k: v for k, v in entry.items() if v not in (None, '')}}
    path = day_path(meta_root, day)
    with _lock:
        entries = read_day(meta_root, day)
        last = entries[-1] if entries else None
        key = _merge_key(entry)
        if last and key is not None and _merge_key(last) == key:
            since = datetime.strptime(f"{day} {last.get('until') or last['at']}", '%Y-%m-%d %H:%M')
            if now - since <= timedelta(minutes=MERGE_MINUTES):
                last['until'] = clock
                last['count'] = int(last.get('count') or 1) + 1
                entry = None
        if entry:
            entries.append(entry)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        atomic_write(path, fm.build({'type': 'journal', 'date': day, 'entries': entries}, _body(day, entries)))


def read_day(meta_root, day):
    """The entries of a day's journal ([] when there is none, or it cannot be read)."""
    path = day_path(meta_root, day)
    if not os.path.exists(path):
        return []
    try:
        with open(path, encoding='utf-8') as f:
            entries = fm.parse(fm.split(f.read())[0]).get('entries')
    except (OSError, ValueError):
        return []
    return [e for e in entries or [] if isinstance(e, dict) and e.get('at')] if isinstance(entries, list) else []


def _body(day, entries):
    lines = [f'# Journal · {day}', '', 'What was done in the Task Manager this day (written by the app; the syncs are not here).', '']
    for e in entries:
        when = f"{e['at']}–{e['until']}" if e.get('until') else e['at']
        what = ' '.join(x for x in (e.get('id'), f"«{e['title']}»" if e.get('title') else None) if x)
        tail = ' — '.join(x for x in (e.get('detail'), f"×{e['count']}" if e.get('count') else None) if x)
        lines.append(f"- {when} · {e.get('actor')} · {e['action']} {what}" + (f' — {tail}' if tail else ''))
    return '\n'.join(lines) + '\n'
