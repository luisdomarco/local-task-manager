#!/usr/bin/env python3
"""Read and write a Task Manager vault from the shell, with or without the app running: for agents (Claude Code, a
script) and for people at a terminal. It opens the vault through the app's own Store, the same code the server runs,
so a write here lands exactly as one made in the app (the structure's rules and gates apply, ids are never handed out
twice, only the keys that change are rewritten) and the open app shows it on its next refresh.

    python3 tools/vault.py [-C VAULT] [--json] COMMAND …

The vault is -C, else $TM_VAULT, else the nearest folder up from here that holds a .task-manager folder, else here.
Items are named by their ref (STY-482), a project by its key (ACME), a doc by its path (Docs/Guide.md).

Read
    overview                          projects, items by type and state, what changed last
    types [TYPE]                      the vault's item types; with TYPE, its fields, statuses and links
    find [TEXT] [--type T] [--status S] [--project KEY] [--open | --closed] [--text] [--limit N]
                                      items whose ref or title has TEXT; --text also searches inside the files
    show REF [--no-body]              an item: its fields, every link read from it, its comments and description
    graph REF [--depth N] [--kinds K,K]
                                      what is around an item, N steps out (parent, link, relation, mention; project too
                                      when asked)
    context REF [--instruction TEXT]  the item as a prompt, as the app hands it to Claude
    check                             whether the vault matches its structure (it is read-only until it does)
    base PATH [--view NAME]           an index (an Obsidian .base): one view's rows, as the app draws them
    board [NAME] [--place REF=COLUMN]…
                                      the custom boards; with NAME, its columns and cards; --place puts a card in a
                                      column (by its name or id; REF= takes it off). Never writes the item's file
    agents [--on | --off | --print]   the vault's guide for agents (AGENTS.md): whether it has it, turn it on or off,
                                      or print what it would say
    trash                             what is in the trash, most recently deleted first (what `restore` takes)

Write (as an agent: the structure's transitions and gates apply)
    new TYPE TITLE [--set KEY=VALUE]… [--body TEXT | --body -] [--attach FILE]…
                                      every type; `types TYPE` says what one needs to be created (a project its key,
                                      `--set project_key=EN`; a plan its parent, `--set related_to=INI-3`…)
    set REF KEY=VALUE… [--body TEXT | --body -] [--rev REV]
    move REF STATUS
    link REF KIND REF                 KIND: relates, blocked, blocks, precedes, follows, duplicates, duplicated,
                                      copied_to, copied_from (Projects keeps "blocked" in depends_on)
    unlink REF REF
    comment REF TEXT                  (TEXT "-" reads it from stdin)
    attach REF FILE… [--name NAME]    keep files on the item (Attachments/<its folder>/, at most 25 MB each)
    detach REF PATH                   take one off (PATH as `show` lists it): the file goes to the trash
    delete REF [--with-items]         to the trash, as the app deletes: whatever hung from it loses the link and a
                                      restore gives it back. A project goes with its folder and every item in it, so
                                      it asks for --with-items
    restore TRASHED                   back to where it was deleted from (TRASHED as `delete` or `trash` prints it)

A VALUE is text; `[…]` or `{…}` is JSON, `null`/`true`/`false` too. A link field (related_to, project, plan, origin,
depends_on…) takes refs: `--set related_to=INI-3`, `--set depends_on=STY-4,STY-9`. --rev (from `show`) refuses the write
if the file changed since. Exit codes: 0 done, 1 refused or failed (the reason on stderr), 2 a wrong command line.

Python stdlib only. It never reads config.json: the vault is the folder it is given.
"""
import argparse
import json
import os
import sys

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)
from tm import agentsmd, attachments  # noqa: E402
from tm.fsutil import download_on_read  # noqa: E402
from tm import graph as tm_graph  # noqa: E402
from tm.store import META_DIR, Store, StoreError  # noqa: E402
from tm.structures import REGISTRY  # noqa: E402

# Tried in this order when the vault does not say which it is: Projects is the structure, the other two are legacy.
STRUCTURE_ORDER = ('ticketing', 'folders', 'tasks')
LINK_KINDS = ('link', 'links')
# Fields `show` leaves out: the item's identity (in its heading), what has its own section, and the app's bookkeeping.
SHOW_SKIP = {'id', 'type', 'subject', 'name', 'comments', 'status_log', 'claude_sessions', 'relations', 'relation_kinds',
             'plan_order', 'week_order', 'today_list', 'week_list'}
RECENT = 10
# Keys a new item is made from but never keeps as fields (a Projects project: its key, fixed once made, and the
# `project_kind` a project from before initiative kinds said, read as its initiatives' kind).
CREATE_ONLY = {'project_key', 'project_kind'}
TRASH_ROWS = 50  # entries `trash` prints (all of them with --json)


class CliError(Exception):
    pass


# ── the vault ────────────────────────────────────────────────────────────────
def find_vault(start):
    """The nearest folder from `start` up that holds the vault's META_DIR, else `start`."""
    here = os.path.realpath(start)
    while True:
        if os.path.isdir(os.path.join(here, META_DIR)):
            return here
        up = os.path.dirname(here)
        if up == here:
            return os.path.realpath(start)
        here = up


def open_store(path, structure=None):
    """The vault's Store as the server opens it (it refuses writes while the vault does not match its structure), and
    the structure's id. Without `structure`, the first in STRUCTURE_ORDER whose check passes; none: Projects."""
    if not os.path.isdir(path):
        raise CliError(f'no such folder: {path}')
    if structure:
        if structure not in REGISTRY:
            raise CliError(f"unknown structure: {structure} (there are: {', '.join(REGISTRY)})")
        sid = structure
    else:
        sid = next((s for s in STRUCTURE_ORDER if s in REGISTRY and Store(path, None, s).check()['ok']), STRUCTURE_ORDER[0])
    return Store(path, None, sid, enforce_structure=True), sid


def node_name(n):
    """A graph node as a line names it: its ref and title, or the title alone when it has no ref of its own."""
    return n['title'] if n['ref'] == n['title'] else f"{n['ref']} {n['title']}"


def ref_of(it):
    return it.get('ref') or it.get('id') or it.get('path') or it.get('key')


def node_of(it):
    return tm_graph.node_id(it)


def closed(store, it):
    status = it['fields'].get('status')
    return bool(status) and status in store.structure.closed_of(it['type'])


def plural(n, word):
    return f"{n} {word}{'s' * (n != 1)}"


def cell(text):
    return str(text if text is not None else '').replace('|', '\\|').replace('\n', ' ')


def item_line(it, extra=''):
    f = it['fields']
    bits = [it['type'], f.get('status'), f.get('project') if it['type'] != 'project' else None]
    name = f"{it.get('ref') or it.get('id')} {it['title']}" if it.get('ref') or it.get('id') else f"{it['title']} (`{it['path']}`)"
    return f"{name} ({' · '.join(str(b) for b in bits if b)}){extra}"


def read_text(value):
    """A command-line text, or stdin for '-'."""
    return sys.stdin.read() if value == '-' else value


# ── values from the command line ─────────────────────────────────────────────
def link_fields(store, item_type):
    """{field: 'link' | 'links'} of a type: its link props, its parent, its project and its relations."""
    t = store.structure.types.get(item_type)
    out = {p['key']: p['kind'] for p in (t.props if t else ()) if p.get('kind') in LINK_KINDS}
    fields = store.structure.allowed_fields(item_type) if t else set()
    for key, kind in (('related_to', 'link'), ('project', 'link'), ('relations', 'links')):
        if key in fields:
            out.setdefault(key, kind)
    return out


def to_node(store, value):
    """A ref, id or key as a link field keeps it (the item's id, a project's key); as given if it names no item (the
    Store says what is wrong with it)."""
    try:
        return node_of(store.find(value))
    except StoreError:
        return value


def parse_value(raw):
    text = raw.strip()
    if text[:1] in '[{' or text in ('null', 'true', 'false'):
        try:
            return json.loads(text)
        except ValueError:
            raise CliError(f'not valid JSON: {raw}') from None
    return raw


def parse_values(store, item_type, pairs, creating=False):
    """KEY=VALUE pairs → the values for Store.create/update, refs in link fields turned into what the file keeps."""
    links = link_fields(store, item_type)
    allowed = store.structure.allowed_fields(item_type) | {'subject', 'resolved'} | (CREATE_ONLY if creating else set())
    values = {}
    for pair in pairs or ():
        key, sep, raw = pair.partition('=')
        key = key.strip()
        if not sep or not key:
            raise CliError(f'expected KEY=VALUE, got: {pair}')
        if key not in allowed:  # the Store would drop it without a word
            raise CliError(f"a {item_type} has no field '{key}' (see: types {item_type})")
        value = parse_value(raw)
        kind = links.get(key)
        if kind == 'links' and isinstance(value, str):
            value = [v.strip() for v in value.split(',') if v.strip()]
        if kind == 'link' and isinstance(value, str):
            value = to_node(store, value.strip()) if value.strip() else None
        elif kind == 'links' and isinstance(value, list):
            value = [to_node(store, v) if isinstance(v, str) else v for v in value]
        values[key] = value
    return values


def creation_needs(store, item_type):
    """What `new TYPE` must be given, beyond a title, as `--set` hints: read from the structure (the rules Store.create
    applies), never a list of types of its own. [] when a title is enough."""
    s = store.structure
    t = s.types[item_type]
    extras = s.extras
    parents = ' / '.join(p for p in t.parents if p in s.types) or 'item'
    codec = s.codec
    if codec and getattr(codec, 'owns_folder', None) and codec.owns_folder(item_type):
        return ['project_key=<2 to 4 capital letters, fixed once made>']
    if item_type in extras.get('needs_parent', ()):
        return [f'related_to=<the ref of its {parents}>']
    if item_type in extras.get('project_scoped', ()) and item_type not in extras.get('leaves_project', ()):
        return [f'project=<KEY> or related_to=<the ref of its {parents}>']
    return []


def needs_text(store, item_type):
    return ' · '.join(f'`--set {n}`' for n in creation_needs(store, item_type))


# ── read ─────────────────────────────────────────────────────────────────────
def cmd_overview(store, args):
    items = store.items()
    s = store.structure
    projects = [it for it in items if it['type'] == 'project']
    per_project, per_type = {}, {}
    for it in items:
        state = 'closed' if closed(store, it) else 'open'
        per_type.setdefault(it['type'], {'open': 0, 'closed': 0})[state] += 1
        p = it['fields'].get('project')
        if p and it['type'] != 'project':
            per_project.setdefault(p, {'open': 0, 'closed': 0})[state] += 1
    recent = sorted(items, key=lambda it: str(it['fields'].get('updated_at') or ''), reverse=True)[:RECENT]
    result = store.check()
    data = {'vault': store.root, 'structure': args.structure_id, 'items': len(items), 'check_ok': result['ok'],
            'projects': [{'key': node_of(p), 'name': p['title'], **per_project.get(node_of(p), {'open': 0, 'closed': 0})} for p in projects],
            'types': [{'type': t, 'label': s.types[t].plural or t, **per_type[t]} for t in s.types if t in per_type],
            'recent': [{'ref': ref_of(it), 'title': it['title'], 'type': it['type'], 'status': it['fields'].get('status'),
                        'updated_at': it['fields'].get('updated_at')} for it in recent]}
    lines = [f'# {os.path.basename(store.root)}', '',
             f"{REGISTRY[args.structure_id].label} vault · {len(items)} items · "
             + ('matches its structure' if result['ok'] else '**does not match its structure: read-only** (run `check`)'),
             f'Folder: `{store.root}`']
    if data['projects']:
        lines += ['', '## Projects', '', '| Key | Name | Open | Closed |', '|---|---|---|---|']
        lines += [f"| {cell(p['key'])} | {cell(p['name'])} | {p['open']} | {p['closed']} |" for p in data['projects']]
    lines += ['', '## Items by type', '', '| Type | Open | Closed |', '|---|---|---|']
    lines += [f"| {cell(t['label'])} (`{t['type']}`) | {t['open']} | {t['closed']} |" for t in data['types']]
    lines += ['', '## Changed last', '']
    lines += [f"- {item_line(it, ' · ' + str(it['fields'].get('updated_at') or ''))}" for it in recent]
    return data, lines


def cmd_types(store, args):
    s = store.structure
    public = {t['name']: t for t in s.public()['types']}
    if not args.type:
        rows = [{'type': name, 'label': t.label, 'prefix': t.prefix, 'folder': t.folder, 'statuses': list(t.statuses),
                 'needs': creation_needs(store, name)} for name, t in s.types.items()]
        lines = [f'# Item types ({REGISTRY[args.structure_id].label})', '',
                 '| Type | Name | Id | Folder | Statuses | To create one, also |', '|---|---|---|---|---|---|']
        lines += [f"| `{r['type']}` | {cell(r['label'])} | {r['prefix'] or '—'} | {cell(r['folder'] or '—')} | "
                  f"{cell(', '.join(r['statuses']) or '—')} | {cell(needs_text(store, r['type']) or '—')} |" for r in rows]
        lines += ['', 'More on one: `types TYPE`. Relation kinds: ' + ', '.join(k for k, _ in (s.extras.get('relation_kinds') or {}).get('kinds', ()))]
        return rows, lines
    if args.type not in s.types:
        raise CliError(f"no type '{args.type}' in this vault (there are: {', '.join(s.types)})")
    t, pub = s.types[args.type], public.get(args.type, {})
    props = pub.get('props') or []
    links = link_fields(store, args.type)
    lines = [f'# {t.label} (`{args.type}`)', '',
             f"Id: {t.prefix or 'none'} · folder: `{t.folder or '—'}` · parents: {', '.join(t.parents) or 'none'}",
             f"Statuses: {', '.join(t.statuses) or '—'} (closed: {', '.join(s.closed_of(args.type)) or '—'})",
             f"To create one: `new {args.type} \"<title>\"`" + (f" {needs_text(store, args.type)}" if creation_needs(store, args.type) else ''), '',
             '## Fields', '', '| Key | Name | Kind | Values |', '|---|---|---|---|']
    for p in props:
        values = ', '.join(str(o[0]) for o in p.get('options') or [] if o and o[0]) or ', '.join(p.get('types') or [])
        # A key the card never edits but `new` takes (a project's key): set once, there.
        kind = 'set by `new` only' if p['key'] in CREATE_ONLY else p.get('kind')
        lines.append(f"| `{p['key']}` | {cell(p.get('label'))} | {kind} | {cell(values)} |")
    others = sorted(k for k in s.allowed_fields(args.type) if k not in {p['key'] for p in props})
    lines += ['', 'Other keys it keeps: ' + ', '.join(f'`{k}`' for k in others),
              'Link fields (take refs): ' + (', '.join(f'`{k}`' for k in links) or 'none')]
    return {**pub, 'needs': creation_needs(store, args.type)}, lines


def cmd_trash(store, args):
    entries = store.trash()
    lines = [f'{len(entries)} in the trash' + (f' (the latest {TRASH_ROWS})' if len(entries) > TRASH_ROWS else '')]
    if entries:
        lines += ['', '| Deleted | What | Was at | Restore with |', '|---|---|---|---|']
        lines += [f"| {cell(e['deleted_at'])} | {cell(' '.join(x for x in (e['ref'], e['title']) if x))} ({e['type']}"
                  f"{', with ' + plural(e['holds'], 'item') if e.get('holds') else ''}) | `{cell(e['original_path'])}` | "
                  f"`restore {cell(e['trashed'])}` |" for e in entries[:TRASH_ROWS]]
    return entries, lines


def cmd_find(store, args):
    q = (args.text or '').casefold().strip()
    out = []
    for it in store.items():
        f = it['fields']
        if args.type and it['type'] != args.type:
            continue
        if args.status and str(f.get('status') or '').casefold() != args.status.casefold():
            continue
        if args.project and (f.get('project') or (node_of(it) if it['type'] == 'project' else None)) != args.project:
            continue
        if (args.open and closed(store, it)) or (args.closed and not closed(store, it)):
            continue
        if q and q not in ' '.join(str(x) for x in (ref_of(it), it.get('id'), it['title'])).casefold():
            continue
        out.append(it)
    out.sort(key=lambda it: str(it['fields'].get('updated_at') or ''), reverse=True)
    total, out = len(out), out[:args.limit]
    hits = store.search_files(args.text)['results'][:args.limit] if args.text_search and args.text else []
    data = {'total': total, 'items': [{'ref': ref_of(it), 'title': it['title'], 'type': it['type'], 'status': it['fields'].get('status'),
                                       'project': it['fields'].get('project'), 'path': it['path']} for it in out],
            'text': hits}
    lines = [f'{total} item{"s" * (total != 1)}' + (f' (the first {len(out)})' if total > len(out) else '')]
    if out:
        lines += ['', '| Ref | Title | Type | Status | Project |', '|---|---|---|---|---|']
        lines += [f"| {cell(r['ref'])} | {cell(r['title'])} | {r['type']} | {cell(r['status'])} | {cell(r['project'])} |" for r in data['items']]
    if args.text_search and args.text:
        lines += ['', f'## In the text ({len(hits)})', '']
        lines += [f"- `{h['path']}:{h['line']}` {h['text']}" for h in hits]
    return data, lines


def links_of(store, node, graph, kinds=tm_graph.KINDS):
    """Every edge of `node` in `graph`, read from it: [{reading, ref, title, type, id, kind}]."""
    by_id = {n['id']: n for n in graph['nodes']}
    out = []
    for e in graph['edges']:
        if e['kind'] not in kinds or node not in (e['source'], e['target']):
            continue
        other = by_id[e['target'] if e['source'] == node else e['source']]
        out.append({'reading': tm_graph.reading(e, node, store.structure), 'ref': other['ref'], 'title': other['title'],
                    'type': other['type'], 'id': other['id'], 'kind': e['kind']})
    order = {k: i for i, k in enumerate(tm_graph.KINDS)}
    out.sort(key=lambda link: (order.get(link['kind'], 9), link['reading'], link['ref']))
    return out


def resolve_doc(store, address):
    """A vault file that is no item (a doc), as its relative path, or None."""
    rel = address.replace(os.sep, '/').strip('/')
    try:
        path = store.abs(rel)
    except StoreError:
        return None
    return rel if rel.lower().endswith('.md') and os.path.isfile(path) else None


def cmd_show(store, args):
    try:
        it = store.read(args.ref)
    except StoreError as e:
        doc = resolve_doc(store, args.ref)
        if not doc:
            raise e
        with open(store.abs(doc), encoding='utf-8', errors='replace') as f:
            text = f.read()
        links = links_of(store, doc, store.graph())
        lines = [f'# {doc}', '', '## Links', ''] + ([f"- {link['reading']} {node_name(link)} ({link['type']})" for link in links] or ['none'])
        lines += ([] if args.no_body else ['', '## Text', '', text.strip()])
        return {'path': doc, 'links': links, 'text': text}, lines
    f = it['fields']
    graph = store.graph()
    links = links_of(store, node_of(it), graph)
    refs = {n['id']: n['ref'] for n in graph['nodes']}
    kinds = link_fields(store, it['type'])
    meta = [it['type'], f.get('status'), f"project {f['project']}" if f.get('project') and it['type'] != 'project' else None]
    lines = [f"# {ref_of(it)} · {it['title']}", '', ' · '.join(str(m) for m in meta if m),
             f"File: `{it['path']}` · rev: `{it['rev']}`", '', '## Fields', '']
    for k, v in f.items():
        if k in SHOW_SKIP or v in (None, '', [], {}):
            continue
        if k in kinds:  # a link field shows the refs it names, not the ids the file keeps
            v = [refs.get(x, x) for x in v] if isinstance(v, list) else refs.get(v, v)
        lines.append(f'- {k}: {", ".join(map(str, v)) if k in kinds and isinstance(v, list) else json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v}')
    lines += ['', '## Links', ''] + ([f"- {link['reading']} {node_name(link)} ({link['type']})" for link in links] or ['none'])
    comments = [c for c in f.get('comments') or [] if isinstance(c, dict)]
    if comments:
        lines += ['', '## Comments', ''] + [f"- {c.get('at', '')}: {c.get('text', '')}" for c in comments]
    if not args.no_body:
        lines += ['', '## Description', '', (it.get('body') or '').strip() or '(empty)']
    return {**it, 'links': links}, lines


def cmd_graph(store, args):
    kinds = [k.strip() for k in args.kinds.split(',') if k.strip()] if args.kinds else list(tm_graph.NEIGHBOR_KINDS)
    bad = [k for k in kinds if k not in tm_graph.KINDS]
    if bad:
        raise CliError(f"unknown kind of link: {', '.join(bad)} (there are: {', '.join(tm_graph.KINDS)})")
    start = resolve_doc(store, args.ref) if '/' in args.ref else None
    if not start:
        start = node_of(store.find(args.ref))
    near = tm_graph.neighbors(store.graph(), start, args.depth, kinds)
    by_id = {n['id']: n for n in near['nodes']}
    lines = [f"# Around {node_name(by_id[start])}" if start in by_id else f'# Around {args.ref}', '',
             f"{len(near['nodes']) - 1} nodes within {args.depth} step{'s' * (args.depth != 1)} · links: {', '.join(kinds)}"]
    for d in range(1, args.depth + 1):
        ring = [n for n in near['nodes'] if n['depth'] == d]
        if ring:
            lines += ['', f"## {d} step{'s' * (d != 1)}", '']
            lines += [f"- {node_name(n)} ({' · '.join(str(b) for b in (n['type'], n['status']) if b)})" for n in ring]
    lines += ['', '## Links', '']
    lines += [f"- {by_id[e['source']]['ref']} {tm_graph.reading(e, e['source'], store.structure)} {by_id[e['target']]['ref']}" for e in near['edges']]
    return near, lines


def cmd_context(store, args):
    text = store.claude_prompt(args.ref, args.instruction or '')
    return {'prompt': text}, [text.rstrip()]


def cmd_check(store, args):
    result = store.check()
    if result['ok']:
        return result, ['The vault matches its structure.']
    lines = ['**The vault does not match its structure**: nothing is written to it until it does.', '']
    lines += [f"- `{b['path']}`: {b['detail']}" for b in result.get('blocking', [])]
    return result, lines


def cmd_agents(store, args):
    if args.print_it:
        text = agentsmd.render(store.agents_info(), APP_DIR)
        return {'text': text}, [text.rstrip()]
    if args.on or args.off:
        status = store.set_agents_md(bool(args.on), APP_DIR)
    else:
        status = store.agents_status()
    say = (f"{agentsmd.FILE} keeps the vault's guide for agents; it is written again when the types or projects change."
           if status['on'] else 'No guide for agents in this vault. `agents --on` writes AGENTS.md (and CLAUDE.md if it has none).')
    return status, [say]


# ── write ────────────────────────────────────────────────────────────────────
def written(store, its, verb):
    lines = [f"{verb} {item_line(it)} · `{it['path']}`" for it in its]
    return (its[0] if len(its) == 1 else its), lines or ['Nothing to change.']


def read_upload(path):
    """A file to attach: its bytes, refused before reading when it is bigger than an attachment may be."""
    full = os.path.expanduser(path)
    if not os.path.isfile(full):
        raise CliError(f'no such file: {path}')
    if os.path.getsize(full) > attachments.MAX_BYTES:
        raise CliError(f'{path}: an attachment is at most {attachments.MAX_BYTES // (1024 * 1024)} MB')
    with open(full, 'rb') as f:
        return f.read()


def cmd_new(store, args):
    if args.type not in store.structure.types:
        raise CliError(f"no type '{args.type}' in this vault (there are: {', '.join(store.structure.types)})")
    values = parse_values(store, args.type, args.set, creating=True)
    uploads = [(os.path.basename(f), read_upload(f)) for f in args.attach or ()]  # all read before anything is written
    try:
        it = store.create(args.type, args.title, values, read_text(args.body) if args.body is not None else None)  # none: the type's default text
    except StoreError as e:
        # The Store speaks of the app's form ("choose it in Parent"): say what to pass here.
        needs = needs_text(store, args.type)
        if e.status == 400 and needs:
            raise StoreError(400, f'{e} — here: {needs} (see: types {args.type})') from None
        raise
    for name, data in uploads:
        it = store.add_attachment(it['key'], name, data)
    return written(store, [it], 'Created')


def cmd_set(store, args):
    it = store.find(args.ref)
    values = parse_values(store, it['type'], args.pairs)
    body = read_text(args.body) if args.body is not None else None
    if not values and body is None:
        raise CliError('nothing to set: give KEY=VALUE pairs or --body')
    return written(store, [store.update(it['key'], values, body, base_rev=args.rev, by='agent')], 'Updated')


def cmd_move(store, args):
    it = store.find(args.ref)
    statuses = store.structure.types[it['type']].statuses
    status = next((st for st in statuses if st.casefold() == args.status.casefold()), None)
    if not status:
        raise CliError(f"a {it['type']} has no status '{args.status}' (it has: {', '.join(statuses)})")
    return written(store, [store.update(it['key'], {'status': status}, by='agent')], 'Moved')


def cmd_link(store, args):
    return written(store, store.relate(args.ref, args.kind, args.other, by='agent'), 'Updated')


def cmd_unlink(store, args):
    return written(store, store.relate(args.ref, None, args.other, by='agent'), 'Updated')


def cmd_comment(store, args):
    it = store.add_comment(args.ref, read_text(args.text))
    return written(store, [it], 'Commented on')


def cmd_attach(store, args):
    if args.name and len(args.files) > 1:
        raise CliError('--name names one file: attach them one at a time')
    it = store.find(args.ref)
    uploads = [(args.name or os.path.basename(f), read_upload(f)) for f in args.files]
    for name, data in uploads:
        it = store.add_attachment(it['key'], name, data)
    kept = (it['fields'].get('attachments') or [])[-len(uploads):]
    return it, [f"Attached to {item_line(it)}:"] + [f'- `{p}`' for p in kept]


def cmd_detach(store, args):
    it = store.find(args.ref)
    out = store.remove_attachment(it['key'], args.path)
    where = f" · the file is in the trash (`{out['trashed']}`)" if out['trashed'] else ' · its file was already gone'
    return out, [f"Took `{args.path}` off {item_line(out['item'])}{where}"]


def cmd_delete(store, args):
    it = store.find(args.ref)
    name = item_line(it)
    if it['type'] == 'project':
        # What goes with it is what lives in its folder (an item elsewhere that names it only loses the link).
        folder = os.path.dirname(it['path']).replace(os.sep, '/') + '/'
        held = [i for i in store.items() if i['key'] != it['key'] and i['path'].replace(os.sep, '/').startswith(folder)]
        if held and not args.with_items:
            raise CliError(f'{name} holds {plural(len(held), "item")} in its folder: they go to the trash with it. Add '
                           '--with-items to delete them all, or move them first')
    out = store.delete(it['key'])
    lines = [f"Deleted {name} → the trash (`{out['trashed']}`)"]
    if out.get('holds'):
        lines.append(f"With it, {plural(out['holds'], 'item')} of its folder.")
    if out.get('unlinked'):
        lines.append(f"{plural(out['unlinked'], 'item')} that named it lost the link; a restore gives it back.")
    lines.append(f"Undo: `restore {out['trashed']}`")
    return out, lines


def cmd_restore(store, args):
    it = store.restore_trashed(args.trashed)
    return written(store, [it], 'Restored')


BASE_ROWS = 100  # rows `base` prints (all of them with --json)


def cmd_base(store, args):
    out = store.base(args.path, args.view)
    if out.get('error'):
        raise CliError(out['error'])
    cols = out['columns']

    def text(v):
        return ', '.join(map(str, v)) if isinstance(v, list) else '' if v is None else str(v)
    lines = [f"# {out['path']} · {out['views'][out['view']]['name'] if out['views'] else ''}", '',
             f"{out['total']} results" + (f" · first {out['limit']}" if out.get('limit') else '') + ' · views: '
             + ', '.join(v['name'] for v in out['views'])]
    lines += [f'Not supported here: {", ".join(out["unsupported"])}' for _ in out['unsupported'][:1]]
    lines += [f'Error: {e}' for e in out['errors']]
    lines += ['', '| ' + ' | '.join(cell(c['label']) for c in cols) + ' |', '|' + '---|' * len(cols)]
    rows = out['rows']
    order = ([(g['label'], g['rows']) for g in out['groups']] if out.get('groups') else [(None, list(range(len(rows))))])
    shown = 0
    for label, idx in order:
        if label is not None:
            lines.append(f"| **{cell(label)}** ({len(idx)}) |" + ' |' * (len(cols) - 1))
        for i in idx:
            if shown >= BASE_ROWS:
                break
            lines.append('| ' + ' | '.join(cell(text(v)) for v in rows[i]['cells']) + ' |')
            shown += 1
    if len(rows) > shown:
        lines.append(f'\n…and {len(rows) - shown} more rows (--json has them all).')
    return out, lines


def cmd_board(store, args):
    if not args.name:
        if args.place:
            raise CliError('--place needs the board: board NAME --place REF=COLUMN')
        boards = store.agents_info()['boards']
        lines = ['# Boards', ''] + ([f"- {b['name']}: {', '.join(b['columns'])}" for b in boards] or ['none saved yet'])
        return {'boards': boards}, lines
    board = store.custom_board(args.name)
    if args.place:
        place = {}
        for pair in args.place:
            ref, sep, col = pair.partition('=')
            if not sep:
                raise CliError(f'--place takes REF=COLUMN, not {pair!r}')
            it = store.find(ref.strip())
            if it.get('id') is None:
                raise CliError(f'{ref} has no id: only an item goes on a board')
            col = col.strip()
            if not col:
                place[str(it['id'])] = None
                continue
            hit = next((c['id'] for c in board['columns'] if col in (c['id'], c['name'])
                        or c['name'].casefold() == col.casefold()), None)
            if hit is None:
                raise CliError(f"board {args.name} has no column {col!r} (it has: {', '.join(c['name'] for c in board['columns'])})")
            place[str(it['id'])] = [hit, None]
        board = store.save_custom_board(args.name, place=place)
    refs = {str(it['id']): it.get('ref') or it['title'] for it in store.items() if it.get('id') is not None}
    lines = [f"# Board {board['name']}", '']
    for c in board['columns']:
        cards = sorted((v[1] if v[1] is not None else float('inf'), refs.get(k, k)) for k, v in board['cards'].items()
                       if v[0] == c['id'] and k in refs)
        lines.append(f"- {c['name']} (`{c['id']}`): " + (', '.join(r for _, r in cards) or '—'))
    return board, lines


WRITES = (cmd_new, cmd_set, cmd_move, cmd_link, cmd_unlink, cmd_comment, cmd_attach, cmd_detach, cmd_delete, cmd_restore)


# ── the command line ─────────────────────────────────────────────────────────
def parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument('-C', '--vault', default=argparse.SUPPRESS, help='the vault folder')
    common.add_argument('--structure', default=argparse.SUPPRESS, choices=sorted(REGISTRY), help='do not detect it')
    common.add_argument('--json', action='store_true', default=argparse.SUPPRESS, help='machine output')
    p = argparse.ArgumentParser(prog='vault.py', parents=[common], description=__doc__.split('\n\n')[0],
                                formatter_class=argparse.RawDescriptionHelpFormatter, epilog='Run with -h after a command for its options.')
    sub = p.add_subparsers(dest='cmd', metavar='COMMAND', required=True)

    def add(name, fn, help_, *args):
        c = sub.add_parser(name, parents=[common], help=help_)
        c.set_defaults(fn=fn)
        for a, kw in args:
            c.add_argument(*a, **kw)
        return c

    add('overview', cmd_overview, 'projects, items by type and state, what changed last')
    add('types', cmd_types, 'the item types; with TYPE, its fields', (('type',), {'nargs': '?'}))
    add('find', cmd_find, 'items by text, type, status, project',
        (('text',), {'nargs': '?'}), (('--type',), {}), (('--status',), {}), (('--project',), {}),
        (('--open',), {'action': 'store_true'}), (('--closed',), {'action': 'store_true'}),
        (('--text',), {'dest': 'text_search', 'action': 'store_true', 'help': 'also search inside the files'}),
        (('--limit',), {'type': int, 'default': 50}))
    add('show', cmd_show, 'an item with its links', (('ref',), {}), (('--no-body',), {'action': 'store_true'}))
    add('graph', cmd_graph, 'what is around an item', (('ref',), {}), (('--depth',), {'type': int, 'default': 1}),
        (('--kinds',), {'help': ','.join(tm_graph.KINDS)}))
    add('context', cmd_context, 'the item as a prompt', (('ref',), {}), (('--instruction',), {}))
    add('check', cmd_check, 'whether the vault matches its structure')
    add('base', cmd_base, "an index (an Obsidian .base): one view's rows", (('path',), {}), (('--view',), {}))
    add('board', cmd_board, 'the custom boards; place a card', (('name',), {'nargs': '?'}),
        (('--place',), {'action': 'append', 'metavar': 'REF=COLUMN'}))
    agents = add('agents', cmd_agents, "the vault's guide for agents (AGENTS.md)", (('--print',), {'dest': 'print_it', 'action': 'store_true'}))
    onoff = agents.add_mutually_exclusive_group()
    onoff.add_argument('--on', action='store_true')
    onoff.add_argument('--off', action='store_true')
    add('trash', cmd_trash, 'what is in the trash (what restore takes)')
    add('new', cmd_new, 'create an item (any type: `types TYPE` says what it needs)', (('type',), {}), (('title',), {}),
        (('--set',), {'action': 'append', 'metavar': 'KEY=VALUE'}), (('--body',), {}),
        (('--attach',), {'action': 'append', 'metavar': 'FILE', 'help': 'a file to keep on it (repeat for more)'}))
    add('set', cmd_set, 'change fields or the description', (('ref',), {}), (('pairs',), {'nargs': '*', 'metavar': 'KEY=VALUE'}),
        (('--body',), {}), (('--rev',), {}))
    add('move', cmd_move, 'change the status', (('ref',), {}), (('status',), {}))
    add('link', cmd_link, 'relate two items', (('ref',), {}), (('kind',), {}), (('other',), {}))
    add('unlink', cmd_unlink, 'take a relation off', (('ref',), {}), (('other',), {}))
    add('comment', cmd_comment, 'add a comment', (('ref',), {}), (('text',), {}))
    add('attach', cmd_attach, 'keep files on an item', (('ref',), {}), (('files',), {'nargs': '+', 'metavar': 'FILE'}),
        (('--name',), {'help': 'the name it is kept as (one file)'}))
    add('detach', cmd_detach, 'take an attachment off (to the trash)', (('ref',), {}), (('path',), {}))
    add('delete', cmd_delete, 'to the trash (restore takes it back)', (('ref',), {}),
        (('--with-items',), {'action': 'store_true', 'help': "a project: with its folder's items"}))
    add('restore', cmd_restore, 'back from the trash', (('trashed',), {}))
    return p


def main(argv=None, out=None, err=None):
    out, err = out or sys.stdout, err or sys.stderr
    args = parser().parse_args(argv)
    download_on_read()  # a note iCloud has not downloaded yet is downloaded when read, not refused
    as_json = getattr(args, 'json', False)
    try:
        if getattr(args, 'open', False) and getattr(args, 'closed', False):
            raise CliError('--open and --closed together find nothing')
        if getattr(args, 'depth', 1) < 1:
            raise CliError('--depth is 1 or more')
        vault = getattr(args, 'vault', None) or os.environ.get('TM_VAULT') or find_vault(os.getcwd())
        store, args.structure_id = open_store(os.path.realpath(os.path.expanduser(vault)), getattr(args, 'structure', None))
        data, lines = args.fn(store, args)
        if args.fn in WRITES:
            store.refresh_agents_md(APP_DIR)  # a new project, a renamed one: the guide says so
    except (CliError, StoreError) as e:
        status = getattr(e, 'status', None)
        if as_json:
            out.write(json.dumps({'error': str(e), **({'status': status} if status else {})}, ensure_ascii=False) + '\n')
        else:
            err.write(f'vault.py: {e}\n')
        return 1
    if as_json:
        out.write(json.dumps(data, ensure_ascii=False, indent=2, default=str) + '\n')
    else:
        out.write('\n'.join(lines).rstrip() + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
