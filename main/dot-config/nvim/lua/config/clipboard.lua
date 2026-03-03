local should_load = require('conditional_load').should_load

if should_load('ssh') then
	vim.g.clipboard = {
		name = 'OSC 52',
		copy = {
			['+'] = require('vim.ui.clipboard.osc52').copy('+'),
			['*'] = require('vim.ui.clipboard.osc52').copy('*'),
		},
		paste = {
			['+'] = require('vim.ui.clipboard.osc52').paste('+'),
			['*'] = require('vim.ui.clipboard.osc52').paste('*'),
		},
	}

	if vim.env.TMUX ~= nil then
		local copy = {'tmux', 'load-buffer', '-w', '-'}
		local paste = {'bash', '-c', 'tmux refresh-client -l && sleep 0.05 && tmux save-buffer -'}
		vim.g.clipboard = {
			name = 'tmux',
			copy = {
				['+'] = copy,
				['*'] = copy,
			},
			paste = {
				['+'] = paste,
				['*'] = paste,
			},
			cache_enabled = 0,
		}
	end
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

