" Prompt for a command to run
map <silent> <localleader>vp :VimuxPromptCommand<CR>
map <silent> <localleader>vl :call VimuxSendKeys('up Enter')<CR>
map <silent> <localleader>vi :VimuxInspectRunner<CR>
map <silent> <localleader>vq :VimuxCloseRunner<CR>
map <silent> <localleader>vx :VimuxInterruptRunner<CR>
map <silent> <localleader>vz :call VimuxZoomRunner()<CR>
map <silent> <localleader>vo :call VimuxOpenRunner()<CR>

" If text is selected, save it in the v buffer and send that buffer it to tmux
vmap <silent> <localleader>vs :call vimux_config#slime()<CR>`>j^
vmap <silent> <localleader>vj Jgv:call vimux_config#slime()<CR>u`>j^
vmap <silent> <localleader>vyp Jgv:call vimux_config#copy_postgres()<CR>u`>j^
vmap <silent> <localleader>v; Jgv:call vimux_config#slime_semicolon()<CR>u`>j^
vmap <silent> <localleader><CR> <localleader>vs

" Select current paragraph and send it to tmux
nmap <silent> <localleader>vs vip<localleader>vs
nmap <silent> <localleader>vj vip<localleader>vj
nmap <silent> <localleader>vyp vip<localleader>vyp
nmap <silent> <localleader>v; vip<localleader>v;
nmap <silent> <localleader><CR> V<localleader>vs
nmap <silent> <localleader>vaa ggVG<localleader>vs
nmap <silent> <localleader>vaj ggVG<localleader>vj

" Execute current file in the interpreter
nnoremap <silent> <localleader>vf :w<CR>:call VimuxRunCommand(vimux_config#get_execute_command())<CR>
nnoremap <silent> <localleader>vw :call VimuxRunCommand(vimux_config#get_nodemon_command())<CR>
nmap <silent> <localleader>vr <localleader>vq:call VimuxRunCommand(vimux_config#get_repl_command())<CR>
nnoremap <silent> <localleader>vtp :call vimux_config#run_pagarme_test()<cr>

" Python specific shortcuts
augroup python_vimux_shortuts
  autocmd!
  autocmd FileType python vmap <buffer> <localleader>vs :call VimuxSlimeLineBreak()<CR>`>j^
  autocmd FileType python nmap <localleader><CR> V:call vimux_config#slime()<CR>`>j^
augroup END

