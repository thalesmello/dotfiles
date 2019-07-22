fundle plugin brgmnn/fish-docker-compose
fundle plugin fischerling/plugin-wd
fundle plugin thalesmello/theme-cmorrell.com
fundle plugin fisherman/rbenv
fundle plugin cafedomancer/nodenv
fundle init

# Configure theme
set -g theme_display_docker_machine no
set -g theme_display_vi yes
set -g theme_display_date no
set -g theme_display_cmd_duration yes
set -g theme_nerd_fonts yes
set -g theme_powerline_fonts no
set -g theme_show_exit_status yes
set -g theme_display_virtualenv no
set -g default_user thales
set -g theme_color_scheme zenburn
set -g fish_prompt_pwd_dir_length 2

# Environment variables
set -gx EDITOR nvim
set -gx VISUAL nvim

# Setup envs
set -xg FZF_DEFAULT_OPTS '--bind "ctrl-n:down,ctrl-p:up,ctrl-r:previous-history,ctrl-s:next-history,ctrl-q:select-all,ctrl-x:toggle-out"'
set -xg SKIM_DEFAULT_OPTS '--bind "ctrl-n:down,ctrl-p:up,alt-r:previous-history,alt-s:next-history,ctrl-q:select-all,ctrl-x:toggle-out"'

# AWS completion
test -x (which aws_completer); and complete --command aws --no-files --arguments '(begin; set --local --export COMP_SHELL fish; set --local --export COMP_LINE (commandline); aws_completer | sed \'s/ $//\'; end)'
