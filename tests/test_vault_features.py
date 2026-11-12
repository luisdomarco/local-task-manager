"""Features a vault turns off as a whole (Settings → Vaults → Features, tm/vaultsettings.py FEATURES): kept in the vault
with its types, they take their item types with them, their routes refuse the vault's requests, and nothing on disk
is touched: turned on again, everything is back."""
import contextlib
import io
import json
import os
import tempfile
import unittest
from unittest import mock

import server
from tm import vaultsettings
from tm.store import DEFAULT_FOLDERS, StoreError

TICKET_FOLDERS = ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log')


class Base(unittest.TestCase):
    structure = 'folders'

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = tmp.name
        self.a = os.path.join(tmp.name, 'a')
        folders = DEFAULT_FOLDERS.values() if self.structure == 'folders' else TICKET_FOLDERS
        for folder in folders:
            os.makedirs(os.path.join(self.a, folder))
        self.cfg = os.path.join(tmp.name, 'config.json')
        with open(self.cfg, 'w', encoding='utf-8') as f:
            json.dump({'root': self.a, 'vaults': [{'id': 'a', 'name': 'A', 'path': self.a, 'structure': self.structure}],
                       'default_vault': 'a'}, f)
        patcher = mock.patch.object(server, 'CONFIG_PATH', self.cfg)
        patcher.start()
        self.addCleanup(patcher.stop)
        quiet = contextlib.redirect_stdout(io.StringIO())
        quiet.__enter__()
        self.addCleanup(quiet.__exit__, None, None, None)
        self.app = server.App()

    def saved(self):
        with open(vaultsettings.path(self.a), encoding='utf-8') as f:
            return json.load(f)

    def vault(self):
        return self.app.public_config()['vaults'][0]


class SaveTest(Base):
    def test_kept_in_the_vault_and_its_types_go_with_it(self):
        out = self.app.set_vault_settings('a', {'disabled_features': ['meetings', 'graph']})
        self.assertEqual(out['settings']['disabled_features'], ['graph', 'meetings'])  # in FEATURES' order
        self.assertEqual(self.saved()['disabled_features'], ['graph', 'meetings'])
        types = self.app.store_for('a').structure.types
        self.assertNotIn('meeting', types)
        self.assertNotIn('transcription', types)
        self.assertEqual(self.vault()['disabled_types'], [])  # Item types keeps its own list: the feature hides them
        self.assertEqual(self.vault()['features_off'], ['graph', 'meetings'])
        with open(self.cfg, encoding='utf-8') as f:
            self.assertNotIn('disabled_features', json.dumps(json.load(f)))  # never config.json

    def test_refused(self):
        for bad in (['nope'], 'graph'):
            with self.subTest(bad), self.assertRaises(StoreError):
                self.app.set_vault_settings('a', {'disabled_features': bad})
        self.assertFalse(os.path.exists(vaultsettings.path(self.a)))

    def test_a_config_save_keeps_features_out_of_config_json(self):
        self.app.set_vault_settings('a', {'disabled_features': ['contacts']})
        self.app.set_config({'vaults': self.app.config['vaults'], 'default_vault': 'a'})
        self.app.set_config({'editor_app': 'Cursor'})  # a save without the vault list
        with open(self.cfg, encoding='utf-8') as f:
            text = f.read()
        self.assertNotIn('disabled_features', text)
        self.assertNotIn('features_off', text)
        self.assertEqual(self.vault()['features_off'], ['contacts'])

    def test_a_feature_follows_its_types_when_all_are_off(self):
        self.app.set_vault_settings('a', {'disabled_types': ['activity']})
        self.assertIn('activity', self.vault()['features_off'])  # the Activity tab goes with the Activity type
        self.app.set_vault_settings('a', {'disabled_types': ['meeting']})
        self.assertNotIn('meetings', self.vault()['features_off'])  # transcriptions are still on

    def test_turned_on_again_everything_is_back(self):
        store = self.app.store_for('a')
        meeting = store.create('meeting', 'Kick-off')
        self.app.set_vault_settings('a', {'disabled_features': ['meetings']})
        with self.assertRaises(StoreError):
            self.app.store_for('a').read(meeting['id'])
        self.app.set_vault_settings('a', {'disabled_features': []})
        self.assertEqual(self.app.store_for('a').read(meeting['id'])['title'], 'Kick-off')

    def test_another_device_sees_the_same(self):
        self.app.set_vault_settings('a', {'disabled_features': ['inbox']})
        phone = os.path.join(self.tmp, 'phone.json')
        with open(phone, 'w', encoding='utf-8') as f:
            json.dump({'root': self.a, 'vaults': [{'id': 'p', 'name': 'P', 'path': self.a, 'structure': 'folders'}],
                       'default_vault': 'p'}, f)
        with mock.patch.object(server, 'CONFIG_PATH', phone):
            self.assertEqual(server.App().public_config()['vaults'][0]['features_off'], ['inbox'])



class RouteTest(Base):
    structure = 'ticketing'

    def test_the_routes_of_a_feature_turned_off_refuse(self):
        self.app.set_vault_settings('a', {'disabled_features': ['graph', 'worklog', 'contacts', 'activity', 'agents']})
        store = self.app.store_for('a')
        for path in ('/api/graph', '/api/worklog', '/api/worklog/confirm', '/api/people', '/api/groups/update',
                     '/api/item/comment', '/api/item/history', '/api/item/claude', '/api/claude/sessions'):
            with self.subTest(path):
                self.assertIn('turned off in this vault', server.feature_refused(store, path))
        for path in ('/api/items', '/api/graphs', '/api/canvases', '/api/agents/runs'):
            with self.subTest(path):
                self.assertIsNone(server.feature_refused(store, path))

    def test_a_store_from_before_features_refuses_nothing(self):
        class Bare:
            pass
        self.assertIsNone(server.feature_refused(Bare(), '/api/graph'))

    def test_the_page_is_told_what_each_feature_hides(self):
        features = self.app.public_config()['vault_features']
        self.assertEqual([f['id'] for f in features], list(vaultsettings.FEATURE_IDS))
        self.assertEqual(next(f for f in features if f['id'] == 'goals')['types'], ['goal'])

    def test_goals_off_takes_the_goal_type_and_its_field(self):
        self.app.set_vault_settings('a', {'disabled_features': ['goals']})
        s = self.app.store_for('a').structure
        self.assertNotIn('goal', s.types)
        self.assertFalse(any(p.get('key') == 'goal' for t in s.types.values() for p in (t.props or ())))


if __name__ == '__main__':
    unittest.main()
