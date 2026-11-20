"""Keep the two terminal transports aligned with prompt and Neovim redo."""
import json
from pathlib import Path
import unittest

CONFIG = Path(__file__).resolve().parents[1] / "stow_modules/main/dot-config"


class TerminalRedoTests(unittest.TestCase):
    def test_cmd_a_is_forwarded_to_applications(self):
        bindings = (CONFIG / "ghostty/config").read_text().splitlines()
        self.assertIn(r"keybind = super+a=text:\x1b[97;9u", bindings)
        config = json.loads((CONFIG / "herdr-app/keys.json").read_text())
        self.assertEqual(config["terminal"]["cmd-a"], "send:\x1b[97;9u")

    def test_ghostty_undo_and_redo(self):
        bindings = (CONFIG / "ghostty/config").read_text().splitlines()
        self.assertIn(r"keybind = cmd+z=text:\x1f", bindings)
        self.assertIn(r"keybind = cmd+shift+z=text:\x1b[47;6u", bindings)

    def test_herdr_undo_and_redo(self):
        config = json.loads((CONFIG / "herdr-app/keys.json").read_text())
        bindings = config["terminal"]
        self.assertEqual(bindings["cmd-z"], "send:\x1f")
        self.assertEqual(bindings["cmd-shift-z"], "send:\x1b[47;6u")


if __name__ == "__main__":
    unittest.main()
