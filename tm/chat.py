"""Claude as a chat inside this server: `claude -p` in stream-json mode, no pty, so the dock can show its messages,
tool calls and permission requests as such instead of a terminal screen. One Chat per Claude session id, the same id
the terminal uses (tm/pty.py): a session is driven by one of the two at a time. stdlib only.

The protocol is the one the Agent SDK speaks (checked by tools/probe_chat_protocol.py): NDJSON on stdout, NDJSON on
stdin. A user message goes in as `{"type": "user", …}`; a tool that needs permission comes out as a `control_request`
`can_use_tool` and waits for our `control_response`; `interrupt`, `set_model` and `set_permission_mode` are control
requests of ours. What is kept is the conversation (messages, permission requests, our answers), not the noise
(hooks, rate limits, token estimates); partial text (`stream_event`) is passed on live and never kept, since the full
message follows it.

Only `claude` (the command from Settings) is ever started here, with flags the server built: the browser sends text,
a permission answer, or one of a closed list of modes and models — never a command line."""
import base64
import binascii
import collections
import json
import os
import queue
import re
import shutil
import subprocess
import threading
import time

from .launch import CLAUDE_EFFORTS
from .store import StoreError

KEEP_EVENTS = 4000  # kept per chat, for a tab that reconnects (a page reload)
TEXT_MAX = 20000  # characters of one tool result kept: a Read of a long file is shown cut
STDERR_LINES = 30
# The permission modes the composer offers (`--permission-mode` and `set_permission_mode`). Closed: bypassPermissions
# is not among them on purpose.
CHAT_MODES = ('default', 'acceptEdits', 'plan', 'auto')
# What a turn cannot be without: the rest of `system` is hooks, tokens and status, and stays out.
SYSTEM_KEPT = {'init', 'compact_boundary'}
FILES_MAX = 20000  # paths the composer's @ is offered from one folder
FILES_SKIP = {'node_modules', '__pycache__', 'venv', '.venv', 'dist', 'build'}
IMAGES_MAX = 5  # images with one message
IMAGE_MAX = 5 * 1024 * 1024  # characters of one image in base64: the model's own limit
THUMB_MAX = 48 * 1024  # characters of the small copy the chat keeps to show it (a data: URL)
# What an image is, by its first bytes: the browser's word for it is not taken.
IMAGE_MAGIC = ((b'\x89PNG\r\n\x1a\n', 'image/png'), (b'\xff\xd8\xff', 'image/jpeg'), (b'GIF87a', 'image/gif'), (b'GIF89a', 'image/gif'))
ANSWER_MAX = 4000  # characters of one answer to an AskUserQuestion


def chat_flags(mode=''):
    """The flags that make claude a chat: stream-json both ways, permissions asked on stdio, and the starting mode."""
    mode = (mode or '').strip()
    if mode and mode not in CHAT_MODES:
        raise ValueError(f"mode must be one of {', '.join(CHAT_MODES)}")
    return ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
            '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', mode or 'default']


def session_files(cwd, limit=FILES_MAX):
    """What `@` offers in a session's folder: its files and folders (folders end in /), relative to it, sorted.
    In a git checkout, what git lists (tracked, or new and not ignored); elsewhere a walk that skips hidden folders and
    FILES_SKIP. → (paths, truncated)."""
    files = None
    try:
        # core.fsmonitor off: a repository's own config could name a program for git to run while it lists.
        out = subprocess.run(['git', '-c', 'core.fsmonitor=false', 'ls-files', '-co', '--exclude-standard', '-z'], cwd=cwd,
                             capture_output=True, timeout=5)
        if out.returncode == 0:
            files = [f for f in out.stdout.decode('utf-8', 'replace').split('\0') if f]
    except (OSError, subprocess.SubprocessError):
        pass
    if files is None:
        files = []
        for dirpath, dirnames, filenames in os.walk(cwd):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith('.') and d not in FILES_SKIP)
            rel = os.path.relpath(dirpath, cwd)
            files.extend(f if rel == '.' else f'{rel}/{f}'.replace(os.sep, '/') for f in filenames if not f.startswith('.'))
            if len(files) > limit:
                break
    folders = {f[:i + 1] for f in files for i, c in enumerate(f) if c == '/'}
    paths = sorted(folders | set(files))
    return paths[:limit], len(paths) > limit


def model_choice(m):
    """One model of claude's `initialize` answer, as the composer offers it: its alias or id (`value`), its name with
    the version ("Opus 5.5"), what it is for, the full id an alias stands for, and the efforts it takes."""
    efforts = m.get('supportedEffortLevels') if m.get('supportsEffort') else []
    return {'value': str(m['value']), 'label': str(m.get('displayName') or m['value']), 'description': str(m.get('description') or ''),
            'resolved': str(m.get('resolvedModel') or ''), 'efforts': [e for e in efforts or [] if e in CLAUDE_EFFORTS]}


def effort_for(wanted, allowed):
    """The effort a model is given when the session switches to it: the one it had, if the model takes it; else the
    nearest one below (Extra high on a model without it: High), else its lowest. '' when it takes none, or when no
    effort was set (claude's own default for the model, then)."""
    if not allowed or wanted not in CLAUDE_EFFORTS:
        return ''
    if wanted in allowed:
        return wanted
    below = [e for e in allowed if CLAUDE_EFFORTS.index(e) < CLAUDE_EFFORTS.index(wanted)]
    return below[-1] if below else allowed[0]


ITEMS_OPEN, ITEMS_CLOSE = '<attached-items>', '</attached-items>'
ITEM_RE = re.compile(r'<item ref="([^"]*)">')


def with_items(text, items):
    """The message claude gets: the text, then each attached item's context in an <item> of <attached-items>."""
    if not items:
        return text
    blocks = []
    for it in items:
        ref = f"{it.get('id') or it.get('type') or ''} · {it.get('title') or ''}".replace('"', "'")
        blocks.append(f'<item ref="{ref}">\n{(it.get("context") or "").strip()}\n</item>')
    note = 'These items of my task manager are attached to this message:'
    return '\n\n'.join(x for x in (text, f'{ITEMS_OPEN}\n{note}\n\n' + '\n\n'.join(blocks) + f'\n{ITEMS_CLOSE}') if x)


def split_items(content):
    """with_items read back (a transcript): (the text typed, [{id, title}] of what was attached)."""
    at = content.find(ITEMS_OPEN)
    if at < 0:
        return content, []
    items = []
    for ref in ITEM_RE.findall(content[at:]):
        ident, _, title = ref.partition(' · ')
        items.append({'id': ident, 'title': title, 'type': ''})
    return content[:at].strip(), items


def image_blocks(images):
    """The images of a message ([{data: base64, thumb: data URL}], as the composer sends them) checked and made into
    claude's `image` blocks; their type is read from their bytes (png, jpeg, gif, webp). → (blocks, what the chat
    keeps of each: {media_type, thumb})."""
    images = list(images or [])
    if len(images) > IMAGES_MAX:
        raise StoreError(400, f'at most {IMAGES_MAX} images go with one message')
    blocks, kept = [], []
    for im in images:
        data = im.get('data') if isinstance(im, dict) else None
        if not isinstance(data, str) or not data:
            raise StoreError(400, 'an image without its data')
        if len(data) > IMAGE_MAX:
            raise StoreError(413, f'an image is at most {IMAGE_MAX // (1024 * 1024)} MB')
        try:
            raw = base64.b64decode(data, validate=True)
        except (binascii.Error, ValueError):
            raise StoreError(400, 'an image that is not base64')
        media = next((t for magic, t in IMAGE_MAGIC if raw.startswith(magic)), None)
        if not media and raw[:4] == b'RIFF' and raw[8:12] == b'WEBP':
            media = 'image/webp'
        if not media:
            raise StoreError(400, 'images are png, jpeg, gif or webp')
        blocks.append({'type': 'image', 'source': {'type': 'base64', 'media_type': media, 'data': data}})
        thumb = im.get('thumb')
        ok = isinstance(thumb, str) and len(thumb) <= THUMB_MAX and thumb.startswith(('data:image/jpeg;base64,', 'data:image/png;base64,'))
        kept.append({'media_type': media, **({'thumb': thumb} if ok else {})})
    return blocks, kept


def _cut(text):
    return text if len(text) <= TEXT_MAX else text[:TEXT_MAX] + f'\n… ({len(text) - TEXT_MAX} more characters)'


def slim(msg):
    """The message as kept and sent: tool results cut to TEXT_MAX, the long lists of `init` dropped."""
    if msg.get('type') == 'user':
        content = (msg.get('message') or {}).get('content')
        if isinstance(content, list):
            for block in content:
                if block.get('type') == 'tool_result':
                    c = block.get('content')
                    if isinstance(c, str):
                        block['content'] = _cut(c)
                    elif isinstance(c, list):
                        for part in c:
                            if part.get('type') == 'text' and isinstance(part.get('text'), str):
                                part['text'] = _cut(part['text'])
                            elif part.get('type') == 'image':
                                part.pop('source', None)
    if msg.get('type') == 'system' and msg.get('subtype') == 'init':
        return {k: msg.get(k) for k in ('type', 'subtype', 'session_id', 'cwd', 'model', 'permissionMode',
                                         'claude_code_version', 'slash_commands')}
    return msg


def kind(msg):
    """'keep' (part of the conversation), 'live' (passed on, not kept) or None (dropped)."""
    t = msg.get('type')
    if t in ('assistant', 'user', 'result'):
        return 'keep'
    if t == 'system':
        return 'keep' if msg.get('subtype') in SYSTEM_KEPT else None
    if t == 'control_request':
        return 'keep' if (msg.get('request') or {}).get('subtype') == 'can_use_tool' else None
    if t == 'stream_event':
        e = msg.get('event') or {}
        if msg.get('parent_tool_use_id'):
            return None  # a subagent's text: it comes whole, in its assistant message
        if e.get('type') == 'content_block_delta' and (e.get('delta') or {}).get('type') == 'text_delta':
            return 'live'
        if e.get('type') == 'message_start':
            return 'live'
        return None
    return None


class Chat:
    def __init__(self, chat_id, argv, cwd, env, label='', key=None, mode='default', model='', history=(), effort=''):
        exe = shutil.which(argv[0])
        if not exe:
            raise StoreError(500, f'{argv[0]!r} was not found in the PATH of this server — set the full path in Settings → Command')
        self.id, self.cwd, self.label, self.key = chat_id, cwd, label, key
        self.vault = None  # the vault its record is in, set by the server: where a change of item moves it
        self.mode, self.model, self.effort = mode or 'default', model or '', effort or ''
        self.window = None  # how full the context is: {used, max, percent}, from claude's get_context_usage
        self.models = []  # what claude offers, from its `initialize` answer: [{value, label, description, resolved, efforts}]
        # Called with (model, effort) once claude has confirmed a change of either: the server keeps the record in step.
        self.on_settings = None
        self._asked = {}  # request_id → (subtype, what it was asked with), for our control requests whose answer we read
        self.started = self.activity = time.time()
        self.exit_code = None
        self.busy = False  # from a message sent to its turn's `result`
        self.pending = {}  # request_id → the can_use_tool request, until answered
        self._events = collections.deque(history, maxlen=KEEP_EVENTS)  # a resume starts with what was said before
        self._stderr = collections.deque(maxlen=STDERR_LINES)
        self._subs = set()
        self._lock = threading.Lock()
        self._write_lock = threading.Lock()
        self._seq = 0
        try:
            self._proc = subprocess.Popen([exe, *argv[1:]], cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                          stderr=subprocess.PIPE, start_new_session=True, close_fds=True)
        except OSError as e:
            raise StoreError(500, f'could not start {argv[0]}: {e}')
        threading.Thread(target=self._pump, name=f'chat-{chat_id[:8]}', daemon=True).start()
        threading.Thread(target=self._pump_stderr, name=f'chat-err-{chat_id[:8]}', daemon=True).start()
        self._control({'subtype': 'initialize', 'hooks': None})

    # ── out of claude ────────────────────────────────────────────────────────
    def _pump(self):
        for raw in self._proc.stdout:
            try:
                msg = json.loads(raw.decode('utf-8', 'replace'))
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get('type') == 'control_response':
                self._answered(msg.get('response') or {})
                continue
            k = kind(msg)
            if not k:
                continue
            t = msg.get('type')
            if t == 'control_request':
                self.pending[msg.get('request_id')] = msg['request']
            elif t == 'result':
                self.busy = False
                self._ask_context()
            elif t == 'system' and msg.get('subtype') == 'compact_boundary':
                self._ask_context()
            elif t == 'system' and msg.get('subtype') == 'init':
                self.mode = msg.get('permissionMode') or self.mode
                self.model = msg.get('model') or self.model
            self._emit(slim(msg), keep=k == 'keep')
        self._proc.stdout.close()
        self.exit_code = self._proc.wait()
        self.busy = False
        self.pending.clear()
        self._emit({'type': 'tm_exit', 'exit_code': self.exit_code, 'stderr': '\n'.join(self._stderr)})
        with self._lock:
            subs = list(self._subs)
        for q in subs:
            q.put(None)  # the sentinel: nothing more will come

    def _answered(self, response):
        """claude's answer to one of our control requests: the models it offers (`initialize`), a change of model or
        effort done (then the settings it applies are asked: claude answers out of order, so never before), the effort
        it applies (`get_settings`). A refused change is undone here and said in the chat."""
        what, ctx = self._asked.pop(response.get('request_id'), (None, {}))
        body = response.get('response') or {}
        if response.get('subtype') == 'error':
            error = str(response.get('error') or 'refused')
            if what == 'set_model':
                self.model = ctx.get('was', '')
                self._emit({'type': 'tm_model', 'model': self.model})
                self._emit({'type': 'tm_notice', 'tone': 'error', 'text': f"Claude did not switch models: {error}"})
            elif what == 'apply_flag_settings':
                self._emit({'type': 'tm_notice', 'tone': 'error', 'text': f"Claude did not change the effort: {error}"})
                self._ask('get_settings')  # what it does apply, so the menu shows it
            return
        if what == 'initialize':
            self.models = [model_choice(m) for m in body.get('models') or [] if isinstance(m, dict) and m.get('value')]
            self._emit({'type': 'tm_models', 'models': self.models}, keep=False)
            self._ask('get_settings')
        elif what == 'set_model':
            # claude gives each model its own default effort unless one was set: the session's goes on with it.
            current = self.current_model()
            effort = effort_for(self.effort, current['efforts'] if current else [])
            if effort:
                self._ask('apply_flag_settings', settings={'effortLevel': effort}, changed=True)
            else:
                self._ask('get_settings', changed=True)
        elif what == 'apply_flag_settings':
            self._ask('get_settings', changed=ctx.get('changed', False))
        elif what == 'get_settings':
            effort = (body.get('applied') or {}).get('effort')
            if isinstance(effort, str) and effort:
                self.effort = effort
                self._emit({'type': 'tm_effort', 'effort': effort}, keep=False)
            if ctx.get('changed'):
                self._settled()
        elif what == 'get_context_usage':
            used, most, pct = body.get('totalTokens'), body.get('maxTokens'), body.get('percentage')
            if all(isinstance(x, (int, float)) for x in (used, most, pct)) and most > 0:
                self.window = {'used': int(used), 'max': int(most), 'percent': int(pct)}
                self._emit({'type': 'tm_context', 'window': self.window}, keep=False)

    def _ask(self, subtype, changed=False, **request):
        """A control request whose answer _answered reads, from the reading thread: a chat that has ended asks
        nothing. `changed`: it follows a change of model or effort, which its answer then confirms."""
        try:
            self._control({'subtype': subtype, **request}, changed=changed)
        except StoreError:
            pass

    def _settled(self):
        """A change of model or effort confirmed by claude: said in the chat (kept, so a reload shows it too) and
        handed to the server for the record."""
        current = self.current_model()
        if current and not current['efforts']:
            self.effort = ''  # a model that takes none: what the last one had no longer applies
        self._emit({'type': 'tm_settings', 'model': (current['resolved'] or current['value']) if current else self.model,
                    'effort': self.effort})
        if self.on_settings:
            try:
                self.on_settings(self.model, self.effort)
            except Exception:  # the record is the server's business: the chat goes on whatever it does
                pass

    def _ask_context(self):
        """How full the context is now: asked after each turn and each compaction, answered in _answered."""
        self._ask('get_context_usage')

    def _pump_stderr(self):
        for raw in self._proc.stderr:
            self._stderr.append(raw.decode('utf-8', 'replace').rstrip())
        self._proc.stderr.close()

    def _emit(self, msg, keep=True):
        with self._lock:
            if keep:
                self._events.append(msg)
            self.activity = time.time()
            subs = list(self._subs)
        for q in subs:
            q.put(msg)

    # ── into claude ──────────────────────────────────────────────────────────
    @property
    def alive(self):
        return self.exit_code is None

    def _write(self, obj):
        if not self.alive:
            raise StoreError(409, 'this chat has ended')
        line = (json.dumps(obj) + '\n').encode('utf-8')
        with self._write_lock:
            try:
                self._proc.stdin.write(line)
                self._proc.stdin.flush()
            except (OSError, ValueError) as e:
                raise StoreError(409, f'this chat is not taking input: {e}')

    def _control(self, request, **ctx):
        with self._write_lock:
            self._seq += 1
            rid = f'tm_{self._seq}'
        self._asked[rid] = (request['subtype'], ctx)
        self._write({'type': 'control_request', 'request_id': rid, 'request': request})

    def send(self, text, items=(), images=()):
        """A message from the user, with the vault items attached to it ([{id, title, type, context}]: claude gets each
        one's context after the text, inside <attached-items>; the chat shows them as chips) and its images (see
        image_blocks). Kept as our own event (claude does not echo it), then sent: of an image, only its thumbnail."""
        text = str(text or '').strip()
        items = list(items or [])
        blocks, kept = image_blocks(images)
        if not text and not items and not blocks:
            raise StoreError(400, 'an empty message')
        content = with_items(text, items)
        if blocks:
            content = ([{'type': 'text', 'text': content}] if content else []) + blocks
        self._write({'type': 'user', 'session_id': self.id, 'parent_tool_use_id': None,
                     'message': {'role': 'user', 'content': content}})
        self.busy = True
        event = {'type': 'tm_user', 'text': text}
        if items:
            event['items'] = [{k: it.get(k) or '' for k in ('id', 'title', 'type')} for it in items]
        if kept:
            event['images'] = kept
        self._emit(event)

    def answer(self, request_id, behavior, always=False, message='', answers=None, mode=''):
        """A permission request answered from its card: allow (once, or `always` for the rest of this session) or deny.
        Allow-always adds the rules claude itself suggested, but only to this session: never to a settings file.
        Two tools have a card of their own: AskUserQuestion is allowed with the user's `answers` ({question: answer},
        one per question it asked), and ExitPlanMode — the plan approved — with the `mode` to go on in: Ask before
        edits unless another is named, never a looser one by default. Denying a plan with a message keeps Claude
        planning, with that message."""
        req = self.pending.get(request_id)
        if not req:
            raise StoreError(409, 'that request was already answered, or the turn ended')
        tool = req.get('tool_name')
        event = {}
        if behavior == 'allow' and tool == 'AskUserQuestion':
            questions = [q.get('question') for q in (req.get('input') or {}).get('questions') or [] if isinstance(q, dict)]
            if not isinstance(answers, dict) or set(answers) != set(questions) \
                    or not all(isinstance(a, str) and a.strip() and len(a) <= ANSWER_MAX for a in answers.values()):
                raise StoreError(400, 'answer each question, in a few words')
            answers = {q: answers[q].strip() for q in questions}
            response = {'behavior': 'allow', 'updatedInput': {**(req.get('input') or {}), 'answers': answers}}
            event['answers'] = answers
        elif behavior == 'allow' and tool == 'ExitPlanMode':
            mode = mode or 'default'
            if mode not in CHAT_MODES or mode == 'plan':
                raise StoreError(400, f"after a plan, the mode is one of {', '.join(m for m in CHAT_MODES if m != 'plan')}")
            response = {'behavior': 'allow', 'updatedInput': req.get('input') or {},
                        'updatedPermissions': [{'type': 'setMode', 'mode': mode, 'destination': 'session'}]}
            self.mode = mode
            self._emit({'type': 'tm_mode', 'mode': mode})
            event['mode'] = mode
        elif behavior == 'allow':
            response = {'behavior': 'allow', 'updatedInput': req.get('input') or {}}
            if always:
                rules = [{**s, 'destination': 'session'} for s in (req.get('permission_suggestions') or [])
                         if isinstance(s, dict) and s.get('type') == 'addRules']
                if rules:
                    response['updatedPermissions'] = rules
        elif behavior == 'deny':
            message = str(message or '').strip()
            response = {'behavior': 'deny', 'message': message or 'The user denied this.'}
            if message:
                event['message'] = message
        else:
            raise StoreError(400, 'behavior must be allow or deny')
        self._write({'type': 'control_response',
                     'response': {'subtype': 'success', 'request_id': request_id, 'response': response}})
        self.pending.pop(request_id, None)
        self._emit({'type': 'tm_answer', 'request_id': request_id, 'behavior': behavior, 'always': bool(always), **event})
        return {'ok': True}

    def interrupt(self):
        """Stops the turn running now; the session goes on. Unanswered requests are dropped with it."""
        self._control({'subtype': 'interrupt'})
        for rid in list(self.pending):
            self.pending.pop(rid, None)
            self._emit({'type': 'tm_answer', 'request_id': rid, 'behavior': 'interrupted'})
        return {'ok': True}

    def set_mode(self, mode):
        if mode not in CHAT_MODES:
            raise StoreError(400, f"mode must be one of {', '.join(CHAT_MODES)}")
        self._control({'subtype': 'set_permission_mode', 'mode': mode})
        self.mode = mode
        self._emit({'type': 'tm_mode', 'mode': mode})
        return {'mode': mode}

    def set_model(self, model):
        """One of the models claude listed (any of CLAUDE_MODELS until it has). Once claude has switched, the session's
        effort is set on the new model (effort_for), then what it applies is read back and the change said in the
        chat; if claude refuses, the model it had comes back (_answered)."""
        if self.models and model not in {m['value'] for m in self.models}:
            raise StoreError(400, f"model must be one of {', '.join(m['value'] for m in self.models)}")
        self._control({'subtype': 'set_model', 'model': model}, was=self.model)
        self.model = model
        self._emit({'type': 'tm_model', 'model': model})
        return {'model': model}

    def set_effort(self, effort):
        """How hard the model thinks, for the rest of this session: a flag setting of claude's own (in memory, never a
        settings file), within what the current model supports. It holds across a change of model (set_model). What
        claude applies is read back once it has taken it."""
        current = self.current_model()
        allowed = current['efforts'] if current else CLAUDE_EFFORTS
        if not allowed:
            raise StoreError(400, f"{current['label']} takes no effort level")
        if effort not in allowed:
            raise StoreError(400, f"effort must be one of {', '.join(allowed)}")
        self._control({'subtype': 'apply_flag_settings', 'settings': {'effortLevel': effort}}, changed=True)
        self.effort = effort
        self._emit({'type': 'tm_effort', 'effort': effort}, keep=False)
        return {'effort': effort}

    def current_model(self):
        """The entry of self.models the session runs (by alias or by full id; an alias first), or None."""
        hits = [m for m in self.models if self.model in (m['value'], m['resolved'])]
        return next((m for m in hits if m['value'] != 'default'), hits[0] if hits else None)

    def kill(self, grace=3.0):
        """Closing stdin ends claude cleanly (it saves the transcript); then SIGTERM, then SIGKILL if it lingers."""
        if not self.alive:
            return
        try:
            self._proc.stdin.close()
        except OSError:
            pass
        for step, wait in ((None, grace), (self._proc.terminate, 2), (self._proc.kill, 5)):
            if step:
                try:
                    step()
                except OSError:
                    pass
            try:
                self._proc.wait(timeout=wait)
                break
            except subprocess.TimeoutExpired:
                continue
        for _ in range(100):  # _pump sets exit_code once stdout is drained
            if not self.alive:
                break
            time.sleep(0.02)

    # ── listeners ────────────────────────────────────────────────────────────
    def subscribe(self):
        """→ (the conversation so far, a queue of the messages to come; None on it means the end)."""
        q = queue.Queue()
        with self._lock:
            snapshot = list(self._events)
            self._subs.add(q)
            ended = not self.alive
        if ended:
            q.put(None)
        return snapshot, q

    def unsubscribe(self, q):
        with self._lock:
            self._subs.discard(q)

    def info(self):
        return {'id': self.id, 'label': self.label, 'key': self.key, 'vault': self.vault, 'cwd': self.cwd, 'alive': self.alive,
                'exit_code': self.exit_code, 'busy': self.busy and self.alive, 'pending': len(self.pending),
                'mode': self.mode, 'model': self.model, 'effort': self.effort, 'models': self.models, 'window': self.window,
                'started': self.started, 'activity': self.activity}


class Chats:
    """The chats this server runs, by Claude session id. An ended one stays listed (its conversation can still be
    read) until it is closed."""

    def __init__(self):
        self._by_id = {}
        self._lock = threading.Lock()

    def open(self, chat_id, argv, cwd, env, label='', key=None, mode='default', model='', prompt=None, history=(), effort=''):
        """Start one (and send `prompt` as its first message), or hand back the live chat of that session."""
        with self._lock:
            cur = self._by_id.get(chat_id)
            if cur and cur.alive:
                return cur
            chat = Chat(chat_id, argv, cwd, env, label, key, mode, model, history, effort)
            self._by_id[chat_id] = chat
        if prompt:
            chat.send(prompt)
        return chat

    def get(self, chat_id):
        chat = self._by_id.get(str(chat_id or ''))
        if not chat:
            raise StoreError(404, 'no such chat')
        return chat

    def live(self, chat_id):
        chat = self._by_id.get(str(chat_id or ''))
        return chat if chat and chat.alive else None

    def list(self):
        return [c.info() for c in sorted(self._by_id.values(), key=lambda c: c.started)]

    def close(self, chat_id):
        with self._lock:
            chat = self._by_id.pop(str(chat_id or ''), None)
        if not chat:
            raise StoreError(404, 'no such chat')
        chat.kill()
        return {'closed': chat_id, 'exit_code': chat.exit_code}

    def close_all(self):
        for chat_id in list(self._by_id):
            try:
                self.close(chat_id)
            except StoreError:
                pass
