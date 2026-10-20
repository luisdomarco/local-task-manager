"""Types a vault turns off (Settings → Vaults, disabled_types): hidden from everything the app shows, creates and
links, while their files stay on disk, untouched and valid, and come back when turned on again."""
import contextlib
import hashlib
import io
import json
import os
import tempfile
import unittest
from unittest import mock

import server
from tm import frontmatter as fm
from tm.store import DEFAULT_FOLDERS, Store, StoreError
from tm.structures import REGISTRY


def tree_hash(root):
    h = hashlib.sha256()
    for dirpath, dirnames, filenames in sorted(os.walk(root)):
        dirnames.sort()
        for name in sorted(filenames):
            path = os.path.join(dirpath, name)
            if '.task-manager' in path:
                continue
            h.update(os.path.relpath(path, root).encode())
            with open(path, 'rb') as f:
                h.update(f.read())
    return h.hexdigest()


class FolderPerTypeToggleTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for folder in DEFAULT_FOLDERS.values():
            os.makedirs(os.path.join(self.root, folder))
        full = Store(self.root)
        self.task = full.create('task', 'Ship it')
        self.note = full.create('note', 'Why we ship', {'related_to': self.task['id']})
        self.meeting = full.create('meeting', 'Kick-off', {'related_to': self.task['id']})
        self.before = tree_hash(self.root)
        self.s = Store(self.root, enforce_structure=True, disabled_types=['note', 'meeting'])

    def test_hidden_from_everything_the_app_shows(self):
        self.assertEqual({i['type'] for i in self.s.items()}, {'task'})
        with self.assertRaises(StoreError):
            self.s.read(self.note['id'])
        public = self.s.structure.public()
        names = [t['name'] for t in public['types']]
        self.assertNotIn('note', names)
        self.assertNotIn('meeting', names)
        self.assertFalse(any('note' in t['parents'] or 'meeting' in t['parents'] for t in public['types']))
        self.assertEqual(public['disabled_types'], ['meeting', 'note'])

    def test_not_created_nor_linked(self):
        with self.assertRaises(StoreError) as cm:
            self.s.create('note', 'No')
        self.assertIn('turned off', str(cm.exception))
        with self.assertRaises(StoreError):
            self.s.update(self.task['id'], {'relations': [self.note['id']]})
        inbox = self.s.create('inbox', 'Capture')
        with self.assertRaises(StoreError) as cm:
            self.s.convert(inbox['key'], 'note')
        self.assertIn('turned off', str(cm.exception))

    def test_files_stay_valid_and_untouched(self):
        self.assertTrue(self.s.check()['ok'])  # a note on disk is not a mismatch: never read-only for it
        self.s.update(self.task['id'], {'status': 'Done'})
        after = tree_hash(self.root)
        self.assertNotEqual(after, self.before)  # the task changed…
        with open(os.path.join(self.root, self.note['path']), encoding='utf-8') as f:
            self.assertEqual(fm.parse(fm.split(f.read())[0])['related_to'], self.task['id'])  # …the hidden note did not

    def test_turned_on_again_everything_is_back(self):
        again = Store(self.root)
        self.assertEqual({i['id'] for i in again.items()}, {self.task['id'], self.note['id'], self.meeting['id']})
        self.assertEqual(tree_hash(self.root), self.before)  # turning off and on wrote nothing

    def test_hidden_ids_are_never_handed_out_again(self):
        self.assertIn(self.note['id'], self.s._hidden_ids())

    def test_a_delete_unlinks_hidden_children_and_a_restore_relinks_them(self):
        out = self.s.delete(self.task['id'])
        with open(os.path.join(self.root, self.note['path']), encoding='utf-8') as f:
            self.assertIsNone(fm.parse(fm.split(f.read())[0]).get('related_to'))
        self.assertEqual(out['unlinked'], 2)
        self.s.restore(out['trashed'], out['restore_to'])
        with open(os.path.join(self.root, self.note['path']), encoding='utf-8') as f:
            self.assertEqual(fm.parse(fm.split(f.read())[0])['related_to'], self.task['id'])


class TicketingToggleTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for d in ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log'):
            os.makedirs(os.path.join(self.root, d))
        full = Store(self.root, structure='ticketing')
        full.create('project', 'Acme Web', {'project_key': 'ECD', 'project_kind': 'product'})
        self.sup = full.create('support', 'Algo', {'project': 'ECD'})

    def test_the_project_cannot_be_turned_off(self):
        s = Store(self.root, structure='ticketing', disabled_types=['project'])
        self.assertIn('project', s.structure.types)

    def test_promote_and_escalate_need_their_type(self):
        s = Store(self.root, structure='ticketing', enforce_structure=True, disabled_types=['initiative', 'hotfix'])
        for action in ('promote', 'escalate'):
            with self.subTest(action), self.assertRaises(StoreError) as cm:
                s.item_action(action, self.sup['id'])
            self.assertIn('turned off', str(cm.exception))
        props = {p['key'] for p in s.structure.types['support'].props}
        self.assertNotIn('promoted_to', props)  # a link to a type that is off: not offered
        self.assertNotIn('escalated_to', props)
        self.assertTrue(s.check()['ok'])


class ConfigTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.a = os.path.join(tmp.name, 'a')
        for folder in DEFAULT_FOLDERS.values():
            os.makedirs(os.path.join(self.a, folder))
        self.cfg = os.path.join(tmp.name, 'config.json')
        with open(self.cfg, 'w', encoding='utf-8') as f:
            json.dump({'root': self.a, 'vaults': [{'id': 'a', 'name': 'A', 'path': self.a, 'structure': 'folders'}], 'default_vault': 'a'}, f)
        patcher = mock.patch.object(server, 'CONFIG_PATH', self.cfg)
        patcher.start()
        self.addCleanup(patcher.stop)
        quiet = contextlib.redirect_stdout(io.StringIO())
        quiet.__enter__()
        self.addCleanup(quiet.__exit__, None, None, None)

    def test_saved_and_applied_to_the_vault_store(self):
        app = server.App()
        app.set_config({'vaults': [{'id': 'a', 'name': 'A', 'path': self.a, 'structure': 'folders', 'disabled_types': ['note', 'story']}],
                        'default_vault': 'a'})
        self.assertEqual(app.config['vaults'][0]['disabled_types'], ['story', 'note'])  # in the structure's order
        self.assertNotIn('note', app.store_for('a').structure.types)
        self.assertIn('note', app.store_for('a').full_structure.types)

    def test_bad_lists_are_refused(self):
        app = server.App()
        everything = list(REGISTRY['folders'].types)
        for bad in (['nope'], everything):
            with self.subTest(bad), self.assertRaises(StoreError):
                app.set_config({'vaults': [{'id': 'a', 'name': 'A', 'path': self.a, 'structure': 'folders', 'disabled_types': bad}],
                                'default_vault': 'a'})
        tickets = os.path.join(os.path.dirname(self.a), 't')
        os.makedirs(tickets)
        with self.assertRaises(StoreError):
            app.set_config({'vaults': [{'id': 'a', 'name': 'A', 'path': self.a, 'structure': 'folders'},
                                       {'id': 't', 'name': 'T', 'path': tickets, 'structure': 'ticketing', 'disabled_types': ['project']}],
                            'default_vault': 'a'})


if __name__ == '__main__':
    unittest.main()
