#!/usr/bin/env python3
"""Claude lifecycle sidecar: exact Core session labels, alongside managed hooks.

Never sends a prompt or reads a transcript. Root interactive sessions only;
non-Core terminals, SDK/subagent hooks and another agent's terminal are ignored.
"""
import json
import os
import shutil
import subprocess
import sys

TIMEOUT = 1.5


def core(args):
    binary = shutil.which('hc') or os.path.expanduser('~/.local/bin/hc')
    reply = subprocess.run([binary, *args], capture_output=True, text=True,
                           timeout=TIMEOUT, check=True)
    return json.loads(reply.stdout) if reply.stdout.strip() else {}


def handle(event, env=None, call=core):
    env = os.environ if env is None else env
    terminal = env.get('HC_TERMINAL_ID', '')
    if not terminal or '/' in terminal or not isinstance(event, dict):
        return
    if event.get('agent_id') or event.get('is_subagent') or env.get('CURSOR_VERSION'):
        return
    name = event.get('hook_event_name')
    session = event.get('session_id')
    if name not in ('SessionStart', 'SessionEnd') or not isinstance(session, str) or not session:
        return
    observed = call(['get', terminal, '--json'])
    labels = observed.get('labels') or {}
    if labels.get('agent.kind') not in (None, '', 'claude', 'claude-code'):
        return  # A tool launched Claude inside a Pi/Codex terminal.
    if name == 'SessionEnd':
        if labels.get('agent.session') != session:
            return  # A stale ending must not clear a newer conversation.
        call(['label', terminal, 'agent.kind=', 'agent.session=', 'agent.session_kind='])
        return
    foreground = observed.get('foreground') or {}
    argv = foreground.get('argv') or []
    if not argv or not any(os.path.basename(str(arg)).removesuffix('.real') in ('claude', 'claude-code') or str(arg).endswith('/@anthropic-ai/claude-code/cli.js') for arg in argv):
        return  # The terminal belongs to an interactive parent, not this hook.
    if any(arg in ('-p', '--print', '--output-format', '--input-format') or str(arg).startswith(('--print=', '--output-format=', '--input-format=')) for arg in argv):
        return  # One-shot / SDK children must never replace root session labels.
    call(['label', terminal, 'agent.kind=claude', f'agent.session={session}', 'agent.session_kind=id'])


def main():
    try:
        payload = sys.stdin.read(128 * 1024 + 1)
        if len(payload) <= 128 * 1024:
            handle(json.loads(payload))
    except (ValueError, OSError, subprocess.SubprocessError):
        pass  # Metadata must never prevent Claude from starting or closing.
    return 0


if __name__ == '__main__':
    sys.exit(main())
