local M = {}

local timer = nil

local function visible_filenames()
    local seen = {}
    local names = {}

    for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
        local buf = vim.api.nvim_win_get_buf(win)

        if seen[buf] then
            goto continue
        end

        seen[buf] = true

        if vim.bo[buf].buftype ~= "" then
            goto continue
        end

        local name = vim.api.nvim_buf_get_name(buf)

        if name ~= "" then
            table.insert(names, name)
        end

        ::continue::
    end

    return names
end

local function check_visible_files()
    for _, name in ipairs(visible_filenames()) do
        vim.cmd("checktime " .. vim.fn.fnameescape(name))
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
