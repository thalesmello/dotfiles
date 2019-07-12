let g:ale_javascript_eslint_executable = 'eslint_d'
let g:ale_linters = {
			\ 'javascript': ['eslint'],
			\ 'typescript': ['tslint', 'tsserver'],
			\ 'go': ['gofmt -e', 'go vet', 'golint', 'gosimple', 'staticcheck'],
			\ 'python': ['flake8']
			\ }

let g:ale_fixers = {
\   'python': ['black'],
\   'javascript': ['prettier-eslint'],
\}

let g:ale_python_black_executable = "safe-black"

let g:ale_lint_on_save = 1
let g:ale_fix_on_save = 1
let g:ale_lint_on_text_changed = 'never'
let g:ale_lint_on_enter = 0
let g:ale_lint_on_filetype_changed = 0

" let g:ale_python_flake8_options = '--ignore=E501,E203'
