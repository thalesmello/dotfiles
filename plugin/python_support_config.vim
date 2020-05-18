let g:python_support_python2_require = 0
let g:python_support_python2_venv = 0
let g:python_support_python3_venv = 0

" for python completions
let g:python_support_python3_requirements = add(get(g:,'python_support_python3_requirements',[]),'pynvim')
let g:python_support_python3_requirements = add(get(g:,'python_support_python3_requirements',[]),'jedi')
" language specific completions on markdown file
let g:python_support_python3_requirements = add(get(g:,'python_support_python3_requirements',[]),'mistune')

" utils, optional
let g:python_support_python3_requirements = add(get(g:,'python_support_python3_requirements',[]),'psutil')
let g:python_support_python3_requirements = add(get(g:,'python_support_python3_requirements',[]),'setproctitle')

" Formatter
let g:python_support_python3_requirements = add(get(g:,'python_support_python3_requirements',[]),'black')
let g:python_support_python3_requirements = add(get(g:,'python_support_python3_requirements',[]),'flake8')
let g:python_support_python3_requirements = add(get(g:,'python_support_python3_requirements',[]),'isort')
