# Enable FZF key bindings
fish_default_key_bindings -M insert

fzf_key_bindings
# # Without an argument, fish_vi_key_bindings will default to
# # resetting all bindings.
# # The argument specifies the initial mode (insert, "default" or visual).
fish_vi_key_bindings --no-erase
# # Shift Tab
bind -M insert \cv edit_cmd

