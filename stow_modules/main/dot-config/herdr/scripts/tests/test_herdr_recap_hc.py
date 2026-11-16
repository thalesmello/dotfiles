"""Recap's modern backend, without a running app, agent or summarizer."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("recap_hc_test", SCRIPTS / "recap_hc.py")
hc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hc)
spec = importlib.util.spec_from_file_location("recap_test", SCRIPTS / "herdr-recap.py")
rc = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = rc
spec.loader.exec_module(rc)


class BackendTest(unittest.TestCase):
    def test_explicit_legacy_socket_wins_over_hc_identity(self):
        with mock.patch.dict(os.environ, {"HERDR_SOCKET_PATH": "/legacy.sock", "HC_TERMINAL_ID": "t1"}, clear=True), \
                mock.patch.object(hc, "adapter") as adapter:
            self.assertFalse(hc.enabled())
            adapter.assert_not_called()

    def test_prefix_backend_overrides_leaked_legacy_socket(self):
        with mock.patch.dict(os.environ, {"HC_PRESET_BACKEND": "hc", "HERDR_SOCKET_PATH": "/legacy.sock"}, clear=True):
            self.assertTrue(hc.enabled())

    def test_bridge_routes_to_core_not_legacy_socket(self):
        backend = mock.Mock()
        backend.enabled.return_value = True
        backend.call.return_value = {"agents": [{"pane_id": "p1", "terminal_id": "devserver/t1", "machine": "devserver",
                                                  "agent": "pi", "agent_status": "done", "cwd": "/launch", "foreground_cwd": "/actual"}]}
        with mock.patch.object(rc, "hc_backend", return_value=backend), mock.patch.object(rc.socket, "socket") as socket:
            agents = rc.list_agents()
        socket.assert_not_called()
        self.assertEqual((agents[0].terminal_id, agents[0].machine, agents[0].cwd), ("devserver/t1", "devserver", "/actual"))

    def test_core_failure_is_not_empty_agent_list(self):
        a = mock.Mock()
        a.handle_hc_rpc_compat.return_value = {"error": {"code": "offline"}}
        with mock.patch.object(hc, "adapter", return_value=a), self.assertRaises(RuntimeError):
            hc.call("agent.list", {})

    def test_remote_focus_uses_terminal_not_local_pane_default(self):
        a = mock.Mock()
        a.HcWorld.return_value.resolve_pane.return_value = {"pane_id": "devserver/p1", "terminal_id": "devserver/t1"}
        with mock.patch.object(hc, "adapter", return_value=a):
            hc.call("agent.focus", {"target": "devserver/p1"})
        a.herdr_app_do.assert_called_once_with("agent.focus", {"terminal": "devserver/t1"})

    def test_remote_close_uses_explicit_pane(self):
        a = mock.Mock()
        a.HcWorld.return_value.resolve_pane.return_value = {"pane_id": "devserver/p1", "terminal_id": "devserver/t1"}
        with mock.patch.object(hc, "adapter", return_value=a):
            hc.call("pane.close", {"pane_id": "devserver/p1"})
        a.herdr_app_do.assert_called_once_with("pane.close", {"pane": "devserver/p1"})

    def test_pin_uses_native_state(self):
        a = mock.Mock()
        a.HcWorld.return_value.resolve_pane.side_effect = lambda target, hydrate=False: {
            "terminal_id": "t1", "labels": {"herdr.pinned": "1"} if hydrate else {}}
        with mock.patch.object(hc, "adapter", return_value=a):
            hc.call("terminal.pin", {"pane_id": "p1"})
        a.HcWorld.return_value.resolve_pane.assert_called_once_with("p1", hydrate=True)
        a.herdr_app_do.assert_called_once_with("terminal.pin", {"terminal": "t1", "pinned": False})

    def test_send_respects_draft_and_blocked_gates(self):
        a = mock.Mock()
        a.HcWorld.return_value.resolve_pane.return_value = {"terminal_id": "t1"}
        with mock.patch.object(hc, "adapter", return_value=a), \
                mock.patch.object(hc, "core", return_value={"started": True}) as core:
            hc.call("agent.prompt", {"target": "p1", "text": "hello", "wait": {}}, 10)
        core.assert_called_once_with("terminal.send", {"terminal": "t1", "text": "hello"}, timeout=75)

    def test_uncertain_send_is_not_retried(self):
        a = mock.Mock()
        a.HcWorld.return_value.resolve_pane.return_value = {"terminal_id": "t1"}
        with mock.patch.object(hc, "adapter", return_value=a), \
                mock.patch.object(hc, "core", return_value={"started": False}) as core, self.assertRaises(RuntimeError):
            hc.call("agent.prompt", {"target": "p1", "text": "hello"})
        self.assertEqual(core.call_count, 1)

    def test_action_opens_recap_without_legacy_plugin_manifest(self):
        a = mock.Mock()
        a.herdr_app_home.return_value = "/tmp/custom-app"
        with mock.patch.object(hc, "adapter", return_value=a), \
                mock.patch.object(hc, "core", return_value={"address": "t99"}) as core:
            opened = hc.call("plugin.pane.open", {"plugin_id": "herdr-recap", "entrypoint": "picker"})
        core.assert_called_once()
        method, params = core.call_args.args
        self.assertEqual(method, "terminal.run")
        self.assertEqual(params["env"]["HC_PRESET_BACKEND"], "hc")
        self.assertEqual(params["env"]["HERDR_APP_HOME"], "/tmp/custom-app")
        self.assertTrue(params["argv"][1].endswith("herdr-recap.py"))
        self.assertEqual(opened["pane"]["terminal_id"], "t99")
        a.herdr_app_do.assert_called_once_with("mod.open", {"name": "prefix"})
        a.save_json_file.assert_called_once()

    def test_failed_popup_display_cleans_only_launched_terminal(self):
        a = mock.Mock()
        a.herdr_app_home.return_value = "/tmp/custom-app"
        a.herdr_app_do.side_effect = RuntimeError("app offline")
        with mock.patch.object(hc, "adapter", return_value=a), \
                mock.patch.object(hc, "core", return_value={"address": "t99"}) as core, self.assertRaises(RuntimeError):
            hc.call("plugin.pane.open", {"plugin_id": "herdr-recap", "entrypoint": "picker"})
        self.assertEqual(core.call_args_list[-1].args, ("terminal.kill", {"terminal": "t99"}))

    def test_remote_repo_is_never_read_on_local_machine(self):
        backend = mock.Mock()
        backend.exec_on.side_effect = ["main\n", "# branch.ab +2 -1\n? new.txt\n", "1 file changed, 3 insertions(+), 4 deletions(-)\n"]
        with mock.patch.object(rc, "hc_backend", return_value=backend), \
                mock.patch.object(rc.subprocess, "run", side_effect=AssertionError("local git")):
            branch, changes = rc.repository_snapshot("/home/repo", "devserver")
        self.assertEqual(branch, "main")
        self.assertEqual(changes, rc.GitChanges(files=1, added=3, deleted=4, ahead=2, behind=1))
        self.assertTrue(all(c.args[0] == "devserver" for c in backend.exec_on.call_args_list))


class PiProbeTest(unittest.TestCase):
    sid = "12345678-1234-1234-1234-123456789abc"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env = mock.patch.dict(os.environ, {"PI_CODING_AGENT_DIR": str(self.root)}, clear=False)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.directory = self.root / "sessions/--work--"
        self.directory.mkdir(parents=True)

    def transcript(self, name="Job", sid=None):
        path = self.directory / ("2026-11-16T12-00-00-000Z_" + (sid or self.sid) + ".jsonl")
        path.write_text(json.dumps({"type": "session_info", "name": name}) + "\n" +
                        json.dumps({"type": "message", "message": {"role": "user", "content": "hello"}}) + "\n")
        return path

    def test_reported_path_is_authoritative(self):
        path = self.transcript()
        probe = hc.probe_pi({"kind": "path", "value": str(path)}, "/work", [], 0, "Other")
        self.assertEqual(probe["path"], str(path))
        self.assertIn("hello", probe["text"])

    def test_launch_uuid_resolves_existing_agent_without_reload(self):
        path = self.transcript()
        self.assertEqual(hc.probe_pi({}, "/work", ["pi", "--session-id", self.sid], 0, "")["path"], str(path))

    def test_persisted_unique_title_can_resolve_no_arg_launch(self):
        path = self.transcript()
        self.assertEqual(hc.probe_pi({}, "/work", ["pi"], 0, "Job")["path"], str(path))

    def test_ambiguous_title_never_guesses_latest_session(self):
        self.transcript()
        self.transcript(sid="87654321-1234-1234-1234-123456789abc")
        with self.assertRaisesRegex(RuntimeError, "/reload"):
            hc.probe_pi({}, "/work", ["pi"], 0, "Job")

    def test_uuid_missing_never_falls_back_to_different_session(self):
        self.transcript()
        with self.assertRaisesRegex(RuntimeError, "/reload"):
            hc.probe_pi({"kind": "id", "value": "87654321-1234-1234-1234-123456789abc"}, "/work", ["pi"], 0, "Job")

    def test_remote_snapshot_is_namespaced_private_and_fresh(self):
        path = self.transcript()
        snapshot = hc.probe_pi({"kind": "path", "value": str(path)}, "/work", [], 0, "")
        agent = rc.AgentInfo(pane_id="remote/p1", terminal_id="remote/t1", machine="remote", agent="pi")
        a = mock.Mock()
        a.HcWorld.return_value.resolve_pane.return_value = {"foreground": {}, "foreground_cwd": "/work"}
        with mock.patch.object(hc, "adapter", return_value=a), \
                mock.patch.object(hc, "exec_on", return_value=json.dumps(snapshot)) as remote, \
                mock.patch.object(hc, "probe_pi", side_effect=AssertionError("local PID")):
            # inspect needs the real function source, not the mocked function.
            with mock.patch.object(hc.inspect, "getsource", return_value="def probe_pi(*args): pass\n"):
                sid, cache = hc.pi_session(agent, self.root / "cache")
        self.assertEqual(sid, "remote:" + str(path))
        self.assertEqual(Path(cache).read_text(), snapshot["text"])
        self.assertEqual(Path(cache).stat().st_mtime_ns, snapshot["mtime_ns"])
        self.assertEqual(Path(cache).stat().st_mode & 0o777, 0o600)
        self.assertEqual(remote.call_args.args[0], "remote")


if __name__ == "__main__":
    unittest.main()
