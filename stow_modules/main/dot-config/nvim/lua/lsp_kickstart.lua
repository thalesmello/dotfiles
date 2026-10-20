local M = {}

local bootstrapped = false
local kickstart_hooks = {}

local LSP_PLUGINS = {
    "mason.nvim",
    "nvim-lspconfig",
    "mason-lspconfig.nvim",
    "lsp_signature.nvim",
    "lsp-command",
    "nvim-lint",
    "mason-nvim-lint",
    "none-ls.nvim",
    "meta.nvim",
}

function M.is_bootstrapped()
    return bootstrapped
end

--- Register a callback to run when LSP is kickstarted.
--- If LSP is already kickstarted, the callback runs immediately.
---@param fn fun()
function M.on_kickstart(fn)
    if bootstrapped then
        fn()
    else
        table.insert(kickstart_hooks, fn)
    end
end

---@param bufnr integer
---@param method? string
---@return boolean
local function has_ready_client(bufnr, method)
    local clients = vim.lsp.get_clients({ bufnr = bufnr })
    if #clients == 0 then
        return false
    end
    if not method then
        return true
    end
    for _, client in ipairs(clients) do
        if client:supports_method(method) then
            return true
        end
    end
    return false
end

---@param bufnr integer
---@return boolean
local function has_matching_async_config(bufnr)
    local ft = vim.bo[bufnr].filetype
    if ft == "" then
        return false
    end
    for name in pairs(vim.lsp._enabled_configs or {}) do
        local ok, cfg = pcall(function()
            return vim.lsp.config[name]
        end)
        if ok and cfg then
            local filetypes = cfg.filetypes
            if filetypes == nil or vim.tbl_contains(filetypes, ft) then
                if type(cfg.root_dir) == "function" then
                    return true
                end
            end
        end
    end
    return false
end

--- Load LSP plugins and start configured language servers for `bufnr`.
---@param bufnr? integer
function M.kickstart(bufnr)
    bufnr = (bufnr and bufnr ~= 0) and bufnr or vim.api.nvim_get_current_buf()

    if not bootstrapped then
        bootstrapped = true

        local ok, lazy_config = pcall(require, "lazy.core.config")
        if ok and lazy_config.plugins then
            local to_load = vim.tbl_filter(function(name)
                local p = lazy_config.plugins[name]
                return p ~= nil and p._.loaded == nil
            end, LSP_PLUGINS)

            if #to_load > 0 then
                require("lazy").load({ plugins = to_load })
            end
        end

        for _, hook in ipairs(kickstart_hooks) do
            pcall(hook)
        end
        kickstart_hooks = {}
    end

    if vim.api.nvim_buf_is_valid(bufnr) and vim.bo[bufnr].filetype ~= "" then
        pcall(vim.api.nvim_exec_autocmds, "FileType", {
            group = "nvim.lsp.enable",
            buffer = bufnr,
            modeline = false,
        })
        if package.loaded["lint"] then
            pcall(require("lint").try_lint)
        end
    end
end

---@class LspKickstartRunOpts
---@field method? string LSP method required (e.g. "textDocument/hover")
---@field action fun() Action to invoke once a supporting client is ready
---@field fallback? fun() Fallback when no LSP server applies to the buffer
---@field desc? string Description for notifications

--- Ensure LSP is running for the current buffer and run `opts.action` once ready.
---@param opts LspKickstartRunOpts
function M.kickstart_and_run(opts)
    local bufnr = vim.api.nvim_get_current_buf()

    if has_ready_client(bufnr, opts.method) then
        opts.action()
        return
    end

    M.kickstart(bufnr)

    if has_ready_client(bufnr, opts.method) then
        opts.action()
        return
    end

    local all_buf_clients = vim.lsp.get_clients({ bufnr = bufnr, _uninitialized = true })
    local uninitialized = vim.tbl_filter(function(c)
        return not c.initialized
    end, all_buf_clients)

    local async_starting = #all_buf_clients == 0 and has_matching_async_config(bufnr)

    if #uninitialized == 0 and not async_starting then
        if opts.fallback then
            opts.fallback()
        elseif #all_buf_clients > 0 then
            opts.action()
        else
            local ft = vim.bo[bufnr].filetype
            vim.notify(
                "LSP: no language server configured for filetype " .. (ft ~= "" and ft or "<empty>"),
                vim.log.levels.INFO
            )
        end
        return
    end

    local names = vim.tbl_map(function(c)
        return c.name
    end, uninitialized)
    local label = #names > 0 and table.concat(names, ", ") or vim.bo[bufnr].filetype
    vim.notify(string.format("Starting LSP (%s)...", label), vim.log.levels.INFO)

    local done = false
    local augroup = vim.api.nvim_create_augroup("LspKickstartPending_" .. bufnr, { clear = true })
    local timer = vim.uv.new_timer()

    local function cleanup()
        if done then
            return
        end
        done = true
        pcall(vim.api.nvim_del_augroup_by_id, augroup)
        if timer then
            timer:stop()
            timer:close()
            timer = nil
        end
    end

    local function try_dispatch()
        if done then
            return
        end
        if not vim.api.nvim_buf_is_valid(bufnr) or vim.api.nvim_get_current_buf() ~= bufnr then
            cleanup()
            return
        end
        if has_ready_client(bufnr, opts.method) then
            cleanup()
            vim.schedule(function()
                if vim.api.nvim_buf_is_valid(bufnr) and vim.api.nvim_get_current_buf() == bufnr then
                    opts.action()
                end
            end)
        end
    end

    vim.api.nvim_create_autocmd("LspAttach", {
        group = augroup,
        buffer = bufnr,
        callback = function()
            try_dispatch()
        end,
    })

    if timer then
        local elapsed = 0
        timer:start(100, 150, vim.schedule_wrap(function()
            elapsed = elapsed + 150
            try_dispatch()
            if not done and elapsed >= 10000 then
                cleanup()
                if opts.fallback then
                    opts.fallback()
                end
            end
        end))
    end
end

function M.setup_keymaps()
    vim.api.nvim_create_user_command("LspKickstart", function()
        local bufnr = vim.api.nvim_get_current_buf()
        M.kickstart(bufnr)
        local clients = vim.lsp.get_clients({ bufnr = bufnr, _uninitialized = true })
        local names = vim.tbl_map(function(c)
            return c.name
        end, clients)
        if #names > 0 then
            vim.notify("LSP active: " .. table.concat(names, ", "), vim.log.levels.INFO)
        else
            vim.notify("LSP enabled (no server matched current buffer)", vim.log.levels.INFO)
        end
    end, { desc = "Lazily load and start LSP servers" })

    vim.keymap.set("n", "<leader>ll", "<cmd>LspKickstart<cr>", { desc = "Kickstart LSP" })

    vim.keymap.set("n", "gd", function()
        M.kickstart_and_run({
            method = "textDocument/definition",
            action = vim.lsp.buf.definition,
            fallback = function()
                vim.cmd("normal! gd")
            end,
            desc = "Go to definition",
        })
    end, { desc = "LSP: Go to definition" })

    vim.keymap.set("n", "<C-]>", function()
        M.kickstart_and_run({
            method = "textDocument/definition",
            action = vim.lsp.buf.definition,
            fallback = function()
                pcall(vim.cmd, "normal! \29")
            end,
            desc = "Jump to definition/tag",
        })
    end, { desc = "LSP: Jump to definition" })

    vim.keymap.set("n", "gD", function()
        M.kickstart_and_run({
            method = "textDocument/declaration",
            action = vim.lsp.buf.declaration,
            fallback = function()
                vim.cmd("normal! gD")
            end,
            desc = "Go to declaration",
        })
    end, { desc = "LSP: Go to declaration" })

    vim.keymap.set("n", "gI", function()
        M.kickstart_and_run({
            method = "textDocument/implementation",
            action = vim.lsp.buf.implementation,
            desc = "Go to implementation",
        })
    end, { desc = "LSP: Go to implementation" })

    vim.keymap.set("n", "<leader>go", function()
        M.kickstart_and_run({
            method = "textDocument/typeDefinition",
            action = vim.lsp.buf.type_definition,
            desc = "Go to type definition",
        })
    end, { desc = "LSP: Type definition" })

    vim.keymap.set("n", "<leader>fr", function()
        M.kickstart_and_run({
            method = "textDocument/references",
            action = vim.lsp.buf.references,
            desc = "Find references",
        })
    end, { desc = "LSP: Find references" })

    vim.keymap.set("n", "K", function()
        if vim.list_contains({ "vim", "help" }, vim.bo.filetype) then
            pcall(vim.cmd, "help " .. vim.fn.expand("<cword>"))
            return
        end
        M.kickstart_and_run({
            method = "textDocument/hover",
            action = vim.lsp.buf.hover,
            fallback = function()
                pcall(vim.cmd, "help " .. vim.fn.expand("<cword>"))
            end,
            desc = "Hover documentation",
        })
    end, { desc = "LSP: Hover documentation" })

    vim.keymap.set("n", "gK", function()
        M.kickstart_and_run({
            method = "textDocument/signatureHelp",
            action = vim.lsp.buf.signature_help,
            desc = "Signature help",
        })
    end, { desc = "LSP: Signature help" })

    vim.keymap.set("n", "<leader>rv", function()
        M.kickstart_and_run({
            method = "textDocument/rename",
            action = vim.lsp.buf.rename,
            desc = "Rename symbol",
        })
    end, { desc = "LSP: Rename" })

    vim.keymap.set("n", "<leader>.", function()
        M.kickstart_and_run({
            method = "textDocument/codeAction",
            action = vim.lsp.buf.code_action,
            desc = "Code action",
        })
    end, { desc = "LSP: Code action" })

    vim.keymap.set("n", "gl", function()
        if not bootstrapped then
            M.kickstart()
        end
        vim.diagnostic.open_float()
    end, { desc = "Open diagnostic float" })

    vim.keymap.set("n", "[g", function()
        if not bootstrapped then
            M.kickstart()
        end
        vim.diagnostic.goto_prev()
    end, { desc = "Previous diagnostic" })

    vim.keymap.set("n", "]g", function()
        if not bootstrapped then
            M.kickstart()
        end
        vim.diagnostic.goto_next()
    end, { desc = "Next diagnostic" })
end

return M
