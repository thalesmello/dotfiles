-- Client for the nvim bridge that runs inside pi (see ../pi/nvim_bridge.ts).
--
-- This is the editor half of the bridge. It replaces carderne/pi-nvim, which
-- was the same idea -- a unix socket opened by a pi extension, discovered
-- through manifests in /tmp/pi-nvim-sockets -- but whose protocol could only
-- submit a turn (`pi.sendUserMessage`). Ours adds `insert`, which fills pi's
-- input line and leaves it there, so that <leader>as / <leader>. behave like
-- the Claude and Codex @-mention commands. The socket layout is kept
-- compatible so a pi started with the old extension is still discoverable.
--
-- Protocol (newline-delimited JSON, one response per message):
--   {"type": "insert", "message": "..."}  -> paste into the input line
--   {"type": "prompt", "message": "..."}  -> submit as a user turn
--   {"type": "ping"}                      -> {"ok": true, "type": "pong"}

local M = {}

--- Where pi's bridge extension registers its socket and manifest.
M.dir = "/tmp/pi-nvim-sockets"

-- The session explicitly chosen (by attaching to a pane, or via the picker).
-- Preferred over cwd matching while it is still alive.
local pinned = nil

function M.pin(socket)
   pinned = socket
end

function M.pinned()
   return pinned
end

local function realpath(path)
   if not path then
      return nil
   end
   return vim.uv.fs_realpath(path) or path
end

--- Live pi sessions, best first.
---
--- Ordering: the pinned session, then ones whose extension speaks `insert`
--- (ours) ahead of submit-only ones, then most recently started.
---
--- cwd is compared through fs_realpath because pi records the resolved path
--- (/private/tmp) where nvim reports the symlink (/tmp).
---@param cwd string? restrict to sessions running in this directory
---@return { socket: string, info: table, mtime: number }[]
function M.sessions(cwd)
   local wanted = realpath(cwd)
   local found = {}

   for _, info_path in ipairs(vim.fn.glob(M.dir .. "/*.info", false, true)) do
      local read_ok, content = pcall(vim.fn.readfile, info_path)
      local decoded_ok, info = false, nil
      if read_ok and content and content[1] then
         decoded_ok, info = pcall(vim.json.decode, content[1])
      end

      if decoded_ok and type(info) == "table" then
         local socket = info_path:sub(1, -6) -- strip ".info"
         local stat = vim.uv.fs_stat(socket)
         if stat and (wanted == nil or realpath(info.cwd) == wanted) then
            table.insert(found, { socket = socket, info = info, mtime = stat.mtime.sec })
         end
      end
   end

   table.sort(found, function(a, b)
      if (a.socket == pinned) ~= (b.socket == pinned) then
         return a.socket == pinned
      end

      local a_insert, b_insert = a.info.insert == true, b.info.insert == true
      if a_insert ~= b_insert then
         return a_insert
      end

      return a.mtime > b.mtime
   end)

   return found
end

--- One-line description of a session, for pickers.
function M.describe(session)
   local started = tostring(session.info.startedAt or ""):match("T(%d+:%d+)") or "?"
   return string.format("%s  [pid %s, started %s]", session.info.cwd or "?", session.info.pid or "?", started)
end

--- Send one message and hand the decoded response to `cb`.
---@param cb? fun(err: string?, response: table?)
function M.send(socket, message, cb)
   local function done(err, response)
      if cb then
         vim.schedule(function()
            cb(err, response)
         end)
      end
   end

   local client = vim.uv.new_pipe(false)
   if not client then
      done("could not create pipe")
      return
   end

   client:connect(socket, function(connect_err)
      if connect_err then
         client:close()
         done(connect_err)
         return
      end

      client:write(vim.json.encode(message) .. "\n")

      local buffer = ""
      client:read_start(function(read_err, data)
         if read_err then
            client:read_stop()
            client:close()
            done(read_err)
            return
         end

         if not data then -- EOF before a full line
            client:close()
            done("connection closed")
            return
         end

         buffer = buffer .. data
         local newline = buffer:find("\n")
         if not newline then
            return
         end

         client:read_stop()
         client:close()

         local ok, response = pcall(vim.json.decode, buffer:sub(1, newline - 1))
         if ok and type(response) == "table" then
            done(nil, response)
         else
            done("invalid response from pi")
         end
      end)
   end)
end

--- Send a message to the best matching session, reporting failures.
---@param kind "insert"|"prompt"
---@param cwd string? restrict to sessions in this directory
---@return boolean started true when a session was found and written to
function M.deliver(kind, text, cwd)
   local session = M.sessions(cwd)[1]
   if not session then
      return false
   end

   M.pin(session.socket)

   -- A session from the superseded pi-nvim extension only understands `prompt`,
   -- and that submits; it is still better than not reaching it at all.
   if kind == "insert" and session.info.insert ~= true then
      kind = "prompt"
   end

   M.send(session.socket, { type = kind, message = text }, function(err, response)
      if err then
         vim.notify("pi: " .. err, vim.log.levels.ERROR)
      elseif response and response.ok == false then
         vim.notify("pi: " .. tostring(response.error), vim.log.levels.ERROR)
      end
   end)

   return true
end

return M
