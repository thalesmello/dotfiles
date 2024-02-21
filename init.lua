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
    { 'tpope/vim-commentary' },
    { 'tpope/vim-flagship', config = function()
        require('config/flagship_config')
    end},
    { 'ryanoasis/vim-devicons', config = function ()
        require('config/devicons_config')
    end },
    { 'romainl/Apprentice',
        priority = 1000,
        config = function ()
            -- Sets the colorscheme for terminal sessions too.
            vim.opt.background = "dark"
            vim.cmd.colorscheme("apprentice")
        end },
    { 'tpope/vim-scriptease' },
    { 'tpope/vim-projectionist', config = function()
        require('config/projectionist_config')
    end},
    { 'tpope/vim-tbone', config = function()
        require('config/tbone_config')
    end},
    { 'justinmk/vim-dirvish',
        commit= '2e845b6352ff43b47be2b2725245a4cba3e34da1',
        config = function()
            require('config/dirvish_config')
        end},
    { 'tpope/vim-eunuch' },
    { 'thalesmello/tabfold' },
    { 'tpope/vim-fugitive', config = function()
        require('config/fugitive_config')
        require('config/fugitive_gitlab_config')
    end},
    { 'kylechui/nvim-surround', config = function()
        require('config/surround_config')
    end},
    { 'tpope/vim-repeat' },
    { 'tpope/vim-abolish' },
    { 'tweekmonster/local-indent.vim' },
    { 'tpope/vim-sleuth' },
    { 'dag/vim-fish' },
    { 'airblade/vim-gitgutter', config = function()
        require('config/gitgutter_config')
    end},
    { 'peterrincker/vim-argumentative' },
    { 'sheerun/vim-polyglot', init = function()
        require('config/polyglot_config')
    end},
    {
        'tpope/vim-endwise',
        dependencies = {
            -- Run autopairs before endwise so both of them work get to hook <cr> in insert mode
            {"windwp/nvim-autopairs", opts = {}}
        }
    },
    { 'ludovicchabant/vim-gutentags', init = function()
        require('config/gutentags_config')
    end},
    { 'thalesmello/gitignore' },
    { 'tpope/vim-rsi' },
    { 'thalesmello/vim-trailing-whitespace' },
    { 'tpope/vim-unimpaired' },
    { 'simeji/winresizer', init = function()
        require('config/winresizer_config')
    end},
    { 'honza/vim-snippets' },
    { 'junegunn/fzf.vim',
        dependencies = { 'junegunn/fzf' },
        config = function()
            require('config/fzf_config')
        end},
    { 'tmux-plugins/vim-tmux-focus-events', tag = 'v1.0.0' },
    { 'ConradIrwin/vim-bracketed-paste' },
    { 'thalesmello/tabmessage.vim' },
    { 'thalesmello/persistent.vim' },
    { 'thinca/vim-visualstar' },
    { 'farmergreg/vim-lastplace' },
    { 'duggiefresh/vim-easydir' },
    { 'tmux-plugins/vim-tmux' },
    { 'sainnhe/tmuxline.vim', config = function()
        require('config/tmuxline_config')
    end},
    { 'moll/vim-node' },
    { 'ggandor/leap.nvim', config = function()
        require('config/leap_config')
    end},
    { 'machakann/vim-highlightedyank', config = function()
        require('config/highlightedyank_config')
    end},
    { 'thalesmello/python-support.nvim',
        build = function ()
            vim.cmd.PythonSupportInitPython3()
        end,
        init = function()
            require('config/python_support_config')
        end},

    -- { 'wellle/tmux-complete.vim' },
    -- { 'thalesmello/webcomplete.vim', cond = vim.fn.has('macunix' ) },
    { 'liuchengxu/vista.vim', init = function()
        require('config/vista_config')
    end},

    -- Python dependencies,
    { 'pseewald/vim-anyfold', init = function()
        require('config/anyfold_config')
    end },

    -- Text objects,
    {
        'kana/vim-textobj-user',
        name = 'textobj',
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
        config = function() require('config/textobject_config') end,
    },

    {
        'coderifous/textobj-word-column.vim',
        init = function() require('config/textobjectcolumn_config') end,
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
            require('config/dispatch_config')
        end,
    },
    { 'tpope/vim-haystack' },


    { 'tpope/vim-apathy' },
    { 'yssl/QFEnter' },

    { 'thalesmello/lkml.vim' },
    { 'junegunn/vim-easy-align', config = function()
        require('config/easyalign_config')
    end},

    { 'dzeban/vim-log-syntax' },
    { 'alvan/vim-closetag' },
    { 'tpope/vim-rhubarb' },

    { 'andymass/vim-matchup' },

    { 'tpope/vim-jdaddy' },
    { 'AndrewRadev/undoquit.vim', config = function()
        require('config/undoquit_config')
    end},
    { 'AndrewRadev/inline_edit.vim', config = function()
        require('config/inline_edit_config')
    end},
    { 'google/vim-jsonnet' },

    { 'hashivim/vim-terraform', config = function()
        require('config/terraform_config')
    end},

    { 'glacambre/firenvim',
        build = function ()
            vim.fn['firenvim#install'](0)
        end,
        config = function()
            require('config/firenvim_config')
        end},

    { 'AndrewRadev/linediff.vim' },

    -- Default restructured text syntax doesn't work well,
    { 'marshallward/vim-restructuredtext' },
    { 'mattboehm/vim-unstack', config = function()
        require('config/unstack_config')
    end},

    { 'AndrewRadev/splitjoin.vim', config = function()
        require('config/splitjoin_config')
    end},
    {
        'nvim-treesitter/nvim-treesitter',
        build = function ()
            vim.cmd('TSUpdate')
        end,
        dependencies = {
            'nvim-treesitter/nvim-treesitter-textobjects',
            'nvim-treesitter/nvim-treesitter-context',
        },
        config = function ()
            require('config/treesitter_config')
        end

    },
    { 'Wansmer/treesj',
        dependencies = { 'nvim-treesitter/nvim-treesitter' },
        config = function()
            require('config/treesj_config')
        end},
    { 'shumphrey/fugitive-gitlab.vim' },
    { 'ivanovyordan/dbt.vim' },

    { 'neovim/nvim-lspconfig', dependencies = { 'folke/neodev.nvim' } },
    { 'williamboman/mason.nvim' },
    {
        'williamboman/mason-lspconfig.nvim',
        dependencies = {
            'neovim/nvim-lspconfig',
            'williamboman/mason.nvim'
        },
    },
    { 'hrsh7th/nvim-cmp' },
    { 'hrsh7th/cmp-nvim-lsp', dependencies = { 'hrsh7th/nvim-cmp' } },
    { 'dcampos/nvim-snippy', config = function ()
        local config = vim.fn.stdpath("config")
        vim.keymap.set("n", "<leader>esp", function ()
            if vim.fn.expand("%:e") == '' then
                return
            end

            vim.cmd.edit(config .. "/snippets/" .. vim.fn.expand("%:e") .. '.snippets')
            vim.bo.filetype = "snippets"
        end)
    end },
    { 'dcampos/cmp-snippy', dependencies = { 'dcampos/nvim-snippy' } },
    { 'rafamadriz/friendly-snippets' },
    { 'folke/neodev.nvim', config = true },
    {
        'ThePrimeagen/refactoring.nvim',
        dependencies = {
            "nvim-lua/plenary.nvim",
            "nvim-treesitter/nvim-treesitter",
        },
        config = true,
    },
    { 'hrsh7th/cmp-buffer', dependencies = { 'hrsh7th/nvim-cmp' } },
    { 'hrsh7th/cmp-path', dependencies = { 'hrsh7th/nvim-cmp' } },
    { 'hrsh7th/cmp-cmdline', dependencies = { 'hrsh7th/nvim-cmp' } },
    { 'winston0410/range-highlight.nvim', dependencies = { 'winston0410/cmd-parser.nvim' }, config = true },
    { 'xiyaowong/nvim-cursorword' },
    { "ray-x/lsp_signature.nvim" },
    { 'folke/which-key.nvim', opts = {} },
    {
        "folke/trouble.nvim",
        dependencies = { "nvim-tree/nvim-web-devicons" },
        opts = {},
    },
    { "lukas-reineke/indent-blankline.nvim", main = "ibl", opts = {
        scope = {
            enabled = true,
            show_start = false,
            show_end = false,
            injected_languages = true,
            highlight = { "Function", "Label" },
            priority = 500,
        }
    } },
    {

        "cshuaimin/ssr.nvim",
        main = "ssr",
        -- Calling setup is optional.
        config = function()
            require("ssr").setup {
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

            vim.keymap.set("n", "<leader>sr", function()
                require("ssr").open()
            end, { desc = "[S]tructural [R]eplace" })
        end

    },
})

require('config/settings')
require('config/mappings')
require('config/clipboard_config')
require('config/jk_jumps_config')
require('config/neovimterminal_config')
require('config/quickfix_remove')


require('config/lsp_config')


