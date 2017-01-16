# Environment variables
set -gx EDITOR nvim
set -gx VSUAL nvim

# Setup envs
status --is-interactive; and source (nodenv init -|psub)
status --is-interactive; and source (rbenv init -|psub)

