return {
    'thalesmello/vim-projectionist',
    dependencies = {
        { 'tpope/vim-haystack' },
    },
    config = function() require('config/projectionist') end,
    name = 'vim-projectionist',
}
