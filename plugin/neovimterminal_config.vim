if !has('nvim')
  finish
endif

" tnoremap <silent> <C-Space><C-h> <C-\><C-n><C-w><C-h>
" tnoremap <silent> <C-Space><C-j> <C-\><C-n><C-w><C-j>
" tnoremap <silent> <C-Space><C-k> <C-\><C-n><C-w><C-k>
" tnoremap <silent> <C-Space><C-l> <C-\><C-n><C-w><C-l>
tnoremap <silent> <C-]><esc> <C-\><C-n>

autocmd BufWinEnter,WinEnter term://* startinsert
autocmd BufLeave term://* stopinsert
