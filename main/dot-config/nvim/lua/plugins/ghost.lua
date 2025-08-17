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

               vim.api.nvim_create_autocmd({ 'FileType' }, {
                  group = vim.api.nvim_create_augroup('GhostFiletype', { clear = true }),
                  buffer = vim.api.nvim_get_current_buf(),
                  callback = function(ev)
                     vim.g.GHOST_LAST_FILETYPE = ev.match
                  end,
               })

               vim.system({
                  "fish",
                  "-c",
                  [[osascript -e "tell application \"System Events\" to set frontmost of every process whose unix id is $(cat "$TMPDIR/nvim_ghost.pid") to true"]]
               }, {text=true})
            end,
         })
      end,
   }
}
