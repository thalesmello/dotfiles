if match(&runtimepath, 'deoplete') == -1
    finish
endif

let g:deoplete#enable_at_startup = 1
