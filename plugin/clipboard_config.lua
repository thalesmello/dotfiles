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
