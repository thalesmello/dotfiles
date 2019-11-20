let g:ale_javascript_eslint_executable = 'eslint_d'
let g:ale_linters = {
			\ 'javascript': ['eslint'],
			\ 'typescript': ['tslint', 'tsserver'],
			\ 'go': ['gofmt -e', 'go vet', 'golint', 'gosimple', 'staticcheck'],
			\ 'python': ['flake8', 'mypy'],
			\ }

let g:ale_fixers = {
\   'python': ['black'],
\   'javascript': ['prettier-eslint'],
\}

let g:ale_python_black_executable = "safe-black"
let g:ale_python_mypy_ignore_invalid_syntax = 1
let g:ale_python_mypy_options = "--ignore-missing-imports"

let g:ale_lint_on_save = 1
let g:ale_fix_on_save = 1
let g:ale_lint_on_text_changed = 'never'
let g:ale_lint_on_enter = 0
let g:ale_lint_on_filetype_changed = 0

autocmd User MultipleCursorsPre ALEDisable
autocmd User MultipleCursorsPost ALEEnable
