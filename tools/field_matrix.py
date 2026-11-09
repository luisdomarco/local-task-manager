#!/usr/bin/env python3
"""The field matrix of every vault structure: which fields each item type carries and where each shows, plus how the
types relate. Read from tm/structures (traits.py and each structure's props), so it describes the code as it is.

    python3 tools/field_matrix.py                 # JSON on stdout: {vault: {types, labels, rows, relations}}
    python3 tools/field_matrix.py --out m.json    # the same, to a file, and a one-line summary per vault

A row is [section, key, label, kind, ✓ per type]. Sections are traits.SECTIONS, in the order the card and the page
lay them out; a type's own prop sits where its `tab` puts it (tm/structures prop_tab). It is what the shared sheet of
fields per type is refreshed from.
"""
import argparse
import json
import os
import sys

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)
from tm.structures import get, prop_tab  # noqa: E402
from tm.structures.traits import SECTION_OF, SECTIONS  # noqa: E402

VAULTS = (('folders', 'Initiatives'), ('tasks', 'Tasks'), ('ticketing', 'Projects'))

# How the matrix names the app's own fields (a type's props bring their own label).
LABELS = {
    'subject': 'Title', 'id': 'Id', 'status': 'Status', 'priority': 'Priority', 'priority_reason': 'Priority reason',
    'plan_day': 'Planned (day)', 'plan_week': 'Planned (week)', 'plan_month': 'Planned (month)', 'due': 'Due',
    'labels': 'Labels', 'date': 'Date', 'time': 'Time', 'duration': 'Duration', 'attendees': 'Attendees',
    'event_id': 'Calendar event id', 'source': 'Source', 'from': 'From', 'resolution': 'Resolution',
    'body': 'Description (body)', 'attachments': 'Attachments (Attachments/ folder)', 'ticket_id': 'Ticket id',
    'ticket_url': 'Ticket URL', 'tracker': 'Tracker', 'local_path': 'Local path', 'watchers': 'Watchers',
    'worklog': 'Log work (work log files)', 'url': 'Main link', 'url_label': 'Main link label', 'links': 'Other links',
    'project': 'Project', 'related_to': 'Parent', 'relations': 'Related items', 'relation_kinds': 'Kind of each relation',
    'docs': 'Linked docs and folders', 'comments': 'Comments', 'claude_sessions': 'Claude sessions', 'list': 'Board list',
    'order': 'Board order', 'today_list': 'Today column', 'plan_order': 'Order in its day or week',
    'week_list': 'Week column', 'week_order': 'Order in its Week column', 'sidebar': 'Favourite (star)',
    'archived': 'Archived (⋯ menu)', 'session_name': 'Session name', 'completed_at': 'Closed at',
    'resolved_at': 'Resolved at', 'created_at': 'Created at', 'updated_at': 'Updated at',
    'project_key': 'Project key', 'area': 'Area', 'objective': 'Objective', 'user_stories': 'Embedded stories (legacy)', 'legacy_id': 'Id before migration (legacy)',
}
GROUPED = {'delivery': 'Delivery', 'details': 'Details', 'settings': 'Settings'}


def place(prop):
    """The section a type's own prop shows in."""
    tab = prop_tab(prop)
    if tab == 'main':
        return 'Properties'
    if tab == 'relations':
        return 'Relations'
    if tab == 'hidden':
        return 'Hidden (shown elsewhere)'
    group = prop.get('group') or tab
    return GROUPED[tab] if group == GROUPED[tab] else f"{GROUPED[tab]} · {group}"


def ordered_types(s):
    """The structure's types, inbox and prompt last (the minimal ones)."""
    return [n for n in s.types if n not in ('prompt', 'inbox')] + [n for n in ('inbox', 'prompt') if n in s.types]


def fields_matrix(s):
    types = ordered_types(s)
    rows = {}  # (section, key) → {label, kind, types}
    for n in types:
        t = s.types[n]
        props = {p['key']: p for p in t.props}
        named = t.has_id or n == 'project'
        keys = ['subject', *(['id'] if named else []), 'body', 'attachments', *t.fields, *t.extra_fields,
                'created_at', 'updated_at', *(['worklog'] if named else [])]
        for k in dict.fromkeys(keys):
            if k in props:
                p = props[k]
                sec, label, kind = place(p), p['label'], p['kind']
            else:
                sec, label, kind = SECTION_OF.get(k, 'Stored, not shown'), LABELS.get(k, k), ''
            rows.setdefault((sec, k), {'label': label, 'kind': kind, 'types': set()})['types'].add(n)
    rank = {name: i for i, name in enumerate(SECTIONS)}
    first = {n: i for i, n in enumerate(types)}
    out = sorted(rows.items(), key=lambda kv: (rank.get(kv[0][0], len(SECTIONS)), min(first[n] for n in kv[1]['types'])))
    return types, [[sec, key, r['label'], r['kind'], *('✓' if n in r['types'] else '' for n in types)]
                   for (sec, key), r in out]


def relations(s):
    """How the types relate: who hangs from whom (titled as the page titles it), the link props, which page or card
    lists each type's children, and the relation kinds."""
    types = [n for n in s.types if n not in ('prompt', 'inbox')]
    hierarchy = [[c, *((s.types[c].parent_label or 'Parent') if p in s.types[c].parents else '' for p in types)]
                 for c in types if s.types[c].parents]
    links = []
    for n in types:
        for p in s.types[n].props:
            if p['kind'] in ('link', 'links'):
                links.append([n, p['key'], p['label'], 'one' if p['kind'] == 'link' else 'many', ', '.join(p.get('types') or []),
                              {'relations': 'Relations', 'hidden': 'Not in Relations'}.get(prop_tab(p), prop_tab(p))])
    tabs = []
    for n in types:
        t = s.types[n]
        kids = list(t.children) if t.page else [c for c in types if n in s.types[c].parents]
        if kids:
            tabs.append([n, 'page' if t.page else 'card', ', '.join(kids)])
    return {'types': types, 'hierarchy': hierarchy, 'links': links, 'tabs': tabs, 'kinds': s.extras.get('relation_kinds') or {}}


def matrix():
    out = {}
    for sid, name in VAULTS:
        s = get(sid)
        types, rows = fields_matrix(s)
        out[name] = {'types': types, 'labels': [s.types[n].label for n in types], 'rows': rows, 'relations': relations(s)}
    return out


def main(argv=None, out=sys.stdout):
    p = argparse.ArgumentParser(description=__doc__.split('\n', 1)[0])
    p.add_argument('--out', help='write the JSON here instead of stdout')
    a = p.parse_args(argv)
    data = matrix()
    if not a.out:
        json.dump(data, out, ensure_ascii=False, indent=1)
        out.write('\n')
        return 0
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    for name, v in data.items():
        out.write(f"{name}: {len(v['types'])} types, {len(v['rows'])} rows, {len(v['relations']['hierarchy'])} children, "
                  f"{len(v['relations']['links'])} links\n")
    return 0


if __name__ == '__main__':
    sys.exit(main())
