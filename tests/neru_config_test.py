"""Offline Neru config checks; run from the original dotfiles checkout."""
from pathlib import Path
import math
import re
import string
import tomllib
import unittest

CONFIG = Path("stow_modules/main/dot-config/neru/config.toml")
MOUSELESS = Path("mouseless/config.yaml")
KARABINER = Path("stow_modules/main/dot-config/karabiner.edn")
KEYORDER = "qweruiopasdfjkl;zxcvm,./"


class NeruConfigTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = tomllib.loads(CONFIG.read_text())
        cls.yaml = MOUSELESS.read_text()

    def test_global_hotkeys_are_empty_and_sticky_modifiers_disabled(self):
        self.assertEqual(self.config["hotkeys"], {})
        self.assertIs(self.config["sticky_modifiers"]["enabled"], False)
        self.assertIs(self.config["general"]["passthrough_unbounded_keys"], True)

    def test_alternating_hand_five_by_three_recursive_layout(self):
        grid = self.config["recursive_grid"]
        # The launcher can change this managed block to the Mouseless preset.
        if grid["keys"] == "qwertasdfgzxcvb":
            left, right = "qwertasdfgzxcvb", "yuiophjkl;nm,./"
            self.assertEqual((grid["grid_cols"], grid["grid_rows"]), (5, 3))
            self.assertEqual(grid["max_depth"], 10)
            self.assertEqual(len(set(left)), 15)
            self.assertEqual(len(set(right)), 15)
            self.assertFalse(any(char.isdigit() for char in left + right))
            self.assertFalse(set(left) & set(right))
            overrides = {layer["depth"]: layer for layer in grid["layers"]}
            self.assertEqual(set(overrides), {1, 3, 5, 7, 9})
            for depth in range(11):
                layer = overrides.get(depth, grid)
                self.assertEqual((layer["grid_cols"], layer["grid_rows"]), (5, 3))
                self.assertEqual(layer["keys"], left if depth % 2 == 0 else right)
        else:
            self.assertEqual(grid["keys"], KEYORDER)
            self.assertEqual([(l["grid_cols"], l["grid_rows"]) for l in grid["layers"]],
                             [(1, 26), (26, 1), (2, 1), (8, 3)])
        self.assertEqual(grid["min_size_width"], 1)
        self.assertEqual(grid["min_size_height"], 1)

    def test_f16_yaml_fallback_preserves_hyper_semicolon(self):
        self.assertRegex(self.yaml, r"toggle overlay:\n    - ctrl\+cmd\+option\+;\n    - F16")
        self.assertRegex(self.yaml, r"(?m)^    hold for drag: Shift\+ControlLeft$")

    def test_right_shift_alone_maps_to_f16_without_changing_hold(self):
        self.assertRegex(KARABINER.read_text(),
                         r"\[:##right_shift\s+:right_shift\s+nil\s+"
                         r"\{:alone\s+:f16\s+:params\s+\{:alone\s+150\}\}\]")

    def test_restart_bindings_use_the_reciprocal_controller(self):
        text = Path("stow_modules/main/dot-hammerspoon/keybindings.lua").read_text()
        for key, method in (("n", "restartNeru"), ("m", "restartMouseless")):
            self.assertRegex(text, rf'restart:bindOnce\(hyper, "{key}", "[^"]+", navigation\.{method}\)')

    def test_f16_routes_to_regular_grid_and_toggles_it_closed(self):
        for mode in ("hints", "scroll", "vim", "bisect", "monitor_select"):
            self.assertEqual(self.config[mode]["hotkeys"]["F16"], "macro open_grid")
        for mode in ("grid", "recursive_grid"):
            self.assertEqual(self.config[mode]["hotkeys"]["F16"], "idle")

    def test_opacity_keys_are_bound_in_both_grids(self):
        for mode in ("grid", "recursive_grid"):
            self.assertEqual(self.config[mode]["hotkeys"]["-"], "macro opacity_down")
            self.assertEqual(self.config[mode]["hotkeys"]["="], "macro opacity_up")
        self.assertIn("adjustOpacity", self.config["macros"]["opacity_down"])

    def test_recursive_escape_backtracks_and_shift_escape_exits(self):
        keys = self.config["recursive_grid"]["hotkeys"]
        self.assertEqual(keys["Escape"], "action reset")
        self.assertEqual(keys["Shift+Escape"], "idle")
        self.assertEqual(keys["F16"], "idle")

    def test_click_confirmation_and_continuous_decision(self):
        for mode in ("hints", "recursive_grid", "grid", "scroll", "bisect"):
            keys = self.config[mode]["hotkeys"]
            self.assertEqual(keys["Space"], "macro confirm_left_stay")
            self.assertEqual(keys["Enter"], "macro confirm_left")
            self.assertEqual(keys["Alt+Space"], "macro confirm_right_stay")
            self.assertEqual(keys["Alt+Enter"], "macro confirm_right")
            self.assertEqual(keys["Cmd+Space"], "macro confirm_middle_stay")
            self.assertEqual(keys["Cmd+Enter"], "macro confirm_middle")
            for suffix in ("Space", "Enter"):
                ctrl = "macro start_hold" if mode in ("grid", "recursive_grid") else "macro confirm_middle"
                self.assertEqual(keys["Ctrl+" + suffix], ctrl)
            expected_drag = "macro toggle_drag" if mode in ("recursive_grid", "grid") else "action left_click --toggle"
            self.assertEqual(keys["Ctrl+Alt+Enter"], expected_drag)
        for button in ("left", "right", "middle"):
            self.assertEqual(self.config["macros"]["confirm_" + button],
                             [f"action {button}_click --bail-on-error", "macro after_click_exit"])
            self.assertEqual(self.config["macros"]["confirm_" + button + "_stay"],
                             [f"action {button}_click --bail-on-error", "macro after_click_stay"])
        self.assertIn("neruNavigation", self.config["macros"]["after_click"])
        self.assertNotIn("--action", self.config["macros"]["open_recursive"])

    def test_vim_return_clicks_then_quits_but_space_stays(self):
        keys = self.config["vim"]["keymaps"]
        self.assertEqual(keys["normal"]["<CR>"], "<Plug>(left-click):q<CR>")
        self.assertEqual(keys["normal"]["<Space>"], "<Plug>(left-click)")
        self.assertEqual(keys["visual"]["<Space>"], "<Plug>(left-click)")
        # Visual Return retains native drag/select behavior; typing is unaffected.
        self.assertNotIn("<CR>", keys["visual"])
        self.assertNotIn("Enter", self.config["vim"]["hotkeys"])

    def test_native_grid_alternates_three_label_keys_and_right_subgrid(self):
        grid = self.config["grid"]
        left, right = "wertasdfgzxcvb", "yuiophjklnm"
        self.assertNotIn("q", grid["characters"])
        self.assertNotIn("q", grid["row_labels"])
        self.assertEqual(grid["characters"], left)
        self.assertEqual(grid["row_labels"], left)
        self.assertEqual(grid["col_labels"], right)
        self.assertEqual(grid["sublayer_keys"], "uiojklm,.")
        for field in ("characters", "row_labels", "col_labels"):
            self.assertTrue(grid[field].isalpha(), field)
        self.assertTrue(set(grid["sublayer_keys"]) <= set(right + ",."))
        self.assertEqual(len(set(grid["sublayer_keys"])), 9)
        self.assertEqual(grid["max_label_length"], 3)
        for char in set(left + right):
            self.assertEqual(grid["hotkeys"]["Ctrl+Shift+" + char.upper()], f"action feed --mode {char}")
        self.assertEqual(self.config["macros"]["toggle_drag"],
                         ["action move_mouse --selection --bail-on-error", "action left_click --toggle"])

    def test_hint_labels_use_physically_held_mouse_modifiers(self):
        modifiers = self.config["hints"]["select_with"]
        self.assertEqual(modifiers["alt"], "action right_click")
        self.assertEqual(modifiers["cmd"], "action middle_click")
        self.assertEqual(modifiers["ctrl"], "action middle_click")

    def test_vim_modifier_clicks_target_its_cursor(self):
        keys = self.config["vim"]["hotkeys"]
        for mod, target in (("Alt", "r"), ("Cmd", "m")):
            click = f"action feed --mode g {target}"
            self.assertEqual(keys[mod + "+Space"], click)
            self.assertEqual(keys[mod + "+Enter"], [click, "idle"])
        visual = self.config["vim"]["keymaps"]["visual"]
        self.assertEqual(visual["gr"], "<Plug>(right-click)")
        self.assertEqual(visual["gm"], "<Plug>(middle-click)")

    def test_ctrl_starts_latched_drag_in_grid_and_vim(self):
        for mode in ("grid", "recursive_grid", "vim"):
            for suffix in ("Space", "Enter"):
                self.assertEqual(self.config[mode]["hotkeys"]["Ctrl+" + suffix], "macro start_hold")
        self.assertIn("startHold", self.config["macros"]["start_hold"])
        source = Path("stow_modules/main/dot-hammerspoon/neruNavigation.lua").read_text()
        self.assertIn("state.dropHold(key == 36)", source)
        self.assertIn('command({"run", "action reset"}', source)

    def test_shift_mouse_chords_move_without_clicking(self):
        for mode in ("hints", "recursive_grid", "grid", "scroll", "bisect"):
            base = "confirm_move_bare" if mode in ("hints", "scroll") else "confirm_move"
            self.assertEqual(self.config[mode]["hotkeys"]["Shift+Space"], "macro " + base)
            self.assertEqual(self.config[mode]["hotkeys"]["Shift+Enter"], "macro " + base + "_exit")
        self.assertIn("moveOnly", self.config["macros"]["confirm_move"])
        self.assertEqual(self.config["vim"]["hotkeys"]["Shift+Space"], "action feed --mode g h")
        self.assertEqual(self.config["vim"]["hotkeys"]["Shift+Enter"], ["action feed --mode g h", "idle"])
        self.assertEqual(self.config["vim"]["keymaps"]["visual"]["gh"], "<Plug>(move-mouse)")

    def test_hints_tab_switches_monitors(self):
        keys = self.config["hints"]["hotkeys"]
        self.assertEqual(keys["Tab"], ["action move_monitor --bail-on-error", "idle"])
        self.assertEqual(keys["Shift+Tab"], ["action move_monitor --previous --bail-on-error", "idle"])

    def test_cmd_f16_toggles_continuous_in_every_mode(self):
        for mode in ("hints", "recursive_grid", "grid", "scroll", "vim", "bisect", "monitor_select"):
            self.assertEqual(self.config[mode]["hotkeys"]["Cmd+F16"], "macro toggle_continuous")
        self.assertIn("toggleContinuous", self.config["macros"]["toggle_continuous"])
        source = Path("stow_modules/main/dot-hammerspoon/neruNavigation.lua").read_text()
        self.assertNotIn('bindOnce(continuousMods, "/"', source)
        self.assertNotIn("(Hyper+Shift+/)", source)
        self.assertNotIn("Ctrl+Option+Enter or try again", source)

    def test_vim_tab_switches_displays_and_refreshes_screen_text(self):
        keys = self.config["vim"]["hotkeys"]
        self.assertEqual(keys["Tab"], ["action move_monitor --bail-on-error", "vim --capture-scope screen"])
        self.assertEqual(keys["Shift+Tab"], ["action move_monitor --previous --bail-on-error", "vim --capture-scope screen"])

    def test_scroll_app_switch_chords_exit_scroll_mode(self):
        keys = self.config["scroll"]["hotkeys"]
        self.assertEqual(keys["Cmd+Tab"], ["action feed Cmd+Tab", "idle"])
        self.assertEqual(keys["Cmd+Shift+Tab"], ["action feed Cmd+Shift+Tab", "idle"])

    def test_scroll_hyper_page_aliases(self):
        keys = self.config["scroll"]["hotkeys"]
        self.assertEqual(keys["Cmd+Ctrl+Alt+d"], "action page_down")
        self.assertEqual(keys["Cmd+Ctrl+Alt+u"], "action page_up")

    def test_cmd_right_shift_sends_clean_cmd_f16(self):
        self.assertIn("[:!Cright_shift :!Cf16]", KARABINER.read_text())
        source = Path("stow_modules/main/dot-hammerspoon/neruNavigation.lua").read_text()
        self.assertIn('bindOnce({"cmd"}, "F16"', source)
        self.assertNotIn("recursiveChordDown", source)

    def test_atkinson_font_is_installed_via_brewfile_and_used_for_labels(self):
        font = "AtkinsonHyperlegibleMono-ExtraLight_Bold"
        self.assertIn('cask "font-atkinson-hyperlegible-mono"', Path("Brewfile").read_text())
        for mode in ("hints", "recursive_grid", "grid", "vim", "bisect", "monitor_select", "mode_indicator"):
            self.assertEqual(self.config[mode]["ui"]["font_family"], font)
        self.assertEqual(self.config["hints"]["search_input_ui"]["font_family"], font)

    def test_modified_labels_support_both_layouts(self):
        labels = set(string.ascii_lowercase + ";,./")
        for char in labels:
            for prefix in ("Shift+", "Ctrl+Shift+"):
                self.assertEqual(self.config["recursive_grid"]["hotkeys"][prefix + char.upper()],
                                 f"action feed --mode {char}")

    def test_ctrl_shift_drag_can_nudge_in_grid_and_scroll(self):
        for mode in ("recursive_grid", "scroll"):
            for key, (dx, dy) in {"Up": (0, -10), "Down": (0, 10), "Left": (-10, 0), "Right": (10, 0)}.items():
                self.assertEqual(self.config[mode]["hotkeys"]["Ctrl+Shift+" + key],
                                 f"action move_mouse_relative --dx={dx} --dy={dy}")

    def test_grid_palette_and_contrast(self):
        def argb(values):
            r, g, b, a = [math.floor(float(v) * 255 + .5) for v in values]
            return f"#{a:02X}{r:02X}{g:02X}{b:02X}"
        def color(key):
            match = re.search(rf"(?m)^  {key}:\n((?:  - [0-9.]+\n){{4}})", self.yaml)
            self.assertIsNotNone(match)
            return argb([line.strip().removeprefix("- ") for line in match[1].splitlines()])
        recursive = self.config["recursive_grid"]["ui"]
        self.assertTrue(recursive["highlight_color"].endswith("180C10"))
        self.assertTrue(recursive["line_color"].endswith("B87671"))  # separator alpha is fixed, not tuned
        self.assertEqual(recursive["text_color"], color("text_rgba"))
        self.assertEqual(recursive["line_color"], recursive["highlight_color"][:3] + color("highlight_rgba")[3:])
        self.assertEqual(recursive["line_width"], 2)
        self.assertEqual(self.config["grid"]["ui"]["border_width"], 0)
        self.assertTrue(self.config["grid"]["ui"]["border_color"].startswith("#00"))
        self.assertTrue(self.config["grid"]["ui"]["matched_border_color"].startswith("#00"))
        self.assertIs(recursive["label_background"], True)
        self.assertEqual(recursive["label_background_color"], "#D9000000")
        fixed = self.config["grid"]["ui"]
        self.assertEqual(fixed["background_color"], recursive["highlight_color"])
        self.assertEqual(fixed["matched_background_color"], recursive["highlight_color"])
        self.assertEqual(fixed["text_color"], recursive["text_color"])
        self.assertEqual(fixed["matched_text_color"], recursive["text_color"])

    def test_recursive_grid_hides_next_level_preview(self):
        ui = self.config["recursive_grid"]["ui"]
        self.assertIs(ui["sub_key_preview"], False)
        self.assertEqual(ui["sub_key_preview_font_size"], 10)
        self.assertEqual(ui["sub_key_preview_text_color"], "#FFFFFFFF")

    def test_every_mode_uses_mouseless_palette(self):
        self.assertEqual(self.config["theme"]["light"], self.config["theme"]["dark"])
        self.assertEqual(self.config["theme"]["dark"]["surface"], "#7A4949")
        self.assertEqual(self.config["theme"]["dark"]["text"], "#FEFEFE")
        for mode in ("hints", "monitor_select"):
            self.assertEqual(self.config[mode]["ui"]["background_color"], "#E67A4949")
        self.assertEqual(self.config["vim"]["ui"]["status_background_color"], "#E67A4949")
        self.assertEqual(self.config["mode_indicator"]["ui"]["background_color"], "#E67A4949")


if __name__ == "__main__":
    unittest.main()
