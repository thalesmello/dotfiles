-- Generic "run a coding agent in its own herdr pane" terminal provider.
--
-- Why a real pane instead of an in-nvim :terminal: herdr binds an agent to a
-- pane by looking at the pane pty's foreground process (herdr-server.log:
-- `agent changed pane=2 previous_agent=None agent=Some(Claude) process=claude
-- pgid=...`) plus screen-scraping that pane for state. An agent started inside
-- nvim's embedded terminal is a grandchild of nvim, so the pane's foreground
-- process stays `nvim`, the pane's agent stays None, and it never gets a row in
-- the agents sidebar. `herdr pane report-agent` from the outside is accepted
-- ({"result":{"type":"ok"}}) but does not synthesize an agent identity for a
-- pane herdr did not detect one in. The only thing that produces an agent row
-- is giving the agent its own pane.
--
-- Nvim still drives that pane: `herdr pane split --env` forwards the plugin's
-- SSE port / IDE-integration env into the new pane, so the agent running there
-- connects back to this nvim over the websocket and @-references, diffs,
-- selection sending and the *Add commands keep working.
--
-- M.new(spec) returns one provider instance, shaped like the custom-table
-- terminal provider that claudecode.nvim and codex.nvim accept. Each agent
-- (claude, codex, pi) gets its own instance so their panes are tracked
-- independently. See claudecode_herdr_provider.lua for the Claude instance.

local M = {}

local function herdr_bin()
   return vim.env.HERDR_BIN_PATH or "herdr"
end

--- Run a herdr CLI command synchronously. Returns the completed process, or nil
--- when it could not be run or exited non-zero.
function M.run(args)
   local cmd = { herdr_bin() }
   vim.list_extend(cmd, args)

   local ok, res = pcall(function()
      return vim.system(cmd, { text = true }):wait(5000)
   end)
   if not ok or res.code ~= 0 then
      return nil
   end

   return res
end

--- Same, for the commands that answer with the socket API's JSON envelope:
--- returns the decoded `result`, or nil on failure (non-zero exit, or an `error`
--- payload such as pane_not_found). `pane run` is not one of these -- it echoes
--- pane output -- so it goes through M.run instead.
function M.json(args)
   local res = M.run(args)
   if not res then
      return nil
   end

   local decoded_ok, decoded = pcall(vim.json.decode, res.stdout or "")
   if not decoded_ok or type(decoded) ~= "table" or decoded.error then
      return nil
   end

   return decoded.result
end

--- Whether this nvim is itself running inside a herdr pane.
function M.available()
   return vim.env.HERDR_PANE_ID ~= nil
end

--- Agents herdr has detected, excluding this nvim's own pane.
---
--- "tab" scope (the default) keeps implicit attaches unambiguous: the agent
--- meant when a command opens is the one sitting next to the editor.
--- "workspace" scope is for the explicit attach command, where picking an agent
--- from another tab of the same workspace is the point.
---@param opts? { scope?: "tab"|"workspace", kinds?: string[] }
---@return table[] agents entries from `herdr agent list`
function M.list_agents(opts)
   opts = opts or {}

   local result = M.json({ "agent", "list" })
   local agents = (result and result.agents) or {}

   local key = opts.scope == "workspace" and "workspace_id" or "tab_id"
   local id = opts.scope == "workspace" and vim.env.HERDR_WORKSPACE_ID or vim.env.HERDR_TAB_ID

   local out = {}
   for _, agent in ipairs(agents) do
      local kind_matches = opts.kinds == nil or vim.list_contains(opts.kinds, agent.agent)
      if
         kind_matches
         and agent.pane_id ~= vim.env.HERDR_PANE_ID
         and (id == nil or agent[key] == id)
      then
         table.insert(out, agent)
      end
   end
   return out
end

--- One-line description of a `herdr agent list` entry, for pickers.
function M.describe(agent)
   return table.concat({
      agent.pane_id,
      agent.tab_id or "?",
      agent.agent_status or "?",
      agent.terminal_title_stripped or agent.cwd or "",
   }, "  ")
end

--- Build a terminal provider that keeps its agent in a dedicated herdr pane.
---@param spec { agent: string, label: string, on_attach?: fun(provider: table, pane_id: string) }
---   agent     herdr agent kind ("claude", "codex", "pi", ...), as reported by
---             `herdr agent list`.
---   label     human name, used in messages.
---   on_attach runs after adopting a pane that this nvim did not spawn. Agents
---             that need a handshake to bind to this editor (Claude's `/ide`)
---             do it here; agents that discover the editor by themselves leave
---             it unset.
function M.new(spec)
   local P = {}

   local pane_id = nil
   local config = {}

   local function pane_exists()
      return pane_id ~= nil and M.json({ "pane", "get", pane_id }) ~= nil
   end

   local function focus_pane()
      if not pane_id then
         return
      end

      -- Pane ids are valid agent targets, and `agent focus` also switches
      -- workspace/tab when needed. Fall back to directional focus in case the
      -- pane has no detected agent yet (the agent is still starting up).
      if M.json({ "agent", "focus", pane_id }) == nil and vim.env.HERDR_PANE_ID then
         M.json({ "pane", "focus", "--pane", vim.env.HERDR_PANE_ID, "--direction", "right" })
      end
   end

   local function spawn(cmd_string, env_table, effective_config, focus)
      local host_pane = vim.env.HERDR_PANE_ID
      if not host_pane then
         vim.notify("Not running inside a herdr pane (HERDR_PANE_ID unset)", vim.log.levels.ERROR)
         return false
      end

      -- herdr's --ratio is the share kept by the pane being split, not the size
      -- of the new one: splitting a 63-column pane with --ratio 0.3 leaves it 19
      -- columns and hands 44 to the new pane. split_width_percentage means the
      -- opposite (the agent's width), so invert it.
      local agent_share = effective_config.split_width_percentage or 0.30

      local args = {
         "pane",
         "split",
         host_pane,
         "--direction",
         "right",
         "--ratio",
         tostring(1 - agent_share),
         focus and "--focus" or "--no-focus",
         "--cwd",
         effective_config.cwd or vim.fn.getcwd(),
      }

      for key, value in pairs(env_table or {}) do
         table.insert(args, "--env")
         table.insert(args, key .. "=" .. tostring(value))
      end

      local result = M.json(args)
      local new_pane = result and result.pane and result.pane.pane_id
      if not new_pane then
         vim.notify("herdr pane split failed", vim.log.levels.ERROR)
         return false
      end

      pane_id = new_pane

      -- `exec` replaces the pane shell so the pane closes when the agent exits.
      if M.run({ "pane", "run", pane_id, "exec " .. cmd_string }) == nil then
         vim.notify("Failed to start " .. spec.label .. " in herdr pane " .. pane_id, vim.log.levels.ERROR)
         M.json({ "pane", "close", pane_id })
         pane_id = nil
         return false
      end

      return true
   end

   function P.setup(term_config)
      config = term_config or {}
   end

   -- focus defaults to false, not true: both claudecode.nvim and codex.nvim
   -- call terminal.open() with no focus argument on the not-yet-connected send
   -- path, which would drag you into the agent every time <leader>as starts it.
   -- Focus is only ever taken when something asks for it by name -- P.focus(),
   -- or the toggles behind <leader>ac / <leader>ax / <leader>ap.
   function P.open(cmd_string, env_table, effective_config, focus)
      if focus == nil then focus = false end

      if pane_exists() then
         if focus then
            focus_pane()
         end
         return
      end

      pane_id = nil

      -- An agent already sitting in this tab is almost always the one meant, so
      -- adopt it before splitting another pane. Note this ignores the command's
      -- flags (--resume, --continue): the running session is what you get.
      if P.attach_existing({ focus = focus }) then
         return
      end

      spawn(cmd_string, env_table, effective_config or config or {}, focus)
   end

   function P.close()
      if pane_exists() then
         M.json({ "pane", "close", pane_id })
      end
      pane_id = nil
   end

   -- There is no "hide" for a herdr pane: closing it would kill the session, so
   -- toggling from nvim means "take me to the agent" instead. Coming back is the
   -- usual herdr pane navigation (prefix+ctrl+h).
   function P.simple_toggle(cmd_string, env_table, effective_config)
      P.open(cmd_string, env_table, effective_config, true)
   end

   function P.focus_toggle(cmd_string, env_table, effective_config)
      P.open(cmd_string, env_table, effective_config, true)
   end

   function P.get_active_bufnr()
      -- The agent lives in a herdr pane, not in a Neovim buffer.
      return nil
   end

   -- Deliberately no ensure_visible(). A pane is always visible once it exists,
   -- so a no-op looked right -- but the plugins call provider.ensure_visible()
   -- to mean "make sure there IS one", and answering "already fine" when no
   -- pane exists yet meant nothing ever got adopted or spawned. Leaving it
   -- undefined makes them fall through to provider.open(cmd, env, cfg, false),
   -- which has the command and environment needed to do that, unfocused.

   function P.is_available()
      return M.available()
   end

   --- Whether a live pane exists. Used by keymaps that need to know if the agent
   --- is around, since get_active_bufnr() is always nil here.
   function P.is_pane_active()
      return pane_exists()
   end

   function P.get_pane_id()
      return pane_id
   end

   --- Jump to the agent's pane, if there is one.
   ---@return boolean focused
   function P.focus()
      if not pane_exists() then
         return false
      end

      focus_pane()
      return true
   end

   --- Type text into the pane, for the plugins that fall back to writing into
   --- their agent's terminal when the websocket is not connected. Those
   --- fallbacks target a Neovim terminal buffer, which a herdr pane has none of.
   ---@param opts? { submit?: boolean } submit defaults to true, matching the
   ---  plugins' own terminal-send contract
   ---@return boolean sent
   function P.send_text(text, opts)
      if not pane_exists() then
         return false
      end

      if text and text ~= "" then
         M.run({ "pane", "send-text", pane_id, text })
      end

      if not opts or opts.submit ~= false then
         M.run({ "pane", "send-keys", pane_id, "enter" })
      end

      return true
   end

   --- Drop text into the agent's input line without submitting it, the way the
   --- Claude/Codex @-mention commands do -- you get a chance to type around it
   --- before hitting enter.
   ---
   --- Bracketed paste is what makes that work for a multi-line body: `pane
   --- send-text` is literal, so a bare newline would submit the first line and
   --- strand the rest. herdr passes the escape bytes through untouched.
   ---@return boolean pasted
   function P.paste(text)
      return P.send_text("\27[200~" .. text .. "\27[201~", { submit = false })
   end

   --- Panes running this agent, tab-scoped by default. See M.list_agents.
   ---@param scope? "tab"|"workspace"
   function P.list_agents(scope)
      return M.list_agents({ scope = scope, kinds = { spec.agent } })
   end

   --- Adopt an agent that is already running in another herdr pane instead of
   --- spawning one.
   ---@param target_pane string herdr pane id
   ---@param opts? { handshake?: boolean, focus?: boolean, quiet?: boolean }
   ---@return boolean attached
   function P.attach(target_pane, opts)
      opts = opts or {}

      if M.json({ "pane", "get", target_pane }) == nil then
         vim.notify("No such herdr pane: " .. tostring(target_pane), vim.log.levels.ERROR)
         return false
      end

      pane_id = target_pane
      if not opts.quiet then
         vim.notify("Attached to " .. spec.label .. " pane " .. target_pane)
      end

      if spec.on_attach and opts.handshake ~= false then
         spec.on_attach(P, target_pane)
      end

      if opts.focus then
         focus_pane()
      end

      return true
   end

   --- Attach to an agent already running in this herdr tab (or anywhere in the
   --- workspace with opts.scope = "workspace"), asking which one when there is
   --- more than one.
   ---@param opts? { handshake?: boolean, focus?: boolean, quiet?: boolean, scope?: "tab"|"workspace" }
   ---@return boolean started true when an attach happened, or a picker was opened
   function P.attach_existing(opts)
      opts = opts or {}

      local agents = P.list_agents(opts.scope)
      if #agents == 0 then
         return false
      end

      if #agents == 1 then
         return P.attach(agents[1].pane_id, opts)
      end

      vim.ui.select(agents, {
         prompt = "Attach to " .. spec.label .. " pane",
         format_item = M.describe,
      }, function(agent)
         if agent then
            P.attach(agent.pane_id, opts)
         end
      end)

      return true
   end

   --- Forget the attached pane without touching it (leaves the agent running).
   function P.detach()
      pane_id = nil
   end

   return P
end

return M
