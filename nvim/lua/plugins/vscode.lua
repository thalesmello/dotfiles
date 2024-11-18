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

  vim.print(range)
  local vscode_internal = require('vscode.internal')
  vscode_internal.scroll_viewport(range.start_line, range.end_line)
end

local group = vim.api.nvim_create_augroup('VsCodeAugroup', { clear = true })

vim.api.nvim_create_autocmd({ 'CursorHold' }, {
  group = vim.api.nvim_create_augroup('VsCodeShortcuts', { clear = true }),
  pattern = {"*"},
  once = true,
  callback = function()
    -- Wait for vscode to load
    vim.keymap.set({ "n", "x", "o" }, "=", "=", { noremap = true })
    vim.keymap.set({ "n" }, "==", "==", { noremap = true })

    vim.keymap.set("n", "j", inferMoveKey("j"), { remap = true, expr = true })

    vim.keymap.set("n", "k", inferMoveKey("k"), { remap = true, expr = true })

    vim.keymap.set("n", "<leader><bs>", function () vscode.action('workbench.action.closeEditorsAndGroup') end)
    vim.keymap.set("n", "<leader>rv", function () vscode.action('vscode-neovim.restart') end)
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

    vim.keymap.set("n", "gr", function () vscode.action('editor.action.rename') end)

    vim.keymap.set({ "n" }, "<c-t>", function () vscode.action('workbench.action.navigateBackInEditLocations') end)
    vim.keymap.set("n", "<c-f>", function () vscode.action('workbench.action.findInFiles') end)
    vim.keymap.set("n", "<leader>/", "viw<cmd>lua require('vscode').action('workbench.action.findInFiles')<cr>")

    vim.keymap.set("v", "<leader>/", function ()
      vscode.action('workbench.action.findInFiles')
    end)

    vim.keymap.set("n", "gR", function () vscode.action('references-view.findReferences') end)
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
