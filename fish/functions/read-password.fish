function read-password
	echo -n Password:
    stty -echo
    head -n 1 | read -g $argv[1]
    stty echo
    echo
end
