#!/bin/sh
# prefix+alt+l: force herdr to repaint the whole screen.
#
# tmux parity: `bind r refresh-client`. herdr has no redraw action and no API
# method for it -- the only things that force a full frame are an outer
# focus-gained event (when ui.redraw_on_focus_gained is on) and a client
# resize. So this takes the resize path: the client's resize poll loop treats a
# SIGWINCH as a report-worthy event even when the measured size has not changed
# (`resize_report_required` = `signalled || new_size != last_size`), which
# invalidates the host-side blit baseline and repaints every client.
#
# What it is for: the "rare host terminal surface corruption" that
# ui.redraw_on_focus_gained exists to clear -- garbage left by a program that
# wrote outside herdr's model, stale cells after a graphics protocol hiccup.
#
# Signals every attached client, not just one: a session can have several, and
# corruption is per-surface. The server is excluded by matching its `server`
# argument -- SIGWINCH to it is harmless, but there is no reason to send it.
#
# Limitation: over `herdr --remote` the keybinding runs on the SERVER while the
# client runs on your Mac, so there is nothing local to signal and this does
# nothing. Detach and reattach for that case.

found=0
for pid in $(pgrep -x herdr 2>/dev/null); do
  case "$(ps -p "$pid" -o command= 2>/dev/null)" in
    *" server"*) continue ;;
  esac
  kill -WINCH "$pid" 2>/dev/null && found=$((found + 1))
done

if [ "$found" -eq 0 ]; then
  herdr="${HERDR_BIN_PATH:-herdr}"
  "$herdr" notification show "no local client to refresh" \
    --body "remote session? detach and reattach" \
    --position top-right --sound none >/dev/null 2>&1
  exit 1
fi
exit 0
