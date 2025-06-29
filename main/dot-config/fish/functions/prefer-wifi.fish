function prefer-wifi
    if test (count $argv) -ne 3
        echo "Wrong number of arguments"
        echo "Usage: prefer-wifi <network device, e.g. en0> <wifi name> <security type>"
    end

    sudo networksetup -removepreferredwirelessnetwork $argv[1] $argv[2]
    sudo networksetup -addpreferredwirelessnetworkatindex $argv[1] $argv[2] 0 $argv[3]
end

function __prefer_wifi_complete_wifi_name
    if not command -q networksetup
        return
    end

    set tokens (commandline -opc)

    networksetup -listpreferredwirelessnetworks $tokens[2] | tail -n +2 | string replace -r '^\s*' ''
end

complete -c prefer-wifi -f
complete -c prefer-wifi -n "__fish_is_nth_token 1" -d "network device" -a "en0 en1"
complete -c prefer-wifi -n "__fish_is_nth_token 2" -d "WiFi name" -a "(__prefer_wifi_complete_wifi_name)"
complete -c prefer-wifi -n "__fish_is_nth_token 3" -d "security type" -a "OPEN WPA WPAE WEP"

