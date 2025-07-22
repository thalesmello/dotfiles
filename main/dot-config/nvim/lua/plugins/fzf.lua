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

        local function get_project_cwd()
            local path = vim.fn["projectionist#path"]()

            if path == "/" or path == nil or path == '' then
                path = vim.fn.getcwd()
            end

            return path
        end

        local function cwd_files ()
            if vim.o.filetype == 'qf' then
                vim_utils.feedkeys("<up>")

                return
            end

            local path = get_project_cwd()
            fzf_lua.files({ cwd = path })
        end

        vim.keymap.set("n", "<c-p>", cwd_files, { noremap = true, silent = true })
        vim.keymap.set("n", "<c-t>", cwd_files, { noremap = true, silent = true })

        vim.keymap.set("n", "<leader><c-p>",
            function ()
                local path = get_project_cwd()

                fzf_lua.files({
                    cwd = path,
                    query = vim.fn.expand("%:t:r")
                })
            end,
            { noremap = true, silent = true }
        )
        vim.keymap.set("v", "<c-p>", function ()
            local path = get_project_cwd()
            local selection = vim_utils.get_visual_selection()
            fzf_lua.files({
                cwd = path,
                query = selection,
            })
        end, { noremap = true, silent = true })
        vim.keymap.set("n", "<c-f>", function ()
            return ':<c-u>Ag!<space>'
        end, { noremap = true, expr = true })
        vim.keymap.set("n", "<leader>/", function ()
                local path = get_project_cwd()
            fzf_lua.grep_cword({ cwd = path })
        end, { silent = true })
        vim.keymap.set("v", "<leader>/", function ()
            local path = get_project_cwd()
            local selection = vim_utils.get_visual_selection()
            fzf_lua.live_grep({
                cwd = path,
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
            local path = get_project_cwd()
            local callback = utils.create_user_command_callback("live_grep", "search", {
                cwd = opts.bang and path or vim.fn.getcwd(),
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
