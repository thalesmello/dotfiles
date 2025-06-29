local H = {}

H.prepare_captures = function(captures)
  local is_capture = function(x) return type(x) == 'string' and x:sub(1, 1) == '@' end

  if not (type(captures) == 'table' and is_capture(captures.outer) and is_capture(captures.inner)) then
    H.error('Wrong format for `captures`. See `MiniSurround.gen_spec.input.treesitter()` for details.')
  end

  return { outer = captures.outer, inner = captures.inner }
end

H.get_matched_node_pairs_plugin = function(captures)
  local ts_queries = require('nvim-treesitter.query')
  local ts_parsers = require('nvim-treesitter.parsers')

  -- This is a modified version of `ts_queries.get_capture_matches_recursively`
  -- source code which keeps track of match language
  local matches = {}
  local parser = ts_parsers.get_parser(0)
  if parser then
    parser:for_each_tree(function(tree, lang_tree)
      local lang = lang_tree:lang()
      local lang_matches = ts_queries.get_capture_matches(0, captures.outer, 'textobjects', tree:root(), lang)
      for _, m in pairs(lang_matches) do
        m.lang = lang
      end
      vim.list_extend(matches, lang_matches)
    end)
  end

  return vim.tbl_map(
    function(match)
      local node_outer = match.node
      -- Pick inner node as the biggest node matching inner query. This is
      -- needed because query output is not quaranteed to come in order.
      local matches_inner = ts_queries.get_capture_matches(0, captures.inner, 'textobjects', node_outer, match.lang)
      local nodes_inner = vim.tbl_map(function(x) return x.node end, matches_inner)
      return { outer = node_outer, inner = H.get_biggest_node(nodes_inner) }
    end,
    -- This call should handle multiple languages in buffer
    matches
  )
end

H.pos_to_left = function(pos)
  if pos.line == 1 and pos.col == 1 then return { line = pos.line, col = pos.col } end
  if pos.col == 1 then return { line = pos.line - 1, col = H.get_line_cols(pos.line - 1) } end
  return { line = pos.line, col = pos.col - 1 }
end

H.get_line_cols = function(line_num) return vim.fn.getline(line_num):len() end

H.pos_to_right = function(pos)
  local n_cols = H.get_line_cols(pos.line)
  -- Using `>` and not `>=` helps with removing '\n' and in the last line
  if pos.line == vim.api.nvim_buf_line_count(0) and pos.col > n_cols then return { line = pos.line, col = n_cols } end
  if pos.col > n_cols then return { line = pos.line + 1, col = 1 } end
  return { line = pos.line, col = pos.col + 1 }
end

H.get_matched_node_pairs_builtin = function(captures)
  -- Fetch treesitter data for buffer
  local lang = vim.bo.filetype
  -- TODO: Remove `opts.error` after compatibility with Neovim=0.11 is dropped
  local has_parser, parser = pcall(vim.treesitter.get_parser, 0, lang, { error = false })
  if not has_parser or parser == nil then H.error_treesitter('parser', lang) end

  local get_query = vim.fn.has('nvim-0.9') == 1 and vim.treesitter.query.get or vim.treesitter.get_query
  local query = get_query(lang, 'textobjects')
  if query == nil then H.error_treesitter('query', lang) end

  -- Remove leading '@'
  local capture_outer, capture_inner = captures.outer:sub(2), captures.inner:sub(2)

  -- Compute nodes matching outer capture
  local nodes_outer = {}
  for _, tree in ipairs(parser:trees()) do
    vim.list_extend(nodes_outer, H.get_builtin_matched_nodes(capture_outer, tree:root(), query))
  end

  -- Make node pairs with biggest node matching inner capture inside outer node
  return vim.tbl_map(function(node_outer)
    local nodes_inner = H.get_builtin_matched_nodes(capture_inner, node_outer, query)
    return { outer = node_outer, inner = H.get_biggest_node(nodes_inner) }
  end, nodes_outer)
end

H.get_builtin_matched_nodes = function(capture, root, query)
  local res = {}
  for capture_id, node, _ in query:iter_captures(root, 0) do
    if query.captures[capture_id] == capture then table.insert(res, node) end
  end
  return res
end

H.get_biggest_node = function(node_arr)
  local best_node, best_byte_count = nil, -math.huge
  for _, node in ipairs(node_arr) do
    local _, _, start_byte = node:start()
    local _, _, end_byte = node:end_()
    local byte_count = end_byte - start_byte + 1
    if best_byte_count < byte_count then
      best_node, best_byte_count = node, byte_count
    end
  end

  return best_node
end

H.error_treesitter = function(failed_get, lang)
  local bufnr = vim.api.nvim_get_current_buf()
  local msg = string.format([[Can not get %s for buffer %d and language '%s'.]], failed_get, bufnr, lang)
  H.error(msg)
end

H.input_treesitter = function(captures, opts)
  opts = vim.tbl_deep_extend('force', { use_nvim_treesitter = true }, opts or {})
  captures = H.prepare_captures(captures)

  return function()
    -- Get array of matched treesitter nodes
    local has_nvim_treesitter = pcall(require, 'nvim-treesitter') and pcall(require, 'nvim-treesitter.query')
    local node_pair_querier = (has_nvim_treesitter and opts.use_nvim_treesitter) and H.get_matched_node_pairs_plugin
      or H.get_matched_node_pairs_builtin
    local matched_node_pairs = node_pair_querier(captures)

    -- Return array of region pairs
    return vim.tbl_map(function(node_pair)
      -- `node:range()` returns 0-based numbers for end-exclusive region
      local left_from_line, left_from_col, right_to_line, right_to_col = node_pair.outer:range()
      local left_from = { line = left_from_line + 1, col = left_from_col + 1 }
      local right_to = { line = right_to_line + 1, col = right_to_col }

      local left_to, right_from
      if node_pair.inner == nil then
        left_to = right_to
        right_from = H.pos_to_right(right_to)
        right_to = nil
      else
        local left_to_line, left_to_col, right_from_line, right_from_col = node_pair.inner:range()
        left_to = { line = left_to_line + 1, col = left_to_col + 1 }
        right_from = { line = right_from_line + 1, col = right_from_col }
        -- Take into account that inner capture should be both edges exclusive
        left_to, right_from = H.pos_to_left(left_to), H.pos_to_right(right_from)
      end

      return { left = { from = left_from, to = left_to }, right = { from = right_from, to = right_to } }
    end, matched_node_pairs)
  end
end


H.wrap_callable_table = function(x)
  if vim.is_callable(x) and type(x) == 'table' then return function(...) return x(...) end end
  return x
end


H.is_composed_pattern = function(x)
  if not (H.islist(x) and #x > 0) then return false end
  for _, val in ipairs(x) do
    local val_type = type(val)
    if not (val_type == 'table' or val_type == 'string' or vim.is_callable(val)) then return false end
  end
  return true
end

H.ns_id = {
  input = vim.api.nvim_create_namespace('MiniSurroundAdapter'),
}

H.user_input = function(prompt, text)
  -- Major issue with both `vim.fn.input()` is that the only way to distinguish
  -- cancelling with `<Esc>` and entering empty string with immediate `<CR>` is
  -- through `cancelreturn` option (see `:h input()`). In that case the return
  -- of `cancelreturn` will mean actual cancel, which removes possibility of
  -- using that string. Although doable with very obscure string, this is not
  -- very clean.
  -- Overcome this by adding temporary keystroke listener.
  local on_key = vim.on_key or vim.register_keystroke_callback
  local was_cancelled = false
  on_key(function(key)
    if key == vim.api.nvim_replace_termcodes('<Esc>', true, true, true) then was_cancelled = true end
  end, H.ns_id.input)

  -- Ask for input
  -- NOTE: it would be GREAT to make this work with `vim.ui.input()` but I
  -- didn't find a way to make it work without major refactor of whole module.
  -- The main issue is that `vim.ui.input()` is designed to perform action in
  -- callback and current module design is to get output immediately. Although
  -- naive approach of
  -- `local res; vim.ui.input({...}, function(input) res = input end)`
  -- works in default `vim.ui.input`, its reimplementations can return from it
  -- immediately and proceed in main event loop. Couldn't find a relatively
  -- simple way to stop execution of this current function until `ui.input()`'s
  -- callback finished execution.
  local opts = { prompt = '(mini.surround) ' .. prompt .. ': ', default = text or '' }
  vim.cmd('echohl Question')
  -- Use `pcall` to allow `<C-c>` to cancel user input
  local ok, res = pcall(vim.fn.input, opts)
  vim.cmd([[echohl None | echo '' | redraw]])

  -- Stop key listening
  on_key(nil, H.ns_id.input)

  if not ok or was_cancelled then return end
  return res
end

H.from_mini = function (surr_spec)

    local input = surr_spec.input
    local output = surr_spec.output

    return {
        add = function ()
            local res = output
            if vim.is_callable(res) then res = res() end
            if not H.is_surrounding_info(res, "output") then return nil end
            if H.is_composed_pattern(res) then res = vim.tbl_map(H.wrap_callable_table, res) end

            return { res.left, res.right }
        end,
        find = function ()
            local res = input
            if vim.is_callable(res) then res = res() end
            if not H.is_surrounding_info(res, "input") then return nil end
            if H.is_composed_pattern(res) then res = vim.tbl_map(H.wrap_callable_table, res) end
            local surr = H.find_surrounding_region_pair(res)

            return {
                first_pos = { surr.left.from.line, surr.left.from.col },
                last_pos = { surr.right.from.line, surr.right.from.col }
            }
        end,
        delete = function ()
            local res = input
            if vim.is_callable(res) then res = res() end
            if not H.is_surrounding_info(res, "input") then return nil end
            if H.is_composed_pattern(res) then res = vim.tbl_map(H.wrap_callable_table, res) end
            local surr = H.find_surrounding_region_pair(res)
            return {
                left = {
                    first_pos = { surr.left.from.line, surr.left.from.col },
                    last_pos = { surr.left.to.line, surr.left.to.col },
                },
                right = {
                    first_pos = { surr.right.from.line, surr.right.from.col },
                    last_pos = { surr.right.to.line, surr.right.to.col },
                }
            }
        end
    }

end

H.find_surrounding_region_pair = function(surr_spec, opts)
    if surr_spec == nil then return end
    if H.is_region_pair(surr_spec) then return surr_spec end

    local cur_pos = vim.api.nvim_win_get_cursor(0)
    local reference_region = { from = { line = cur_pos[1], col = cur_pos[2] + 1 } }
    local n_times, n_lines = vim.v.count1, 20

    opts = vim.tbl_deep_extend('force', {search_method = "cover"}, opts or {})

    if n_times == 0 then return end

    -- Find `n_times` matching spans evolving from reference region span
    -- First try to find inside 0-neighborhood
    local neigh = H.get_neighborhood(reference_region, 0)
    local reference_span = neigh.region_to_span(reference_region)

    local find_next = function(cur_reference_span)
        local res = H.find_best_match(neigh, surr_spec, cur_reference_span, opts)

        -- If didn't find in 0-neighborhood, possibly try extend one
        if res.span == nil then
            -- Stop if no need to extend neighborhood
            if n_lines == 0 or neigh.n_neighbors > 0 then return {} end

            -- Update data with respect to new neighborhood
            local cur_reference_region = neigh.span_to_region(cur_reference_span)
            neigh = H.get_neighborhood(reference_region, n_lines)
            reference_span = neigh.region_to_span(reference_region)
            cur_reference_span = neigh.region_to_span(cur_reference_region)

            -- Recompute based on new neighborhood
            res = H.find_best_match(neigh, surr_spec, cur_reference_span, opts)
        end

        return res
    end

    local find_res = { span = reference_span }
    for _ = 1, n_times do
        find_res = find_next(find_res.span)
        if find_res.span == nil then return end
    end

    -- Extract final span
    local extract = function(span, extract_pattern)
        -- Use table extract pattern to allow array of regions as surrounding spec
        -- Pair of spans is constructed based on best region pair
        if type(extract_pattern) == 'table' then return extract_pattern end

        -- First extract local (with respect to best matched span) surrounding spans
        local s = neigh['1d']:sub(span.from, span.to - 1)
        local local_surr_spans = H.extract_surr_spans(s, extract_pattern)

        -- Convert local spans to global
        local off = span.from - 1
        local left, right = local_surr_spans.left, local_surr_spans.right
        return {
            left = { from = left.from + off, to = left.to + off },
            right = { from = right.from + off, to = right.to + off },
        }
    end

    local final_spans = extract(find_res.span, find_res.extract_pattern)
    local outer_span = { from = final_spans.left.from, to = final_spans.right.to }

    -- Ensure that output region is different from reference.
    if H.is_span_covering(reference_span, outer_span) then
        find_res = find_next(find_res.span)
        if find_res.span == nil then return end
        final_spans = extract(find_res.span, find_res.extract_pattern)
        outer_span = { from = final_spans.left.from, to = final_spans.right.to }
        if H.is_span_covering(reference_span, outer_span) then return end
    end

    -- Convert to region pair
    return { left = neigh.span_to_region(final_spans.left), right = neigh.span_to_region(final_spans.right) }
end


H.find_best_match = function(neighborhood, surr_spec, reference_span, opts)
    local best_span, best_nested_pattern, current_nested_pattern
    local f = function(span)
        if H.is_better_span(span, best_span, reference_span, opts) then
            best_span = span
            best_nested_pattern = current_nested_pattern
        end
    end

    if H.is_region_pair_array(surr_spec) then
        -- Iterate over all spans representing outer regions in array
        for _, region_pair in ipairs(surr_spec) do
            -- Construct outer region used to find best region pair
            local outer_region = { from = region_pair.left.from, to = region_pair.right.to or region_pair.right.from }

            -- Consider outer region only if it is completely within neighborhood
            if neighborhood.is_region_inside(outer_region) then
                -- Make future extract pattern based directly on region pair
                current_nested_pattern = {
                    {
                        left = neighborhood.region_to_span(region_pair.left),
                        right = neighborhood.region_to_span(region_pair.right),
                    },
                }

                f(neighborhood.region_to_span(outer_region))
            end
        end
    else
        -- Iterate over all matched spans
        for _, nested_pattern in ipairs(H.cartesian_product(surr_spec)) do
            current_nested_pattern = nested_pattern
            H.iterate_matched_spans(neighborhood['1d'], nested_pattern, f)
        end
    end

    local extract_pattern
    if best_nested_pattern ~= nil then extract_pattern = best_nested_pattern[#best_nested_pattern] end
    return { span = best_span, extract_pattern = extract_pattern }
end

H.iterate_matched_spans = function(line, nested_pattern, f)
    local max_level = #nested_pattern
    -- Keep track of visited spans to ensure only one call of `f`.
    -- Example: `((a) (b))`, `{'%b()', '%b()'}`
    local visited = {}

    local process
    process = function(level, level_line, level_offset)
        local pattern = nested_pattern[level]
        local next_span = function(s, init) return H.string_find(s, pattern, init) end
        if vim.is_callable(pattern) then next_span = pattern end

        local is_same_balanced = type(pattern) == 'string' and pattern:match('^%%b(.)%1$') ~= nil
        local init = 1
        while init <= level_line:len() do
            local from, to = next_span(level_line, init)
            if from == nil then break end

            if level == max_level then
                local found_match = H.new_span(from + level_offset, to + level_offset)
                local found_match_id = string.format('%s_%s', found_match.from, found_match.to)
                if not visited[found_match_id] then
                    f(found_match)
                    visited[found_match_id] = true
                end
            else
                local next_level_line = level_line:sub(from, to)
                local next_level_offset = level_offset + from - 1
                process(level + 1, next_level_line, next_level_offset)
            end

            -- Start searching from right end to implement "balanced" pair.
            -- This doesn't work with regular balanced pattern because it doesn't
            -- capture nested brackets.
            init = (is_same_balanced and to or from) + 1
        end
    end

    process(1, line, 0)
end


H.is_span_equal = function(span_1, span_2)
    if span_1 == nil or span_2 == nil then return false end
    return (span_1.from == span_2.from) and (span_1.to == span_2.to)
end

H.is_span_covering = function(span, span_to_cover)
    if span == nil or span_to_cover == nil then return false end
    if span.from == span.to then
        return (span.from == span_to_cover.from) and (span_to_cover.to == span.to)
    end
    if span_to_cover.from == span_to_cover.to then
        return (span.from <= span_to_cover.from) and (span_to_cover.to < span.to)
    end

    return (span.from <= span_to_cover.from) and (span_to_cover.to <= span.to)
end


H.get_neighborhood = function(reference_region, n_neighbors)
    -- Compute '2d neighborhood' of (possibly empty) region
    local from_line, to_line = reference_region.from.line, (reference_region.to or reference_region.from).line
    local line_start = math.max(1, from_line - n_neighbors)
    local line_end = math.min(vim.api.nvim_buf_line_count(0), to_line + n_neighbors)
    local neigh2d = vim.api.nvim_buf_get_lines(0, line_start - 1, line_end, false)
    -- Append 'newline' character to distinguish between lines in 1d case
    for k, v in pairs(neigh2d) do
        neigh2d[k] = v .. '\n'
    end

    -- '1d neighborhood': position is determined by offset from start
    local neigh1d = table.concat(neigh2d, '')

    -- Convert 2d buffer position to 1d offset
    local pos_to_offset = function(pos)
        if pos == nil then return nil end
        local line_num = line_start
        local offset = 0
        while line_num < pos.line do
            offset = offset + neigh2d[line_num - line_start + 1]:len()
            line_num = line_num + 1
        end

        return offset + pos.col
    end

    -- Convert 1d offset to 2d buffer position
    local offset_to_pos = function(offset)
        if offset == nil then return nil end
        local line_num = 1
        local line_offset = 0
        while line_num <= #neigh2d and line_offset + neigh2d[line_num]:len() < offset do
            line_offset = line_offset + neigh2d[line_num]:len()
            line_num = line_num + 1
        end

        return { line = line_start + line_num - 1, col = offset - line_offset }
    end

    -- Convert 2d region to 1d span
    local region_to_span = function(region)
        if region == nil then return nil end
        local is_empty = region.to == nil
        local to = region.to or region.from
        return { from = pos_to_offset(region.from), to = pos_to_offset(to) + (is_empty and 0 or 1) }
    end

    -- Convert 1d span to 2d region
    local span_to_region = function(span)
        if span == nil then return nil end
        -- NOTE: this might lead to outside of line positions due to added `\n` at
        -- the end of lines in 1d-neighborhood.
        local res = { from = offset_to_pos(span.from) }

        -- Convert empty span to empty region
        if span.from < span.to then res.to = offset_to_pos(span.to - 1) end
        return res
    end

    local is_region_inside = function(region)
        local res = line_start <= region.from.line
        if region.to ~= nil then res = res and (region.to.line <= line_end) end
        return res
    end

    return {
        n_neighbors = n_neighbors,
        region = reference_region,
        ['1d'] = neigh1d,
        ['2d'] = neigh2d,
        pos_to_offset = pos_to_offset,
        offset_to_pos = offset_to_pos,
        region_to_span = region_to_span,
        span_to_region = span_to_region,
        is_region_inside = is_region_inside,
    }
end

H.is_region_pair = function(x)
    if type(x) ~= 'table' then return false end
    return H.is_region(x.left) and H.is_region(x.right)
end


H.is_region = function(x)
    if type(x) ~= 'table' then return false end
    local from_is_valid = type(x.from) == 'table' and type(x.from.line) == 'number' and type(x.from.col) == 'number'
    -- Allow `to` to be `nil` to describe empty regions
    local to_is_valid = true
    if x.to ~= nil then
        to_is_valid = type(x.to) == 'table' and type(x.to.line) == 'number' and type(x.to.col) == 'number'
    end
    return from_is_valid and to_is_valid
end

H.is_region_pair_array = function(x)
    if not H.islist(x) then return false end
    for _, v in ipairs(x) do
        if not H.is_region_pair(v) then return false end
    end
    return true
end


H.islist = vim.islist

H.cartesian_product = function(arr)
    if not (type(arr) == 'table' and #arr > 0) then return {} end
    arr = vim.tbl_map(function(x) return H.islist(x) and x or { x } end, arr)

    local res, cur_item = {}, {}
    local process
    process = function(level)
        for i = 1, #arr[level] do
            table.insert(cur_item, arr[level][i])
            if level == #arr then
                -- Flatten array to allow tables as elements of step tables
                table.insert(res, H.tbl_flatten(cur_item))
            else
                process(level + 1)
            end
            table.remove(cur_item, #cur_item)
        end
    end

    process(1)
    return res
end


H.tbl_flatten = function(x)
    return vim.iter(x):flatten(math.huge):totable()
end

H.is_better_span = function(candidate, current, reference, opts)
    -- Candidate should be never equal or nested inside reference
    if H.is_span_covering(reference, candidate) or H.is_span_equal(candidate, reference) then return false end

    return H.span_compare_methods[opts.search_method](candidate, current, reference)
end

H.new_span = function(from, to) return { from = from, to = to == nil and from or (to + 1) } end

H.string_find = function(s, pattern, init)
    init = init or 1

    -- Match only start of full string if pattern says so.
    -- This is needed because `string.find()` doesn't do this.
    -- Example: `string.find('(aaa)', '^.*$', 4)` returns `4, 5`
    if pattern:sub(1, 1) == '^' then
        if init > 1 then return nil end
        return string.find(s, pattern)
    end

    -- Handle patterns `x.-y` differently: make match as small as possible. This
    -- doesn't allow `x` be present inside `.-` match, just as with `yyy`. Which
    -- also leads to a behavior similar to punctuation id (like with `va_`): no
    -- covering is possible, only next, previous, or nearest.
    local check_left, _, prev = string.find(pattern, '(.)%.%-')
    local is_pattern_special = check_left ~= nil and prev ~= '%'
    if not is_pattern_special then return string.find(s, pattern, init) end

    -- Make match as small as possible
    local from, to = string.find(s, pattern, init)
    if from == nil then return end

    local cur_from, cur_to = from, to
    while cur_to == to do
        from, to = cur_from, cur_to
        cur_from, cur_to = string.find(s, pattern, cur_from + 1)
    end

    return from, to
end


H.span_compare_methods = {
    cover = function(candidate, current, reference)
        local res = H.is_better_covering_span(candidate, current, reference)
        if res ~= nil then return res end
        -- If both are not covering, `candidate` is not better (as it must cover)
        return false
    end,

    cover_or_next = function(candidate, current, reference)
        local res = H.is_better_covering_span(candidate, current, reference)
        if res ~= nil then return res end

        -- If not covering, `candidate` must be "next" and closer to reference
        if not H.is_span_on_left(reference, candidate) then return false end
        if current == nil then return true end

        local dist = H.span_distance.next
        return dist(candidate, reference) < dist(current, reference)
    end,

    cover_or_prev = function(candidate, current, reference)
        local res = H.is_better_covering_span(candidate, current, reference)
        if res ~= nil then return res end

        -- If not covering, `candidate` must be "previous" and closer to reference
        if not H.is_span_on_left(candidate, reference) then return false end
        if current == nil then return true end

        local dist = H.span_distance.prev
        return dist(candidate, reference) < dist(current, reference)
    end,

    cover_or_nearest = function(candidate, current, reference)
        local res = H.is_better_covering_span(candidate, current, reference)
        if res ~= nil then return res end

        -- If not covering, `candidate` must be closer to reference
        if current == nil then return true end

        local dist = H.span_distance.near
        return dist(candidate, reference) < dist(current, reference)
    end,

    next = function(candidate, current, reference)
        if H.is_span_covering(candidate, reference) then return false end

        -- `candidate` must be "next" and closer to reference
        if not H.is_span_on_left(reference, candidate) then return false end
        if current == nil then return true end

        local dist = H.span_distance.next
        return dist(candidate, reference) < dist(current, reference)
    end,

    prev = function(candidate, current, reference)
        if H.is_span_covering(candidate, reference) then return false end

        -- `candidate` must be "previous" and closer to reference
        if not H.is_span_on_left(candidate, reference) then return false end
        if current == nil then return true end

        local dist = H.span_distance.prev
        return dist(candidate, reference) < dist(current, reference)
    end,

    nearest = function(candidate, current, reference)
        if H.is_span_covering(candidate, reference) then return false end

        -- `candidate` must be closer to reference
        if current == nil then return true end

        local dist = H.span_distance.near
        return dist(candidate, reference) < dist(current, reference)
    end,
}


H.extract_surr_spans = function(s, extract_pattern)
  local positions = { s:match(extract_pattern) }

  local is_all_numbers = true
  for _, pos in ipairs(positions) do
    if type(pos) ~= 'number' then is_all_numbers = false end
  end

  local is_valid_positions = is_all_numbers and (#positions == 2 or #positions == 4)
  if not is_valid_positions then
    local msg = 'Could not extract proper positions (two or four empty captures) from '
      .. string.format([[string '%s' with extraction pattern '%s'.]], s, extract_pattern)
    H.error(msg)
  end

  if #positions == 2 then
    return { left = H.new_span(1, positions[1] - 1), right = H.new_span(positions[2], s:len()) }
  end
  return { left = H.new_span(positions[1], positions[2] - 1), right = H.new_span(positions[3], positions[4] - 1) }
end

H.is_better_covering_span = function(candidate, current, reference)
  local candidate_is_covering = H.is_span_covering(candidate, reference)
  local current_is_covering = H.is_span_covering(current, reference)

  if candidate_is_covering and current_is_covering then
    -- Covering candidate is better than covering current if it is narrower
    return (candidate.to - candidate.from) < (current.to - current.from)
  end
  if candidate_is_covering and not current_is_covering then return true end
  if not candidate_is_covering and current_is_covering then return false end

  -- Return `nil` if neither span is covering
  return nil
end

H.is_surrounding_info = function(x, sur_type)
  if sur_type == 'input' then
    return H.is_composed_pattern(x) or H.is_region_pair(x) or H.is_region_pair_array(x)
  elseif sur_type == 'output' then
    return (type(x) == 'table' and type(x.left) == 'string' and type(x.right) == 'string')
  end
end

return H
