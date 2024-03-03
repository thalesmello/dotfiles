-- OriginalAuthor: Pedro Franceschi <pedrohfranceschi@gmail.com>
-- ModifiedVersion: Thales Mello <!-- <thalesmello@gmail.com> -->
-- Source: http://github.com/thalesmello/vimfiles


-- Polyglot disabled configs should load before any syntax is loaded
vim.g.polyglot_disabled = {"autoindent"}
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
            'ryanoasis/vim-devicons'
        },
        config = function() require('config/flagship') end,
    },
    {
        'ryanoasis/vim-devicons',
        config = function () require('config/devicons') end,
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
    { 'tpope/vim-scriptease', event = "VeryLazy" },
    {
        'tpope/vim-projectionist',
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
            require('config/fugitive')
            vim.g.fugitive_gitlab_domains = { 'http://gitlab.platform' }
        end,
    },
    {
        'kylechui/nvim-surround',
        config = function() require('config/surround') end,
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },
    { 'tpope/vim-repeat' },
    { 'tpope/vim-abolish', event = "VeryLazy" },
    {
        'tpope/vim-sleuth',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },
    { 'dag/vim-fish' },
    {
        'airblade/vim-gitgutter',
        config = function() require('config/gitgutter') end,
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },
    { 'peterrincker/vim-argumentative' }, -- TODO: Check if can be replaced by treesitter-textobj
    {
        'sheerun/vim-polyglot',
        init = function() require('config/polyglot') end,
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
        }
    },
    { 'ludovicchabant/vim-gutentags', init = function()
        require('config/gutentags')
    end},
    { 'thalesmello/gitignore' },
    { 'tpope/vim-rsi', event = {"CmdlineEnter", "InsertEnter"} },
    {
        'thalesmello/vim-trailing-whitespace',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
    },
    { 'tpope/vim-unimpaired', event = "VeryLazy" },
    { 'simeji/winresizer', init = function()
        require('config/winresizer')
    end},
    {
        'junegunn/fzf.vim',
        dependencies = { 'junegunn/fzf', 'tpope/vim-projectionist' },
        config = function()
            require('config/fzf')
        end,
    },
    { 'tmux-plugins/vim-tmux-focus-events', tag = 'v1.0.0' },
    { 'ConradIrwin/vim-bracketed-paste', event = "VeryLazy" },
    { 'thalesmello/tabmessage.vim', cmd = "TabMessage" },
    { 'thalesmello/persistent.vim' },
    { 'thinca/vim-visualstar' },
    { 'farmergreg/vim-lastplace' },
    { 'duggiefresh/vim-easydir' },
    { 'tmux-plugins/vim-tmux' },
    {
        'sainnhe/tmuxline.vim',
        config = function() require('config/tmuxline') end,
        cmd = {
            "Tmuxline",
            "TmuxlineSnapshot",
        }
    },
    { 'moll/vim-node' },
    { 'ggandor/leap.nvim', config = function()
        require('config/leap')
    end},
    { 'machakann/vim-highlightedyank', config = function()
        require('config/highlightedyank')
    end},
    { 'thalesmello/python-support.nvim',
        build = function ()
            vim.cmd.PythonSupportInitPython3()
        end,
        init = function()
            require('config/python_support')
        end},

    -- { 'wellle/tmux-complete.vim' },
    -- { 'thalesmello/webcomplete.vim', cond = vim.fn.has('macunix' ) },
    { 'liuchengxu/vista.vim', init = function()
        require('config/vista')
    end},

    -- Python dependencies,
    { 'pseewald/vim-anyfold', init = function()
        require('config/anyfold')
    end },

    -- Text objects,
    {
        'kana/vim-textobj-user',
        name = 'textobj',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
        dependencies = {
            { 'michaeljsmith/vim-indent-object' },
            { 'thalesmello/vim-textobj-methodcall' },
            { 'glts/vim-textobj-comment' },
            { 'Julian/vim-textobj-variable-segment' },
            { 'kana/vim-textobj-entire' },
            { 'thalesmello/vim-textobj-bracketchunk' },
            { 'kana/vim-textobj-function' },
            { 'rhysd/vim-textobj-ruby' },
            { 'bps/vim-textobj-python' },
            { 'haya14busa/vim-textobj-function-syntax' },
            { 'thinca/vim-textobj-function-javascript' },
            { 'thalesmello/vim-textobj-multiline-str' },
        },
        config = function() require('config/textobject') end,
    },

    {
        'coderifous/textobj-word-column.vim',
        init = function() require('config/textobjectcolumn') end,
    },

    {
        'wellle/targets.vim',
        config = function ()
            vim.g.targets_seekRanges = 'cc cr cb cB lc ac Ac lr lb ar ab lB Ar aB Ab AB rr ll rb al rB Al bb aa bB Aa BB AA'
        end,
    },


    { 'ggandor/leap-spooky.nvim' },

    {
        'tpope/vim-dispatch',
        config = function()
            require('config/dispatch')
        end,
    },
    { 'tpope/vim-haystack' },


    { 'tpope/vim-apathy' },
    { 'yssl/QFEnter' },

    { 'thalesmello/lkml.vim' },
    { 'junegunn/vim-easy-align', config = function()
        require('config/easyalign')
    end},

    { 'dzeban/vim-log-syntax' },
    { 'alvan/vim-closetag' },
    {
        'andymass/vim-matchup',
        keys = {"%", mode = {"n", "o"}},
    },
    {
        'AndrewRadev/undoquit.vim',
        keys = {"<leader>T"},
        config = function()
            require('config/undoquit')
        end,
    },
    { 'AndrewRadev/inline_edit.vim', config = function()
        require('config/inline_edit')
    end},
    { 'google/vim-jsonnet' },

    { 'hashivim/vim-terraform', config = function()
        require('config/terraform')
    end},

    { 'glacambre/firenvim',
        build = function ()
            vim.fn['firenvim#install'](0)
        end,
        config = function()
            require('config/firenvim')
        end},

    { 'AndrewRadev/linediff.vim' },

    -- Default restructured text syntax doesn't work well,
    { 'marshallward/vim-restructuredtext' },
    { 'mattboehm/vim-unstack', config = function()
        require('config/unstack')
    end},

    { 'AndrewRadev/splitjoin.vim', config = function()
        require('config/splitjoin')
    end},
    {
        'nvim-treesitter/nvim-treesitter',
        event = { "BufReadPost", "BufNewFile", "BufFilePost" },
        build = function ()
            vim.cmd('TSUpdate')
        end,
        dependencies = {
            'nvim-treesitter/nvim-treesitter-textobjects',
            'nvim-treesitter/nvim-treesitter-context',
        },
        config = function ()
            require('config/treesitter')
        end

    },
    { 'Wansmer/treesj',
        dependencies = { 'nvim-treesitter/nvim-treesitter' },
        config = function()
            require('config/treesj')
        end,
        keys = { "gS", "gJ" },
        cmd = {"TSJSplit", "TSJJoin"}

    },
    { 'ivanovyordan/dbt.vim', ft = { "python", "sql" } },
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
                    'williamboman/mason-lspconfig.nvim'
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
            {
                'github/copilot.vim',
                event = "InsertEnter",
                dependencies = {
                    {
                        "CopilotC-Nvim/CopilotChat.nvim",
                        opts = {
                            prompts = {
                                Explain = "Explain how it works by in simple terms.",
                                Review = "Review the following code and provide concise suggestions.",
                                Tests = "Briefly explain how the selected code works, then generate unit tests.",
                                Refactor = "Refactor the code to improve clarity and readability.",
                            },
                        },
                        build = function()
                            vim.notify("Please update the remote plugins by running ':UpdateRemotePlugins', then restart Neovim.")
                        end,
                        event = "VeryLazy",
                    },

                }
            },
        },
    },
    {
        'ThePrimeagen/refactoring.nvim',
        dependencies = {
            "nvim-lua/plenary.nvim",
            "nvim-treesitter/nvim-treesitter",
        },
        opts = {},
        cmd = {"Refactor"}
    },
    {
        'winston0410/range-highlight.nvim',
        dependencies = { 'winston0410/cmd-parser.nvim' },
        opts = {},
    },
    { 'folke/which-key.nvim', opts = {} },
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
        event = "VeryLazy"
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
        config = function ()
            vim.g.islime2_29_mode=1
        end,
        event = "VeryLazy",
    },
    { "stevearc/dressing.nvim", event = "VeryLazy" },
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


