return {
    'glacambre/firenvim',
    build = function ()
        vim.fn['firenvim#install'](0)
    end,
    config = function()
        require('config/firenvim')
    end,
    cond = vim.g.started_by_firenvim,
}
