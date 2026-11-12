"""The text a new item starts with, per type (Projects): the vault keeps its own in .task-manager/templates/<type>.md,
seeded once from tm/structures/ticketing/default_texts/, set in Settings → Vaults → Item types. A type with no text
starts empty; a new item's body never repeats its title nor ends in an empty `## Related`."""
import contextlib
import io
import json
import os
import tempfile
import unittest
from datetime import date
from unittest import mock

import server
from tm.store import Store, StoreError
from tm.structures.ticketing.codec import TicketingCodec

ROOT_FOLDERS = ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log')


def read(root, rel):
    with open(os.path.join(root, rel), encoding='utf-8') as f:
        return f.read()


def body_of(text):
    return text.split('\n---\n', 1)[1].strip('\n')


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for d in ROOT_FOLDERS:
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.p = self.s.create('project', 'Acme Web', {'project_key': 'ACME', 'project_kind': 'product'})
        self.folder = os.path.join(self.root, '.task-manager', 'templates')


class SeedTest(Base):
    def test_seeded_once_with_the_structures_texts(self):
        self.assertTrue(os.path.isdir(self.folder))  # the first item written seeded it
        seeds = TicketingCodec.default_texts()
        self.assertEqual(read(self.folder, 'story.md'), seeds['story'])
        self.assertFalse(os.path.exists(os.path.join(self.folder, 'task.md')))  # a task has none: it starts empty
        self.assertFalse(self.s.seed_default_texts())  # never again

    def test_no_seed_text_carries_a_title_or_an_empty_related(self):
        for t, text in TicketingCodec.default_texts().items():
            with self.subTest(t):
                self.assertNotIn('{{title}}', text)
                self.assertFalse(text.lstrip().startswith('# '), text[:40])
                self.assertNotIn('## Related', text)

    def test_an_emptied_or_deleted_text_never_comes_back(self):
        self.s.set_default_text('story', '')
        self.assertEqual(read(self.folder, 'story.md'), '')  # kept, empty: the structure's text stays out
        os.remove(os.path.join(self.folder, 'spec.md'))
        s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.assertFalse(s.seed_default_texts())
        self.assertEqual((s.default_text('story'), s.default_text('spec')), ('', ''))
        sty = s.create('story', 'Bare', {'project': 'ACME'})
        self.assertEqual(body_of(read(self.root, sty['path'])), '')

    def test_a_vault_with_ids_but_no_texts_is_seeded_at_its_next_write(self):
        # Such a vault is one from before default texts, or one whose folder a device has not downloaded yet: nothing
        # is written into it on open, only on a write that needs the texts.
        import shutil
        shutil.rmtree(self.folder)
        s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.assertFalse(os.path.isdir(self.folder))
        self.assertIn('## Acceptance criteria', s.default_text('story'))  # read: what it will be given
        self.assertFalse(os.path.isdir(self.folder))
        s.create('task', 'Write', {'project': 'ACME'})
        self.assertTrue(os.path.isdir(self.folder))


class CreateTest(Base):
    def test_none_is_the_types_text_and_an_empty_body_is_empty(self):
        sty = self.s.create('story', 'One page', {'project': 'ACME'})
        self.assertIn('## Acceptance criteria', read(self.root, sty['path']))
        bare = self.s.create('story', 'Nothing', {'project': 'ACME'}, body='')
        self.assertEqual(body_of(read(self.root, bare['path'])), '')
        task = self.s.create('task', 'Call', {'project': 'ACME'})
        self.assertEqual(body_of(read(self.root, task['path'])), '')

    def test_the_vaults_text_is_used_with_its_placeholders_filled(self):
        self.s.set_default_text('task', '## Why\n\n{{ref}} in {{project}}, {{date}}. {{unknown}}')
        task = self.s.create('task', 'Call', {'project': 'ACME'})
        self.assertEqual(body_of(read(self.root, task['path'])),
                         f"## Why\n\n{task['ref']} in Acme Web, {date.today().isoformat()}. {{{{unknown}}}}")

    def test_set_default_text_refuses_what_it_cannot_keep(self):
        for t, text in (('nope', 'x'), ('task', None), ('task', 3)):
            with self.subTest(t=t, text=text), self.assertRaises(StoreError):
                self.s.set_default_text(t, text)
        legacy = tempfile.TemporaryDirectory()
        self.addCleanup(legacy.cleanup)
        with self.assertRaises(StoreError):
            Store(legacy.name, structure='tasks').set_default_text('task', 'x')
        self.assertEqual(Store(legacy.name, structure='tasks').default_texts(), {})

    def test_a_converted_inbox_item_keeps_what_was_captured_then_the_text(self):
        self.s.set_default_text('task', '## Steps')
        inbox = self.s.create('inbox', 'Idea', {}, body='Ask Ana first.')
        task = self.s.convert(inbox['key'], 'task', {'project': 'ACME'})
        self.assertEqual(body_of(read(self.root, task['path'])), 'Ask Ana first.\n\n## Steps')


class RouteTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.a = os.path.join(tmp.name, 'a')
        for d in ROOT_FOLDERS:
            os.makedirs(os.path.join(self.a, d))
        cfg = os.path.join(tmp.name, 'config.json')
        with open(cfg, 'w', encoding='utf-8') as f:
            json.dump({'root': self.a, 'vaults': [{'id': 'a', 'name': 'A', 'path': self.a, 'structure': 'ticketing'}],
                       'default_vault': 'a'}, f)
        patcher = mock.patch.object(server, 'CONFIG_PATH', cfg)
        patcher.start()
        self.addCleanup(patcher.stop)
        quiet = contextlib.redirect_stdout(io.StringIO())
        quiet.__enter__()
        self.addCleanup(quiet.__exit__, None, None, None)
        self.app = server.App()
        self.s = self.app.store_for('a')

    def route(self, method, path, body=None):
        return server.ROUTES[(method, path)](self.s, {}, body or {})

    def test_read_and_set_through_the_routes(self):
        out = self.route('GET', '/api/vault/default-texts')
        self.assertTrue(out['editable'])
        self.assertIn('ref', out['placeholders'])
        self.assertIn('## Acceptance criteria', out['texts']['story'])
        self.assertEqual(out['texts']['task'], '')
        out = self.route('POST', '/api/vault/default-text', {'type': 'task', 'text': '## Notes\r\n'})
        self.assertEqual(out['texts']['task'], '## Notes\n')

    def test_the_server_seeds_a_vault_once_at_start(self):
        self.assertTrue(self.s.check()['ok'], self.s.check())
        server.App.migrate(self.s)
        self.assertTrue(os.path.isdir(os.path.join(self.a, '.task-manager', 'templates')))


if __name__ == '__main__':
    unittest.main()
