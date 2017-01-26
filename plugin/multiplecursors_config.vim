let g:multi_cursor_exit_from_insert_mode = 0
let g:multi_cursor_exit_from_visual_mode = 0
let g:deoplete#auto_complete_delay = 100

function! Multiple_cursors_before()
  call deoplete_config#multiple_cursors_switch(1)
endfunction

function! Multiple_cursors_after()
  call deoplete_config#multiple_cursors_switch(0)
endfunction

nnoremap g<c-n> :MultipleCursorsFind \<<c-r><c-w>\><cr>
vnoremap g<c-n> :call multiplecursors_config#smart_visual_select()<cr>
nnoremap <c-_> :MultipleCursorsFind<space>
vnoremap <c-_> :MultipleCursorsFind<space>

