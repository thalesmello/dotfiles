let g:python3_host_prog = '/opt/homebrew/bin/python3'

let g:python_support_python2_require = 0
let g:python_support_python2_venv = 0
let g:python_support_python3_venv = 0

" for python completions
let g:python_support_python3_requirements = [
  \ 'pynvim',
  \ 'jedi',
  \ 'mistune',
  \ 'psutil',
  \ 'setproctitle',
  \ 'black',
  \ 'neovim-remote',
  \ 'flake8',
  \ 'isort'
  \ ]
