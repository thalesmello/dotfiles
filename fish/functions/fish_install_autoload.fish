function fish_install_autoload
    # We list possible brew locations, in order of precedence
    set brews '/opt/homebrew/bin/original-brew' '/opt/homebrew/bin/brew' '/home/linuxbrew/.linuxbrew/bin/brew'

    for brew in $brews
        test -x "$brew"
        and "$brew" shellenv > "$__fish_data_dir/vendor_conf.d/brew.fish"
        and break
    end

    fzf --fish > "$__fish_data_dir/vendor_conf.d/fzf.fish"
end
