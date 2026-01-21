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
      enabled = true,
      -- Will multiply the current scale factor by this number
      scale = 2,
        -- disable the Neovide animations while in Zen mode
      disable_animations = {
        neovide_animation_length = 0,
        neovide_cursor_animate_command_line = false,
        neovide_scroll_animation_length = 0,
        neovide_position_animation_length = 0,
        neovide_cursor_animation_length = 0,
        neovide_cursor_vfx_mode = "",
      }
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
  extra_contexts = {"lite_mode", "ssh"}
}
