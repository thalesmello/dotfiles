-- Function doesn't work yet
-- Debug when I have more time
function _G.ItermProfile (profile)
  if vim.env.TERM_PROGRAM ~= "iTerm.app" then
    return
  end

  local stdout = vim.loop.new_tty(1, false)

  if not stdout then
    return
  end
  stdout:write(('\x1b]50;SetProfile=%s\x07'):format(profile))

  vim.cmd.redraw()
end

return {
  "folke/zen-mode.nvim",
  opts = {
    neovide = {
      enabled = true
    },

    on_open = function()
      ItermProfile('LargeFont')
    end,
    on_close = function()
      ItermProfile('Default')
    end
  },
  cmd  = {"ZenMode"},
  keys = {{"<leader>kz", "<cmd>ZenMode<cr>", mode = {"n", "v"}}},
}
