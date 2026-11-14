"""The vault's index: one per Store, what is in its folder and what its text files say, kept between requests.

What a Store asked the disk for on every read (a walk of the whole folder for the items, another for the Explorer, every
file read again for a search or a doc's backlinks) it now asks here:

- **entries**: every folder and file of the vault, in walk order (each folder's subfolders, then its files, by name),
  with their stat key (inode, mtime_ns, size). `node_modules` and `__pycache__` are never walked; `.git` and
  `.task-manager` are listed, sealed, never walked into. Hidden files are listed too: the Explorer shows them on request.
- **what a file says**, read once per stat key: its text, its lines and their folded form (case and accents aside, for
  search), the targets of its wikilinks. A file iCloud has not downloaded (SF_DATALESS) is listed but never read here:
  reading it would block until it is.

**Fresh or trusted.** By default every read walks the folder again (`entries()`): a Store in a test or a tool sees a
file written a moment ago, as it always has. A page that polls `GET /api/vault/changes` (server.py) makes the index
*watched*: then a read reuses the last walk while it is younger than `max_age`, and the poll itself walks again — what
another program changes shows within a poll's interval, and the page is told which files. A write through the Store
(`@writes`) always reads fresh while it runs, and the read after it walks again.

**Changes**: each walk compares with the one before and logs what was added, changed or removed under a growing
sequence number, with who made it (`by`: the page's tab whose write it was, None for anything else), for the poll.

**Kept on disk**, per device, outside the vault (iCloud would sync it, and inodes are a device's own): what a file's
links are, by its stat key, so a cold start answers backlinks and the graph without reading every file again.
"""
import hashlib
import json
import os
import re
import sys
import threading
import time
import unicodedata
import uuid
from collections import deque, namedtuple

from .fsutil import atomic_write

VERSION = 1
SF_DATALESS = 0x40000000          # st_flags of a file whose bytes are still in iCloud (sys/stat.h)
SKIP = {'node_modules', '__pycache__'}
SEALED = ('.git', '.task-manager')  # listed, never walked into (matched case aside)
LOG_MAX = 2000                    # changes remembered for the poll; older ones are "everything may have changed"
CHANGES_MAX = 200                 # paths a poll answers at most
PERSISTED = ('targets', 'link_keys')  # what a file says that is kept on disk between runs
SAVE_EVERY = 10.0                 # s: the kept file is written at most this often

# Who is writing, set by the server for the length of a request (server.py dispatch): the page's tab, so its own
# changes are not reported back to it as news.
ACTOR = threading.local()

Entry = namedtuple('Entry', 'kind ino mtime_ns size mtime dataless sealed')


def clocks():
    """(monotonic, wall) now. How old a walk is takes both: macOS's monotonic clock (mach_absolute_time) stops while the
    Mac sleeps, so on waking a walk from before the night would look a moment old and be trusted; the wall clock moves
    on through sleep, but can be set back, so it alone is no guide either."""
    return time.monotonic(), time.time()


def within(then, now, span):
    """`now` (a clocks() pair) is less than `span` s after `then` on both clocks."""
    return all(0 <= n - t < span for n, t in zip(now, then))


def key_of(e):
    return (e.ino, e.mtime_ns, e.size)


def fold(text):
    """Case and accents aside: what search compares."""
    return ''.join(c for c in unicodedata.normalize('NFKD', text.casefold()) if not unicodedata.combining(c))


_INNER = re.compile(r'(?=\[\[([^\]\n]*)\]\])')  # a lookahead: every [[…]] start, overlapping ones too


def link_keys(text):
    """What every [[link]] of a text names, lower case, before its #heading or |alias and without spaces around: the
    names a backlink search for a file's stem looks for. Every match `Store.backlinks`' pattern finds is one of these."""
    return sorted({m.group(1).split('#', 1)[0].split('|', 1)[0].strip().lower() for m in _INNER.finditer(text)})


def cache_dir():
    """Where a device keeps its indexes: TM_CACHE_DIR, else the user's caches folder (on an iPhone, the app's own)."""
    if os.environ.get('TM_CACHE_DIR'):
        return os.environ['TM_CACHE_DIR']
    if sys.platform in ('darwin', 'ios'):
        return os.path.join(os.path.expanduser('~'), 'Library', 'Caches', 'task-manager')
    return os.path.join(os.environ.get('XDG_CACHE_HOME') or os.path.join(os.path.expanduser('~'), '.cache'), 'task-manager')


def cache_path(root):
    return os.path.join(cache_dir(), f"index-{hashlib.sha1(root.encode('utf-8')).hexdigest()[:16]}.json")


class VaultIndex:
    def __init__(self, root, cache_file=None):
        self.root = root
        self.cache_file = cache_file or cache_path(root)
        self.epoch = uuid.uuid4().hex[:12]  # a new index (a reopened vault) starts its sequence again: the page sees it
        self.max_age = 3.5                  # s a watched index trusts its last walk
        self._lock = threading.RLock()      # one walk at a time; readers wait for it
        self._entries = None
        self._at = (0.0, 0.0)               # clocks() of the last walk
        self._dirty = False
        self._watched = ((0.0, 0.0), 0.0)   # (clocks() when a page last polled, for how many s)
        self._seq = 0
        self._log = deque(maxlen=LOG_MAX)   # (seq, rel, by)
        self._said = {}                     # rel -> {'key', 'text', 'utf8', 'nul', 'lines', 'folded', <PERSISTED…>}
        self._kept = None                   # rel -> [ino, mtime_ns, size, {name: value}], read from the cache file
        self._unsaved = False
        self._saved_at = 0.0
        self._walked = []                   # [(abs folder, mtime_ns before it was listed)] of the last walk
        self._top_mtime = None
        self._reuse = None                  # the `keep` of the last walk, when partial: what a write's next read may reuse
        self._items_at = (0.0, 0.0)         # clocks() of the last walk of the item folders (whole or partial)
        self._stale = False                 # a partial walk came after the last whole one: the rest may be behind
        self._kept_part = None              # (kept prefixes, {rel: Entry} under them): what partial walks take as it was

    # ── the walk ─────────────────────────────────────────────────────────────
    def _walk(self, keep=None):
        """{rel: Entry} of the folder. `keep(rel)` True for a folder: it is listed, but what is in it is taken from the
        last walk instead of walked again (a write reading its items: Docs/ and Attachments/ hold none)."""
        out, kept = {}, []
        try:  # the top's own mtime, taken before it is listed (_unchanged)
            self._top_mtime = os.stat(self.root).st_mtime_ns
        except OSError:
            self._top_mtime = None
        for dirpath, dirnames, filenames in os.walk(self.root):
            shown = sorted(d for d in dirnames if d not in SKIP)
            sealed = {d for d in shown if d.casefold() in SEALED}
            rel_dir = os.path.relpath(dirpath, self.root).replace(os.sep, '/')
            prefix = '' if rel_dir == '.' else rel_dir + '/'
            reused = {d for d in shown if d not in sealed and keep and keep(prefix + d)}
            kept += [prefix + d + '/' for d in reused]
            dirnames[:] = [d for d in shown if d not in sealed and d not in reused]
            for name, kind in [*((d, 'dir') for d in shown), *((f, 'file') for f in sorted(filenames))]:
                try:
                    st = os.stat(os.path.join(dirpath, name))
                except OSError:
                    continue  # a broken symlink, or gone meanwhile
                out[prefix + name] = Entry(kind, st.st_ino, st.st_mtime_ns, st.st_size, int(st.st_mtime),
                                           bool(getattr(st, 'st_flags', 0) & SF_DATALESS), kind == 'dir' and name in sealed)
        # The folders walked, each with the mtime it had before it was listed: a file made, renamed or removed in one
        # (every write here is atomic_write's temp file then a rename) changes it (_unchanged).
        inside = tuple(kept)
        self._walked = [(self.root, self._top_mtime)] + [
            (os.path.join(self.root, rel), e.mtime_ns) for rel, e in out.items()
            if e.kind == 'dir' and not e.sealed and not (rel + '/').startswith(inside)]
        if kept:
            # What is in the kept folders, as the last walk had it: picked out of thousands of entries once, then
            # reused by every partial walk until a whole one replaces it.
            cached = self._kept_part
            if cached is None or cached[0] != inside:
                cached = self._kept_part = (inside, {rel: e for rel, e in self._entries.items() if rel.startswith(inside)})
            out.update(cached[1])
        else:
            self._kept_part = None
        return out

    def _unchanged(self):
        """Whether no folder of the last walk had a file made, renamed or removed since (one stat per folder, not one
        per file). A file edited in place by another program does not show here: only trusted within one write."""
        for path, mtime in self._walked:
            try:
                if mtime is None or os.stat(path).st_mtime_ns != mtime:
                    return False
            except OSError:
                return False
        return True

    def refresh(self, by=None, keep=None):
        """Walk the folder again, and log what changed since the last walk (none on the first). `keep`: the folders
        not walked again (_walk); after such a partial walk the items are current but those folders may not be, so a
        read of the whole folder walks it all again (_stale)."""
        with self._lock:
            old = self._entries
            keep = keep if old is not None else None  # nothing to take them from yet: the whole folder
            new = self._walk(keep)
            if old is not None and new == old:
                # Nothing changed: the same walk, the same object — so what a Store worked out from it (its items, its
                # resolver) still holds, and it can tell by identity alone (Store._items_memo).
                new = old
            elif old is not None:
                for rel, e in new.items():
                    o = old.get(rel)
                    if o is e:
                        continue  # taken from the last walk (a kept folder's)
                    if o is None or (e.kind == 'file' and key_of(o) != key_of(e)):
                        self._note(rel, by)
                for rel in old:
                    if rel not in new:
                        self._note(rel, by)
                        self._said.pop(rel, None)
            if self._kept is None:
                self._load_kept()
            now = clocks()
            self._entries, self._dirty, self._items_at = new, False, now
            self._reuse = keep  # a partial walk may serve the write's next read (entries), while nothing changed
            if keep:
                self._stale = True
            else:
                self._at, self._stale = now, False
            return new

    def _note(self, rel, by):
        self._seq += 1
        self._log.append((self._seq, rel, by))

    def entries(self, fresh=False, by=None, max_age=None, keep=None):
        """{rel: Entry} of the whole vault. A walk now, unless the index is watched and its last walk is younger than
        `max_age` (the index's own when None) and no write came since; `fresh` always walks (a write in progress).
        `keep`: what is read is only outside the folders that predicate keeps (the items: Store._no_items), so a walk of
        the rest is enough and is what is trusted — a read of the whole folder trusts only a whole walk."""
        with self._lock:
            if fresh and keep:
                # Within one write, its item reads (five for a create) share one walk until a folder of it changed.
                if self._reuse is not None and self._reuse == keep and self._entries is not None and self._unchanged():
                    return self._entries
                return self.refresh(by, keep)
            now = clocks()
            if (not fresh and self._entries is not None and not self._dirty and within(self._watched[0], now, self._watched[1])
                    and (keep or not self._stale)
                    and within(self._items_at if keep else self._at, now, self.max_age if max_age is None else max_age)):
                return self._entries
            return self.refresh(by, keep)

    def whole_walk_due(self, every):
        """Whether the last walk of the whole folder is older than `every` s (the poll, server.py vault_changes: it
        walks the item folders on every ask, and everything only this often)."""
        return self._entries is None or not within(self._at, clocks(), every)

    def entry(self, rel):
        return (self._entries or {}).get(rel)

    # ── writes and the poll ──────────────────────────────────────────────────
    @property
    def watched(self):
        return within(self._watched[0], clocks(), self._watched[1])

    def watch(self, seconds):
        """A page polls: trust a walk for max_age, for the next `seconds`."""
        self._watched = (clocks(), seconds)

    def before_write(self, keep=None):
        """A Store write starts: what changed before it is somebody else's (only worth a walk when a page polls).
        `keep` (the folders a write's reads never need, Store._no_items): walked by the next poll instead, which logs
        what changed there as nobody's — a change made outside the app, or by this write in a Docs folder (the page
        then reloads once more than it needed)."""
        self._reuse = None  # a walk from before this write is never reused by it
        if self.watched:
            self.refresh(keep=keep)

    def after_write(self, by=None, keep=None):
        """A Store write ended: what it changed is `by`'s; the next read walks again (`keep`: before_write). A write
        that read its items after its last change (an update reads its item back) walked them then, as `by`: unless a
        folder changed since, that walk is the one after the write."""
        if self.watched:
            if not (keep and self._reuse == keep and self._entries is not None and self._unchanged()):
                self.refresh(by, keep=keep)
            self._reuse = None
        else:
            self._reuse = None
            self._dirty = True

    def changes(self, since=None, epoch=None, exclude=None):
        """What changed after `since` (a sequence number this index gave), but what `exclude` (a tab) wrote. → {epoch,
        seq, paths, more}: `more` when there were more than CHANGES_MAX or the log no longer reaches back that far; a
        `since` of another epoch (the vault was opened again) or none answers no paths, only where to start."""
        with self._lock:
            out = {'epoch': self.epoch, 'seq': self._seq, 'paths': [], 'more': False}
            if since is None or epoch != self.epoch:
                return out
            if self._log and self._log[0][0] > since + 1:
                out['more'] = True
            paths = []
            for seq, rel, by in self._log:
                if seq > since and (exclude is None or by != exclude) and rel not in paths:
                    paths.append(rel)
            out['more'] = out['more'] or len(paths) > CHANGES_MAX
            out['paths'] = paths[:CHANGES_MAX]
            return out

    # ── what a file says ─────────────────────────────────────────────────────
    def _read(self, rel, key):
        """A file's text, read once per stat key (errors replaced; whether it was UTF-8 and held a NUL kept beside it).
        None for a file iCloud has not downloaded, one outside the vault (a symlink out) or one that cannot be read."""
        e = self.entry(rel)
        if e is None or e.kind != 'file' or e.dataless:
            return None
        full = os.path.realpath(os.path.join(self.root, rel))
        if not full.startswith(self.root + os.sep):
            return None
        with self._lock:
            said = self._said.get(rel)
            if said and said['key'] == key and 'text' in said:
                return said
        try:
            with open(full, 'rb') as f:
                raw = f.read()
        except OSError:
            return None
        try:
            text, utf8 = raw.decode('utf-8'), True
        except UnicodeDecodeError:
            text, utf8 = raw.decode('utf-8', errors='replace'), False
        with self._lock:
            said = self._said.get(rel)
            if not said or said['key'] != key:
                said = self._said[rel] = {'key': key}
            said.update(text=text, utf8=utf8, nul='\x00' in text)
            return said

    def text(self, rel, utf8=True, nul=True):
        """A file's text; None when it cannot be read, is not UTF-8 (`utf8`) or holds a NUL (`nul`: refused unless True)."""
        e = self.entry(rel)
        said = self._read(rel, key_of(e)) if e else None
        if said is None or (utf8 and not said['utf8']) or (not nul and said['nul']):
            return None
        return said['text']

    def lines(self, rel):
        """(lines, folded lines) of a UTF-8 text file with no NUL in it (what search looks through); None otherwise."""
        e = self.entry(rel)
        said = self._read(rel, key_of(e)) if e else None
        if said is None or not said['utf8'] or said['nul']:
            return None
        if 'folded' not in said:
            lines = said['text'].splitlines()
            said['lines'], said['folded'] = lines, [fold(line) for line in lines]
        return said['lines'], said['folded']

    def value(self, rel, name, compute, utf8=False):
        """`compute(text)` of a file, once per stat key; a PERSISTED one is kept on disk too, so the next run finds it
        without reading the file. None when the file cannot be read (or is not UTF-8, with `utf8`)."""
        e = self.entry(rel)
        if e is None:
            return None
        key = key_of(e)
        with self._lock:
            said = self._said.get(rel)
            if said and said['key'] == key and name in said:
                return said[name]
            kept = (self._kept or {}).get(rel)
            if name in PERSISTED and kept and tuple(kept[:3]) == key and name in kept[3]:
                if not said or said['key'] != key:
                    said = self._said[rel] = {'key': key}
                said[name] = kept[3][name]
                return said[name]
        text = self.text(rel, utf8=utf8)
        if text is None:
            return None
        result = compute(text)
        with self._lock:
            said = self._said.get(rel)
            if said and said['key'] == key:
                said[name] = result
                if name in PERSISTED:
                    self._unsaved = True
        return result

    # ── kept on disk ─────────────────────────────────────────────────────────
    def _load_kept(self):
        """The kept file of a run before, if it is this version's and this vault's; anything else starts empty."""
        self._kept = {}
        try:
            with open(self.cache_file, encoding='utf-8') as f:
                data = json.load(f)
            if data.get('version') == VERSION and data.get('root') == self.root and isinstance(data.get('files'), dict):
                self._kept = {rel: v for rel, v in data['files'].items() if isinstance(v, list) and len(v) == 4}
        except (OSError, ValueError, AttributeError):
            pass

    def save(self, force=False):
        """Write what files say (PERSISTED) to the kept file, when something new was learnt and SAVE_EVERY has passed
        (`force`: now). Never fails a request: a cache that cannot be written is only slower next time."""
        with self._lock:
            if not self._unsaved or (not force and time.monotonic() - self._saved_at < SAVE_EVERY):
                return False
            files = {}
            for rel, said in self._said.items():
                kept = {n: said[n] for n in PERSISTED if n in said}
                if kept:
                    files[rel] = [*said['key'], kept]
            for rel, v in (self._kept or {}).items():  # what is still true of a file not read this run
                e = self.entry(rel)
                if rel not in files and e is not None and key_of(e) == tuple(v[:3]):
                    files[rel] = v
            self._unsaved, self._saved_at = False, time.monotonic()
        try:
            os.makedirs(os.path.dirname(self.cache_file), exist_ok=True)
            atomic_write(self.cache_file, json.dumps({'version': VERSION, 'root': self.root, 'files': files}, ensure_ascii=False))
            return True
        except OSError:
            return False

    def forget(self):
        """Drop everything: the walk, what files say and the kept file (Reload from disk)."""
        with self._lock:
            self._entries, self._said, self._kept, self._unsaved, self._kept_part = None, {}, {}, False, None
            try:
                os.remove(self.cache_file)
            except OSError:
                pass
