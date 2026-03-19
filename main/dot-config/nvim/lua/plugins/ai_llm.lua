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

         -- Temporarily commenting out tmux because some integration don't work nicely, such as gf, refreshing buffer, etc.

         -- if vim.env.TMUX then
         --    opts.terminal = {
         --       provider = "external",
         --       provider_opts = {
         --          external_terminal_cmd = function(cmd, env)
         --             local command = { "tmux", "split-window", "-h", "-l", "30%" }
         --             if env then
         --                for k, v in pairs(env) do
         --                   table.insert(command, "-e")
         --                   table.insert(command, k .. "=" .. v)
         --                end
         --             end
         --             table.insert(command, cmd)
         --             return command
         --          end,
         --       },
         --    }
         -- end

         return opts
      end,
      keys = {
         { "<leader>a", nil, desc = "AI/Claude Code" },
         { "<leader>ac", "<cmd>ClaudeCode<cr>", desc = "Toggle Claude", mode = {"n", "v"} },
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
      extra_contexts = {"ssh"},
      config = function(_, opts)
         require("claudecode").setup(opts)

         local timer = vim.uv.new_timer()
         vim.api.nvim_create_autocmd("TextChangedT", {
            group = vim.api.nvim_create_augroup("ClaudeTermCheckTime", {}),
            pattern = "*claude",
            callback = function()
               if not timer then return end
               timer:stop()
               timer:start(1000, 0, vim.schedule_wrap(function()
                  vim.cmd("checktime")
               end))
            end,
         })
      end,
   },
   {
      "ThePrimeagen/99",
      dependencies = { "coder/claudecode.nvim" },
      config = function()
         local _99 = require("99")
         local project_name = vim.fn.fnamemodify(vim.fn.getcwd(), ":t")

         _99.setup({
            provider = _99.Providers.ClaudeCodeProvider,
            completion_source = "cmp",
            tmp_dir = "/tmp/99claude/",
            md_files = { "CLAUDE.md" },
            logger = {
               enabled = true,
               file = "/tmp/" .. project_name .. ".99.debug",
            },
         })

         vim.keymap.set("n", "<leader>9s", _99.search, { desc = "99: Search" })
         vim.keymap.set("v", "<leader>9v", _99.visual, { desc = "99: Visual replace" })
         vim.keymap.set("n", "<leader>9x", _99.stop_all_requests, { desc = "99: Stop all" })
         vim.keymap.set("n", "<leader>9o", _99.open, { desc = "99: Open results" })
         vim.keymap.set("n", "<leader>9l", _99.view_logs, { desc = "99: View logs" })
         vim.keymap.set("n", "<leader>9c", _99.clear_previous_requests, { desc = "99: Clear requests" })
         vim.keymap.set("n", "<leader>9V", _99.vibe, { desc = "99: Vibe mode" })
         vim.keymap.set("n", "<leader>9w", _99.Extensions.Worker.set_work, { desc = "99: Set work" })
         vim.keymap.set("n", "<leader>9W", _99.Extensions.Worker.search, { desc = "99: Search work" })
      end,
   },
}
