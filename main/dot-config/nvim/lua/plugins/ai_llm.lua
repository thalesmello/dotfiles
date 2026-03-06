return {
   {
      "coder/claudecode.nvim",
      dependencies = { "folke/snacks.nvim" },
      opts = function()
         local opts = {
            diff_opts = {
               open_in_current_tab = false,
            },
         }

         if vim.env.TMUX then
            opts.terminal = {
               provider = "external",
               provider_opts = {
                  external_terminal_cmd = function(cmd, env)
                     local command = { "tmux", "split-window", "-h", "-l", "30%" }
                     if env then
                        for k, v in pairs(env) do
                           table.insert(command, "-e")
                           table.insert(command, k .. "=" .. v)
                        end
                     end
                     table.insert(command, cmd)
                     return command
                  end,
               },
            }
         end

         return opts
      end,
      keys = {
         { "<leader>a", nil, desc = "AI/Claude Code" },
         { "<leader>ac", "<cmd>ClaudeCode<cr>", desc = "Toggle Claude" },
         { "<leader>af", "<cmd>ClaudeCodeFocus<cr>", desc = "Focus Claude" },
         { "<leader>ar", "<cmd>ClaudeCode --resume<cr>", desc = "Resume Claude" },
         { "<leader>aC", "<cmd>ClaudeCode --continue<cr>", desc = "Continue Claude" },
         { "<leader>am", "<cmd>ClaudeCodeSelectModel<cr>", desc = "Select Claude model" },
         { "<leader>ab", "<cmd>ClaudeCodeAdd %<cr>", desc = "Add current buffer" },
         { "<leader>as", "<cmd>ClaudeCodeSend<cr>", mode = "v", desc = "Send to Claude" },
         {
            "<leader>as",
            "<cmd>ClaudeCodeTreeAdd<cr>",
            desc = "Add file",
            ft = { "NvimTree", "neo-tree", "oil", "minifiles", "netrw" },
         },
         {
            "<leader>as",
            "<cmd>argdo ClaudeCodeAdd %<cr>",
            desc = "Add file",
            ft = {"dirvish"},
         },
         {
            "<leader>.",
            "<cmd>ClaudeCodeAdd <cWORD><cr>",
            desc = "Add file",
            ft = {"dirvish"},
         },
         -- Diff management
         { "<leader>aa", "<cmd>ClaudeCodeDiffAccept<cr>", desc = "Accept diff" },
         { "<leader>ad", "<cmd>ClaudeCodeDiffDeny<cr>", desc = "Deny diff" },
      },
      extra_contexts = {"ssh"}
   },
}
