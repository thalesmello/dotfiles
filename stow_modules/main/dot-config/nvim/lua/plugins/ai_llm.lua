local vim_utils = require("vim_utils")
local ai_agents = require("ai_agents")

-- Inside herdr, agents run in their own herdr pane so they show up in the
-- agents sidebar (herdr only detects agents by a pane's foreground process, so
-- an in-nvim terminal is invisible to it). See herdr_agent_pane.lua.
-- Set vim.g.claudecode_herdr_pane = false before startup to stay in-nvim.
local use_herdr_pane = ai_agents.use_herdr

local function copy_reference(reference)
   vim.fn.setreg("+", reference)
   vim.notify("Copied to clipboard: " .. reference)
end

local function copy_file_reference()
   copy_reference(ai_agents.file_reference())
end

local function copy_visual_reference()
   copy_reference(vim_utils.visual_reference())
end

-- Pure copy keymaps: no agent involved, so these are the only definitions.
vim.keymap.set("n", "<leader>aB", copy_file_reference, { desc = "Copy file reference" })
vim.keymap.set("v", "<leader>ay", copy_visual_reference, { desc = "Copy code reference" })

-- Agent-agnostic keymaps. These act on whichever agent is currently attached to
-- a terminal and fall back to Claude when none is, so they are defined here
-- rather than as lazy `keys` of one plugin (which would tie them to Claude and
-- would not work in lite mode, where the agent plugins are absent).
vim.keymap.set("n", "<leader>ab", ai_agents.add_buffer, { desc = "Add current buffer to agent" })
vim.keymap.set("v", "<leader>as", ai_agents.send_selection, { desc = "Send to agent" })
vim.keymap.set("v", "<leader>.", ai_agents.send_selection_or_copy, { desc = "Send to agent or copy reference" })
vim.keymap.set("n", "<leader>aR", ai_agents.pick_session, { desc = "Attach to an agent session" })
vim.keymap.set("n", "<leader>a<bs>", ai_agents.detach, { desc = "Detach all agents" })

-- Defined here rather than in a plugin's config so they exist even when none of
-- the agent plugins have loaded.
vim.api.nvim_create_user_command("AiAgentDetach", ai_agents.detach, {
   desc = "Let go of every attached agent, leaving them running",
})

vim.api.nvim_create_user_command("AiAgentAttach", function(cmd_opts)
   ai_agents.attach(cmd_opts.args)
end, {
   nargs = "?",
   complete = ai_agents.attach_candidates,
   desc = "Attach to an agent pane, or pick one when no pane is given",
})

-- Per-agent activation: visual mode sends the selection, normal mode opens the
-- agent's pane/terminal.
for key, agent in pairs({ ac = "claude", ax = "codex", ap = "pi" }) do
   for _, mode in ipairs({ "n", "v" }) do
      vim.keymap.set(mode, "<leader>" .. key, function()
         ai_agents.activate(agent, mode)
      end, { desc = (mode == "v" and "Send to " or "Toggle ") .. ai_agents.get(agent).label })
   end
end

-- Tree/file-list buffers: the same <leader>as / <leader>. verbs, scoped to the
-- filetypes that have a notion of "the file under the cursor".
vim.api.nvim_create_autocmd("FileType", {
   group = vim.api.nvim_create_augroup("AiAgentTreeMaps", {}),
   pattern = { "NvimTree", "neo-tree", "oil", "minifiles", "netrw", "dirvish" },
   callback = function(args)
      local opts = { buffer = args.buf }

      if args.match == "dirvish" then
         -- Arglist if populated, else the file under the cursor -- the same
         -- rule <leader>Y uses in vim_dirvish.lua.
         vim.keymap.set("n", "<leader>as", ai_agents.add_targets,
            vim.tbl_extend("force", opts, { desc = "Add file(s) to agent" }))

         -- Visual mode only. vim_dirvish.lua owns normal-mode <leader>. for
         -- Quick Look, and <leader>as already covers "the file under the
         -- cursor" through the same arglist-or-cursor rule, so there is nothing
         -- to gain by fighting it for that key. Buffer-local, so these still
         -- beat the global visual mappings -- without them a visual <leader>as
         -- in dirvish sends the buffer's own name, which is the directory, with
         -- the selected line range attached.
         vim.keymap.set("v", "<leader>as", ai_agents.add_visual_lines,
            vim.tbl_extend("force", opts, { desc = "Add selected files to agent" }))
         vim.keymap.set("v", "<leader>.", ai_agents.add_visual_lines,
            vim.tbl_extend("force", opts, { desc = "Add selected files to agent" }))
      else
         vim.keymap.set("n", "<leader>as", ai_agents.tree_add,
            vim.tbl_extend("force", opts, { desc = "Add file to agent" }))
      end
   end,
})

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
         opts.terminal = vim.tbl_extend("force", ai_agents.terminal_config, {
            provider = ai_agents.get("claude").provider(),
         })

         return opts
      end,
      keys = {
         { "<leader>a", nil, desc = "AI agents" },
         { "<leader>af", "<cmd>update | ClaudeCodeFocus<cr>", desc = "Focus Claude" },
         { "<leader>ar", "<cmd>update | ClaudeCode --resume<cr>", desc = "Resume Claude" },
         { "<leader>aC", "<cmd>update | ClaudeCode --continue<cr>", desc = "Continue Claude" },
         { "<leader>am", "<cmd>ClaudeCodeSelectModel<cr>", desc = "Select Claude model" },
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
            -- attach helper types into the pane for us. Any ClaudeCode command
            -- attaches on its own when the tab already has a Claude; this
            -- command is for attaching on demand or to a named pane. Unlike the
            -- implicit adopt on open (tab-scoped), it picks from every Claude in
            -- the workspace, auto-attaching when there is only one.
            -- <leader>aR is the cross-agent version of this.
            vim.api.nvim_create_user_command("ClaudeCodeHerdrAttach", function(cmd_opts)
               local provider = ai_agents.get("claude").provider()

               if cmd_opts.args ~= "" then
                  provider.attach(cmd_opts.args, { focus = true })
                  return
               end

               if not provider.attach_existing({ focus = true, scope = "workspace" }) then
                  vim.notify("No other Claude panes in this herdr workspace", vim.log.levels.WARN)
               end
            end, { nargs = "?", desc = "Attach to an existing Claude herdr pane" })

            vim.api.nvim_create_user_command("ClaudeCodeHerdrDetach", function()
               ai_agents.get("claude").provider().detach()
            end, { desc = "Forget the attached Claude herdr pane" })
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
      -- codex.nvim is a fork of claudecode.nvim: same websocket IDE protocol,
      -- same command set under a Codex* prefix, same custom terminal provider
      -- contract. That is what lets ai_agents drive both through one code path.
      "ishiooon/codex.nvim",
      opts = function()
         return {
            -- claudecode's `open_in_current_tab = false` spelled the other way
            -- round in the fork.
            diff_opts = {
               open_in_new_tab = true,
            },
            -- Its defaults grab <leader>cc/<leader>cs; all Codex keymaps live in
            -- this file instead.
            keymaps = {
               enabled = false,
            },
            terminal = vim.tbl_extend("force", ai_agents.terminal_config, {
               provider = ai_agents.get("codex").provider(),
            }),
         }
      end,
      keys = {
         { "<leader>aX", "<cmd>update | CodexFocus<cr>", desc = "Focus Codex" },
      },
      extra_contexts = {"ssh"},
      config = function(_, opts)
         require("codex").setup(opts)

         -- Take over the not-connected branch entirely.
         --
         -- A Codex pane we adopted can never connect: it was started outside
         -- nvim, so it never got CODEX_CODE_SSE_PORT. codex.nvim's answer is to
         -- queue the mention and wait, which ends in "Connection timeout -
         -- clearing N queued @ mentions" every single time. Its terminal
         -- fallback does not rescue that either: it writes through a
         -- b:terminal_job_id, which neither of our providers has (a herdr pane
         -- is not a buffer; neoterminal uses nvim_open_term + jobstart); it is
         -- skipped outright for the CodexSend context; and it runs before
         -- anything has adopted a pane to write into.
         --
         -- So when there is no websocket, deliver it ourselves: make sure a
         -- pane exists, then paste the reference in the shared format. No
         -- queue, no timeout, and identical text to Claude and pi.
         local codex = require("codex")
         local terminal = require("codex.terminal")
         local provider = ai_agents.get("codex").provider()
         local broadcast = codex.send_at_mention

         codex.send_at_mention = function(file_path, start_line, end_line, context)
            if codex.is_codex_connected() then
               return broadcast(file_path, start_line, end_line, context)
            end

            if not provider.is_pane_active() and not provider.get_active_bufnr() then
               terminal.ensure_visible()
            end

            provider.paste(ai_agents.build_reference(file_path, start_line, end_line))
            return true
         end

         -- Both of codex.nvim's fallbacks funnel through terminal.send, and the
         -- wrapper above has already delivered by the time they run. Drop them
         -- rather than pasting the same reference twice.
         terminal.send = function()
            return true
         end
      end,
   },
   -- pi has no plugin entry: its integration is entirely ours. The editor half
   -- is lua/pi_socket.lua and the pi half is pi/nvim_bridge.ts, loaded into
   -- every pi we start via `pi --extension`. See lua/ai_agents.lua.
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
