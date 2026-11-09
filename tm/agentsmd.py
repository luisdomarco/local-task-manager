"""The vault's guide for agents: an AGENTS.md at its top that tells any agent opened in the folder (Claude Code, Codex,
Cursor…) what the vault is and how to read and write it — with tools/vault.py, which keeps every rule — so the vault
works as a second brain without the app running. Opt-in per vault (Settings → Vaults, or `vault.py agents --on`).

The generated part sits between two markers; what the owner writes above or below them is never touched. It is made
from the vault's own structure and projects (Structure.public(), the scan), never from text kept here, so it cannot
drift from what the app enforces; and it has no date in it, so writing it again with nothing changed changes nothing.
CLAUDE.md, which Claude Code reads (not AGENTS.md), gets `@AGENTS.md` when the vault has none of its own.

Pure, but for the few file helpers at the end: the Store writes (Store.set_agents_md, refresh_agents_md).
"""
import os
import shlex

FILE = 'AGENTS.md'
CLAUDE_FILE = 'CLAUDE.md'
CLAUDE_LINE = '@AGENTS.md'
START = '<!-- task-manager:agents start · written by Local Task Manager from the vault: edit outside these markers -->'
END = '<!-- task-manager:agents end -->'


def _cell(text):
    return str(text if text is not None else '').replace('|', '\\|').replace('\n', ' ')


def _example_ref(items, type_name, prefix, numbered):
    """A ref of this type as the vault draws it: a real one when it has an item of it (its lowest number, then its ref:
    the same whatever order the disk lists the files in), else its pattern."""
    refs = [(int(it['id']) if str(it['id']).isdigit() else float('inf'), it['ref'])
            for it in items if it['type'] == type_name and it.get('ref') and it.get('id')]
    if refs:
        return min(refs)[1]
    if not prefix:
        return ''
    return f'{prefix}-<n>' if numbered else f'{prefix}-<nnn>'


def render(info, app_dir, python='python3'):
    """The generated block, markers included. `info` is Store.agents_info(): {structure, label, types, projects,
    relation_kinds, docs, numbered, items}."""
    cli = f'{python} {shlex.quote(os.path.join(app_dir, "tools", "vault.py"))}'
    types, scoped = info['types'], set(info.get('project_scoped') or ())
    rk = info.get('relation_kinds') or {}
    lines = [START, '',
             f"# This folder is a Task Manager vault ({info['label']})", '',
             'Every item (a project, an initiative, a story, a task, a note…) is one Markdown file with YAML frontmatter.',
             'The Local Task Manager app, Obsidian and agents all edit these files, so they follow strict rules:',
             'read and write them **with the CLI below**, which keeps every rule the app keeps (where a file goes, its id,',
             'its links, the allowed statuses and the gates between them). Do not create, rename or move item files by hand.', '',
             '## Read and write it', '',
             'Run from this folder (or pass `-C <this folder>`). Output is Markdown; add `--json` for data.', '',
             '```bash',
             f'{cli} overview                  # projects, items by type and state, what changed last',
             f'{cli} find <text> [--type T] [--status S] [--project KEY] [--open] [--text]',
             f'{cli} show <REF>                # fields, every link read from the item, comments, description',
             f'{cli} graph <REF> --depth 2     # what is around an item',
             f'{cli} context <REF>             # the item as a prompt',
             f'{cli} types [<type>]            # the types; one type: all its fields and link fields',
             f'{cli} new <type> "<title>" --set project=<KEY> --set related_to=<REF> --body -   # body from stdin',
             f'{cli} set <REF> key=value … [--body -] [--rev <rev from show>]',
             f'{cli} move <REF> <Status>',
             f'{cli} link <REF> <kind> <REF>    # unlink <REF> <REF>',
             f'{cli} comment <REF> "<text>"',
             f'{cli} check                     # must stay clean after you write',
             '```', '',
             '- Name an item by its **ref** (`' + (next((t['example'] for t in types if t['example']), 'STY-1')) + '`), a project by its **key**, a doc by its path.',
             '- Link fields take refs: `--set related_to=<REF>`, `--set depends_on=<REF>,<REF>`.',
             '- You write as an agent: a status the gates do not allow yet is refused with the reason. Do not work around it;',
             '  tell the owner what is missing.',
             '- A refusal (exit 1) says why on stderr. Nothing is half written.']
    if info['projects'] and any(p['folder'] for p in info['projects']):
        lines += ['', '## Projects', '', 'Each project is a folder; its items live in it. A ticket in no project lives in its type\'s '
                  'folder at the top of the vault (see Item types).', '',
                  '| Key | Name | Folder |', '|---|---|---|']
        lines += [f"| {_cell(p['key'])} | {_cell(p['name'])} | `{_cell(p['folder'])}` |" for p in info['projects']]
    elif info['projects']:
        lines += ['', '## Projects', '', '| Key | Name |', '|---|---|']
        lines += [f"| {_cell(p['key'])} | {_cell(p['name'])} |" for p in info['projects']]
    lines += ['', '## Item types', '',
              '| Type | Ref | Folder | Statuses (closed in bold) | Parent | Link fields |', '|---|---|---|---|---|---|']
    for t in types:
        # A ticket's folder is in its project's, or, in no project, the one of the same name at the vault's top.
        folder = (f"`<project>/{_cell(t['folder'])}` (no project: `{_cell(t['folder'])}`)" if t['name'] in scoped and t['folder']
                  else f"`{_cell(t['folder'] or '—')}`")
        statuses = ', '.join(f'**{s}**' if s in t['closed'] else s for s in t['statuses']) or '—'
        links = ', '.join(f"`{k}`" + (f" → {'/'.join(v)}" if v else '') for k, v in t['links']) or '—'
        lines.append(f"| `{t['name']}` {_cell(t['label'])} | {_cell(t['example'] or '—')} | {folder} | {statuses} | "
                     f"{_cell(', '.join(t['parents']) or '—')} | {links} |")
    if rk.get('kinds'):
        kept = rk.get('fields') or {}
        lines += ['', '## Relations between items', '',
                  'A relation is kept on one of the two items; the other sees its inverse (Blocks ↔ Blocked by). Kinds for `link`: '
                  + ', '.join(f'`{k}` ({label.split(" (")[0]})' for k, label in rk['kinds']) + '.']
        if kept:
            lines.append('Kept in a field of their own: ' + ', '.join(f'`{k}` in `{f}`' for k, f in kept.items())
                         + ' (the item that waits names what it waits for).')
    if info.get('docs'):
        lines += ['', '## Docs', '',
                  'Documents that are not items (no id, no status), free Markdown: ' + ', '.join(f'`{d}`' for d in info['docs'])
                  + '. Edit them as files; link to an item with `[[<its file name without .md>]]`.']
    lines += ['', '## If you must edit a file by hand', '',
              '- Change only the keys you mean to; keep the others, their order and their `#` comments as they are.',
              '- A link is `"[[<file name without .md>]]"`. Never invent or reuse an id: new items only through `new`.',
              f'- Run `{cli} check` afterwards. `.task-manager/` is the app\'s own: never edit it.', '',
              'This block is written again when the vault\'s types or projects change. Put your own notes outside the markers.',
              '', END]
    return '\n'.join(lines) + '\n'


def block_of(text):
    """The generated block in `text` (markers included), or None."""
    start = text.find(START)
    if start < 0:
        return None
    end = text.find(END, start)
    return text[start:end + len(END)] + '\n' if end >= 0 else None


def merge(existing, block):
    """`existing` (the file as it is, '' when missing) with `block` in place of the generated one, or added at its end:
    what is outside the markers stays byte for byte."""
    start = existing.find(START)
    end = existing.find(END, start) if start >= 0 else -1
    if start >= 0 and end >= 0:
        after = existing[end + len(END):]
        return existing[:start] + block.rstrip('\n') + after if after else existing[:start] + block
    if not existing.strip():
        return block
    return existing.rstrip('\n') + '\n\n' + block


def strip(existing):
    """`existing` without the generated block (and the blank lines merge() put before it)."""
    start = existing.find(START)
    end = existing.find(END, start) if start >= 0 else -1
    if start < 0 or end < 0:
        return existing
    head, tail = existing[:start], existing[end + len(END):]
    tail = tail[1:] if tail.startswith('\n') else tail
    if not tail.strip():
        head = head.rstrip('\n') + ('\n' if head.strip() else '')
    return head + tail


def is_on(root):
    """Whether the vault keeps a guide: its AGENTS.md has the generated block. Cheap: one small read. A link is never
    the vault's own guide (see Store._guide_path)."""
    path = os.path.join(root, FILE)
    if os.path.islink(path):
        return False
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            return START in f.read(1 << 20)
    except OSError:
        return False
