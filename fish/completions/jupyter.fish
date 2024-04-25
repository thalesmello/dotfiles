function __fish_jupyter_subcommands
    command jupyter -h | sed '/Available/!d;s/^.*: //' | tr ' ' '\n'
end

complete -x -c jupyter -a "(__fish_jupyter_subcommands)"
