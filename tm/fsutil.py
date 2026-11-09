"""Crash-safe file writes.

`open(path, 'w')` truncates first and writes after: a crash, a full disk or a reader
in between sees an empty or half-written file. Here the new content goes to a hidden
temporary file in the same folder, is flushed to disk, and only then takes the
place of the old file in one step (`os.replace`), so any reader sees the old file
or the new one, never a mix.

What the swap does not keep: extended attributes (Finder tags, colour labels) and
the creation date of the old file, because the result is a new file. Its mode is kept.

vault_lock() is the other half: one writer at a time across processes (the app, tools/vault.py, a sync), so two of
them never hand out the same id or rewrite a file the other just read.
"""

import contextlib
import errno
import os
import secrets
import shutil
import time

try:
    import fcntl
except ImportError:  # not a Unix: the store's own (in-process) lock is all there is
    fcntl = None

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


LOCK_FILE = '.lock'  # in the vault's META_DIR; empty, it only carries the lock


class VaultBusy(Exception):
    """Another process held the vault's lock for longer than the wait allows."""


@contextlib.contextmanager
def vault_lock(meta_dir, timeout=10.0):
    """Hold the vault's write lock (flock on <meta_dir>/.lock) for the block, waiting up to `timeout` seconds for
    another process to let it go (VaultBusy after that). The lock goes with the file descriptor: a process that dies
    holding it lets it go at once, and nothing is left to clean up.

    It is per open file, not per process: two threads of one process that both open the file wait for each other
    too. The Store takes its own RLock first and this second, always in that order, so they never deadlock.

    A vault where the lock cannot be taken at all (a read-only folder, a share without flock) is written without it,
    as before there was one: the write itself says why it fails, if it does."""
    fd = None
    if fcntl is not None:
        try:
            os.makedirs(meta_dir, exist_ok=True)
            fd = os.open(os.path.join(meta_dir, LOCK_FILE), os.O_RDWR | os.O_CREAT, 0o666)
        except OSError:
            fd = None
    try:
        if fd is not None:
            deadline = time.monotonic() + timeout
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise VaultBusy(f'another program has been writing to this vault for over {timeout:g} s') from None
                    time.sleep(0.02)
                except OSError:
                    break  # no flock on this file system: unlocked, as above
        yield
    finally:
        if fd is not None:
            os.close(fd)  # lets the lock go
