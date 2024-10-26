function betterdisplaycli --wraps betterdisplaycli
    set args $argv
    set acc
    set seen_option 0
    while test (count $args) -gt 0
        set arg $args[1]
        set -e args[1]

        if string match -q -- '--*' "$arg"
            set seen_option 1
        else if test $seen_option = 1
            set last_arg $acc[-1]

            if not string match -q -- '*=*' "$last_arg"
                set -e acc[-1]
                set arg "$last_arg=$arg"
            end
        end

        set acc $acc "$arg"
    end

    echo >&2 "Executing betterdisplaycli $(string join -- ' ' (string escape -- $acc))"
    command betterdisplaycli $acc
end
