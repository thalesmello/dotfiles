"""App snooze integration; all transports and timers are isolated from live Herdr."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock
from datetime import datetime, timedelta

SCRIPT = Path(__file__).resolve().parents[1] / "herdr-snooze.py"
spec = importlib.util.spec_from_file_location("snooze_app_test", SCRIPT)
snooze = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snooze)
backend = snooze.hc_backend()


class AppSnooze(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.env = mock.patch.dict(os.environ, {"HC_PRESET_BACKEND": "hc", "HERDR_APP_HOME": str(self.home),
                                               "HERDR_SOCKET_PATH": str(self.home / "legacy.sock")})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.panes = [{"pane_id": "p1", "terminal_id": "t1", "workspace_id": "sp1", "agent": "pi",
                       "agent_status": "working", "tokens": {}, "focused": False}]
        self.spaces = [{"id": "sp1", "tabs": [{"terminals": [{"pane": "p1", "terminal": "t1"}]}]}]
        self.machines = []
        self.metadata = []
        self.a = mock.Mock()
        self.a.herdr_app_home.return_value = str(self.home)
        self.a.hc_socket_path.return_value = str(self.home / "core.sock")
        self.a.HcWorld.side_effect = lambda **kw: SimpleNamespace(
            app_ls={"spaces": self.spaces}, panes=copy.deepcopy(self.panes),
            workspaces=[{"workspace_id": "sp1", "label": "project"}])
        self.a.load_json_file.side_effect = self.load
        self.a.save_json_file.side_effect = self.save
        self.a.hc_rpc.side_effect = lambda *args, **kw: {"result": {"machines": self.machines}}
        self.a.handle_hc_rpc_compat.side_effect = self.compat
        patch = mock.patch.object(backend, "adapter", return_value=self.a)
        patch.start()
        self.addCleanup(patch.stop)
        for name in ("arm_timer", "announce_wakes"):
            patch = mock.patch.object(snooze, name)
            patch.start()
            self.addCleanup(patch.stop)

    def load(self, path, default):
        try:
            return json.loads(Path(path).read_text())
        except FileNotFoundError:
            return default

    def save(self, path, value):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    def compat(self, method, params):
        self.metadata.append((method, params))
        if method == "pane.report_metadata":
            pane = next((p for p in self.panes if p["pane_id"] == params["pane_id"]), None)
            if pane:
                pane["tokens"].update(params["tokens"])
        return {"result": {}}

    def snooze_agent(self, when=""):
        return snooze.snooze("pane", "p1", datetime.now() + timedelta(hours=1),
                             snooze.load_config(), when=when)

    def test_backend_selection_preserves_explicit_legacy_context(self):
        self.assertTrue(backend.enabled())
        with mock.patch.dict(os.environ, {"HC_PRESET_BACKEND": "herdr"}):
            self.assertFalse(backend.enabled())
            self.assertEqual(snooze.socket_path(), str(self.home / "legacy.sock"))
        with mock.patch.dict(os.environ, {"HC_PRESET_BACKEND": ""}):
            self.assertFalse(backend.enabled())

    def test_separate_state_and_no_legacy_recovery(self):
        self.assertEqual(self.snooze_agent(), 1)
        self.assertEqual(snooze.state_dir(), str(self.home / "data/snooze"))
        with mock.patch.object(snooze, "prune_stale_sessions") as prune, \
             mock.patch.object(snooze, "recover_legacy") as recover:
            snooze.main(["tick"])
        prune.assert_not_called()
        recover.assert_not_called()

    def test_snooze_wake_and_metadata_transport(self):
        self.snooze_agent()
        self.assertIn("p1", snooze.read_state()["panes"])
        self.assertEqual(self.panes[0]["tokens"][snooze.MARK], "1")
        self.assertEqual(snooze.wake(snooze.load_config(), pane_ids=["p1"]), 1)
        self.assertEqual(snooze.read_state()["panes"], {})
        self.assertFalse(backend.read_json("agent-view.json", {}).get("active"))

    def test_toggle_walks_priority_grouped_snoozed_all(self):
        self.snooze_agent()
        expected = [("spaces", None), ("spaces", "snoozed"), ("spaces", "all"), ("priority", None)]
        for order, showing in expected:
            snooze.main(["toggle"])
            view = snooze.read_state()["view"]
            self.assertEqual(view.get("order") or snooze.panel_mode(), order)
            self.assertEqual(view.get("showing"), showing)

    def test_condition_wakes_on_done(self):
        self.snooze_agent(when="done")
        self.panes[0]["agent_status"] = "done"
        snooze.main(["tick"])
        self.assertNotIn("p1", snooze.read_state()["panes"])
        self.assertIn("p1", snooze.read_state()["woke"])

    def test_same_kind_replacement_does_not_inherit_snooze(self):
        self.panes[0]["foreground"] = {"pid": 100}
        self.snooze_agent()
        self.panes[0]["foreground"]["pid"] = 101
        snooze.main(["tick"])
        self.assertNotIn("p1", snooze.read_state()["panes"])

    def test_needs_you_wakes_immediately(self):
        self.snooze_agent()
        self.panes[0]["agent_status"] = "blocked"
        snooze.main(["tick"])
        self.assertNotIn("p1", snooze.read_state()["panes"])

    def test_deadline_wakes(self):
        self.snooze_agent()
        with snooze.locked_state() as state:
            state["panes"]["p1"]["until"] = snooze.now_ms() - 1
        snooze.main(["tick"])
        self.assertNotIn("p1", snooze.read_state()["panes"])

    def test_workspace_snooze_covers_new_agents(self):
        snooze.snooze("workspace", "sp1", datetime.now() + timedelta(hours=1), snooze.load_config())
        self.assertIn("p1", snooze.read_state()["panes"])
        self.panes.append({**self.panes[0], "pane_id": "p2", "terminal_id": "t2", "tokens": {}})
        self.spaces[0]["tabs"][0]["terminals"].append({"pane": "p2", "terminal": "t2"})
        snooze.main(["tick"])
        self.assertIn("p2", snooze.read_state()["panes"])

    def test_disconnection_does_not_delete_remote_snooze(self):
        self.panes[0].update(pane_id="remote/p1", terminal_id="remote/t1", workspace_id="remote/sp1")
        self.spaces[0]["tabs"][0]["terminals"] = [{"pane": "remote/p1", "terminal": "remote/t1"}]
        snooze.snooze("pane", "remote/p1", datetime.now() + timedelta(hours=1), snooze.load_config())
        self.panes = []
        self.spaces = [{"id": "local", "tabs": []}]
        self.machines = [{"name": "remote", "state": "disconnected"}]
        snooze.main(["tick"])
        self.assertIn("remote/p1", snooze.read_state()["panes"])

    def test_missing_app_keeps_state_for_retry(self):
        self.snooze_agent()
        self.spaces = []
        with self.assertRaises(snooze.HerdrError):
            snooze.main(["tick"])
        self.assertIn("p1", snooze.read_state()["panes"])

    def test_picker_launch_uses_explicit_argv_not_manifest_parser(self):
        self.a.hc_bin.return_value = "hc"
        self.a.herdr_app_do.return_value = {"ok": True}
        proc = SimpleNamespace(returncode=0, stdout='{"address":"t-popup"}', stderr="")
        with mock.patch.object(backend.subprocess, "run", return_value=proc) as run:
            backend.call("plugin.pane.open", {"plugin_id": "herdr-snooze", "entrypoint": "picker",
                         "env": {"HERDR_SNOOZE_TARGET": "remote/p1"}})
        argv = run.call_args.args[0]
        self.assertIn("--bg", argv)
        self.assertIn("remote/p1", argv[-1])
        self.assertIn("HC_PRESET_BACKEND=hc", argv[-1])
        self.assertEqual(self.load(self.home / "data/popup-request.json", {})["terminal"], "t-popup")


if __name__ == "__main__":
    unittest.main()
