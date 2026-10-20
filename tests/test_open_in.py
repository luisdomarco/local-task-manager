"""Open in ▾ (TSK-038): the commands and URLs that hand a Claude session to Claude Desktop, Cursor or Antigravity,
and which of them this Mac offers."""
import unittest
from unittest import mock
from urllib.parse import parse_qs, urlsplit

import server
from tm.launch import desktop_new_url, desktop_resume_flags, ide_open_url

SID = '0f1e2d3c-4b5a-4978-8a6b-1234567890ab'
NASTY = 'Fix "it" & ship #2\nthen $(rm -rf ~) 100%'


class OpenInTest(unittest.TestCase):
    def test_desktop_resumes_through_the_cli(self):
        self.assertEqual(desktop_resume_flags(SID), ['--desktop', '--resume', SID])
        with self.assertRaises(ValueError):
            desktop_resume_flags('x; rm -rf ~')

    def test_a_new_desktop_session_carries_folder_and_prompt_as_one_value_each(self):
        url = desktop_new_url('/Users/me/my repo', NASTY)
        self.assertTrue(url.startswith('claude://code/new?'))
        q = parse_qs(urlsplit(url).query)
        self.assertEqual((q['folder'], q['q']), (['/Users/me/my repo'], [NASTY]))
        self.assertNotIn(' ', url)
        self.assertNotIn('\n', url)

    def test_the_ides_open_a_session_or_a_prompt_in_their_extension(self):
        self.assertEqual(ide_open_url('cursor', session=SID), f'cursor://anthropic.claude-code/open?session={SID}')
        url = ide_open_url('antigravity', prompt=NASTY)
        self.assertTrue(url.startswith('antigravity://anthropic.claude-code/open?prompt='))
        self.assertEqual(parse_qs(urlsplit(url).query)['prompt'], [NASTY])
        self.assertEqual(ide_open_url('cursor'), 'cursor://anthropic.claude-code/open')
        for bad in (dict(ide='vscode'), dict(ide='cursor', session='not-a-uuid')):
            with self.subTest(**bad), self.assertRaises(ValueError):
                ide_open_url(**bad)


class OpenTargetsTest(unittest.TestCase):
    """open_targets(): Terminal always, then each app whose bundle is installed — and only on a Mac."""

    def targets(self, platform, installed, terminal='iTerm'):
        with mock.patch.dict(server.APP.config, {'terminal': terminal}), \
                mock.patch.object(server.sys, 'platform', platform), \
                mock.patch.object(server.os.path, 'isdir', side_effect=lambda p: p in installed):
            return [(t['key'], t['label']) for t in server.open_targets()]

    def test_a_mac_offers_the_apps_it_has(self):
        self.assertEqual(self.targets('darwin', {'/Applications/Claude.app', '/Applications/Antigravity.app'}),
                         [('terminal', 'iTerm'), ('desktop', 'Claude Desktop'), ('antigravity', 'Antigravity')])
        everything = {path for _, _, path in server.OPEN_TARGETS.values()}
        self.assertEqual([k for k, _ in self.targets('darwin', everything)], ['terminal', 'desktop', 'cursor', 'antigravity'])
        self.assertEqual(self.targets('darwin', set(), terminal=''), [('terminal', 'Terminal')])

    def test_elsewhere_only_terminal_even_with_the_folders_there(self):
        everything = {path for _, _, path in server.OPEN_TARGETS.values()}
        self.assertEqual(self.targets('linux', everything), [('terminal', 'iTerm')])

    def test_a_target_this_mac_lacks_is_refused(self):
        with mock.patch.object(server, 'open_targets', return_value=[{'key': 'terminal', 'label': 'Terminal'}]):
            self.assertEqual(server._target(None), 'terminal')
            with self.assertRaises(server.StoreError) as e:
                server._target('cursor')
            self.assertEqual(e.exception.status, 400)


if __name__ == '__main__':
    unittest.main()
