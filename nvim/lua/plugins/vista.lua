-- TODO: Try out Aerial.nvim!
return {
    'liuchengxu/vista.vim',
    keys = {
        {"<leader>co", '<cmd>Vista!!<cr>'},
    },
    cmd = {"Vista"},
    init = function()
        vim.g.vista_icon_indent = { "╰─▸ ", "├─▸ " }
        vim.g["vista#renderer#enable_icon"] = 1
        vim.g.vista_default_executive = 'ctags'
    end,
}
