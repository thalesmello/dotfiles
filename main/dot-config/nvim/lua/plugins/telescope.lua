return {
   {
      "nvim-telescope/telescope.nvim",
      dependencies = {"nvim-lua/plenary.nvim"},
      opts = {},
      config = function ()
         local builtin = require('telescope.builtin')

         vim.keymap.set('n', '<leader>ff', builtin.find_files, { desc = 'Telescope find files' })
         vim.keymap.set('n', '<leader>fg', builtin.live_grep, { desc = 'Telescope live grep' })
         vim.keymap.set('n', '<leader>fb', builtin.buffers, { desc = 'Telescope buffers' })
         vim.keymap.set('n', '<leader>fh', builtin.help_tags, { desc = 'Telescope help tags' })
         -- builtin.
         vim.keymap.set('n', '<leader>fv', function () builtin.find_files({ cwd = vim.fn.stdpath("config") }) end, { desc = 'Telescope vim config files' })
         vim.keymap.set('n', '<leader>fd', function () builtin.find_files({ cwd = "~/src/dotfiles" }) end, { desc = 'Telescope dotfiles' })
         vim.keymap.set('n', '<leader>fV', function () builtin.find_files({ search_dirs = vim.api.nvim_list_runtime_paths() }) end, { desc = 'Telescope plugin files' })

         vim.api.nvim_create_autocmd({ 'FileType' }, {
            group = vim.api.nvim_create_augroup('TelescopeResumeGroup', { clear = true }),
            pattern = {"TelescopePrompt"},
            callback = function()
               vim.g.fuzzy_finder_to_resume = 'telescope'
            end,
         })
      end
   }
}
