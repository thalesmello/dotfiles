return {
    'thalesmello/python-support.nvim',
    build = function()
        vim.cmd.PythonSupportInitPython3()
    end,
    init = function()
        require('config/python_support')
    end
}
