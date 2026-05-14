function __sp_list_services
    for f in ~/.config/service-preset/*/service.toml
        test -f "$f"; and path basename (path dirname "$f")
    end
end

function __sp_list_orphans
    set -l native
    switch (uname -s)
        case Darwin
            for f in ~/Library/LaunchAgents/com.service-preset.*.plist
                test -f "$f"; or continue
                set -a native (path basename "$f" | string replace -r '^com\.service-preset\.' '' | string replace -r '\.plist$' '')
            end
        case Linux
            for f in ~/.config/systemd/user/service-preset.*.service
                test -f "$f"; or continue
                set -a native (path basename "$f" | string replace -r '^service-preset\.' '' | string replace -r '\.service$' '')
            end
    end

    set -l defined (__sp_list_services)
    for name in $native
        contains -- "$name" $defined; or echo "$name"
    end
end

complete -c service-preset -f

complete -c service-preset -n "__fish_is_nth_token 1" -f -d "Subcommand" -a "
    list
    install
    uninstall
    start
    stop
    restart
    status
    run
    logs
    create
    orphans
    help
"

complete -c service-preset -l dry-run -d "Print commands without executing"
complete -c service-preset -s h -l help -d "Show help"

complete -c service-preset -n "__fish_seen_subcommand_from install uninstall start stop restart status run logs" \
    -f -a "(__sp_list_services)" -d "Service name"

complete -c service-preset -n "__fish_seen_subcommand_from install uninstall start stop restart status" \
    -l all -d "Apply to all services"

complete -c service-preset -n "__fish_seen_subcommand_from logs" \
    -s f -l follow -d "Follow log output"

complete -c service-preset -n "__fish_seen_subcommand_from create" \
    -l mode -d "Service mode" -rfa "daemon scheduled"

complete -c service-preset -n "__fish_seen_subcommand_from orphans" \
    -l uninstall -d "Uninstall orphaned services"

complete -c service-preset -n "__fish_seen_subcommand_from orphans; and __fish_contains_opt uninstall" \
    -f -a "(__sp_list_orphans)" -d "Orphan name"
