function! s:send_operation(_type)
	call setpos("'<", getpos("'["))
	call setpos("'>", getpos("']"))
	normal! gv

	call feedkeys("\<Plug>SendSelectionToTmux\<Plug>SlimePostHook")
endfunction

nnoremap <silent> <Plug>SlimePostHook :call setpos('.', getpos("'>"))<cr>^j

nmap <silent> <a-m> :set opfunc=<SID>send_operation<cr>g@
nmap <silent> <a-m><a-m> :set opfunc=<SID>send_operation<cr>Vg@
vmap <silent> <a-m> :<c-u>set opfunc=<SID>send_operation<cr>gvg@

command! SlimeResetVars call feedkeys("\<Plug>SetTmuxVars")

let g:tslime_always_current_session = 1
let g:tslime_always_current_window = 1
