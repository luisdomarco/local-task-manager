"""The Agent type (tm/structures/agents.py) in both structures, and the sidebar's sections (TSK-036)."""
import os
import tempfile
import unittest

from tm.store import Store, StoreError
from tm.structures import get
from tm.structures.folders import FOLDER_PER_TYPE

TICKETING_ROOT = ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log')


def read(root, rel):
    with open(os.path.join(root, rel), encoding='utf-8') as f:
        return f.read()


def sidebar(structure):
    """The 'types' group of the sidebar as the page draws it (static/js/main.js renderNav): plurals in order, '|' where
    the section changes, a type in one of the structure's `sections` left for its tab; then those sections' names."""
    sections = structure.extras.get('sections', [])
    tabs = {name for s in sections for name in s['types']}
    types = sorted((t for t in structure.types.values() if t.nav and t.nav['group'] == 'types' and t.name not in tabs),
                   key=lambda t: t.nav['order'])
    out = []
    for i, t in enumerate(types):
        if i and t.nav['section'] != types[i - 1].nav['section']:
            out.append('|')
        out.append(t.plural)
    return out + (['|', *(s['label'] for s in sections)] if sections else [])


class SidebarTest(unittest.TestCase):
    def test_folders_in_sections(self):
        self.assertEqual(sidebar(FOLDER_PER_TYPE), ['Initiatives', 'User stories', 'Tasks', '|', 'Meetings', 'Transcriptions', 'Notes',
                                           '|', 'Agents'])

    def test_ticketing_in_sections(self):
        # Agents sit with the tools, under More; the rest are tabs of Meetings, Brief, Issues and Records
        self.assertEqual(sidebar(get('ticketing')), ['Projects', 'Initiatives', 'Tasks', '|', 'Notes', '|',
                                                     'Meetings', 'Brief', 'Issues', 'Records'])

    def test_a_type_turned_off_leaves_no_tab_and_a_section_with_none_no_link(self):
        off = get('ticketing').without(['hotfix', 'error', 'learning'])
        self.assertEqual(sidebar(off)[-4:], ['|', 'Meetings', 'Brief', 'Issues'])
        self.assertEqual(next(s for s in off.public()['sections'] if s['key'] == 'issues')['types'], ['story', 'support'])


class FolderPerTypeAgentTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for kind, folder in FOLDER_PER_TYPE.default_folders.items():
            if kind != 'agent':
                os.makedirs(os.path.join(self.root, folder))
        self.s = Store(self.root, enforce_structure=True)

    def test_a_vault_without_the_agents_folder_still_matches_and_gets_it_with_the_first_agent(self):
        self.assertTrue(self.s.check()['ok'], self.s.check())
        a = self.s.create('agent', 'Weekly report writer', {'platform': 'Agent SDK', 'trigger': 'scheduled'})
        self.assertEqual(os.path.dirname(a['path']), 'agents')
        self.assertTrue(a['id'].startswith('AGT-'))
        self.assertEqual(a['fields']['status'], 'Idea')  # its own first status, not the Backlog
        self.assertEqual((a['fields']['platform'], a['fields']['trigger']), ('Agent SDK', 'scheduled'))
        self.assertIn('## Purpose', read(self.root, a['path']))
        self.assertIn('## Runbook', read(self.root, a['path']))
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_its_statuses_are_its_own(self):
        a = self.s.create('agent', 'Triage bot')
        with self.assertRaises(StoreError):
            self.s.update(a['key'], {'status': 'ToDo'})
        self.assertFalse(self.s.update(a['key'], {'status': 'Live'})['fields'].get('completed_at'))
        self.assertTrue(self.s.update(a['key'], {'status': 'Retired'})['fields'].get('completed_at'))

    def test_a_body_given_is_kept(self):
        a = self.s.create('agent', 'Mine', body='Just this')
        self.assertNotIn('## Purpose', read(self.root, a['path']))

    def test_a_missing_required_folder_still_blocks(self):
        os.rmdir(os.path.join(self.root, 'tasks'))
        result = self.s.check()
        self.assertFalse(result['ok'])
        self.assertEqual(result['missing_folders'], ['tasks'])


class TicketingAgentTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for d in TICKETING_ROOT:
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)

    def test_a_vault_without_agents_matches_and_the_first_agent_makes_the_folder(self):
        self.assertTrue(self.s.check()['ok'], self.s.check())
        a = self.s.create('agent', 'Inbox triage', {'model': 'claude-sonnet-5-5', 'tools': 'Gmail MCP'})
        self.assertEqual(a['path'], f"Agents/{a['ref']} Inbox triage.md")
        self.assertEqual((a['id'], a['ref']), ('1', 'AGT-1'))  # a new vault numbers its items
        self.assertEqual(a['fields']['status'], 'Idea')
        text = read(self.root, a['path'])
        self.assertIn('fileClass: Ticket Agent', text)
        self.assertIn('status_agent: Idea', text)
        self.assertIn('model: claude-sonnet-5-5', text)
        self.assertIn('## Evaluation', text)
        self.assertTrue(self.s.check()['ok'], self.s.check())

    def test_its_status_is_written_as_it_is_and_logged(self):
        a = self.s.create('agent', 'Release notes')
        f = self.s.update(a['key'], {'status': 'Build'})['fields']
        self.assertEqual(f['status'], 'Build')
        text = read(self.root, self.s.read(a['key'])['path'])
        self.assertIn('status_agent: Build', text)  # not "3. Build": an agent's statuses are not the tickets'
        self.assertIn('"from": "Idea", "to": "Build"', text)  # status_log
        with self.assertRaises(StoreError):
            self.s.update(a['key'], {'status': 'InProgress'})

    def test_an_agents_folder_is_known_even_with_the_type_turned_off(self):
        self.s.create('agent', 'Kept')
        off = Store(self.root, structure='ticketing', enforce_structure=True, disabled_types=['agent'])
        self.assertTrue(off.check()['ok'], off.check())


if __name__ == '__main__':
    unittest.main()
