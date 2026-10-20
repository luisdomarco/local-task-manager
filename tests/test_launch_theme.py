import json
import os
import tempfile
import unittest
from unittest import mock

from tm.launch import claude_theme, session_updated


class ClaudeThemeTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.home, '.claude'))
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        os.environ.pop('CLAUDE_CONFIG_DIR', None)

    def tearDown(self):
        self.env.stop()

    def write(self, rel, data):
        with open(os.path.join(self.home, rel), 'w', encoding='utf-8') as f:
            f.write(data if isinstance(data, str) else json.dumps(data))

    def test_dark_unless_set_otherwise(self):
        self.assertEqual(claude_theme(self.home), 'dark')
        self.write('.claude/settings.json', '{not json')
        self.assertEqual(claude_theme(self.home), 'dark')

    def test_settings_first_then_claude_json(self):
        self.write('.claude.json', {'theme': 'light'})
        self.assertEqual(claude_theme(self.home), 'light')
        self.write('.claude/settings.json', {'theme': 'dark-daltonized'})
        self.assertEqual(claude_theme(self.home), 'dark')
        self.write('.claude/settings.json', {'theme': 'light-ansi'})
        self.assertEqual(claude_theme(self.home), 'light')

    def test_claude_config_dir(self):
        other = tempfile.mkdtemp()
        with open(os.path.join(other, 'settings.json'), 'w', encoding='utf-8') as f:
            json.dump({'theme': 'light'}, f)
        os.environ['CLAUDE_CONFIG_DIR'] = other
        self.assertEqual(claude_theme(self.home), 'light')


    def test_session_updated_reads_the_transcript(self):
        sid = '3f0afa44-5be9-45c0-9980-4f7bbcd75d91'
        folder = os.path.join(self.home, '.claude', 'projects', '-Users-me-work-app-x')
        os.makedirs(folder)
        path = os.path.join(folder, f'{sid}.jsonl')
        self.write(os.path.relpath(path, self.home), '{}')
        os.utime(path, (1792140000, 1792140000))
        self.assertRegex(session_updated(sid, '/Users/me/work/app.x', self.home), r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$')
        self.assertIsNotNone(session_updated(sid, '/somewhere/else', self.home))  # found in another project too
        self.assertIsNone(session_updated('df89fc12-c48f-4dbe-ab20-2059e03d2af9', '/Users/me/work/app.x', self.home))
        self.assertIsNone(session_updated('../../etc/passwd', '/x', self.home))


if __name__ == '__main__':
    unittest.main()
