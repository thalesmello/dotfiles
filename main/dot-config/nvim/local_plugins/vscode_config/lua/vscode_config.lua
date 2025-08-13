local M = {}

local vscode = require('vscode')

function M.inferMoveKey(direction)
  return function ()
    if vim.v.count > 0 or vim.fn.reg_recording() ~= '' then
      return direction
    else
      return "g" .. direction
    end
  end
end

function M.startResizeCycle()
    vim.keymap.set("n", "J", function () vscode.action('workbench.action.increaseViewHeight') end, { buffer = true})
    vim.keymap.set("n", "K", function () vscode.action('workbench.action.decreaseViewHeight') end, { buffer = true})
    vim.keymap.set("n", "L", function () vscode.action('workbench.action.increaseViewWidth') end, { buffer = true})
    vim.keymap.set("n", "H", function () vscode.action('workbench.action.decreaseViewWidth') end, { buffer = true})

    local group = vim.api.nvim_create_augroup("VscodeResizeGroup", {})
    vim.api.nvim_create_autocmd("CursorHold", {
        group = group,
        pattern = "*",
        callback = function ()
            vim.keymap.del("n", "J", { buffer = true})
            vim.keymap.del("n", "K", { buffer = true})
            vim.keymap.del("n", "L", { buffer = true})
            vim.keymap.del("n", "H", { buffer = true})

            vim.api.nvim_clear_autocmds({ group = group })
        end
    })
end

function M.vscodeOpenFile(files)
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

function M.vscodeGetProjection(file)
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

function M.vscodeAlternateFile()
  local current_file = vim.fn.expand("%")
  local entity, config = M.vscodeGetProjection(current_file)

  if entity ~= nil and config ~= nil then
    local alternate = config.alternate

    local files = vim.iter(alternate):map(function (item)
      local str = item:gsub("{}", entity)
      return str
    end):totable()

    M.vscodeOpenFile(files)
    return
  end
end

function M.vscodeWorkspaceUri()
  local uri = vscode.eval([[
    var workspaceUri = vscode.workspace.workspaceFolders[0].uri
    return workspaceUri
  ]])

  return uri
end

function M.vscodeProjectionistCreateEditCommands()
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

function M.setupVscodeHarpoon()
    local ok, harpoon = pcall(require, 'harpoon')

    if not ok then
        return
    end

    local Extensions = require("harpoon.extensions")
    local Logger = require("harpoon.logger")

    ---@diagnostic disable-next-line: missing-fields
    harpoon.setup({
        vscode = {
            get_root_dir = function ()
                local uri = M.vscodeWorkspaceUri()

                if uri.scheme == 'vscode-remote' then
                    return uri.external
                else
                    return uri.path
                end
            end,

            create_list_item = function(config, name)
                name = name or M.normalize_path(
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
                local bufname = M.normalize_path(
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

                M.vscodeOpenFile({ list_item.value })
            end,
        }
    })
end

function M.normalize_path(uri, root)
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

function M.performHalfScroll(opts)
  -- Code from: https://github.com/d-Nk/HalfScroll/blob/master/src/extension.ts
  vscode.eval([[
    async function SetNewActive(top)
    {
        const editor = vscode.window.activeTextEditor;
        if(!editor){return false;}

        const nowRange = editor.visibleRanges.reduce((agg, x) => {
          return agg + x.end.line - x.start.line + 1;
        }, 0);
        const halfRange = Math.round(nowRange / 2);

        vscode.commands.executeCommand('editorScroll', { 'to': (top ? "up" : "down"), 'by': 'line', 'value': halfRange})
        vscode.commands.executeCommand('cursorMove', { 'to': (top ? "up" : "down"), 'by': 'wrappedLine', 'value': halfRange})

    }

    await SetNewActive(args.up)
  ]], {args = {up = opts.up}})
end

return M
