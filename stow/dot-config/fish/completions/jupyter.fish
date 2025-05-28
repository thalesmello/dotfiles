function __fish_jupyter_subcommands
    command jupyter -h | sed '/Available/,$!d;s/^.*: //' | tr ' ' '\n'
    # complete -C "jupyter-" | string replace -r "^jupyter-" ""
end

complete -c jupyter -n "__fish_is_first_token" -xa "(__fish_jupyter_subcommands)"
