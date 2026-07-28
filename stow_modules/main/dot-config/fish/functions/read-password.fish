# Defined in /var/folders/l_/j27d13hd1cs842jb5gy0s65w0000gn/T//fish.ffUZX8/read-password.fish @ line 2
function read-password
	if test (count $argv) -gt 0
        echo -n "Password: "
    else
        echo -n "Password: " 1>&2
    end

    stty -echo
    head -n 1 - | read -l password
    stty echo

    if test (count $argv) -gt 0
        set -xg $argv[1] $password
    else
        echo $password
    end
end
