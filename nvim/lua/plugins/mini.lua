return {
    'echasnovski/mini.ai',
    version = false,
    config = function()
        require('mini.ai').setup({
            custom_textobjects = {},
            search_method = "cover",
            n_lines = 1000,
        })

        local group = vim.api.nvim_create_augroup("MiniAiBufferGroup", { clear = true })

        vim.api.nvim_create_autocmd({ 'FileType' }, {
            group = group,
            pattern = {"sql", "jinja"},
            callback = function()

                local spec_pair = require('mini.ai').gen_spec.pair
                vim.b.miniai_config = {
                    custom_textobjects = {
                        ['<c-]>'] = spec_pair('{{', '}}'),
                        ['%'] = spec_pair('{%', '%}'),
                        ['-'] = spec_pair('{%-', '-%}'),
                        ['#'] = spec_pair('{#', '#}'),
                        ['\\'] = { "}()%s-()%S?.-%S?()%s-(){" },
                    },
                }
            end,
        })
    end,
}
