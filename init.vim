"/ OriginalAuthor: Pedro Franceschi <pedrohfranceschi@gmail.com>
" ModifiedVersion: Thales Mello <!-- <thalesmello@gmail.com> -->
" Source: http://github.com/thalesmello/vimfiles

call plug#begin()
Plug 'tpope/vim-sensible', only#if(!has('nvim'))
Plug 'tpope/vim-commentary'
Plug 'tpope/vim-flagship'
Plug 'kana/vim-textobj-user'
" Plug 'SirVer/ultisnips', only#if(v:version >= 704)
Plug 'ryanoasis/vim-devicons'
Plug 'romainl/Apprentice'
Plug 'tpope/vim-scriptease'
Plug 'tpope/vim-projectionist'
Plug 'tpope/vim-tbone'
Plug 'justinmk/vim-dirvish'
Plug 'tpope/vim-eunuch'
Plug 'thalesmello/tabfold'
Plug 'tpope/vim-fugitive'
Plug 'tpope/vim-surround'
Plug 'nelstrom/vim-markdown-folding'
Plug 'tpope/vim-repeat'
Plug 'tpope/vim-abolish'
Plug 'tweekmonster/local-indent.vim'
Plug 'scrooloose/nerdtree', { 'on': ['NERDTreeToggle', 'NERDTreeFind'] }
Plug 'tpope/vim-sleuth'
Plug 'dag/vim-fish'
Plug 'airblade/vim-gitgutter'
Plug 'peterrincker/vim-argumentative'
Plug 'sheerun/vim-polyglot'
Plug 'tpope/vim-endwise'
Plug 'ludovicchabant/vim-gutentags', only#if(v:version >= 704)
Plug 'thalesmello/gitignore'
Plug 'tpope/vim-rsi'
Plug 'fatih/vim-go'
Plug 'bronson/vim-trailing-whitespace'
Plug 'tpope/vim-unimpaired'
Plug 'simnalamburt/vim-mundo'
Plug 'simeji/winresizer'
Plug 'honza/vim-snippets'
Plug 'AndrewRadev/splitjoin.vim'
Plug 'junegunn/fzf'
Plug 'junegunn/fzf.vim'
Plug 'tmux-plugins/vim-tmux-focus-events', { 'tag': 'v1.0.0' }
Plug 'ConradIrwin/vim-bracketed-paste', only#if(!has('nvim'))
Plug 'thalesmello/tabmessage.vim'
Plug 'thalesmello/persistent.vim'
Plug 'thinca/vim-visualstar'
Plug 'dietsche/vim-lastplace'
Plug 'duggiefresh/vim-easydir'
Plug 'tmux-plugins/vim-tmux'
Plug 'sainnhe/tmuxline.vim'
Plug 'moll/vim-node'
Plug 'justinmk/vim-sneak'
Plug 'machakann/vim-highlightedyank'

" Coc.nvim
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'Shougo/neco-vim'
Plug 'neoclide/coc-neco'
Plug 'wellle/tmux-complete.vim'
Plug 'thalesmello/webcomplete.vim', only#if(has('macunix'))
Plug 'liuchengxu/vista.vim'

" Python dependencies
Plug 'thalesmello/python-support.nvim'

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


Plug 'tpope/vim-dispatch'
Plug 'tpope/vim-haystack'


Plug 'tpope/vim-apathy'
Plug 'yssl/QFEnter'

" Slime
Plug 'jgdavey/tslime.vim'

Plug 'thalesmello/lkml.vim'
Plug 'junegunn/vim-easy-align'

Plug 'dzeban/vim-log-syntax'
Plug 'alvan/vim-closetag'
Plug 'tpope/vim-rhubarb'

Plug 'AndrewRadev/switch.vim'
Plug 'andymass/vim-matchup'

Plug 'tpope/vim-jdaddy'
Plug 'AndrewRadev/undoquit.vim'
Plug 'thalesmello/inline_edit.vim'
" Plug 'EinfachToll/DidYouMean'
Plug 'google/vim-jsonnet'

Plug 'hashivim/vim-terraform'

" Ingo Libraries
Plug 'vim-scripts/ingo-library'
Plug 'inkarkat/vim-AdvancedSorters'

call plug#end()

let mapleader = "\<space>"
let maplocalleader = "'"
let g:my_colorscheme = "apprentice"
