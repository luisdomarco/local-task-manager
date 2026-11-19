"""Obsidian Bases (`.base` files): read one and work out the rows each of its views shows.

A `.base` file is YAML: `filters` (a statement, or `and` / `or` / `not` over a list of them), `formulas` (name →
expression), `properties` (display names), `summaries` and `views` (a list: `type` table · cards · list, `name`,
`filters`, `order`, `sort`, `groupBy`, `groupOrder`, `limit`, `summaries`, `image`). The statements and formulas are
Obsidian's expression language: literals, `note.*` / `file.*` / `formula.*` / `this`, the operators of JavaScript,
global functions (`if`, `now`, `today`, `date`, `link`, `list`, `number`, `min`, `max`, `duration`, `file`) and the
methods of each type (a string's `contains`, a list's `join`, a file's `hasTag` / `inFolder` / `hasLink`, a date's
`format`…). See https://obsidian.md/help/bases/syntax and …/functions.

What is not here (a plugin's view type, `map`/`filter`/`reduce`, a custom summary, `html()`…) is never guessed: it is
named in the answer's `unsupported` and that view (or that cell) shows nothing.

Nothing here reads the disk: the Store hands a `Source` (the vault's files and what they say, from its index).
"""
import datetime as _dt
import json
import math
import re
import time

try:  # the parser of `re` itself: 3.11+ keeps it as re._parser (sre_parse warns there), 3.9 as sre_parse
    from re import _parser as _sre
except ImportError:  # pragma: no cover - Python 3.9 / 3.10
    import sre_parse as _sre

from . import frontmatter as fm

# Limits a base cannot pass, whatever its file says: a base is data a vault carries (and a vault is also edited
# elsewhere), so one cannot make the server build huge text or spin. Past them the view shows an error.
TEXT_MAX = 100_000      # characters of any text, items of any list, an expression may build
DIGITS_MAX = 100        # round() / toFixed() digits
PATTERN_MAX = 300       # characters of a /regex/
TIME_BUDGET = 5.0       # seconds one view may take to work out
REGEX_TEXT_MAX = 2_000  # characters of the text a regex runs on
UNBOUNDED_MAX = 2       # unbounded repetitions (*, +, {n,}) one regex may have in all
ROW_BUDGET = 2_000_000  # characters and items one row's expressions may build in all
# the opcodes of re's parse that hold no subpattern (a literal, a class, an anchor…): anything else must be walked
_LEAVES = {getattr(_sre, n) for n in ('LITERAL', 'NOT_LITERAL', 'ANY', 'IN', 'AT', 'CATEGORY', 'GROUPREF',
                                      'RANGE', 'NEGATE', 'CHARSET', 'BIGCHARSET', 'FAILURE', 'SUCCESS',
                                      'RANGE_UNI_IGNORE') if hasattr(_sre, n)}
_REPEATS = {getattr(_sre, n) for n in ('MAX_REPEAT', 'MIN_REPEAT', 'POSSESSIVE_REPEAT') if hasattr(_sre, n)}


class BaseError(ValueError):
    """The file is not a base this can read (YAML it cannot parse, a view that is not a list…)."""


class Unsupported(Exception):
    """Something Obsidian has and this does not: its name is said, nothing is guessed."""


class ExprError(Exception):
    """An expression that cannot be read or evaluated (a typo, a method of the wrong type)."""


# ── the YAML Bases writes ─────────────────────────────────────────────────────────────────────────────────────
_KEY = re.compile(r'''^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^'"\s#][^:#]*?)[ \t]*:(?:[ \t]+(.*))?$''')


def _rows(text):
    out = []
    for raw in text.replace('\r\n', '\n').split('\n'):
        if raw.strip() and not raw.lstrip().startswith('#'):
            if '\t' in raw[:len(raw) - len(raw.lstrip())]:
                raise BaseError('tabs in indentation')
            out.append([len(raw) - len(raw.lstrip(' ')), raw.strip(), raw])
    return out


def _key(raw):
    if raw[:1] == '"':
        return json.loads(raw)
    if raw[:1] == "'":
        return raw[1:-1].replace("''", "'")
    return raw.strip()


def _block_scalar(rows, i, ind, style):
    """`|` or `>`: the lines indented under the key, their common indent removed."""
    lines, j = [], i
    while j < len(rows) and rows[j][0] > ind:
        lines.append(rows[j][2])
        j += 1
    cut = min((len(l) - len(l.lstrip(' ')) for l in lines), default=0)
    lines = [l[cut:] for l in lines]
    text = ' '.join(lines) if style.startswith('>') else '\n'.join(lines)
    return text, j


def _node(rows, i, ind):
    """The node whose lines start at rows[i], all at indent `ind` (a list or a map). → (value, next row)."""
    if rows[i][1] == '-' or rows[i][1].startswith('- '):
        return _seq(rows, i, ind)
    return _map(rows, i, ind)


def _value(rows, i, ind, raw):
    """A key's value: inline (`raw`), a block scalar, or the block under it. → (value, next row)."""
    raw = fm._strip_comment(raw or '')
    if raw and raw[0] in '|>' and re.match(r'^[|>][+-]?\d*$', raw):
        return _block_scalar(rows, i, ind, raw)
    if raw:
        return fm.parse_value(raw), i
    if i < len(rows) and (rows[i][0] > ind or (rows[i][0] == ind and (rows[i][1] == '-' or rows[i][1].startswith('- ')))):
        return _node(rows, i, rows[i][0])
    return None, i


def _map(rows, i, ind):
    out = {}
    while i < len(rows) and rows[i][0] == ind:
        text = rows[i][1]
        if text == '-' or text.startswith('- '):
            break
        m = _KEY.match(text)
        if not m:
            raise BaseError(f'line {text!r} is not "key: value"')
        out[_key(m.group(1))], i = _value(rows, i + 1, ind, m.group(2))
    if i < len(rows) and rows[i][0] > ind:
        raise BaseError(f'unexpected indentation at {rows[i][1]!r}')
    return out, i


def _seq(rows, i, ind):
    out = []
    while i < len(rows) and rows[i][0] == ind and (rows[i][1] == '-' or rows[i][1].startswith('- ')):
        rest = rows[i][1][1:].lstrip(' ')
        col = ind + len(rows[i][1]) - len(rest)
        if not rest:
            value, i = _value(rows, i + 1, ind, '')
        elif _KEY.match(rest) and not rest.startswith(('"', "'", '[', '{')) or re.match(r'''^("[^"]*"|'[^']*')[ \t]*:''', rest):
            # `- key: v` opens a map at the column of `key`: its first row is this one, its others are indented as it
            rows[i] = [col, rest, ' ' * col + rest]
            value, i = _map(rows, i, col)
        elif rest == '-' or rest.startswith('- '):
            rows[i] = [col, rest, ' ' * col + rest]
            value, i = _seq(rows, i, col)
        else:
            value, i = fm.parse_value(rest), i + 1
        out.append(value)
    return out, i


def parse_yaml(text):
    """The YAML of a .base file (maps, lists, scalars, flow collections, block scalars; no anchors or tags)."""
    rows = _rows(text)
    if not rows:
        return {}
    value, i = _node(rows, 0, rows[0][0])
    if i < len(rows):
        raise BaseError(f'unexpected line {rows[i][1]!r}')
    return value


# ── values ────────────────────────────────────────────────────────────────────────────────────────────────────
class Date:
    """A day or a moment (naive, local time). `time` says whether it has one (`2026-11-14` has none)."""
    __slots__ = ('dt', 'time')

    def __init__(self, dt, time=True):
        self.dt, self.time = dt, time

    def __eq__(self, other):
        return isinstance(other, Date) and self.dt == other.dt

    def __hash__(self):
        return hash(self.dt)

    def text(self):
        return self.dt.strftime('%Y-%m-%dT%H:%M:%S') if self.time else self.dt.strftime('%Y-%m-%d')


class Duration:
    __slots__ = ('months', 'ms')

    def __init__(self, months=0, ms=0.0):
        self.months, self.ms = months, ms

    def __eq__(self, other):
        return isinstance(other, Duration) and (self.months, self.ms) == (other.months, other.ms)

    def total(self):
        return self.months * 30 * 86400000 + self.ms

    def text(self):
        ms = self.total()
        for name, size in (('year', 365 * 86400000), ('month', 30 * 86400000), ('week', 7 * 86400000), ('day', 86400000),
                           ('hour', 3600000), ('minute', 60000), ('second', 1000)):
            if abs(ms) >= size:
                n = int(ms / size)
                return f"{n} {name}{'' if abs(n) == 1 else 's'}"
        return '0 seconds'


class Link:
    """A [[note]]: what it names, and the file that is (when the vault has it)."""
    __slots__ = ('target', 'display', 'path')

    def __init__(self, target, display=None, path=None):
        self.target, self.display, self.path = target, display, path

    def __eq__(self, other):
        if isinstance(other, Link):
            return (self.path or self.target.lower()) == (other.path or other.target.lower())
        if isinstance(other, File):
            return self.path == other.rel
        if isinstance(other, str):
            o = other.strip()
            m = _WIKI.match(o)
            o = (m.group(1) if m else o).strip().lower()
            return o in (self.target.lower(), (self.path or '').lower(), _stem(self.path or '').lower())
        return False

    def __hash__(self):
        return hash(self.path or self.target.lower())

    def text(self):
        return f'[[{self.target}|{self.display}]]' if self.display else f'[[{self.target}]]'


def _backtracks(pattern):
    """Whether a regex can take very long on some text (Python's re has no timeout), read from re's own parse of it at
    any depth: a repetition, an alternation or a back-reference inside a repeated group — (a+)+, (a|aa)*, (a?){30} —,
    or more than UNBOUNDED_MAX unbounded repetitions in all (a*a*a*b: polynomial). Fails closed: a parse it does not
    know how to walk is refused."""
    try:
        tree = _sre.parse(pattern)
    except re.error:
        return False  # re.compile says why
    unbounded = [0]

    def subpatterns(av):
        if isinstance(av, _sre.SubPattern):
            return [av]
        out = []
        for part in (av if isinstance(av, (tuple, list)) else ()):
            out += subpatterns(part) if isinstance(part, (tuple, list, _sre.SubPattern)) else []
        return out

    def walk(node, repeated):
        for op, av in node:
            if op in _REPEATS:
                lo, hi, sub = av
                if repeated:
                    return True
                if hi is _sre.MAXREPEAT:
                    unbounded[0] += 1
                    if unbounded[0] > UNBOUNDED_MAX:
                        return True
                if walk(sub, hi is _sre.MAXREPEAT or hi > 1):
                    return True
                continue
            if repeated and op in (_sre.BRANCH, _sre.GROUPREF, getattr(_sre, 'GROUPREF_EXISTS', None)):
                return True
            if op not in _LEAVES and not subpatterns(av):
                return True  # an opcode with no subpattern that is not a known leaf: not walked, so refused
            for sp in subpatterns(av):
                if walk(sp, repeated):
                    return True
        return False
    return walk(tree, False)


def _regex_text(text):
    """The text a regex runs on, if it is short enough."""
    if len(text) > REGEX_TEXT_MAX:
        raise ExprError(f'a regular expression on a text past {REGEX_TEXT_MAX} characters')
    return text


def _sized(v, size=None):
    """v, if it (or what it would be: `size`) is a text or list within TEXT_MAX; else the view's error."""
    if size is None:
        size = len(v) if isinstance(v, (str, list)) else 0
    if size > TEXT_MAX:
        raise ExprError(f'a {"list" if isinstance(v, list) else "text"} past {TEXT_MAX} '
                        f'{"items" if isinstance(v, list) else "characters"}')
    return v


def _int_arg(x, lo, hi):
    """A whole-number argument, kept between lo and hi (NaN → lo)."""
    n = to_number(x)
    if n is None or n != n or n in (math.inf, -math.inf):
        return lo
    return max(lo, min(hi, int(n)))


class Regex:
    __slots__ = ('re', 'glob')

    def __init__(self, pattern, flags):
        f = (re.IGNORECASE if 'i' in flags else 0) | (re.MULTILINE if 'm' in flags else 0) | (re.DOTALL if 's' in flags else 0)
        if len(pattern) > PATTERN_MAX:
            raise ExprError(f'a regular expression longer than {PATTERN_MAX} characters')
        if _backtracks(pattern):
            raise ExprError(f'a regular expression that can take very long to run: /{pattern}/ (a repetition inside a repeated '
                          f'group, or more than {UNBOUNDED_MAX} unbounded ones)')
        try:
            self.re = re.compile(pattern, f)
        except re.error as e:
            raise ExprError(f'not a regular expression: /{pattern}/ ({e})')
        self.glob = 'g' in flags


_WIKI = re.compile(r'^\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$')
_DATE = re.compile(r'^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$')


def _stem(path):
    name = path.rsplit('/', 1)[-1]
    return name[:-3] if name.lower().endswith('.md') else name


def parse_date(s):
    m = _DATE.match(str(s).strip())
    if not m:
        return None
    y, mo, d, hh, mm, ss = (int(x) if x else 0 for x in m.groups()[:6])
    try:
        return Date(_dt.datetime(y, mo, d, hh, mm, ss), m.group(4) is not None)
    except ValueError:
        return None


_UNITS = {'y': 'y', 'year': 'y', 'years': 'y', 'M': 'M', 'month': 'M', 'months': 'M', 'w': 'w', 'week': 'w', 'weeks': 'w',
          'd': 'd', 'day': 'd', 'days': 'd', 'h': 'h', 'hour': 'h', 'hours': 'h', 'm': 'm', 'minute': 'm', 'minutes': 'm',
          's': 's', 'second': 's', 'seconds': 's', 'ms': 'ms', 'millisecond': 'ms', 'milliseconds': 'ms'}
_MS = {'w': 7 * 86400000, 'd': 86400000, 'h': 3600000, 'm': 60000, 's': 1000, 'ms': 1}


def parse_duration(s):
    s = str(s).strip()
    parts = re.findall(r'(-?\d+(?:\.\d+)?)\s*([A-Za-z]+)', s)
    if not parts or re.sub(r'(-?\d+(?:\.\d+)?)\s*([A-Za-z]+)|[\s,]', '', s):
        return None
    months, ms = 0, 0.0
    for n, unit in parts:
        u = _UNITS.get(unit) or _UNITS.get(unit.lower() if len(unit) > 1 else unit)
        if u is None:
            return None
        n = float(n)
        if u == 'y':
            months += int(n * 12)
        elif u == 'M':
            months += int(n)
        else:
            ms += n * _MS[u]
    return Duration(months, ms)


def _add_months(dt, n):
    y, m = divmod(dt.month - 1 + n, 12)
    y += dt.year
    m += 1
    days = [31, 29 if y % 4 == 0 and (y % 100 or y % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return dt.replace(year=y, month=m, day=min(dt.day, days))


def _shift(date, dur, sign=1):
    dt = _add_months(date.dt, sign * dur.months) + _dt.timedelta(milliseconds=sign * dur.ms)
    return Date(dt, date.time or bool(dur.ms % 86400000))


def truthy(v):
    if v is None or v is False:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v != 0 and not (isinstance(v, float) and math.isnan(v))
    if isinstance(v, str):
        return v != ''
    return True  # lists and objects too, as in JavaScript


def is_empty(v):
    return v is None or v == '' or (isinstance(v, (list, dict)) and not v)


def to_text(v):
    """A value as text, as JavaScript's String() and Obsidian's display say it."""
    if v is None:
        return ''
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (Date, Duration, Link)):
        return v.text()
    if isinstance(v, File):
        return v.name
    if isinstance(v, list):
        return ', '.join(to_text(x) for x in v)
    if isinstance(v, dict):
        return json.dumps({k: to_text(x) for k, x in v.items()}, ensure_ascii=False)
    return str(v)


def to_json(v):
    """A value for the page: what props.js draws (a date as its ISO text, a link as [[…]], a list as a list)."""
    if isinstance(v, float) and v.is_integer() and abs(v) < 2 ** 53:
        return int(v)
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, list):
        return [to_json(x) for x in v]
    if isinstance(v, dict):
        return {k: to_json(x) for k, x in v.items()}
    if isinstance(v, File):
        return f'[[{_stem(v.rel) if v.rel.lower().endswith(".md") else v.rel}]]'
    return to_text(v)


def to_number(v):
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, Date):
        return v.dt.timestamp() * 1000
    if isinstance(v, Duration):
        return v.total()
    if isinstance(v, str):
        try:
            return float(v) if v.strip() else 0
        except ValueError:
            raise ExprError(f'not a number: {v!r}')
    if v is None:
        return 0
    raise ExprError(f'not a number: {to_text(v)}')


def _as_date(v):
    if isinstance(v, Date):
        return v
    if isinstance(v, str):
        return parse_date(v)
    return None


def equal(a, b):
    if isinstance(a, Link) or isinstance(b, Link):
        return (a if isinstance(a, Link) else b) == (b if isinstance(a, Link) else a)
    if isinstance(a, File) and isinstance(b, File):
        return a.rel == b.rel
    if isinstance(a, Date) or isinstance(b, Date):
        da, db = _as_date(a), _as_date(b)
        return da is not None and db is not None and da.dt == db.dt
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b or (isinstance(a, bool) and isinstance(b, bool) and a == b)
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(equal(x, y) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and isinstance(b, str) or isinstance(b, (int, float)) and isinstance(a, str):
        try:
            return float(a) == float(b)
        except ValueError:
            return False
    return a == b


def compare(a, b):
    """-1 · 0 · 1, for < > <= >=: numbers, dates (a date's text too), durations, text."""
    da, db = _as_date(a), _as_date(b)
    if isinstance(a, Date) or isinstance(b, Date):
        if da is None or db is None:
            raise ExprError(f'cannot compare {to_text(a)!r} with {to_text(b)!r}')
        x, y = da.dt, db.dt
    elif isinstance(a, Duration) or isinstance(b, Duration):
        x, y = to_number(a), to_number(b)
    elif isinstance(a, str) and isinstance(b, str):
        x, y = a, b
    elif a is None or b is None:
        raise ExprError('compared with nothing')
    else:
        x, y = to_number(a), to_number(b)
    return (x > y) - (x < y)


# ── the expression language ───────────────────────────────────────────────────────────────────────────────────
_TOKEN = re.compile(r'''
    (?P<ws>\s+)
  | (?P<num>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)
  | (?P<str>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')
  | (?P<id>[A-Za-z_$][\w$]*)
  | (?P<op>==|!=|>=|<=|&&|\|\||=>|[<>!+\-*/%().,\[\]{}:?])
''', re.VERBOSE)
_ESC = {'n': '\n', 't': '\t', 'r': '\r', '\\': '\\', '"': '"', "'": "'", '/': '/', '0': '\0'}


def _unescape(s):
    return re.sub(r'\\(u[0-9a-fA-F]{4}|.)', lambda m: chr(int(m.group(1)[1:], 16)) if m.group(1)[0] == 'u' and len(m.group(1)) == 5 else _ESC.get(m.group(1), m.group(1)), s)


def tokenize(src):
    out, i = [], 0
    while i < len(src):
        # A regex literal where an operand may start
        if src[i] == '/' and (not out or out[-1][0] == 'op' and out[-1][1] not in (')', ']')):
            m = re.match(r'/((?:[^/\\\n]|\\.)+)/([gimsuy]*)', src[i:])
            if m:
                out.append(('re', (m.group(1), m.group(2))))
                i += m.end()
                continue
        m = _TOKEN.match(src, i)
        if not m:
            raise ExprError(f'cannot read {src[i:i + 12]!r}')
        i = m.end()
        kind = m.lastgroup
        if kind == 'ws':
            continue
        text = m.group(kind)
        if kind == 'num':
            out.append(('num', float(text) if ('.' in text or 'e' in text.lower()) else int(text)))
        elif kind == 'str':
            out.append(('str', _unescape(text[1:-1])))
        else:
            out.append((kind, text))
    out.append(('end', None))
    return out


class _Parser:
    BINARY = [('||',), ('&&',), ('==', '!='), ('<', '>', '<=', '>='), ('+', '-'), ('*', '/', '%')]

    def __init__(self, src):
        self.toks, self.i = tokenize(src), 0

    def peek(self, kind=None, text=None):
        k, t = self.toks[self.i]
        return (kind is None or k == kind) and (text is None or t == text)

    def take(self, text=None):
        k, t = self.toks[self.i]
        if text is not None and t != text:
            raise ExprError(f'expected {text!r}, found {t!r}')
        self.i += 1
        return k, t

    def parse(self):
        node = self.ternary()
        if not self.peek('end'):
            raise ExprError(f'unexpected {self.toks[self.i][1]!r}')
        return node

    def ternary(self):
        cond = self.binary(0)
        if self.peek('op', '?'):
            self.take()
            a = self.ternary()
            self.take(':')
            return ('if', cond, a, self.ternary())
        return cond

    def binary(self, level):
        if level == len(self.BINARY):
            return self.unary()
        left = self.binary(level + 1)
        while self.peek('op') and self.toks[self.i][1] in self.BINARY[level]:
            op = self.take()[1]
            left = ('bin', op, left, self.binary(level + 1))
        return left

    def unary(self):
        if self.peek('op', '!'):
            self.take()
            return ('not', self.unary())
        if self.peek('op', '-'):
            self.take()
            return ('neg', self.unary())
        if self.peek('op', '+'):
            self.take()
            return self.unary()
        return self.postfix(self.primary())

    def args(self):
        self.take('(')
        out = []
        while not self.peek('op', ')'):
            out.append(self.ternary())
            if not self.peek('op', ')'):
                self.take(',')
        self.take(')')
        return out

    def postfix(self, node):
        while True:
            if self.peek('op', '.'):
                self.take()
                k, name = self.take()
                if k != 'id':
                    raise ExprError(f'expected a name after ".", found {name!r}')
                node = ('call', node, name, self.args()) if self.peek('op', '(') else ('get', node, name)
            elif self.peek('op', '['):
                self.take()
                key = self.ternary()
                self.take(']')
                node = ('index', node, key)
            else:
                return node

    def primary(self):
        k, t = self.take()
        if k in ('num', 'str'):
            return ('lit', t)
        if k == 're':
            return ('re', t)
        if k == 'op' and t == '(':
            node = self.ternary()
            self.take(')')
            return node
        if k == 'op' and t == '[':
            items = []
            while not self.peek('op', ']'):
                items.append(self.ternary())
                if not self.peek('op', ']'):
                    self.take(',')
            self.take(']')
            return ('list', items)
        if k == 'id':
            if t in ('true', 'false'):
                return ('lit', t == 'true')
            if t in ('null', 'undefined'):
                return ('lit', None)
            if self.peek('op', '('):
                return ('fn', t, self.args())
            return ('name', t)
        raise ExprError(f'unexpected {t!r}')


_PARSED = {}


def parse_expr(src):
    src = str(src)
    if src not in _PARSED:
        if len(_PARSED) > 5000:
            _PARSED.clear()
        try:
            _PARSED[src] = _Parser(src).parse()
        except ExprError as e:
            _PARSED[src] = ('bad', str(e))
    node = _PARSED[src]
    if node[0] == 'bad':
        raise ExprError(f'{node[1]} in {src!r}')
    return node


# ── a file, as the expressions see it ─────────────────────────────────────────────────────────────────────────
class File:
    __slots__ = ('rel', 'src', '_cache')

    def __init__(self, rel, src):
        self.rel, self.src, self._cache = rel, src, {}

    @property
    def name(self):
        return self.rel.rsplit('/', 1)[-1]

    def get(self, field):
        if field in self._cache:
            return self._cache[field]
        name = self.name
        if field == 'name':
            v = name
        elif field == 'basename':
            v = name.rsplit('.', 1)[0] if '.' in name.lstrip('.') else name
        elif field == 'path':
            v = self.rel
        elif field == 'folder':
            v = self.rel.rsplit('/', 1)[0] if '/' in self.rel else ''
        elif field == 'ext':
            v = name.rsplit('.', 1)[1] if '.' in name.lstrip('.') else ''
        elif field == 'size':
            v = self.src.stat(self.rel)[0]
        elif field in ('mtime', 'ctime'):
            s = self.src.stat(self.rel)[1 if field == 'mtime' else 2]
            v = Date(_dt.datetime.fromtimestamp(s)) if s else None
        elif field == 'properties':
            v = {k: typed(x, self.src, self.rel) for k, x in self.src.props(self.rel).items()}
        elif field == 'tags':
            v = ['#' + t for t in self.src.tags(self.rel)]
        elif field == 'links':
            v = [Link(t, None, self.src.resolve(t, self.rel)) for t in self.src.links(self.rel)]
        elif field == 'embeds':
            v = [Link(t, None, self.src.resolve(t, self.rel)) for t in self.src.embeds(self.rel)]
        elif field == 'backlinks':
            v = [File(r, self.src) for r in self.src.backlinks(self.rel)]
        elif field == 'file':
            v = self
        else:
            raise Unsupported(f'file.{field}')
        self._cache[field] = v
        return v

    def note(self, key):
        props = self.src.props(self.rel)
        return typed(props.get(key), self.src, self.rel) if key in props else None


def typed(v, src, rel):
    """A frontmatter value as Obsidian reads it: `[[x]]` a link, `2026-11-14` a date; lists item by item."""
    if isinstance(v, list):
        return [typed(x, src, rel) for x in v]
    if isinstance(v, str):
        s = v.strip()
        m = _WIKI.match(s)
        if m:
            return Link(m.group(1).strip(), (m.group(2) or '').strip() or None, src.resolve(m.group(1).strip(), rel))
        if _DATE.match(s):
            return parse_date(s) or v
    if isinstance(v, (_dt.date, _dt.datetime)):
        return Date(v if isinstance(v, _dt.datetime) else _dt.datetime(v.year, v.month, v.day), isinstance(v, _dt.datetime))
    return v


class _Lambda:
    """A list method's argument: an expression over `value`, `index` (and `acc`)."""

    def __init__(self, node, ctx):
        self.node, self.ctx = node, ctx

    def __call__(self, **names):
        return self.ctx.child(names).eval(self.node)


class Context:
    """What an expression of one row sees: the row's file, `this`, the base's formulas, and names a lambda binds."""

    def __init__(self, base, file, this=None, names=None):
        self.base, self.file, self.this, self.names = base, file, this, names or {}
        self.computing = set() if names is None else None
        self.spent = [0]  # what this row's expressions have built (ROW_BUDGET): shared with its lambdas and formulas

    def child(self, names):
        c = Context(self.base, self.file, self.this, {**self.names, **names})
        c.computing, c.spent = self.computing, self.spent
        return c

    # names
    def name(self, n):
        if n in self.names:
            return self.names[n]
        if n == 'file':
            return self.file
        if n == 'note':
            return _Note(self.file)
        if n == 'formula':
            return _Formulas(self)
        if n == 'this':
            return _This(self.this)
        return self.file.note(n)  # a bare name is a note property

    def formula(self, name):
        src = self.base.formulas.get(name)
        if src is None:
            raise ExprError(f'no formula named {name!r}')
        cache = self.base.formula_cache.setdefault(self.file.rel, {})
        if name in cache:
            return cache[name]
        computing = self.computing if self.computing is not None else set()
        if name in computing:
            raise ExprError(f'formula {name!r} refers to itself')
        computing.add(name)
        try:
            inner = Context(self.base, self.file, self.this)
            inner.computing, inner.spent = computing, self.spent
            v = inner.eval(parse_expr(src))  # Context.eval: this module's own interpreter, never Python's eval
        finally:
            computing.discard(name)
        cache[name] = v
        return v

    def eval(self, node):
        deadline = getattr(self.base, 'deadline', None)
        if deadline is not None and time.monotonic() > deadline:
            raise ExprError(f'this view takes more than {TIME_BUDGET:g} s to work out')
        v = _sized(self._eval(node))
        if isinstance(v, (str, list)):
            self.spent[0] += len(v)
            if self.spent[0] > ROW_BUDGET:
                raise ExprError(f'this row builds more than {ROW_BUDGET} characters and items')
        return v

    def _eval(self, node):
        op = node[0]
        if op == 'lit':
            return node[1]
        if op == 're':
            return Regex(*node[1])
        if op == 'list':
            return [self.eval(x) for x in node[1]]
        if op == 'name':
            return self.name(node[1])
        if op == 'not':
            return not truthy(self.eval(node[1]))
        if op == 'neg':
            v = self.eval(node[1])
            return Duration(-v.months, -v.ms) if isinstance(v, Duration) else -to_number(v)
        if op == 'if':
            return self.eval(node[2]) if truthy(self.eval(node[1])) else self.eval(node[3])
        if op == 'bin':
            return self.binary(node[1], node[2], node[3])
        if op == 'get':
            return self.member(self.eval(node[1]), node[2])
        if op == 'index':
            target, key = self.eval(node[1]), self.eval(node[2])
            if isinstance(target, list):
                i = int(to_number(key))
                return target[i] if -len(target) <= i < len(target) else None
            if isinstance(key, str):
                return self.member(target, key)
            return None
        if op == 'fn':
            return self.function(node[1], node[2])
        if op == 'call':
            return self.method(node[1], node[2], node[3])
        raise ExprError(f'cannot evaluate {op}')

    def binary(self, op, l, r):
        if op == '&&':
            a = self.eval(l)
            return self.eval(r) if truthy(a) else a
        if op == '||':
            a = self.eval(l)
            return a if truthy(a) else self.eval(r)
        a, b = self.eval(l), self.eval(r)
        if op == '==':
            return equal(a, b)
        if op == '!=':
            return not equal(a, b)
        if op in ('<', '>', '<=', '>='):
            if a is None or b is None:
                return False
            try:
                c = compare(a, b)
            except ExprError:
                return False
            return {'<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0}[op]
        if op == '+':
            if isinstance(a, Date) and (isinstance(b, (Duration, str))):
                d = b if isinstance(b, Duration) else parse_duration(b)
                if d is None:
                    raise ExprError(f'not a duration: {b!r}')
                return _shift(a, d)
            if isinstance(a, Duration) and isinstance(b, Duration):
                return Duration(a.months + b.months, a.ms + b.ms)
            if isinstance(a, list) and isinstance(b, list):
                return _sized(a, len(a) + len(b)) + b
            if isinstance(a, str) or isinstance(b, str) or isinstance(a, (Link, File)) or isinstance(b, (Link, File)):
                ta, tb = to_text(a), to_text(b)
                return _sized(ta, len(ta) + len(tb)) + tb
            return to_number(a) + to_number(b)
        if op == '-':
            if isinstance(a, Date):
                if isinstance(b, Date) or (isinstance(b, str) and parse_date(b)):
                    db = b if isinstance(b, Date) else parse_date(b)
                    return Duration(0, (a.dt - db.dt).total_seconds() * 1000)
                d = b if isinstance(b, Duration) else parse_duration(b) if isinstance(b, str) else None
                if d is None:
                    raise ExprError(f'cannot take {to_text(b)!r} from a date')
                return _shift(a, d, -1)
            if isinstance(a, Duration) and isinstance(b, Duration):
                return Duration(a.months - b.months, a.ms - b.ms)
            return to_number(a) - to_number(b)
        if op == '*':
            if isinstance(a, Duration):
                n = to_number(b)
                return Duration(int(a.months * n), a.ms * n)
            return to_number(a) * to_number(b)
        if op in ('/', '%'):
            x, y = to_number(a), to_number(b)
            if y == 0:
                return float('nan') if x == 0 else math.copysign(float('inf'), x) if op == '/' else float('nan')
            return x / y if op == '/' else math.fmod(x, y)
        raise ExprError(f'unknown operator {op}')

    # ── functions ──
    def function(self, name, arg_nodes):
        if name == 'if':
            if not 2 <= len(arg_nodes) <= 3:
                raise ExprError('if() takes a condition, a value and an optional other value')
            if truthy(self.eval(arg_nodes[0])):
                return self.eval(arg_nodes[1])
            return self.eval(arg_nodes[2]) if len(arg_nodes) == 3 else None
        args = [self.eval(a) for a in arg_nodes]
        if name == 'now':
            return Date(_dt.datetime.now().replace(microsecond=0))
        if name == 'today':
            return Date(_dt.datetime.combine(_dt.date.today(), _dt.time()), False)
        if name == 'date':
            v = args[0] if args else None
            if isinstance(v, Date):
                return v
            d = parse_date(to_text(v))
            if d is None:
                raise ExprError(f'not a date: {to_text(v)!r}')
            return d
        if name == 'duration':
            d = parse_duration(to_text(args[0] if args else ''))
            if d is None:
                raise ExprError(f'not a duration: {to_text(args[0] if args else "")!r}')
            return d
        if name == 'number':
            return to_number(args[0] if args else None)
        if name == 'list':
            v = args[0] if args else None
            return v if isinstance(v, list) else [] if v is None else [v]
        if name in ('max', 'min'):
            nums = [to_number(a) for a in (args[0] if len(args) == 1 and isinstance(args[0], list) else args) if a is not None]
            return (max if name == 'max' else min)(nums) if nums else None
        if name == 'link':
            v = args[0] if args else None
            if isinstance(v, File):
                return Link(_stem(v.rel), to_text(args[1]) if len(args) > 1 else None, v.rel)
            t = to_text(v)
            m = _WIKI.match(t.strip())
            t = m.group(1).strip() if m else t
            if re.match(r'^[a-z][\w+.-]*://', t):
                return t
            return Link(t, to_text(args[1]) if len(args) > 1 else None, self.base.src.resolve(t, self.file.rel))
        if name == 'file':
            v = args[0] if args else None
            if isinstance(v, File):
                return v
            rel = v.path if isinstance(v, Link) else self.base.src.resolve(to_text(v), self.file.rel)
            return File(rel, self.base.src) if rel else None
        if name == 'escapeHTML':
            return to_text(args[0] if args else '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
        raise Unsupported(f'{name}()')

    # ── members and methods ──
    def member(self, v, name):
        if isinstance(v, (_Note, _Formulas, _This)):
            return v.get(name)
        if isinstance(v, File):
            return v.get(name)
        if isinstance(v, Link) and name == 'path':
            return v.path
        if isinstance(v, (str, list)) and name == 'length':
            return len(v)
        if isinstance(v, Date):
            dt = v.dt
            fields = {'year': dt.year, 'month': dt.month, 'day': dt.day, 'hour': dt.hour, 'minute': dt.minute,
                      'second': dt.second, 'millisecond': dt.microsecond // 1000}
            if name in fields:
                return fields[name]
        if isinstance(v, dict):
            return v.get(name)
        if v is None:
            return None
        raise ExprError(f'{to_text(v)!r} has no {name}')

    def method(self, target_node, name, arg_nodes):
        target = self.eval(target_node)
        if isinstance(target, list) and name in ('filter', 'map', 'reduce'):
            if not arg_nodes:
                raise ExprError(f'{name}() needs an expression')
            fn = _Lambda(arg_nodes[0], self)
            if name == 'filter':
                return [x for i, x in enumerate(target) if truthy(fn(value=x, index=i))]
            if name == 'map':
                return [fn(value=x, index=i) for i, x in enumerate(target)]
            acc = self.eval(arg_nodes[1]) if len(arg_nodes) > 1 else None
            for i, x in enumerate(target):
                acc = fn(value=x, index=i, acc=acc)
            return acc
        args = [self.eval(a) for a in arg_nodes]
        return call_method(target, name, args, self)


class _Note:
    def __init__(self, file):
        self.file = file

    def get(self, key):
        return self.file.note(key)


class _Formulas:
    def __init__(self, ctx):
        self.ctx = ctx

    def get(self, name):
        return self.ctx.formula(name)


class _This:
    def __init__(self, file):
        self.file = file

    def get(self, key):
        if self.file is None:
            return None
        if key == 'file':
            return self.file
        if key == 'note':
            return _Note(self.file)
        return self.file.note(key)


def _contains(target, x):
    if isinstance(target, str):
        return to_text(x) in target
    if isinstance(target, list):
        return any(equal(y, x) for y in target)
    return False


def call_method(v, name, args, ctx):
    a0 = args[0] if args else None
    # any value
    if name == 'isTruthy':
        return truthy(v)
    if name == 'toString':
        return to_text(v)
    if name == 'isType':
        t = to_text(a0).lower()
        kinds = {'null': v is None, 'string': isinstance(v, str), 'number': isinstance(v, (int, float)) and not isinstance(v, bool),
                 'boolean': isinstance(v, bool), 'date': isinstance(v, Date), 'duration': isinstance(v, Duration),
                 'list': isinstance(v, list), 'object': isinstance(v, dict), 'link': isinstance(v, Link), 'file': isinstance(v, File)}
        return kinds.get(t, False)
    if name == 'isEmpty':
        return False if isinstance(v, (Date, File)) else is_empty(v)
    if isinstance(v, File):
        if name == 'hasTag':
            tags = ctx.base.src.tags(v.rel)
            wanted = [to_text(x).lstrip('#').lower() for x in args]
            return any(t.lower() == w or t.lower().startswith(w + '/') for t in tags for w in wanted)
        if name == 'inFolder':
            folder = to_text(a0).strip('/')
            return folder == '' or v.rel.startswith(folder + '/')
        if name == 'hasProperty':
            return to_text(a0) in ctx.base.src.props(v.rel)
        if name == 'hasLink':
            if isinstance(a0, File):
                want = a0.rel
            elif isinstance(a0, Link):
                want = a0.path
            else:
                want = ctx.base.src.resolve(to_text(a0), v.rel)
            return bool(want) and any(ctx.base.src.resolve(t, v.rel) == want for t in ctx.base.src.links(v.rel))
        if name == 'asLink':
            return Link(_stem(v.rel), to_text(a0) if args else None, v.rel)
        raise Unsupported(f'file.{name}()')
    if isinstance(v, Link):
        if name == 'asFile':
            return File(v.path, ctx.base.src) if v.path else None
        if name == 'linksTo':
            target = a0.rel if isinstance(a0, File) else a0.path if isinstance(a0, Link) else ctx.base.src.resolve(to_text(a0), ctx.file.rel)
            return bool(v.path and target) and any(ctx.base.src.resolve(t, v.path) == target for t in ctx.base.src.links(v.path))
        v = v.text()  # anything else: as its text
    if isinstance(v, Regex):
        if name == 'matches':
            return bool(v.re.search(_regex_text(to_text(a0))))
        raise Unsupported(f'regex.{name}()')
    if isinstance(v, Date):
        if name == 'date':
            return Date(v.dt.replace(hour=0, minute=0, second=0, microsecond=0), False)
        if name == 'format':
            return _moment(v.dt, to_text(a0) if args else 'YYYY-MM-DD')
        if name == 'time':
            return v.dt.strftime('%H:%M:%S')
        if name == 'relative':
            return _relative(v.dt)
        raise Unsupported(f'date.{name}()')
    if isinstance(v, Duration):
        raise Unsupported(f'duration.{name}()')
    if isinstance(v, str):
        if name == 'contains':
            return to_text(a0) in v
        if name == 'containsAll':
            return all(to_text(x) in v for x in args)
        if name == 'containsAny':
            return any(to_text(x) in v for x in args)
        if name == 'startsWith':
            return v.startswith(to_text(a0))
        if name == 'endsWith':
            return v.endswith(to_text(a0))
        if name == 'lower':
            return v.lower()
        if name == 'upper':
            return v.upper()
        if name == 'title':
            return re.sub(r'\b(\w)', lambda m: m.group(1).upper(), v)
        if name == 'trim':
            return v.strip()
        if name == 'reverse':
            return v[::-1]
        if name == 'repeat':
            n = _int_arg(a0, 0, TEXT_MAX)
            if len(v) * n > TEXT_MAX:
                raise ExprError(f'repeat() past {TEXT_MAX} characters')
            return v * n
        if name == 'slice':
            return _slice(v, args)
        if name == 'split':
            parts = a0.re.split(_regex_text(v)) if isinstance(a0, Regex) else v.split(to_text(a0)) if to_text(a0) else list(v)
            return parts[:int(to_number(args[1]))] if len(args) > 1 else parts
        if name == 'replace':
            repl = re.sub(r'\$(\d)', r'\\\1', to_text(args[1] if len(args) > 1 else ''))
            if isinstance(a0, Regex):
                built = [len(v)]

                def one(m):  # every replacement counts towards TEXT_MAX before the text is built
                    r = m.expand(repl)
                    built[0] += len(r)
                    _sized('', built[0])
                    return r
                return a0.re.sub(one, _regex_text(v), count=0 if a0.glob else 1)
            return v.replace(to_text(a0), to_text(args[1] if len(args) > 1 else ''), 1)
        if name in ('toFixed', 'round', 'abs', 'ceil', 'floor'):
            try:
                return call_method(float(v), name, args, ctx)
            except ValueError:
                raise ExprError(f'not a number: {v!r}')
        raise Unsupported(f'string.{name}()')
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if name == 'abs':
            return abs(v)
        if name == 'ceil':
            return math.ceil(v)
        if name == 'floor':
            return math.floor(v)
        if name == 'round':
            digits = _int_arg(a0, -DIGITS_MAX, DIGITS_MAX) if args else 0
            q = 10 ** digits
            return math.floor(v * q + 0.5) / q if digits else math.floor(v + 0.5)
        if name == 'toFixed':
            return f'{v:.{_int_arg(a0, 0, DIGITS_MAX) if args else 0}f}'
        raise Unsupported(f'number.{name}()')
    if isinstance(v, list):
        if name == 'contains':
            return _contains(v, a0)
        if name == 'containsAll':
            return all(_contains(v, x) for x in args)
        if name == 'containsAny':
            return any(_contains(v, x) for x in args)
        if name == 'join':
            sep, texts = (to_text(a0) if args else ','), [to_text(x) for x in v]
            _sized('', sum(map(len, texts)) + len(sep) * max(0, len(texts) - 1))
            return sep.join(texts)
        if name == 'reverse':
            return v[::-1]
        if name == 'sort':
            return sorted(v, key=sort_key)
        if name == 'unique':
            out = []
            for x in v:
                if not any(equal(x, y) for y in out):
                    out.append(x)
            return out
        if name == 'flat':
            _sized([], sum(len(x) if isinstance(x, list) else 1 for x in v))
            return [y for x in v for y in (x if isinstance(x, list) else [x])]
        if name == 'slice':
            return _slice(v, args)
        raise Unsupported(f'list.{name}()')
    if isinstance(v, dict):
        if name == 'keys':
            return list(v)
        if name == 'values':
            return list(v.values())
        raise Unsupported(f'object.{name}()')
    if v is None:
        return None  # a method of nothing (a note without the property): nothing, as Obsidian shows an empty cell
    if isinstance(v, bool):
        raise ExprError(f'a true/false has no {name}()')
    raise Unsupported(f'{name}()')


def _slice(v, args):
    start = int(to_number(args[0])) if args else 0
    end = int(to_number(args[1])) if len(args) > 1 else None
    return v[start:end]


_MOMENT = [('YYYY', '%Y'), ('YY', '%y'), ('MMMM', '%B'), ('MMM', '%b'), ('MM', '%m'), ('DD', '%d'), ('dddd', '%A'),
           ('ddd', '%a'), ('HH', '%H'), ('hh', '%I'), ('mm', '%M'), ('ss', '%S'), ('A', '%p')]


def _moment(dt, fmt):
    """Moment.js's common tokens (YYYY MM DD HH mm ss, MMM, dddd, M, D…); text in [brackets] kept as it is."""
    out, i = [], 0
    while i < len(fmt):
        if fmt[i] == '[':
            j = fmt.find(']', i)
            j = len(fmt) if j < 0 else j
            out.append(fmt[i + 1:j])
            i = j + 1
            continue
        for tok, code in _MOMENT:
            if fmt.startswith(tok, i):
                out.append(dt.strftime(code))
                i += len(tok)
                break
        else:
            if fmt[i] == 'M':
                out.append(str(dt.month))
            elif fmt[i] == 'D':
                out.append(str(dt.day))
            elif fmt[i] == 'H':
                out.append(str(dt.hour))
            else:
                out.append(fmt[i])
            i += 1
    return ''.join(out)


def _relative(dt):
    secs = (_dt.datetime.now() - dt).total_seconds()
    ago = secs >= 0
    s = abs(secs)
    for name, size in (('year', 365 * 86400), ('month', 30 * 86400), ('day', 86400), ('hour', 3600), ('minute', 60)):
        if s >= size:
            n = int(s // size)
            words = f"{n} {name}{'' if n == 1 else 's'}"
            return f'{words} ago' if ago else f'in {words}'
    return 'just now'


def sort_key(v):
    """A key that orders mixed values as Obsidian does: nothing last, numbers and dates by value, text case aside."""
    if v is None or v == '' or v == []:
        return (3, 0, '')
    if isinstance(v, bool):
        return (0, int(v), '')
    if isinstance(v, (int, float)):
        return (0, v, '')
    if isinstance(v, Date):
        return (0, v.dt.timestamp(), '')
    if isinstance(v, Duration):
        return (0, v.total(), '')
    if isinstance(v, str) and parse_date(v):
        return (0, parse_date(v).dt.timestamp(), '')
    return (1, 0, to_text(v).casefold())


# ── a base ────────────────────────────────────────────────────────────────────────────────────────────────────
VIEW_TYPES = ('table', 'cards', 'list')
SUMMARIES = ('Average', 'Min', 'Max', 'Sum', 'Range', 'Median', 'Stddev', 'Earliest', 'Latest', 'Checked', 'Unchecked',
             'Empty', 'Filled', 'Unique')
ROWS_MAX = 5000


_NAMESPACES = {'file', 'note', 'formula', 'this', 'value', 'index', 'acc'}


def describe_empty(error=None):
    """describe()'s shape with nothing read from a base — what the vault's guide says about one it cannot read
    (tm/store._bases_info). The shape lives here only, so a new bucket reaches every caller."""
    return {'views': [], 'properties': {}, 'folders': [], 'tags': [],
            'excludes': {'folders': [], 'tags': [], 'properties': []},
            'group_by': [], 'shows': [], 'error': error}


def describe(data):
    """What decides which notes a base lists and what it shows, read from its YAML (no vault needed), for the vault's
    guide (tm/agentsmd.py): {views, properties: {name: [values it is compared with]}, folders, tags,
    excludes: {folders, tags, properties}, group_by, shows, error}. A filter it cannot read is skipped: this says what a
    note needs, it does not judge one."""
    out = describe_empty()
    admits = [True]  # the base's own filters admit a note; a view's only choose among those (no values, no folders)
    # Inside a negated expression (`!file.inFolder("x")`, a `not:` filter group): what it names keeps a note OUT. The
    # polarity lives above the predicate, so it is carried down the walk — reading the leaf alone says the opposite.
    denies = [False]

    def add(seq, v):
        if v not in seq:
            seq.append(v)

    def prop(name, value=None):
        if not admits[0]:
            if name not in out['properties'] and name not in out['shows']:
                out['shows'].append(name)
            return
        got = out['properties'].setdefault(name, [])
        if value is not None and not denies[0] and value not in got:
            got.append(value)

    def lit(node):
        return node[1] if node and node[0] == 'lit' and isinstance(node[1], (str, int, float, bool)) else None

    def named(node):
        """The note property a node names (`status`, `note.status`, `note["a b"]`), or None."""
        if node[0] == 'name' and node[1] not in _NAMESPACES:
            return node[1]
        if node[0] == 'get' and node[1] == ('name', 'note'):
            return node[2]
        if node[0] == 'index' and node[1] == ('name', 'note') and lit(node[2]) is not None:
            return str(lit(node[2]))
        return None

    def walk(node):
        if not isinstance(node, tuple) or not node:
            return
        if node[0] == 'not':
            denies[0] = not denies[0]
            [walk(part) for part in node[1:] if isinstance(part, tuple)]
            denies[0] = not denies[0]
            return
        if node[0] == 'call' and node[1] == ('name', 'file'):
            args = [lit(a) for a in node[3]]
            keeps = out['excludes'] if denies[0] else out  # `!file.inFolder("x")` is not a way in, it is a way out
            if node[2] == 'hasProperty' and not denies[0]:
                [prop(str(a)) for a in args if a is not None]
            elif not admits[0]:
                pass
            elif node[2] == 'hasProperty':
                [add(out['excludes']['properties'], str(a)) for a in args if a is not None]
            elif node[2] == 'inFolder':
                [add(keeps['folders'], str(a)) for a in args if a is not None]
            elif node[2] == 'hasTag':
                [add(keeps['tags'], str(a)) for a in args if a is not None]
        if node[0] == 'bin' and node[1] in ('==', '!=', '<', '>', '<=', '>='):
            for a, b in ((node[2], node[3]), (node[3], node[2])):
                if named(a) is not None:
                    prop(named(a), lit(b) if node[1] == '==' else None)
        if node[0] == 'call' and named(node[1]) is not None:  # category.contains("AI")
            prop(named(node[1]), lit(node[3][0]) if node[2] in ('contains', 'containsAny') and node[3] else None)
        n = named(node)
        if n is not None:
            prop(n)
        for part in node[1:]:
            if isinstance(part, tuple):
                walk(part)
            elif isinstance(part, list):
                [walk(x) for x in part if isinstance(x, tuple)]

    def filters(f):
        if isinstance(f, str):
            try:
                walk(parse_expr(f))
            except ExprError:
                pass
        elif isinstance(f, list):
            [filters(x) for x in f]
        elif isinstance(f, dict):
            for key, value in f.items():
                if str(key).strip().lower() == 'not':  # "none of the following are true" (see Base.matches)
                    denies[0] = not denies[0]
                    filters(value)
                    denies[0] = not denies[0]
                else:
                    filters(value)

    if not isinstance(data, dict):
        out['error'] = 'not a base'
        return out
    filters(data.get('filters'))
    for v in data.get('views') if isinstance(data.get('views'), list) else []:
        if not isinstance(v, dict):
            continue
        add(out['views'], str(v.get('name') or v.get('type') or 'Table'))
        admits[0] = False
        filters(v.get('filters'))
        admits[0] = True
        g = v.get('groupBy')
        g = g.get('property') if isinstance(g, dict) else g
        if g:
            add(out['group_by'], prop_id(g)[5:] if prop_id(g).startswith('note.') else str(g))
        for c in v.get('order') if isinstance(v.get('order'), list) else []:
            pid = prop_id(c)
            if pid.startswith('note.') and pid[5:] not in out['properties']:
                add(out['shows'], pid[5:])
    return out


def prop_id(name):
    """`status` and `note.status` are one property; `file.name` and `formula.x` keep their namespace."""
    name = str(name).strip()
    return name if name.startswith(('file.', 'formula.', 'note.')) else f'note.{name}'


def prop_label(pid, properties):
    for key in (pid, pid[5:] if pid.startswith('note.') else None):
        meta = properties.get(key) if key else None
        if isinstance(meta, dict) and meta.get('displayName'):
            return str(meta['displayName'])
    if pid.startswith('note.'):
        return pid[5:]
    if pid.startswith('formula.'):
        return pid[8:]
    return 'file ' + pid[5:] if pid != 'file.name' else 'file name'


class Base:
    def __init__(self, data, src):
        if not isinstance(data, dict):
            raise BaseError('a base is a map of filters, formulas, properties and views')
        self.data, self.src = data, src
        self.deadline = None  # run() sets it: past it every expression stops
        self.formulas = {str(k): str(v) for k, v in (data.get('formulas') or {}).items()} if isinstance(data.get('formulas') or {}, dict) else {}
        self.properties = data.get('properties') if isinstance(data.get('properties'), dict) else {}
        views = data.get('views')
        if views is None:
            views = [{'type': 'table', 'name': 'Table'}]
        if not isinstance(views, list):
            raise BaseError('views is a list')
        self.views = [v if isinstance(v, dict) else {} for v in views] or [{'type': 'table', 'name': 'Table'}]
        self.formula_cache = {}

    def view_names(self):
        return [{'name': str(v.get('name') or f'View {i + 1}'), 'type': str(v.get('type') or 'table')} for i, v in enumerate(self.views)]

    def pick(self, name):
        names = [v['name'] for v in self.view_names()]
        if name is None or name == '':
            return 0
        for i, n in enumerate(names):
            if n == name or n.lower() == str(name).lower():
                return i
        return None

    def matches(self, f, ctx):
        """A filter (a statement or an and/or/not of them) for one row."""
        if f is None:
            return True
        if isinstance(f, bool):
            return f
        if isinstance(f, str):
            return truthy(ctx.eval(parse_expr(f)))
        if isinstance(f, list):
            return all(self.matches(x, ctx) for x in f)
        if isinstance(f, dict):
            if len(f) != 1:
                raise BaseError('a filter group has one of and / or / not')
            (op, items), = f.items()
            items = items if isinstance(items, list) else [items]
            if op == 'and':
                return all(self.matches(x, ctx) for x in items)
            if op == 'or':
                return any(self.matches(x, ctx) for x in items)
            if op == 'not':
                return not any(self.matches(x, ctx) for x in items)  # "none of the following are true"
            raise BaseError(f'unknown filter group {op!r}')
        raise BaseError(f'a filter cannot be {type(f).__name__}')

    def cell(self, pid, ctx):
        if pid.startswith('file.'):
            return ctx.file.get(pid[5:])
        if pid.startswith('formula.'):
            return ctx.formula(pid[8:])
        return ctx.file.note(pid[5:])

    def run(self, view_index=0, this=None):
        """The rows of one view. → {columns, rows, groups, summaries, total, unsupported, errors, …} (see Store.base).
        Past TIME_BUDGET every expression stops (ExprError): the view shows that error and no rows."""
        self.deadline = time.monotonic() + TIME_BUDGET
        try:
            return self._run(view_index, this)
        except ExprError as e:
            view = self.views[view_index]
            return {'view': view_index, 'type': str(view.get('type') or 'table'), 'columns': [], 'rows': [],
                    'groups': None, 'summaries': None, 'total': 0, 'limit': None, 'unsupported': [],
                    'errors': [str(e)], 'image': None}
        finally:
            self.deadline = None

    def _run(self, view_index, this):
        view = self.views[view_index]
        vtype = str(view.get('type') or 'table')
        unsupported, errors = [], []

        def note_unsupported(what):
            if what not in unsupported:
                unsupported.append(what)

        out = {'view': view_index, 'type': vtype, 'columns': [], 'rows': [], 'groups': None, 'summaries': None, 'total': 0,
               'limit': None, 'unsupported': unsupported, 'errors': errors, 'image': None}
        if vtype not in VIEW_TYPES:
            note_unsupported(f'a {vtype} view')
            return out
        order = view.get('order')
        order = [prop_id(x) for x in order] if isinstance(order, list) and order else ['file.name']
        out['columns'] = [{'id': p, 'label': prop_label(p, self.properties), 'kind': p.split('.', 1)[0]} for p in order]
        this_file = File(this, self.src) if this else None
        files = [File(rel, self.src) for rel in self.src.files()]
        rows = []
        filters = [f for f in (self.data.get('filters'), view.get('filters')) if f is not None]
        for f in files:
            ctx = Context(self, f, this_file)
            try:
                if all(self.matches(x, ctx) for x in filters):
                    rows.append(ctx)
            except Unsupported as e:
                note_unsupported(str(e))
                out['rows'] = []
                return out
            except (ExprError, BaseError) as e:
                errors.append(str(e)) if str(e) not in errors else None
                return out
        # sort: the view's `sort` ({property, direction} pairs), else by file name
        sort = view.get('sort')
        sort = [sort] if isinstance(sort, (str, dict)) else sort if isinstance(sort, list) else []
        keys = []
        for s in sort:
            if isinstance(s, str):
                keys.append((prop_id(s), False))
            elif isinstance(s, dict) and s.get('property'):
                keys.append((prop_id(s['property']), str(s.get('direction') or 'ASC').upper() == 'DESC'))

        def value(ctx, pid):
            try:
                return self.cell(pid, ctx)
            except Unsupported as e:
                note_unsupported(str(e))
            except ExprError as e:
                if str(e) not in errors:
                    errors.append(str(e))
            return None

        rows.sort(key=lambda c: c.file.rel.casefold())
        for pid, desc in reversed(keys):
            filled = [c for c in rows if sort_key(value(c, pid))[0] != 3]
            empty = [c for c in rows if sort_key(value(c, pid))[0] == 3]
            filled.sort(key=lambda c: sort_key(value(c, pid)), reverse=desc)
            rows = filled + empty  # nothing last either way
        out['total'] = len(rows)
        limit = view.get('limit')
        if isinstance(limit, (int, float)) and not isinstance(limit, bool) and limit > 0:
            out['limit'] = int(limit)
            rows = rows[:int(limit)]
        rows = rows[:ROWS_MAX]
        image = view.get('image')
        image_id = prop_id(image) if isinstance(image, str) and image.strip() else None
        out['image'] = image_id
        for ctx in rows:
            cells = [to_json(value(ctx, p)) for p in order]
            row = {'path': ctx.file.rel, 'cells': cells}
            if image_id:
                row['image'] = to_json(value(ctx, image_id))
            out['rows'].append(row)
        # groups
        group = view.get('groupBy')
        if isinstance(group, str):
            group = {'property': group}
        if isinstance(group, dict) and group.get('property'):
            gid, desc = prop_id(group['property']), str(group.get('direction') or 'ASC').upper() == 'DESC'
            buckets = {}
            for i, ctx in enumerate(rows):
                v = value(ctx, gid)
                k = None if is_empty(v) else to_text(v)
                b = buckets.setdefault(k, {'value': to_json(v) if k is not None else None, 'label': k, 'rows': [], 'sort': sort_key(v)})
                b['rows'].append(i)
            named = sorted((b for k, b in buckets.items() if k is not None), key=lambda b: b['sort'], reverse=desc)
            groups = named + ([buckets[None]] if None in buckets else [])
            go = view.get('groupOrder')
            if isinstance(go, list):
                want = [None if x is None else to_text(typed(x, self.src, '')) for x in go]
                groups = [b for w in want for b in groups if b['label'] == w]
            for b in groups:
                b.pop('sort')
            out['groups'] = groups
            out['group_by'] = {'id': gid, 'label': prop_label(gid, self.properties)}
        # summaries
        sums = view.get('summaries')
        if isinstance(sums, dict) and sums:
            custom = self.data.get('summaries') if isinstance(self.data.get('summaries'), dict) else {}
            table = []
            for p in order:
                name = sums.get(p) or (sums.get(p[5:]) if p.startswith('note.') else None)
                if not name:
                    table.append(None)
                    continue
                name = str(name)
                if name in custom or name not in SUMMARIES:
                    note_unsupported(f'the summary {name}')
                    table.append(None)
                    continue
                table.append({'name': name, 'value': to_json(summarize(name, [value(c, p) for c in rows]))})
            out['summaries'] = table
        return out


def summarize(name, values):
    filled = [v for v in values if not is_empty(v)]
    if name == 'Empty':
        return len(values) - len(filled)
    if name == 'Filled':
        return len(filled)
    if name == 'Unique':
        return len({to_text(v) for v in filled})
    if name == 'Checked':
        return sum(1 for v in values if v is True)
    if name == 'Unchecked':
        return sum(1 for v in values if v is not True)
    if name in ('Earliest', 'Latest'):
        dates = [d for d in (_as_date(v) for v in filled) if d]
        if not dates:
            return None
        return (min if name == 'Earliest' else max)(dates, key=lambda d: d.dt)
    nums = []
    for v in filled:
        try:
            nums.append(to_number(v))
        except ExprError:
            pass
    if name == 'Range' and not nums:
        dates = [d for d in (_as_date(v) for v in filled) if d]
        return Duration(0, (max(d.dt for d in dates) - min(d.dt for d in dates)).total_seconds() * 1000) if dates else None
    if not nums:
        return None
    if name == 'Sum':
        return sum(nums)
    if name == 'Average':
        return round(sum(nums) / len(nums), 6)
    if name == 'Min':
        return min(nums)
    if name == 'Max':
        return max(nums)
    if name == 'Range':
        return max(nums) - min(nums)
    if name == 'Median':
        s = sorted(nums)
        n = len(s)
        return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
    if name == 'Stddev':
        mean = sum(nums) / len(nums)
        return round(math.sqrt(sum((x - mean) ** 2 for x in nums) / len(nums)), 6)
    return None


# ── what a note says, for the Source ──────────────────────────────────────────────────────────────────────────
_CODE = re.compile(r'```.*?```|~~~.*?~~~|`[^`\n]*`', re.DOTALL)
_TAG = re.compile(r'(?<![\w/#&])#([A-Za-z0-9_/\-]*[A-Za-z_/\-][A-Za-z0-9_/\-]*)')
_LINK = re.compile(r'(!?)\[\[([^\]\n]+?)\]\]')


def text_facts(text):
    """{tags, links, embeds} of a note's text: its #tags (frontmatter `tags` too), its [[links]] (frontmatter's too) and
    its ![[embeds]] — names as written, before a #heading or |alias."""
    head, body = fm.split(text)
    props = fm.parse(head) if head is not None else {}
    tags = []
    ft = props.get('tags', props.get('tag'))
    for t in (ft if isinstance(ft, list) else re.split(r'[,\s]+', str(ft)) if ft else []):
        t = str(t).strip().lstrip('#')
        if t and t not in tags:
            tags.append(t)
    clean = _CODE.sub(' ', body)
    for m in _TAG.finditer(clean):
        if m.group(1) not in tags:
            tags.append(m.group(1))
    links, embeds = [], []
    for m in _LINK.finditer((head or '') + '\n' + clean):
        target = m.group(2).split('|', 1)[0].split('#', 1)[0].strip()
        if not target:
            continue
        (embeds if m.group(1) else links).append(target)
    return {'tags': tags, 'links': list(dict.fromkeys(links)), 'embeds': list(dict.fromkeys(embeds))}


def resolver(paths):
    """`resolve(target, from_rel)` over the vault's files: a [[target]] as Obsidian finds it — a path (with or without
    .md), else a file of that name (a note's name without .md), the one nearest the linking note when several."""
    by_path, by_name = {}, {}
    for rel in paths:
        low = rel.lower()
        by_path[low] = rel
        if low.endswith('.md'):
            by_path.setdefault(low[:-3], rel)
        name = low.rsplit('/', 1)[-1]
        by_name.setdefault(name, []).append(rel)
        if name.endswith('.md'):
            by_name.setdefault(name[:-3], []).append(rel)

    def resolve(target, from_rel=''):
        t = str(target or '').strip().lstrip('/').lower()
        if not t:
            return None
        if t in by_path:
            return by_path[t]
        hits = by_name.get(t.rsplit('/', 1)[-1])
        if not hits:
            return None
        if '/' in t:
            hits = [h for h in hits if h.lower().endswith('/' + t) or h.lower().endswith('/' + t + '.md')] or hits
        if len(hits) == 1:
            return hits[0]
        base = from_rel.rsplit('/', 1)[0] if '/' in (from_rel or '') else ''
        return sorted(hits, key=lambda h: (not h.startswith(base + '/') if base else False, h.count('/'), h))[0]
    return resolve
