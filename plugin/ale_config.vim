let g:ale_javascript_eslint_executable = 'eslint_d'
let g:ale_statusline_format = ['⨉ %d', '⚠ %d', '']
let g:ale_linters = {
			\ 'javascript': ['eslint'],
			\ 'go': ['go build']
			\ }

