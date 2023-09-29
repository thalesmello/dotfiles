if not vim.g.started_by_firenvim then
    return
end

vim.go.showtabline = 0
vim.go.laststatus = 0
vim.go.guifont = "InconsolataGoNerdFontCompleteM-Regular:h14"

vim.g.firenvim_config = {
    localSettings = {
        ['.*'] = {
            takeover = 'never',
        }
    }
}
