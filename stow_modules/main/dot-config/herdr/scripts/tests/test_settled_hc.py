"""Machine-local Core Settled: isolated IO, ordered events, exact safe resume."""
import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shlex
import sys
import tempfile
import unittest
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import settled_hc as hc

spec = importlib.util.spec_from_file_location("settled_core_legacy", SCRIPTS / "herdr-settled.py")
legacy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = legacy
spec.loader.exec_module(legacy)


def terminal(conv="/sessions/a.jsonl", address="t1", created=1000, state="live", labels=True):
    return {"address": address, "created_ms": created, "state": state,
            "cwd": "/shell", "title": "Task A", "reported": True,
            "argv": ["fish", "-l"], "finished_ms": 10000 if state == "finished" else None,
            "foreground": {"name": "pi", "cwd": "/repo", "argv": ["pi", "--provider", "anthropic", "--thinking", "high", "-p", "FIRST PROMPT"]} if state == "live" else None,
            "labels": {"herdr.space": "sp1", "herdr.tab": "tb1", **({"agent.kind": "pi", "agent.session": conv, "agent.session_kind": "path"} if labels else {})},
            "status": {"state": "done"}}


DOC = {"other": {"preserved": True}, "spaces": [{"id": "sp1", "name": "Project", "folder": "/repo", "tabs": [
    {"id": "tb1", "name": "Tab A", "root": {"type": "row", "children": [
        {"id": "p1", "type": "block", "content": {"terminal": "t1"}}]}}]}]}


class FakeCore:
    def __init__(self, terms=None, doc=None):
        self.terms = terms or []
        self.doc = copy.deepcopy(DOC if doc is None else doc)
        self.version = 1
        self.calls = []
        self.failure = None
        self.conflicts = 0
        self.run_result = {"address": "t2", "created_ms": 2000, "state": "live"}

    def hc_rpc(self, method, params=None, timeout=5):
        params = params or {}
        self.calls.append((method, copy.deepcopy(params)))
        if self.failure == method:
            return {"error": {"kind": "unavailable", "message": "offline"}}
        if method == "terminal.list":
            assert params == {"all": True}
            value = {"terminals": copy.deepcopy(self.terms)}
        elif method == "doc.get":
            assert params == {"name": "herdr-app"}  # no `on`, no desktop merged ls
            value = {"value": copy.deepcopy(self.doc), "version": self.version}
        elif method == "doc.set":
            assert "on" not in params
            if self.conflicts:
                self.conflicts -= 1
                self.version += 1
                self.doc["concurrent"] = "kept"
                return {"error": {"code": -32000, "data": {"kind": "conflict"}}}
            self.doc = copy.deepcopy(params["value"])
            self.version += 1
            value = {"version": self.version}
        elif method == "terminal.run":
            value = copy.deepcopy(self.run_result)
            if value.get("state") == "live" and value.get("address") and "/" not in value["address"]:
                spawned = terminal(address=value["address"], created=value.get("created_ms", 0))
                spawned.update(value)
                spawned["labels"] = copy.deepcopy(params.get("labels", {}))
                spawned["foreground"] = {"argv": params.get("argv", []), "cwd": params.get("cwd"), "name": "pi"}
                self.terms.append(spawned)
        elif method == "terminal.label":
            target = next(t for t in self.terms if t["address"] == params["terminal"])
            target.setdefault("labels", {}).update(params["labels"])
            value = {"address": params["terminal"]}
        elif method == "terminal.get":
            value = next((t for t in self.terms if t["address"] == params["terminal"]), None)
            if value is None:
                return {"error": {"kind": "not_found"}}
        elif method in ("terminal.kill", "terminal.rm"):
            value = {"address": params["terminal"]}
        else:
            raise AssertionError("Unexpected RPC " + method)
        return {"result": copy.deepcopy(value)}

    def unix_rpc_line(self, socket, payload, timeout=5):
        return self.hc_rpc(payload["method"], payload["params"], timeout)

    def hc_socket_path(self):
        return "/mock/core.sock"


class SocketPathTest(unittest.TestCase):
    def test_linux_runtime_socket_and_session_isolation(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"XDG_RUNTIME_DIR": tmp, "HC_SESSION": "named"}, clear=True), mock.patch.object(hc, "adapter") as adapter:
            runtime = Path(tmp) / "herdr-core"
            runtime.mkdir()
            (runtime / "default.sock").touch()
            adapter.return_value.hc_socket_path.return_value = None
            self.assertIsNone(hc.socket_path(), "never route a missing named Core to default")
            (runtime / "named.sock").touch()
            self.assertEqual(hc.socket_path(), str(runtime / "named.sock"))
            adapter.return_value.hc_socket_path.assert_called_once()

    def test_cli_prefers_this_core_without_frontmost_app_detection(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(hc, "socket_path", return_value="/runtime/default.sock"), mock.patch.object(hc, "adapter") as adapter:
            self.assertTrue(hc.enabled())
            adapter.assert_not_called()

    def test_explicit_socket_namespaces_do_not_share_archives(self):
        with mock.patch.dict(os.environ, {"HC_SOCKET": "/tmp/core-a/default.sock"}, clear=True):
            first = hc.registry_path()
        with mock.patch.dict(os.environ, {"HC_SOCKET": "/tmp/core-b/default.sock"}, clear=True):
            self.assertNotEqual(first, hc.registry_path())

    def test_explicit_socket_wins_and_macos_falls_back(self):
        with mock.patch.dict(os.environ, {"HC_SOCKET": "/explicit/core.sock", "XDG_RUNTIME_DIR": "/runtime"}, clear=True):
            self.assertEqual(hc.socket_path(), "/explicit/core.sock")
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(hc, "adapter") as adapter:
            adapter.return_value.hc_socket_path.return_value = "/state/default.sock"
            self.assertEqual(hc.socket_path(), "/state/default.sock")


class CoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.env = mock.patch.dict(os.environ, {"SETTLED_STATE_DIR": str(self.root / "settled"),
                                               "XDG_STATE_HOME": str(self.root / "state"),
                                               "HOME": str(self.root / "home"), "HC_SESSION": "test", "HC_PRESET_BACKEND": "hc",
                                               "HC_SOCKET": "", "HC_TERMINAL_SOCKET": "", "XDG_RUNTIME_DIR": str(self.root / "runtime")})
        self.env.start()
        self.core = FakeCore([terminal()])
        self.patch = mock.patch.object(hc, "_adapter", self.core)
        self.patch.start()
        hc._transcripts.clear()
        hc._pi_sessions.clear()

    def tearDown(self):
        self.patch.stop()
        self.env.stop()
        self.temp.cleanup()

    def archived(self):
        hc.tick()
        self.core.terms = []
        hc.tick()
        return hc.read_registry()["settled"]["/sessions/a.jsonl"]

    def test_full_record_survives_close_and_timestamp_never_changes(self):
        hc.tick()
        seen = hc.read_registry()["seen"]["/sessions/a.jsonl"]
        self.assertEqual(seen["argv"], terminal()["foreground"]["argv"])
        self.assertNotEqual(seen["argv"][0], "fish")
        self.assertEqual(seen["cwd"], "/repo")
        for key, value in {"terminal_id": "t1", "created_ms": 1000, "workspace_id": "sp1", "space_name": "Project", "tab_name": "Tab A", "title": "Task A"}.items():
            self.assertEqual(seen[key], value)
        self.core.terms = []
        hc.tick()
        stamp = hc.read_registry()["settled"]["/sessions/a.jsonl"]["settled_at"]
        hc.tick()
        self.assertEqual(hc.read_registry()["settled"]["/sessions/a.jsonl"]["settled_at"], stamp)

    def test_done_and_error_status_are_not_closure(self):
        for state in ("done", "blocked", "error"):
            self.core.terms[0]["status"] = {"state": state}
            hc.tick()
            self.assertEqual(hc.read_registry()["settled"], {})

    def test_finished_cleared_and_changed_sessions_settle(self):
        for change in ("finished", "cleared", "changed"):
            with self.subTest(change=change):
                hc.write_registry({"settled": {}, "seen": {}, "forgotten": {}})
                self.core.terms = [terminal()]
                hc.tick()
                if change == "finished":
                    self.core.terms = [terminal(state="finished", labels=False)]
                elif change == "cleared":
                    self.core.terms[0]["labels"] = {}
                else:
                    self.core.terms = [terminal(conv="/sessions/b.jsonl")]
                hc.tick()
                self.assertIn("/sessions/a.jsonl", hc.read_registry()["settled"])
                self.assertNotIn("/sessions/b.jsonl", hc.read_registry()["settled"])

    def test_id_reuse_never_overwrites_old_record(self):
        hc.tick()
        self.core.terms = [terminal(conv="/sessions/b.jsonl", created=3000)]
        hc.tick()
        old = hc.read_registry()["settled"]["/sessions/a.jsonl"]
        self.assertEqual(old["created_ms"], 1000)
        self.assertEqual(hc.read_registry()["seen"]["/sessions/b.jsonl"]["created_ms"], 3000)

    def test_live_exact_conversation_elsewhere_removes_archive(self):
        self.archived()
        self.core.terms = [terminal(address="t9", created=999)]
        hc.tick()
        self.assertEqual(hc.read_registry()["settled"], {})

    def test_forget_suppresses_retained_finished_records_and_all_future_ticks(self):
        self.archived()
        hc.forget("/sessions/a.jsonl")
        self.core.terms = [terminal(state="finished")]
        hc.tick()
        hc.tick()
        self.assertEqual(hc.read_registry()["settled"], {})
        self.assertIn("/sessions/a.jsonl", hc.read_registry()["forgotten"])
        self.core.terms = [terminal(address="t9", created=999)]
        hc.tick()
        self.core.terms = []
        hc.tick()
        self.assertIn("/sessions/a.jsonl", hc.read_registry()["settled"])

    def test_list_and_doc_errors_preserve_bytes(self):
        hc.tick()
        before = Path(hc.registry_path()).read_bytes()
        for failed in ("terminal.list", "doc.get"):
            self.core.failure = failed
            with self.assertRaises(hc.CoreError):
                hc.tick()
            self.assertEqual(Path(hc.registry_path()).read_bytes(), before)

    def test_malformed_list_does_not_infer_closure(self):
        hc.tick()
        with mock.patch.object(self.core, "hc_rpc", return_value={"result": {}}):
            with self.assertRaises(hc.CoreError):
                hc.tick()
        self.assertEqual(hc.read_registry()["settled"], {})

    def test_remote_addresses_discarded_and_other_sessions_isolated(self):
        self.core.terms = [terminal(address="remote/t1", conv="/remote/a.jsonl")]
        hc.tick()
        self.assertEqual(hc.read_registry()["seen"], {})
        test_path = hc.registry_path()
        with mock.patch.dict(os.environ, {"HC_SESSION": "another"}):
            self.assertNotEqual(test_path, hc.registry_path())
            self.assertEqual(hc.read_registry()["settled"], {})
        with mock.patch.dict(os.environ, {"SETTLED_STATE_DIR": str(self.root / "another-machine")}):
            self.assertNotEqual(test_path, hc.registry_path())

    def test_defaults_never_share_legacy_registry(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("SETTLED_STATE_DIR")
            self.assertEqual(hc.registry_path(), str(self.root / "state/herdr-core/settled/test/registry.json"))

    def test_picker_reload_ticks_finished_records(self):
        hc.tick()
        self.core.terms = [terminal(state="finished")]
        self.assertEqual(hc.compat_call("pane.list"), {"panes": []})
        self.assertIn("/sessions/a.jsonl", hc.read_registry()["settled"])

    def test_short_lived_labels_remembered_even_if_later_get_list_already_clear(self):
        original = terminal(labels=False)
        cache = {"t1": copy.deepcopy(original)}
        self.core.terms = [copy.deepcopy(original)]  # newer facts already cleared
        event = {"method": "event", "params": {"type": "labels", "terminal": "t1",
                  "data": {"labels": terminal()["labels"]}}}
        hc.process_event(event, cache, copy.deepcopy(DOC))
        self.assertIn("/sessions/a.jsonl", hc.read_registry()["settled"])
        self.assertEqual(hc.read_registry()["seen"]["/sessions/a.jsonl"]["argv"][0], "pi")
        event["params"]["data"]["labels"] = {}
        hc.process_event(event, cache, DOC)
        self.assertEqual(cache["t1"]["labels"], {})

    def test_removed_event_and_label_switch_preserve_previous_record(self):
        hc.tick()
        cache = {"t1": terminal()}
        self.core.terms = [terminal(conv="/sessions/b.jsonl")]
        hc.process_event({"method": "event", "params": {"type": "labels", "terminal": "t1", "data": {"labels": self.core.terms[0]["labels"]}}}, cache, DOC)
        self.assertIn("/sessions/a.jsonl", hc.read_registry()["settled"])
        self.core.terms = []
        hc.process_event({"method": "event", "params": {"type": "removed", "terminal": "t1", "data": {}}}, cache, DOC)
        self.assertIn("/sessions/b.jsonl", hc.read_registry()["settled"])

    def test_event_disconnect_or_missed_never_settles(self):
        hc.tick()
        for event in ({"method": "heartbeat"}, {"method": "missed"}):
            with contextlib_suppress_core():
                hc.process_event(event, {"t1": terminal()}, DOC)
        self.assertEqual(hc.read_registry()["settled"], {})
        self.core.failure = "terminal.list"
        with self.assertRaises(hc.CoreError):
            hc.process_event({"method": "event", "params": {"type": "removed", "terminal": "t1"}}, {"t1": terminal()}, DOC)
        self.assertEqual(hc.read_registry()["settled"], {})

    def test_core_resume_preserves_exact_options_without_first_prompt(self):
        self.archived()
        entry = hc.read_registry()["settled"]["/sessions/a.jsonl"]
        entry["cwd"] = str(self.root)
        state = hc.read_registry()
        state["settled"]["/sessions/a.jsonl"] = entry
        hc.write_registry(state)
        with mock.patch.object(legacy, "_hc_mode", True):
            outcome = hc.reopen("/sessions/a.jsonl", legacy.resume_command)
        self.assertEqual(outcome, "reopened in t2")
        run = next(p for m, p in self.core.calls if m == "terminal.run")
        self.assertEqual(run["argv"], ["pi", "--provider", "anthropic", "--thinking", "high", "--session", "/sessions/a.jsonl"])
        for flag in ("keep", "no_parent", "outlive_parent", "no_notify"):
            self.assertTrue(run[flag])
        self.assertNotIn("on", run)
        self.assertEqual(run["labels"]["agent.session"], "/sessions/a.jsonl")
        tab = self.core.doc["spaces"][0]["tabs"][-1]
        self.assertEqual(tab["root"]["children"][0]["content"], {"terminal": "t2"})
        self.assertEqual(tab["id"], run["labels"]["herdr.tab"])
        self.assertEqual(hc.read_registry()["settled"], {})
        self.assertEqual(self.core.doc["other"], {"preserved": True})

    def resumable(self):
        self.archived()
        state = hc.read_registry()
        state["settled"]["/sessions/a.jsonl"]["cwd"] = str(self.root)
        hc.write_registry(state)

    def test_resume_launch_failures_retain_archive_without_doc_mutation(self):
        self.resumable()
        for result in ({}, {"address": "remote/t2", "state": "live"},
                       {"address": "t2", "created_ms": 2, "state": "finished"},
                       {"address": "t2", "created_ms": 2, "state": "live", "reason": "spawn_pending"}):
            self.core.run_result = result
            with self.assertRaises(hc.CoreError):
                hc.reopen("/sessions/a.jsonl", legacy.resume_command)
            self.assertIn("/sessions/a.jsonl", hc.read_registry()["settled"])
            self.assertFalse(any(m == "doc.set" for m, _ in self.core.calls))
        self.core.failure = "terminal.run"
        with self.assertRaises(hc.CoreError):
            hc.reopen("/sessions/a.jsonl", legacy.resume_command)
        self.assertIn("/sessions/a.jsonl", hc.read_registry()["settled"])

    def test_resume_doc_conflict_retries_and_preserves_concurrent_changes(self):
        self.resumable()
        self.core.conflicts = 2
        hc.reopen("/sessions/a.jsonl", legacy.resume_command)
        self.assertEqual(self.core.doc["concurrent"], "kept")
        self.assertEqual(sum(m == "terminal.run" for m, _ in self.core.calls), 1)
        self.assertEqual(sum(m == "doc.set" for m, _ in self.core.calls), 3)

    def test_resume_adoption_failure_keeps_archive_no_duplicate_spawn(self):
        self.resumable()
        self.core.failure = "doc.set"
        with self.assertRaisesRegex(hc.CoreError, "launched in t2.*archive retained"):
            hc.reopen("/sessions/a.jsonl", legacy.resume_command)
        self.assertIn("/sessions/a.jsonl", hc.read_registry()["settled"])
        self.assertEqual(sum(m == "terminal.run" for m, _ in self.core.calls), 1)
        self.assertEqual(sum(m == "doc.set" for m, _ in self.core.calls), 1)

    def test_watcher_keeps_pending_resume_during_failed_adoption_and_retry(self):
        self.resumable()
        self.core.failure = "doc.set"
        original = self.core.hc_rpc
        def run_with_events(method, params=None, timeout=5):
            response = original(method, params, timeout)
            if method == "terminal.run":
                launched = terminal(address="t2", created=2000)
                launched["labels"] = params["labels"]
                self.core.terms.append(launched)
                hc.remember(launched, DOC)
                hc.tick()
                self.assertIn("/sessions/a.jsonl", hc.read_registry()["settled"])
            return response
        with mock.patch.object(self.core, "hc_rpc", side_effect=run_with_events):
            with self.assertRaisesRegex(hc.CoreError, "adoption failed"):
                hc.reopen("/sessions/a.jsonl", legacy.resume_command)
            hc.tick()
            self.assertIn("/sessions/a.jsonl", hc.read_registry()["settled"])
            self.core.failure = None
            self.assertEqual(hc.reopen("/sessions/a.jsonl", legacy.resume_command), "reopened in t2")
        self.assertEqual(sum(m == "terminal.run" for m, _ in self.core.calls), 1)
        self.assertEqual(hc.read_registry()["settled"], {})
        self.assertEqual(hc.read_registry()["pending"], {})

    def test_pi_id_and_path_merge_and_resume_stays_out_of_archive(self):
        session_id = "6ce0a76d-34ac-4287-91b2-1e871f94ac8a"
        path = Path(self.transcript(name="Restored work", cwd=str(self.root), suffix=session_id))
        path.write_text(json.dumps({"type": "session", "id": session_id, "cwd": str(self.root)}) + '\n')
        entry = {"agent": "pi", "session": {"kind": "path", "value": str(path)}, "cwd": str(self.root),
                 "title": "Restored work", "terminal_id": "old", "created_ms": 1, "settled_at": 3}
        hc.write_registry({"settled": {str(path): entry, session_id: {**entry, "session": {"kind": "path", "value": session_id}, "settled_at": 5}}, "seen": {str(path): entry}})
        self.core.terms = []
        self.assertEqual(list(hc.read_registry()["settled"]), [str(path)])
        self.assertEqual(hc.read_registry()["settled"][str(path)]["settled_at"], 3)
        self.assertEqual(hc.reopen(session_id, legacy.resume_command), "reopened in t2")
        # Real Pi's lifecycle can report the ID, not the path used by reopen.
        self.core.terms[-1]["labels"].update({"agent.session": session_id, "agent.session_kind": "id"})
        hc.tick()
        self.assertEqual(hc.read_registry()["settled"], {})
        focus = next(p for m, p in self.core.calls if m == "terminal.label")
        self.assertIn("settled.focus_token", focus["labels"])
        self.assertLess(next(i for i, (m, _) in enumerate(self.core.calls) if m == "doc.set"), next(i for i, (m, _) in enumerate(self.core.calls) if m == "terminal.label"))

    def test_already_open_alias_requests_focus_and_removes_stale_row(self):
        session_id = "12345678-1234-1234-1234-123456789abc"
        path = Path(self.transcript(cwd=str(self.root), suffix=session_id))
        path.write_text(json.dumps({"type": "session", "id": session_id}) + '\n')
        entry = {"agent": "pi", "session": {"kind": "path", "value": str(path)}, "cwd": str(self.root), "settled_at": 3}
        hc.write_registry({"settled": {str(path): entry}})
        self.core.terms = [terminal(conv=session_id)]
        self.core.terms[0]["labels"]["agent.session_kind"] = "id"
        self.assertIn("focus requested", hc.reopen(str(path), legacy.resume_command))
        self.assertEqual(hc.read_registry()["settled"], {})
        self.assertFalse(any(m == "terminal.run" for m, _ in self.core.calls))

    def test_pi_session_selector_distinguishes_id_from_path(self):
        session_id = "12345678-1234-1234-1234-123456789abc"
        self.assertEqual(hc.exact_argv_session(["pi", "--session", session_id])["kind"], "id")
        self.assertEqual(hc.exact_argv_session(["pi", "--session", "/exact/chat.jsonl"])["kind"], "path")

    def test_picker_restore_failure_keeps_rows_even_when_refresh_also_fails(self):
        row = {"kind": "settled", "key": "/sessions/a.jsonl"}
        picker = legacy.Picker.__new__(legacy.Picker)
        picker.rows, picker.marked = [row], set()
        picker.reload = mock.Mock(side_effect=hc.CoreError("offline"))
        with mock.patch.object(legacy, "reopen", side_effect=hc.CoreError("offline")), mock.patch.object(legacy, "last_settled_key", return_value=row["key"]):
            self.assertFalse(picker.act("enter", row))
            self.assertIn("Restore failed", picker.flash)
            self.assertFalse(picker.act("undo", row))
            self.assertIn("Restore failed", picker.flash)
        self.assertEqual(picker.rows, [row])

    def test_watcher_reconnects_with_bounded_backoff(self):
        with mock.patch.object(hc, "watch_stream", side_effect=[hc.CoreError("missed"), OSError("temporary EOF"), 0]) as watch, mock.patch.object(hc.time, "sleep") as delay:
            self.assertEqual(hc.watch(), 0)
        self.assertEqual(watch.call_count, 3)
        self.assertEqual(delay.call_args_list, [mock.call(0.1), mock.call(0.2)])

    def test_headless_recreates_space_and_missing_cwd_is_explicit_error(self):
        self.resumable()
        self.core.doc = {"spaces": []}
        hc.reopen("/sessions/a.jsonl", legacy.resume_command)
        self.assertEqual(self.core.doc["spaces"][0]["name"], "Project")
        self.core.terms = [terminal()]
        self.archived()
        with self.assertRaisesRegex(hc.CoreError, "cwd no longer exists"):
            hc.reopen("/sessions/a.jsonl", legacy.resume_command)

    def test_core_codex_no_daemon_and_flags_after_resume(self):
        with mock.patch.object(legacy, "_hc_mode", True):
            command = legacy.resume_command({"agent": "codex", "argv": ["codex", "resume", "old", "--model", "m", "--full-auto", "FIRST"], "session": {"kind": "id", "value": "exact"}})
        self.assertEqual(shlex.split(command), ["codex", "--no-daemon", "--model", "m", "--full-auto", "resume", "exact"])

    def test_no_most_recent_fallback_for_core(self):
        hc.write_registry({"settled": {"a": {"agent": "pi", "session": {}}}, "seen": {}, "forgotten": {}})
        with self.assertRaisesRegex(hc.CoreError, "exact conversation"):
            hc.reopen("a", legacy.resume_command)

    def test_unsupported_popup_actions_are_explicit(self):
        with self.assertRaisesRegex(hc.CoreError, "legacy-only action"):
            hc.compat_call("plugin.pane.open", {})

    def test_settle_archives_before_kill_and_guard_id_reuse(self):
        hc.settle_pane("t1")
        self.assertIn("/sessions/a.jsonl", hc.read_registry()["settled"])
        self.assertEqual([m for m, _ in self.core.calls if m in ("terminal.kill", "terminal.rm")], ["terminal.kill", "terminal.rm"])
        self.core.calls.clear()
        get = self.core.hc_rpc
        def reused(method, params=None, timeout=5):
            if method == "terminal.get":
                return {"result": terminal(created=999)}
            return get(method, params, timeout)
        with mock.patch.object(self.core, "hc_rpc", side_effect=reused):
            with self.assertRaisesRegex(hc.CoreError, "identity changed"):
                hc.settle_pane("t1")
        self.assertFalse(any(m == "terminal.kill" for m, _ in self.core.calls))

    def test_settle_session_uses_exact_remembered_outgoing_ref(self):
        hc.tick()
        self.core.terms = [terminal(conv="/sessions/b.jsonl")]
        hc.settle_session("t1", "/sessions/a.jsonl")
        self.assertIn("/sessions/a.jsonl", hc.read_registry()["settled"])
        self.assertNotIn("/sessions/b.jsonl", hc.read_registry()["settled"])
        with self.assertRaises(hc.CoreError):
            hc.settle_session("remote/t1", "/sessions/a.jsonl")

    def test_ensure_watch_is_owned_by_core_not_short_lived_exec_scope(self):
        with mock.patch.object(hc, "rpc", return_value={"state": "live", "address": "t-watch"}) as spawn:
            self.assertEqual(hc.ensure_watch("/scripts/herdr-settled.py"), 0)
            method, params = spawn.call_args.args
            self.assertEqual(method, "terminal.run")
            self.assertEqual(params["argv"][2:], ["watch", "--wait-lock"])
            self.assertEqual(params["name"], "settled-watch")
            self.assertTrue(params["no_parent"])
            self.assertTrue(params["outlive_parent"])
            self.assertTrue(params["no_notify"])
            self.assertNotIn("herdr.space", params["labels"])
        with open(Path(hc.state_dir()) / "watch.lock", "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with mock.patch.object(hc, "rpc") as spawn:
                self.assertEqual(hc.ensure_watch("/script"), 0)
                spawn.assert_not_called()
                self.assertEqual(hc.watch(), 0)

    def test_legacy_import_only_local_resolved_once_forget_survives(self):
        transcript = self.root / "session.jsonl"
        transcript.write_text('{}\n')
        archive = self.root / "state/herdr/plugins/herdr-settled/test.json"
        archive.parent.mkdir(parents=True)
        valid = {"agent": "pi", "session": {"kind": "path", "value": str(transcript)}, "title": "Old", "settled_at": 7}
        archive.write_text(json.dumps({"settled": {str(transcript): valid,
                                                  "/remote/no.jsonl": {**valid, "session": {"kind": "path", "value": "/remote/no.jsonl"}}}}))
        self.core.terms = []
        hc.tick()
        self.assertEqual(set(hc.read_registry()["settled"]), {str(transcript)})
        self.assertEqual(hc.read_registry()["settled"][str(transcript)]["settled_at"], 7)
        hc.forget(str(transcript))
        hc.tick()
        self.assertEqual(hc.read_registry()["settled"], {})
        self.assertTrue(hc.read_registry()["legacy_migrated"])

    def transcript(self, name="Task A", timestamp="1970-01-01T00:00:02Z", cwd="/repo", suffix="a"):
        directory = Path.home() / ".pi/agent/sessions" / ("--" + cwd.strip("/").replace("/", "-") + "--")
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / (suffix + ".jsonl")
        path.write_text(json.dumps({"type": "session", "cwd": cwd, "timestamp": timestamp}) + '\n' +
                        json.dumps({"type": "session_info", "name": "Earlier"}) + '\n' +
                        json.dumps({"type": "session_info", "name": name}) + '\n')
        return str(path)

    def test_archive_uses_durable_pi_title_instead_of_tool_osc_title(self):
        path = self.transcript(name="Durable conversation name")
        self.core.terms = [terminal(conv=path)]
        self.core.terms[0]["title"] = "</readfile>"
        hc.tick()
        self.core.terms = []
        hc.tick()
        self.assertEqual(hc.read_registry()["settled"][path]["title"], "Durable conversation name")

    def test_unique_pi_backfill_finished_and_live_foreground_cwd(self):
        path = self.transcript()
        for live in (True, False):
            t = terminal(labels=False, state="live" if live else "finished")
            t["cwd"] = "/repo" if not live else "/shell"
            self.core.terms = [t]
            hc.tick()
            records = hc.read_registry()["seen"]
            self.assertIn(path, records)
            self.assertEqual(records[path]["session"]["source"], "core-backfill")
            self.assertEqual(records[path]["cwd"], "/repo")

    def test_backfill_is_unique_exact_latest_name_and_interval_not_recency(self):
        self.transcript()
        self.transcript(suffix="b")
        self.assertIsNone(hc.backfill(terminal(labels=False), {}))
        for path in (Path.home() / ".pi/agent/sessions/--repo--").glob("*.jsonl"):
            path.unlink()
        self.transcript(name="Task A suffix")
        self.assertIsNone(hc.backfill(terminal(labels=False), {}))
        self.transcript(timestamp="1970-01-01T00:00:00Z", suffix="outside")
        self.assertIsNone(hc.backfill(terminal(labels=False), {}))
        t = terminal(state="finished", labels=False)
        t["cwd"] = "/repo"
        t["reported"] = False
        self.assertIsNone(hc.backfill(t, {}))

    def test_exact_labels_then_argv_before_heuristic_no_revival_after_clear(self):
        heuristic = self.transcript()
        t = terminal()
        t["foreground"]["argv"] = ["pi", "--session", "/sessions/argv.jsonl"]
        self.assertEqual(hc.record(t, DOC, {})["session"]["value"], "/sessions/a.jsonl")
        t["labels"] = {"herdr.space": "sp1", "herdr.tab": "tb1"}
        self.assertEqual(hc.record(t, DOC, {})["session"]["value"], "/sessions/argv.jsonl")
        self.core.terms = [terminal()]
        hc.tick()
        self.core.terms = [t]
        hc.tick()
        self.assertNotIn(heuristic, hc.read_registry()["seen"])
        self.assertIn("/sessions/a.jsonl", hc.read_registry()["settled"])
        self.assertNotIn("/sessions/argv.jsonl", hc.read_registry()["seen"])

    def test_transcript_metadata_cached_per_stat(self):
        path = Path(self.transcript())
        hc.pi_info(path)
        with mock.patch.object(Path, "open", side_effect=AssertionError("must use cached metadata")):
            self.assertEqual(hc.pi_info(path)["name"], "Task A")
        path.write_text(path.read_text() + json.dumps({"type": "session_info", "name": "Changed"}) + '\n')
        self.assertEqual(hc.pi_info(path)["name"], "Changed")


# A narrow helper keeps the heartbeat/missed invariant test readable.
import contextlib

def contextlib_suppress_core():
    return contextlib.suppress(hc.CoreError)


if __name__ == "__main__":
    unittest.main()
