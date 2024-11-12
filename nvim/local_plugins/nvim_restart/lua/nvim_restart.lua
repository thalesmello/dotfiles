local M = {}

function M.exit_status_one()
    -- Context: https://www.reddit.com/r/neovim/comments/15gihnd/neat_trick_for_restarting_neovim_fast_when_using/
    vim.print("Exiting vim with status one. Should restart your svim with the right binary")
    vim.cmd.cquit()
end

return M
