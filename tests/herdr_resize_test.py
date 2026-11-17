import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

PATH = Path(__file__).resolve().parents[1] / "stow_modules/main/dot-config/herdr-app/mods/prefix/resize.py"
spec = importlib.util.spec_from_file_location("resize", PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def block(name, weight=1):
    return {"id": name, "type": "block", "size": {"weight": weight}}


def split(axis, *children):
    return {"type": axis, "children": list(children)}


class Core:
    def __init__(self):
        self.doc = {"spaces": [{"tabs": [{"id": "tab", "root": split("row", block("a"), block("b"))}]}]}
        self.version = 1
        self.calls = []

    def call(self, method, params):
        self.calls.append((method, copy.deepcopy(params)))
        if method == "doc.get":
            return {"value": copy.deepcopy(self.doc), "version": self.version}
        if params["version"] != self.version:
            raise module.RpcError({"data": {"kind": "conflict"}, "message": "conflict"})
        self.doc = copy.deepcopy(params["value"])
        self.version += 1
        return {"version": self.version}


class ResizeTest(unittest.TestCase):
    def weights(self, root):
        return [c["size"]["weight"] for c in root["children"]]

    def test_directions_from_both_sides(self):
        for axis, positive, negative in [("row", "right", "left"), ("column", "down", "up")]:
            for pane in ("a", "b"):
                root = split(axis, block("a"), block("b"))
                self.assertTrue(module.resize(root, pane, positive))
                self.assertAlmostEqual(self.weights(root)[0], 0.58)
                self.assertTrue(module.resize(root, pane, negative))
                self.assertAlmostEqual(self.weights(root)[0], 0.5)

    def test_nearest_split_and_other_axis(self):
        inner = split("row", block("a"), block("b"))
        root = split("column", inner, block("c"))
        self.assertTrue(module.resize(root, "b", "right"))
        self.assertAlmostEqual(self.weights(inner)[0], 0.58)
        self.assertTrue(module.resize(root, "b", "down"))
        self.assertAlmostEqual(self.weights(root)[0], 0.58)
        before = copy.deepcopy(root)
        self.assertFalse(module.resize(root, "missing", "left"))
        self.assertEqual(root, before)

    def test_bounds_preserve_total_and_do_not_jump_to_outer_split(self):
        inner = split("row", block("a", 0.9), block("b", 0.1))
        root = split("row", inner, block("c"))
        self.assertFalse(module.resize(root, "a", "right"))
        self.assertNotIn("size", inner)
        root = split("row", block("a"), block("b"), block("c"))
        for _ in range(20):
            module.resize(root, "a", "right")
        self.assertAlmostEqual(sum(self.weights(root)), 1)
        self.assertAlmostEqual(self.weights(root)[1], 0.1)
        self.assertAlmostEqual(self.weights(root)[2], 1 / 3)

    def test_batch_one_read_one_write_and_remote_ids(self):
        for machine in (None, "dev"):
            prefix = "dev/" if machine else ""
            doc = {"spaces": [{"tabs": [{"id": "tab", "root": split("row", block("a"), block("b"))}]}]}
            calls = []

            def call(method, params):
                calls.append((method, params))
                return {"value": doc, "version": 42}

            module.apply({"machine": machine, "tab": prefix + "tab", "pane": prefix + "a",
                          "directions": ["right", "right", "left"]}, call)
            self.assertEqual([c[0] for c in calls], ["doc.get", "doc.set"])
            self.assertEqual(calls[1][1]["version"], 42)
            self.assertEqual(calls[0][1].get("on"), machine)
            saved = calls[1][1]["value"]
            self.assertAlmostEqual(self.weights(saved["spaces"][0]["tabs"][0]["root"])[0], 0.58)

    def test_removed_target_never_writes(self):
        calls = []

        def call(method, params):
            calls.append(method)
            return {"value": {"spaces": []}, "version": 1}

        module.apply({"tab": "gone", "pane": "a", "directions": ["right"]}, call)
        self.assertEqual(calls, ["doc.get"])

    def test_rejected_write_is_not_retried(self):
        calls = []

        def call(method, params):
            calls.append(method)
            if method == "doc.set":
                raise RuntimeError("conflict")
            return {"value": {"spaces": [{"tabs": [{"id": "tab", "root": split("row", block("a"), block("b"))}]}]}, "version": 1}

        with self.assertRaises(RuntimeError):
            module.apply({"tab": "tab", "pane": "a", "directions": ["right"]}, call)
        self.assertEqual(calls, ["doc.get", "doc.set"])

    def test_warm_session_reads_once_for_multiple_keys(self):
        core = Core()
        session = module.ResizeSession({"tab": "tab", "pane": "a"}, core.call)
        session.apply(["right"])
        session.apply(["right"])
        self.assertEqual([m for m, _ in core.calls], ["doc.get", "doc.set", "doc.set"])
        self.assertEqual([p["version"] for m, p in core.calls if m == "doc.set"], [1, 2])
        self.assertAlmostEqual(self.weights(core.doc["spaces"][0]["tabs"][0]["root"])[0], 0.66)

    def test_stale_snapshot_rebases_only_on_confirmed_conflict(self):
        core = Core()
        session = module.ResizeSession({"tab": "tab", "pane": "a"}, core.call)
        core.doc["unrelated"] = "keep this"
        core.version += 1
        session.apply(["right"])
        self.assertEqual([m for m, _ in core.calls], ["doc.get", "doc.set", "doc.get", "doc.set"])
        self.assertEqual(core.doc["unrelated"], "keep this")
        self.assertAlmostEqual(self.weights(core.doc["spaces"][0]["tabs"][0]["root"])[0], 0.58)

    def test_stale_clamp_refreshes_before_skipping_key(self):
        core = Core()
        root = core.doc["spaces"][0]["tabs"][0]["root"]
        root["children"] = [block("a", 0.9), block("b", 0.1)]
        session = module.ResizeSession({"tab": "tab", "pane": "a"}, core.call)
        root["children"] = [block("a"), block("b")]
        core.version += 1
        self.assertTrue(session.apply(["right"]))
        self.assertAlmostEqual(self.weights(core.doc["spaces"][0]["tabs"][0]["root"])[0], 0.58)

    def test_uncertain_write_is_not_replayed(self):
        core = Core()

        def call(method, params):
            if method == "doc.set":
                core.calls.append((method, params))
                raise TimeoutError("unknown outcome")
            return core.call(method, params)

        session = module.ResizeSession({"tab": "tab", "pane": "a"}, call)
        with self.assertRaises(TimeoutError):
            session.apply(["right"])
        self.assertIsNone(session.snapshot)
        self.assertEqual([m for m, _ in core.calls], ["doc.get", "doc.set"])

    def test_loopback_worker_auth_batching_and_cleanup(self):
        core = Core()
        ready = threading.Event()
        real_replace = os.replace

        def publish(src, dst):
            real_replace(src, dst)
            ready.set()

        with tempfile.TemporaryDirectory() as directory, patch.object(module, "rpc", core.call), patch.object(module.os, "replace", publish):
            path = Path(directory) / "ready.json"
            worker = threading.Thread(target=module.serve, args=({"tab": "tab", "pane": "a"}, str(path)), daemon=True)
            worker.start()
            self.assertTrue(ready.wait(3), "worker never became ready")
            endpoint = json.loads(path.read_text())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            base = f"http://127.0.0.1:{endpoint['port']}"

            def post(route, directions=None):
                data = json.dumps({"directions": directions or []}).encode()
                with urlopen(Request(base + route, data=data, method="POST"), timeout=3) as response:
                    return json.load(response)

            try:
                with self.assertRaises(HTTPError) as error:
                    post("/wrong/resize", ["right"])
                self.assertEqual(error.exception.code, 403)
                error.exception.close()
                self.assertEqual(len(core.calls), 1)
                timings = []
                for _ in range(5):
                    start = time.perf_counter()
                    self.assertTrue(post(f"/{endpoint['token']}/resize", ["right", "left"])["ok"])
                    timings.append((time.perf_counter() - start) * 1000)
                self.assertEqual([m for m, _ in core.calls].count("doc.get"), 1)
                print(f"Local warm worker HTTP round trip (fake core): {sum(timings) / len(timings):.2f} ms")
            finally:
                post(f"/{endpoint['token']}/close")
                worker.join(3)
            self.assertFalse(worker.is_alive())
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
