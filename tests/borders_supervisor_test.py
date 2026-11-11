"""Test executable selection without launching or stopping desktop processes."""

from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

SUPERVISOR = (
    Path(__file__).resolve().parents[1]
    / "stow_modules/main/dot-config/yabai/borders-supervisor.py"
)
HOME = Path("/home/test")
ARM_BREW = Path("/opt/homebrew/opt/borders-mission-control/bin/borders")
INTEL_BREW = Path("/usr/local/opt/borders-mission-control/bin/borders")
MANUAL = HOME / ".local/libexec/jankyborders/borders"


class BordersSupervisorTest(unittest.TestCase):
    def argv_for(self, executables):
        with (
            patch.object(Path, "home", return_value=HOME),
            patch("os.access", side_effect=lambda path, mode: path in executables),
        ):
            return runpy.run_path(str(SUPERVISOR))["BORDERS_ARGV"]

    def test_homebrew_precedes_manual_build(self):
        argv = self.argv_for({ARM_BREW, MANUAL})
        self.assertEqual(argv[0], str(ARM_BREW))
        self.assertIn("mission_control=on", argv)
        self.assertIn("mission_control_fade=80", argv)

    def test_intel_homebrew(self):
        self.assertEqual(self.argv_for({INTEL_BREW, MANUAL})[0], str(INTEL_BREW))

    def test_manual_fallback(self):
        argv = self.argv_for({MANUAL})
        self.assertEqual(argv[0], str(MANUAL))
        self.assertIn("mission_control=on", argv)

    def test_upstream_fallback_does_not_receive_fork_options(self):
        argv = self.argv_for(set())
        self.assertEqual(argv[0], "/opt/homebrew/bin/borders")
        self.assertFalse(any(arg.startswith("mission_control") for arg in argv))


if __name__ == "__main__":
    unittest.main()
