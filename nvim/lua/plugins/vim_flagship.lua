return {
    'thalesmello/vim-flagship',
    dependencies = {
        {
            'ryanoasis/vim-devicons',
            init = function ()
                vim.g.webdevicons_enable_flagship_statusline = 0
                vim.g.webdevicons_enable_flagship_statusline_fileformat_symbols = 0
            end,
        }
    },
    config = function() require('config/flagship') end,
}
