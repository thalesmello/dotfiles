function! vimux_config#slime() range
  call VimuxRunCommand(vim_utils#visual_selection())
endfunction

function! vimux_config#run_pagarme_test()
  if getcwd() =~ '.*gateway$'
    if expand('%') =~ 'e2e' && expand('%') =~ 'live'
      let script = './script/test-e2e live'
    elseif expand('%') =~ 'e2e'
      let script = './script/test-e2e test'
    else
      let script = './script/test-unit'
    endif
  else
    let script = './script/test'
  endif

  call VimuxRunCommand('exec-notify '. script . ' ' . expand('%'))
endfunction

function! vimux_config#slime_line_break() range
  call vimux_config#slime()
  call VimuxSendKeys('Enter')
endfunction

function! vimux_config#slime_semicolon() range
  call VimuxRunCommand(vim_utils#visual_selection() . '\;')
endfunction

function! vimux_config#copy_postres() range
  call VimuxRunCommand('\COPY (' . vim_utils#visual_selection() . ") TO PROGRAM 'pbcopy' DELIMITER e'\\t' CSV HEADER\;")
endfunction

function! vimux_config#get_execute_command()
  let filetype_to_command = {
        \   'javascript': 'node',
        \   'coffee': 'coffee',
        \   'python': 'python',
        \   'html': 'open',
        \   'ruby': 'ruby',
        \   'sh': 'sh',
        \   'bash': 'bash'
        \ }
  let cmd = get(filetype_to_command, &filetype, &filetype)
  return cmd . " " . expand("%")
endfunction

function! vimux_config#get_nodemon_command()
  let filetype_to_extension = {
        \   'javascript': 'js',
        \   'coffee': 'coffee',
        \   'python': 'py',
        \   'ruby': 'rb'
        \ }
  let extension = get(filetype_to_extension, &filetype, &filetype)
  let cmd = GetExecuteCommand()
  return  'nodemon -L -e "' . extension . '" -x "' . cmd . '"'
endfunction

function! vimux_config#get_repl_command()
  let filetype_to_repl = {
        \   'javascript': 'node',
        \   'ruby': 'rbenv exec pry',
        \   'sql': 'pagarme_postgres'
        \ }
  let repl_bin = get(filetype_to_repl, &filetype, &filetype)
  echo repl_bin
  return  repl_bin
endfunction
