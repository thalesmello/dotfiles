# Herdr script tests

Tests for the Herdr helper scripts in this folder. Run everything:

```
cd ~/.config/herdr/scripts
python3 -m unittest discover -s tests -t .
```

## Where the tests came from

- `test_*.py` (age, app, auto_title, client, fuzzy, host, icons, items,
  keys, mru, paint, renaming_guard, render, tab_status, textutil,
  title_watcher) and `fixtures.py`: copied from the herdr-bar project's
  Python test suite (v0.8 line), the same code `herdr_bar/` came from.
- `test_snooze_upstream.py`: copied from herdr-snooze's Python test suite
  (0.2 line), the same code `herdr-snooze.py` came from.
- `test_confirm_close.py`: translated from asumaran/asconfirmclose's Go
  tests (classify, config, close flow, prompt rendering).
- `test_herdr_recap.py`: translated from mrolafsson/herdr-recap's Go
  tests (ticket/title rules, stages, search, meta, recap parsing) plus
  tests for this port's Pi addition.

## Local adaptations

Copied tests were changed only where this repo's port deliberately
differs, and each change is marked "Local adaptation" in place:

- herdr-bar runs standalone (no plugin registry root), so the entry shim
  provides `HERDR_PLUGIN_CONFIG_DIR` / `HERDR_PLUGIN_STATE_DIR` and the
  package stays env-only.
- Tab names lead bar rows; the agent's human title takes over only for
  numbered or slug tab labels. A slug agent name counts as a default only
  when it equals the tab label.
- `tab_status` defaults off in code (upstream) and is turned on in the
  version-controlled `plugins/config/herdr-bar/config.json`.
- herdr-snooze tests for the `run.sh` launcher are skipped: this port has
  no launcher; Herdr hooks call `herdr-snooze.py` directly.
- Snooze assertions that predate the Just woke list were updated where an
  expired agent now lands on that list (and announces its wake).
- Two snooze duration assertions allow an extra hour in DST fall-back
  weeks (elapsed time vs wall clock).
