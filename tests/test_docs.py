"""Docs (TSK-039), phase 0: the structures know their Docs folders — documents, never items. A vault with them still
matches; nothing in them is scanned as an item; an item is never moved into one; a project's first docs root is made
in one go; and the page can ask where they are (docs_roots)."""

import os
import tempfile
import unittest
from datetime import date

from tm import frontmatter as fm
from tm.store import Store, StoreError

TICKET = '''---
fileClass: Ticket Task
id: "TSK-009"
name: "a-mano"
status_ticket: "1. Backlog"
---

# TSK-009 — A mano
'''
DOC = '''---
fileClass: Doc
project: "[[00 Internal Tools]]"
doc_status: draft
---

# Visión

Ver [[Arquitectura]].
'''


def write(root, rel, text='x'):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def read(root, rel):
    with open(os.path.join(root, rel), encoding='utf-8') as f:
        return f.read()


class TicketingDocsTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        for d in ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log'):
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.hb = self.s.create('project', 'Internal Tools', {'project_key': 'HB', 'project_kind': 'system'})
        self.task = self.s.create('task', 'Revisar', {'project': 'HB'})

    def test_docs_folders_match_and_hold_no_items(self):
        before = sorted(i['key'] for i in self.s.items())
        write(self.root, 'Docs/General/Glosario.md', '# Glosario')
        write(self.root, 'Internal Tools/Docs/Producto/Visión.md', DOC)
        write(self.root, 'Internal Tools/Docs/Producto/diagrama.png')
        write(self.root, 'Internal Tools/Docs/Producto/Onboarding/Paso 1.md', '# sin frontmatter')
        check = self.s.check()
        self.assertTrue(check['ok'], check)
        self.assertEqual([w for w in check['warnings'] if 'Docs' in w['path']], [])  # no "untyped", no "not markdown"
        self.assertEqual(sorted(i['key'] for i in self.s.items()), before)  # the docs added no item

    def test_a_ticket_left_in_docs_is_pointed_out_and_not_shown(self):
        write(self.root, 'Internal Tools/Docs/TSK-009 A mano.md', TICKET)
        check = self.s.check()
        self.assertTrue(check['ok'], check)  # a warning, not blocking: the vault still opens
        self.assertIn(('item_in_docs', 'Internal Tools/Docs/TSK-009 A mano.md'), [(w['kind'], w['path']) for w in check['warnings']])
        self.assertNotIn('TSK-009', [i['id'] for i in self.s.items()])

    def test_docs_only_in_a_project_or_at_the_top(self):
        os.makedirs(os.path.join(self.root, 'Tasks', 'Docs'))  # inside a type's folder it is not a Docs folder
        write(self.root, 'Tasks/Docs/TSK-010 Escondida.md', TICKET.replace('TSK-009', 'TSK-010'))
        self.assertIn('TSK-010', [i['id'] for i in self.s.items()])  # still scanned: Tasks/Docs is not a Docs folder

    def test_an_item_is_never_moved_into_docs(self):
        self.s.make_folder('Internal Tools/Docs/Producto', parents=True)
        with self.assertRaises(StoreError) as cm:
            self.s.move_path(self.task['path'], 'Internal Tools/Docs/Producto')
        self.assertEqual(cm.exception.status, 409)
        self.assertIn('TSK-001', str(cm.exception))
        self.assertTrue(os.path.isfile(os.path.join(self.root, self.task['path'])))  # nothing moved
        write(self.root, 'Docs/Suelto.md', '# suelto')
        self.assertEqual(self.s.move_path('Docs/Suelto.md', 'Internal Tools/Docs/Producto')['path'],
                         'Internal Tools/Docs/Producto/Suelto.md')  # a doc moves freely between Docs folders

    def test_a_project_s_first_root_is_made_in_one_go(self):
        with self.assertRaises(StoreError) as cm:
            self.s.make_folder('Internal Tools/Docs/Producto')
        self.assertEqual(cm.exception.status, 404)  # without parents, as before
        self.assertEqual(self.s.make_folder('Internal Tools/Docs/Producto', parents=True), {'path': 'Internal Tools/Docs/Producto'})
        self.assertTrue(os.path.isdir(os.path.join(self.root, 'Internal Tools/Docs/Producto')))
        with self.assertRaises(StoreError):  # anywhere the structure does not allow: refused, and nothing is left behind
            self.s.make_folder('Otra/Cosa', parents=True)
        self.assertFalse(os.path.exists(os.path.join(self.root, 'Otra')))

    def test_docs_roots_lists_each_project_and_the_vault(self):
        self.s.create('project', 'Acme Web', {'project_key': 'ECD', 'project_kind': 'product'})
        self.s.make_folder('Internal Tools/Docs/Producto', parents=True)
        self.s.make_folder('Internal Tools/Docs/Arquitectura')
        self.s.make_folder('Docs/General', parents=True)
        got = [(c['project'], c['title'], c['path'], c['exists'], c['roots']) for c in self.s.docs_roots()]
        self.assertEqual(got, [
            ('ECD', 'Acme Web', 'Acme Web/Docs', False, []),
            ('HB', 'Internal Tools', 'Internal Tools/Docs', True, ['Arquitectura', 'Producto']),
            (None, '', 'Docs', True, ['General']),
        ])

    def test_renaming_a_doc_rewrites_links_in_other_docs(self):
        write(self.root, 'Internal Tools/Docs/Producto/Arquitectura.md', '# Arquitectura')
        write(self.root, 'Internal Tools/Docs/Producto/Visión.md', DOC)
        self.s.rename_path('Internal Tools/Docs/Producto/Arquitectura.md', 'Arquitectura general.md')
        self.assertIn('[[Arquitectura general]]', read(self.root, 'Internal Tools/Docs/Producto/Visión.md'))


class DocPropertiesTest(unittest.TestCase):
    """Phase 1b: a doc's own properties (plans/TSK-039 §3.6), edited from its page; its project is where it is."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        for d in ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log'):
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.s.create('project', 'Internal Tools', {'project_key': 'HB', 'project_kind': 'system'})
        self.s.create('project', 'Acme Web', {'project_key': 'ECD', 'project_kind': 'product'})
        write(self.root, 'Internal Tools/Docs/Producto/Onboarding/Visión.md', DOC)
        self.doc = 'Internal Tools/Docs/Producto/Onboarding/Visión.md'
        self.today = date.today().isoformat()

    def fields(self, rel):
        return fm.parse(fm.split(read(self.root, rel))[0])

    def test_status_owner_and_tags_are_written_and_dated(self):
        out = self.s.update_doc(self.doc, {'doc_status': 'published', 'owner': 'Ana', 'tags': [' #ux', 'ux', 'onboarding', '']})
        self.assertEqual(out['path'], self.doc)
        f = self.fields(self.doc)
        self.assertEqual((f['doc_status'], f['owner'], f['tags'], f['updated_date']), ('published', '[[Ana]]', ['ux', 'onboarding'], self.today))
        self.assertIn('Ver [[Arquitectura]].', read(self.root, self.doc))  # the body is untouched
        self.s.update_doc(self.doc, {'owner': ''})
        self.assertEqual(self.fields(self.doc)['owner'], '')

    def test_changing_its_project_moves_it_there_keeping_its_place(self):
        out = self.s.update_doc(self.doc, {'project': 'ECD'})
        self.assertEqual(out['path'], 'Acme Web/Docs/Producto/Onboarding/Visión.md')  # its Docs folder made too
        self.assertFalse(os.path.exists(os.path.join(self.root, self.doc)))
        self.assertEqual(self.fields(out['path'])['project'], '[[00 Acme Web]]')
        self.assertTrue(self.s.check()['ok'])
        back = self.s.update_doc(out['path'], {'project': None})
        self.assertEqual(back['path'], 'Docs/Producto/Onboarding/Visión.md')
        self.assertEqual(self.fields(back['path'])['project'], '')

    def test_what_is_refused(self):
        for path, values, status in [
            ('Tasks/x.md', {'doc_status': 'draft'}, 404),          # not in a Docs folder
            (self.doc, {'doc_status': 'final'}, 400),
            (self.doc, {'tags': 'ux'}, 400),
            (self.doc, {'project': 'NOPE'}, 400),
        ]:
            with self.subTest(values=values), self.assertRaises(StoreError) as cm:
                self.s.update_doc(path, values)
            self.assertEqual(cm.exception.status, status)
        write(self.root, 'Acme Web/Docs/Producto/Onboarding/Visión.md', '# taken')
        with self.assertRaises(StoreError) as cm:
            self.s.update_doc(self.doc, {'project': 'ECD'})
        self.assertEqual(cm.exception.status, 409)  # never over another doc
        with self.assertRaises(StoreError) as cm:
            self.s.update_doc(self.doc, {'doc_status': 'draft'}, base_rev='stale')
        self.assertEqual(cm.exception.status, 409)

    def test_a_doc_without_frontmatter_gets_one(self):
        write(self.root, 'Docs/Suelto.md', '# Suelto\n')
        self.s.update_doc('Docs/Suelto.md', {'doc_status': 'draft'})
        f = self.fields('Docs/Suelto.md')
        self.assertEqual((f['fileClass'], f['doc_status']), ('Doc', 'draft'))

    def test_saving_a_doc_dates_it_and_nothing_else(self):
        text = read(self.root, self.doc)
        self.s.save_file(self.doc, text.replace('Ver [[Arquitectura]].', 'Ver [[Arquitectura]] y más.'))
        self.assertEqual(self.fields(self.doc)['updated_date'], self.today)
        write(self.root, 'Internal Tools/Docs/Producto/plain.md', '# plain\n')  # no Doc frontmatter: left as written
        self.s.save_file('Internal Tools/Docs/Producto/plain.md', '# plain\n\nmore\n')
        self.assertEqual(read(self.root, 'Internal Tools/Docs/Producto/plain.md'), '# plain\n\nmore\n')


class DocsOrderTest(unittest.TestCase):
    """Phase 2: a Docs folder keeps the order its entries were dragged in (.order), and only a Docs folder does."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        for d in ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log'):
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.s.create('project', 'Internal Tools', {'project_key': 'HB', 'project_kind': 'system'})
        for name in ('A.md', 'B.md', 'C.md'):
            write(self.root, f'Docs/Producto/{name}', f'# {name}')
        write(self.root, 'Docs/Otra/D.md', '# D')

    def order_of(self, folder):
        return next((e.get('order') for e in self.s.files()['entries'] if e['path'] == folder), 'missing')

    def test_an_order_is_kept_listed_and_cleaned(self):
        self.assertIsNone(self.order_of('Docs/Producto'))  # none until dragged
        out = self.s.set_order('Docs/Producto', ['C.md', 'A.md', 'gone.md', 'C.md', '.order'])
        self.assertEqual(out['order'], ['C.md', 'A.md'])  # names not there, repeats and hidden ones dropped
        self.assertEqual(self.order_of('Docs/Producto'), ['C.md', 'A.md'])
        self.assertNotIn('Docs/Producto/.order', [e['path'] for e in self.s.files()['entries']])  # hidden, like .obsidian
        self.assertTrue(self.s.check()['ok'])
        self.s.set_order('Docs/Producto', [])
        self.assertFalse(os.path.exists(os.path.join(self.root, 'Docs/Producto/.order')))

    def test_only_a_docs_folder_has_one(self):
        for folder in ('Tasks', 'Internal Tools', '', 'Docs/Nope'):
            with self.subTest(folder=folder), self.assertRaises(StoreError):
                self.s.set_order(folder, ['x'])
        with self.assertRaises(StoreError):
            self.s.move_path('Docs/Otra/D.md', 'Tasks', order=['D.md'])
        self.assertTrue(os.path.isfile(os.path.join(self.root, 'Docs/Otra/D.md')))  # refused before anything moved

    def test_moving_with_an_order_places_it_and_reordering_is_a_move_in_place(self):
        out = self.s.move_path('Docs/Otra/D.md', 'Docs/Producto', order=['A.md', 'D.md', 'B.md', 'C.md'])
        self.assertEqual(out['path'], 'Docs/Producto/D.md')
        self.assertEqual(self.order_of('Docs/Producto'), ['A.md', 'D.md', 'B.md', 'C.md'])
        self.s.move_path('Docs/Producto/C.md', 'Docs/Producto', order=['C.md', 'A.md', 'D.md', 'B.md'])
        self.assertEqual(self.order_of('Docs/Producto'), ['C.md', 'A.md', 'D.md', 'B.md'])

    def test_renaming_keeps_its_place(self):
        self.s.set_order('Docs/Producto', ['C.md', 'A.md', 'B.md'])
        self.s.rename_path('Docs/Producto/A.md', 'Alfa.md')
        self.assertEqual(self.order_of('Docs/Producto'), ['C.md', 'Alfa.md', 'B.md'])

    def test_the_order_travels_with_its_folder(self):
        self.s.set_order('Docs/Producto', ['B.md', 'A.md'])
        self.s.make_folder('Internal Tools/Docs', parents=True)
        self.s.move_path('Docs/Producto', 'Internal Tools/Docs')
        self.assertEqual(self.order_of('Internal Tools/Docs/Producto'), ['B.md', 'A.md'])


class DocsLinksTest(unittest.TestCase):
    """Phase 3: an initiative or a task links docs ([[a doc]]) and folders (a path/), and a folder that moves or is
    renamed from the app is followed; a doc renamed is followed by its [[links]] as anywhere else."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        for d in ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log'):
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.s.create('project', 'Internal Tools', {'project_key': 'HB', 'project_kind': 'system'})
        write(self.root, 'Docs/Producto/Onboarding/Paso 1.md', '# Paso 1')
        write(self.root, 'Docs/Producto/Visión.md', DOC)

    def test_links_are_kept_tidy_and_written_to_the_file(self):
        task = self.s.create('task', 'Revisar', {'docs': [' Visión.md ', '[[ Visión ]]', 'Docs/Producto/', '/Docs/Producto/Onboarding/', '']})
        self.assertEqual(task['fields']['docs'], ['[[Visión]]', 'Docs/Producto/', 'Docs/Producto/Onboarding/'])
        self.assertEqual(fm.parse(fm.split(read(self.root, task['path']))[0])['docs'], ['[[Visión]]', 'Docs/Producto/', 'Docs/Producto/Onboarding/'])
        ini = self.s.create('initiative', 'Curación', {'project': 'HB', 'docs': ['Docs/Producto/']})
        self.assertEqual(self.s.read(ini['key'])['fields']['docs'], ['Docs/Producto/'])
        note = self.s.create('note', 'Idea', {'docs': ['Visión']})
        self.assertNotIn('docs', note['fields'])  # only initiatives and tasks link docs
        for bad in ('Visión', [1], ['../fuera/'], ['/']):
            with self.subTest(bad=bad), self.assertRaises(StoreError):
                self.s.update(task['key'], {'docs': bad})

    def test_a_folder_renamed_or_moved_is_followed_and_backed_up(self):
        task = self.s.create('task', 'Revisar', {'docs': ['[[Visión]]', 'Docs/Producto/', 'Docs/Producto/Onboarding/', 'Docs/Otra/']})
        self.s.rename_path('Docs/Producto', 'Producto 2')
        self.assertEqual(self.s.read(task['key'])['fields']['docs'], ['[[Visión]]', 'Docs/Producto 2/', 'Docs/Producto 2/Onboarding/', 'Docs/Otra/'])
        backups = os.listdir(os.path.join(self.root, '.task-manager', 'backup'))
        self.assertTrue(any(b.endswith('-rename') for b in backups))
        self.s.make_folder('Internal Tools/Docs', parents=True)
        self.s.move_path('Docs/Producto 2', 'Internal Tools/Docs')
        self.assertEqual(self.s.read(task['key'])['fields']['docs'][1:3],
                         ['Internal Tools/Docs/Producto 2/', 'Internal Tools/Docs/Producto 2/Onboarding/'])

    def test_a_doc_renamed_is_followed_by_its_links(self):
        task = self.s.create('task', 'Revisar', {'docs': ['[[Visión]]']})
        self.s.rename_path('Docs/Producto/Visión.md', 'Visión general.md')
        self.assertEqual(self.s.read(task['key'])['fields']['docs'], ['[[Visión general]]'])


class NoteToDocTest(unittest.TestCase):
    """Phase 4: a note becomes a doc — its text in a Docs folder, its links following it, the note in the trash."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        for d in ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log'):
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.s.create('project', 'Internal Tools', {'project_key': 'HB', 'project_kind': 'system'})
        self.task = self.s.create('task', 'Revisar', {'project': 'HB'})
        self.note = self.s.create('note', 'Idea: menús', {'related_to': self.task['key'], 'labels': ['ux']}, body='Texto de la idea.\n')

    def test_a_note_becomes_a_doc_and_its_links_follow(self):
        stem = os.path.splitext(os.path.basename(self.note['path']))[0]
        write(self.root, 'Docs/Otra.md', f'Ver [[{stem}]].\n')
        out = self.s.note_to_doc(self.note['key'], 'Internal Tools/Docs/Ideas')
        self.assertEqual(out['path'], 'Internal Tools/Docs/Ideas/Idea menús.md')  # its title, made a usable name
        text = read(self.root, out['path'])
        f = fm.parse(fm.split(text)[0])
        self.assertEqual((f['fileClass'], f['project'], f['doc_status'], f['tags']), ('Doc', '[[00 Internal Tools]]', 'draft', ['ux']))
        self.assertIn('Texto de la idea.', text)
        self.assertEqual(read(self.root, 'Docs/Otra.md'), 'Ver [[Idea menús]].\n')  # rewritten (and backed up)
        self.assertEqual(self.s.read(self.task['key'])['fields']['docs'], ['[[Idea menús]]'])  # the item it hung from links it
        self.assertNotIn(self.note['key'], [i['key'] for i in self.s.items()])
        self.assertTrue(os.listdir(os.path.join(self.root, '.task-manager', 'trash')))  # restorable
        self.assertTrue(self.s.check()['ok'])

    def test_what_is_refused(self):
        with self.assertRaises(StoreError):
            self.s.note_to_doc(self.task['key'], 'Docs/Ideas')  # only a note
        for folder in ('Tasks', '', 'Internal Tools/Initiatives'):
            with self.subTest(folder=folder), self.assertRaises(StoreError):
                self.s.note_to_doc(self.note['key'], folder)
        self.assertIn(self.note['key'], [i['key'] for i in self.s.items()])  # still a note


class FolderPerTypeDocsTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(tmp.name)
        self.s = Store(self.root, enforce_structure=True)
        for rel in self.s.folders.values():
            os.makedirs(os.path.join(self.root, rel), exist_ok=True)
        self.task = self.s.create('task', 'Primera')

    def test_the_docs_folder_matches_and_holds_no_items(self):
        write(self.root, 'docs/Producto/Visión.md', DOC)
        write(self.root, 'docs/Producto/tasks/TSK-0099-a-mano.md', '---\ntype: task\nid: TSK-0099\nsubject: A mano\n---\n')
        check = self.s.check()
        self.assertTrue(check['ok'], check)
        self.assertEqual([(w['kind'], w['path']) for w in check['warnings'] if w['path'].startswith('docs')],
                         [('item_in_docs', 'docs/Producto/tasks/TSK-0099-a-mano.md')])
        self.assertEqual([i['id'] for i in self.s.items()], ['TSK-0001'])
        self.assertEqual([(c['project'], c['path'], c['roots']) for c in self.s.docs_roots()], [(None, 'docs', ['Producto'])])

    def test_a_folder_with_items_is_never_moved_into_docs(self):
        self.s.make_folder('docs', parents=True)
        os.makedirs(os.path.join(self.root, 'tasks', 'sub'))
        os.rename(os.path.join(self.root, self.task['path']), os.path.join(self.root, 'tasks', 'sub', os.path.basename(self.task['path'])))
        with self.assertRaises(StoreError) as cm:
            self.s.move_path('tasks/sub', 'docs')
        self.assertEqual(cm.exception.status, 409)
        self.assertTrue(os.path.isdir(os.path.join(self.root, 'tasks', 'sub')))

    def test_initiatives_stories_and_tasks_link_docs(self):
        ini = self.s.create('initiative', 'Plan', {'docs': ['docs/Producto/', 'Visión']})
        story = self.s.create('story', 'Historia', {'docs': ['[[Visión]]']})
        self.assertEqual((ini['fields']['docs'], story['fields']['docs']), (['docs/Producto/', '[[Visión]]'], ['[[Visión]]']))
        os.makedirs(os.path.join(self.root, 'docs', 'Producto'))
        self.s.rename_path('docs/Producto', 'Producto 2')
        self.assertEqual(self.s.read(ini['key'])['fields']['docs'], ['docs/Producto 2/', '[[Visión]]'])

    def test_nothing_is_restored_into_docs(self):
        self.s.make_folder('docs')
        trashed = self.s.delete(self.task['key'])['trashed']
        with self.assertRaises(StoreError):
            self.s.restore(trashed, 'docs/TSK-0001.md')


if __name__ == '__main__':
    unittest.main()
