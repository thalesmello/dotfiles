local util = require("util")
local Preset = require("preset")
local GhosttyPreset = require("ghosttyPreset")

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
--   herdr-paste the clipboard sent the OTHER way (`bin/herdr-paste`), which
--               the relay cannot do by itself -- see the paste section below
--
-- All three use RS/US-framed records carrying a versioned 128-bit namespace token,
-- which makes an accidental match on something a user actually copied
-- vanishingly unlikely. A record is never left on the clipboard: it is consumed
-- and the previous contents put back (or, for a copy, replaced by the text that
-- was being sent).
--
-- ONE WATCHER FOR ALL THREE is deliberate. The relay has to remember what was on the
-- clipboard BEFORE a request arrived in order to restore it, and separate
-- watchers would each snapshot the others' in-flight records as if they were
-- ordinary copies -- so a restore would put a half-finished transfer back on
-- the clipboard. A paste goes further and NEEDS that snapshot: the clipboard as
-- it stood before the request is the very thing being pasted.
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

-- Must match bin/herdr-paste. Records are
--   Q:<id>:<socket path b64>:<herdr-paste path b64>   asking to paste
--   R:<id>                                            receiver ready for cmd+v
local PASTE_PREFIX = "\30HERDR_PASTE_V1:2c8e4f6b91a74d0c8e3b5a72d1f09c46:"
local PASTE_SUFFIX = "\31"

-- Ceiling on what will be pushed through a pty as keystrokes. Well past any
-- clipboard worth pasting into a terminal, and short of the point where the
-- paste becomes the slow part.
local PASTE_MAX_BYTES = 1048576

-- How long the popup gets to open, start herdr-paste and announce itself.
-- Generous: it crosses ssh, and the popup is only driven once.
local PASTE_READY_TIMEOUT = 12

-- Appended to the base64 payload so the receiver knows where it ends without
-- depending on bracketed paste surviving every layer. Outside the base64
-- alphabet by construction.
local PASTE_TERMINATOR = "~"

-- Long enough for a clipboard write to be visible to Ghostty before the chord
-- that reads it, and for the chord to have been read before the clipboard is
-- put back. Same race (in both directions) that ghosttyPreset's
-- executeAndForgetHerdrCommand documents at length -- and the same 0.05 it has
-- used for the staging half of it for as long as it has existed.
local PASTE_SETTLE = 0.05
local PASTE_RELEASE = 0.5

-- The confirmation dialog took the focus off the terminal, and the chords that
-- drive the popup go to whatever is frontmost, so the terminal has to be back
-- before they are sent. This WATCHES for that rather than allowing a flat delay
-- long enough to cover the worst case: activation is usually done within a tick
-- or two, and every millisecond of a fixed wait is one the user spends looking
-- at a popup that has not been typed into yet.
local PASTE_REFOCUS_TICK = 0.02
local PASTE_REFOCUS_CAP = 0.6

-- Pasteboard polling. hs.pasteboard.watcher polls rather than subscribing, and
-- the callback only ever sees the LATEST contents -- two records landing inside
-- one interval means the first is gone. 0.05s (down from the 0.25s default)
-- halves the lag before a paste receiver's READY is noticed, and still leaves
-- herdr-copy's 0.2s pacing four times clear of it.
-- Module-wide and only read when a watcher is created, hence set before ours.
local POLL_INTERVAL = 0.05

---------------------------------------------------------------
-- Clipboard bookkeeping
---------------------------------------------------------------

-- Snapshot of the clipboard as it was before the request currently being
-- handled. A full UTI snapshot rather than the plain string, so restoring an
-- image or rich text does not flatten it.
local previousClipboard
local previousText
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
-- Paste being negotiated with a pane, or nil.
local pasteRequest

local function snapshotClipboard()
  previousClipboard = hs.pasteboard.readAllData()
  -- Kept alongside the UTI snapshot because a paste needs the TEXT, and by the
  -- time a paste request is read the clipboard no longer holds it.
  previousText = hs.pasteboard.readString()
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

-- Split a framed record into its ':'-separated fields, or nil when it is not
-- one of ours. Every field is either a token or base64, neither of which can
-- contain ':', so a plain split is unambiguous.
local function parseFramedRecord(contents, prefix, suffix)
  if type(contents) ~= "string" then return nil end
  if contents:sub(1, #prefix) ~= prefix then return nil end
  if contents:sub(-#suffix) ~= suffix then return nil end

  local body = contents:sub(#prefix + 1, -#suffix - 1)
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
-- herdr-paste: send this Mac's clipboard the other way
---------------------------------------------------------------

-- The relay is one-directional: a pane can WRITE our clipboard over OSC 52, but
-- nothing lets it read one. So a paste is done as a paste -- the pane opens a
-- program that takes over a tty, and this side sends it cmd+v, which is the one
-- path from the Mac's clipboard into a remote pty that always works.
--
-- The pane asks (Q), the user is asked, herdr's run-command popup is driven to
-- start the receiver, the receiver says it has the tty (R), and only then does
-- the payload go on the clipboard and the chord get sent. Waiting for R rather
-- than guessing at a delay is what makes this survive a slow ssh link.
--
-- What is pasted is BASE64 plus a terminator, never the text itself: no
-- newlines for Ghostty's paste protection to object to, no CR/LF for a layer in
-- between to translate, and an unambiguous end marker.

-- Paths arrive base64'd from a clipboard record, and one of them is about to be
-- run as a command on the other side. Nothing is trusted: the decoded path must
-- be plain and absolute, with no shell metacharacter, no whitespace and no
-- `..`, so that single-quoting it for the popup's `eval` cannot be escaped.
local function decodeRelayPath(field)
  if type(field) ~= "string" or field == "" or #field > 512 then return nil end
  if not field:match("^[A-Za-z0-9+/]*=?=?$") then return nil end
  local ok, path = pcall(hs.base64.decode, field)
  if not ok or type(path) ~= "string" then return nil end
  if not path:match("^/[A-Za-z0-9._/-]+$") or path:find("%.%.") then return nil end
  return path
end

local function endPaste()
  if pasteRequest and pasteRequest.timer then pasteRequest.timer:stop() end
  pasteRequest = nil
end

local function failPaste(reason)
  util.log("herdrRelay: paste failed:", reason)
  endPaste()
  hs.alert.show("Herdr paste failed\n" .. reason, 4)
end

-- Put the user's own clipboard back after the payload has been handed over.
-- From the request's own copy rather than the module snapshot, which by now has
-- been through the popup command's clipboard round trip.
local function restorePasteClipboard(request)
  if request.snapshot and next(request.snapshot) then
    hs.pasteboard.writeAllData(request.snapshot)
  else
    hs.pasteboard.setContents(request.text)
  end
  ignoredChangeCount = hs.pasteboard.changeCount()
  previousClipboard = hs.pasteboard.readAllData()
  previousText = request.text
end

-- Drive herdr's run-command popup, which is the only way back to a session that
-- may be remote. Held until `app` is frontmost again (it is the terminal, which
-- the confirmation dialog may have just taken the focus from), since the chords
-- go wherever the focus is. Capped, so a window that never comes back still
-- gets its attempt rather than the paste silently evaporating.
--
-- Single quotes throughout are safe -- decodeRelayPath has already refused
-- anything a quote could be broken out of.
local function drivePastePopup(app, command)
  local function frontmost()
    if not app then return true end
    local ok, front = pcall(hs.application.frontmostApplication)
    if not ok or not front then return false end
    local same, equal = pcall(function() return front:pid() == app:pid() end)
    return same and equal
  end

  local function go() GhosttyPreset.executeAndForgetHerdrCommand(command) end

  if frontmost() then return go() end

  local deadline = hs.timer.secondsSinceEpoch() + PASTE_REFOCUS_CAP
  local ticker
  ticker = hs.timer.doEvery(PASTE_REFOCUS_TICK, function()
    if frontmost() or hs.timer.secondsSinceEpoch() >= deadline then
      ticker:stop()
      go()
    end
  end)
end

-- Say no back to the pane instead of just dropping the request. The pane is
-- BLOCKED waiting -- it may be nvim's clipboard provider, with the editor
-- frozen behind it -- and its own timeout is a minute away.
local function declinePaste(app, bin, sock)
  drivePastePopup(app, string.format("'%s' --decline '%s'", bin, sock))
end

local function beginPaste(fields)
  -- The request record overwrote the clipboard, so what is being asked for is
  -- the snapshot from the previous tick. Putting it back is also how the record
  -- gets consumed -- FIRST, before any reason to refuse, since a rejected
  -- request left on the clipboard is a frame the next paste would produce.
  local snapshot, text = previousClipboard, previousText
  restoreClipboard()

  -- The terminal, captured before any dialog can take the focus off it: it is
  -- both what the dialog hands the focus back to and what the popup chords have
  -- to wait for.
  local terminal = hs.application.frontmostApplication()

  local id = fields[2]
  local sock = decodeRelayPath(fields[3])
  local bin = decodeRelayPath(fields[4])

  if not (id and id:match("^%x+$") and sock and bin) or not bin:match("/herdr%-paste$") then
    util.log("herdrRelay: ignoring malformed paste request")
    return
  end

  if pasteRequest then
    util.log("herdrRelay: a paste is already in flight; ignoring", id)
    return
  end

  if not text or text == "" then
    hs.alert.show("Herdr paste: the clipboard holds no text", 3)
    return declinePaste(terminal, bin, sock)
  end
  if #text > PASTE_MAX_BYTES then
    hs.alert.show(string.format("Herdr paste: %s is too much to type through a pty",
      humanSize(#text)), 4)
    return declinePaste(terminal, bin, sock)
  end

  -- blockAlert is backed by NSAlert, which needs Hammerspoon frontmost to be
  -- the key window -- and the terminal has to have the focus BACK before any
  -- chord is sent, hence the activate below and the wait inside drivePastePopup.
  hs.focus()
  local button = hs.dialog.blockAlert(
    "Paste clipboard into Herdr?",
    string.format("%s\n\n%s", humanSize(#text),
      (text:gsub("%s+", " "):sub(1, 160))),
    "Paste",
    "Cancel",
    "informational"
  )
  if terminal then terminal:activate(true) end
  if button ~= "Paste" then return declinePaste(terminal, bin, sock) end

  pasteRequest = {
    id = id,
    text = text,
    snapshot = snapshot,
    timer = hs.timer.doAfter(PASTE_READY_TIMEOUT, function()
      failPaste("the paste receiver never opened")
    end),
  }

  drivePastePopup(terminal, string.format("'%s' --receive '%s' --id %s", bin, sock, id))
end

local function readyPaste(fields)
  if not pasteRequest or fields[2] ~= pasteRequest.id then return end
  local request = pasteRequest
  if request.timer then request.timer:stop(); request.timer = nil end

  -- Overwrites the READY record, which is the receiver's own OSC 52 write.
  hs.pasteboard.setContents(hs.base64.encode(request.text) .. PASTE_TERMINATOR)
  ignoredChangeCount = hs.pasteboard.changeCount()

  hs.timer.doAfter(PASTE_SETTLE, function()
    if pasteRequest ~= request then return end
    Preset.sendKeys({"cmd", "v"})
    hs.timer.doAfter(PASTE_RELEASE, function()
      if pasteRequest ~= request then return end
      restorePasteClipboard(request)
      endPaste()
      Preset.displayMessage("Pasted " .. humanSize(#request.text) .. " into Herdr", 1.5)
    end)
  end)
end

local function handlePasteRecord(fields)
  local kind = fields[1]
  if kind == "Q" then return beginPaste(fields) end
  if kind == "R" then return readyPaste(fields) end
  util.log("herdrRelay: unknown paste record", tostring(kind))
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

  local record = parseFramedRecord(contents, COPY_PREFIX, COPY_SUFFIX)
  if record then
    handleCopyRecord(record)
    return
  end

  record = parseFramedRecord(contents, PASTE_PREFIX, PASTE_SUFFIX)
  if record then
    handlePasteRecord(record)
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
  pasteRequest = nil

  hs.pasteboard.watcher.interval(POLL_INTERVAL)
  _G._HerdrRelayWatcher = hs.pasteboard.watcher.new(onPasteboardChange)
end

return M
