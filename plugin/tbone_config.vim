if !exists('$TMUX')
	finish
endif

function! s:twrite_operation(_type)
	call setpos("'<", getpos("'["))
	call setpos("'>", getpos("']"))
	normal! gv

	'<,'>Twrite {last}
	normal! '>j^
endfunction

nnoremap <silent> <Plug>TwriteOperation <cmd>set opfunc=<SID>twrite_operation<cr>g@
xnoremap <silent> <Plug>TwriteOperation <cmd>set opfunc=<SID>twrite_operation<cr>g@

nmap <silent> <leader><cr> <Plug>TwriteOperation
nmap <silent> <leader><cr><cr> V<Plug>TwriteOperation
xmap <silent> <leader><cr> <Plug>TwriteOperation

function! s:tmux_enter(command)
	execute "Tmux send -t '{last}'" shellescape(a:command) "Enter"
endfunction

command! -nargs=+ TmuxEnter call <SID>tmux_enter(<q-args>)
