"""What an agent (a command of an agent folder, tm/commands.py) works with: the skills, subagents and other commands of
its folder that its prompt names, and the files of the folder it points at — for the tabs of its page.

Nothing is declared anywhere: a command says "use `ski-context-ledger`" or "hand it to age-spe-optimizer" in prose.
So the folder's own catalog is read — `.claude/skills/<name>/SKILL.md`, `.claude/agents/**/*.md`, its commands — and
each name in it found in the prompt as a whole word (a command as `/name`) is related. What a related skill or
subagent names in turn is related too, one step further (`via` says through what): a command that hands work to a
subagent works with that subagent's skills. A file is a path in the prompt (`docs/x.md`, `.claude/rules/y.md`) that is a
file inside the folder. Only names and paths of that folder: a prompt never reaches outside it.
"""

import os
import re

from tm import commands

SKILLS_DIR = os.path.join('.claude', 'skills')
AGENTS_DIR = os.path.join('.claude', 'agents')
DEPTH = 2          # the prompt's own names, and theirs
MAX_ITEMS = 60     # of each kind
MAX_FILES = 40     # paths taken from one prompt
KINDS = ('skills', 'agents', 'commands', 'files')
PATH_RE = re.compile(r'(?<![\w/.~-])((?:\.{0,2}/)?[\w.@-]+(?:/[\w.@-]+)*\.(?:md|markdown|json|ya?ml|toml|txt|py|js|mjs|ts|sh|csv|xml|drawio))(?![\w/-])')
TEXT_EXT = ('.md', '.markdown', '.json', '.yaml', '.yml', '.toml', '.txt', '.py', '.js', '.mjs', '.ts', '.sh', '.csv', '.xml', '.drawio')


def _fields(full):
    try:
        fields, body = commands._parse(commands._read_text(full))
    except OSError:
        return None, ''
    return fields, body


def _one_line(v):
    return ' '.join(str(v).split()) if v not in (None, '') else ''


def catalog(folder):
    """The folder's skills, subagents and commands: {kind: {name: {name, description, path}}}, `path` from the folder."""
    out = {'skills': {}, 'agents': {}, 'commands': {}}
    base = os.path.join(folder, SKILLS_DIR)
    try:
        names = sorted(os.listdir(base))
    except OSError:
        names = []
    for d in names:
        full = os.path.join(base, d, 'SKILL.md')
        if d.startswith('.') or not os.path.isfile(full) or len(out['skills']) >= commands.MAX_FILES:
            continue
        fields, _ = _fields(full)
        name = _one_line((fields or {}).get('name')) or d
        out['skills'][name] = {'name': name, 'description': _one_line((fields or {}).get('description')), 'path': f'.claude/skills/{d}/SKILL.md'}
    base = os.path.join(folder, AGENTS_DIR)
    if os.path.isdir(base):
        for rel, full in commands._walk(base):
            fields, _ = _fields(full)
            name = _one_line((fields or {}).get('name')) or os.path.basename(rel)[:-3]
            out['agents'][name] = {'name': name, 'description': _one_line((fields or {}).get('description')), 'path': f'.claude/agents/{rel}'}
    for c in commands.scan(folder):
        out['commands'][c['name']] = {'name': c['name'], 'description': c['description'], 'path': c['file']}
    return out


def _named(text, name, slash=False):
    """Whether `text` names `name` as a whole word (`/name` for a command)."""
    if len(name) < 3:
        return False
    lead = '/' if slash else ''
    return re.search(rf'(?<![\w/-]){lead}{re.escape(name)}(?![\w-]|:\w)', text) is not None


def _inside(folder, rel):
    """`rel` as a file inside `folder` (its path from there, `/` separated), or None."""
    root = os.path.realpath(folder)
    full = os.path.realpath(os.path.join(root, rel))
    if not full.startswith(root + os.sep) or not os.path.isfile(full):
        return None
    return os.path.relpath(full, root).replace(os.sep, '/')


def _files(folder, text, known):
    out, seen = [], set(known)
    for m in PATH_RE.finditer(text):
        token = m.group(1)
        token = token[2:] if token.startswith('./') else token
        for rel in (token, f'.claude/{token}'):
            found = _inside(folder, rel)
            if found and found not in seen:
                seen.add(found)
                out.append({'name': os.path.basename(found), 'description': '', 'path': found})
                break
        if len(out) >= MAX_FILES:
            break
    return out


def related(folder, name):
    """What command `name` of `folder` works with: {skills, agents, commands, files}, each a list of {name, description,
    path, via (the related item that names it, when not the prompt itself)}. None when the folder has no such command."""
    found = commands.read(folder, name)
    if not found:
        return None
    cat = catalog(folder)
    out = {k: [] for k in KINDS}
    seen = {('commands', name)}
    queue = [(found['body'], None, 1)]
    while queue:
        text, via, depth = queue.pop(0)
        for kind in ('skills', 'agents', 'commands'):
            for n, item in cat[kind].items():
                if (kind, n) in seen or len(out[kind]) >= MAX_ITEMS or not _named(text, n, slash=kind == 'commands'):
                    continue
                seen.add((kind, n))
                out[kind].append({**item, **({'via': via} if via else {})})
                if kind != 'commands' and depth < DEPTH:
                    _, body = _fields(os.path.join(folder, item['path']))
                    queue.append((body, n, depth + 1))
    known = {i['path'] for k in ('skills', 'agents', 'commands') for i in out[k]} | {found['file']}
    out['files'] = _files(folder, found['body'], known)
    return out


def read_related(folder, name, path):
    """One file of what command `name` works with, for its tab: {path, name, description, body, fields}. Only a path
    related() lists — never any path the request names. None otherwise."""
    rel = related(folder, name)
    if not rel or not any(i['path'] == path for k in KINDS for i in rel[k]):
        return None
    full = os.path.join(os.path.realpath(folder), path)
    if not full.endswith(TEXT_EXT):
        return None
    if full.endswith(('.md', '.markdown')):
        fields, body = _fields(full)
        fields = fields or {}
        return {'path': path, 'description': _one_line(fields.get('description')), 'body': body, 'markdown': True}
    try:
        text = commands._read_text(full)
    except OSError:
        return None
    return {'path': path, 'description': '', 'body': text, 'markdown': False}
