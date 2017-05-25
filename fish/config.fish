# Environment variables
set -gx EDITOR nvim
set -gx VISUAL nvim

# Setup envs
status --is-interactive; and source (nodenv init - | sed 's/setenv/set -x/g' | psub)
status --is-interactive; and source (rbenv init -| sed 's/setenv/set -x/g' | psub)
set -xg FZF_DEFAULT_OPTS '--bind "ctrl-n:down,ctrl-p:up,ctrl-r:previous-history,ctrl-s:next-history,ctrl-q:select-all,ctrl-x:toggle-out"'
