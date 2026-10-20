"""Obsidian wikilinks: `[[Target]]`, `[[Target|alias]]`, `[[Target#heading]]`. A link names a note by its file
name without `.md` (its stem): that is what Obsidian resolves, and what the app maps to an item."""

import re

LINK_RE = re.compile(r'^\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*$')


def target(value):
    """The stem a wikilink points at, or None when `value` is not a single wikilink."""
    m = LINK_RE.match(str(value or ''))
    return m.group(1).strip() if m else None


def link(stem):
    return f'[[{stem}]]'


def rewrite(text, old, new):
    """`[[old]]`, `[[old|…]]` and `[[old#…]]` → the same with `new`; nothing else (`[[old 2]]` stays)."""
    return re.sub(r'\[\[' + re.escape(old) + r'(?=[\]|#])', '[[' + new.replace('\\', r'\\'), text)
