function svim-preset
    set mode $argv[1]
    set -e argv[1]

    switch "$mode"
    case "enter"
        svim > /tmp/svim.log &
        skhd -k "cmd - tab"
        skhd -k "cmd - tab"
    case "exit"
        killall svim
    end
end

complete -c svim-preset -f
complete -c svim-preset -n "__fish_is_nth_token 1" -a "enter exit"
