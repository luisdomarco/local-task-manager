"""Attachments (tm/attachments.py): an item's files in its vault's Attachments/ folder, named in its frontmatter by
path, added by their bytes, served only to this app, removed to the trash."""
import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

import server
from tm import attachments
from tm.store import Store, StoreError

PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 32


class NamesTest(unittest.TestCase):
    def test_a_file_keeps_its_own_name_made_safe(self):
        self.assertEqual(attachments.safe_name('../../etc/passwd'), 'passwd')
        self.assertEqual(attachments.safe_name('C:\\fotos\\Captura 1.png'), 'Captura 1.png')
        self.assertEqual(attachments.safe_name('a:b*c?.png'), 'a-b-c-.png')
        self.assertTrue(attachments.safe_name('x' * 300 + '.jpeg').endswith('.jpeg'))
        self.assertLessEqual(len(attachments.safe_name('x' * 300 + '.jpeg')), 120)
        for bad in ('', '..', '/', ' . '):
            with self.subTest(bad), self.assertRaises(ValueError):
                attachments.safe_name(bad)

    def test_the_list_holds_paths_inside_the_folder(self):
        self.assertEqual(attachments.clean_list(['Attachments/T-1/a.png', '/Attachments/T-1/a.png', 'Attachments/T-1/b.pdf']),
                         ['Attachments/T-1/a.png', 'Attachments/T-1/b.pdf'])
        for bad in ('tasks/T-1.md', 'Attachments', 'Attachments/../x.md', 'Attachments//a.png'):
            with self.subTest(bad), self.assertRaises(ValueError):
                attachments.clean_list([bad])


class StoreAttachmentsTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        self.s = Store(self.root)
        self.s.create_missing_folders()  # a whole vault, for the check
        self.task = self.s.create('task', 'Con capturas')

    def test_an_item_gets_its_files_in_its_own_folder(self):
        it = self.s.add_attachment(self.task['key'], 'captura.png', PNG)
        it = self.s.add_attachment(self.task['key'], 'captura.png', b'otra')  # same name: a free one
        folder = f"Attachments/{self.task['id']}"
        self.assertEqual(it['fields']['attachments'], [f'{folder}/captura.png', f'{folder}/captura-2.png'])
        with open(os.path.join(self.root, folder, 'captura.png'), 'rb') as f:
            self.assertEqual(f.read(), PNG)
        self.assertEqual(self.s.attachment_file(f'{folder}/captura.png'), os.path.join(os.path.realpath(self.root), folder, 'captura.png'))

    def test_an_attached_markdown_file_is_never_an_item_and_the_vault_stays_valid(self):
        self.s.add_attachment(self.task['key'], 'notas.md', b'---\ntype: task\nid: TSK-9999\n---\n')
        self.assertEqual([i['id'] for i in self.s.items()], [self.task['id']])
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_removing_one_moves_it_to_the_trash_and_undo_brings_it_back(self):
        self.s.add_attachment(self.task['key'], 'a.png', PNG)
        rel = f"Attachments/{self.task['id']}/a.png"
        out = self.s.remove_attachment(self.task['key'], rel)
        self.assertEqual(out['item']['fields']['attachments'], [])
        self.assertFalse(os.path.exists(os.path.join(self.root, rel)))
        trashed = os.listdir(os.path.join(self.root, '.task-manager', 'trash', 'attachments'))
        self.assertEqual(len(trashed), 1)
        self.assertTrue(trashed[0].endswith('-a.png'))
        with self.assertRaises(StoreError):  # not one of its files
            self.s.remove_attachment(self.task['key'], rel)
        it = self.s.restore_attachment(self.task['key'], out['trashed'], rel)
        self.assertEqual(it['fields']['attachments'], [rel])
        with open(os.path.join(self.root, rel), 'rb') as f:
            self.assertEqual(f.read(), PNG)
        with self.assertRaises(StoreError):  # only from the attachments' trash
            self.s.restore_attachment(self.task['key'], self.task['path'], rel)

    def test_too_big_or_outside_the_folder_is_refused(self):
        with self.assertRaises(StoreError) as cm:
            self.s.add_attachment(self.task['key'], 'big.bin', b'x' * (attachments.MAX_BYTES + 1))
        self.assertEqual(cm.exception.status, 413)
        for bad in ('tasks', '../x', 'Attachments/../tasks'):
            with self.subTest(bad), self.assertRaises(StoreError):
                self.s.attachment_file(bad)
        with self.assertRaises(StoreError):  # the list only takes paths inside Attachments/
            self.s.update(self.task['key'], {'attachments': ['tasks/x.md']})

    def test_a_converted_inbox_item_keeps_its_files(self):
        inbox = self.s.create('inbox', 'Captura suelta')
        self.s.add_attachment(inbox['key'], 'a.png', PNG)
        task = self.s.convert(inbox['key'], 'task')
        self.assertEqual(task['fields']['attachments'], [f"Attachments/{inbox['id']}/a.png"])

    def path(self, rel):
        return os.path.join(self.root, *rel.split('/'))

    def test_emptying_the_trash_deletes_the_files_taken_off_an_item(self):
        self.s.add_attachment(self.task['key'], 'a.png', PNG)
        self.s.remove_attachment(self.task['key'], f"Attachments/{self.task['id']}/a.png")
        removed = os.path.join(self.root, '.task-manager', 'trash', 'attachments')
        self.assertEqual(len(os.listdir(removed)), 1)
        self.assertEqual(self.s.empty_trash(), {'purged': 0, 'attachments': 1, 'files': 0})
        self.assertFalse(os.path.exists(removed))

    def test_the_trash_counts_the_files_taken_off_an_item(self):
        self.assertEqual(self.s.removed_attachments(), 0)  # no trash folder yet
        self.s.add_attachment(self.task['key'], 'a.png', PNG)
        self.s.add_attachment(self.task['key'], 'b.png', PNG)
        folder = f"Attachments/{self.task['id']}"
        out = self.s.remove_attachment(self.task['key'], f'{folder}/a.png')
        self.s.remove_attachment(self.task['key'], f'{folder}/b.png')
        self.assertEqual(self.s.removed_attachments(), 2)
        self.assertEqual(self.s.trash(), [])  # files, not deleted items
        self.s.restore_attachment(self.task['key'], out['trashed'], f'{folder}/a.png')  # an Undo takes it back out
        self.assertEqual(self.s.removed_attachments(), 1)
        self.assertEqual(self.s.empty_trash(), {'purged': 0, 'attachments': 1, 'files': 0})
        self.assertEqual(self.s.removed_attachments(), 0)

    def test_a_deleted_item_keeps_its_files_until_it_is_purged(self):
        self.s.add_attachment(self.task['key'], 'a.png', PNG)
        rel = f"Attachments/{self.task['id']}/a.png"
        out = self.s.delete(self.task['key'])
        self.assertTrue(os.path.isfile(self.path(rel)))  # a restore finds them
        self.assertEqual(self.s.unlisted_attachments(), [])  # a deleted item still lists them
        it = self.s.restore_trashed(out['trashed'])
        self.assertEqual(it['fields']['attachments'], [rel])
        self.assertEqual(self.s.attachment_file(rel), os.path.join(os.path.realpath(self.root), *rel.split('/')))

        out = self.s.delete(it['key'])
        self.assertEqual(self.s.purge(out['trashed']), {'purged': out['trashed'], 'attachments': 1})
        self.assertFalse(os.path.exists(self.path(rel)))
        self.assertFalse(os.path.exists(self.path(f"Attachments/{self.task['id']}")))  # its folder, once empty

    def test_emptying_the_trash_purges_the_files_of_the_deleted_items(self):
        other = self.s.create('task', 'Otra')
        self.s.add_attachment(self.task['key'], 'a.png', PNG)
        self.s.add_attachment(other['key'], 'b.png', PNG)
        self.s.delete(self.task['key'])
        self.s.delete(other['key'])
        self.assertEqual(self.s.empty_trash(), {'purged': 2, 'attachments': 2, 'files': 0})
        self.assertEqual(os.listdir(self.path('Attachments')), [])
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_a_file_another_item_lists_is_kept(self):
        rel = f"Attachments/{self.task['id']}/a.png"
        self.s.add_attachment(self.task['key'], 'a.png', PNG)
        live = self.s.create('note', 'La comparte', {'attachments': [rel]})
        gone = self.s.create('task', 'También, y borrada', {'attachments': [rel]})
        trashed_gone = self.s.delete(gone['key'])['trashed']
        trashed = self.s.delete(self.task['key'])['trashed']

        self.assertEqual(self.s.purge(trashed)['attachments'], 0)  # a live note and a deleted task still list it
        self.s.delete(live['key'])
        self.assertEqual(self.s.purge(trashed_gone)['attachments'], 0)  # the note, deleted, still does
        self.assertEqual(self.s.empty_trash()['attachments'], 1)  # now nobody
        self.assertFalse(os.path.exists(self.path(rel)))

    def test_a_converted_inbox_item_purged_leaves_the_files_of_what_it_became(self):
        inbox = self.s.create('inbox', 'Captura suelta')
        self.s.add_attachment(inbox['key'], 'a.png', PNG)
        task = self.s.convert(inbox['key'], 'task')
        self.assertEqual(self.s.empty_trash()['attachments'], 0)
        self.assertTrue(os.path.isfile(self.path(task['fields']['attachments'][0])))

    def test_a_purge_deletes_nothing_out_of_the_folder(self):
        outside = os.path.join(self.root, 'tasks', 'keep.png')
        with open(outside, 'wb') as f:
            f.write(PNG)
        os.makedirs(self.path('Attachments'))
        os.symlink(os.path.dirname(outside), self.path('Attachments/link'))
        self.s.update(self.task['key'], {'attachments': ['Attachments/link/keep.png']})
        self.s.delete(self.task['key'])
        self.assertEqual(self.s.empty_trash()['attachments'], 0)
        self.assertTrue(os.path.isfile(outside))

    def test_a_file_no_item_lists_is_a_warning_of_its_own(self):
        self.s.add_attachment(self.task['key'], 'a.png', PNG)
        os.makedirs(self.path('Attachments/suelto'))
        for name in ('x.pdf', '.DS_Store'):
            with open(self.path(f'Attachments/suelto/{name}'), 'wb') as f:
                f.write(b'x')
        self.assertEqual([w['path'] for w in self.s.unlisted_attachments()], ['Attachments/suelto/x.pdf'])
        self.assertEqual(self.s.check()['warnings'], [])  # not part of the check every write runs


class TicketingAttachmentsTest(unittest.TestCase):
    def test_a_ticketing_vault_takes_them_too(self):
        with tempfile.TemporaryDirectory() as root:
            for d in ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log'):
                os.makedirs(os.path.join(root, d))
            s = Store(root, structure='ticketing', enforce_structure=True)
            s.create('project', 'Internal Tools', {'project_key': 'HB', 'project_kind': 'system'})
            sup = s.create('support', 'Falla', {'project': 'HB'})
            it = s.add_attachment(sup['key'], 'log.txt', b'trace')
            self.assertEqual(it['fields']['attachments'], ['Attachments/HB-SUP-001/log.txt'])
            self.assertIn('Attachments/HB-SUP-001/log.txt', open(os.path.join(root, sup['path']), encoding='utf-8').read())
            self.assertTrue(s.check()['ok'], s.check())
            s.delete(sup['key'])
            self.assertTrue(os.path.isfile(os.path.join(root, 'Attachments', 'HB-SUP-001', 'log.txt')))
            self.assertEqual(s.empty_trash()['attachments'], 1)
            self.assertFalse(os.path.exists(os.path.join(root, 'Attachments', 'HB-SUP-001')))


class HttpAttachmentsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.base = f'http://127.0.0.1:{cls.httpd.server_address[1]}'
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.saved_store = server.APP.store

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        server.APP.store = cls.saved_store

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        server.APP.store = Store(tmp.name)
        self.vault = server.APP.config['default_vault']
        self.task = server.APP.store.create('task', 'Con capturas')

    def send(self, path, data, headers):
        req = Request(self.base + path, data=data, headers={'X-TM-Vault': self.vault, 'X-Task-Manager': '1', **headers})
        try:
            with urlopen(req) as res:
                return res.status, dict(res.headers), res.read()
        except HTTPError as e:
            with e:
                return e.code, dict(e.headers), e.read()

    def upload(self, name, data):
        return self.send(f"/api/attachments/add?key={quote(self.task['key'])}", data,
                         {'Content-Type': 'application/octet-stream', 'X-TM-Filename': quote(name)})

    def test_upload_serve_and_remove_as_api_js_does(self):
        status, _, body = self.upload('captura ñ.png', PNG)
        self.assertEqual(status, 200, body)
        rel = f"Attachments/{self.task['id']}/captura ñ.png"
        self.assertEqual(json.loads(body)['fields']['attachments'], [rel])

        status, headers, body = self.send(f'/api/attachments/file?vault={self.vault}&path={quote(rel)}', None, {'Sec-Fetch-Site': 'same-origin'})
        self.assertEqual((status, body), (200, PNG))
        self.assertEqual(headers['Content-Type'], 'image/png')
        self.assertTrue(headers['Content-Disposition'].startswith('inline'))
        self.assertEqual((headers['X-Content-Type-Options'], headers['Cross-Origin-Resource-Policy'], headers['Content-Security-Policy']),
                         ('nosniff', 'same-origin', 'sandbox'))

        status, _, body = self.send('/api/attachments/remove', json.dumps({'key': self.task['key'], 'path': rel}).encode(),
                                    {'Content-Type': 'application/json'})
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)['item']['fields']['attachments'], [])

    def test_the_trash_reports_the_files_waiting_to_be_emptied(self):
        self.upload('a.png', PNG)
        rel = f"Attachments/{self.task['id']}/a.png"
        status, _, body = self.send('/api/attachments/remove', json.dumps({'key': self.task['key'], 'path': rel}).encode(),
                                    {'Content-Type': 'application/json'})
        self.assertEqual(status, 200, body)
        status, _, body = self.send('/api/trash', None, {})
        self.assertEqual((status, json.loads(body)), (200, {'entries': [], 'attachments': 1, 'files': []}))  # what keeps Empty trash there
        status, _, body = self.send('/api/trash/empty', b'{}', {'Content-Type': 'application/json'})
        self.assertEqual((status, json.loads(body)), (200, {'purged': 0, 'attachments': 1, 'files': 0}))
        self.assertEqual(json.loads(self.send('/api/trash', None, {})[2])['attachments'], 0)

    def test_what_the_page_cannot_show_is_downloaded(self):
        self.upload('page.html', b'<script>alert(1)</script>')
        rel = f"Attachments/{self.task['id']}/page.html"
        status, headers, _ = self.send(f'/api/attachments/file?vault={self.vault}&path={quote(rel)}', None, {})
        self.assertEqual(status, 200)
        self.assertTrue(headers['Content-Disposition'].startswith('attachment'))
        self.assertEqual(headers['Content-Security-Policy'], 'sandbox')

    def test_another_site_cannot_load_them_nor_upload(self):
        self.upload('a.png', PNG)
        rel = f"Attachments/{self.task['id']}/a.png"
        status, _, _ = self.send(f'/api/attachments/file?vault={self.vault}&path={quote(rel)}', None, {'Sec-Fetch-Site': 'cross-site'})
        self.assertEqual(status, 403)
        req = Request(f"{self.base}/api/attachments/add?key={quote(self.task['key'])}", data=PNG,
                      headers={'X-TM-Vault': self.vault, 'X-TM-Filename': 'b.png'})  # no X-Task-Manager: the CSRF guard
        with self.assertRaises(HTTPError) as cm:
            urlopen(req)
        cm.exception.close()
        self.assertEqual(cm.exception.code, 403)

    def test_the_vault_status_warns_of_a_file_no_item_lists(self):
        server.APP.store.create_missing_folders()  # a vault that matches its structure: the only one with warnings
        self.upload('a.png', PNG)
        root = server.APP.store.root
        with open(os.path.join(root, 'Attachments', 'suelto.pdf'), 'wb') as f:
            f.write(b'%PDF')
        status, _, body = self.send('/api/vault/status', None, {})
        self.assertEqual(status, 200, body)
        check = json.loads(body)['check']
        self.assertTrue(check['ok'])
        self.assertEqual([(w['kind'], w['path']) for w in check['warnings']], [('unlisted_attachment', 'Attachments/suelto.pdf')])

    def test_a_path_out_of_the_folder_is_not_served(self):
        for bad in (self.task['path'], f"Attachments/../{self.task['path']}"):
            with self.subTest(bad):
                status, _, _ = self.send(f'/api/attachments/file?vault={self.vault}&path={quote(bad)}', None, {})
                self.assertIn(status, (400, 404))


if __name__ == '__main__':
    unittest.main()
