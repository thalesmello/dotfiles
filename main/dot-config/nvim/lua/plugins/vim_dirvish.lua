return {
    'justinmk/vim-dirvish',
    commit= '2e845b6352ff43b47be2b2725245a4cba3e34da1',
    keys = {
        {"-", function()
            return vim.fn.empty(vim.fn.expand("%")) == 1 and "<cmd>Dirvish<cr>" or "<cmd>Dirvish %:h<cr>"
        end, mode = "n", expr = true, noremap = true}
    },
    cmd = "Dirvish",
    event = {"VimEnter"},
    init = function ()
        vim.g.dirvish_relative_paths = 0

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

        vim.api.nvim_create_autocmd('VimEnter', {
            callback = function()
                -- Check if Neovim was started with a directory argument
                local arg = vim.fn.argv(0)
                if arg ~= '' and vim.fn.isdirectory(arg) == 1 then
                    -- Enter Dirvish
                    vim.cmd('Dirvish ' .. vim.fn.fnameescape(arg))
                end
            end
        })
    end,
    cond = true,
    extra_context = {"ssh"},
}
