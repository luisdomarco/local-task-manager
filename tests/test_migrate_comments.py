"""tools/migrate_comments.py: a Projects vault's comments moved out of their items' frontmatter into files of their own,
Comments/<ref>/<at>.md (TSK-128, docs/migrate-comments.md): plan, copy and compare, apply in place, resume, check."""

import io
import os
import shutil
import tempfile
import unittest

from tm import comments as tc
from tm import frontmatter as fm
from tm.store import Store
from tm.structures.ticketing.definition import ROOT_FOLDERS, WORKLOG_FOLDER
from tools import migrate_comments as mig


def read(root, rel):
    with open(os.path.join(root, rel), encoding='utf-8', newline='') as f:
        return f.read()


def write(root, rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def run(*argv):
    out = io.StringIO()
    code = mig.main(list(argv), out=out)
    return code, out.getvalue()


def digest_of(text):
    return text.rsplit('Digest: ', 1)[1].split()[0]


class MigrateCommentsTest(unittest.TestCase):
    """A vault from before comments were files: a task with three (two in one minute, one edited), a project with
    one, a story with a bare string and none of its own moment, and a task with an empty list."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = tmp.name
        self.root = os.path.join(self.dir, 'Tickets')
        for d in [*ROOT_FOLDERS.values(), WORKLOG_FOLDER]:
            os.makedirs(os.path.join(self.root, d))
        s = Store(self.root, structure='ticketing', enforce_structure=True)
        self.project = s.create('project', 'Internal Tools', {'project_key': 'HB'})
        self.task = s.create('task', 'Review the plan', {'project': 'HB'})
        self.story = s.create('story', 'One page', {'project': 'HB'})
        self.empty = s.create('task', 'Nothing said', {'project': 'HB'})
        self.untouched = s.create('task', 'Quiet', {'project': 'HB'})
        self.put(self.task, [{'at': '2026-10-01T10:00', 'text': 'first'},
                             {'at': '2026-10-01T10:00', 'text': 'same minute'},
                             {'at': '2026-10-02T09:15:30', 'text': 'changed', 'edited': '2026-10-02T09:20:00'}])
        self.put(self.project, [{'at': '2026-09-30T08:00:00', 'text': 'kick-off'}])
        self.put(self.story, ['a bare string'])
        self.put(self.empty, [])
        self.quiet = read(self.root, self.untouched['path'])

    def put(self, it, comments):
        text = read(self.root, it['path'])
        write(self.root, it['path'], fm.patch(text, {'comments': comments}))

    def store(self, root=None):
        return Store(root or self.root, structure='ticketing')

    def files(self, it, root=None):
        return tc.names(os.path.join(root or self.root, 'Comments', it['ref']))

    def test_plan_writes_nothing_and_names_each_file(self):
        before = {rel: read(self.root, rel) for rel in mig.all_files(self.root)}
        code, out = run('--plan', self.root)
        self.assertEqual(code, 0, out)
        self.assertIn('5 comments in 4 items', out)
        self.assertIn('2026-10-01T10-00-00-000, 2026-10-01T10-00-00-001, 2026-10-02T09-15-30-000', out)
        self.assertIn('an empty list: the key goes', out)
        self.assertEqual({rel: read(self.root, rel) for rel in mig.all_files(self.root)}, before)
        self.assertFalse(os.path.exists(os.path.join(self.root, 'Comments')))

    def test_copy_then_compare(self):
        code, out = run('--plan', self.root)
        copy = os.path.join(self.dir, 'Copy')
        code, out = run('--copy', self.root, '--to', copy)
        self.assertEqual(code, 0, out)
        self.assertFalse(os.path.exists(os.path.join(self.root, 'Comments')))  # the vault itself as it was
        code, out = run('--compare', self.root, copy)
        self.assertEqual(code, 0, out)
        self.assertIn('5 comments of 4 items read back as they were', out)
        # A difference is said: one comment's text changed in the copy.
        rel = f"Comments/{self.task['ref']}/2026-10-01T10-00-00-001.md"
        write(copy, rel, read(copy, rel).replace('same minute', 'another'))
        code, out = run('--compare', self.root, copy)
        self.assertEqual(code, 1)
        self.assertIn('comment 2', out)

    def test_apply_moves_them_and_keeps_every_other_byte(self):
        before = {it['path']: read(self.root, it['path']) for it in (self.task, self.project, self.story, self.empty)}
        _, out = run('--plan', self.root)
        code, out = run('--apply', self.root, '--digest', digest_of(out))
        self.assertEqual(code, 0, out)
        for path, text in before.items():
            self.assertEqual(read(self.root, path), fm.drop(text, ['comments']))
            self.assertNotIn('comments:', read(self.root, path))
        self.assertEqual(read(self.root, self.untouched['path']), self.quiet)
        self.assertEqual(self.files(self.task), ['2026-10-01T10-00-00-000.md', '2026-10-01T10-00-00-001.md',
                                                 '2026-10-02T09-15-30-000.md'])
        self.assertEqual(self.files(self.empty), [])
        got = self.store().item_comments(self.task['id'])['comments']
        self.assertEqual([(c['text'], c['at'], c['by'], c.get('edited')) for c in got], [
            ('first', '2026-10-01T10:00:00.000', 'owner', None),
            ('same minute', '2026-10-01T10:00:00.001', 'owner', None),
            ('changed', '2026-10-02T09:15:30.000', 'owner', '2026-10-02T09:20:00')])
        head, _ = fm.split(read(self.root, f"Comments/{self.task['ref']}/2026-10-01T10-00-00-000.md"))
        stem = os.path.splitext(os.path.basename(self.task['path']))[0]
        self.assertEqual(fm.parse(head)['item'], f'[[{stem}]]')
        # The project by its key; the bare string at its item's created_at.
        self.assertEqual(self.store().item_comments(self.project['key'])['comments'][0]['text'], 'kick-off')
        story = self.store().item_comments(self.story['id'])['comments']
        self.assertEqual([c['text'] for c in story], ['a bare string'])
        self.assertTrue(story[0]['at'].startswith(str(self.story['fields']['created_at'])[:10]))
        self.assertFalse(os.path.exists(os.path.join(self.root, '.task-manager', mig.PARTIAL)))
        code, out = run('--check', self.root)
        self.assertEqual(code, 0, out)
        self.assertIn('0 comment warnings', out)

    def test_again_changes_nothing(self):
        _, out = run('--plan', self.root)
        run('--apply', self.root, '--digest', digest_of(out))
        after = {rel: read(self.root, rel) for rel in mig.all_files(self.root)}
        comments = sorted(os.path.join(h, f) for h, _, fs in os.walk(os.path.join(self.root, 'Comments')) for f in fs)
        _, out = run('--plan', self.root)
        self.assertIn('0 comments in 0 items', out)
        code, out = run('--apply', self.root, '--digest', digest_of(out))
        self.assertEqual(code, 0, out)
        self.assertEqual({rel: read(self.root, rel) for rel in mig.all_files(self.root)}, after)
        self.assertEqual(sorted(os.path.join(h, f) for h, _, fs in os.walk(os.path.join(self.root, 'Comments')) for f in fs),
                         comments)

    def test_refuses_a_vault_changed_since_the_plan(self):
        _, out = run('--plan', self.root)
        self.put(self.untouched, [{'at': '2026-10-05T12:00', 'text': 'late'}])
        code, out = run('--apply', self.root, '--digest', digest_of(out))
        self.assertEqual(code, 2)
        self.assertIn('not as planned', out)
        self.assertFalse(os.path.exists(os.path.join(self.root, 'Comments')))
        code, out = run('--check', self.root)
        self.assertEqual(code, 1)
        self.assertIn('5 items keep comments', out)

    def test_a_run_that_stopped_goes_on(self):
        _, out = run('--plan', self.root)
        digest = digest_of(out)
        real = mig.atomic_write
        calls = []

        def stop_after_two_comments(path, text, exclusive=False):
            if exclusive:
                calls.append(path)
                if len(calls) > 2:
                    raise OSError('the disk went away')
            return real(path, text, exclusive=exclusive)

        mig.atomic_write = stop_after_two_comments
        try:
            with self.assertRaises(OSError):
                mig.apply(self.root, digest, io.StringIO())
        finally:
            mig.atomic_write = real
        self.assertTrue(os.path.isfile(os.path.join(self.root, '.task-manager', mig.PARTIAL)))
        # Half way: some files written, items not yet stripped. The same command goes on, and refuses another digest.
        code, out = run('--apply', self.root, '--digest', '0000000000000000')
        self.assertEqual(code, 2)
        code, out = run('--apply', self.root, '--digest', digest)
        self.assertEqual(code, 0, out)
        self.assertEqual(len(self.files(self.task)) + len(self.files(self.project)) + len(self.files(self.story)), 5)
        self.assertEqual(run('--check', self.root)[0], 0)

    def test_a_name_already_taken_moves_on_a_millisecond(self):
        # A comment written as a file at that very moment already (after comments were files).
        tc.write_new(os.path.join(self.root, 'Comments', self.task['ref']), '[[x]]', 'newer', 'agent',
                     at='2026-10-01T10:00:00.000')
        _, out = run('--plan', self.root)
        self.assertIn('2026-10-01T10-00-00-001, 2026-10-01T10-00-00-002', out)
        run('--apply', self.root, '--digest', digest_of(out))
        texts = [c['text'] for c in self.store().item_comments(self.task['id'])['comments']]
        self.assertEqual(texts, ['newer', 'first', 'same minute', 'changed'])

    def test_a_long_line_of_many_comments(self):
        many = [{'at': f'2026-10-03T11:{i:02d}', 'text': 'x' * 2000 + f' {i}'} for i in range(16)]
        self.put(self.untouched, many)  # one flow line of about 32 KB when written inline
        _, out = run('--plan', self.root)
        self.assertIn('21 comments in 5 items', out)
        copy = os.path.join(self.dir, 'Copy')
        self.assertEqual(run('--copy', self.root, '--to', copy)[0], 0)
        code, out = run('--compare', self.root, copy)
        self.assertEqual(code, 0, out)
        self.assertEqual(len(self.files(self.untouched, copy)), 16)

    def test_refuses_what_is_not_a_projects_vault(self):
        legacy = os.path.join(self.dir, 'Legacy')
        shutil.copytree(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sample-vault-legacy'), legacy)
        code, out = run('--plan', legacy)
        self.assertEqual(code, 2)
        self.assertIn('does not match the Projects structure', out)
        code, out = run('--copy', self.root)
        self.assertEqual(code, 2)
        self.assertIn('--copy needs --to', out)


if __name__ == '__main__':
    unittest.main()
