local vim_utils = require('vim_utils')

local function visual_ag(word_boundary)
    local selection = vim_utils.get_visual_selection()
    if word_boundary then
        vim.cmd.ProjectDo('Ag \\b' .. selection .. '\\b')
    else
        vim.cmd.ProjectDo('Ag ' .. selection)
    end
end

vim.g.fzf_history_dir = '~/.local/share/fzf-history'
vim.env.FZF_DEFAULT_COMMAND = 'ag -g ""'

vim.keymap.set("n", "<c-p>", '<cmd>ProjectDo Files<cr>', { noremap = true, silent = true })
vim.keymap.set("v", "<c-p>", '<cmd>ProjectDo Files<cr>', { noremap = true, silent = true })
vim.keymap.set("n", "<c-f>", ':<c-u>ProjectDo Ag<space>', { noremap = true })
vim.keymap.set("n", "<leader>/", function () return '<cmd>ProjectDo Ag \\b' .. vim.fn.expand('<cword>') .. '\\b<cr>' end, { silent = true, expr = true })
vim.keymap.set("v", "<leader>/", function () visual_ag(true) end, { noremap = true, silent = true })
vim.keymap.set("v", "<leader>?", function () visual_ag(false) end, { noremap = true, silent = true })

function CompleteAg(A)
  if A == '' then
        return A
  end

  local ag_cmd = "ag -o " .. vim.fn.shellescape([[\b\w*]] .. A .. [[\w*\b]])

  local output = vim.fn.split(
    vim.system({
      "ag",
      "-o",
      [[\b\w*]] .. A .. [[\w*\b]],
    }, {text=true}):wait().stdout,
    "\n"
  )

  local completions = vim.iter(output)
    :map(function (line)
      return line:match("^[^:]*:[^:]*:(.-)$")
    end)
    :fold({}, function (acc, line)
      acc[line] = 1
      return acc
    end)

  return vim.tbl_keys(completions)
end

vim.api.nvim_create_user_command("Ag", function(opts)
  vim.fn["fzf#vim#ag"](opts.args, vim.fn["fzf#vim#with_preview"]("right"), opts.bang)
end, {
    bang = true,
    complete = CompleteAg,
    nargs="*",
  })


if vim.env.TMUX and vim.fn.empty(vim.fn.trim(vim.fn.system("tmux show -gqv '@tmux-popup' || true"))) == 1 then
  vim.g.fzf_layout = { tmux= '-p90%,60%' }
else
  vim.g.fzf_layout = { window= { width= 0.9, height= 0.6 } }
end
