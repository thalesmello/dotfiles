function svim-preset
    set mode $argv[1]
    set -e argv[1]
    
    switch "$mode"
    case "enter"
        echo hi
    case "exit"
        echo bye
    end
end

complete -c svim-preset -f
