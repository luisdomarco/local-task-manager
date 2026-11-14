"""tools/bookmarks_to_base.py: a hand-written bookmarks index → the `category` its notes lack and a .base that lists them
(on a temp vault only: the real one is the owner's to run it on)."""
import contextlib
import io
import os
import sys
import tempfile
import unittest
from unittest import mock

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(APP_DIR, 'tools'))
import bookmarks_to_base as b2b  # noqa: E402
from tm import bases  # noqa: E402
from tm.store import Store  # noqa: E402

INDEX = '''# Bookmarks

## 🧰 Repos
- [[Ruff]] - https://github.com/astral-sh/ruff
- [[uv|the uv tool]] - https://github.com/astral-sh/uv

## Podcasts
- [[Ship It]] - https://changelog.com/shipit
- [[Missing note]] - https://nowhere.example

## AI
- [[Claude Code]] - https://claude.com
- [[Ruff]] - listed twice

```dataview
TABLE url FROM "Bookmarks"
```
'''
NOTES = {
    'Bookmarks/Ruff.md': '---\nfileClass: Bookmarks\nurl: https://github.com/astral-sh/ruff\n---\n# Ruff\n',
    'Bookmarks/uv.md': '---\nfileClass: Bookmarks   # what it is\nurl: https://github.com/astral-sh/uv\ntags: [python]\n---\nuv.\n',
    'Bookmarks/Ship It.md': '---\nfileClass: Bookmarks\ncategory: Podcasts\n---\n',
    'Bookmarks/Claude Code.md': '---\nfileClass: Bookmarks\ncategory: Tools\n---\nBody.\n',
}


class BookmarksToBase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        env = mock.patch.dict(os.environ, {'TM_CACHE_DIR': os.path.join(self.root, '.cache')})
        env.start()
        self.addCleanup(env.stop)
        for rel, text in {**NOTES, '00 Index Bookmarks.md': INDEX}.items():
            os.makedirs(os.path.dirname(os.path.join(self.root, rel)), exist_ok=True)
            with open(os.path.join(self.root, rel), 'w', encoding='utf-8') as f:
                f.write(text)

    def read(self, rel):
        with open(os.path.join(self.root, rel), encoding='utf-8') as f:
            return f.read()

    def run_tool(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            b2b.main(['-C', self.root, *args])
        return out.getvalue()

    def test_a_dry_run_writes_nothing(self):
        out = self.run_tool()
        self.assertIn('Bookmarks/uv.md  →  Repos', out)
        self.assertIn('Bookmarks/Claude Code.md: has "Tools", listed under "AI"', out)
        self.assertIn('Bookmarks/Ruff.md: Repos, AI', out)
        self.assertIn('[[Missing note]] under Podcasts', out)
        self.assertIn('1 Dataview block', out)
        self.assertEqual(self.read('Bookmarks/uv.md'), NOTES['Bookmarks/uv.md'])
        self.assertFalse(os.path.exists(os.path.join(self.root, '00 Index Bookmarks.base')))

    def test_apply_writes_only_category_and_a_base_that_reads(self):
        self.run_tool('--apply')
        self.assertEqual(self.read('Bookmarks/uv.md'), NOTES['Bookmarks/uv.md'].replace('tags: [python]\n', 'tags: [python]\ncategory: Repos\n'))
        for rel in ('Bookmarks/Ruff.md', 'Bookmarks/Ship It.md', 'Bookmarks/Claude Code.md'):
            self.assertEqual(self.read(rel), NOTES[rel])  # twice, already right, differs: left as they are
        self.assertEqual(self.read('00 Index Bookmarks.md'), INDEX)
        s = Store(self.root, structure='ticketing')
        out = s.base('00 Index Bookmarks.base')
        self.assertEqual([v['name'] for v in out['views']], ['All', 'Repos', 'Podcasts'])
        self.assertEqual([g['label'] for g in out['groups']], ['Podcasts', 'Repos', 'Tools', None])
        repos = s.base('00 Index Bookmarks.base', 'Repos')
        self.assertEqual([r['path'] for r in repos['rows']], ['Bookmarks/uv.md'])
        with self.assertRaises(SystemExit):
            self.run_tool('--apply')  # the base is there: not overwritten without --force
        self.run_tool('--apply', '--force')

    def test_the_base_parses_as_yaml(self):
        p = b2b.plan(self.root, '00 Index Bookmarks.md')
        data = bases.parse_yaml(b2b.base_text('00 Index Bookmarks.md', p))
        self.assertEqual(data['filters'], {'and': ['fileClass == "Bookmarks"']})
        self.assertEqual(data['views'][1]['filters'], 'category == "Repos"')


if __name__ == '__main__':
    unittest.main()
