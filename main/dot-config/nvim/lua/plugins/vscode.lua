if not vim.g.vscode then
  return {}
end

local vscode = require('vscode')
local vim_utils = require('vim_utils')

-- This is makes extensions not be enabled by default
-- To enable, add "vscode = true" to the plugin spec
require("lazy.core.config").options.defaults.cond = require('conditional_load').should_load

local function inferMoveKey(direction)
  return function ()
    if vim.v.count > 0 or vim.fn.reg_recording() ~= '' then
      return direction
    else
      return "g" .. direction
    end
  end
end

local function vscodeMoveLines(toDirection, moveLines)
  local range = vscode.eval([[
    var e = vscode.window.activeTextEditor;

    if (!e) {
        return;
    }


    const withTimeout = timeout => promise => {
      return Promise.race([
        promise,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout exceeded')), timeout);
        })
      ]);
    }


    var changedVisibleRange = (() => {
      let disposableHandler

      let rangePromise = new Promise((resolve) => {
         disposableHandler = vscode.window.onDidChangeTextEditorVisibleRanges(e => {
          resolve(e.visibleRanges)
        })

      })

      return {
        withTimeout(timeout) {
          return rangePromise.then(withTimeout(1000)).finally(() => disposableHandler.dispose())
        }
      }
    })()

    const revealAt = args.to === "up" ? "bottom" : "top"
    const delta = args.to === "up" ? -args.moveLines : args.moveLines;

    const totalLines = e.document.lineCount;

    let line = e.selection.active.line;
    line += delta
    line = Math.max(line, 0)
    line = Math.min(line, totalLines - 1)

    changedVisibleRange = changedVisibleRange.withTimeout(1000)

    await Promise.all([
      vscode.commands.executeCommand("cursorMove", {
          to: args.to,
          by: "line",
          value: args.moveLines,
        }),
      vscode.commands.executeCommand("revealLine", {
        lineNumber: line,
        at: revealAt,
      })
     ])

    let [range, ] = await changedVisibleRange

    return { start_line: range.start.line, end_line: range.end.line }
  ]], { args = { to = toDirection, moveLines = moveLines }})

  local vscode_internal = require('vscode.internal')
  vscode_internal.scroll_viewport(range.start_line, range.end_line)
end


local function vscodeOpenFile(files)
  vscode.eval([[
    var root = vscode.workspace.workspaceFolders[0].uri
    var fileUri

    for (let file of args.files) {
        console.log(file)
        var fileUri = vscode.Uri.joinPath(root, file)
        try {
            await vscode.workspace.fs.stat(fileUri);
            // File exists, so we open it
            await vscode.commands.executeCommand("vscode.open", fileUri)
        } catch {
            // File doesn't exist, so we continue to the next one
        }
    }
  ]], { args = { files = files }})
end

local function vscodeWorkspaceUri()
  local uri = vscode.eval([[
    var workspaceUri = vscode.workspace.workspaceFolders[0].uri
    return workspaceUri
  ]])

  return uri
end

local function vscodeGetProjection(file)
  local projections = vim.g.vscode_projections or {}
  for projection, config in pairs(projections) do
    local capture_group_projection = vim.pesc(projection):gsub("%%%*", "(.-)")
    local entity = file:match(capture_group_projection)

    if entity ~= nil then
      return entity, config
    end
  end

  return nil, nil
end

local function vscodeAlternateFile()
  local current_file = vim.fn.expand("%")
  local entity, config = vscodeGetProjection(current_file)

  if entity ~= nil and config ~= nil then
    local alternate = config.alternate

    local files = vim.iter(alternate):map(function (item)
      local str = item:gsub("{}", entity)
      return str
    end):totable()

    vscodeOpenFile(files)
    return
  end
end

local function vscodeProjectionistCreateEditCommands()
  local function snakeToCamel(str)
    return str:gsub("_%l", function(w) return w:sub(2, 2):upper() end)
  end

  local projections = vim.g.vscode_projections or {}

  for projection, config in pairs(projections) do
    local prefix = projection:match("^(.-)%*")

    if prefix ~= nil then
      local type = config.type

      vim.api.nvim_create_user_command("E" .. snakeToCamel(type), function ()
        vscode.action('workbench.action.quickOpen', { args = { prefix.." " } })
      end, {})
    end
  end
end

vim.api.nvim_create_user_command("A", vscodeAlternateFile, {})

local group = vim.api.nvim_create_augroup('VsCodeAugroup', { clear = true })

local normalize_path = function(uri, root)
  if uri == root then
    uri = "."
  else
    if root:sub(#root, #root) ~= '/' then
      root = root .. '/'
    end

    if uri:sub(1, #root) == root then
      uri = uri:sub(#root + 1, -1)
    end
  end

  return uri
end

-- Some keycodes require forwarding to neovim
-- e.g.
-- { "key": "ctrl+d", "command": "vscode-neovim.send", "args": "<c-d>", "when": "editorTextFocus && neovim.init" },
-- { "key": "ctrl+u", "command": "vscode-neovim.send", "args": "<c-u>", "when": "editorTextFocus && neovim.init" },
-- { "key": "ctrl+p", "command": "vscode-neovim.send", "args": "<c-p>", "when": "editorTextFocus && neovim.init" },
-- { "key": "ctrl+f", "command": "vscode-neovim.send", "args": "<c-f>", "when": "editorTextFocus && neovim.init" },
vim.api.nvim_create_autocmd({ 'CursorHold' }, {
  group = vim.api.nvim_create_augroup('VsCodeShortcuts', { clear = true }),
  pattern = {"*"},
  once = true,
  callback = function()
    -- Wait for vscode to load
    vscodeProjectionistCreateEditCommands()

    vim.keymap.set({ "n", "x", "o" }, "=", "=", { noremap = true })
    vim.keymap.set({ "n" }, "==", "==", { noremap = true })

    vim.keymap.set("n", "j", inferMoveKey("j"), { remap = true, expr = true })

    vim.keymap.set("n", "k", inferMoveKey("k"), { remap = true, expr = true })

    vim.keymap.set("n", "<leader><bs>", function () vscode.action('workbench.action.closeEditorsAndGroup') end)
    vim.keymap.set("n", "<leader>rV", function () vscode.action('vscode-neovim.restart') end)
    vim.keymap.set("n", "<leader><leader>", function ()
      vscode.call('workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup')
      vscode.action('workbench.action.acceptSelectedQuickOpenItem')
    end)

    vim.keymap.set("n", "<leader>km", function () vscode.action('workbench.action.toggleMaximizeEditorGroup') end)
    vim.keymap.set("n", "<leader>kj", function () vscode.action('workbench.action.togglePanel') end)

    vim.keymap.set({ "n", "x" }, "<c-u>", function ()
      -- vscodeMoveLines("up", 20)
      vscode.call('cursorPageUp')
    end)

    vim.keymap.set({ "n", "x" }, "<c-d>", function ()
      -- vscodeMoveLines("down", 20)
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
    vim.keymap.set("n", "<tab>", function () vscode.action('editor.toggleFold') end)
    vim.keymap.set("n", "zC", function () vscode.action('editor.foldRecursively') end)
    vim.keymap.set("n", "zO", function () vscode.action('editor.unfoldRecursively') end)
    vim.keymap.set("n", "zR", function () vscode.action('editor.unfoldAll') end)
    vim.keymap.set("n", "zM", function () vscode.action('editor.foldAll') end)

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

    vim.keymap.set("n", "<leader><tab>", vscodeAlternateFile)

    -- Unset nvim surround mappings. There's a weird but going on and I need to set and delete the mappings
    -- TODO: Fix this hacky solution
    vim.keymap.set('i', '<c-s>', '')
    vim.keymap.set('i', '<c-s><c-s>', '')
    vim.keymap.del('i', '<c-s>')
    vim.keymap.del('i', '<c-s><c-s>')

    vim.keymap.set('i', '<c-s>', function ()
        vim.api.nvim_create_autocmd({ 'InsertEnter' }, {
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


    local ok, harpoon = pcall(require, 'harpoon')

    if ok then
      local Extensions = require("harpoon.extensions")
      local Logger = require("harpoon.logger")

      ---@diagnostic disable-next-line: missing-fields
      harpoon.setup({
        vscode = {
          get_root_dir = function ()
            local uri = vscodeWorkspaceUri()

            if uri.scheme == 'vscode-remote' then
              return uri.external
            else
              return uri.path
            end
          end,

          create_list_item = function(config, name)
            name = name or normalize_path(
              vim.api.nvim_buf_get_name(
                vim.api.nvim_get_current_buf()
              ),
              config.get_root_dir()
            )

            Logger:log("config_default#create_list_item", name)

            local bufnr = vim.fn.bufnr(name, false)

            local pos = { 1, 0 }
            if bufnr ~= -1 then
              pos = vim.api.nvim_win_get_cursor(0)
            end

            return {
              value = name,
              context = {
                row = pos[1],
                col = pos[2],
              },
            }
          end,

          ---@param arg {buf: number}
          ---@param list HarpoonList
          BufLeave = function(arg, list)
            local bufnr = arg.buf
            local bufname = normalize_path(
              vim.api.nvim_buf_get_name(bufnr),
              list.config.get_root_dir()
            )
            local item = list:get_by_value(bufname)

            if item then
              local pos = vim.api.nvim_win_get_cursor(0)

              Logger:log(
                "config_default#BufLeave updating position",
                bufnr,
                bufname,
                item,
                "to position",
                pos
              )

              item.context.row = pos[1]
              item.context.col = pos[2]

              Extensions.extensions:emit(
                Extensions.event_names.POSITION_UPDATED,
                item
              )
            end
          end,


          select = function(list_item, list, options)
            Logger:log(
              "config_default#select",
              list_item,
              list.name,
              options
            )
            if list_item == nil then
              return
            end

            vscodeOpenFile({ list_item.value })
          end,
        }
      })
    end
  end,
})

vim.api.nvim_create_autocmd({ 'BufEnter' }, {
  group = group,
  pattern = {"*"},
  callback = function()
    vim.o.relativenumber = true
  end,
})

return {}
