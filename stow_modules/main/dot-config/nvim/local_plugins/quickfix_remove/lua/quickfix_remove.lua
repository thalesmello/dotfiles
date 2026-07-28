vim.api.nvim_create_user_command("RemoveQFItem", function ()
  local curqfidx = vim.fn.line('.') - 1
  local qfall = vim.fn.getqflist()
  vim.fn.remove(qfall, curqfidx)
  vim.fn.setqflist(qfall, 'r')
  vim.cmd.cfirst { range = {curqfidx + 1} }
  vim.cmd.copen()
end, {})
