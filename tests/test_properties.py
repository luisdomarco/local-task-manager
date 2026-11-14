"""The Properties section (Store.properties and its writes, /api/properties): every frontmatter key of the vault's
notes, renamed, its values renamed or merged, or removed — in the notes that do not keep it for the app, each file
rewritten only on that key's line."""
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server
from tm.store import Store, StoreError

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(APP_DIR, 'tools'))
from serve_sample import SAMPLE_VAULT, copy_sample  # noqa: E402

TASK = 'Tasks/TSK-9 Map the current checkout steps.md'
BOOK = 'Docs/Reading/A book.md'
LINK = 'Docs/Reading/A link.md'
DOC = 'Docs/Reading/A doc.md'
BOOK_TEXT = ('---\ncategory: Books   # where it goes\nrating: 4\nread: true\nrelated:\n  - "[[A link]]"\n  - Shelf\n'
             'url: https://a.example\n---\n# A book\n\nText.\n')
LINK_TEXT = '---\ncategory: books\nrelated: [Shelf, Desk]\nnote: kept\n---\nBody.\n'
DOC_TEXT = '---\nfileClass: Doc\ndoc_status: draft\nowner: "[[Ana]]"\ncategory: Guides\n---\n# A doc\n'


def write(root, rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def read(root, rel):
    with open(os.path.join(root, rel), encoding='utf-8') as f:
        return f.read()


class PropertiesBase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = tmp.name
        self.root = os.path.realpath(copy_sample(SAMPLE_VAULT, os.path.join(self.tmp, 'vault')))
        env = mock.patch.dict(os.environ, {'TM_CACHE_DIR': os.path.join(self.tmp, 'cache')})
        env.start()
        self.addCleanup(env.stop)
        write(self.root, BOOK, BOOK_TEXT)
        write(self.root, LINK, LINK_TEXT)
        write(self.root, DOC, DOC_TEXT)
        # An item with a key the structure does not declare: still the item's (its card edits it), never changed here
        task = read(self.root, TASK)
        self.task = task.replace('due: 2026-11-11\n', 'due: 2026-11-11\ncategory: Books\n')
        write(self.root, TASK, self.task)
        self.s = Store(self.root, structure='ticketing')

    def prop(self, out, key):
        return next((p for p in out['properties'] if p['key'] == key), None)


class ReadTest(PropertiesBase):
    def test_lists_each_key_with_its_notes_and_values(self):
        out = self.s.properties()
        cat = self.prop(out, 'category')
        self.assertEqual(cat['count'], 4)  # the book, the link, the doc and the task
        self.assertEqual(cat['kept'], 1)  # the task's: an item's file is the item's
        self.assertEqual({v['value']: v['count'] for v in cat['values']}, {'Books': 1, 'books': 1, 'Guides': 1})  # where it can change
        related = self.prop(out, 'related')
        self.assertEqual(related['values'][0], {'value': 'Shelf', 'count': 2})  # a list's items one by one
        self.assertEqual(related['sample'], ['[[A link]]', 'Shelf'])
        self.assertEqual(self.prop(out, 'rating')['sample'], 4)
        self.assertIs(self.prop(out, 'read')['sample'], True)
        self.assertEqual(self.prop(out, 'read')['values'], [{'value': 'true', 'count': 1}])
        self.assertGreater(out['notes'], 4)

    def test_counts_where_the_app_keeps_a_key(self):
        out = self.s.properties()
        url = self.prop(out, 'url')
        self.assertGreater(url['kept'], 0)  # the tasks' url is their field
        self.assertLess(url['kept'], url['count'])  # the book's is free
        self.assertEqual(self.prop(out, 'doc_status')['kept'], self.prop(out, 'doc_status')['count'])
        self.assertEqual(self.prop(out, 'fileClass')['kept'], self.prop(out, 'fileClass')['count'])
        status = self.prop(out, 'status_ticket')  # kept everywhere: its values are still listed, to read
        self.assertEqual(status['kept'], status['count'])
        self.assertTrue(status['values'])


class RenameKeyTest(PropertiesBase):
    def test_renames_in_place_in_every_note_that_does_not_keep_it(self):
        out = self.s.rename_property('category', 'section')
        self.assertEqual((out['changed'], out['kept'], out['clashed']), (3, 1, 0))
        self.assertEqual(read(self.root, BOOK), BOOK_TEXT.replace('category: Books', 'section: Books'))  # comment kept
        self.assertEqual(read(self.root, TASK), self.task)  # the item's: left
        self.assertEqual(self.prop(out, 'category')['count'], 1)
        self.assertEqual(self.prop(out, 'section')['count'], 3)

    def test_leaves_the_structures_key_in_an_item(self):
        out = self.s.rename_property('url', 'link')
        self.assertEqual(out['changed'], 1)  # the book
        self.assertGreater(out['kept'], 0)
        self.assertIn('url: ""', read(self.root, TASK))
        self.assertIn('link: https://a.example', read(self.root, BOOK))

    def test_never_onto_a_key_the_note_keeps_or_already_has(self):
        write(self.root, LINK, LINK_TEXT.replace('note: kept', 'section: x'))
        out = self.s.rename_property('category', 'owner')  # a doc's owner is its field: the doc is left
        self.assertEqual((out['changed'], out['kept'], out['clashed']), (2, 1, 1))
        self.assertEqual(read(self.root, DOC), DOC_TEXT)
        self.assertIn('owner: Books', read(self.root, BOOK))
        out = self.s.rename_property('owner', 'section')  # the link has a section already: never two of one key
        self.assertEqual((out['changed'], out['kept'], out['clashed']), (1, 1, 1))
        self.assertIn('owner: books\n', read(self.root, LINK))
        self.assertIn('section: Books', read(self.root, BOOK))

    def test_refuses_a_bad_name_and_a_missing_key(self):
        for bad in ('', '1st', 'a b', 'x:y'):
            with self.assertRaises(StoreError) as e:
                self.s.rename_property('category', bad)
            self.assertEqual(e.exception.status, 400, bad)
        with self.assertRaises(StoreError) as e:
            self.s.rename_property('nothing_has_it', 'x')
        self.assertEqual(e.exception.status, 404)


class ValuesTest(PropertiesBase):
    def test_renames_a_value_and_merges_it_into_a_list(self):
        out = self.s.rename_property_value('related', 'Shelf', 'Desk')
        self.assertEqual(out['changed'], 2)
        self.assertIn('related: ["[[A link]]", "Desk"]\nurl:', read(self.root, BOOK))  # the block list as one line
        self.assertIn('related: ["Desk"]', read(self.root, LINK))  # Shelf onto Desk, which it had: merged
        self.assertTrue(read(self.root, LINK).endswith('note: kept\n---\nBody.\n'))

    def test_a_scalar_keeps_its_line_and_its_type(self):
        self.s.rename_property_value('category', 'Books', 'Library')
        self.assertEqual(read(self.root, BOOK), BOOK_TEXT.replace('category: Books   # where it goes', 'category: Library # where it goes'))  # the comment at its column
        self.assertIn('category: books\n', read(self.root, LINK))  # another value, case and all
        self.s.rename_property_value('rating', '4', '5')
        self.assertIn('rating: 5\n', read(self.root, BOOK))  # a number stays a number
        self.s.rename_property_value('read', 'true', 'false')
        self.assertIn('read: false\n', read(self.root, BOOK))

    def test_refuses_empty_and_same(self):
        for old, new in (('Books', ''), ('', 'x'), ('Books', 'Books')):
            with self.assertRaises(StoreError) as e:
                self.s.rename_property_value('category', old, new)
            self.assertEqual(e.exception.status, 400)


class DeleteTest(PropertiesBase):
    def test_removes_the_key_where_it_is_free_only(self):
        out = self.s.delete_property('url')
        self.assertEqual(out['changed'], 1)
        self.assertEqual(read(self.root, BOOK), BOOK_TEXT.replace('url: https://a.example\n', ''))
        self.assertIn('url: ""', read(self.root, TASK))

    def test_a_doc_keeps_its_own_fields(self):
        out = self.s.delete_property('doc_status')
        self.assertEqual(out['changed'], 0)
        self.assertEqual(read(self.root, DOC), DOC_TEXT)
        self.s.delete_property('category')
        self.assertEqual(read(self.root, DOC), DOC_TEXT.replace('category: Guides\n', ''))
        self.assertEqual(read(self.root, TASK), self.task)  # the item's

    def test_the_items_read_the_same_after(self):
        before = {it['id']: {k: v for k, v in it['fields'].items() if k != 'category'} for it in self.s.items()}
        self.s.delete_property('category')
        after = {it['id']: {k: v for k, v in it['fields'].items() if k != 'category'} for it in self.s.items()}
        self.assertEqual(before, after)


class RoutesTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(copy_sample(SAMPLE_VAULT, os.path.join(tmp.name, 'vault')))
        write(self.root, BOOK, BOOK_TEXT)
        cfg = os.path.join(tmp.name, 'config.json')
        with open(cfg, 'w', encoding='utf-8') as f:
            json.dump({'root': self.root, 'default_vault': 's', 'vaults': [{'id': 's', 'name': 'S', 'path': self.root, 'structure': 'ticketing'}]}, f)
        for patcher in (mock.patch.object(server, 'CONFIG_PATH', cfg),
                        mock.patch.dict(os.environ, {'TM_CACHE_DIR': os.path.join(tmp.name, 'cache')})):
            patcher.start()
            self.addCleanup(patcher.stop)
        app = mock.patch.object(server, 'APP', server.App())  # made once the config above is the one it reads
        app.start()
        self.addCleanup(app.stop)
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.base = f'http://127.0.0.1:{self.httpd.server_address[1]}'
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)

    def request(self, path, body=None, header=True):
        headers = {'Content-Type': 'application/json', 'X-TM-Vault': 's'}
        if header:
            headers['X-Task-Manager'] = '1'
        req = Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with urlopen(req) as res:
                return res.status, json.loads(res.read())
        except HTTPError as e:
            with e:
                return e.code, json.loads(e.read())

    def test_list_rename_value_and_delete(self):
        code, out = self.request('/api/properties')
        self.assertEqual(code, 200)
        self.assertIn('rating', [p['key'] for p in out['properties']])
        code, _ = self.request('/api/properties/rename', {'key': 'rating', 'new': 'stars'}, header=False)
        self.assertEqual(code, 403)  # every POST needs the header
        code, out = self.request('/api/properties/rename', {'key': 'rating', 'new': 'stars'})
        self.assertEqual((code, out['changed']), (200, 1))
        code, out = self.request('/api/properties/value', {'key': 'stars', 'old': '4', 'new': '5'})
        self.assertEqual((code, out['changed']), (200, 1))
        self.assertIn('stars: 5\n', read(self.root, BOOK))
        code, out = self.request('/api/properties/delete', {'key': 'stars'})
        self.assertEqual((code, out['changed']), (200, 1))
        self.assertNotIn('stars', read(self.root, BOOK))
        code, out = self.request('/api/properties/delete', {'key': 'stars'})
        self.assertEqual(code, 404)


if __name__ == '__main__':
    unittest.main()
