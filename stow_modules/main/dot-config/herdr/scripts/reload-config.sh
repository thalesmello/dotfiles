#!/bin/sh
set -eu

herdr_bin="${HERDR_BIN_PATH:-}"
if [ -z "$herdr_bin" ] || [ ! -x "$herdr_bin" ]; then
  herdr_bin=$(command -v herdr 2>/dev/null || true)
fi
if [ -z "$herdr_bin" ]; then
  for candidate in "$HOME/.local/bin/herdr" /opt/homebrew/bin/herdr /usr/local/bin/herdr; do
    if [ -x "$candidate" ]; then
      herdr_bin=$candidate
      break
    fi
  done
fi
[ -n "$herdr_bin" ] || {
  printf 'herdr CLI not found\n' >&2
  exit 1
}

# Pick up edited local plugin manifests first; Herdr's plugin registry stores a
# copy of each manifest, not a live pointer to it.
if command -v herdr-preset >/dev/null 2>&1; then
  herdr-preset install-local-plugins --quiet >/dev/null 2>&1 || true
fi

# The unread marker has a long-running animation daemon. Herdr has no
# config-reload plugin hook, so restart it explicitly from the reload key so code
# and glyph changes are visible immediately.
python3 "$HOME/.config/herdr/scripts/unread-marker.py" restart >/dev/null 2>&1 || true

if output=$("$herdr_bin" server reload-config 2>&1); then
  "$herdr_bin" notification show "Herdr config reloaded" \
    --body "local plugins relinked; unread marker restarted" \
    --position top-right --sound none >/dev/null 2>&1 || true
  printf '%s\n' "$output"
  exit 0
else
  status=$?
  body=$(printf '%s' "$output" | tr '\n' ' ' | cut -c 1-240)
  "$herdr_bin" notification show "Herdr config reload failed" \
    --body "$body" --position top-right --sound none >/dev/null 2>&1 || true
  printf '%s\n' "$output" >&2
  exit "$status"
fi
