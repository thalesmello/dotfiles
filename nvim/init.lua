-- OriginalAuthor: Pedro Franceschi <pedrohfranceschi@gmail.com>
-- ModifiedVersion: Thales Mello <!-- <thalesmello@gmail.com> -->
-- Source: http://github.com/thalesmello/vimfiles


-- Polyglot disabled configs should load before any syntax is loaded
vim.g.mapleader = " "
vim.g.maplocalleader = "'"

local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
    vim.fn.system({
        "git",
        "clone",
        "--filter=blob:none",
        "https://github.com/folke/lazy.nvim.git",
        "--branch=stable", -- latest stable release
        lazypath,
    })
end
vim.opt.rtp:prepend(lazypath)



---@type string
require("lazy").setup({
    spec = {
        { import = "plugins" },
    },
})

-- Personal configs that were never exported to a plugin
require('config/settings')
require('config/mappings')
require('config/clipboard')
require('config/jk_jumps')
require('config/neovimterminal')
require('config/quickfix_remove')
require('config/smart_send_text')

local nvim_local = vim.fn.expand("$HOME/.nvim_local.lua")
if vim.loop.fs_stat(nvim_local) then
    vim.cmd.luafile(nvim_local)
end
