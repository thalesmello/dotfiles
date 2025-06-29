function fish_install_autoload
    mkdir -p "$__fish_user_data_dir/vendor_conf.d/"

    # We list possible brew locations, in order of precedence
    set brews '/opt/homebrew/bin/original-brew' '/opt/homebrew/bin/brew' '/home/linuxbrew/.linuxbrew/bin/brew'

    if not test -e "$__fish_user_data_dir/vendor_conf.d/brew.fish"
        for brew in $brews
            test -x "$brew"
            and "$brew" shellenv > "$__fish_user_data_dir/vendor_conf.d/brew.fish"
            and source "$__fish_user_data_dir/vendor_conf.d/brew.fish"
            and break
        end
    end

    fzf --fish > "$__fish_user_data_dir/vendor_conf.d/fzf.fish"
end
