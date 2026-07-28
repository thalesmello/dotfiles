local vim_utils = require('vim_utils')

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
            args = {"fish", "-c", vim.fn.shellescape(opts.args)},
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

    vim.keymap.set({'n'}, '<Plug>FishBangFilterOperator', '<cmd>set opfunc=v:lua.FishBangFilterOperator<cr>g@', {noremap = true, silent = true})

    function FishBangFilterOperator(mode)
        local line1 = vim.fn.line("'[")
        local line2 = vim.fn.line("']")
        local curline = vim.fn.line(".")
        local visline1 = vim.fn.line("'<")
        local visline2 = vim.fn.line("'>")

        if line1 == line2 and line1 == curline then
            return vim_utils.feedkeys(":.Fish<space>")
        elseif visline1 == line1 and visline2 == line2 then
            return vim_utils.feedkeys(":'<,'>Fish<space>")
        elseif line1 == curline then
            local diff = line2 - line1
            return vim_utils.feedkeys(":.,+" .. diff .. "Fish<space>")
        else
            return vim_utils.feedkeys(":" .. line1 .. "," .. line2 .. "Fish<space>")
        end
    end
end

return M
