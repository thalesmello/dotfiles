function ua
    argparse 'clipboard' -- $argv
    or return

    # Read piped input if stdin is not a terminal
    set -l piped_text ""
    if not isatty stdin
        read -z -l raw
        set piped_text (string trim -- $raw)
    end

    # Count active input sources
    set -l source_count 0
    set -q _flag_clipboard; and set source_count (math $source_count + 1)
    test -n "$piped_text"; and set source_count (math $source_count + 1)
    test (count $argv) -gt 0; and set source_count (math $source_count + 1)

    if test $source_count -gt 1
        echo "Error: multiple input sources provided. Use only one of: arguments, piped input, or --clipboard" >&2
        return 1
    end

    if set -q _flag_clipboard
        btt-preset send-keys cmd c
        set -l text (pbpaste)
        osascript -l JavaScript -e 'function run(argv) { Application("com.runningwithcrayons.Alfred").action(argv, {asType: "text"}) }' "$text"
        return
    end

    if test -n "$piped_text"
        osascript -l JavaScript -e 'function run(argv) { Application("com.runningwithcrayons.Alfred").action(argv, {asType: "text"}) }' "$piped_text"
        return
    end

    if test (count $argv) -eq 0
        # No arguments: invoke universal actions with default behavior
        btt-preset send-keys ctrl cmd backslash
        return
    end

    # File mode: validate and expand paths
    for file_path in $argv
        if not test -e "$file_path"
            echo "Path does not exist: $file_path" >&2
            return 1
        end
    end

    set -l absolute_paths (realpath $argv)
    osascript -l JavaScript -e 'function run(argv) { Application("com.runningwithcrayons.Alfred").action(argv) }' $absolute_paths
end

complete -c ua -f
complete -c ua -l clipboard -d "Use clipboard contents as text input"
