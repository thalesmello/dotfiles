"""Adapter regression tests. Mock all IPC/process calls; never control live panes.

Run: python3 -m unittest discover -s scripts/tests -p test_hc_preset.py
"""
import contextlib
import copy
import importlib.machinery
import importlib.util
import io
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

PATH = Path(__file__).resolve().parents[2] / "bin" / "hc-preset"
loader = importlib.machinery.SourceFileLoader("hc_preset", str(PATH))
spec = importlib.util.spec_from_loader(loader.name, loader)
adapter = importlib.util.module_from_spec(spec)
loader.exec_module(adapter)


class BackendTests(unittest.TestCase):
    def test_legacy_plugin_socket_beats_frontmost_app(self):
        with patch.dict(os.environ, {"HERDR_SOCKET_PATH": "/tmp/legacy.sock"}, clear=True), \
                patch.object(adapter, "herdr_app_socket_path", side_effect=AssertionError("must not guess")):
            self.assertEqual(adapter.detect_backend(), "herdr")

    def test_legacy_keybinding_beats_inherited_core_context(self):
        env = {"HERDR_SOCKET_PATH": "/tmp/legacy.sock", "HERDR_ENV": "1",
               "HERDR_ACTIVE_PANE_ID": "w1:p1", "HC_TERMINAL_ID": "t3", "TERM_PROGRAM": "ghostty"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(adapter.detect_backend(), "herdr")

    def test_core_helper_explicit_override_beats_compatibility_markers(self):
        env = {"HC_PRESET_BACKEND": "hc", "HERDR_ACTIVE_PANE_ID": "p123", "HC_TERMINAL_ID": "t3"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(adapter.detect_backend(), "hc")
            self.assertEqual(adapter.detect_backend("herdr"), "herdr")

    def test_core_helper_compatibility_active_pane_stays_hc_without_legacy_env(self):
        env = {"HERDR_ACTIVE_PANE_ID": "p123", "HC_TERMINAL_ID": "t3", "HC_TERMINAL_SOCKET": "/tmp/core.sock"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(adapter.detect_backend(), "hc")

    def test_core_terminal(self):
        with patch.dict(os.environ, {"HC_TERMINAL_ID": "t3"}, clear=True):
            self.assertEqual(adapter.detect_backend(), "hc")

    def test_explicit_sockets_do_not_fall_back(self):
        env = {"HERDR_SOCKET_PATH": "/missing/herdr.sock", "HC_SOCKET": "/missing/core.sock"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(adapter.herdr_socket_path(), env["HERDR_SOCKET_PATH"])
            self.assertEqual(adapter.hc_socket_path(), env["HC_SOCKET"])

    def test_named_core_session_does_not_fall_back_to_default(self):
        with patch.dict(os.environ, {"HC_SESSION": "named"}, clear=True), \
                patch.object(adapter.os.path, "exists", side_effect=lambda p: "/default/" in p):
            self.assertIsNone(adapter.hc_socket_path())

    def test_legacy_cli_arguments_preserved(self):
        with patch.object(adapter, "herdr_bin", return_value="/bin/herdr"), \
                patch.object(adapter.subprocess, "call", return_value=0) as call:
            self.assertEqual(adapter.main(["--backend", "herdr", "--session", "named", "pane", "list"]), 0)
            call.assert_called_once_with(["/bin/herdr", "--session", "named", "pane", "list"])


class ErrorTests(unittest.TestCase):
    def test_json_error_is_nonzero(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(adapter.print_json({"error": {"code": "test"}}), 1)
            self.assertEqual(adapter.print_json({"result": {"type": "ok"}}), 0)

    def test_failed_core_mutation_raises(self):
        with patch.object(adapter, "hc_socket_path", return_value="/tmp/core.sock"), \
                patch.object(adapter, "unix_rpc_line", return_value={"error": {"kind": "blocked"}}):
            with self.assertRaises(adapter.AdapterError):
                adapter.hc_rpc("terminal.send", {"terminal": "t3", "text": "hello"})

    def test_missing_core_mutation_reply_raises(self):
        with patch.object(adapter, "hc_socket_path", return_value=None):
            with self.assertRaises(adapter.AdapterError):
                adapter.hc_rpc("doc.set", {})

    def test_failed_app_focus_raises(self):
        with patch.object(adapter, "herdr_app_rpc", return_value={"error": "no such pane"}):
            with self.assertRaises(adapter.AdapterError):
                adapter.herdr_app_do("pane.focus", {"pane": "missing"})

    def test_missing_app_reply_is_not_retried_after_mutation(self):
        with patch.object(adapter, "herdr_app_socket_path", return_value="/tmp/app.sock"), \
                patch.object(adapter, "unix_rpc_line", return_value=None), \
                patch.object(adapter.subprocess, "run") as run:
            with self.assertRaises(adapter.AdapterError):
                adapter.herdr_app_do("tab.new", {"name": "tests"})
            run.assert_not_called()

    def test_unknown_rpc_and_split_ratio_are_not_success(self):
        with patch.object(adapter, "HcWorld", return_value=Mock()):
            for method in ("missing.method", "layout.set_split_ratio", "layout.export"):
                self.assertIn("error", adapter.handle_hc_rpc_compat(method, {}))

    def test_stale_metadata_target_is_not_success(self):
        world = Mock()
        world.resolve_pane.return_value = None
        with patch.object(adapter, "HcWorld", return_value=world):
            for method in ("pane.report_metadata", "pane.report_agent", "pane.report_agent_session"):
                self.assertEqual(adapter.handle_hc_rpc_compat(method, {"pane_id": "missing"})["error"]["code"], "pane_not_found")

    def test_rpc_cli_exits_nonzero_for_server_error(self):
        with patch.object(adapter, "herdr_rpc", return_value={"error": {"code": "missing"}}), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(adapter.main(["--backend", "herdr", "rpc", "pane.focus", "{}"]), 1)

    def test_error_status_maps_to_blocked(self):
        world = adapter.HcWorld.__new__(adapter.HcWorld)
        world.view = {}
        world.focused_pane_id = None
        world.term_by_addr = {
            "t1": {"address": "t1", "agent": "pi", "status": "error", "cwd": "/tmp", "labels": {}},
            "t2": {"address": "t2", "agent": "pi", "status": {"state": "error", "msg": "API error"}, "cwd": "/tmp", "labels": {}},
        }
        p1 = world._build_pane("p1", "t1", "tb1", "ws1", 0, {"terminal": "t1", "pane": "p1"})
        p2 = world._build_pane("p2", "t2", "tb1", "ws1", 1, {"terminal": "t2", "pane": "p2"})
        self.assertEqual(p1["agent_status"], "blocked")
        self.assertEqual(p2["agent_status"], "blocked")

    def test_print_json_is_compact_for_sed_parsers(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            adapter.print_json({"result": {"pane": {"pane_id": "p123"}}})
        self.assertIn('"pane_id":"p123"', buf.getvalue())

    def test_do_space_new_inherits_focused_cwd_and_machine(self):
        world = Mock()
        world.resolve_pane.return_value = {"foreground_cwd": "/Users/test/src/repo", "cwd": "/Users/test"}
        world.workspaces = [{"workspace_id": "ws1", "focused": True, "machine": "devserver", "cwd": "/Users/test"}]
        with patch.object(adapter, "HcWorld", return_value=world), \
                patch.object(adapter, "herdr_app_do", return_value={"space": "sp2"}) as do_mock, \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(adapter.main(["--backend", "hc", "do", "space.new"]), 0)
            do_mock.assert_called_once_with(
                "space.new",
                {"machine": "devserver", "folder": "/Users/test/src/repo"},
            )

    def test_popup_open_exports_extra_env_and_prints_result(self):
        world = Mock()
        world.resolve_pane.return_value = {
            "pane_id": "p1",
            "tab_id": "tb1",
            "workspace_id": "ws1",
            "terminal_id": "t1",
            "foreground_cwd": "/tmp",
            "cwd": "/tmp",
        }
        proc_res = Mock(returncode=0, stdout='{"address":"t99"}')
        buf = io.StringIO()
        with patch.object(adapter, "resolve_plugin_entrypoint_command", return_value="/bin/true"), \
                patch.object(adapter, "HcWorld", return_value=world), \
                patch.object(adapter, "hc_bin", return_value="/bin/hc"), \
                patch.object(adapter.subprocess, "run", return_value=proc_res) as run_mock, \
                patch.object(adapter, "save_json_file"), \
                patch.object(adapter, "herdr_app_do", return_value={"ok": True}), \
                contextlib.redirect_stdout(buf):
            rc = adapter.handle_popup_open("hc", "confirm-close", "confirm", "64", "9", ["ASCONFIRMCLOSE_PANE_ID=p1"])
        self.assertEqual(rc, 0)
        self.assertIn('"pane_id":"t99"', buf.getvalue())
        cmd_line = run_mock.call_args[0][0][-1]
        self.assertIn("ASCONFIRMCLOSE_PANE_ID=p1", cmd_line)

    def test_fast_pane_visible_unwrap_uses_terminal_get_and_read(self):
        env = {"HERDR_ACTIVE_PANE_ID": "p1", "HERDR_ACTIVE_TERMINAL_ID": "t19"}
        t_resp = {"result": {"cols": 20, "foreground": {"name": "pi"}}}
        r_resp = {"result": {"text": "01234567890123456789\n/foo/bar rest\n"}}
        buf = io.StringIO()
        with patch.dict(os.environ, env, clear=True), \
                patch.object(adapter, "hc_rpc", side_effect=[t_resp, r_resp]) as rpc_mock, \
                contextlib.redirect_stdout(buf):
            rc = adapter.fast_hc_pane_visible_unwrap(["p1"])
        self.assertEqual(rc, 0)
        self.assertEqual(buf.getvalue(), "01234567890123456789/foo/bar\nrest\n")
        self.assertEqual(rpc_mock.call_count, 2)

    def test_doc_fallback_derives_workspace_label_and_matches_remote_terminal_ids(self):
        def fake_hc_rpc(method, params=None, timeout=5.0):
            if method == "terminal.list":
                return {
                    "result": {
                        "terminals": [
                            {
                                "address": "t8",
                                "state": "live",
                                "cwd": "/home/user/src",
                                "foreground": {"name": "pi", "cwd": "/home/user/src", "pid": 99},
                                "labels": {"herdr.space": "sp1", "herdr.tab": "tb1", "where": "src / test"},
                            }
                        ]
                    }
                }
            if method == "doc.get":
                return {
                    "result": {
                        "version": 3,
                        "value": {
                            "spaces": [
                                {
                                    "id": "sp1",
                                    "name": "",
                                    "folder": "/home/user",
                                    "tabs": [
                                        {
                                            "id": "tb1",
                                            "name": "test",
                                            "root": {
                                                "id": "tb1",
                                                "type": "row",
                                                "children": [
                                                    {"id": "p1", "type": "block", "content": {"terminal": "t8"}}
                                                ],
                                            },
                                        }
                                    ],
                                }
                            ]
                        },
                    }
                }
            return None

        with patch.object(adapter, "herdr_app_rpc", return_value=None), \
                patch.object(adapter, "hc_rpc", side_effect=fake_hc_rpc):
            world = adapter.HcWorld()
            self.assertEqual(world.workspaces[0]["label"], "src")
            self.assertEqual(world.workspaces[0]["cwd"], "/home/user/src")
            self.assertIsNotNone(world.resolve_pane("devserver/t8", hydrate=False))
            self.assertEqual(world.resolve_pane("devserver/t8", hydrate=False)["pane_id"], "p1")

    def test_remote_tab_create_and_rename_use_dict_labels_and_focus_prefix(self):
        calls = []

        def fake_hc_rpc(method, params=None, timeout=5.0):
            calls.append((method, params))
            if method == "terminal.list":
                return {"result": {"terminals": []}}
            if method == "doc.get":
                return {
                    "result": {
                        "version": 1,
                        "value": {"spaces": [{"id": "sp1", "name": "src", "folder": "/home/user/src", "tabs": []}]},
                    }
                }
            if method == "terminal.run":
                return {"result": {"address": "t9"}}
            if method == "doc.set":
                return {"result": {"version": 2}}
            return {"result": {}}

        with patch.object(adapter, "herdr_app_rpc", return_value=None), \
                patch.object(adapter, "hc_rpc", side_effect=fake_hc_rpc):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = adapter.handle_hc_herdr_cli(
                    ["tab", "create", "--workspace", "sp1", "--cwd", "/home/user/src", "--label", "ask-slug", "--focus"]
                )
            self.assertEqual(rc, 0)
            out = adapter.json.loads(buf.getvalue())
            self.assertTrue(out["result"]["root_pane"]["pane_id"].startswith("pf"))
            run_call = next(p for m, p in calls if m == "terminal.run")
            self.assertIsInstance(run_call["labels"], dict)
            self.assertTrue(run_call["no_parent"])
            self.assertTrue(run_call["outlive_parent"])

            buf_rename = io.StringIO()
            with contextlib.redirect_stdout(buf_rename):
                rc_rename = adapter.handle_hc_herdr_cli(
                    ["tab", "rename", out["result"]["tab"]["tab_id"], "renamed-slug"]
                )
            self.assertEqual(rc_rename, 0)


class PaneMoveTests(unittest.TestCase):
    def setUp(self):
        self.pane = {"pane_id": "p1", "terminal_id": "t1", "tab_id": "tb1",
                     "workspace_id": "sp1", "machine": None, "foreground_cwd": "/work/repo"}
        self.leaf = {"id": "p1", "type": "block", "size": {"weight": 0.3},
                     "content": {"terminal": "t1"}, "border": {"color": "accent"}}
        self.other = {"id": "p2", "type": "block", "content": {"terminal": "t2"}}
        self.doc = {"spaces": [{"id": "sp1", "name": "original", "folder": "/work",
                                "tabs": [{"id": "tb1", "name": "task",
                                          "root": {"id": "tb1", "type": "row", "gap": 6,
                                                   "children": [self.leaf]}}]}]}
        self.calls = []
        self.saved = None

    def rpc(self, method, params):
        self.calls.append((method, copy.deepcopy(params)))
        if method == "doc.get":
            return {"result": {"value": copy.deepcopy(self.doc), "version": 7}}
        if method == "doc.set":
            self.saved = copy.deepcopy(params["value"])
            return {"result": {"version": 8}}
        if method == "terminal.label":
            self.assertIsNotNone(self.saved, "commit layout before changing labels")
            return {"result": {}}
        self.fail(f"unexpected lifecycle/RPC operation: {method}")

    def app_layout(self, doc):
        prefix = f"{self.pane['machine']}/" if self.pane["machine"] else ""
        return {"spaces": [{"id": prefix + sp["id"], "tabs": [
            {"id": prefix + tb["id"], "terminals": [
                {"pane": prefix + p["pane"], "terminal": prefix + p["terminal"]}
                for p in adapter.collect_doc_panes(tb["root"])]}
            for tb in sp["tabs"]]} for sp in doc["spaces"]]}

    def move(self, **kwargs):
        with patch.object(adapter, "hc_rpc", side_effect=self.rpc), \
                patch.object(adapter, "herdr_app_socket_path", return_value=None):
            return adapter.move_hc_pane(self.pane, **kwargs)

    def test_lone_tab_moves_to_named_workspace_without_respawning(self):
        original_tab = copy.deepcopy(self.doc["spaces"][0]["tabs"][0])
        moved = self.move(new_workspace=True, label="Fix Tab Extraction", tab_label="Fix Tab Extraction")
        self.assertEqual(len(self.saved["spaces"]), 1)  # remove empty source space
        destination = self.saved["spaces"][0]
        self.assertNotEqual(destination["id"], "sp1")
        self.assertEqual(destination["name"], "Fix Tab Extraction")
        self.assertEqual(destination["folder"], "/work/repo")
        tab = destination["tabs"][0]
        self.assertEqual(tab["id"], "tb1")  # keep the tab's view state
        self.assertEqual(tab["name"], "Fix Tab Extraction")
        self.assertEqual(tab["root"], original_tab["root"])
        self.assertEqual(moved["pane_id"], "p1")
        self.assertEqual(moved["terminal_id"], "t1")
        self.assertEqual(moved["workspace_id"], destination["id"])
        self.assertEqual([m for m, _ in self.calls], ["doc.get", "doc.set", "terminal.label"])
        self.assertEqual(self.calls[1][1]["version"], 7)
        self.assertEqual(self.calls[2][1]["labels"], {"herdr.space": destination["id"], "herdr.tab": "tb1"})

    def test_extract_tab_leaves_other_tabs_in_source_space(self):
        other_tab = {"id": "tb2", "name": "other", "root": {"id": "p2", "type": "block", "content": {"terminal": "t2"}}}
        self.doc["spaces"][0]["tabs"].append(copy.deepcopy(other_tab))
        self.move(new_workspace=True, label="new")
        self.assertEqual(self.saved["spaces"][0]["tabs"], [other_tab])
        self.assertEqual(self.saved["spaces"][1]["tabs"][0]["name"], "task")

    def test_split_pane_moves_to_new_tab_and_prunes_empty_nested_splits(self):
        root = self.doc["spaces"][0]["tabs"][0]["root"]
        root["children"] = [{"id": "nested", "type": "column", "children": [self.leaf]}, self.other]
        moved = self.move(new_workspace=False, label="extracted")
        self.assertEqual(len(self.saved["spaces"]), 1)
        tabs = self.saved["spaces"][0]["tabs"]
        self.assertEqual(tabs[0]["root"]["children"], [self.other])
        self.assertEqual(tabs[0]["root"]["gap"], 6)
        self.assertEqual(tabs[1]["name"], "extracted")
        new_leaf = tabs[1]["root"]["children"][0]
        self.assertEqual(new_leaf["id"], "p1")
        self.assertEqual(new_leaf["border"], self.leaf["border"])
        self.assertNotIn("size", new_leaf)
        self.assertEqual(moved["tab_id"], tabs[1]["id"])
        self.assertEqual(moved["workspace_id"], "sp1")

    def test_split_pane_moves_to_new_workspace_without_moving_other_panes(self):
        self.doc["spaces"][0]["tabs"][0]["root"]["children"].append(self.other)
        self.move(new_workspace=True, label="space", tab_label="tab")
        self.assertEqual(self.saved["spaces"][0]["tabs"][0]["root"]["children"], [self.other])
        self.assertEqual(self.saved["spaces"][1]["tabs"][0]["name"], "tab")
        self.assertNotEqual(self.saved["spaces"][1]["tabs"][0]["id"], "tb1")

    def test_mod_pane_is_preserved_not_mistaken_for_empty_tab(self):
        mod = {"id": "pm", "type": "block", "content": {"mod": "files", "props": {"file": "foo"}}}
        self.doc["spaces"][0]["tabs"][0]["root"]["children"].append(mod)
        self.move(new_workspace=False)
        tabs = self.saved["spaces"][0]["tabs"]
        self.assertEqual(tabs[0]["root"]["children"], [mod])
        self.assertEqual(tabs[1]["name"], "")

    def test_lone_pane_new_tab_removes_empty_source_tab_but_keeps_space(self):
        self.move(new_workspace=False)
        tabs = self.saved["spaces"][0]["tabs"]
        self.assertEqual(len(tabs), 1)
        self.assertNotEqual(tabs[0]["id"], "tb1")
        self.assertEqual(tabs[0]["name"], "")

    def test_empty_workspace_label_uses_automatic_name(self):
        self.move(new_workspace=True, label="", tab_label="")
        self.assertEqual(self.saved["spaces"][0]["name"], "")
        self.assertEqual(self.saved["spaces"][0]["tabs"][0]["name"], "")

    def test_failed_or_uncertain_doc_write_does_not_relabel_or_focus(self):
        for write_reply in ({"error": {"kind": "version_conflict"}}, None):
            self.calls = []
            def fail_write(method, params):
                if method == "doc.set":
                    self.calls.append((method, params))
                    return write_reply
                return self.rpc(method, params)
            with patch.object(adapter, "hc_rpc", side_effect=fail_write), \
                    patch.object(adapter, "herdr_app_do") as do:
                with self.assertRaises(adapter.AdapterError):
                    adapter.move_hc_pane(self.pane, new_workspace=True, focus=True)
            self.assertEqual([m for m, _ in self.calls], ["doc.get", "doc.set"])
            do.assert_not_called()

    def test_missing_doc_or_stale_target_does_not_mutate(self):
        for reply in (None, {"result": {"value": None, "version": 0}},
                      {"result": {"value": {"spaces": []}, "version": 7}}):
            with patch.object(adapter, "hc_rpc", return_value=reply) as rpc:
                with self.assertRaises(adapter.AdapterError):
                    adapter.move_hc_pane(self.pane, new_workspace=True)
            rpc.assert_called_once_with("doc.get", {"name": "herdr-app"})
        self.pane["pane_id"] = "stale"
        with patch.object(adapter, "hc_rpc", side_effect=self.rpc):
            with self.assertRaises(adapter.AdapterError):
                adapter.move_hc_pane(self.pane, new_workspace=True)
        self.assertEqual([m for m, _ in self.calls], ["doc.get"])

    def test_headless_idless_pane_uses_terminal_as_pane_id(self):
        self.leaf.pop("id")
        self.pane["pane_id"] = "t1"
        moved = self.move(new_workspace=True)
        self.assertEqual(moved["pane_id"], "t1")
        self.assertEqual(self.saved["spaces"][0]["tabs"][0]["root"]["children"], [self.leaf])

    def test_label_failure_reports_already_saved_layout(self):
        def fail_label(method, params):
            if method == "terminal.label":
                return {"error": {"kind": "not_found"}}
            return self.rpc(method, params)
        with patch.object(adapter, "hc_rpc", side_effect=fail_label), \
                patch.object(adapter, "herdr_app_do") as do:
            with self.assertRaisesRegex(adapter.AdapterError, "layout saved.*labels"):
                adapter.move_hc_pane(self.pane, new_workspace=True, focus=True)
        self.assertIsNotNone(self.saved)
        do.assert_not_called()

    def test_focus_waits_until_window_has_consumed_document(self):
        def read_layout(payload):
            self.assertEqual(payload, {"ls": True})
            return self.app_layout(self.doc if read_layout.first else self.saved)
        read_layout.first = True
        def tick(_seconds):
            read_layout.first = False
        with patch.object(adapter, "hc_rpc", side_effect=self.rpc), \
                patch.object(adapter, "herdr_app_socket_path", return_value="/tmp/app.sock"), \
                patch.object(adapter, "herdr_app_rpc", side_effect=read_layout) as reads, \
                patch.object(adapter.time, "sleep", side_effect=tick), \
                patch.object(adapter, "herdr_app_do", return_value={"ok": True}) as do:
            adapter.move_hc_pane(self.pane, new_workspace=True, label="named", focus=True)
        self.assertEqual(reads.call_count, 2)
        do.assert_called_once_with("pane.focus", {"terminal": "t1"})  # no racy rename

    def test_window_timeout_reports_saved_move_without_retry_or_focus(self):
        with patch.object(adapter, "hc_rpc", side_effect=self.rpc), \
                patch.object(adapter, "herdr_app_socket_path", return_value="/tmp/app.sock"), \
                patch.object(adapter, "herdr_app_rpc", return_value={"spaces": []}), \
                patch.object(adapter.time, "monotonic", side_effect=[0, 6]), \
                patch.object(adapter, "herdr_app_do") as do:
            with self.assertRaisesRegex(adapter.AdapterError, "layout saved"):
                adapter.move_hc_pane(self.pane, new_workspace=True, focus=True)
        self.assertEqual([m for m, _ in self.calls], ["doc.get", "doc.set", "terminal.label"])
        do.assert_not_called()

    def test_remote_move_uses_local_ids_in_remote_doc_and_qualified_window_ids(self):
        self.pane = {**self.pane, "machine": "devserver",
                     **{key: "devserver/" + self.pane[key] for key in
                        ("pane_id", "terminal_id", "tab_id", "workspace_id")}}
        with patch.object(adapter, "hc_rpc", side_effect=self.rpc), \
                patch.object(adapter, "herdr_app_socket_path", return_value="/tmp/app.sock"), \
                patch.object(adapter, "herdr_app_rpc", side_effect=lambda _: self.app_layout(self.saved)), \
                patch.object(adapter, "herdr_app_do", return_value={"ok": True}) as do:
            moved = adapter.move_hc_pane(self.pane, new_workspace=True, label="remote", focus=True)
        self.assertTrue(moved["workspace_id"].startswith("devserver/sp"))
        for _, params in self.calls[:2]:
            self.assertEqual(params["on"], "devserver")
        self.assertNotIn("on", self.calls[2][1])  # terminal.label routes by qualified address
        self.assertEqual(self.calls[2][1]["terminal"], "devserver/t1")
        self.assertFalse(self.calls[2][1]["labels"]["herdr.space"].startswith("devserver/"))
        do.assert_called_once_with("pane.focus", {"terminal": "devserver/t1"})

    def test_cli_dispatch_honors_focus_flags_and_returns_destination_ids(self):
        world = Mock()
        world.resolve_pane.return_value = self.pane
        for flag, expected_focus in (("--focus", True), ("--no-focus", False)):
            with patch.object(adapter, "HcWorld", return_value=world), \
                    patch.object(adapter, "move_hc_pane", return_value={**self.pane, "workspace_id": "sp2"}) as move, \
                    contextlib.redirect_stdout(io.StringIO()) as out:
                rc = adapter.handle_hc_herdr_cli(["pane", "move", "p1", "--new-workspace", "--label", "space", "--tab-label", "tab", flag])
            self.assertEqual(rc, 0)
            move.assert_called_once_with(self.pane, new_workspace=True, label="space", tab_label="tab", focus=expected_focus)
            self.assertEqual(adapter.json.loads(out.getvalue())["result"]["move_result"]["pane"]["workspace_id"], "sp2")


if __name__ == "__main__":
    unittest.main()
