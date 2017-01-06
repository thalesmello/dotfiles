" # Unite buffer options {{{
" Plugn extractable
call auto#defer("plug#load('neoyank.vim')")
call unite#custom#source('grep, lines', 'max_candidates', 1000)
call unite#custom#source('grep', 'sorters', 'sorter_rank')
call unite#custom#source('location_list, quickfix', 'sorters', 'sorter_nothing')
call unite#filters#matcher_default#use(['matcher_fuzzy'])
call unite#filters#sorter_default#use(['sorter_rank'])
call unite#custom#profile('default', 'context', {
      \   'start_insert': 0,
      \   'winheight': 15,
      \   'direction': 'topleft',
      \ })

let g:unite_quickfix_is_multiline=0
call unite#custom_source('quickfix', 'converters', 'converter_quickfix_highlight')
call unite#custom_source('location_list', 'converters', 'converter_quickfix_highlight')

" " }}}
" # Prefix shortcuts {{{
" Plugin extractable
nnoremap [unite] <Nop>
nmap s [unite]
nnoremap <silent> [unite]r :<C-u>UniteResume<CR>
nnoremap <silent> [unite]me :<C-u>Unite output:message<CR>
nnoremap <silent> [unite]u :<C-u>Unite ultisnips<CR>
nnoremap <silent> [unite]o :<C-u>Unite -direction=topleft -split outline<CR>
nnoremap <silent> [unite]tw :<c-u>Unite tmuxcomplete -default-action=append<cr>
nnoremap <silent> [unite]tl :<c-u>Unite tmuxcomplete/lines -default-action=append<cr>
nnoremap <silent> [unite]li :<c-u>Unite line<cr>
nnoremap <silent> [unite]mr :<C-u>Unite file_mru<cr>
nnoremap <silent> [unite]f :<C-u>Unite file_mru<cr>
nnoremap <silent> [unite]/ :<C-u>Unite line -input=<c-r>/<cr>
nnoremap <silent> [unite]bb :Unite -quick-match buffer<cr>
nnoremap <silent> [unite]qf :<c-u>Unite -wrap -prompt-direction=top quickfix<cr>
nnoremap <silent> [unite]ll :<c-u>Unite -wrap -prompt-direction=top location_list<cr>
nnoremap <silent> [unite][ :<c-u>UnitePrevious<cr>
nnoremap <silent> [unite]] :<c-u>UniteNext<cr>
nnoremap <silent> [unite]{ :<c-u>UniteFirst<cr>
nnoremap <silent> [unite]} :<c-u>UniteLast<cr>
" " }}}
" Ag grep config {{{
" Plugin extractable
let g:unite_source_rec_async_command = ['ag', '--follow', '--nocolor', '--nogroup', '--hidden', '-g', '']
let g:unite_source_grep_command = 'ag'
let g:unite_source_grep_default_opts = '-i --vimgrep --hidden --ignore ' .
      \ '''.hg'' --ignore ''.svn'' --ignore ''.git'' --ignore ''.bzr'''
let g:unite_source_grep_recursive_opt = ''
let g:unite_source_line_enable_highlight = 1

" }}}
" # File explorer (Ctrl+P) {{{
" Plugin extractable
let grep_source = has('nvim') ? 'file_rec/neovim' : 'file_rec/async'
nnoremap <silent> <expr> <leader><c-p> ":\<C-u>Unite -buffer-name=files " . grep_source . ":! file/new\<CR>"
vnoremap <silent> <expr> gf "\"uy:\<C-u>Unite -buffer-name=files " . grep_source . ":! -input=\<c-r>u\<CR>"

" "}}}
" # Other mappings {{{
nnoremap <silent> <leader><c-o> :<c-u>Unite jump<cr>
nmap <leader>epv :<c-u>Unite -input=.lvimrc file_rec/neovim<cr>
nmap <leader>spv :<c-u>LocalVimRC<cr>
nmap <leader>epg :<c-u>Unite file_rec/neovim:~/.vim/plugged<cr>
