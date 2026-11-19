"""Build checks in temporary directories; never touch live annotations/native taps."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = Path("/Applications/Hammerspoon.app")


class HammerspoonBuildTest(unittest.TestCase):
    @unittest.skipUnless((APP / "Contents/Resources/docs.json").exists() and shutil.which("nvim"),
                         "requires installed Hammerspoon docs and Neovim")
    def test_offline_lsp_generation_and_cache(self):
        with tempfile.TemporaryDirectory(prefix="hs-lsp-test-") as directory:
            spoon = Path(directory) / "Spoons/EmmyLua.spoon"
            spoon.mkdir(parents=True)
            shutil.copy(ROOT / "stow_modules/main/dot-hammerspoon/Spoons/EmmyLua.spoon/init.lua",
                        spoon / "init.lua")
            env = dict(os.environ, HAMMERSPOON_LSP_CONFIGDIR=directory)
            command = [shutil.which("nvim"), "--headless", "-u", "NONE", "-l",
                       str(ROOT / "scripts/hammerspoon-lsp-annotations.lua")]
            subprocess.run(command, env=env, check=True, capture_output=True, timeout=30)
            files = list((spoon / "annotations").glob("*.lua"))
            self.assertGreater(len(files), 100)
            self.assertTrue((spoon / "annotations/hs.window.lua").exists())
            mtimes = {p.name: p.stat().st_mtime_ns for p in files}
            subprocess.run(command, env=env, check=True, capture_output=True, timeout=30)
            self.assertEqual(mtimes, {p.name: p.stat().st_mtime_ns for p in files})

    @unittest.skipUnless(sys.platform == "darwin" and APP.exists(), "requires macOS and Hammerspoon")
    def test_native_build_and_export(self):
        headers = APP / "Contents/Frameworks/LuaSkin.framework/Versions/A/Headers"
        with tempfile.TemporaryDirectory(prefix="hs-native-test-") as directory:
            library = Path(directory) / "hs_hidtap.so"
            subprocess.run(["/usr/bin/clang", "-O2", "-bundle", "-undefined", "dynamic_lookup",
                            f"-I{headers}", "-framework", "ApplicationServices",
                            "-framework", "CoreFoundation",
                            str(ROOT / "homebrew/casks/thalesmello/homebrew-hammerspoon/hs_hidtap.c"),
                            "-o", str(library)], check=True, capture_output=True, timeout=30)
            symbols = subprocess.check_output(["/usr/bin/nm", "-g", str(library)], text=True)
            self.assertIn("_luaopen_hs_hidtap", symbols)


if __name__ == "__main__":
    unittest.main()
