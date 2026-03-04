return {
   {
      "olimorris/codecompanion.nvim",
      opts = {
         interactions = {
            chat = {
               adapter = "gemini",
            },
            inline = {
               adapter = "gemini",
            },
            cmd = {
               adapter = "gemini",
            }
         },
         adapters = {
            gemini = function()
               return require("codecompanion.adapters").extend("gemini", {
                  env = {
                     api_key = 'cmd:op read "op://Personal/thales-workflow Gemini API Key/credential" --no-newline',
                  },
               })
            end,
         },
      },
      dependencies = {
         "nvim-lua/plenary.nvim",
         "nvim-treesitter/nvim-treesitter",
         "j-hui/fidget.nvim",
      },
      init = function ()
         require('config.code_companion_fidget_spinner'):init()
      end,
      config = function (_, opts)
         require("codecompanion").setup(opts)

         vim.keymap.set({ "n", "v" }, "<leader>ca", "<cmd>CodeCompanionActions<cr>", { noremap = true, silent = true })
         vim.keymap.set({ "n", "v" }, "<leader>cc", "<cmd>CodeCompanionChat Toggle<cr>", { noremap = true, silent = true })
         vim.keymap.set("v", "<leader>ga", "<cmd>CodeCompanionChat Add<cr>", { noremap = true, silent = true })

         vim.cmd.cabbrev("cc CodeCompanion")
      end
   },
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
         -- Diff management
         { "<leader>aa", "<cmd>ClaudeCodeDiffAccept<cr>", desc = "Accept diff" },
         { "<leader>ad", "<cmd>ClaudeCodeDiffDeny<cr>", desc = "Deny diff" },
      },
      extra_contexts = {"ssh"}
   },
}
