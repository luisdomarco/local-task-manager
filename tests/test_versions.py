"""An architecture's and an entity's versions (tm/versions.py, Store.cut_version / restore_version): cut by hand, kept
byte for byte, compared and restored without losing anything."""
import json
import os
import shutil
import tempfile
import unittest

import server
from tm import versions
from tm.store import Store, StoreError
from tm.structures import get

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCH = '78'  # sample-vault/Agents/AGT-78 Shopping assistant.md: version 1.1, no snapshot yet


class BumpTest(unittest.TestCase):
    def test_minor_and_major(self):
        self.assertEqual(versions.bump('1.2'), '1.3')
        self.assertEqual(versions.bump('1.9'), '1.10')
        self.assertEqual(versions.bump('1.2', major=True), '2.0')

    def test_anything_else_starts_at_one(self):
        for v in (None, '', 'v2', '1', '1.2.3'):
            self.assertEqual(versions.bump(v), '1.0')


class VersionsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.vault = os.path.join(self.tmp, 'vault')
        shutil.copytree(os.path.join(ROOT, 'sample-vault'), self.vault)
        self.store = Store(self.vault, structure=get('ticketing'))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def file(self, key):
        with open(os.path.join(self.vault, self.store.find(key)['path']), encoding='utf-8') as f:
            return f.read()

    def test_cut_writes_only_its_version_and_keeps_the_file(self):
        before = self.file(ARCH)
        out = self.store.cut_version(ARCH, note='first cut')
        self.assertEqual((out['version'], out['edited']), ('1.2', False))
        after = self.file(ARCH)
        self.assertEqual(after, before.replace('version: "1.1"', 'version: "1.2"', 1))  # the rest byte for byte
        snap = os.path.join(self.vault, '.task-manager', 'versions', ARCH, '1.2.md')
        with open(snap, encoding='utf-8') as f:
            self.assertEqual(f.read(), after)
        line = out['versions'][0]
        self.assertEqual((line['note'], line['by'], line['title']), ('first cut', 'owner', 'Shopping assistant'))
        # An architecture's version names the version each of its entities was at.
        self.assertEqual(line['entities'], {f'ENT-{n}': '1.0' for n in range(79, 84)})

    def test_a_major_version(self):
        self.assertEqual(self.store.cut_version(ARCH, major=True)['version'], '2.0')

    def test_an_edit_after_a_version_is_named(self):
        self.store.cut_version(ARCH)
        self.store.update(ARCH, {'decision': 'AR-2: measured saturation'}, by='owner')
        self.assertTrue(self.store.item_versions(ARCH)['edited'])
        diff = self.store.item_version(ARCH, '1.2')['diff']
        self.assertIn('+decision: "AR-2: measured saturation"', diff)
        self.assertTrue(diff.startswith('--- v1.2\n+++ now\n@@ '))

    def test_restore_brings_it_back_and_cuts_a_version(self):
        self.store.cut_version(ARCH)
        kept = self.file(ARCH)
        self.store.update(ARCH, {'decision': 'changed', 'subject': 'Renamed assistant'}, by='owner')
        out = self.store.restore_version(ARCH, '1.2')
        # The edit never cut is kept first (1.3), then the restore is a version of its own (1.4).
        self.assertEqual([(v['version'], v['note']) for v in out['versions']],
                         [('1.4', 'Restored 1.2'), ('1.3', 'Before restoring 1.2'), ('1.2', '')])
        self.assertIn('Renamed assistant', self.store.item_version(ARCH, '1.3')['title'])
        it = self.store.read(ARCH)
        self.assertEqual(it['title'], 'Shopping assistant')  # its name back too
        self.assertIn('no measured saturation', it['fields']['decision'])
        # Its body and the keys around as they were (the rename back writes its `name` once more, unquoted).
        now = self.file(ARCH)
        self.assertEqual(now.split('\n---\n', 1)[1], kept.split('\n---\n', 1)[1])
        self.assertIn('architecture: AR-1', now)

    def test_restore_refuses_a_file_changed_since(self):
        self.store.cut_version(ARCH)
        rev = self.store.read(ARCH)['rev']
        self.store.update(ARCH, {'decision': 'outside'}, by='owner')
        with self.assertRaises(StoreError) as e:
            self.store.restore_version(ARCH, '1.2', base_rev=rev)
        self.assertEqual(e.exception.status, 409)

    def test_a_new_entity_starts_at_its_first_version(self):
        e = self.store.create('entity', 'ski-dedupe', {'related_to': ARCH, 'entity_type': 'skill'})
        self.assertEqual(e['path'], 'Agents/AGT-78/ENT-84 ski-dedupe.md')  # in its architecture's folder
        self.assertEqual(e['fields']['version'], '1.0')
        v = self.store.item_versions(e['key'])
        self.assertEqual([(x['version'], x['note']) for x in v['versions']], [('1.0', 'Created')])
        self.assertFalse(v['edited'])
        self.assertTrue(self.store.check()['ok'])

    def test_a_type_without_versions_is_refused(self):
        task = self.store.create('task', 'Plain task')
        with self.assertRaises(StoreError) as e:
            self.store.cut_version(task['key'])
        self.assertEqual(e.exception.status, 400)
        self.assertFalse(os.path.exists(os.path.join(self.vault, '.task-manager', 'versions', str(task['id']))))

    def test_an_unknown_version_is_404(self):
        with self.assertRaises(StoreError) as e:
            self.store.item_version(ARCH, '9.9')
        self.assertEqual(e.exception.status, 404)

    def test_the_index_is_json_oldest_first(self):
        self.store.cut_version(ARCH)
        self.store.cut_version(ARCH)
        with open(os.path.join(self.vault, '.task-manager', 'versions', ARCH, 'versions.json'), encoding='utf-8') as f:
            self.assertEqual([e['version'] for e in json.load(f)], ['1.2', '1.3'])

    def test_the_routes(self):
        for route in (('GET', '/api/item/versions'), ('GET', '/api/item/version'),
                      ('POST', '/api/item/versions/cut'), ('POST', '/api/item/versions/restore')):
            self.assertIn(route, server.ROUTES)
        out = server.ROUTES[('POST', '/api/item/versions/cut')](self.store, {}, {'key': ARCH, 'major': True, 'note': 'x'})
        self.assertEqual(out['version'], '2.0')
        listed = server.ROUTES[('GET', '/api/item/versions')](self.store, {'key': ARCH}, None)
        self.assertEqual(listed['versions'][0]['note'], 'x')


if __name__ == '__main__':
    unittest.main()
