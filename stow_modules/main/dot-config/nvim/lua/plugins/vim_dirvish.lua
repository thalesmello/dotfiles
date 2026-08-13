return {
    'justinmk/vim-dirvish',
    commit= '2e845b6352ff43b47be2b2725245a4cba3e34da1',
    keys = {
        {"-", function()
            return vim.fn.empty(vim.fn.expand("%")) == 1 and "<cmd>Dirvish<cr>" or "<cmd>Dirvish %:h<cr>"
        end, mode = "n", expr = true, noremap = true}
    },
    cmd = "Dirvish",
    event = {"VimEnter"},
    init = function ()
        vim.g.dirvish_relative_paths = 0

        local group = vim.api.nvim_create_augroup("DirvishGroup", {
            clear = true
        })

        -- The files an action operates on: the whole arglist when it's
        -- populated, otherwise just the file under the cursor.
        local function targets()
            local args = vim.fn.argv()
            if #args > 0 then
                return args
            end
            return { vim.fn.getline(".") }
        end

        -- Run a command and report it on the cmdline. `cmd` is a list: program
        -- then arguments.
        --
        -- Not `:!`, which always ends in a hit-enter prompt and blocks the
        -- editor for as long as the program runs -- for Quick Look that is the
        -- whole time its window is open. vim.system runs it in the background
        -- and we echo a single collapsed line when it finishes, which is short
        -- enough that nvim never needs to ask you to press enter.
        local function run(cmd)
            local function echo(message, level)
                -- One line, and comfortably narrower than the screen: both are
                -- what keep this out of the hit-enter prompt.
                message = message:gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
                if message == "" then
                    return
                end

                local width = math.max(20, vim.o.columns - 20)
                if vim.fn.strdisplaywidth(message) > width then
                    message = vim.fn.strcharpart(message, 0, width - 1) .. "…"
                end

                if level then
                    vim.notify(message, level)
                else
                    vim.api.nvim_echo({ { message } }, false, {})
                end
            end

            -- Show the command that ran, the way :! used to. These commands are
            -- mostly silent on success -- preview hides qlmanage's chatter
            -- entirely -- so without this there is no feedback at all.
            -- Paths go through :~:. so the line stays readable: relative to the
            -- cwd when they are under it, ~-relative otherwise.
            local parts = { cmd[1] }
            for i = 2, #cmd do
                table.insert(parts, vim.fn.fnamemodify(cmd[i], ":~:."))
            end
            echo("!" .. table.concat(parts, " "))

            vim.system(cmd, { text = true }, function(result)
                vim.schedule(function()
                    local output = (result.stdout or "") .. " " .. (result.stderr or "")

                    if result.code ~= 0 then
                        echo(cmd[1] .. ": " .. output .. " (exit " .. result.code .. ")", vim.log.levels.ERROR)
                    elseif output:match("%S") then
                        echo(output)
                    end
                end)
            end)
        end

        vim.api.nvim_create_autocmd({ 'FileType' }, {
            group = group,
            pattern = 'dirvish',
            callback = function()
                local opts = { buffer = true }
                vim.keymap.set({ "n" }, "%", ":<C-U>edit %", opts)

                -- Copy files to the clipboard as real file references.
                vim.keymap.set("n", "<leader>Y", function()
                    local cmd = { "bincopy" }
                    vim.list_extend(cmd, targets())
                    run(cmd)
                end, opts)

                -- Paste the clipboard's file(s) into the current directory.
                vim.keymap.set("n", "<leader>P", function()
                    run({ "binpaste", vim.fn.expand("%") })
                end, opts)

                -- Quick Look the target file(s).
                vim.keymap.set("n", "<leader>.", function()
                    local cmd = { "preview" }
                    vim.list_extend(cmd, targets())
                    run(cmd)
                end, opts)

                vim.cmd [[
                      silent! unmap <buffer> <c-p>
                      silent! unmap <buffer> <c-n>
                      ]]
            end,
        })

        vim.api.nvim_create_autocmd('VimEnter', {
            callback = function()
                -- Check if Neovim was started with a directory argument
                local arg = vim.fn.argv(0)
                if arg ~= '' and vim.fn.isdirectory(arg) == 1 then
                    -- Enter Dirvish
                    vim.cmd('Dirvish ' .. vim.fn.fnameescape(arg))
                end
            end
        })
    end,
    cond = true,
    extra_context = {"ssh"},
}
