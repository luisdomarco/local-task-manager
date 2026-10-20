"""atomic_write: a reader sees the old file or the new one, never an empty or half-written one."""
import errno
import os
import stat
import tempfile
import threading
import unittest
from unittest import mock

from tm import fsutil
from tm.fsutil import atomic_write


class AtomicWriteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = os.path.realpath(self.tmp.name)
        self.path = os.path.join(self.dir, 'a.md')

    def read(self, path=None):
        with open(path or self.path, encoding='utf-8') as f:
            return f.read()

    def assertOnlyFiles(self, *names):
        self.assertEqual(sorted(os.listdir(self.dir)), sorted(names))  # no temporary left behind

    def test_replaces_the_whole_content(self):
        atomic_write(self.path, 'x' * 5000)
        atomic_write(self.path, 'short ñ')
        self.assertEqual(self.read(), 'short ñ')
        self.assertOnlyFiles('a.md')

    def test_new_file_mode_follows_the_umask(self):
        mask = os.umask(0o022)
        os.umask(mask)
        atomic_write(self.path, 'x')
        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o666 & ~mask)

    def test_existing_mode_is_kept(self):
        atomic_write(self.path, 'one')
        os.chmod(self.path, 0o640)
        atomic_write(self.path, 'two')
        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o640)

    def test_exclusive_refuses_an_existing_file(self):
        atomic_write(self.path, 'first', exclusive=True)
        with self.assertRaises(FileExistsError):
            atomic_write(self.path, 'second', exclusive=True)
        self.assertEqual(self.read(), 'first')
        self.assertOnlyFiles('a.md')

    def test_exclusive_without_hard_links_falls_back(self):
        for code in (errno.EPERM, errno.ENOTSUP, errno.EXDEV):
            with self.subTest(errno=code):
                path = os.path.join(self.dir, f'n{code}.md')
                with mock.patch.object(fsutil.os, 'link', side_effect=OSError(code, 'no links here')):
                    atomic_write(path, 'made', exclusive=True)
                    self.assertEqual(self.read(path), 'made')
                    with self.assertRaises(FileExistsError):
                        atomic_write(path, 'again', exclusive=True)
                self.assertEqual(self.read(path), 'made')
        self.assertFalse([n for n in os.listdir(self.dir) if n.endswith('.tmp')])

    def test_other_link_errors_are_not_swallowed(self):
        with mock.patch.object(fsutil.os, 'link', side_effect=OSError(errno.EIO, 'disk')):
            with self.assertRaises(OSError):
                atomic_write(self.path, 'x', exclusive=True)
        self.assertOnlyFiles()

    def test_a_failure_half_way_leaves_the_original_intact(self):
        atomic_write(self.path, 'original')
        # the new content is already half on disk (in the temporary) when the flush fails
        with mock.patch.object(fsutil.os, 'fsync', side_effect=OSError(errno.ENOSPC, 'disk full')):
            with self.assertRaises(OSError):
                atomic_write(self.path, 'new content that never lands')
        with mock.patch.object(fsutil.os, 'replace', side_effect=OSError(errno.EIO, 'boom')):
            with self.assertRaises(OSError):
                atomic_write(self.path, 'nor this')
        self.assertEqual(self.read(), 'original')
        self.assertOnlyFiles('a.md')

    def test_a_temporary_left_by_a_crash_is_ignored_and_does_not_block(self):
        stale = os.path.join(self.dir, '.tm-deadbeef0000.tmp')
        with open(stale, 'w') as f:
            f.write('half')
        atomic_write(self.path, 'whole')
        self.assertEqual(self.read(), 'whole')
        self.assertEqual(sorted(os.listdir(self.dir)), ['.tm-deadbeef0000.tmp', 'a.md'])  # the leftover is not touched

    def test_a_long_file_name_still_writes(self):
        # 240 bytes of name: a temporary named after it would pass the 255-byte limit.
        long = os.path.join(self.dir, 'x' * 237 + '.md')
        atomic_write(long, 'long name')
        self.assertEqual(self.read(long), 'long name')
        atomic_write(long, 'again', exclusive=False)
        self.assertEqual(self.read(long), 'again')
        atomic_write(os.path.join(self.dir, 'y' * 237 + '.md'), 'new', exclusive=True)

    def test_writing_through_a_symlink_updates_its_target(self):
        target = os.path.join(self.dir, 'real.md')
        atomic_write(target, 'old')
        os.symlink(target, self.path)
        atomic_write(self.path, 'new')
        self.assertTrue(os.path.islink(self.path))
        self.assertEqual(self.read(target), 'new')

    def test_readers_never_see_a_partial_file(self):
        # With open('w') this fails at once: the reader catches the file truncated, or half written.
        versions = ['A' * 200_000 + '\n', 'B' * 150_000 + '\n']
        atomic_write(self.path, versions[0])
        stop, seen, bad = threading.Event(), set(), []

        def reader():
            while not stop.is_set():
                text = self.read()
                if text not in versions:
                    bad.append(len(text))
                seen.add(text[:1])

        def writer(n):
            for i in range(60):
                atomic_write(self.path, versions[(i + n) % 2])

        r = threading.Thread(target=reader)
        r.start()
        writers = [threading.Thread(target=writer, args=(n,)) for n in range(3)]
        for w in writers:
            w.start()
        for w in writers:
            w.join()
        stop.set()
        r.join()
        self.assertEqual(bad, [])
        self.assertEqual(seen, {'A', 'B'})  # the reader really did run while the content changed
        self.assertOnlyFiles('a.md')


if __name__ == '__main__':
    unittest.main()
