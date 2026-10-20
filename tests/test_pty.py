"""The embedded terminal: a process in a pty, its output buffered and fanned out, keystrokes in, resize, kill."""
import os
import queue
import shutil
import sys
import tempfile
import time
import unittest

from tm import pty as tpty
from tm.store import StoreError

# A tiny "program": prints its TERM and size, then runs each line it is given as a shell command.
SHELL = ['sh', '-c', 'printf "hi %s\\n" "$TERM"; stty size; while read -r l; do eval "$l"; done']
ENV = {**os.environ, 'TERM': 'xterm-256color'}


def drain(q, until, timeout=5):
    """Chunks from the queue until `until` shows up in what was read (or the sentinel / timeout)."""
    got, deadline = b'', time.time() + timeout
    while until not in got and time.time() < deadline:
        try:
            chunk = q.get(timeout=0.2)
        except queue.Empty:
            continue
        if chunk is None:
            break
        got += chunk
    return got


@unittest.skipIf(sys.platform == 'win32' or not shutil.which('sh'), 'needs a pty and sh')
class TermTest(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.mkdtemp(prefix='tm pty ')
        self.addCleanup(shutil.rmtree, self.work, True)
        self.terms = tpty.Terms()
        self.addCleanup(self.terms.close_all)

    def test_output_input_resize_and_exit(self):
        term = self.terms.open('t1', SHELL, self.work, 80, 24, ENV, 'demo')
        _, q = term.subscribe()
        got = drain(q, b'24 80')
        self.assertIn(b'hi xterm-256color', got)  # the environment reached the process
        self.assertIn(b'24 80', got)  # and so did the size, before it started
        term.write(b'pwd\n')
        self.assertIn(os.path.realpath(self.work).encode(), drain(q, os.path.realpath(self.work).encode()))  # ran in cwd
        term.resize(120, 40)
        term.write(b'stty size\n')
        self.assertIn(b'40 120', drain(q, b'40 120'))
        self.assertEqual((term.cols, term.rows), (120, 40))
        snapshot, q2 = term.subscribe()  # a late subscriber gets everything printed so far
        self.assertIn(b'hi xterm-256color', snapshot)
        self.assertIn(b'40 120', snapshot)
        term.write(b'exit 3\n')
        drain(q2, b'\x00never', timeout=5)  # reads through to the sentinel
        for _ in range(100):
            if not term.alive:
                break
            time.sleep(0.05)
        self.assertFalse(term.alive)
        self.assertEqual(term.exit_code, 3)
        self.assertIn(b'exit 3', drain(q, b'\x00never', timeout=3))  # the first subscriber got the rest, then its sentinel
        self.assertTrue(q.empty())
        with self.assertRaises(StoreError) as cm:
            term.write(b'x')
        self.assertEqual(cm.exception.status, 409)
        self.assertFalse(self.terms.list()[0]['alive'])  # still listed, so its screen can be read
        self.assertEqual(self.terms.close('t1')['exit_code'], 3)
        with self.assertRaises(StoreError):
            self.terms.get('t1')

    def test_buffer_is_bounded(self):
        old = tpty.BUFFER_BYTES
        tpty.BUFFER_BYTES = 2000
        self.addCleanup(setattr, tpty, 'BUFFER_BYTES', old)
        term = self.terms.open('t2', SHELL, self.work, 80, 24, ENV)
        _, q = term.subscribe()
        drain(q, b'24 80')
        # DO""NE prints DONE, but its echo does not hold it: wait for the output, not for the typed line coming back
        term.write(b'i=0; while [ $i -lt 200 ]; do printf "%050d\\n" $i; i=$((i+1)); done; echo DO""NE\n')
        drain(q, b'DONE')
        snapshot, _ = term.subscribe()
        self.assertIn(b'DONE', snapshot)
        self.assertLess(len(snapshot), 2000 + tpty.READ_BYTES)  # at most one chunk over the cap

    def test_reattach_hands_back_the_live_terminal_and_kill_ends_it(self):
        term = self.terms.open('t3', SHELL, self.work, 80, 24, ENV)
        self.assertIs(self.terms.open('t3', SHELL, self.work, 80, 24, ENV), term)  # no second process
        _, q = term.subscribe()
        drain(q, b'24 80')
        term.kill()
        self.assertFalse(term.alive)
        self.assertIsNone(q.get(timeout=2))
        again = self.terms.open('t3', SHELL, self.work, 80, 24, ENV)  # an ended one is replaced
        self.assertIsNot(again, term)
        self.assertTrue(again.alive)

    def test_a_missing_command_is_a_clear_error(self):
        with self.assertRaises(StoreError) as cm:
            self.terms.open('t4', ['no-such-claude-binary'], self.work, 80, 24, ENV)
        self.assertEqual(cm.exception.status, 500)
        self.assertIn('not found in the PATH', str(cm.exception))
        with self.assertRaises(StoreError):
            self.terms.get('t4')

    def test_sizes_are_clamped(self):
        self.assertEqual(tpty.dim('abc', 100, 20, 500), 100)
        self.assertEqual(tpty.dim(5, 100, 20, 500), 20)
        self.assertEqual(tpty.dim(9999, 100, 20, 500), 500)
        self.assertEqual(tpty.dim('132', 100, 20, 500), 132)
