#!/usr/bin/env python3
"""Turn a hand-written bookmarks index into an Obsidian base (.base), as Obsidian builds indexes now.

The index is a note of `## Category` sections, each a list of `- [[Note]] - https://…` lines (Dataview blocks are
left alone: the base's views replace them). Every listed note gets the `category` of the section it is under, when
it has none yet; then a base beside the index lists the notes, grouped by category, with a view for each of the
Repos and Podcasts sections when there are such.

    python3 tools/bookmarks_to_base.py -C <vault>                          # a dry run: what it would do, nothing written
    python3 tools/bookmarks_to_base.py -C <vault> --apply                  # write the categories and the .base
    python3 tools/bookmarks_to_base.py -C <vault> --index "Lists/My bookmarks.md"

Only the `category` key of a note is written (frontmatter.patch: every other byte stays). A note that has a category
already keeps it; one that differs from its section is listed for you to decide. A note listed under two sections is
listed too, never guessed. The .md index is not touched, and an existing .base is not overwritten (--force).
Stdlib only, Python 3.9.
"""
import argparse
import os
import re
import sys

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)

from tm import bases  # noqa: E402
from tm import frontmatter as fm  # noqa: E402
from tm.fsutil import atomic_write  # noqa: E402

DEFAULT_INDEX = '00 Index Bookmarks.md'
SKIP = {'.git', '.obsidian', '.trash', '.task-manager', 'node_modules', '__pycache__'}
H2 = re.compile(r'^##\s+(.+?)\s*#*\s*$')
ENTRY = re.compile(r'^\s*[-*+]\s+(?:\[[ xX]\]\s+)?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]')


def notes_of(root):
    """Every .md of the vault, as vault-relative paths (hidden and app folders left out)."""
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP and not d.startswith('.'))
        rel = os.path.relpath(dirpath, root).replace(os.sep, '/')
        for f in sorted(filenames):
            if f.lower().endswith('.md'):
                out.append(f if rel == '.' else f'{rel}/{f}')
    return out


def category_name(heading):
    """A section's heading as a category: its words, without the emoji or the marks a heading may lead with."""
    text = re.sub(r'^[^\w\[(]+', '', heading, flags=re.UNICODE).strip()
    return text or heading.strip()


def read_index(text):
    """[(category, note target)] of the index's lists, in order, and how many Dataview blocks it holds."""
    entries, section, fence, dataview = [], None, None, 0
    for line in text.splitlines():
        stripped = line.strip()
        if fence:
            if stripped.startswith(fence):
                fence = None
            continue
        if stripped.startswith(('```', '~~~')):
            fence = stripped[:3]
            if stripped[3:].strip().lower().startswith('dataview'):
                dataview += 1
            continue
        m = H2.match(line)
        if m:
            section = category_name(m.group(1))
            continue
        m = ENTRY.match(line)
        if m and section:
            entries.append((section, m.group(1).strip()))
    return entries, dataview


def frontmatter(path):
    with open(path, encoding='utf-8') as f:
        text = f.read()
    head = fm.split(text)[0]
    return text, (fm.parse(head) if head is not None else {})


def plan(root, index_rel):
    """What --apply would do: {set: [(rel, category)], keep: [(rel, has)], differ: [(rel, has, section)],
    twice: [(rel, [sections])], missing: [(section, target)], dataview, notes, file_class}."""
    index_path = os.path.join(root, index_rel)
    with open(index_path, encoding='utf-8') as f:
        entries, dataview = read_index(f.read())
    resolve = bases.resolver(notes_of(root))
    sections_of, missing = {}, []
    for section, target in entries:
        rel = resolve(target, index_rel)
        if rel is None:
            missing.append((section, target))
            continue
        if rel == index_rel:
            continue
        got = sections_of.setdefault(rel, [])
        if section not in got:
            got.append(section)
    out = {'set': [], 'keep': [], 'differ': [], 'twice': [], 'missing': missing, 'dataview': dataview,
           'notes': len(sections_of), 'file_class': None, 'sections': []}
    classes = {}
    for rel, sections in sections_of.items():
        for s in sections:
            if s not in out['sections']:
                out['sections'].append(s)
        _, fields = frontmatter(os.path.join(root, rel))
        fc = str(fields.get('fileClass') or '').strip()
        if fc:
            classes[fc] = classes.get(fc, 0) + 1
        has = fields.get('category')
        has = ', '.join(map(str, has)) if isinstance(has, list) else (str(has).strip() if has not in (None, '') else '')
        if len(sections) > 1:
            out['twice'].append((rel, sections))
        elif not has:
            out['set'].append((rel, sections[0]))
        elif has.casefold() == sections[0].casefold():
            out['keep'].append((rel, has))
        else:
            out['differ'].append((rel, has, sections[0]))
    if classes:
        fc, n = max(classes.items(), key=lambda kv: kv[1])
        if n * 2 > len(sections_of):
            out['file_class'] = fc  # most listed notes say what they are: the base keeps to those
    return out


def _q(s):
    return '"' + str(s).replace('\\', '\\\\').replace('"', '\\"') + '"'


def base_text(index_rel, p):
    """The .base: every bookmark (its fileClass, else a category in the index's folder), grouped by category; a view
    for the Repos and the Podcasts sections when the index has them."""
    folder = index_rel.rsplit('/', 1)[0] if '/' in index_rel else ''
    if p['file_class']:
        where = [f'fileClass == {_q(p["file_class"])}']
    else:
        where = ['file.hasProperty("category")'] + ([f'file.inFolder({_q(folder)})'] if folder else [])
    cols = ['file.name', 'category', 'url', 'summary', 'related_tool', 'tags']
    lines = ['filters:', '  and:'] + [f"    - '{w}'" for w in where]
    lines += ['views:', '  - type: table', '    name: All', '    groupBy:', '      property: category', '      direction: ASC',
              '    order:'] + [f'      - {c}' for c in cols]
    for word in ('Repos', 'Podcasts'):
        hit = next((s for s in p['sections'] if word.lower().rstrip('s') in s.lower()), None)
        if hit:
            lines += ['  - type: table', f'    name: {word}', f"    filters: 'category == {_q(hit)}'", '    order:']
            lines += [f'      - {c}' for c in cols if c != 'category']
    return '\n'.join(lines) + '\n'


def apply(root, index_rel, p, force=False):
    """Write the categories and the .base. → (notes written, the base's path)."""
    written = 0
    for rel, category in p['set']:
        path = os.path.join(root, rel)
        text, fields = frontmatter(path)
        if fields.get('category') not in (None, ''):
            continue  # it got one meanwhile
        out = fm.patch(text, {'category': category})
        if out != text:
            atomic_write(path, out)
            written += 1
    base_rel = re.sub(r'\.md$', '', index_rel, flags=re.IGNORECASE) + '.base'
    base_path = os.path.join(root, base_rel)
    if os.path.exists(base_path) and not force:
        raise SystemExit(f'{base_rel} exists already: --force to write it again')
    atomic_write(base_path, base_text(index_rel, p))
    return written, base_rel


def report(p, index_rel):
    lines = [f'{index_rel}: {p["notes"]} notes listed in {len(p["sections"])} sections'
             + (f', {p["dataview"]} Dataview block(s) (the base\'s views replace them)' if p['dataview'] else '') + '.']
    if p['file_class']:
        lines.append(f'The base lists the notes with fileClass: {p["file_class"]}.')
    lines.append(f'\ncategory to add ({len(p["set"])}):')
    lines += [f'  {rel}  →  {cat}' for rel, cat in p['set']] or ['  (none)']
    if p['differ']:
        lines.append(f'\nhave another category (kept; change it by hand if the section is right) ({len(p["differ"])}):')
        lines += [f'  {rel}: has "{has}", listed under "{sec}"' for rel, has, sec in p['differ']]
    if p['twice']:
        lines.append(f'\nlisted under several sections (left for you) ({len(p["twice"])}):')
        lines += [f'  {rel}: {", ".join(secs)}' for rel, secs in p['twice']]
    if p['missing']:
        lines.append(f'\nlisted but not in the vault ({len(p["missing"])}):')
        lines += [f'  [[{t}]] under {sec}' for sec, t in p['missing']]
    lines.append(f'\nalready right: {len(p["keep"])}')
    return '\n'.join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('-C', dest='root', required=True, help='the vault')
    ap.add_argument('--index', default=DEFAULT_INDEX, help=f'the index note, from the vault (default: {DEFAULT_INDEX})')
    ap.add_argument('--apply', action='store_true', help='write the categories and the .base (default: a dry run)')
    ap.add_argument('--force', action='store_true', help='write the .base even if it exists')
    args = ap.parse_args(argv)
    root = os.path.realpath(args.root)
    index_rel = args.index.strip('/')
    if not os.path.isfile(os.path.join(root, index_rel)):
        raise SystemExit(f'no index at {index_rel} in {root}')
    p = plan(root, index_rel)
    print(report(p, index_rel))
    if not args.apply:
        print('\nA dry run: nothing written. With --apply, the categories above and '
              f'{re.sub(r"[.]md$", "", index_rel)}.base are written; the .md index stays.')
        return 0
    written, base_rel = apply(root, index_rel, p, force=args.force)
    print(f'\nWrote category in {written} notes, and {base_rel}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
