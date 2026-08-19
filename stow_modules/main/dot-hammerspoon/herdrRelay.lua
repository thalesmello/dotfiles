local util = require("util")
local Preset = require("preset")

-- Requests relayed from a Herdr pane through the clipboard.
--
-- Herdr forwards OSC 52 clipboard writes made inside a pane it renders to the
-- ATTACHED CLIENT's clipboard, and that holds even when the herdr server (and
-- the pane's shell) live on the other end of an ssh connection. That makes the
-- pasteboard the one channel a remote pane can reach this Mac through without
-- any agent of ours running on the server, so two things ride it:
--
--   herdr-open  a URL to open here (`bin/herdr-open`), confirmed by a dialog
--   herdr-copy  text to put on the clipboard (`bin/herdr-copy`), split across
--               several writes when it is too big for one OSC 52 sequence
--
-- Both use RS/US-framed records carrying a versioned 128-bit namespace token,
-- which makes an accidental match on something a user actually copied
-- vanishingly unlikely. A record is never left on the clipboard: it is consumed
-- and the previous contents put back (or, for a copy, replaced by the text that
-- was being sent).
--
-- ONE WATCHER FOR BOTH is deliberate. The relay has to remember what was on the
-- clipboard BEFORE a request arrived in order to restore it, and two watchers
-- would each snapshot the other's in-flight records as if they were ordinary
-- copies -- so a restore would put a half-finished transfer back on the
-- clipboard.
local M = {}

---------------------------------------------------------------
-- Wire format
---------------------------------------------------------------

-- Must match bin/herdr-open.
local OPEN_PREFIX = "\30HERDR_OPEN_URL_V1:8f26c7a14d9346b8a01e57bc649b2e3d:"
local OPEN_SUFFIX = "\31"

-- Must match bin/herdr-copy. Records are
--   B:<id>:<records>:<bytes>:<b64len>:<sha256|->:<label b64|->
--   D:<id>:<seq>:<base64 slice>
--   E:<id>:<records>
local COPY_PREFIX = "\30HERDR_COPY_V1:834556b044b8c4e66da30e4c210094d2:"
local COPY_SUFFIX = "\31"

-- What the sender is allowed to ask for, mirroring its own 128 KiB ceiling
-- (plus slack for base64). A record claiming more than this is a bug or a
-- forgery, not a transfer worth allocating for.
local COPY_MAX_BYTES = 131072
local COPY_MAX_RECORDS = 64

-- How long a transfer may go without progress before it is written off. The
-- sender paces records ~0.2s apart; anything approaching this means records
-- stopped arriving (the pane died, ssh stalled, a write was dropped).
local COPY_TIMEOUT = 5

-- Pasteboard polling. hs.pasteboard.watcher polls rather than subscribing, and
-- the callback only ever sees the LATEST contents -- two records landing inside
-- one interval means the first is gone. 0.1s (down from the 0.25s default) is
-- what lets herdr-copy pace at 0.2s and still send 128 KiB in a few seconds.
-- Module-wide and only read when a watcher is created, hence set before ours.
local POLL_INTERVAL = 0.1

---------------------------------------------------------------
-- Clipboard bookkeeping
---------------------------------------------------------------

-- Snapshot of the clipboard as it was before the request currently being
-- handled. A full UTI snapshot rather than the plain string, so restoring an
-- image or rich text does not flatten it.
local previousClipboard
-- The changeCount of the mutation WE made, so the watcher does not treat its
-- own restore as a fresh copy. A count rather than a boolean: a request that
-- arrives before the next tick then still gets processed instead of being
-- mistaken for the restore.
local ignoredChangeCount
-- In-flight multi-record copy, or nil.
local transfer
-- Id of a transfer that has been written off, whose remaining records are
-- still on their way and get swept off the clipboard as they land.
local discarding

local function snapshotClipboard()
  previousClipboard = hs.pasteboard.readAllData()
end

local function restoreClipboard()
  if previousClipboard and next(previousClipboard) then
    hs.pasteboard.writeAllData(previousClipboard)
  else
    hs.pasteboard.clearContents()
  end
  ignoredChangeCount = hs.pasteboard.changeCount()
end

local function humanSize(bytes)
  if bytes < 1024 then return string.format("%d B", bytes) end
  return (string.format("%.1f", bytes / 1024):gsub("%.0$", "")) .. " KB"
end

---------------------------------------------------------------
-- herdr-open: open a URL here
---------------------------------------------------------------

local function decodeOpenRequest(contents)
  if type(contents) ~= "string" then return nil end
  if contents:sub(1, #OPEN_PREFIX) ~= OPEN_PREFIX then return nil end
  if contents:sub(-#OPEN_SUFFIX) ~= OPEN_SUFFIX then return nil end

  local encoded = contents:sub(#OPEN_PREFIX + 1, -#OPEN_SUFFIX - 1)
  if #encoded == 0 or #encoded > 16384 then return nil end
  if not encoded:match("^[A-Za-z0-9+/]*=?=?$") then return nil end

  local ok, url = pcall(hs.base64.decode, encoded)
  if not ok or type(url) ~= "string" or #url == 0 or #url > 8192 then return nil end
  -- Herdr's pane URL detector only produces web URLs. Keep the relay just as
  -- narrow: confirmation should not turn arbitrary application URL schemes
  -- into a remote code-execution primitive.
  if not url:match("^https?://") or url:find("[%z\1-\31\127]") then return nil end
  return url
end

local function showOpenDialog(url)
  local previousApp = hs.application.frontmostApplication()

  -- blockAlert is backed directly by NSAlert rather than by the hidden webview
  -- used by hs.dialog.alert. Focus Hammerspoon first so the native modal is the
  -- foreground key window. NSAlert makes its first button the default, so both
  -- Return and Enter choose Open; Escape chooses Cancel.
  hs.focus()
  local button = hs.dialog.blockAlert(
    "Open URL from Herdr?",
    url,
    "Open",
    "Cancel",
    "informational"
  )

  if button == "Open" then
    if not hs.urlevent.openURL(url) and previousApp then previousApp:activate(true) end
  elseif previousApp then
    previousApp:activate(true)
  end
end

---------------------------------------------------------------
-- herdr-copy: stitch a chunked clipboard transfer back together
---------------------------------------------------------------

-- Split a framed copy record into its ':'-separated fields, or nil when this
-- is not one of ours. The last field (a base64 slice) never contains ':', so a
-- plain split is unambiguous.
local function parseCopyRecord(contents)
  if type(contents) ~= "string" then return nil end
  if contents:sub(1, #COPY_PREFIX) ~= COPY_PREFIX then return nil end
  if contents:sub(-#COPY_SUFFIX) ~= COPY_SUFFIX then return nil end

  local body = contents:sub(#COPY_PREFIX + 1, -#COPY_SUFFIX - 1)
  local fields = {}
  for field in (body .. ":"):gmatch("([^:]*):") do
    fields[#fields + 1] = field
  end
  return fields
end

local function stopTimeout()
  if transfer and transfer.timer then
    transfer.timer:stop()
    transfer.timer = nil
  end
end

-- Give up on the transfer in flight. `restore` puts the pre-transfer clipboard
-- back; it is skipped when something else has legitimately taken the clipboard
-- over in the meantime (an ordinary copy, another request), since clobbering
-- what the user just copied would be worse than the failure itself.
local function abortTransfer(reason, restore)
  if not transfer then return end
  stopTimeout()
  -- The sender has no back channel and keeps writing records until it runs out
  -- of them; remembering which transfer was written off is what stops those
  -- from being left sitting on the clipboard.
  discarding = transfer.id
  transfer = nil
  if restore then
    restoreClipboard()
  else
    -- Not ours to roll back, but it IS what the remaining records have to be
    -- swept back off the clipboard in favour of.
    snapshotClipboard()
  end
  util.log("herdrRelay: copy failed:", reason)
  hs.alert.show("Herdr copy failed\n" .. reason
    .. (restore and "\nClipboard restored." or ""), 4)
end

local function armTimeout()
  stopTimeout()
  local id = transfer.id
  transfer.timer = hs.timer.doAfter(COPY_TIMEOUT, function()
    if transfer and transfer.id == id then
      abortTransfer(string.format("record %d of %d never arrived",
        transfer.next, transfer.total), true)
    end
  end)
end

local function beginTransfer(fields)
  local id = fields[2]
  local total = tonumber(fields[3])
  local bytes = tonumber(fields[4])
  local b64len = tonumber(fields[5])
  local digest = fields[6]
  local label

  if fields[7] and fields[7] ~= "-" and fields[7]:match("^[A-Za-z0-9+/]*=?=?$") then
    local ok, decoded = pcall(hs.base64.decode, fields[7])
    if ok and type(decoded) == "string" and not decoded:find("[%z\1-\31\127]") then
      label = decoded
    end
  end

  if not (id ~= "" and total and bytes and b64len)
      or total < 1 or total > COPY_MAX_RECORDS
      or bytes < 1 or bytes > COPY_MAX_BYTES then
    util.log("herdrRelay: ignoring malformed copy handshake")
    return
  end

  -- A transfer already in flight was abandoned by its sender (its records
  -- stopped arriving) -- report it, but keep the clipboard snapshot: it is
  -- still the last thing the user actually copied, and this new transfer will
  -- want to restore it if IT fails.
  if transfer then
    stopTimeout()
    util.log("herdrRelay: superseded transfer", transfer.id)
    transfer = nil
  end
  -- Nothing is snapshotted here on purpose: the handshake is ALREADY on the
  -- clipboard by the time this runs, so what a restore has to put back is the
  -- snapshot taken on an earlier tick.

  discarding = nil
  transfer = {
    id = id,
    total = total,
    bytes = bytes,
    b64len = b64len,
    digest = digest,
    label = label,
    chunks = {},
    next = 1,
  }
  armTimeout()
end

local function finishTransfer(fields)
  if not transfer then return end
  if fields[2] ~= transfer.id then return end

  if tonumber(fields[3]) ~= transfer.total or transfer.next - 1 ~= transfer.total then
    return abortTransfer(string.format("got %d of %d records",
      transfer.next - 1, transfer.total), true)
  end

  local encoded = table.concat(transfer.chunks)
  if #encoded ~= transfer.b64len then
    return abortTransfer("payload was truncated in transit", true)
  end

  local ok, text = pcall(hs.base64.decode, encoded)
  if not ok or type(text) ~= "string" then
    return abortTransfer("payload did not decode", true)
  end
  if #text ~= transfer.bytes then
    return abortTransfer(string.format("expected %d bytes, got %d", transfer.bytes, #text), true)
  end
  -- "-" when the sending host had neither shasum nor sha256sum; the length
  -- checks above still stand.
  if transfer.digest and transfer.digest ~= "-"
      and hs.hash.SHA256(text):lower() ~= transfer.digest:lower() then
    return abortTransfer("checksum mismatch", true)
  end

  local label = transfer.label
  stopTimeout()
  transfer = nil

  hs.pasteboard.setContents(text)
  ignoredChangeCount = hs.pasteboard.changeCount()
  Preset.displayMessage("Copied " .. (label and (label .. " ") or "")
    .. "(" .. humanSize(#text) .. ") from Herdr", 1.5)
end

local function handleCopyRecord(fields)
  local kind = fields[1]

  if kind == "B" then
    return beginTransfer(fields)
  end

  if discarding and fields[2] == discarding then
    -- Tail of a transfer already written off. Its sender cannot be told to
    -- stop, so each remaining record is swept straight back off the clipboard;
    -- otherwise the last one it sends is what the user's next paste produces.
    restoreClipboard()
    if kind == "E" then discarding = nil end
    return
  end

  if not transfer or fields[2] ~= transfer.id then
    -- Tail of a transfer whose handshake we missed, or one already written
    -- off. Nothing to stitch it onto, and the clipboard is not ours to touch.
    util.log("herdrRelay: stray copy record", kind)
    return
  end

  if kind == "E" then
    return finishTransfer(fields)
  end

  if kind ~= "D" then
    return abortTransfer("unknown record type '" .. tostring(kind) .. "'", true)
  end

  local seq = tonumber(fields[3])
  local chunk = fields[4]
  if not seq or type(chunk) ~= "string" or not chunk:match("^[A-Za-z0-9+/]*=?=?$") then
    return abortTransfer("malformed record " .. tostring(fields[3]), true)
  end
  -- Records are numbered precisely so a dropped one is detectable: the poll
  -- only reports the newest clipboard, so a record that arrives inside another
  -- one's interval is lost silently. Better to fail than paste a file with a
  -- hole in it.
  if seq ~= transfer.next then
    return abortTransfer(string.format("record %d arrived where %d was expected",
      seq, transfer.next), true)
  end

  transfer.chunks[seq] = chunk
  transfer.next = seq + 1
  armTimeout()
end

---------------------------------------------------------------
-- Watcher
---------------------------------------------------------------

local function onPasteboardChange(contents)
  -- Ignore precisely the pasteboard mutation made by our own restore.
  if hs.pasteboard.changeCount() == ignoredChangeCount then
    ignoredChangeCount = nil
    if not transfer then snapshotClipboard() end
    return
  end

  local record = parseCopyRecord(contents)
  if record then
    handleCopyRecord(record)
    return
  end

  local url = decodeOpenRequest(contents)
  if url then
    -- Whatever the transfer was carrying is lost, but the snapshot it was
    -- holding is exactly what the URL request is about to restore.
    abortTransfer("interrupted by an open-url request", false)

    -- Consume the request before showing the dialog so the sentinel never
    -- remains available to paste into another app.
    restoreClipboard()
    showOpenDialog(url)
    return
  end

  -- An ordinary copy. Mid-transfer that means the user (or an app) put
  -- something on the clipboard while records were still arriving: the transfer
  -- cannot be completed, and their copy stays put rather than being rolled
  -- back to the older snapshot.
  if transfer then
    -- The abort snapshots THIS copy rather than restoring the older one, and
    -- the records still to come are then swept back off in favour of it.
    abortTransfer("clipboard was overwritten mid-transfer", false)
    return
  end

  -- Copied during the sweep: stop putting the old snapshot back over it.
  discarding = nil
  snapshotClipboard()
end

function M.setup()
  if _G._HerdrRelayWatcher then
    _G._HerdrRelayWatcher:stop()
  end
  -- The URL relay used to live in keybindings.lua with a watcher of its own;
  -- a reload from a session that still has it running would leave two.
  if _G._HerdrOpenClipboardWatcher then
    _G._HerdrOpenClipboardWatcher:stop()
    _G._HerdrOpenClipboardWatcher = nil
  end

  snapshotClipboard()
  ignoredChangeCount = nil
  transfer = nil
  discarding = nil

  hs.pasteboard.watcher.interval(POLL_INTERVAL)
  _G._HerdrRelayWatcher = hs.pasteboard.watcher.new(onPasteboardChange)
end

return M
