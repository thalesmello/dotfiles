local M = {}

function M.makeProjections(relatedFiles)
    local projections = {}

    for _,files in ipairs(relatedFiles) do
        local paths = vim.iter(files):map(function (x) return x.path end):totable()
        for i,file in ipairs(files) do
            local pattern = file.path:gsub("{}", "*")
            if projections[pattern] == nil then
                projections[pattern] = {
                    type = file.type,
                    temp_alternate_main = {},
                    temp_alternate_fallback = {},
                }
            end

            local projection = projections[pattern]


            local localPaths = {}
            vim.list_extend(localPaths, paths, i + 1)
            vim.list_extend(localPaths, paths, 1, i - 1)

            vim.list_extend(projection.temp_alternate_main, vim.list_slice(localPaths, 1, 1))
            vim.list_extend(projection.temp_alternate_fallback, vim.list_slice(localPaths, 2))
        end
    end

    for _, projection in pairs(projections) do
        projection.alternate = vim.list.unique(vim.list_extend(projection.temp_alternate_main, projection.temp_alternate_fallback))
        projection.temp_alternate_main = nil
        projection.temp_alternate_fallback = nil
    end

    return projections
end

return M
