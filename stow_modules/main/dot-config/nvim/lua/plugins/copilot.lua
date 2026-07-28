return {
    'github/copilot.vim',
    enabled = false,
    cmd = {"Copilot"},
    event = "InsertEnter",
    config = function()
        vim.keymap.set('i', '<right>', 'copilot#Accept("\\<right>")', {
            expr = true,
            replace_keycodes = false
        })
        vim.g.copilot_no_tab_map = true
    end,
    dependencies = {
        {
            "CopilotC-Nvim/CopilotChat.nvim",
            opts = {
                prompts = {
                    Explain = "Explain how it works by in simple terms.",
                    Review = "Review the following code and provide concise suggestions.",
                    Tests = "Briefly explain how the selected code works, then generate unit tests.",
                    Refactor = "Refactor the code to improve clarity and readability.",
                },
            },
            build = function()
                vim.notify("Please update the remote plugins by running ':UpdateRemotePlugins', then restart Neovim.")
            end,
        },
    }
}
