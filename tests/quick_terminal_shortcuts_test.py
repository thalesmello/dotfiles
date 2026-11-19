"""Offline checks for the double-Ctrl quick-terminal bridge."""
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path("stow_modules/main")


class QuickTerminalShortcutsTest(unittest.TestCase):
    def test_double_ctrl_emits_f20_not_hyper_slash(self):
        source = (ROOT / "dot-config/karabiner.edn").read_text()
        rule = next(line for line in source.splitlines()
                    if "[:##left_control :##left_control [\"control-pressed-once\" 1]" in line)
        self.assertIn(":alone :f20", rule)
        self.assertNotIn(":!TOCslash", rule)
        self.assertIn(":held :!Ospacebar", rule)

    def test_ghostty_uses_only_f20_for_quick_terminal(self):
        lines = (ROOT / "dot-config/ghostty/config").read_text().splitlines()
        keys = [line for line in lines if line.startswith("keybind =")
                and line.endswith("=toggle_quick_terminal")]
        self.assertEqual(keys, ["keybind = global:f20=toggle_quick_terminal"])

    def test_iterm_profile_uses_unmodified_f20(self):
        data = json.loads(subprocess.check_output([
            "plutil", "-convert", "json", "-o", "-",
            "itermfiles/com.googlecode.iterm2.plist"]))
        profiles = [p for p in data["New Bookmarks"] if p.get("Has Hotkey")]
        self.assertEqual(len(profiles), 1)
        profile = profiles[0]
        self.assertEqual(profile["HotKey Key Code"], 90)
        self.assertEqual(profile["HotKey Modifier Flags"], 0)
        self.assertEqual(profile["HotKey Characters"], "\uf717")
        self.assertEqual(profile["HotKey Characters Ignoring Modifiers"], "\uf717")
        self.assertFalse(profile["HotKey Activated By Modifier"])

    def test_hyper_slash_is_no_longer_a_terminal_launcher(self):
        source = (ROOT / "dot-hammerspoon/keybindings.lua").read_text()
        self.assertNotIn('bindOnce(hyper, "/"', source)

    def test_helpers_match_the_new_hotkey(self):
        ghostty = (ROOT / "dot-hammerspoon/ghosttyPreset.lua").read_text()
        self.assertEqual(ghostty.count('Preset.sendKeys({"f20"})'), 2)
        self.assertNotIn('Preset.sendKeys({"f17"})', ghostty)
        iterm = Path("bin/iterm-preset").read_text()
        self.assertIn("hs-preset send-keys f20", iterm)
        self.assertNotIn("hs-preset send-keys f13", iterm)


if __name__ == "__main__":
    unittest.main()
