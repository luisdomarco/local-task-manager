"""tm/structures/check.py: what makes a vault not match its structure, and what only warns."""
import os
import tempfile
import unittest

from tm.store import DEFAULT_FOLDERS, ID_RE, ITEM_TYPES, SKIP_DIRS, Store
from tm.structures.check import folders_spec, check


def write(root, rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


class FolderPerTypeCheckTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for folder in DEFAULT_FOLDERS.values():
            os.makedirs(os.path.join(self.root, folder))

    def run_check(self, folders=None):
        return check(self.root, folders_spec(folders or DEFAULT_FOLDERS, ITEM_TYPES, ID_RE, SKIP_DIRS))

    def kinds(self, result, which='blocking'):
        return [(f['kind'], f['path']) for f in result[which]]

    def test_a_vault_with_every_folder_matches(self):
        Store(self.root).create('task', 'Ship it')
        result = self.run_check()
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['warnings'], [])
        self.assertFalse(result['can_create_folders'])

    def test_a_missing_folder_blocks_and_can_be_created(self):
        os.rmdir(os.path.join(self.root, 'transcriptions'))
        result = self.run_check()
        self.assertFalse(result['ok'])
        self.assertEqual(self.kinds(result), [('missing_folder', 'transcriptions')])
        self.assertEqual(result['missing_folders'], ['transcriptions'])
        self.assertTrue(result['can_create_folders'])

    def test_a_folder_the_structure_does_not_have_blocks(self):
        os.makedirs(os.path.join(self.root, 'Tickets'))
        result = self.run_check()
        self.assertEqual(self.kinds(result), [('unexpected_folder', 'Tickets')])
        self.assertFalse(result['can_create_folders'])  # creating folders would not fix it

    def test_hidden_folders_are_left_alone(self):
        for name in ('.task-manager', '.obsidian', '.git'):
            os.makedirs(os.path.join(self.root, name))
        write(self.root, '.obsidian/x.md', '---\ntype: nonsense\n---\n')
        self.assertTrue(self.run_check()['ok'])

    def test_an_unknown_type_blocks(self):
        write(self.root, 'notes/odd.md', '---\ntype: ticket\n---\n')
        self.assertEqual(self.kinds(self.run_check()), [('unknown_type', os.path.join('notes', 'odd.md'))])

    def test_duplicate_ids_block(self):
        write(self.root, 'tasks/a.md', '---\nid: TSK-0001\ntype: task\nsubject: A\n---\n')
        write(self.root, 'tasks/a 2.md', '---\nid: TSK-0001\ntype: task\nsubject: A\n---\n')  # an iCloud conflict copy
        self.assertEqual([k for k, _ in self.kinds(self.run_check())], ['duplicate_id'])

    def test_an_id_that_is_not_its_types_blocks(self):
        write(self.root, 'tasks/a.md', '---\nid: INI-0001\ntype: task\nsubject: A\n---\n')
        write(self.root, 'tasks/b.md', '---\nid: HB-SUP-042\ntype: task\nsubject: B\n---\n')
        self.assertEqual(sorted(k for k, _ in self.kinds(self.run_check())), ['bad_id', 'bad_id'])

    def test_an_icloud_placeholder_blocks(self):
        write(self.root, 'tasks/.TSK-0009-x.md.icloud', '')
        self.assertEqual([k for k, _ in self.kinds(self.run_check())], ['placeholder'])

    def test_what_only_warns(self):
        write(self.root, 'notes/TSK-0001-x.md', '---\nid: TSK-0001\ntype: task\nsubject: In notes\n---\n')
        write(self.root, 'notes/loose.md', 'no frontmatter\n')
        write(self.root, 'notes/diagram.png', 'png')
        result = self.run_check()
        self.assertTrue(result['ok'], result)
        self.assertEqual(sorted(k for k, _ in self.kinds(result, 'warnings')), ['not_markdown', 'outside_folder', 'untyped'])

    def test_a_missing_vault_folder_cannot_be_created(self):
        result = check(os.path.join(self.root, 'gone'), folders_spec(DEFAULT_FOLDERS, ITEM_TYPES, ID_RE, SKIP_DIRS))
        self.assertEqual(self.kinds(result), [('missing_root', '.')])
        self.assertFalse(result['can_create_folders'])

    def test_custom_and_nested_folders(self):
        folders = {**DEFAULT_FOLDERS, 'task': 'work/tasks'}
        os.rmdir(os.path.join(self.root, 'tasks'))
        result = self.run_check(folders)
        self.assertEqual(self.kinds(result), [('missing_folder', 'work/tasks')])


if __name__ == '__main__':
    unittest.main()
