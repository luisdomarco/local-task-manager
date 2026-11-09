"""What an agent works with (tm/agentlinks.py): the skills, subagents, commands and files its prompt names, one step
further through a skill or subagent, and only those read for its tabs."""
import os
import shutil
import tempfile
import unittest

from tm import agentfiles, agentlinks
from tm.store import StoreError


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


class RelatedTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='tm links ')
        self.addCleanup(shutil.rmtree, self.dir, True)
        d = self.dir
        write(os.path.join(d, '.claude/commands/wor-build.md'),
              '---\ndescription: Build\n---\nUse `ski-ledger` first, then hand it to age-spe-writer.\n'
              'When done, run /help. See docs/guide.md, `.claude/rules/style.md`, ./notes.txt, ../outside.md and missing.md.\n'
              'Not ski-ledger-old, nor /helper, nor /help:more.\n')
        write(os.path.join(d, '.claude/commands/help.md'), '---\ndescription: Help\n---\nHelp.\n')
        write(os.path.join(d, '.claude/skills/ski-ledger/SKILL.md'), '---\nname: ski-ledger\ndescription: Keeps a ledger\n---\nBody\n')
        write(os.path.join(d, '.claude/skills/ski-render/SKILL.md'), '---\nname: ski-render\ndescription: Renders\n---\nUses ski-xml.\n')
        write(os.path.join(d, '.claude/skills/ski-xml/SKILL.md'), '---\nname: ski-xml\n---\nDeep\n')
        write(os.path.join(d, '.claude/skills/ski-unused/SKILL.md'), '---\nname: ski-unused\n---\n')
        write(os.path.join(d, '.claude/agents/age-spe-writer.md'), '---\nname: age-spe-writer\ndescription: Writes\n---\nCalls ski-render.\n')
        write(os.path.join(d, 'docs/guide.md'), '# Guide\n')
        write(os.path.join(d, '.claude/rules/style.md'), '---\ndescription: Style\n---\nRules\n')
        write(os.path.join(d, 'notes.txt'), 'notes')
        write(os.path.join(os.path.dirname(d), 'outside.md'), 'not its own')
        self.addCleanup(lambda: os.path.exists(os.path.join(os.path.dirname(d), 'outside.md')) and os.remove(os.path.join(os.path.dirname(d), 'outside.md')))

    def test_it_finds_what_the_prompt_names_and_one_step_further(self):
        got = agentlinks.related(self.dir, 'wor-build')
        self.assertEqual([(i['name'], i.get('via')) for i in got['skills']], [('ski-ledger', None), ('ski-render', 'age-spe-writer')])  # ski-xml: a step too far
        self.assertEqual([(i['name'], i['description'], i['path']) for i in got['agents']], [('age-spe-writer', 'Writes', '.claude/agents/age-spe-writer.md')])
        self.assertEqual([i['name'] for i in got['commands']], ['help'])
        self.assertEqual([i['path'] for i in got['files']], ['docs/guide.md', '.claude/rules/style.md', 'notes.txt'])  # inside the folder, and there
        self.assertIsNone(agentlinks.related(self.dir, 'nope'))
        self.assertEqual(agentlinks.related(self.dir, 'help'), {'skills': [], 'agents': [], 'commands': [], 'files': []})

    def test_only_its_file_or_a_related_one_is_read_whole(self):
        skill = agentfiles.read(self.dir, 'wor-build', '.claude/skills/ski-ledger/SKILL.md')
        self.assertEqual((skill['text'], skill['body'].strip(), skill['markdown']),
                         ('---\nname: ski-ledger\ndescription: Keeps a ledger\n---\nBody\n', 'Body', True))
        self.assertEqual(agentfiles.read(self.dir, 'wor-build', 'notes.txt')['body'], 'notes')
        own = agentfiles.read(self.dir, 'help')  # no path: the command's own file
        self.assertEqual((own['path'], own['text']), ('.claude/commands/help.md', '---\ndescription: Help\n---\nHelp.\n'))
        for path in ('.claude/skills/ski-unused/SKILL.md', '../outside.md', '/etc/hosts', '.claude/commands/wor-build.md'):
            self.assertIsNone(agentfiles.read(self.dir, 'wor-build', path), path)
        self.assertIsNone(agentfiles.read(self.dir, 'nope'))

    def test_a_save_goes_against_the_version_it_was_read_at(self):
        path = '.claude/skills/ski-ledger/SKILL.md'
        was = agentfiles.read(self.dir, 'wor-build', path)
        now = agentfiles.save(self.dir, 'wor-build', path, was['text'].replace('Body', 'New body'), was['rev'])
        self.assertEqual(now['body'].strip(), 'New body')
        with self.assertRaises(StoreError) as cm:  # written meanwhile (an editor, an agent): never over it
            agentfiles.save(self.dir, 'wor-build', path, 'mine', was['rev'])
        self.assertEqual((cm.exception.status, cm.exception.extra['rev']), (409, now['rev']))
        self.assertIsNone(agentfiles.save(self.dir, 'wor-build', '../outside.md', 'x', ''))  # only its own files
        with open(os.path.join(os.path.dirname(self.dir), 'outside.md'), encoding='utf-8') as f:
            self.assertEqual(f.read(), 'not its own')

    def test_a_file_reached_through_a_link_is_written_where_it_lives(self):
        system = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, system)
        write(os.path.join(system, 'commands', 'go.md'), 'Go.\r\n')
        app = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, app)
        os.makedirs(os.path.join(app, '.claude'))
        os.symlink(os.path.join(system, 'commands'), os.path.join(app, '.claude', 'commands'))
        was = agentfiles.read(app, 'go')
        agentfiles.save(app, 'go', '', 'Go on.\n', was['rev'])
        self.assertTrue(os.path.islink(os.path.join(app, '.claude', 'commands')))  # the link stays a link
        with open(os.path.join(system, 'commands', 'go.md'), 'rb') as f:
            self.assertEqual(f.read(), b'Go on.\r\n')  # CRLF kept

if __name__ == '__main__':
    unittest.main()
