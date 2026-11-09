"""An agent's files as its page shows and edits them: its own command file, and the files of its folder it works with
(tm/agentlinks.py related) — read whole (frontmatter and all) for Source and Edit, and written back from Edit.

Only those: the page names a file by the path related() lists (or none, for the command's own file), never by any path
it likes. A save goes against the version it was read at (`rev`, as the Explorer's editor does: Store.disk_rev), so an
edit made meanwhile in an editor or by an agent is never written over, and it lands with an atomic rename on the real
file (a file reached through a linked `.claude/commands` is written where it lives, and the link stays a link).
"""

import os
import threading

from tm import agentlinks, commands
from tm.fsutil import atomic_write
from tm.store import StoreError

SAVE_MAX = 2 * 1024 * 1024  # as the Explorer: no larger file is edited here
MARKDOWN_EXT = ('.md', '.markdown')
_lock = threading.Lock()  # one save at a time from this server (another process is caught by `rev`)


def rev_of(full):
    """A file's version: changes with any write, to the nanosecond, whatever wrote it (as Store.disk_rev)."""
    st = os.stat(full)
    return f'{st.st_mtime_ns}-{st.st_size}'


def locate(folder, name, path=''):
    """(full path, path as the page shows it) of command `name`'s own file (`path` empty) or of a file it works with.
    None when it is neither."""
    if not path:
        full = commands.find(folder, name)
        return (os.path.realpath(full), commands.read(folder, name)['file']) if full else None
    rel = agentlinks.related(folder, name)
    if not rel or not any(i['path'] == path for k in agentlinks.KINDS for i in rel[k]):
        return None
    full = os.path.realpath(os.path.join(os.path.realpath(folder), path))
    return (full, path) if full.endswith(agentlinks.TEXT_EXT) and os.path.isfile(full) else None


def _text(full, shown):
    with open(full, 'rb') as f:
        raw = f.read(SAVE_MAX + 1)
    if len(raw) > SAVE_MAX:
        raise StoreError(400, f'too large to show here: {shown}')
    if b'\x00' in raw:
        raise StoreError(400, f'not a text file: {shown}')
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        raise StoreError(400, f'not a text file: {shown}') from None


def read(folder, name, path=''):
    """{path, text (the whole file), body (Markdown without its frontmatter, for Preview), markdown, rev}, or None."""
    found = locate(folder, name, path)
    if not found:
        return None
    full, shown = found
    text = _text(full, shown)
    md = full.endswith(MARKDOWN_EXT)
    return {'path': shown, 'text': text, 'body': commands._parse(text)[1] if md else text, 'markdown': md, 'rev': rev_of(full)}


def save(folder, name, path, text, base_rev):
    """Writes `text` over the file, unless it changed on disk since `base_rev` (409, with its rev). → read() after."""
    if not isinstance(text, str):
        raise StoreError(400, 'text must be a string')
    if len(text.encode('utf-8')) > SAVE_MAX:
        raise StoreError(400, 'too large to save here')
    found = locate(folder, name, path)
    if not found:
        return None
    full, shown = found
    with _lock:
        old = _text(full, shown)
        if base_rev and rev_of(full) != base_rev:
            raise StoreError(409, f'{shown} changed on disk since it was opened', rev=rev_of(full))
        if '\r\n' in old and '\r' not in text:
            text = text.replace('\n', '\r\n')  # a textarea gives LF: a CRLF file stays CRLF
        if text != old:
            atomic_write(full, text)
    return read(folder, name, path)
