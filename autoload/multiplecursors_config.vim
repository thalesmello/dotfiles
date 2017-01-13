function! multiplecursors_config#smart_visual_select() range
  normal! gv
  let mode = mode()
  execute "normal! \<esc>"
  if a:firstline == a:lastline && mode ==# 'v'
    let text = vim_utils#visual_selection()
    call multiple_cursors#find(1, line('$'), text)
  else
    call multiple_cursors#find(a:firstline, a:lastline, getreg('/'))
  endif
endfunction
