if not vim.g.started_by_firenvim then
    return
end

local vim_utils = require('vim_utils')

local fontSize = 30
local function setGuiFont(fontSizeChange)
    if not fontSizeChange then
        fontSizeChange = 0
    end

    fontSize = fontSize + fontSizeChange
    vim.go.guifont = "InconsolataGoNerdFontCompleteM-Regular:h" .. fontSize
end


local defaultLineChange = 2
local defaultColumnChange = 5
local function setDocument(lines, columns)
    if not lines then
        lines = 0
    end

    if not columns then
        columns = 0
    end


    vim.o.lines = vim.o.lines + lines
    vim.o.columns = vim.o.columns + columns
end


vim.go.laststatus = 0


function startResizeCycle()
    vim.keymap.set("n", "J", function () setDocument(defaultLineChange, 0) end, { buffer = true})
    vim.keymap.set("n", "K", function () setDocument(-defaultLineChange, 0) end, { buffer = true})
    vim.keymap.set("n", "L", function () setDocument(0, defaultColumnChange) end, { buffer = true})
    vim.keymap.set("n", "H", function () setDocument(0, -defaultColumnChange) end, { buffer = true})

    local group = vim.api.nvim_create_augroup("DocumentResizeGroup", {})
    vim.api.nvim_create_autocmd("CursorHold", {
        group = group,
        pattern = "*",
        callback = function ()
            vim.keymap.del("n", "J", { buffer = true})
            vim.keymap.del("n", "K", { buffer = true})
            vim.keymap.del("n", "L", { buffer = true})
            vim.keymap.del("n", "H", { buffer = true})

            vim.api.nvim_clear_autocmds({ group = group })
        end
    })
end

vim.api.nvim_create_autocmd({'UIEnter'}, {
    group = vim.api.nvim_create_augroup("FireNvimConfig", { clear = true}),
    callback = function()
        local chan = vim.v.event.chan
        local client = vim.api.nvim_get_chan_info(chan).client

        if client and client.name == "Firenvim" then
            setGuiFont()

            vim.keymap.set("n", "<leader>J", function ()
                setDocument(defaultLineChange, 0)
                startResizeCycle()
            end)
            vim.keymap.set("n", "<leader>K", function ()
                setDocument(-defaultLineChange, 0)
                startResizeCycle()
            end)
            vim.keymap.set("n", "<leader>L", function ()
                setDocument(0, defaultColumnChange)
                startResizeCycle()
            end)
            vim.keymap.set("n", "<leader>H", function ()
                setDocument(0, -defaultColumnChange)
                startResizeCycle()
            end)

            vim.keymap.set("n", "<c-->", function ()
                setGuiFont(-1)
            end)

            vim.keymap.set("n", "<c-=>", function ()
                setGuiFont(1)
            end)

            vim.keymap.set("n", "<c-z>", function ()
                vim.fn["firenvim#hide_frame"]()
            end)

            vim.defer_fn(function()
                vim_utils.create_vimscript_function('UserFirenvimSetlineCallback', function(line)
                    line = tonumber(vim.json.decode(line))

                    if line >= 0 then
                        vim.api.nvim_win_set_cursor(0, {line, 1})
                    end
                end)

                vim.cmd [[
                function! UserVimFirenvimSetlineCallback(line)
                    let _ = v:lua.UserFirenvimSetlineCallback(a:line)
                endfunction
                ]]

                vim.rpcnotify(chan, 'firenvim_eval_js', "document.querySelector('.active-line-number').innerText", "UserFirenvimSetlineCallback")
            end, 100)
        end
    end
})

vim.keymap.set("n", "<c-l>", setGuiFont)

vim.g.firenvim_config = {
    localSettings = {
        ['.*'] = {
            takeover = 'never',
        }
    }
}
