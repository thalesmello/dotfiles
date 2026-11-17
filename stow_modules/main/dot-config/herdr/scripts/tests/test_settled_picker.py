"""Connected-machine picker filters, async races, selection, and owner actions."""
import copy
import importlib.util
from pathlib import Path
import sys
import threading
import unittest
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import settled_picker as picker

spec = importlib.util.spec_from_file_location('settled_picker_legacy', SCRIPTS / 'herdr-settled.py')
legacy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = legacy
spec.loader.exec_module(legacy)
MachinePicker = picker.picker_class(legacy)


def row(machine, key='same', stamp=100, **extra):
    return {'kind': 'settled', 'key': str(machine) + ':' + key, 'origin_key': key,
            'machine': machine, 'machine_label': machine or 'Local', 'core_id': str(machine),
            'namespace': 'default', 'title': 'Work ' + str(machine), 'agent_name': 'pi',
            'workspace_label': 'Project', 'cwd': '/repo', 'settled_at': stamp,
            'transcript': '/not-local/transcript.jsonl', 'gone': False, **extra}


class Provider:
    def __init__(self):
        self.names = [None, 'devserver']
        self.identities = {None: 'None', 'devserver': 'devserver', 'all': 'all'}
        self.rows = [row(None, stamp=200), row('devserver')]
        self.actions = []
        self.previews = []
        self.snapshot_started = threading.Event()
        self.release_snapshot = threading.Event()
        self.slow = False
        self.preview_release = threading.Event()
        self.preview_started = threading.Event()
        self.slow_preview = False
        self.preview_failures = 0
        self.slow_action = False
        self.action_started = threading.Event()
        self.release_action = threading.Event()

    def connected(self):
        return [{'name': name, 'label': name or 'Local', 'core_id': self.identities[name], 'namespace': 'default'} for name in self.names]

    def snapshot(self):
        result = {'machines': self.connected(), 'rows': copy.deepcopy(self.rows)}
        if self.slow:
            self.snapshot_started.set()
            if not self.release_snapshot.wait(2):
                raise RuntimeError('test snapshot was not released')
        return result

    def preview(self, selected):
        self.previews.append(selected['machine'])
        self.preview_started.set()
        if self.slow_preview and not self.preview_release.wait(2):
            raise RuntimeError('test preview was not released')
        if self.preview_failures:
            self.preview_failures -= 1
            raise RuntimeError('temporary preview failure')
        return {'messages': [['assistant', 'Preview from ' + str(selected['machine'])]], 'gone': False}

    def action(self, selected, action):
        self.action_started.set()
        if self.slow_action and not self.release_action.wait(2):
            raise RuntimeError('test action was not released')
        if selected['machine'] not in self.names:
            raise RuntimeError('disconnected')
        self.actions.append((selected['machine'], selected['origin_key'], action))
        self.rows = [r for r in self.rows if r['key'] != selected['key']]
        if action == 'forget':
            return 'forgot ' + selected['origin_key']
        return 'reopened in ' + str(selected['machine']) + '/t1'


class PickerTest(unittest.TestCase):
    def setUp(self):
        self.provider = Provider()
        self.now = 0
        self.panel = MachinePicker(self.provider, clock=lambda: self.now)
        self.addCleanup(self.panel.close)
        self.addCleanup(self.provider.release_snapshot.set)
        self.addCleanup(self.provider.preview_release.set)
        self.addCleanup(self.provider.release_action.set)
        self.drain()

    def drain(self):
        for _ in range(5):
            tasks = list(self.panel.tasks.values())
            if not tasks:
                return
            for task in tasks:
                self.assertTrue(task.done.wait(1))
            self.panel.refresh_background()

    def test_default_all_and_tab_cycle_only_connected_machines(self):
        self.assertIs(self.panel.machine_filter, picker.ALL)
        self.assertEqual([r['machine'] for r in self.panel.rows], [None, 'devserver'])
        self.panel.cycle_filter(1)
        self.assertIsNone(self.panel.machine_filter)
        self.assertEqual([r['machine'] for r in self.panel.rows], [None])
        self.panel.cycle_filter(1)
        self.assertEqual(self.panel.machine_filter, 'devserver')
        self.assertEqual([r['machine'] for r in self.panel.rows], ['devserver'])
        self.panel.cycle_filter(1)
        self.assertIs(self.panel.machine_filter, picker.ALL)
        self.panel.cycle_filter(-1)
        self.assertEqual(self.panel.machine_filter, 'devserver')

    def test_tab_switches_machine_even_during_search(self):
        class Term:
            cols, rows = 100, 18
            events = iter([('tab', b'\t'), ('enter', b'\r'), ('esc', b'q')])
            def key(self, timeout=None): return next(self.events)
            def draw(self, lines): pass
        self.panel.query = 'project'
        self.panel.searching = True
        self.panel.apply_view()
        legacy._picker_loop(self.panel, Term())
        self.assertIsNone(self.panel.machine_filter)
        self.assertEqual(self.panel.query, 'project')
        self.assertEqual([r['machine'] for r in self.panel.rows], [None])

    def test_machine_literally_named_all_is_not_the_all_filter(self):
        self.provider.names.append('all')
        self.provider.rows.append(row('all'))
        self.now = 3
        self.panel.refresh_background()
        self.drain()
        self.panel.cycle_filter(1)  # Local
        self.panel.cycle_filter(1)  # named 'all'
        self.assertEqual(self.panel.machine_filter, 'all')
        self.assertEqual([r['machine'] for r in self.panel.rows], ['all'])

    def test_disconnected_rows_filter_and_marks_disappear_while_open(self):
        self.panel.cycle_filter(-1)
        self.panel.marked.add(self.panel.rows[0]['key'])
        self.provider.names = [None]
        self.now = 1
        self.panel.refresh_background()
        self.drain()
        self.assertIs(self.panel.machine_filter, picker.ALL)
        self.assertEqual([r['machine'] for r in self.panel.rows], [None])
        self.assertEqual(self.panel.machine_choices(), [picker.ALL, None])
        self.assertEqual(self.panel.marked, set())

    def test_disconnect_drops_late_snapshot_without_hiding_local(self):
        self.provider.slow = True
        self.now = 3
        self.panel.refresh_background()
        self.assertTrue(self.provider.snapshot_started.wait(1))
        self.provider.names = [None]
        self.now = 4
        self.panel.refresh_background()
        connection = self.panel.tasks.get('connections')
        if connection:
            self.assertTrue(connection.done.wait(1))
            self.panel.refresh_background()
        self.assertEqual([r['machine'] for r in self.panel.rows], [None])
        self.provider.release_snapshot.set()
        self.drain()
        self.assertEqual([r['machine'] for r in self.panel.rows], [None])

    def test_same_name_core_replacement_removes_old_rows_and_previews(self):
        remote = self.panel.rows[1]
        self.panel.preview(remote)
        self.drain()
        self.assertIn(remote['key'], self.panel.preview_results)
        self.provider.identities['devserver'] = 'replacement-core'
        self.now = 1
        self.panel.refresh_background()
        self.drain()
        self.assertEqual([r['machine'] for r in self.panel.rows], [None])
        self.assertNotIn(remote['key'], self.panel.preview_results)
        self.assertEqual(self.panel.preview(remote), [])

    def test_slow_action_keeps_connection_updates_and_close_responsive(self):
        remote = self.panel.rows[1]
        self.provider.slow_action = True
        self.panel.act('enter', remote)
        self.assertTrue(self.provider.action_started.wait(1))
        action = self.panel.tasks['action']
        self.provider.names = [None]
        self.now = 1
        self.panel.refresh_background()
        connections = self.panel.tasks['connections']
        self.assertTrue(connections.done.wait(1))
        self.panel.refresh_background()
        self.assertEqual([r['machine'] for r in self.panel.rows], [None])
        self.panel.cycle_filter(1)
        self.assertIsNone(self.panel.machine_filter)
        self.panel.close()
        self.assertFalse(action.done.is_set(), 'close must not join an issued slow action')
        self.provider.release_action.set()
        self.assertTrue(action.done.wait(1))

    def test_transient_preview_error_retries_after_short_expiry(self):
        remote = self.panel.rows[1]
        self.provider.preview_failures = 1
        self.panel.preview(remote)
        self.drain()
        self.assertIn('Preview unavailable', self.panel.preview(remote)[0][1])
        self.now = 3
        self.panel.preview(remote)
        self.drain()
        self.assertEqual(self.panel.preview(remote), [['assistant', 'Preview from devserver']])
        self.assertEqual(self.provider.previews, ['devserver', 'devserver'])

    def test_draw_refreshes_current_terminal_dimensions_before_layout(self):
        class Term:
            rows, cols = 40, 200
            def refresh_size(self): self.rows, self.cols = 12, 60
            def draw(self, lines): self.lines = lines
        term = Term()
        self.panel.draw(term)
        self.assertEqual(len(term.lines), 12)
        self.assertLessEqual(len(legacy._ANSI.sub('', term.lines[0])), 60)

    def test_archive_and_preview_text_cannot_inject_terminal_controls(self):
        self.provider.rows[0]['title'] = '\x1b]52;c;secret\x07Title'
        self.now = 3
        self.panel.reload()
        self.drain()
        self.assertNotIn('\x1b', self.panel.rows[0]['title'])
        key = self.panel.rows[0]['key']
        self.panel.preview_results[key] = {'messages': [['user', '\x1b]52;c;secret\x07text']], 'gone': False}
        self.assertNotIn('\x1b', self.panel.preview(self.panel.rows[0])[0][1])

    def test_core_viewport_size_overrides_stale_os_terminal_size(self):
        self.panel.close()
        self.provider.terminal_size = lambda terminal: (60, 12)
        with mock.patch.dict(picker.os.environ, {'HC_TERMINAL_ID': 't-view'}):
            self.panel = MachinePicker(self.provider, clock=lambda: self.now)
        self.addCleanup(self.panel.close)
        self.drain()
        class Term:
            rows, cols = 120, 200
            def refresh_size(self): raise AssertionError('stale OS ioctl used instead of Core viewport')
            def draw(self, lines): self.lines = lines
        term = Term()
        self.panel.draw(term)
        self.assertEqual((term.cols, term.rows, len(term.lines)), (60, 12, 12))
        self.provider.terminal_size = lambda terminal: (70, 14)
        self.now = 1
        self.panel.refresh_background()
        self.drain()
        self.panel.draw(term)
        self.assertEqual((term.cols, term.rows, len(term.lines)), (70, 14, 14))

    def test_search_combines_machine_project_title_and_cwd(self):
        self.panel.query = 'devserver'
        self.panel.request_filter('search')
        self.assertEqual([r['machine'] for r in self.panel.rows], ['devserver'])
        self.panel.query = 'project'
        self.panel.request_filter('search')
        self.assertEqual(len(self.panel.rows), 2)
        self.panel.cycle_filter(1)
        self.assertEqual([r['machine'] for r in self.panel.rows], [None])

    def test_only_settled_rows_even_when_section_shortcuts_are_pressed(self):
        self.provider.rows.append(row(None, key='live', kind='live'))
        self.now = 3
        self.panel.reload()
        self.drain()
        self.panel.set_filter('working')
        self.assertTrue(all(r['kind'] == 'settled' for r in self.panel.rows))
        self.assertEqual(len(self.panel.rows), 2)

    def test_selection_survives_periodic_metadata_refresh(self):
        self.panel.selected = 1
        key = self.panel.rows[1]['key']
        self.now = 3
        self.panel.reload()
        self.drain()
        self.assertEqual(self.panel.rows[self.panel.selected]['key'], key)

    def test_preview_nonblocking_and_routes_to_the_selected_owner(self):
        self.provider.slow_preview = True
        selected = self.panel.rows[1]
        result = self.panel.preview(selected)
        self.assertIn('loading transcript', result[0][1])
        self.assertTrue(self.provider.preview_started.wait(1))
        self.assertEqual(self.provider.previews, ['devserver'])
        self.provider.preview_release.set()
        self.drain()
        self.assertEqual(self.panel.preview(selected), [['assistant', 'Preview from devserver']])

    def test_restore_and_forget_use_origin_not_composite_key(self):
        remote = self.panel.rows[1]
        self.assertFalse(self.panel.act('forget', remote))
        self.drain()
        self.assertEqual(self.provider.actions[-1], ('devserver', 'same', 'forget'))
        self.assertEqual([r['machine'] for r in self.panel.rows], [None])
        local = self.panel.rows[0]
        self.assertFalse(self.panel.act('enter', local), 'input loop closes only after asynchronous success')
        self.drain()
        self.assertTrue(self.panel.completed_restore)
        self.assertEqual(self.provider.actions[-1], (None, 'same', 'reopen'))

    def test_offline_action_is_refused_before_next_connectivity_poll(self):
        remote = self.panel.rows[1]
        self.provider.names = [None]
        self.assertFalse(self.panel.act('enter', remote))
        self.drain()
        self.assertIn('disconnected', self.panel.flash)
        self.assertEqual(self.provider.actions, [])

    def test_pre_forget_snapshot_cannot_reintroduce_forgotten_row(self):
        local = self.panel.rows[0]
        self.provider.slow = True
        self.now = 3
        self.panel.refresh_background()
        self.assertTrue(self.provider.snapshot_started.wait(1))
        self.panel.act('forget', local)
        self.assertTrue(self.panel.tasks['action'].done.wait(1))
        self.panel.refresh_background()
        self.assertNotIn(local['key'], [r['key'] for r in self.panel.rows])
        self.provider.slow = False
        self.provider.release_snapshot.set()
        self.drain()
        self.assertNotIn(local['key'], [r['key'] for r in self.panel.rows])

    def test_machine_header_and_column_are_visible(self):
        class Term:
            rows, cols = 18, 100
            def draw(self, lines): self.lines = lines
        term = Term()
        self.panel.draw(term)
        self.assertEqual(len(term.lines), term.rows)
        self.assertIn('Machines: All connected', term.lines[0])
        self.assertTrue(any('devserver' in line for line in term.lines[1:]))
        self.panel.cycle_filter(1)
        self.panel.draw(term)
        self.assertIn('Machines: Local', term.lines[0])
        self.assertFalse(any('devserver' in line for line in term.lines[1:]))


if __name__ == '__main__':
    unittest.main()
