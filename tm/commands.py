"""The agents a folder offers to the Agents section: its Claude Code custom commands, `.claude/commands/**/*.md`.

A command is named by its path under that folder, the way Claude Code names it: `dev/start.md` is `dev:start`, typed
`/dev:start`. Its frontmatter says what the page shows (description, argument hint, allowed tools…); its body is the
prompt Claude runs, with `$ARGUMENTS` replaced. Nothing here runs it: the page sends `/<name> <args>` to a session
started in that folder (tm/chat.py), so Claude itself loads the command, with its own `allowed-tools`.

`.claude/commands` is often a symlink (an app links the commands of the system that builds it, README §8 of the tree),
so links are followed as Claude Code follows them, each real folder once (no loops), up to MAX_FILES commands.
"""

import hashlib
import os
import re

from tm import frontmatter

COMMANDS_DIR = os.path.join('.claude', 'commands')
MAX_FILES = 500           # commands listed from one folder
MAX_BYTES = 256 * 1024    # of one command file read
NAME_RE = re.compile(r'^[\w.-]+(?::[\w.-]+)*$')


def dir_id(path):
    """A short, stable id for an agent folder, what the address shows (`#/runs/<id>/…`): from its real path, so
    the browser names a folder without ever sending one."""
    return hashlib.sha1(os.path.realpath(path).encode('utf-8')).hexdigest()[:8]


def command_name(rel):
    """`dev/start.md` → `dev:start` (the path under .claude/commands, `/` as `:`, without `.md`)."""
    return rel[:-3].replace(os.sep, ':').replace('/', ':') if rel.endswith('.md') else ''


def split_tools(raw):
    """`allowed-tools` as a list: a YAML list as it is, a string split on the commas outside parentheses
    (`Read, Bash(git add *, git commit *)` is two tools)."""
    if isinstance(raw, list):
        return [str(t).strip() for t in raw if str(t).strip()]
    out, depth, cur = [], 0, ''
    for c in str(raw or ''):
        if c == ',' and depth == 0:
            out.append(cur)
            cur = ''
            continue
        depth += (c == '(') - (c == ')')
        cur += c
    out.append(cur)
    return [t.strip() for t in out if t.strip()]


def _meta(fields):
    def text(key):
        v = fields.get(key)
        return ' '.join(str(v).split()) if v not in (None, '') else ''
    hint = fields.get('argument-hint')
    if isinstance(hint, list):  # `argument-hint: [topic]` is a list to YAML; Claude Code shows it as written
        hint = ' '.join(f'[{x}]' for x in hint)
    return {'description': text('description'), 'argument_hint': ' '.join(str(hint).split()) if hint not in (None, '') else '',
            'allowed_tools': split_tools(fields.get('allowed-tools')), 'model': text('model'),
            'disable_model_invocation': fields.get('disable-model-invocation') in (True, 'true')}


def _parse(text):
    """(frontmatter fields, body) of a command file; a frontmatter that cannot be read is no fields (the file is
    still a command: Claude Code runs it all the same)."""
    fm, body = frontmatter.split(text)
    try:
        fields = frontmatter.parse(fm) if fm is not None else {}
    except Exception:  # noqa: BLE001 — a hand-written file; show it without its fields rather than hide it
        fields = {}
    return (fields if isinstance(fields, dict) else {}), body


def _read_text(path):
    with open(path, 'rb') as f:
        return f.read(MAX_BYTES).decode('utf-8', 'replace')


def _walk(base):
    """(rel, full) of every .md under `base`, following links, each real folder once, sorted, at most MAX_FILES."""
    seen, out = set(), []

    def visit(folder, rel):
        real = os.path.realpath(folder)
        if real in seen or len(out) >= MAX_FILES:
            return
        seen.add(real)
        try:
            names = sorted(os.listdir(folder))
        except OSError:
            return
        for name in names:
            if name.startswith('.'):
                continue
            full, sub = os.path.join(folder, name), (f'{rel}/{name}' if rel else name)
            if os.path.isdir(full):
                visit(full, sub)
            elif name.endswith('.md') and os.path.isfile(full) and len(out) < MAX_FILES:
                out.append((sub, full))
    visit(base, '')
    return out


def scan(folder):
    """The commands of an agent folder, by name: [{name, ns, file, description, argument_hint, allowed_tools, model,
    disable_model_invocation, mtime}]. A folder without .claude/commands has none."""
    base = os.path.join(folder, COMMANDS_DIR)
    if not os.path.isdir(base):
        return []
    out = []
    for rel, full in _walk(base):
        name = command_name(rel)
        if not NAME_RE.match(name):
            continue
        try:
            fields, _ = _parse(_read_text(full))
            mtime = int(os.path.getmtime(full))
        except OSError:
            continue
        out.append({'name': name, 'ns': name.rpartition(':')[0], 'file': _file_of(name), **_meta(fields), 'mtime': mtime})
    return out


def find(folder, name):
    """The file of command `name` in `folder` (None when it has none), found by scanning, never by joining the name
    into a path: a name from the address can only pick one of the commands the folder lists."""
    if not NAME_RE.match(str(name or '')):
        return None
    base = os.path.join(folder, COMMANDS_DIR)
    if not os.path.isdir(base):
        return None
    return next((full for rel, full in _walk(base) if command_name(rel) == name), None)


def read(folder, name):
    """One command for its page: what scan() lists for it plus its body (the prompt, Markdown). None when the
    folder has no such command."""
    full = find(folder, name)
    if not full:
        return None
    fields, body = _parse(_read_text(full))
    return {'name': name, 'ns': name.rpartition(':')[0], 'file': _file_of(name), **_meta(fields),
            'mtime': int(os.path.getmtime(full)), 'body': body}


def _file_of(name):
    """Where a command lives, as the page shows it: `dev:start` → `.claude/commands/dev/start.md`."""
    return f'.claude/commands/{name.replace(":", "/")}.md'
