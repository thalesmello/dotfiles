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

    set -l SEP \x1f
    set -l INSTALL_FILES
    set -l INSTALL_COND
    set -l INSTALL_COMMANDS

    # fzf
    set -a INSTALL_FILES "$__fish_user_data_dir/vendor_conf.d/fzf.fish"
    set -a INSTALL_COND (string join $SEP -- command -q fzf)
    set -a INSTALL_COMMANDS (string join $SEP -- fzf --fish)

    # try
    set -a INSTALL_FILES "$__fish_user_data_dir/vendor_functions.d/try.fish"
    set -a INSTALL_COND __fish_install_autoload_have_try
    set -a INSTALL_COMMANDS (string join $SEP -- try init)

    # herdr
    set -a INSTALL_FILES "$__fish_user_data_dir/vendor_completions.d/herdr.fish"
    set -a INSTALL_COND (string join $SEP -- command -q herdr)
    set -a INSTALL_COMMANDS (string join $SEP -- herdr completion fish)

    # brew
    set -a INSTALL_FILES "$__fish_user_data_dir/vendor_conf.d/brew.fish"
    set -a INSTALL_COND (string join $SEP -- command -q brew)
    set -a INSTALL_COMMANDS (string join $SEP -- (__fish_install_autoload_brew_path) shellenv)

    # In --if-absent mode, only check whether the config files already exist. If
    # they all do, there is nothing to do. Otherwise fall through and reinstall
    # everything; the per-tool conditions below decide what actually gets written.
    if set -q _flag_if_absent; and not path filter -qv -- $INSTALL_FILES
        return 0
    end

    mkdir -p \
        "$__fish_user_data_dir/vendor_conf.d/" \
        "$__fish_user_data_dir/vendor_functions.d/" \
        "$__fish_user_data_dir/vendor_completions.d/"
    or return 1

    for i in (seq (count $INSTALL_FILES))
        set -l cond (string split $SEP -- $INSTALL_COND[$i])
        eval $cond; or continue
        set -l cmd (string split $SEP -- $INSTALL_COMMANDS[$i])
        command $cmd > $INSTALL_FILES[$i]
    end

end
