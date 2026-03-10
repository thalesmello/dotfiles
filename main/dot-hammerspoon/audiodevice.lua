local util = require("util")
local FISH = "/opt/homebrew/bin/fish"

local function setPreferredInputDevice()
  util.log("audiodevice: setting preferred input device")
  hs.task.new(FISH, function(exitCode, stdOut, stdErr)

    util.log("audiodevice: exitCode=", exitCode)
    if stdOut and #stdOut > 0 then util.log("audiodevice stdout:", stdOut) end
    if stdErr and #stdErr > 0 then util.log("audiodevice stderr:", stdErr) end
  end, {"-c", "set-preferred-input-device"}):start()
end

local function audioDeviceCallback(event)
  util.log("audiodevice: event=", event)
  if event == "dIn " then
    setPreferredInputDevice()
  end
end

hs.audiodevice.watcher.setCallback(audioDeviceCallback)
hs.audiodevice.watcher.start()
