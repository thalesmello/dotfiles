let g:multi_cursor_exit_from_insert_mode = 0
let g:multi_cursor_exit_from_visual_mode = 0

nnoremap g<c-n> :MultipleCursorsFind \<<c-r><c-w>\><cr>
vnoremap g<c-n> :call multiplecursors_config#smart_visual_select()<cr>
nnoremap <c-_> :MultipleCursorsFind<space>
vnoremap <c-_> :MultipleCursorsFind<space>

