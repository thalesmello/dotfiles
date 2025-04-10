local M = {}
function M.keycodes(str)
    return vim.api.nvim_replace_termcodes(str, true, true, true)
end

--- @param str string keys to feed into editor
--- @param mode? 'n'|'m' mode passed to the feedkeys() function call, defaults to 'n'
function M.feedkeys(str, mode)
    mode = mode or 'n'
    vim.api.nvim_feedkeys(M.keycodes(str), 'n', false)
end

function M.get_visual_selection(mode)
    mode = mode or 'char'
    vim.cmd.normal({ args = {M.keycodes([[<c-\><c-n>gv]])}, bang = true })
    local line_start, column_start = unpack(vim.fn.getpos("'<"), 2, 3)
    local line_end, column_end = unpack(vim.fn.getpos("'>"), 2, 3)
    local lines = vim.api.nvim_buf_get_lines(0, line_start - 1, line_end, false)
    if #lines == 0 then
        return ''
    end

    if mode == "char" then
        lines[#lines] = string.sub(lines[#lines], 1, 1 + column_end - (vim.o.selection == 'inclusive' and 1 or 2))
        lines[1] = string.sub(lines[1], column_start)
    elseif mode == "block" then
        for num, line in ipairs(lines) do
            lines[num] = line:sub(column_start, 1 + column_end - (vim.o.selection == 'inclusive' and 1 or 2))
        end
    end

    return table.concat(lines, "\n")
end

function M.concat_array(a, b)
  local result = {unpack(a)}
  table.move(b, 1, #b, #result + 1, result)
  return result
end

function M.partial(fn, ...)
  local args = { ... }

  return function(...)
    local args2 = { ... }
    local results = M.concat_array(args, args2)
    return fn(unpack(results, 1, #results))
  end
end


function M.temporary_highlight(start_pos, end_pos, opts)
    local api = vim.api
    opts = opts or {}
    local bufnr = api.nvim_get_current_buf()
    local timeout = opts.timeout or 500
    local highlight = opts.highlitght or "IncSearch"
    local namespace = vim.api.nvim_create_namespace(opts.namespace or "temporary_highlight")
    local mode = opts.mode or "char"
    local inclusive = opts.inclusive or false

    local regtype = ({
        char = 'v',
        block = '<CTRL-V>',
        line = 'V',
    })[mode]

    api.nvim_buf_clear_namespace(bufnr, namespace, 0, -1)

    vim.highlight.range(0,namespace, highlight, start_pos, end_pos, {
        inclusive = inclusive,
        regtype = regtype,
    })

    vim.defer_fn(function()
        if api.nvim_buf_is_valid(bufnr) then
            api.nvim_buf_clear_namespace(bufnr, namespace, 0, -1)
        end
    end, timeout)
end


function M.create_vimscript_function(name, fn)
    local luafunc_name = '__' .. name .. '_luafunc'
    _G[luafunc_name] = fn
    vim.cmd([[
function! ]] .. name .. [[(val)
        call v:lua.]] .. luafunc_name .. [[(a:val)
endfunction
]])

    return name
end

function M.injector_module(spec)
    local parent_module = spec[1]

    local injectable_opts = spec.injectable_opts or {}
    local extra_contexts = spec.extra_contexts
    spec.injectable_opts = nil

    if not vim.isarray(injectable_opts) and type(injectable_opts[1]) == "string" then
        injectable_opts = { injectable_opts }
    end

    local injected_modules = vim.iter(injectable_opts)
        :map(function(injectable)
            local inject_opts
            local resolution_mode = 'default'

            if injectable.merge_opts then
                inject_opts = injectable.merge_opts
                resolution_mode = 'merge'
            elseif injectable.opts ~= nil then
                inject_opts = injectable.opts
            else
                inject_opts = {}
            end

            local eval_opts
            if type(inject_opts) ~= "function" then
                eval_opts = function (_, opts)
                    if resolution_mode == 'merge' then
                        return inject_opts
                    else
                        return vim.tbl_deep_extend('force', opts or {}, inject_opts)
                    end
                end
            else
                eval_opts = inject_opts
            end

            local inject_dependencies = injectable.dependencies or {}

            return vim.tbl_deep_extend('force', injectable, {
                optional = true,
                dependencies = vim.list_extend(inject_dependencies, { parent_module }),
                extra_contexts = extra_contexts,
                opts = function (arg_spec, arg_opts)
                    local new_opts = eval_opts(arg_spec, arg_opts) or {}

                    local opts
                    if new_opts == nil then
                        opts = arg_opts
                    elseif resolution_mode == "merge" then
                        opts = M.deep_tbl_merge_concat(arg_opts, new_opts)
                    else
                        opts = new_opts
                    end

                    return opts
                end
            })
        end)
        :totable()

    return { spec, unpack(injected_modules) }
end

function M.deep_tbl_merge_concat(dst, ...)
    local srcs = {...}

    for _, src in ipairs(srcs) do
        for k, src_val in pairs(src) do
            local dst_val = dst[k]

            local is_dst_array = vim.isarray(dst_val)
            local is_src_array = vim.isarray(src_val)

            if is_dst_array and is_src_array then
                dst[k] = vim.list_extend(dst_val, src_val)
            elseif type(dst_val) == 'table' and type(src_val) == 'table' and not is_dst_array and not is_src_array then
                dst[k] = M.deep_tbl_merge_concat(dst_val, src_val)
            elseif dst_val == nil and src_val ~= nil then
                dst[k] = src_val
            elseif dst_val ~= nil and src_val ~= nil then
                error("merge_opts conflict on ".. k .. " with lhs=" .. vim.inspect(dst_val) .. " ~= rhs=" .. vim.inspect(src_val))
            end
        end
    end

    return dst
end


function M.tbl_set(tbl, ...)
    local args = { ... }
    local value = args[#args]
    args[#args] = nil

    local cur = value
    for i=#args,1,-1 do
        cur = { [args[i]] = cur }
    end

    local new_tbl = vim.tbl_deep_extend("force", tbl, cur)

    for k, v in pairs(new_tbl) do
        tbl[k] = v
    end

    return tbl
end

function M.deep_list_extend(tbl, ...)
    local args = {...}
    local items_to_add = args[#args]
    args[#args] = nil

    local old_list = vim.tbl_get(tbl, unpack(args)) or {}

    args[#args + 1] = vim.list_extend(old_list, items_to_add)
    return M.tbl_set(tbl, unpack(args))
end

function M.set_register(register, contents)
    contents = vim.api.nvim_replace_termcodes(contents, true, true, true)
    vim.fn.setreg(register, contents)
end

function M.coroutine_user_input(arg_prompt)
    local co = coroutine.running()
    assert(co, "must be running under a coroutine")

    vim.ui.input(arg_prompt, function(str)
        -- (2) the asynchronous callback called when user inputs something
        coroutine.resume(co, str)
    end)

    -- (1) Suspends the execution of the current coroutine, context switching occurs
    local input = coroutine.yield()

    -- (3) return the function
    return input
end

function M.has_words_before()
    local line, col = unpack(vim.api.nvim_win_get_cursor(0))

    if col == 0 then
        return false
    end

    local current_line_text = vim.api.nvim_buf_get_lines(0, line - 1, line, true)[1]

    return current_line_text:sub(col, col):match("%s") == nil
end

return M
