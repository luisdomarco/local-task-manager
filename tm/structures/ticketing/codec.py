"""Ticketing files ↔ the app's items.

Reading is two steps. `decode` turns one file's frontmatter into the item's fields, on its own: the type from
`fileClass`, the title from the file name, `status_ticket: "4. InProgress"` → `status: InProgress`, the dates,
`tags` → `labels`. Links stay as the stems they name. `resolve` then sees every item at once and turns those
stems into item keys (an id, or the path of a file without one) and the project link into the project's key.

Writing changes only the keys the app changed, under their names on disk (`encode`): never the key order, the
comments, the keys the app does not know, or the body. A status change appends to `status_log`. A new file is its
type's template (templates/), filled in, then patched with the form's values (`new_file`).

Nothing here touches the disk: the Store reads and writes, this only translates.
"""

import os
import re
import unicodedata

from ... import frontmatter as fm
from .. import NUMBER_RE
from . import rules, wikilinks
from .definition import (CLOSED, INDEX_NOTE, LEGACY_PARENT, OWN_CLOSED, OWN_STATUSES, PROJECT_KEY_RE, ROOT_FOLDERS, SPEC, STATUSES, BY_FILE_CLASS,
                         PROPS)

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = os.path.join(HERE, 'templates')  # a new file's frontmatter, per file class
# What a new item's body starts as when a vault has not set its own yet (Store.default_text): seeded into the vault once
# (.task-manager/templates/<type>.md), where Settings → Vaults → Item types edits it. A type with no file starts empty.
DEFAULT_TEXTS = os.path.join(HERE, 'default_texts')
STATUS_RE = re.compile(r'^\s*\d+\.\s*(.+?)\s*$')
DATE_PREFIX_RE = re.compile(r'^(\d{4}-\d{2}-\d{2}) (.+)$')
# A template's link to its project's note, in its body (a plan's "[[00 {{project}}#Rules for agents…]]").
NO_PROJECT_LINK_RE = re.compile(r'\[\[00 \{\{project\}\}[^\]]*\]\]')
# What a file name cannot hold (on macOS, in Obsidian's links, or anywhere): replaced by a space.
UNSAFE_RE = re.compile(r'[\\/:*?"<>|#^\[\]]+')
# Keys whose meaning the app gives under another name; never passed through as they are.
DISK_KEYS = {'fileClass', 'status_ticket', 'status_error', 'status_agent', 'status_spec', 'status_goal', 'creation_date', 'updated_date', 'tags'}
LINK_PROPS = {t: {p['key'] for p in props if p['kind'] == 'link'} for t, props in PROPS.items()}
MULTI_PROPS = {t: {p['key'] for p in props if p['kind'] == 'links'} for t, props in PROPS.items()}


def links_of(t):
    spec = SPEC[t]
    return set(spec['links']) | LINK_PROPS.get(t, set())


def multi_links_of(t):
    spec = SPEC[t]
    return set(spec['multi_links']) | MULTI_PROPS.get(t, set())


def safe_title(text, limit=120):
    """A title that can be a file name and a wikilink target: no slashes, colons, brackets, pipes or hashes."""
    out = ' '.join(UNSAFE_RE.sub(' ', str(text or '')).split()).strip(' .')
    return out[:limit].rstrip(' .') or 'Untitled'


def slugify(text):
    text = unicodedata.normalize('NFKD', str(text or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')[:60] or 'item'


def disk_status(t, status):
    if t in OWN_STATUSES:  # an error's, an agent's or a spec's own statuses: as they are, not numbered
        return status
    return f'{STATUSES.index(status) + 1}. {status}' if status in STATUSES else status


def app_status(t, raw):
    if raw in (None, ''):
        return None
    m = STATUS_RE.match(str(raw))
    return m.group(1) if m and t not in OWN_STATUSES else str(raw).strip()


def ref(t, item_id):
    """How a ticket's id is drawn, and so how its file is named: a short id with its type's code (`STY-482`), a long one
    (`ACME-STY-001`, from before short ids) as it is."""
    item_id = str(item_id or '')
    return f"{SPEC[t]['code']}-{item_id}" if NUMBER_RE.match(item_id) and SPEC[t]['code'] else item_id


def _title_of(t, item_id):
    """How a file of type `t` is named: by its spec's `title`, or, for a plan or an analysis with no id (from before
    they had one), by its `legacy_title`."""
    spec = SPEC[t]
    return spec['legacy_title'] if spec['legacy_title'] and not item_id else spec['title']


def _stem(rel):
    return os.path.splitext(os.path.basename(rel))[0]


def _first_dir(rel):
    parts = rel.replace(os.sep, '/').split('/')
    return parts[0] if len(parts) > 1 else ''


class Resolver:
    """Who is who in one scan: file stems ↔ item keys, and the projects (key → note stem, folder, name, fields)."""

    def __init__(self):
        self.stem_to_key = {}
        self.key_to_stem = {}
        self.projects = {}
        self.project_by_stem = {}
        self.project_by_dir = {}

    def stem(self, key):
        return self.key_to_stem.get(key)

    def link(self, key):
        """A wikilink to the item of that key; a value that is not a known key is written back as it was."""
        stem = self.stem(key)
        if stem:
            return wikilinks.link(stem)
        return key if wikilinks.target(key) else wikilinks.link(key)


class TicketingCodec:
    # ── reading ──────────────────────────────────────────────────────────────
    def classify(self, rel, raw):
        """Which item type a file is ('worklog' for a work-log day), from its fileClass; None for anything else."""
        if raw.get('type') == 'worklog':
            return 'worklog'
        return BY_FILE_CLASS.get(str(raw.get('fileClass') or '').strip())

    def decode(self, rel, raw):
        """One file's fields as the app's, links still as stems (in `_links`, for resolve)."""
        t = self.classify(rel, raw)
        spec = SPEC[t]
        stem = _stem(rel)
        parent = spec['parent']
        legacy = LEGACY_PARENT.get(t)
        if legacy and raw.get(parent) in (None, '') and raw.get(legacy) not in (None, ''):
            raw = {**raw, parent: raw[legacy]}
        f = {k: v for k, v in raw.items() if k not in DISK_KEYS and k not in (parent, legacy, 'project')}
        f['type'] = t
        item_id = str(raw.get('id') or '').strip() if spec['code'] else ''
        if item_id:
            f['id'] = item_id
        else:
            f.pop('id', None)
        title = _title_of(t, item_id)
        if title == 'id':
            named = ref(t, item_id)
            subject = stem[len(named) + 1:] if named and stem.startswith(named + ' ') else stem
        elif title == 'date':
            m = DATE_PREFIX_RE.match(stem)
            subject = str(raw.get('title') or '').strip() or (m.group(2) if m else stem)
        elif title == 'note':
            subject = stem[3:] if stem.startswith('00 ') else stem
        else:
            subject = stem
        f['subject'] = subject
        if spec['status_key']:
            f['status'] = app_status(t, raw.get(spec['status_key']))
            f['completed_at'] = self._closed_at(t, raw.get('status_log'), f['status'])
        f['created_at'] = str(raw.get('creation_date') or '') or None
        f['updated_at'] = str(raw.get('updated_date') or '') or None
        tags = raw.get('tags')
        f['labels'] = [str(x).lstrip('#') for x in tags] if isinstance(tags, list) else []
        links = {}
        if parent:
            s = wikilinks.target(raw.get(parent))
            if s:
                links['related_to'] = s
            elif raw.get(parent) not in (None, '', []):
                f[f'{parent}_text'] = raw.get(parent)  # "direct" (a hotfix with no support ticket): shown, kept
        s = wikilinks.target(raw.get('project'))
        if s:
            links['project'] = s
        for k in links_of(t):
            s = wikilinks.target(raw.get(k))
            if s:
                links[k] = s
        for k in multi_links_of(t) | {'relations'}:
            v = raw.get(k)
            if isinstance(v, list):
                links[k] = [wikilinks.target(x) or x for x in v if x not in (None, '')]
        f['_links'] = links
        f['_rel'] = rel
        return f

    def _closed_at(self, t, log, status):
        """When it was last closed: the date of the last status_log entry into a closed status (None while open)."""
        closed = OWN_CLOSED.get(t, CLOSED)
        if status not in closed or not isinstance(log, list):
            return None
        for entry in reversed(log):
            if isinstance(entry, dict) and app_status(t, entry.get('to')) in closed:
                return str(entry.get('date') or '') or None
        return None

    def resolve(self, items):
        """Every item's links as item keys, and its project as the project's key. → the Resolver, for writes."""
        r = Resolver()
        for it in items:
            stem = _stem(it['path'])
            # A link names an item by its id where it has one: a project's is its key (store._item), which is what
            # another item's `relations` hold; its path is still its key for everything else.
            r.stem_to_key[stem] = it['id'] or it['key']
            r.key_to_stem[it['key']] = stem
            if it['id']:
                r.key_to_stem[it['id']] = stem
            if it['type'] == 'project':
                key = str(it['fields'].get('project_key') or '').strip()
                if PROJECT_KEY_RE.match(key) and key not in r.projects:
                    folder = os.path.dirname(it['path'])
                    r.projects[key] = {'stem': stem, 'dir': folder, 'name': it['fields']['subject'], 'fields': it['fields']}
                    r.project_by_stem[stem] = key
                    r.project_by_dir[folder] = key
        for it in items:
            self.apply(it['fields'], r)
        return r

    def apply(self, f, r):
        """Turn one decoded item's stems into keys (resolve, for a single item read again)."""
        links = f.pop('_links', {})
        rel = f.pop('_rel', '')
        t = f['type']
        if t == 'project':
            f['project'] = str(f.get('project_key') or '') or None
        else:
            p = links.get('project')
            f['project'] = r.project_by_stem.get(p) or (r.project_by_dir.get(_first_dir(rel)) if SPEC[t]['scope'] == 'project' else None)
        f['related_to'] = r.stem_to_key.get(links['related_to']) if links.get('related_to') else None
        for k in links_of(t):
            if links.get(k):
                f[k] = r.stem_to_key.get(links[k], f.get(k))  # a link to nothing known stays as written
        for k in multi_links_of(t):
            if k in links:
                f[k] = [r.stem_to_key.get(s, s) for s in links[k]]
        if 'relations' in links:
            known = [r.stem_to_key[s] for s in links['relations'] if s in r.stem_to_key]
            f['relations'] = known
            f['_unresolved_relations'] = [s for s in links['relations'] if s not in r.stem_to_key]
        return f

    # ── writing ──────────────────────────────────────────────────────────────
    def encode(self, t, values, raw, r, stamp=None, by='owner', current=None):
        """The app's `values` for an item of type `t` → the keys to patch on disk. `raw` is the file's current
        frontmatter (its status_log grows here when the status changes); `current`, the item's fields as read
        (the relations it names that no item answers to are written back, never dropped)."""
        spec = SPEC[t]
        out = {}
        links, multi = links_of(t), multi_links_of(t)
        for k, v in values.items():
            if k in ('completed_at', 'type', 'id') or k.startswith('_'):
                continue  # completed_at comes from status_log; type and id are never rewritten
            if k == 'subject':
                if 'name' in raw:
                    out['name'] = slugify(v)
                if 'title' in raw:
                    out['title'] = v
            elif k == 'status':
                key = spec['status_key']
                if not key:
                    continue
                new, old = disk_status(t, v), raw.get(key)
                out[key] = new
                if app_status(t, old) != v and stamp:
                    log = raw.get('status_log') if isinstance(raw.get('status_log'), list) else []
                    out['status_log'] = [*log, {'date': stamp[:10], 'from': old or '', 'to': new, 'by': by}]
            elif k == 'updated_at':
                out['updated_date'] = str(v or '')[:10]
            elif k == 'created_at':
                out['creation_date'] = str(v or '')[:10]
            elif k == 'labels':
                out['tags'] = list(v or [])
            elif k == 'related_to':
                if spec['parent']:
                    out[spec['parent']] = r.link(v) if v else ''
                    if LEGACY_PARENT.get(t) in raw:  # the old name emptied, or clearing the link would bring it back
                        out[LEGACY_PARENT[t]] = ''
            elif k == 'project':
                p = r.projects.get(v) if v else None
                out['project'] = wikilinks.link(p['stem']) if p else ''
            elif k in links:
                out[k] = r.link(v) if v else ''
            elif k in multi:
                out[k] = [r.link(x) for x in (v or [])]
            elif k == 'relations':
                kept = [s if wikilinks.target(s) else wikilinks.link(s) for s in ((current or {}).get('_unresolved_relations') or [])]
                out[k] = [*(r.link(x) for x in (v or [])), *kept]
            else:
                out[k] = v
        return out

    def file_name(self, t, item_id, subject, stamp, parent_id=None):
        """`<ref> <Title>.md` (`STY-482 Pay in one page.md`). A plan or an analysis from before they had ids keeps its old
        name: a plan after its item's ref (`parent_id`), an analysis after its date."""
        title = _title_of(t, item_id)
        if title == 'plan':
            return f'{parent_id} Plan.md'
        if title == 'date':
            return f'{stamp[:10]} {safe_title(subject)}.md'
        if title == 'note':
            return f'00 {safe_title(subject)}.md'
        return f'{ref(t, item_id)} {safe_title(subject)}.md'

    def folder_of(self, t, project, r, subject=None):
        """Where a new item of type `t` goes, relative to the vault: a ticket of `project`, in that project's folder of
        its type; one in no project (`project` None), in the folder of its type at the vault's top (Initiatives/)."""
        spec = SPEC[t]
        if spec['scope'] == 'root':
            return spec['folder']
        if spec['scope'] == 'note':
            return safe_title(subject)
        if not project:
            return spec['folder']
        p = r.projects.get(project)
        return f"{p['dir']}/{spec['folder']}" if p else None

    def template(self, t, variables):
        """A new file's frontmatter (templates/<file class>.md), its placeholders filled in."""
        with open(os.path.join(TEMPLATES, f"{SPEC[t]['file_class']}.md"), encoding='utf-8') as f:
            return fill(f.read(), variables)

    @staticmethod
    def default_texts():
        """The body each type starts with until a vault sets its own: {type: text}, only the types that have one."""
        out = {}
        for t in SPEC:
            try:
                with open(os.path.join(DEFAULT_TEXTS, f'{t}.md'), encoding='utf-8') as f:
                    out[t] = f.read()
            except FileNotFoundError:
                pass
        return out

    def new_file(self, t, subject, values, body, r, item_id, stamp, parent=None):
        """→ (path relative to the vault, text) of a new item: its frontmatter, filled in and patched with `values`, then
        `body` (what the form sent, or the vault's default text for the type: Store.create), its placeholders filled in
        too ({{ref}}, {{project}}, {{date}}…). Never its title: that is the item's `name`, not a line of its body."""
        project = values.get('project')
        p = r.projects.get(project) if project else None
        parent_ref = ref(parent['type'], parent['id']) if parent else None
        name = self.file_name(t, item_id, subject, stamp, parent_id=parent_ref)
        folder = self.folder_of(t, project, r, subject)
        variables = {'id': item_id or '', 'ref': ref(t, item_id), 'key': project or '', 'project': p['name'] if p else '', 'title': subject,
                     'date': stamp[:10], 'slug': slugify(subject),
                     # what it hangs from (a plan's text names the initiative or story it executes)
                     'item_ref': parent_ref or '', 'item_title': parent['title'] if parent else ''}
        if t == 'project':  # its note's title is its own name (there is no project yet to take it from)
            variables['project'] = subject
        text = self.template(t, variables)
        body = (body or '').strip()
        if SPEC[t]['scope'] == 'project' and not p:
            # A ticket in no project: its file names none (`project: ""`), and a line of its body that would link to its
            # project's note (a plan's rules for agents) says it has none.
            values = {**values, 'project': None}
            body = NO_PROJECT_LINK_RE.sub('(none: it is in no project)', body)
        body = fill(body, variables)
        if item_id and NUMBER_RE.match(str(item_id)):  # a short id is stored as the number it is: `id: 482`
            text = fm.patch(text, {'id': int(item_id)})
        raw = fm.parse(fm.split(text)[0])
        disk = self.encode(t, {k: v for k, v in values.items() if k != 'status'}, raw, r)
        if 'status' in values and SPEC[t]['status_key']:
            disk[SPEC[t]['status_key']] = disk_status(t, values['status'])
        text = fm.patch(text, disk)
        if body:
            text = text.rstrip('\n') + '\n\n' + body + '\n'
        return f'{folder}/{name}' if folder else name, text

    @staticmethod
    def link_fields(item_type):
        """The fields of an item of this type that hold links to other items (one or a list), besides its parent
        (`related_to`), its project and its `relations`: what the graph draws (tm/graph.py)."""
        return sorted(links_of(item_type) | multi_links_of(item_type))

    @staticmethod
    def title_is_name(item_type):
        """Whether an item of this type is named after its title: its file follows a change of title (renamed)."""
        return SPEC[item_type]['title'] in ('id', 'date', 'note')

    @staticmethod
    def owns_folder(item_type):
        """Whether an item of this type is its folder's note (a project: `<Name>/00 <Name>.md`, its tickets inside):
        it is renamed, deleted and restored with everything in the folder."""
        return (SPEC.get(item_type) or {}).get('scope') == 'note'

    def renamed(self, it, subject, stamp):
        """The new path of an item whose title changes (its file name is its title): same folder, new name. A plan from
        before plans had ids is named after its item, not its title: it keeps its name. A project's folder is named
        after it too (`<Name>/00 <Name>.md`): both change, and what is in the folder goes with it."""
        t = it['type']
        if not self.title_is_name(t) or _title_of(t, it['id']) == 'plan':
            return None
        name = self.file_name(t, it['id'], subject, (it['fields'].get('created_at') or stamp))
        if SPEC[t]['scope'] == 'note':
            return f'{self.folder_of(t, None, None, subject)}/{name}'
        return os.path.join(os.path.dirname(it['path']), name)

    # ── projects ─────────────────────────────────────────────────────────────
    @staticmethod
    def is_root_file(name):
        return name == INDEX_NOTE or name.endswith('.base')

    root_folders = ROOT_FOLDERS

    # ── links and rules ──────────────────────────────────────────────────────
    @staticmethod
    def relink(text, old_stem, new_stem):
        return wikilinks.rewrite(text, old_stem, new_stem)

    # The type rules (rules.py), as hooks the Store calls; a RuleError is the user's 400.
    rule_error = rules.RuleError
    on_create = staticmethod(rules.on_create)
    on_update = staticmethod(rules.on_update)
    after_update = staticmethod(rules.after_update)
    duplicate_of = staticmethod(rules.duplicate_of)
    add_occurrence = staticmethod(rules.add_occurrence)
    actions = {'promote': rules.promote, 'escalate': rules.escalate}


def fill(text, variables):
    """`text` with each {{name}} of `variables` replaced; any other {{…}} is left as it is."""
    for k, v in variables.items():
        text = text.replace('{{' + k + '}}', str(v))
    return text
