"""Crash-safe file writes.

`open(path, 'w')` truncates first and writes after: a crash, a full disk or a reader
in between sees an empty or half-written file. Here the new content goes to a hidden
temporary file in the same folder, is flushed to disk, and only then takes the
place of the old file in one step (`os.replace`), so any reader sees the old file
or the new one, never a mix.

What the swap does not keep: extended attributes (Finder tags, colour labels) and
the creation date of the old file, because the result is a new file. Its mode is kept.
"""

import errno
import os
import secrets
import shutil

# The file system cannot make hard links (FAT/exFAT, some network shares): fall back to check + rename.
_NO_LINK = {errno.EPERM, errno.ENOTSUP, errno.EOPNOTSUPP, errno.EXDEV, errno.EMLINK, errno.ENOSYS}


def _tmp_path(path):
    # Starts with a dot and does not end in .md: the scanner and the trash listing skip it. The name is a fixed
    # length, whatever the file is called: a name built from the target's would overflow the file system's
    # limit (255 bytes) for an item with a long title, which open('w') used to write without trouble.
    return os.path.join(os.path.dirname(path), f'.tm-{secrets.token_hex(6)}.tmp')


def _open_tmp(path):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    while True:
        tmp = _tmp_path(path)
        try:
            return os.open(tmp, flags, 0o666), tmp  # 0666 minus the umask, like open(); mkstemp would make it 0600
        except FileExistsError:
            continue  # a random name that is taken (a leftover or another writer): draw another


def atomic_write(path, text, exclusive=False):
    """Write `text` (UTF-8; bytes as they are, an attachment) to `path` all at once.

    exclusive=True refuses to replace an existing file (FileExistsError), like open(path, 'x').
    Writing through a symlink updates the file it points at and leaves the link alone, as open() did.
    """
    path = os.path.realpath(path)
    fd, tmp = _open_tmp(path)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(text if isinstance(text, bytes) else text.encode('utf-8'))
            f.flush()
            os.fsync(f.fileno())
        if not exclusive:
            try:
                shutil.copymode(path, tmp)
            except FileNotFoundError:
                pass
            os.replace(tmp, path)
            return
        try:
            os.link(tmp, path)  # atomic and fails if path exists: no window where two creators both win
        except OSError as e:
            if e.errno not in _NO_LINK:
                raise
            # No hard links here. Every creator in this app holds the store lock, so check + rename is enough.
            if os.path.lexists(path):
                raise FileExistsError(errno.EEXIST, os.strerror(errno.EEXIST), path) from None
            os.replace(tmp, path)
    finally:
        try:
            os.unlink(tmp)  # after link() the content lives on under `path`; after replace() it is already gone
        except FileNotFoundError:
            pass
