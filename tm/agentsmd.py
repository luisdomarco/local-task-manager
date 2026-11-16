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
             f'{cli} types [<type>]            # the types and what each needs to be created; one type: all its fields',
             f'{cli} new <type> "<title>" --set project=<KEY> --set related_to=<REF> --body -   # body from stdin',
             f'{cli} new project "<name>" --set project_key=<KEY>   # 2 to 4 capital letters, fixed once made',
             f'{cli} set <REF> key=value … [--body -] [--rev <rev from show>]',
             f'{cli} move <REF> <Status>',
             f'{cli} link <REF> <kind> <REF>    # unlink <REF> <REF>',
             f'{cli} comment <REF> "<text>"',
             f'{cli} attach <REF> <file>…      # detach <REF> <path> takes one off; new … --attach <file> too',
             f'{cli} delete <REF>              # to the trash; restore <trashed> brings it back, trash lists it',
             f'{cli} base <path.base> [--view V]   # an index (Obsidian base): its rows',
             f'{cli} board [<name>] [--place <REF>=<column>]   # the custom boards; place a card',
             f'{cli} check                     # must stay clean after you write',
             '```', '',
             '- Name an item by its **ref** (`' + (next((t['example'] for t in types if t['example']), 'STY-1')) + '`), a project by its **key**, a doc by its path.',
             '- Link fields take refs: `--set related_to=<REF>`, `--set depends_on=<REF>,<REF>`.',
             '- You write as an agent: a status the gates do not allow yet is refused with the reason. Do not work around it;',
             '  tell the owner what is missing.',
             '- A refusal (exit 1) says why on stderr. Nothing is half written.']
    if info.get('default_texts'):
        lines += ['- Without `--body`, a new item starts with its type\'s default text in this vault (`.task-manager/templates/<type>.md`;',
                  '  an initiative, and a story, PRD or plan of one, `<type>.<initiative kind>.md` when it has one; set by the owner in',
                  '  Settings → Vaults): fill in its sections with `set <REF> --body -`. Never put the title in the body.']
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
    if info.get('comments_folder'):
        d = info['comments_folder']
        lines += ['', '## Comments', '',
                  f"An item's comments are files of their own: `{d}/<ref>/<when, to the millisecond>.md`, its text the body, "
                  f'`item: "[[<the item\'s file>]]"` in the frontmatter. Add one with `{cli} comment <REF> "…"`; '
                  f'`{cli} show <REF>` reads them. Never put them in the item\'s file.']
    lines += _bases_lines(info, cli)
    if info.get('agentic'):
        lines += _agentic_lines(info['agentic'], types, cli)
    lines += _boards_lines(info.get('boards') or [], cli)
    lines += ['', '## If you must edit a file by hand', '',
              '- Change only the keys you mean to; keep the others, their order and their `#` comments as they are.',
              '- A link is `"[[<file name without .md>]]"`. Never invent or reuse an id: new items only through `new`.',
              f'- Run `{cli} check` afterwards. `.task-manager/` is the app\'s own: never edit it.', '',
              'This block is written again when the vault\'s types or projects change. Put your own notes outside the markers.',
              '', END]
    return '\n'.join(lines) + '\n'


def _needs(b):
    """What a base asks of a note, as the guide's cell: in `Docs/X` · #tag · `fileClass: Y` · `category`."""
    out = [f'in `{_cell(f)}`' for f in b['folders']] + [f'`#{_cell(t)}`' for t in b['tags']]
    for name, values in b['properties'].items():
        vals = [v for v in values if not isinstance(v, bool)]
        out.append(f'`{_cell(name)}: {_cell(vals[0])}`' if len(vals) == 1
                   else f'`{_cell(name)}` ({" or ".join(_cell(v) for v in vals)})' if vals else f'`{_cell(name)}`')
    return ' · '.join(out) or 'any file (no filter)'


def _bases_lines(info, cli):
    bases = info.get('bases') or []
    lines = ['', '## Indexes (Obsidian Bases)', '',
             'An index here is an Obsidian base, a `.base` file: it lists the notes its filters match, so **a note joins an',
             'index by its own properties**. To put a new note in one, give it what the base asks for and fill in what it',
             'shows; never edit a base, or a hand-written list in a note, to add a note to it. A new index is a new `.base`',
             '(Obsidian\'s YAML: `filters`, `formulas`, `properties`, `views`; https://obsidian.md/help/bases/syntax): the',
             'app and Obsidian draw it alike.']
    if not bases:
        return lines
    lines += ['', '| Base | Views | A note is in it with | Grouped by | Fill in too |', '|---|---|---|---|---|']
    for b in bases:
        if b.get('error'):
            lines.append(f"| `{_cell(b['path'])}` | — | (cannot be read: {_cell(b['error'])}) | — | — |")
            continue
        lines.append(f"| `{_cell(b['path'])}` | {_cell(', '.join(b['views']) or '—')} | {_needs(b)} | "
                     f"{', '.join(f'`{_cell(g)}`' for g in b['group_by']) or '—'} | "
                     f"{', '.join(f'`{_cell(x)}`' for x in b['shows']) or '—'} |")
    more = (info.get('bases_count') or 0) - len(bases)
    if more > 0:
        lines.append(f'\n{more} more `.base` files are not listed here.')
    lines += ['', f'A grouped-by property is best given a value the base already has (`{cli} base <path>` shows them): '
              'a new one makes a new group.']
    return lines


def _agentic_lines(v, types, cli):
    ref = {t['name']: t['example'] for t in types}
    lines = ['', '## Agentic systems: architectures and entities', '',
             f"An **architecture** (`agent`, {_cell(ref.get('agent') or 'AGT')}) is how one agentic system is built; it belongs "
             'to a system initiative (`parent`). Its pieces are **entities** (`entity`), each with `parent` its architecture:',
             f'`{cli} new entity "<name>" --set parent=<architecture ref> --set entity_type=<type>`.', '',
             '- `scheme`: ' + ' · '.join(f'`{k}` {_cell(l.split(" · ", 1)[-1])}' for k, l in v['schemes']) + '.',
             '- `harness` (who holds the plan): ' + ' · '.join(f'`{k}` {_cell(l)}' for k, l in v['harnesses']) + '.',
             '- `architecture`: ' + ' · '.join(f'`{k}`' for k, _ in v['architectures'])
             + ''.join(f'. `{a}` is an anti-pattern: never pick it; tell the owner when a system looks like it' for a in v['anti_patterns'][:1])
             + '.',
             '- What a harness usually comes out as: ' + '; '.join(f"`{h}` → {', '.join(a)}" for h, a in v['harness_architectures'].items())
             + '. Another choice needs its dated evidence in `decision`.',
             '- An entity\'s `level` comes from its `entity_type` (' + ' · '.join(f'{k} {_cell(l)}' for k, l in v['levels'])
             + '): never set it. `path` is where it lives in its repo; `version` is cut in the app, never typed.', '',
             '| `entity_type` | Level | Canon | File prefix |', '|---|---|---|---|']
    lines += [f"| `{_cell(e['id'])}` | {e['level']} | {'yes' if e['canon'] else 'proposed'} | "
              f"{'`' + _cell(e['prefix']) + '`' if e['prefix'] else '—'} |" for e in v['entity_types']]
    if v.get('agent_prefix'):
        lines.append('\nAn agent\'s prefix says its role (`agent_role`): '
                     + ', '.join(f'`{p}` {r}' for r, p in v['agent_prefix'].items()) + '.')
    return lines


def _boards_lines(boards, cli):
    lines = ['', '## Boards', '',
             'Columns of the owner\'s own (Today\'s board, the week\'s and the month\'s Custom grouping, a list\'s board) are kept',
             'in `.task-manager/boards/<name>.json`, never in the item\'s file: read one with `' + cli + ' board <name>`, put a',
             'card in a column with `--place <REF>=<column>` (`--place <REF>=` takes it off).']
    if boards:
        lines += ['', '| Board | Columns |', '|---|---|']
        lines += [f"| `{_cell(b['name'])}` | {_cell(', '.join(b['columns']))} |" for b in boards]
    return lines


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
