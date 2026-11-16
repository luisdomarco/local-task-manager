"""Comments as files (TSK-128, tm/comments.py): in a Projects vault each comment is `Comments/<ref>/<at>.md`, its item's
file never touched; a legacy vault keeps them in the item's frontmatter, as before."""
import os
import tempfile
import unittest
from unittest import mock

from tm import comments
from tm import frontmatter as fm
from tm.store import Store, StoreError

ROOT_FOLDERS = ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log')


def read(root, rel):
    with open(os.path.join(root, rel), encoding='utf-8') as f:
        return f.read()


def write(root, rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


class ModuleTest(unittest.TestCase):
    def test_a_moment_names_its_file_and_back(self):
        self.assertEqual(comments.stem_of('2026-11-16T09:23:45.123'), '2026-11-16T09-23-45-123')
        self.assertEqual(comments.at_of('2026-11-16T09-23-45-123'), '2026-11-16T09:23:45.123')
        # one from before, to the minute or the second, gets zeros
        self.assertEqual(comments.stem_of('2026-11-16T09:23'), '2026-11-16T09-23-00-000')
        self.assertEqual(comments.stem_of('2026-11-16T09:23:05'), '2026-11-16T09-23-05-000')
        self.assertEqual(comments.next_at('2026-11-16T09:23:59.999'), '2026-11-16T09:24:00.000')
        self.assertIsNone(comments.at_of('notes'))
        with self.assertRaises(ValueError):
            comments.stem_of('yesterday')

    def test_two_in_one_millisecond_both_land(self):
        with tempfile.TemporaryDirectory() as d:
            a = comments.write_new(d, '[[X]]', 'one', 'owner', at='2026-11-16T09:23:45.123')
            b = comments.write_new(d, '[[X]]', 'two', 'owner', at='2026-11-16T09:23:45.123')
            self.assertEqual((a['id'], b['id']), ('2026-11-16T09-23-45-123', '2026-11-16T09-23-45-124'))
            self.assertEqual([c['text'] for c in comments.read_folder(d)], ['one', 'two'])


class FilesTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for d in ROOT_FOLDERS:
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.s.create('project', 'Internal Tools', {'project_key': 'HB'})
        self.task = self.s.create('task', 'Review the plan', {})

    def folder(self, it):
        return os.path.join(self.root, 'Comments', it['ref'])

    def test_a_comment_is_a_file_of_its_own(self):
        before = read(self.root, self.task['path'])
        out = self.s.add_comment(self.task['id'], 'Looks good, @[Ana]', by='owner')
        c = out['comment']
        self.assertEqual(read(self.root, self.task['path']), before)  # the item's file as it was
        rel = f"Comments/{self.task['ref']}/{c['id']}.md"
        head, body = fm.split(read(self.root, rel))
        f = fm.parse(head)
        stem = os.path.splitext(os.path.basename(self.task['path']))[0]
        self.assertEqual((f['fileClass'], f['item'], f['at'], f['by']), ('Comment', f'[[{stem}]]', c['at'], 'owner'))
        self.assertRegex(c['at'], r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$')
        self.assertEqual(body.strip(), 'Looks good, @[Ana]')
        self.assertEqual(self.s.item_comments(self.task['id'])['comments'], [{**c, 'by': 'owner'}])
        self.assertTrue(self.s.check()['ok'])

    def test_the_items_say_when_without_reading_one(self):
        a = self.s.add_comment(self.task['id'], 'one')['comment']
        b = self.s.add_comment(self.task['id'], 'two')['comment']
        it = self.s.with_comments(self.s.read(self.task['id']))
        self.assertEqual(it['comment_ats'], [a['at'], b['at']])
        rev = it['comments_rev']
        other = self.s.with_comments(self.s.items())
        self.assertNotIn('comment_ats', next(i for i in other if i['type'] == 'project'))  # none: nothing said
        # an edit (here, by hand: its file's time) moves the version on
        os.utime(os.path.join(self.folder(self.task), b['id'] + '.md'), ns=(1, 10 ** 19))
        self.assertNotEqual(self.s.with_comments(self.s.read(self.task['id']))['comments_rev'], rev)

    def test_editing_changes_its_text_and_edited_only(self):
        c = self.s.add_comment(self.task['id'], 'one')['comment']
        path = os.path.join(self.folder(self.task), c['id'] + '.md')
        before = fm.parse(fm.split(read(self.root, path))[0])
        self.s.edit_comment(self.task['id'], c['id'], 'one, edited', was='one')
        head, body = fm.split(read(self.root, path))
        after = fm.parse(head)
        self.assertEqual({k: v for k, v in after.items() if k != 'edited'}, before)
        self.assertTrue(after['edited'])
        self.assertEqual(body.strip(), 'one, edited')
        with self.assertRaises(StoreError) as e:  # edited by someone else meanwhile: never written over
            self.s.edit_comment(self.task['id'], c['id'], 'mine', was='one')
        self.assertEqual(e.exception.status, 409)
        with self.assertRaises(StoreError) as e:
            self.s.edit_comment(self.task['id'], '2020-01-01T00-00-00-000', 'x')
        self.assertEqual(e.exception.status, 404)

    def test_a_deleted_one_goes_to_the_trash_and_undo_brings_it_back(self):
        c = self.s.add_comment(self.task['id'], 'one')['comment']
        out = self.s.delete_comment(self.task['id'], c['id'])
        self.assertEqual(out['removed']['text'], 'one')
        self.assertEqual(self.s.item_comments(self.task['id'])['comments'], [])
        kept = os.path.join(self.root, '.task-manager', 'trash', 'comments', self.task['ref'], c['id'] + '.md')
        self.assertTrue(os.path.isfile(kept))
        self.s.restore_comment(self.task['id'], c['id'], out['removed'])
        self.assertEqual([x['text'] for x in self.s.item_comments(self.task['id'])['comments']], ['one'])
        self.assertFalse(os.path.exists(kept))
        with self.assertRaises(StoreError) as e:  # already there: never two of one
            self.s.restore_comment(self.task['id'], c['id'], out['removed'])
        self.assertEqual(e.exception.status, 409)
        # The trash emptied meanwhile: written again from what the page kept, its moment the same
        self.s.delete_comment(self.task['id'], c['id'])
        os.remove(kept)
        self.s.restore_comment(self.task['id'], c['id'], out['removed'])
        self.assertEqual(self.s.item_comments(self.task['id'])['comments'][0]['at'], c['at'])

    def test_one_still_in_the_frontmatter_is_read_only(self):
        path = os.path.join(self.root, self.task['path'])
        text = read(self.root, self.task['path'])
        write(self.root, self.task['path'], fm.patch(text, {'comments': [{'at': '2026-10-01T10:00', 'text': 'from before'}]}))
        new = self.s.add_comment(self.task['id'], 'new')['comment']
        got = self.s.item_comments(self.task['id'])['comments']
        self.assertEqual([(c['text'], c.get('legacy', False)) for c in got], [('from before', True), ('new', False)])
        with self.assertRaises(StoreError) as e:
            self.s.delete_comment(self.task['id'], got[0]['id'])
        self.assertEqual(e.exception.status, 409)
        self.assertIn('from before', read(self.root, self.task['path']))
        self.assertTrue(os.path.isfile(os.path.join(self.folder(self.task), new['id'] + '.md')))
        self.assertIn('comments_in_file', [w['kind'] for w in self.s.check()['warnings']])
        self.assertTrue(os.path.isfile(path))

    def test_a_converted_inbox_item_takes_its_comments(self):
        inbox = self.s.create('inbox', 'Call the bank', {})
        c = self.s.add_comment(inbox['id'], 'about the card')['comment']
        task = self.s.convert(inbox['id'], 'task')
        self.assertFalse(os.path.isdir(self.folder(inbox)))
        moved = self.s.item_comments(task['id'])['comments']
        self.assertEqual([(x['id'], x['text']) for x in moved], [(c['id'], 'about the card')])
        stem = os.path.splitext(os.path.basename(task['path']))[0]
        self.assertEqual(fm.parse(fm.split(read(self.folder(task), c['id'] + '.md'))[0])['item'], f'[[{stem}]]')

    def test_a_renamed_item_is_named_anew_in_its_comments(self):
        c = self.s.add_comment(self.task['id'], 'see [[Review the plan]]')['comment']
        out = self.s.update(self.task['id'], {'subject': 'Review the budget'})
        stem = os.path.splitext(os.path.basename(out['path']))[0]
        text = read(self.folder(self.task), c['id'] + '.md')
        self.assertEqual(fm.parse(fm.split(text)[0])['item'], f'[[{stem}]]')

    def test_a_deleted_item_keeps_them_for_its_restore_and_a_purge_takes_them(self):
        self.s.add_comment(self.task['id'], 'one')
        out = self.s.delete(self.task['id'])
        self.assertTrue(os.path.isdir(self.folder(self.task)))
        self.s.restore(out['trashed'], out['restore_to'])
        self.assertEqual(len(self.s.item_comments(self.task['id'])['comments']), 1)
        out = self.s.delete(self.task['id'])
        self.s.purge(out['trashed'])
        self.assertFalse(os.path.exists(self.folder(self.task)))

    def test_a_person_renamed_is_renamed_in_the_comments(self):
        c = self.s.add_comment(self.task['id'], 'Ask @[Ana] first')['comment']
        self.s._rename_mentions('Ana', 'Ana López')
        self.assertIn('Ask @[Ana López] first', read(self.folder(self.task), c['id'] + '.md'))

    def test_what_is_not_a_comment_is_pointed_out_never_blocking(self):
        write(self.root, 'Comments/TSK-999/2026-11-16T09-00-00-000.md', '---\nfileClass: Comment\n---\nlost\n')
        write(self.root, f"Comments/{self.task['ref']}/notes.md", 'a note\n')
        write(self.root, f"Comments/{self.task['ref']}/2026-11-16T09-00-00-000.md", '---\nfileClass: Note\n---\nx\n')
        result = self.s.check()
        self.assertTrue(result['ok'])
        codes = sorted(w['kind'] for w in result['warnings'])
        self.assertEqual(codes, ['comments_orphaned', 'not_a_comment', 'not_a_comment'])
        self.assertFalse(any(it['path'].startswith('Comments/') for it in self.s.items()))  # never an item

    def test_the_comments_folder_is_walked_with_the_items(self):
        # A comment written from another device is seen at the next quick poll; one this tab wrote is its own.
        self.assertFalse(self.s._no_items('Comments'))
        self.assertFalse(self.s._no_items(f"Comments/{self.task['ref']}"))
        self.assertTrue(self.s._no_items('Attachments'))

    def test_claude_is_told_who_the_comments_mention(self):
        self.s.add_comment(self.task['id'], 'Ask @[Ana]')
        with mock.patch.object(Store, 'mentions_note', return_value='') as note:
            self.s.claude_prompt(self.task['id'])
        self.assertIn('Ask @[Ana]', note.call_args.args)


class LegacyTest(unittest.TestCase):
    def test_a_legacy_vault_keeps_them_in_the_items_file(self):
        with tempfile.TemporaryDirectory() as root:
            s = Store(root)
            t = s.create('task', 'Old way', {})
            s.add_comment(t['id'], 'one')
            self.assertEqual([c['text'] for c in s.read(t['id'])['fields']['comments']], ['one'])
            self.assertEqual(s.item_comments(t['id'])['comments'][0]['id'], 0)
            s.edit_comment(t['id'], 0, 'one, edited')
            out = s.delete_comment(t['id'], 0)
            s.restore_comment(t['id'], 0, out['removed'])
            self.assertEqual(s.read(t['id'])['fields']['comments'][0]['text'], 'one, edited')
            self.assertFalse(os.path.exists(os.path.join(root, 'Comments')))
            self.assertNotIn('comment_ats', s.with_comments(s.read(t['id'])))


if __name__ == '__main__':
    unittest.main()
