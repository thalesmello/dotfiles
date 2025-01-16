local M = {}

function M.setup ()
    vim.api.nvim_create_user_command("Fish", function (opts)
        local range

        if opts.range == 2 then
            range = {opts.line1, opts.line2}
        elseif opts.range == 1 then
            range = {opts.line1}
        end

        vim.api.nvim_cmd({
            cmd = "!",
            range = range,
            args = opts.fargs,
        }, {output = false})
    end,
        {
            nargs="*",
            range=true,
            ---@param C string
            complete = function (_, C)
                local cmd = C:match("Fish!? (.+)$")
                local output = vim.fn.split(
                    vim.system({
                        "fish",
                        "-c",
                        "complete -C " .. vim.fn.shellescape(cmd)
                    }, {text=true}):wait().stdout,
                    "\n"
                )

                return vim.iter(output)
                    ---@param line string
                    :map(function (line)
                        local comp, _ = line:gsub("\t(.+)", "")

                        if comp:find(" ") then
                            return vim.fn.shellescape(comp)
                        end

                        return comp
                    end)
                    :totable()
            end
        }
    )
end

return M
