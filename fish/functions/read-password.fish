function read-password
    set -l exports_to_variable (math (count $argv)' > 0')
    if math $exports_to_variable >/dev/null
        echo -n "Password: "
    else
        echo -n "Password: " 1>&2
    end

    stty -echo
    head -n 1 - | read -l password
    stty echo

    if math $exports_to_variable >/dev/null
        set -xg $argv[1] $password
    else
        echo $password
    end
end
