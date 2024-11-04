return {
    'echasnovski/mini.ai',
    version = false,
    vscode = true,
    config = function()
        local spec_pair = require('mini.ai').gen_spec.pair

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

        vim.api.nvim_create_autocmd({ 'FileType' }, {
            group = group,
            pattern = {"python"},
            callback = function()
                vim.b.miniai_config = {
                    custom_textobjects = {
                        ['q'] = { { 'f?""".-"""', "f?'''.-'''" }, '^...%s*().-()%s*...$' },
                    },
                }
            end,
        })
    end,
}
