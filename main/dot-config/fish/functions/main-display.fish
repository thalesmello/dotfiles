function main-display -a monitor
    betterdisplaycli set '--main=on' "--originalName=$monitor"
end

complete -c main-display -f
complete -c main-display -n "__fish_is_nth_token 1" -f -d "Name of the display to make main" -a "(complete -C 'betterdisplaycli set --main=on --originalName ')"
