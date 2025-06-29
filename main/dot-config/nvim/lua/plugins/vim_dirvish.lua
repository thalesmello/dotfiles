return {
    'justinmk/vim-dirvish',
    commit= '2e845b6352ff43b47be2b2725245a4cba3e34da1',
    config = function()
        vim.keymap.set("n", "-", function()
            return vim.fn.empty(vim.fn.expand("%")) == 1 and "<cmd>Dirvish<cr>" or "<cmd>Dirvish %:h<cr>"
        end, { expr = true, noremap = true })


        local group = vim.api.nvim_create_augroup("DirvishGroup", {
            clear = true
        })

        vim.api.nvim_create_autocmd({ 'FileType' }, {
            group = group,
            pattern = 'dirvish',
            callback = function()
                local opts = { buffer = true }
                vim.keymap.set({ "n" }, "%", ":<C-U>edit %", opts)
                vim.cmd [[
                      silent! unmap <buffer> <c-p>
                      silent! unmap <buffer> <c-n>
                      ]]
            end,
        })

    end,
    cond = true,
}
