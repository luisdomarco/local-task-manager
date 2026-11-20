"""Reminders: when an item planned for a day at a time, or a meeting, rings before it starts. Stdlib only.

An item's moment is its planned day (`plan_day`) at its `plan_time`, or a meeting's `date` at its `time`; one with no
time has no moment and never rings. What rings before it is the item's `reminders` (offsets of OFFSETS), and whether
it rings as an alarm its `reminder_urgent`. Either one left blank (absent in the file, or `reminders:` with no value)
follows the vault's own default (Settings → Reminders, kept in the vault's .task-manager/settings.json, so the Mac and
the iPhone read the same), and follows it live: changing Settings changes every item that has none of its own.
`reminders: []` is "no reminder", whatever the default.

The Mac rings them from the server's scheduler (server.py ring_reminders), the iPhone schedules them with iOS from
`GET /api/reminders`; `upcoming` is what both read. Everything here is pure (a moment in, a list out), so it is
tested with a fixed clock, in this computer's local time."""
import datetime as dt
import re

# Before the moment: id as kept on disk, minutes, words. In this order everywhere (the page's copy is
# static/js/reminders.js OFFSETS; tests/test_reminders.py holds them equal).
OFFSETS = (
    ('at', 0, 'At the time'),
    ('10m', 10, '10 minutes before'),
    ('30m', 30, '30 minutes before'),
    ('1h', 60, '1 hour before'),
    ('2h', 120, '2 hours before'),
    ('1d', 1440, '1 day before'),
)
MINUTES = {k: m for k, m, _ in OFFSETS}
RANK = {k: i for i, (k, _, _) in enumerate(OFFSETS)}

# A vault with nothing in its Settings → Reminders: a task with a time rings 10 minutes before, as a notification, and
# takes 30 minutes.
DEFAULTS = {'on': True, 'offsets': ['10m'], 'urgent': False, 'duration': '00:30'}

_TIME_RE = re.compile(r'^([01]?\d|2[0-3]):([0-5]\d)$')
_DURATION_RE = re.compile(r'^(\d{1,3}):([0-5]\d)$')
_DAY_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def clean_offsets(raw):
    """What an item or Settings keeps as its offsets: None (nothing of its own) stays None; anything else is the list of
    known offsets, each once, in OFFSETS order ([] = none). A comma-separated text is a list (tools/vault.py)."""
    if raw is None or raw == '':
        return None
    if isinstance(raw, str):
        raw = [p for p in raw.split(',')]
    if not isinstance(raw, (list, tuple)):
        raise ValueError(f"reminders must be a list of {', '.join(MINUTES)}")
    picked = {str(x).strip() for x in raw if str(x or '').strip()}
    unknown = sorted(picked - set(MINUTES))
    if unknown:
        raise ValueError(f"unknown reminder {', '.join(unknown)}: one of {', '.join(MINUTES)}")
    return sorted(picked, key=RANK.get)


def minutes_of(duration):
    """'01:15' → 75; None for anything that is not a duration longer than none."""
    m = _DURATION_RE.match(str(duration or '').strip())
    total = int(m.group(1)) * 60 + int(m.group(2)) if m else 0
    return total or None


def clean_settings(raw):
    """Settings → Reminders as the vault keeps them, checked: {on, offsets, urgent, duration}; a key not sent keeps its
    default. ValueError with words for the page when a value is not one."""
    if not isinstance(raw, dict):
        raise ValueError('reminders settings must be a map of on, offsets, urgent and duration')
    out = dict(DEFAULTS)
    if 'on' in raw:
        out['on'] = bool(raw['on'])
    if 'urgent' in raw:
        out['urgent'] = bool(raw['urgent'])
    if 'offsets' in raw:
        offsets = clean_offsets(raw['offsets'])
        if not offsets:
            raise ValueError('pick at least one reminder (or turn reminders off)')
        out['offsets'] = offsets
    if 'duration' in raw:
        total = minutes_of(raw['duration'])
        if not total:
            raise ValueError('the default duration must be HH:MM, longer than 00:00 (for example 00:30)')
        out['duration'] = f'{total // 60:02d}:{total % 60:02d}'
    return out


def settings_of(vault_settings):
    """A vault's reminder defaults: what its settings keep over DEFAULTS (a value that is not one is left out)."""
    kept = (vault_settings or {}).get('reminders')
    try:
        return clean_settings(kept) if isinstance(kept, dict) else dict(DEFAULTS)
    except ValueError:
        return dict(DEFAULTS)


def moment(fields):
    """When an item starts, as a local datetime: its planned day at its planned time, or a meeting's date at its time;
    None when it has no day or no time."""
    for day_key, time_key in (('plan_day', 'plan_time'), ('date', 'time')):
        day, time = str(fields.get(day_key) or '').strip(), str(fields.get(time_key) or '').strip()
        tm = _TIME_RE.match(time)
        if _DAY_RE.match(day) and tm:
            try:
                return dt.datetime.strptime(day, '%Y-%m-%d').replace(hour=int(tm.group(1)), minute=int(tm.group(2)))
            except ValueError:
                return None
    return None


def effective(fields, settings):
    """{offsets, urgent, duration, inherited}: what rings for an item, its own or the vault's default."""
    own = fields.get('reminders')
    own = own if isinstance(own, list) else None
    offsets = [o for o in own if o in MINUTES] if own is not None else (list(settings['offsets']) if settings['on'] else [])
    urgent = fields.get('reminder_urgent')
    duration = minutes_of(fields.get('plan_duration') or fields.get('duration')) or minutes_of(settings['duration'])
    return {'offsets': sorted(offsets, key=RANK.get), 'urgent': settings['urgent'] if urgent is None else bool(urgent),
            'duration': duration, 'inherited': own is None}


def of_item(item, settings):
    """An item's reminders: [(when, offset)] in time order; [] for one with no moment."""
    start = moment(item.get('fields') or {})
    if start is None:
        return []
    rings = effective(item['fields'], settings)
    return sorted(((start - dt.timedelta(minutes=MINUTES[o]), o) for o in rings['offsets']), key=lambda r: r[0])


def upcoming(items, settings, since, until, closed=lambda item: False, vault=None):
    """The reminders that ring in (since, until] — local datetimes —, oldest first: one entry per item and offset.
    `closed(item)` leaves out what is done or discarded; archived items are left out too."""
    out = []
    for it in items:
        f = it.get('fields') or {}
        if f.get('archived') or closed(it):
            continue
        rings = of_item(it, settings)
        if not rings:
            continue
        start = moment(f)
        urgent = effective(f, settings)['urgent']
        for when, offset in rings:
            if since < when <= until:
                out.append({'vault': vault, 'key': it['key'], 'ref': it.get('ref') or it.get('id') or '', 'title': it.get('title') or '',
                            'type': it.get('type'), 'at': when.isoformat(timespec='minutes'), 'offset': offset,
                            'start': start.isoformat(timespec='minutes'), 'urgent': urgent,
                            'id': f"{vault or ''}|{it['key']}|{offset}|{start.isoformat(timespec='minutes')}"})
    return sorted(out, key=lambda r: r['at'])


def _span(minutes):
    """75 → "1 h 15 min", 120 → "2 hours", 5 → "5 minutes"."""
    if minutes < 60:
        return f"{minutes} minute{'' if minutes == 1 else 's'}"
    hours, rest = divmod(minutes, 60)
    if rest:
        return f'{hours} h {rest} min'
    return f"{hours} hour{'' if hours == 1 else 's'}"


def words(start, now):
    """What a ringing reminder says under its title, from how far its moment is when it rings (a late one — the Mac was
    asleep — says so): "In 10 minutes · 13:30", "In 1 h 15 min · 13:30", "Tomorrow · 09:00", "Now · 13:30",
    "Started 5 minutes ago · 13:30"."""
    minutes = int(round((start - now).total_seconds() / 60))
    if minutes < 0:
        lead = f'Started {_span(-minutes)} ago'
    elif minutes == 0:
        lead = 'Now'
    elif start.date() == now.date():
        lead = f'In {_span(minutes)}'
    elif start.date() == now.date() + dt.timedelta(days=1):
        lead = 'Tomorrow'
    else:
        lead = start.strftime('%a %d')
    return f"{lead} · {start.strftime('%H:%M')}"


# Ringing them on the Mac (server.py ring_reminders): a reminder whose instant came less than this long ago still rings
# once — the app was starting, the Mac waking —; one older than that is left: a notice an hour late is noise.
CATCH_UP = dt.timedelta(minutes=15)
# What the Mac has rung is kept this long (its ids), then forgotten: a reminder never comes due again after a day.
KEEP_FIRED = dt.timedelta(days=2)


def to_ring(due, fired):
    """Of `due` (upcoming's entries whose instant has come), those not rung yet: `fired` is {id: at} of what was."""
    return [r for r in due if r['id'] not in fired]


def prune(fired, now):
    """`fired` without what rang before now - KEEP_FIRED (or whose instant cannot be read)."""
    out = {}
    for rid, at in (fired or {}).items():
        try:
            if dt.datetime.fromisoformat(str(at)) >= now - KEEP_FIRED:
                out[str(rid)] = str(at)
        except ValueError:
            continue
    return out
