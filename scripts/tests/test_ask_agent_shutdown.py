"""The prefix+a popup must not wait for its background queue's polling tick."""
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import unittest

SCRIPTS = Path(__file__).resolve().parents[2] / "stow_modules/main/dot-config/herdr/scripts"


class AskShutdownTests(unittest.TestCase):
    def test_cancel_returns_while_watcher_is_asleep_and_preserves_final_submission(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scripts = root / "scripts"
            scripts.mkdir()
            for name in ("ask-agent.sh", "prompt-lib.sh"):
                shutil.copy2(SCRIPTS / name, scripts / name)
            (scripts / "herdr-lib.sh").write_text(
                'herdr_bin() { printf "/bin/true\\n"; }\n'
                'herdr_die() { exit 1; }\n'
            )
            bin_dir = root / ".local/bin"
            bin_dir.mkdir(parents=True)
            ready, dispatched = root / "sleeping", root / "dispatched"
            queue_path = root / "queue-path"
            release_read, release_write = os.pipe()
            stubs = {
                "sleep": '''#!/usr/bin/env python3
import os
from pathlib import Path
Path(os.environ["TEST_READY"]).touch()
os.read(int(os.environ["TEST_RELEASE_FD"]), 1)
''',
                "prompt-python": '''#!/usr/bin/env python3
import os
from pathlib import Path
import sys
import time
ready = Path(os.environ["TEST_READY"])
deadline = time.monotonic() + 5
while not ready.exists():
    if time.monotonic() > deadline:
        raise SystemExit("watcher did not enter sleep")
    time.sleep(0.005)
queue = Path(sys.argv[sys.argv.index("--submit-dir") + 1])
Path(os.environ["TEST_QUEUE_PATH"]).write_text(str(queue))
# A Ctrl+Enter submission queued immediately before Esc must still dispatch.
(queue / "last.prompt").write_text("qq final queued question")
raise SystemExit(1)
''',
                "nohup": '''#!/usr/bin/env python3
import os
from pathlib import Path
import sys
assert sys.argv[2] == "--dispatch", sys.argv
claimed = Path(sys.argv[3])
Path(os.environ["TEST_DISPATCHED"]).write_text(claimed.read_text())
claimed.unlink()
''',
            }
            for name, body in stubs.items():
                file = bin_dir / name
                file.write_text(body)
                file.chmod(0o755)
            env = dict(os.environ, HOME=tmp, TMPDIR=tmp, ASK_AGENT_CONTEXT="0",
                       PROMPT_LIB_PYTHON=str(bin_dir / "prompt-python"),
                       TEST_READY=str(ready), TEST_DISPATCHED=str(dispatched),
                       TEST_QUEUE_PATH=str(queue_path), TEST_RELEASE_FD=str(release_read))
            # Don't inherit optional live invocation settings from another ask.
            for name in ("ASK_AGENT_RESULT_FILE", "ASK_AGENT_COMPLETION_WARNING"):
                env.pop(name, None)
            child = subprocess.Popen(["/bin/bash", str(scripts / "ask-agent.sh")],
                                     env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     pass_fds=(release_read,), text=True, start_new_session=True)
            try:
                # The watcher cannot finish until the test releases its sleep.
                # This is a deterministic check, not a sub-millisecond timing assertion.
                out, err = child.communicate(timeout=3)
                self.assertEqual(child.returncode, 0, out + err)
                self.assertTrue(ready.exists())
                self.assertFalse(dispatched.exists())
                queue = Path(queue_path.read_text())
                self.assertTrue((queue / ".done").exists())
                # Closing the popup can hang up the former foreground process group.
                os.killpg(child.pid, signal.SIGHUP)
                os.write(release_write, b"1")
                deadline = time.monotonic() + 5
                while not dispatched.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(dispatched.exists())
                self.assertEqual(dispatched.read_text(), "qq final queued question")
                while queue.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertFalse(queue.exists(), "watcher must clean up the queue")
            finally:
                # Unblock the fake sleep on failure too, so no watcher is left behind.
                os.write(release_write, b"1")
                if child.poll() is None:
                    child.kill()
                    child.communicate()
                os.close(release_read)
                os.close(release_write)


if __name__ == "__main__":
    unittest.main()
