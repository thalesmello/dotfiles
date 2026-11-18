"""Harpoon integration tests. All desktop/core commands are mocked in fish."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "stow_modules/main/dot-config/fish/functions/yabai-harpoon.fish"
FISH = shutil.which("fish")
MOCKS = r'''
function display-message; end
function term-preset; end
function hc-preset
    echo 'Unexpected core/remote command' >&2
    return 99
end
function yabai-preset
    switch $argv[1]
    case query-windows
        if contains -- --window $argv
            echo $MOCK_WINDOW
        else
            echo $MOCK_WINDOWS
        end
    case query-focused-window
        echo $MOCK_WINDOW
    case get-focused-window-id
        echo $MOCK_FOCUSED_WINDOW
    case focus-window-id
        printf 'window:%s\n' $argv[-1] >> $MOCK_CALLS
    end
end
function herdr-app
    switch $argv[1]
    case status
        echo $MOCK_STATUS
        return $MOCK_STATUS_RC
    case do
        printf '%s\n' (string join '|' -- $argv) >> $MOCK_CALLS
        return $MOCK_FOCUS_RC
    end
end
function ghostty-preset
    switch $argv[1]
    case is-herdr-zoomed-or-single-surface
        return 0
    case execute-herdr-command
        printf 'legacy:%s\n' $argv[2] >> $MOCK_CALLS
        if string match -q '*get-pin-json' -- $argv[2]
            echo '{"type":"herdr_pane","pane_id":"p1","session":"remote","name":"TUI"}'
        end
    end
end
'''


@unittest.skipUnless(FISH and shutil.which("jq"), "fish and jq required")
class HarpoonTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.calls = self.home / "calls"
        self.env = dict(os.environ, HOME=str(self.home), MOCK_CALLS=str(self.calls),
                        MOCK_WINDOW=json.dumps({"id": 42, "app": "Herdr", "title": "Work"}),
                        MOCK_WINDOWS=json.dumps([{"id": 42, "app": "Herdr", "title": "Work"}]),
                        MOCK_FOCUSED_WINDOW="42", MOCK_STATUS_RC="0", MOCK_FOCUS_RC="0",
                        MOCK_STATUS=json.dumps({"focused_pane": "devserver/p1"}))

    def run_fish(self, command, stdin=None):
        return subprocess.run([FISH, "--no-config", "-c", f"source '{SOURCE}';\n{MOCKS}\n{command}"],
                              input=stdin, text=True, capture_output=True, env=self.env)

    def pin(self, **kwargs):
        return dict(type="herdr_app_pane", app="Herdr", pane_id="devserver/p1", window_id=42, **kwargs)

    def focus(self, pin):
        return self.run_fish("yabai-harpoon focus-pin-json", json.dumps(pin) + "\n")

    def test_add_native_remote_and_dedupe_without_core(self):
        result = self.run_fish("yabai-harpoon add; and yabai-harpoon add")
        self.assertEqual(result.returncode, 0, result.stderr)
        pins = json.loads((self.home / ".yabai-harpoon.json").read_text())["pins"]
        self.assertEqual(len(pins), 1)
        self.assertEqual(pins[0]["type"], "herdr_app_pane")
        self.assertEqual(pins[0]["pane_id"], "devserver/p1")
        self.assertFalse(self.calls.exists())

    def test_local_and_remote_panes_have_distinct_identity(self):
        self.assertEqual(self.run_fish("yabai-harpoon add").returncode, 0)
        self.env["MOCK_STATUS"] = '{"focused_pane":"p1"}'
        self.assertEqual(self.run_fish("yabai-harpoon add").returncode, 0)
        pins = json.loads((self.home / ".yabai-harpoon.json").read_text())["pins"]
        self.assertEqual(len({p["uuid"] for p in pins}), 2)

    def test_capture_rejects_missing_invalid_or_failed_status(self):
        for status in ['{}', '{"focused_pane":null}', '{"focused_pane":""}', '{"focused_pane":2}', 'broken']:
            self.env["MOCK_STATUS"] = status
            self.assertNotEqual(self.run_fish("yabai-harpoon capture-herdr-app-pin").returncode, 0, status)
        self.env.update(MOCK_STATUS='{"focused_pane":"p1"}', MOCK_STATUS_RC="1")
        self.assertNotEqual(self.run_fish("yabai-harpoon capture-herdr-app-pin").returncode, 0)

    def test_focus_native_remote_is_one_local_app_command(self):
        result = self.focus(self.pin())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls.read_text().splitlines(),
                         ['window:42', 'do|pane.focus|--pane|devserver/p1'])

    def test_reopened_window_ignores_changed_title(self):
        self.env["MOCK_WINDOWS"] = '[{"id":99,"app":"Herdr","title":"Other work"},{"id":42,"app":"Other"}]'
        result = self.focus(self.pin())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls.read_text().splitlines()[0], 'window:99')

    def test_closed_app_and_gone_pane_report_failure(self):
        self.env["MOCK_WINDOWS"] = '[]'
        self.assertNotEqual(self.focus(self.pin()).returncode, 0)
        self.assertFalse(self.calls.exists())
        self.env["MOCK_WINDOWS"] = '[{"id":42,"app":"Herdr"}]'
        self.env["MOCK_FOCUS_RC"] = "1"
        self.assertNotEqual(self.focus(self.pin()).returncode, 0)

    def test_previous_native_pin_uses_fast_path(self):
        pin = self.pin(session="default")
        pin["type"] = "herdr_pane"
        self.assertEqual(self.focus(pin).returncode, 0)
        self.assertNotIn('legacy:', self.calls.read_text())

    def test_next_prev_matches_exact_pane_and_front_window(self):
        (self.home / ".yabai-harpoon.json").write_text(json.dumps({"pins": [self.pin()]}))
        self.assertEqual(self.run_fish("yabai-harpoon focused-matches-pin 1").returncode, 0)
        self.env["MOCK_STATUS"] = '{"focused_pane":"p1"}'
        self.assertNotEqual(self.run_fish("yabai-harpoon focused-matches-pin 1").returncode, 0)
        self.env.update(MOCK_STATUS='{"focused_pane":"devserver/p1"}',
                        MOCK_WINDOW='{"id":99,"app":"Other"}')
        self.assertNotEqual(self.run_fish("yabai-harpoon focused-matches-pin 1").returncode, 0)
        self.env["MOCK_WINDOW"] = '{"id":99,"app":"Herdr"}'
        self.assertEqual(self.run_fish("yabai-harpoon focused-matches-pin 1").returncode, 0,
                         'reopened app must still match the exact pane')

    def test_tui_capture_and_focus_keep_callback_and_session_guard(self):
        self.env.update(MOCK_WINDOW='{"id":42,"app":"Ghostty","title":"remote"}',
                        MOCK_WINDOWS='[{"id":42,"app":"Ghostty","title":"remote"}]')
        result = self.run_fish("yabai-harpoon get-focused-pin-json")
        self.assertEqual(result.returncode, 0, result.stderr)
        pin = json.loads(result.stdout)
        self.assertEqual(pin["type"], "herdr_pane")
        self.assertEqual(pin["session"], "remote")
        result = self.focus(pin)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--session", self.calls.read_text())
        self.assertIn("legacy:hc-preset focus-pane", self.calls.read_text())

    def test_normalize_preserves_both_pin_formats(self):
        pins = [self.pin(), dict(type="herdr_pane", pane_id="p1", session="remote", uuid="old")]
        result = self.run_fish("yabai-harpoon normalize-pins", '\n'.join(map(json.dumps, pins)) + '\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(list(map(json.loads, result.stdout.splitlines())), pins)


if __name__ == "__main__":
    unittest.main()
