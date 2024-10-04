function fish_user_key_bindings
  # Enable FZF key bindings
  fish_vi_key_bindings
  fish_default_key_bindings -M insert
  fish_vi_key_bindings --no-erase -M insert

  fzf_key_bindings
  # # Without an argument, fish_vi_key_bindings will default to
  # # resetting all bindings.
  # # The argument specifies the initial mode (insert, "default" or visual).
  # # Shift Tab
  bind -M insert \cv edit_cmd
  bind -M insert \cq 'commandline (commandline | format-shell)'
  bind -M insert \cg expand-abbr
end
