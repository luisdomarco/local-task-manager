"""A Claude Code transcript (~/.claude/projects/…/<session id>.jsonl) read back as the chat's own messages, so a
resumed session opens with what was said before. Only read, never written: the file is Claude Code's.

Of its lines only the conversation is kept — `user` and `assistant` with a `message` — and of those not the ones
Claude Code adds for itself (`isMeta`, a subagent's `isSidechain`, the wrappers of a slash command). A typed message
becomes our own `tm_user`, as a live chat records it; tool results and assistant blocks stay as they are."""
import json

from .chat import KEEP_EVENTS, slim, split_items

WRAPPERS = ('<command-name>', '<command-message>', '<local-command-stdout>', '<system-reminder>')


def history(path, limit=KEEP_EVENTS):
    """→ the last `limit` messages of the transcript at `path`, in the chat's shapes; [] when it cannot be read."""
    out = []
    try:
        f = open(path, encoding='utf-8')
    except (OSError, TypeError):
        return out
    with f:
        for line in f:
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if not isinstance(rec, dict) or rec.get('isMeta') or rec.get('isSidechain'):
                continue
            t, msg = rec.get('type'), rec.get('message')
            if t not in ('user', 'assistant') or not isinstance(msg, dict):
                continue
            if t == 'user' and isinstance(msg.get('content'), str):
                text = msg['content'].strip()
                if text and not text.startswith(WRAPPERS):
                    out.append(_typed(text))
                continue
            if t == 'user' and isinstance(msg.get('content'), list):
                texts = [b.get('text', '') for b in msg['content'] if isinstance(b, dict) and b.get('type') == 'text']
                if any(x.startswith('[Request interrupted') for x in texts):
                    out.append({'type': 'tm_answer', 'behavior': 'interrupted', 'request_id': None})
                    continue
                if not any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in msg['content']):
                    text = '\n'.join(x.strip() for x in texts if x.strip() and not x.strip().startswith(WRAPPERS))
                    images = [{'media_type': (b.get('source') or {}).get('media_type') or ''} for b in msg['content']
                              if isinstance(b, dict) and b.get('type') == 'image']
                    if text or images:  # a message typed with something attached: its text, and its images (no copy kept)
                        out.append({**_typed(text), **({'images': images} if images else {})})
                    continue
            out.append(slim({'type': t, 'message': msg, 'history': True}))
    return out[-limit:]


def _typed(content):
    """A message the user typed, as the live chat records it: its text, and the vault items attached to it as chips."""
    text, items = split_items(content)
    return {'type': 'tm_user', 'text': text, **({'items': items} if items else {})}
