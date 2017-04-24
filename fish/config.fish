# Environment variables
set -gx EDITOR nvim
set -gx VISUAL nvim

# Setup envs
status --is-interactive; and source (nodenv init -|psub)
status --is-interactive; and source (rbenv init -|psub)
set -xg FZF_DEFAULT_OPTS '--bind "ctrl-n:down,ctrl-p:up,ctrl-r:previous-history,ctrl-s:next-history,ctrl-q:select-all,ctrl-x:toggle-out"'
set -g projects_path ~/projects/*
