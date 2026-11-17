import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[2] / 'stow_modules/main/dot-config/herdr/scripts/hc-agent-session.py'
spec = importlib.util.spec_from_file_location('hc_agent_session', path)
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)


class SessionHookTest(unittest.TestCase):
    def run_hook(self, event, observed=None, env=None):
        calls = []
        def call(args):
            calls.append(args)
            return observed or {'foreground': {'argv': ['claude']}, 'labels': {}}
        hook.handle(event, {'HC_TERMINAL_ID': 't1'} if env is None else env, call)
        return calls

    def test_start_publishes_exact_session(self):
        calls = self.run_hook({'hook_event_name': 'SessionStart', 'session_id': 'abc'})
        self.assertEqual(calls[-1], ['label', 't1', 'agent.kind=claude', 'agent.session=abc', 'agent.session_kind=id'])

    def test_node_claude_launcher(self):
        calls = self.run_hook({'hook_event_name': 'SessionStart', 'session_id': 'abc'},
                              {'foreground': {'argv': ['node', '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js']}})
        self.assertEqual(calls[-1][0], 'label')

    def test_no_core_or_subagent_is_ignored(self):
        event = {'hook_event_name': 'SessionStart', 'session_id': 'abc'}
        self.assertEqual(self.run_hook(event, env={}), [])
        self.assertEqual(self.run_hook({**event, 'agent_id': 'child'}), [])
        self.assertEqual(self.run_hook(event, env={'HC_TERMINAL_ID': 'devserver/t1'}), [])

    def test_print_children_and_other_agent_terminals_are_ignored(self):
        event = {'hook_event_name': 'SessionStart', 'session_id': 'abc'}
        for argv in (['claude', '-p', 'task'], ['claude', '--output-format=json', 'task'], ['pi']):
            calls = self.run_hook(event, {'foreground': {'argv': argv}})
            self.assertEqual(len(calls), 1)
        calls = self.run_hook(event, {'foreground': {'argv': ['claude']}, 'labels': {'agent.kind': 'pi'}})
        self.assertEqual(len(calls), 1)

    def test_end_clears_only_matching_session(self):
        event = {'hook_event_name': 'SessionEnd', 'session_id': 'abc'}
        calls = self.run_hook(event, {'labels': {'agent.kind': 'claude', 'agent.session': 'abc'}})
        self.assertEqual(calls[-1], ['label', 't1', 'agent.kind=', 'agent.session=', 'agent.session_kind='])
        calls = self.run_hook(event, {'labels': {'agent.kind': 'claude', 'agent.session': 'new'}})
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
