-- claudecode.nvim terminal provider that runs Claude in a real herdr pane.
--
-- The pane mechanics live in herdr_agent_pane.lua (shared with codex and pi);
-- what is Claude-specific is the handshake used when adopting a pane this nvim
-- did not spawn. Claude connects to nvim from its side via `/ide`, picking an
-- entry from the lock files in ~/.claude/ide, so attaching means typing that
-- command into the pane and answering the menu.

local herdr_agent_pane = require("herdr_agent_pane")

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

--- Find the number of the `/ide` menu entry whose line contains `label`.
--- The menu is a numbered list, so take the "N." immediately before the label:
---
---   1. Neovim
--- ❯ 2. Neovim wQ:p4 dotfiles
---   3. Neovim
---
---@return string? number
local function find_menu_entry(text, label)
   for line in text:gmatch("[^\n]+") do
      local at = line:find(label, 1, true)
      if at then
         local number = line:sub(1, at - 1):match("(%d+)%.%s*$")
         if number then
            return number
         end
      end
   end
   return nil
end

--- Answer the `/ide` prompt we just typed into the pane. The menu takes a moment
--- to render, so read the pane back after a short delay, locate our own entry by
--- the label we wrote into the lock file, and press its number.
local function select_ide_entry(provider, target_pane, label)
   vim.defer_fn(function()
      if provider.get_pane_id() ~= target_pane then
         return
      end

      local res = herdr_agent_pane.run({ "pane", "read", target_pane })
      local number = res and find_menu_entry(res.stdout or "", label)

      if not number then
         vim.notify('Could not find "' .. label .. '" in the /ide menu; pick it manually', vim.log.levels.WARN)
         return
      end

      herdr_agent_pane.run({ "pane", "send-text", target_pane, number })
   end, 500)
end

return herdr_agent_pane.new({
   agent = "claude",
   label = "Claude",
   on_attach = function(provider, target_pane)
      local label = label_lockfile()

      -- Anything half-typed in Claude's prompt would turn "/ide" into a normal
      -- message. Stash it with ctrl+s rather than deleting it (ctrl+u only kills
      -- one line, so it can leave a multi-line draft behind); Claude restores the
      -- stash on its own once the slash command is done.
      herdr_agent_pane.run({ "pane", "send-keys", target_pane, "ctrl+s" })
      herdr_agent_pane.run({ "pane", "send-text", target_pane, "/ide" })
      herdr_agent_pane.run({ "pane", "send-keys", target_pane, "enter" })

      if label then
         select_ide_entry(provider, target_pane, label)
      else
         vim.notify("Pick this nvim in the Claude pane", vim.log.levels.WARN)
      end
   end,
})
