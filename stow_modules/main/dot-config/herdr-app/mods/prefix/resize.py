"""Local-only, session-scoped resize worker. No interpreter launch per key."""

import copy
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
import secrets
import signal
import socket
from socketserver import TCPServer
import sys
import time


class RpcError(RuntimeError):
    def __init__(self, error):
        super().__init__(json.dumps(error))
        self.kind = (error.get("data") or {}).get("kind")


def rpc(method, params):
    session = os.environ.get("HC_SESSION", "default")
    state = os.environ.get("XDG_STATE_HOME", os.path.expanduser("~/.local/state"))
    path = (os.environ.get("HC_SOCKET") or os.environ.get("HC_TERMINAL_SOCKET")
            or os.path.join(state, "herdr-core", session, session + ".sock"))
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(5)
        sock.connect(path)
        sock.sendall((json.dumps({"jsonrpc": "2.0", "id": 1,
                                 "method": method, "params": params}) + "\n").encode())
        with sock.makefile("rb") as stream:
            reply = json.loads(stream.readline())
    if "error" in reply:
        raise RpcError(reply["error"])
    return reply["result"]


def resize(root, pane, direction):
    """Move the nearest matching divider; preserve pair weight and 10% minimum."""
    axis = "row" if direction in ("left", "right") else "column"
    delta = -0.08 if direction in ("left", "up") else 0.08

    def contains(node):
        return node.get("id") == pane or any(contains(c) for c in node.get("children", []))

    def adjust(node):
        children = node.get("children", [])
        idx = next((i for i, c in enumerate(children) if contains(c)), None)
        if idx is None:
            return None
        nested = adjust(children[idx])
        if nested is not None:
            return nested
        if node.get("type") != axis or len(children) < 2:
            return None
        weights = [float(c.get("size", {}).get("weight") or 1) for c in children]
        total = sum(weights)
        weights = [w / total for w in weights]
        left = min(idx, len(children) - 2)
        right = left + 1
        pair = weights[left] + weights[right]
        minimum = min(0.1, pair / 2)
        new_left = max(minimum, min(pair - minimum, weights[left] + delta))
        if abs(new_left - weights[left]) < 1e-9:
            return False
        weights[left], weights[right] = new_left, pair - new_left
        for child, weight in zip(children, weights):
            child["size"] = {"weight": weight}
        return True

    if not contains(root):
        return False
    return bool(adjust(root))


class ResizeSession:
    def __init__(self, request, call=rpc):
        self.call = call
        machine = request.get("machine")

        def local_id(value):
            prefix = machine + "/" if machine else ""
            return value[len(prefix):] if prefix and value.startswith(prefix) else value

        self.params = {"name": "herdr-app"}
        if machine:
            self.params["on"] = machine
        self.tab_id, self.pane_id = local_id(request["tab"]), local_id(request["pane"])
        # Warm once when entering resize mode, not on each key.
        self.snapshot = self.call("doc.get", self.params)

    def apply(self, directions):
        if not isinstance(directions, list) or len(directions) > 256 or any(
                d not in ("left", "right", "up", "down") for d in directions):
            raise ValueError("Invalid resize directions")
        for attempt in range(3):
            if self.snapshot is None:
                self.snapshot = self.call("doc.get", self.params)
            doc = copy.deepcopy(self.snapshot["value"])
            tab = next((t for s in (doc or {}).get("spaces", []) for t in s.get("tabs", [])
                        if t.get("id") == self.tab_id), None)
            if not tab or not self.pane_id:
                return False
            changed = False
            for direction in directions:
                changed = resize(tab["root"], self.pane_id, direction) or changed
            if not changed:
                # A cached clamp/no-op may have been moved by mouse drag or another screen.
                fresh = self.call("doc.get", self.params)
                if fresh["version"] != self.snapshot["version"] and attempt < 2:
                    self.snapshot = fresh
                    continue
                self.snapshot = fresh
                return False
            try:
                result = self.call("doc.set", {**self.params, "version": self.snapshot["version"], "value": doc})
            except RpcError as error:
                self.snapshot = None
                # Only a confirmed CAS rejection is safe to retry. Never replay a timed-out write.
                if error.kind == "conflict" and attempt < 2:
                    continue
                raise
            except Exception:
                self.snapshot = None
                raise
            self.snapshot = {"value": doc, "version": result["version"]}
            return True


def apply(request, call=rpc):
    return ResizeSession(request, call).apply(request["directions"])


def serve(request, descriptor_path):
    session = ResizeSession(request, rpc)
    token = secrets.token_hex(32)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            # Loopback only, unpredictable per-session capability, no CORS permission.
            if self.path not in (f"/{token}/resize", f"/{token}/close"):
                self.send_error(403)
                return
            self.server.last_used = time.monotonic()
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 <= length <= 16384:
                    raise ValueError("Request too large")
                body = self.rfile.read(length)
                if self.path.endswith("/close"):
                    self.server.stopping = True
                    result = {"ok": True}
                else:
                    result = {"ok": True, "changed": session.apply(json.loads(body)["directions"])}
                status = 200
            except Exception as error:
                status, result = 500, {"ok": False, "error": str(error)}
            encoded = json.dumps(result).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    class Server(HTTPServer):
        def server_bind(self):
            # HTTPServer's default reverse-DNS lookup can itself stall on macOS.
            TCPServer.server_bind(self)
            self.server_name = "127.0.0.1"
            self.server_port = self.server_address[1]

        def get_request(self):
            connection, address = super().get_request()
            connection.settimeout(5)
            return connection, address

    with Server(("127.0.0.1", 0), Handler) as server:
        server.timeout = 1
        server.stopping = False
        server.last_used = time.monotonic()
        started = server.last_used
        try:
            # Private, unique discovery file. Publish atomically after warm-up and bind.
            temp = descriptor_path + ".tmp"
            with open(os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
                json.dump({"port": server.server_port, "token": token}, stream)
            os.replace(temp, descriptor_path)
            print("resize worker ready", flush=True)
            while (not server.stopping and time.monotonic() - server.last_used < 60
                   and time.monotonic() - started < 3600):
                server.handle_request()
        finally:
            for path in (descriptor_path, descriptor_path + ".tmp"):
                try:
                    os.unlink(path)
                except FileNotFoundError:
                    pass


if __name__ == "__main__":
    def terminate(_signal, _frame):
        raise SystemExit(0)

    for sig in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, terminate)
    try:
        if sys.argv[1] == "--serve":
            serve(json.loads(sys.argv[2]), sys.argv[3])
        else:
            apply(json.loads(sys.argv[1]))
    except Exception as error:
        print(error, file=sys.stderr)
        sys.exit(1)
