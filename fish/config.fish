fundle plugin brgmnn/fish-docker-compose
fundle plugin fischerling/plugin-wd
fundle plugin thalesmello/theme-cmorrell.com
fundle plugin thalesmello/plugin-hubflow
fundle plugin ankitsumitg/docker-fish-completions
fundle plugin lgathy/google-cloud-sdk-fish-completion
fundle plugin franciscolourenco/done
fundle plugin PatrickF1/colored_man_pages.fish
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

 set -U fish_features qmark-noglob

# Setup envs
#fzf --fish | source
set -xg FZF_DEFAULT_OPTS '--bind "ctrl-n:down,ctrl-p:up,ctrl-r:previous-history,ctrl-s:next-history,ctrl-q:select-all,ctrl-x:toggle-out" --height 40%'
set -xg FZF_CTRL_T_COMMAND 'ag -l'

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
