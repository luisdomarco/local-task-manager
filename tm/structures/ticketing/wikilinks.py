"""Obsidian wikilinks: `[[Target]]`, `[[Target|alias]]`, `[[Target#heading]]`. A link names a note by its file
name without `.md` (its stem): that is what Obsidian resolves, and what the app maps to an item."""

import re

LINK_RE = re.compile(r'^\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*$')


# Any wikilink or embed inside a text: `[[Target]]`, `[[Target|alias]]`, `[[Target#heading]]`, `![[Target]]`.
TEXT_LINK_RE = re.compile(r'!?\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]')


def targets(text):
    """The stems a text links to, each once, in the order they first appear. A link with a folder (`[[Docs/Guide]]`)
    names its note by the last part, as Obsidian resolves it; a `.md` on the end is dropped."""
    out, seen = [], set()
    for m in TEXT_LINK_RE.finditer(str(text or '')):
        stem = m.group(1).strip().replace('\\', '/').rsplit('/', 1)[-1]
        if stem.lower().endswith('.md'):
            stem = stem[:-3]
        if stem and stem not in seen:
            seen.add(stem)
            out.append(stem)
    return out


def target(value):
    """The stem a wikilink points at, or None when `value` is not a single wikilink."""
    m = LINK_RE.match(str(value or ''))
    return m.group(1).strip() if m else None


def link(stem):
    return f'[[{stem}]]'


def rewrite(text, old, new):
    """`[[old]]`, `[[old|…]]` and `[[old#…]]` → the same with `new`; nothing else (`[[old 2]]` stays)."""
    return re.sub(r'\[\[' + re.escape(old) + r'(?=[\]|#])', '[[' + new.replace('\\', r'\\'), text)
