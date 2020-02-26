function! clap_config#visual_grep()
  call clap_config#with_input_hook('grep', vim_utils#visual_selection())
endfunction

function! clap_config#from_query_term(mode, query_term)
  execute "Clap" a:mode "."
  call feedkeys("\<c-e>")
  call g:clap.input.set(a:query_term)

  if exists("g:clap#provider#" . a:mode ."#.on_typed")
    call g:clap#provider#{a:mode}#.on_typed()
  endif
endfunction

function! clap_config#from_last_input(mode)
  if !exists("g:clap_config_last_input")
      let g:clap_config_last_input = {}
  endif

  let last_term = get(g:clap_config_last_input, a:mode, "")
  call clap_config#set_input_hook(a:mode)
  call clap_config#from_query_term(a:mode, last_term)
endfunction

function! clap_config#with_input_hook(mode, term)
  call clap_config#set_input_hook(a:mode)
  call clap_config#from_query_term(a:mode, a:term)
endfunction

function! clap_config#set_input_hook(keyword)
  if !exists("g:clap_config_last_input")
      let g:clap_config_last_input = {}
  endif

  augroup ClapConfigLastUsedGroup
    autocmd!
    execute "autocmd CursorMovedI * let g:clap_config_last_input['" . a:keyword . "'] = g:clap.input.get()"
    autocmd User ClapOnExit call clap_config#unset_input_hook()
  augroup END
endfunction

function! clap_config#unset_input_hook()
  autocmd! ClapConfigLastUsedGroup
endfunction

function! clap_config#ensure_closed() abort
  call clap#floating_win#close()
  call feedkeys("\<esc>")
  silent! autocmd! ClapEnsureAllClosed
endfunction

function! clap_config#on_clap_enter() abort
  augroup ClapEnsureAllClosed
    autocmd!
    autocmd BufEnter,WinEnter,WinLeave * call clap_config#ensure_closed()
  augroup END
endfunction

