local ensure_installed = { "lua", "vim", "python", "ruby", "query",
    "sql", "regex", "markdown", "markdown_inline", "html",
    "latex", "typst", "yaml", "fish" }

return {
    {
        'nvim-treesitter/nvim-treesitter',
        branch = "main",
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
        -- String form so lazy loads the plugin (registering the :TSUpdate
        -- command) before running the build. On `main` the command is defined in
        -- plugin/nvim-treesitter.lua at load time.
        build = ":TSUpdate",
        dependencies = {
            { 'nvim-treesitter/nvim-treesitter-textobjects', branch = "main" },
            'nvim-treesitter/nvim-treesitter-context',
            'kana/vim-textobj-user',
        },
        config = function ()
            local nts = require('nvim-treesitter')
            nts.setup()

            -- Install any parsers from `ensure_installed` that are missing.
            -- (main branch: no `ensure_installed`/`auto_install` config keys;
            -- installation is an explicit async call.)
            do
                local installed = nts.get_installed()
                local missing = vim.tbl_filter(function(lang)
                    return not vim.tbl_contains(installed, lang)
                end, ensure_installed)
                if #missing > 0 then
                    nts.install(missing)
                end
            end

            local group = vim.api.nvim_create_augroup("TreesitterAutogroup", {
                clear = true
            })

            -- Replaces the master-branch `highlight`, `indent`, and `auto_install`
            -- modules: enable treesitter highlighting + indentation per buffer, and
            -- fetch a missing-but-available parser on demand.
            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = "*",
                callback = function(args)
                    local buf = args.buf
                    local ft = vim.bo[buf].filetype
                    local lang = vim.treesitter.language.get_lang(ft) or ft

                    -- auto_install: fetch parser if available but not installed
                    if vim.tbl_contains(nts.get_available(), lang)
                        and not vim.tbl_contains(nts.get_installed(), lang) then
                        nts.install({ lang })
                    end

                    -- highlight (returns false / errors when no parser: guard it)
                    local started = pcall(vim.treesitter.start, buf)

                    -- indent (only when a parser is actually active)
                    if started then
                        vim.bo[buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
                    end
                end,
            })

            -- The plugin loads at startup, so the buffer opened on the command line
            -- may have fired FileType before the autocmd above existed. Apply it now.
            if vim.bo.filetype ~= "" then
                vim.api.nvim_exec_autocmds("FileType", { group = group, pattern = vim.bo.filetype })
            end

            -- Treesitter-based folding for python.
            -- Replaces the master-branch `nvim_treesitter#foldexpr()` with the
            -- builtin `vim.treesitter.foldexpr()`.
            for _, lang in ipairs({"python"}) do
                vim.api.nvim_create_autocmd({ 'FileType' }, {
                    group = group,
                    pattern = lang,
                    callback = function()
                        vim.opt_local.foldmethod = "expr"
                        vim.opt_local.foldexpr = "v:lua.vim.treesitter.foldexpr()"
                    end,
                })
            end

            -- textobjects (main branch): call setup once, then register keymaps
            -- manually. The `move` module wraps itself with `make_repeatable_move`,
            -- so `;` / `,` below repeat these motions automatically.
            require('nvim-treesitter-textobjects').setup({
                select = { lookahead = true },
                move = { set_jumps = true },
            })

            local move = require('nvim-treesitter-textobjects.move')

            -- { lhs, move fn, query (string or list), query_group, desc }
            local motions = {
                { "]m", move.goto_next_start, "@function.outer", nil, "Next function start" },
                { "]]", move.goto_next_start, "@class.outer", nil, "Next class start" },
                { "]o", move.goto_next_start, { "@loop.inner", "@loop.outer" }, nil, "Next loop start" },
                { "]s", move.goto_next_start, "@scope", "locals", "Next scope" },
                { "]z", move.goto_next_start, "@fold", "folds", "Next fold" },
                { "]M", move.goto_next_end, "@function.outer", nil, "Next function end" },
                { "][", move.goto_next_end, "@class.outer", nil, "Next class end" },
                { "[m", move.goto_previous_start, "@function.outer", nil, "Prev function start" },
                { "[[", move.goto_previous_start, "@class.outer", nil, "Prev class start" },
                { "[z", move.goto_previous_start, "@fold", "folds", "Prev fold" },
                { "[M", move.goto_previous_end, "@function.outer", nil, "Prev function end" },
                { "[]", move.goto_previous_end, "@class.outer", nil, "Prev class end" },
                { "]i", move.goto_next, "@conditional.outer", nil, "Next conditional" },
                { "[i", move.goto_previous, "@conditional.outer", nil, "Prev conditional" },
            }

            for _, m in ipairs(motions) do
                local lhs, fn, query, query_group, desc = m[1], m[2], m[3], m[4], m[5]
                vim.keymap.set({ "n", "x", "o" }, lhs, function()
                    fn(query, query_group)
                end, { desc = desc })
            end

            -- NOTE: the master-branch `lsp_interop.peek_definition_code`
            -- (<leader>df / <leader>dF) has no equivalent in textobjects `main`
            -- and was dropped in the migration. It used the LSP to peek the
            -- source code of the enclosing textobject in a floating window:
            -- <leader>df peeked the definition of the function (@function.outer)
            -- under the cursor, <leader>dF the enclosing class (@class.outer) --
            -- without leaving the current buffer.

            local ts_repeat_move = require("nvim-treesitter-textobjects.repeatable_move")

            vim.keymap.set({ "n", "x" }, ";", ts_repeat_move.repeat_last_move)
            vim.keymap.set({ "n", "x" }, ",", ts_repeat_move.repeat_last_move_opposite)
            vim.keymap.set({ "n", "x" }, "f", ts_repeat_move.builtin_f_expr, { expr = true })
            vim.keymap.set({ "n", "x" }, "F", ts_repeat_move.builtin_F_expr, { expr = true })
            vim.keymap.set({ "n", "x" }, "t", ts_repeat_move.builtin_t_expr, { expr = true })
            vim.keymap.set({ "n", "x" }, "T", ts_repeat_move.builtin_T_expr, { expr = true })

            -- Local main-branch reimplementation of the expand/shrink half of
            -- nvim-treesitter-textsubjects (see lua/textsubjects_shim.lua and
            -- queries/*/textsubjects-smart.scm).
            -- <cr> = expand smart, <bs> = shrink to previous selection.
            require('textsubjects_shim').setup({
                prev_selection = '<bs>',
                keymaps = {
                    ['<cr>'] = 'textsubjects-smart',
                },
            })

            vim.keymap.set({ "n" }, "<leader>eto", function()
                local config = vim.fn.stdpath("config")

                local filetype = vim.o.filetype

                if filetype == '' then
                    return
                end

                vim.cmd.edit(config .. "/after/queries/" .. filetype .. '/textobjects.scm')
            end)


            vim.keymap.set({ "n" }, "<leader>eti", function()
                local config = vim.fn.stdpath("config")

                local filetype = vim.o.filetype

                if filetype == '' then
                    return
                end

                vim.cmd.edit(config .. "/after/queries/" .. filetype .. '/injections.scm')
            end)

            vim.api.nvim_create_autocmd({ 'CursorHold' }, {
                group = group,
                pattern = "*",
                callback = function()
                    local prev_filetype = vim.b.treesitter_prev_filetype

                    local line = vim.fn.line('.')

                    local ok, parser = pcall(vim.treesitter.get_parser)

                    if not ok or not parser then
                        return
                    end

                    if not vim.b.treesitter_full_buffer_parse then
                        local parse_ok = pcall(parser.parse, parser, true)
                        if not parse_ok then
                            return
                        end
                        vim.b.treesitter_full_buffer_parse = true
                    end

                    local lang_ok, lang_tree = pcall(parser.language_for_range, parser, {line, 0, line, 0})
                    if not lang_ok or not lang_tree then
                        return
                    end
                    local filetype = lang_tree:lang()

                    if filetype ~= prev_filetype then
                        vim.b.treesitter_prev_filetype = filetype
                        vim.api.nvim_exec_autocmds("User", {
                            pattern = "TreesitterEmbeddedFileType",
                            data = {
                                filetype = filetype
                            }
                        })
                    end
                end,
            })
        end,
        extra_contexts = {"vscode", "firenvim", "ssh"},
        lazy = false,
    },
    {

        "cshuaimin/ssr.nvim",
        main = "ssr",
        -- Calling setup is optional.
        keys = {
            {
                "<leader>ssr",
                function() require("ssr").open() end,
                { desc = "[S]tructural Replace [T]reesitter" },
            }
        },
        opts = {
            border = "rounded",
            min_width = 50,
            min_height = 5,
            max_width = 120,
            max_height = 25,
            adjust_window = true,
            keymaps = {
                close = "q",
                next_match = "n",
                prev_match = "N",
                replace_confirm = "<cr>",
                replace_all = "<leader><cr>",
            },
        }
    },

    -- NOTE: RRethy/nvim-treesitter-textsubjects was dropped in the master->main
    -- migration (it needs master-only modules and has no `main` branch). Its
    -- <cr> expand + <bs> shrink behavior is reimplemented locally on builtin
    -- vim.treesitter -- see lua/textsubjects_shim.lua (wired up in the
    -- nvim-treesitter config above) and the vendored queries/*/textsubjects-smart.scm.
}
