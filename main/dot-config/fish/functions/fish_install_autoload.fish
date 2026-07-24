function __fish_install_autoload_brew_path --description 'Print the first available brew binary'
    # We list possible brew locations, in order of precedence
    for brew in /opt/homebrew/bin/original-brew /opt/homebrew/bin/brew /home/linuxbrew/.linuxbrew/bin/brew
        if test -x "$brew"
            echo "$brew"
            return 0
        end
    end
    return 1
end

function __fish_install_autoload_have_try --description 'Check whether `try` can be initialized'
    command -q try; and command -q ruby
    and ruby -e 'exit(Gem::Version.new(RUBY_VERSION) > Gem::Version.new("3.1") ? 0 : 1)' 2>/dev/null
end

function fish_install_autoload --description 'Install fish autoload files for available tools'
    # Parse arguments. With --if-absent, we only reinstall if any of the files
    # that *would* be installed on this machine are missing.
    argparse if-absent -- $argv
    or return 1

    set brew_file "$__fish_user_data_dir/vendor_conf.d/brew.fish"
    set fzf_file "$__fish_user_data_dir/vendor_conf.d/fzf.fish"
    set try_file "$__fish_user_data_dir/vendor_functions.d/try.fish"

    # In --if-absent mode, only check whether the config files already exist. If
    # they all do, there is nothing to do. Otherwise fall through and reinstall
    # everything; the command probes below decide what actually gets written.
    if set -q _flag_if_absent
        if test -e "$brew_file"; and test -e "$fzf_file"; and test -e "$try_file"
            return 0
        end
    end

    mkdir -p "$__fish_user_data_dir/vendor_conf.d/"
    or return 1
    mkdir -p "$__fish_user_data_dir/vendor_functions.d/"
    or return 1

    set brew_path (__fish_install_autoload_brew_path)
    if test -n "$brew_path"; and not test -e "$brew_file"
        "$brew_path" shellenv > "$brew_file"
        and source "$brew_file"
    end

    if command -q fzf
        command fzf --fish > "$fzf_file"
    end

    if __fish_install_autoload_have_try
        command try init > "$try_file"
    end
end
