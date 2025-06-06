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
    config = function()
        _G.StatuslineFugitiveBranch = function ()
            if vim.fn.winwidth(0) < 80 then
                return ''
            end

            if vim.fn.exists('*FugitiveHead') ~= 0 then
                local branch = vim.fn.FugitiveHead()

                if branch ~= '' then
                    return '' ..branch
                end
            end

            return ''
        end


        vim.api.nvim_create_autocmd("User", {
            pattern = "Flags",
            group = vim.api.nvim_create_augroup("FlagshipConfig", { clear = true }),
            callback = function ()
                vim.fn.Hoist("buffer", -1, "WebDevIconsGetFileTypeSymbol")
                vim.fn.Hoist("buffer", "[%{v:lua.StatuslineFugitiveBranch()}]")
            end
        })

        vim.g.tabprefix = ""

        vim.g.flagship_skip = [[FugitiveStatusline]]
    end,
}
