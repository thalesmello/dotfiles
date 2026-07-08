-- Minimal reimplementation of RRethy/nvim-treesitter-textsubjects for the
-- nvim-treesitter `main` branch.
--
-- The original plugin depended on master-only runtime modules
-- (nvim-treesitter.query / .parsers / .ts_utils) that `main` removed. This shim
-- keeps the exact behavior (query-driven "smart"/container expand, plus a
-- shrink-to-previous key) but runs entirely on builtin `vim.treesitter`.
--
-- It relies on the vendored query files under `queries/<lang>/textsubjects-*.scm`
-- (copied from the upstream repo). Those use two custom query extensions that
-- core `main` does not ship, so we register them here:
--   * `#make-range!` directive  -> stores a combined range in `metadata.range`
--   * `#not-kind-eq?` predicate  -> negation of the builtin-ish `kind-eq?`
-- (`#match?` is already builtin.)
--
-- The pure-Lua helpers (does_surround / is_equal / extend_range_with_whitespace
-- / normalize_selection) are ported verbatim from the upstream implementation.

local ts = vim.treesitter

local M = {}

-- array keyed by bufnr of { changedtick = number, [1] = range, [2] = sel_mode }
local prev_selections = {}

--------------------------------------------------------------------------------
-- Query extensions missing on core `main`
--------------------------------------------------------------------------------

local registered = false
local function register_query_extensions()
    if registered then
        return
    end
    registered = true

    -- (#make-range! "range" @start @end)
    -- Spans from the start of the first @start node to the end of the last @end
    -- node and records it as match-level metadata `range`.
    ts.query.add_directive('make-range!', function(match, _, _, pred, metadata)
        local starts = match[pred[3]]
        local ends = match[pred[4]]
        if not starts or not ends or #starts == 0 or #ends == 0 then
            return
        end
        local srow, scol = starts[1]:range()
        local _, _, erow, ecol = ends[#ends]:range()
        metadata.range = { srow, scol, erow, ecol }
    end, { force = true })

    -- (#not-kind-eq? @node "type" ...) -> true unless @node's type matches one
    -- of the given types.
    ts.query.add_predicate('not-kind-eq?', function(match, _, _, pred)
        local nodes = match[pred[2]]
        if not nodes or #nodes == 0 then
            return true
        end
        local node_type = nodes[1]:type()
        for i = 3, #pred do
            if node_type == pred[i] then
                return false
            end
        end
        return true
    end, { force = true })
end

--------------------------------------------------------------------------------
-- Range collection (replaces nvim-treesitter.query.get_capture_matches_recursively)
--------------------------------------------------------------------------------

--- Collect every `@range` (0-indexed, end-exclusive) produced by `group` across
--- all language trees in the buffer.
---@return integer[][]
local function get_ranges(bufnr, group)
    local ok, parser = pcall(ts.get_parser, bufnr)
    if not ok or not parser then
        return {}
    end
    parser:parse(true)

    local ranges = {}
    parser:for_each_tree(function(tree, ltree)
        local query = ts.query.get(ltree:lang(), group)
        if not query then
            return
        end
        local root = tree:root()
        for _, match, metadata in query:iter_matches(root, bufnr, 0, -1) do
            if metadata.range then
                local r = metadata.range
                table.insert(ranges, { r[1], r[2], r[3], r[4] })
            else
                -- Plain `@range` capture without #make-range!.
                for id, nodes in pairs(match) do
                    if query.captures[id] == 'range' then
                        local node = nodes[#nodes]
                        local srow, scol, erow, ecol = node:range()
                        table.insert(ranges, { srow, scol, erow, ecol })
                    end
                end
            end
        end
    end)
    return ranges
end

--------------------------------------------------------------------------------
-- Pure helpers (ported verbatim from upstream)
--------------------------------------------------------------------------------

--- @return boolean: true iff the range @a is equal to the range @b
local function is_equal(a, b)
    return a[1] == b[1] and a[2] == b[2] and a[3] == b[3] and a[4] == b[4]
end

--- @return boolean: true iff the range @a strictly surrounds the range @b. @a == @b => false.
local function does_surround(a, b)
    local a_start_row, a_start_col, a_end_row, a_end_col = a[1], a[2], a[3], a[4]
    local b_start_row, b_start_col, b_end_row, b_end_col = b[1], b[2], b[3], b[4]

    if a_start_row > b_start_row or a_start_row == b_start_row and a_start_col > b_start_col then
        return false
    end
    if a_end_row < b_end_row or a_end_row == b_end_row and a_end_col < b_end_col then
        return false
    end
    return a_start_row < b_start_row or
        a_start_col < b_start_col or
        a_end_row > b_end_row or
        a_end_col > b_end_col
end

--- extend_range_with_whitespace extends the selection to select any surrounding whitespace as part of the text object
local function extend_range_with_whitespace(range)
    local start_row, start_col, end_row, end_col = unpack(range)

    -- everything before the selection on the same lines as the start of the range
    local startline = string.sub(vim.fn.getline(start_row + 1), 1, start_col)
    local startline_len = #startline
    local startline_whitespace_len = #string.match(startline, '(%s*)$', 1)

    -- everything after the selection on the same lines as the end of the range
    local endline = string.sub(vim.fn.getline(end_row + 1), end_col + 1, -1)
    local endline_len = #endline
    local endline_whitespace_len = #string.match(endline, '^(%s*)', 1)

    local sel_mode
    if startline_whitespace_len == startline_len and endline_whitespace_len == endline_len then
        -- the text objects is the only thing on the lines in the range so we
        -- should use visual line mode
        sel_mode = 'V'
        if end_row + 1 < vim.fn.line('$') and
            start_row > 0 then
            if string.match(vim.fn.getline(end_row + 2), '^%s*$', 1) then
                -- we either have a blank line below AND above OR just below, in either case we want extend to the line below
                end_col = math.max(#vim.fn.getline(end_row + 2), 1)
                end_row = end_row + 1
            elseif string.match(vim.fn.getline(start_row), '^%s*$', 1) then
                -- we have a blank line above AND NOT below, we extend to the line above
                start_col = math.max(#vim.fn.getline(start_row), 1)
                start_row = start_row - 1
            end
        end
    else
        sel_mode = 'v'
        end_col = end_col + endline_whitespace_len
        if endline_whitespace_len == 0 and startline_whitespace_len ~= startline_len then
            start_col = start_col - startline_whitespace_len
        end
    end

    return { start_row, start_col, end_row, end_col }, sel_mode
end

local function normalize_selection(sel_start, sel_end)
    local _, sel_start_row, sel_start_col = unpack(sel_start)
    local start_max_cols = #vim.fn.getline(sel_start_row)
    -- visual line mode results in getpos("'>") returning a massive number so
    -- we have to set it to the true end col
    if start_max_cols < sel_start_col then
        sel_start_col = start_max_cols
    end
    -- tree-sitter uses zero-indexed rows
    sel_start_row = sel_start_row - 1
    -- tree-sitter uses zero-indexed cols for the start
    sel_start_col = sel_start_col - 1

    local _, sel_end_row, sel_end_col = unpack(sel_end)
    local end_max_cols = #vim.fn.getline(sel_end_row)
    -- visual line mode results in getpos("'>") returning a massive number so
    -- we have to set it to the true end col
    if end_max_cols < sel_end_col then
        sel_end_col = end_max_cols
    end
    -- tree-sitter uses zero-indexed rows
    sel_end_row = sel_end_row - 1

    return { sel_start_row, sel_start_col, sel_end_row, sel_end_col }
end

--------------------------------------------------------------------------------
-- Selection (replaces nvim-treesitter.ts_utils.update_selection)
--------------------------------------------------------------------------------

--- Set the visual selection to `range` (0-indexed, end-exclusive) in `sel_mode`.
local function update_selection(range, sel_mode)
    sel_mode = sel_mode or 'v'
    local srow, scol, erow, ecol = range[1], range[2], range[3], range[4]

    local vsrow, vscol = srow + 1, scol + 1
    local verow, vecol
    if ecol == 0 then
        verow = erow
        vecol = math.max(#vim.fn.getline(verow), 1)
    else
        verow, vecol = erow + 1, ecol
    end

    local mode = vim.fn.mode()
    if mode == 'v' or mode == 'V' or mode == '\22' then
        vim.cmd('normal! ' .. vim.api.nvim_replace_termcodes('<Esc>', true, true, true))
    end

    vim.fn.setpos('.', { 0, vsrow, vscol, 0 })
    vim.cmd('normal! ' .. sel_mode)
    vim.fn.setpos('.', { 0, verow, vecol, 0 })
end

--------------------------------------------------------------------------------
-- Public: select / prev_select
--------------------------------------------------------------------------------

function M.select(group, restore_visual, sel_start, sel_end)
    local bufnr = vim.api.nvim_get_current_buf()

    local sel = normalize_selection(sel_start, sel_end)
    local best
    for _, m in ipairs(get_ranges(bufnr, group)) do
        -- match must cover an exclusively bigger range than the current selection
        if does_surround(m, sel) then
            if not best or does_surround(best, m) then
                best = m
            end
        end
    end

    if best then
        local new_best, sel_mode = extend_range_with_whitespace(best)
        update_selection(new_best, sel_mode)
        local selections = prev_selections[bufnr]
        if selections == nil or not does_surround(new_best, selections[#selections][1]) then
            prev_selections[bufnr] = {
                { changedtick = vim.api.nvim_buf_get_changedtick(bufnr), new_best, sel_mode },
            }
        else
            table.insert(selections,
                { changedtick = vim.api.nvim_buf_get_changedtick(bufnr), new_best, sel_mode })
        end
        -- prefer going to start of text object while in visual mode
        vim.cmd('normal! o')
    else
        if restore_visual then
            vim.cmd('normal! gv')
        end
    end
end

function M.prev_select(sel_start, sel_end)
    local bufnr = vim.api.nvim_get_current_buf()
    local selections = prev_selections[bufnr]
    local sel = normalize_selection(sel_start, sel_end)
    if #vim.fn.getline(sel[1] + 1) == 0 then sel[2] = 1 end
    if #vim.fn.getline(sel[3] + 1) == 0 then sel[4] = 1 end
    local changedtick = vim.api.nvim_buf_get_changedtick(bufnr)

    -- Drop any previous selections from a different changedtick: the text
    -- *probably* changed and the stored ranges *may* now be invalid.
    while selections ~= nil and selections[#selections].changedtick ~= changedtick do
        table.remove(selections)
        if #selections == 0 then
            selections = nil
        end
    end

    if selections == nil then
        prev_selections[bufnr] = nil
        vim.cmd('normal! v')
        return
    end

    local head = selections[#selections][1]
    if is_equal(sel, head) or does_surround(sel, head) then
        table.remove(selections)
        if #selections == 0 then
            prev_selections[bufnr] = nil
            vim.cmd('normal! v')
            return
        end
    end

    local new_sel, sel_mode = unpack(selections[#selections])
    update_selection(new_sel, sel_mode)
    vim.cmd('normal! o')
end

--------------------------------------------------------------------------------
-- Setup
--------------------------------------------------------------------------------

local default_keymaps = {
    ['<cr>'] = 'textsubjects-smart',
}

function M.setup(opts)
    opts = opts or {}
    local keymaps = opts.keymaps or default_keymaps
    local prev_selection = opts.prev_selection or '<bs>'

    register_query_extensions()

    -- Mappings mirror upstream: operator-pending + visual, via `:lua` so that in
    -- visual mode `'<`/`'>` are set before select() reads them, and the pending
    -- operator applies to the selection created in operator-pending mode.
    for lhs, group in pairs(keymaps) do
        local o_rhs = string.format(
            [[:lua require('textsubjects_shim').select(%q, false, vim.fn.getpos('.'), vim.fn.getpos('.'))<cr>]],
            group)
        local x_rhs = string.format(
            [[:lua require('textsubjects_shim').select(%q, true, vim.fn.getpos("'<"), vim.fn.getpos("'>"))<cr>]],
            group)
        vim.keymap.set('o', lhs, o_rhs, { silent = true, desc = 'textsubjects: ' .. group })
        vim.keymap.set('x', lhs, x_rhs, { silent = true, desc = 'textsubjects: ' .. group })
    end

    if prev_selection and #prev_selection > 0 then
        local o_rhs =
            [[:lua require('textsubjects_shim').prev_select(vim.fn.getpos('.'), vim.fn.getpos('.'))<cr>]]
        local x_rhs =
            [[:lua require('textsubjects_shim').prev_select(vim.fn.getpos("'<"), vim.fn.getpos("'>"))<cr>]]
        vim.keymap.set('o', prev_selection, o_rhs, { silent = true, desc = 'textsubjects: previous selection' })
        vim.keymap.set('x', prev_selection, x_rhs, { silent = true, desc = 'textsubjects: previous selection' })
    end
end

return M
