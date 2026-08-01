local vim_utils = require("vim_utils")

-- Inside herdr, run Claude in its own herdr pane so it shows up in the agents
-- sidebar (herdr only detects agents by a pane's foreground process, so an
-- in-nvim terminal is invisible to it). See claudecode_herdr_provider.lua.
-- Set vim.g.claudecode_herdr_pane = false before startup to stay in-nvim.
local use_herdr_pane = vim.env.HERDR_PANE_ID ~= nil and vim.g.claudecode_herdr_pane ~= false

local function claude_provider()
   return require(use_herdr_pane and "claudecode_herdr_provider" or "claudecode_neoterm_provider")
end

local function claude_window_active()
   if use_herdr_pane then
      return claude_provider().is_pane_active()
   end

   local bufnr = require("claudecode.terminal").get_active_terminal_bufnr()
   local info = bufnr and unpack(vim.fn.getbufinfo(bufnr))
   return info and #info.windows > 0
end

local function copy_reference(reference)
   vim.fn.setreg("+", reference)
   vim.notify("Copied to clipboard: " .. reference)
end

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

         -- Always route Claude Code through the neoterminal provider so it
         -- inherits the same callbacks/keymaps as a regular <c-space>v terminal
         -- (including alt-screen scroll forwarding via open_filtered_terminal).
         -- The snacks default has no output hook, so it can't detect alt mode.
         --
         -- Previously this was gated behind `vim.env.TMUX or vim.env.HERDR_PANE_ID`
         -- so only multiplexer sessions used the neoterm provider and everything
         -- else fell back to snacks. That left snacks-based terminals (e.g.
         -- :ClaudeCodeOpen outside tmux/herdr) without scroll forwarding, so the
         -- gate was removed. (Herdr exports HERDR_PANE_ID into every pane shell,
         -- which nvim inherits.)
         --
         -- Under herdr the neoterm provider is swapped for the herdr provider,
         -- which puts Claude in a real herdr pane (agents sidebar integration).
         opts.terminal = {
            provider = claude_provider(),
         }

         return opts
      end,
      keys = {
         { "<leader>a", nil, desc = "AI/Claude Code" },
         { "<leader>ac", "<cmd>update | ClaudeCode<cr>", desc = "Toggle Claude" },
         {
            "<leader>ac",
            function()
               vim.cmd.update()

               local was_active = claude_window_active()

               vim.cmd.ClaudeCodeSend()

               if was_active then
                  vim.schedule(function()
                     vim.cmd.ClaudeCodeOpen()
                  end)
               end
            end,
            mode = {"v"},
            desc = "Send to Claude",
         },
         { "<leader>af", "<cmd>update | ClaudeCodeFocus<cr>", desc = "Focus Claude" },
         { "<leader>ar", "<cmd>update | ClaudeCode --resume<cr>", desc = "Resume Claude" },
         { "<leader>aC", "<cmd>update | ClaudeCode --continue<cr>", desc = "Continue Claude" },
         { "<leader>am", "<cmd>ClaudeCodeSelectModel<cr>", desc = "Select Claude model" },
         {
            "<leader>ab",
            function()
               vim.cmd.update()

               if claude_window_active() then
                  vim.cmd("ClaudeCodeAdd %")
                  vim.schedule(function()
                     vim.cmd.ClaudeCodeOpen()
                  end)
                  return
               end

               local path = vim.fn.fnamemodify(vim.fn.expand("%"), ":.")
               copy_reference("@" .. path)
            end,
            desc = "Add current buffer",
         },
         {
            "<leader>aB",
            function()
               local path = vim.fn.fnamemodify(vim.fn.expand("%"), ":.")
               copy_reference("@" .. path)
            end,
            desc = "Copy file reference",
         },
         { "<leader>as", "<cmd>update | ClaudeCodeSend<cr>", mode = "v", desc = "Send to Claude" },
         {
            "<leader>ay",
            function()
               copy_reference(vim_utils.visual_reference())
            end,
            mode = {"v"},
            desc = "Copy code reference",
         },
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
            function()
               vim.cmd.update()

               if claude_window_active() then
                  vim.cmd.ClaudeCodeSend()
                  vim.schedule(function()
                     vim.cmd.ClaudeCodeOpen()
                  end)
                  return
               end

               copy_reference(vim_utils.visual_reference())
            end,
            mode = {"v"},
            desc = "Send to Claude or copy reference",
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

         if use_herdr_pane then
            -- Adopt a Claude that is already running in another herdr pane
            -- rather than splitting a new one. Claude connects to this nvim
            -- from its side via /ide (lock files in ~/.claude/ide), which the
            -- attach helper types into the pane for us.
            vim.api.nvim_create_user_command("ClaudeCodeHerdrAttach", function(cmd_opts)
               local provider = claude_provider()

               if cmd_opts.args ~= "" then
                  provider.attach(cmd_opts.args, { focus = true })
                  return
               end

               local agents = provider.list_claude_agents()
               if #agents == 0 then
                  vim.notify("No other Claude panes in this herdr tab", vim.log.levels.WARN)
                  return
               end

               if #agents == 1 then
                  provider.attach(agents[1].pane_id, { focus = true })
                  return
               end

               vim.ui.select(agents, {
                  prompt = "Attach to Claude pane",
                  format_item = function(agent)
                     return table.concat({
                        agent.pane_id,
                        agent.agent_status or "?",
                        agent.terminal_title_stripped or agent.cwd or "",
                     }, "  ")
                  end,
               }, function(agent)
                  if agent then
                     provider.attach(agent.pane_id, { focus = true })
                  end
               end)
            end, { nargs = "?", desc = "Attach to an existing Claude herdr pane" })

            vim.api.nvim_create_user_command("ClaudeCodeHerdrDetach", function()
               claude_provider().detach()
            end, { desc = "Forget the attached Claude herdr pane" })

            vim.keymap.set("n", "<leader>aR", "<cmd>ClaudeCodeHerdrAttach<cr>", { desc = "Attach Claude pane" })
         end

         -- There's now reloadfiles that automatically reload files when they change on disk

         -- local timer = vim.uv.new_timer()
         -- vim.api.nvim_create_autocmd("TextChangedT", {
         --    group = vim.api.nvim_create_augroup("ClaudeTermCheckTime", {}),
         --    pattern = "*claude",
         --    callback = function()
         --       if not timer then return end
         --       timer:stop()
         --       timer:start(1000, 0, vim.schedule_wrap(function()
         --          vim.cmd("checktime")
         --       end))
         --    end,
         -- })
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
