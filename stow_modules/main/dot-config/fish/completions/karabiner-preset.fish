complete -c karabiner-preset -f
complete -c karabiner-preset -n "__fish_is_nth_token 1" -f -d "Sub-command" -a "
    enable-layer
    disable-layer
    restart
"
