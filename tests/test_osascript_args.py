"""Vault text handed to `osascript` is read as values, never as options (`server.osascript_cmd`).

osascript parses its options with BSD getopt: an argument that starts with `-` is read as an option and not as a
value for the script's `on run argv` / JXA's `run(argv)`, so a title of exactly `-e` turns the argument after it into
another piece of script. A title is not always written in the app — the iOS Share extension and the Inbox take a
shared page's title — so every value goes behind `--`.

These tests assert on the argv each call *would* make; none of them runs osascript.
"""
import datetime as dt
import tempfile
import unittest
from unittest import mock

import server

# Values that must arrive as values. `-e` is the one that costs: osascript would read the next argument as script.
AS_OPTIONS = ['-e', '-l', '--', '-rf', '-e ', '-']


class CmdTest(unittest.TestCase):
    def test_the_data_goes_behind_a_double_dash(self):
        self.assertEqual(server.osascript_cmd(['-e', 'SCRIPT'], ['a', 'b']),
                         ['osascript', '-e', 'SCRIPT', '--', 'a', 'b'])
        self.assertEqual(server.osascript_cmd(['-l', 'JavaScript', '-e', 'S'], []),
                         ['osascript', '-l', 'JavaScript', '-e', 'S', '--'])

    def test_every_value_stays_behind_it_whole_and_in_order(self):
        cmd = server.osascript_cmd(['-e', 'S'], AS_OPTIONS)
        self.assertEqual(cmd[:4], ['osascript', '-e', 'S', '--'])
        self.assertEqual(cmd[4:], AS_OPTIONS)  # unchanged: nothing escaped, nothing dropped
        self.assertEqual(cmd.count('--'), 2)  # the one that ends the options, and the value that is "--"
        self.assertEqual(cmd.index('--'), 3)  # the first is the separator


def _calls_of(fn):
    """Runs `fn` with the Mac's platform and a `subprocess.run` that only records the argv. → the argvs."""
    calls = []

    class Now:  # a thread that runs at once, so the ring's argv is recorded before the test looks
        def __init__(self, target, args, **_):
            self.go = lambda: target(*args)

        def start(self):
            self.go()

    def run(cmd, **_):
        calls.append(cmd)
        return mock.Mock(returncode=0, stdout='', stderr='')

    with mock.patch.object(server.sys, 'platform', 'darwin'), \
            mock.patch.object(server.threading, 'Thread', Now), \
            mock.patch.object(server.subprocess, 'run', run):
        fn()
    return calls


class RingTest(unittest.TestCase):
    """`ring_on_mac`: the title, the words for the time and the ref. The title is the one from outside."""

    NOW = dt.datetime(2026, 11, 19, 13, 20)
    R = {'ref': 'TSK-1', 'key': 'T1', 'offset': '10m', 'urgent': False,
         'at': '2026-11-19T13:20', 'start': '2026-11-19T13:30'}

    def argv_for(self, title, urgent=False):
        r = {**self.R, 'title': title, 'urgent': urgent}
        with mock.patch('builtins.print'):
            calls = _calls_of(lambda: server.ring_on_mac(r, self.NOW))
        self.assertEqual(len(calls), 1)
        return calls[0]

    def test_a_title_of_dash_e_is_a_value_not_another_script(self):
        argv = self.argv_for('-e')
        self.assertEqual(argv[3], '--')  # ['osascript', '-e', <script>, '--', …]
        self.assertEqual(argv[4], '-e')  # the title, behind the separator
        self.assertEqual(argv.index('-e', 4), 4)  # no second `-e` option after it
        self.assertEqual(argv[4:], ['-e', 'In 10 minutes · 13:30', 'TSK-1'])

    def test_a_title_that_starts_with_a_dash(self):
        for title in ('-l JavaScript', '--version', '-s'):
            argv = self.argv_for(title)
            self.assertEqual(argv[3:], ['--', title, 'In 10 minutes · 13:30', 'TSK-1'], title)

    def test_a_normal_title_is_unchanged(self):
        argv = self.argv_for('Vet "Rex"')
        self.assertEqual(argv[3:], ['--', 'Vet "Rex"', 'In 10 minutes · 13:30', 'TSK-1'])
        self.assertIn('display notification', argv[2])
        self.assertNotIn('Rex', argv[2])  # the title is never inside the script

    def test_an_urgent_one_too(self):
        argv = self.argv_for('-e', urgent=True)
        self.assertEqual(argv[3:], ['--', '-e', 'In 10 minutes · 13:30\nTSK-1'])
        self.assertIn('display alert', argv[2])


class PickFolderTest(unittest.TestCase):
    """`pick_folder`: the dialog's prompt comes in on the request, and under `-l JavaScript` the argument after a
    `-e` would be *evaluated*, so the prompt is the one that matters here."""

    def argv_for(self, prompt, start):
        calls = _calls_of(lambda: server.pick_folder(start=start, prompt=prompt))
        self.assertEqual(len(calls), 1)
        return calls[0]

    def test_a_prompt_of_dash_e_is_a_value(self):
        with tempfile.TemporaryDirectory() as d:
            argv = self.argv_for('-e', d)
        self.assertEqual(argv[:4], ['osascript', '-l', 'JavaScript', '-e'])
        self.assertEqual(argv[5], '--')
        self.assertEqual(argv[6], '-e')  # the prompt, a value and not another option
        self.assertEqual(len(argv), 8)  # and nothing else: the script, the separator, the prompt, the folder

    def test_a_prompt_that_starts_with_a_dash_and_a_normal_one(self):
        with tempfile.TemporaryDirectory() as d:
            for prompt, kept in (('-rf', '-rf'), ('Choose a vault', 'Choose a vault')):
                argv = self.argv_for(prompt, d)
                self.assertEqual(argv[5], '--')
                self.assertEqual(argv[6], kept)
                self.assertEqual(argv[7], d)


class DefaultAppTest(unittest.TestCase):
    """`default_app`'s probe: a path cannot start with `-`, but it goes behind the separator with everything else."""

    def test_the_path_goes_behind_the_separator(self):
        server._opener_cache.clear()
        self.addCleanup(server._opener_cache.clear)
        calls = _calls_of(lambda: server.default_app('/tmp/a file.md'))
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][:4], ['osascript', '-l', 'JavaScript', '-e'])
        self.assertEqual(calls[0][5:], ['--', '/tmp/a file.md'])


if __name__ == '__main__':
    unittest.main()
