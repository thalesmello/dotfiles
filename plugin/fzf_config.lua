vim.g.fzf_history_dir = '~/.local/share/fzf-history'
vim.env.FZF_DEFAULT_COMMAND = 'ag -g ""'

vim.keymap.set("n", "<silent><c-p>", '<cmd>Files<cr>', { noremap = true })
vim.keymap.set("v", "<silent><c-p>", '<cmd>Files<cr>', { noremap = true })
vim.keymap.set("n", "<c-f>", ':<c-u>Ag<space>', { noremap = true })
vim.keymap.set("n", "<leader>/", function () return '<cmd>Ag \\b' .. vim.fn.expand('<cword>') .. '\\b<cr>' end, { silent = true, expr = true })
vim.keymap.set("v", "<leader>/", ':<c-u>call fzf_config#visual_ag(0)<cr>', { noremap = true, silent = true })
vim.keymap.set("v", "<leader>?", ':<c-u>call fzf_config#visual_ag(1)<cr>', { noremap = true, silent = true })
vim.keymap.set("n", "<leader>ft", '<cmd>Filetypes<cr>', { noremap = true, silent = true })

function CompleteAg(A)
  if A == '' then
        return A
  end

  return vim.fn.split(vim.fn.system("ag -o " .. vim.fn.shellescape([[\b\w*]] .. A .. [[\w*\b]]) .. [[ | cut -d":" -f3- | sort | uniq -c | sort -k1,1 -n -r | awk "{ print \$2 }"]]), "\n")
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
