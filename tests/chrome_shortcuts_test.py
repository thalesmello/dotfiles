"""Offline regression checks for Chrome-specific HJKL tab shortcuts."""
from pathlib import Path
import re
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "stow_modules/main/dot-hammerspoon/keybindings.lua"


class ChromeShortcutsTest(unittest.TestCase):
    def test_navigation_and_move_actions(self):
        source = SOURCE.read_text()
        expected = {
            (False, "h"): 'hs.eventtap.keyStroke({"cmd"}, "1")',
            (False, "j"): 'hs.eventtap.keyStroke({"ctrl"}, "tab")',
            (False, "k"): 'hs.eventtap.keyStroke({"ctrl", "shift"}, "tab")',
            (False, "l"): 'hs.eventtap.keyStroke({"cmd"}, "9")',
            (True, "h"): 'task({"osascript-preset", "send-keys", "ctrl", "shift", "k"})',
            (True, "j"): 'hs.eventtap.keyStroke({"ctrl", "shift"}, "pagedown")',
            (True, "k"): 'hs.eventtap.keyStroke({"ctrl", "shift"}, "pageup")',
            (True, "l"): 'task({"osascript-preset", "send-keys", "ctrl", "shift", "j"})',
        }
        for (shift, key), action in expected.items():
            with self.subTest(shift=shift, key=key):
                mods = '{"shift", "ctrl", "cmd"}' if shift else '{"ctrl", "cmd"}'
                pattern = re.escape(f'default:conditionalBind({mods}, "{key}", {{') + r"(.*?)\n  \}\)"
                blocks = re.findall(pattern, source, re.S)
                self.assertEqual(len(blocks), 1)
                self.assertIn('{app = "Google Chrome", function() ' + action + ' end}', blocks[0])


if __name__ == "__main__":
    unittest.main()
