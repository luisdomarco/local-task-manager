"""Frontmatter hardening for Obsidian-native files (Ticketing): comments, nested blocks, flow maps.

The existing folder-per-type behaviour is pinned by two corpus checks: `patch(text, {})` is byte-identical,
and every committed `sample-vault/` file parses exactly as it did before this change
(`fixtures/sample_vault_parsed.json`, captured with the old code, with each file's hash).
"""

import hashlib
import json
import os
import unittest

from tm import frontmatter as fm

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEMPLATES = os.path.join(HERE, 'fixtures', 'ticketing_templates')
SAMPLE = os.path.join(HERE, 'fixtures', 'sample_vault_corpus')  # sample-vault/ as it was when the parser was pinned


def read(path):
    with open(path, encoding='utf-8', newline='') as f:
        return f.read()


def corpus(root):
    for d, _, files in sorted(os.walk(root)):
        for f in sorted(files):
            if f.endswith('.md'):
                yield os.path.join(d, f)


def fields(text):
    return fm.parse(fm.split(text)[0])


class CorpusTest(unittest.TestCase):
    def test_patch_without_updates_is_byte_identical(self):
        paths = list(corpus(TEMPLATES)) + list(corpus(SAMPLE))
        self.assertGreaterEqual(len(paths), 9 + 15)
        for path in paths:
            with self.subTest(path=os.path.relpath(path, ROOT)):
                text = read(path)
                self.assertEqual(fm.patch(text, {}), text)

    def test_patching_one_key_moves_nothing_else(self):
        new = [{'date': '2026-10-17', 'from': '1. Backlog', 'to': '2. ToDo'}]
        for path in list(corpus(TEMPLATES)) + list(corpus(SAMPLE)):
            text = read(path)
            before, body = fields(text), fm.split(text)[1]
            for key in before:
                with self.subTest(path=os.path.basename(path), key=key):
                    out = fm.patch(text, {key: new})
                    self.assertEqual(fields(out), {**before, key: new})
                    self.assertEqual(fm.split(out)[1], body)
                    def others(t):  # every other top-level line (keys, comments), in order
                        return [l for l in fm.split(t)[0].split('\n')
                                if l and l[0] not in ' \t-' and not l.startswith(key + ':')]
                    self.assertEqual(others(out), others(text))

    def test_sample_vault_parses_as_before(self):
        # The committed sample-vault files, parsed by the old code, with the hash of the bytes that were parsed. A file
        # edited in this checkout (trying the app out writes into sample-vault) is skipped, never failed: what it
        # pins is the parser, not the checkout. Enough of them must still be compared for the test to mean anything.
        with open(os.path.join(HERE, 'fixtures', 'sample_vault_parsed.json'), encoding='utf-8') as f:
            before = json.load(f)
        compared = 0
        for rel, was in before.items():
            path = os.path.join(SAMPLE, rel)
            with self.subTest(rel=rel):
                if not os.path.exists(path):
                    self.skipTest('not in this checkout')
                with open(path, 'rb') as f:
                    data = f.read()
                if hashlib.sha256(data).hexdigest() != was['sha256']:
                    self.skipTest('edited in this checkout')
                self.assertEqual(fields(data.decode('utf-8')), was['fields'])
                compared += 1
        self.assertGreaterEqual(compared, 10)

    def test_templates_parse_without_comments(self):
        f = fields(read(os.path.join(TEMPLATES, 'Ticket Project.md')))
        self.assertEqual(f['project_kind'], 'product')
        self.assertEqual(f['enabled_types'], ['initiative', 'support', 'hotfix', 'prd'])
        self.assertEqual(f['support_due_days'], {'C1': 0, 'C2': 7, 'C3': 30})
        self.assertEqual(f['areas'], [])
        f = fields(read(os.path.join(TEMPLATES, 'Ticket Initiative.md')))
        self.assertEqual(f['status_ticket'], '1. Backlog')
        self.assertEqual(f['status_log'], [])
        self.assertEqual(f['on_hold'], {})
        self.assertEqual(f['parent'], '')
        self.assertEqual(f['creation_date'], '{{date}}')  # placeholder: not YAML, kept as text
        for path in corpus(TEMPLATES):
            for key, value in fields(read(path)).items():
                self.assertNotIn('#', json.dumps(value), f'{os.path.basename(path)}: {key}')


class ParseTest(unittest.TestCase):
    def test_trailing_comments_are_stripped_outside_quotes(self):
        text = ('---\n'
                'a: plain   # note\n'
                'b: "quoted # kept"   # note\n'
                "c: 'it''s # kept' # note\n"
                'd: C#sharp\n'
                'e: 3 # n\n'
                'f: [x, "y # z"] # n\n'
                'g: # only a comment\n'
                'h: "[[KEY-INI-001 Foo]]"  # link\n'
                '---\n')
        self.assertEqual(fields(text), {'a': 'plain', 'b': 'quoted # kept', 'c': "it's # kept", 'd': 'C#sharp',
                                        'e': 3, 'f': ['x', 'y # z'], 'g': None, 'h': '[[KEY-INI-001 Foo]]'})

    def test_block_list_of_maps(self):
        text = ('---\n'
                'status_log:          # written by the capability\n'
                '  - date: 2026-10-16\n'
                '    from: 1. Backlog   # why\n'
                '    to: "2. ToDo"\n'
                '\n'
                '  - date: 2026-10-17\n'
                '    from: 2. ToDo\n'
                '    to: 3. InProgress\n'
                '    by: owner\n'
                'next: x\n'
                '---\n')
        self.assertEqual(fields(text), {
            'status_log': [{'date': '2026-10-16', 'from': '1. Backlog', 'to': '2. ToDo'},
                           {'date': '2026-10-17', 'from': '2. ToDo', 'to': '3. InProgress', 'by': 'owner'}],
            'next': 'x'})

    def test_block_list_at_column_zero_and_nested(self):
        text = '---\ntags:\n- a\n- b # c\nm:\n  - - x\n    - y\n  -\n    k: v\n---\n'
        self.assertEqual(fields(text), {'tags': ['a', 'b'], 'm': [['x', 'y'], {'k': 'v'}]})

    def test_block_map(self):
        text = ('---\n'
                'on_hold:     # {by, why, resume_when}\n'
                '  by: owner\n'
                '  why: "waiting: vendor"\n'
                '  resume_when:\n'
                '    - vendor answers\n'
                '  nested:\n'
                '    deep: 1\n'
                'after: 2\n'
                '---\n')
        self.assertEqual(fields(text), {'on_hold': {'by': 'owner', 'why': 'waiting: vendor',
                                                    'resume_when': ['vendor answers'], 'nested': {'deep': 1}},
                                        'after': 2})

    def test_flow_map_with_unquoted_keys(self):
        self.assertEqual(fm.parse_value('{C1: 0, C2: 7, C3: 30}'), {'C1': 0, 'C2': 7, 'C3': 30})
        self.assertEqual(fm.parse_value('{by: owner, why: "a, b", tags: [x, y], n: {k: v}} # c'),
                         {'by': 'owner', 'why': 'a, b', 'tags': ['x', 'y'], 'n': {'k': 'v'}})
        self.assertEqual(fm.parse_value('{"a": 1, b: true, c: null, d: }'), {'a': 1, 'b': True, 'c': None, 'd': None})
        self.assertEqual(fm.parse_value('{}'), {})
        # Not a map we understand: kept as the raw text rather than guessed.
        self.assertEqual(fm.parse_value('{{date}}'), '{{date}}')
        self.assertEqual(fm.parse_value('{a: 1'), '{a: 1')

    def test_values_the_old_parser_already_handled(self):
        self.assertEqual(fm.parse_value('[a, b]'), ['a', 'b'])
        self.assertEqual(fm.parse_value('[[00 X]]'), [['00 X']])
        self.assertEqual(fm.parse_value('[]'), [])
        self.assertEqual(fm.parse_value('"x"'), 'x')
        self.assertEqual(fm.parse_value('http://a.b/c#frag'), 'http://a.b/c#frag')
        self.assertEqual(fm.parse_value('[{"at": "2026-10-14T10:00", "text": "a # b"}]'),
                         [{'at': '2026-10-14T10:00', 'text': 'a # b'}])


class PatchTest(unittest.TestCase):
    BLOCK = ('---\n'
             'id: "HB-INI-001"           # KEY-INI-NNN\n'
             'status_ticket: "1. Backlog"            # only via tickets_move\n'
             'status_log:\n'
             '  - date: 2026-10-16\n'
             '    from: 1. Backlog\n'
             '    to: 2. ToDo\n'
             '\n'
             '# a column-0 comment stays\n'
             'on_hold:\n'
             '  by: owner\n'
             'tags: []\n'
             '---\n'
             'body # not frontmatter\n')

    def test_replacing_a_block_list_leaves_no_orphan_lines(self):
        log = [{'date': '2026-10-16', 'from': '1. Backlog', 'to': '2. ToDo'},
               {'date': '2026-10-17', 'from': '2. ToDo', 'to': '3. InProgress'}]
        out = fm.patch(self.BLOCK, {'status_log': log})
        self.assertNotIn('    from:', out)
        self.assertNotIn('    to:', out)
        self.assertEqual(fields(out)['status_log'], log)
        self.assertIn('\n\n# a column-0 comment stays\non_hold:\n  by: owner\n', out)
        self.assertEqual(fields(out)['on_hold'], {'by': 'owner'})

    def test_replacing_a_block_map(self):
        out = fm.patch(self.BLOCK, {'on_hold': {}})
        self.assertNotIn('  by: owner', out)
        self.assertEqual(fields(out)['on_hold'], {})
        self.assertEqual(fields(out)['tags'], [])

    def test_scalar_keeps_its_comment_and_column(self):
        out = fm.patch(self.BLOCK, {'status_ticket': '2. ToDo'})
        self.assertIn('\nstatus_ticket: "2. ToDo"               # only via tickets_move\n', out)
        out = fm.patch(self.BLOCK, {'id': 'HB-INI-0001-with-a-much-longer-value'})
        self.assertIn('\nid: HB-INI-0001-with-a-much-longer-value # KEY-INI-NNN\n', out)
        self.assertEqual(fields(out)['id'], 'HB-INI-0001-with-a-much-longer-value')

    def test_untouched_keys_order_and_body_survive(self):
        out = fm.patch(self.BLOCK, {'status_ticket': '2. ToDo', 'new_key': 'v'})
        before = self.BLOCK.split('\n')
        after = out.split('\n')
        self.assertEqual([l for l in after if not l.startswith(('status_ticket', 'new_key'))],
                         [l for l in before if not l.startswith('status_ticket')])
        self.assertTrue(out.endswith('tags: []\nnew_key: v\n---\nbody # not frontmatter\n'))

    def test_body_is_not_given_a_blank_line_it_did_not_have(self):
        text = '---\na: 1\n---\nbody\n'
        self.assertEqual(fm.patch(text, {'a': 2}), '---\na: 2\n---\nbody\n')

    def test_replaced_body_still_gets_its_blank_line(self):
        self.assertEqual(fm.patch('---\na: 1\n---\nold\n', {}, 'new\n'), '---\na: 1\n---\n\nnew\n')

    def test_no_frontmatter(self):
        self.assertEqual(fm.patch('just text\n', {}), 'just text\n')
        self.assertEqual(fm.patch('just text\n', {'a': 1}), '---\na: 1\n---\n\njust text\n')
        self.assertEqual(fm.patch('---\n---\nx\n', {'a': 1}), '---\na: 1\n---\nx\n')

    def test_crlf_line_endings_are_kept(self):
        text = '---\r\na: 1   # c\r\nlog:\r\n  - x\r\nb: 2\r\n---\r\nbody\r\n'
        self.assertEqual(fm.patch(text, {}), text)
        self.assertEqual(fm.patch(text, {'log': ['y'], 'c': 3}),
                         '---\r\na: 1   # c\r\nlog: ["y"]\r\nb: 2\r\nc: 3\r\n---\r\nbody\r\n')

    def test_round_trip_of_nested_values(self):
        values = {'status_log': [{'date': '2026-10-16', 'from': '1. Backlog', 'to': '2. ToDo', 'by': None}],
                  'on_hold': {'by': 'owner', 'why': 'a: b # c', 'resume_when': ''},
                  'support_due_days': {'C1': 0, 'C2': 7}, 'title': 'Fix #12: "quotes"', 'empty': [],
                  'hash': '#tag', 'flag': False}
        self.assertEqual(fields(fm.build(values)), values)
        for path in corpus(TEMPLATES):
            text = read(path)
            self.assertEqual(fields(fm.patch(text, values)), {**fields(text), **values})


if __name__ == '__main__':
    unittest.main()
