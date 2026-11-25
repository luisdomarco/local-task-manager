"""What a new project's file is made of, and that every path writes the same one.

A Ticketing item's frontmatter is not derived from the schema: it is a text file (`templates/<file class>.md`) with
`{{…}}` filled in (codec `template` → `fill`). Two things follow, and both bit a real vault (SUP-391):

* Editing that template forks the population. The files already on disk are never revisited, so the vault's projects
  split by the date each was created — `enabled_types` in the ones from before 2026-11-14, `area` and `objective` only
  in the ones from after 2026-11-07.
* A key the template writes but no type declares is write-only: `allowed_values` (tm/store.py) drops a value for any
  key outside `Structure.allowed_fields`, so neither the app nor the CLI can ever set it — only Obsidian, by hand.
  `premise_max_age_days` was one, and the readiness gate reads it (`rules._check_premise`).

So these tests pin three things: the template writes only keys the type declares, only placeholders `new_file` fills,
and every path that makes a project (the HTTP route's `Store.create`, `tools/vault.py new`, and
`tools/migrate_structures.py` calling `codec.new_file`) writes the same keys.
"""
import io
import os
import re
import tempfile
import unittest

from tm import frontmatter as fm
from tm.store import Store
from tm.structures import get as get_structure
from tm.structures.ticketing import codec as C
from tm.structures.ticketing.definition import LEGACY_PARENT, PROPS, SPEC
from tools import vault

ROOT_FOLDERS = ('Tasks', 'Notes', 'Meetings', 'Inbox', 'Activities', 'Work log')
PLACEHOLDER_RE = re.compile(r'\{\{([^}]*)\}\}')
EMBED_RE = re.compile(r'!\[\[([^\]|#]+)')

# Keys a type's template writes that the type does not declare: the same defect as the project's, type by type, left
# visible here instead of silently drifting (SUP-391 lists them; the owner decides each). A key leaves this table
# when it is declared or dropped — never by adding another one.
UNDECLARED = {
    'entity': ('priority',),                                   # an entity is not `prioritized` (tm/structures/traits.py)
    'hotfix': ('spec_impact', 'cherry_picked_to_develop'),     # `spec_impact` is a story's prop; the other is read nowhere
    'support': ('evidence', 'changelog_ref'),                  # `evidence` is read nowhere; `changelog_ref` is a story's
}


def declared(structure, t):
    """Every key a file of type `t` may legitimately carry: its type's fields, the keys the codec gives another name
    (`fileClass`, `status_ticket`, the dates, `tags`), what Obsidian and the codec add on their own (`aliases`,
    `name`, `status_log`), its parent and its links."""
    return (set(structure.allowed_fields(t)) | set(C.DISK_KEYS) | {'aliases', 'name', 'status_log'}
            | C.links_of(t) | C.multi_links_of(t) | {p['key'] for p in PROPS.get(t, ())}
            | {SPEC[t]['parent'], LEGACY_PARENT.get(t), 'project'})


class ShippedTextsTest(unittest.TestCase):
    """The templates and default texts this app ships, read as data."""

    def setUp(self):
        self.structure = get_structure('ticketing')

    def texts(self):
        """(what it is, its text) for every shipped template and default text."""
        for folder in (C.TEMPLATES, C.DEFAULT_TEXTS):
            for name in sorted(os.listdir(folder)):
                if name.endswith('.md'):
                    with open(os.path.join(folder, name), encoding='utf-8') as f:
                        yield os.path.join(os.path.basename(folder), name), f.read()

    def test_a_template_writes_only_keys_its_type_declares(self):
        for t in SPEC:
            with open(os.path.join(C.TEMPLATES, f"{SPEC[t]['file_class']}.md"), encoding='utf-8') as f:
                keys = list(fm.parse(fm.split(f.read())[0]))
            extra = [k for k in keys if k not in declared(self.structure, t)]
            self.assertEqual(extra, list(UNDECLARED.get(t, ())), f'{t}: keys no type declares')

    def test_the_project_template_declares_every_key_it_writes(self):
        # The one this fix is about: no exception at all, so it cannot drift again.
        self.assertNotIn('project', UNDECLARED)

    def test_the_retired_keys_are_written_nowhere(self):
        # No code reads any of them on a project: `enabled_types` (what a project holds follows from its initiatives'
        # kinds since 2026-11-14), `areas` (the closed list of areas was never implemented), `living_specs` (the specs
        # are in `Specs/`), `related_initiatives` (a link kept before the app had relations; still a property of the
        # owner's own Obsidian notes, which a project note does not take part in). The one key a rule does read,
        # `premise_max_age_days`, is declared instead and stays in the template.
        for what, text in self.texts():
            for key in ('enabled_types', 'areas', 'living_specs', 'related_initiatives'):
                self.assertNotRegex(text, rf'(?m)^{key}:', f'{what} still writes {key}')

    def test_a_shipped_text_only_uses_placeholders_new_file_fills(self):
        for what, text in self.texts():
            for name in PLACEHOLDER_RE.findall(text):
                self.assertIn(name, C.TEMPLATE_VARIABLES, f'{what}: {{{{{name}}}}} is filled in by nobody')


class NewProjectTest(unittest.TestCase):
    """A project as each path writes it."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        for d in ROOT_FOLDERS:
            os.makedirs(os.path.join(self.root, d))
        self.s = Store(self.root, structure='ticketing', enforce_structure=True)

    def cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        code = vault.main(['-C', self.root, *argv], out=out, err=err)
        self.assertEqual(code, 0, out.getvalue() + err.getvalue())
        return out.getvalue()

    def text(self, rel):
        with open(os.path.join(self.root, rel), encoding='utf-8') as f:
            return f.read()

    def keys_of(self, rel):
        return list(fm.parse(fm.split(self.text(rel))[0]))

    def test_the_app_and_the_cli_write_a_project_with_the_same_keys(self):
        # What POST /api/item/create calls, and what an agent runs: one template, so one shape.
        app = self.s.create('project', 'Alpha One', {'project_key': 'ALP'})
        self.cli('new', 'project', 'Beta Two', '--set', 'project_key=BET')
        cli = self.s.find('BET')
        self.assertEqual(self.keys_of(app['path']), self.keys_of(cli['path']))
        self.assertEqual(self.keys_of(app['path']),
                         ['fileClass', 'project_key', 'repo', 'managed_by', 'area', 'objective', 'execution_mode',
                          'support_due_days', 'premise_max_age_days', 'url', 'tags', 'creation_date', 'updated_date',
                          'sidebar'])

    def test_a_migration_writes_the_same_project_as_the_app(self):
        # tools/migrate_structures.py builds the note itself, through the codec: the same template, the same keys.
        app = self.s.create('project', 'Alpha One', {'project_key': 'ALP'})
        r = self.s._resolver()
        rel, text = C.TicketingCodec().new_file('project', 'Gamma Three', {}, '', r, None, '2026-11-19T10:00:00')
        self.assertEqual(list(fm.parse(fm.split(text)[0])),
                         [k for k in self.keys_of(app['path']) if k != 'sidebar'])
        self.assertEqual(rel, 'Gamma Three/00 Gamma Three.md')

    def test_a_new_project_carries_no_placeholder_of_its_own(self):
        it = self.s.create('project', 'Alpha One', {'project_key': 'ALP'})
        self.assertNotIn('{{', self.text(it['path']))

    def test_a_new_project_embeds_no_file_that_does_not_exist(self):
        # Its note promised `![[<Project>.base#Open]]` until SUP-391: nobody writes a `.base` (tm/bases.py only
        # reads one, and the vault's AGENTS.md tells agents never to touch one), so the embed was always dead.
        it = self.s.create('project', 'Alpha One', {'project_key': 'ALP'})
        stems = {os.path.splitext(f)[0] for _, _, files in os.walk(self.root) for f in files}
        for target in EMBED_RE.findall(self.text(it['path'])):
            self.assertIn(os.path.splitext(target.strip())[0], stems, f'{target} is embedded but not in the vault')

    def test_the_premise_gate_reads_a_max_age_the_app_can_now_set(self):
        # The key the template wrote and no type declared: a value for it was dropped before it reached the disk.
        p = self.s.create('project', 'Alpha One', {'project_key': 'ALP'})
        self.s.update(p['key'], {'premise_max_age_days': 30})
        self.assertEqual(self.s.find('ALP')['fields']['premise_max_age_days'], 30)
        self.assertRegex(self.text(p['path']), r'(?m)^premise_max_age_days: 30\b')

    def test_a_number_field_is_kept_as_a_number_whoever_sends_it(self):
        # The page's number box and tools/vault.py both send text; a field the structure draws as a number is written
        # as one, so the file says `21`, not `"21"` (store.number_fields, read from the schema).
        p = self.s.create('project', 'Alpha One', {'project_key': 'ALP'})
        self.s.update(p['key'], {'premise_max_age_days': '21'})
        self.assertRegex(self.text(p['path']), r'(?m)^premise_max_age_days: 21\b')
        self.cli('set', 'ALP', 'premise_max_age_days=7')
        self.assertRegex(self.text(p['path']), r'(?m)^premise_max_age_days: 7\b')
        self.assertEqual(self.s.find('ALP')['fields']['premise_max_age_days'], 7)


OLD_SHAPE = '''---
fileClass: Ticket Project
project_key: FOUR               # 2-4 capital letters, unique in the vault
project_kind: product                  # system | product
repo: ""                               # where the code lives
living_specs: "openspec/specs"         # product: openspec/specs
enabled_types: ["initiative", "support"] # system projects usually drop hotfix
areas: []                              # closed list for the `area` field
premise_max_age_days: 14               # gate Backlog→ToDo fails if older
related_initiatives: []                # the personal Initiative note(s)
tags: ["navegacion"]
creation_date: 2026-10-17
updated_date: 2026-11-19
---

> [!owner] What this project is
> Mine, written by hand.

## Board

![[.base#Open]]

## Living specs

- Path: `{{living_specs}}`

## Related

-
'''


class MigrationTest(unittest.TestCase):
    """tools/migrate_project_keys.py on a note of each older shape. It is never run against a real vault here."""

    def migrated(self, text):
        from tools.migrate_project_keys import migrated
        return migrated(text)

    def test_a_note_from_before_becomes_the_shape_of_one_created_today(self):
        new, changed, left = self.migrated(OLD_SHAPE)
        keys = list(fm.parse(fm.split(new)[0]))
        self.assertEqual(keys, ['fileClass', 'project_key', 'project_kind', 'repo', 'premise_max_age_days', 'tags',
                                'creation_date', 'updated_date', 'area', 'objective'])
        self.assertEqual(left, [])
        self.assertIn('enabled_types dropped', changed)

    def test_it_keeps_every_other_byte(self):
        new, _, _ = self.migrated(OLD_SHAPE)
        # the owner's own prose, the comments on the keys it keeps, the blank line under the frontmatter and the
        # trailing spaces of the body all stay as they were
        self.assertIn('> Mine, written by hand.', new)
        self.assertIn('premise_max_age_days: 14               # gate Backlog→ToDo fails if older', new)
        self.assertTrue(new.startswith('---\nfileClass: Ticket Project\n'))
        self.assertIn('---\n\n> [!owner]', new)
        self.assertTrue(new.endswith('## Related\n\n-\n'), repr(new[-20:]))
        # a trailing space of the body is a byte like any other (an `- ` bullet the owner left to fill in)
        spaced = OLD_SHAPE.replace('## Related\n\n-\n', '## Related\n\n-' + ' ' + '\n')
        self.assertTrue(self.migrated(spaced)[0].endswith('-' + ' ' + '\n'))

    def test_the_path_a_placeholder_meant_is_kept_before_its_key_goes(self):
        new, changed, _ = self.migrated(OLD_SHAPE)
        self.assertIn('- Path: `openspec/specs`', new)
        self.assertNotIn('{{', new)
        self.assertIn('{{living_specs}} → openspec/specs', changed)

    def test_a_dead_board_embed_goes_but_a_board_with_anything_else_is_left_alone(self):
        new, _, _ = self.migrated(OLD_SHAPE)
        self.assertNotIn('## Board', new)
        mine = OLD_SHAPE.replace('![[.base#Open]]', '![[.base#Open]]\n\nWhat I think of the board.')
        kept, _, left = self.migrated(mine)
        self.assertIn('## Board', kept)
        self.assertIn('What I think of the board.', kept)
        self.assertEqual(left, ['## Board holds more than the embed: left as it is'])

    def test_a_note_of_todays_shape_is_left_exactly_as_it_is(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for d in ROOT_FOLDERS:
            os.makedirs(os.path.join(tmp.name, d))
        s = Store(tmp.name, structure='ticketing', enforce_structure=True)
        it = s.create('project', 'Alpha One', {'project_key': 'ALP'})
        with open(os.path.join(tmp.name, it['path']), encoding='utf-8') as f:
            text = f.read()
        new, changed, left = self.migrated(text)
        self.assertEqual((new, changed, left), (text, [], []))


if __name__ == '__main__':
    unittest.main()
