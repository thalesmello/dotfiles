vim.g.python_support_python2_require = 0
vim.g.python_support_python2_venv = 0
vim.g.python_support_python3_venv = 1
vim.g.python3_host_prog = 'python3'

-- for python completions
vim.g.python_support_python3_requirements = {
	'pynvim',
	'mistune',
	'psutil',
	'setproctitle',
	'python-dotenv',
	'requests',
	'prompt_toolkit',
}
