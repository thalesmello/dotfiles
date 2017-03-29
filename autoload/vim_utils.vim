function! vim_utils#visual_selection()
  let [lnum1, col1] = getpos("'<")[1:2]
  let [lnum2, col2] = getpos("'>")[1:2]
  let lines = getline(lnum1, lnum2)
  let lines[-1] = lines[-1][: col2 - (&selection == 'inclusive' ? 1 : 2)]
  let lines[0] = lines[0][col1 - 1:]
  return join(lines, "\n")
endfunction


function! vim_utils#chomp(string)
  return substitute(a:string, '\n\+$', '', '')
endfunction

function! vim_utils#visual_command() range
  let text = vim_utils#visual_selection()
  let cmd = input('Pipe: ', '', 'shellcmd')
  let @v = vim_utils#chomp(system(cmd, text))
  execute 'normal! gv"vp'
endfunction

function! vim_utils#syn_stack()
  return map(synstack(line('.'), col('.')), 'synIDattr(v:val, "name")')
endfunc
