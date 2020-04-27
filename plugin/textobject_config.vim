if match(&runtimepath, 'vim-textobj-user') == -1
    finish
endif

call textobj#user#map('python', { 'class': { 'select-a': 'aP', 'select-i': 'iP', } })
let g:textobj_python_no_default_key_mappings = 1
