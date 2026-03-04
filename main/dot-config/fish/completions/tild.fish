function __fish_tild_needs_command
    set cmd (commandline -opc)
    test (count $cmd) -eq 1
end

function __fish_tild_forward_completions
    set cmd (commandline -opc)
    set cmd $cmd[2..]
    complete -C "$cmd "(commandline -ct)
end

complete -f -c tild -n __fish_tild_needs_command -a "(complete -C ''(commandline -ct))"
complete -f -c tild -n "not __fish_tild_needs_command" -a "(__fish_tild_forward_completions)"
