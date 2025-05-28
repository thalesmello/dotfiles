return {
    {
        'tmux-plugins/vim-tmux-focus-events',
        tag = 'v1.0.0',
        event = "TermOpen",
    },
    { 'tmux-plugins/vim-tmux', ft = "tmux" },
    {
        'sainnhe/tmuxline.vim',
        config = function()
            vim.g["airline#extensions#tmuxline#enabled"] = 0
            vim.g.tmuxline_powerline_separators = 0

            local window_icon, empty_icon, tab_name_generator

            window_icon = "#{?window_zoomed_flag,,}"
            window_icon = window_icon .. "#{?window_activity_flag,,}"
            window_icon = window_icon .. "#{?window_bell_flag,,}"
            empty_icon = "#{==:" .. window_icon .. ",}"
            window_icon = "#{?" .. empty_icon .. ",," .. window_icon .. " }"
            tab_name_generator = window_icon .. "#{b:pane_current_path}/"

            vim.g.tmuxline_preset = {
                a = {' #(whoami)', '#S'},
                win = {'#I', tab_name_generator},
                cwin = {'#I', tab_name_generator},
                x = {'#{prefix_highlight}'},
                z = {'#{online_status}', '%R'},
                options = {['status-justify'] = 'left'}
            }
        end,
        cmd = {
            "Tmuxline",
            "TmuxlineSnapshot",
        }
    },
    -- { 'wellle/tmux-complete.vim' },
    cond = not vim.env.TMUX
}
