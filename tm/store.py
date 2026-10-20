"""Item store over a directory tree of .md files.

Any `.md` under the configured root whose frontmatter has a known `type` is an item.
Location does not matter for reading (the whole tree is scanned); new items are
written to the per-type folder from the config. Relations use stable IDs
(`parent: INI-0003`), never paths, so files can be renamed or moved freely.
"""

import functools
import hashlib
import json
import os
import re
import shutil
import threading
import unicodedata
from datetime import datetime

from . import attachments
from . import frontmatter as fm
from . import people
from .fsutil import atomic_write
from .launch import SESSION_RE
from .structures import GROUPS, StatusConfigError
from .structures import get as get_structure
from .structures.folders import (FOLDER_PER_TYPE, CLOSED, DEFAULT_FOLDERS, ID_RE, ITEM_TYPES, PARENT_TYPES, PRIORITIES,  # noqa: F401
                                STATUSES, TYPE_FIELDS)
from .structures.check import IGNORED_FILES
from .structures.check import check as check_structure
from .structures.ticketing import wikilinks

# ITEM_TYPES, DEFAULT_FOLDERS, STATUSES, CLOSED, PRIORITIES, TYPE_FIELDS, PARENT_TYPES and ID_RE are the folder-per-type
# structure's (tm/structures/folders.py), under the names they have always had here: the server, the tools and the
# tests import them. A Store reads its own structure (Store.structure) instead.

DEFAULT_WORK_KINDS = ['Analysis', 'Definition', 'Testing', 'Meeting', 'Management']
# Default board: one list per status. Lists are user-editable; each maps to a status.
DEFAULT_LISTS = [{'id': s.lower(), 'name': s, 'status': s} for s in STATUSES]
# Today board: columns are how you organise the day, not a status. The default
# column cannot be deleted; an item whose `today_list` names no column lands there.
TODAY_DEFAULT = 'uncategorized'
DEFAULT_TODAY_LISTS = [{'id': TODAY_DEFAULT, 'name': 'Uncategorized'}]
# Where an activity (a pasted email, Slack message, comment…) came from.
ACTIVITY_SOURCES = ['Email', 'Slack', 'Comment', 'Other']
# `sidebar`: a favourite (listed under Favourites). A new or converted item is not one until starred; a file without
# the key, from before, still is (the page reads `sidebar !== false`).
FIELD_DEFAULTS = {'status': 'Backlog', 'priority': 'Normal', 'links': [], 'relations': [], 'archived': False, 'sidebar': False,
                  'labels': [], 'attendees': [], 'comments': []}
# Comments: [{at: 'YYYY-MM-DDTHH:MM', text}] in the frontmatter, oldest first.
# Claude sessions: [{id, at, cwd, instruction, model?, effort?}] in the frontmatter, oldest first — one per
# "work on it with Claude" launch, so the conversation can be resumed (`claude --resume <id>`, from `cwd`).
# Launches made from the top bar (no item) go to <root>/.task-manager/claude-sessions.md instead.
CLAUDE_SESSIONS_FILE = 'claude-sessions.md'
CLAUDE_SESSION_KEYS = ('id', 'at', 'cwd', 'instruction', 'model', 'effort')
CLAUDE_INSTRUCTION_MAX = 120  # chars kept of the instruction: a label for the list, not the prompt itself
STORY_KEYS = ('id', 'subject', 'redmine_url', 'local_path', 'status')
PROTECTED = {'id', 'type', 'created_at', 'completed_at', 'resolved_at'}
# Everything a type may carry (Structure.allowed_fields). A value for any other field (a task's `list` sent
# for a note, a `status` left in a form switched to Prompt) is dropped without an error, as PROTECTED ones are:
# refusing it would break forms that send more than the type needs. Beyond each type's own fields:
# `title` (how old files named the subject), `converted_from` (set by convert), and the legacy ones of
# tm/structures/folders.py (EXTRA_FIELDS).
ALLOWED_FIELDS = {t: FOLDER_PER_TYPE.allowed_fields(t) for t in FOLDER_PER_TYPE.types}
IDS_FILE = 'ids.json'  # in META_DIR: the highest number ever handed out per prefix
META_DIR = '.task-manager'
ORDER_FILE = '.order'  # in a Docs folder: its entries' names in the order dragged (Store.set_order)
STATUSES_FILE = 'statuses.json'  # in META_DIR: how this vault arranged its types' statuses (TSK-037)
SKIP_DIRS = {'node_modules', '__pycache__', attachments.DIR}  # Attachments/: files, never items
# What "work on it with Claude" sends: the item as plain text. The user sees it in full before it goes out.
CLAUDE_MAX_PROMPT = 100_000  # bytes of prompt; the body is cut (and says so) beyond this
CLAUDE_DEFAULT_INSTRUCTION = ('Read this item, tell me in a few lines what you understand it asks for and what you would do first, '
                              'and wait for my go-ahead before changing anything.')
TRASH_STAMP_RE = re.compile(r'^(\d{8})-(\d{6})-(.+)$')  # <deleted-at>-<original file name>
CHECK_RE = re.compile(r'^\s*[-*+]\s+\[([ xX])\]', re.MULTILINE)
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
TIME_RE = re.compile(r'^(\d{1,3}):([0-5]\d)$')


def clean_people(value):
    """A list of people: names trimmed, blanks dropped, repeats (ignoring case) removed.
    A bare string is one person."""
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    out, seen = [], set()
    for v in value:
        name = ' '.join(str(v if v is not None else '').split())
        if name and name.lower() not in seen:
            seen.add(name.lower())
            out.append(name)
    return out


def clean_label(value):
    """A label as stored: no '#', no commas, single spaces."""
    return ' '.join(str(value if value is not None else '').replace(',', ' ').split()).lstrip('#').strip()


def clean_labels(values):
    """A list of labels without blanks or repeats (labels are case-sensitive)."""
    out = []
    for v in values if isinstance(values, (list, tuple)) else [values] if values else []:
        label = clean_label(v)
        if label and label not in out:
            out.append(label)
    return out


def normalize_time(value):
    """Time spent as HH:MM ('1:5' is not a time; '1:05' becomes '01:05'); blank means 00:00."""
    value = str(value if value is not None else '').strip()
    if not value:
        return '00:00'
    m = TIME_RE.match(value)
    if not m:
        raise StoreError(400, 'time must be HH:MM (for example 01:30)')
    return f'{int(m.group(1)):02d}:{m.group(2)}'


# Fields an inbox item carries over when converted (besides subject and body).
CARRY_OVER = ('url', 'url_label', 'links', 'labels', 'archived', 'created_at')
URL_RE = re.compile(r'^(https?://|mailto:|obsidian://|file://)\S+$', re.IGNORECASE)
# A bare host ("dominio.com", "www.x.io/path", "localhost:3000") is taken as https.
BARE_HOST_RE = re.compile(r'^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$|^localhost(?::\d+)?(?:[/?#]\S*)?$', re.IGNORECASE)


def normalize_url(value, what):
    """'dominio.com' → 'https://dominio.com'; real links pass through; anything else is a 400."""
    v = str(value or '').strip()
    if URL_RE.match(v):
        return v
    if BARE_HOST_RE.match(v):
        return f'https://{v}'
    raise StoreError(400, f'{what} is not a link: {value}')


def validate(values, structure=FOLDER_PER_TYPE, item_type=None):
    """Reject values the app relies on being well-formed; normalize links. Statuses and priorities are the
    structure's (those of `item_type`, when given)."""
    statuses = list(structure.statuses_of(item_type))
    priorities = list(structure.priorities)
    if 'status' in values and values['status'] not in statuses:
        raise StoreError(400, f'status must be one of {statuses}')
    if 'priority' in values and values['priority'] not in priorities:
        raise StoreError(400, f'priority must be one of {priorities}')
    if values.get('source') and values['source'] not in ACTIVITY_SOURCES:
        raise StoreError(400, f'source must be one of {ACTIVITY_SOURCES}')
    if 'plan_order' in values:  # a card's place on Today and Week (TSK-053): a number, or none
        v = values['plan_order']
        if v not in (None, '') and (isinstance(v, bool) or not isinstance(v, (int, float))):
            raise StoreError(400, 'plan_order must be a number')
        values['plan_order'] = v if v not in (None, '') else None
    if 'sidebar' in values:  # whether an initiative is listed in the sidebar
        values['sidebar'] = bool(values['sidebar'])
    if 'resolved' in values:  # an action, never stored: see Store.update
        values['resolved'] = bool(values['resolved'])
    for key in ('from', 'attendees', 'watchers'):  # people: always a list; an activity's sender may be empty, the rest default to []
        if key in values:
            raw = values[key]
            if key in ('attendees', 'watchers') and isinstance(raw, str):
                raw = raw.split(',')
            names = clean_people(raw)
            values[key] = names if names or key != 'from' else None
    if 'time' in values:  # when a meeting starts or an activity came, HH:MM on a 24 h clock; blank means "not known"
        raw = str(values['time'] if values['time'] is not None else '').strip()
        m = TIME_RE.match(raw)
        if raw and not (m and int(m.group(1)) < 24):
            raise StoreError(400, 'time must be HH:MM, from 00:00 to 23:59 (for example 09:30)')
        values['time'] = normalize_time(raw) if raw else None
    if 'duration' in values:  # a meeting's length, HH:MM; blank means "not known"
        raw = str(values['duration'] if values['duration'] is not None else '').strip()
        if raw and not TIME_RE.match(raw):
            raise StoreError(400, 'duration must be HH:MM (for example 00:45)')
        values['duration'] = normalize_time(raw) if raw else None
    for key in ('resolution', 'session_name', 'url_label', 'event_id', 'priority_reason'):  # free text: blank means "none"
        if key in values:
            values[key] = (str(values[key]).strip() if values[key] is not None else '') or None
    for key in ('url', structure.external_ref['url_key']):
        if values.get(key):
            values[key] = normalize_url(values[key], key)
    if 'user_stories' in values:
        stories, seen = [], set()
        for st in values['user_stories'] or []:
            st = {k: st.get(k) for k in STORY_KEYS if st.get(k) not in (None, '')}
            if not st.get('id') or not st.get('subject'):
                raise StoreError(400, 'a user story needs an id and a subject')
            if st['id'] in seen:
                raise StoreError(400, f"duplicate user story id: {st['id']}")
            seen.add(st['id'])
            st.setdefault('status', 'Backlog')
            if st['status'] not in structure.statuses:
                raise StoreError(400, f'user story status must be one of {list(structure.statuses)}')
            if st.get('redmine_url'):
                st['redmine_url'] = normalize_url(st['redmine_url'], 'user story redmine_url')
            stories.append(st)
        values['user_stories'] = stories
    if 'attachments' in values:  # vault-relative paths inside Attachments/ (tm/attachments.py)
        try:
            values['attachments'] = attachments.clean_list(values['attachments'])
        except ValueError as e:
            raise StoreError(400, str(e)) from None
    if 'links' in values:
        links = []
        for l in values['links'] or []:
            l = {'url': l} if isinstance(l, str) else dict(l)
            l['url'] = normalize_url(l.get('url'), 'link')
            links.append({k: l[k] for k in ('label', 'url') if l.get(k)})
        values['links'] = links
    if 'relations' in values:  # ids, each once; checked against the vault by Store._check_relations
        raw = values['relations'] if isinstance(values['relations'], (list, tuple)) else [values['relations']] if values['relations'] else []
        values['relations'] = list(dict.fromkeys(str(r).strip() for r in raw if str(r or '').strip()))
    if 'docs' in values:
        values['docs'] = clean_docs(values['docs'])
    if 'archived' in values:
        values['archived'] = bool(values['archived'])
    if 'comments' in values:
        comments = []
        for c in values['comments'] or []:
            c = {'text': c} if isinstance(c, str) else dict(c)
            text = str(c.get('text') or '').strip()
            if not text:
                raise StoreError(400, 'a comment needs text')
            comments.append({'at': str(c.get('at') or now_stamp()), 'text': text})
        values['comments'] = comments
    if 'claude_sessions' in values:
        values['claude_sessions'] = clean_claude_sessions(values['claude_sessions'])
    return values


def clean_docs(raw):
    """What an item links in the vault's Docs (TSK-039 §3.4), each once: a doc as its wikilink, [[Name]] (Obsidian finds
    it wherever it moves; a bare name or "Name.md" becomes that), a folder as its path from the vault with a final "/"
    (the app rewrites it when the folder moves or is renamed)."""
    if raw in (None, ''):
        return []
    if not isinstance(raw, list) or not all(isinstance(x, str) for x in raw):
        raise StoreError(400, 'docs must be a list of [[docs]] and folders/')
    out = []
    for x in raw:
        s = x.strip()
        if not s:
            continue
        if s.startswith('[[') and s.endswith(']]'):
            s = f'[[{s[2:-2].strip()}]]'
        elif s.endswith('/'):
            s = s.strip('/') + '/'
        else:
            s = f'[[{re.sub(r"[.]md$", "", s, flags=re.I)}]]'
        if s in ('[[]]', '/') or '..' in s.strip('[]/').split('/'):
            raise StoreError(400, f'not a doc or a folder: {x}')
        out.append(s)
    return list(dict.fromkeys(out))


def clean_claude_sessions(raw):
    """Claude sessions as stored: id (a UUID, or the entry is refused), at, cwd (required: a resume runs there),
    the first line of the instruction, and the model / effort flags if any. Anything else is dropped."""
    out = []
    for s in raw or []:
        if not isinstance(s, dict):
            raise StoreError(400, 'a Claude session must be an object')
        sid = str(s.get('id') or '').strip().lower()
        if not SESSION_RE.match(sid):
            raise StoreError(400, f'not a Claude session id: {sid or "(empty)"}')
        cwd = str(s.get('cwd') or '').strip()
        if not cwd:
            raise StoreError(400, 'a Claude session needs the folder it ran in')
        instruction = ' '.join(str(s.get('instruction') or '').strip().split('\n')[0].split())[:CLAUDE_INSTRUCTION_MAX]
        entry = {'id': sid, 'at': str(s.get('at') or now_stamp()), 'cwd': cwd, 'instruction': instruction}
        for k in ('model', 'effort'):
            if s.get(k):
                entry[k] = str(s[k]).strip()
        out.append(entry)
    return out


def allowed_values(item_type, values, structure=FOLDER_PER_TYPE):
    """Only what this type may carry, and never a PROTECTED field (see ALLOWED_FIELDS). Runs before
    validate() and before any side effect (completed_at, resolved_at, today_list…), so a foreign
    field can neither fail the request nor trigger a rule meant for another type.

    One exception, kept from before: asking to relate an inbox item or a prompt to something is an
    explicit request that cannot be honoured, so it is a 400, not a silent no-op (an empty one is fine)."""
    keep = structure.allowed_fields(item_type)
    for key in ('related_to', 'relations'):
        if (values or {}).get(key) and key not in keep:
            raise StoreError(400, f'a {item_type} cannot be related to anything')
    return {k: v for k, v in (values or {}).items() if k in keep and k not in PROTECTED}


class StoreError(Exception):
    def __init__(self, status, msg, **extra):
        super().__init__(msg)
        self.status = status
        self.extra = extra  # sent next to `error` in the JSON answer (a 409 carries the current revs)


# How deep this thread is inside @writes / @writes_files methods: create() calls _mark_ids() and _remember(), and the
# vault's structure is checked once, by the outermost one, which leaves here whether it matched for the inner ones.
_writing = threading.local()

READ_ONLY_MESSAGE = 'This vault does not match its structure, so it is read-only until it does (see the notice in the app).'


def _write_guard(method, refuse_unmatched):
    @functools.wraps(method)
    def guarded(self, *args, **kwargs):
        depth = getattr(_writing, 'depth', 0)
        result = None
        if depth == 0:
            result = self.check() if self.enforce_structure else None
            _writing.matched = result is None or result['ok']
        if refuse_unmatched and not _writing.matched:
            raise StoreError(409, READ_ONLY_MESSAGE, check=result or self.check())
        _writing.depth = depth + 1
        try:
            return method(self, *args, **kwargs)
        finally:
            _writing.depth = depth
    return guarded


def writes(method):
    """Marks a Store method that writes items (their files, ids, relations, the vault's own records). On a store that
    enforces its structure (the server's), the outermost such call checks the vault first and refuses (409) when it
    does not match: a write into a vault in an unexpected shape is how a file lands in the wrong place or an id is
    handed out twice."""
    return _write_guard(method, refuse_unmatched=True)


def writes_files(method):
    """Marks a Store method that works on the vault as plain files (the Explorer's: a folder, a rename, a move, a
    delete to the files' trash). Those stay allowed while the vault does not match its structure — they are how it is
    put right — and keep it matching when it did (_keeping_structure). An item write they call (deleting an item's
    file is deleting the item) is still refused on a vault that does not match."""
    return _write_guard(method, refuse_unmatched=False)


def now_stamp():
    return datetime.now().strftime('%Y-%m-%dT%H:%M')


def shown_body(body):
    """The body as read() returns it: the blank line after the frontmatter is not part of it."""
    return body[1:] if body.startswith('\n') else body


def body_rev(body):
    """A short hash of the body alone (as shown). Saving a field changes the file but not this, so the
    description editor only conflicts when the description itself changed on disk."""
    return hashlib.sha1(shown_body(body).encode('utf-8')).hexdigest()[:16]


def file_rev(key):
    """The whole file's version, from the cache key (inode, mtime_ns, size): any change to it, made here or not."""
    return '-'.join(f'{n:x}' for n in key)


def slugify(text, max_len=50):
    # Accents are stripped (é → e) but letters of other scripts stay: a title in Chinese or Greek keeps a readable file name.
    out = []
    for c in unicodedata.normalize('NFKD', text):
        if unicodedata.combining(c) and out and out[-1].isascii():
            continue  # the accent of a Latin letter goes; the voicing mark of が or the vowel sign of a Hindi letter stays
        out.append(c)
    text = unicodedata.normalize('NFC', ''.join(out))
    text = re.sub(r'[^\w]+|_+', '-', text).strip('-').lower()
    return text[:max_len].rstrip('-') or 'untitled'


class Store:
    def __init__(self, root, folders=None, structure=FOLDER_PER_TYPE, enforce_structure=False, disabled_types=()):
        self.root = os.path.realpath(root)
        # What the vault's files must look like and what its items are (tm/structures): types, fields,
        # statuses, ids. Given as the Structure or its id. `full_structure` is all of it: what the vault's folder is
        # checked against and every id is counted from. `structure` is what this vault turned on (Settings →
        # Vaults, disabled_types): the types the app shows, lists, creates and links. A type turned off only hides
        # its files; they stay on disk, valid, and come back when it is turned on again.
        self.full_structure = get_structure(structure) if isinstance(structure, str) else structure
        # `structure` also carries how the vault arranged its statuses in the three groups (statuses.json, Settings →
        # Item type status); `base_structure` is it before that, what an arrangement is checked against.
        self.base_structure = self.full_structure.without(disabled_types)
        self.status_error = ''  # why statuses.json was set aside (shown in Settings), '' when it was not
        self.structure = self._arranged(self.base_structure)
        self.folders = {**self.full_structure.default_folders, **(folders or {})}
        # The server's stores refuse to write items while the vault does not match its structure (see @writes); its
        # plain files they still move about (@writes_files).
        # Off by default: a Store built by a test or a tool over a bare folder keeps working as before.
        self.enforce_structure = enforce_structure
        # abs path -> ((st_ino, mtime_ns, size), parsed). The inode is in the key because every write
        # here replaces the file (a new inode): ToDo→Done keeps the size, and on a coarse-clock file
        # system it can keep the mtime too, so (mtime, size) alone would hand back the old content.
        self._cache = {}
        # A leaf lock: held only around the dict operations, never during I/O and never while taking
        # another lock. Order is always _lock → _cache_lock. Not around scan's loop: it calls _load.
        self._cache_lock = threading.Lock()
        # Reentrant: add_comment/delete_comment read the item and call update() under one hold, so
        # no other writer can slip in between the read and the write.
        self._lock = threading.RLock()

    # ── paths ────────────────────────────────────────────────────────────────
    def abs(self, rel):
        p = os.path.realpath(os.path.join(self.root, rel))
        if p != self.root and not p.startswith(self.root + os.sep):
            raise StoreError(400, 'path escapes root')
        return p

    def rel(self, path):
        return os.path.relpath(path, self.root)

    def _scannable(self, rel):
        """Whether _walk_md would find an item at `rel`: a .md, under no hidden (.task-manager…) or skipped folder,
        and not in a Docs folder."""
        parts = [p for p in re.split(r'[\\/]+', rel) if p not in ('', '.')]
        if not parts or not parts[-1].endswith('.md'):
            return False
        return not any(p.startswith('.') or p in SKIP_DIRS for p in parts) and not self.full_structure.in_docs('/'.join(parts))

    def _walk_md(self, docs=False):
        """Every .md where an item may be; `docs` too, those in the Docs folders (TSK-039): documents, never items, but
        their [[links]] are rewritten like any other's."""
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = [d for d in dirnames if not d.startswith('.') and d not in SKIP_DIRS]
            if not docs:
                rel_dir = os.path.relpath(dirpath, self.root).replace(os.sep, '/')
                dirnames[:] = [d for d in dirnames if not self.full_structure.in_docs(f'{rel_dir}/{d}' if rel_dir != '.' else d)]
            for name in filenames:
                if name.endswith('.md') and not name.startswith('.'):
                    yield os.path.join(dirpath, name)

    def _load(self, path):
        """→ (cache key, fields, body, body_rev). The key comes from fstat on the open file, so it
        describes exactly the content read, even if the file is replaced in between. The body's
        hash is part of the cached parse: the list payload carries it without re-hashing every scan."""
        with open(path, encoding='utf-8', errors='replace') as f:
            st = os.fstat(f.fileno())
            key = (st.st_ino, st.st_mtime_ns, st.st_size)
            with self._cache_lock:
                hit = self._cache.get(path)
            if hit and hit[0] == key:
                return (key, *hit[1])
            text = f.read()
        fm_text, body = fm.split(text)
        parsed = (fm.parse(fm_text), body, body_rev(body))
        with self._cache_lock:
            self._cache[path] = (key, parsed)
        return (key, *parsed)

    def _read(self, path):
        return self._load(path)[1:3]

    # ── structure ────────────────────────────────────────────────────────────
    def check(self):
        """Whether the vault matches its structure (tm/structures/check.py, or the structure's own checker), read
        through this store's cache."""
        load = lambda path: self._load(path)[1]  # noqa: E731
        full = self.full_structure  # a type turned off is still a valid file on disk: never a mismatch
        if full.checker:
            return full.checker(self.root, load=load)
        return check_structure(self.root, full.check_spec(self.folders, SKIP_DIRS), load=load)

    # ── a structure with its own file format (Structure.codec) ───────────────
    def _type_of(self, rel, fields):
        """The item type of a file (or 'worklog'), from its `type:` or, in a structure with a codec, its own way."""
        codec = self.structure.codec
        return codec.classify(rel, fields) if codec else fields.get('type')

    def _decoded(self, rel, fields):
        """A file's fields as the app's: as they are, or through the structure's codec (links still unresolved)."""
        codec = self.structure.codec
        return codec.decode(rel, fields) if codec else fields

    def _resolver(self):
        """Who is who in the vault right now (the codec's stems ↔ keys, projects): a fresh scan's."""
        return self.structure.codec.resolve(self.items_raw())

    def items_raw(self):
        """The items of a scan, before a codec resolves their links (scan() resolves them itself)."""
        return self._scan(resolve=False)[0]

    def _disk_values(self, it, values, text, stamp=None, resolver=None):
        """`values` as the keys to write into the item's file: as they are, or through the structure's codec."""
        codec = self.structure.codec
        if not codec:
            return values
        raw = fm.parse(fm.split(text)[0])
        return codec.encode(it['type'], values, raw, resolver or self._resolver(), stamp=stamp, current=it['fields'])

    def create_missing_folders(self):
        """Create the folders the structure is missing, and nothing else: only when they are the vault's only
        problem, only the ones the check names (never a path from the request), one level at a time, and never
        over something that appeared there meanwhile. No file is written, moved or removed. → the new check."""
        with self._lock:
            result = self.check()
            if result['ok']:
                return result
            if not result['can_create_folders']:
                raise StoreError(409, 'Creating folders would not fix this vault: see what else does not match.', check=result)
            for rel in result['missing_folders']:
                target = self.abs(rel)  # stays inside the root
                parts = os.path.relpath(target, self.root).split(os.sep)
                for i in range(1, len(parts) + 1):
                    path = os.path.join(self.root, *parts[:i])
                    if os.path.isdir(path) and not os.path.islink(path):
                        continue
                    if os.path.lexists(path):
                        raise StoreError(409, f'Something that is not a folder is in the way: {self.rel(path)}', check=result)
                    os.mkdir(path)
            return self.check()

    def _defaults(self, item_type, defaults):
        """`defaults` for a new `item_type`: a status it may have (an agent starts as an Idea, not in the Backlog)."""
        statuses = self.structure.statuses_of(item_type)
        if defaults.get('status') and statuses and defaults['status'] not in statuses:
            defaults = {**defaults, 'status': statuses[0]}
        return defaults

    def _valid(self, item_type, values):
        """`values` as a `item_type` of this structure may carry them, checked (allowed_values, then validate)."""
        return validate(allowed_values(item_type, values, self.structure), self.structure, item_type)

    def _default_lists(self):
        """The board before it is edited: one list per status of the structure."""
        return DEFAULT_LISTS if self.full_structure is FOLDER_PER_TYPE else [{'id': s.lower(), 'name': s, 'status': s} for s in self.structure.statuses]

    # ── scan ─────────────────────────────────────────────────────────────────
    def _item(self, path, key, fields, body, brev):
        marks = CHECK_RE.findall(body)
        stem = os.path.splitext(os.path.basename(path))[0]
        return {
            'id': fields.get('id'),
            'key': fields.get('id') or self.rel(path),
            'type': fields['type'],
            'title': str(fields.get('subject') or fields.get('title') or stem),
            'path': self.rel(path),
            'rev': file_rev(key),
            'body_rev': brev,
            'fields': fields,
            'checklist': {'done': sum(1 for m in marks if m != ' '), 'total': len(marks)},
        }

    def scan(self):
        """Return (items, worklog_days). Worklog days are {date: (path, fields)}."""
        return self._scan()

    def _scan(self, resolve=True, hidden_too=False):
        """`hidden_too`: also the items of the types this vault turned off, for what must see every file (ids, and
        the children a delete unlinks); never for what is shown."""
        items, days = [], {}
        live = set()
        types = self.full_structure.types if hidden_too else self.structure.types
        for path in self._walk_md():
            live.add(path)
            try:
                key, fields, body, brev = self._load(path)
            except OSError:
                continue
            rel = self.rel(path)
            t = self._type_of(rel, fields)
            if t in types:
                items.append(self._item(path, key, self._decoded(rel, fields), body, brev))
            elif t == 'worklog' and DATE_RE.match(str(fields.get('date') or '')):
                days[str(fields['date'])] = (path, fields)
        with self._cache_lock:  # pop, not del: another scan may have dropped it already
            for stale in [p for p in self._cache if p not in live]:
                self._cache.pop(stale, None)
        if resolve and self.structure.codec:  # links among what was read (with hidden_too, the hidden items too)
            self.structure.codec.resolve(items)
        return items, days

    def _type_off(self, item_type):
        """Why an item of that type cannot be made here: turned off in this vault, or not a type of its structure."""
        if item_type in self.full_structure.types:
            return f"{self.full_structure.types[item_type].plural} are turned off in this vault (Settings → Vaults)"
        return f'unknown type: {item_type}'

    def _hidden_ids(self):
        """The ids of the items of the types this vault turned off: still used, so never handed out again."""
        if set(self.structure.types) == set(self.full_structure.types):
            return []
        shown = {it['key'] for it in self._scan(resolve=False)[0]}
        return [it['fields'].get('id') for it in self._scan(resolve=False, hidden_too=True)[0] if it['key'] not in shown]

    def items(self):
        return self.scan()[0]

    def find(self, key):
        for it in self.items():
            if it['id'] == key or it['path'] == key:
                return it
        raise StoreError(404, f'item not found: {key}')

    def next_id(self, item_type, items=None, days=None, project=None):
        """One past the highest number this prefix has ever used. An id is never handed out twice: old
        work-log entries would attach to the new item. So besides the live items it counts the ids
        kept in converted_from (a converted inbox item), the trash (a restore must find its id free),
        the work log, and the high-water mark in ids.json, which remembers what was purged from the
        trash or deleted by hand. Callers hold the lock and record the new id with _mark_ids."""
        prefix = self.structure.prefix_for(item_type, project)  # HB-SUP in a Ticketing project, TSK otherwise
        if items is None:
            items, days = self.scan()
        elif days is None:
            days = self.scan()[1]
        used = [*(it['id'] for it in items), *(it['fields'].get('converted_from') for it in items), *self._trashed_ids(), *self._hidden_ids(),
                *(e.get('id') for _, f in days.values() for e in f.get('entries') or [] if isinstance(e, dict))]
        top = self._id_marks().get(prefix, 0)
        for u in used:
            parsed = self.structure.parse_id(u)
            if parsed and parsed[0] == prefix:
                top = max(top, parsed[1])
        return self.structure.format_id(prefix, top + 1)

    def _ids_path(self):
        return os.path.join(self.root, META_DIR, IDS_FILE)

    def _id_marks(self):
        """{prefix: highest number used}. Missing or unreadable means {}: next_id still counts every
        other source, and the next _mark_ids writes a good file again."""
        marks, _ = self._read_id_marks()
        return marks

    def _read_id_marks(self):
        """({prefix: number}, readable). A file that is missing is fine (nothing recorded yet); one that is there but
        cannot be read is not: the caller must not write it back with a single prefix in it."""
        try:
            with open(self._ids_path(), encoding='utf-8') as f:
                data = json.load(f)
        except FileNotFoundError:
            return {}, True
        except (OSError, ValueError):
            return {}, False
        if not isinstance(data, dict):
            return {}, False
        return {k: v for k, v in data.items() if isinstance(v, int) and not isinstance(v, bool) and v > 0}, True

    def _rebuild_id_marks(self):
        """The marks as every other source remembers them: live items, converted_from, the trash and the work log."""
        items, days = self.scan()
        used = [*(it['id'] for it in items), *(it['fields'].get('converted_from') for it in items), *self._trashed_ids(), *self._hidden_ids(),
                *(e.get('id') for _, f in days.values() for e in f.get('entries') or [] if isinstance(e, dict))]
        marks = {}
        for u in used:
            parsed = self.structure.parse_id(u)
            if parsed and parsed[1] > marks.get(parsed[0], 0):
                marks[parsed[0]] = parsed[1]
        return marks

    @writes
    def _mark_ids(self, ids):
        """Raise the high-water mark to cover `ids` (callers hold the lock). Done before the item is
        written: if the write then fails, a number is skipped, which is harmless; the other order could
        leave an item on disk that ids.json does not know about."""
        marks, readable = self._read_id_marks()
        changed = False
        if not readable:  # a damaged ids.json: start from what everything else knows, for every prefix, and keep the bad file
            marks, changed = self._rebuild_id_marks(), True
            try:
                os.replace(self._ids_path(), self._ids_path() + '.damaged')
            except OSError:
                pass
        for used in ids:
            parsed = self.structure.parse_id(used)
            if parsed and parsed[1] > marks.get(parsed[0], 0):
                marks[parsed[0]] = parsed[1]
                changed = True
        if changed:
            os.makedirs(os.path.dirname(self._ids_path()), exist_ok=True)
            atomic_write(self._ids_path(), json.dumps(marks, indent=2, sort_keys=True) + '\n')

    # ── items ────────────────────────────────────────────────────────────────
    def read(self, key):
        it = self.find(key)
        # Fields, revs and body from one read of the file: a body newer than its rev would let a
        # stale editor overwrite it without a conflict. (Same path as the scan: a cache hit.)
        path = os.path.join(self.root, it['path'])
        k, fields, body, brev = self._load(path)
        if self._type_of(it['path'], fields) not in self.structure.types:  # changed into something else since the scan
            raise StoreError(404, f'item not found: {key}')
        if self.structure.codec:
            fields = self.structure.codec.apply(self._decoded(it['path'], fields), self._resolver())
        return {**self._item(path, k, fields, body, brev), 'body': shown_body(body)}

    @writes
    def create(self, item_type, subject, values=None, body=''):
        if item_type not in self.structure.types:
            raise StoreError(400, self._type_off(item_type))
        subject = (subject or '').strip()
        if not subject:
            raise StoreError(400, 'subject is required')
        given = dict(values or {})  # a Ticketing project is created from fields its card never edits (its key)
        values = self._valid(item_type, values)
        if 'sidebar' in self.structure.types[item_type].fields:
            # Written either way, never left out: a file without the key is a favourite (one from before the default
            # changed), and a structure with a codec writes only the keys it is given.
            values.setdefault('sidebar', False)
        if self.structure.codec:
            return self._create_coded(item_type, subject, values, body, given)
        with self._lock:
            if values.get('related_to'):
                self._check_relation({'id': None, 'type': item_type}, values['related_to'])
            if values.get('relations'):
                self._check_relations({'id': None}, values['relations'])
            item_id = self.next_id(item_type)
            self._mark_ids([item_id])
            stamp = now_stamp()
            fields = {'id': item_id, 'type': item_type, 'subject': subject}
            defaults = self._defaults(item_type, {**FIELD_DEFAULTS, **self.structure.defaults})
            for k in self.structure.types[item_type].fields:
                fields[k] = values.get(k, defaults.get(k))
            fields.update({k: v for k, v in values.items() if k not in fields})
            if fields.get('status') in self.structure.closed_of(item_type):
                fields['completed_at'] = stamp
            if fields.get('resolution'):
                fields['resolved_at'] = stamp
            fields['created_at'] = stamp
            fields['updated_at'] = stamp
            self._remember_people(clean_people(fields.get('from')) + clean_people(fields.get('attendees')) + self._watching_people(fields))
            self._remember_labels(fields.get('labels'))
            folder = self.abs(self.folders[item_type])
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, f'{item_id}-{slugify(subject)}.md')
            # Nothing typed: the type's own sections, if it has them (an agent's Purpose, Inputs…).
            body = body if (body or '').strip() else self.structure.types[item_type].body
            atomic_write(path, fm.build(fields, body), exclusive=True)
        return self.read(item_id)

    # ── writes in a structure with its own file format (Structure.codec) ─────
    def _create_coded(self, item_type, subject, values, body, given=None):
        """A new item as its structure's template, filled in (a Ticketing ticket: `<ID> <Title>.md` in its project)."""
        codec = self.structure.codec
        tdef = self.structure.types[item_type]
        with self._lock:
            r = self._resolver()
            if item_type == 'project':
                return self._create_project(subject, given or {}, r, body)
            project = values.get('project') or None
            scoped = item_type in self.structure.extras.get('project_scoped', ())
            parent = None
            if values.get('related_to'):
                self._check_relation({'id': None, 'type': item_type}, values['related_to'])
                parent = self.find(values['related_to'])
                if scoped and not project:
                    project = parent['fields'].get('project')
            if values.get('relations'):
                self._check_relations({'id': None}, values['relations'])
            if project and project not in r.projects:
                raise StoreError(400, f'unknown project: {project}')
            if scoped and not project:
                known = ', '.join(sorted(r.projects)) or 'none yet: create one first'
                raise StoreError(400, f'a {tdef.label.lower()} lives in a project: choose one ({known})')
            if item_type == 'plan' and not parent:
                raise StoreError(400, 'a plan executes an initiative or a support ticket: choose it in Related to')
            values = {**values, 'project': project} if project else values
            dup = self._rule('duplicate_of', item_type, values, self.items())
            if dup:  # the same problem again (an open support ticket with this signature): one more occurrence
                return self.read(self._rule('add_occurrence', dup, body, r, now_stamp()))
            item_id = self.next_id(item_type, project=project) if tdef.has_id else None
            if item_id:
                self._mark_ids([item_id])
            stamp = now_stamp()
            vals = {k: v for k, v in self._defaults(item_type, self.structure.defaults).items() if k in tdef.fields and k not in values}
            vals.update(values)
            vals = self._ticket_rules_on_create(item_type, vals, r, stamp)
            vals['created_at'] = vals['updated_at'] = stamp
            rel, text = codec.new_file(item_type, subject, vals, body, r, item_id, stamp, parent=parent)
            path = self.abs(rel)
            if os.path.exists(path):
                raise StoreError(409, f'already exists: {rel}')
            os.makedirs(os.path.dirname(path), exist_ok=True)
            self._remember_people(clean_people(vals.get('from')) + clean_people(vals.get('attendees')) + self._watching_people(vals))
            self._remember_labels(vals.get('labels'))
            atomic_write(path, text, exclusive=True)
        return self.read(item_id or rel)

    def _create_project(self, name, given, r, body=''):
        """A project: its folder, its note (`00 <Name>.md`, fileClass Ticket Project) and its type folders."""
        codec = self.structure.codec
        key = str(given.get('project_key') or '').strip().upper()
        kind = str(given.get('project_kind') or 'product').strip()
        if not re.match(r'^[A-Z]{2,4}$', key):
            raise StoreError(400, 'a project needs a key of 2 to 4 capital letters (project_key)')
        if key in r.projects:
            raise StoreError(409, f'the key {key} is taken by the project {r.projects[key]["name"]}')
        if kind not in ('system', 'product'):
            raise StoreError(400, 'project_kind must be system or product')
        stamp = now_stamp()
        rel, text = codec.new_file('project', name, {}, body, r, None, stamp)
        folder = self.abs(os.path.dirname(rel))
        if os.path.lexists(folder):
            raise StoreError(409, f'already exists: {os.path.dirname(rel)}')
        text = fm.patch(text, {'project_key': key, 'project_kind': kind, 'enabled_types': codec.enabled_types(kind)})
        os.mkdir(folder)
        for sub in codec.project_folders(kind):
            os.makedirs(os.path.join(folder, sub), exist_ok=True)
        atomic_write(self.abs(rel), text, exclusive=True)
        return self.read(rel)

    def _convert_coded(self, key, new_type, values):
        """An inbox item becomes a ticket: a new file from the type's template (title, body, links and labels
        carried over, `converted_from` keeping the inbox id), then the inbox file goes."""
        with self._lock:
            it = self.find(key)
            if it['type'] != 'inbox':
                raise StoreError(400, f"only inbox items convert, not a {it['type']}")
            src = self.abs(it['path'])
            _, body = self._read(src)
            old = it['fields']
            carried = {k: old[k] for k in ('url', 'url_label', 'links', 'labels', 'attachments') if old.get(k)}
            body = '\n'.join(line for line in body.strip().split('\n') if line.strip() not in ('## Related', '-', '- ')).strip()
            if body == it['title']:
                body = ''  # an inbox note's template body is its title: nothing more was written
            if it['id']:
                self._mark_ids([it['id']])
            new = self._create_coded(new_type, it['title'], {**carried, **values, 'converted_from': it['id']}, body)
            os.remove(src)
        return new

    def _rule(self, name, *args):
        """Run one of the structure's own rules (its codec's hook `name`), if it has it; a rule that says no is a 400."""
        codec = self.structure.codec
        hook = getattr(codec, name, None)
        if not hook:
            return None
        try:
            return hook(self, *args)
        except codec.rule_error as e:
            raise StoreError(400, str(e))

    def _ticket_rules_on_create(self, item_type, values, r, stamp):
        """The structure's own rules for a new item (a support ticket's level and due date…): its codec's, if any."""
        out = self._rule('on_create', item_type, values, r, stamp)
        return values if out is None else out

    def _ticket_rules_on_update(self, it, values, r, stamp):
        """The structure's own rules for a change (allowed transitions, gates, a level that only goes up…)."""
        out = self._rule('on_update', it, values, r, stamp)
        return values if out is None else out

    @writes
    def close_by_rule(self, it, status, stamp, extra=None):
        """A status set by one of the structure's rules (a support ticket closing with what it became, a promoted
        one going on hold…): written as any change, logged `by: rule`, without the transition checks a person's
        change goes through."""
        stamp = stamp or now_stamp()
        with self._lock:
            path = self.abs(it['path'])
            with open(path, encoding='utf-8') as f:
                text = f.read()
            raw = fm.parse(fm.split(text)[0])
            values = {**(extra or {}), 'status': status, 'updated_at': stamp}
            disk = self.structure.codec.encode(it['type'], values, raw, self._resolver(), stamp=stamp, by='rule', current=it['fields'])
            atomic_write(path, fm.patch(text, disk, None))
        return self.read(it['key'])

    @writes
    def item_action(self, name, key):
        """One of the structure's actions on an item (Ticketing: promote, escalate)."""
        codec = self.structure.codec
        action = (getattr(codec, 'actions', None) or {}).get(name)
        if not action:
            raise StoreError(404, f'no action {name} in this structure')
        try:
            return action(self, key)
        except codec.rule_error as e:
            raise StoreError(400, str(e))

    def _write_coded(self, it, values, body, text, path, stamp):
        """Patch the item's file through the codec; a new title renames the file (and every link to it). → its key."""
        r = self._resolver()
        scoped = it['type'] in self.structure.extras.get('project_scoped', ())
        if 'project' in values and (values['project'] or None) != (it['fields'].get('project') or None):
            if scoped:
                raise StoreError(400, 'a ticket cannot move to another project: its id carries the project key')
            if values['project'] and values['project'] not in r.projects:
                raise StoreError(400, f"unknown project: {values['project']}")
        if it['type'] == 'project':  # its key names every id of the project
            values = {k: v for k, v in values.items() if k not in ('project_key', 'project')}
        values = self._ticket_rules_on_update(it, values, r, stamp)
        raw = fm.parse(fm.split(text)[0])
        disk = self.structure.codec.encode(it['type'], values, raw, r, stamp=stamp, current=it['fields'])
        atomic_write(path, fm.patch(text, disk, body))
        key = it['key']
        if it['type'] == 'project' and 'enabled_types' in values:  # a type it turns on gets its folder (vault check)
            for sub in self.structure.codec.project_folders(it['fields'].get('project_kind'), values['enabled_types']):
                os.makedirs(os.path.join(os.path.dirname(path), sub), exist_ok=True)
        if 'subject' in values and values['subject'] != it['title']:
            key = self._rename_coded(it, values['subject'], stamp)
        self._rule('after_update', it, values, stamp)
        return key

    def _rename_coded(self, it, subject, stamp):
        """The title is the file name: rename the file and rewrite every `[[old]]` in the vault to `[[new]]`. Each
        file touched is copied first to .task-manager/backup/<stamp>-rename/; the edits are planned before any is
        written, and the rename comes last. → the item's key (its path, for one without an id)."""
        codec = self.structure.codec
        new_rel = codec.renamed(it, subject, stamp)
        if not new_rel or new_rel == it['path']:
            return it['key']
        src, dst = self.abs(it['path']), self.abs(new_rel)
        if os.path.lexists(dst):
            raise StoreError(409, f'another file already has that name: {new_rel}')
        old_stem, new_stem = [os.path.splitext(os.path.basename(p))[0] for p in (it['path'], new_rel)]
        self._relink(old_stem, new_stem, stamp, also=[src])
        os.rename(src, dst)
        return it['id'] or new_rel

    def _relink(self, old_stem, new_stem, stamp, also=()):
        """Rewrite every `[[old_stem]]` of the vault to `[[new_stem]]` (Obsidian names a note by its stem). Each file
        touched, and those in `also` (the one being renamed), is copied first to .task-manager/backup/<stamp>-rename/;
        the edits are planned before any is written. → how many files changed."""
        rewrite = self.structure.codec.relink if self.structure.codec else wikilinks.rewrite
        edits = []
        for path in self._walk_md(docs=True):
            with open(path, encoding='utf-8') as f:
                before = f.read()
            after = rewrite(before, old_stem, new_stem)
            if after != before:
                edits.append((path, after))
        backup = os.path.join(self.root, META_DIR, 'backup', f"{stamp.replace(':', '').replace('T', '-')}-rename")
        for path in dict.fromkeys([*also, *(p for p, _ in edits)]):
            copy = os.path.join(backup, self.rel(path))
            os.makedirs(os.path.dirname(copy), exist_ok=True)
            shutil.copy2(path, copy)
        for path, after in edits:
            atomic_write(path, after)
        return len(edits)

    @writes
    def update(self, key, values=None, body=None, base_rev=None, base_body_rev=None):
        """Patch fields and, when `body` is given, replace the body. `base_body_rev` (the body_rev the
        editor loaded) makes a body write a 409 if the body changed on disk since; `base_rev` (the
        file's rev) does the same for any change to the file. Both optional: without them, last write wins."""
        values = dict(values or {})
        resolved = values.pop('resolved', None)  # explicit "mark resolved / reopen"; the resolution text is left alone
        renamed = 'subject' in values
        subject = str(values.pop('subject', None) or '').strip()
        if renamed and not subject:  # an item without a subject has nothing to show for it in any list
            raise StoreError(400, 'subject is required')
        with self._lock:
            it = self.find(key)
            # Filtered by the item's own type, before any rule below reads a value.
            values = self._valid(it['type'], values)
            if renamed:
                values['subject'] = subject
            path = self.abs(it['path'])
            with open(path, encoding='utf-8') as f:
                st = os.fstat(f.fileno())
                text = f.read()
            # Lost-update guard, for clients that say what they started from. The file may have been
            # edited outside the app (Claude, Obsidian) since: writing on top would erase that edit.
            now_rev, now_body_rev = file_rev((st.st_ino, st.st_mtime_ns, st.st_size)), body_rev(fm.split(text)[1])
            if base_rev is not None and base_rev != now_rev:
                raise StoreError(409, 'the item changed on disk since you opened it', rev=now_rev, body_rev=now_body_rev)
            if body is not None and base_body_rev is not None and base_body_rev != now_body_rev:
                raise StoreError(409, 'the description changed on disk since you opened it', rev=now_rev, body_rev=now_body_rev)
            stamp = now_stamp()
            if 'status' in values:  # completed_at follows status; never set by hand
                closed = self.structure.closed_of(it['type'])
                was = it['fields'].get('status')
                # A status this vault no longer has (renamed in Settings → Item type status): its completed_at says
                # whether it was closed, so a renamed Done keeps the day it was done.
                was_closed = was in closed or (was not in self.structure.statuses_of(it['type']) and bool(it['fields'].get('completed_at')))
                if values['status'] in closed and not was_closed:
                    values['completed_at'] = stamp
                elif values['status'] not in closed:
                    values['completed_at'] = None
            # writing the first resolution resolves; clearing it reopens (only where resolved_at exists: an activity;
            # a Ticketing support ticket's `resolution` is how it ended, not whether)
            if 'resolution' in values and 'resolved_at' in self.structure.types[it['type']].fields:
                if values['resolution'] and not it['fields'].get('resolution') and not it['fields'].get('resolved_at'):
                    values['resolved_at'] = stamp
                elif not values['resolution']:
                    values['resolved_at'] = None
            if resolved is not None:  # the explicit action wins over the text rules above
                if it['type'] != 'activity':
                    raise StoreError(400, f"only activities can be resolved, not a {it['type']}")
                values['resolved_at'] = (it['fields'].get('resolved_at') or stamp) if resolved else None
            if 'related_to' in values and values['related_to']:
                self._check_relation(it, values['related_to'])
            if values.get('relations'):
                self._check_relations(it, values['relations'])
            # Moving the day resets the Today column: each day starts in Uncategorized.
            if 'plan_day' in values and values['plan_day'] != it['fields'].get('plan_day') and 'today_list' not in values:
                values['today_list'] = None
            values['updated_at'] = stamp
            self._remember_people(clean_people(values.get('from')) + clean_people(values.get('attendees')) + self._watching_people(values))
            self._remember_labels(values.get('labels'))
            if self.structure.codec:
                return self.read(self._write_coded(it, values, body, text, path, stamp))
            atomic_write(path, fm.patch(text, values, body))
        return self.read(it['key'])

    @writes
    def convert(self, key, new_type, values=None):
        """Turn an inbox item into a task/initiative/note/meeting.

        The item gets the new type's id and moves to that type's folder; subject,
        content, links, labels and created_at carry over, and `converted_from`
        keeps the old id. Only inbox items convert: nothing can point at them,
        while ids of the other types are referenced by relations and the work log.
        """
        if new_type in self.full_structure.types and new_type not in self.structure.types:
            raise StoreError(400, self._type_off(new_type))
        if new_type not in self.structure.types or new_type == 'inbox' or (self.structure.codec and not self.structure.types[new_type].convertible):
            raise StoreError(400, f'cannot convert to: {new_type}')
        values = self._valid(new_type, values)  # what the new type may carry, not the inbox's
        if self.structure.codec:
            return self._convert_coded(key, new_type, values)
        with self._lock:
            it = self.find(key)
            if it['type'] != 'inbox':
                raise StoreError(400, f"only inbox items convert, not a {it['type']}")
            if values.get('related_to'):
                self._check_relation({**it, 'type': new_type}, values['related_to'])
            if values.get('relations'):
                self._check_relations({'id': None}, values['relations'])
            src = self.abs(it['path'])
            _, body = self._read(src)
            old = it['fields']
            new_id = self.next_id(new_type)
            self._mark_ids([new_id, it['id']])
            stamp = now_stamp()
            fields = {'id': new_id, 'type': new_type, 'subject': it['title']}
            defaults = {**FIELD_DEFAULTS, **self.structure.defaults}
            for k in self.structure.types[new_type].fields:
                fields[k] = values.get(k, old.get(k, defaults.get(k)) if k in CARRY_OVER else defaults.get(k))
            if old.get('attachments'):  # its files go with it (a field of every type, so not in the loop above)
                fields['attachments'] = old['attachments']
            fields.update({k: v for k, v in values.items() if k not in fields})
            if fields.get('status') in self.structure.closed_of(new_type):
                fields['completed_at'] = stamp
            if fields.get('resolution'):
                fields['resolved_at'] = stamp
            fields['converted_from'] = it['id']
            self._remember_people(clean_people(fields.get('from')) + clean_people(fields.get('attendees')) + self._watching_people(fields))
            self._remember_labels(fields.get('labels'))
            fields['created_at'] = old.get('created_at') or stamp
            fields['updated_at'] = stamp
            folder = self.abs(self.folders[new_type])
            os.makedirs(folder, exist_ok=True)
            dst = os.path.join(folder, f'{new_id}-{slugify(it["title"])}.md')
            atomic_write(dst, fm.build(fields, body[1:] if body.startswith('\n') else body), exclusive=True)
            os.remove(src)
        return self.read(new_id)

    @writes
    def add_comment(self, key, text):
        text = str(text or '').strip()
        if not text:
            raise StoreError(400, 'a comment needs text')
        # Read and write under one hold of the (reentrant) lock: two comments sent at once both land,
        # instead of each rewriting the list it read before the other was saved.
        with self._lock:
            it = self.find(key)
            if 'comments' not in self.structure.allowed_fields(it['type']):  # update() would drop it without a word
                raise StoreError(400, f"a {it['type']} has no comments")
            comments = list(it['fields'].get('comments') or []) + [{'at': now_stamp(), 'text': text}]
            return self.update(it['key'], {'comments': comments})

    @writes
    def delete_comment(self, key, index):
        with self._lock:  # the index points into the list as it is now, not as some other request left it
            it = self.find(key)
            comments = list(it['fields'].get('comments') or [])
            if not 0 <= index < len(comments):
                raise StoreError(404, 'comment not found')
            comments.pop(index)
            return self.update(it['key'], {'comments': comments})

    # ── Claude sessions: one entry per launch, on the item (or in the global file) ──
    @writes
    def add_claude_session(self, key, entry):
        """Record a launch on the item, so its conversation can be resumed from the card. → the item."""
        with self._lock:  # read and write under one hold: two launches at once both land
            it = self.find(key)
            if 'claude_sessions' not in self.structure.allowed_fields(it['type']):  # update() would drop it without a word
                raise StoreError(400, f"a {it['type']} keeps no Claude sessions")
            sessions = list(it['fields'].get('claude_sessions') or []) + [entry]  # validate() checks its shape
            return self.update(it['key'], {'claude_sessions': sessions})

    @writes
    def forget_claude_session(self, key, index):
        """Drop one entry from the item's list. The session itself stays on disk (Claude Code owns it)."""
        with self._lock:
            it = self.find(key)
            sessions = list(it['fields'].get('claude_sessions') or [])
            if not 0 <= index < len(sessions):
                raise StoreError(404, 'Claude session not found')
            sessions.pop(index)
            return self.update(it['key'], {'claude_sessions': sessions})

    def claude_session(self, key, session_id):
        """The recorded entry a resume starts from (its cwd is what the shell gets). 404 if it is not on record."""
        sessions = self.find(key)['fields'].get('claude_sessions') if key else self.global_claude_sessions()['sessions']
        found = next((s for s in sessions or [] if s.get('id') == str(session_id or '').strip().lower()), None)
        if not found:
            raise StoreError(404, 'Claude session not found')
        return found

    def _check_relations(self, item, ids):
        """Each id of a `relations` list is another item that can be related to (not an inbox item nor a prompt)."""
        by_id = {i['id']: i for i in self.items() if i['id']}
        for target_id in ids:
            target = by_id.get(target_id)
            if not target:
                raise StoreError(400, f'relations: {target_id} not found')
            if target_id == item.get('id'):
                raise StoreError(400, 'an item cannot be related to itself')
            if 'relations' not in self.structure.allowed_fields(target['type']):
                raise StoreError(400, f"nothing can be related to a {target['type']}")

    def related_of(self, item, items=None):
        """The items linked to `item` as equals, both ways: the ones it lists and the ones that list it."""
        items = self.items() if items is None else items
        own = set(item['fields'].get('relations') or [])
        return [i for i in items if i['id'] and i['id'] != item['id']
                and (i['id'] in own or item['id'] in (i['fields'].get('relations') or []))]

    def _check_relation(self, item, target_id):
        allowed = self.structure.types[item['type']].parents
        by_id = {i['id']: i for i in self.items() if i['id']}
        target = by_id.get(target_id)
        if not target:
            raise StoreError(400, f'related_to: {target_id} not found')
        if target['type'] not in allowed:
            raise StoreError(400, f"a {item['type']} cannot be related to a {target['type']}")
        seen, cur = set(), target
        while cur:  # walk up: refusing cycles (A → B → A)
            if cur['id'] == item['id'] or cur['id'] in seen:
                raise StoreError(400, 'related_to would create a cycle')
            seen.add(cur['id'])
            cur = by_id.get(cur['fields'].get('related_to'))

    @writes
    def migrate_user_stories(self):
        """One-off, safe to repeat: user stories that used to live inside an initiative's frontmatter
        (`user_stories: [...]`) become story items, related to that initiative. The initiative file is copied
        to .task-manager/backup/ first, and a story remembers where it came from (`legacy_id`) so a second
        run never duplicates it."""
        moved = []
        if self.full_structure is not FOLDER_PER_TYPE or 'story' not in self.structure.types:  # folder per type only; kept embedded while stories are off
            return moved
        for ini in [i for i in self.items() if i['type'] == 'initiative']:
            legacy = ini['fields'].get('user_stories') or []
            if not legacy or not ini['id']:
                continue
            backup = os.path.join(self.root, META_DIR, 'backup')
            os.makedirs(backup, exist_ok=True)
            shutil.copy2(self.abs(ini['path']), os.path.join(backup, f"{datetime.now():%Y%m%d-%H%M%S}-{os.path.basename(ini['path'])}"))
            done = {s['fields'].get('legacy_id') for s in self.items()
                    if s['type'] == 'story' and s['fields'].get('related_to') == ini['id']}
            for st in legacy:
                if not isinstance(st, dict) or not st.get('subject') or st.get('id') in done:
                    continue
                values = {k: st[k] for k in ('status', 'redmine_url', 'local_path') if st.get(k)}
                try:
                    made = self.create('story', st['subject'], {**values, 'related_to': ini['id'], 'legacy_id': st.get('id')})
                except StoreError:  # an old value the validator now refuses (a broken URL): keep the story, drop that value
                    made = self.create('story', st['subject'], {**{k: v for k, v in values.items() if k != 'redmine_url'},
                                                                'related_to': ini['id'], 'legacy_id': st.get('id')})
                moved.append({'initiative': ini['id'], 'story': made['id'], 'was': st.get('id')})
            with self._lock:  # the stories now live as items; the list stays, empty, for old readers
                self._patch_fields(ini, {'user_stories': []})
        return moved

    # ── "work on it with Claude": the prompt and the folder it runs in ───────
    def claude_prompt(self, key, instruction=''):
        """The item as a prompt: its facts, its relation, its links, its description, then what to do."""
        it = self.read(key)
        f = it['fields']
        parent = next((i for i in self.items() if i['id'] and i['id'] == f.get('related_to')), None)
        facts = []

        def add(label, value):
            if value not in (None, '', []):
                facts.append(f'- {label}: {value}')

        add('Type', it['type'])
        add('Status', f.get('status'))
        add('Priority', f.get('priority'))
        add('Priority reason', f.get('priority_reason'))
        add('Planned', f.get('plan_day') or f.get('plan_week'))
        add('Due', f.get('due'))
        add('Date', f.get('date'))
        add('Time', f.get('time'))
        add('Attendees', ', '.join(f.get('attendees') or []))
        add('Source', f.get('source'))
        add('From', ', '.join(f.get('from') or []) if isinstance(f.get('from'), list) else f.get('from'))
        add('Related to', f"{parent['id']} · {parent['title']}" if parent else f.get('related_to'))
        add('Related', ', '.join(f"{r['id']} · {r['title']}" for r in self.related_of(it)) if it['id'] else None)
        add('Labels', ', '.join(f.get('labels') or []))
        add('Watchers', ', '.join(f.get('watchers') or []))
        ext = self.structure.external_ref  # the outside tracker: Redmine in the folder-per-type structure
        add(ext['label'], ' '.join(x for x in (f.get(ext['id_key']) and f"#{f[ext['id_key']]}", f.get(ext['url_key'])) if x))
        add('Local path', f.get('local_path'))
        add('Item file', self.abs(it['path']))
        links = ([{'label': f.get('url_label') or 'Link', 'url': f['url']}] if f.get('url') else []) + list(f.get('links') or [])
        if links:
            facts.append('- Links:')
            facts += [f"  - {l.get('label') or 'Link'}: {l.get('url')}" for l in links]
        body = (it.get('body') or '').strip()
        comments = [c.get('text') for c in f.get('comments') or [] if isinstance(c, dict)]
        tail_people = self.watchers_note(f.get('watchers')) + self.mentions_note(body, *comments, instruction)
        head = f"I want to work on this item from my task manager.\n\n# {it['id'] or it['type']} · {it['title']}\n\n" + '\n'.join(facts)
        tail = f"{tail_people}\n\n## What I want\n\n{(instruction or '').strip() or CLAUDE_DEFAULT_INSTRUCTION}\n"
        room = CLAUDE_MAX_PROMPT - len((head + tail).encode('utf-8')) - 200
        if body:
            raw = body.encode('utf-8')
            if len(raw) > room:
                body = raw[:max(room, 0)].decode('utf-8', 'ignore') + '\n\n[…the description was cut here: it is longer than the prompt allows]'
            head += f'\n\n## Description\n\n{body}'
        return head + tail

    def _contact_lines(self, names):
        known = {r['name'].lower(): r for r in self._people_records()}
        groups = {g['name'].lower(): g for g in self._group_records()}
        return '\n'.join(people.contact_line(n, known.get(n.lower()), groups.get(n.lower())) for n in names)

    def watchers_note(self, names):
        """For a prompt: the item's watchers (TSK-051) and how to reach each, to tell them when its status changes.
        '' when it has none."""
        names = clean_people(names)
        if not names:
            return ''
        return '\n\n## Watchers\n\nTell them when its status changes, as each one says:\n\n' + self._contact_lines(names)

    def mentions_note(self, *texts):
        """For a prompt: the people the texts mention (@[Name]) and how to reach them, so that "send this to
        @[Ana]" carries Ana's email, Slack and Redmine user. '' when nobody is mentioned."""
        names = people.mentions(*texts)
        if not names:
            return ''
        return '\n\n## People mentioned\n\n' + self._contact_lines(names)

    def claude_cwd(self, key, fallback=''):
        """Where Claude should start: the item's Local path, else its parent's (up to five levels), else its
        project's (Ticketing), else the default folder from the settings, else the home folder. → {path, source, from_id}.
        With no key (a launch from the top bar) only the last two apply."""
        def good(raw):
            p = os.path.expanduser(str(raw or '').strip())
            return os.path.realpath(p) if p and os.path.isabs(p) and os.path.isdir(p) else None

        cur, seen, project = (self.find(key) if key else None), set(), None
        for depth in range(6 if cur else 0):
            path = good(cur['fields'].get('local_path'))
            if path:
                return {'path': path, 'source': 'item' if depth == 0 else 'parent', 'from_id': cur['id']}
            seen.add(cur['id'])
            project = project or (cur['fields'].get('project') if cur['type'] != 'project' else None)
            parent = cur['fields'].get('related_to')
            cur = next((i for i in self.items() if i['id'] == parent), None) if parent and parent not in seen else None
            if cur is None:
                break
        # Ticketing: a ticket belongs to its project through `project` (its key), not `related_to`: the project last
        if project:
            home = next((i for i in self.items() if i['type'] == 'project' and i['fields'].get('project_key') == project), None)
            path = good(home['fields'].get('local_path')) if home else None
            if path:
                return {'path': path, 'source': 'parent', 'from_id': home['id']}
        path = good(fallback)
        if path:
            return {'path': path, 'source': 'settings', 'from_id': None}
        return {'path': os.path.expanduser('~'), 'source': 'home', 'from_id': None}

    # ── trash: <root>/.task-manager/trash/ ───────────────────────────────────
    # A deleted item is moved here, next to a `<file>.meta.json` that remembers where it came from,
    # when it went and which related items were detached from it. Nothing leaves the trash unless
    # the user restores it or empties it. A file taken off an item goes to trash/attachments/; a deleted
    # item's own files stay in Attachments/ (a restore finds them) until the item is purged.
    def _trash_dir(self):
        return os.path.join(self.root, META_DIR, 'trash')

    def _attachments_trash(self):
        return os.path.join(self._trash_dir(), 'attachments')

    def _in_trash(self, trashed):
        src = self.abs(trashed)
        if not src.startswith(self._trash_dir() + os.sep) or not os.path.isfile(src):
            raise StoreError(404, f'not in the trash: {trashed}')
        return src

    @staticmethod
    def _trash_meta(path):
        for suffix in ('.meta.json', '.relations.json'):  # the second is how older deletes were recorded
            try:
                with open(path + suffix, encoding='utf-8') as f:
                    return json.load(f)
            except (OSError, ValueError):
                continue
        return {}

    def _drop_sidecars(self, path):
        for suffix in ('.meta.json', '.relations.json'):
            if os.path.exists(path + suffix):
                os.remove(path + suffix)

    def _trash_files(self):
        folder = self._trash_dir()
        if not os.path.isdir(folder):
            return []
        return [os.path.join(folder, n) for n in sorted(os.listdir(folder)) if n.endswith('.md') and not n.startswith('.')]

    @staticmethod
    def _file_ids(path):
        """The ids a trashed file holds: its own and, for a converted item, the inbox id it came from."""
        try:
            with open(path, encoding='utf-8', errors='replace') as f:
                fields = fm.parse(fm.split(f.read())[0])
        except OSError:
            return []
        return [fields.get('id'), fields.get('converted_from')]

    def _trashed_ids(self):
        return [i for path in self._trash_files() for i in self._file_ids(path)]

    @staticmethod
    def _file_attachments(path):
        """The files a trashed item lists in its `attachments` (none when unreadable or not attachment paths)."""
        try:
            with open(path, encoding='utf-8', errors='replace') as f:
                return attachments.clean_list(fm.parse(fm.split(f.read())[0]).get('attachments'))
        except (OSError, ValueError):
            return []

    def _listed_attachments(self, purging=()):
        """Every attachment path some item lists: the live ones (hidden types too) and the deleted ones still in the
        trash, but those in `purging` (trashed files on their way out)."""
        listed = {p for it in self._scan(resolve=False, hidden_too=True)[0] for p in it['fields'].get('attachments') or []}
        purging = {os.path.realpath(p) for p in purging}
        listed.update(p for path in self._trash_files() if os.path.realpath(path) not in purging for p in self._file_attachments(path))
        return listed

    def _orphaned_by(self, purging):
        """The files the trashed items in `purging` list that no other item does: what goes with them."""
        listed = self._listed_attachments(purging)
        return list(dict.fromkeys(p for path in purging for p in self._file_attachments(path) if p not in listed))

    def _drop_attachments(self, rels):
        """Delete for good these files of Attachments/, and their item's folder once it is empty. Only what
        attachment_file would serve: a path through a symlink out of the folder is left alone, and a symlinked file
        loses the link, never its target. → how many went."""
        top = os.path.join(self.root, attachments.DIR)
        n = 0
        for rel in rels:
            try:
                self.attachment_file(rel)
            except StoreError:
                continue
            path = os.path.join(self.root, *rel.split('/'))
            os.remove(path)
            n += 1
            folder = os.path.dirname(path)
            while folder != top and folder.startswith(top + os.sep):
                try:
                    os.rmdir(folder)  # only when empty: a file nobody lists stays, for the check to point at
                except OSError:
                    break
                folder = os.path.dirname(folder)
        return n

    def unlisted_attachments(self):
        """Warnings, never blocking: files in Attachments/ that no item lists, live or in the trash. A pass of its own,
        not part of check(): that one runs before every write, and both checkers skip the folder on purpose."""
        top = os.path.join(self.root, attachments.DIR)
        if not os.path.isdir(top):
            return []
        listed, out = self._listed_attachments(), []
        for dirpath, dirnames, filenames in os.walk(top):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith('.'))
            for name in sorted(filenames):
                if name.startswith('.') or name in IGNORED_FILES:
                    continue
                rel = self.rel(os.path.join(dirpath, name)).replace(os.sep, '/')
                if rel not in listed:
                    out.append({'kind': 'unlisted_attachment', 'path': rel,
                                'detail': f'In {attachments.DIR}/, but no item lists it: the app never shows it.'})
        return out

    def removed_attachments(self):
        """How many files taken off an item wait in trash/attachments/: emptying the trash deletes them."""
        return sum(len(names) for _, _, names in os.walk(self._attachments_trash()))

    def trash(self):
        """What is in the trash, most recently deleted first."""
        out = []
        for path in self._trash_files():
            try:
                with open(path, encoding='utf-8', errors='replace') as f:
                    fields, _ = fm.split(f.read())
                fields = fm.parse(fields)
            except OSError:
                continue
            name = os.path.basename(path)
            stamp = TRASH_STAMP_RE.match(name)
            meta = self._trash_meta(path)
            kind = self._type_of(self.rel(path), fields)
            deleted_at = meta.get('deleted_at')
            if not deleted_at and stamp:
                deleted_at = datetime.strptime(stamp.group(1) + stamp.group(2), '%Y%m%d%H%M%S').strftime('%Y-%m-%dT%H:%M:%S')
            original = meta.get('path') or os.path.join(self.folders.get(kind, ''), stamp.group(3) if stamp else name)
            out.append({
                'trashed': self.rel(path), 'id': fields.get('id'), 'type': kind,
                'title': str(fields.get('subject') or fields.get('title') or os.path.splitext(name)[0]),
                'original_path': original, 'deleted_at': deleted_at or '',
                'related_to': fields.get('related_to'), 'unlinked': len(meta.get('children') or []),
            })
        return sorted(out, key=lambda e: e['deleted_at'], reverse=True)

    # ── attachments (tm/attachments.py) ─────────────────────────────────────────
    @writes
    def add_attachment(self, key, filename, data):
        """Keep `data` as one of the item's files — Attachments/<its folder>/<name>, "name-2.png" when the name is
        taken — and add it to its `attachments`. → the item."""
        if len(data) > attachments.MAX_BYTES:
            raise StoreError(413, f'an attachment is at most {attachments.MAX_BYTES // (1024 * 1024)} MB')
        try:
            name = attachments.safe_name(filename)
        except ValueError as e:
            raise StoreError(400, str(e)) from None
        with self._lock:
            it = self.find(key)
            folder = f'{attachments.DIR}/{attachments.owner_folder(it)}'
            os.makedirs(self.abs(folder), exist_ok=True)
            stem, ext = os.path.splitext(name)
            rel, n = f'{folder}/{name}', 1
            while os.path.lexists(self.abs(rel)):
                n += 1
                rel = f'{folder}/{stem}-{n}{ext}'
            atomic_write(self.abs(rel), data, exclusive=True)
            return self.update(key, {'attachments': [*(it['fields'].get('attachments') or []), rel]})

    @writes
    def remove_attachment(self, key, path):
        """Take one file off the item: out of its `attachments`, and the file to .task-manager/trash/attachments/
        (never unlinked). → {item, trashed} (trashed: where it went, for restore_attachment; None when it was gone)."""
        with self._lock:
            it = self.find(key)
            current = list(it['fields'].get('attachments') or [])
            if path not in current:
                raise StoreError(404, f'{it["id"] or it["title"]} has no attachment {path}')
            src = self.abs(path)
            dst = None
            if os.path.isfile(src):
                trash = self._attachments_trash()
                os.makedirs(trash, exist_ok=True)
                dst, n = None, 0
                while dst is None or os.path.lexists(dst):
                    dst = os.path.join(trash, f"{datetime.now():%Y%m%d-%H%M%S}{'' if not n else f'-{n}'}-{os.path.basename(src)}")
                    n += 1
                shutil.move(src, dst)
            item = self.update(key, {'attachments': [p for p in current if p != path]})
            return {'item': item, 'trashed': self.rel(dst) if dst else None}

    @writes
    def restore_attachment(self, key, trashed, path):
        """Undo remove_attachment: the file back from the trash to `path`, and onto the item's list again. → the item."""
        with self._lock:
            it = self.find(key)
            try:
                path = attachments.clean_list([path])[0]
            except (ValueError, IndexError):
                raise StoreError(400, f'not an attachment: {path}') from None
            src = self.abs(trashed)
            if not src.startswith(os.path.realpath(self._attachments_trash()) + os.sep) or not os.path.isfile(src):
                raise StoreError(404, f'not in the trash: {trashed}')
            dst = self.abs(path)
            if os.path.lexists(dst):
                raise StoreError(409, f'{path} exists again: not overwritten')
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(src, dst)
            return self.update(key, {'attachments': [*(it['fields'].get('attachments') or []), path]})

    def attachment_file(self, path):
        """The file on disk of an attachment path, for serving: inside Attachments/ (symlinks followed) and a file."""
        try:
            rel = attachments.clean_list([path])[0]
        except (ValueError, IndexError):
            raise StoreError(400, f'not an attachment: {path}') from None
        full = self.abs(rel)
        if not full.startswith(os.path.realpath(os.path.join(self.root, attachments.DIR)) + os.sep) or not os.path.isfile(full):
            raise StoreError(404, f'no such attachment: {rel}')
        return full

    # ── the vault as files (the sidebar's Explorer) ──────────────────────────
    FILES_MAX = 5000  # entries listed; a vault with more says it was cut (truncated)
    FILES_SKIP = {'node_modules', '__pycache__'}  # unlike SKIP_DIRS, Attachments/ is listed: it holds real files

    @classmethod
    def _listable(cls, rel):
        """Whether the Explorer shows `rel`: no part of it hidden (.task-manager, .obsidian, .git…) or skipped."""
        parts = [p for p in re.split(r'[\\/]+', str(rel or '')) if p not in ('', '.')]
        return bool(parts) and not any(p.startswith('.') or p in cls.FILES_SKIP for p in parts)

    def files(self):
        """Every folder and file of the vault, as a flat list of {path, kind: dir|file, size, mtime, item?}, sorted
        by path. A file that is an item carries {key, type, status, title}; hidden folders are left out."""
        items = {it['path']: it for it in self.items()}
        out, truncated = [], False
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith('.') and d not in self.FILES_SKIP)
            for name, kind in [*((d, 'dir') for d in dirnames), *((f, 'file') for f in sorted(filenames))]:
                if name.startswith('.'):
                    continue
                full = os.path.join(dirpath, name)
                try:
                    st = os.stat(full)
                except OSError:
                    continue  # a broken symlink, or gone meanwhile
                if len(out) >= self.FILES_MAX:
                    truncated = True
                    break
                rel = self.rel(full).replace(os.sep, '/')
                entry = {'path': rel, 'kind': kind, 'mtime': int(st.st_mtime)}
                if kind == 'dir' and self.full_structure.in_docs(rel):
                    order = self._read_order(rel)
                    if order:
                        entry['order'] = order
                if kind == 'file':
                    entry['size'] = st.st_size
                    it = items.get(rel)
                    if it:
                        entry['item'] = {'key': it['key'], 'type': it['type'], 'title': it['title'],
                                         'status': it['fields'].get('status'), 'rename': self._renames(it['type'])}
                out.append(entry)
            if truncated:
                break
        out.sort(key=lambda e: e['path'])
        return {'entries': out, 'truncated': truncated}

    SEARCH_MAX = 200     # lines answered, at most
    SEARCH_PER_FILE = 20  # of them from one file

    def search_files(self, query):
        """The lines of the vault's text files that hold `query` (case and accents aside), file by file, as the
        Explorer lists them (hidden folders out). → {query, results: [{path, line, text}], files, truncated}. A file that
        is not text (not UTF-8, a NUL in it) or larger than SAVE_MAX is skipped."""
        def fold(t):
            return ''.join(c for c in unicodedata.normalize('NFKD', t.casefold()) if not unicodedata.combining(c))
        q = fold(str(query or '').strip())
        if len(q) < 2:
            raise StoreError(400, 'search for 2 characters or more')
        results, files, truncated = [], 0, False
        for e in self.files()['entries']:
            if e['kind'] != 'file' or e.get('size', 0) > self.SAVE_MAX:
                continue
            try:
                with open(self.abs(e['path']), 'rb') as f:
                    raw = f.read()
                if b'\x00' in raw:
                    continue
                text = raw.decode('utf-8')
            except (OSError, UnicodeDecodeError, StoreError):
                continue
            hits = 0
            for n, line in enumerate(text.splitlines(), 1):
                if q in fold(line):
                    if len(results) >= self.SEARCH_MAX:
                        truncated = True
                        break
                    results.append({'path': e['path'], 'line': n, 'text': line.strip()[:300]})
                    hits += 1
                    if hits >= self.SEARCH_PER_FILE:
                        break
            files += bool(hits)
            if truncated:
                break
        return {'query': query, 'results': results, 'files': files, 'truncated': truncated}

    def backlinks(self, path):
        """The Markdown files that link to `path` with a wikilink ([[name]], [[name|alias]], [[name#heading]] — by its
        name without .md, as Obsidian resolves them, case aside), each with its first such line. → {path, links:
        [{path, line, text, count}]}."""
        rel = self._rel_path(path)
        stem = os.path.splitext(os.path.basename(rel))[0]
        link = re.compile(r'\[\[\s*' + re.escape(stem) + r'\s*(?:[#|][^\]\n]*)?\]\]', re.IGNORECASE)
        out = []
        for e in self.files()['entries']:
            if e['kind'] != 'file' or e['path'] == rel or not e['path'].lower().endswith('.md') or e.get('size', 0) > self.SAVE_MAX:
                continue
            try:
                with open(self.abs(e['path']), encoding='utf-8') as f:
                    text = f.read()
            except (OSError, UnicodeDecodeError, StoreError):
                continue
            hits = [(n, line) for n, line in enumerate(text.splitlines(), 1) if link.search(line)]
            if hits:
                n, line = hits[0]
                out.append({'path': e['path'], 'line': n, 'text': line.strip()[:300], 'count': len(hits)})
        return {'path': rel, 'links': out}

    def _renames(self, item_type):
        """How the Explorer renames an item's file: 'file' (its name is free: the folder-per-type structure keys items by id), 'title' (the
        file is named after the title: change that), or None (the structure fixes its name)."""
        codec = self.structure.codec
        if not codec:
            return 'file'
        return 'title' if codec.title_is_name(item_type) else None

    def vault_file(self, path):
        """The file on disk of a vault-relative path, for serving: inside the vault (symlinks followed), under no hidden
        folder, and a file."""
        rel = str(path or '').strip().replace('\\', '/').lstrip('/')
        if not self._listable(rel) or any(p == '..' for p in rel.split('/')):
            raise StoreError(400, f'not a vault file: {path}')
        full = self.abs(rel)
        if not os.path.isfile(full) or not self._listable(self.rel(full)):
            raise StoreError(404, f'no such file: {rel}')
        return full

    # ── the Explorer's operations: new folder, rename, move, delete ──────────
    # Every one is checked against the vault's structure after it is done, and undone when it would leave the vault
    # out of it (a type's folder renamed, an item moved where its type does not live…): one guard for every structure,
    # instead of rules per structure. An item's own file is never edited here: a delete goes through delete() (the
    # items' trash, its relations), and in a structure whose files are named after their title, a rename is a change of
    # title (update). A file some item lists as an attachment is managed from that item. Nothing is ever unlinked:
    # a deleted file or folder waits in .task-manager/trash/files/ until it is restored or the trash is emptied.

    def _files_trash(self):
        return os.path.join(self._trash_dir(), 'files')

    def _rel_path(self, path, allow_root=False):
        """A vault-relative path the Explorer may touch, as given (no '..', no hidden part); '' only with allow_root."""
        rel = str(path or '').strip().replace('\\', '/').strip('/')
        if not rel and allow_root:
            return ''
        if not self._listable(rel) or any(p in ('', '.', '..') for p in rel.split('/')):
            raise StoreError(400, f'not a vault path: {path}')
        self.abs(rel)  # stays inside the root
        return rel

    @staticmethod
    def _new_name(name):
        """A name for a file or folder: one part, not hidden, nothing a disk or Obsidian refuses."""
        name = unicodedata.normalize('NFC', str(name or '')).strip()
        if not name or name in ('.', '..') or name.startswith('.') or re.search(r'[\x00-\x1f\x7f/\\:*?"<>|]', name):
            raise StoreError(400, f'not a usable name: {name or "(empty)"}')
        return name

    def _item_at(self, rel):
        return next((it for it in self._scan(resolve=False, hidden_too=True)[0] if it['path'] == rel), None)

    def _items_under(self, rel):
        return [it for it in self._scan(resolve=False, hidden_too=True)[0] if it['path'].startswith(rel + '/')]

    def _refuse_items_into_docs(self, rel, new_rel):
        """An item never goes into a Docs folder: nothing there is scanned, so it would vanish from the app (TSK-039)."""
        if not self.full_structure.in_docs(new_rel) or self.full_structure.in_docs(rel):
            return
        hit = [self._item_at(rel)] if os.path.isfile(self.abs(rel)) else self._items_under(rel)
        hit = [it for it in hit if it]
        if hit:
            raise StoreError(409, f'{hit[0]["id"] or hit[0]["path"]} is an item: a Docs folder holds documents, and the app would '
                             'stop seeing it there' + (f' (and {len(hit) - 1} more)' if len(hit) > 1 else ''))

    # ── docs (TSK-039) ───────────────────────────────────────────────────────
    def docs_roots(self):
        """Where this vault's documents are: [{project, title, path, exists, archived, roots}] — one per project when the
        structure keeps docs in them (Ticketing: `<Project>/Docs`), by title, then the vault's own (`project` None). A
        folder that is not there yet is listed too (`exists` false): the page offers to start it. `roots`: the folders
        in it, each the top of a tree of docs."""
        s = self.full_structure

        def entry(project, title, rel, archived=False):
            full = os.path.join(self.root, rel)
            exists = os.path.isdir(full)
            roots = sorted(d for d in os.listdir(full) if not d.startswith('.') and os.path.isdir(os.path.join(full, d))) if exists else []
            return {'project': project, 'title': title, 'path': rel, 'exists': exists, 'archived': archived, 'roots': roots}
        out = []
        if s.docs_in_projects:
            projects = [it for it in self._scan(resolve=False, hidden_too=True)[0] if it['type'] == 'project']
            for it in sorted(projects, key=lambda i: i['title'].lower()):
                key = str(it['fields'].get('project_key') or it['fields'].get('project') or '')
                out.append(entry(key or None, it['title'], f"{os.path.dirname(it['path'])}/{s.docs_folder}", bool(it['fields'].get('archived'))))
        out.append(entry(None, '', s.docs_folder))
        return out

    DOC_STATUSES = ('draft', 'published')  # a doc's doc_status (plans/TSK-039 §3.6)

    @writes_files
    def set_order(self, folder, names):
        """The order a Docs folder shows its entries in (TSK-039 phase 2): `names` as dragged, kept in its `.order` — a
        hidden file in the folder, so it travels with it whatever moves it. Names not in the folder are dropped; an
        empty list removes it (the folder sorts as everywhere else). Only in a Docs folder. → {folder, order}."""
        with self._lock:
            rel = self._rel_path(folder, allow_root=True)
            if not rel or not self.full_structure.in_docs(rel) or not os.path.isdir(self.abs(rel)):
                raise StoreError(400, f'not a Docs folder: {rel or "(the vault)"}')
            return {'folder': rel, 'order': self._write_order(rel, names)}

    def _read_order(self, folder_rel):
        try:
            with open(os.path.join(self.abs(folder_rel), ORDER_FILE), encoding='utf-8') as f:
                data = json.load(f)
        except (OSError, ValueError):
            return []
        return [n for n in data if isinstance(n, str)] if isinstance(data, list) else []

    def _write_order(self, folder_rel, names):
        if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
            raise StoreError(400, 'names must be a list of names')
        full = self.abs(folder_rel)
        there = set(os.listdir(full))
        order = [n for n in dict.fromkeys(names) if n in there and not n.startswith('.')]
        path = os.path.join(full, ORDER_FILE)
        if order:
            atomic_write(path, json.dumps(order, ensure_ascii=False, indent=1) + '\n')
        elif os.path.exists(path):
            os.remove(path)
        return order

    @writes_files
    def update_doc(self, path, values, base_rev=None):
        """A doc's own properties (plans/TSK-039 §3.6): `doc_status`, `owner` (a person, written as [[Name]]), `tags` —
        and `project` (a key, or None/'' for the vault's own Docs), which moves it to that project's Docs folder, at
        the same place under it, since a doc's project is where it is. `updated_date` becomes today; a doc with no
        frontmatter yet gets `fileClass: Doc`. Refused (409) when the file changed since `base_rev`. → {path, rev}."""
        if not isinstance(values, dict):
            raise StoreError(400, 'values must be an object')
        with self._lock:
            rel = self._rel_path(path)
            container = self.full_structure.docs_container(rel)
            full = self.abs(rel)
            if not container or not rel.lower().endswith('.md') or not os.path.isfile(full):
                raise StoreError(404, f'not a doc: {rel}')
            if base_rev and self.disk_rev(full) != base_rev:
                raise StoreError(409, f'{rel} changed on disk since it was opened', rev=self.disk_rev(full))
            with open(full, encoding='utf-8') as f:
                text = f.read()
            updates = {}
            if 'doc_status' in values:
                if values['doc_status'] not in self.DOC_STATUSES:
                    raise StoreError(400, f"doc_status is one of {', '.join(self.DOC_STATUSES)}")
                updates['doc_status'] = values['doc_status']
            if 'owner' in values:
                name = str(values['owner'] or '').strip().removeprefix('[[').removesuffix(']]').strip()
                updates['owner'] = f'[[{name}]]' if name else ''
            if 'tags' in values:
                tags = values['tags']
                if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
                    raise StoreError(400, 'tags must be a list of text')
                updates['tags'] = list(dict.fromkeys(t.strip().lstrip('#') for t in tags if t.strip().lstrip('#')))
            new_rel = rel
            if 'project' in values:
                key = values['project'] or None
                target = next((c for c in self.docs_roots() if c['project'] == key), None)
                if target is None:
                    raise StoreError(400, f'no such project: {key}')
                new_rel = f"{target['path']}/{rel[len(container) + 1:]}"
                updates['project'] = f"[[00 {target['path'].split('/')[0]}]]" if key else ''
            if not str(fm.parse(fm.split(text)[0]).get('fileClass') or '').strip():
                updates = {'fileClass': 'Doc', **updates}
            updates['updated_date'] = datetime.now().strftime('%Y-%m-%d')
            dst = full
            if new_rel != rel:
                dst = self.abs(new_rel)
                if os.path.lexists(dst):
                    raise StoreError(409, f'already exists: {new_rel}')
            atomic_write(full, fm.patch(text, updates))
            if dst != full:
                made = []
                up = os.path.dirname(dst)
                while not os.path.isdir(up):
                    made.append(up)
                    up = os.path.dirname(up)

                def do():
                    for d in reversed(made):
                        os.mkdir(d)
                    shutil.move(full, dst)

                def undo():
                    shutil.move(dst, full)
                    for d in made:
                        os.rmdir(d)
                self._keeping_structure(do, undo)
            return {'path': new_rel, 'rev': self.disk_rev(dst)}

    @writes
    def note_to_doc(self, key, folder):
        """A note becomes a doc (TSK-039 phase 4). Its text goes to the Docs `folder` as "<its title>.md" with the Doc
        frontmatter: its labels as tags, its creation date, and the project of that folder. Every [[link]] to the note
        is rewritten to the doc (backed up, _relink); the item it hung from links the doc in its `docs` when it can;
        and the note goes to the trash, where it can be restored. → {path}."""
        with self._lock:
            it = self.read(key)
            if it['type'] != 'note':
                raise StoreError(400, f"only a note becomes a doc, not a {it['type']}")
            rel = self._rel_path(folder, allow_root=True)
            container = self.full_structure.docs_container(rel)
            if not rel or not container:
                raise StoreError(400, f'not a Docs folder: {rel or "(the vault)"}')
            os.makedirs(self.abs(rel), exist_ok=True)  # a Docs folder is always one the structure allows
            title = ' '.join(re.sub(r'[\x00-\x1f\x7f/\\:*?"<>|#\[\]^]', ' ', it['title']).split()).strip(' .') or 'Untitled'
            name = self._free_name(rel, f'{title[:120].rstrip(" .")}.md')
            new_rel = f'{rel}/{name}'
            f = it['fields']
            today = datetime.now().strftime('%Y-%m-%d')
            project = container.split('/')[0] if '/' in container else ''
            atomic_write(self.abs(new_rel), fm.build({
                'fileClass': 'Doc', 'project': f'[[00 {project}]]' if project else '', 'doc_status': 'draft', 'owner': '',
                'tags': list(f.get('labels') or []), 'creation_date': str(f.get('created_at') or '')[:10] or today, 'updated_date': today,
            }, it['body']))
            old_stem, new_stem = os.path.splitext(os.path.basename(it['path']))[0], os.path.splitext(name)[0]
            self._relink(old_stem, new_stem, now_stamp())
            parent = next((i for i in self.items() if f.get('related_to') and i['id'] == f['related_to']), None)
            if parent and 'docs' in self.structure.allowed_fields(parent['type']):
                self.update(parent['key'], {'docs': [*(parent['fields'].get('docs') or []), f'[[{new_stem}]]']})
            self.delete(it['key'])
            return {'path': new_rel}

    def _relink_docs_folder(self, old, new):
        """A folder moved or renamed: the items that link it (or a folder in it) in their `docs` follow it, each file
        copied first to .task-manager/backup/<stamp>-rename/ as _relink does. Not on a vault that does not match its
        structure (its items are read-only): there the link shows as not found until it is fixed."""
        if not getattr(_writing, 'matched', True):
            return 0
        old_p, new_p = f'{old}/', f'{new}/'
        hits = [(it, [new_p + d[len(old_p):] if d.startswith(old_p) else d for d in it['fields'].get('docs') or []])
                for it in self.items() if any(isinstance(d, str) and d.startswith(old_p) for d in it['fields'].get('docs') or [])]
        if not hits:
            return 0
        stamp = now_stamp()
        backup = os.path.join(self.root, META_DIR, 'backup', f"{stamp.replace(':', '').replace('T', '-')}-rename")
        for it, docs in hits:
            copy = os.path.join(backup, it['path'])
            os.makedirs(os.path.dirname(copy), exist_ok=True)
            shutil.copy2(self.abs(it['path']), copy)
            self.update(it['key'], {'docs': docs})
        return len(hits)

    def _touch_doc(self, rel, text):
        """A doc saved from the editor: its `updated_date` is today, when it has the Doc frontmatter."""
        if not self.full_structure.in_docs(rel) or not rel.lower().endswith('.md'):
            return text
        fields = fm.parse(fm.split(text)[0])
        today = datetime.now().strftime('%Y-%m-%d')
        if str(fields.get('fileClass') or '').strip() != 'Doc' or str(fields.get('updated_date') or '') == today:
            return text
        return fm.patch(text, {'updated_date': today})

    def _listed_under(self, rel, listed=None):
        """The attachment paths some item lists that are `rel` or inside it."""
        listed = self._listed_attachments() if listed is None else listed
        return sorted(p for p in listed if p == rel or p.startswith(rel + '/'))

    def _refuse_attachments(self, rel, doing):
        hit = self._listed_under(rel)
        if hit:
            raise StoreError(409, f'{hit[0]} is an attachment of an item: {doing} it from that item'
                             + (f' (and {len(hit) - 1} more)' if len(hit) > 1 else ''))

    def _keeping_structure(self, do, undo):
        """do(); and when the vault matched its structure before but does not after, undo() and refuse (409), naming
        what would not match."""
        before = self.check()['ok']
        do()
        if not before:
            return
        after = self.check()
        if not after['ok']:
            undo()
            found = ' '.join(f"{f['path']}: {f['detail']}" for f in after['blocking'][:3])
            raise StoreError(409, f'That would leave the vault out of its structure, so nothing was changed. {found}',
                             check=after)

    @writes_files
    def make_folder(self, path, parents=False):
        """A new empty folder at `path`, inside one that exists — or, with `parents`, along with the ones above it that
        do not (a project's first docs root: `<Project>/Docs/<Root>` in one go). → {path}."""
        with self._lock:
            rel = self._rel_path(path)
            full = self.abs(rel)
            if os.path.lexists(full):
                raise StoreError(409, f'already exists: {rel}')
            made, up = [], full  # the folders this creates, deepest first: what an undo removes
            while not os.path.isdir(up):
                if os.path.lexists(up) or (up != full and not parents):
                    raise StoreError(404, f'no such folder: {os.path.dirname(rel) or "(the vault)"}')
                made.append(up)
                up = os.path.dirname(up)

            def do():
                for d in reversed(made):
                    os.mkdir(d)

            def undo():
                for d in made:
                    os.rmdir(d)
            self._keeping_structure(do, undo)
            return {'path': rel}

    SAVE_MAX = 2 * 1024 * 1024  # what the Explorer reads into the page (views/files.js MAX_TEXT): no larger is edited

    @staticmethod
    def disk_rev(full):
        """A file's version as the editor knows it: changes with any write, to the nanosecond, whatever wrote it."""
        st = os.stat(full)
        return f'{st.st_mtime_ns}-{st.st_size}'

    @writes_files
    def save_file(self, path, text, base_rev=None, force=False):
        """A vault file's new text, from the Explorer's editor. → {path, rev, size, mtime}.

        Only a file that is text already (UTF-8, no NUL, at most SAVE_MAX) and stays so. When `base_rev` is given
        and the file changed on disk since (Obsidian, another tab, a sync), refused (409, with its rev) unless `force`.
        A file written with CRLF keeps CRLF (a textarea gives LF). An item's file is saved as any file — the store
        reads it back as it reads an outside edit — and a save that would leave the vault out of its structure (an
        id or a type changed in its frontmatter) is undone and refused (_keeping_structure)."""
        if not isinstance(text, str):
            raise StoreError(400, 'text must be a string')
        with self._lock:
            rel = self._rel_path(path)
            full = self.abs(rel)
            if not os.path.isfile(full):
                raise StoreError(404, f'no such file: {rel}')
            if os.path.getsize(full) > self.SAVE_MAX:
                raise StoreError(400, f'too large to edit here: {rel}')
            with open(full, 'rb') as f:
                old = f.read()
            try:
                if b'\x00' in old:
                    raise UnicodeDecodeError('utf-8', old, 0, 1, 'NUL')
                old_text = old.decode('utf-8')
            except UnicodeDecodeError:
                raise StoreError(400, f'not a text file: {rel}') from None
            if base_rev and not force and self.disk_rev(full) != base_rev:
                raise StoreError(409, f'{rel} changed on disk since it was opened', rev=self.disk_rev(full))
            if '\r\n' in old_text and '\r' not in text:
                text = text.replace('\n', '\r\n')
            if text != old_text:
                text = self._touch_doc(rel, text)
            if len(text.encode('utf-8')) > self.SAVE_MAX:
                raise StoreError(400, 'too large to save here')
            self._keeping_structure(lambda: atomic_write(full, text), lambda: atomic_write(full, old))
            st = os.stat(full)
            return {'path': rel, 'rev': self.disk_rev(full), 'size': st.st_size, 'mtime': int(st.st_mtime)}

    def _free_name(self, folder_rel, name, copy=False):
        """`name` in `folder_rel`, or the first free variant of it: "name (2).ext" … — "name copy.ext", "name copy 2.ext"
        … for a duplicate. Nothing is ever written over."""
        stem, ext = os.path.splitext(name)
        if ext and not stem:  # ".env"-like: all stem
            stem, ext = name, ''
        candidates = ([f'{stem} copy{ext}'] + [f'{stem} copy {n}{ext}' for n in range(2, 1000)]) if copy \
            else ([name] + [f'{stem} ({n}){ext}' for n in range(2, 1000)])
        for c in candidates:
            if not os.path.lexists(os.path.join(self.abs(folder_rel) if folder_rel else self.root, c)):
                return c
        raise StoreError(409, f'no free name for {name}')

    def _parent_folder(self, folder):
        rel = self._rel_path(folder, allow_root=True)
        full = self.abs(rel) if rel else self.root
        if not os.path.isdir(full):
            raise StoreError(404, f'no such folder: {rel or "(the vault)"}')
        return rel, full

    @writes_files
    def create_file(self, path, text=''):
        """A new file at `path`, in a folder that exists, with `text` (a Markdown file with nothing given starts with
        its name as a heading). Never over an existing one. → {path}."""
        if not isinstance(text, str):
            raise StoreError(400, 'text must be a string')
        with self._lock:
            rel = self._rel_path(path)
            self._new_name(os.path.basename(rel))
            full = self.abs(rel)
            if os.path.lexists(full):
                raise StoreError(409, f'already exists: {rel}')
            if not os.path.isdir(os.path.dirname(full)):
                raise StoreError(404, f'no such folder: {os.path.dirname(rel) or "(the vault)"}')
            if not text and rel.lower().endswith('.md'):
                text = f'# {os.path.splitext(os.path.basename(rel))[0]}\n'
            self._keeping_structure(lambda: atomic_write(full, text, exclusive=True), lambda: os.remove(full))
            return {'path': rel}

    @writes_files
    def duplicate_file(self, path):
        """A copy of a file next to it ("name copy.ext"). Not of an item's file: the copy would carry its id (create
        a new item instead). → {path}."""
        with self._lock:
            rel = self._rel_path(path)
            full = self.abs(rel)
            if not os.path.isfile(full):
                raise StoreError(404, f'no such file: {rel}')
            if self._item_at(rel):
                raise StoreError(409, f'{os.path.basename(rel)} is an item: a copy would carry its id. Create a new item instead.')
            folder = os.path.dirname(rel)
            name = self._free_name(folder, os.path.basename(rel), copy=True)
            dst = os.path.join(os.path.dirname(full), name)
            with open(full, 'rb') as f:
                data = f.read()
            self._keeping_structure(lambda: atomic_write(dst, data, exclusive=True), lambda: os.remove(dst))
            return {'path': f'{folder}/{name}' if folder else name}

    @writes_files
    def upload_file(self, folder, filename, data):
        """A file brought in from the computer (dropped on the Explorer) into `folder`, under its own name or the first
        free variant of it ("name (2).ext"). → {path}."""
        if len(data) > attachments.MAX_BYTES:
            raise StoreError(413, f'a file is at most {attachments.MAX_BYTES // (1024 * 1024)} MB')
        with self._lock:
            folder_rel, full_folder = self._parent_folder(folder)
            name = self._free_name(folder_rel, self._new_name(os.path.basename(str(filename or '').replace('\\', '/'))))
            dst = os.path.join(full_folder, name)
            self._keeping_structure(lambda: atomic_write(dst, data, exclusive=True), lambda: os.remove(dst))
            return {'path': f'{folder_rel}/{name}' if folder_rel else name}

    @writes_files
    def rename_path(self, path, name):
        """Give the file or folder at `path` the name `name`, in the same folder. A Markdown file's `[[old]]` links in
        the vault follow it. → {path} (the new one)."""
        with self._lock:
            rel = self._rel_path(path)
            name = self._new_name(name)
            src = self.abs(rel)
            if not os.path.lexists(src):
                raise StoreError(404, f'no such file or folder: {rel}')
            new_rel = '/'.join([*rel.split('/')[:-1], name])
            if new_rel == rel:
                return {'path': rel}
            dst = self.abs(new_rel)
            if os.path.lexists(dst) and os.path.normcase(dst) != os.path.normcase(src):
                raise StoreError(409, f'already exists: {new_rel}')
            it = self._item_at(rel)
            if it and self.structure.codec:
                raise StoreError(409, f'{it["id"] or it["title"]} is named after its title: change its title instead')
            self._refuse_attachments(rel, 'rename')
            self._keeping_structure(lambda: os.rename(src, dst), lambda: os.rename(dst, src))
            if os.path.isdir(dst):
                self._relink_docs_folder(rel, new_rel)
            parent = '/'.join(rel.split('/')[:-1])
            if parent and self.full_structure.in_docs(parent):  # it keeps its place in its Docs folder's order
                order = self._read_order(parent)
                old_name = rel.split('/')[-1]
                if old_name in order:
                    self._write_order(parent, [name if n == old_name else n for n in order])
            old_stem, new_stem = (os.path.splitext(os.path.basename(p))[0] for p in (rel, new_rel))
            if os.path.isfile(dst) and dst.endswith('.md') and old_stem != new_stem:
                self._relink(old_stem, new_stem, now_stamp())
            return {'path': new_rel}

    @writes_files
    def move_path(self, path, to, order=None):
        """Move the file or folder at `path` into the folder `to` ('' is the vault), keeping its name. With `order` (a
        Docs folder's names as they should show, set_order) the folder takes that order too: the same folder only
        reorders. → {path}."""
        with self._lock:
            rel = self._rel_path(path)
            folder = self._rel_path(to, allow_root=True)
            src = self.abs(rel)
            if not os.path.lexists(src):
                raise StoreError(404, f'no such file or folder: {rel}')
            target = self.abs(folder) if folder else self.root
            if not os.path.isdir(target):
                raise StoreError(404, f'no such folder: {folder}')
            if folder == rel or folder.startswith(rel + '/'):
                raise StoreError(400, f'a folder cannot go inside itself: {rel}')
            new_rel = '/'.join(filter(None, [folder, os.path.basename(rel)]))
            if order is not None and not (folder and self.full_structure.in_docs(folder)):
                raise StoreError(400, 'an order is kept only in a Docs folder')
            if new_rel != rel:
                dst = self.abs(new_rel)
                if os.path.lexists(dst):
                    raise StoreError(409, f'already exists: {new_rel}')
                self._refuse_attachments(rel, 'move')
                self._refuse_items_into_docs(rel, new_rel)
                self._keeping_structure(lambda: shutil.move(src, dst), lambda: shutil.move(dst, src))
                if os.path.isdir(dst):
                    self._relink_docs_folder(rel, new_rel)
            if order is not None:
                self._write_order(folder, order)
            return {'path': new_rel}

    @writes_files
    def delete_path(self, path):
        """Delete the file or folder at `path`: an item through delete() (the items' trash); anything else to
        .task-manager/trash/files/. A folder that still holds items is refused: delete them first, each with its own
        relations. → {trashed, path, item?}."""
        with self._lock:
            rel = self._rel_path(path)
            src = self.abs(rel)
            if not os.path.lexists(src):
                raise StoreError(404, f'no such file or folder: {rel}')
            it = self._item_at(rel)
            if it:
                return {**self.delete(it['key']), 'path': rel, 'item': it['key']}
            self._refuse_attachments(rel, 'delete')
            if os.path.isdir(src):
                inside = self._items_under(rel)
                if inside:
                    raise StoreError(409, f'{rel} holds {len(inside)} item{"s" if len(inside) != 1 else ""}: delete '
                                     f'{"them" if len(inside) != 1 else "it"} first (each with its relations)')
            when = datetime.now()
            trash = self._files_trash()
            os.makedirs(trash, exist_ok=True)
            slot, n = None, 0
            while slot is None or os.path.lexists(slot):  # two deletes in one second
                slot = os.path.join(trash, f"{when:%Y%m%d-%H%M%S}{'' if not n else f'-{n}'}")
                n += 1
            os.mkdir(slot)
            dst = os.path.join(slot, os.path.basename(src))

            def undo():
                shutil.move(dst, src)
                os.rmdir(slot)
            self._keeping_structure(lambda: shutil.move(src, dst), undo)
            atomic_write(slot + '.json', json.dumps({'path': rel, 'kind': 'dir' if os.path.isdir(dst) else 'file',
                                                     'deleted_at': f'{when:%Y-%m-%dT%H:%M:%S}'}, ensure_ascii=False))
            return {'trashed': self.rel(slot), 'path': rel}

    def trashed_files(self):
        """The files and folders deleted from the Explorer, most recent first: [{trashed, path, kind, deleted_at}]."""
        trash = self._files_trash()
        if not os.path.isdir(trash):
            return []
        out = []
        for name in os.listdir(trash):
            slot = os.path.join(trash, name)
            if not os.path.isdir(slot):
                continue
            try:
                with open(slot + '.json', encoding='utf-8') as f:
                    meta = json.load(f)
            except (OSError, ValueError):
                inside = os.listdir(slot)
                meta = {'path': inside[0] if inside else name, 'kind': 'file', 'deleted_at': ''}
            out.append({'trashed': self.rel(slot), 'path': meta.get('path') or name, 'kind': meta.get('kind') or 'file',
                        'deleted_at': meta.get('deleted_at') or ''})
        return sorted(out, key=lambda e: e['deleted_at'], reverse=True)

    def _file_slot(self, trashed):
        slot = self.abs(trashed)
        trash = os.path.realpath(self._files_trash())
        if os.path.dirname(slot) != trash or not os.path.isdir(slot):
            raise StoreError(404, f'not in the trash: {trashed}')
        return slot

    @writes_files
    def restore_file(self, trashed):
        """A deleted file or folder back where it was (its folders made again if they went too). → {path}."""
        with self._lock:
            slot = self._file_slot(trashed)
            entry = next((e for e in self.trashed_files() if e['trashed'] == self.rel(slot)), None)
            rel = self._rel_path(entry['path'])
            inside = [n for n in os.listdir(slot)]
            if len(inside) != 1:
                raise StoreError(409, f'{trashed} does not hold one file or folder: restore it by hand')
            src, dst = os.path.join(slot, inside[0]), self.abs(rel)
            if os.path.lexists(dst):
                raise StoreError(409, f'{rel} exists again: not overwritten')
            parent = os.path.dirname(dst)
            made = not os.path.isdir(parent)
            os.makedirs(parent, exist_ok=True)

            def undo():
                shutil.move(dst, src)
                if made:
                    try:
                        os.removedirs(parent)
                    except OSError:
                        pass
            self._keeping_structure(lambda: shutil.move(src, dst), undo)
            os.rmdir(slot)
            if os.path.exists(slot + '.json'):
                os.remove(slot + '.json')
            return {'path': rel}

    @writes_files
    def purge_file(self, trashed):
        """A deleted file or folder gone for good."""
        with self._lock:
            slot = self._file_slot(trashed)
            shutil.rmtree(slot)
            if os.path.exists(slot + '.json'):
                os.remove(slot + '.json')
            return {'purged': trashed}

    @writes
    def delete(self, key):
        """Move to <root>/.task-manager/trash/ — recoverable, never unlinked. Whatever was related
        to the item (its tasks, notes, activities…) is left with no relation instead of pointing at
        something that no longer exists; the trash remembers which, so a restore can relink them."""
        with self._lock:
            it = self.find(key)
            # Every child, the hidden ones too (a type this vault turned off): none may keep pointing at a deleted item.
            children = [c for c in self._scan(hidden_too=True)[0] if it['id'] and c['id'] != it['id'] and c['fields'].get('related_to') == it['id']]
            src = self.abs(it['path'])
            trash = self._trash_dir()
            os.makedirs(trash, exist_ok=True)
            when = datetime.now()
            dst, n = None, 0
            while dst is None or os.path.exists(dst):  # two deletes of the same file in one second
                dst = os.path.join(trash, f"{when:%Y%m%d-%H%M%S}{'' if not n else f'-{n}'}-{os.path.basename(src)}")
                n += 1
            shutil.move(src, dst)
            for c in children:  # a relation is not an edit of the item: updated_at stays
                self._patch_fields(c, {'related_to': None})
            atomic_write(dst + '.meta.json', json.dumps({
                'id': it['id'], 'type': it['type'], 'path': it['path'], 'deleted_at': f'{when:%Y-%m-%dT%H:%M:%S}',
                'children': [c['id'] for c in children if c['id']]}, ensure_ascii=False))
        return {'trashed': self.rel(dst), 'restore_to': it['path'], 'unlinked': len(children)}

    @writes
    def restore(self, trashed, to):
        """Undo a delete: move `trashed` (relative to root, inside the trash) back to `to`."""
        to = str(to or '')
        if not self._scannable(to):  # anywhere else it would leave the trash and vanish from the app
            raise StoreError(400, f'cannot restore to {to or "(nothing)"}: it must be a .md path outside hidden folders')
        with self._lock:
            src = self._in_trash(trashed)
            dst = self.abs(to)
            if os.path.exists(dst):
                raise StoreError(409, f'already exists: {to}')
            meta = self._trash_meta(src)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(src, dst)
            for child_id in meta.get('children') or []:  # relink what the delete detached, unless it was related elsewhere since
                for c in self._scan(hidden_too=True)[0]:  # the hidden ones too: the delete detached them as well
                    if c['id'] == child_id and not c['fields'].get('related_to'):
                        self._patch_fields(c, {'related_to': meta.get('id')})
            self._drop_sidecars(src)
            item = self.find(self.rel(dst))
            parent = item['fields'].get('related_to')  # what it hung from may be gone since
            if parent and not any(i['id'] == parent for i in self.items()):
                self._patch_fields(item, {'related_to': None})
        return self.read(self.rel(dst))

    @writes
    def restore_trashed(self, trashed):
        """Restore from the trash view: back to the place it was deleted from."""
        entry = next((e for e in self.trash() if e['trashed'] == trashed), None)
        if not entry:
            raise StoreError(404, f'not in the trash: {trashed}')
        return self.restore(trashed, entry['original_path'])

    @writes
    def purge(self, trashed):
        """Delete one thing from the trash for good, and with it the files it lists that no other item does."""
        with self._lock:
            src = self._in_trash(trashed)
            files = self._orphaned_by([src]) if src.endswith('.md') else []
            self._mark_ids(self._file_ids(src))  # gone for good, but its id stays used (items made before ids.json)
            os.remove(src)
            self._drop_sidecars(src)
            gone = self._drop_attachments(files)
        return {'purged': trashed, 'attachments': gone}

    @writes
    def empty_trash(self):
        """Delete everything in the trash for good: the deleted items, the files only they listed, the files
        taken off an item (trash/attachments/) and what the Explorer deleted (trash/files/)."""
        with self._lock:
            files = self._trash_files()
            orphans = self._orphaned_by(files)
            self._mark_ids([i for path in files for i in self._file_ids(path)])
            for path in files:
                os.remove(path)
                self._drop_sidecars(path)
            gone = self._drop_attachments(orphans)
            removed = self._attachments_trash()
            if os.path.isdir(removed):
                gone += self.removed_attachments()
                shutil.rmtree(removed)
            deleted_files = len(self.trashed_files())
            if os.path.isdir(self._files_trash()):
                shutil.rmtree(self._files_trash())
        return {'purged': len(files), 'attachments': gone, 'files': deleted_files}

    @writes
    def assign_missing_ids(self):
        """Give an id/created/updated to items found without one (e.g. hand-written)."""
        if self.structure.codec:  # Ticketing: a plan or an analysis has no id by design; a ticket without one is a check finding
            return []
        assigned = []
        with self._lock:
            items, days = self.scan()
            for it in items:
                if it['id']:
                    continue
                new_id = self.next_id(it['type'], items, days)
                self._mark_ids([new_id])
                path = self.abs(it['path'])
                stamp = datetime.fromtimestamp(os.stat(path).st_mtime).strftime('%Y-%m-%dT%H:%M')
                with open(path, encoding='utf-8') as f:
                    text = f.read()
                vals = {'id': new_id}
                if not it['fields'].get('created_at'):
                    vals['created_at'] = stamp
                vals['updated_at'] = now_stamp()
                atomic_write(path, fm.patch(text, vals))
                it['id'] = new_id  # so the next next_id() sees it
                assigned.append({'path': it['path'], 'id': new_id})
        return assigned

    # ── statuses: each type's, in the three groups (TSK-037) ─────────────────
    def _statuses_path(self):
        return os.path.join(self.root, META_DIR, STATUSES_FILE)

    def _read_statuses(self):
        try:
            with open(self._statuses_path(), encoding='utf-8') as f:
                cfg = json.load(f)
            return cfg if isinstance(cfg, dict) else {}
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as e:
            self.status_error = f'{META_DIR}/{STATUSES_FILE} could not be read ({e}): the default statuses are used'
            return {}

    def _arranged(self, base):
        """`base` with the statuses this vault arranged. A type turned off keeps its arrangement in the file, for when
        it comes back; a colour of a status no type here has is left out. An arrangement that is not valid any more is
        set aside (status_error), never half applied."""
        cfg = self._read_statuses()
        if not cfg:
            return base
        types = {k: v for k, v in (cfg.get('types') or {}).items() if k in base.types and base.types[k].statuses}
        known = {str(r.get('name')) for rows in types.values() for r in rows if isinstance(r, dict)} | set(base.statuses)
        colors = {k: v for k, v in (cfg.get('colors') or {}).items() if k in known}
        try:
            return base.with_statuses(base.check_statuses({'types': types, 'colors': colors}))
        except StatusConfigError as e:
            self.status_error = f'{META_DIR}/{STATUSES_FILE} is not valid ({e}): the default statuses are used'
            return base

    def _status_counts(self):
        """{type: {status: how many items have it}}, for the types with statuses."""
        counts = {}
        for it in self.items():
            t = self.structure.types.get(it['type'])
            if t and t.statuses and it['fields'].get('status'):
                by = counts.setdefault(it['type'], {})
                by[it['fields']['status']] = by.get(it['fields']['status'], 0) + 1
        return counts

    def status_config(self):
        """Settings → Item type status: each type with statuses, its statuses by group with how many items have each,
        and any status items have that the type does not (written by hand, or left by an older arrangement)."""
        counts = self._status_counts()
        arranged = self.structure.status_config()['types']
        types = []
        for t in self.structure.types.values():
            if not t.statuses:
                continue
            used = counts.get(t.name, {})
            types.append({'type': t.name, 'label': t.plural,
                          'statuses': [{**r, 'count': used.get(r['name'], 0)} for r in arranged[t.name]],
                          'unknown': [{'name': k, 'count': v} for k, v in sorted(used.items()) if k not in t.statuses]})
        return {'types': types, 'colors': dict(self.structure.colors), 'groups': [list(g) for g in self.structure.public()['groups']],
                'locked': self.structure.statuses_locked, 'structure': self.structure.label, 'error': self.status_error,
                'saved': os.path.exists(self._statuses_path())}

    @writes
    def save_status_config(self, cfg, remap=None):
        """Arranges the types' statuses (Settings → Item type status). `remap` {type: {old: new}} moves the items (and
        the board's lists) off a status the new arrangement drops or renames; without it, a status still in use cannot go
        (409, with how many items have it). A remapped item keeps its completed_at when it stays closed."""
        base = self.base_structure
        try:
            clean = base.check_statuses(cfg)
        except StatusConfigError as e:
            raise StoreError(400, str(e))
        new = base.with_statuses(clean)
        remap = remap or {}
        if not isinstance(remap, dict):
            raise StoreError(400, 'remap: expected {type: {old: new}}')
        with self._lock:
            moves, stranded = [], {}
            for it in self.items():
                t = self.structure.types.get(it['type'])
                status = it['fields'].get('status')
                if not t or not t.statuses or not status or status not in self.structure.statuses_of(t.name) or status in new.statuses_of(t.name):
                    continue
                to = (remap.get(t.name) or {}).get(status)
                if to is None:
                    stranded.setdefault(t.plural, {}).setdefault(status, 0)
                    stranded[t.plural][status] += 1
                elif to not in new.statuses_of(t.name):
                    raise StoreError(400, f'remap {t.plural}: {to} is not one of its statuses')
                else:
                    moves.append((it['key'], to))
            # The board's lists name a status each: they follow a rename. A list of the default board (never edited) whose
            # status goes is just dropped; one the user made has to say where it goes.
            edited = os.path.exists(self._board_path())
            lists = self.board()['lists']
            by_name = {old: to for m in remap.values() if isinstance(m, dict) for old, to in m.items() if to in new.statuses}
            for l in lists:
                if edited and l.get('status') not in new.statuses and l.get('status') not in by_name:
                    stranded.setdefault('Board lists', {}).setdefault(l.get('status'), 0)
                    stranded['Board lists'][l.get('status')] += 1
            if stranded:
                what = '; '.join(f"{t}: {', '.join(f'{s} ({n})' for s, n in v.items())}" for t, v in stranded.items())
                raise StoreError(409, f'Still in use, so they cannot go without saying where those items move: {what}', stranded=stranded)
            saved = self._read_statuses()
            path = self._statuses_path()
            if saved:  # the arrangement before, kept like the other backups of .task-manager
                stamp = now_stamp().replace(':', '').replace('T', '-')
                os.makedirs(os.path.join(self.root, META_DIR, 'backup'), exist_ok=True)
                atomic_write(os.path.join(self.root, META_DIR, 'backup', f'{stamp}-{STATUSES_FILE}'), json.dumps(saved, indent=2, ensure_ascii=False) + '\n')
            off = {k: v for k, v in (saved.get('types') or {}).items() if k not in base.types}  # types turned off keep theirs
            os.makedirs(os.path.dirname(path), exist_ok=True)
            atomic_write(path, json.dumps({'types': {**off, **clean['types']}, 'colors': clean['colors']}, indent=2, ensure_ascii=False) + '\n')
            self.structure, self.status_error = new, ''
            for key, to in moves:
                self.update(key, {'status': to})
            if any(l.get('status') not in new.statuses for l in lists):
                moved = [{**l, 'status': by_name.get(l['status'], l['status'])} for l in lists]
                kept = [l for l in moved if l['status'] in new.statuses]
                if kept:
                    self.save_board(kept)
        return {**self.status_config(), 'moved': len(moves)}

    # ── board ────────────────────────────────────────────────────────────────
    def _board_path(self):
        return os.path.join(self.root, META_DIR, 'board.md')

    def board(self):
        path = self._board_path()
        if os.path.exists(path):
            fields, _ = self._read(path)
            if isinstance(fields.get('lists'), list) and fields['lists']:
                return {'lists': fields['lists']}
        return {'lists': self._default_lists()}

    @writes
    def save_board(self, lists):
        ids = [l.get('id') for l in lists]
        if not lists or len(set(ids)) != len(ids) or not all(ids):
            raise StoreError(400, 'lists need unique non-empty ids')
        clean = []
        for l in lists:
            if l.get('status') not in self.structure.statuses:
                raise StoreError(400, f"list {l['id']}: status must be one of {list(self.structure.statuses)}")
            entry = {'id': str(l['id']), 'name': str(l.get('name') or l['id']), 'status': l['status']}
            if l.get('wip'):
                entry['wip'] = int(l['wip'])
            clean.append(entry)
        path = self._board_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        body = '# Board\n\nLists are edited from the app. Order here is column order.\n\n' + \
            '\n'.join(f"- **{l['name']}** (`{l['id']}`) → status {l['status']}" for l in clean) + '\n'
        atomic_write(path, fm.build({'type': 'board', 'lists': clean, 'updated_at': now_stamp()}, body))
        return {'lists': clean}

    # ── today board: user columns in <root>/.task-manager/today.md ───────────
    def _today_path(self):
        return os.path.join(self.root, META_DIR, 'today.md')

    def today_lists(self):
        path = self._today_path()
        if os.path.exists(path):
            fields, _ = self._read(path)
            if isinstance(fields.get('lists'), list) and fields['lists']:
                return {'lists': fields['lists']}
        return {'lists': DEFAULT_TODAY_LISTS}

    @writes
    def save_today_lists(self, lists):
        if not isinstance(lists, list):
            raise StoreError(400, 'lists must be a list')
        ids = [l.get('id') for l in lists]
        if len(set(ids)) != len(ids) or not all(ids):
            raise StoreError(400, 'lists need unique non-empty ids')
        clean = [{'id': str(l['id']), 'name': str(l.get('name') or l['id'])} for l in lists]
        if not any(l['id'] == TODAY_DEFAULT for l in clean):  # never deletable
            clean.insert(0, dict(DEFAULT_TODAY_LISTS[0]))
        path = self._today_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        body = '# Today board\n\nColumns of the Today board, in order. Edited from the app.\n\n' + \
            '\n'.join(f"- **{l['name']}** (`{l['id']}`)" for l in clean) + '\n'
        atomic_write(path, fm.build({'type': 'today', 'lists': clean, 'updated_at': now_stamp()}, body))
        return {'lists': clean}

    # ── pins: the ordered list of items shown in the top bar ─────────────────
    # ── labels and people: tags that live on items, plus a history of their own ─────────
    # Each has a registry file in .task-manager/ so a tag can exist before any item uses it
    # (added from its screen) and outlive the items that had it.
    REGISTRIES = {
        'labels': ('# Labels', 'Every label created or used, for suggestions and for the Labels screen.'),
        'people': ('# People', 'Every person named as the sender of an activity or an attendee of a meeting, for suggestions.'),
        'groups': ('# Groups', 'Groups of people reached as one: an email list, a Slack channel… (Contacts → Groups).'),
    }

    def _registry_path(self, kind):
        return os.path.join(self.root, META_DIR, f'{kind}.md')

    def _registry(self, kind):
        if kind == 'people':
            return [r['name'] for r in self._people_records()]
        path = self._registry_path(kind)
        if os.path.exists(path):
            fields, _ = self._read(path)
            return clean_labels(fields.get('names'))
        return []

    @writes
    def _save_registry(self, kind, names):
        if kind == 'people':  # by name: whoever keeps their name keeps the rest of their record
            known = {r['name'].lower(): r for r in self._people_records()}
            return self._save_people([known.get(n.lower()) or people.clean_record(n)
                                      for n in clean_people(names)])
        title, blurb = self.REGISTRIES[kind]
        path = self._registry_path(kind)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        body = f'{title}\n\n{blurb}\n\n' + ''.join(f'- {n}\n' for n in names)
        atomic_write(path, fm.build({'type': kind, 'names': names, 'updated_at': now_stamp()}, body))

    # People are records (tm/people.py): the public name, the name Calendar gives them, their emails, their Redmine and Slack users.
    # people.md keeps `names` too (the public names), which is all an older copy of the app reads.
    def _people_records(self):
        path = self._registry_path('people')
        if not os.path.exists(path):
            return []
        fields, _ = self._read(path)
        raw = fields.get('people') if isinstance(fields.get('people'), list) else clean_people(fields.get('names'))
        out, seen = [], set()
        for r in map(people.clean_record, raw):
            if r and r['name'].lower() not in seen:
                seen.add(r['name'].lower())
                out.append(r)
        return out

    @writes
    def _save_people(self, records):
        title, blurb = self.REGISTRIES['people']
        path = self._registry_path('people')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        line = lambda r: ' · '.join([r['name'], *([f"Calendar: {r['calendar_name']}"] if r['calendar_name'] else []), *r['emails'],  # noqa: E731
                                     *[f'{label}: {r[k]}' for k, label in (('redmine', 'Redmine'), ('slack', 'Slack')) if r[k]]])
        body = f'{title}\n\n{blurb}\n\n' + ''.join(f'- {line(r)}\n' for r in records)
        atomic_write(path, fm.build({'type': 'people', 'names': [r['name'] for r in records], 'people': records,
                                     'updated_at': now_stamp()}, body))

    @writes
    def _remember(self, kind, names):
        """Add names to a registry (callers hold the lock)."""
        names = clean_people(names) if kind == 'people' else clean_labels(names)
        if not names:
            return
        known = self._registry(kind)
        fold = str.lower if kind == 'people' else (lambda x: x)
        have = {fold(n) for n in known}
        fresh = [n for n in names if fold(n) not in have]
        if fresh:
            self._save_registry(kind, known + fresh)

    def _remember_people(self, names):
        self._remember('people', names)

    def _watching_people(self, fields):
        """The watchers (TSK-051) of `fields` that are people: a name that is not a group is remembered as a person."""
        groups = {g['name'].lower() for g in self._group_records()}
        return [n for n in clean_people(fields.get('watchers')) if n.lower() not in groups]

    def _remember_labels(self, names):
        self._remember('labels', names)

    @writes
    def _patch_fields(self, it, values):
        """Rewrite fields of an item's file without touching updated_at: a rename is not an edit of the item."""
        path = self.abs(it['path'])
        with open(path, encoding='utf-8') as f:
            text = f.read()
        atomic_write(path, fm.patch(text, self._disk_values(it, values, text), None))

    @writes
    def _rename_mentions(self, old, new):
        """@[old] → @[new] in every description and comment that mentions them, the rest byte for byte
        (like _patch_fields, not an edit of the item: updated_at stays)."""
        for it in self.items():
            path = self.abs(it['path'])
            with open(path, encoding='utf-8') as f:
                text = f.read()
            if '@[' not in text:
                continue
            _, body = fm.split(text)
            renamed = people.rename_mentions(body, old, new)
            out = text[:len(text) - len(body)] + renamed
            comments = it['fields'].get('comments')
            if isinstance(comments, list) and any(isinstance(c, dict) and '@[' in str(c.get('text')) for c in comments):
                moved = [{**c, 'text': people.rename_mentions(c.get('text'), old, new)} if isinstance(c, dict) else c for c in comments]
                if moved != comments:
                    out = fm.patch(out, {'comments': moved}, None)
            if out != text:
                atomic_write(path, out)

    def _retarget_name(self, it, field, key, new):
        """`field` of item `it` (a list of names) with the name `key` (lower case) made `new`, or dropped (None)."""
        have = clean_people(it['fields'].get(field))
        if not any(n.lower() == key for n in have):
            return
        out = []
        for n in have:
            if n.lower() == key:
                if new is None:
                    continue
                n = new
            if n.lower() not in {o.lower() for o in out}:
                out.append(n)
        self._patch_fields(it, {field: out if out or field != 'from' else None})

    def _retarget_watcher(self, key, new):
        """A person or a group renamed (new) or removed (None): every item that watches them follows (TSK-051)."""
        for it in self.items():
            if it['fields'].get('watchers'):
                self._retarget_name(it, 'watchers', key, new)

    def _watched(self):
        """How many items each name (lower case) watches."""
        counts = {}
        for it in self.items():
            for n in clean_people(it['fields'].get('watchers')):
                counts[n.lower()] = counts.get(n.lower(), 0) + 1
        return counts

    @staticmethod
    def _people_field(it):
        return 'from' if it['type'] == 'activity' else 'attendees' if it['type'] == 'meeting' else None

    def labels(self):
        """Every label with how many items carry it (and of which types), most used first."""
        counts, types = {}, {}
        for it in self.items():
            for l in clean_labels(it['fields'].get('labels')):
                counts[l] = counts.get(l, 0) + 1
                types.setdefault(l, {})[it['type']] = types.setdefault(l, {}).get(it['type'], 0) + 1
        names = list(dict.fromkeys([*self._registry('labels'), *counts]))
        out = [{'name': n, 'count': counts.get(n, 0), 'types': types.get(n, {})} for n in names]
        out.sort(key=lambda x: (-x['count'], x['name'].lower()))
        return {'labels': out}

    @writes
    def add_label(self, name):
        name = clean_label(name)
        if not name:
            raise StoreError(400, 'a label needs a name')
        with self._lock:
            self._remember('labels', [name])
        return self.labels()

    @writes
    def rename_label(self, old, new):
        """Rename a label everywhere it is used; renaming onto an existing label merges them."""
        old, new = clean_label(old), clean_label(new)
        if not new:
            raise StoreError(400, 'a label needs a name')
        with self._lock:
            if old not in [l['name'] for l in self.labels()['labels']]:
                raise StoreError(404, f'label not found: {old}')
            for it in self.items():
                have = clean_labels(it['fields'].get('labels'))
                if old in have:
                    out = []
                    for l in have:
                        l = new if l == old else l
                        if l not in out:
                            out.append(l)
                    self._patch_fields(it, {'labels': out})
            reg = [new if n == old else n for n in self._registry('labels')]
            self._save_registry('labels', list(dict.fromkeys([*reg, new])))
        return self.labels()

    @writes
    def delete_label(self, name):
        """Remove a label from every item that has it, and from the history."""
        name = clean_label(name)
        with self._lock:
            if name not in [l['name'] for l in self.labels()['labels']]:
                raise StoreError(404, f'label not found: {name}')
            for it in self.items():
                have = clean_labels(it['fields'].get('labels'))
                if name in have:
                    self._patch_fields(it, {'labels': [l for l in have if l != name]})
            self._save_registry('labels', [n for n in self._registry('labels') if n != name])
        return self.labels()

    def people(self):
        """The people history, most used first: the saved history plus whoever the items name today."""
        display, sender, attendee = {}, {}, {}
        for n in self._registry('people'):
            display.setdefault(n.lower(), n)
        for it in self.items():
            field = self._people_field(it)
            for n in clean_people(it['fields'].get(field)) if field else []:
                k = n.lower()
                display.setdefault(k, n)
                bucket = sender if field == 'from' else attendee
                bucket[k] = bucket.get(k, 0) + 1
        watcher = self._watched()
        records = {r['name'].lower(): r for r in self._people_records()}
        out = [{'name': display[k], 'count': sender.get(k, 0) + attendee.get(k, 0) + watcher.get(k, 0),
                'sender': sender.get(k, 0), 'attendee': attendee.get(k, 0), 'watcher': watcher.get(k, 0),
                'calendar_name': records.get(k, {}).get('calendar_name', ''), 'emails': records.get(k, {}).get('emails', []),
                'redmine': records.get(k, {}).get('redmine', ''), 'slack': records.get(k, {}).get('slack', ''),
                'notes': records.get(k, {}).get('notes', ''), 'when_to_use': records.get(k, {}).get('when_to_use', '')}
               for k in display]
        out.sort(key=lambda p: (-p['count'], p['name'].lower()))
        return {'people': out}

    @writes
    def add_person(self, name, values=None):
        """Add a person by name; with `values` (calendar_name, emails, redmine, slack, notes, when_to_use: as update_person takes them)
        the new person's record is filled in too, and a name someone already has is refused."""
        names = clean_people(name)
        if not names:
            raise StoreError(400, 'a person needs a name')
        values = {k: v for k, v in dict(values or {}).items() if k != 'name'}
        with self._lock:
            if values and names[0].lower() in [p['name'].lower() for p in self.people()['people']]:
                raise StoreError(409, f'{names[0]} is already in People')
            if names[0].lower() in [g['name'].lower() for g in self._group_records()]:
                raise StoreError(409, f'{names[0]} is already a group in Contacts')
            for e in people.clean_emails(values.get('emails')):  # checked before adding: a refused address adds nobody
                owner = next((r for r in self._people_records() if e in r['emails']), None)
                if owner:
                    raise StoreError(409, f"{e} is already {owner['name']}'s")
            self._remember('people', names[:1])
            if values:
                return self.update_person(names[0], values)
        return self.people()

    def _retarget_person(self, old, new):
        """Rename (new given) or remove (new None) a person on every activity and meeting that names them."""
        key = ' '.join(str(old or '').split()).lower()
        if key not in [p['name'].lower() for p in self.people()['people']]:
            raise StoreError(404, f'person not found: {old}')
        if new and new.lower() in [g['name'].lower() for g in self._group_records()]:
            raise StoreError(409, f'{new} is already a group in Contacts')
        for it in self.items():
            field = self._people_field(it)
            if field:
                self._retarget_name(it, field, key, new)
        self._retarget_watcher(key, new)
        if new:
            self._rename_mentions(key, new)
        # The record goes with the name: renamed, merged into the person who already has the new name
        # (their emails joined, the empty fields filled), or dropped.
        records = self._people_records()
        mine = next((r for r in records if r['name'].lower() == key), None) or people.clean_record(old)
        records = [r for r in records if r['name'].lower() != key]
        if new:
            target = next((r for r in records if r['name'].lower() == new.lower()), None)
            if target:
                for k in ('calendar_name', 'redmine', 'slack', 'notes', 'when_to_use'):
                    target[k] = target[k] or mine[k]
                target['emails'] = list(dict.fromkeys([*target['emails'], *mine['emails']]))
            else:
                records.append({**mine, 'name': new})
        self._save_people(records)
        self._retarget_member(key, new)

    @writes
    def rename_person(self, old, new):
        names = clean_people(new)
        if not names:
            raise StoreError(400, 'a person needs a name')
        with self._lock:
            self._retarget_person(old, names[0])
        return self.people()

    @writes
    def delete_person(self, name):
        with self._lock:
            self._retarget_person(name, None)
        return self.people()

    @writes
    def update_person(self, name, values):
        """Edit a person: `name` (the public one: renamed on every item, merged if someone has it already),
        `calendar_name`, `emails` (a list or text; each address belongs to one person only), their `redmine`
        and `slack` users (either may be empty), and `notes` and `when_to_use` (free text: what an agent reads)."""
        values = dict(values or {})
        with self._lock:
            key = ' '.join(str(name or '').split()).lower()
            if key not in [p['name'].lower() for p in self.people()['people']]:
                raise StoreError(404, f'person not found: {name}')
            current = ' '.join(str(name).split())
            if 'name' in values:
                new = (clean_people(values['name']) or [None])[0]
                if not new:
                    raise StoreError(400, 'a person needs a name')
                if new != current:
                    self._retarget_person(current, new)
                    current = new
            records = self._people_records()
            rec = next((r for r in records if r['name'].lower() == current.lower()), None)
            if rec is None:  # named on items only, never in the registry
                rec = people.clean_record(current)
                records.append(rec)
            for k in ('calendar_name', 'redmine', 'slack'):
                if k in values:
                    rec[k] = people.clean_name(values[k])
            for k in ('notes', 'when_to_use'):
                if k in values:
                    rec[k] = people.clean_text(values[k])
            if 'emails' in values:
                emails = people.clean_emails(values['emails'])
                for r in records:
                    taken = [e for e in emails if r is not rec and e in r['emails']]
                    if taken:
                        raise StoreError(409, f"{taken[0]} is already {r['name']}'s")
                rec['emails'] = emails
            self._save_people(records)
        return self.people()

    # ── groups (TSK-050): people reached as one, an email list or a Slack channel; Contacts → Groups ──────────
    def _group_records(self):
        path = self._registry_path('groups')
        if not os.path.exists(path):
            return []
        fields, _ = self._read(path)
        out, seen = [], set()
        for g in map(people.clean_group, fields.get('groups') if isinstance(fields.get('groups'), list) else []):
            if g and g['name'].lower() not in seen:
                seen.add(g['name'].lower())
                out.append(g)
        return out

    @writes
    def _save_groups(self, records):
        title, blurb = self.REGISTRIES['groups']
        path = self._registry_path('groups')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        line = lambda g: ' · '.join([g['name'], g['channel'], *([g['address']] if g['address'] else []),  # noqa: E731
                                     *([f"members: {', '.join(g['members'])}"] if g['members'] else [])])
        body = f'{title}\n\n{blurb}\n\n' + ''.join(f'- {line(g)}\n' for g in records)
        atomic_write(path, fm.build({'type': 'groups', 'groups': records, 'updated_at': now_stamp()}, body))

    def groups(self):
        """Every group, by name, with how many items it watches (`count`)."""
        watched = self._watched()
        return {'groups': [{**g, 'count': watched.get(g['name'].lower(), 0)}
                           for g in sorted(self._group_records(), key=lambda g: g['name'].lower())]}

    def _check_group_name(self, name, records, own=None):
        """A group's name must be free: no other group, and no person, goes by it (items name either by the name alone)."""
        key = name.lower()
        if any(g['name'].lower() == key and g is not own for g in records):
            raise StoreError(409, f'{name} is already a group')
        if key in [p['name'].lower() for p in self.people()['people']]:
            raise StoreError(409, f'{name} is already a person in Contacts')

    @writes
    def add_group(self, name, values=None):
        """Add a group: its `name`, and any of `channel` (email · slack · other), `address`, `members`, `notes`, `when_to_use`."""
        g = people.clean_group({**dict(values or {}), 'name': name})
        if not g:
            raise StoreError(400, 'a group needs a name')
        with self._lock:
            records = self._group_records()
            self._check_group_name(g['name'], records)
            self._save_groups([*records, g])
        return self.groups()

    @writes
    def update_group(self, name, values):
        """Edit a group: any of `name` (a new one, free as add_group wants it), `channel`, `address`, `members`, `notes`,
        `when_to_use`; what is left out stays."""
        values = dict(values or {})
        with self._lock:
            records = self._group_records()
            key = people.clean_name(name).lower()
            g = next((r for r in records if r['name'].lower() == key), None)
            if g is None:
                raise StoreError(404, f'group not found: {name}')
            new = people.clean_group({**g, **{k: v for k, v in values.items() if k in g}})
            if not new:
                raise StoreError(400, 'a group needs a name')
            if new['name'].lower() != key:
                self._check_group_name(new['name'], records, own=g)
            self._save_groups([new if r is g else r for r in records])
            if new['name'] != g['name']:
                self._retarget_watcher(key, new['name'])
        return self.groups()

    @writes
    def delete_group(self, name):
        with self._lock:
            records = self._group_records()
            key = people.clean_name(name).lower()
            if not any(r['name'].lower() == key for r in records):
                raise StoreError(404, f'group not found: {name}')
            self._save_groups([r for r in records if r['name'].lower() != key])
            self._retarget_watcher(key, None)
        return self.groups()

    def _retarget_member(self, key, new):
        """A person renamed (new) or removed (None): the groups they are a member of follow (callers hold the lock)."""
        records = self._group_records()
        changed = False
        for g in records:
            if any(m.lower() == key for m in g['members']):
                out = []
                for m in g['members']:
                    m = (new if m.lower() == key else m)
                    if m and m.lower() not in {o.lower() for o in out}:
                        out.append(m)
                g['members'] = out
                changed = True
        if changed:
            self._save_groups(records)

    @writes
    def learn_people(self, new=(), learned=()):
        """What a calendar sync found: `new` people ({name, calendar_name, emails}) and emails `learned` for
        people already known ({name, email}). An address someone already has is never moved."""
        with self._lock:
            records = self._people_records()
            owner = {e: r for r in records for e in r['emails']}
            by_name = {r['name'].lower(): r for r in records}
            for raw in new:
                r = people.clean_record(raw)
                if not r:
                    continue
                emails = [e for e in r['emails'] if e not in owner]
                have = by_name.get(r['name'].lower())
                if have:  # the same name twice in one sync: one person, both addresses
                    have['emails'] = list(dict.fromkeys([*have['emails'], *emails]))
                    have['calendar_name'] = have['calendar_name'] or r['calendar_name']
                    r = have
                else:
                    r['emails'] = emails
                    records.append(r)
                    by_name[r['name'].lower()] = r
                owner.update({e: r for e in r['emails']})
            for item in learned:
                r, e = by_name.get(people.clean_name(item.get('name')).lower()), people.clean_email(item.get('email'))
                if r and e and e not in owner:
                    r['emails'].append(e)
                    owner[e] = r
            self._save_people(records)
        return self.people()

    # Ordered id lists in .task-manager/: the pins of the top bar and the order of
    # the initiatives in the sidebar. Ids of deleted items are kept until the next
    # save: the UI just skips what it cannot find.
    ID_LISTS = {
        'pins': ('pins.md', '# Pinned', 'Items fixed to the top bar, in order. Edited from the app.'),
        'sidebar': ('sidebar.md', '# Sidebar', 'Initiatives in the sidebar, in the order dragged there. Edited from the app.'),
    }

    def _id_list(self, kind):
        path = os.path.join(self.root, META_DIR, self.ID_LISTS[kind][0])
        if os.path.exists(path):
            fields, _ = self._read(path)
            if isinstance(fields.get('items'), list):
                return {'items': [str(i) for i in fields['items'] if i]}
        return {'items': []}

    @writes
    def _save_id_list(self, kind, ids):
        if not isinstance(ids, list):
            raise StoreError(400, 'items must be a list of ids')
        clean, seen = [], set()
        for i in ids:
            i = str(i or '').strip()
            if not self.structure.parse_id(i):
                raise StoreError(400, f'not an item id: {i}')
            if i not in seen:
                seen.add(i)
                clean.append(i)
        name, heading, about = self.ID_LISTS[kind]
        titles = {it['id']: it['title'] for it in self.items() if it['id']}
        path = os.path.join(self.root, META_DIR, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        body = f'{heading}\n\n{about}\n\n' + \
            ''.join(f"- {i} {titles.get(i, '')}\n".replace(' \n', '\n') for i in clean)
        atomic_write(path, fm.build({'type': kind, 'items': clean, 'updated_at': now_stamp()}, body))
        return {'items': clean}

    # Launches made from the top bar belong to no item: they are listed in .task-manager/claude-sessions.md,
    # oldest first, with the same entries an item keeps (see clean_claude_sessions).
    def global_claude_sessions(self):
        path = os.path.join(self.root, META_DIR, CLAUDE_SESSIONS_FILE)
        if os.path.exists(path):
            fields, _ = self._read(path)
            if isinstance(fields.get('sessions'), list):
                try:
                    return {'sessions': clean_claude_sessions(fields['sessions'])}
                except StoreError:
                    pass  # a hand-edited file that no longer parses: start over rather than refuse every launch
        return {'sessions': []}

    @writes
    def _save_global_claude_sessions(self, sessions):
        clean = clean_claude_sessions(sessions)
        path = os.path.join(self.root, META_DIR, CLAUDE_SESSIONS_FILE)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        body = '# Claude sessions\n\nTerminals opened from the top bar (no item), oldest first. Edited from the app.\n\n' + \
            ''.join(f"- {s['at']} `{s['id']}` in {s['cwd']}{' — ' + s['instruction'] if s['instruction'] else ''}\n" for s in clean)
        atomic_write(path, fm.build({'type': 'claude-sessions', 'sessions': clean, 'updated_at': now_stamp()}, body))
        return {'sessions': clean}

    @writes
    def add_global_claude_session(self, entry):
        with self._lock:
            return self._save_global_claude_sessions(self.global_claude_sessions()['sessions'] + [entry])

    @writes
    def forget_global_claude_session(self, index):
        with self._lock:
            sessions = self.global_claude_sessions()['sessions']
            if not 0 <= index < len(sessions):
                raise StoreError(404, 'Claude session not found')
            sessions.pop(index)
            return self._save_global_claude_sessions(sessions)

    def pins(self):
        """Ordered item ids pinned to the top bar."""
        return self._id_list('pins')

    @writes
    def save_pins(self, ids):
        return self._save_id_list('pins', ids)

    def sidebar_order(self):
        """Initiative ids in the order the sidebar shows them (the rest follow, by status)."""
        return self._id_list('sidebar')

    @writes
    def save_sidebar_order(self, ids):
        return self._save_id_list('sidebar', ids)

    # ── worklog: one .md per day, entries in the frontmatter ─────────────────
    def worklog(self, date_from=None, date_to=None):
        _, days = self.scan()
        out = []
        for date, (_, fields) in sorted(days.items()):
            if (date_from and date < date_from) or (date_to and date > date_to):
                continue
            for i, e in enumerate(fields.get('entries') or []):
                if isinstance(e, dict):
                    out.append({**e, 'time': e.get('time') or '00:00', 'date': date, 'index': i})
        return out

    def _day_path(self, date, days):
        if date in days:
            return days[date][0]
        folder = self.abs(self.folders['worklog'])
        return os.path.join(folder, date[:4], f'{date}.md')

    @writes
    def _write_day(self, date, path, entries):
        # The path comes from os.walk, which does not resolve symlinks: resolve it (and keep it inside
        # the root) so a day file that is a link is written through, not swapped for a plain file.
        path = self.abs(self.rel(path))
        titles = {it['id']: it['title'] for it in self.items() if it['id']}
        lines = [f'# Work log — {date}', '']
        for e in entries:
            note = f" — {e['note']}" if e.get('note') else ''
            title = titles.get(e.get('id')) or e.get('title') or ''  # the item may be gone: its title as logged
            lines.append(f"- {e.get('at', '')} · **{e.get('kind')}** · {e.get('time') or '00:00'} · "
                         f"{e.get('id')} {title}{note}".rstrip())
        os.makedirs(os.path.dirname(path), exist_ok=True)
        text = fm.build({'type': 'worklog', 'date': date, 'entries': entries,
                         'updated_at': now_stamp()}, '\n'.join(lines) + '\n')
        atomic_write(path, text)

    @writes
    def log_work(self, item_id, kind, note='', date=None, kinds=None, time=None):
        date = date or datetime.now().strftime('%Y-%m-%d')
        if not DATE_RE.match(date):
            raise StoreError(400, 'date must be YYYY-MM-DD')
        if kinds and kind not in kinds:
            raise StoreError(400, f'kind must be one of {kinds}')
        time = normalize_time(time)
        with self._lock:
            it = self.find(item_id)
            _, days = self.scan()
            path = self._day_path(date, days)
            entries = list(days[date][1].get('entries') or []) if date in days else []
            # The title as it was when logged: once the item is deleted for good, the work log can still
            # say what the time went on. Older entries have none; update_log keeps whatever is there.
            entry = {'at': datetime.now().strftime('%H:%M'), 'id': item_id, 'title': it['title'], 'kind': kind, 'time': time}
            if note:
                entry['note'] = note
            entries.append(entry)
            self._write_day(date, path, entries)
        return {**entry, 'date': date, 'index': len(entries) - 1}

    @writes
    def update_log(self, date, index, values, kinds=None):
        """Edit one work-log entry: kind, time spent, note and day (`new_date` moves it to another day's file)."""
        values = values or {}
        new_date = values.get('new_date') or date
        if not DATE_RE.match(new_date):
            raise StoreError(400, 'date must be YYYY-MM-DD')
        if 'kind' in values and kinds and values['kind'] not in kinds:
            raise StoreError(400, f'kind must be one of {kinds}')
        with self._lock:
            _, days = self.scan()
            if date not in days:
                raise StoreError(404, f'no work log for {date}')
            path, fields = days[date]
            entries = list(fields.get('entries') or [])
            if not 0 <= index < len(entries):
                raise StoreError(404, 'entry not found')
            entry = dict(entries[index])
            if 'kind' in values:
                entry['kind'] = values['kind']
            if 'time' in values:
                entry['time'] = normalize_time(values['time'])
            else:
                entry.setdefault('time', '00:00')
            if 'note' in values:
                note = str(values['note'] or '').strip()
                if note:
                    entry['note'] = note
                else:
                    entry.pop('note', None)
            if new_date == date:
                entries[index] = entry
                self._write_day(date, path, entries)
                return {**entry, 'date': date, 'index': index}
            entries.pop(index)
            self._write_day(date, path, entries)
            _, days = self.scan()  # the source file may have just changed; the target may not exist yet
            target = list(days[new_date][1].get('entries') or []) if new_date in days else []
            target.append(entry)
            self._write_day(new_date, self._day_path(new_date, days), target)
            return {**entry, 'date': new_date, 'index': len(target) - 1}

    @writes
    def unlog_work(self, date, index):
        with self._lock:
            _, days = self.scan()
            if date not in days:
                raise StoreError(404, f'no work log for {date}')
            path, fields = days[date]
            entries = list(fields.get('entries') or [])
            if not 0 <= index < len(entries):
                raise StoreError(404, 'entry not found')
            entries.pop(index)
            self._write_day(date, path, entries)
        return {'ok': True}
