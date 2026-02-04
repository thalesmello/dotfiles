local should_load = require('conditional_load').should_load
local copyprg = should_load('ssh') and 'ssh-pbcopy' or 'pbcopy'

vim.g.clipboard = {
	name = 'mac-os like',
	copy = {
		['+'] = copyprg,
		['*'] = copyprg,
	},
	paste = {
		['+'] = 'pbpaste',
		['*'] = 'pbpaste',
	},
	cache_enabled = 1,
}
