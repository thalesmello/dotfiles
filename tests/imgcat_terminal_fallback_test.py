"""Verify imgcat/icat terminal dispatch without emitting terminal graphics."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


IMGCAT = Path(__file__).resolve().parents[1] / "bin" / "imgcat"


class ImgcatTerminalFallbackTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="imgcat test ")
        self.addCleanup(self.temp.cleanup)
        self.bin_dir = Path(self.temp.name)
        shutil.copy2(IMGCAT, self.bin_dir / "imgcat")
        icat = self.bin_dir / "icat"
        icat.write_text(
            '#!/usr/bin/env bash\n'
            'printf "icat\\n"\n'
            'printf "<%s>\\n" "$@"\n'
            'cat\n'
            'exit "${ICAT_TEST_EXIT:-0}"\n'
        )
        icat.chmod(0o755)
        self.env = os.environ.copy()
        for key in ("TERM_PROGRAM", "TERM", "KITTY_WINDOW_ID", "ICAT_TEST_EXIT"):
            self.env.pop(key, None)

    def run_imgcat(self, env, *args, stdin=""):
        return subprocess.run(
            [str(self.bin_dir / "imgcat"), *args],
            env={**self.env, **env},
            input=stdin,
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )

    def test_ghostty_and_kitty_dispatch(self):
        for env in (
            {"TERM_PROGRAM": "ghostty", "TERM": "xterm-256color"},
            {"TERM": "xterm-ghostty"},
            {"TERM_PROGRAM": "kitty"},
            {"TERM": "xterm-kitty"},
            {"KITTY_WINDOW_ID": "1", "TERM": "xterm-256color"},
        ):
            with self.subTest(env=env):
                result = self.run_imgcat(
                    env, "--width", "40", "image with spaces.png", "-", stdin="image data"
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(
                    result.stdout,
                    "icat\n<--width>\n<40>\n<image with spaces.png>\n<->\nimage data",
                )

    def test_icat_exit_status_is_preserved(self):
        result = self.run_imgcat({"TERM_PROGRAM": "ghostty", "ICAT_TEST_EXIT": "7"})
        self.assertEqual(result.returncode, 7)

    def test_iterm_and_unknown_terminals_keep_original_renderer(self):
        for env in (
            {"TERM_PROGRAM": "iTerm.app", "TERM": "xterm-256color"},
            {"TERM": "xterm-256color"},
            {},
            {"KITTY_WINDOW_ID": ""},
        ):
            with self.subTest(env=env):
                result = self.run_imgcat(env, "--help")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn("icat\n", result.stdout)
                self.assertIn("--legacy", result.stderr)

    def test_icat_delegates_to_imgcat_on_iterm(self):
        shutil.copy2(IMGCAT.with_name("icat"), self.bin_dir / "icat")
        (self.bin_dir / "imgcat").write_text(
            '#!/usr/bin/env bash\n'
            'printf "imgcat\\n"\n'
            'printf "<%s>\\n" "$@"\n'
            'cat\n'
            'exit 7\n'
        )
        result = subprocess.run(
            [str(self.bin_dir / "icat"), "--width", "40", "image with spaces.png", "-"],
            env={**self.env, "TERM_PROGRAM": "iTerm.app"},
            input="image data",
            capture_output=True,
            text=True,
            timeout=5,
        )
        self.assertEqual(result.returncode, 7)
        self.assertEqual(
            result.stdout,
            "imgcat\n<--width>\n<40>\n<image with spaces.png>\n<->\nimage data",
        )

    def test_iterm_dispatch_does_not_loop_with_inherited_kitty_variables(self):
        shutil.copy2(IMGCAT.with_name("icat"), self.bin_dir / "icat")
        for term in ("xterm-256color", "xterm-kitty", "xterm-ghostty"):
            for command in ("imgcat", "icat"):
                with self.subTest(term=term, command=command):
                    result = subprocess.run(
                        [str(self.bin_dir / command), "--help"],
                        env={
                            **self.env,
                            "TERM_PROGRAM": "iTerm.app",
                            "TERM": term,
                            "KITTY_WINDOW_ID": "1",
                        },
                        input="",
                        capture_output=True,
                        text=True,
                        timeout=5,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn("--legacy", result.stderr)


if __name__ == "__main__":
    unittest.main()
