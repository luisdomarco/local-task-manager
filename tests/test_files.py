"""The vault as files (the sidebar's Explorer): Store.files lists it, Store.vault_file and /api/files/raw serve one."""

import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402
from tm.store import Store, StoreError  # noqa: E402


def write(root, rel, text='x'):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


class StoreFilesTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        self.store = Store(self.root)
        self.task = self.store.create('task', 'Primera')
        write(self.root, 'Attachments/TSK-0001/shot.png')
        write(self.root, 'templates/plan.md', '# Plan')
        write(self.root, '.obsidian/app.json', '{}')
        write(self.root, 'node_modules/x/index.js')
        write(self.root, '.hidden.md')

    def test_lists_folders_and_files_but_nothing_hidden(self):
        listed = {e['path']: e for e in self.store.files()['entries']}
        self.assertIn('Attachments/TSK-0001/shot.png', listed)  # attachments are files, and shown
        self.assertEqual(listed['templates']['kind'], 'dir')
        self.assertEqual(listed['templates/plan.md']['kind'], 'file')
        self.assertFalse([p for p in listed if p.startswith(('.', 'node_modules')) or '/.' in p])
        self.assertEqual(list(listed), sorted(listed))

    def test_an_item_file_carries_its_item(self):
        entry = next(e for e in self.store.files()['entries'] if e['path'] == self.task['path'])
        self.assertEqual(entry['item']['key'], self.task['key'])
        self.assertEqual(entry['item']['type'], 'task')
        self.assertNotIn('item', next(e for e in self.store.files()['entries'] if e['path'] == 'templates/plan.md'))

    def test_a_vault_too_big_says_it_was_cut(self):
        self.store.FILES_MAX = 3
        result = self.store.files()
        self.assertEqual((len(result['entries']), result['truncated']), (3, True))

    def test_vault_file_stays_inside_and_visible(self):
        self.assertEqual(self.store.vault_file('templates/plan.md'), os.path.join(self.root, 'templates', 'plan.md'))
        for bad, status in [('../etc/passwd', 400), ('.obsidian/app.json', 400), ('templates', 404), ('nope.md', 404), ('', 400)]:
            with self.subTest(bad=bad), self.assertRaises(StoreError) as e:
                self.store.vault_file(bad)
            self.assertEqual(e.exception.status, status)

    def test_a_symlink_out_of_the_vault_is_refused(self):
        outside = tempfile.TemporaryDirectory()
        self.addCleanup(outside.cleanup)
        write(outside.name, 'secret.txt')
        os.symlink(os.path.join(outside.name, 'secret.txt'), os.path.join(self.root, 'link.txt'))
        with self.assertRaises(StoreError) as e:
            self.store.vault_file('link.txt')
        self.assertEqual(e.exception.status, 400)


SAMPLE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sample-vault')


class StoreFileOpsTest(unittest.TestCase):
    """New folder, rename, move and delete on a vault that matches its structure (a copy of sample-vault, folder per type)."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.join(os.path.realpath(tmp.name), 'v')
        shutil.copytree(SAMPLE, self.root)
        self.store = Store(self.root, enforce_structure=True)
        self.assertTrue(self.store.check()['ok'])
        write(self.root, 'notes/drafts/idea.md', 'Ver [[TSK-0001-benchmark-competitor-pricing]] y [[idea]].')
        write(self.root, 'notes/drafts/pic.png', 'png')

    def exists(self, rel):
        return os.path.lexists(os.path.join(self.root, rel))

    def test_makes_a_folder_only_inside_one_that_exists(self):
        self.assertEqual(self.store.make_folder('notes/drafts/old')['path'], 'notes/drafts/old')
        self.assertTrue(os.path.isdir(os.path.join(self.root, 'notes/drafts/old')))
        for bad, status in [('notes/drafts/old', 409), ('nope/x', 404), ('.obsidian', 400), ('../out', 400)]:
            with self.subTest(bad=bad), self.assertRaises(StoreError) as e:
                self.store.make_folder(bad)
            self.assertEqual(e.exception.status, status)

    def test_renames_a_note_and_its_links_follow(self):
        write(self.root, 'notes/other.md', 'see [[idea|la idea]] and [[idea 2]]')
        self.assertEqual(self.store.rename_path('notes/drafts/idea.md', 'plan.md')['path'], 'notes/drafts/plan.md')
        self.assertFalse(self.exists('notes/drafts/idea.md'))
        with open(os.path.join(self.root, 'notes/other.md'), encoding='utf-8') as f:
            self.assertEqual(f.read(), 'see [[plan|la idea]] and [[idea 2]]')
        backups = os.listdir(os.path.join(self.root, '.task-manager', 'backup'))
        self.assertTrue(any(b.endswith('-rename') for b in backups))

    def test_a_folder_per_type_item_file_renames_freely_its_key_is_its_id(self):
        self.store.rename_path('tasks/TSK-0001-benchmark-competitor-pricing.md', 'TSK-0001-pricing.md')
        self.assertEqual(self.store.find('TSK-0001')['path'], 'tasks/TSK-0001-pricing.md')
        with open(os.path.join(self.root, 'notes/drafts/idea.md'), encoding='utf-8') as f:
            self.assertIn('[[TSK-0001-pricing]]', f.read())

    def test_a_rename_that_breaks_the_structure_is_undone(self):
        with self.assertRaises(StoreError) as e:
            self.store.rename_path('tasks', 'todo')
        self.assertEqual(e.exception.status, 409)
        self.assertIn('out of its structure', str(e.exception))
        self.assertTrue(self.exists('tasks') and not self.exists('todo'))
        self.assertTrue(self.store.check()['ok'])

    def test_refuses_bad_names_and_taken_ones(self):
        for name in ['', '.hidden', 'a/b', 'a:b', '..']:
            with self.subTest(name=name), self.assertRaises(StoreError) as e:
                self.store.rename_path('notes/drafts/idea.md', name)
            self.assertEqual(e.exception.status, 400)
        with self.assertRaises(StoreError) as e:
            self.store.rename_path('notes/drafts/idea.md', 'pic.png')
        self.assertEqual(e.exception.status, 409)

    def test_moves_into_a_folder_and_never_into_itself(self):
        self.store.make_folder('notes/archive')
        self.assertEqual(self.store.move_path('notes/drafts', 'notes/archive')['path'], 'notes/archive/drafts')
        self.assertTrue(self.exists('notes/archive/drafts/idea.md'))
        with self.assertRaises(StoreError) as e:
            self.store.move_path('notes/archive', 'notes/archive/drafts')
        self.assertEqual(e.exception.status, 400)
        with self.assertRaises(StoreError) as e:
            self.store.move_path('notes/archive/drafts/idea.md', 'nope')
        self.assertEqual(e.exception.status, 404)

    def test_a_move_that_breaks_the_structure_is_undone(self):
        with self.assertRaises(StoreError) as e:
            self.store.move_path('tasks', 'notes')
        self.assertEqual(e.exception.status, 409)
        self.assertTrue(self.exists('tasks') and not self.exists('notes/tasks'))

    def test_an_attachment_an_item_lists_is_managed_from_its_item(self):
        task = self.store.add_attachment('TSK-0002', 'shot.png', b'png')
        rel = task['fields']['attachments'][0]
        for op in (lambda: self.store.rename_path(rel, 'x.png'), lambda: self.store.move_path(rel, 'notes'),
                   lambda: self.store.delete_path(rel), lambda: self.store.delete_path('Attachments')):
            with self.assertRaises(StoreError) as e:
                op()
            self.assertEqual(e.exception.status, 409)
            self.assertIn('attachment of an item', str(e.exception))
        self.assertTrue(self.exists(rel))

    def test_deleting_an_item_file_is_deleting_the_item(self):
        out = self.store.delete_path('tasks/TSK-0007-collect-churn-data.md')
        self.assertEqual(out['item'], 'TSK-0007')
        self.assertIn('TSK-0007', [e['id'] for e in self.store.trash()])
        self.assertEqual(self.store.trashed_files(), [])

    def test_a_folder_with_items_is_not_deleted(self):
        write(self.root, 'tasks/sub/TSK-0099-x.md', '---\nid: TSK-0099\ntype: task\nsubject: X\n---\n')
        with self.assertRaises(StoreError) as e:
            self.store.delete_path('tasks/sub')
        self.assertEqual(e.exception.status, 409)
        self.assertIn('holds 1 item', str(e.exception))

    def test_a_deleted_folder_waits_in_the_trash_and_comes_back(self):
        out = self.store.delete_path('notes/drafts')
        self.assertFalse(self.exists('notes/drafts'))
        [entry] = self.store.trashed_files()
        self.assertEqual((entry['trashed'], entry['path'], entry['kind']), (out['trashed'], 'notes/drafts', 'dir'))
        self.assertNotIn('idea.md', [os.path.basename(p) for p in self.store._walk_md()])  # not an item in the trash
        self.assertEqual(self.store.restore_file(out['trashed'])['path'], 'notes/drafts')
        self.assertTrue(self.exists('notes/drafts/idea.md'))
        self.assertEqual(self.store.trashed_files(), [])

    def test_a_restore_never_overwrites(self):
        out = self.store.delete_path('notes/drafts/pic.png')
        write(self.root, 'notes/drafts/pic.png', 'new')
        with self.assertRaises(StoreError) as e:
            self.store.restore_file(out['trashed'])
        self.assertEqual(e.exception.status, 409)

    def test_deleting_a_type_folder_is_undone(self):
        for name in os.listdir(os.path.join(self.root, 'prompts')):  # empty: only its being a type's folder refuses it
            os.remove(os.path.join(self.root, 'prompts', name))
        with self.assertRaises(StoreError) as e:
            self.store.delete_path('prompts')
        self.assertEqual(e.exception.status, 409)
        self.assertTrue(os.path.isdir(os.path.join(self.root, 'prompts')))
        self.assertEqual(self.store.trashed_files(), [])

    def test_purge_and_empty_trash_delete_for_good(self):
        a = self.store.delete_path('notes/drafts/pic.png')
        self.store.delete_path('notes/drafts/idea.md')
        self.store.purge_file(a['trashed'])
        self.assertEqual(len(self.store.trashed_files()), 1)
        self.assertEqual(self.store.empty_trash()['files'], 1)
        self.assertEqual(self.store.trashed_files(), [])
        with self.assertRaises(StoreError):
            self.store.purge_file('.task-manager/trash/files/../../tasks')


class TicketingFileOpsTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        for d in ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log'):
            os.makedirs(os.path.join(self.root, d))
        self.store = Store(self.root, structure='ticketing', enforce_structure=True)
        self.store.create('project', 'Internal Tools', {'project_key': 'HB', 'project_kind': 'system'})
        self.sup = self.store.create('support', 'Falla', {'project': 'HB'})
        self.assertTrue(self.store.check()['ok'], self.store.check())

    def test_an_item_named_after_its_title_is_renamed_by_its_title(self):
        entry = next(e for e in self.store.files()['entries'] if e['path'] == self.sup['path'])
        self.assertEqual(entry['item']['rename'], 'title')
        with self.assertRaises(StoreError) as e:
            self.store.rename_path(self.sup['path'], 'HB-SUP-001 Otra.md')
        self.assertEqual(e.exception.status, 409)
        self.assertIn('change its title', str(e.exception))

    def test_moving_a_ticket_out_of_its_project_is_undone(self):
        with self.assertRaises(StoreError) as e:
            self.store.move_path(self.sup['path'], 'Notes')
        self.assertEqual(e.exception.status, 409)
        self.assertTrue(os.path.isfile(os.path.join(self.root, self.sup['path'])))


class UnmatchedFileOpsTest(unittest.TestCase):
    """A vault that does not match its structure is read-only for items, but its files are still worked on from the
    Explorer: that is how such a folder is looked at, tidied and put right."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        write(self.root, 'docs/readme.md', 'see [[readme]]')
        write(self.root, 'docs/pic.png', 'png')
        write(self.root, 'tasks/TSK-0001-x.md', '---\nid: TSK-0001\ntype: task\nsubject: X\n---\n')
        self.store = Store(self.root, enforce_structure=True)
        self.assertFalse(self.store.check()['ok'])

    def exists(self, rel):
        return os.path.lexists(os.path.join(self.root, rel))

    def test_folders_renames_moves_and_deletes_go_through(self):
        self.store.make_folder('docs/old')
        self.assertEqual(self.store.rename_path('docs/readme.md', 'intro.md')['path'], 'docs/intro.md')
        self.assertEqual(self.store.move_path('docs/intro.md', 'docs/old')['path'], 'docs/old/intro.md')
        out = self.store.delete_path('docs/pic.png')
        self.assertFalse(self.exists('docs/pic.png'))
        self.assertEqual(self.store.restore_file(out['trashed'])['path'], 'docs/pic.png')
        self.store.purge_file(self.store.delete_path('docs/pic.png')['trashed'])
        self.assertEqual((self.exists('docs/old/intro.md'), self.exists('docs/pic.png')), (True, False))
        self.assertEqual(self.store.trashed_files(), [])
        self.assertFalse(self.store.check()['ok'])  # nothing was refused, nothing was undone

    def test_items_are_still_not_written(self):
        for op in (lambda: self.store.create('task', 'Nueva'), lambda: self.store.delete_path('tasks/TSK-0001-x.md')):
            with self.assertRaises(StoreError) as e:
                op()
            self.assertEqual(e.exception.status, 409)
            self.assertIn('read-only', str(e.exception))
        self.assertTrue(self.exists('tasks/TSK-0001-x.md'))
        self.assertEqual(os.listdir(os.path.join(self.root, 'tasks')), ['TSK-0001-x.md'])


class StoreSaveFileTest(unittest.TestCase):
    """The Explorer's editor: Store.save_file on a copy of sample-vault (folder per type), which must keep matching."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.join(os.path.realpath(tmp.name), 'v')
        shutil.copytree(SAMPLE, self.root)
        self.store = Store(self.root, enforce_structure=True)
        write(self.root, 'notes/drafts/idea.md', '# Idea\n')

    def text(self, rel):
        with open(os.path.join(self.root, rel), encoding='utf-8', newline='') as f:
            return f.read()

    def test_saves_a_text_file_and_answers_its_new_rev(self):
        rev = Store.disk_rev(os.path.join(self.root, 'notes/drafts/idea.md'))
        out = self.store.save_file('notes/drafts/idea.md', '# Idea\n\nMore.\n', rev)
        self.assertEqual(self.text('notes/drafts/idea.md'), '# Idea\n\nMore.\n')
        self.assertNotEqual(out['rev'], rev)
        self.assertEqual(out['rev'], Store.disk_rev(os.path.join(self.root, 'notes/drafts/idea.md')))

    def test_a_file_changed_on_disk_since_is_refused_unless_forced(self):
        rev = Store.disk_rev(os.path.join(self.root, 'notes/drafts/idea.md'))
        write(self.root, 'notes/drafts/idea.md', '# Idea, edited in Obsidian\n')
        with self.assertRaises(StoreError) as e:
            self.store.save_file('notes/drafts/idea.md', 'mine', rev)
        self.assertEqual(e.exception.status, 409)
        self.assertIn('rev', e.exception.extra)
        self.assertEqual(self.text('notes/drafts/idea.md'), '# Idea, edited in Obsidian\n')
        self.store.save_file('notes/drafts/idea.md', 'mine', rev, force=True)
        self.assertEqual(self.text('notes/drafts/idea.md'), 'mine')

    def test_keeps_crlf(self):
        with open(os.path.join(self.root, 'notes/drafts/win.txt'), 'w', encoding='utf-8', newline='') as f:
            f.write('a\r\nb\r\n')
        self.store.save_file('notes/drafts/win.txt', 'a\nb\nc\n')
        self.assertEqual(self.text('notes/drafts/win.txt'), 'a\r\nb\r\nc\r\n')

    def test_only_text_inside_the_vault(self):
        write(self.root, 'notes/drafts/pic.png', 'x')
        with open(os.path.join(self.root, 'notes/drafts/pic.png'), 'wb') as f:
            f.write(b'\x89PNG\x00\x01')
        for path, status in (('notes/drafts/pic.png', 400), ('../outside.md', 400), ('.task-manager/x.md', 400),
                             ('notes/drafts/nope.md', 404)):
            with self.subTest(path=path), self.assertRaises(StoreError) as e:
                self.store.save_file(path, 'x')
            self.assertEqual(e.exception.status, status)

    def test_an_item_file_saved_here_is_read_back_and_a_broken_one_undone(self):
        task = next(it for it in self.store.items() if it['type'] == 'task')
        before = self.text(task['path'])
        self.store.save_file(task['path'], before.replace('\n---\n', '\n---\nEdited in the Explorer.\n', 1))
        self.assertIn('Edited in the Explorer.', self.store.read(task['key'])['body'])
        broken = before.replace(f"id: {task['id']}", 'id: NOPE-1', 1)
        self.assertNotEqual(broken, before)
        with self.assertRaises(StoreError) as e:
            self.store.save_file(task['path'], broken)
        self.assertEqual(e.exception.status, 409)
        self.assertNotIn('NOPE-1', self.text(task['path']))
        self.assertTrue(self.store.check()['ok'])


class StoreNewFilesTest(unittest.TestCase):
    """New file, duplicate and upload, on a copy of sample-vault (folder per type) that must keep matching."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.join(os.path.realpath(tmp.name), 'v')
        shutil.copytree(SAMPLE, self.root)
        self.store = Store(self.root, enforce_structure=True)
        os.makedirs(os.path.join(self.root, 'notes', 'drafts'))

    def text(self, rel):
        with open(os.path.join(self.root, rel), encoding='utf-8') as f:
            return f.read()

    def test_a_new_markdown_file_starts_with_its_name_and_never_overwrites(self):
        self.assertEqual(self.store.create_file('notes/drafts/Idea nueva.md'), {'path': 'notes/drafts/Idea nueva.md'})
        self.assertEqual(self.text('notes/drafts/Idea nueva.md'), '# Idea nueva\n')
        self.store.create_file('notes/drafts/script.py', 'print(1)\n')
        self.assertEqual(self.text('notes/drafts/script.py'), 'print(1)\n')
        for path, status in (('notes/drafts/Idea nueva.md', 409), ('notes/nope/x.md', 404), ('notes/drafts/.hidden', 400),
                             ('../x.md', 400)):
            with self.subTest(path=path), self.assertRaises(StoreError) as e:
                self.store.create_file(path)
            self.assertEqual(e.exception.status, status)
        self.assertTrue(self.store.check()['ok'])

    def test_duplicate_names_the_copy_and_refuses_an_items_file(self):
        self.store.create_file('notes/drafts/plan.md', 'v1')
        self.assertEqual(self.store.duplicate_file('notes/drafts/plan.md')['path'], 'notes/drafts/plan copy.md')
        self.assertEqual(self.store.duplicate_file('notes/drafts/plan.md')['path'], 'notes/drafts/plan copy 2.md')
        self.assertEqual(self.text('notes/drafts/plan copy 2.md'), 'v1')
        task = next(it for it in self.store.items() if it['type'] == 'task')
        with self.assertRaises(StoreError) as e:
            self.store.duplicate_file(task['path'])
        self.assertEqual(e.exception.status, 409)
        self.assertTrue(self.store.check()['ok'])

    def test_upload_keeps_its_name_or_takes_a_free_one(self):
        self.assertEqual(self.store.upload_file('notes/drafts', 'shot.png', b'\x89PNG')['path'], 'notes/drafts/shot.png')
        self.assertEqual(self.store.upload_file('notes/drafts', 'shot.png', b'2')['path'], 'notes/drafts/shot (2).png')
        self.assertEqual(self.store.upload_file('', 'root.txt', b'x')['path'], 'root.txt')
        with open(os.path.join(self.root, 'notes/drafts/shot.png'), 'rb') as f:
            self.assertEqual(f.read(), b'\x89PNG')
        for folder, name, status in (('notes/nope', 'a.txt', 404), ('notes/drafts', '.env', 400), ('notes/drafts', '', 400)):
            with self.subTest(name=name), self.assertRaises(StoreError) as e:
                self.store.upload_file(folder, name, b'x')
            self.assertEqual(e.exception.status, status)


class StoreSearchFilesTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        self.store = Store(self.root)
        write(self.root, 'notes/a.md', '# Ideas\nRevisar la Campaña de verano\notra línea\n')
        write(self.root, 'code/x.js', 'const campana = 1;\n')
        write(self.root, '.obsidian/hidden.md', 'campaña oculta')
        with open(os.path.join(self.root, 'code', 'bin.dat'), 'wb') as f:
            f.write(b'campa\x00na')

    def test_finds_lines_across_text_files_case_and_accents_aside(self):
        out = self.store.search_files('CAMPANA')
        self.assertEqual([(r['path'], r['line']) for r in out['results']], [('code/x.js', 1), ('notes/a.md', 2)])
        self.assertEqual(out['results'][1]['text'], 'Revisar la Campaña de verano')
        self.assertEqual(out['files'], 2)
        self.assertFalse(out['truncated'])

    def test_too_short_a_query_is_refused(self):
        with self.assertRaises(StoreError):
            self.store.search_files(' a ')

    def test_backlinks_are_the_markdown_files_with_a_wikilink_to_it(self):
        write(self.root, 'notes/Plan Q4.md', '# Plan')
        write(self.root, 'notes/b.md', 'see [[plan q4]] and\nagain [[Plan Q4#Goals|the goals]]\n')
        write(self.root, 'notes/c.md', 'related_to: "[[Plan Q4]]"\n')
        write(self.root, 'notes/d.md', 'not [[Plan Q40]] nor Plan Q4\n')
        write(self.root, 'code/e.txt', '[[Plan Q4]] in a text file')
        out = self.store.backlinks('notes/Plan Q4.md')
        self.assertEqual([(l['path'], l['line'], l['count']) for l in out['links']], [('notes/b.md', 1, 2), ('notes/c.md', 1, 1)])


class HttpFilesTest(unittest.TestCase):
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
        write(tmp.name, 'docs/nota ñ.txt', 'hola')

    def get(self, path, headers=None):
        req = Request(self.base + path, headers={'X-TM-Vault': self.vault, **(headers or {})})
        try:
            with urlopen(req) as res:
                return res.status, dict(res.headers), res.read()
        except HTTPError as e:
            with e:
                return e.code, dict(e.headers), e.read()

    def test_lists_the_vault(self):
        status, _, body = self.get('/api/files')
        self.assertEqual(status, 200, body)
        self.assertIn('docs/nota ñ.txt', [e['path'] for e in json.loads(body)['entries']])

    def test_serves_a_file_as_attachments_are_served(self):
        url = f"/api/files/raw?vault={self.vault}&path={quote('docs/nota ñ.txt')}"
        status, headers, body = self.get(url, {'Sec-Fetch-Site': 'same-origin'})
        self.assertEqual((status, body), (200, b'hola'))
        self.assertEqual((headers['X-Content-Type-Options'], headers['Cross-Origin-Resource-Policy'], headers['Content-Security-Policy']),
                         ('nosniff', 'same-origin', 'sandbox'))
        self.assertEqual(self.get(url, {'Sec-Fetch-Site': 'cross-site'})[0], 403)
        self.assertEqual(self.get(f'/api/files/raw?vault={self.vault}&path=..%2Fx')[0], 400)

    def test_the_raw_file_names_its_rev_and_a_save_against_it_lands(self):
        url = f"/api/files/raw?vault={self.vault}&path={quote('docs/nota ñ.txt')}"
        rev = self.get(url, {'Sec-Fetch-Site': 'same-origin'})[1]['X-TM-Rev']
        body = json.dumps({'path': 'docs/nota ñ.txt', 'text': 'adiós', 'base_rev': rev}).encode()
        req = Request(self.base + '/api/files/save', data=body, method='POST',
                      headers={'X-TM-Vault': self.vault, 'X-Task-Manager': '1', 'Content-Type': 'application/json'})
        with urlopen(req) as res:
            out = json.loads(res.read())
        self.assertNotEqual(out['rev'], rev)
        self.assertEqual(self.get(url, {'Sec-Fetch-Site': 'same-origin'})[2], 'adiós'.encode())


if __name__ == '__main__':
    unittest.main()
