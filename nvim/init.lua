-- OriginalAuthor: Pedro Franceschi <pedrohfranceschi@gmail.com>
-- ModifiedVersion: Thales Mello <!-- <thalesmello@gmail.com> -->
-- Source: http://github.com/thalesmello/vimfiles


-- Polyglot disabled configs should load before any syntax is loaded
vim.g.mapleader = " "
vim.g.maplocalleader = "'"
vim.g.my_colorscheme = "apprentice"

local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
    vim.fn.system({
        "git",
        "clone",
        "--filter=blob:none",
        "https://github.com/folke/lazy.nvim.git",
        "--branch=stable", -- latest stable release
        lazypath,
    })
end
vim.opt.rtp:prepend(lazypath)

---@type string
require("lazy").setup({
    {
        'tpope/vim-commentary',
        keys = {
            {"gc", mode = {"n", "v"}},
        },
        cmd = "Commentary",
    },
    {
        'tpope/vim-flagship',
        dependencies = {
            {
                'ryanoasis/vim-devicons',
                init = function ()
                    vim.g.webdevicons_enable_flagship_statusline = 0
                    vim.g.webdevicons_enable_flagship_statusline_fileformat_symbols = 0
                end,
            }
        },
        config = function() require('config/flagship') end,
    },
    {
        'romainl/Apprentice',
        priority = 1000,
        config = function ()
            -- Sets the colorscheme for terminal sessions too.
            vim.opt.background = "dark"
            vim.cmd.colorscheme("apprentice")
        end
    },
    {
        'tpope/vim-scriptease',
        keys = {"g="},
        ft = {"vim", "help"},
        cmd = {
            "Messages",
            "PP",
            "Scriptnames",
            "Verbose",
        },
    },
    {
        'thalesmello/vim-projectionist',
        dependencies = {
            { 'tpope/vim-haystack' },
        },
        config = function() require('config/projectionist') end,
    },
    {
        'tpope/vim-tbone',
        config = function() require('config/tbone') end,
        cond = vim.env.TMUX,
    },
    {
        'justinmk/vim-dirvish',
        commit= '2e845b6352ff43b47be2b2725245a4cba3e34da1',
        config = function()
            require('config/dirvish')
        end,
    },
    {
        'tpope/vim-eunuch',
        event = 'VeryLazy',
    },
    {
        'thalesmello/tabfold',
        keys = {"<tab>", "<s-tab>"}
    },
    {
        'tpope/vim-fugitive',
        dependencies = {
            { 'shumphrey/fugitive-gitlab.vim' },
            { 'tpope/vim-rhubarb' },
        },
        keys = {
            {"<leader>gd", "<cmd>Gdiffsplit<cr>",  noremap = true },
            {"<leader>gs", "<cmd>Git<cr>",  noremap = true },
            {"<leader>gw", "<cmd>Git write<cr>",  noremap = true },
            {"<leader>ga", "<cmd>Git add<cr>",  noremap = true },
            {"<leader>gb", "<cmd>Git blame<cr>",  noremap = true },
            {"<leader>gci", "<cmd>Git commit<cr>",  noremap = true },
            {"<leader>gm", "<cmd>Git move",  noremap = true },
            {"<leader>gr", "<cmd>Git read<cr>",  noremap = true },
            {"<leader>grm", "<cmd>Git remove<cr>",  noremap = true },
            {"<leader>gp", "<cmd>Git push<cr>",  noremap = true },
        },
        cmd = {"Git", "G", "Gdiffsplit", "GMove", "GBrowse"},
        config = function()
            vim.g.fugitive_gitlab_domains = { 'http://gitlab.platform' }
        end,
        lazy = false,
    },
    {
        'kylechui/nvim-surround',
        dependencies = {
            'nvim-treesitter/nvim-treesitter',
            'kana/vim-textobj-user',
        },
        config = function() require('config/surround') end,
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },
    { 'tpope/vim-repeat' },
    {
        'tpope/vim-abolish',
        keys = {"cr"},
        cmd = {"Abolish", "Subvert"},
    },
    {
        'tpope/vim-sleuth',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },
    {
        'dag/vim-fish',
        ft = {"fish"},
    },
    {
        'airblade/vim-gitgutter',
        config = function() require('config/gitgutter') end,
    },
    {
        "windwp/nvim-autopairs",
        opts = {
            fast_wrap = {
                map = '<c-g>g',
            },
        },
    },
    {
        'tpope/vim-endwise',
        dependencies = {
            -- Run autopairs before endwise so both of them work get to hook <cr> in insert mode
            {"windwp/nvim-autopairs"}
        },
    },
    {
        'ludovicchabant/vim-gutentags',
        init = function()
            vim.g.gutentags_ctags_exclude = { 'node_modules', '.git' }
        end,
    },
    { 'thalesmello/gitignore', event = "VeryLazy" },
    { 'tpope/vim-rsi', event = {"CmdlineEnter", "InsertEnter"} },
    {
        'johnfrankmorgan/whitespace.nvim',
        config = function ()
            require('whitespace-nvim').setup({
                -- configuration options and their defaults

                -- `highlight` configures which highlight is used to display
                -- trailing whitespace
                highlight = 'DiffDelete',

                -- `ignored_filetypes` configures which filetypes to ignore when
                -- displaying trailing whitespace
                ignored_filetypes = { 'TelescopePrompt', 'Trouble', 'help', 'qf' },

                -- `ignore_terminal` configures whether to ignore terminal buffers
                ignore_terminal = true,

                -- `return_cursor` configures if cursor should return to previous
                -- position after trimming whitespace
                return_cursor = true,
            })

            -- remove trailing whitespace with a keybinding
            vim.keymap.set('n', '<Leader>fw', require('whitespace-nvim').trim)
        end,
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },
    { 'tpope/vim-unimpaired', event = "VeryLazy" },
    {
        'simeji/winresizer',
        keys = {
            {"<leader>H", '<leader>wrH', remap = true},
            {"<leader>J", '<leader>wrJ', remap = true},
            {"<leader>K", '<leader>wrK', remap = true},
            {"<leader>L", '<leader>wrL', remap = true},
        },
        init = function()
            vim.g.winresizer_start_key = '<leader>wr'
            vim.g.winresizer_keycode_left = 72
            vim.g.winresizer_keycode_right = 76
            vim.g.winresizer_keycode_down = 74
            vim.g.winresizer_keycode_up = 75
        end
    },
    {
        'junegunn/fzf.vim',
        dependencies = { 'junegunn/fzf', 'tpope/vim-projectionist' },
        keys = {
            {"<c-p>", mode = "n"},
            {"<c-p>", mode = "v"},
            {"<c-f>", mode = "n"},
            {"<leader>/", mode = "n"},
            {"<leader>/", mode = "v"},
            {"<leader>?", mode = "v"},
            {"<leader>ft", mode = "n"},
        },
        cmd = {
            "Files", "GFiles", "GFiles", "Buffers", "Colors", "Ag", "Rg",
            "RG", "Lines", "BLines", "Tags", "BTags", "Changes", "Marks", "Jumps",
            "Windows", "Locate", "History", "", "History", "Snippets", "Commits",
            "BCommits", "Commands", "Maps", "Helptags", "Filetypes"
        },
        config = function()
            require('config/fzf')
        end,
    },
    {
        'tmux-plugins/vim-tmux-focus-events',
        tag = 'v1.0.0',
        event = "TermOpen",
        lazy = not vim.env.TMUX
    },
    { 'thalesmello/tabmessage.vim', cmd = "TabMessage" },
    {
        'thalesmello/persistent.vim',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },
    {
        'thinca/vim-visualstar',
        keys = {
            {"*", "<Plug>(visualstar-*)", mode = {"x"}},
            {"#", "<Plug>(visualstar-#)", mode = {"x"}},
        },
    },
    {
        'farmergreg/vim-lastplace',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },
    {
        'duggiefresh/vim-easydir',
        event = {"BufWritePre", "FileWritePre"},
    },
    { 'tmux-plugins/vim-tmux', ft = "tmux" },
    {
        'sainnhe/tmuxline.vim',
        config = function() require('config/tmuxline') end,
        cmd = {
            "Tmuxline",
            "TmuxlineSnapshot",
        }
    },
    { 'moll/vim-node', ft = {"javascript", "json", "jsx"} },
    {
        'ggandor/leap.nvim',
        dependencies = {
            'ggandor/leap-spooky.nvim',
        },
        config = function()
            require('config/leap')
        end,
        keys = {
            {"s", "<Plug>(leap-forward)", mode = { "n" }, desc = "Leap forward to"},
            {"S", "<Plug>(leap-backward)", mode = { "n" }, desc = "Leap backward to"},
            {"gs", "<Plug>(leap-from-window)", mode = { "n" }, desc = "Leap from windows"},
            {"s", "<Plug>(leap-forward-to)", mode = { "x" }, desc = "Leap operator inclusive"},
            {"gs", "<Plug>(leap-backward-to)", mode = { "x" }, desc = "Leap backwards operator inclusive"},
            {"z", "<Plug>(leap-forward-to)", mode = { "o" }, desc = "Leap operator inclusive"},
            {"Z", "<Plug>(leap-backward-to)", mode = { "o" }, desc = "Leap backwards operator inclusive"},
            {"x", "<Plug>(leap-forward-till)", mode = { "o" }, desc = "Leap operator non-inclusive"},
            {"X", "<Plug>(leap-backward-till)", mode = { "o" }, desc = "Leap backwards operator inclusive"},
        },
    },
    {
        'machakann/vim-highlightedyank',
        config = function() require('config/highlightedyank') end,
        event = "TextYankPost",
    },
    {
        'thalesmello/python-support.nvim',
        build = function()
            vim.cmd.PythonSupportInitPython3()
        end,
        init = function()
            require('config/python_support')
        end
    },

    -- { 'wellle/tmux-complete.vim' },
    -- { 'thalesmello/webcomplete.vim', cond = vim.fn.has('macunix' ) },
    {
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
    },

    -- Text objects,
    {
        'kana/vim-textobj-user',
        dependencies = {
            { 'michaeljsmith/vim-indent-object' },
            { 'thalesmello/vim-textobj-methodcall' },
            { 'glts/vim-textobj-comment' },
            { 'Julian/vim-textobj-variable-segment' },
            { 'kana/vim-textobj-entire' },
            { 'thalesmello/vim-textobj-bracketchunk' },
            -- Only works vim treesitter syntax, doesn't work with Tree sitter yet
            -- { 'thalesmello/vim-textobj-multiline-str' },
        },
    },

    {
        'coderifous/textobj-word-column.vim',
        init = function() require('config/textobjectcolumn') end,
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },

    -- {
    --     'wellle/targets.vim',
    --     config = function ()
    --         vim.g.targets_seekRanges = 'cc cr cb cB lc ac Ac lr lb ar ab lB Ar aB Ab AB rr ll rb al rB Al bb aa bB Aa BB AA'

    --         vim.api.nvim_create_autocmd("User", {
    --             group = vim.api.nvim_create_augroup("TargetsAuGroup", { clear = true }),
    --             pattern = "targets#mappings#user",
    --             callback = function ()
    --                 vim.fn['targets#mappings#extend']({
    --                     [":"] = vim.empty_dict(),
    --                     [";"] = vim.empty_dict(),
    --                 })
    --             end
    --         })
    --     end,
    -- },
    {
        'echasnovski/mini.ai',
        version = false,
        config = function()
            require('mini.ai').setup({
                custom_textobjects = {},
                search_method = "cover"

            })

            local group = vim.api.nvim_create_augroup("MiniAiBufferGroup", { clear = true })

            vim.api.nvim_create_autocmd({ 'FileType' }, {
                group = group,
                pattern = {"sql", "jinja"},
                callback = function()

                    local spec_pair = require('mini.ai').gen_spec.pair
                    vim.b.miniai_config = {
                        custom_textobjects = {
                            ['<c-]>'] = spec_pair('{{', '}}'),
                            ['%'] = spec_pair('{%', '%}'),
                            ['-'] = spec_pair('{%-', '-%}'),
                            ['#'] = spec_pair('{#', '#}'),
                            ['\\'] = { "}()().-()(){" },
                        },
                    }
                end,
            })
        end,
    },
    {
        'tpope/vim-dispatch',
        config = function()
            require('config/dispatch')
        end,
    },
    {
        'tpope/vim-apathy',
        ft = {
            'c',
            'coffee',
            'csh',
            'desktop',
            'dosbatch',
            'go',
            'javascript',
            'javascriptreact',
            'lua',
            'python',
            'ruby',
            'scheme',
            'sh',
            'typescript',
            'typescriptreact',
            'zsh',
        }
    },
    { 'yssl/QFEnter', event = "QuickFixCmdPre" },
    { 'thalesmello/lkml.vim', ft = 'lkml' },
    {
        'junegunn/vim-easy-align',
        config = function()
            require('config/easyalign')
        end,
        keys = {
            {"ga", "<Plug>(EasyAlign)", mode = {"n", "x"}}
        },
        cmd = {"EasyAlign"}
    },
    { 'dzeban/vim-log-syntax', ft = "log" },
    { 'alvan/vim-closetag' },
    {
        'AndrewRadev/undoquit.vim',
        keys = {"<leader>T"},
        cmd = {"Undoquit"},
        config = function()
            vim.g.undoquit_mapping = '<leader>T'
        end,
    },
    {
        'AndrewRadev/inline_edit.vim',
        keys = {
            {'<leader>ie',  '<cmd>InlineEdit<cr>',  silent = true},
            {'<leader>ie', ':InlineEdit<space>""<left>', remap = true, mode = "x"}
        },
        cmd = "InlineEdit",
    },
    { 'google/vim-jsonnet', ft = "jsonnet" },

    {
        'hashivim/vim-terraform',
        config = function()
            require('config/terraform')
        end,
        ft = "terraform",
    },
    {
        'glacambre/firenvim',
        build = function ()
            vim.fn['firenvim#install'](0)
        end,
        config = function()
            require('config/firenvim')
        end,
        cond = vim.g.started_by_firenvim,
    },

    { 'AndrewRadev/linediff.vim', cmd = {"Linediff", "LinediffMerge"} },
    { 'marshallward/vim-restructuredtext', ft = "rst" },
    {
        'mattboehm/vim-unstack',
        keys = {"<leader>st"},
        cmd = {
            'UnstackFromText',
            'UnstackFromClipboard',
            'UnstackFromSelection',
            'UnstackFromTmux',
        },
        config = function()
            vim.g.unstack_mapkey = "<leader>st"
            vim.g.unstack_populate_quickfix = 1
        end
    },
    {
        'nvim-treesitter/nvim-treesitter',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
        build = function ()
            vim.cmd('TSUpdate')
        end,
        dependencies = {
            'nvim-treesitter/nvim-treesitter-textobjects',
            'nvim-treesitter/nvim-treesitter-context',
            'nvim-treesitter/playground',
            'andymass/vim-matchup',
        },
        config = function ()
            require('config/treesitter')
        end

    },
    {
        'AndrewRadev/splitjoin.vim',
        init = function()
            require('config/splitjoin')
        end,
    },
    {
        'Wansmer/treesj',
        dependencies = {
            'nvim-treesitter/nvim-treesitter',
            {
                'AndrewRadev/splitjoin.vim',
                init = function()
                    require('config/splitjoin')
                end,
            },
        },
        config = function()
            require('config/treesj')
        end,
        keys = { "gS", "gJ" },
        cmd = {"TSJSplit", "TSJJoin"}

    },
    {
        'lepture/vim-jinja',
        ft = "jinja",
    },
    {
        'ivanovyordan/dbt.vim',
        dependencies = {
            'lepture/vim-jinja'
        },
        ft = { "sql" },
        init = function()
            vim.g.omni_sql_no_default_maps = 1
        end,
    },
    {
        'neovim/nvim-lspconfig',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
        config = function ()
            require('config/lsp')
        end,
        dependencies = {
            { 'folke/neodev.nvim' },
            {
                'hrsh7th/nvim-cmp',
                dependencies = {
                    {'hrsh7th/cmp-nvim-lsp'},
                    {'hrsh7th/cmp-buffer'},
                    {'hrsh7th/cmp-path'},
                    {'hrsh7th/cmp-cmdline'},
                },
            },
            {
                'williamboman/mason.nvim',
                dependencies = {
                    'williamboman/mason-lspconfig.nvim',
                    {
                        "rshkarin/mason-nvim-lint",
                        dependencies = {
                            "mfussenegger/nvim-lint",
                            config = function()
                                require('lint').linters_by_ft = {
                                    python = { 'flake8' }
                                }

                                local group = vim.api.nvim_create_augroup("LintGroup", { clear = true })

                                vim.api.nvim_create_autocmd({ "BufEnter" }, {
                                  group = group,
                                  callback = function() require("lint").try_lint() end,
                                })

                                vim.api.nvim_create_autocmd({ "BufWritePost" }, {
                                  group = group,
                                  callback = function() require("lint").try_lint() end,
                                })
                            end

                        },
                        opts = {}
                    },
                    {
                        'mhartington/formatter.nvim',
                        config = function()
                            local util = require "formatter.util"

                            require("formatter").setup {
                                logging = true,
                                log_level = vim.log.levels.WARN,

                                filetype = {
                                    lua = {
                                        require("formatter.filetypes.lua").stylua,
                                    },

                                    python = {
                                        require("formatter.filetypes.python").black,
                                    },

                                    ["*"] = {
                                        require("formatter.filetypes.any").remove_trailing_whitespace,
                                    }
                                }
                            }
                        end

                    }
                },
            },
            { "ray-x/lsp_signature.nvim" },
            {
                'dcampos/nvim-snippy',
                keys = {
                    {"<leader>esp", function()
                        local config = vim.fn.stdpath("config")
                        if vim.fn.expand("%:e") == '' then
                            return
                        end

                        vim.cmd.edit(config .. "/snippets/" .. vim.fn.expand("%:e") .. '.snippets')
                        vim.bo.filetype = "snippets"
                    end}
                },
                dependencies = {
                    { 'dcampos/cmp-snippy' },
                    { 'rafamadriz/friendly-snippets' },
                    { 'honza/vim-snippets' },
                },
            },
        },
    },
    -- {
    --     'github/copilot.vim',
    --     enabled = false,
    --     cmd = {"Copilot"},
    --     event = "InsertEnter",
    --     config = function()
    --         vim.keymap.set('i', '<right>', 'copilot#Accept("\\<right>")', {
    --             expr = true,
    --             replace_keycodes = false
    --         })
    --         vim.g.copilot_no_tab_map = true
    --     end,
    --     dependencies = {
    --         {
    --             "CopilotC-Nvim/CopilotChat.nvim",
    --             opts = {
    --                 prompts = {
    --                     Explain = "Explain how it works by in simple terms.",
    --                     Review = "Review the following code and provide concise suggestions.",
    --                     Tests = "Briefly explain how the selected code works, then generate unit tests.",
    --                     Refactor = "Refactor the code to improve clarity and readability.",
    --                 },
    --             },
    --             build = function()
    --                 vim.notify("Please update the remote plugins by running ':UpdateRemotePlugins', then restart Neovim.")
    --             end,
    --         },
    --     }
    -- },
    {
        'ThePrimeagen/refactoring.nvim',
        dependencies = {
            "nvim-lua/plenary.nvim",
            "nvim-treesitter/nvim-treesitter",
        },
        opts = {},
        priority = 0,
    },
    -- { 'folke/which-key.nvim', opts = {}, event = 'VeryLazy', priority = 0 },
    {
        "folke/trouble.nvim",
        dependencies = { "nvim-tree/nvim-web-devicons" },
        cmd = {
            "Trouble",
            "TroubleClose",
            "TroubleToggle",
            "TroubleRefresh",
        },
    },
    {
        "lukas-reineke/indent-blankline.nvim",
        main = "ibl",
        opts = {
            scope = {
                enabled = true,
                show_start = false,
                show_end = false,
                injected_languages = true,
                highlight = { "Function", "Label" },
                priority = 500,
            },
        },
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },
    {

        "cshuaimin/ssr.nvim",
        main = "ssr",
        -- Calling setup is optional.
        keys = {
            {
                "<leader>sr",
                function() require("ssr").open() end,
                { desc = "[S]tructural [R]eplace" },
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
    {
        'thalesmello/vim-islime2',
        config = function()
            vim.g.islime2_29_mode = 1
        end,
        event = "VeryLazy",
    },
    { "stevearc/dressing.nvim", event = "VeryLazy" },
    { "PeterRincker/vim-argumentative" },
    -- {
    --     "anuvyklack/pretty-fold.nvim",
    --     -- event = "VeryLazy",
    --     config = function()
    --         local components = require('pretty-fold.components')
    --         require('pretty-fold').setup({
    --             -- fill_char = ' ',
    --             sections = {

    --                 left = {
    --                     function (config)
    --                         local content = components.content(config) ---@type string

    --                         if content:match(config.fill_char .. '*%s*{%.%.%.}') then
    --                             local line_num = vim.fn.nextnonblank(vim.v.foldstart + 1)
    --                             local next_line = vim.fn.trim(vim.fn.getline(line_num))
    --                             content = content:gsub('%.%.%.', next_line .. ' ...')
    --                         end

    --                         return content
    --                     end
    --                 },
    --                 right = {
    --                     ' ', 'number_of_folded_lines', ': ', 'percentage', ' ',
    --                     function(config) return config.fill_char:rep(3) end
    --                 }
    --             }
    --         })
    --         require('pretty-fold').ft_setup('lua', {
    --             matchup_patterns = {
    --                 { '^%s*do$', 'end' }, -- do ... end blocks
    --                 { '^%s*if', 'end' },  -- if ... end
    --                 { '^%s*for', 'end' }, -- for
    --                 { 'function%s*%(', 'end' }, -- 'function( or 'function (''
    --                 {  '{', '}' },
    --                 { '%(', ')' }, -- % to escape lua pattern char
    --                 { '%[', ']' }, -- % to escape lua pattern char
    --             },
    --         })
    --     end,
    -- }
})

require('config/settings')
require('config/mappings')
require('config/clipboard')
require('config/jk_jumps')
require('config/neovimterminal')
require('config/quickfix_remove')


require('config/smart_send_text')


vim.keymap.set("n", "<leader>ep", function ()
  local share = vim.fn.stdpath("data")
  vim.cmd.edit(share .. "/lazy/")
end, { noremap = true })
