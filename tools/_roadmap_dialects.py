#!/usr/bin/env python3
"""The dialects of the `work/` and `roadmap/` trees of ~/github, and how each maps to a Projects type.

One dialect per source tree. They disagree on almost everything — where the status lives (a folder here, a key
there), whether the id is in the file name, which language the values are in — so each says it for itself and the
importer only walks what a dialect declares. What a dialect cannot decide (a value the vault has no slot for) it
reports, and the owner answers it in the plan.

Read only: nothing here writes.
"""
import os
import re
import sys
from datetime import datetime

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)
from tm import frontmatter as fm  # noqa: E402

# Paths that are never a source, whatever is inside them. The worktrees of the dashboard alone hold 16,989 .md:
# ten times the real corpus, each a full copy of `roadmap/` with the same ids (its own LRN-190).
EXCLUDE_PARTS = ('/.claude/', '/worktrees/', '/_migration/', '/deprecated/', '/node_modules/', '/__pycache__/',
                 '/.git/', '/sample-vault', '/tickets-vault/', '/vault/', '/historico/')
# File names that are documentation, a template or a generated board, never a work item.
NOT_ITEMS = {'TEMPLATE.md', 'BOARD.md', 'README.md', 'strategy.md', 'ritmo.md',
             'board-initiatives.md', 'board-support.md', 'roadmap.md', 'roadmap.strategy.md',
             'CONVENTIONS.md', 'index.md', 'TEMPLATE-architect.md', 'TEMPLATE-express.md',
             'TEMPLATE-error.md', 'TEMPLATE-learning.md'}
# The six state folders a status-folder tree uses, and the Projects status each becomes. `ready_to_prod` is D5.
STATUS_FOLDERS = {'backlog': 'Backlog', 'in_progress': 'InProgress', 'on_hold': 'OnHold',
             'ready_to_prod': 'Review', 'completed': 'Done', 'discarded': 'Discarded'}
# Values the sources write in Spanish, or in their own words, where the vault has an enum.
REGIME = {'estándar': 'standard', 'estandar': 'standard', 'crítico': 'critical', 'critico': 'critical',
          'standard': 'standard', 'critical': 'critical'}
DISPOSITION = {'arreglar': 'fix', 'descartar': 'discard', 'pendiente': 'pending', 'dueño': 'owner',
               'duenio': 'owner', 'fix': 'fix', 'discard': 'discard', 'pending': 'pending', 'owner': 'owner'}
EXECUTOR = {'claude': 'claude', 'codex': 'codex', 'dueño': 'owner', 'owner': 'owner'}
LANE = {'rápido': 'fast', 'rapido': 'fast', 'normal': 'normal', 'completo': 'full',
        'fast': 'fast', 'full': 'full'}
# Four values the sources write that the vault has no slot for. Settled by the owner, 2026-11-21:
# `holds` says the premise holds, which is what `verified` means; a support ticket raised by the
# knowledge-staleness check is `curation`, the instrument it belongs to. The two analysis kinds have no
# equivalent among the vault's eight and are left empty: a label invented here would read as his.
PREMISE = {'holds': 'verified', 'confirmed': 'verified', 'partial': 'reframed',
           'unverified': 'unverified', 'verified': 'verified', 'reframed': 'reframed', 'refuted': 'refuted'}
SUPPORT_ORIGIN = {'knowledge': 'curation', 'manual': 'manual', 'user': 'user', 'judge': 'judge',
                  'auditor': 'auditor', 'gate': 'gate', 'ci': 'ci', 'monitor': 'monitor', 'curation': 'curation'}
# Left empty on purpose, so they raise no question: there is nothing to map them to.
KIND_NO_EQUIVALENT = ('linked-debt-delivery', 'original')
# Template defaults that would read as the source's own claim. The type's template fills these in for a new
# item the owner is about to write; for a migrated one nobody said them, so they are written empty on purpose.
# `analysis.kind: diagnosis` would label 55 analyses; `plan.base` would carry the literal `develop @ <sha>`
# placeholder; `plan.lane: normal` is a real choice 82 plans never made.
BLANK_UNLESS_SAID = {'analysis': ('kind',), 'plan': ('base', 'lane')}
# The dashboard's own drift. Its priorities ran past P3 and slipped into words; its severities and one of its
# error statuses are half in Spanish. Each of these is a translation, not a reading.
PRIORITY = {'p0': 'P0', 'p1': 'P1', 'p2': 'P2', 'p3': 'P3', 'p4': 'P3',
            'high': 'P1', 'alta': 'P1', 'media': 'P2', 'normal': 'P2', 'low': 'P3', 'baja': 'P3'}
SEVERITY = {'low': 'low', 'baja': 'low', 'medium': 'medium', 'media': 'medium',
            'high': 'high', 'alta': 'high', 'critical': 'critical', 'critica': 'critical', 'crítica': 'critical'}
ERROR_STATUS = {'open': 'open', 'abierto': 'open', 'mitigated': 'mitigated', 'mitigado': 'mitigated',
                'resolved': 'resolved', 'resuelto': 'resolved', 'fixed': 'resolved'}
# A ref as these trees write it.
REF_RE = re.compile(r'\b((?:INI|SUP|LRN|ERR|CHG|ANA|SYS|STY|HFX)-\d+)\b')


def excluded(path):
    """True for a path no dialect may read: a worktree copy, a vendored tree, a backup, a test vault."""
    p = '/' + path.replace(os.sep, '/').strip('/') + '/'
    return any(part in p for part in EXCLUDE_PARTS)


def read_file(path):
    """(fields, body) of a markdown file, with the app's own frontmatter parser.

    A line regex is not enough: `scope:` and `on_hold:` hold quoted text that runs over several lines and
    inline maps, and reading them by line yields values like `executor: branch:`.
    """
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    head, body = fm.split(text)
    # `split` says None for a file with no frontmatter at all: every learning here, and 54 of the analyses.
    return (fm.parse(head) if (head or '').strip() else {}), body


def title_of(body, old_ref=None):
    """The readable title: the first H1, without the `<REF> — ` or `<date> — ` these trees put in front of it."""
    m = re.search(r'^#\s+(.+?)\s*$', body, re.M)
    if not m:
        return ''
    t = m.group(1).strip()
    # `<REF> — Title`, `<REF> · Title`, `<date> — Title`: these trees use all of them.
    t = re.sub(r'^(?:[A-Z]{3}-\d+|\d{4}-\d{2}-\d{2})\s*[—–·-]\s*', '', t).strip()
    if old_ref:
        t = re.sub(r'^%s\s*[—–·-]\s*' % re.escape(old_ref), '', t).strip()
    # Trailing decoration the vault models in its own fields: whether it is an umbrella shows in having
    # stories, and its status in `status_ticket`. A `·` segment is only dropped when it says one of those —
    # plenty of real titles use `·` ("Estado de publicación · Google Shopping").
    t = re.sub(r'(\s*·\s*(?:\*\*)?(?:umbrella|UMBRELLA)(?:\*\*)?(?:\s*\([^)]*\))?'
               r'|\s*·\s*[^·]*(?:🚧|✅|IN PROGRESS|CERRADA|DONE)[^·]*'
               r'|\s*·\s*realizó el slice[^·]*)+\s*$', '', t).strip()
    return t


def date_in(name):
    m = re.match(r'(\d{4}-\d{2}-\d{2})', os.path.basename(name))
    return m.group(1) if m else ''


def ref_in(name):
    """The ref a file name carries: `2026-09-28-ini-003-…` → INI-003, `INI-006-…` → INI-006."""
    # With or without the dash: these trees write both `…-ini-003-…` and `…-ini006-…`.
    m = re.search(r'\b(ini|sup|lrn|err|chg|ana|sys)-?(\d{1,4})\b', os.path.basename(name), re.I)
    if not m:
        return ''
    return '%s-%s' % (m.group(1).upper(), m.group(2).zfill(3))


class Dialect:
    """One source tree: where its items are, what type they become, and how to read one.

    `aliases`: {canonical key: the spellings this tree uses}. `deep`: its status folders have subfolders whose
    files are items too (the dashboard's `backlog/_slices/`). `statuses`: its folder → status map. `skip`:
    {path relative to github: why} for a file the owner said is not an item. `story_when`: given the file's
    fields, True when the item is a story and not what `kind` says — the dashboard writes a slice in the same
    folder as its initiative and tells them apart by `parent` (D28).
    """

    def __init__(self, key, root, kind, layout, project, aliases=None, deep=False, statuses=None,
                 skip=None, story_when=None, premise_fallback='', force=None, date_from_body=False,
                 initiative_kind='product'):
        self.key, self.root, self.kind, self.layout, self.project = key, root, kind, layout, project
        self.aliases = aliases or {}
        self.deep = deep
        self.statuses = statuses or STATUS_FOLDERS
        self.skip = skip or {}
        self.story_when = story_when
        self.premise_fallback = premise_fallback
        # `force`: values every item of this source gets, whatever it says. `date_from_body`: its files carry
        # no date, in their name or their frontmatter, so the first one written in the text is taken.
        self.force = force or {}
        self.date_from_body = date_from_body
        # What its initiatives deliver: a product has end users, a system builds or verifies other things.
        self.initiative_kind = initiative_kind

    def get(self, fields, key, default=''):
        """A value by its canonical key, whichever spelling this tree used for it."""
        for name in self.aliases.get(key, (key,)):
            if str(fields.get(name) or '').strip() != '':
                return fields[name]
        return default

    def type_of(self, fields):
        return 'story' if (self.story_when and self.story_when(fields)) else self.kind

    def walk(self, github):
        """Every item file of this source, as (abs path, status folder or None). Never a doc or a template."""
        base = os.path.join(github, self.root)
        out = []
        if not os.path.isdir(base):
            return out
        if self.layout == 'status-folders':
            # The folder name, not the status it becomes: `map_item` is the one place that maps it.
            for folder in self.statuses:
                d = os.path.join(base, folder)
                if not os.path.isdir(d):
                    continue
                walker = os.walk(d) if self.deep else [(d, [], sorted(os.listdir(d)))]
                for here, _dirs, files in walker:
                    for f in sorted(files):
                        full = os.path.join(here, f)
                        if not f.endswith('.md') or f in NOT_ITEMS or excluded(full):
                            continue
                        if os.path.relpath(full, github) in self.skip:
                            continue
                        if os.path.isfile(full):
                            out.append((full, folder))
        else:  # 'flat': the items sit in the folder itself, its subfolders are not items
            for f in sorted(os.listdir(base)):
                full = os.path.join(base, f)
                if os.path.isfile(full) and f.endswith('.md') and f not in NOT_ITEMS and not excluded(full):
                    out.append((full, None))
        return out




# ── reading one item ────────────────────────────────────────────────────────

def _enum(table, raw, key, unmapped):
    """A value through its table, by its first word when the source wrote prose ("normal (M)" → normal).

    Anything the table does not know goes to `unmapped` and is left out, never guessed: the owner answers it.
    """
    s = str(raw or '').strip()
    if not s:
        return ''
    low = s.lower()
    if low in table:
        return table[low]
    first = re.split(r'[\s(—–,;:]', low, 1)[0]
    if first in table:
        return table[first]
    unmapped.append({'key': key, 'value': s})
    return ''


def _int_or_text(raw):
    """A 1-5 scale as the number the template writes, not as the quoted string `str()` would give."""
    t = str(raw).strip()
    return int(t) if t.isdigit() else t


def _refs(raw):
    """Every ref in a value, whether it is a string, a list or a path."""
    out = []
    for part in (raw if isinstance(raw, list) else [raw]):
        out += REF_RE.findall(str(part or ''))
    return out


# How the app writes a status in `status_log`: the numbered disk form, always (`codec.py:266-270` builds the
# entry from `disk_status(t, v)`). Writing the plain one works — `_closed_at` normalises with `app_status` —
# but it leaves a chain whose `to` is plain and whose next `from`, written by the app, is numbered.
_NUMBERED = {'Backlog': '1. Backlog', 'ToDo': '2. ToDo', 'OnHold': '3. OnHold', 'InProgress': '4. InProgress',
             'Review': '5. Review', 'Done': '6. Done', 'Discarded': '7. Discarded'}


def _log(entries):
    """A status_log the vault reads, oldest first, with `by: migration` so a migrated move stays recognisable."""
    out, prev = [], ''
    for date, status in entries:
        if not date or not status or status == prev:
            continue
        out.append({'date': str(date), 'from': _NUMBERED.get(prev, prev), 'to': _NUMBERED[status],
                    'by': 'migration'})
        prev = status
    return out

# Which types carry a status, and where it comes from: the folder for a ticket, its own key for an error, and
# nowhere for a plan, an analysis or a learning — their types have no status in the vault.
FROM_FOLDER = ('initiative', 'story', 'support', 'hotfix', 'prd')
# The category of a learning, written under five different keys over time. The vault's `learning` has no such
# field, so they become labels: the information survives and a Base can group by it.
CATEGORY_KEYS = ('categoria', 'category', 'type', 'kind', 'tipo')
# Keys with no field of their own in the vault that are still a fact about the item, so they are written as
# undeclared frontmatter: they survive, a Base can query them, and the app will not rewrite them
# (`allowed_values` drops what no type declares). A frozen historical record, not a live field.
KEEP_EXTRA = ('doc_impact', 'i18n_impact', 'prod', 'pr', 'release', 'owner_led',
              'verdict', 'question', 'sources', 'candidate', 'corpus_base', 'measured_at', 'wired_at',
              'mode', 'system_type', 'target_platforms', 'unit_path',
              'continues', 'driven_by', 'absorbs', 'merged_from', 'defers_to')
# `hb_sha` is not here: it is already written as `subject_sha`, the field the vault has for it.


def _strip_h1(body):
    """The body without its first H1: that line is the title, and the vault keeps the title in `subject`."""
    return re.sub(r'\A\s*#\s+.*?\n+', '', body, count=1)


def scope_section(text):
    """The source's `scope`, a prose paragraph that lives in its frontmatter and nowhere else, as a callout.

    Without this it is simply lost: it is not part of the body, and the vault has no `scope` field.
    """
    body = '\n> '.join(str(text).strip().splitlines())
    return f'> [!owner] Scope, as the source recorded it\n> {body}\n\n'


def map_item(d, path, status_folder):
    """One source file as what the Projects vault needs. `unmapped` is what only the owner can settle."""
    fields, body = read_file(path)
    t = d.type_of(fields)
    unmapped, notes = [], []
    base = os.path.basename(path)
    # Only its own `id` is its ref. A plan called `INI-006-….md` and an analysis called `…-ini-079-….md` name
    # the initiative they belong to, not themselves: taking that as their ref would make `vault.py show
    # INI-079` ambiguous between the initiative and the analysis about it.
    old_ref = str(fields.get('id') or '').strip()
    born = str(d.get(fields, 'date') or fields.get('written') or '').strip()[:10] or date_in(base)
    if not born and d.date_from_body:
        m = re.search(r'\b(20\d{2}-\d{2}-\d{2})\b', body)
        if m:
            born = m.group(1)
            notes.append(f'no date in its name or its frontmatter: {born}, the first one written in its text')
        else:
            # Nothing says when it was written. The file's own mtime is the only signal left, and saying so
            # in the item is better than stamping it with the day of the migration.
            born = datetime.fromtimestamp(os.path.getmtime(path)).strftime('%Y-%m-%d')
            notes.append(f'no date anywhere in it: {born}, the date the file was last written')
    last = str(d.get(fields, 'updated') or '').strip()[:10] or born
    subject = (title_of(body, old_ref) or str(d.get(fields, 'title') or '').strip()
               or str(fields.get('name') or '').replace('-', ' ').strip() or base[:-3])
    if not fields:
        notes.append('no frontmatter: subject from its H1, date from its file name')

    v = {}
    for src, dst in (('area', 'area'), ('objective', 'objective'), ('branch', 'branch'),
                     ('changelog_ref', 'changelog_ref'), ('changelog', 'changelog_ref')):
        if str(fields.get(src) or '').strip() and not str(v.get(dst) or '').strip():
            val = fields[src]
            v[dst] = ', '.join(str(x) for x in val) if isinstance(val, list) else str(val).strip()
    for key in KEEP_EXTRA:
        if fields.get(key) not in (None, '', [], {}):
            v[key] = fields[key]
    if str(d.get(fields, 'priority') or '').strip():
        got = _enum(PRIORITY, d.get(fields, 'priority'), 'priority', unmapped)
        if got:
            v['priority'] = got

    # ── the status, and the history that makes `completed_at` land ───────
    status, log = '', []
    if t in FROM_FOLDER:
        status = d.statuses.get(status_folder or '', '')
    elif t == 'error':
        status = _enum(ERROR_STATUS, d.get(fields, 'status'), 'status', unmapped) or 'open'
    if status and t in FROM_FOLDER:
        v['status'] = status
        approved = str(fields.get('approved') or '').strip()
        pv = str(fields.get('premise_verified') or '').strip()[:10]
        started = str(fields.get('started_at') or '').strip()
        # The last entry is always the status the item is in: `codec._closed_at` reads `completed_at` from it,
        # and a log whose last `to` differs from `status_ticket` is a vault that contradicts itself.
        log = _log([(born, 'Backlog'),
                    (approved[:10] if approved else (pv if status != 'Backlog' else ''), 'ToDo'),
                    (started, 'InProgress'),
                    (last or born, status)])
        if status == 'Discarded' and not str(fields.get('discard_reason') or '').strip():
            v['discard_reason'] = 'migrated: no reason recorded in the source'
        hold = fields.get('on_hold')
        if status == 'OnHold':
            why = (hold or {}).get('why') if isinstance(hold, dict) else None
            v['on_hold'] = {'by': str((hold or {}).get('by') or 'owner') if isinstance(hold, dict) else 'owner',
                            'why': str(why or 'migrated: on hold in the source'),
                            'resume_when': str((hold or {}).get('resume_when') or '') if isinstance(hold, dict) else ''}
    elif status:
        v['status'] = status

    # ── per type ────────────────────────────────────────────────────────
    if t in ('initiative', 'story'):
        if t == 'initiative':
            v['initiative_kind'] = d.initiative_kind
        for src in ('size', 'premise_verified', 'spec_impact'):
            if str(fields.get(src) or '').strip():
                v[src] = str(fields[src]).strip()
        if str(fields.get('premise') or '').strip():
            got = _enum(PREMISE, fields['premise'], 'premise', unmapped)
            if got:
                v['premise'] = got
            elif d.premise_fallback:
                v['premise'] = d.premise_fallback
                unmapped.pop()   # the dialect answers it; it is not a question
                notes.append(f"premise {str(fields['premise'])[:40]!r} → {d.premise_fallback} (owner, 2026-11-21)")
        if fields.get('regime'):
            got = _enum(REGIME, fields['regime'], 'regime', unmapped)
            if got:
                v['regime'] = got
    elif t == 'support':
        for src in ('level', 'level_base', 'level_reason', 'signature', 'occurrences', 'due_from', 'due',
                    'should_have_caught', 'subject_sha'):
            if str(fields.get(src) or '').strip():
                v[src] = fields[src]
        if str(fields.get('hb_sha') or '').strip():
            v['subject_sha'] = str(fields['hb_sha']).strip()
        for src, table, dst in (('origin', SUPPORT_ORIGIN, 'origin'), ('disposition', DISPOSITION, 'disposition'),
                                ('executor', EXECUTOR, 'executor')):
            if str(fields.get(src) or '').strip():
                got = _enum(table, fields[src], src, unmapped)
                if got:
                    v[dst] = got
    elif t == 'plan':
        for src, dst in (('written', 'written'), ('base', 'base'), ('worktree', 'worktree'), ('judge', 'verifier')):
            if str(fields.get(src) or '').strip():
                v[dst] = str(fields[src]).strip()
        for src, table, dst in (('executor', EXECUTOR, 'executor'), ('lane', LANE, 'lane')):
            if str(fields.get(src) or '').strip():
                got = _enum(table, fields[src], src, unmapped)
                if got:
                    v[dst] = got
    elif t == 'analysis':
        for src, dst in (('base', 'base'), ('author', 'author')):
            if str(fields.get(src) or '').strip():
                v[dst] = str(fields[src]).strip()
        if str(fields.get('kind') or '').strip():
            k = str(fields['kind']).strip().lower()
            if k in ('diagnosis', 'decision', 'review', 'research', 'retro', 'ux', 'brief', 'report'):
                v['kind'] = k
            elif k in KIND_NO_EQUIVALENT:
                notes.append(f"kind: {k} has no equivalent among the vault's eight: left empty (owner, 2026-11-21)")
            else:
                unmapped.append({'key': 'kind', 'value': str(fields['kind']).strip()})
    elif t == 'error':
        if str(d.get(fields, 'severity') or '').strip():
            got = _enum(SEVERITY, d.get(fields, 'severity'), 'severity', unmapped)
            if got:
                v['severity'] = got
        if str(d.get(fields, 'impact') or '').strip():
            v['impact'] = _int_or_text(d.get(fields, 'impact'))
    elif t == 'learning':
        if str(d.get(fields, 'impact') or '').strip():
            v['impact'] = _int_or_text(d.get(fields, 'impact'))
        # Its category, under whichever of the five keys this file used, plus whatever tags it already had.
        labels = [str(x).lstrip('#') for x in (fields.get('tags') or []) if str(x).strip()]
        for key in CATEGORY_KEYS:
            got = str(fields.get(key) or '').strip()
            if got and got not in labels:
                labels.append(got)
        if labels:
            v['labels'] = labels

    v.update(d.force)
    for key in BLANK_UNLESS_SAID.get(t, ()):
        if not str(v.get(key) or '').strip():
            v[key] = ''

    # ── who it hangs from, and what it relates to: refs now, wikilinks in pass 2 ──
    parent = ''
    for key in ('parent', 'initiative', 'item'):
        got = _refs(d.get(fields, key) if key in d.aliases else fields.get(key))
        if got:
            parent = got[0]
            break
    if not parent and t in ('plan', 'analysis', 'learning'):
        got = ref_in(base)
        parent = got if got.startswith(('INI', 'SUP')) else ''
    rel = []
    for key in ('depends_on', 'related_errors', 'related_learnings', 'related_analyses', 'analyses',
                'linked_initiatives', 'origin', 'promoted_to', 'caused_by', 'supersedes', 'plan',
                'related_initiatives', 'related', 'relates_to', 'parents', 'superseded_by', 'slices',
                'umbrella', 'resolved_by', 'surfaced_by', 'fixed_by'):
        rel += [(key, r) for r in _refs(fields.get(key))]
    out_body = _strip_h1(body)
    scope = str(d.get(fields, 'scope') or '').strip()
    if scope and scope[:60] not in out_body:
        out_body = scope_section(scope) + out_body
        notes.append('its `scope` was only in the frontmatter: written at the top of the body')
    aliases = [old_ref, f'{d.key.split("-")[0]}/{old_ref}'] if old_ref else [base[:-3]]
    return {'source': d.key, 'type': t, 'project': d.project, 'path': path, 'basename': base,
            'aliases': aliases,
            'old_ref': old_ref, 'subject': subject, 'creation_date': born, 'updated_date': last,
            'values': v, 'status_log': log, 'parent': parent, 'relations': rel,
            'body': out_body, 'fields': fields, 'unmapped': unmapped, 'notes': notes}
