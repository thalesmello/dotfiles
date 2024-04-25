# We list possible brew locations, in order of precedence
set brews '/opt/homebrew/bin/original-brew' '/opt/homebrew/bin/brew' '/home/linuxbrew/.linuxbrew/bin/brew'

for brew in $brews
	test -x "$brew"
	and eval ("$brew" shellenv)
	and break
end

fundle plugin brgmnn/fish-docker-compose
fundle plugin fischerling/plugin-wd
fundle plugin thalesmello/theme-cmorrell.com
fundle plugin thalesmello/plugin-hubflow
fundle plugin ankitsumitg/docker-fish-completions
fundle plugin lgathy/google-cloud-sdk-fish-completion
fundle plugin franciscolourenco/done
fundle plugin PatrickF1/colored_man_pages.fish
fundle plugin lwolfsonkin/fish-jupyter-completions
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
set -g theme_color_scheme zenburn
set -g fish_prompt_pwd_dir_length 2

# Environment variables
set -gx EDITOR nvim
set -gx VISUAL nvim

set -gx LESS "--ignore-case --LONG-PROMPT --RAW-CONTROL-CHARS --tabs=4 --quit-if-one-screen --mouse"

set -gx LESS_TERMCAP_mb \e'[1;31m'     # begin bold
set -gx LESS_TERMCAP_md \e'[1;36m'     # begin blink
set -gx LESS_TERMCAP_me \e'[0m'        # reset bold/blink
set -gx LESS_TERMCAP_so \e'[01;44;33m' # begin reverse video
set -gx LESS_TERMCAP_se \e'[0m'        # reset reverse video
set -gx LESS_TERMCAP_us \e'[1;32m'     # begin underline
set -gx LESS_TERMCAP_ue \e'[0m'        # reset underline

set -gx LIBGL_ALWAYS_INDIRECT 1

# Setup envs
set -xg FZF_DEFAULT_OPTS '--bind "ctrl-n:down,ctrl-p:up,ctrl-r:previous-history,ctrl-s:next-history,ctrl-q:select-all,ctrl-x:toggle-out" --height 40%'
set -xg FZF_CTRL_T_COMMAND 'ag -l'

# AWS completion
test -x (type -q aws_completer); and complete --command aws --no-files --arguments '(begin; set --local --export COMP_SHELL fish; set --local --export COMP_LINE (commandline); aws_completer | sed \'s/ $//\'; end)'
if set -q USE_WSL_CONFIG
	eval (keychain --eval --quiet $HOME/.ssh/id_rsa)
	set -x WSL_HOST (tail -1 /etc/resolv.conf | cut -d' ' -f2)
	set -x DISPLAY $WSL_HOST:0
	set -x HOST (hostname)
	set -x HOSTNAME (hostname)

	if test -z "$(pgrep ssh-agent)"
		find /tmp/ -name "ssh-*" -type d -exec rm '{}' + 2>/dev/null
		eval $(ssh-agent -c) > /dev/null
	else
		set -x SSH_AGENT_PID "$(pgrep ssh-agent)"
		set -x SSH_AUTH_SOCK "$(find '/tmp/ssh-*' -name 'agent.*')"
	end
end

if command -qs zoxide
	zoxide init fish | source

	complete --command z -e
	complete --command z --no-files --keep-order --arguments '(__zoxide_z_complete_smart)'
end

if command -qs ag
	set -l tokens ()
	complete --command ag -e
	complete --command ag -n '__ag_is_positional_arg 1' --no-files --keep-order --arguments '(__ag_completion_smart)'
	complete --command ag -n 'not __ag_is_positional_arg 1' -F
end
