"""What an agent works with (tm/agentlinks.py): the skills, subagents, commands and files its prompt names, one step
further through a skill or subagent, and only those read for its tabs."""
import os
import shutil
import tempfile
import unittest

from tm import agentlinks


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

    def test_only_a_related_file_is_read(self):
        skill = agentlinks.read_related(self.dir, 'wor-build', '.claude/skills/ski-ledger/SKILL.md')
        self.assertEqual((skill['description'], skill['body'].strip(), skill['markdown']), ('Keeps a ledger', 'Body', True))
        self.assertEqual(agentlinks.read_related(self.dir, 'wor-build', 'notes.txt')['body'], 'notes')
        for path in ('.claude/skills/ski-unused/SKILL.md', '../outside.md', '/etc/hosts', '.claude/commands/wor-build.md'):
            self.assertIsNone(agentlinks.read_related(self.dir, 'wor-build', path), path)


if __name__ == '__main__':
    unittest.main()
