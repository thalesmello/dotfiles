return {
    'junegunn/vim-easy-align',
    config = function()
        require('config/easyalign')
    end,
    keys = {
        {"ga", "<Plug>(EasyAlign)", mode = {"n", "x"}}
    },
    cmd = {"EasyAlign"},
    firenvim = true,
    vscode = true,
}
