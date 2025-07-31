local M = {}

M.ft_mappings = {
    python = {"sqljinja", "python"},
    jinja = {"sqljinja", "jinja"},
    sql = {"sqljinja", "sql"},
}

function M.ftmini_config(filetype)
    if filetype == '' then return {} end

    local iter_filetypes = M.ft_mappings[filetype] or {filetype}

    local config = vim.iter(vim.list_extend({"global"}, iter_filetypes))
    :map(function (ft)
        local ok, ftconfig = pcall(require, "ftmini." .. ft)
        if ok then
            return {ftconfig}
        else
            return {}
        end
	end)
    :flatten()
    :fold({}, function (acc, config) return vim.tbl_deep_extend("force", acc, config) end)

    return config
end

return M
