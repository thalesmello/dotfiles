local tsj = require('treesj')

local langs = {}

tsj.setup({
  -- Use default keymaps
  -- (<space>m - toggle, <space>j - join, <space>s - split)
  use_default_keymaps = false,

  -- Node with syntax error will not be formatted
  check_syntax_error = true,

  -- If line after join will be longer than max value,
  -- node will not be formatted
  max_join_length = 1200,

  -- hold|start|end:
  -- hold - cursor follows the node/place on which it was called
  -- start - cursor jumps to the first symbol of the node being formatted
  -- end - cursor jumps to the last symbol of the node being formatted
  cursor_behavior = 'hold',

  -- Notify about possible problems or not
  notify = true,
  langs = langs,

  -- Use `dot` for repeat action
  dot_repeat = true,
})


langs = require'treesj.langs'['presets']

vim.keymap.set('n', 'gS', function ()
  if langs[vim.bo.filetype] then
    return '<Cmd>TSJSplit<CR>'
  else
    return '<Cmd>SplitjoinSplit<CR>'
  end
end, { expr = true, silent = true, desc = "Split structure" })

vim.keymap.set('n', 'gJ', function ()
    if langs[vim.bo.filetype] then
      return '<Cmd>TSJJoin<CR>'
    else
      return '<Cmd>SplitjoinJoin<CR>'
    end
end, { expr = true, silent = true, desc = "Join structure" })
