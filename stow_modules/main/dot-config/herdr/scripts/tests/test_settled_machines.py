"""Connected-only Settled service: routing, races and bounded safe transport."""
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import settled_machines as service


def archive(core_id="local-core", namespace="default", key="/sessions/same.jsonl", **fields):
    return {"version": 1, "core_id": core_id, "namespace": namespace, "entries": [
        {"key": key, "title": "Task", "agent": "pi", "workspace_label": "Project",
         "workspace_id": "sp1", "project": {"name": "Example"}, "cwd": "/repo",
         "settled_at": 100, "transcript": key, "gone": False,
         "fallback": True, **fields}]}


class ConnectedTests(unittest.TestCase):
    def setUp(self):
        self.local_id = "local-core"
        self.namespace = "default"
        self.local_online = True
        self.list_online = True
        self.machines = [
            {"name": "devserver", "state": "connected", "id": "remote-core"},
            {"name": "offline", "state": "disconnected", "id": "offline-core"},
            {"name": "booting", "state": "connecting"},
            {"name": "temporary", "state": "connected", "temporary": True},
            {"state": "connected"},
        ]
        self.legacy = mock.Mock()
        self.legacy.resume_command = mock.Mock(name="resume_command")
        self.svc = service.ConnectedArchives(self.legacy, timeout=2, workers=2)
        self.calls = []
        self.remote_data = archive("remote-core", "remote-session")
        self.local_data = archive()
        patches = [mock.patch.object(service.hc, "rpc", side_effect=self.rpc),
                   mock.patch.object(service.hc, "namespace", side_effect=lambda: self.namespace),
                   mock.patch.object(service, "export_local", side_effect=lambda legacy: copy.deepcopy(self.local_data)),
                   mock.patch.object(service, "_run_bounded", side_effect=self.transport)]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def rpc(self, method, params=None, timeout=5):
        if method == "hello":
            if not self.local_online:
                raise service.ArchiveError("local offline")
            return {"core": {"id": self.local_id}}
        if method == "machine.list":
            if not self.list_online:
                raise service.ArchiveError("listing offline")
            return {"machines": copy.deepcopy(self.machines)}
        raise AssertionError(method)

    def transport(self, argv, timeout, max_bytes):
        self.calls.append(list(argv))
        self.assertEqual(argv[:4], ["hc", "exec", "--on", "devserver"])
        self.assertEqual(argv[6:9], ["--", "sh", "-c"])
        if argv[9] == service._SHELL_EXPORT:
            self.assertEqual(argv[11:], ["export-json"])
            return json.dumps(self.remote_data)
        self.assertEqual(argv[9], service._SHELL_OWNER)
        code, core_id, namespace, action, key = argv[11:]
        self.assertEqual(code, service._OWNER_COMMAND)
        self.assertEqual((core_id, namespace), ("remote-core", "remote-session"))
        if action == "preview-json":
            return json.dumps({"messages": [["assistant", "remote transcript"]], "gone": False})
        return "%s remote %s\n" % (action, key)

    def row(self, machine=None):
        return next(row for row in self.svc.snapshot()["rows"] if row["machine"] == machine)

    def test_all_includes_only_local_and_connected_nontemporary_named_machines(self):
        connected = self.svc.connected()
        self.assertEqual([m["name"] for m in connected], [None, "devserver"])
        self.assertEqual([m["label"] for m in connected], ["Local", "devserver"])
        snapshot = self.svc.snapshot()
        self.assertEqual([m["name"] for m in snapshot["machines"]], [None, "devserver"])
        self.assertEqual([m["namespace"] for m in snapshot["machines"]], ["default", "remote-session"])
        self.assertEqual(len(snapshot["rows"]), 2)
        local, remote = snapshot["rows"]
        self.assertEqual(local["origin_key"], remote["origin_key"])
        self.assertNotEqual(local["key"], remote["key"], "same origin key must not dedup across machines")
        for row, label in ((local, "Local"), (remote, "devserver")):
            self.assertEqual(row["kind"], "settled")
            self.assertEqual(row["machine_label"], label)
            self.assertEqual(row["agent_name"], "pi")
            self.assertEqual(row["workspace_label"], "Project")
            self.assertEqual(row["project"], {"name": "Example"})
            self.assertEqual(row["workspace_id"], "sp1")
            self.assertFalse(row["fallback"])
            self.assertTrue(row["age"])
        self.assertEqual([r for r in snapshot["rows"] if r["machine"] is None], [local])

    def test_connected_failures_never_reuse_previous_names_or_local_identity(self):
        self.svc.snapshot()
        self.list_online = False
        self.assertEqual([m["name"] for m in self.svc.connected()], [None])
        self.assertEqual([r["machine"] for r in self.svc.snapshot()["rows"]], [None])
        self.local_online = False
        self.assertEqual(self.svc.connected(), [])
        self.assertEqual(self.svc.snapshot(), {"machines": [], "rows": []})

    def test_disconnect_during_fetch_discards_remote_without_losing_local(self):
        def disconnect(argv, *_args):
            self.machines[0]["state"] = "disconnected"
            return json.dumps(self.remote_data)
        with mock.patch.object(service, "_run_bounded", side_effect=disconnect):
            snapshot = self.svc.snapshot()
        self.assertEqual([m["name"] for m in snapshot["machines"]], [None])
        self.assertEqual([r["machine"] for r in snapshot["rows"]], [None])

    def test_connected_poll_is_not_blocked_by_late_export_and_late_rows_are_excluded(self):
        started, release = threading.Event(), threading.Event()
        result = []
        def slow(argv, *_args):
            started.set()
            if not release.wait(2):
                raise AssertionError("test transport was not released")
            return json.dumps(self.remote_data)
        with mock.patch.object(service, "_run_bounded", side_effect=slow):
            thread = threading.Thread(target=lambda: result.append(self.svc.snapshot()))
            thread.start()
            try:
                self.assertTrue(started.wait(1))
                self.machines[0]["state"] = "disconnected"
                self.assertEqual([m["name"] for m in self.svc.connected()], [None])
            finally:
                release.set()
                thread.join(2)
            self.assertFalse(thread.is_alive())
        self.assertEqual([r["machine"] for r in result[0]["rows"]], [None])

    def test_rebuild_during_fetch_excludes_stale_export(self):
        def rebuild(argv, *_args):
            self.machines[0]["id"] = "rebuilt-core"
            return json.dumps(self.remote_data)
        with mock.patch.object(service, "_run_bounded", side_effect=rebuild):
            self.assertEqual([r["machine"] for r in self.svc.snapshot()["rows"]], [None])

    def test_malformed_or_failed_remote_does_not_poison_or_cache_rows(self):
        self.svc.snapshot()
        malformed = ["not json", "[]", json.dumps({"version": 1}),
                     json.dumps({**self.remote_data, "version": 2}),
                     json.dumps({**self.remote_data, "entries": [None]}),
                     json.dumps({**self.remote_data, "entries": self.remote_data["entries"] * 2}),
                     json.dumps(archive("remote-core", settled_at=float("nan"))),
                     json.dumps(archive("remote-core", title=["invalid"]))]
        for output in malformed:
            with self.subTest(output=output), mock.patch.object(service, "_run_bounded", return_value=output):
                snapshot = self.svc.snapshot()
                self.assertEqual([r["machine"] for r in snapshot["rows"]], [None])
                self.assertEqual([m["name"] for m in snapshot["machines"]], [None, "devserver"])
        with mock.patch.object(service, "_run_bounded", side_effect=service.ArchiveError("timeout")):
            self.assertEqual([r["machine"] for r in self.svc.snapshot()["rows"]], [None])

    def test_failed_remote_does_not_hide_other_connected_remote(self):
        self.machines.append({"name": "second", "state": "connected", "id": "second-core"})
        def transport(argv, *_args):
            if argv[3] == "devserver":
                raise service.ArchiveError("remote failed")
            return json.dumps(archive("second-core", "second-session"))
        with mock.patch.object(service, "_run_bounded", side_effect=transport):
            self.assertEqual([r["machine"] for r in self.svc.snapshot()["rows"]], [None, "second"])

    def test_local_read_failure_preserves_remote_rows_but_not_stale_local_rows(self):
        with mock.patch.object(service, "export_local", side_effect=service.ArchiveError("tick failed")):
            self.assertEqual([r["machine"] for r in self.svc.snapshot()["rows"]], ["devserver"])

    def test_preview_and_actions_route_only_to_owner_using_original_key(self):
        local, remote = self.row(), self.row("devserver")
        with mock.patch.object(service, "preview_local", return_value={"messages": [["user", "local"]], "gone": False}) as preview:
            self.assertEqual(self.svc.preview(local)["messages"], [["user", "local"]])
            preview.assert_called_once_with(self.legacy, local["origin_key"])
        with mock.patch.object(service, "durable_action", return_value="completed") as action:
            self.assertEqual(self.svc.action(local, "forget"), "completed")
            self.assertEqual(self.svc.action(local), "completed")
            self.assertEqual(action.call_args_list, [mock.call(self.legacy, "forget", local["origin_key"], "local-core", "default"), mock.call(self.legacy, "reopen", local["origin_key"], "local-core", "default")])
            with mock.patch.object(service, "preview_local", side_effect=AssertionError("remote path read locally")):
                self.assertEqual(self.svc.preview(remote)["messages"], [["assistant", "remote transcript"]])
            self.assertTrue(self.svc.action(remote, "forget").startswith("forget remote "))
            self.assertTrue(self.svc.action(remote).startswith("reopen remote "))
            self.assertEqual(action.call_count, 2)

    def test_stale_core_namespace_and_offline_row_refuse_mutation_and_preview(self):
        local, remote = self.row(), self.row("devserver")
        with mock.patch.object(service.hc, "forget") as forget:
            self.local_id = "new-local-core"
            with self.assertRaisesRegex(service.ArchiveError, "Stale"):
                self.svc.action(local, "forget")
            self.local_id = "local-core"
            self.namespace = "other-namespace"
            with self.assertRaisesRegex(service.ArchiveError, "Stale"):
                self.svc.action(local, "forget")
            forget.assert_not_called()
        count = len(self.calls)
        self.machines[0]["id"] = "new-remote-core"
        with self.assertRaisesRegex(service.ArchiveError, "Stale"):
            self.svc.action(remote)
        self.machines[0]["state"] = "disconnected"
        with self.assertRaisesRegex(service.ArchiveError, "disconnected"):
            self.svc.preview(remote)
        self.assertEqual(len(self.calls), count)

    def test_late_preview_disconnect_is_explicit_not_successful_cached_read(self):
        remote = self.row("devserver")
        def disconnect(argv, *_args):
            self.machines[0]["state"] = "disconnected"
            return json.dumps({"messages": [["user", "late"]], "gone": False})
        with mock.patch.object(service, "_run_bounded", side_effect=disconnect):
            with self.assertRaisesRegex(service.ArchiveError, "disconnected"):
                self.svc.preview(remote)

    def test_preview_transport_and_malformed_data_fail_explicitly(self):
        remote = self.row("devserver")
        for output in ("not json", json.dumps({"messages": "bad", "gone": False}),
                       json.dumps({"messages": [["user"]], "gone": False})):
            with mock.patch.object(service, "_run_bounded", return_value=output):
                with self.assertRaises((ValueError, service.ArchiveError)):
                    self.svc.preview(remote)
        with mock.patch.object(service, "_run_bounded", side_effect=service.ArchiveError("failed")):
            with self.assertRaisesRegex(service.ArchiveError, "failed"):
                self.svc.preview(remote)

    def test_uncertain_action_is_never_retried(self):
        remote = self.row("devserver")
        with mock.patch.object(service, "_run_bounded", side_effect=service.ArchiveError("lost reply")) as run:
            with self.assertRaisesRegex(service.ArchiveError, "lost reply"):
                self.svc.action(remote)
            self.assertEqual(run.call_count, 1)
        with self.assertRaises(ValueError):
            self.svc.action(remote, "settle")

    def test_command_arguments_and_composite_keys_are_collision_and_injection_safe(self):
        remote = self.row("devserver")
        dangerous = " /a/quote'\"; $(touch /tmp/NO); `id`\n--forget|tab:core"
        remote["origin_key"] = dangerous
        remote["machine"] = "host'; echo injected"
        self.machines[0]["name"] = remote["machine"]
        with mock.patch.object(service, "_run_bounded", return_value="forgotten") as run:
            self.svc.action(remote, "forget")
            argv = run.call_args.args[0]
        self.assertEqual(argv[3], remote["machine"])
        self.assertEqual(argv[-1], dangerous)
        self.assertNotIn(dangerous, argv[9])
        self.assertNotIn(remote["machine"], argv[9])
        self.assertIn('"$5"', argv[9])
        self.assertIn('"$HOME/.local/bin:$PATH"', argv[9])
        self.assertIn('"$HOME/.config/herdr/scripts/herdr-settled.py"', argv[9])
        self.remote_data["entries"][0]["key"] = dangerous
        self.machines[0]["name"] = "devserver"
        snapshot = self.svc.snapshot()
        row = next(r for r in snapshot["rows"] if r["machine"] == "devserver")
        self.assertEqual(json.loads(row["key"]), ["devserver", "remote-core", "remote-session", dangerous])
        self.assertEqual(row["origin_key"], dangerous)

    def test_fanout_is_concurrent_and_bounded(self):
        self.machines = [{"name": "host%d" % i, "state": "connected", "id": "remote-core"} for i in range(6)]
        active = peak = 0
        lock = threading.Lock()
        two_running = threading.Event()
        def transport(argv, *_args):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
                if active == 2:
                    two_running.set()
            try:
                self.assertTrue(two_running.wait(1), "exports were serialized")
                time.sleep(0.01)  # fake transport work, not waiting on an hc terminal
                return json.dumps(self.remote_data)
            finally:
                with lock:
                    active -= 1
        with mock.patch.object(service, "_run_bounded", side_effect=transport):
            self.assertEqual(len(self.svc.snapshot()["rows"]), 7)
        self.assertEqual(peak, 2)


class DurableActionTests(unittest.TestCase):
    def test_mutation_is_a_parent_independent_core_worker_not_picker_code(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(service, "_identity", return_value=("core", "default")), mock.patch.object(service.hc, "state_dir", return_value=tmp):
            calls = []
            def rpc(method, params=None, timeout=5):
                calls.append((method, params))
                if method == "terminal.run":
                    token = params["labels"]["settled.action"]
                    path = Path(tmp) / "actions" / (token + '.json')
                    path.parent.mkdir()
                    path.write_text(json.dumps({"ok": True, "outcome": "reopened in t2"}))
                    return {"address": "job", "state": "live"}
                return {"ended": True}
            with mock.patch.object(service.hc, "rpc", side_effect=rpc), mock.patch.object(service.hc, "reopen", side_effect=AssertionError("picker performed mutation")):
                self.assertEqual(service.durable_action(mock.Mock(), "reopen", "exact", "core", "default"), "reopened in t2")
            params = calls[0][1]
            self.assertTrue(params["no_parent"])
            self.assertTrue(params["outlive_parent"])
            self.assertTrue(params["no_notify"])
            self.assertIn("action-worker-json", params["argv"])
            self.assertEqual(params["argv"][3:7], ["reopen", "exact", "core", "default"])
            self.assertEqual(list((Path(tmp) / 'actions').iterdir()), [])

    def test_worker_rechecks_identity_and_records_outcome_atomically(self):
        token = '12345678123412341234123456789abc'
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(service.hc, "state_dir", return_value=tmp), mock.patch.object(service, "_identity", return_value=("core", "default")), mock.patch.object(service.hc, "forget", return_value="forgot exact") as forget:
            self.assertEqual(service.action_worker(mock.Mock(), 'forget', 'exact', 'core', 'default', token), 0)
            data = json.loads((Path(tmp) / 'actions' / (token + '.json')).read_text())
            self.assertEqual(data, {"ok": True, "outcome": "forgot exact"})
            forget.assert_called_once_with('exact')
            self.assertEqual(service.action_worker(mock.Mock(), 'forget', 'exact', 'stale', 'default', token), 1)
            self.assertEqual(forget.call_count, 1)


class LocalExportTests(unittest.TestCase):
    def setUp(self):
        self.legacy = mock.Mock()
        self.identity = mock.patch.object(service, "_identity", return_value=("local", "default"))
        self.identity.start()
        self.addCleanup(self.identity.stop)

    def test_export_calls_actual_tick_and_exports_metadata_without_reading_messages(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "transcript.jsonl"
            path.write_text("private messages")
            self.legacy.transcript_path.return_value = str(path)
            state = {"settled": {"original-id": {"title": "Title", "agent": "claude", "settled_at": 10, "argv": ["claude", "private initial prompt"]}}}
            with mock.patch.object(service.hc, "tick") as tick, mock.patch.object(service.hc, "read_registry", return_value=state):
                stdout = io.StringIO()
                with mock.patch("sys.stdout", stdout):
                    data = service.export_local(self.legacy)
            tick.assert_called_once_with()
            self.legacy.tick.assert_not_called()
            self.legacy.tail_messages.assert_not_called()
            self.assertEqual(stdout.getvalue(), "")
            self.assertEqual(data["version"], 1)
            self.assertEqual((data["core_id"], data["namespace"]), ("local", "default"))
            self.assertEqual(data["entries"][0]["key"], "original-id")
            self.assertEqual(data["entries"][0]["transcript"], str(path))
            self.assertFalse(data["entries"][0]["gone"])
            self.assertNotIn("messages", data["entries"][0])
            self.assertNotIn("argv", data["entries"][0])

    def test_tick_failure_raises_without_stdout_or_registry_fallback(self):
        with mock.patch.object(service.hc, "tick", side_effect=service.ArchiveError("Core failed")), mock.patch.object(service.hc, "read_registry") as registry:
            with mock.patch("sys.stdout", new_callable=io.StringIO) as stdout:
                with self.assertRaisesRegex(service.ArchiveError, "Core failed"):
                    service.export_local(self.legacy)
            registry.assert_not_called()
            self.assertEqual(stdout.getvalue(), "")

    def test_preview_uses_current_registry_path_not_row_path_and_missing_is_gone(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "a.jsonl"
            path.touch()
            entry = {"title": "Current entry"}
            self.legacy.transcript_path.return_value = str(path)
            self.legacy.tail_messages.return_value = [("user", "hello"), ("assistant", "world")]
            with mock.patch.object(service.hc, "read_registry", return_value={"settled": {"key": entry}}):
                self.assertEqual(service.preview_local(self.legacy, "key"), {"messages": [["user", "hello"], ["assistant", "world"]], "gone": False})
                self.legacy.transcript_path.assert_called_once_with(entry)
                self.legacy.tail_messages.assert_called_once_with(str(path))
                path.unlink()
                self.assertEqual(service.preview_local(self.legacy, "key"), {"messages": [], "gone": True})
                with self.assertRaisesRegex(service.ArchiveError, "No longer settled"):
                    service.preview_local(self.legacy, "wrong-key")

    def test_unreadable_local_preview_is_an_error_not_an_empty_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "a.jsonl"
            path.touch()
            self.legacy.transcript_path.return_value = str(path)
            with mock.patch.object(service.hc, "read_registry", return_value={"settled": {"key": {}}}), mock.patch("builtins.open", side_effect=PermissionError("unreadable")):
                with self.assertRaises(PermissionError):
                    service.preview_local(self.legacy, "key")
            self.legacy.tail_messages.assert_not_called()

    def test_export_and_preview_reject_identity_changes_during_read(self):
        self.legacy.transcript_path.return_value = None
        state = {"settled": {"key": {}}}
        with mock.patch.object(service.hc, "tick"), mock.patch.object(service.hc, "read_registry", return_value=state):
            for operation in (lambda: service.export_local(self.legacy), lambda: service.preview_local(self.legacy, "key")):
                with mock.patch.object(service, "_identity", side_effect=[("old", "default"), ("new", "default")]):
                    with self.assertRaisesRegex(service.ArchiveError, "Core changed"):
                        operation()


class TransportTests(unittest.TestCase):
    def test_slow_snapshot_workers_do_not_hold_interpreter_open_on_picker_close(self):
        code = '''import sys, threading, time
sys.path.insert(0, sys.argv[1])
from settled_machines import ConnectedArchives
from unittest.mock import Mock
service = ConnectedArchives(Mock())
service.connected = lambda: [{"name": "remote", "core_id": "remote"}]
started = threading.Event()
def slow_export(machine):
    started.set()
    time.sleep(10)
service._export = slow_export
threading.Thread(target=service.snapshot, daemon=True).start()
assert started.wait(1)
print("closed")
'''
        self.assertEqual(service._run_bounded([sys.executable, '-c', code, str(SCRIPTS)], 2, 1024), 'closed\n')

    def test_bounded_transport_preserves_exact_stdout_and_rejects_errors(self):
        self.assertEqual(service._run_bounded([sys.executable, "-c", "print('exact')"], 2, 1024), "exact\n")
        with self.assertRaisesRegex(service.ArchiveError, "failed.*bad"):
            service._run_bounded([sys.executable, "-c", "import sys; sys.stderr.write('bad'); sys.exit(3)"], 2, 1024)

    def test_output_and_time_are_bounded_and_process_is_reaped(self):
        with self.assertRaisesRegex(service.ArchiveError, "output limit"):
            service._run_bounded([sys.executable, "-c", "print('x' * 4096)"], 2, 100)
        start = time.monotonic()
        with self.assertRaisesRegex(service.ArchiveError, "timed out"):
            service._run_bounded([sys.executable, "-c", "import time; time.sleep(10)"], 0.05, 1024)
        self.assertLess(time.monotonic() - start, 2)

    def test_actual_shell_wrapper_quotes_home_and_all_positional_arguments(self):
        with tempfile.TemporaryDirectory(prefix="owner home ' ") as tmp:
            home = Path(tmp)
            scripts = home / ".config/herdr/scripts"
            scripts.mkdir(parents=True)
            bindir = home / ".local/bin"
            bindir.mkdir(parents=True)
            (bindir / "python3").symlink_to(sys.executable)
            (scripts / "settled_hc.py").write_text('''def install(module): pass
def rpc(method): return {"core": {"id": "expected"}}
def namespace(): return "named"
''')
            (scripts / "herdr-settled.py").write_text('''import json, sys
def main(argv):
    print(json.dumps(argv))
    return 0
if __name__ == "__main__":
    main(sys.argv[1:])
''')
            (scripts / "settled_machines.py").write_text('''import json
def durable_action(module, action, key, core, namespace): return json.dumps([action, key])
''')
            marker = home / "INJECTED"
            key = "quote'\\\"; $(touch %s)\n--key" % marker
            args = ["sh", "-c", service._SHELL_OWNER, "settled", service._OWNER_COMMAND,
                    "expected", "named", "forget", key]
            with mock.patch.dict(os.environ, {"HOME": str(home)}):
                result = subprocess.run(args, capture_output=True, text=True, timeout=2)
                exported = subprocess.run(["sh", "-c", service._SHELL_EXPORT, "settled", "export-json"],
                                          capture_output=True, text=True, timeout=2)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), ["forget", key])
            self.assertEqual(exported.returncode, 0, exported.stderr)
            self.assertEqual(json.loads(exported.stdout), ["export-json"])
            self.assertFalse(marker.exists())

    def test_owner_guard_checks_identity_in_same_process_and_passes_exact_command_key(self):
        # Exercise the actual inline guard, with stand-in installed scripts. No
        # Core, remote registry, or agent is started by these subprocess tests.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "settled_hc.py").write_text('''import os
class Dummy: pass
def install(module): pass
def rpc(method): return {"core": {"id": os.environ["TEST_CORE"]}}
def namespace(): return os.environ["TEST_NAMESPACE"]
''')
            script = root / "herdr-settled.py"
            script.write_text('''import json
def main(argv):
    print(json.dumps(argv))
    return 0
''')
            (root / "settled_machines.py").write_text('''import json
def durable_action(module, action, key, core, namespace): return json.dumps([action, key])
''')
            key = "quote'\" ; $(echo injected)\nexact key"
            args = [sys.executable, "-c", service._OWNER_COMMAND, str(script), "expected", "named", "forget", key]
            with mock.patch.dict(os.environ, {"TEST_CORE": "expected", "TEST_NAMESPACE": "named"}):
                result = subprocess.run(args, capture_output=True, text=True, timeout=2)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout), ["forget", key])
            for core, namespace in (("rebuilt", "named"), ("expected", "other")):
                with mock.patch.dict(os.environ, {"TEST_CORE": core, "TEST_NAMESPACE": namespace}):
                    result = subprocess.run(args, capture_output=True, text=True, timeout=2)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "", "stale identity must not reach the mutation")
                self.assertIn("Stale Settled row", result.stderr)


if __name__ == "__main__":
    unittest.main()
