return {
   {
      -- "subnut/nvim-ghost.nvim",
      "thalesmello/nvim-ghost.nvim",
      dependencies = { "thalesmello/python-support.nvim" },
      cond = vim.env.NVIM_GHOST_ENABLE == "1",
      init = function (_, opts)
         vim.g.nvim_ghost_use_script = 1
         vim.g.nvim_ghost_lua_autocmd = 1
         vim.g.nvim_ghost_python_executable = "python3"
      end,
      config = function (_, _)
         vim.g.nvim_ghost_python_executable = vim.g.python3_host_prog
         vim.api.nvim_create_autocmd({ 'User' }, {
            group = vim.api.nvim_create_augroup('NvimGhostText', { clear = true }),
            pattern = {"GhostTextAttach"},
            callback = function(ev)
               if vim.g.GHOST_LAST_FILETYPE then
                  vim.o.filetype = vim.g.GHOST_LAST_FILETYPE
               end

               local group = vim.api.nvim_create_augroup('GhostBufAutocmd', { clear = true })

               vim.api.nvim_create_autocmd({ 'FileType' }, {
                  group = group,
                  buffer = vim.api.nvim_get_current_buf(),
                  callback = function(e)
                     vim.g.GHOST_LAST_FILETYPE = e.match
                  end,
               })

               vim.api.nvim_create_autocmd({ 'BufWinLeave' }, {
                  group = group,
                  buffer = vim.api.nvim_get_current_buf(),
                  callback = function()
                     vim.print("Batman")
                     vim.system({
                        "fish",
                        "-c",
                        [[yabai-preset minimize-pid "$(cat "$TMPDIR/nvim_ghost.pid")"]]
                     }, {text=true})
                  end,
               })

               vim.system({
                  "fish",
                  "-c",
                  [[yabai-preset focus-pid "$(cat "$TMPDIR/nvim_ghost.pid")"]]
               }, {text=true})
            end,
         })
      end,
   }
}
