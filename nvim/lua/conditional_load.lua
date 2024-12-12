local M = {}

local conditions = {
    {context_active = vim.g.started_by_firenvim, load_if_context = 'firenvim'},
    {context_active = vim.g.vscode, load_if_context = 'vscode'},
}

function M.should_load(spec)
    for _, condition in ipairs(conditions) do
        if condition.context_active then
            return (
                spec[condition.load_if_context]
                or vim.tbl_contains(spec.extra_contexts or {}, condition.load_if_context)
                or vim.tbl_get(spec, "_", "dep")
                or spec.name == 'lazy.nvim'
            )
        end
    end

    return true
end

function M.wrap(handle)
    local function wrapper(spec, opts)
        if require('conditional_load').should_load(spec) then
            return handle(spec, opts)
        end

        return opts
    end

    return wrapper

end

function M.exec_when(spec, action)
    if M.should_load(spec) then
        return action()
    end
end

return M
