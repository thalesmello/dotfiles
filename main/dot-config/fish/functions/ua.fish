function ua
    argparse 'clipboard' -- $argv
    or return

    # Count active input sources
    set -l source_count 0
    set -q _flag_clipboard; and set source_count (math $source_count + 1)
    not isatty stdin; and set source_count (math $source_count + 1)
    test (count $argv) -gt 0; and set source_count (math $source_count + 1)

    if test $source_count -eq 0
        echo "Usage: ua [--clipboard] [files...]" >&2
        echo "  Provide file paths, pipe text, or use --clipboard" >&2
        return 1
    end

    if test $source_count -gt 1
        echo "Error: multiple input sources provided. Use only one of: arguments, piped input, or --clipboard" >&2
        return 1
    end

    if set -q _flag_clipboard
        set -l text (pbpaste)
        /usr/bin/osascript -l JavaScript -e 'function run(argv) { Application("com.runningwithcrayons.Alfred").action(argv) }' "$text"
        return
    end

    if not isatty stdin
        read -z -l text
        set text (string trim -- $text)
        /usr/bin/osascript -l JavaScript -e 'function run(argv) { Application("com.runningwithcrayons.Alfred").action(argv) }' "$text"
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
    /usr/bin/osascript -l JavaScript -e 'function run(argv) { Application("com.runningwithcrayons.Alfred").action(argv) }' $absolute_paths
end

complete -c ua -f
complete -c ua -l clipboard -d "Use clipboard contents as text input"
