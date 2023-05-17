"/ OriginalAuthor: Pedro Franceschi <pedrohfranceschi@gmail.com>
" ModifiedVersion: Thales Mello <!-- <thalesmello@gmail.com> -->
" Source: http://github.com/thalesmello/vimfiles


" Polyglot disabled configs should load before any syntax is loaded
let g:polyglot_disabled = ["autoindent"]

call plug#begin()
Plug 'tpope/vim-commentary'
Plug 'tpope/vim-flagship'
Plug 'kana/vim-textobj-user'
Plug 'ryanoasis/vim-devicons'
Plug 'romainl/Apprentice'
Plug 'tpope/vim-scriptease'
Plug 'tpope/vim-projectionist'
Plug 'tpope/vim-tbone'
Plug 'justinmk/vim-dirvish', {'commit': '2e845b6352ff43b47be2b2725245a4cba3e34da1'}
Plug 'tpope/vim-eunuch'
Plug 'thalesmello/tabfold'
Plug 'tpope/vim-fugitive'
Plug 'tpope/vim-surround'
Plug 'tpope/vim-repeat'
Plug 'tpope/vim-abolish'
Plug 'tweekmonster/local-indent.vim'
Plug 'tpope/vim-sleuth'
Plug 'dag/vim-fish'
Plug 'airblade/vim-gitgutter'
Plug 'peterrincker/vim-argumentative'
Plug 'sheerun/vim-polyglot'
Plug 'tpope/vim-endwise'
Plug 'ludovicchabant/vim-gutentags', only#if(v:version >= 704)
Plug 'thalesmello/gitignore'
Plug 'tpope/vim-rsi'
Plug 'thalesmello/vim-trailing-whitespace'
Plug 'tpope/vim-unimpaired'
Plug 'simeji/winresizer'
Plug 'honza/vim-snippets'
Plug 'junegunn/fzf'
Plug 'junegunn/fzf.vim'
Plug 'tmux-plugins/vim-tmux-focus-events', { 'tag': 'v1.0.0' }
Plug 'ConradIrwin/vim-bracketed-paste'
Plug 'thalesmello/tabmessage.vim'
Plug 'thalesmello/persistent.vim'
Plug 'thinca/vim-visualstar'
Plug 'farmergreg/vim-lastplace'
Plug 'duggiefresh/vim-easydir'
Plug 'tmux-plugins/vim-tmux'
Plug 'sainnhe/tmuxline.vim'
Plug 'moll/vim-node'
Plug 'justinmk/vim-sneak'
Plug 'machakann/vim-highlightedyank'
Plug 'thalesmello/python-support.nvim'

" Coc.nvim
Plug 'neoclide/coc.nvim', { 'branch': 'release' }
Plug 'Shougo/neco-vim'
Plug 'neoclide/coc-neco'
Plug 'wellle/tmux-complete.vim'
Plug 'thalesmello/webcomplete.vim', only#if(has('macunix'))
Plug 'liuchengxu/vista.vim'

" Python dependencies
Plug 'pseewald/vim-anyfold'

" Text objects
Plug 'michaeljsmith/vim-indent-object'
Plug 'coderifous/textobj-word-column.vim'
Plug 'thalesmello/vim-textobj-methodcall'
Plug 'glts/vim-textobj-comment'
Plug 'Julian/vim-textobj-variable-segment'
Plug 'kana/vim-textobj-entire'
Plug 'thalesmello/vim-textobj-bracketchunk'

Plug 'kana/vim-textobj-function'
Plug 'rhysd/vim-textobj-ruby'
Plug 'bps/vim-textobj-python'
Plug 'haya14busa/vim-textobj-function-syntax'
Plug 'thinca/vim-textobj-function-javascript'
Plug 'thalesmello/vim-textobj-multiline-str'


Plug 'tpope/vim-dispatch'
Plug 'tpope/vim-haystack'


Plug 'tpope/vim-apathy'
Plug 'yssl/QFEnter'

Plug 'thalesmello/lkml.vim'
Plug 'junegunn/vim-easy-align'

Plug 'dzeban/vim-log-syntax'
Plug 'alvan/vim-closetag'
Plug 'tpope/vim-rhubarb'

Plug 'andymass/vim-matchup'

Plug 'tpope/vim-jdaddy'
Plug 'AndrewRadev/undoquit.vim'
Plug 'AndrewRadev/inline_edit.vim'
Plug 'google/vim-jsonnet'

Plug 'hashivim/vim-terraform'

Plug 'glacambre/firenvim', { 'do': { _ -> firenvim#install(0) } }

Plug 'AndrewRadev/linediff.vim'

" Default restructured text syntax doesn't work well
Plug 'marshallward/vim-restructuredtext'
Plug 'mattboehm/vim-unstack'

Plug 'AndrewRadev/splitjoin.vim'
Plug 'nvim-treesitter/nvim-treesitter', {'do': 'TSUpdate'}
Plug 'Wansmer/treesj'
Plug 'shumphrey/fugitive-gitlab.vim'

call plug#end()

let mapleader = "\<space>"
let maplocalleader = "'"
let g:my_colorscheme = "apprentice"
