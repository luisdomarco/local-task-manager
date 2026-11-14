"""Obsidian Bases (tm/bases.py, Store.base, /api/bases): the YAML Bases writes, its filters and formulas over a vault,
sort, groups, limit and summaries, what is not supported said and never guessed, and a cell edited writing only that
note's key."""
import os
import sys
import tempfile
import unittest
from unittest import mock

from tm import bases
from tm.store import Store, StoreError

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(APP_DIR, 'tools'))
from serve_sample import SAMPLE_VAULT, copy_sample  # noqa: E402

# The example of Obsidian's syntax page (https://obsidian.md/help/bases/syntax), as its parts are documented
DOCS_EXAMPLE = '''filters:
  or:
    - file.hasTag("tag")
    - and:
        - file.hasTag("book")
        - file.hasLink("Textbook")
    - not:
        - file.hasTag("book")
        - file.inFolder("Required Reading")
formulas:
  formatted_price: 'if(price, price.toFixed(2) + " dollars")'
  ppu: "(price / age).toFixed(2)"
properties:
  status:
    displayName: Status
  formula.formatted_price:
    displayName: "Price"
  file.ext:
    displayName: Extension
summaries:
  customAverage: 'values.mean().round(3)'
views:
  - type: table
    name: "My table"
    limit: 10
    groupBy:
      property: note.age
      direction: DESC
    filters:
      and:
        - 'status != "done"'
        - or:
            - "formula.ppu > 5"
            - "price > 2.1"
    order:
      - file.name
      - file.ext
      - note.age
      - formula.ppu
      - formula.formatted_price
    summaries:
      formula.ppu: Average
'''


def write(root, rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def read(root, rel):
    with open(os.path.join(root, rel), encoding='utf-8') as f:
        return f.read()


class ParseYaml(unittest.TestCase):
    def test_the_docs_example(self):
        data = bases.parse_yaml(DOCS_EXAMPLE)
        self.assertEqual(data['filters']['or'][0], 'file.hasTag("tag")')
        self.assertEqual(data['filters']['or'][1]['and'][1], 'file.hasLink("Textbook")')
        self.assertEqual(data['filters']['or'][2]['not'], ['file.hasTag("book")', 'file.inFolder("Required Reading")'])
        self.assertEqual(data['formulas']['formatted_price'], 'if(price, price.toFixed(2) + " dollars")')
        self.assertEqual(data['properties']['formula.formatted_price'], {'displayName': 'Price'})
        view = data['views'][0]
        self.assertEqual((view['type'], view['name'], view['limit']), ('table', 'My table', 10))
        self.assertEqual(view['groupBy'], {'property': 'note.age', 'direction': 'DESC'})
        self.assertEqual(view['filters']['and'][1]['or'], ['formula.ppu > 5', 'price > 2.1'])
        self.assertEqual(view['order'][-1], 'formula.formatted_price')
        self.assertEqual(view['summaries'], {'formula.ppu': 'Average'})

    def test_flow_lists_quoted_keys_block_scalars_and_comments(self):
        data = bases.parse_yaml('# a base\nviews:\n  - type: cards\n    order: [file.name, "note.a b"]\n'
                                '    "odd: key": 1\nformulas:\n  long: |\n    if(a,\n      b)\n')
        self.assertEqual(data['views'][0]['order'], ['file.name', 'note.a b'])
        self.assertEqual(data['views'][0]['odd: key'], 1)
        self.assertEqual(data['formulas']['long'], 'if(a,\n  b)')

    def test_bad_yaml_is_an_error(self):
        with self.assertRaises(bases.BaseError):
            bases.parse_yaml('views:\n  - type: table\n   bad: indent\n')


class FakeSource:
    """A vault in memory: {rel: (frontmatter, text)}."""

    def __init__(self, files):
        self.data = files
        self.resolve_ = bases.resolver(list(files))

    def files(self):
        return list(self.data)

    def stat(self, rel):
        return (len(self.data[rel][1]), 1_700_000_000, 1_600_000_000)

    def props(self, rel):
        return self.data[rel][0]

    def _facts(self, rel):
        return bases.text_facts(self.data[rel][1])

    def tags(self, rel):
        return self._facts(rel)['tags'] + [t for t in self.data[rel][0].get('tags', []) if t not in self._facts(rel)['tags']]

    def links(self, rel):
        return self._facts(rel)['links']

    def embeds(self, rel):
        return self._facts(rel)['embeds']

    def resolve(self, target, from_rel=''):
        return self.resolve_(target, from_rel)

    def backlinks(self, rel):
        return [f for f in self.data if f != rel and any(self.resolve(t, f) == rel for t in self.links(f))]


BOOKS = {
    'Books/Dune.md': ({'tags': ['book'], 'price': 10, 'age': 1, 'status': 'reading', 'read': '2026-11-01'},
                      'A [[Textbook]] about sand. #scifi'),
    'Books/Emma.md': ({'tags': ['book'], 'price': 3, 'age': 2, 'status': 'done'}, '[[Textbook]]'),
    'Books/Hobbit.md': ({'tags': ['book'], 'price': 30, 'age': 2, 'status': 'todo'}, 'No link.'),
    'Required Reading/Ulysses.md': ({'tags': ['book'], 'price': 9, 'age': 3}, 'Hard.'),
    'Notes/Tagged.md': ({'tags': ['tag']}, 'Tagged.'),
    'Notes/Plain.md': ({}, 'Plain, #tag/nested inline.'),
    'Textbook.md': ({}, 'The textbook.'),
    'cover.png': ({}, ''),
}


class Evaluate(unittest.TestCase):
    def run_base(self, text, view=0, this=None, files=BOOKS):
        return bases.Base(bases.parse_yaml(text), FakeSource(files)).run(view, this)

    def names(self, out):
        return [r['path'] for r in out['rows']]

    def test_the_docs_example_rows(self):
        out = self.run_base(DOCS_EXAMPLE)
        # global filter: tagged #tag (Tagged, Plain's #tag/nested), or a book linking Textbook (Dune, Emma), or neither
        # a book nor in Required Reading (Tagged, Plain, Textbook, cover.png); then the view's: status not done, and
        # ppu > 5 or price > 2.1 — only Dune (10/1) is left with a price
        self.assertEqual(self.names(out), ['Books/Dune.md'])
        self.assertEqual([c['label'] for c in out['columns']], ['file name', 'Extension', 'age', 'ppu', 'Price'])
        self.assertEqual(out['rows'][0]['cells'], ['Dune.md', 'md', 1, '10.00', '10.00 dollars'])
        self.assertEqual(out['groups'], [{'value': 1, 'label': '1', 'rows': [0]}])
        self.assertEqual(out['summaries'][3], {'name': 'Average', 'value': 10})
        self.assertEqual(out['unsupported'], [])

    def test_limits_a_base_cannot_pass(self):
        # a base is data the vault carries: it cannot make the server build huge text, hang on a regex or spin
        def err(expr):
            out = self.run_base(f"filters: '{expr}'\n")
            return out['errors'][0] if out['errors'] else None
        self.assertIn('repeat() past', err('"ab".repeat(1000000) != ""'))
        self.assertIn('take very long', err('/(a+)+$/.matches(file.name)'))
        self.assertIn('not a regular expression', err('/(/.matches(file.name)'))
        self.assertIn('longer than', err('/' + 'a' * 400 + '/.matches(file.name)'))
        self.assertEqual(self.names(self.run_base("filters: '(2).toFixed(1000000) != \"\"'\n"))[:1], ['Books/Dune.md'])
        self.assertIn('take very long', err('/(a|aa)+$/.matches(file.name)'))
        self.assertIn('take very long', err('/(a?){30}b/.matches(file.name)'))
        self.assertIn('take very long', err('/((ab)*c)+/.matches(file.name)'))
        # inside an atomic group too (3.11+; before, (?> is not a regex at all)
        self.assertRegex(err('/(?>((a+)+)b)/.matches(file.name)'), 'take very long|not a regular expression')
        self.assertIn('take very long', err('/a*a*a*b/.matches(file.name)'))  # polynomial: three unbounded in a row
        alone = self.run_base("filters: '/^(Dune|Emma)[.]md$/.matches(file.name)'\n")  # an alternation alone is fine
        self.assertEqual((self.names(alone), alone['errors'], alone['unsupported']), (['Books/Dune.md', 'Books/Emma.md'], [], []))
        self.assertIn('regular expression on a text past', err('/y/.matches("x".repeat(20000))'))
        # each value small, the row's sum not: a list of 50k-character texts, mapped
        self.assertIn('this row builds more than', err('[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45].map("x".repeat(50000)).length > 0'))
        self.assertIn('past', err('"x".repeat(60000).replace(/x/g, "yy") != ""'))
        self.assertIn('past', err('["x".repeat(60000), "x".repeat(60000)].join("") != ""'))
        # doubling through formulas: each step is small, the result is not
        doubling = 'formulas:\n  a: \'"x".repeat(50000)\'\n  b: \'formula.a + formula.a + formula.a\'\n' \
                   'filters: \'formula.b != ""\'\n'
        self.assertIn('past', self.run_base(doubling)['errors'][0])
        with mock.patch.object(bases, 'TIME_BUDGET', -1):
            out = self.run_base("filters: 'file.ext == \"md\"'\n")
        self.assertEqual(out['rows'], [])
        self.assertIn('takes more than', out['errors'][0])

    def test_not_is_none_of_them(self):
        out = self.run_base('filters:\n  not:\n    - file.hasTag("book")\n    - file.ext == "png"\n')
        self.assertEqual(self.names(out), ['Notes/Plain.md', 'Notes/Tagged.md', 'Textbook.md'])

    def test_filters_functions_and_operators(self):
        cases = {
            'file.inFolder("Books")': ['Books/Dune.md', 'Books/Emma.md', 'Books/Hobbit.md'],
            'file.hasTag("tag")': ['Notes/Plain.md', 'Notes/Tagged.md'],  # #tag/nested counts as #tag
            'price >= 10 && status != "done"': ['Books/Dune.md', 'Books/Hobbit.md'],
            'status.contains("do")': ['Books/Emma.md', 'Books/Hobbit.md'],
            'file.hasProperty("status") && !(price > 5)': ['Books/Emma.md'],
            'read > date("2026-10-01")': ['Books/Dune.md'],
            'read < today() + "100 years"': ['Books/Dune.md'],
            'file.name.startsWith("T") || file.basename == "cover"': ['cover.png', 'Notes/Tagged.md', 'Textbook.md'],
            'file.hasLink("Textbook")': ['Books/Dune.md', 'Books/Emma.md'],
            '[1, 2].contains(age) && file.ext == "md" && price % 2 == 0': ['Books/Dune.md', 'Books/Hobbit.md'],
            'list(tags).containsAny("scifi", "tag")': ['Notes/Tagged.md'],
            'file.tags.contains("#scifi")': ['Books/Dune.md'],
            'file.backlinks.length > 1': ['Textbook.md'],
            '/^E/.matches(file.name)': ['Books/Emma.md'],
        }
        for expr, want in cases.items():
            with self.subTest(expr=expr):
                out = self.run_base(f'filters: {bases.json.dumps(expr)}\n')
                self.assertEqual(out['errors'], [])
                self.assertEqual(self.names(out), want)

    def test_formulas_dates_and_methods(self):
        out = self.run_base('filters: file.inFolder("Books")\nformulas:\n  total: price * age\n  twice: formula.total * 2\n'
                            '  when: \'if(read, date(read).format("D MMM YYYY"), "unread")\'\n'
                            '  label: status.upper() + " " + price.toFixed(1)\n  days: (date("2026-11-11") - date(read))\n'
                            'views:\n  - type: table\n    order: [file.basename, formula.twice, formula.when, formula.label, formula.days]\n')
        self.assertEqual(out['rows'][0]['cells'], ['Dune', 20, '1 Nov 2026', 'READING 10.0', '1 week'])
        self.assertEqual(out['rows'][2]['cells'][:3], ['Hobbit', 120, 'unread'])

    def test_sort_limit_group_order_and_summaries(self):
        out = self.run_base('filters: file.hasProperty("price")\nviews:\n  - type: table\n    name: Cheap first\n'
                            '    order: [file.basename, price, status]\n    sort:\n      - property: price\n        direction: ASC\n'
                            '    limit: 3\n    summaries:\n      price: Sum\n      status: Empty\n'
                            '  - type: cards\n    name: By status\n    groupBy: status\n    groupOrder: [todo, null]\n'
                            '    image: note.cover\n')
        self.assertEqual([r['cells'][0] for r in out['rows']], ['Emma', 'Ulysses', 'Dune'])
        self.assertEqual((out['total'], out['limit']), (4, 3))
        self.assertEqual(out['summaries'], [None, {'name': 'Sum', 'value': 22}, {'name': 'Empty', 'value': 1}])
        cards = self.run_base('filters: file.hasProperty("price")\nviews:\n  - type: table\n  - type: cards\n'
                              '    groupBy: status\n    groupOrder: [todo, null]\n', view=1)
        self.assertEqual([(g['label'], len(g['rows'])) for g in cards['groups']], [('todo', 1), (None, 1)])

    def test_sort_desc_keeps_empty_last(self):
        out = self.run_base('filters: file.inFolder("Books") || file.inFolder("Required Reading")\nviews:\n'
                            '  - type: table\n    order: [file.basename]\n    sort:\n      - property: status\n        direction: DESC\n')
        self.assertEqual([r['cells'][0] for r in out['rows']], ['Hobbit', 'Dune', 'Emma', 'Ulysses'])

    def test_this_is_the_embedding_note(self):
        files = {**BOOKS, 'Index.md': ({'shelf': 'Books'}, '![[Books.base]]')}
        out = self.run_base('filters: file.inFolder(this.shelf)\n', this='Index.md', files=files)
        self.assertEqual(len(out['rows']), 3)
        out = self.run_base('filters: file.hasLink(this.file)\n', this='Textbook.md')
        self.assertEqual(self.names(out), ['Books/Dune.md', 'Books/Emma.md'])

    def test_unsupported_is_said_never_guessed(self):
        out = self.run_base('filters: file.inFolder("Books")\nviews:\n  - type: map\n')
        self.assertEqual((out['rows'], out['unsupported']), ([], ['a map view']))
        out = self.run_base('filters: html("x")\n')
        self.assertEqual((out['rows'], out['unsupported']), ([], ['html()']))
        out = self.run_base('filters: file.inFolder("Books")\nformulas:\n  x: price.mean()\n'
                            'views:\n  - type: table\n    order: [file.name, formula.x]\n    summaries:\n      file.name: customAverage\n')
        self.assertEqual(len(out['rows']), 3)
        self.assertEqual(out['rows'][0]['cells'][1], None)
        self.assertEqual(out['unsupported'], ['number.mean()', 'the summary customAverage'])

    def test_errors_are_reported(self):
        out = self.run_base('filters: price >\n')
        self.assertEqual(out['rows'], [])
        self.assertTrue(out['errors'] and 'unexpected' in out['errors'][0])
        out = self.run_base('formulas:\n  a: formula.b\n  b: formula.a\nviews:\n  - type: table\n    order: [formula.a]\n')
        self.assertIn('refers to itself', ' '.join(out['errors']))


class StoreBases(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.realpath(copy_sample(SAMPLE_VAULT, os.path.join(tmp.name, 'vault')))
        env = mock.patch.dict(os.environ, {'TM_CACHE_DIR': os.path.join(tmp.name, 'cache')})
        env.start()
        self.addCleanup(env.stop)
        write(self.root, 'Docs/Reading/Dune.md', '---\ncategory: Books   # shelf\nrating: 4\n---\n# Dune\n')
        write(self.root, 'Docs/Reading/Emma.md', '---\ncategory: Novels\n---\nText.\n')
        write(self.root, 'Docs/Reading/Shelf.base', 'filters: file.inFolder("Docs/Reading")\nviews:\n'
                                                   '  - type: table\n    name: All\n    order: [file.name, category, rating]\n'
                                                   '  - type: table\n    name: Notes\n    filters: file.ext == "md"\n'
                                                   '    order: [file.name, tags, fileClass]\n')
        self.s = Store(self.root, structure='ticketing')

    def test_a_view_by_name_and_its_editable_cells(self):
        out = self.s.base('Docs/Reading/Shelf.base')
        self.assertEqual([v['name'] for v in out['views']], ['All', 'Notes'])
        self.assertEqual([r['path'] for r in out['rows']], ['Docs/Reading/Dune.md', 'Docs/Reading/Emma.md', 'Docs/Reading/Shelf.base'])
        self.assertEqual(out['rows'][0]['cells'], ['Dune.md', 'Books', 4])
        self.assertEqual([c['editable'] for c in out['columns']], [False, True, True])
        self.assertEqual(out['rows'][2].get('locked'), [1, 2])  # a .base has no properties
        notes = self.s.base('Docs/Reading/Shelf.base', 'notes')
        self.assertEqual(notes['rows'][0]['locked'], [1, 2])  # tags and fileClass are the app's
        with self.assertRaises(StoreError):
            self.s.base('Docs/Reading/Shelf.base', 'Nope')

    def test_items_are_locked(self):
        write(self.root, 'Docs/Items.base', 'filters: file.inFolder("Tasks")\nviews:\n  - type: table\n    order: [file.name, status]\n')
        out = self.s.base('Docs/Items.base')
        self.assertTrue(out['rows'])
        self.assertTrue(all(r['locked'] == [1] for r in out['rows']))
        with self.assertRaises(StoreError) as e:
            self.s.set_note_property(out['rows'][0]['path'], 'status', 'Done')
        self.assertEqual(e.exception.status, 409)

    def test_set_note_property_writes_only_that_key(self):
        before = read(self.root, 'Docs/Reading/Dune.md')
        self.s.set_note_property('Docs/Reading/Dune.md', 'rating', 5)
        self.assertEqual(read(self.root, 'Docs/Reading/Dune.md'), before.replace('rating: 4', 'rating: 5'))
        self.s.set_note_property('Docs/Reading/Dune.md', 'related_tool', ['Obsidian', ''])
        self.assertIn('related_tool: ["Obsidian"]\n---', read(self.root, 'Docs/Reading/Dune.md'))
        self.s.set_note_property('Docs/Reading/Dune.md', 'related_tool', None)
        self.s.set_note_property('Docs/Reading/Dune.md', 'rating', 4)
        self.assertEqual(read(self.root, 'Docs/Reading/Dune.md'), before)
        self.assertEqual(self.s.base('Docs/Reading/Shelf.base')['rows'][0]['cells'], ['Dune.md', 'Books', 4])
        for bad in [('Docs/Reading/Dune.md', 'tags', ['x']), ('Docs/Reading/Shelf.base', 'a', 1), ('Docs/Reading/Dune.md', 'a b', 1)]:
            with self.assertRaises(StoreError):
                self.s.set_note_property(*bad)

    def test_a_bad_base_says_so(self):
        write(self.root, 'Docs/Bad.base', 'views:\n  - type: table\n   x: 1\n')
        out = self.s.base('Docs/Bad.base')
        self.assertIn('cannot be read', out['error'])
        with self.assertRaises(StoreError):
            self.s.base('Docs/Reading/Dune.md')


if __name__ == '__main__':
    unittest.main()
