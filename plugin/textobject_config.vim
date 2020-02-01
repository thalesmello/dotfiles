if !exists("*textobj#user#map")
	finish
endif

call textobj#user#map('python', { 'class': { 'select-a': 'aP', 'select-i': 'iP', } })
let g:textobj_python_no_default_key_mappings = 1

call textobj#user#map('indent', { '-': { 'select-a': 'ai', 'select-i': 'ii' } })
let g:textobj_indent_no_default_key_mappings = 1
