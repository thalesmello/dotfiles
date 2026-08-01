-- claudecode.nvim terminal provider that runs Claude in a real herdr pane.
--
-- Why this exists: herdr binds an agent to a pane by looking at the pane pty's
-- foreground process (herdr-server.log: `agent changed pane=2 previous_agent=None
-- agent=Some(Claude) process=claude pgid=...`) plus screen-scraping that pane for
-- state. A Claude started inside nvim's embedded :terminal is a grandchild of
-- nvim, so the pane's foreground process stays `nvim`, the pane's agent stays
-- None, and it never gets a row in the agents sidebar. `herdr pane report-agent`
-- from the outside is accepted ({"result":{"type":"ok"}}) but does not synthesize
-- an agent identity for a pane herdr did not detect one in, so there is no way to
-- register an in-nvim terminal. The only thing that produces an agent row is
-- giving Claude its own pane.
--
-- Nvim still drives that pane: `herdr pane split --env` forwards claudecode.nvim's
-- CLAUDE_CODE_SSE_PORT / ENABLE_IDE_INTEGRATION into the new pane, so the Claude
-- running there connects back to this nvim over the websocket and @-references,
-- diffs, selection sending and ClaudeCodeAdd keep working.
--
-- The Claude command is launched with `exec` so the pane closes when Claude exits.

local M = {}

local pane_id = nil
local config = {}

local function herdr_bin()
   return vim.env.HERDR_BIN_PATH or "herdr"
end

-- Run a herdr CLI command synchronously. Returns the completed process, or nil
-- when it could not be run or exited non-zero.
local function herdr_run(args)
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

-- Same, for the commands that answer with the socket API's JSON envelope:
-- returns the decoded `result`, or nil on failure (non-zero exit, or an `error`
-- payload such as pane_not_found). `pane run` is not one of these -- it echoes
-- pane output -- so it goes through herdr_run instead.
local function herdr(args)
   local res = herdr_run(args)
   if not res then
      return nil
   end

   local decoded_ok, decoded = pcall(vim.json.decode, res.stdout or "")
   if not decoded_ok or type(decoded) ~= "table" or decoded.error then
      return nil
   end

   return decoded.result
end

local function pane_exists()
   return pane_id ~= nil and herdr({ "pane", "get", pane_id }) ~= nil
end

local function focus_pane()
   if not pane_id then
      return
   end

   -- Pane ids are valid agent targets, and `agent focus` also switches
   -- workspace/tab when needed. Fall back to directional focus in case the pane
   -- has no detected agent yet (Claude still starting up).
   if herdr({ "agent", "focus", pane_id }) == nil and vim.env.HERDR_PANE_ID then
      herdr({ "pane", "focus", "--pane", vim.env.HERDR_PANE_ID, "--direction", "right" })
   end
end

local function spawn(cmd_string, env_table, effective_config, focus)
   local host_pane = vim.env.HERDR_PANE_ID
   if not host_pane then
      vim.notify("Not running inside a herdr pane (HERDR_PANE_ID unset)", vim.log.levels.ERROR)
      return false
   end

   -- herdr's --ratio is the share kept by the pane being split, not the size of
   -- the new one: splitting a 63-column pane with --ratio 0.3 leaves it 19
   -- columns and hands 44 to the new pane. split_width_percentage means the
   -- opposite (Claude's width), so invert it.
   local claude_share = effective_config.split_width_percentage or 0.30

   local args = {
      "pane",
      "split",
      host_pane,
      "--direction",
      "right",
      "--ratio",
      tostring(1 - claude_share),
      focus and "--focus" or "--no-focus",
      "--cwd",
      effective_config.cwd or vim.fn.getcwd(),
   }

   for key, value in pairs(env_table or {}) do
      table.insert(args, "--env")
      table.insert(args, key .. "=" .. tostring(value))
   end

   local result = herdr(args)
   local new_pane = result and result.pane and result.pane.pane_id
   if not new_pane then
      vim.notify("herdr pane split failed", vim.log.levels.ERROR)
      return false
   end

   pane_id = new_pane

   -- `exec` replaces the pane shell so the pane closes when Claude exits.
   if herdr_run({ "pane", "run", pane_id, "exec " .. cmd_string }) == nil then
      vim.notify("Failed to start Claude in herdr pane " .. pane_id, vim.log.levels.ERROR)
      herdr({ "pane", "close", pane_id })
      pane_id = nil
      return false
   end

   return true
end

function M.setup(term_config)
   config = term_config or {}
end

function M.open(cmd_string, env_table, effective_config, focus)
   if focus == nil then focus = true end

   if pane_exists() then
      if focus then
         focus_pane()
      end
      return
   end

   pane_id = nil
   spawn(cmd_string, env_table, effective_config or {}, focus)
end

function M.close()
   if pane_exists() then
      herdr({ "pane", "close", pane_id })
   end
   pane_id = nil
end

-- There is no "hide" for a herdr pane: closing it would kill the Claude session,
-- so toggling from nvim means "take me to Claude" instead. Coming back is the
-- usual herdr pane navigation (prefix+ctrl+h).
function M.simple_toggle(cmd_string, env_table, effective_config)
   M.open(cmd_string, env_table, effective_config, true)
end

function M.focus_toggle(cmd_string, env_table, effective_config)
   M.open(cmd_string, env_table, effective_config, true)
end

function M.get_active_bufnr()
   -- Claude lives in a herdr pane, not in a Neovim buffer.
   return nil
end

function M.ensure_visible() end

function M.is_available()
   return vim.env.HERDR_PANE_ID ~= nil
end

--- Whether a live Claude pane exists. Used by keymaps that need to know if
--- Claude is around, since get_active_bufnr() is always nil here.
function M.is_pane_active()
   return pane_exists()
end

function M.get_pane_id()
   return pane_id
end

--- Claude agents herdr has detected in this nvim's own tab, excluding this
--- nvim's pane. Scoping to the tab keeps attach unambiguous: the Claude you
--- mean is the one sitting next to the editor, not one in another workspace.
---@return table[] agents entries from `herdr agent list`
function M.list_claude_agents()
   local result = herdr({ "agent", "list" })
   local agents = (result and result.agents) or {}
   local tab_id = vim.env.HERDR_TAB_ID

   local out = {}
   for _, agent in ipairs(agents) do
      if
         agent.agent == "claude"
         and agent.pane_id ~= vim.env.HERDR_PANE_ID
         and (tab_id == nil or agent.tab_id == tab_id)
      then
         table.insert(out, agent)
      end
   end
   return out
end

local function lockfile_path()
   local ok, claudecode = pcall(require, "claudecode")
   local port = ok and claudecode.state and claudecode.state.port
   if not port then
      return nil
   end

   local config_dir = vim.env.CLAUDE_CONFIG_DIR
   local lock_dir = (config_dir and config_dir ~= "") and vim.fn.expand(config_dir .. "/ide")
      or vim.fn.expand("~/.claude/ide")

   return lock_dir .. "/" .. port .. ".lock"
end

--- Name this nvim's lock file after its herdr pane.
---
--- Claude's `/ide` picker lists every lock file in ~/.claude/ide, and
--- claudecode.nvim hard-codes `ideName = "Neovim"` for all of them, so with more
--- than one editor running there is no way to tell which entry is this one.
--- Rewriting ideName just before we ask Claude to pick makes the choice obvious.
---@return string? label the ideName written, or nil if the lock file is unreadable
local function label_lockfile()
   local path = lockfile_path()
   if not path then
      return nil
   end

   local ok, lines = pcall(vim.fn.readfile, path)
   if not ok or type(lines) ~= "table" or #lines == 0 then
      return nil
   end

   local decoded_ok, lock = pcall(vim.json.decode, table.concat(lines, "\n"))
   if not decoded_ok or type(lock) ~= "table" then
      return nil
   end

   local label = table.concat({
      "Neovim",
      vim.env.HERDR_PANE_ID or tostring(vim.fn.getpid()),
      vim.fn.fnamemodify(vim.fn.getcwd(), ":t"),
   }, " ")

   lock.ideName = label

   -- writefile truncates in place, so the lock file keeps its 0600 mode.
   if not pcall(vim.fn.writefile, { vim.json.encode(lock) }, path) then
      return nil
   end

   return label
end

--- Adopt a Claude that is already running in another herdr pane instead of
--- spawning one. The websocket link is Claude's side of the handshake: it picks
--- this nvim from the lock files in ~/.claude/ide via the `/ide` command, which
--- is why we type it into the pane (opts.send_ide = false to do it by hand).
---@param target_pane string herdr pane id
---@param opts? { send_ide?: boolean, focus?: boolean }
---@return boolean attached
function M.attach(target_pane, opts)
   opts = opts or {}

   if herdr({ "pane", "get", target_pane }) == nil then
      vim.notify("No such herdr pane: " .. tostring(target_pane), vim.log.levels.ERROR)
      return false
   end

   pane_id = target_pane

   if opts.send_ide ~= false then
      local label = label_lockfile()
      herdr_run({ "pane", "send-text", pane_id, "/ide" })
      herdr_run({ "pane", "send-keys", pane_id, "enter" })
      vim.notify("Pick " .. (label and ('"' .. label .. '"') or "this nvim") .. " in the Claude pane")
   end

   if opts.focus then
      focus_pane()
   end

   return true
end

--- Forget the attached pane without touching it (leaves Claude running).
function M.detach()
   pane_id = nil
end

return M
