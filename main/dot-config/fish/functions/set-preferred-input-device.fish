function set-preferred-input-device
    set -l priorities \
        "Yeti Nano" \
        "Realtek USB2.0 Audio" \
        "MacBook Pro Microphone"
        # Add more device names here — first entry = highest priority

    argparse 'dry-run' 'list' -- $argv
    or return

    set -l connected (SwitchAudioSource -a -t input)

    if set -q _flag_list
        for device in $connected
            echo $device
        end
        return
    end

    for priority in $priorities
        if contains -- $priority $connected
            if set -q _flag_dry_run
                echo "Would select: $priority"
            else
                SwitchAudioSource -t input -s "$priority"
                echo "Switched to: $priority"
            end
            return
        end
    end

    echo "No preferred input device found among connected devices."
end

complete -c set-preferred-input-device -f
complete -c set-preferred-input-device -l dry-run -d "Print what would be selected without switching"
complete -c set-preferred-input-device -l list -d "List all connected input devices"
