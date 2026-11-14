"""Custom boards: columns of the user's own and where each card sits in them — Today's board, the Custom grouping of the
Week (and Next week), the Month and every list's board. One JSON file per board, `.task-manager/boards/<name>.json`:

    {"columns": [{"id": "uncategorized", "name": "Uncategorized"}, {"id": "waiting", "name": "Waiting"}],
     "cards": {"482": ["waiting", 10], "17": ["uncategorized", null]}}

`cards` maps an item's id to its column and its place in it (a number, or null: not placed by hand, so it follows the
board's own order). Placing a card never writes the item's file, so a ticket stays byte for byte and Obsidian sees no
change. A card whose column is gone, or that names none, is in Uncategorized, the column every board has.

Before boards had files, Today's columns were `.task-manager/today.md` and each item's `today_list`, and the week's Free
board was `week.md` with `week_list` / `week_order`: `migrate` reads them into a board, and the first write of that board
keeps it. Those keys are only read, never written again. Pure: no I/O; the Store reads and writes the files.
"""
import json
import re

UNCATEGORIZED = 'uncategorized'
DIR = 'boards'  # in .task-manager/: one <name>.json per board
# A board's name: the view it belongs to (`today`, `week`, `month`, `list.initiative`…): it is its file's name too.
NAME_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$')
# The boards that had a file before: (its file in .task-manager/, the item key naming a card's column, the one its place)
LEGACY = {'today': ('today.md', 'today_list', None), 'week': ('week.md', 'week_list', 'week_order')}


class BoardError(ValueError):
    pass


def default():
    return {'columns': [{'id': UNCATEGORIZED, 'name': 'Uncategorized'}], 'cards': {}}


def clean_columns(columns):
    """[{id, name}] as given, checked: unique non-empty ids, a name each (its id if none); Uncategorized first when it is
    missing (it cannot be deleted)."""
    if not isinstance(columns, list):
        raise BoardError('columns must be a list')
    out = []
    for c in columns:
        if not isinstance(c, dict) or not str(c.get('id') or '').strip():
            raise BoardError('each column needs an id')
        cid = str(c['id']).strip()
        out.append({'id': cid, 'name': str(c.get('name') or cid).strip() or cid})
    ids = [c['id'] for c in out]
    if len(set(ids)) != len(ids):
        raise BoardError('column ids must be unique')
    if UNCATEGORIZED not in ids:
        out.insert(0, default()['columns'][0])
    return out


def _place(value):
    """A card's [column, order] as kept: order a number or None."""
    if not isinstance(value, (list, tuple)) or len(value) != 2 or not str(value[0] or '').strip():
        raise BoardError('a card is [column, order]')
    order = value[1]
    if order is not None and (isinstance(order, bool) or not isinstance(order, (int, float))):
        raise BoardError('a card\'s order is a number or null')
    return [str(value[0]).strip(), order]


def clean_cards(cards, columns):
    """{id: [column, order]} keeping only the cards whose column the board has (the others are in Uncategorized)."""
    if not isinstance(cards, dict):
        raise BoardError('cards must be a map of item id to [column, order]')
    ids = {c['id'] for c in columns}
    out = {}
    for key, value in cards.items():
        col, order = _place(value)
        if col in ids:
            out[str(key)] = [col, order]
    return out


def apply(board, columns=None, place=None):
    """`board` with its columns replaced (`columns`) and cards placed (`place`: {id: [column, order], or null to take it
    out). A card left in a column that is gone goes back to Uncategorized (it is dropped from the map)."""
    cols = clean_columns(columns) if columns is not None else board['columns']
    cards = dict(board['cards'])
    if place is not None:
        if not isinstance(place, dict):
            raise BoardError('place must be a map of item id to [column, order] or null')
        known = {c['id'] for c in cols}
        for key, value in place.items():
            if value is None:
                cards.pop(str(key), None)
                continue
            col, order = _place(value)
            if col not in known:
                raise BoardError(f'no column {col} on this board')
            cards[str(key)] = [col, order]
    return {'columns': cols, 'cards': clean_cards(cards, cols)}


def parse(text):
    """A board file's text → the board; one that cannot be read is an error (the Store says so, never overwrites it)."""
    try:
        data = json.loads(text)
    except ValueError as e:
        raise BoardError(f'not JSON: {e}')
    if not isinstance(data, dict):
        raise BoardError('a board is an object')
    cols = clean_columns(data.get('columns') or [])
    return {'columns': cols, 'cards': clean_cards(data.get('cards') or {}, cols)}


def dump(board):
    """The file's text: columns in order, cards by id, one per line, so a diff of it reads."""
    cards = ',\n'.join(f'    {json.dumps(k)}: {json.dumps(v)}' for k, v in sorted(board['cards'].items(), key=lambda kv: _id_key(kv[0])))
    cols = ',\n'.join(f'    {json.dumps(c, ensure_ascii=False)}' for c in board['columns'])
    return '{\n  "columns": [\n' + cols + '\n  ],\n  "cards": {\n' + cards + ('\n' if cards else '') + '  }\n}\n'


def _id_key(k):
    return (0, int(k), '') if k.isdigit() else (1, 0, k)


def migrate(name, lists, items):
    """The board of before (LEGACY[name]): `lists` the columns its .md file held (None: it had none, so Uncategorized
    only), `items` [(id, fields)] every item; each item whose key names one of those columns, or that has a place,
    becomes a card. → the board, or None when `name` had no board before."""
    if name not in LEGACY:
        return None
    _, col_key, order_key = LEGACY[name]
    try:
        cols = clean_columns(lists) if lists else default()['columns']
    except BoardError:
        cols = default()['columns']
    known = {c['id'] for c in cols}
    cards = {}
    for item_id, fields in items:
        col = str(fields.get(col_key) or '').strip()
        order = fields.get(order_key) if order_key else None
        order = order if isinstance(order, (int, float)) and not isinstance(order, bool) else None
        if col in known and col != UNCATEGORIZED:
            cards[str(item_id)] = [col, order]
        elif order is not None:
            cards[str(item_id)] = [UNCATEGORIZED, order]
    return {'columns': cols, 'cards': cards}
