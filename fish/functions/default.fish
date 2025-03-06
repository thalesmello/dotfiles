# Used to set defualt values
function default
    for val in $argv
        if test -z "$val"
            continue
        end

        echo $val
        return 0
    end

    return 1
end
