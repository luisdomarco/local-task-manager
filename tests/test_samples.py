"""The two versioned sample vaults (tools/seed_sample_vault.py): each matches its structure and shows every type it
has, with people, labels, docs, work log and a favourite, so every screen has something on a first run."""
import os
import unittest

from tm.store import Store
from tm.structures import get

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLES = {'sample-vault': 'folders', 'sample-vault-ticketing': 'ticketing'}


class SamplesTest(unittest.TestCase):
    def store(self, folder):
        return Store(os.path.join(APP_DIR, folder), structure=SAMPLES[folder], enforce_structure=True)

    def test_each_matches_its_structure(self):
        for folder, structure in SAMPLES.items():
            with self.subTest(folder):
                s = self.store(folder)
                self.assertEqual(s.check()['ok'], True, s.check())
                self.assertIs(s.full_structure, get(structure))

    def test_each_has_an_item_of_every_type(self):
        for folder in SAMPLES:
            with self.subTest(folder):
                s = self.store(folder)
                self.assertEqual(set(s.structure.types) - {i['type'] for i in s.items()}, set())

    def test_each_has_people_labels_docs_work_log_and_a_favourite(self):
        for folder in SAMPLES:
            with self.subTest(folder):
                s = self.store(folder)
                people = s.people()['people']
                self.assertGreaterEqual(len(people), 3)
                self.assertTrue(any(p.get('emails') for p in people))  # with their details, not names only
                self.assertGreaterEqual(len(s.labels()['labels']), 3)
                self.assertTrue(s.worklog())
                self.assertTrue(any(i['fields'].get('sidebar') is True for i in s.items() if i['type'] == 'initiative'))
                docs = [p for p, _, files in os.walk(os.path.join(APP_DIR, folder)) if os.path.basename(p) != '.task-manager'
                        and any(f.endswith('.md') for f in files) and f'{os.sep}docs' in p.lower()]
                self.assertTrue(docs, 'no doc')


if __name__ == '__main__':
    unittest.main()
