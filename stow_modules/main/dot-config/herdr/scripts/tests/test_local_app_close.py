"""Local-only Herdr app confirmation tests; no live terminals or IPC."""
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location("local_confirm_close", Path(__file__).resolve().parents[1] / "confirm-close.py")
cc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cc)


def window():
    return {"spaces": [
        {"tabs": [{"terminals": [{"pane": "p1", "terminal": "t1"}]}]},
        {"tabs": [{"terminals": [{"pane": "remote/p1", "terminal": "remote/t1"}]}]},
    ]}


class LocalAppCloseTest(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "HERDR_APP_HOME": "/tmp/local-window", "HC_TERMINAL_SOCKET": "/tmp/local-core.sock",
            "HC_SOCKET": "/remote/incorrect-core.sock", "HC_TERMINAL_ID": "remote/t99",
            "HERDR_BIN_PATH": "/remote/broken/hc-preset", "HERDR_SOCKET_PATH": "/remote/legacy.sock",
        }, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        rpc_patch = patch.object(cc, "local_json_request", side_effect=[window(), {"result": {"type": "ok"}}])
        self.rpc = rpc_patch.start()
        self.addCleanup(rpc_patch.stop)

    def test_local_and_remote_targets_use_only_local_controller_sockets(self):
        for pane, terminal in (("p1", "t1"), ("remote/p1", "remote/t1")):
            self.rpc.reset_mock()
            self.rpc.side_effect = [window(), {"result": {"type": "ok"}}]
            cc.local_app_close(pane, terminal)
            self.assertEqual(self.rpc.call_count, 2)
            self.assertEqual(self.rpc.call_args_list[0].args, ("/tmp/local-window/herdr-app.sock", {"ls": True}))
            self.assertEqual(self.rpc.call_args_list[1].args, ("/tmp/local-core.sock", {
                "jsonrpc": "2.0", "id": 1, "method": "terminal.kill", "params": {"terminal": terminal}}))

    def test_changed_terminal_cancels_without_core_request(self):
        with self.assertRaises(cc.CliError):
            cc.local_app_close("remote/p1", "t1")
        self.assertEqual(self.rpc.call_count, 1)

    def test_missing_qualified_pane_never_aliases_local_pane(self):
        self.rpc.side_effect = [{"spaces": [{"tabs": [{"terminals": [{"pane": "p1", "terminal": "t1"}]}]}]}]
        with self.assertRaises(cc.CliError):
            cc.local_app_close("remote/p1", "remote/t1")
        self.assertEqual(self.rpc.call_count, 1)

    def test_standalone_terminal_requires_exact_captured_pair(self):
        self.rpc.side_effect = [{"spaces": []}, {"result": {}}]
        cc.local_app_close("remote/t1", "remote/t1")
        self.assertEqual(self.rpc.call_args.args[1]["params"], {"terminal": "remote/t1"})

    def test_missing_terminal_identity_cancels_before_any_ipc(self):
        with self.assertRaises(cc.CliError):
            cc.local_app_close("p1", "")
        self.rpc.assert_not_called()

    def test_missing_local_core_never_uses_inherited_target_socket(self):
        del os.environ["HC_TERMINAL_SOCKET"]
        with self.assertRaises(cc.CliError):
            cc.local_app_close("p1", "t1")
        self.assertEqual(self.rpc.call_count, 1)

    def test_missing_acknowledgment_never_retries_kill(self):
        self.rpc.side_effect = [window(), {}]
        with self.assertRaises(RuntimeError):
            cc.local_app_close("p1", "t1")
        self.assertEqual(self.rpc.call_count, 2)

    def test_controller_errors_never_retry_or_execute_remote_code(self):
        self.rpc.side_effect = [window(), RuntimeError("remote offline")]
        with self.assertRaises(RuntimeError):
            cc.local_app_close("remote/p1", "remote/t1")
        self.assertEqual(self.rpc.call_count, 2)

    def test_unflagged_app_prompt_also_cannot_fall_back_to_an_adapter(self):
        with patch.dict(os.environ, {"HC_PRESET_BACKEND": "hc", cc.ENV_PANE_ID: "remote/p1", cc.ENV_TERMINAL_ID: "remote/t1"}), \
                patch.object(cc.HerdrRunner, "cli", side_effect=AssertionError("must not load any hc-preset")), \
                patch.object(cc, "load_config", return_value=(cc.Config(), None)), \
                patch.object(cc, "run_prompt", side_effect=lambda p, proc, cmd, close, **kw: close() or 0):
            self.assertEqual(cc.main(["prompt"]), 0)
        self.assertEqual(self.rpc.call_count, 2)

    def test_prompt_flag_bypasses_entire_adapter_loader(self):
        with patch.dict(os.environ, {cc.ENV_PANE_ID: "remote/p1", cc.ENV_TERMINAL_ID: "remote/t1"}), \
                patch.object(cc.HerdrRunner, "cli", side_effect=AssertionError("must not load any hc-preset")), \
                patch.object(cc, "load_config", return_value=(cc.Config(), None)), \
                patch.object(cc, "run_prompt", side_effect=lambda p, proc, cmd, close, **kw: close() or 0):
            self.assertEqual(cc.main(["prompt", "--local-app"]), 0)
        self.assertEqual(self.rpc.call_count, 2)


class LocalJsonRequestTest(unittest.TestCase):
    def request(self, chunks):
        client = Mock()
        client.recv.side_effect = chunks
        with patch.object(cc.socket, "socket", return_value=client):
            result = cc.local_json_request("/tmp/mock.sock", {"ls": True})
        client.connect.assert_called_once_with("/tmp/mock.sock")
        client.sendall.assert_called_once_with(b'{"ls": true}\n')
        client.close.assert_called_once_with()
        return result

    def test_split_response_is_reassembled(self):
        self.assertEqual(self.request([b'{"res', b'ult":{}}\n']), {"result": {}})

    def test_remote_error_is_reported_not_silently_accepted(self):
        with self.assertRaises(RuntimeError):
            self.request([b'{"error":{"message":"offline"}}\n'])

    def test_incomplete_response_is_not_retried(self):
        with self.assertRaises(RuntimeError):
            self.request([b'{"result":', b''])


if __name__ == "__main__":
    unittest.main()
