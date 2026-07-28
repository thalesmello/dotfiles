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

        -- The files an action operates on: the whole arglist when it's
        -- populated, otherwise just the file under the cursor.
        local function targets()
            local args = vim.fn.argv()
            if #args > 0 then
                return args
            end
            return { vim.fn.getline(".") }
        end

        -- Run a command synchronously via :!, so it's shown and its output
        -- appears in the cmdline. `cmd` is a list: program then arguments.
        local function run(cmd)
            local parts = {}
            for _, arg in ipairs(cmd) do
                table.insert(parts, vim.fn.shellescape(arg))
            end
            vim.cmd("!" .. table.concat(parts, " "))
        end

        vim.api.nvim_create_autocmd({ 'FileType' }, {
            group = group,
            pattern = 'dirvish',
            callback = function()
                local opts = { buffer = true }
                vim.keymap.set({ "n" }, "%", ":<C-U>edit %", opts)

                -- Copy files to the clipboard as real file references.
                vim.keymap.set("n", "<leader>Y", function()
                    local cmd = { "bincopy" }
                    vim.list_extend(cmd, targets())
                    run(cmd)
                end, opts)

                -- Paste the clipboard's file(s) into the current directory.
                vim.keymap.set("n", "<leader>P", function()
                    run({ "binpaste", vim.fn.expand("%") })
                end, opts)

                -- Quick Look the target file(s).
                vim.keymap.set("n", "<leader>.", function()
                    local cmd = { "preview" }
                    vim.list_extend(cmd, targets())
                    run(cmd)
                end, opts)

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
