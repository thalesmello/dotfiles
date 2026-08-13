-- Registry of the interactive coding agents nvim can drive (Claude, Codex, pi)
-- and the dispatch behind the shared <leader>a keymaps.
--
-- Each agent owns a terminal provider instance: a herdr pane when nvim itself
-- runs inside herdr (so the agent shows up in the agents sidebar -- see
-- herdr_agent_pane.lua), otherwise an in-nvim neoterminal split. The providers
-- are created here rather than by the plugins so that this module can answer
-- "is that agent running?" without forcing the plugin to load.
--
-- <leader>ac / <leader>ax / <leader>ap activate a specific agent; the rest of
-- the <leader>a maps act on whichever agent is currently attached, falling back
-- to Claude when none is.

local vim_utils = require("vim_utils")
local pi_socket = require("pi_socket")

local M = {}

-- Set vim.g.claudecode_herdr_pane = false before startup to keep every agent
-- in an in-nvim terminal even under herdr.
M.use_herdr = vim.env.HERDR_PANE_ID ~= nil and vim.g.claudecode_herdr_pane ~= false

M.terminal_config = {
   split_width_percentage = 0.40,
}

local specs = {}

--- Agent names in the order they are offered / probed.
M.order = { "claude", "codex", "pi" }

local current = nil

---@return table spec
function M.get(name)
   return specs[name]
end

function M.set_current(name)
   current = name
end

---@return string? name the agent last activated, if any
function M.current()
   return current
end

--- The agent the shared keymaps act on: the last one activated if it is still
--- running, else any running one, else Claude.
---@return table spec
function M.resolve()
   local spec = current and specs[current]
   if spec and spec.is_active() then
      return spec
   end

   for _, name in ipairs(M.order) do
      if specs[name].is_active() then
         return specs[name]
      end
   end

   return specs.claude
end

-- ---------------------------------------------------------------------------
-- Shared provider plumbing
-- ---------------------------------------------------------------------------

local function build_provider(spec)
   if M.use_herdr then
      if spec.herdr_provider then
         return spec.herdr_provider()
      end
      return require("herdr_agent_pane").new({ agent = spec.herdr_agent, label = spec.label })
   end
   return require("neoterm_agent_provider").new()
end

local function define(spec)
   local provider = nil

   --- The provider instance, created on first use.
   function spec.provider()
      if not provider then
         provider = build_provider(spec)
      end
      return provider
   end

   --- Load the plugin that backs this agent (lazy.nvim loads on require).
   --- Agents with no plugin behind them -- pi, whose whole integration is ours
   --- -- have nothing to load.
   function spec.ensure_loaded()
      if not spec.module then
         return true
      end
      return pcall(require, spec.module)
   end

   --- Live terminal/pane? Never creates a provider: an agent that was never
   --- activated from this nvim is not attached to it.
   function spec.is_active()
      if not provider then
         return false
      end

      if M.use_herdr then
         return provider.is_pane_active()
      end

      local bufnr = provider.get_active_bufnr()
      local info = bufnr and unpack(vim.fn.getbufinfo(bufnr))
      return (info and #info.windows > 0) or false
   end

   --- Forget the agent without touching it: the pane or terminal keeps running,
   --- nvim just stops treating it as attached. Cheap when nothing was attached,
   --- so it is safe to call for every agent.
   function spec.detach()
      if provider then
         provider.detach()
      end
      if spec.on_detached then
         spec.on_detached()
      end
   end

   --- Adopt an agent already running in a herdr pane.
   ---@param entry table an entry from `herdr agent list`
   function spec.attach(entry)
      spec.ensure_loaded()
      local attached = spec.provider().attach(entry.pane_id, { focus = true })
      if attached then
         M.set_current(spec.name)
         if spec.on_attached then
            spec.on_attached(entry)
         end
      end
      return attached
   end

   specs[spec.name] = spec
   return spec
end

-- ---------------------------------------------------------------------------
-- Claude and Codex: claudecode.nvim and its codex.nvim fork, same command set
-- ---------------------------------------------------------------------------

--- @param o { name: string, label: string, module: string, terminal_module: string, prefix: string, herdr_provider?: fun(): table }
local function define_claudecode_like(o)
   local spec = {
      name = o.name,
      label = o.label,
      module = o.module,
      herdr_agent = o.name,
      herdr_provider = o.herdr_provider,
   }

   local function cmd(suffix, args)
      vim.cmd(o.prefix .. (suffix or "") .. (args and (" " .. args) or ""))
   end

   function spec.open()
      vim.cmd.update()
      cmd()
   end

   --- Go to the agent. Asks the provider directly rather than going through
   --- *Open, because provider.open no longer focuses by default -- see the note
   --- there. Falls back to the toggle, which both creates and focuses, when
   --- there is no terminal/pane yet. Deferred because the send it follows
   --- finishes on a later tick.
   function spec.focus()
      vim.schedule(function()
         if not spec.provider().focus() then
            cmd()
         end
      end)
   end

   function spec.send_selection()
      vim.cmd.update()
      cmd("Send")
   end

   function spec.add_buffer()
      vim.cmd.update()
      cmd("Add", "%")
   end

   function spec.tree_add()
      cmd("TreeAdd")
   end

   --- Hand file references over as plain text -- `@a @b ` in one message, the
   --- same thing pi gets.
   ---
   --- The alternative is the plugin's own *Add command, once per file. That
   --- routes each path through the at-mention machinery, which spells the
   --- reference its own way, queues (and eventually times out) whenever the
   --- agent is not connected over the websocket, and turns N files into N
   --- separate round trips. For "here are some files, look at them" none of
   --- that buys anything over typing the references into the prompt.
   function spec.add_paths(paths)
      if #paths == 0 then
         return
      end

      if not spec.is_active() then
         -- The plugin knows the command and environment; ensure_visible starts
         -- or adopts without taking focus.
         require(o.terminal_module).ensure_visible()
      end

      spec.provider().paste(M.build_references(paths))
   end

   return define(spec)
end

define_claudecode_like({
   name = "claude",
   label = "Claude",
   module = "claudecode",
   terminal_module = "claudecode.terminal",
   prefix = "ClaudeCode",
   -- Claude needs the `/ide` handshake when adopting a pane it did not spawn.
   herdr_provider = function()
      return require("claudecode_herdr_provider")
   end,
})

define_claudecode_like({
   name = "codex",
   label = "Codex",
   module = "codex",
   terminal_module = "codex.terminal",
   prefix = "Codex",
})

-- ---------------------------------------------------------------------------
-- pi. Unlike claudecode.nvim/codex.nvim there is no plugin here: the editor
-- half of the bridge is pi_socket.lua and the pi half is pi/nvim_bridge.ts,
-- both ours. pi has no terminal integration of its own either, so the
-- pane/terminal is ours to manage as well.
-- ---------------------------------------------------------------------------

local pi = define({
   name = "pi",
   label = "pi",
   herdr_agent = "pi",
})

-- Where the bridge is exposed to pi. It lives in the nvim config, but pi must
-- not be *launched* from there: the path would put the word "nvim" in pi's
-- argv, and tooling that asks "is this pane running vim?" by grepping
-- `herdr pane process-info` (herdr's own agent detection matches the process
-- name, but the smart-close / smart-pane-nav keybinding scripts grep the whole
-- payload) would then treat the pi pane as an editor. Hence a symlink from a
-- path with no "nvim" in it.
local PI_BRIDGE_LINK = vim.fs.joinpath(
   vim.env.XDG_DATA_HOME or vim.fn.expand("~/.local/share"),
   "pi-bridge",
   "bridge.ts"
)

--- Point PI_BRIDGE_LINK at the bridge in the nvim config, and return it.
--- A symlink rather than a copy, so edits to the config take effect with no
--- staleness to manage.
---@return string? path
local function pi_bridge()
   local source = vim.api.nvim_get_runtime_file("pi/nvim_bridge.ts", false)[1]
   if not source then
      return nil
   end

   if vim.uv.fs_realpath(PI_BRIDGE_LINK) ~= vim.uv.fs_realpath(source) then
      vim.fn.mkdir(vim.fs.dirname(PI_BRIDGE_LINK), "p")
      vim.uv.fs_unlink(PI_BRIDGE_LINK)
      if not vim.uv.fs_symlink(source, PI_BRIDGE_LINK) then
         return source
      end
   end

   return PI_BRIDGE_LINK
end

--- The command to start pi with.
---
--- The socket nvim talks to is opened by an extension running inside pi, and
--- without it a session is unreachable. pi takes `--extension <path>`, so
--- loading ours here means every pi we start has the bridge, with nothing to
--- install on the pi side.
local function pi_command()
   local bridge = pi_bridge()
   if not bridge then
      vim.notify("pi/nvim_bridge.ts not on the runtimepath; pi will not be reachable", vim.log.levels.WARN)
      return "pi"
   end

   return "pi --extension " .. vim.fn.shellescape(bridge)
end

--- Deliver a message to pi, by whichever route is available.
---
--- The socket comes first: it addresses a session directly rather than typing
--- at whatever the pane happens to be showing, and `insert` fills the input
--- line without submitting.
---
--- Pasting into a pane/terminal we own is the fallback, and gets there by the
--- same means -- pi's pasteToEditor is literally
--- `editor.handleInput("\27[200~" .. text .. "\27[201~")`.
---@return boolean delivered
local function pi_deliver(message)
   -- A session in this project, then the one we started, then any session at
   -- all.
   if pi_socket.deliver("insert", message, vim.uv.cwd()) then
      return true
   end

   if pi.is_active() and pi.provider().paste(message) then
      return true
   end

   return pi_socket.deliver("insert", message, nil)
end

--- A freshly spawned pi takes a moment to reach its prompt, so retry for a few
--- seconds rather than dropping the message.
local function pi_deliver_when_ready(message, attempts)
   if pi_deliver(message) then
      return
   end

   if attempts <= 0 then
      vim.notify("Could not reach pi to send the prompt", vim.log.levels.ERROR)
      return
   end

   vim.defer_fn(function()
      pi_deliver_when_ready(message, attempts - 1)
   end, 300)
end

--- Leave the cursor one space past the reference, so you can start typing the
--- actual request without reaching for the spacebar first.
local function with_trailing_space(text)
   return text:match("%s$") and text or text .. " "
end

local function pi_send(message)
   message = with_trailing_space(message)
   M.set_current("pi")

   if pi_deliver(message) then
      return true
   end

   -- No pi to talk to yet: start one alongside the editor and deliver the
   -- message once it answers. Unfocused, because the send verbs that land here
   -- (<leader>as and friends) leave you in the editor.
   vim.cmd.update()
   pi.provider().open(pi_command(), {}, M.terminal_config, false)
   M.set_current("pi")

   pi_deliver_when_ready(message, 30)
   return true
end

--- <leader>ap in normal mode. simple_toggle rather than open, to match what the
--- bare :ClaudeCode / :Codex commands do behind <leader>ac and <leader>ax: show
--- and focus, or hide again if it is an in-nvim split you are looking at.
function pi.open()
   vim.cmd.update()
   pi.provider().simple_toggle(pi_command(), {}, M.terminal_config)
   M.set_current("pi")
end

-- pi gets the same @-mention references Claude Code and Codex do -- `@path` and
-- `@path#L3-10` -- rather than an inlined copy of the code. One format across
-- all three agents, and the agent reads the file itself.

--- claudecode.nvim and codex.nvim drop out of visual mode as part of their
--- *Send commands. pi's send is ours, so it has to do the same -- otherwise you
--- are left with the selection still active over a buffer you have moved on
--- from. Capture the reference first: it reads the range from `v` and `.`,
--- which only mean anything while the selection is live.
function pi.send_selection()
   vim.cmd.update()

   local reference = vim_utils.visual_reference()

   if vim.fn.mode():match("^[vV\22]") then
      vim.api.nvim_feedkeys(vim.keycode("<Esc>"), "nx", false)
   end

   pi_send(reference)
end

function pi.add_buffer()
   vim.cmd.update()
   pi_send(M.file_reference())
end

function pi.add_paths(paths)
   if #paths > 0 then
      pi_send(M.build_references(paths))
   end
end

function pi.tree_add()
   pi.add_paths({ vim.fn.expand("<cfile>") })
end

--- Jump to pi, the way *Open does for Claude and Codex.
---
--- Those two always have a pane/terminal of ours to go to, because talking to
--- them requires one. pi does not: a session found over its socket may be
--- running in a herdr pane this nvim never started, so <leader>. would have
--- nothing to focus. Adopt that pane first -- which also pins its socket -- and
--- the rest of the keymaps then treat it like any other attached agent.
---@return boolean focused
function pi.focus()
   if pi.provider().focus() then
      return true
   end

   if not M.use_herdr then
      return false
   end

   local session = pi_socket.sessions(vim.uv.cwd())[1] or pi_socket.sessions()[1]
   local wanted = session and session.info.cwd and vim.uv.fs_realpath(session.info.cwd)

   for _, entry in ipairs(require("herdr_agent_pane").list_agents({ scope = "workspace", kinds = { "pi" } })) do
      if wanted == nil or (entry.cwd and vim.uv.fs_realpath(entry.cwd) == wanted) then
         return pi.attach(entry)
      end
   end

   return false
end


-- pi can be attached without a pane of ours: a session reached over the socket
-- counts too, so that <leader>as keeps going to pi after <leader>ap. Gated on
-- pi having been chosen, so that a stray pi running in this directory does not
-- quietly capture keymaps meant for Claude.
local pi_pane_active = pi.is_active

function pi.is_active()
   if pi_pane_active() then
      return true
   end

   return M.current() == "pi" and #pi_socket.sessions(vim.uv.cwd()) > 0
end

--- Detaching pi also drops the pinned socket, so the next send goes back to
--- picking a session by cwd instead of the one we were talking to.
function pi.on_detached()
   pi_socket.pin(nil)
end

--- Sessions are picked by cwd by default; after adopting a specific pane, pin
--- the session running in it so messages land there rather than in whichever pi
--- started most recently.
function pi.on_attached(entry)
   local session = entry.cwd and pi_socket.sessions(entry.cwd)[1]
   if session then
      pi_socket.pin(session.socket)
   end
end

-- ---------------------------------------------------------------------------
-- Keymap entry points
-- ---------------------------------------------------------------------------

local function copy_reference(reference)
   vim.fn.setreg("+", reference)
   vim.notify("Copied to clipboard: " .. reference)
end

function M.file_reference()
   return "@" .. vim.fn.fnamemodify(vim.fn.expand("%"), ":.")
end

--- The canonical @ mention: `@path` or `@path#L3-7`, plus the trailing space.
--- The one place the reference format is decided, so Claude, Codex and pi all
--- receive identical text.
---@param start_line integer? 0-indexed, as the plugins pass them
---@param end_line integer? 0-indexed
---@return string
function M.build_reference(path, start_line, end_line)
   local reference = "@" .. M.relative_path(path)

   if type(start_line) == "number" and type(end_line) == "number" then
      reference = reference .. string.format("#L%d-%d", start_line + 1, end_line + 1)
   end

   return reference .. " "
end

--- Several file references as one message: `@a @b `.
function M.build_references(paths)
   local references = vim.tbl_map(function(path)
      return vim.trim(M.build_reference(path))
   end, paths)

   return table.concat(references, " ") .. " "
end

--- Shorten a path against the cwd, for building @ mentions.
---
--- Dirvish lists absolute paths (dirvish_relative_paths = 0), and plain
--- fnamemodify(":.") does not shorten them on macOS: nvim reports the cwd as
--- /tmp while the path resolves to /private/tmp, so the prefix never matches.
--- Resolving both sides first fixes that. Claude and Codex do their own
--- resolution when handed an absolute path; pi takes the mention literally, so
--- it needs this.
---@return string
function M.relative_path(path)
   local absolute = vim.fn.fnamemodify(path, ":p")
   local trailing = absolute:sub(-1) == "/" and "/" or ""
   local bare = trailing == "/" and absolute:sub(1, -2) or absolute

   local real = vim.uv.fs_realpath(bare) or bare
   local cwd = vim.uv.cwd() or ""
   local real_cwd = vim.uv.fs_realpath(cwd) or cwd

   if real_cwd ~= "" and real == real_cwd then
      return "." .. trailing
   end

   if real_cwd ~= "" and vim.startswith(real, real_cwd .. "/") then
      return real:sub(#real_cwd + 2) .. trailing
   end

   return real .. trailing
end

--- <leader>ac / <leader>ax / <leader>ap: activate one agent -- sending the
--- visual selection when there is one, opening its pane otherwise. Activating
--- is a deliberate "go work with this agent", so it takes you there either way.
function M.activate(name, mode)
   local spec = specs[name]
   M.set_current(name)
   spec.ensure_loaded()

   if mode == "v" then
      spec.send_selection()
      spec.focus()
   else
      spec.open()
   end
end

--- <leader>as (visual): hand the reference over and stay in the editor.
function M.send_selection()
   M.resolve().send_selection()
end

--- <leader>ab: add the current buffer to the attached agent and go there, or
--- copy its reference when no agent is running. Focuses, unlike <leader>as --
--- reaching for the whole buffer usually means you are about to talk about it.
function M.add_buffer()
   vim.cmd.update()

   local spec = M.resolve()
   if spec.is_active() then
      spec.add_buffer()
      spec.focus()
      return
   end

   copy_reference(M.file_reference())
end

--- <leader>. (visual): send to the attached agent and go there -- the "I am
--- done editing, let's talk about this" verb. Copies the reference instead when
--- no agent is running.
function M.send_selection_or_copy()
   local spec = M.resolve()
   if spec.is_active() then
      spec.send_selection()
      spec.focus()
      return
   end

   copy_reference(vim_utils.visual_reference())
end

--- <leader>as in tree buffers.
function M.tree_add()
   M.resolve().tree_add()
end

--- The files a dirvish action operates on: the whole arglist when it is
--- populated, otherwise the file under the cursor. Same rule the other dirvish
--- mappings in vim_dirvish.lua use, so <leader>as does something useful whether
--- or not you have built an arglist.
local function dirvish_targets()
   local args = vim.fn.argv()
   if #args > 0 then
      return args
   end

   local line = vim.fn.getline(".")
   return line ~= "" and { line } or {}
end

--- <leader>as in dirvish.
function M.add_targets()
   local targets = dirvish_targets()
   if #targets == 0 then
      return
   end

   M.resolve().add_paths(targets)
end

--- Leave visual mode, the way the plugins' own *Send commands do.
local function leave_visual()
   if vim.fn.mode():match("^[vV\22]") then
      vim.api.nvim_feedkeys(vim.keycode("<Esc>"), "nx", false)
   end
end

--- <leader>as / <leader>. over a visual selection in dirvish: every path on the
--- selected lines.
---
--- Without this the global visual <leader>as wins, and the agents treat a
--- dirvish buffer like any other file -- sending its *name*, which is the
--- directory, with the selected line range attached (`@/Users/me/src/#L3-4`).
--- Neither plugin's tree integration covers dirvish, so it has to be handled
--- here.
function M.add_visual_lines()
   local from = math.min(vim.fn.line("v"), vim.fn.line("."))
   local to = math.max(vim.fn.line("v"), vim.fn.line("."))

   local paths = {}
   for _, line in ipairs(vim.fn.getline(from, to)) do
      if line ~= "" then
         table.insert(paths, line)
      end
   end

   leave_visual()

   if #paths > 0 then
      M.resolve().add_paths(paths)
   end
end

--- <leader>. in dirvish: just the file under the cursor, ignoring the arglist.
--- The whole line is the path, which beats <cWORD> -- that stops at spaces, so
--- it truncates any filename containing one.
function M.add_cursor_line()
   local line = vim.fn.getline(".")
   if line == "" then
      return
   end

   M.resolve().add_paths({ line })
end

--- <leader>a<bs> / :AiAgentDetach -- let go of every attached agent, leaving
--- them all running. The next <leader>as goes back to the default (Claude, or
--- whichever agent is running) rather than to whatever was last attached.
function M.detach()
   local detached = {}

   for _, name in ipairs(M.order) do
      local spec = specs[name]
      if spec.is_active() then
         table.insert(detached, spec.label)
      end
      spec.detach()
   end

   M.set_current(nil)

   if #detached == 0 then
      vim.notify("No attached agents")
   else
      vim.notify("Detached " .. table.concat(detached, ", "))
   end
end

--- Every agent pane in this herdr workspace, whatever the agent.
local function workspace_agents()
   return require("herdr_agent_pane").list_agents({ scope = "workspace", kinds = M.order })
end

--- :AiAgentAttach [pane] -- attach to a named herdr pane, or open the picker
--- when none is given. The agent kind comes from herdr, so the right
--- integration is used for whatever is running there.
function M.attach(pane_id)
   if not pane_id or pane_id == "" then
      return M.pick_session()
   end

   if not M.use_herdr then
      vim.notify("Not running inside herdr; no panes to attach to", vim.log.levels.WARN)
      return false
   end

   for _, entry in ipairs(workspace_agents()) do
      if entry.pane_id == pane_id then
         return specs[entry.agent].attach(entry)
      end
   end

   vim.notify("No Claude, Codex or pi agent in pane " .. pane_id, vim.log.levels.ERROR)
   return false
end

--- Pane ids for :AiAgentAttach completion.
function M.attach_candidates()
   if not M.use_herdr then
      return {}
   end

   return vim.tbl_map(function(entry)
      return entry.pane_id
   end, workspace_agents())
end

--- <leader>aR: pick any Claude/Codex/pi session in this herdr workspace and
--- attach to it. Outside herdr the only externally discoverable sessions are
--- pi's, so the picker narrows to those.
function M.pick_session()
   if not M.use_herdr then
      -- Claude and Codex outside herdr live in terminals this nvim owns, so
      -- there is nothing to discover; pi announces itself over its socket.
      local sessions = pi_socket.sessions()
      if #sessions == 0 then
         vim.notify("No agent sessions to attach to outside herdr", vim.log.levels.WARN)
         return
      end

      vim.ui.select(sessions, {
         prompt = "Attach to pi session",
         format_item = function(session)
            return (session.socket == pi_socket.pinned() and "● " or "○ ") .. pi_socket.describe(session)
         end,
      }, function(session)
         if session then
            pi_socket.pin(session.socket)
            M.set_current("pi")
            vim.notify("Attached to pi in " .. (session.info.cwd or "?"))
         end
      end)
      return
   end

   local herdr_agent_pane = require("herdr_agent_pane")
   local entries = workspace_agents()

   if #entries == 0 then
      vim.notify("No agent panes in this herdr workspace", vim.log.levels.WARN)
      return
   end

   vim.ui.select(entries, {
      prompt = "Attach to agent pane",
      format_item = function(entry)
         return string.format("%-7s %s", specs[entry.agent].label, herdr_agent_pane.describe(entry))
      end,
   }, function(entry)
      if entry then
         specs[entry.agent].attach(entry)
      end
   end)
end

return M
