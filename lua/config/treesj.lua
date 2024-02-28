if vim.fn.match(vim.opt.runtimepath:get(), "nvim-treesitter") == -1 or vim.fn.match(vim.opt.runtimepath:get(), "nvim-treesitter") == -1 then
   return
end

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

local group = vim.api.nvim_create_augroup("TreeSplitJoinGroup", {
  clear = true
})

vim.api.nvim_create_autocmd({ 'FileType' }, {
  group = group,
  pattern = '*',
  callback = function()
    local opts = { buffer = true }
    if langs[vim.bo.filetype] then
      vim.keymap.set('n', 'gS', '<Cmd>TSJSplit<CR>', opts)
      vim.keymap.set('n', 'gJ', '<Cmd>TSJJoin<CR>', opts)
    else
      vim.keymap.set('n', 'gS', '<Cmd>SplitjoinSplit<CR>', opts)
      vim.keymap.set('n', 'gJ', '<Cmd>SplitjoinJoin<CR>', opts)
    end
  end,
})
