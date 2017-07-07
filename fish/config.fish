fundle plugin brgmnn/fish-docker-compose
fundle plugin fischerling/plugin-wd
fundle plugin oh-my-fish/theme-bobthefish
fundle init

# Configure theme
set -g theme_display_docker_machine no
set -g theme_display_vi yes
set -g theme_display_date no
set -g theme_display_cmd_duration yes
set -g theme_nerd_fonts yes
set -g theme_show_exit_status yes
set -g default_user your_normal_user
set -g theme_color_scheme gruvbox
set -g fish_prompt_pwd_dir_length 2

thefuck --alias | source
# Environment variables
set -gx EDITOR nvim
set -gx VISUAL nvim

# Setup envs
status --is-interactive; and source (nodenv init - | sed 's/setenv/set -x/g' | psub)
status --is-interactive; and source (rbenv init -| sed 's/setenv/set -x/g' | psub)
set -xg FZF_DEFAULT_OPTS '--bind "ctrl-n:down,ctrl-p:up,ctrl-r:previous-history,ctrl-s:next-history,ctrl-q:select-all,ctrl-x:toggle-out"'
