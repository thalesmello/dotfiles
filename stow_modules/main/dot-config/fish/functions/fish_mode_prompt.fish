# Defined in /var/folders/l_/j27d13hd1cs842jb5gy0s65w0000gn/T//fish.VKnwUu/fish_mode_prompt.fish @ line 2
function fish_mode_prompt --description 'Display the default mode for the prompt'
	set -l normalize ""
    if test "$fish_key_bindings" = "fish_vi_key_bindings"
        or test "$fish_key_bindings" = "fish_hybrid_key_bindings"
        switch $fish_bind_mode
        case default
            set_color --bold red
            echo 'n'
        case insert
            echo ' '
        case replace_one
            set_color --bold green
            echo 'r'
        case visual
            set_color --bold magenta
            echo 'v'
        end

        set_color normal
        echo ''
    end
end
