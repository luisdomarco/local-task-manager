"""The vault as a graph (tm/graph.py, Store.graph, GET /api/graph): every link between items and docs is one edge, of
the kind it is kept as, and nothing that links to what the vault lacks is drawn."""
import os
import unittest

import server
from tests.test_ticketing import TicketingBase, read, write
from tm import graph as tm_graph
from tm.store import Store

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def stem(it):
    return os.path.splitext(os.path.basename(it['path']))[0]


def edges_of(g, source):
    return {(e['target'], e['kind'], e.get('field'), e.get('relation')) for e in g['edges'] if e['source'] == source}


class GraphTest(TicketingBase):
    def setUp(self):
        super().setUp()
        s = self.s
        self.ini = s.create('initiative', 'Checkout', {'project': 'ECD'})
        self.a = s.create('story', 'One', {'project': 'ECD', 'related_to': self.ini['id']})
        self.b = s.create('story', 'Two', {'project': 'ECD', 'related_to': self.ini['id'], 'depends_on': [self.a['id']]})
        self.sup = s.create('support', 'Broken', {'project': 'ECD'})
        self.hfx = s.create('hotfix', 'Patch', {'project': 'ECD', 'related_to': self.sup['id']})
        s.update(self.sup['id'], {'relations': [self.hfx['id']], 'relation_kinds': {self.hfx['id']: 'precedes'}})
        s.update(self.ini['id'], {'origin': self.sup['id']})
        write(self.root, 'Docs/Guide.md', f'# Guide\n\nStart at [[{stem(self.ini)}]], see [[Nowhere]].\n')
        self.note = s.create('note', 'Idea', {'related_to': self.ini['id']},
                             body=f'About [[{stem(self.ini)}]] and [[{stem(self.b)}|the second]], in ![[Guide#Start]].\n'
                                  'Not [[SPEC-<n> <Capability>]].\n')

    def test_every_item_and_doc_is_a_node(self):
        g = self.s.graph()
        ids = {n['id'] for n in g['nodes']}
        self.assertLessEqual({self.ini['id'], self.a['id'], self.note['id'], 'ECD', 'HB', 'Docs/Guide.md'}, ids)
        doc = next(n for n in g['nodes'] if n['id'] == 'Docs/Guide.md')
        self.assertEqual((doc['type'], doc['title']), ('doc', 'Guide'))
        story = next(n for n in g['nodes'] if n['id'] == self.a['id'])
        self.assertEqual((story['type'], story['project'], story['title']), ('story', 'ECD', 'One'))

    def test_fields_relations_and_blocked_by_are_edges_of_their_kind(self):
        g = self.s.graph()
        self.assertEqual(edges_of(g, self.b['id']), {
            (self.ini['id'], 'parent', 'related_to', None),
            ('ECD', 'project', 'project', None),
            (self.a['id'], 'relation', 'depends_on', 'blocked'),  # Projects keeps Blocked by in depends_on
        })
        self.assertIn((self.hfx['id'], 'relation', 'relations', 'precedes'), edges_of(g, self.sup['id']))
        self.assertIn((self.sup['id'], 'link', 'origin', None), edges_of(g, self.ini['id']))
        # The inverse is the page's to draw: the hotfix keeps no edge back to its support's relation.
        self.assertNotIn((self.sup['id'], 'relation', 'relations', 'follows'), edges_of(g, self.hfx['id']))

    def test_body_links_are_mentions_unless_the_fields_already_join_them(self):
        g = self.s.graph()
        self.assertEqual(edges_of(g, self.note['id']), {
            (self.ini['id'], 'parent', 'related_to', None),  # also in the body: no second edge
            (self.b['id'], 'mention', None, None),         # an alias still names its note
            ('Docs/Guide.md', 'mention', None, None),      # an embed with a heading too
        })
        self.assertEqual(edges_of(g, 'Docs/Guide.md'), {(self.ini['id'], 'mention', None, None)})  # [[Nowhere]] is no edge

    def test_a_body_edited_outside_is_read_again(self):
        self.assertNotIn((self.a['id'], 'mention', None, None), edges_of(self.s.graph(), 'Docs/Guide.md'))
        write(self.root, 'Docs/Guide.md', f'# Guide\n\nNow [[{stem(self.a)}]] only, in another size.\n')
        self.assertEqual(edges_of(self.s.graph(), 'Docs/Guide.md'), {(self.a['id'], 'mention', None, None)})
        os.remove(os.path.join(self.root, 'Docs/Guide.md'))
        g = self.s.graph()
        self.assertNotIn('Docs/Guide.md', {n['id'] for n in g['nodes']})
        self.assertFalse(any('Guide.md' in p for p in self.s._links_cache))

    def test_the_graph_reads_and_never_writes(self):
        before = {p: read(self.root, p) for p in (self.note['path'], self.sup['path'], 'Docs/Guide.md')}
        self.s.graph()
        self.assertEqual({p: read(self.root, p) for p in before}, before)

    def test_neighbors_follow_edges_both_ways_and_skip_the_project_by_default(self):
        g = self.s.graph()
        one = tm_graph.neighbors(g, self.a['id'], depth=1)
        self.assertEqual({n['id']: n['depth'] for n in one['nodes']}, {self.a['id']: 0, self.ini['id']: 1, self.b['id']: 1})
        self.assertTrue(all(e['kind'] != 'project' for e in one['edges']))
        two = tm_graph.neighbors(g, self.a['id'], depth=2)
        self.assertLessEqual({self.note['id'], self.sup['id'], 'Docs/Guide.md'}, {n['id'] for n in two['nodes']})
        with_project = tm_graph.neighbors(g, self.a['id'], depth=1, kinds=tm_graph.KINDS)
        self.assertIn('ECD', {n['id'] for n in with_project['nodes']})
        self.assertEqual(tm_graph.neighbors(g, 'nope'), {'nodes': [], 'edges': []})

    def test_the_api_answers_the_graph(self):
        g = server.ROUTES[('GET', '/api/graph')](self.s, {}, {})
        self.assertEqual(g, self.s.graph())


class LegacyGraphTest(unittest.TestCase):
    def test_a_folder_per_type_vault_draws_its_parents_by_plain_id(self):
        s = Store(os.path.join(APP_DIR, 'sample-vault-legacy'), structure='folders')
        g = s.graph()
        ids = {n['id'] for n in g['nodes']}
        parents = [e for e in g['edges'] if e['kind'] == 'parent']
        self.assertTrue(parents)
        self.assertTrue(all(e['source'] in ids and e['target'] in ids for e in g['edges']))
        child = next(i for i in s.items() if i['fields'].get('related_to'))
        self.assertIn({'source': child['id'], 'target': child['fields']['related_to'], 'kind': 'parent', 'field': 'related_to'}, parents)


class TargetsTest(unittest.TestCase):
    def test_every_wikilink_form_gives_its_stem_once(self):
        text = 'a [[One]] [[Two|alias]] [[Three#h]] ![[Four.md]] [[Docs/Five]] [[One]] `[[Six]]`'
        from tm.structures.ticketing import wikilinks
        self.assertEqual(wikilinks.targets(text), ['One', 'Two', 'Three', 'Four', 'Five', 'Six'])
        self.assertEqual(wikilinks.targets(''), [])


if __name__ == '__main__':
    unittest.main()
