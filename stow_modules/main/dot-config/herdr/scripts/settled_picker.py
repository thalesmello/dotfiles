"""Settled-only, connected-machine picker. Archives and actions stay on their Core."""
import os
import sys
import threading
import time

from settled_machines import ConnectedArchives
import settled_hc as hc

ALL = object()  # cannot collide with a configured machine literally named 'all'


def display_text(value):
    # Transcript text is data, never terminal control sequences (OSC/clipboard).
    return "".join(ch if ord(ch) >= 32 and not 127 <= ord(ch) < 160 and not 0xD800 <= ord(ch) <= 0xDFFF else " " for ch in str(value or ""))


class Task:
    """A bounded transport runs off the input/render thread; close never joins it."""
    def __init__(self, operation):
        self.done = threading.Event()
        self.value = None
        self.error = None
        def work():
            try:
                self.value = operation()
            except Exception as exc:
                self.error = exc
            finally:
                self.done.set()
        threading.Thread(target=work, daemon=True).start()


def picker_class(legacy):
    class MachinePicker(legacy.Picker):
        key_timeout = 0.2
        WORKSPACE_COL = 16
        CHEATSHEET = [("enter", "resume on its machine"), ("⌫", "forget settled"),
                      ("space", "mark (bulk)"), ("tab", "next machine"),
                      ("⇧tab", "previous machine"), ("/", "search"),
                      ("u", "resume latest"), ("?", "toggle help"), ("q", "close")]

        def __init__(self, provider=None, clock=time.monotonic):
            self.provider = provider or ConnectedArchives(legacy, hc_command=hc.adapter().hc_bin() or "hc")
            self.clock = clock
            self.machine_filter = ALL
            self.connected_names = set()
            self.connected_owners = {}
            self.machine_labels = {None: "Local"}
            self.connections_ready = False
            self.all_rows = []
            self.tasks = {}
            self.next_connections = 0
            self.next_snapshot = 0
            self.next_size = 0
            self.terminal_id = os.environ.get("HC_TERMINAL_ID")
            self.terminal_dimensions = None
            self.inventory_generation = 0
            self.preview_results = {}
            self.preview_target = None
            self.loading = True
            self.busy_action = None
            self.completed_restore = False
            self.closed = False
            super().__init__()
            # Metadata search is cheap; keep selection stable across inventory
            # updates instead of the legacy filter worker resetting it each time.
            self.worker.close()
            self.worker = None

        def close(self):
            self.closed = True
            self.tasks.clear()
            super().close()

        def machine_choices(self):
            return [ALL] + ([None] if None in self.connected_names else []) + sorted(
                name for name in self.connected_names if name is not None)

        def machine_label(self):
            return display_text("All connected" if self.machine_filter == ALL else self.machine_labels.get(self.machine_filter, str(self.machine_filter)))

        def row_connected(self, row):
            if row["machine"] not in self.connected_names:
                return False
            core, namespace = self.connected_owners.get(row["machine"], (None, None))
            return (not core or core == row.get("core_id")) and (not namespace or namespace == row.get("namespace"))

        def reload(self):
            self.next_snapshot = 0
            self.refresh_background()

        def refresh_background(self):
            if self.closed:
                return
            now = self.clock()
            for kind, task in list(self.tasks.items()):
                if not task.done.is_set():
                    continue
                del self.tasks[kind]
                if kind == "connections":
                    # Failure is not permission to continue displaying cached
                    # remote archives whose connectivity can no longer be proved.
                    machines = [] if task.error else task.value
                    owners = {m["name"]: (m.get("core_id"), m.get("namespace")) for m in machines}
                    if self.connections_ready and owners != self.connected_owners:
                        self.inventory_generation += 1
                        self.next_snapshot = 0
                    self.connected_owners = owners
                    self.connected_names = set(owners)
                    self.machine_labels = {m["name"]: m.get("label") or m["name"] or "Local" for m in machines}
                    self.connections_ready = True
                    if self.machine_filter not in self.machine_choices():
                        self.machine_filter = ALL
                    self.all_rows = [r for r in self.all_rows if self.row_connected(r)]
                    self.preview_results = {key: value for key, value in self.preview_results.items()
                                            if any(r["key"] == key for r in self.all_rows)}
                    self.apply_view()
                elif kind == "snapshot":
                    if getattr(task, "generation", 0) != self.inventory_generation:
                        self.next_snapshot = 0
                        continue  # a pre-mutation export must not re-add forgotten rows
                    self.loading = False
                    if task.error:
                        self.all_rows = []
                        self.flash = "Archive refresh failed: %s" % task.error
                    else:
                        snapshot = task.value
                        if not self.connections_ready:
                            self.connected_names = {m["name"] for m in snapshot["machines"]}
                            self.connected_owners = {m["name"]: (m.get("core_id"), m.get("namespace")) for m in snapshot["machines"]}
                            self.machine_labels = {m["name"]: m.get("label") or m["name"] or "Local" for m in snapshot["machines"]}
                        self.all_rows = []
                        for original in snapshot["rows"]:
                            if original.get("kind") != "settled" or not self.row_connected(original):
                                continue  # discard live rows and late disconnected-machine results
                            row = dict(original)
                            row["project_label"] = row.get("workspace_label") or ""
                            row["workspace_label"] = row.get("machine_label") or self.machine_labels.get(row["machine"], "Local")
                            for field in ("title", "agent_name", "workspace_label", "project_label", "cwd"):
                                row[field] = display_text(row.get(field))
                            row["age"] = legacy._age(row.get("settled_at"))
                            row["_search"] = " ".join(str(row.get(k) or "") for k in
                                ("title", "agent_name", "workspace_label", "project_label", "cwd")).lower()
                            self.all_rows.append(row)
                        self.all_rows.sort(key=lambda r: r.get("settled_at") or 0, reverse=True)
                    self.apply_view()
                elif kind == "preview":
                    key, result = task.value if not task.error else (getattr(task, "target", None), None)
                    if key == self.preview_target and any(r["key"] == key and self.row_connected(r) for r in self.all_rows):
                        self.preview_results[key] = result if result is not None else {
                            "messages": [["—", "Preview unavailable: %s" % task.error]], "retry_after": now + 2}
                elif kind == "size":
                    if not task.error and task.value:
                        self.terminal_dimensions = task.value
                elif kind == "action":
                    verb = self.busy_action
                    self.busy_action = None
                    self.inventory_generation += 1
                    self.next_snapshot = 0
                    if task.error:
                        self.flash = "%s failed: %s. Check the session before retrying." % (verb.title(), task.error)
                    elif verb == "reopen":
                        self.flash = task.value
                        self.completed_restore = self.flash.startswith(("reopened in ", "already open in "))
                    else:
                        outcomes, forgotten = task.value
                        self.flash = "; ".join(outcomes)
                        self.all_rows = [r for r in self.all_rows if r["key"] not in forgotten]
                        self.marked.clear()
                    self.apply_view()
            if self.completed_restore:
                return  # successful restore is about to close; do not start more reads
            if "connections" not in self.tasks and now >= self.next_connections:
                self.tasks["connections"] = Task(self.provider.connected)
                self.next_connections = now + 1
            size = getattr(self.provider, "terminal_size", None)
            if self.terminal_id and callable(size) and "size" not in self.tasks and now >= self.next_size:
                self.tasks["size"] = Task(lambda: size(self.terminal_id))
                self.next_size = now + 0.5
            if "snapshot" not in self.tasks and now >= self.next_snapshot:
                task = Task(self.provider.snapshot)
                task.generation = self.inventory_generation
                self.tasks["snapshot"] = task
                self.next_snapshot = now + 3

        def apply_view(self):
            old_key = self.rows[self.selected]["key"] if self.rows and self.selected < len(self.rows) else None
            query = self.query.lower()
            rows = [r for r in self.all_rows if self.row_connected(r) and
                    (self.machine_filter == ALL or r["machine"] == self.machine_filter) and
                    (not query or query in r.get("_search", ""))]
            self.rows = rows
            self.display_sections = [("Settled", rows)] if rows else []
            self.sections = self.display_sections
            self.selected = next((i for i, r in enumerate(rows) if r["key"] == old_key), min(self.selected, max(0, len(rows) - 1)))
            allowed = {r["key"] for r in self.all_rows}
            self.marked.intersection_update(allowed)

        def request_filter(self, reason):
            self.apply_view()

        def set_filter(self, _name):
            self.flash = "Settled sessions only · Tab switches machines"

        def cycle_filter(self, step):
            choices = self.machine_choices()
            index = choices.index(self.machine_filter) if self.machine_filter in choices else 0
            self.machine_filter = choices[(index + step) % len(choices)]
            self.selected = 0
            self.flash = ""
            self.apply_view()

        def draw(self, term):
            if self.terminal_dimensions:
                cols, rows = self.terminal_dimensions
                if (term.cols, term.rows) != (cols, rows):
                    term.cols, term.rows = cols, rows
                    term.last_frame = None
            else:
                refresh = getattr(term, "refresh_size", None)
                if refresh:
                    refresh()
            super().draw(term)

        def header_lines(self, term):
            suffix = " · loading archives" if self.loading else ""
            sidebar = self.SIDEBAR_W if self.show_help and term.cols >= 60 else 0
            text = "Machines: " + self.machine_label() + " · Tab / Shift+Tab to switch" + suffix
            return ["  " + legacy.BOLD + legacy.clip(text, max(10, term.cols - sidebar - 4)) + legacy.RESET]

        def sidebar_lines(self, height):
            lines = [legacy.BOLD + "Shortcuts" + legacy.RESET, legacy.DIM + "─" * 20 + legacy.RESET]
            lines += [legacy.BOLD + "%-6s" % key + legacy.RESET + legacy.DIM + action + legacy.RESET for key, action in self.CHEATSHEET]
            lines += ["", legacy.BOLD + self.machine_label() + legacy.RESET, "%d settled sessions" % len(self.rows)]
            return (lines + [""] * height)[:height]

        def preview(self, row):
            if not row or not self.row_connected(row):
                return []
            key = row["key"]
            self.preview_target = key
            result = self.preview_results.get(key)
            if result is not None and result.get("retry_after", float("inf")) <= self.clock():
                self.preview_results.pop(key, None)
                result = None
            if result is not None:
                messages = result.get("messages") or [["—", "transcript unavailable" if result.get("gone") else "no messages in the transcript tail"]]
                return [[display_text(role), display_text(text)] for role, text in messages]
            if "preview" not in self.tasks:
                task = Task(lambda: (key, self.provider.preview(row)))
                task.target = key
                self.tasks["preview"] = task
            return [["—", "loading transcript from " + (row.get("machine_label") or "Local") + "…"]]

        def status_line(self, term, row):
            if self.busy_action and not self.searching:
                text = self.busy_action.title() + " in progress · q closes this window, not an issued request"
                return "  " + legacy.DIM + legacy.clip(text, max(10, term.cols - 4)) + legacy.RESET
            if self.flash or self.searching:
                previous = self.flash
                self.flash = display_text(self.flash)
                try:
                    return super().status_line(term, row)
                finally:
                    self.flash = previous
            text = "  " + self.machine_label()
            if row:
                text += " · " + " · ".join(v for v in (row.get("project_label"), row.get("cwd")) if v)
            hint = "? for help"
            return legacy.pad_visible(legacy.clip(text, max(0, term.cols - len(hint) - 3)), max(0, term.cols - len(hint) - 2)) + " " + legacy.DIM + hint + legacy.RESET

        def act(self, action, row):
            if action == "undo":
                row = self.all_rows[0] if self.all_rows else None
                action = "enter"
            if row is None:
                return False
            if action not in ("enter", "forget"):
                self.flash = "Settled sessions only · Enter resumes · Backspace forgets"
                return False
            if "action" in self.tasks:
                self.flash = "An archive action is already in progress"
                return False
            self.inventory_generation += 1
            self.busy_action = "reopen" if action == "enter" else "forget"
            self.flash = ""
            if action == "enter":
                selected = dict(row)
                self.tasks["action"] = Task(lambda: self.provider.action(selected, "reopen"))
            else:
                targets = [dict(r) for r in self.all_rows if r["key"] in self.marked] or [dict(row)]
                def forget():
                    outcomes, forgotten = [], set()
                    for target in targets:
                        try:
                            outcome = self.provider.action(target, "forget")
                            outcomes.append(outcome)
                            if outcome.startswith("forgot "):
                                forgotten.add(target["key"])
                        except Exception as exc:
                            outcomes.append("Forget failed: %s" % exc)
                    return outcomes, forgotten
                self.tasks["action"] = Task(forget)
            # Input, connection updates and resize remain live. Completion closes
            # a successful restore; q only closes the view, never retries/cancels
            # a mutation whose remote outcome may already be committed.
            return False

    return MachinePicker


def run(legacy):
    class CachedTerminal(legacy.RawTerminal):
        def __enter__(self):
            super().__enter__()
            sys.stdout.write("\x1b[?1049h\x1b[H")
            sys.stdout.flush()
            return self

        def __exit__(self, *exc):
            try:
                return super().__exit__(*exc)
            finally:
                sys.stdout.write("\x1b[?1049l")
                sys.stdout.flush()

        def refresh_size(self):
            try:
                size = os.get_terminal_size(self.fd)
            except OSError:
                return
            if (self.cols, self.rows) != (size.columns, size.lines):
                self.cols, self.rows = size.columns, size.lines
                self.last_frame = None

        def draw(self, lines):
            if lines != getattr(self, "last_frame", None):
                super().draw(lines)
                self.last_frame = list(lines)
    legacy.name_self()
    picker = picker_class(legacy)()
    with CachedTerminal() as term:
        try:
            return legacy._picker_loop(picker, term)
        finally:
            picker.close()
