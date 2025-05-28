local surround_adapter = require("surround_adapter")
local ftmini = require("ftmini")

return {
    'kylechui/nvim-surround',
    dependencies = {
        'nvim-treesitter/nvim-treesitter',
        'kana/vim-textobj-user',
    },
    config = function()
        local surround = require('nvim-surround')
        local get_input = surround_adapter.user_input

        surround.setup({
            surrounds = {
                ['?'] = surround_adapter.from_mini({
                    input = function()
                        local surroundings = get_input('Left Surround ||| Right Surround')

                        local left, right = unpack(vim.split(surroundings, "|||"))

                        if left == nil or left == '' then return end
                        if right == nil or right == '' then return end

                        return { vim.pesc(left) .. '().-()' .. vim.pesc(right) }
                    end,
                    output = function()
                        local surroundings = get_input('Left Surround ||| Right Surround')

                        local left, right = unpack(vim.split(surroundings, "|||"))

                        if left == nil then return end
                        if right == nil then return end
                        return { left = left, right = right }
                    end,
                }),
            },
            keymaps = {
                insert = "<c-s>",
                insert_line = "<C-s><c-s>",
            },
            -- surrounds =     -- Defines surround keys and behavior
            aliases = {
                ["a"] = false,
                ["b"] = false,
                ["B"] = false,
                ["r"] = false,
                ["q"] = false,
                ["s"] = false,
            },
            -- highlight =     -- Defines highlight behavior
            move_cursor = true,
            -- indent_lines =  -- Defines line indentation behavior,
        })



        local group = vim.api.nvim_create_augroup("NvimSurroungGroup", { clear = true })


        local function set_buffer_config(filetype)
            local config = ftmini.ftmini_config(filetype)

            surround.buffer_setup({
                surrounds = vim.tbl_map(surround_adapter.from_mini, config.custom_surroundings or {})
            })
        end

        vim.api.nvim_create_autocmd({ 'FileType' }, {
            group = group,
            pattern = "*",
            callback = function(opts)
                set_buffer_config(opts.match)
            end,
        })

        vim.api.nvim_create_autocmd({ 'User' }, {
            group = group,
            pattern = "TreesitterEmbeddedFileType",
            callback = function(opts)
                set_buffer_config(opts.data.filetype)
            end,
        })
    end,
    cond = true,
    extra_contexts = {"vscode", "firenvim"}
}
