return {
    setup = function ()
        vim.api.nvim_create_user_command("Throw", function (opts)
            local pos = vim.fn.getpos('.')
            local pos_line = pos[2]
            local target_line = vim.api.nvim_parse_cmd(opts.args .. "p", {}).range[1]

            local range, move_arg, jumpback
            if target_line < pos_line then
                range = {target_line, opts.line1 - 1}
                move_arg = {opts.line2}
                jumpback = false
            else
                range = {opts.line2 + 1, target_line}
                move_arg = {opts.line1 - 1}
                jumpback = true
            end

            vim.print(range)
            vim.cmd({
                cmd = "move",
                range = range,
                args = move_arg,
                mods = {
                    silent = true,
                    keepjumps = true,
                }
            })

            if jumpback then
                vim.cmd.normal({ "`[", mods = {keepjumps = true}})
            end
        end, { nargs = 1, range = true })

        vim.api.nvim_create_user_command("Jump", function (opts)
            local target_line = vim.api.nvim_parse_cmd(opts.args .. "p", {}).range[1]
            target_line = target_line - 1

            vim.cmd({
                cmd = "move",
                range = {opts.line1, opts.line2},
                args = { target_line },
                mods = {
                    silent = true,
                    keepjumps = true,
                }
            })

            vim.cmd.normal("`[")
        end, { nargs = 1, range = true })
    end
}
