"""Contacts: people (who a meeting's attendee or an activity's sender is) and groups (an email list, a Slack channel…).

A person is a record {name, calendar_name, emails, redmine, slack, notes, when_to_use}:
  name           the public name: what the items store and the app shows (you edit it)
  calendar_name  how Google Calendar names them (displayName), as it came
  emails         the addresses Calendar used for them, lower case
  redmine        their Redmine user (login or id), when they have one; '' when not
  slack          their Slack user (handle or member id), when they have one; '' when not
  notes          anything worth keeping about them (free text, several lines)
  when_to_use    when to reach them, and how: instructions an agent reads in a prompt (free text)

A group is a record {name, channel, address, members, notes, when_to_use} (TSK-050): `channel` is how it is reached
(CHANNELS), `address` the list's email or the Slack channel, `members` the names of people in it. A group's name is
never a person's: items name either by the name alone.

Items keep the public name, never an id, so a meeting reads well in any editor; renaming a person
rewrites the items (Store.update_person). The calendar sync finds the person behind an attendee with
match(): by email first, then by name, ignoring case, accents and spaces.

A text (a description, a comment, a prompt) mentions someone as @[Public name]: plain text that reads
well in any editor. A rename rewrites the mentions too; a mention of nobody in People is kept as written.
"""
import re
import unicodedata

EMAIL_RE = re.compile(r'^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$')
MENTION_RE = re.compile(r'@\[([^\[\]\n]{1,80})\]')


def clean_name(value):
    return ' '.join(str(value if value is not None else '').split())


def norm(name):
    """A name as compared: no accents, no case, single spaces (Ana  GARCÍA → ana garcia)."""
    text = unicodedata.normalize('NFKD', clean_name(name))
    return ''.join(c for c in text if not unicodedata.combining(c)).casefold()


def clean_text(value, limit=4000):
    """Free text as stored (notes, when to use it): its lines kept, trailing spaces and blank edges dropped."""
    lines = [l.rstrip() for l in str(value if value is not None else '').replace('\r\n', '\n').split('\n')]
    return '\n'.join(lines).strip()[:limit]


def clean_email(value):
    email = str(value or '').strip().lower()
    return email if EMAIL_RE.match(email) else ''


def clean_emails(value):
    """A list of addresses from a list, or from text separated by commas, semicolons or spaces."""
    if value is None:
        return []
    parts = re.split(r'[\s,;]+', value) if isinstance(value, str) else value
    out = []
    for v in parts:
        e = clean_email(v)
        if e and e not in out:
            out.append(e)
    return out


def clean_record(value):
    """A person record as stored, or None when it has no name. A bare string is a name."""
    if isinstance(value, str):
        value = {'name': value}
    if not isinstance(value, dict):
        return None
    name = clean_name(value.get('name'))
    if not name:
        return None
    return {'name': name, 'calendar_name': clean_name(value.get('calendar_name')), 'emails': clean_emails(value.get('emails')),
            'redmine': clean_name(value.get('redmine')), 'slack': clean_name(value.get('slack')),
            'notes': clean_text(value.get('notes')), 'when_to_use': clean_text(value.get('when_to_use'))}


CHANNELS = ('email', 'slack', 'other')


def clean_group(value):
    """A group record as stored, or None when it has no name. A bare string is a name."""
    if isinstance(value, str):
        value = {'name': value}
    if not isinstance(value, dict):
        return None
    name = clean_name(value.get('name'))
    if not name:
        return None
    channel = str(value.get('channel') or '').strip().lower()
    members, seen = [], set()
    raw = value.get('members')
    for m in (raw.split(',') if isinstance(raw, str) else raw if isinstance(raw, list) else []):
        n = clean_name(m)
        if n and n.lower() not in seen:
            seen.add(n.lower())
            members.append(n)
    return {'name': name, 'channel': channel if channel in CHANNELS else 'other', 'address': clean_name(value.get('address')),
            'members': members, 'notes': clean_text(value.get('notes')), 'when_to_use': clean_text(value.get('when_to_use'))}


def mentions(*texts):
    """The names mentioned (@[Name]) in `texts`, in order, each once (ignoring case)."""
    out = []
    for text in texts:
        for m in MENTION_RE.finditer(str(text or '')):
            name = clean_name(m.group(1))
            if name and name.lower() not in [o.lower() for o in out]:
                out.append(name)
    return out


def rename_mentions(text, old, new):
    """`text` with every @[old] (any case, any spacing) made @[new]; the rest byte for byte."""
    key = clean_name(old).lower()
    return MENTION_RE.sub(lambda m: f'@[{new}]' if clean_name(m.group(1)).lower() == key else m.group(0), str(text or ''))


def _indented(label, text):
    """A free-text field under a contact's line in a prompt: its lines indented, '' when empty."""
    return f"\n  {label}: " + '\n    '.join(text.split('\n')) if text else ''


def contact_line(name, record, group=None):
    """For a prompt: who a mention is and how to reach them — a person's `record`, or a `group`'s — with when to use
    them and the notes kept, each on lines of its own."""
    if group:
        how = {'email': 'email list', 'slack': 'Slack channel'}.get(group['channel'], 'group')
        parts = [f"{how} {group['address']}" if group['address'] else how,
                 *([f"members {', '.join(group['members'])}"] if group['members'] else [])]
        return f"- {group['name']} (group): {' · '.join(parts)}" + _indented('When to use', group['when_to_use']) + _indented('Notes', group['notes'])
    if not record:
        return f'- {name}: not in Contacts (no contact details)'
    parts = [*([f"email {', '.join(record['emails'])}"] if record.get('emails') else []),
             *([f"Slack {record['slack']}"] if record.get('slack') else []),
             *([f"Redmine {record['redmine']}"] if record.get('redmine') else [])]
    return (f"- {record['name']}: {' · '.join(parts) if parts else 'no contact details yet'}"
            + _indented('When to use', record.get('when_to_use') or '') + _indented('Notes', record.get('notes') or ''))


def name_from_email(email):
    """A name for an address with no name: ana.garcia@x.com → Ana Garcia."""
    local = str(email or '').split('@')[0]
    return ' '.join(w.capitalize() for w in re.split(r'[._-]+', local) if w)


def match(records, email='', display=''):
    """Who an attendee is, among `records`:
        ('email', record)        an address of theirs
        ('name', record)         their public or calendar name (only one person has it)
        ('ambiguous', [records]) the name of more than one person: nobody is guessed
        ('new', None)            nobody yet
    Without a display name, the name made from the address is compared."""
    email = clean_email(email)
    if email:
        for r in records:
            if email in r['emails']:
                return 'email', r
    key = norm(display) or norm(name_from_email(email))
    if not key:
        return 'new', None
    found = [r for r in records if key in (norm(r['name']), norm(r['calendar_name']))]
    if len(found) == 1:
        return 'name', found[0]
    if found:
        return 'ambiguous', found
    return 'new', None
