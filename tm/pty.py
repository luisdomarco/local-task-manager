"""Claude in a pseudo-terminal inside this server, so the browser can show it (xterm.js in the dock) instead of
Terminal.app. One Term per Claude session id. Its output is kept in a bounded buffer — a tab that reconnects
(a page reload) gets the screen back — and fanned out to every subscriber queue (the SSE streams). stdlib only.

Only `claude` (the command from Settings) is ever started here, with flags the server built: the browser sends
keystrokes to a running terminal, never a command line."""
import collections
import fcntl
import os
import queue
import shutil
import signal
import struct
import subprocess
import termios
import threading
import time

from .store import StoreError

BUFFER_BYTES = 512 * 1024  # of output kept per terminal, for reattaching
READ_BYTES = 65536
MIN_COLS, MAX_COLS, MIN_ROWS, MAX_ROWS = 20, 500, 5, 200


def dim(value, default, lo, hi):
    """A terminal size from the browser: an int within bounds, else the default."""
    try:
        v = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _attach_tty():
    """Runs in the child, after setsid: the pty becomes its controlling terminal (job control, ^C, SIGHUP on close)."""
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)


class Term:
    def __init__(self, term_id, argv, cwd, cols, rows, env, label=''):
        exe = shutil.which(argv[0])
        if not exe:
            raise StoreError(500, f'{argv[0]!r} was not found in the PATH of this server — set the full path in Settings → Command')
        self.id, self.cwd, self.label = term_id, cwd, label
        self.cols, self.rows = cols, rows
        self.started = time.time()
        self.exit_code = None
        self._buffer = collections.deque()
        self._size = 0
        self._subs = set()
        self._lock = threading.Lock()
        master, slave = os.openpty()
        self._master = master
        self._set_size(cols, rows)
        try:
            self._proc = subprocess.Popen([exe, *argv[1:]], cwd=cwd, env=env, stdin=slave, stdout=slave, stderr=slave,
                                          start_new_session=True, preexec_fn=_attach_tty, close_fds=True)
        except OSError as e:
            os.close(master)
            os.close(slave)
            raise StoreError(500, f'could not start {argv[0]}: {e}')
        os.close(slave)  # the child holds its own copy; EOF on the master then means "it is gone"
        threading.Thread(target=self._pump, name=f'term-{term_id[:8]}', daemon=True).start()

    # ── io ───────────────────────────────────────────────────────────────────
    def _pump(self):
        while True:
            try:
                chunk = os.read(self._master, READ_BYTES)
            except OSError:  # EIO: the slave side closed — the process ended
                break
            if not chunk:
                break
            with self._lock:
                self._buffer.append(chunk)
                self._size += len(chunk)
                while self._size > BUFFER_BYTES and len(self._buffer) > 1:
                    self._size -= len(self._buffer.popleft())
                subs = list(self._subs)
            for q in subs:
                q.put(chunk)
        self.exit_code = self._proc.wait()
        with self._lock:
            subs = list(self._subs)
        for q in subs:
            q.put(None)  # the sentinel: nothing more will come
        try:
            os.close(self._master)
        except OSError:
            pass

    @property
    def alive(self):
        return self.exit_code is None

    def write(self, data):
        """Keystrokes from the browser, as bytes."""
        if not self.alive:
            raise StoreError(409, 'this terminal has ended')
        try:
            os.write(self._master, data)
        except OSError as e:
            raise StoreError(409, f'this terminal is not taking input: {e}')

    def _set_size(self, cols, rows):
        fcntl.ioctl(self._master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
        self.cols, self.rows = cols, rows

    def resize(self, cols, rows):
        if not self.alive:
            return
        self._set_size(cols, rows)
        try:
            os.killpg(os.getpgid(self._proc.pid), signal.SIGWINCH)
        except (ProcessLookupError, PermissionError, OSError):
            pass

    def kill(self, grace=1.0):
        """SIGHUP (what closing a terminal window sends), then SIGKILL if it lingers."""
        if not self.alive:
            return
        for sig, wait in ((signal.SIGHUP, grace), (signal.SIGTERM, grace), (signal.SIGKILL, 5)):
            try:
                os.killpg(os.getpgid(self._proc.pid), sig)
            except (ProcessLookupError, PermissionError, OSError):
                pass
            try:
                self._proc.wait(timeout=wait)
                break
            except subprocess.TimeoutExpired:
                continue
        # _pump sets exit_code once it drains the master; wait for it so callers see a consistent state
        for _ in range(50):
            if not self.alive:
                break
            time.sleep(0.02)

    # ── listeners ────────────────────────────────────────────────────────────
    def subscribe(self):
        """→ (what was printed so far, a queue of the chunks to come; None on it means the end)."""
        q = queue.Queue()
        with self._lock:
            snapshot = b''.join(self._buffer)
            self._subs.add(q)
            ended = not self.alive
        if ended:
            q.put(None)
        return snapshot, q

    def unsubscribe(self, q):
        with self._lock:
            self._subs.discard(q)

    def info(self):
        return {'id': self.id, 'label': self.label, 'cwd': self.cwd, 'alive': self.alive, 'exit_code': self.exit_code,
                'cols': self.cols, 'rows': self.rows, 'started': self.started}


class Terms:
    """The terminals this server runs, by Claude session id. An ended one stays listed (its screen can still be
    read) until it is closed."""

    def __init__(self):
        self._by_id = {}
        self._lock = threading.Lock()

    def open(self, term_id, argv, cwd, cols, rows, env, label=''):
        """Start one — or, when a live terminal already runs that session, hand that one back (a reattach)."""
        with self._lock:
            cur = self._by_id.get(term_id)
            if cur and cur.alive:
                return cur
            term = Term(term_id, argv, cwd, cols, rows, env, label)
            self._by_id[term_id] = term
            return term

    def get(self, term_id):
        term = self._by_id.get(str(term_id or ''))
        if not term:
            raise StoreError(404, 'no such terminal')
        return term

    def list(self):
        return [t.info() for t in sorted(self._by_id.values(), key=lambda t: t.started)]

    def close(self, term_id):
        with self._lock:
            term = self._by_id.pop(str(term_id or ''), None)
        if not term:
            raise StoreError(404, 'no such terminal')
        term.kill()
        return {'closed': term_id, 'exit_code': term.exit_code}

    def close_all(self):
        for term_id in list(self._by_id):
            try:
                self.close(term_id)
            except StoreError:
                pass
