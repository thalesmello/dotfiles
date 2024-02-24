local function keycodes(str)
    return vim.api.nvim_replace_termcodes(str, true, true, true)
end

--- @param str string keys to feed into editor
--- @param mode? 'n'|'m' mode passed to the feedkeys() function call, defaults to 'n'
local function feedkeys(str, mode)
    mode = mode or 'n'
    vim.api.nvim_feedkeys(keycodes(str), 'n', false)
end


local function get_visual_selection()
    vim.cmd.normal({ args = {keycodes("<esc>gv")}, bang = true })
    local line_start, column_start = unpack(vim.fn.getpos("'<"), 2, 3)
    local line_end, column_end = unpack(vim.fn.getpos("'>"), 2, 3)
    local lines = vim.api.nvim_buf_get_lines(0, line_start - 1, line_end, false)
    if #lines == 0 then
        return ''
    end
    lines[#lines] = string.sub(lines[#lines], 1, 1 + column_end - (vim.o.selection == 'inclusive' and 1 or 2))
    lines[1] = string.sub(lines[1], column_start)
    return table.concat(lines, "\n")
end

local function concat_array(a, b)
  local result = {unpack(a)}
  table.move(b, 1, #b, #result + 1, result)
  return result
end

local function partial(fn, ...)
  local args = { ... }

  return function(...)
    local args2 = { ... }
    local results = concat_array(args, args2)
    return fn(unpack(results, 1, #results))
  end
end


return {
    get_visual_selection = get_visual_selection,
    keycodes = keycodes,
    feedkeys = feedkeys,
    partial = partial,
    concat_array = concat_array,
}
