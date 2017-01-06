call auto#cmd('lastwindow', 'BufLeave * let g:lastwindow_buffer_name = expand("%")')

command! LastWindow vsplit | execute 'edit' g:lastwindow_buffer_name
