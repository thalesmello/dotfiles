-- Terminal provider that runs a coding agent in an in-nvim :terminal split,
-- opened through neoterminal so it inherits the same callbacks/keymaps as a
-- regular <c-space>v terminal (including alt-screen scroll forwarding via
-- open_filtered_terminal).
--
-- Shaped like the custom-table terminal provider that claudecode.nvim and
-- codex.nvim accept. M.new() returns one independent instance: each agent
-- (claude, codex, pi) needs its own buffer/window state, so the state lives in
-- the closure rather than at module level. ai_agents.lua creates and owns one
-- instance per agent.

local neoterminal = require('neovimterminal')

local M = {}

function M.new()
  local P = {}

  local bufnr = nil
  local winid = nil
  local jobid = nil
  local config = {}

  local function cleanup_state()
    bufnr = nil
    winid = nil
    jobid = nil
  end

  local function is_valid()
    if not bufnr or not vim.api.nvim_buf_is_valid(bufnr) then
      cleanup_state()
      return false
    end

    if winid and not vim.api.nvim_win_is_valid(winid) then
      for _, win in ipairs(vim.api.nvim_list_wins()) do
        if vim.api.nvim_win_get_buf(win) == bufnr then
          winid = win
          return true
        end
      end
      winid = nil
    end

    return true
  end

  local function is_visible()
    if not bufnr or not vim.api.nvim_buf_is_valid(bufnr) then
      return false
    end
    for _, win in ipairs(vim.api.nvim_list_wins()) do
      if vim.api.nvim_win_get_buf(win) == bufnr then
        winid = win
        return true
      end
    end
    winid = nil
    return false
  end

  local function create_split(effective_config)
    local width = math.floor(vim.o.columns * (effective_config.split_width_percentage or 0.30))
    local modifier = effective_config.split_side == "left" and "topleft " or "botright "
    vim.cmd(modifier .. width .. "vsplit")
    local new_win = vim.api.nvim_get_current_win()
    vim.api.nvim_win_set_height(new_win, vim.o.lines)
    vim.cmd("enew")
    return new_win
  end

  local function show_in_split(effective_config, focus)
    local original_win = vim.api.nvim_get_current_win()
    local new_win = create_split(effective_config)
    vim.api.nvim_win_set_buf(new_win, bufnr)
    winid = new_win

    if focus then
      vim.api.nvim_set_current_win(winid)
      vim.cmd("startinsert")
    else
      vim.api.nvim_set_current_win(original_win)
    end
  end

  local function focus_terminal()
    if winid and vim.api.nvim_win_is_valid(winid) then
      vim.api.nvim_set_current_win(winid)
      vim.cmd("startinsert")
    end
  end

  local function hide_terminal()
    if winid and vim.api.nvim_win_is_valid(winid) then
      vim.api.nvim_win_close(winid, false)
      winid = nil
    end
  end

  local function open_terminal(cmd_string, env_table, effective_config, focus)
    local original_win = vim.api.nvim_get_current_win()
    local new_win = create_split(effective_config)

    jobid = neoterminal.open_filtered_terminal(cmd_string, {
      env = env_table,
      cwd = effective_config.cwd,
      on_exit = function()
        vim.schedule(function()
          local saved_win = winid
          cleanup_state()

          if effective_config.auto_close and saved_win and vim.api.nvim_win_is_valid(saved_win) then
            vim.api.nvim_win_close(saved_win, true)
          end
        end)
      end,
    })

    if not jobid or jobid <= 0 then
      vim.api.nvim_win_close(new_win, true)
      vim.api.nvim_set_current_win(original_win)
      cleanup_state()
      return false
    end

    winid = new_win
    bufnr = vim.api.nvim_get_current_buf()
    vim.bo[bufnr].bufhidden = "hide"

    if focus then
      vim.api.nvim_set_current_win(winid)
      vim.cmd("startinsert")
    else
      vim.api.nvim_set_current_win(original_win)
    end

    return true
  end

  function P.setup(term_config)
    config = term_config or {}
  end

  -- focus defaults to false; see the note in herdr_agent_pane.lua. The plugins
  -- call terminal.open() with no focus argument while starting an agent to send
  -- to, and that must not steal the cursor.
  function P.open(cmd_string, env_table, effective_config, focus)
    if focus == nil then focus = false end
    effective_config = effective_config or config or {}

    if is_valid() then
      if not is_visible() then
        show_in_split(effective_config, focus)
      elseif focus then
        focus_terminal()
      end
    else
      open_terminal(cmd_string, env_table, effective_config, focus)
    end
  end

  function P.close()
    if is_valid() and winid and vim.api.nvim_win_is_valid(winid) then
      vim.api.nvim_win_close(winid, true)
      cleanup_state()
    end
  end

  function P.simple_toggle(cmd_string, env_table, effective_config)
    local has_buffer = is_valid()
    effective_config = effective_config or config or {}

    if has_buffer and is_visible() then
      hide_terminal()
    elseif has_buffer then
      show_in_split(effective_config, true)
    else
      open_terminal(cmd_string, env_table, effective_config, true)
    end
  end

  function P.focus_toggle(cmd_string, env_table, effective_config)
    local has_buffer = is_valid()
    effective_config = effective_config or config or {}

    if has_buffer and is_visible() then
      if winid == vim.api.nvim_get_current_win() then
        hide_terminal()
      else
        focus_terminal()
      end
    elseif has_buffer then
      show_in_split(effective_config, true)
    else
      open_terminal(cmd_string, env_table, effective_config, true)
    end
  end

  function P.get_active_bufnr()
    if is_valid() then
      return bufnr
    end
    return nil
  end

  --- Jump to the agent's terminal, showing it again if it was hidden.
  ---@return boolean focused
  function P.focus()
    if not is_valid() then
      return false
    end

    if is_visible() then
      focus_terminal()
    else
      show_in_split(config or {}, true)
    end
    return true
  end

  function P.is_available()
    return true
  end

  --- Stop treating this terminal as the agent's, without killing it. The
  --- window and its process stay exactly as they are; we just forget them, so
  --- the next open starts a fresh one.
  function P.detach()
    cleanup_state()
  end

  --- Send raw text to the terminal job, for agents driven through their stdin
  --- rather than over a websocket.
  ---@return boolean sent
  function P.send_text(text)
    if not is_valid() or not jobid then
      return false
    end
    vim.fn.chansend(jobid, text)
    return true
  end

  --- Drop text into the agent's input line without submitting it. Bracketed
  --- paste (and no trailing CR) keeps a multi-line body in the input as one
  --- block instead of submitting it a line at a time.
  ---@return boolean pasted
  function P.paste(text)
    return P.send_text("\27[200~" .. text .. "\27[201~")
  end

  return P
end

return M
