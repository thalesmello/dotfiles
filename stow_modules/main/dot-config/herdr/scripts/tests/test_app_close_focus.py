"""App close-focus regression tests: all IPC mocked; no live panes touched."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('app_confirm_close', Path(__file__).resolve().parents[1] / 'confirm-close.py')
cc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cc)


class Runner(cc.HerdrRunner):
    def __init__(self, agents, panes=None, close_error=False):
        self.socket_path = None
        self.bin_path = None
        self.agents = agents
        self.panes = panes or [{'pane_id': 'p1'}]
        self.close_error = close_error
        self.calls = []

    def call(self, method, params, cli_args):
        self.calls.append((method, params))
        if method == 'pane.layout':
            return {'layout': {'panes': self.panes}}
        if method == 'agent.list':
            return {'agents': self.agents}
        if method == 'pane.close' and self.close_error:
            raise RuntimeError('close failed')
        return {}


def agent(address, pane, focused=False, status='idle', seq=1):
    return {'terminal_id': address, 'pane_id': pane, 'focused': focused,
            'agent_status': status, 'state_change_seq': seq}


class AppCloseFocusTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        self.env = patch.dict(os.environ, {'HC_PRESET_BACKEND': 'hc', 'HERDR_APP_HOME': self.home.name}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def publish(self, order):
        Path(self.home.name, 'shared.json').write_text(json.dumps({'agents.visibleOrder': order}))

    def test_qualified_ids_both_directions_and_full_focus_close_sequence(self):
        for source, target in [('t1', 'remote/t1'), ('remote/t1', 't1')]:
            with self.subTest(source=source):
                # Raw smart ranking contradicts the sidebar; the sidebar wins.
                self.publish([source, target, 't2'])
                rows = [agent(source, 'p-source', True), agent(target, 'p-target'),
                        agent('t2', 'p-other', status='working', seq=100)]
                runner = Runner(rows)
                cc.close_pane(runner, 'p-source')
                self.assertEqual(runner.calls, [
                    ('pane.layout', {'pane_id': 'p-source'}), ('agent.list', {}),
                    ('agent.focus', {'target': 'p-target'}),
                    ('pane.close', {'pane_id': 'p-source'}),
                    ('agent.focus', {'target': 'p-target'}),
                ])

    def test_hidden_agents_are_never_appended_and_stale_successors_are_skipped(self):
        self.publish(['t1', 'gone', 'remote/t1', 't2'])
        rows = [agent('t1', 'p1', True), agent('hidden', 'p-hidden', status='working', seq=100),
                agent('remote/t1', 'remote/p1'), agent('t2', 'p2')]
        self.assertEqual(cc.next_agent_to_focus(Runner(rows), 'p1'), 'remote/p1')

    def test_last_row_uses_previous_visible_row(self):
        self.publish(['t1', 'remote/t1', 't2'])
        rows = [agent('t1', 'p1'), agent('remote/t1', 'remote/p1'), agent('t2', 'p2', True)]
        self.assertEqual(cc.next_agent_to_focus(Runner(rows), 'p2'), 'remote/p1')

    def test_siblings_keep_native_focus(self):
        self.publish(['t1', 'remote/t1'])
        runner = Runner([agent('t1', 'p1', True), agent('remote/t1', 'remote/p1')],
                        [{'pane_id': 'p1'}, {'pane_id': 'shell-or-mod'}])
        cc.close_pane(runner, 'p1')
        self.assertEqual([method for method, _ in runner.calls], ['pane.layout', 'pane.close'])

    def test_missing_or_corrupt_order_does_not_fall_back_to_tui(self):
        rows = [agent('t1', 'p1', True), agent('t2', 'p2')]
        for raw in [None, '{', '[]', '{}', '{"agents.visibleOrder": [1]}']:
            with self.subTest(raw=raw):
                path = Path(self.home.name, 'shared.json')
                if raw is None:
                    path.unlink(missing_ok=True)
                else:
                    path.write_text(raw)
                self.assertIsNone(cc.next_agent_to_focus(Runner(rows), 'p1'))

    def test_background_close_never_steals_focus(self):
        self.publish(['t1', 'remote/t1', 't2'])
        rows = [agent('t1', 'p1'), agent('remote/t1', 'remote/p1'), agent('t2', 'p2', True)]
        self.assertIsNone(cc.next_agent_to_focus(Runner(rows), 'p1'))

    def test_failed_close_restores_original_focus(self):
        self.publish(['t1', 'remote/t1'])
        runner = Runner([agent('t1', 'p1', True), agent('remote/t1', 'remote/p1')], close_error=True)
        with self.assertRaisesRegex(RuntimeError, 'close failed'):
            cc.close_pane(runner, 'p1')
        self.assertEqual(runner.calls[-1], ('agent.focus', {'target': 'p1'}))

    def test_terminal_address_target_also_matches_exactly(self):
        rows = [agent('t1', 'p1'), agent('remote/t1', 'remote/p1', True), agent('t2', 'p2')]
        self.assertEqual(cc.pick_app_next_agent(rows, 'remote/t1', ['t1', 'remote/t1', 't2']), 'p2')

    def test_tui_keeps_its_existing_order(self):
        runner = Runner([])
        runner.socket_path = '/tmp/legacy-herdr.sock'
        self.publish(['remote/t1', 't1'])
        self.assertIsNone(cc.app_agent_order(runner))


if __name__ == '__main__':
    unittest.main()
