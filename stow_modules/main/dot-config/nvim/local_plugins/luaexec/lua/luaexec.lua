local M = {}

function M.setup()
  local vim_utils = require("vim_utils")

  vim.keymap.set({'n', 'x'}, '<Plug>LuaExecOperator', '<cmd>set opfunc=v:lua.LuaExecOperator<cr>g@', {noremap = true, silent = true})

  function LuaExecOperator(mode)
    local line1 = vim.fn.line("'[")
    local line2 = vim.fn.line("']")

    vim.api.nvim_cmd({ cmd = 'lua', range = {line1, line2} }, {output=false})

    vim_utils.temporary_highlight("'[", "']", {
      inclusive = true,
      mode = mode,
    })
    -- vim.fn.setcursorcharpos(unpack(vim.fn.getpos("'["), 2))
  end
end

return M
