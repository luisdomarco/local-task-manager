"""Scheduled agent runs (server.py tick): a command of an agent folder run on its own, by a rule in plain words.

A rule is one of
  {'every': 'day',     'at': 'HH:MM'}                  every day at that time
  {'every': 'weekday', 'at': 'HH:MM'}                  Monday to Friday
  {'every': 'week',    'at': 'HH:MM', 'days': [0, 2]}  on those days (0 Monday … 6 Sunday)
  {'every': 'hours',   'at': 'HH:MM', 'hours': N}      every N hours, counted from `at` each day (N 1–24)
always in this computer's local time. `next_fire` is pure (a rule and a moment → the next moment it fires) so it is
tested with a fixed clock. The schedules are one list for this computer, as the runs are (tm/agentruns.py), in
agent-schedules.json next to config.json. Stdlib only."""
import datetime as dt
import json
import os
import re
import secrets
import threading
import time

from tm.fsutil import atomic_write

EVERY = ('day', 'weekday', 'week', 'hours')
DAY_NAMES = ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')
MAX = 100
ID_RE = re.compile(r'^sch-[0-9a-f]{8}$')
CATCH_UP_MS = 12 * 3600 * 1000  # a fire missed by less than this (the app was off, the Mac asleep) still runs, once
SHORT = ('dir', 'cmd', 'mode', 'model', 'effort', 'where', 'last_run', 'created_at')
INTS = ('next_ts', 'last_ts', 'missed_ts', 'skipped_ts', 'error_ts')
_lock = threading.Lock()
_TIME_RE = re.compile(r'^([01]?\d|2[0-3]):([0-5]\d)$')


def normalize(rule):
    """A rule as kept, checked → dict; ValueError with words for the page when it is not one."""
    if not isinstance(rule, dict):
        raise ValueError('a schedule needs a rule')
    every = str(rule.get('every') or '').strip()
    if every not in EVERY:
        raise ValueError(f"every must be one of {', '.join(EVERY)}")
    m = _TIME_RE.match(str(rule.get('at') or '').strip())
    if not m:
        raise ValueError('at must be a time, HH:MM')
    out = {'every': every, 'at': f'{int(m.group(1)):02d}:{m.group(2)}'}
    if every == 'week':
        days = rule.get('days')
        if not isinstance(days, list) or not days:
            raise ValueError('a weekly schedule needs at least one day')
        try:
            picked = sorted({int(d) for d in days})
        except (TypeError, ValueError):
            raise ValueError('days are numbers, 0 (Monday) to 6 (Sunday)')
        if picked[0] < 0 or picked[-1] > 6:
            raise ValueError('days are numbers, 0 (Monday) to 6 (Sunday)')
        out['days'] = picked
    if every == 'hours':
        try:
            hours = int(rule.get('hours'))
        except (TypeError, ValueError):
            raise ValueError('hours must be a whole number, 1 to 24')
        if not 1 <= hours <= 24:
            raise ValueError('hours must be a whole number, 1 to 24')
        out['hours'] = hours
    return out


def _times_of_day(rule):
    """The (hour, minute) the rule fires at on a day it fires, in order."""
    h, m = (int(x) for x in rule['at'].split(':'))
    if rule['every'] != 'hours':
        return [(h, m)]
    start = h * 60 + m
    return [divmod(t, 60) for t in range(start, 24 * 60, rule['hours'] * 60)]


def _fires_on(rule, day):
    wd = day.weekday()
    if rule['every'] == 'weekday':
        return wd < 5
    if rule['every'] == 'week':
        return wd in rule['days']
    return True


def next_fire(rule, after):
    """The first moment strictly after `after` (a naive local datetime) the rule fires at."""
    rule = normalize(rule)
    day = after.date()
    for _ in range(9):  # a weekly rule fires within 7 days; two more for good measure
        if _fires_on(rule, day):
            for h, m in _times_of_day(rule):
                at = dt.datetime(day.year, day.month, day.day, h, m)
                if at > after:
                    return at
        day += dt.timedelta(days=1)
    raise ValueError('this rule never fires')  # normalize makes it unreachable


def next_ts(rule, now_ms):
    """next_fire in ms since the epoch, from ms since the epoch (local time in between)."""
    after = dt.datetime.fromtimestamp(now_ms / 1000)
    return int(time.mktime(next_fire(rule, after).timetuple()) * 1000)


def _clock(at):
    h, m = at.split(':')
    return f'{int(h)}:{m}'


def label(rule):
    """The rule in words: 'Every weekday at 9:00', 'Every Mon, Thu at 18:30', 'Every 6 hours from 0:00'."""
    rule = normalize(rule)
    at = _clock(rule['at'])
    if rule['every'] == 'day':
        return f'Every day at {at}'
    days = rule.get('days')
    if rule['every'] == 'weekday' or days == [0, 1, 2, 3, 4]:
        return f'Every weekday at {at}'
    if days == list(range(7)):
        return f'Every day at {at}'
    if rule['every'] == 'week':
        return f"Every {', '.join(DAY_NAMES[d] for d in rule['days'])} at {at}"
    n = rule['hours']
    return f'Every hour from {at}' if n == 1 else f'Every {n} hours from {at}'


# ── storage ──────────────────────────────────────────────────────────────────

def clean(raw):
    """The schedules as stored: an id (sch-<8 hex>), a folder, a command and a rule that holds, or it is dropped."""
    out = {}
    for s in raw if isinstance(raw, list) else []:
        if not isinstance(s, dict) or not ID_RE.match(str(s.get('id') or '')):
            continue
        try:
            rule = normalize(s.get('rule'))
        except ValueError:
            continue
        entry = {'id': s['id'], 'rule': rule, 'args': ' '.join(str(s.get('args') or '').split())[:300], 'paused': s.get('paused') is True}
        for k in SHORT:
            if s.get(k):
                entry[k] = str(s[k]).strip()[:80]
        for k in INTS:
            if isinstance(s.get(k), (int, float)) and not isinstance(s.get(k), bool):
                entry[k] = int(s[k])
        if s.get('error'):
            entry['error'] = str(s['error'])[:300]
        if not entry.get('dir') or not entry.get('cmd'):
            continue
        out[entry['id']] = entry
    return list(out.values())[:MAX]


def load(path):
    """Every schedule. A file missing or not readable is none, never an error."""
    try:
        with open(path, encoding='utf-8') as f:
            return clean(json.load(f).get('schedules'))
    except (OSError, ValueError, AttributeError):
        return []


def _save(path, items):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    atomic_write(path, json.dumps({'schedules': clean(items)}, indent=1, ensure_ascii=False) + '\n')


def add(path, entry):
    """A new schedule (its id made here) → as stored."""
    with _lock:
        items = load(path)
        if len(items) >= MAX:
            raise ValueError(f'at most {MAX} schedules')
        new = {**entry, 'id': f'sch-{secrets.token_hex(4)}'}
        _save(path, items + [new])
    return next(s for s in load(path) if s['id'] == new['id'])


def update(path, sid, **fields):
    """Sets fields on one schedule (None removes one) → as stored, or None when there is no such schedule."""
    with _lock:
        items = load(path)
        hit = next((s for s in items if s['id'] == sid), None)
        if not hit:
            return None
        for k, v in fields.items():
            if v is None:
                hit.pop(k, None)
            else:
                hit[k] = v
        _save(path, items)
    return next((s for s in load(path) if s['id'] == sid), None)


def remove(path, sid):
    with _lock:
        items = load(path)
        kept = [s for s in items if s['id'] != sid]
        if len(kept) == len(items):
            return False
        _save(path, kept)
    return True


def due_soon(path, now_ms, within_ms):
    """Whether a schedule that is not paused fires by now + within_ms, or should have already: what
    tools/agents_wake.py asks before it wakes the installed app (one long overdue wakes it too, so the server marks it
    missed and moves it on)."""
    return any(not s['paused'] and 'next_ts' in s and s['next_ts'] <= now_ms + within_ms for s in load(path))
