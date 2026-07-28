# Fish completion script for skhd

complete -c skhd -l install-service \
    -d "Install launchd service file into ~/Library/LaunchAgents/com.koekeishiya.skhd.plist"

complete -c skhd -l uninstall-service \
    -d "Remove launchd service file ~/Library/LaunchAgents/com.koekeishiya.skhd.plist"

complete -c skhd -l start-service \
    -d "Run skhd as a service through launchd"

complete -c skhd -l restart-service \
    -d "Restart skhd service"

complete -c skhd -l stop-service \
    -d "Stop skhd service from running"

complete -c skhd -l verbose -s V \
    -d "Output debug information"

complete -c skhd -l profile -s P \
    -d "Output profiling information"

complete -c skhd -l version -s v \
    -d "Print version number to stdout"

complete -c skhd -l config -s c -r \
    -d "Specify location of config file"

complete -c skhd -l observe -s o \
    -d "Output keycode and modifiers of event. Ctrl+C to quit"

complete -c skhd -l reload -s r \
    -d "Signal a running instance of skhd to reload its config file"

complete -c skhd -l no-hotload -s h \
    -d "Disable system for hotloading config file"

complete -c skhd -l key -s k -r \
    -d "Synthesize a keypress (same syntax as when defining a hotkey)"

complete -c skhd -l text -s t -r \
    -d "Synthesize a line of text"
