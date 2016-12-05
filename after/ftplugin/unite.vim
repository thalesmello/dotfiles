nmap <buffer> <C-z> <Plug>(unite_toggle_transpose_window)
imap <buffer> <C-z> <Plug>(unite_toggle_transpose_window)
nmap <buffer> J <Plug>(unite_toggle_auto_preview)
nmap <buffer> K <Plug>(unite_print_candidate)
nmap <buffer> L <Plug>(unite_redraw)
nunmap <buffer> <c-k>
nunmap <buffer> <c-l>
nunmap <buffer> <c-h>
imap <buffer> <C-j> <Plug>(unite_toggle_auto_preview)
nmap <buffer> <C-r> <Plug>(unite_narrowing_input_history)
imap <buffer> <C-r> <Plug>(unite_narrowing_input_history)
nmap <buffer> <Tab> <Plug>(unite_complete)
imap <buffer> <Tab> <Plug>(unite_complete)
nmap <buffer> <C-@> <Plug>(unite_choose_action)
imap <buffer> <C-@> <Plug>(unite_choose_action)
nmap <buffer> <esc> <Plug>(unite_exit)
nmap <buffer> / <Plug>(unite_insert_enter)
nmap <buffer><expr> v unite#do_action('left')
imap <buffer><expr> <c-v> unite#do_action('left')
