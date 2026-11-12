"""Several vaults: the config, which vault a request reaches, and that no vault loses or gains a byte it should not."""
import contextlib
import hashlib
import io
import json
import os
import shutil
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server
from tm.store import DEFAULT_FOLDERS, Store
from tm.structures.folders import FOLDER_PER_TYPE


def make_vault(root, *, folders=DEFAULT_FOLDERS):
    os.makedirs(root, exist_ok=True)
    for folder in folders.values():
        os.makedirs(os.path.join(root, folder), exist_ok=True)
    return root


def tree_hash(root):
    """One hash over every file (path and bytes) and every folder under `root`, hidden ones included."""
    h = hashlib.sha256()
    for dirpath, dirnames, filenames in sorted(os.walk(root)):
        dirnames.sort()
        h.update(os.path.relpath(dirpath, root).encode())
        for name in sorted(filenames):
            path = os.path.join(dirpath, name)
            h.update(name.encode())
            with open(path, 'rb') as f:
                h.update(f.read())
    return h.hexdigest()


class VaultsBase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = tmp.name
        self.a = make_vault(os.path.join(self.tmp, 'a'))
        self.b = make_vault(os.path.join(self.tmp, 'b'))
        self.cfg = os.path.join(self.tmp, 'config.json')
        patcher = mock.patch.object(server, 'CONFIG_PATH', self.cfg)
        patcher.start()
        self.addCleanup(patcher.stop)
        quiet = contextlib.redirect_stdout(io.StringIO())
        quiet.__enter__()
        self.addCleanup(quiet.__exit__, None, None, None)

    def write_config(self, data):
        with open(self.cfg, 'w', encoding='utf-8') as f:
            json.dump(data, f)

    def two_vaults(self):
        self.write_config({'root': self.a, 'default_vault': 'a', 'vaults': [
            {'id': 'a', 'name': 'A', 'path': self.a, 'structure': 'folders'},
            {'id': 'b', 'name': 'B', 'path': self.b, 'structure': 'folders'}]})
        return server.App()


class ConfigTest(VaultsBase):
    def test_an_old_config_becomes_one_vault_in_memory_only(self):
        self.write_config({'root': self.a, 'folders': {'task': 'tasks'}})
        with open(self.cfg, 'rb') as f:
            before = f.read()
        app = server.App()
        self.assertEqual([(v['id'], v['path'], v['structure']) for v in app.config['vaults']], [('folders', self.a, 'folders')])
        self.assertEqual(app.config['default_vault'], 'folders')
        self.assertEqual(app.store.root, os.path.realpath(self.a))
        with open(self.cfg, 'rb') as f:
            self.assertEqual(f.read(), before)  # nothing written until a save
        self.assertFalse(os.path.exists(os.path.join(self.tmp, 'backups')))

    def test_the_first_save_keeps_a_copy_and_root_follows_the_default(self):
        self.write_config({'root': self.a})
        app = server.App()
        app.set_config({'vaults': [{'id': 'folders', 'name': 'Folders', 'path': self.a, 'structure': 'folders'},
                                   {'name': 'Second one', 'path': self.b, 'structure': 'folders'}],
                        'default_vault': 'folders'})
        self.assertEqual([n for n in os.listdir(self.tmp) if n.startswith('config.json.bak')], [])  # not next to it
        backups = [n for n in os.listdir(os.path.join(self.tmp, 'backups')) if n.startswith('config.json.bak-')]
        self.assertEqual(len(backups), 1)
        with open(os.path.join(self.tmp, 'backups', backups[0]), encoding='utf-8') as f:
            self.assertEqual(json.load(f), {'root': self.a})
        with open(self.cfg, encoding='utf-8') as f:
            saved = json.load(f)
        self.assertEqual([v['id'] for v in saved['vaults']], ['folders', 'second-one'])  # a new vault gets an id from its name
        app.set_config({'vaults': saved['vaults'], 'default_vault': 'second-one'})
        with open(self.cfg, encoding='utf-8') as f:
            self.assertEqual(json.load(f)['root'], self.b)  # the tools keep reading `root`
        self.assertEqual(len(os.listdir(os.path.join(self.tmp, 'backups'))), 1)  # only the first time

    def test_bad_vault_lists_are_refused(self):
        app = self.two_vaults()
        inner = make_vault(os.path.join(self.a, 'inner'))
        cases = {
            'empty': [],
            'missing folder': [{'id': 'a', 'name': 'A', 'path': os.path.join(self.tmp, 'nope')}],
            'the disk': [{'id': 'a', 'name': 'A', 'path': '/'}],
            'home': [{'id': 'a', 'name': 'A', 'path': '~'}],
            'overlap': [{'id': 'a', 'name': 'A', 'path': self.a}, {'id': 'i', 'name': 'I', 'path': inner}],
            'same folder': [{'id': 'a', 'name': 'A', 'path': self.a}, {'id': 'c', 'name': 'C', 'path': self.a + '/'}],
            'unknown structure': [{'id': 'a', 'name': 'A', 'path': self.a, 'structure': 'nope'}],
            'two ids': [{'id': 'a', 'name': 'A', 'path': self.a}, {'id': 'a', 'name': 'B', 'path': self.b}],
            'no name': [{'id': 'a', 'name': ' ', 'path': self.a}],
        }
        with open(self.cfg, 'rb') as f:
            before = f.read()
        for what, vaults in cases.items():
            with self.subTest(what), self.assertRaises(server.StoreError) as cm:
                app.set_config({'vaults': vaults, 'default_vault': 'a'})
            self.assertEqual(cm.exception.status, 400)
        with open(self.cfg, 'rb') as f:
            self.assertEqual(f.read(), before)  # nothing saved by a refused change

    def test_a_vault_whose_folder_is_gone_does_not_block_saving_the_rest(self):
        app = self.two_vaults()
        shutil.rmtree(self.b)  # moved or deleted outside the app
        self.assertEqual([(v['id'], v['missing']) for v in app.public_config()['vaults']], [('a', False), ('b', True)])
        vaults = app.public_config()['vaults']  # Settings sends back what it was given, `missing` and all
        app.set_config({'vaults': vaults, 'default_vault': 'a', 'work_kinds': ['Coding']})  # an unrelated change saves
        self.assertEqual(app.config['work_kinds'], ['Coding'])
        self.assertEqual([(v['id'], v['path']) for v in app.config['vaults']], [('a', self.a), ('b', self.b)])  # kept as it was
        self.assertNotIn('missing', json.dumps(app.config))  # said to the page, never written
        gone = os.path.join(self.tmp, 'gone')
        for what, more in (('a new vault', {'name': 'New', 'path': gone}), ('a vault moved to nowhere', {'id': 'b', 'name': 'B', 'path': gone})):
            with self.subTest(what), self.assertRaises(server.StoreError) as cm:
                app.set_config({'vaults': [vaults[0], more], 'default_vault': 'a'})
            self.assertIn('not a directory', str(cm.exception))
        with self.assertRaises(server.StoreError):  # the default must be there: the page opens it
            app.set_config({'vaults': vaults, 'default_vault': 'b'})
        app.set_config({'vaults': vaults[:1], 'default_vault': 'a'})  # removing it saves too
        self.assertEqual([v['id'] for v in app.config['vaults']], ['a'])

    def test_removing_a_vault_touches_none_of_its_files(self):
        app = self.two_vaults()
        app.store_for('b').create('note', 'Keep me')
        before = tree_hash(self.b)
        app.set_config({'vaults': [{'id': 'a', 'name': 'A', 'path': self.a}], 'default_vault': 'a'})
        self.assertEqual([v['id'] for v in app.config['vaults']], ['a'])
        self.assertEqual(tree_hash(self.b), before)
        with self.assertRaises(server.StoreError) as cm:
            app.store_for('b')
        self.assertEqual(cm.exception.status, 404)

    def test_migration_never_runs_on_a_vault_that_does_not_match(self):
        legacy = os.path.join(self.tmp, 'legacy')
        Store(legacy).create('initiative', 'Legacy', {'user_stories': [{'id': 'US-1', 'subject': 'Old story'}]})
        os.makedirs(os.path.join(legacy, 'Tickets'))  # a folder the structure does not have
        make_vault(legacy)
        before = tree_hash(legacy)
        server.App.migrate(Store(legacy, enforce_structure=True))
        self.assertEqual(tree_hash(legacy), before)


class LegacyStructuresTest(VaultsBase):
    """Projects is the structure a new vault gets; Initiatives and Tasks stay for the folders that already are theirs."""

    def test_what_a_config_that_names_no_structure_meant_is_kept(self):
        self.write_config({'root': self.a, 'default_vault': 'old', 'vaults': [{'id': 'old', 'name': 'Old', 'path': self.a}]})
        self.assertEqual(server.load_config()['vaults'][0]['structure'], 'folders')  # saved before structures were picked
        self.write_config({'root': self.a})
        self.assertEqual(server.load_config()['vaults'][0]['structure'], 'folders')  # a root from before vaults
        os.remove(self.cfg)
        cfg = server.load_config()  # no config at all: the bundled sample, a Projects vault
        self.assertEqual([(v['path'], v['structure']) for v in cfg['vaults']], [('sample-vault', 'ticketing')])

    def test_the_page_is_told_which_structures_are_legacy(self):
        self.write_config({'root': self.a, 'vaults': [{'id': 'a', 'name': 'A', 'path': self.a, 'structure': 'folders'}]})
        c = server.App().public_config()
        self.assertEqual((c['default_structure'], c['legacy_structures']), ('ticketing', ['folders', 'tasks']))
        self.assertEqual(c['structures'], {'folders': 'Initiatives', 'tasks': 'Tasks', 'ticketing': 'Projects'})

    def test_an_empty_folder_starts_a_projects_vault_never_a_legacy_one(self):
        self.write_config({'root': self.a, 'vaults': [{'id': 'a', 'name': 'A', 'path': self.a, 'structure': 'folders'}]})
        app = server.App()
        empty = os.path.join(self.tmp, 'empty')
        os.makedirs(os.path.join(empty, '.obsidian'))  # hidden files do not make it a vault
        for structure in ('folders', 'tasks'):
            with self.assertRaises(server.StoreError) as cm:
                app.set_config({'vaults': [app.config['vaults'][0], {'name': 'New', 'path': empty, 'structure': structure}]})
            self.assertIn('a new vault starts as Projects', str(cm.exception))
        self.assertEqual([v['id'] for v in app.config['vaults']], ['a'])  # nothing saved
        app.set_config({'vaults': [app.config['vaults'][0], {'name': 'New', 'path': empty}]})  # no structure: Projects
        self.assertEqual([v['structure'] for v in app.config['vaults']], ['folders', 'ticketing'])

    def test_a_folder_that_already_is_a_legacy_vault_can_still_be_added_and_kept(self):
        self.write_config({'root': self.a, 'vaults': [{'id': 'a', 'name': 'A', 'path': self.a, 'structure': 'folders'}]})
        app = server.App()
        Store(self.b).create('task', 'Already here')
        app.set_config({'vaults': [app.config['vaults'][0], {'name': 'Old one', 'path': self.b, 'structure': 'folders'}]})
        self.assertEqual([v['structure'] for v in app.config['vaults']], ['folders', 'folders'])
        # sent again without a structure (a tool, an older page), each keeps its own
        app.set_config({'vaults': [{k: x for k, x in v.items() if k != 'structure'} for v in app.config['vaults']]})
        self.assertEqual([v['structure'] for v in app.config['vaults']], ['folders', 'folders'])


    def test_a_folder_that_cannot_be_read_is_not_refused_as_empty(self):
        self.write_config({'root': self.a, 'vaults': [{'id': 'a', 'name': 'A', 'path': self.a, 'structure': 'folders'}]})
        app = server.App()
        locked = os.path.join(self.tmp, 'locked')
        os.makedirs(os.path.join(locked, 'tasks'))
        os.chmod(locked, 0)  # as iCloud is to a process macOS has not let in
        self.addCleanup(os.chmod, locked, 0o755)
        try:
            app.set_config({'vaults': [app.config['vaults'][0], {'name': 'Locked', 'path': locked, 'structure': 'folders'}]})
        except server.StoreError as e:
            self.assertNotIn('a new vault starts as Projects', str(e))


class OtherShapeTest(VaultsBase):
    """A folder that holds a vault of another structure: never saved as this one, and its notice says which it is."""

    def setUp(self):
        super().setUp()
        Store(self.b).create('task', 'A folder-per-type vault, full')  # b: a folder-per-type vault with something in it
        self.empty = os.path.join(self.tmp, 'empty')
        os.makedirs(self.empty)

    def crossed(self):
        # The Projects one first: its folder (another structure's vault) is what is refused, before the legacy one is
        # refused for its empty folder (a new vault starts as Projects).
        return [{'id': 'a', 'name': 'A', 'path': self.a, 'structure': 'folders'},
                {'name': 'Projects & Tickets', 'path': self.b, 'structure': 'ticketing'},
                {'name': 'Second folder vault', 'path': self.empty, 'structure': 'folders'}]

    def test_two_new_vaults_with_their_folders_swapped_are_refused(self):
        self.write_config({'root': self.a, 'vaults': [{'id': 'a', 'name': 'A', 'path': self.a, 'structure': 'folders'}], 'default_vault': 'a'})
        app = server.App()
        with open(self.cfg, 'rb') as f:
            before = f.read()
        with self.assertRaises(server.StoreError) as cm:
            app.set_config({'vaults': self.crossed(), 'default_vault': 'a'})
        self.assertIn('Initiatives', str(cm.exception))
        self.assertIn('Projects & Tickets', str(cm.exception))
        with open(self.cfg, 'rb') as f:
            self.assertEqual(f.read(), before)  # nothing saved
        right = [self.crossed()[0], {**self.crossed()[1], 'path': self.empty}, {**self.crossed()[2], 'path': self.b}]
        app.set_config({'vaults': right, 'default_vault': 'a'})  # the right way round: an empty folder starts a Projects vault
        self.assertEqual([v['structure'] for v in app.config['vaults']], ['folders', 'ticketing', 'folders'])

    def test_a_vault_already_saved_that_way_does_not_block_other_saves_and_its_notice_says_why(self):
        crossed = [{**v, 'id': v.get('id') or ('x' if v['structure'] == 'folders' else 'y')} for v in self.crossed()]
        self.write_config({'root': self.a, 'vaults': crossed, 'default_vault': 'a'})  # as written before this check existed
        app = server.App()
        patch = mock.patch.object(server, 'APP', app)  # vault_status names the vault through the app
        patch.start()
        self.addCleanup(patch.stop)  # not enterContext: that is Python 3.11+, and the stock macOS python3 is 3.9
        app.set_config({'work_kinds': ['Analysis', 'Coding']})  # an unrelated change still saves
        self.assertEqual(app.config['work_kinds'], ['Analysis', 'Coding'])
        status = server.vault_status(app.store_for('y'), 'y')
        self.assertFalse(status['check']['ok'])
        self.assertEqual(status['matches'], [{'id': 'folders', 'label': 'Initiatives'}])
        self.assertEqual(server.vault_status(app.store_for('x'), 'x')['matches'], [])  # empty: nothing to say but "create"


class HttpVaultsTest(VaultsBase):
    def setUp(self):
        super().setUp()
        self.app = self.two_vaults()
        patcher = mock.patch.object(server, 'APP', self.app)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.base = f'http://127.0.0.1:{self.httpd.server_address[1]}'
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)

    def request(self, path, body=None, vault='a'):
        headers = {'Content-Type': 'application/json', 'X-Task-Manager': '1'}
        if vault:
            headers['X-TM-Vault'] = vault
        req = Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with urlopen(req) as res:
                return res.status, json.loads(res.read())
        except HTTPError as e:
            with e:
                return e.code, json.loads(e.read())

    def test_the_vault_must_be_named_and_known(self):
        self.assertEqual(self.request('/api/items', vault=None)[0], 400)
        self.assertEqual(self.request('/api/items', vault='zzz')[0], 404)
        self.assertEqual(self.request('/api/config', vault=None)[0], 200)  # not about a vault
        code, out = self.request('/api/vault/status', vault='b')
        self.assertEqual((code, out['vault']['id'], out['check']['ok']), (200, 'b', True))

    def test_the_user_guide_is_served_to_any_page(self):
        # Settings → Documentation: docs/user-guide.md, about no vault in particular
        code, out = self.request('/api/guide', vault=None)
        self.assertEqual(code, 200)
        self.assertTrue(out['markdown'].startswith('# '))
        with mock.patch.object(server, 'GUIDE_PATH', os.path.join(self.tmp, 'gone.md')):
            self.assertEqual(self.request('/api/guide', vault=None)[0], 404)

    def test_the_guide_says_which_version_this_is(self):
        # The last release CHANGELOG.md names (not Unreleased); a copy without it (the iPhone app's bundle) says none.
        log = os.path.join(self.tmp, 'CHANGELOG.md')
        with open(log, 'w', encoding='utf-8') as f:
            f.write('# Changelog\n\n## [Unreleased]\n\n- next\n\n## [2.3.1] - 2026-11-12\n\n## [2.3.0]\n')
        with mock.patch.object(server, 'CHANGELOG_PATH', log):
            self.assertEqual(self.request('/api/guide', vault=None)[1]['version'], '2.3.1')
        with mock.patch.object(server, 'CHANGELOG_PATH', os.path.join(self.tmp, 'gone.md')):
            self.assertIsNone(self.request('/api/guide', vault=None)[1]['version'])

    def test_the_structure_is_the_vaults_own(self):
        self.assertEqual(self.request('/api/structure', vault=None)[0], 400)
        code, out = self.request('/api/structure', vault='b')
        self.assertEqual((code, out['id'], out['external_ref']['label']), (200, 'folders', 'Ticket'))
        self.assertEqual(out, json.loads(json.dumps(FOLDER_PER_TYPE.public())))

    def test_the_same_id_in_two_vaults_never_crosses(self):
        _, in_a = self.request('/api/item/create', {'type': 'task', 'subject': 'In A', 'values': {}, 'body': ''}, 'a')
        _, in_b = self.request('/api/item/create', {'type': 'task', 'subject': 'In B', 'values': {}, 'body': ''}, 'b')
        self.assertEqual(in_a['id'], in_b['id'])  # each vault numbers its own
        before_b = tree_hash(self.b)
        code, out = self.request('/api/item/update', {'key': in_a['id'], 'values': {'status': 'Done'}}, 'a')
        self.assertEqual((code, out['fields']['status']), (200, 'Done'))
        self.assertEqual(tree_hash(self.b), before_b)
        self.assertEqual(self.request('/api/items', vault='b')[1]['items'][0]['title'], 'In B')

    def test_a_vault_that_does_not_match_is_read_only(self):
        _, item = self.request('/api/item/create', {'type': 'task', 'subject': 'Before', 'values': {}, 'body': ''}, 'a')
        self.request('/api/worklog', {'id': item['id'], 'kind': 'Analysis', 'note': 'x'}, 'a')
        os.makedirs(os.path.join(self.a, 'Tickets'))  # now it does not match
        before = tree_hash(self.a)
        key = item['id']
        writes = [
            ('/api/item/create', {'type': 'note', 'subject': 'No', 'values': {}, 'body': ''}),
            ('/api/item/update', {'key': key, 'values': {'status': 'Done'}}),
            ('/api/item/delete', {'key': key}),
            ('/api/item/comment', {'key': key, 'text': 'hi'}),
            ('/api/item/convert', {'key': key, 'type': 'note'}),
            ('/api/assign-ids', {}),
            ('/api/board', {'lists': [{'id': 'x', 'name': 'X'}]}),
            ('/api/today', {'lists': [{'id': 'x', 'name': 'X'}]}),
            ('/api/pins', {'items': [key]}),
            ('/api/sidebar', {'items': [key]}),
            ('/api/people', {'name': 'Ana'}),
            ('/api/labels', {'name': 'x'}),
            ('/api/worklog', {'id': key, 'kind': 'Analysis', 'note': 'y'}),
            ('/api/worklog/delete', {'date': item['fields']['created_at'][:10], 'index': 0}),
            ('/api/trash/empty', {}),
        ]
        for path, body in writes:
            with self.subTest(path):
                code, out = self.request(path, body, 'a')
                self.assertEqual(code, 409, out)
                self.assertTrue(out['check']['blocking'])
        self.assertEqual(tree_hash(self.a), before)
        self.assertEqual(self.request('/api/vault/status', vault='a')[1]['check']['blocking'][0]['kind'], 'unexpected_folder')

    def test_create_folders_creates_only_what_is_missing(self):
        os.rmdir(os.path.join(self.a, 'transcriptions'))
        os.rmdir(os.path.join(self.a, 'inbox'))
        before = {os.path.relpath(os.path.join(d, f), self.a) for d, _, fs in os.walk(self.a) for f in fs}
        code, out = self.request('/api/vault/create-folders', {}, 'a')
        self.assertEqual((code, out['check']['ok']), (200, True))
        self.assertTrue(os.path.isdir(os.path.join(self.a, 'transcriptions')))
        self.assertEqual({os.path.relpath(os.path.join(d, f), self.a) for d, _, fs in os.walk(self.a) for f in fs}, before)

    def test_create_folders_refuses_when_it_would_not_fix_the_vault(self):
        os.rmdir(os.path.join(self.a, 'inbox'))
        os.makedirs(os.path.join(self.a, 'Tickets'))
        before = tree_hash(self.a)
        code, out = self.request('/api/vault/create-folders', {}, 'a')
        self.assertEqual(code, 409, out)
        self.assertEqual(tree_hash(self.a), before)

    def test_create_folders_never_writes_over_a_file(self):
        os.rmdir(os.path.join(self.a, 'inbox'))
        with open(os.path.join(self.a, 'inbox'), 'w', encoding='utf-8') as f:
            f.write('a file where the folder should be')
        before = tree_hash(self.a)
        code, out = self.request('/api/vault/create-folders', {}, 'a')
        self.assertEqual(code, 409, out)
        self.assertEqual(tree_hash(self.a), before)


if __name__ == '__main__':
    unittest.main()
