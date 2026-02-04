local should_load = require('conditional_load').should_load

if should_load('ssh') then
	vim.g.clipboard = 'osc52'
else
	vim.g.clipboard = {
		name = 'mac-os like',
		copy = {
			['+'] = 'pbcopy',
			['*'] = 'pbcopy',
		},
		paste = {
			['+'] = 'pbpaste',
			['*'] = 'pbpaste',
		},
		cache_enabled = 1,
	}

end

