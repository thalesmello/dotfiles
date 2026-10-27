#!/bin/sh
# prefix+backspace / ctrl+alt+w:
#   - if the focused pane runs (n)vim -> forward <c-space><bs> so nvim closes its
#     own window (analogous to the smart pane-nav forwarding).
#   - if the focused pane is an idle shell -> close it immediately.
#   - if the focused pane is running another process -> open the confirmation
#     popup (confirm-close.py).

exec python3 "$(dirname "$0")/confirm-close.py" close --forward-vim
