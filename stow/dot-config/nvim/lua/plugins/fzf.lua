return {
    "ibhagwan/fzf-lua",
    dependencies = { 'vim-projectionist' },
    keys = {
        {"<c-p>", mode = {"n", "v"}},
        {"<c-t>", mode = {"n", "v"}},
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

        vim.g.fzf_history_dir = '~/.local/share/fzf-history'
        vim.env.FZF_DEFAULT_COMMAND = 'ag -g ""'

        local function cwd_files ()
            if vim.o.filetype == 'qf' then
                vim_utils.feedkeys("<up>")

                return
            end

            vim.cmd([[ProjectDo let b:project_do_cwd = getcwd()]])
            fzf_lua.files({ cwd = vim.b.project_do_cwd })
        end

        vim.keymap.set("n", "<c-p>", cwd_files, { noremap = true, silent = true })
        vim.keymap.set("n", "<c-t>", cwd_files, { noremap = true, silent = true })

        vim.keymap.set("n", "<leader><c-p>",
            function ()
                vim.cmd([[ProjectDo let b:project_do_cwd = getcwd()]])
                fzf_lua.files({
                    cwd = vim.b.project_do_cwd,
                    query = vim.fn.expand("%:t:r")
                })
            end,
            { noremap = true, silent = true }
        )
        vim.keymap.set("v", "<c-p>", function ()
            vim.cmd([[ProjectDo let b:project_do_cwd = getcwd()]])
            local selection = vim_utils.get_visual_selection()
            fzf_lua.files({
                cwd = vim.b.project_do_cwd,
                query = selection,
            })
        end, { noremap = true, silent = true })
        vim.keymap.set("n", "<c-f>", function ()
            return ':<c-u>Ag!<space>'
        end, { noremap = true, expr = true })
        vim.keymap.set("n", "<leader>/", function ()
            vim.cmd([[ProjectDo let b:project_do_cwd = getcwd()]])
            fzf_lua.grep_cword({ cwd = vim.b.project_do_cwd })
        end, { silent = true })
        vim.keymap.set("v", "<leader>/", function ()
            vim.cmd([[ProjectDo let b:project_do_cwd = getcwd()]])
            local selection = vim_utils.get_visual_selection()
            fzf_lua.live_grep({
                cwd = vim.b.project_do_cwd,
                query = selection,
                no_esc = true,
            })
        end, { noremap = true, silent = true })

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

        vim.api.nvim_create_user_command("Ag", function (ops)
            vim.cmd([[ProjectDo let b:project_do_cwd = getcwd()]])
            local callback = utils.create_user_command_callback("live_grep", "search", {
                cwd = opts.bang and vim.b.project_do_cwd or vim.fn.getcwd(),
                no_esc = true,
            })
            callback(ops)
        end, {
            bang = true,
            complete = CompleteAg,
            nargs=1,
        })
    end,
    lazy=false,
}
