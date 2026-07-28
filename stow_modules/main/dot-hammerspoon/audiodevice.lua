local util = require("util")
local shell = require("shell")

local M = {}

function M.setPreferredInputDevice()
  util.log("audiodevice: setting preferred input device")
  shell.fish("set-preferred-input-device")
end

function M.audioDeviceCallback(event)
  util.log("audiodevice: event=", event)
  if event == "dIn " then
    M.setPreferredInputDevice()
  end
end

function M.setup()
  hs.audiodevice.watcher.setCallback(M.audioDeviceCallback)
  hs.audiodevice.watcher.start()
end

-- TODO: This appears to not be working very well because it executes every time I manually override the microphone, so I need to investigate at some point
-- local usbWatcher = hs.usb.watcher.new(function(event)
--   util.log("audiodevice: usb event=", event.eventType, "productName=", event.productName)
--   if event.eventType == "added" then
--     M.setPreferredInputDevice()
--   end
-- end)
-- usbWatcher:start()

return M
