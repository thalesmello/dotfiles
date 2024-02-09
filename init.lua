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

require("lazy").setup({
    { dir = vim.fn.stdpath('config'), name = "local_config", priority = 100 },
    { 'tpope/vim-commentary' },
    { 'tpope/vim-flagship' },
    { 'kana/vim-textobj-user', name = 'textobj' },
    { 'ryanoasis/vim-devicons' },
    { 'romainl/Apprentice' },
    { 'tpope/vim-scriptease' },
    { 'tpope/vim-projectionist' },
    { 'tpope/vim-tbone' },
    { 'justinmk/vim-dirvish', commit= '2e845b6352ff43b47be2b2725245a4cba3e34da1' },
    { 'tpope/vim-eunuch' },
    { 'thalesmello/tabfold' },
    { 'tpope/vim-fugitive' },
    { 'kylechui/nvim-surround' },
    { 'tpope/vim-repeat' },
    { 'tpope/vim-abolish' },
    { 'tweekmonster/local-indent.vim' },
    { 'tpope/vim-sleuth' },
    { 'dag/vim-fish' },
    { 'airblade/vim-gitgutter' },
    { 'peterrincker/vim-argumentative' },
    { 'sheerun/vim-polyglot' },
    { 'tpope/vim-endwise' },
    { 'ludovicchabant/vim-gutentags' },
    { 'thalesmello/gitignore' },
    { 'tpope/vim-rsi' },
    { 'thalesmello/vim-trailing-whitespace' },
    { 'tpope/vim-unimpaired' },
    { 'simeji/winresizer' },
    { 'honza/vim-snippets' },
    { 'junegunn/fzf' },
    { 'junegunn/fzf.vim' },
    { 'tmux-plugins/vim-tmux-focus-events', tag = 'v1.0.0' },
    { 'ConradIrwin/vim-bracketed-paste' },
    { 'thalesmello/tabmessage.vim' },
    { 'thalesmello/persistent.vim' },
    { 'thinca/vim-visualstar' },
    { 'farmergreg/vim-lastplace' },
    { 'duggiefresh/vim-easydir' },
    { 'tmux-plugins/vim-tmux' },
    { 'sainnhe/tmuxline.vim' },
    { 'moll/vim-node' },
    { 'ggandor/leap.nvim' },
    { 'machakann/vim-highlightedyank' },
    { 'thalesmello/python-support.nvim' },

    -- Coc.nvim,
    { 'neoclide/coc.nvim', branch = 'release'  },
    { 'Shougo/neco-vim' },
    { 'neoclide/coc-neco' },
    { 'wellle/tmux-complete.vim' },
    { 'thalesmello/webcomplete.vim', cond = vim.fn.has('macunix' ) },
    { 'liuchengxu/vista.vim' },

    -- Python dependencies,
    { 'pseewald/vim-anyfold' },

    -- Text objects,
    { 'michaeljsmith/vim-indent-object', dependencies = {'textobj'} },
    { 'coderifous/textobj-word-column.vim' , dependencies = {'textobj'} },
    { 'thalesmello/vim-textobj-methodcall' , dependencies = {'textobj'} },
    { 'glts/vim-textobj-comment' , dependencies = {'textobj'} },
    { 'Julian/vim-textobj-variable-segment' , dependencies = {'textobj'} },
    { 'kana/vim-textobj-entire' , dependencies = {'textobj'} },
    { 'thalesmello/vim-textobj-bracketchunk' , dependencies = {'textobj'} },
    { 'wellle/targets.vim' , dependencies = {'textobj'} },
    { 'ggandor/leap-spooky.nvim' },

    { 'kana/vim-textobj-function' , dependencies = {'textobj'} },
    { 'rhysd/vim-textobj-ruby' , dependencies = {'textobj'} },
    { 'bps/vim-textobj-python' , dependencies = {'textobj'} },
    { 'haya14busa/vim-textobj-function-syntax' , dependencies = {'textobj'} },
    { 'thinca/vim-textobj-function-javascript' , dependencies = {'textobj'} },
    { 'thalesmello/vim-textobj-multiline-str' , dependencies = {'textobj'} },


    { 'tpope/vim-dispatch' },
    { 'tpope/vim-haystack' },


    { 'tpope/vim-apathy' },
    { 'yssl/QFEnter' },

    { 'thalesmello/lkml.vim' },
    { 'junegunn/vim-easy-align' },

    { 'dzeban/vim-log-syntax' },
    { 'alvan/vim-closetag' },
    { 'tpope/vim-rhubarb' },

    { 'andymass/vim-matchup' },

    { 'tpope/vim-jdaddy' },
    { 'AndrewRadev/undoquit.vim' },
    { 'AndrewRadev/inline_edit.vim' },
    { 'google/vim-jsonnet' },

    { 'hashivim/vim-terraform' },

    { 'glacambre/firenvim',
        build = function ()
            vim.fn['firenvim#install'](0)
        end
    },

    { 'AndrewRadev/linediff.vim' },

    -- Default restructured text syntax doesn't work well,
    { 'marshallward/vim-restructuredtext' },
    { 'mattboehm/vim-unstack' },

    { 'AndrewRadev/splitjoin.vim' },
    {
        'nvim-treesitter/nvim-treesitter',
        build = function ()
            vim.cmd('TSUpdate')
        end

    },
    { 'Wansmer/treesj' },
    { 'shumphrey/fugitive-gitlab.vim' },
    { 'ivanovyordan/dbt.vim' },

    { 'cohama/lexima.vim' },
})
