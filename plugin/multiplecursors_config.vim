let g:multi_cursor_exit_from_insert_mode = 0
let g:multi_cursor_exit_from_visual_mode = 0
let g:deoplete#auto_complete_delay = 100

function! Multiple_cursors_before()
  call deoplete_config#multiple_cursors_switch(1)
endfunction

function! Multiple_cursors_after()
  call deoplete_config#multiple_cursors_switch(0)
endfunction

noremap g<c-n> :MultipleCursorsFind <c-r>/<cr>

highlight multiple_cursors_cursor term=reverse cterm=reverse gui=reverse
highlight link multiple_cursors_visual Visual

