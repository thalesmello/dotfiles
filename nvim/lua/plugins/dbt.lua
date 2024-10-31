return {
    'ivanovyordan/dbt.vim',
    dependencies = {
        'lepture/vim-jinja'
    },
    ft = { "sql" },
    init = function()
        vim.g.omni_sql_no_default_maps = 1
    end,
}
