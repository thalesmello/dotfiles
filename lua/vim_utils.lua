local function keycodes(str)
    return vim.api.nvim_replace_termcodes(str, true, true, true)
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

return {
    get_visual_selection = get_visual_selection,
    keycodes = keycodes,
}
