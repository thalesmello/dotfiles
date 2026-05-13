local neoterminal = require('neovimterminal')

local M = {}

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

function M.setup(term_config)
  config = term_config
end

function M.open(cmd_string, env_table, effective_config, focus)
  if focus == nil then focus = true end

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

function M.close()
  if is_valid() and winid and vim.api.nvim_win_is_valid(winid) then
    vim.api.nvim_win_close(winid, true)
    cleanup_state()
  end
end

function M.simple_toggle(cmd_string, env_table, effective_config)
  local has_buffer = is_valid()

  if has_buffer and is_visible() then
    hide_terminal()
  elseif has_buffer then
    show_in_split(effective_config, true)
  else
    open_terminal(cmd_string, env_table, effective_config, true)
  end
end

function M.focus_toggle(cmd_string, env_table, effective_config)
  local has_buffer = is_valid()

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

function M.get_active_bufnr()
  if is_valid() then
    return bufnr
  end
  return nil
end

function M.is_available()
  return true
end

return M
