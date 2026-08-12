--- Non-blocking progress display for background nvim-treesitter parser installs.
---
--- nvim-treesitter logs four lines per parser (Downloading / Compiling /
--- Installing / Language installed, see nvim-treesitter/install.lua), each via
--- `nvim_echo`. A cold start with a full `ensure_installed` list is therefore
--- ~56 messages, and more pending message lines than 'cmdheight' is precisely
--- what raises a hit-enter prompt -- so the install ends up interrupting you
--- repeatedly even though it is running asynchronously.
---
--- A floating window is not a message, so it can be redrawn as often as we like
--- without ever prompting. This module owns one such window, anchored bottom
--- right, showing a counter plus the languages currently in flight.

local M = {}

local MAX_ROWS = 6 -- in-flight languages listed before we elide the rest
local LINGER_MS = 1500 -- how long the final summary stays up

local state = {
    buf = nil,
    win = nil,
    active = {}, --- @type table<string, string> lang -> current phase
    order = {}, --- @type string[] langs, insertion-ordered, for stable display
    done = 0,
    total = 0,
    summary = nil, --- @type string? replaces the body once finished
    timer = nil,
}

local function win_valid()
    return state.win and vim.api.nvim_win_is_valid(state.win)
end

local function stop_timer()
    if state.timer then
        state.timer:stop()
        if not state.timer:is_closing() then
            state.timer:close()
        end
        state.timer = nil
    end
end

local function shutdown()
    stop_timer()
    if win_valid() then
        vim.api.nvim_win_close(state.win, true)
    end
    if state.buf and vim.api.nvim_buf_is_valid(state.buf) then
        vim.api.nvim_buf_delete(state.buf, { force = true })
    end
    state.buf, state.win = nil, nil
    state.active, state.order = {}, {}
    state.done, state.total, state.summary = 0, 0, nil
end

--- Build the text body from current state.
--- @return string[]
local function body()
    if state.summary then
        return { state.summary }
    end

    local lines = { string.format('treesitter: %d/%d parsers', state.done, state.total) }

    -- Only languages still in flight; `state.order` also holds finished ones so
    -- that display order stays stable, hence the separate count here.
    local active = {}
    for _, lang in ipairs(state.order) do
        if state.active[lang] then
            active[#active + 1] = lang
        end
    end

    for i, lang in ipairs(active) do
        if i > MAX_ROWS then
            lines[#lines + 1] = string.format('  ... and %d more', #active - MAX_ROWS)
            break
        end
        lines[#lines + 1] = string.format('  %s %s', state.active[lang], lang)
    end

    return lines
end

--- Draw (creating the window on first use). Must run on the main loop.
local function render()
    local lines = body()

    local width = 0
    for _, l in ipairs(lines) do
        width = math.max(width, vim.fn.strdisplaywidth(l))
    end
    width = math.max(18, math.min(width, vim.o.columns - 4))

    -- Keep the float clear of the cmdline so it never overlaps a real message.
    local row = vim.o.lines - vim.o.cmdheight - 1
    if vim.o.laststatus > 0 then
        row = row - 1
    end

    if not state.buf or not vim.api.nvim_buf_is_valid(state.buf) then
        state.buf = vim.api.nvim_create_buf(false, true)
        vim.bo[state.buf].bufhidden = 'wipe'
    end
    vim.bo[state.buf].modifiable = true
    vim.api.nvim_buf_set_lines(state.buf, 0, -1, false, lines)
    vim.bo[state.buf].modifiable = false

    local cfg = {
        relative = 'editor',
        anchor = 'SE',
        row = row,
        col = vim.o.columns - 1,
        width = width,
        height = #lines,
        style = 'minimal',
        border = 'rounded',
        focusable = false,
        zindex = 60,
    }

    if win_valid() then
        vim.api.nvim_win_set_config(state.win, cfg)
    else
        -- `noautocmd` only on creation; it is rejected by nvim_win_set_config.
        cfg.noautocmd = true
        state.win = vim.api.nvim_open_win(state.buf, false, cfg)
        vim.wo[state.win].winhighlight = 'Normal:NormalFloat,FloatBorder:FloatBorder'
        vim.wo[state.win].wrap = false
    end
end

--- Announce that `n` more languages have been queued.
--- @param n integer
function M.add(n)
    if n <= 0 then
        return
    end
    vim.schedule(function()
        stop_timer()
        state.summary = nil
        state.total = state.total + n
        render()
    end)
end

--- Record a phase change for `lang`.
--- @param lang string
--- @param phase string one of 'downloading' | 'compiling' | 'installing'
function M.phase(lang, phase)
    vim.schedule(function()
        if not state.active[lang] then
            state.order[#state.order + 1] = lang
        end
        state.active[lang] = phase
        render()
    end)
end

--- Record that `lang` finished.
--- @param lang string
function M.complete(lang)
    vim.schedule(function()
        state.active[lang] = nil
        state.done = state.done + 1
        render()
    end)
end

--- Show a closing summary, then tear the window down.
--- @param text string
function M.finish(text)
    vim.schedule(function()
        stop_timer()
        state.summary = text
        render()
        state.timer = vim.uv.new_timer()
        state.timer:start(LINGER_MS, 0, function()
            vim.schedule(shutdown)
        end)
    end)
end

--- Tear down immediately, discarding any pending state.
M.close = function()
    vim.schedule(shutdown)
end

return M
