return {
    {
        'ggandor/leap.nvim',
        keys = {
            {"s", "<Plug>(leap-forward)", mode = { "n" }, desc = "Leap forward to"},
            {"S", "<Plug>(leap-backward)", mode = { "n" }, desc = "Leap backward to"},
            {"gs", "<Plug>(leap-from-window)", mode = { "n" }, desc = "Leap from windows"},
            {"s", "<Plug>(leap-forward-to)", mode = { "x" }, desc = "Leap operator inclusive"},
            {"gs", "<Plug>(leap-backward-to)", mode = { "x" }, desc = "Leap backwards operator inclusive"},
            {"z", "<Plug>(leap-forward-to)", mode = { "o" }, desc = "Leap operator inclusive"},
            {"Z", "<Plug>(leap-backward-to)", mode = { "o" }, desc = "Leap backwards operator inclusive"},
            {"x", "<Plug>(leap-forward-till)", mode = { "o" }, desc = "Leap operator non-inclusive"},
            {"X", "<Plug>(leap-backward-till)", mode = { "o" }, desc = "Leap backwards operator inclusive"},
        },
        -- config = function ()
        --     local function createMagnaticJump(opts)
        --         local action
        --         do
        --             local first_jump = true
        --             action = function (target)
        --                 local winid = target.wininfo.winid
        --                 local bufid = vim.api.nvim_win_get_buf(winid)
        --                 local pos = target.pos
        --                 local line_text = unpack(vim.api.nvim_buf_get_lines(bufid, pos[1] - 1, pos[1], true))
        --
        --                 local boundaries = vim.iter(vim.fn.matchstrlist({line_text}, [[\<\w\|\w\>]])):map(function(d) return d.byteidx + 1 end):totable()
        --                 local offset
        --
        --                 if opts.backward then
        --                     if vim.list_contains(boundaries, pos[2]) then
        --                         offset = 0
        --                     elseif vim.list_contains(boundaries, pos[2] + 1) then
        --                         offset = 1
        --                     else
        --                         offset = 0
        --                     end
        --                 else
        --                     if vim.list_contains(boundaries, pos[2] + 1) then
        --                         offset = 1
        --                     else
        --                         offset = 0
        --                     end
        --                 end
        --
        --                 local jump = require("leap.jump")
        --                 jump["jump-to!"](target.pos, {
        --                     winid = target.wininfo.winid,
        --                     ["add-to-jumplist?"] = first_jump,
        --                     mode = opts.mode,
        --                     offset = offset,
        --                     ["backward?"] = opts.backward,
        --                     ["inclusive-op?"] = opts.inclusive,
        --                 })
        --                 first_jump = false
        --                 return nil
        --             end
        --         end
        --
        --         return action
        --     end
        --     vim.keymap.set("n", "<Plug>(leap-magnetic-forward)", function ()
        --         local opts = {
        --             backward = false,
        --             inclusive = false,
        --             mode = "n",
        --         }
        --
        --         require('leap').leap(vim.tbl_deep_extend("force", {}, opts, { action = createMagnaticJump(opts) }))
        --     end, { remap = false, desc = "Leap forward to" })
        --
        --     vim.keymap.set("n", "<Plug>(leap-magnetic-backward)", function ()
        --         local opts = {
        --             backward = true,
        --             inclusive = false,
        --             mode = "n",
        --         }
        --
        --         require('leap').leap(vim.tbl_deep_extend("force", {}, opts, { action = createMagnaticJump(opts) }))
        --     end, { remap = false, desc = "Leap forward to" })
        -- end,
        extra_contexts = {"vscode", "firenvim", "lite_mode", "ssh"}
    },
    {
        'rasulomaroff/telepath.nvim',
        dependencies = 'ggandor/leap.nvim',
        keys = {
            { 'r', function() require('telepath').remote { restore = true } end, mode = 'o' },
            { 'R', function() require('telepath').remote { restore = true, recursive = true } end, mode = 'o' },
            { 'm', function() require('telepath').remote() end, mode = 'o' },
            { 'M', function() require('telepath').remote { recursive = true } end, mode = 'o' }
        },
        extra_contexts = {"vscode", "firenvim"}
    }
}
