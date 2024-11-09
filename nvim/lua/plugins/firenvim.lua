if vim.g.started_by_firenvim then
    -- This is makes extensions not be enabled by default
    -- To enable, add "firenvim = true" to the plugin spec

    require("lazy.core.config").options.defaults.cond = function(plugin)
        return (
            plugin.firenvim
            or plugin._.dep
            or plugin.name == 'lazy.nvim'
        )
    end
end

return {
    'glacambre/firenvim',
    build = function ()
        vim.fn['firenvim#install'](0)
    end,
    config = function()
        local vim_utils = require('vim_utils')

        require("tokyonight").setup({
            styles = {
                comments = { italic = false },
                keywords = { italic = false },
            },
        })

        vim.cmd[[colorscheme tokyonight]]

        local fontSize = 25
        local function setFontSize(newFontSize)
            if not newFontSize then
                newFontSize = fontSize
            else
                fontSize = newFontSize
            end
            vim.go.guifont = "InconsolataGoNFM:h" .. fontSize
        end
        local function incrementFontSize(fontSizeChange)
            if not fontSizeChange then
                fontSizeChange = 0
            end

            setFontSize(fontSize + fontSizeChange)
        end

        local default_cmdheight = vim.o.cmdheight

        vim.go.laststatus = 0

        local function modifyCmdheight()
            if vim.o.lines <= 10 then
                vim.go.cmdheight = 0
            else
                vim.o.cmdheight = default_cmdheight
            end
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

            modifyCmdheight()
        end




        local function startResizeCycle()
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

        local group = vim.api.nvim_create_augroup("FireNvimConfig", { clear = true})
        vim.api.nvim_create_autocmd({'UIEnter'}, {
            group = group,
            callback = function()
                local chan = vim.v.event.chan

                vim.keymap.set("n", "<A-ScrollWheelUp><A-ScrollWheelUp>", '<ScrollWheelUp>', { noremap = true, silent = true })
                vim.keymap.set("n", "<A-ScrollWheelDown><A-ScrollWheelDown>", '<ScrollWheelDown>', { noremap = true, silent = true })

                local client = vim.api.nvim_get_chan_info(chan).client

                if client and client.name == "Firenvim" then
                    vim.go.mousescroll = "ver:1"
                    incrementFontSize()

                    modifyCmdheight()

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
                        incrementFontSize(-1)
                    end)

                    vim.keymap.set("n", "<c-=>", function ()
                        incrementFontSize(1)
                    end)

                    vim.keymap.set("n", "<c-z>", function ()
                        vim.cmd("update")
                        vim.fn["firenvim#hide_frame"]()
                    end)

                    vim.keymap.set({"n", "i"}, "<D-cr>", function()
                        vim.cmd("update")
                        vim.cmd("quit")
                    end)

                    vim.keymap.set("n", "<D-v>", '"+p')
                    vim.keymap.set({ "i", "c" }, "<D-v>", '<c-r><c-r>+')

                    -- The two following settings work with Monaco editors in web browser pages
                    vim.fn['firenvim#eval_js'](
                        "window.getComputedStyle(document.querySelector('.active-line-number')).getPropertyValue('font-size').slice(0, -2) * window.devicePixelRatio",
                        vim_utils.create_vimscript_function('UserFirenvimSetfontCallback', function(fontsize)
                            fontsize = math.floor(tonumber(vim.json.decode(fontsize)) * 72 / 96)
                            vim.print({fontsize = fontsize})

                            if fontsize > 0 then
                                setFontSize(fontsize)
                            end
                        end)
                    )
                    local firenvim_set_line_callback = vim_utils.create_vimscript_function('UserFirenvimSetlineCallback', function(line)
                        line = tonumber(vim.json.decode(line))

                        if line >= 0 then
                            vim.b.firenvim_last_line_number = line
                            vim.api.nvim_win_set_cursor(0, {line, 1})
                        end
                    end)

                    vim.api.nvim_create_autocmd({ 'FocusGained' }, {
                        group = group,
                        pattern = "*",
                        callback = function()
                            vim.fn['firenvim#eval_js']("document.querySelector('.active-line-number').innerText", firenvim_set_line_callback)
                        end,
                    })
                end
            end
        })

        vim.api.nvim_create_autocmd({'TextChanged', 'TextChangedI'}, {
            group = group,
            callback = function()
                if vim.g.firenvim_bufwrite_timer ~= nil then
                    vim.fn.timer_stop(vim.g.firenvim_bufwrite_timer)
                    vim.g.firenvim_bufwrite_timer = nil
                end

                vim.g.firenvim_bufwrite_timer = vim.fn.timer_start(3000, function()
                    vim.g.firenvim_bufwrite_timer = nil
                    vim.cmd('silent write')
                end)
            end
        })

        -- vim.api.nvim_create_autocmd({'BufEnter'}, {
        --     pattern = "*.txt",
        --     callback = function()
        --         vim.cmd.lcd(vim.fn.expand('%:h'))
        --     end,
        --     group = group,
        -- })

        vim.keymap.set("n", "<c-l>", setFontSize)

        vim.g.firenvim_config = {
            localSettings = {
                ['.*'] = {
                    takeover = 'never',
                    filename = '/tmp/firenvim/{hostname}_{pathname}_{selector%10}_{timestamp%32}.{extension}',
                    cmdline = 'neovim',
                }
            }
        }

        if vim.fn.isdirectory('/tmp/firenvim') == 0 then
            vim.cmd('silent ! mkdir -p /tmp/firenvim')
        end

        -- local ok, cmp = pcall(require, "cmp")
        -- if ok then
        --     cmp.setup({
        --         sources = {
        --             { name = 'nvim_lsp' },
        --             { name = 'snippy' },
        --             { name = 'buffer' },
        --             { name = 'path' },
        --         }
        --     )
        -- end

        -- -- Example of how to setup languages specific to websites
        -- local group = vim.api.nvim_create_augroup('FirenvimNvimLocalGroup', {})

        -- vim.api.nvim_create_autocmd({'BufEnter'}, {
        --     pattern = "www.internalfb.com_intern-daiquery*.txt",
        --     callback = function()
        --         vim.bo.filetype = 'sql'


        --         vim.fn['firenvim#eval_js'](
        --             'document.body.textContent.includes("You have view-only access to the workspace this query is in.")',
        --             vim_utils.create_vimscript_function('UserFirenvimDetectDaiqueryReadonly', function(readonly)
        --                 readonly = vim.json.decode(readonly)

        --                 if readonly then
        --                     vim.bo.modifiable = false
        --                     vim.bo.readonly = true
        --                 end
        --             end)
        --         )

        --         vim.fn['firenvim#eval_js'](
        --             'document.body.textContent.includes("You have view-only access to the workspace this query is in.")',
        --             vim_utils.create_vimscript_function('UserFirenvimDetectDaiqueryReadonly', function(readonly)
        --                 readonly = vim.json.decode(readonly)

        --                 if readonly then
        --                     vim.bo.modifiable = false
        --                     vim.bo.readonly = true
        --                 end
        --             end)
        --         )
        --     end,
        --     group = group,
        -- })

        -- vim.api.nvim_create_autocmd({'BufEnter'}, {
        --     pattern = "www.internalfb.com_code*.txt",
        --     callback = function(args)
        --         -- @cast match string
        --         local match = args.match
        --         local _, path = unpack(vim.split(match, "_"))
        --         local path_pieces = vim.split(path, "-")
        --         local extension = path_pieces[#path_pieces]
        --         local editmode = path_pieces[3]
        --         local newfilename = vim.fn.substitute(match, "\\.txt$", "." .. extension, '')
        --         local filetype, _ = vim.filetype.match({ buf = 0, filename = newfilename })
        --         vim.bo.filetype = filetype

        --         if editmode ~= 'edit' then
        --             vim.bo.modifiable = false
        --             vim.bo.readonly = true
        --         end
        --     end,
        --     group = group,
        -- })
    end,
    cond = vim.g.started_by_firenvim,
}
