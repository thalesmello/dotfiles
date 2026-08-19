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

	-- Inside a herdr pane, HERDR_PANE_ID is exported into the pane's shell (and
	-- so inherited by nvim). Only here, under the ssh branch: locally pbcopy is
	-- both instant and exact, and herdr-paste's confirm-and-type dance would be
	-- an elaborate way of asking the machine we are already on.
	--
	-- Over ssh it earns its keep. Plain OSC 52 (the branch below) does work
	-- through herdr, but it silently drops anything past ~12 KB and cannot read
	-- the clipboard back at all. herdr-copy chunks past that limit and
	-- herdr-paste asks the Mac to paste at us; both are documented in
	-- dotfiles/bin.
	--
	-- A paste needs the user to confirm a dialog on the Mac and takes a couple
	-- of seconds, so caching is left ON: `"+p` right after a `"+y` is answered
	-- from nvim's own cache and never leaves the machine.
	if vim.env.HERDR_PANE_ID ~= nil or vim.env.HERDR_SOCKET_PATH ~= nil then
		local copy = {'herdr-copy', '--quiet', '--label', 'nvim'}
		local paste = {'herdr-paste'}
		vim.g.clipboard = {
			name = 'herdr',
			copy = {
				['+'] = copy,
				['*'] = copy,
			},
			paste = {
				['+'] = paste,
				['*'] = paste,
			},
			cache_enabled = 1,
		}
	elseif vim.env.TMUX ~= nil then
		-- local copy = {'tmux', 'load-buffer', '-w', '-'}
		local paste = {'bash', '-c', 'tmux refresh-client -l && sleep 0.05 && tmux save-buffer -'}
		vim.g.clipboard = {
			name = 'tmux',
			copy = {
				-- ['+'] = copy,
				-- ['*'] = copy,
				['+'] = require('vim.ui.clipboard.osc52').copy('+'),
				['*'] = require('vim.ui.clipboard.osc52').copy('*'),
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

