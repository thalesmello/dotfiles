-- This is makes extensions not be enabled by default
-- To enable, add "vscode = true" to the plugin spec
require("lazy.core.config").options.defaults.cond = require('conditional_load').should_load

return {
  dir = vim.fn.stdpath("config") .. "/local_plugins/vscode_config/",
  dev = true,
  config = function ()
    local vscode = require('vscode')
    local vscode_config = require('vscode_config')
    local vim_utils = require('vim_utils')

    vim.g.inline_edit_proxy_type = "vscode"
    vim.api.nvim_create_user_command("A", vscode_config.vscodeAlternateFile, {})

    local group = vim.api.nvim_create_augroup('VsCodeAugroup', { clear = true })

    vim.api.nvim_create_autocmd({ 'BufEnter' }, {
      group = group,
      pattern = {"*"},
      callback = function()
        vim.o.relativenumber = true
      end,
    })


    vim.api.nvim_create_autocmd({ 'CursorHold' }, {
      group = vim.api.nvim_create_augroup('VsCodeShortcuts', { clear = true }),
      pattern = {"*"},
      once = true,
      callback = function()
        -- Add shortcuts that must wait for vscode to load
      end,
    })

    vscode_config.vscodeProjectionistCreateEditCommands()

        vim.keymap.set({ "n", "x", "o" }, "=", "=", { noremap = true })
        vim.keymap.set({ "n" }, "==", "==", { noremap = true })

        vim.keymap.set("n", "j", vscode_config.inferMoveKey("j"), { remap = true, expr = true })

        vim.keymap.set("n", "k", vscode_config.inferMoveKey("k"), { remap = true, expr = true })

        vim.keymap.set("n", "<leader><bs>", function () vscode.action('workbench.action.closeEditorsAndGroup') end)
        vim.keymap.set("n", "<leader>rV", function () vscode.action('vscode-neovim.restart') end)
        vim.keymap.set("n", "<leader><leader>", function ()
          vscode.call('workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup')
          vscode.action('workbench.action.acceptSelectedQuickOpenItem')
        end)

        vim.keymap.set("n", "<leader>me", function ()
          vscode.call('workbench.action.showOutputChannels')
          -- vim.fn.system([[osascript -e 'tell application "System Events" to keystroke "messages" & return']])
          -- vscode.call('editor.action.clipboardPasteAction')
          -- vscode.action('workbench.action.acceptSelectedQuickOpenItem')
        end)
        vim.keymap.set("n", "<leader>J", function () vscode.action('workbench.action.increaseViewHeight'); vscode_config.startResizeCycle() end)
        vim.keymap.set("n", "<leader>K", function () vscode.action('workbench.action.decreaseViewHeight'); vscode_config.startResizeCycle() end)
        vim.keymap.set("n", "<leader>L", function () vscode.action('workbench.action.increaseViewWidth'); vscode_config.startResizeCycle() end)
        vim.keymap.set("n", "<leader>H", function () vscode.action('workbench.action.decreaseViewWidth'); vscode_config.startResizeCycle() end)

        vim.keymap.set("n", "<leader>km", function () vscode.action('workbench.action.toggleMaximizeEditorGroup') end)
        vim.keymap.set("n", "<leader>kj", function () vscode.action('workbench.action.togglePanel') end)

        vim.keymap.set({ "n", "x" }, "<c-u>", function ()
          -- vscode_config.vscodeMoveLines("up", 20)
          vscode.call('cursorPageUp')
        end)

        vim.keymap.set({ "n", "x" }, "<c-d>", function ()
          -- vscode_config.vscodeMoveLines("down", 20)
          vscode.call('cursorPageDown')
        end)

        vim.keymap.set("n", "<leader>rv", function () vscode.action('editor.action.rename') end)

        vim.keymap.set({ "n" }, "<c-t>", function () vscode.action('workbench.action.navigateBackInEditLocations') end)
        vim.keymap.set("n", "<c-f>", function () vscode.action('workbench.action.findInFiles') end)
        vim.keymap.set("n", "<leader>/", "viw<cmd>lua require'vscode'.action('workbench.action.findInFiles')<cr>")
        vim.keymap.set("n", "<leader><c-p>", function () vscode.action('workbench.action.quickOpen', { args = { vim.fn.expand("%:t:r") } }) end)
        vim.keymap.set("n", "<c-p>", function () vscode.action('workbench.action.quickOpen') end)
        vim.keymap.set("x", "<c-p>", function () vscode.action('workbench.action.quickOpen', { args = { require("vim_utils").get_visual_selection() } }) end)

        vim.keymap.set("v", "<leader>/", function ()
          vscode.action('workbench.action.findInFiles')
        end)

        vim.keymap.set("n", "<leader>fr", function () vscode.action('references-view.findReferences') end)
        vim.keymap.set("n", "<leader>ss", function () vscode.action('workbench.action.gotoSymbol') end)
        vim.keymap.set("n", "<leader><cr>", function () vscode.action('workbench.action.terminal.toggleTerminal') end)
        vim.keymap.set({"n", "v"}, "<tab>", function () vscode.action('editor.toggleFold') end)
        vim.keymap.set({"n", "v"}, "zC", function () vscode.action('editor.foldRecursively') end)
        vim.keymap.set({"n", "v"}, "zO", function () vscode.action('editor.unfoldRecursively') end)
        vim.keymap.set({"n", "v"}, "zR", function () vscode.action('editor.unfoldAll') end)
        vim.keymap.set({"n", "v"}, "zM", function () vscode.action('editor.foldAll') end)
        vim.keymap.set({"n", "v"}, "z-", function () vscode.action('editor.foldAllExcept') end)

        -- Simulate my most used vim-unimpaired shortcut
        vim.keymap.set("n", "[<space>", "<cmd>put!=repeat(nr2char(10), v:count1)|silent ']+<cr>")
        vim.keymap.set("n", "]<space>", "<cmd>put =repeat(nr2char(10), v:count1)|silent '[-<cr>")
        vim.keymap.set("n", "[g", function () vscode.action('editor.action.marker.prev') end)
        vim.keymap.set("n", "]g", function () vscode.action('editor.action.marker.next') end)
        vim.keymap.set("n", "[l", function () vscode.action('editor.action.marker.prev') end)
        vim.keymap.set("n", "]l", function () vscode.action('editor.action.marker.next') end)
        vim.keymap.set("n", "[q", function () vscode.action('action.marker.prevInFiles') end)
        vim.keymap.set("n", "]q", function () vscode.action('action.marker.nextInFiles') end)


        vim.keymap.set("n", "<leader>.", function () vscode.action('editor.action.quickFix') end)

        vim.keymap.set("n", "<leader>fmt", function () vscode.action('editor.action.formatDocument') end)
        vim.keymap.set("v", "<leader>fmt", function () vscode.action('editor.action.formatSelection') end)

        -- vim.keymap.set("n", "<leader>ka", function () vscode.action('vscode-harpoon.addEditor') end)
        -- vim.keymap.set("n", "<leader>ke", function () vscode.action('vscode-harpoon.editEditors') end)
        -- vim.keymap.set("n", "<leader>kE", function () vscode.action('vscode-harpoon.editorQuickPick') end)
        -- vim.keymap.set("n", "<leader>1", function () vscode.action('vscode-harpoon.gotoEditor1') end)
        -- vim.keymap.set("n", "<leader>2", function () vscode.action('vscode-harpoon.gotoEditor2') end)
        -- vim.keymap.set("n", "<leader>3", function () vscode.action('vscode-harpoon.gotoEditor3') end)
        -- vim.keymap.set("n", "<leader>4", function () vscode.action('vscode-harpoon.gotoEditor4') end)
        -- vim.keymap.set("n", "<leader>5", function () vscode.action('vscode-harpoon.gotoEditor5') end)
        -- vim.keymap.set("n", "<leader>6", function () vscode.action('vscode-harpoon.gotoEditor6') end)
        -- vim.keymap.set("n", "<leader>7", function () vscode.action('vscode-harpoon.gotoEditor7') end)
        -- vim.keymap.set("n", "<leader>8", function () vscode.action('vscode-harpoon.gotoEditor8') end)
        -- vim.keymap.set("n", "<leader>9", function () vscode.action('vscode-harpoon.gotoEditor9') end)
        vim.keymap.set("n", "<leader>ka", function () require('harpoon'):list('vscode'):add() end)
        vim.keymap.set("n", "<leader>ke", function ()
          vim.fn.setreg('"', vim.fn.join(require('harpoon'):list('vscode'):display(), '\n'))
          vim.cmd.put()
        end)
        vim.keymap.set("n", "<leader>kE", function ()
          local harpoon = require('harpoon')
          local list = vim.fn.split(vim.fn.getreg('"'), "\n")
          local length = #list
          harpoon:list('vscode'):resolve_displayed(list, length)
        end)
        vim.keymap.set("n", "<leader>k<bs>", function () require('harpoon'):list('vscode'):clear() end)
        vim.keymap.set("n", "<leader>k?", function () vim.print(require('harpoon'):list('vscode'):display()) end)
        vim.keymap.set("n", "<leader>1", function ()  require('harpoon'):list('vscode'):select(1) end)
        vim.keymap.set("n", "<leader>2", function ()  require('harpoon'):list('vscode'):select(2) end)
        vim.keymap.set("n", "<leader>3", function ()  require('harpoon'):list('vscode'):select(3) end)
        vim.keymap.set("n", "<leader>4", function ()  require('harpoon'):list('vscode'):select(4) end)
        vim.keymap.set("n", "<leader>5", function ()  require('harpoon'):list('vscode'):select(5) end)
        vim.keymap.set("n", "<leader>6", function ()  require('harpoon'):list('vscode'):select(6) end)
        vim.keymap.set("n", "<leader>7", function ()  require('harpoon'):list('vscode'):select(7) end)
        vim.keymap.set("n", "<leader>8", function ()  require('harpoon'):list('vscode'):select(8) end)
        vim.keymap.set("n", "<leader>9", function ()  require('harpoon'):list('vscode'):select(9) end)

        vim.keymap.set("n", "-", function () vscode.action('workbench.files.action.showActiveFileInExplorer') end)
        vim.keymap.set("n", "[c", function () vscode.action('editor.action.accessibleDiffViewer.prev') end)
        vim.keymap.set("n", "]c", function () vscode.action('editor.action.accessibleDiffViewer.next') end)

        vim.keymap.set("n", "<leader><tab>", vscode_config.vscodeAlternateFile)

        -- Unset nvim surround mappings. There's a weird but going on and I need to set and delete the mappings
        -- TODO: Fix this hacky solution
        vim.keymap.set('i', '<c-s>', '')
        vim.keymap.set('i', '<c-s><c-s>', '')
        vim.keymap.del('i', '<c-s>')
        vim.keymap.del('i', '<c-s><c-s>')

        vim.keymap.set('i', '<c-s>', function ()
            vim.api.nvim_create_autocmd({ 'insertenter' }, {
                pattern = '*',
                once = true,
                callback = function()
                    local col = vim.fn.col('.')
                    -- For some reason, at cursor column there's a "<c2>" caracter
                    -- And therefore to select the character in from of the cursor I have
                    -- To use col + 1, even though end indices are inclusive in lua
                    -- I couldn't find any documentation, but I think <c2> is an internal representation
                    -- for the cursor output from getline('.')
                    local char_under_cursor = vim.fn.getline('.'):sub(1):sub(col, col+1)
                    if char_under_cursor == '§' then
                        vim_utils.feedkeys("<c-o>x")
                    end
                end,
            })
            vim_utils.feedkeys('§<left><c-o>v:<c-u>lua require("mini.surround").add("visual")<cr>', 'n')
        end)

        vscode_config.setupVscodeHarpoon()
  end,
  extra_contexts = {"vscode"}
}

-- The following is a list of useful shortcuts to be added to vscode in
-- a new configuration

-- Toggle nvim
-- { "key": "cmd+e", "command": "vscode-neovim.stop", "when": "neovim.init" },
-- { "key": "cmd+e", "command": "vscode-neovim.restart", "when": "!neovim.init" },
-- Some keycodes require forwarding to neovim
-- e.g.
-- { "key": "ctrl+d", "command": "vscode-neovim.send", "args": "<c-d>", "when": "editorTextFocus && neovim.init" },
-- { "key": "ctrl+u", "command": "vscode-neovim.send", "args": "<c-u>", "when": "editorTextFocus && neovim.init" },
-- { "key": "ctrl+p", "command": "vscode-neovim.send", "args": "<c-p>", "when": "editorTextFocus && neovim.init" },
-- { "key": "ctrl+f", "command": "vscode-neovim.send", "args": "<c-f>", "when": "editorTextFocus && neovim.init" },
-- { "key": "ctrl+s", "command": "vscode-neovim.send", "args": "<c-s>", "when": "editorTextFocus && neovim.init" },
-- { "key": "ctrl+g", "command": "vscode-neovim.send", "args": "<c-g>", "when": "editorTextFocus && neovim.init" },
-- Add harpoon mappings
-- { "key": "cmd+1", "command": "vscode-neovim.lua", "args": [[ "require('harpoon'):list('vscode'):select(1)"]], },
-- Hide overlays
-- { "key": "escape", "command": "vscode-neovim.escape", "when": "editorTextFocus && neovim.init && neovim.mode != 'normal' && editorLangId not in 'neovim.editorLangIdExclusions' && !parameterHintsVisible" },
-- { "key": "escape", "command": "-vscode-neovim.escape", "when": "editorTextFocus && neovim.init && neovim.mode != 'normal' && editorLangId not in 'neovim.editorLangIdExclusions'" }
--
