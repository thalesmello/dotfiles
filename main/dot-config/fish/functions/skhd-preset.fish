function skhd-preset
    set preset $argv[1]
    set -e argv[1]

    switch "$preset"
    case "search-and-execute-command"
        fish -c "$(string match -rg ':\s*(.*)$' "$(skhd-preset search-and-print-shortcut)")"
    case "search-and-display-mapping"
        btt-preset display-message --duration 1 "$(string match -rg '^(.*):' "$(skhd-preset search-and-print-shortcut)")"
    case "display-shortcuts"
        set config (cat ~/.skhdrc_main ~/.skhdrc_local | string collect)
        string replace -ra ':\n\s*' ': ' "$(string replace -ra '\\\\\n\s+' ' ' "$config")" \
        | string match -e ":" \
        | string match -vre '^#'
    case "search-and-print-shortcut"
        skhd-preset display-shortcuts | choose -w 80 -n 20 -s 20
    end

end
