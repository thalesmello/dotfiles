return {
    "ibhagwan/fzf-lua",
    dependencies = { 'vim-projectionist' },
    keys = {
        {"<c-p>", mode = {"n", "v"}},
        {"<c-f>", mode = "n"},
        {"<leader>/", mode = {"n", "v"}},
    },
    opts = {
        "fzf-vim",
        fzf_colors = true,
    },
    config = function(_, opts)
        require("fzf-lua").setup(opts)

        local vim_utils = require('vim_utils')
        local fzf_lua = require('fzf-lua')
        local utils = fzf_lua.utils

        local function visual_ag(word_boundary)
            local selection = vim_utils.get_visual_selection()
            if word_boundary then
                -- vim.cmd.ProjectDo('Ag \\b' .. selection .. '\\b')
                vim.cmd.ProjectDo('Ag ' .. selection)
            else
                vim.cmd.ProjectDo('Ag ' .. selection)
            end
        end

        vim.g.fzf_history_dir = '~/.local/share/fzf-history'
        vim.env.FZF_DEFAULT_COMMAND = 'ag -g ""'

        vim.keymap.set("n", "<c-p>", '<cmd>ProjectDo Files<cr>', { noremap = true, silent = true })
        vim.keymap.set("n", "<leader><c-p>", '<cmd>ProjectDo Files<cr>'..vim.fn.expand("%:t:r"), { noremap = true, silent = true })
        vim.keymap.set("v", "<c-p>", '<cmd>ProjectDo Files<cr>', { noremap = true, silent = true })
        vim.keymap.set("n", "<c-f>", ':<c-u>ProjectDo Ag<space>', { noremap = true })
        vim.keymap.set("n", "<leader>/", function () return '<cmd>ProjectDo Ag ' .. vim.fn.expand('<cword>') .. '<cr>' end, { silent = true, expr = true })
        vim.keymap.set("v", "<leader>/", function () visual_ag(true) end, { noremap = true, silent = true })

        function CompleteAg(A)
            if A == '' then
                return A
            end

            local output = vim.fn.split(
                vim.system({
                    "ag",
                    "-o",
                    [[\b\w*]] .. A .. [[\w*\b]],
                }, {text=true}):wait().stdout,
                "\n"
            )

            local completions = vim.iter(output)
                :map(function (line)
                    return line:match("^[^:]*:[^:]*:(.-)$")
                end)
                :fold({}, function (acc, line)
                acc[line] = 1
                return acc
            end)

            return vim.tbl_keys(completions)
        end

        vim.api.nvim_create_user_command("Ag", utils.create_user_command_callback("grep", "search"), {
            bang = true,
            complete = CompleteAg,
            nargs=1,
        })
    end,
    lazy=false,
}
