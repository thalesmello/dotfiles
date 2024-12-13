local M = {}

local K_SPECIAL = string.char(0x80)
local KS_MODIFIER = string.char(252)

local KS_EXTRA = string.char(253)

local KE_S_UP = string.char(4)
local KE_S_DOWN = string.char(5)

local KE_S_F1 = string.char(6)
local KE_S_F2 = string.char(7)
local KE_S_F3 = string.char(8)
local KE_S_F4 = string.char(9)
local KE_S_F5 = string.char(10)
local KE_S_F6 = string.char(11)
local KE_S_F7 = string.char(12)
local KE_S_F8 = string.char(13)
local KE_S_F9 = string.char(14)
local KE_S_F10 = string.char(15)
local KE_S_F11 = string.char(16)
local KE_S_F12 = string.char(17)


local KE_TAB = string.char(54)

local KE_MOUSEDOWN = string.char(75)
local KE_MOUSEUP = string.char(76)
local KE_MOUSELEFT = string.char(77)
local KE_MOUSERIGHT = string.char(78)

local KE_KINS = string.char(79)
local KE_KDEL = string.char(80)

local KE_C_LEFT = string.char(85)
local KE_C_RIGHT = string.char(86)
local KE_C_HOME = string.char(87)
local KE_C_END = string.char(88)

local kspecial_codes = {
    ['ku'] = "<Up>",
    ['Ku'] = "<Kup>",
    ['kd'] = "<Down>",
    ['Kd'] = "<Kdown>",
    ['kl'] = "<Left>",
    ['Kl'] = "<Kleft>",
    ['kr'] = "<Right>",
    ['Kr'] = "<Kright>",
    [KS_EXTRA..KE_S_UP] = "<S-up>",
    [KS_EXTRA..KE_S_DOWN] = "<S-down>",
    ['#4'] = "<S-left>",
    [KS_EXTRA..KE_C_LEFT] = "<C-left>",
    ['%i'] = "<S-right>",
    [KS_EXTRA..KE_C_RIGHT] = "<C-right>",
    ['#2'] = "<S-home>",
    [KS_EXTRA..KE_C_HOME] = "<C-home>",
    ['*7'] = "<S-end>",
    [KS_EXTRA..KE_C_END] = "<C-end>",
    [KS_EXTRA..KE_TAB] = "<Tab>",
    ['kB'] = "<S-tab>",
    ['k1'] = "<F1>",
    ['k2'] = "<F2>",
    ['k3'] = "<F3>",
    ['k4'] = "<F4>",
    ['k5'] = "<F5>",
    ['k6'] = "<F6>",
    ['k7'] = "<F7>",
    ['k8'] = "<F8>",
    ['k9'] = "<F9>",
    ['k;'] = "<F10>",
    ['F1'] = "<F11>",
    ['F2'] = "<F12>",
    ['F3'] = "<F13>",
    ['F4'] = "<F14>",
    ['F5'] = "<F15>",
    ['F6'] = "<F16>",
    ['F7'] = "<F17>",
    ['F8'] = "<F18>",
    ['F9'] = "<F19>",
    ['FA'] = "<F20>",
    ['FB'] = "<F21>",
    ['FC'] = "<F22>",
    ['FD'] = "<F23>",
    ['FE'] = "<F24>",
    ['FF'] = "<F25>",
    ['FG'] = "<F26>",
    ['FH'] = "<F27>",
    ['FI'] = "<F28>",
    ['FJ'] = "<F29>",
    ['FK'] = "<F30>",
    ['FL'] = "<F31>",
    ['FM'] = "<F32>",
    ['FN'] = "<F33>",
    ['FO'] = "<F34>",
    ['FP'] = "<F35>",
    ['FQ'] = "<F36>",
    ['FR'] = "<F37>",
    ['FS'] = "<F38>",
    ['FT'] = "<F39>",
    ['FU'] = "<F40>",
    ['FV'] = "<F41>",
    ['FW'] = "<F42>",
    ['FX'] = "<F43>",
    ['FY'] = "<F44>",
    ['FZ'] = "<F45>",
    ['Fa'] = "<F46>",
    ['Fb'] = "<F47>",
    ['Fc'] = "<F48>",
    ['Fd'] = "<F49>",
    ['Fe'] = "<F50>",
    ['Ff'] = "<F51>",
    ['Fg'] = "<F52>",
    ['Fh'] = "<F53>",
    ['Fi'] = "<F54>",
    ['Fj'] = "<F55>",
    ['Fk'] = "<F56>",
    ['Fl'] = "<F57>",
    ['Fm'] = "<F58>",
    ['Fn'] = "<F59>",
    ['Fo'] = "<F60>",
    ['Fp'] = "<F61>",
    ['Fq'] = "<F62>",
    ['Fr'] = "<F63>",
    [KS_EXTRA..KE_S_F1] = "<S-f1>",
    [KS_EXTRA..KE_S_F2] = "<S-f2>",
    [KS_EXTRA..KE_S_F3] = "<S-f3>",
    [KS_EXTRA..KE_S_F4] = "<S-f4>",
    [KS_EXTRA..KE_S_F5] = "<S-f5>",
    [KS_EXTRA..KE_S_F6] = "<S-f6>",
    [KS_EXTRA..KE_S_F7] = "<S-f7>",
    [KS_EXTRA..KE_S_F8] = "<S-f8>",
    [KS_EXTRA..KE_S_F9] = "<S-f9>",
    [KS_EXTRA..KE_S_F10] = "<S-f10>",
    [KS_EXTRA..KE_S_F11] = "<S-f11>",
    [KS_EXTRA..KE_S_F12] = "<S-f12>",
    ['%1'] = "<Help>",
    ['&8'] = "<Undo>",
    ['kb'] = "<Bs>",
    ['kI'] = "<Ins>",
    ['kD'] = "<Del>",
    ['kh'] = "<Home>",
    ['K1']  = "<Khome>",
    ['@7'] = "<End>",
    ['K4']   = "<Kend>",
    ['kP'] = "<Pageup>",
    ['kN'] = "<Pagedown>",
    ['K3']   = "<Kpageup>",
    ['K5']   = "<Kpagedown>",
    ['K6'] = "<Kplus>",
    ['K7'] = "<Kminus>",
    ['K8'] = "<Kdivide>",
    ['K9'] = "<Kmultiply>",
    ['KA'] = "<Kenter>",
    ['KB'] = "<Kpoint>",
    ['KC'] = "<K0>",
    ['KD'] = "<K1>",
    ['KE'] = "<K2>",
    ['KF'] = "<K3>",
    ['KG'] = "<K4>",
    ['KH'] = "<K5>",
    ['KI'] = "<K6>",
    ['KJ'] = "<K7>",
    ['KK'] = "<K8>",
    ['KL'] = "<K9>",
    [KS_EXTRA..KE_KINS] = "<Kins>",
    [KS_EXTRA..KE_KDEL] = "<Kdel>",
    [KS_EXTRA..KE_MOUSEDOWN] = "<ScrollWheelDown>",
    [KS_EXTRA..KE_MOUSEUP] = "<ScrollWheelUp>",
    [KS_EXTRA..KE_MOUSELEFT] = "<ScrollWheelLeft>",
    [KS_EXTRA..KE_MOUSERIGHT] = "<ScrollWheelRight>",

	-- I don't know what this does yet,
	-- but removing it from the term codes doesn't seem to be prejudicial
	["ý5"] = "",
 }



local ascii_codes = {
    [0] = "<C-Space>",
    [1] = "<C-A>",
    [2] = "<C-B>",
    [3] = "<C-C>",
    [4] = "<C-D>",
    [5] = "<C-E>",
    [6] = "<C-F>",
    [7] = "<C-G>",
    [8] = "<C-H>",
    [9] = "<Tab>",
    [11] = "<C-K>",
    [12] = "<C-L>",
    [13] = "<C-M>",
    [14] = "<C-N>",
    [15] = "<C-O>",
    [16] = "<C-P>",
    [17] = "<C-Q>",
    [18] = "<C-R>",
    [19] = "<C-S>",
    [20] = "<C-T>",
    [21] = "<C-U>",
    [22] = "<C-V>",
    [23] = "<C-W>",
    [24] = "<C-X>",
    [25] = "<C-Y>",
    [26] = "<C-Z>",
    [27] = "<Esc>",
    [28] = "<C-\\>",
    [29] = "<C-]>",
    [30] = "<C-^>",
    [31] = "<C-_>",
    [127] = "<C-?>",
}

local modifiers = {
    [0x02] = 'S',
    [0x04] = 'C',
    [0x08] = 'A',
    [0x10] = 'M',
    [0x80] = 'D',
}

function M.reverse_termcodes(str)
	str = str:gsub(K_SPECIAL .. KS_MODIFIER .. '(.)(.)', function (modifier, char)
	    modifier = modifiers[modifier:byte()] or modifier
	    return "<" .. modifier .. "-" .. char .. ">"
	end)

	str = str:gsub(K_SPECIAL .. '(..)', function (cc)
		return kspecial_codes[cc] or cc
	end)

	str = str:gsub(".", function(c)
		return ascii_codes[c:byte()] or c
	end)

	return str
end

return M
