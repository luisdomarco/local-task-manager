"""The outside-ticket keys under their first names (`redmine_id`, `redmine_url`): read as `ticket_id` / `ticket_url`,
renamed on the next save, and renamed for a whole vault by tools/migrate_ticket_keys.py. Always on temp folders."""
import io
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(APP, 'tools'))
import migrate_ticket_keys  # noqa: E402
from tm.store import Store, allowed_values  # noqa: E402

OLD = """---
id: TSK-0001
type: task
subject: "Old keys"
status: ToDo
redmine_id: 4242   # the Redmine issue
redmine_url: "https://tracker.example/issues/4242"
---

redmine_id: 1 stays in the body
"""


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.vault = os.path.join(tmp.name, 'vault')
        shutil.copytree(os.path.join(APP, 'sample-vault-legacy'), self.vault)
        self.task = os.path.join(self.vault, 'tasks', 'TSK-9001-old-keys.md')
        self.write(self.task, OLD.replace('TSK-0001', 'TSK-9001'))

    def write(self, path, text):
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(text)

    def read(self, path):
        with open(path, encoding='utf-8', newline='') as f:
            return f.read()

    def run_tool(self, *args):
        out = io.StringIO()
        code = migrate_ticket_keys.main([self.vault, *args], out=out)
        return code, out.getvalue()


class ToolTest(Base):
    def test_plan_writes_nothing(self):
        before = self.read(self.task)
        code, text = self.run_tool()
        self.assertEqual(code, 0)
        self.assertIn('tasks/TSK-9001-old-keys.md: redmine_id → ticket_id, redmine_url → ticket_url', text)
        self.assertIn('to rename (run again with --apply)', text)
        self.assertEqual(self.read(self.task), before)

    def test_apply_renames_only_the_keys(self):
        self.assertEqual(self.run_tool('--apply')[0], 0)
        after = self.read(self.task)
        expected = OLD.replace('TSK-0001', 'TSK-9001').replace('\nredmine_id: 4242', '\nticket_id: 4242', 1) \
                      .replace('\nredmine_url:', '\nticket_url:', 1)
        self.assertEqual(after, expected)  # value, comment, order and the body line kept byte for byte
        self.assertIn('redmine_id: 1 stays in the body', after)

    def test_second_run_finds_nothing(self):
        self.run_tool('--apply')
        code, text = self.run_tool('--apply')
        self.assertEqual(text.strip(), '0 file(s) renamed')

    def test_sample_vault_files_are_migrated_and_still_read(self):
        before = Store(self.vault).read('INI-0001')['fields']
        self.assertTrue(before.get('ticket_id'))  # the sample's initiative has one
        self.run_tool('--apply')
        for root, _, files in os.walk(self.vault):
            for name in files:
                if name.endswith('.md'):
                    self.assertNotIn('\nredmine_', self.read(os.path.join(root, name)).split('\n---', 1)[0], name)
        after = Store(self.vault).read('INI-0001')['fields']
        self.assertEqual(after.get('ticket_id'), before.get('ticket_id'))
        self.assertEqual(after.get('ticket_url'), before.get('ticket_url'))

    def test_a_file_with_both_keys_is_left_alone(self):
        both = OLD.replace('status: ToDo', 'status: ToDo\nticket_id: 7')
        self.write(self.task, both)
        code, text = self.run_tool('--apply')
        self.assertIn('left alone, has both redmine_id and ticket_id', text)
        self.assertIn('redmine_url → ticket_url', text)  # the other one still moves
        after = self.read(self.task)
        self.assertIn('redmine_id: 4242', after)
        self.assertIn('ticket_url:', after)

    def test_hidden_folders_are_skipped(self):
        hidden = os.path.join(self.vault, '.trash')
        os.makedirs(hidden, exist_ok=True)
        self.write(os.path.join(hidden, 'TSK-0002-gone.md'), OLD)
        self.run_tool('--apply')
        self.assertIn('redmine_id: 4242', self.read(os.path.join(hidden, 'TSK-0002-gone.md')))

    def test_not_a_folder(self):
        with self.assertRaises(SystemExit):
            migrate_ticket_keys.main([os.path.join(self.vault, 'nope')], out=io.StringIO())


class TransitionTest(Base):
    """An unmigrated vault keeps working in the app."""

    def test_old_keys_are_read_under_the_new_names(self):
        item = Store(self.vault).read('TSK-9001')['fields']
        self.assertEqual(item['ticket_id'], 4242)
        self.assertEqual(item['ticket_url'], 'https://tracker.example/issues/4242')
        self.assertNotIn('redmine_id', item)

    def test_a_save_renames_them(self):
        Store(self.vault).update('TSK-9001', {'status': 'InProgress'})
        text = self.read(self.task)
        self.assertIn('ticket_id: 4242   # the Redmine issue', text)
        self.assertIn('ticket_url: "https://tracker.example/issues/4242"', text)
        self.assertNotIn('\nredmine_', text.split('\n---', 1)[0])
        self.assertIn('redmine_id: 1 stays in the body', text)

    def test_a_save_of_the_ticket_writes_the_new_key_once(self):
        Store(self.vault).update('TSK-9001', {'ticket_id': 5})
        head = self.read(self.task).split('\n---', 1)[0]
        self.assertEqual(head.count('ticket_id:'), 1)
        self.assertIn('ticket_id: 5', head)
        self.assertNotIn('redmine_id', head)

    def test_a_caller_sending_the_old_key_reaches_the_new_one(self):
        self.assertEqual(allowed_values('task', {'redmine_id': 9, 'redmine_url': 'u'}),
                         {'ticket_id': 9, 'ticket_url': 'u'})


if __name__ == '__main__':
    unittest.main()
