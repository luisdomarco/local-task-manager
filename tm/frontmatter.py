"""Frontmatter parsing and patching for task-manager .md files.

Values are written in JSON-compatible YAML flow style (`title: "Fix pricing"`,
`labels: ["a", "b"]`), which every YAML reader (Obsidian, js-yaml, PyYAML) accepts,
while this module only needs the stdlib `json`. Reading is tolerant of the plain
YAML a human or Obsidian may write: unquoted scalars, single quotes, trailing `# comments`,
block lists (of scalars or of `- k: v` maps), block maps and flow maps with unquoted keys.
Not supported: block scalars (`|`, `>`), anchors and aliases, tags, multi-line plain scalars.

Updates are *patches*: only the lines of the keys being changed are rewritten, so
unknown keys, comments, ordering, line endings and the body survive byte for byte.
"""

import json
import re

FM_RE = re.compile(r'\A---[ \t]*\r?\n(.*?)(?:\r?\n)?^---[ \t]*(?:\r?\n|\Z)', re.DOTALL | re.MULTILINE)
KEY_RE = re.compile(r'^([A-Za-z_][\w-]*):(?:[ \t]+(.*?))?[ \t]*$')
NUM_RE = re.compile(r'^-?\d+(\.\d+)?$')
# Strings that round-trip unquoted: no spaces, no YAML indicators, not bool/null/number.
PLAIN_RE = re.compile(r'^[A-Za-z0-9][\w\-./+]*(:[\w\-./+]+)*$')


def split(text):
    """Return (frontmatter_text or None, body)."""
    m = FM_RE.match(text)
    if not m:
        return None, text
    return m.group(1), text[m.end():]


def _unquoted(s):
    """Yield (index, char) for each character of `s` outside quoted scalars; (len(s), None) last if
    a quote is left open. A quote only opens where a quoted scalar can start (the beginning, or
    after `[ { , :`), so the apostrophe in a plain `it's` is just a character."""
    quote, prev, i = None, None, 0
    while i < len(s):
        c = s[i]
        if quote:
            if c == '\\' and quote == '"':
                i += 1
            elif c == quote:
                if quote == "'" and s[i + 1:i + 2] == "'":
                    i += 1
                else:
                    quote, prev = None, c
        elif c in '"\'' and prev in (None, '[', '{', ',', ':'):
            quote = c
        else:
            yield i, c
            if c not in ' \t':
                prev = c
        i += 1
    if quote:
        yield len(s), None


def _comment_start(s):
    """Index of the `#` that opens a trailing YAML comment (one that begins the text or follows
    whitespace, outside quotes), or -1."""
    for i, c in _unquoted(s):
        if c == '#' and (i == 0 or s[i - 1] in ' \t'):
            return i
    return -1


def _strip_comment(s):
    i = _comment_start(s)
    return (s if i < 0 else s[:i]).strip()


_BAD = object()  # a flow collection we do not understand: the caller keeps the raw text


def _split_flow(inner):
    """Split the inside of `[...]`/`{...}` on its top-level commas (not inside quotes or nesting)."""
    parts, depth, start = [], 0, 0
    for i, c in _unquoted(inner):
        if c is None:
            return _BAD
        if c in '[{':
            depth += 1
        elif c in ']}':
            depth -= 1
            if depth < 0:
                return _BAD
        elif c == ',' and depth == 0:
            parts.append(inner[start:i])
            start = i + 1
    if depth:
        return _BAD
    parts.append(inner[start:])
    return parts


def _flow_entry(entry):
    """`key: value` inside a flow map → (key, value), the key maybe quoted; _BAD without a `: `."""
    entry, depth = entry.strip(), 0
    for i, c in _unquoted(entry):
        if c is None:
            return _BAD
        if c in '[{':
            depth += 1
        elif c in ']}':
            depth -= 1
        elif c == ':' and depth == 0 and (i + 1 == len(entry) or entry[i + 1] in ' \t'):
            key = parse_value(entry[:i])
            return (key if isinstance(key, str) else entry[:i].strip()), parse_value(entry[i + 1:])
    return _BAD


def _parse_flow(raw):
    inner = raw[1:-1].strip()
    if raw[0] == '[':
        if not inner:
            return []
        parts = _split_flow(inner)
        return _BAD if parts is _BAD else [parse_value(x) for x in parts]
    if not inner:
        return {}
    parts = _split_flow(inner)
    if parts is _BAD:
        return _BAD
    out = {}
    for part in parts:
        if not part.strip():
            continue  # a trailing comma
        entry = _flow_entry(part)
        if entry is _BAD:
            return _BAD
        out[entry[0]] = entry[1]
    return out


def parse_value(raw):
    raw = _strip_comment(raw)
    if raw in ('', '~'):
        return None
    if raw[0] in '"[{' or raw in ('true', 'false', 'null') or NUM_RE.match(raw):
        try:
            return json.loads(raw)
        except ValueError:
            pass
    if len(raw) >= 2 and raw[0] == "'" and raw[-1] == "'":
        return raw[1:-1].replace("''", "'")
    if (raw[0], raw[-1]) in (('[', ']'), ('{', '}')):  # flow collection with unquoted items or keys
        value = _parse_flow(raw)
        if value is not _BAD:
            return value
    return raw


def _is_item(text):
    return text == '-' or text.startswith(('- ', '-\t'))


def _block_end(lines, i):
    """Index just past the block that continues the key line before `i`: its indented lines and
    `- item` lines, blank lines between them included, a trailing blank run not."""
    end = i
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
        elif line[0] in ' \t' or _is_item(line):
            i += 1
            end = i
        else:
            break
    return end


def _node(rows):
    """One block node from (indent, text) rows; the first row is the node's own first line."""
    text = rows[0][1]
    if _is_item(text):
        return _block_seq(rows)
    if KEY_RE.match(text):
        return _block_map(rows)
    return parse_value(text)


def _block_seq(rows):
    ind, out, i = rows[0][0], [], 0
    while i < len(rows):
        indent, text = rows[i]
        j = i + 1
        while j < len(rows) and rows[j][0] > ind:
            j += 1
        children, i = rows[i + 1:j], j
        if not _is_item(text):
            continue
        content = text[1:].lstrip(' \t')
        if not _strip_comment(content):
            out.append(_node(children) if children else None)
        else:  # `- k: v` opens a map at the column of `k`; `- - x` a nested list
            out.append(_node([(indent + len(text) - len(content), content)] + children))
    return out


def _block_map(rows):
    ind, out, i = rows[0][0], {}, 0
    while i < len(rows):
        text = rows[i][1]
        j = i + 1
        while j < len(rows) and (rows[j][0] > ind or rows[j][0] == ind and _is_item(rows[j][1])):
            j += 1
        children, i = rows[i + 1:j], j
        m = KEY_RE.match(text)
        if not m:
            continue
        raw = _strip_comment(m.group(2) or '')
        out[m.group(1)] = parse_value(raw) if raw else (_node(children) if children else None)
    return out


def _lines(fm_text):
    # Only `\n` ends a line: str.splitlines() would also split on U+2028, \x85… inside a value.
    return [line[:-1] if line.endswith('\r') else line for line in fm_text.split('\n')]


def parse(fm_text):
    """Parse top-level keys. A key with no inline value takes the indented block under it:
    a block list (`- item`, `- k: v` maps included) or a block map."""
    data = {}
    if not fm_text:
        return data
    lines = _lines(fm_text)
    i = 0
    while i < len(lines):
        m = KEY_RE.match(lines[i])
        i += 1
        if not m:
            continue
        key, raw = m.group(1), _strip_comment(m.group(2) or '')
        end = _block_end(lines, i)
        if raw:
            data[key] = parse_value(raw)
        else:
            rows = [(len(l) - len(l.lstrip(' \t')), l.strip()) for l in lines[i:end]
                    if l.strip() and not l.lstrip().startswith('#')]
            data[key] = _node(rows) if rows else None
        i = end
    return data


def dump_value(v):
    if v is None:
        return ''
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return json.dumps(v)
    if isinstance(v, (list, dict)):
        return json.dumps(v, ensure_ascii=False)
    s = str(v)
    if PLAIN_RE.match(s) and s not in ('true', 'false', 'null') and not NUM_RE.match(s):
        return s
    return json.dumps(s, ensure_ascii=False)


def _line(key, value):
    dumped = dump_value(value)
    return f'{key}: {dumped}' if dumped != '' else f'{key}:'


def build(fields, body=''):
    """Serialize an ordered dict of fields plus a body into a full .md text."""
    lines = [_line(k, v) for k, v in fields.items()]
    body = body if body.startswith('\n') or body == '' else '\n' + body
    return '---\n' + '\n'.join(lines) + '\n---\n' + body


def patch(text, updates, body=None):
    """Set `updates` keys in the frontmatter of `text`, keeping every other byte.

    A key present in the file is replaced in place, together with the whole block under it
    (indented lines and `- item` lines); a trailing `# comment` on its line is kept at its column.
    A new key is appended. Other keys, comments, order, line endings and the body are untouched;
    `body`, when given, replaces the body.
    """
    m = FM_RE.match(text)
    if not m:
        if not updates and body is None:
            return text
        new_body = text if body is None else body
        if new_body and not new_body.startswith('\n'):
            new_body = '\n' + new_body
        return '---\n' + '\n'.join(_line(k, v) for k, v in updates.items()) + '\n---\n' + new_body
    head, tail, old_body = text[:m.start(1)], text[m.end(1):m.end()], text[m.end():]
    nl = '\r\n' if head.endswith('\r\n') else '\n'
    raw = m.group(1).split('\n')
    ends = ['\n'] * (len(raw) - 1) + ['']  # the last frontmatter line has its newline in `tail`
    lines = _lines(m.group(1))
    if raw == ['']:
        raw, ends, lines = [], [], []
    pending = dict(updates)
    out = []
    i = 0
    while i < len(lines):
        mk = KEY_RE.match(lines[i])
        if not (mk and mk.group(1) in pending):
            out.append(raw[i] + ends[i])
            i += 1
            continue
        key = mk.group(1)
        line = _line(key, pending.pop(key))
        at = _comment_start(mk.group(2) or '')
        if at >= 0:
            col = mk.start(2) + at
            line += ' ' * max(col - len(line), 1) + lines[i][col:]
        end = _block_end(lines, i + 1)
        cr = '\r' if raw[end - 1].endswith('\r') else ''
        out.append(line + cr + ends[end - 1])
        i = end
    if pending:
        added = [_line(k, v) for k, v in pending.items()]
        if out and not out[-1].endswith('\n'):
            out[-1] += nl
            out.append(nl.join(added))
        else:  # empty frontmatter, or one ending in a blank line: keep that layout
            out.append(nl.join(added) + nl)
    new_body = old_body
    if body is not None:
        new_body = body if body == '' or body.startswith('\n') else '\n' + body
        if new_body and not tail.endswith('\n'):
            tail += nl
    return head + ''.join(out) + tail + new_body
