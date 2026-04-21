local M = {}

local timer = nil

local function check_visible_files()
    local seen = {}

    for _, win in ipairs(vim.api.nvim_list_wins()) do
        local buf = vim.api.nvim_win_get_buf(win)

        if not seen[buf] then
            seen[buf] = true
            local name = vim.api.nvim_buf_get_name(buf)

            if name ~= "" then
                vim.cmd("checktime " .. vim.fn.fnameescape(name))
            end
        end
    end
end

local function timer_callback()
    local ok, err = pcall(check_visible_files)

    if not ok then
        vim.notify("reloadfiles: timer disabled due to error: " .. tostring(err), vim.log.levels.ERROR)
        M.pause()
    end
end

function M.pause()
    if timer then
        timer:stop()
        timer:close()
        timer = nil
    end
end

function M.resume()
    if timer then
        return
    end

    timer = vim.uv.new_timer()
    timer:start(2000, 2000, vim.schedule_wrap(timer_callback))
end

function M.setup()
    M.resume()
end

return M
