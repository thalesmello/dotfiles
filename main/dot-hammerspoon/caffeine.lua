local M = {}

function M.setCaffeineDisplay(state)
  if state then
    M._caffeine:setIcon("caffeine-on.pdf")
  else
    M._caffeine:setIcon("caffeine-off.pdf")
  end
end


function M.toggleCaffeine()
  M.setCaffeineDisplay(hs.caffeinate.toggle("displayIdle"))
end

function M.load()
  M._caffeine = hs.menubar.new()

  if M._caffeine then
    M._caffeine:setClickCallback(M.toggleCaffeine)
    M.setCaffeineDisplay(hs.caffeinate.get("displayIdle"))
  end
end

return M

-- Exmaple
-- hs.hotkey.bind(mash.ctrlShiftCmd, "c", function() caffeineClicked() end)
