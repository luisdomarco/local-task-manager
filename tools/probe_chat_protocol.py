#!/usr/bin/env python3
"""Check that the installed `claude` speaks the stream-json control protocol the chat dock relies on.

    python3 tools/probe_chat_protocol.py [--model haiku] [--keep] [--record FILE]

Runs claude in a throwaway folder (never a vault, never this checkout) and walks the four things tm/chat.py needs:
  1. a user message in, NDJSON out, ending in a `result`;
  2. a tool call that needs permission arrives as a `control_request` `can_use_tool`, and an `allow` sent back on stdin
     lets it run;
  3. a `deny` is honoured;
  4. an `interrupt` control request ends a running turn.
Every line read is printed (shortened), and the exit code is 0 only when the four checks pass. It costs one short
session on the model you pick.
"""
import argparse
import json
import os
import queue
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--claude', default='claude')
    ap.add_argument('--model', default='haiku')
    ap.add_argument('--keep', action='store_true', help='keep the temp folder')
    ap.add_argument('--record', metavar='FILE', help='also write every raw line read to FILE')
    args = ap.parse_args()

    tmp = tempfile.mkdtemp(prefix='tm-chat-probe-')
    sid = str(uuid.uuid4())
    argv = [*shlex.split(args.claude), '-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
            '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio',
            '--permission-mode', 'default', '--model', args.model, '--session-id', sid]
    print('$', ' '.join(shlex.quote(a) for a in argv), f'(cwd {tmp})')
    proc = subprocess.Popen(argv, cwd=tmp, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, bufsize=1)
    lines = queue.Queue()

    rec = open(args.record, 'w') if args.record else None

    def pump():
        for line in proc.stdout:
            if rec:
                rec.write(line)
            lines.put(line)
        lines.put(None)
    threading.Thread(target=pump, daemon=True).start()
    threading.Thread(target=lambda: [sys.stderr.write('  stderr: ' + l) for l in proc.stderr], daemon=True).start()

    seq = [0]

    def send(obj):
        proc.stdin.write(json.dumps(obj) + '\n')
        proc.stdin.flush()

    def control(request):
        seq[0] += 1
        rid = f'req_{seq[0]}'
        send({'type': 'control_request', 'request_id': rid, 'request': request})
        return rid

    def user(text):
        send({'type': 'user', 'session_id': sid, 'parent_tool_use_id': None,
              'message': {'role': 'user', 'content': text}})

    def answer(rid, response):
        send({'type': 'control_response', 'response': {'subtype': 'success', 'request_id': rid, 'response': response}})

    def until(pred, timeout=120, on_permission=None):
        end = time.time() + timeout
        while time.time() < end:
            try:
                line = lines.get(timeout=1)
            except queue.Empty:
                continue
            if line is None:
                return None
            try:
                msg = json.loads(line)
            except ValueError:
                print('  (not json)', line[:120].rstrip())
                continue
            kind = msg.get('type')
            sub = msg.get('subtype') or (msg.get('request') or {}).get('subtype') or (msg.get('event') or {}).get('type')
            if kind != 'stream_event':
                print(f'  ← {kind}/{sub}', json.dumps(msg)[:220])
            if kind == 'control_request' and (msg.get('request') or {}).get('subtype') == 'can_use_tool' and on_permission:
                on_permission(msg)
            if pred(msg):
                return msg
        return None

    ok = {}
    try:
        init = control({'subtype': 'initialize', 'hooks': None})
        until(lambda m: m.get('type') == 'control_response', timeout=60)

        print('\n— 1+2: allow a Bash call')
        seen = []
        # A command that writes: read-only ones (echo, ls) are approved by claude itself and never ask.
        user('Run exactly this shell command with the Bash tool, nothing else: touch allowed.txt')
        res = until(lambda m: m.get('type') == 'result', on_permission=lambda m: (
            seen.append(m), answer(m['request_id'], {'behavior': 'allow', 'updatedInput': m['request']['input']})))
        ok['result'] = bool(res)
        ok['allow'] = bool(seen) and os.path.exists(os.path.join(tmp, 'allowed.txt'))

        print('\n— 3: deny a Bash call')
        denied = []
        user('Now run exactly this with the Bash tool, nothing else: touch denied.txt')
        res = until(lambda m: m.get('type') == 'result', on_permission=lambda m: (
            denied.append(m), answer(m['request_id'], {'behavior': 'deny', 'message': 'The user denied this.'})))
        ok['deny'] = bool(denied) and bool(res) and not os.path.exists(os.path.join(tmp, 'denied.txt'))

        print('\n— 4: interrupt a running turn')
        user('Count slowly from 1 to 200, one number per line, with a short comment on each number.')
        until(lambda m: m.get('type') == 'stream_event', timeout=60)
        rid = control({'subtype': 'interrupt'})
        res = until(lambda m: m.get('type') == 'result', timeout=60)
        ok['interrupt'] = bool(res)
    finally:
        try:
            proc.stdin.close()
        except OSError:
            pass
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
        if rec:
            rec.close()
        if not args.keep:
            # and the transcript folder claude made for it (~/.claude/projects/<folder with non-alphanumerics as ->)
            projects = os.path.join(os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude'), 'projects')
            shutil.rmtree(os.path.join(projects, re.sub(r'[^A-Za-z0-9]', '-', os.path.realpath(tmp))), ignore_errors=True)
            shutil.rmtree(tmp, ignore_errors=True)

    print('\nchecks:', json.dumps(ok))
    return 0 if ok and all(ok.values()) else 1


if __name__ == '__main__':
    sys.exit(main())
