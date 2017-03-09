let g:ale_javascript_eslint_executable = 'eslint_d'
let g:ale_statusline_format = ['⨉ %d', '⚠ %d', '']
let g:ale_linters = {
			\ 'javascript': ['eslint'],
			\ 'go': ['go build']
			\ }

let g:ale_lint_on_save = 1
let g:ale_lint_on_text_changed = 0
let g:ale_lint_on_enter = 0
