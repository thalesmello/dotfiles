// @bun
// stow_modules/main/dot-pi/agent/extensions/open-tui/config.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
var DEFAULT_CONFIG = {
  enabled: true,
  header: true,
  inlineFooter: false,
  copyButtons: true,
  settingsLanguage: "en",
  cursorStyle: "block",
  icons: {
    mode: "auto"
  },
  footerSegments: {
    cwd: true,
    hostname: false,
    sessionName: false,
    gitBranch: true,
    gitStatus: true,
    gitCommit: false,
    runtime: true,
    context: true,
    tokens: true,
    cost: true,
    liveTps: true,
    extensionSegments: true,
    extensionStatuses: true,
    capitalizeProviderName: true,
    nerdIconSpacing: false
  },
  telemetry: {
    enabled: true,
    tps: true,
    ttft: true,
    duration: true,
    tokens: true,
    stalls: true,
    cost: true
  },
  thinkingPeek: {
    lines: 1
  },
  toolView: {
    mode: "native",
    extensionTools: false,
    exclude: []
  }
};
function getConfigPath() {
  const agentDir = getAgentDir();
  return join(agentDir, "open-tui.json");
}
function normalizeThinkingPeekLines(value) {
  return value === 0 || value === 1 || value === 2 ? value : DEFAULT_CONFIG.thinkingPeek.lines;
}
function normalizeToolView(value) {
  const source = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  return {
    mode: source.mode === "compact" ? "compact" : DEFAULT_CONFIG.toolView.mode,
    extensionTools: source.extensionTools === true,
    exclude: Array.isArray(source.exclude) ? source.exclude.filter((name) => typeof name === "string") : []
  };
}
var ICON_MODES = ["auto", "nerd", "unicode", "ascii"];
function normalizeFlags(value, defaults) {
  const source = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  const result = { ...source };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (typeof result[key] !== "boolean")
      result[key] = fallback;
  }
  return result;
}
function deepMerge(base, override) {
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    return override ?? base;
  }
  if (typeof override !== "object" || override === null || Array.isArray(override)) {
    return base;
  }
  const result = { ...base };
  const overrideRec = override;
  for (const key of Object.keys(overrideRec)) {
    const baseVal = base[key];
    const overVal = overrideRec[key];
    if (typeof baseVal === "object" && baseVal !== null && !Array.isArray(baseVal) && typeof overVal === "object" && overVal !== null && !Array.isArray(overVal)) {
      result[key] = deepMerge(baseVal, overVal);
    } else if (overVal !== undefined) {
      result[key] = overVal;
    }
  }
  return result;
}
function ensureConfigExists() {
  const path = getConfigPath();
  if (existsSync(path))
    return;
  try {
    const agentDir = getAgentDir();
    if (!existsSync(agentDir))
      mkdirSync(agentDir, { recursive: true });
    writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2) + `
`, "utf8");
  } catch {}
}
function loadConfig(notify) {
  const path = getConfigPath();
  if (!existsSync(path)) {
    ensureConfigExists();
    return structuredClone(DEFAULT_CONFIG);
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    const config = deepMerge(DEFAULT_CONFIG, parsed);
    if (typeof config.enabled !== "boolean") {
      config.enabled = DEFAULT_CONFIG.enabled;
    }
    if (typeof config.header !== "boolean") {
      config.header = DEFAULT_CONFIG.header;
    }
    if (typeof config.inlineFooter !== "boolean") {
      config.inlineFooter = DEFAULT_CONFIG.inlineFooter;
    }
    if (typeof config.copyButtons !== "boolean") {
      config.copyButtons = DEFAULT_CONFIG.copyButtons;
    }
    config.footerSegments = normalizeFlags(config.footerSegments, DEFAULT_CONFIG.footerSegments);
    config.telemetry = normalizeFlags(config.telemetry, DEFAULT_CONFIG.telemetry);
    if (typeof config.icons !== "object" || config.icons === null || !ICON_MODES.includes(config.icons.mode)) {
      config.icons = structuredClone(DEFAULT_CONFIG.icons);
    }
    if (config.settingsLanguage !== "en" && config.settingsLanguage !== "zh") {
      config.settingsLanguage = DEFAULT_CONFIG.settingsLanguage;
    }
    if (config.cursorStyle !== "block" && config.cursorStyle !== "bar" && config.cursorStyle !== "underline") {
      config.cursorStyle = DEFAULT_CONFIG.cursorStyle;
    }
    if (typeof config.thinkingPeek !== "object" || config.thinkingPeek === null || Array.isArray(config.thinkingPeek)) {
      config.thinkingPeek = structuredClone(DEFAULT_CONFIG.thinkingPeek);
    } else {
      config.thinkingPeek.lines = normalizeThinkingPeekLines(config.thinkingPeek.lines);
    }
    config.toolView = normalizeToolView(config.toolView);
    return config;
  } catch (err) {
    notify?.(`open-tui config parse error: ${err instanceof Error ? err.message : String(err)}`, "warning");
    return structuredClone(DEFAULT_CONFIG);
  }
}
function saveConfig(config) {
  const path = getConfigPath();
  try {
    const agentDir = getAgentDir();
    if (!existsSync(agentDir))
      mkdirSync(agentDir, { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2) + `
`, "utf8");
    return true;
  } catch {
    return false;
  }
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/copy-buttons.ts
import { randomUUID } from "crypto";
import { copyToClipboard, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import {
  compositeTuiLine,
  Markdown,
  Marked as Marked2,
  truncateToWidth as truncateToWidth2,
  TuiAltScreen,
  visibleWidth as visibleWidth3
} from "@earendil-works/pi-tui";

// stow_modules/main/dot-pi/agent/extensions/open-tui/utils.ts
import { isAbsolute, relative, resolve, sep } from "path";
import {
  stripTerminalSequences as stripTerminalSequencesFromTui,
  truncateToWidth,
  visibleWidth
} from "@earendil-works/pi-tui";
var CSI_SEQUENCE = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g;
function stripAnsi(text) {
  return stripTerminalSequencesFromTui(text.replace(CSI_SEQUENCE, ""));
}
function formatCwd(cwd) {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home)
    return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const rel = relative(resolvedHome, resolvedCwd);
  const insideHome = rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  if (!insideHome)
    return cwd;
  return rel === "" ? "~" : `~${sep}${rel}`;
}
function basenamePath(path) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
function truncateBranch(branch, maxLen) {
  if (branch.length <= maxLen)
    return branch;
  if (maxLen <= 3)
    return "...".slice(0, maxLen);
  return `${branch.slice(0, maxLen - 3)}...`;
}
function truncatePath(path, maxLen) {
  if (visibleWidth(path) <= maxLen)
    return path;
  if (maxLen <= 3)
    return "...".slice(0, maxLen);
  const sepChar = path.includes("/") ? "/" : "\\";
  const parts = path.split(/[\\/]/);
  if (parts.length <= 2)
    return truncateToWidth(path, maxLen, "...");
  const tail = [];
  let tailLen = 0;
  for (let i = parts.length - 1;i >= 1; i--) {
    const seg = parts[i];
    if (tailLen + visibleWidth(seg) + 4 > maxLen)
      break;
    tail.unshift(seg);
    tailLen += visibleWidth(seg) + 1;
  }
  const head = parts[0];
  const result = `${head}${sepChar}...${sepChar}${tail.join(sepChar)}`;
  return visibleWidth(result) > maxLen ? truncateToWidth(result, maxLen, "...") : result;
}
function finiteOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function fmtTokens(n) {
  if (n < 1000)
    return n.toString();
  if (n < 1e4)
    return `${(n / 1000).toFixed(1)}k`;
  if (n < 1e6)
    return `${Math.round(n / 1000)}k`;
  if (n < 1e7)
    return `${(n / 1e6).toFixed(1)}M`;
  return `${Math.round(n / 1e6)}M`;
}
function formatInputBreakdown(uncached, cacheRead) {
  const total = fmtTokens(uncached + cacheRead);
  return cacheRead > 0 ? `${total} (U ${fmtTokens(uncached)} + R ${fmtTokens(cacheRead)})` : total;
}
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60)
    return `${totalSeconds}s`;
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60)
    return `${totalMinutes}m ${s}s`;
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${h}h ${m}m ${s}s`;
}
function formatModelLabel(model) {
  if (!model?.id)
    return "no-model";
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}
function formatProviderLabel(provider, capitalize) {
  if (!provider)
    return "Unknown";
  return capitalize ? provider.charAt(0).toUpperCase() + provider.slice(1) : provider;
}
function alignRight(left, right, width, theme) {
  const rightW = visibleWidth(right);
  if (rightW > width) {
    right = truncateToWidth(right, width, theme.fg("dim", "..."));
  }
  const leftW = visibleWidth(left);
  const rightW2 = visibleWidth(right);
  const pad = width - leftW - rightW2;
  if (pad >= 1) {
    return left + " ".repeat(pad) + right;
  }
  const availableForLeft = Math.max(0, width - rightW2 - 1);
  const truncatedLeft = availableForLeft > 0 ? truncateToWidth(left, availableForLeft, theme.fg("dim", "...")) : "";
  return truncatedLeft ? truncatedLeft + " " + right : right;
}
function fitSegmentsByPriority(segs, maxW, ellipsis = "...", options = {}) {
  const items = segs.map((s, index) => ({
    index,
    text: s.text,
    compactText: s.compactText,
    priority: s.priority,
    truncate: s.truncate,
    w: visibleWidth(s.text)
  }));
  const totalW = () => {
    const active = items.filter((it) => it.text !== "");
    return active.reduce((width, item, index) => width + item.w + (index === 0 ? 0 : options.gapWidth?.(active[index - 1].index, item.index) ?? 1), 0);
  };
  if (totalW() > maxW) {
    const compactItems = options.compactOrder === "priority" ? [...items].sort((a, b) => a.priority - b.priority || a.index - b.index) : items;
    for (const item of compactItems) {
      if (!item.compactText || visibleWidth(item.compactText) >= item.w)
        continue;
      item.text = item.compactText;
      item.w = visibleWidth(item.text);
      if (totalW() <= maxW)
        break;
    }
  }
  let lastTotal = Infinity;
  while (totalW() > maxW) {
    const nowTotal = totalW();
    if (nowTotal >= lastTotal) {
      let worst = -1;
      for (let i = 0;i < items.length; i++) {
        if (items[i].text !== "" && (worst === -1 || items[i].priority < items[worst].priority)) {
          worst = i;
        }
      }
      if (worst === -1)
        break;
      items[worst].text = "";
      items[worst].w = 0;
      continue;
    }
    lastTotal = nowTotal;
    let target = -1;
    for (let i = 0;i < items.length; i++) {
      if (items[i].text !== "" && (target === -1 || items[i].priority < items[target].priority)) {
        target = i;
      }
    }
    if (target === -1)
      break;
    const avail = maxW - (nowTotal - items[target].w);
    if (avail <= visibleWidth(ellipsis)) {
      items[target].text = "";
      items[target].w = 0;
    } else if (avail < items[target].w) {
      const truncate = items[target].truncate;
      items[target].text = truncate ? truncate(items[target].text, avail, ellipsis) : truncateToWidth(items[target].text, avail, ellipsis);
      items[target].w = visibleWidth(items[target].text);
    } else {
      break;
    }
  }
  return items.map((it) => it.text);
}
function stressColor(value, warn = 70, danger = 90) {
  if (value >= danger)
    return "error";
  if (value >= warn)
    return "warning";
  return "accent";
}
function cacheHitColor(value) {
  if (value < 30)
    return "error";
  if (value < 70)
    return "warning";
  return "success";
}
function providerColor(provider) {
  switch (provider.toLowerCase()) {
    case "anthropic":
      return "accent";
    case "openai":
    case "openai-codex":
      return "success";
    case "google":
    case "google-vertex":
      return "warning";
    case "amazon-bedrock":
      return "thinkingHigh";
    case "github-copilot":
      return "mdLink";
    case "deepseek":
      return "thinkingLow";
    case "xai":
    case "groq":
      return "error";
    default:
      return "muted";
  }
}
function effortColor(level) {
  switch (level) {
    case "minimal":
      return "thinkingMinimal";
    case "low":
      return "thinkingLow";
    case "medium":
      return "thinkingMedium";
    case "high":
      return "thinkingHigh";
    case "xhigh":
      return "thinkingXhigh";
    default:
      return "thinkingMedium";
  }
}
function isEditorBorderLine(line) {
  if (typeof line !== "string")
    return false;
  const plain = stripAnsi(line);
  if (/^\u2500+$/.test(plain))
    return true;
  if (/^\u2500*\s*[\u2191\u2193]\s+\d+\s+more\s*\u2500*$/.test(plain))
    return true;
  return false;
}
function findBottomBorderIndex(lines) {
  for (let i = lines.length - 1;i >= 1; i--) {
    const line = lines[i];
    if (line !== undefined && isEditorBorderLine(line))
      return i;
  }
  return Math.max(0, lines.length - 1);
}
function padRight(text, width, ellipsis = "") {
  const clipped = truncateToWidth(text, width, ellipsis);
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}
function center(text, width) {
  if (width <= 0)
    return "";
  const w = visibleWidth(text);
  if (w >= width)
    return truncateToWidth(text, width, "...");
  return `${" ".repeat(Math.floor((width - w) / 2))}${text}`;
}
function sanitizeStatus(text) {
  return stripAnsi(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/ +/g, " ").trim();
}
var STATUS_TOKEN = /(?:\x1b\[|\x9b)[0-?]*[ -/]*m|(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|(?:\x1bP|\x90|\x1bX|\x98|\x1b\^|\x9e|\x1b_|\x9f)[\s\S]*?(?:\x1b\\|\x9c|$)|(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c|$)|\x1b[@-Z\\_]|[\u0000-\u001f\u007f-\u009f]/g;
var SGR_TOKEN = /^(?:\x1b\[|\x9b)[0-9;:]*m$/;
var SGR_SEQUENCE = /(?:\x1b\[|\x9b)[0-9;:]*m/;
function sanitizeStatusPreservingStyles(text) {
  const cleaned = text.replace(STATUS_TOKEN, (token) => SGR_TOKEN.test(token) ? token : " ");
  return cleaned.replace(/ {2,}/g, " ").trim();
}
function hasAnsiStyles(text) {
  return SGR_SEQUENCE.test(text);
}
function formatThinkingLabel(level) {
  if (level === "off")
    return "thinking off";
  return `${level} effort`;
}
var PI_BUILTIN_SLASH_COMMAND_NAMES = [
  "settings",
  "model",
  "scoped-models",
  "export",
  "import",
  "share",
  "copy",
  "name",
  "session",
  "changelog",
  "hotkeys",
  "fork",
  "clone",
  "tree",
  "trust",
  "login",
  "logout",
  "new",
  "compact",
  "resume",
  "reload",
  "quit"
];
function collectPiCommandNames(sessionCommands) {
  const names = new Set(PI_BUILTIN_SLASH_COMMAND_NAMES);
  for (const command of sessionCommands) {
    if (command.name)
      names.add(command.name);
  }
  return [...names];
}
function pickSlashCommandTips(availableNames, options = {}) {
  const fixed = [...options.fixed ?? []];
  const count = options.count ?? 3;
  const exclude = new Set([...options.exclude ?? [], ...fixed]);
  const random = options.random ?? Math.random;
  const pool = [...new Set(availableNames.map((n) => n.trim()).filter(Boolean))].filter((name) => !exclude.has(name));
  for (let i = pool.length - 1;i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  const picked = pool.slice(0, Math.max(0, count));
  return [...fixed, ...picked].map((name) => name.startsWith("/") ? name : `/${name}`);
}
var MIN_LEFT_WIDTH = 28;
var MIN_TIPS_WIDTH = 16;
var MAX_TIPS_WIDTH = 28;
var COLUMN_GAP = 3;
function headerColumnWidths(innerWidth, minTipsWidth = MIN_TIPS_WIDTH, maxTipsWidth = MAX_TIPS_WIDTH, minLeftWidth = MIN_LEFT_WIDTH) {
  if (innerWidth <= 0) {
    return { leftWidth: 0, rightWidth: 0, useTips: false };
  }
  const gap = COLUMN_GAP;
  if (innerWidth < minLeftWidth + gap + minTipsWidth) {
    return { leftWidth: innerWidth, rightWidth: 0, useTips: false };
  }
  let rightWidth = Math.min(maxTipsWidth, Math.max(minTipsWidth, Math.round(innerWidth * 0.28)));
  let leftWidth = innerWidth - gap - rightWidth;
  if (leftWidth < minLeftWidth) {
    leftWidth = minLeftWidth;
    rightWidth = innerWidth - gap - leftWidth;
  }
  if (leftWidth <= rightWidth) {
    leftWidth = Math.ceil((innerWidth - gap) * 0.65);
    rightWidth = innerWidth - gap - leftWidth;
  }
  if (rightWidth < minTipsWidth || leftWidth < minLeftWidth) {
    return { leftWidth: innerWidth, rightWidth: 0, useTips: false };
  }
  return { leftWidth, rightWidth, useTips: true };
}

// stow_modules/main/dot-pi/agent/extensions/osc8-links.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, statSync } from "fs";
import { homedir } from "os";
import { delimiter, dirname, isAbsolute as isAbsolute2, join as join2, normalize, resolve as resolve2 } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import * as piTui from "@earendil-works/pi-tui";
var PATCH_STATE_SYMBOL = Symbol.for("pi.osc8Links.patchState");
var PATH_STATE_SYMBOL = Symbol.for("pi.osc8Links.pathState");
var OSC8_CLOSE = "\x1B]8;;\x1B\\";
var RAW_OSC8_OPEN_FILE_URL_REGEX = /\x1b\]8;([^;\x07\x1b]*);(file:\/\/[^\x07\x1b]+)(\x07|\x1b\\)/gi;
var PLAIN_URL_Candidate_REGEX = /https?:\/\/(?:<[a-zA-Z0-9_.:-]+>|[^\s<>"'`\x00-\x1f\x7f\u2502\u250C\u2510\u2514\u2518\u251C\u2524\u252C\u2534\u253C\u2500])+/gi;
var PLAIN_FILE_URL_CANDIDATE_REGEX = /file:\/\/[^\s<>"'`\x00-\x1f\x7f\u2502\u250C\u2510\u2514\u2518\u251C\u2524\u252C\u2534\u253C\u2500]+/gi;
var PLAIN_PATH_CANDIDATE_REGEX = /(?:\u2026\/|~\/|\.\.?\/|\/+)?\.?[A-Za-z0-9_][\w./+@%-]*[\w]/g;
var PATHISH_EXTENSION_OR_SLASH_REGEX = /\/|(?<!\.)\.[A-Za-z][A-Za-z0-9]{0,9}$/;
var SCHEME_PREFIX_REGEX = /(?:https?|ftp|file|mailto|ssh|git|npm|hammerspoon|tot):$/i;
var LINE_COL_SUFFIX_REGEX = /^(.*?):(\d+)(?:(?::|-)(\d+))?$/;
var HTML_LAYOUT_TAG_REGEX = /^<\/?(?:br|wbr|hr|p|div|span|a|img|code|pre|em|strong|b|i|u|s|del|ins|sub|sup|td|th|tr|table)\b/i;
var graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
var cjkBreakRegex = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u;
var FILE_STAT_CACHE_TTL_MS = 2000;
var FILE_STAT_CACHE_MAX_SIZE = 2048;
function getSharedPathState() {
  const holder = globalThis;
  if (!holder[PATH_STATE_SYMBOL]) {
    holder[PATH_STATE_SYMBOL] = {
      sessionCwd: process.cwd(),
      fileStatCache: new Map,
      knownPathsBySuffix: new Map,
      indexedSessionFiles: new Set
    };
  }
  return holder[PATH_STATE_SYMBOL];
}
function isHerdrOrHcSession(env = process.env) {
  return env.HERDR_ENV === "1" || Boolean(env.HERDR_PANE_ID) || Boolean(env.HERDR_ACTIVE_PANE_ID) || Boolean(env.HC_TERMINAL_ID);
}
function getSessionCwd() {
  return getSharedPathState().sessionCwd || process.cwd();
}
function formatHerdrFileHyperlinkUrl(filePath, kind = "file") {
  return `hammerspoon://workflow-preset/open-selection?type=${encodeURIComponent(kind)}&match=${encodeURIComponent(filePath)}`;
}
function expandHomePath(rawPath, home = homedir()) {
  if (rawPath === "~")
    return home;
  if (rawPath.startsWith("~/") || rawPath.startsWith("~\\")) {
    return join2(home, rawPath.slice(2));
  }
  return rawPath;
}
function indexKnownFilePath(absPath) {
  const { knownPathsBySuffix } = getSharedPathState();
  const normalized = absPath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0)
    return;
  let suffix = "";
  for (let i = parts.length - 1;i >= 0; i--) {
    suffix = suffix ? `${parts[i]}/${suffix}` : parts[i];
    knownPathsBySuffix.set(suffix, absPath);
  }
}
function statExistingPath(absPath) {
  const { fileStatCache } = getSharedPathState();
  const now = Date.now();
  const cached = fileStatCache.get(absPath);
  if (cached && cached.expiresAt > now) {
    return cached.kind;
  }
  let kind = null;
  try {
    const st = statSync(absPath);
    if (st.isFile())
      kind = "file";
    else if (st.isDirectory())
      kind = "directory";
  } catch {
    kind = null;
  }
  if (fileStatCache.size >= FILE_STAT_CACHE_MAX_SIZE) {
    fileStatCache.clear();
  }
  fileStatCache.set(absPath, { kind, expiresAt: now + FILE_STAT_CACHE_TTL_MS });
  if (kind) {
    indexKnownFilePath(absPath);
  }
  return kind;
}
function stripOptionalLineColSuffix(filePath) {
  const m = LINE_COL_SUFFIX_REGEX.exec(filePath);
  if (!m || !m[1])
    return filePath;
  if (statExistingPath(filePath) !== null)
    return filePath;
  if (statExistingPath(m[1]) !== null)
    return m[1];
  return m[1];
}
function registerKnownFilePath(rawPath, cwd = getSessionCwd()) {
  if (typeof rawPath !== "string")
    return;
  let trimmed = rawPath.trim();
  if (!trimmed)
    return;
  if (trimmed.startsWith("@") && trimmed.length > 1) {
    trimmed = trimmed.slice(1);
  }
  if (/^file:\/\//i.test(trimmed)) {
    const parsed = parseFileHyperlinkUrl(trimmed);
    if (!parsed)
      return;
    trimmed = parsed.filePath;
  }
  const expanded = expandHomePath(trimmed);
  const resolved = isAbsolute2(expanded) ? normalize(expanded) : resolve2(cwd, expanded);
  const clean = stripOptionalLineColSuffix(resolved);
  indexKnownFilePath(clean);
  statExistingPath(clean);
  return clean;
}
function resolveToolPathHyperlinkUrl(rawPath, cwd = getSessionCwd(), env = process.env) {
  const absPath = registerKnownFilePath(rawPath, cwd);
  if (!absPath)
    return;
  if (isHerdrOrHcSession(env)) {
    const kind = statExistingPath(absPath) ?? "file";
    return formatHerdrFileHyperlinkUrl(absPath, kind);
  }
  return pathToFileURL(absPath).href;
}
function looksLikePathCandidate(candidate) {
  if (!candidate || candidate.length < 2)
    return false;
  if (!PATHISH_EXTENSION_OR_SLASH_REGEX.test(candidate))
    return false;
  if (candidate.includes("..") && !/(?:^\.\.\/|\/\.\.(?:\/|$))/.test(candidate)) {
    return false;
  }
  return true;
}
function resolveCandidateFilePath(rawCandidate, cwd = getSessionCwd()) {
  if (!rawCandidate)
    return;
  const candidate = rawCandidate.startsWith("\u2026/") ? rawCandidate.slice(2) : rawCandidate;
  if (!looksLikePathCandidate(candidate))
    return;
  const hasSlash = candidate.includes("/");
  if (!rawCandidate.startsWith("\u2026/")) {
    const expanded = expandHomePath(candidate);
    const absPath = isAbsolute2(expanded) ? normalize(expanded) : resolve2(cwd, expanded);
    const kind = statExistingPath(absPath);
    if (kind === "file" || kind === "directory" && hasSlash) {
      return { filePath: absPath, kind };
    }
  }
  const { knownPathsBySuffix } = getSharedPathState();
  const normalizedKey = candidate.replace(/^\.\//, "");
  const knownAbs = knownPathsBySuffix.get(normalizedKey);
  if (knownAbs) {
    const kind = statExistingPath(knownAbs);
    if (kind === "file" || kind === "directory" && hasSlash) {
      return { filePath: knownAbs, kind };
    }
  }
  return;
}
function parseFileHyperlinkUrl(url) {
  if (!url)
    return;
  if (/^hammerspoon:\/\/workflow-preset\/open-selection(?:\?|$)/i.test(url)) {
    try {
      const parsed = new URL(url);
      const rawType = (parsed.searchParams.get("type") || "file").toLowerCase();
      const rawMatch = parsed.searchParams.get("match");
      if (!rawMatch)
        return;
      if (rawType !== "file" && rawType !== "directory" && rawType !== "path") {
        return;
      }
      const expanded = expandHomePath(rawMatch);
      const absPath = isAbsolute2(expanded) ? normalize(expanded) : resolve2(getSessionCwd(), expanded);
      const cleanPath = stripOptionalLineColSuffix(absPath);
      const statKind = statExistingPath(cleanPath);
      const kind = statKind ?? (rawType === "directory" ? "directory" : rawType === "path" ? "path" : "file");
      return { filePath: cleanPath, kind };
    } catch {
      return;
    }
  }
  if (/^file:\/\//i.test(url)) {
    try {
      const withoutHashOrQuery = url.split("#")[0].split("?")[0];
      let filePath;
      try {
        filePath = fileURLToPath(withoutHashOrQuery);
      } catch {
        const parsed = new URL(withoutHashOrQuery);
        filePath = decodeURIComponent(parsed.pathname);
      }
      if (!filePath)
        return;
      const cleanPath = stripOptionalLineColSuffix(normalize(filePath));
      const statKind = statExistingPath(cleanPath);
      return {
        filePath: cleanPath,
        kind: statKind === "directory" ? "directory" : "file"
      };
    } catch {
      return;
    }
  }
  return;
}
function isFileHyperlinkUrl(url) {
  return parseFileHyperlinkUrl(url) !== undefined;
}
function rewriteUrlForHerdr(url, env = process.env) {
  if (!url || !isHerdrOrHcSession(env))
    return url;
  if (/^file:\/\//i.test(url)) {
    const parsed = parseFileHyperlinkUrl(url);
    if (parsed) {
      return formatHerdrFileHyperlinkUrl(parsed.filePath, parsed.kind);
    }
  }
  return url;
}
function countChar(str, ch) {
  let count = 0;
  for (let i = 0;i < str.length; i++) {
    if (str[i] === ch)
      count++;
  }
  return count;
}
function splitTrailingUrlPunctuation(rawUrl) {
  let url = rawUrl;
  let trailing = "";
  while (url.length > 0) {
    const inlineTagMatch = /(<[a-zA-Z0-9_.:-]+>)$/.exec(url);
    if (inlineTagMatch && HTML_LAYOUT_TAG_REGEX.test(inlineTagMatch[1])) {
      const tag = inlineTagMatch[1];
      url = url.slice(0, -tag.length);
      trailing = tag + trailing;
      continue;
    }
    const last = url[url.length - 1];
    if (`.!?,;:'"`.includes(last)) {
      url = url.slice(0, -1);
      trailing = last + trailing;
      continue;
    }
    if (last === ")" && countChar(url, ")") > countChar(url, "(")) {
      url = url.slice(0, -1);
      trailing = last + trailing;
      continue;
    }
    if (last === "]" && countChar(url, "]") > countChar(url, "[")) {
      url = url.slice(0, -1);
      trailing = last + trailing;
      continue;
    }
    if (last === "}" && countChar(url, "}") > countChar(url, "{")) {
      url = url.slice(0, -1);
      trailing = last + trailing;
      continue;
    }
    break;
  }
  return { url, trailing };
}
function findUrlsInPlainText(text) {
  if (!text)
    return [];
  const inHerdr = isHerdrOrHcSession();
  const hasHttp = text.includes("http://") || text.includes("https://") || /https?:\/\//i.test(text);
  const hasFileUrl = inHerdr && (text.includes("file://") || /file:\/\//i.test(text));
  const hasPathChars = inHerdr && (text.includes("/") || text.includes("."));
  if (!hasHttp && !hasFileUrl && !hasPathChars) {
    return [];
  }
  const matches = [];
  let match;
  if (hasHttp) {
    PLAIN_URL_Candidate_REGEX.lastIndex = 0;
    while ((match = PLAIN_URL_Candidate_REGEX.exec(text)) !== null) {
      const { url } = splitTrailingUrlPunctuation(match[0]);
      if (url.length > "https://".length) {
        matches.push({
          start: match.index,
          end: match.index + url.length,
          url
        });
      }
    }
  }
  if (hasFileUrl) {
    PLAIN_FILE_URL_CANDIDATE_REGEX.lastIndex = 0;
    while ((match = PLAIN_FILE_URL_CANDIDATE_REGEX.exec(text)) !== null) {
      const { url } = splitTrailingUrlPunctuation(match[0]);
      if (url.length > "file:///".length) {
        const start = match.index;
        const end = match.index + url.length;
        if (matches.some((m) => start < m.end && end > m.start))
          continue;
        matches.push({
          start,
          end,
          url: rewriteUrlForHerdr(url)
        });
      }
    }
  }
  if (hasPathChars) {
    PLAIN_PATH_CANDIDATE_REGEX.lastIndex = 0;
    while ((match = PLAIN_PATH_CANDIDATE_REGEX.exec(text)) !== null) {
      const candidate = match[0];
      const start = match.index;
      const end = start + candidate.length;
      if (matches.some((m) => start < m.end && end > m.start))
        continue;
      if (start > 0) {
        const prev = text[start - 1];
        if (/[\w/~.%+-]/.test(prev))
          continue;
        if (prev === "@" && start >= 2 && /[\w.]/.test(text[start - 2]))
          continue;
        if (prev === ":") {
          const beforeColon = text.slice(Math.max(0, start - 20), start);
          if (SCHEME_PREFIX_REGEX.test(beforeColon))
            continue;
        }
      }
      if (text.slice(end, end + 3) === "://")
        continue;
      const resolved = resolveCandidateFilePath(candidate);
      if (resolved) {
        const lineSuffix = /^:\d+(?:(?::|-)\d+)?(?![\w.])/.exec(text.slice(end));
        const matchEnd = lineSuffix ? end + lineSuffix[0].length : end;
        matches.push({
          start,
          end: matchEnd,
          url: formatHerdrFileHyperlinkUrl(resolved.filePath, resolved.kind)
        });
      }
    }
  }
  if (matches.length > 1) {
    matches.sort((a, b) => a.start - b.start);
  }
  return matches;
}
function formatOsc8(text, url, params = "") {
  if (!text)
    return text;
  return `\x1B]8;${params};${url}\x1B\\${text}${OSC8_CLOSE}`;
}
function ansiCodeLength(str, pos) {
  if (pos >= str.length || str.charCodeAt(pos) !== 27)
    return 0;
  const next = str[pos + 1];
  if (next === "[") {
    for (let j = pos + 2;j < str.length; j++) {
      const c = str.charCodeAt(j);
      if (c === 109 || c === 71 || c === 75 || c === 72 || c === 74) {
        return j + 1 - pos;
      }
    }
    return 0;
  }
  if (next === "]" || next === "_") {
    for (let j = pos + 2;j < str.length; j++) {
      const c = str.charCodeAt(j);
      if (c === 7)
        return j + 1 - pos;
      if (c === 27 && str[j + 1] === "\\")
        return j + 2 - pos;
    }
    return 0;
  }
  return 0;
}
function extractAnsiCode(str, pos) {
  const length = ansiCodeLength(str, pos);
  return length > 0 ? { code: str.substring(pos, pos + length), length } : null;
}
function parseOsc8Code(ansiCode) {
  if (!ansiCode.startsWith("\x1B]8;"))
    return;
  const terminator = ansiCode.endsWith("\x07") ? "\x07" : "\x1B\\";
  const body = ansiCode.slice(4, terminator === "\x07" ? -1 : -2);
  const sep = body.indexOf(";");
  if (sep === -1)
    return;
  const params = body.slice(0, sep);
  const url = body.slice(sep + 1);
  if (!url)
    return null;
  return { params, url, terminator };
}
function linkifyAnsiLineUrls(line, styleUrlPrefix = "\x1B[4m", styleUrlSuffix = "\x1B[24m") {
  if (!line)
    return line;
  const inHerdr = isHerdrOrHcSession();
  let workingLine = line;
  if (inHerdr && workingLine.includes("\x1B]8;") && /file:\/\//i.test(workingLine)) {
    workingLine = workingLine.replace(RAW_OSC8_OPEN_FILE_URL_REGEX, (_full, params, rawFileUrl, terminator) => {
      return `\x1B]8;${params};${rewriteUrlForHerdr(rawFileUrl)}${terminator}`;
    });
  }
  if (inHerdr) {
    if (!workingLine.includes("/") && !workingLine.includes(".") && !workingLine.includes("http://") && !workingLine.includes("https://") && !/https?:\/\/|file:\/\//i.test(workingLine)) {
      return workingLine;
    }
  } else if (!workingLine.includes("http://") && !workingLine.includes("https://") && !/https?:\/\//i.test(workingLine)) {
    return workingLine;
  }
  let plain = "";
  const charHasOsc8 = [];
  const charHasUnderline = [];
  const tracker = new AnsiTracker;
  let i = 0;
  while (i < workingLine.length) {
    const ansi = extractAnsiCode(workingLine, i);
    if (ansi) {
      tracker.process(ansi.code);
      i += ansi.length;
      continue;
    }
    plain += workingLine[i];
    charHasOsc8.push(tracker.activeHyperlink !== null);
    charHasUnderline.push(tracker.underline);
    i++;
  }
  const urlMatches = findUrlsInPlainText(plain).filter((m) => {
    for (let idx = m.start;idx < m.end; idx++) {
      if (charHasOsc8[idx])
        return false;
    }
    return true;
  });
  if (urlMatches.length === 0) {
    return workingLine;
  }
  const openAtPlainIdx = new Map;
  const closeAtPlainIdx = new Map;
  for (const match of urlMatches) {
    openAtPlainIdx.set(match.start, match.url);
    closeAtPlainIdx.set(match.end, true);
  }
  let out = "";
  let plainIdx = 0;
  let addedUnderlineForUrl = false;
  i = 0;
  while (i < workingLine.length) {
    const ansi = extractAnsiCode(workingLine, i);
    if (ansi) {
      out += ansi.code;
      if (addedUnderlineForUrl && /^\x1b\[(?:0|24)(?:;[\d;]*)*m$/.test(ansi.code)) {
        out += styleUrlPrefix;
      }
      i += ansi.length;
      continue;
    }
    const openUrl = openAtPlainIdx.get(plainIdx);
    if (openUrl !== undefined) {
      const isFileLink = isFileHyperlinkUrl(openUrl);
      const needsPrefix = !isFileLink && Boolean(styleUrlPrefix) && !(styleUrlPrefix === "\x1B[4m" && charHasUnderline[plainIdx]);
      addedUnderlineForUrl = needsPrefix;
      out += `\x1B]8;;${openUrl}\x1B\\${needsPrefix ? styleUrlPrefix : ""}`;
    }
    out += workingLine[i];
    plainIdx++;
    i++;
    if (closeAtPlainIdx.get(plainIdx)) {
      const closeSuffix = addedUnderlineForUrl ? styleUrlSuffix : "";
      addedUnderlineForUrl = false;
      out += `${closeSuffix}${OSC8_CLOSE}`;
    }
  }
  return out;
}
function linkifyAnsiTextUrls(text, styleUrlPrefix = "\x1B[4m", styleUrlSuffix = "\x1B[24m") {
  if (!text)
    return text;
  if (!isHerdrOrHcSession()) {
    if (!text.includes("http://") && !text.includes("https://") && !/https?:\/\//i.test(text)) {
      return text;
    }
  } else if (!text.includes("/") && !text.includes(".") && !text.includes("http://") && !text.includes("https://") && !/https?:\/\/|file:\/\//i.test(text)) {
    return text;
  }
  return text.split(`
`).map((line) => linkifyAnsiLineUrls(line, styleUrlPrefix, styleUrlSuffix)).join(`
`);
}
function stripTerminalSequencesSafe(str) {
  if (!str.includes("\x1B"))
    return str;
  let result = "";
  let i = 0;
  while (i < str.length) {
    const ansi = extractAnsiCode(str, i);
    if (ansi) {
      i += ansi.length;
      continue;
    }
    result += str[i];
    i++;
  }
  return result;
}

class AnsiTracker {
  bold = false;
  dim = false;
  italic = false;
  underline = false;
  blink = false;
  inverse = false;
  hidden = false;
  strikethrough = false;
  fgColor = null;
  bgColor = null;
  activeHyperlink = null;
  process(ansiCode) {
    const hyperlink = parseOsc8Code(ansiCode);
    if (hyperlink !== undefined) {
      this.activeHyperlink = hyperlink;
      return;
    }
    if (!ansiCode.endsWith("m"))
      return;
    const match = ansiCode.match(/^\x1b\[([\d;]*)m$/);
    if (!match)
      return;
    const params = match[1];
    if (params === "" || params === "0") {
      this.reset();
      return;
    }
    const parts = params.split(";");
    let i = 0;
    while (i < parts.length) {
      const code = Number.parseInt(parts[i], 10);
      if (code === 38 || code === 48) {
        if (parts[i + 1] === "5" && parts[i + 2] !== undefined) {
          const colorCode = `${parts[i]};${parts[i + 1]};${parts[i + 2]}`;
          if (code === 38)
            this.fgColor = colorCode;
          else
            this.bgColor = colorCode;
          i += 3;
          continue;
        }
        if (parts[i + 1] === "2" && parts[i + 4] !== undefined) {
          const colorCode = `${parts[i]};${parts[i + 1]};${parts[i + 2]};${parts[i + 3]};${parts[i + 4]}`;
          if (code === 38)
            this.fgColor = colorCode;
          else
            this.bgColor = colorCode;
          i += 5;
          continue;
        }
      }
      switch (code) {
        case 0:
          this.reset();
          break;
        case 1:
          this.bold = true;
          break;
        case 2:
          this.dim = true;
          break;
        case 3:
          this.italic = true;
          break;
        case 4:
          this.underline = true;
          break;
        case 5:
          this.blink = true;
          break;
        case 7:
          this.inverse = true;
          break;
        case 8:
          this.hidden = true;
          break;
        case 9:
          this.strikethrough = true;
          break;
        case 21:
          this.bold = false;
          break;
        case 22:
          this.bold = false;
          this.dim = false;
          break;
        case 23:
          this.italic = false;
          break;
        case 24:
          this.underline = false;
          break;
        case 25:
          this.blink = false;
          break;
        case 27:
          this.inverse = false;
          break;
        case 28:
          this.hidden = false;
          break;
        case 29:
          this.strikethrough = false;
          break;
        case 39:
          this.fgColor = null;
          break;
        case 49:
          this.bgColor = null;
          break;
        default:
          if (code >= 30 && code <= 37 || code >= 90 && code <= 97) {
            this.fgColor = String(code);
          } else if (code >= 40 && code <= 47 || code >= 100 && code <= 107) {
            this.bgColor = String(code);
          }
          break;
      }
      i++;
    }
  }
  reset() {
    this.bold = false;
    this.dim = false;
    this.italic = false;
    this.underline = false;
    this.blink = false;
    this.inverse = false;
    this.hidden = false;
    this.strikethrough = false;
    this.fgColor = null;
    this.bgColor = null;
  }
  getActiveCodes() {
    const codes = [];
    if (this.bold)
      codes.push("1");
    if (this.dim)
      codes.push("2");
    if (this.italic)
      codes.push("3");
    if (this.underline)
      codes.push("4");
    if (this.blink)
      codes.push("5");
    if (this.inverse)
      codes.push("7");
    if (this.hidden)
      codes.push("8");
    if (this.strikethrough)
      codes.push("9");
    if (this.fgColor)
      codes.push(this.fgColor);
    if (this.bgColor)
      codes.push(this.bgColor);
    let result = codes.length > 0 ? `\x1B[${codes.join(";")}m` : "";
    if (this.activeHyperlink) {
      result += `\x1B]8;${this.activeHyperlink.params};${this.activeHyperlink.url}${this.activeHyperlink.terminator}`;
    }
    return result;
  }
  getLineEndReset() {
    let result = "";
    if (this.underline) {
      result += "\x1B[24m";
    }
    if (this.activeHyperlink) {
      result += `\x1B]8;;${this.activeHyperlink.terminator}`;
    }
    return result;
  }
}
function updateTrackerFromText(text, tracker) {
  let i = text.indexOf("\x1B");
  while (i !== -1) {
    const length = ansiCodeLength(text, i);
    if (length > 0) {
      tracker.process(text.substring(i, i + length));
      i += length;
    } else {
      i++;
    }
    i = text.indexOf("\x1B", i);
  }
}
function isClosingAnsiSequence(code) {
  const osc8 = parseOsc8Code(code);
  if (osc8 !== undefined) {
    return osc8 === null;
  }
  return /^\x1b\[(?:0|21|22|23|24|25|27|28|29|39|49)(?:;(?:0|21|22|23|24|25|27|28|29|39|49))*m$/.test(code);
}
function splitIntoTokensWithAnsiFixed(text) {
  const tokens = [];
  let current = "";
  let pendingAnsi = "";
  let currentKind = null;
  let i = 0;
  const flushCurrent = () => {
    if (!current)
      return;
    tokens.push(current);
    current = "";
    currentKind = null;
  };
  while (i < text.length) {
    const ansiResult = extractAnsiCode(text, i);
    if (ansiResult) {
      if (current && currentKind === "word" && !pendingAnsi && isClosingAnsiSequence(ansiResult.code)) {
        current += ansiResult.code;
      } else {
        pendingAnsi += ansiResult.code;
      }
      i += ansiResult.length;
      continue;
    }
    let end = text.indexOf("\x1B", i + 1);
    while (end !== -1 && ansiCodeLength(text, end) === 0) {
      end = text.indexOf("\x1B", end + 1);
    }
    if (end === -1)
      end = text.length;
    const chunk = text.slice(i, end);
    for (const { segment } of graphemeSegmenter.segment(chunk)) {
      const segmentIsSpace = segment === " ";
      if (!segmentIsSpace && cjkBreakRegex.test(segment)) {
        flushCurrent();
        const token = pendingAnsi + segment;
        pendingAnsi = "";
        tokens.push(token);
        continue;
      }
      const segmentKind = segmentIsSpace ? "space" : "word";
      if (current && currentKind !== segmentKind) {
        flushCurrent();
      }
      if (pendingAnsi) {
        current += pendingAnsi;
        pendingAnsi = "";
      }
      currentKind = segmentKind;
      current += segment;
    }
    i = end;
  }
  if (pendingAnsi) {
    if (current) {
      current += pendingAnsi;
    } else if (tokens.length > 0) {
      tokens[tokens.length - 1] += pendingAnsi;
    } else {
      current = pendingAnsi;
    }
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}
function trimTrailingSpacesPreservingAnsi(line) {
  if (!line)
    return line;
  const segments = [];
  let i = 0;
  while (i < line.length) {
    const ansi = extractAnsiCode(line, i);
    if (ansi) {
      segments.push({ type: "ansi", value: ansi.code });
      i += ansi.length;
      continue;
    }
    let end = i;
    while (end < line.length && !extractAnsiCode(line, end)) {
      end++;
    }
    segments.push({ type: "text", value: line.slice(i, end) });
    i = end;
  }
  for (let idx = segments.length - 1;idx >= 0; idx--) {
    const seg = segments[idx];
    if (seg.type === "ansi")
      continue;
    const trimmed = seg.value.replace(/ +$/, "");
    seg.value = trimmed;
    if (trimmed.length > 0) {
      break;
    }
  }
  return segments.map((s) => s.value).join("");
}
function breakLongWordPreservingOsc8(word, width, tracker, measureWidth) {
  const lines = [];
  let currentLine = tracker.getActiveCodes();
  let currentWidth = 0;
  let i = 0;
  const segments = [];
  while (i < word.length) {
    const ansiResult = extractAnsiCode(word, i);
    if (ansiResult) {
      segments.push({ type: "ansi", value: ansiResult.code });
      i += ansiResult.length;
    } else {
      let end = i;
      while (end < word.length && !extractAnsiCode(word, end)) {
        end++;
      }
      for (const seg of graphemeSegmenter.segment(word.slice(i, end))) {
        segments.push({ type: "grapheme", value: seg.segment });
      }
      i = end;
    }
  }
  for (const seg of segments) {
    if (seg.type === "ansi") {
      currentLine += seg.value;
      tracker.process(seg.value);
      continue;
    }
    const grapheme = seg.value;
    if (!grapheme)
      continue;
    const graphemeWidth = measureWidth(grapheme);
    if (currentWidth + graphemeWidth > width) {
      const lineEndReset = tracker.getLineEndReset();
      if (lineEndReset) {
        currentLine += lineEndReset;
      }
      lines.push(currentLine);
      currentLine = tracker.getActiveCodes();
      currentWidth = 0;
    }
    currentLine += grapheme;
    currentWidth += graphemeWidth;
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines.length > 0 ? lines : [""];
}
function wrapSingleLinePreservingOsc8(line, width, measureWidth) {
  if (!line)
    return [""];
  const visibleLength = measureWidth(line);
  if (visibleLength <= width) {
    return [ensureBalancedLineOsc8(line)];
  }
  const wrapped = [];
  const tracker = new AnsiTracker;
  const tokens = splitIntoTokensWithAnsiFixed(line);
  let currentLine = "";
  let currentVisibleLength = 0;
  for (const token of tokens) {
    const tokenVisibleLength = measureWidth(token);
    const isWhitespace = stripTerminalSequencesSafe(token).trim() === "";
    if (tokenVisibleLength > width && !isWhitespace) {
      if (currentVisibleLength > 0) {
        let lineToPush = trimTrailingSpacesPreservingAnsi(currentLine);
        const lineEndReset = tracker.getLineEndReset();
        if (lineEndReset) {
          lineToPush += lineEndReset;
        }
        wrapped.push(ensureBalancedLineOsc8(lineToPush));
        currentLine = "";
        currentVisibleLength = 0;
      } else if (currentLine) {
        updateTrackerFromText(currentLine, tracker);
        currentLine = "";
      }
      const broken = breakLongWordPreservingOsc8(token, width, tracker, measureWidth);
      for (let i = 0;i < broken.length - 1; i++) {
        wrapped.push(ensureBalancedLineOsc8(broken[i]));
      }
      currentLine = broken[broken.length - 1];
      currentVisibleLength = measureWidth(currentLine);
      continue;
    }
    const totalNeeded = currentVisibleLength + tokenVisibleLength;
    if (totalNeeded > width && currentVisibleLength > 0) {
      let lineToWrap = trimTrailingSpacesPreservingAnsi(currentLine);
      const lineEndReset = tracker.getLineEndReset();
      if (lineEndReset) {
        lineToWrap += lineEndReset;
      }
      wrapped.push(ensureBalancedLineOsc8(lineToWrap));
      if (isWhitespace) {
        updateTrackerFromText(token, tracker);
        currentLine = tracker.getActiveCodes();
        currentVisibleLength = 0;
        continue;
      }
      currentLine = tracker.getActiveCodes() + token;
      currentVisibleLength = tokenVisibleLength;
    } else {
      currentLine += token;
      currentVisibleLength += tokenVisibleLength;
    }
    updateTrackerFromText(token, tracker);
  }
  if (currentVisibleLength > 0 || wrapped.length === 0) {
    let finalLine = trimTrailingSpacesPreservingAnsi(currentLine);
    const lineEndReset = tracker.getLineEndReset();
    if (lineEndReset) {
      finalLine += lineEndReset;
    }
    wrapped.push(ensureBalancedLineOsc8(finalLine));
  }
  return wrapped.length > 0 ? wrapped : [""];
}
function ensureBalancedLineOsc8(line) {
  if (!line.includes("\x1B]8;"))
    return line;
  let active = null;
  let i = 0;
  while (i < line.length) {
    const ansi = extractAnsiCode(line, i);
    if (ansi) {
      const parsed = parseOsc8Code(ansi.code);
      if (parsed !== undefined) {
        active = parsed;
      }
      i += ansi.length;
    } else {
      i++;
    }
  }
  if (active) {
    return `${line}\x1B]8;;${active.terminator}`;
  }
  return line;
}
function wrapAnsiTextPreservingOsc8(text, width, measureWidth = piTui.visibleWidth) {
  if (!text)
    return [""];
  const linkedText = linkifyAnsiTextUrls(text);
  const inputLines = linkedText.split(/\r\n|\r|\n/);
  const result = [];
  const tracker = new AnsiTracker;
  for (const inputLine of inputLines) {
    const prefix = result.length > 0 ? tracker.getActiveCodes() : "";
    const wrappedLines = wrapSingleLinePreservingOsc8(prefix + inputLine, Math.max(1, width), measureWidth);
    for (const wrappedLine of wrappedLines) {
      result.push(wrappedLine);
    }
    updateTrackerFromText(inputLine, tracker);
  }
  return result.length > 0 ? result : [""];
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/copy-buttons.ts
var LABEL = "\u29C9 Copy";
var COPIED_LABEL = "Copied";
var COPIED_FEEDBACK_MS = 2000;
var MIN_FRAME_WIDTH = 8;
var MARKER_PREFIX = "\x1B_open-tui:cb:";
var PATCH_KEY = Symbol.for("pi-open-tui.copy-buttons");
var RELEASE_TOLERANCE = 2;
var renderScope;
var press;
var regionTargets = new WeakMap;
function markCopyScope(markdown, context) {
  if (renderScope) {
    renderScope.frame = renderScope.active && context.messageType !== "assistant-thinking";
    renderScope.label = renderScope.frame && !context.isStreaming;
    const previous = renderScope.state.policy;
    if (previous && (previous.frame !== renderScope.frame || previous.label !== renderScope.label)) {
      renderScope.owner.invalidate();
    }
    renderScope.state.policy = { frame: renderScope.frame, label: renderScope.label };
  }
  return markdown;
}
function renderFramedCode(theme, code, lang, width, label, border = theme.codeBlockBorder, marker = "") {
  const inner = width - 4;
  const highlighted = (theme.highlightCode?.(code, lang) ?? code.split(`
`).map((line) => theme.codeBlock(line))).map((line) => linkifyAnsiLineUrls(line));
  const rows = highlighted.flatMap((line) => {
    const wrapped = wrapAnsiTextPreservingOsc8(line, inner, visibleWidth3);
    return wrapped.length > 0 ? wrapped : [""];
  });
  const suffix = label === undefined ? "" : ` ${LABEL} `;
  const name = truncateToWidth2(lang?.trim().split(/\s+/, 1)[0] || "code", Math.max(1, width - 6 - visibleWidth3(suffix)), "\u2026");
  const prefix = `\u256D\u2500 ${name} `;
  const widest = Math.max(0, ...rows.map((row) => visibleWidth3(row)));
  const frameWidth = Math.min(width, Math.max(widest + 4, visibleWidth3(prefix) + 3 + visibleWidth3(suffix) + 1));
  const fill = Math.max(0, frameWidth - visibleWidth3(prefix) - visibleWidth3(suffix) - 1);
  const top = (label === undefined ? marker : "") + border("\u256D\u2500 ") + theme.codeBlockBorder(`${name} `) + border("\u2500".repeat(fill)) + (label === undefined ? "" : ` ${marker}${label} `) + border("\u256E");
  const body = rows.map((row) => border("\u2502 ") + row + " ".repeat(Math.max(0, frameWidth - 4 - visibleWidth3(row))) + border(" \u2502"));
  return [top, ...body, border(`\u2570${"\u2500".repeat(frameWidth - 2)}\u256F`)];
}
function handleCopyMouse(owner, regions, event, onCopy) {
  if (event.type === "press") {
    if (press?.owner === owner)
      press = undefined;
    if (event.button !== "left" || event.shift || event.alt || event.ctrl)
      return;
    const region = regions.find((r) => event.y === r.row && event.x >= r.col && event.x < r.col + r.width);
    if (region)
      press = { owner, region, x: event.screenX, y: event.screenY, onCopy };
    return;
  }
  if (press?.owner !== owner || event.type !== "drag" && event.type !== "release")
    return;
  const pending = press;
  const nearby = event.screenY === pending.y && Math.abs(event.screenX - pending.x) <= RELEASE_TOLERANCE;
  const primary = event.button === "left" || event.type === "release" && event.button === "none";
  if (!nearby || !primary || event.shift || event.alt || event.ctrl) {
    press = undefined;
    return;
  }
  if (event.type === "drag")
    return;
  press = undefined;
  pending.onCopy(pending.region.text, pending.region);
  return { handled: true, render: false };
}
function cancelStalePress(owner, regions) {
  if (press?.owner !== owner)
    return;
  const previous = press.region;
  if (!regions.some((region) => region.row === previous.row && region.col === previous.col && region.width === previous.width && region.text === previous.text && regionTargets.get(region) === regionTargets.get(previous))) {
    press = undefined;
  }
}
function restoreTabs(source, ordinal, rendered) {
  if (!source.includes("\t"))
    return rendered;
  const sourceLines = source.replace(/\r\n?/g, `
`).split(`
`);
  const normalized = sourceLines.map((line) => line.replace(/\t/g, "   "));
  const blocks = [];
  const parser = new Marked2;
  parser.walkTokens(parser.lexer(normalized.join(`
`)), (token) => {
    if (token.type === "code")
      blocks.push({ raw: token.raw, text: token.text });
  });
  const block = blocks[ordinal];
  if (!block || block.text !== rendered || rendered === "")
    return rendered;
  const rawLines = block.raw.replace(/\n+$/, "").split(`
`);
  let marker = "\uE000";
  while (source.includes(marker))
    marker += "\uE000";
  const expected = rendered.split(`
`);
  expected[0] += marker;
  for (let start = 0;start < sourceLines.length; start++) {
    if (!rawLines.every((raw, offset) => normalized[start + offset]?.endsWith(raw)))
      continue;
    const body = start + (/^ {0,3}(?:`{3,}|~{3,})/.test(block.raw) ? 1 : 0);
    const probe = normalized.slice();
    probe[body] += marker;
    let index = 0;
    let matched = false;
    parser.walkTokens(parser.lexer(probe.join(`
`)), (token) => {
      if (token.type === "code" && index++ === ordinal)
        matched = token.text === expected.join(`
`);
    });
    if (!matched)
      continue;
    const restored = rendered.split(`
`).map((text, offset) => {
      const line = sourceLines[body + offset];
      const expanded = normalized[body + offset];
      if (line === undefined || !expanded?.endsWith(text))
        return text;
      const skip = expanded.length - text.length;
      let column = 0;
      for (let char = 0;char < line.length; char++) {
        if (column === skip)
          return line.slice(char);
        column += line[char] === "\t" ? 3 : 1;
        if (column > skip)
          return " ".repeat(column - skip) + line.slice(char + 1);
      }
      return "";
    }).join(`
`);
    return restored.replace(/\t/g, "   ") === rendered ? restored : rendered;
  }
  return rendered;
}
function patch(target, key, value) {
  const had = Object.prototype.hasOwnProperty.call(target, key);
  const original = target[key];
  target[key] = value;
  return () => {
    if (target[key] !== value)
      return;
    if (had)
      target[key] = original;
    else
      Reflect.deleteProperty(target, key);
  };
}
function installCopyButtons(options) {
  const markdownProto = Markdown.prototype;
  const userProto = UserMessageComponent.prototype;
  const altScreenProto = TuiAltScreen.prototype;
  const refresh = () => {
    press = undefined;
    const tui = options.getTui();
    tui?.invalidate();
    tui?.requestRender();
  };
  if (markdownProto[PATCH_KEY])
    return { cleanup: () => {}, refresh };
  if (typeof markdownProto.render !== "function" || typeof markdownProto.renderToken !== "function" || typeof markdownProto.invalidate !== "function" || typeof altScreenProto.handleMouseEvent !== "function" || typeof altScreenProto.createMouseEvent !== "function") {
    return { cleanup: () => {}, refresh };
  }
  let installed = true;
  const active = () => installed && options.isEnabled() && options.getTui()?.mode === "fullscreen";
  let markdownRegions = new WeakMap;
  let userRegions = new WeakMap;
  let userCopiedUntil = new WeakMap;
  let userCopiedTimers = new WeakMap;
  const liveCopiedTimers = new Set;
  const markerPrefix = `${MARKER_PREFIX}${randomUUID()}:`;
  const markerPattern = new RegExp(`${markerPrefix}(\\d+):([01])\x07`, "g");
  const copy = (text, onCopied) => {
    const tui = options.getTui();
    const flash = (message) => {
      if (installed && tui === options.getTui() && tui instanceof TuiAltScreen)
        tui.flash(message);
    };
    copyToClipboard(text).then(() => {
      onCopied?.();
      flash("Copied!");
    }, () => flash("Copy failed"));
  };
  const markUserCopied = (owner) => {
    userCopiedUntil.set(owner, Date.now() + COPIED_FEEDBACK_MS);
    const previous = userCopiedTimers.get(owner);
    if (previous) {
      clearTimeout(previous);
      liveCopiedTimers.delete(previous);
    }
    const timer = setTimeout(() => {
      liveCopiedTimers.delete(timer);
      userCopiedTimers.delete(owner);
      userCopiedUntil.delete(owner);
      if (installed)
        options.getTui()?.requestRender();
    }, COPIED_FEEDBACK_MS);
    timer.unref?.();
    userCopiedTimers.set(owner, timer);
    liveCopiedTimers.add(timer);
    options.getTui()?.requestRender();
  };
  const markMarkdownCopied = (owner, region) => {
    const state = markdownRegions.get(owner);
    const target = regionTargets.get(region);
    if (!state || !target)
      return;
    state.copiedUntil.set(target, Date.now() + COPIED_FEEDBACK_MS);
    const previous = state.copiedTimers.get(target);
    if (previous) {
      clearTimeout(previous);
      liveCopiedTimers.delete(previous);
    }
    const timer = setTimeout(() => {
      liveCopiedTimers.delete(timer);
      state.copiedTimers.delete(target);
      state.copiedUntil.delete(target);
      if (installed)
        options.getTui()?.requestRender();
    }, COPIED_FEEDBACK_MS);
    timer.unref?.();
    state.copiedTimers.set(target, timer);
    liveCopiedTimers.add(timer);
    options.getTui()?.requestRender();
  };
  const applyMarkdownCopied = (state, lines) => {
    if (state.copiedUntil.size === 0 || state.regions.length === 0)
      return lines;
    const now = Date.now();
    let out;
    for (const region of state.regions) {
      const target = regionTargets.get(region);
      if (!target)
        continue;
      const until = state.copiedUntil.get(target);
      if (until === undefined)
        continue;
      if (until <= now) {
        state.copiedUntil.delete(target);
        continue;
      }
      const line = (out ?? lines)[region.row];
      if (line === undefined)
        continue;
      const idx = line.lastIndexOf(LABEL);
      if (idx < 0)
        continue;
      out ??= lines.slice();
      out[region.row] = line.slice(0, idx) + COPIED_LABEL + line.slice(idx + LABEL.length);
    }
    return out ?? lines;
  };
  const label = () => options.getTheme().fg("muted", LABEL);
  const originalRender = markdownProto.render;
  const originalRenderToken = markdownProto.renderToken;
  const originalMarkdownMouse = markdownProto.handleMouse;
  const originalUserRender = userProto.render;
  const originalUserMouse = userProto.handleMouse;
  const originalAltScreenMouse = altScreenProto.handleMouseEvent;
  const restores = [
    patch(altScreenProto, "handleMouseEvent", function(raw) {
      if (!installed)
        return originalAltScreenMouse.call(this, raw);
      const currentTui = options.getTui();
      const sameTui = this === currentTui || this.terminal !== undefined && this.terminal === currentTui?.terminal;
      if (!active() || !sameTui) {
        press = undefined;
        return originalAltScreenMouse.call(this, raw);
      }
      const motion = (raw.button & 32) !== 0;
      if (!raw.release && !motion)
        press = undefined;
      if (press && (raw.release || motion)) {
        const event = this.createMouseEvent(raw.release ? "release" : "drag", raw.button, raw.x, raw.y);
        if (handleCopyMouse(press.owner, [], event, press.onCopy)) {
          this.clearTextSelection?.();
          this.resetTextSelection?.();
          this.requestRender();
          return;
        }
      }
      return originalAltScreenMouse.call(this, raw);
    }),
    patch(markdownProto, "renderToken", function(token, width, nextTokenType, styleContext) {
      const scope = renderScope;
      if (!installed || !scope?.active || scope.owner !== this || token.type !== "code") {
        return originalRenderToken.call(this, token, width, nextTokenType, styleContext);
      }
      const showLabel = scope.label && width >= MIN_FRAME_WIDTH + LABEL.length + 2;
      const id = scope.state.nextId++;
      const marker = `${markerPrefix}${id}:${showLabel ? 1 : 0}\x07`;
      let lines;
      if (scope.frame && width >= MIN_FRAME_WIDTH) {
        const theme = options.getTheme();
        lines = renderFramedCode(this.theme, token.text, token.lang, width, showLabel ? label() : undefined, (text) => theme.fg("borderMuted", text), marker);
        if (nextTokenType && nextTokenType !== "space")
          lines.push("");
      } else {
        lines = originalRenderToken.call(this, token, width, nextTokenType, styleContext);
        lines[0] = marker + (lines[0] ?? "");
      }
      scope.state.descriptors.set(id, { text: token.text, label: showLabel });
      return lines;
    }),
    patch(markdownProto, "render", function(width) {
      if (!installed)
        return originalRender.call(this, width);
      const enabled = active();
      const previous = markdownRegions.get(this);
      const state = previous ?? {
        active: enabled,
        regions: [],
        descriptors: new Map,
        nextId: 0,
        copiedUntil: new Map,
        copiedTimers: new Map
      };
      if (!previous) {
        markdownRegions.set(this, state);
        this.invalidate();
      } else if (state.active !== enabled) {
        this.invalidate();
        cancelStalePress(this, []);
        for (const timer of state.copiedTimers.values()) {
          clearTimeout(timer);
          liveCopiedTimers.delete(timer);
        }
        state.copiedTimers.clear();
        state.copiedUntil.clear();
        state.active = enabled;
        state.policy = undefined;
      }
      const run = () => {
        const outer = renderScope;
        renderScope = { owner: this, state, active: enabled, frame: false, label: false };
        try {
          return originalRender.call(this, width);
        } finally {
          renderScope = outer;
        }
      };
      try {
        let lines = run();
        if (state.lines === lines)
          return applyMarkdownCopied(state, lines);
        if (state.lines !== undefined && state.descriptors.size > 0 && !lines.some((line) => line.includes(markerPrefix))) {
          return applyMarkdownCopied(state, lines);
        }
        const missing = lines.some((line) => [...line.matchAll(markerPattern)].some((match) => !state.descriptors.has(Number(match[1]))));
        if (missing) {
          this.invalidate();
          lines = run();
        }
        const source = typeof this.text === "string" ? this.text : "";
        const regions = [];
        const live = new Set;
        let ordinal = 0;
        for (let row = 0;row < lines.length; row++) {
          const line = lines[row];
          let clean = "";
          let from = 0;
          for (const match of line.matchAll(markerPattern)) {
            clean += line.slice(from, match.index);
            from = match.index + match[0].length;
            const id = Number(match[1]);
            const block = state.descriptors.get(id);
            const currentOrdinal = ordinal++;
            if (block)
              live.add(id);
            if (match[2] !== "1")
              continue;
            const suffix = line.slice(from);
            const labelAt = suffix.indexOf(LABEL);
            if (labelAt < 0 || stripAnsi(suffix.slice(0, labelAt)) !== "")
              continue;
            if (!block?.label || !enabled) {
              clean += suffix.slice(0, labelAt) + " ".repeat(LABEL.length);
              from += labelAt + LABEL.length;
              continue;
            }
            const region = {
              row,
              col: visibleWidth3(clean),
              width: LABEL.length,
              text: restoreTabs(source, currentOrdinal, block.text)
            };
            regionTargets.set(region, `${currentOrdinal}\x00${source}`);
            regions.push(region);
          }
          lines[row] = clean + line.slice(from);
        }
        for (const id of state.descriptors.keys())
          if (!live.has(id))
            state.descriptors.delete(id);
        cancelStalePress(this, regions);
        state.lines = lines;
        state.regions = regions;
        return applyMarkdownCopied(state, lines);
      } catch (error) {
        cancelStalePress(this, []);
        state.lines = undefined;
        state.regions = [];
        state.descriptors.clear();
        state.policy = undefined;
        this.invalidate();
        throw error;
      }
    }),
    patch(markdownProto, "handleMouse", function(event) {
      if (!active()) {
        cancelStalePress(this, []);
        return originalMarkdownMouse?.call(this, event);
      }
      const regions = markdownRegions.get(this)?.regions ?? [];
      return handleCopyMouse(this, regions, event, (text, region) => copy(text, () => markMarkdownCopied(this, region))) ?? originalMarkdownMouse?.call(this, event);
    }),
    patch(userProto, "render", function(width) {
      if (!installed)
        return originalUserRender.call(this, width);
      const lines = originalUserRender.call(this, width);
      const pad = typeof this.outputPad === "number" ? this.outputPad : 1;
      const col = width - pad - LABEL.length;
      if (!active() || lines.length < 2 || col < 1 || typeof this.text !== "string") {
        cancelStalePress(this, []);
        userRegions.delete(this);
        return lines;
      }
      const row = lines.length - 1;
      const theme = options.getTheme();
      const copied = (userCopiedUntil.get(this) ?? 0) > Date.now();
      const button = theme.bg("userMessageBg", theme.fg("muted", copied ? COPIED_LABEL : LABEL));
      const cached = userRegions.get(this);
      if (cached && cached.source === lines[row] && cached.label === button && cached.width === width && cached.region.row === row && cached.region.col === col && cached.region.text === this.text) {
        lines[row] = cached.line;
        return lines;
      }
      const source = lines[row];
      lines[row] = compositeTuiLine(source, button, col, LABEL.length, width);
      const region = { row, col, width: LABEL.length, text: this.text };
      cancelStalePress(this, [region]);
      userRegions.set(this, {
        region,
        source,
        label: button,
        width,
        line: lines[row]
      });
      return lines;
    }),
    patch(userProto, "handleMouse", function(event) {
      if (!active()) {
        cancelStalePress(this, []);
        return originalUserMouse?.call(this, event);
      }
      const region = userRegions.get(this)?.region;
      return handleCopyMouse(this, region ? [region] : [], event, (text) => copy(text, () => markUserCopied(this))) ?? originalUserMouse?.call(this, event);
    })
  ];
  markdownProto[PATCH_KEY] = true;
  refresh();
  return {
    cleanup: () => {
      if (!installed)
        return;
      installed = false;
      for (const timer of liveCopiedTimers)
        clearTimeout(timer);
      liveCopiedTimers.clear();
      userCopiedUntil = new WeakMap;
      userCopiedTimers = new WeakMap;
      for (const restore of restores)
        restore();
      delete markdownProto[PATCH_KEY];
      press = undefined;
      markdownRegions = new WeakMap;
      userRegions = new WeakMap;
      try {
        refresh();
      } catch {}
    },
    refresh
  };
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/editor.ts
import {
  CustomEditor
} from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, truncateToWidth as truncateToWidth3, visibleWidth as visibleWidth4 } from "@earendil-works/pi-tui";
function fillLine(content, width) {
  const truncated = truncateToWidth3(content, Math.max(0, width), "");
  const pad = " ".repeat(Math.max(0, width - visibleWidth4(truncated)));
  return `${truncated}${pad}`;
}
var CURSOR_STYLE_SEQUENCES = {
  bar: "\x1B[6 q",
  underline: "\x1B[4 q"
};
var DEFAULT_CURSOR_STYLE_SEQUENCE = "\x1B[0 q";
var EDITOR_FRAME_LEFT_INSET = 2;
var EDITOR_FRAME_HORIZONTAL_CHROME = EDITOR_FRAME_LEFT_INSET * 2;
function isHiddenThinkingLabelComponent(value) {
  const component = value;
  return Array.isArray(component.children) && typeof component.render === "function" && typeof component.setHiddenThinkingLabel === "function" && typeof component.setHideThinkingBlock === "function" && typeof component.updateContent === "function";
}
function findLatestHiddenThinkingLabel(tui) {
  const pending = [tui];
  const visited = new Set;
  let latest;
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || typeof value !== "object" || visited.has(value))
      continue;
    visited.add(value);
    if (isHiddenThinkingLabelComponent(value))
      latest = value;
    const children = value.children;
    if (!Array.isArray(children))
      continue;
    for (let i = children.length - 1;i >= 0; i--)
      pending.push(children[i]);
  }
  if (!latest)
    throw new Error("Unable to find the active hidden-thinking component");
  return latest;
}
function hiddenThinkingTextWidth(width, outputPad) {
  const pad = typeof outputPad === "number" && Number.isFinite(outputPad) ? Math.max(0, Math.floor(outputPad)) : 1;
  const paddingX = Math.min(pad, Math.max(0, Math.floor((width - 1) / 2)));
  return Math.max(1, width - paddingX * 2);
}
var FAKE_CURSOR = /\x1b_pi:fc\x07([\s\S]*?)(?:\x1b_pi:\/fc\x07|$)/g;
function removeSoftwareCursor(line, cursorMarker = "") {
  return line.replace(FAKE_CURSOR, (_match, cursor) => {
    const replacement = `${cursorMarker}${cursor}`;
    cursorMarker = "";
    return replacement;
  });
}
function configureCursor(tui, cursorStyle) {
  if (cursorStyle === "block")
    return;
  tui.setShowHardwareCursor(true);
  const sequence = CURSOR_STYLE_SEQUENCES[cursorStyle];
  if (sequence)
    tui.terminal.write(sequence);
}
function roundedBorder(width, kind, paint, sourceLine, indicator) {
  if (width < 2)
    return paint(truncateToWidth3(kind === "top" ? "\u256D\u256E" : "\u2570\u256F", width, ""));
  const corners = kind === "top" ? ["\u256D", "\u256E"] : ["\u2570", "\u256F"];
  if (kind === "top" && indicator) {
    const plain = sourceLine ? stripAnsi(sourceLine) : "";
    const scrollMatch = plain.match(/([\u2191\u2193]\s+\d+\s+more)/);
    const contentWidth = width - 2;
    let status = indicator.renderInBorder(Math.max(1, contentWidth - 5));
    let statusWidth = visibleWidth4(status);
    if (statusWidth > 0) {
      const overflowLabel = scrollMatch ? ` ${scrollMatch[1]} ` : undefined;
      const overflowLabelWidth = overflowLabel ? visibleWidth4(overflowLabel) : 0;
      const overflowStart = Math.floor((contentWidth - overflowLabelWidth) / 2);
      const canFitOverflow = () => overflowLabel !== undefined && overflowLabelWidth + 2 <= contentWidth && overflowStart - (3 + statusWidth + 1) >= 1;
      if (overflowLabel && !canFitOverflow()) {
        status = indicator.renderSpinnerInBorder(contentWidth);
        statusWidth = visibleWidth4(status);
      }
      if (canFitOverflow()) {
        const leftBlockWidth = 3 + statusWidth + 1;
        return `${paint(`${corners[0]}\u2500\u2500 `)}${status}${paint(` ${"\u2500".repeat(overflowStart - leftBlockWidth)}${overflowLabel}${"\u2500".repeat(contentWidth - overflowStart - overflowLabelWidth)}${corners[1]}`)}`;
      }
      if (contentWidth >= statusWidth + 5) {
        return `${paint(`${corners[0]}\u2500\u2500 `)}${status}${paint(` ${"\u2500".repeat(contentWidth - statusWidth - 4)}${corners[1]}`)}`;
      }
      status = indicator.renderSpinnerInBorder(contentWidth);
      statusWidth = visibleWidth4(status);
      const prefixWidth = Math.min(3, Math.max(0, contentWidth - statusWidth));
      return `${paint(`${corners[0]}${"\u2500".repeat(prefixWidth)}`)}${status}${paint(`${"\u2500".repeat(Math.max(0, contentWidth - prefixWidth - statusWidth))}${corners[1]}`)}`;
    }
  }
  if (sourceLine) {
    const plain = stripAnsi(sourceLine);
    const scrollMatch = plain.match(/([\u2191\u2193]\s+\d+\s+more)/);
    if (scrollMatch) {
      const label = `\u2500\u2500\u2500 ${scrollMatch[1]} `;
      const fill = Math.max(0, width - 2 - visibleWidth4(label));
      return paint(`${corners[0]}${label}${"\u2500".repeat(fill)}${corners[1]}`);
    }
  }
  return paint(`${corners[0]}${"\u2500".repeat(Math.max(0, width - 2))}${corners[1]}`);
}
function trimTrailingSpaces(text) {
  const ansiSuffix = text.match(/(?:\x1b\[[0-?]*[ -/]*[@-~])+$/)?.[0] ?? "";
  const content = ansiSuffix ? text.slice(0, -ansiSuffix.length) : text;
  return `${content.replace(/ +$/, "")}${ansiSuffix}`;
}
function inlineBorder(width, kind, paint, renderLine, sourceLine, indicator) {
  if (width < 2)
    return paint(truncateToWidth3(kind === "top" ? "\u256D\u256E" : "\u2570\u256F", width, ""));
  const corners = kind === "top" ? ["\u256D", "\u256E"] : ["\u2570", "\u256F"];
  const contentWidth = width - 2;
  const plain = sourceLine ? stripAnsi(sourceLine) : "";
  const scrollMatch = plain.match(/([\u2191\u2193]\s+\d+\s+more)/);
  const right = scrollMatch ? paint(` ${scrollMatch[1]} `) : "";
  let left = paint("\u2500");
  if (kind === "top" && indicator) {
    const statusBudget = Math.max(1, contentWidth - visibleWidth4(right) - 7);
    let status = indicator.renderInBorder(statusBudget);
    if (visibleWidth4(status) > statusBudget)
      status = indicator.renderSpinnerInBorder(statusBudget);
    const leftBudget = Math.max(0, contentWidth - visibleWidth4(right) - 1);
    status = truncateToWidth3(status, Math.max(0, leftBudget - 4), "");
    if (visibleWidth4(status) > 0)
      left = `${paint("\u2500\u2500 ")}${status}${paint(" ")}`;
  }
  const lineBudget = Math.max(0, contentWidth - visibleWidth4(left) - visibleWidth4(right) - 6);
  const line = renderLine(lineBudget);
  if (!line)
    return roundedBorder(width, kind, paint, sourceLine, indicator);
  const leftContent = trimTrailingSpaces(line.left);
  const rightContent = trimTrailingSpaces(line.right);
  if (visibleWidth4(leftContent) === 0 && visibleWidth4(rightContent) === 0) {
    return roundedBorder(width, kind, paint, sourceLine, indicator);
  }
  const leftCell = leftContent ? ` ${leftContent} ` : "";
  const rightCell = rightContent ? ` ${rightContent} ` : "";
  const fill = Math.max(1, contentWidth - visibleWidth4(left) - visibleWidth4(leftCell) - visibleWidth4(rightCell) - visibleWidth4(right) - 1);
  return `${paint(corners[0])}${left}${leftCell}${paint("\u2500".repeat(fill))}${rightCell}${right}${paint("\u2500")}${paint(corners[1])}`;
}
function isFrameableEditor(editor) {
  return typeof editor.borderColor === "function" && typeof editor.handleMouse === "function" && "getPaddingX" in editor && typeof editor.getPaddingX === "function" && typeof editor.setPaddingX === "function" && "focused" in editor && typeof editor.focused === "boolean";
}
var DECORATIONS = new WeakMap;
function applyCursorStyle(decoration, cursorStyle, blockHardwareCursor = false) {
  const styleChanged = cursorStyle !== decoration.cursorStyle;
  decoration.previewHardwareCursor = cursorStyle !== "block";
  decoration.cursorStyle = cursorStyle;
  if (styleChanged) {
    const tui = decoration.tui;
    if (cursorStyle === "block") {
      tui.terminal.write(DEFAULT_CURSOR_STYLE_SEQUENCE);
      tui.setShowHardwareCursor(blockHardwareCursor);
    } else {
      configureCursor(tui, cursorStyle);
    }
  }
  decoration.tui.requestRender();
}
function renderWithCursor(decoration, width) {
  const renderedLines = decoration.baseRender(width);
  if (decoration.cursorStyle === "block")
    return renderedLines;
  const tui = decoration.tui;
  if (!tui.getShowHardwareCursor())
    configureCursor(tui, decoration.cursorStyle);
  const focused = decoration.editor.focused;
  let cursorMarker = decoration.previewHardwareCursor && !focused ? CURSOR_MARKER : "";
  if (focused)
    decoration.previewHardwareCursor = false;
  return renderedLines.map((line) => {
    const rendered = removeSoftwareCursor(line, cursorMarker);
    if (rendered !== line)
      cursorMarker = "";
    return rendered;
  });
}
function renderFrame(decoration, width) {
  decoration.framedWidth = undefined;
  if (width < EDITOR_FRAME_HORIZONTAL_CHROME)
    return renderWithCursor(decoration, width);
  const innerWidth = Math.max(0, width - EDITOR_FRAME_HORIZONTAL_CHROME);
  const baseLines = renderWithCursor(decoration, innerWidth);
  const bottomIdx = findBottomBorderIndex(baseLines);
  if (bottomIdx <= 1 || !isEditorBorderLine(baseLines[0] ?? "") || !isEditorBorderLine(baseLines[bottomIdx] ?? "")) {
    return renderWithCursor(decoration, width);
  }
  const borderPaint = (text) => decoration.editor.borderColor(text);
  const rail = borderPaint("\u2502");
  const result = [];
  const inlineFooter = decoration.inlineFooter?.enabled() === true;
  const renderInlineLine = (kind, budget) => decoration.inlineFooter?.render(budget)?.[kind];
  result.push(inlineFooter ? inlineBorder(width, "top", borderPaint, (budget) => renderInlineLine("top", budget), baseLines[0], decoration.indicator) : roundedBorder(width, "top", borderPaint, baseLines[0], decoration.indicator));
  for (let i = 1;i < bottomIdx; i++) {
    const line = baseLines[i] ?? "";
    result.push(`${rail} ${fillLine(line, innerWidth)} ${rail}`);
  }
  result.push(inlineFooter ? inlineBorder(width, "bottom", borderPaint, (budget) => renderInlineLine("bottom", budget), baseLines[bottomIdx]) : roundedBorder(width, "bottom", borderPaint, baseLines[bottomIdx]));
  for (let i = bottomIdx + 1;i < baseLines.length; i++) {
    result.push(baseLines[i]);
  }
  decoration.framedWidth = width;
  return result.map((line) => truncateToWidth3(line, width, ""));
}
function decorateOpenTuiEditor(editor, tui, options = {}) {
  const existing = DECORATIONS.get(editor);
  if (existing)
    return editor;
  const decorated = editor;
  const restore = [];
  const baseHandleMouse = editor.handleMouse.bind(editor);
  const baseSetPaddingX = editor.setPaddingX.bind(editor);
  const baseSetWorkingStatus = decorated.setWorkingStatusIndicator?.bind(editor);
  const baseSetCursorStyle = decorated.setCursorStyle?.bind(editor);
  let padding = editor.getPaddingX();
  const decoration = {
    tui,
    editor,
    cursorStyle: options.cursorStyle ?? "block",
    previewHardwareCursor: false,
    inlineFooter: options.inlineFooter,
    indicator: undefined,
    baseRender: editor.render.bind(editor),
    framedWidth: undefined,
    active: true,
    cleanup() {
      if (!decoration.active)
        return;
      decoration.active = false;
      for (const undo of restore)
        undo();
      baseSetPaddingX(padding);
      DECORATIONS.delete(editor);
    }
  };
  const patch = (key, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(editor, key);
    decorated[key] = value;
    restore.push(() => {
      if (decorated[key] !== value)
        return;
      if (descriptor)
        Object.defineProperty(editor, key, descriptor);
      else
        Reflect.deleteProperty(editor, key);
    });
  };
  DECORATIONS.set(editor, decoration);
  configureCursor(tui, decoration.cursorStyle);
  patch("embedWorkingStatus", true);
  patch("setWorkingStatusIndicator", (indicator) => {
    if (!decoration.active)
      return baseSetWorkingStatus?.(indicator);
    decoration.indicator = indicator;
    tui.requestRender();
  });
  patch("setCursorStyle", (style, hardware = false) => {
    if (decoration.active)
      applyCursorStyle(decoration, style, hardware);
    else
      baseSetCursorStyle?.(style, hardware);
  });
  patch("render", (width) => decoration.active ? renderFrame(decoration, width) : decoration.baseRender(width));
  patch("handleMouse", (event) => baseHandleMouse(decoration.active && event.width === decoration.framedWidth ? { ...event, x: event.x - EDITOR_FRAME_LEFT_INSET, width: event.width - EDITOR_FRAME_HORIZONTAL_CHROME } : event));
  patch("setPaddingX", (nextPadding) => {
    padding = nextPadding;
    baseSetPaddingX(decoration.active ? 0 : nextPadding);
  });
  baseSetPaddingX(0);
  return editor;
}
function repaintAfterStreamWrites(requestRepaint, stream = process.stderr) {
  if (!stream.isTTY)
    return () => {};
  const original = stream.write;
  let enabled = true;
  const patched = (...args) => {
    const callback = typeof args[args.length - 1] === "function" ? args.pop() : undefined;
    return original.call(stream, ...args, (error) => {
      try {
        if (enabled)
          requestRepaint();
      } catch {}
      callback?.(error);
    });
  };
  stream.write = patched;
  return () => {
    enabled = false;
    if (stream.write === patched)
      stream.write = original;
  };
}
function installEditor(_pi, ctx, cursorStyle = "block", inlineFooter) {
  let activeTui;
  let activeEditor;
  let enabled = true;
  let previousHardwareCursor;
  let currentCursorStyle = cursorStyle;
  let hiddenThinkingTarget;
  let restoreHiddenThinkingRender;
  let buildHiddenThinkingLabel;
  const getActiveTui = () => {
    if (!activeTui)
      throw new Error("Open TUI editor is not mounted");
    return activeTui;
  };
  const resetHiddenThinkingTarget = () => {
    restoreHiddenThinkingRender?.();
    restoreHiddenThinkingRender = undefined;
    hiddenThinkingTarget = undefined;
    buildHiddenThinkingLabel = undefined;
  };
  const patchHiddenThinkingRender = (target) => {
    const originalRender = target.render;
    let lastWidth;
    let lastBuild;
    let active = true;
    const patched = function(width) {
      if (!active)
        return originalRender.call(this, width);
      const build = buildHiddenThinkingLabel;
      const textWidth = hiddenThinkingTextWidth(width, this.outputPad);
      if (build && (build !== lastBuild || textWidth !== lastWidth)) {
        lastBuild = build;
        lastWidth = textWidth;
        this.setHiddenThinkingLabel(build(textWidth));
      }
      return originalRender.call(this, width);
    };
    target.render = patched;
    restoreHiddenThinkingRender = () => {
      active = false;
      if (target.render === patched)
        target.render = originalRender;
    };
  };
  const restoreStderr = repaintAfterStreamWrites(() => {
    if (activeTui?.mode === "fullscreen")
      activeTui.requestRender(true);
  });
  const ui = ctx.ui;
  const originalSetEditor = ui.setEditorComponent;
  const originalGetEditor = ui.getEditorComponent;
  let inheritedFactory = originalGetEditor.call(ui);
  let mountedEditor;
  let mountedFactory;
  let mountedRender;
  let restoreEditorMount;
  const releaseEditor = () => {
    if (activeEditor)
      DECORATIONS.get(activeEditor)?.cleanup();
    activeEditor = undefined;
    if (activeTui && previousHardwareCursor !== undefined) {
      if (currentCursorStyle !== "block")
        activeTui.terminal.write(DEFAULT_CURSOR_STYLE_SEQUENCE);
      activeTui.setShowHardwareCursor(previousHardwareCursor);
    }
    previousHardwareCursor = undefined;
  };
  const mountEditor = (tui, editor) => {
    releaseEditor();
    activeTui = tui;
    mountedEditor = editor;
    mountedFactory = originalGetEditor.call(ui);
    resetHiddenThinkingTarget();
    if (isFrameableEditor(editor)) {
      let lines = [];
      try {
        lines = editor.render(tui.terminal.columns);
      } catch {}
      const bottom = findBottomBorderIndex(lines);
      if (bottom > 1 && isEditorBorderLine(lines[0] ?? "") && isEditorBorderLine(lines[bottom] ?? "")) {
        previousHardwareCursor = tui.getShowHardwareCursor?.();
        activeEditor = decorateOpenTuiEditor(editor, tui, { cursorStyle: currentCursorStyle, inlineFooter });
      }
    }
    mountedRender = editor.render;
  };
  const wrapFactory = (delegate) => {
    const wrapped = (tui, editorTheme, keybindings) => {
      let inner;
      try {
        inner = delegate?.(tui, editorTheme, keybindings);
      } catch {}
      inner ??= new CustomEditor(tui, editorTheme, keybindings, { paddingX: 0 });
      if (enabled && originalGetEditor.call(ui) === wrapped)
        mountEditor(tui, inner);
      return inner;
    };
    return wrapped;
  };
  let factory = wrapFactory(inheritedFactory);
  const getEditor = () => {
    const current = originalGetEditor.call(ui);
    return enabled && current === factory ? inheritedFactory : current;
  };
  const setEditor = (next) => {
    if (!enabled)
      return originalSetEditor.call(ui, next);
    inheritedFactory = next;
    factory = wrapFactory(next);
    originalSetEditor.call(ui, factory);
  };
  ui.getEditorComponent = getEditor;
  ui.setEditorComponent = setEditor;
  originalSetEditor.call(ui, factory);
  const pending = activeTui ? [activeTui] : [];
  const visited = new Set;
  while (pending.length > 0) {
    const component = pending.pop();
    if (visited.has(component))
      continue;
    visited.add(component);
    const container = component;
    if (!Array.isArray(container.children))
      continue;
    if (!mountedEditor || !container.children.includes(mountedEditor) || typeof container.addChild !== "function") {
      pending.push(...container.children);
      continue;
    }
    const target = container;
    const original = target.addChild;
    const descriptor = Object.getOwnPropertyDescriptor(target, "addChild");
    const patched = function(child) {
      const candidate = child;
      if (enabled && activeTui && (child !== mountedEditor || originalGetEditor.call(ui) !== mountedFactory || child.render !== mountedRender) && typeof candidate.getText === "function" && typeof candidate.setText === "function" && typeof candidate.handleInput === "function" && typeof candidate.onSubmit === "function" && candidate.onSubmit === mountedEditor?.onSubmit && typeof candidate.onChange === "function" && candidate.onChange === mountedEditor?.onChange) {
        mountEditor(activeTui, candidate);
      }
      original.call(this, child);
    };
    target.addChild = patched;
    restoreEditorMount = () => {
      if (target.addChild !== patched)
        return;
      if (descriptor)
        Object.defineProperty(target, "addChild", descriptor);
      else
        Reflect.deleteProperty(target, "addChild");
    };
    break;
  }
  return {
    isFramed: () => enabled && activeEditor !== undefined,
    setLatestHiddenThinkingLabel(build) {
      const tui = getActiveTui();
      if (!hiddenThinkingTarget) {
        hiddenThinkingTarget = findLatestHiddenThinkingLabel(tui);
        patchHiddenThinkingRender(hiddenThinkingTarget);
      }
      buildHiddenThinkingLabel = build;
      tui.requestRender();
    },
    resetHiddenThinkingLabelTarget: resetHiddenThinkingTarget,
    getTui: () => activeTui,
    setCursorStyle(nextCursorStyle) {
      currentCursorStyle = nextCursorStyle;
      activeEditor?.setCursorStyle(nextCursorStyle, previousHardwareCursor);
    },
    cleanup() {
      if (!enabled)
        return;
      enabled = false;
      restoreEditorMount?.();
      releaseEditor();
      restoreStderr();
      resetHiddenThinkingTarget();
      if (ui.setEditorComponent === setEditor)
        ui.setEditorComponent = originalSetEditor;
      if (ui.getEditorComponent === getEditor)
        ui.getEditorComponent = originalGetEditor;
      const current = originalGetEditor.call(ui);
      if (current === factory || current === mountedFactory) {
        try {
          originalSetEditor.call(ui, current === factory ? inheritedFactory : current);
        } catch {
          originalSetEditor.call(ui, undefined);
        }
      }
    }
  };
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/footer.ts
import { hostname as osHostname } from "os";
import { truncateToWidth as truncateToWidth4, visibleWidth as visibleWidth5, wrapTextWithAnsi as wrapTextWithAnsi2 } from "@earendil-works/pi-tui";

// stow_modules/main/dot-pi/agent/extensions/open-tui/icons.ts
var NERD_GLYPHS = {
  cwd: "\uF07C",
  host: "\uF233",
  session: "\uF02B",
  git: "\uF418",
  working: "\uF017",
  done: "\uF00C",
  context: "\uF0C9",
  model: "\uF121",
  thinking: "\uF0EB",
  input: "\uF093",
  output: "\uF019",
  cacheHit: "\uF1C0",
  cost: "\uF155",
  speed: "\uDB81\uDCC5",
  latency: "\uF252",
  stall: "\uF071",
  extensions: "\uF1E6",
  ahead: "\u2191",
  behind: "\u2193",
  diverged: "\u21D5",
  conflicted: "=",
  stashed: "$",
  modified: "!",
  staged: "+",
  untracked: "?",
  renamed: "\xBB",
  deleted: "\u2718",
  toolCall: "\u25CF",
  toolResult: "\u23BF"
};
var ASCII_GLYPHS = {
  cwd: "@",
  host: "h",
  session: "s",
  git: "*",
  working: "o",
  done: "+",
  context: "#",
  model: "M",
  thinking: "~",
  input: "\u2191",
  output: "\u2193",
  cacheHit: "c",
  cost: "$",
  speed: ">",
  latency: "~",
  stall: "!",
  extensions: "&",
  ahead: "^",
  behind: "v",
  diverged: "^v",
  conflicted: "=",
  stashed: "S",
  modified: "!",
  staged: "A",
  untracked: "?",
  renamed: "r",
  deleted: "x",
  toolCall: "*",
  toolResult: "`-"
};
var UNICODE_GLYPHS = {
  cwd: "\uD83D\uDCC1",
  host: "\u2302",
  session: "\uD83D\uDD16",
  git: "\uD83C\uDF3F",
  working: "\u25F7",
  done: "\u2713",
  context: "\u2261",
  model: "\uD83D\uDCBB",
  thinking: "\uD83D\uDCA1",
  input: "\u2191",
  output: "\u2193",
  cacheHit: "\uD83D\uDCBE",
  cost: "$",
  speed: "\u26A1",
  latency: "\u231B",
  stall: "\u26A0",
  extensions: "\uD83D\uDD0C",
  ahead: "\u2191",
  behind: "\u2193",
  diverged: "\u2195",
  conflicted: "=",
  stashed: "$",
  modified: "!",
  staged: "+",
  untracked: "?",
  renamed: "\u2192",
  deleted: "\u2717",
  toolCall: "\u25CF",
  toolResult: "\u2514"
};
function isSshSession() {
  return Boolean(process.env.SSH_TTY || process.env.SSH_CONNECTION);
}
function detectNerdFont() {
  if (process.env.TERM === "dumb" || process.stdout.isTTY !== true)
    return false;
  const locale = [process.env.LC_ALL, process.env.LC_CTYPE, process.env.LANG].find(Boolean);
  return locale === undefined || /utf-?8/i.test(locale);
}
function resolveIconMode(mode) {
  if (mode === "nerd")
    return "nerd";
  if (mode === "ascii")
    return "ascii";
  if (mode === "unicode")
    return "unicode";
  if (!detectNerdFont())
    return "ascii";
  if (isSshSession())
    return "unicode";
  return "nerd";
}
function resolveGlyphs(mode) {
  const resolved = resolveIconMode(mode);
  if (resolved === "unicode")
    return UNICODE_GLYPHS;
  return resolved === "nerd" ? NERD_GLYPHS : ASCII_GLYPHS;
}
var RUNTIME_SYMBOLS = {
  nodejs: "\uE718",
  rust: "\uE7A8",
  go: "\uE626",
  python: "\uE73C",
  ruby: "\uE739",
  java: "\uE256",
  cpp: "\uE61D",
  c: "\uE61E",
  swift: "\uE755",
  kotlin: "\uE634",
  deno: "\uE7FB",
  bun: "\uE76F",
  php: "\uE73D",
  haskell: "\uE777",
  julia: "\uE624",
  lua: "\uE620",
  elixir: "\uE62B",
  erlang: "\uE7B1",
  gleam: "\uE6B4",
  crystal: "\uE62F",
  dart: "\uE7C0",
  nim: "\uE677",
  zig: "\uE6A9",
  ocaml: "\uE67A",
  clojure: "\uE76A",
  scala: "\uE747",
  perl: "\uE769",
  r: "\uE68A",
  elm: "\uE62C",
  haxe: "\uE7B7",
  vagrant: "\uE21A",
  terraform: "\uE1A5"
};
var RUNTIME_ASCII_SYMBOLS = {
  nodejs: "node",
  rust: "rs",
  go: "go",
  python: "py",
  ruby: "rb",
  java: "java",
  swift: "swift",
  kotlin: "kt",
  cpp: "c++",
  c: "c",
  deno: "deno",
  bun: "bun",
  php: "php",
  haskell: "hs",
  julia: "jl",
  lua: "lua",
  elixir: "ex",
  erlang: "erl",
  gleam: "gleam",
  crystal: "cr",
  dart: "dart",
  nim: "nim",
  zig: "zig",
  ocaml: "ml",
  clojure: "clj",
  scala: "scala",
  perl: "pl",
  r: "R",
  elm: "elm",
  haxe: "hx",
  vagrant: "vag",
  terraform: "tf"
};
function runtimeSymbol(name, mode) {
  if (resolveIconMode(mode) !== "nerd")
    return RUNTIME_ASCII_SYMBOLS[name] ?? name;
  return RUNTIME_SYMBOLS[name] ?? "\uF120";
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/git.ts
import { execFile } from "child_process";
import { promisify } from "util";
var execFileAsync = promisify(execFile);
var GIT_TIMEOUT_MS = 2000;
function emptyGitStatus() {
  return {
    branch: undefined,
    ahead: 0,
    behind: 0,
    modified: 0,
    untracked: 0,
    staged: 0,
    stashed: 0,
    conflicted: 0,
    renamed: 0,
    deleted: 0,
    commit: null
  };
}
async function gitExec(args, cwd) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    });
    return stdout;
  } catch {
    return null;
  }
}
async function readGitStatus(cwd, options = {}) {
  const stdout = await gitExec(["status", "--porcelain=v1", "--branch"], cwd);
  if (stdout === null) {
    return emptyGitStatus();
  }
  const status = emptyGitStatus();
  const lines = stdout.split(`
`);
  for (const line of lines) {
    if (line.startsWith("## ")) {
      const branchPart = line.slice(3);
      const detached = branchPart.startsWith("HEAD (no branch)");
      if (detached) {
        status.branch = undefined;
        status.commit = { oid: null, detached: true, tag: null };
      } else {
        const branchMatch = branchPart.match(/^(\S+?)(?:\.\.\.(\S+))?(?:\s+\[(.*)\])?$/);
        if (branchMatch) {
          status.branch = branchMatch[1];
          const ahead = branchMatch[3]?.match(/\bahead (\d+)\b/);
          const behind = branchMatch[3]?.match(/\bbehind (\d+)\b/);
          if (ahead)
            status.ahead = parseInt(ahead[1], 10);
          if (behind)
            status.behind = parseInt(behind[1], 10);
        }
      }
      continue;
    }
    if (options.readCounts === false)
      continue;
    if (line.length < 3)
      continue;
    const x = line[0];
    const y = line[1];
    if (x === "U" || y === "U" || x === "A" && y === "A" || x === "D" && y === "D")
      status.conflicted++;
    else if (x === "?" && y === "?")
      status.untracked++;
    else if (x === "R") {
      status.renamed++;
      if (y === "M")
        status.modified++;
      else if (y === "D")
        status.deleted++;
    } else if (x === "D" || y === "D")
      status.deleted++;
    else {
      if (x !== " " && x !== "?")
        status.staged++;
      if (y === "M" || y === "D")
        status.modified++;
    }
  }
  if (options.readCounts !== false) {
    const stashOut = await gitExec(["stash", "list", "--format=%H"], cwd);
    if (stashOut !== null) {
      status.stashed = stashOut.split(`
`).filter((line) => line.trim() !== "").length;
    }
  }
  if (options.readCommit && status.commit?.detached) {
    const oid = await gitExec(["rev-parse", "HEAD"], cwd);
    if (oid) {
      status.commit.oid = oid.trim();
    }
    if (options.readTag) {
      const tag = await gitExec(["describe", "--tags", "--exact-match", "HEAD"], cwd);
      if (tag) {
        status.commit.tag = tag.trim();
      }
    }
  }
  return status;
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/state.ts
var usageCache;
function getUsageTotals(ctx) {
  const { sessionManager } = ctx;
  const leafId = sessionManager.getLeafId();
  if (usageCache?.sessionManager === sessionManager && usageCache.leafId === leafId)
    return usageCache.totals;
  const totals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    latestCacheHitRate: undefined
  };
  for (const entry of sessionManager.getEntries()) {
    let u;
    let updateCacheHitRate = false;
    if (entry.type === "message" && entry.message.role === "assistant") {
      u = entry.message.usage;
      updateCacheHitRate = true;
    } else if (entry.type === "message" && entry.message.role === "toolResult") {
      u = entry.message.usage;
    } else if (entry.type === "usage" || entry.type === "branch_summary" || entry.type === "compaction") {
      u = entry.usage;
    }
    if (!u)
      continue;
    const input = finiteOrZero(u.input);
    const cacheRead = finiteOrZero(u.cacheRead);
    const cacheWrite = finiteOrZero(u.cacheWrite);
    totals.input += input + cacheWrite;
    totals.output += finiteOrZero(u.output);
    totals.cacheRead += cacheRead;
    totals.cacheWrite += cacheWrite;
    totals.cost += finiteOrZero(u.cost?.total);
    if (updateCacheHitRate) {
      const promptTokens = input + cacheRead + cacheWrite;
      totals.latestCacheHitRate = promptTokens > 0 ? cacheRead / promptTokens * 100 : undefined;
    }
  }
  usageCache = { sessionManager, leafId, totals };
  return totals;
}
function invalidateUsageCache() {
  usageCache = undefined;
}
function createInitialState() {
  return {
    git: emptyGitStatus(),
    runtime: null,
    workingSince: undefined,
    lastDoneIn: undefined
  };
}
function getModelMeta(ctx, getThinkingLevel, capitalizeProviderName) {
  const provider = formatProviderLabel(ctx.model?.provider, capitalizeProviderName);
  const model = ctx.model?.name ?? ctx.model?.id ?? "no-model";
  const reasoning = ctx.model?.reasoning ?? false;
  const effort = reasoning ? getThinkingLevel() : undefined;
  return { provider, model, effort };
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/footer.ts
function shortHostname(hostname) {
  return hostname.split(".")[0] ?? "";
}
function spaceFooterIcon(glyph) {
  return /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u.test(glyph) ? `${glyph} ` : glyph;
}
function renderBar(theme, pct, barWidth, ascii) {
  const filled = Math.max(0, Math.min(barWidth, Math.round(pct / 100 * barWidth)));
  const empty = barWidth - filled;
  const color = stressColor(pct);
  const filledCell = ascii ? "#" : "\u2588";
  const emptyCell = ascii ? "-" : "\u2591";
  return theme.fg("dim", "[") + theme.fg(color, filledCell.repeat(filled)) + theme.fg("dim", emptyCell.repeat(empty)) + theme.fg("dim", "]");
}
function renderContextCompact(theme, ctx, glyphs) {
  const contextUsage = ctx.getContextUsage();
  const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
  if (contextWindow <= 0)
    return "";
  const contextPct = contextUsage?.percent ?? 0;
  return `${theme.fg(stressColor(contextPct), glyphs.context)} ${theme.fg(stressColor(contextPct), `${contextPct.toFixed(1)}%`)}`;
}
function renderGitSegment(theme, git, glyphs, segments, maxBranchLen = 20) {
  const parts = [];
  if (segments.gitBranch) {
    if (git.branch) {
      parts.push(theme.fg("mdLink", glyphs.git));
      parts.push(theme.fg("mdLink", truncateBranch(git.branch, maxBranchLen)));
    } else if (git.commit?.detached) {
      parts.push(theme.fg("warning", glyphs.git));
      parts.push(theme.fg("warning", "HEAD"));
      if (git.commit.oid) {
        const shortHash = git.commit.oid.slice(0, 7);
        const tag = git.commit.tag ? ` ${git.commit.tag}` : "";
        parts.push(theme.fg("dim", `${shortHash}${tag}`));
      }
    }
  }
  if (segments.gitStatus) {
    const statusIcons = [];
    const addStatus = (count, glyph, color) => {
      if (count > 0)
        statusIcons.push(theme.fg(color, `${glyph}${count}`));
    };
    addStatus(git.conflicted, glyphs.conflicted, "error");
    addStatus(git.deleted, glyphs.deleted, "error");
    addStatus(git.modified, glyphs.modified, "warning");
    addStatus(git.renamed, glyphs.renamed, "warning");
    addStatus(git.staged, glyphs.staged, "success");
    addStatus(git.untracked, glyphs.untracked, "muted");
    addStatus(git.stashed, glyphs.stashed, "muted");
    if (git.ahead > 0 && git.behind > 0) {
      statusIcons.push(theme.fg("warning", `${glyphs.diverged}${git.ahead}/${git.behind}`));
    } else if (git.ahead > 0) {
      statusIcons.push(theme.fg("success", `${glyphs.ahead}${git.ahead}`));
    } else if (git.behind > 0) {
      statusIcons.push(theme.fg("warning", `${glyphs.behind}${git.behind}`));
    }
    const statusBlock = statusIcons.join(" ");
    if (statusBlock) {
      parts.push(`${theme.fg("dim", "[")}${statusBlock}${theme.fg("dim", "]")}`);
    }
  }
  return parts.join(" ");
}
function renderRuntimeSegment(theme, runtime, iconMode, spaceIcon) {
  if (!runtime)
    return "";
  const glyph = runtimeSymbol(runtime.name, iconMode);
  const symbol = theme.fg("success", spaceIcon ? spaceFooterIcon(glyph) : glyph);
  const version = runtime.version ? theme.fg("muted", runtime.version) : "";
  const label = [symbol, version].filter(Boolean).join(" ");
  return label;
}
function renderTimerSegment(theme, state, glyphs) {
  if (state.workingSince !== undefined) {
    return `${theme.fg("accent", glyphs.working)} ${theme.fg("dim", "working")} ${theme.fg("accent", formatDuration(Date.now() - state.workingSince))}`;
  }
  if (state.lastDoneIn !== undefined) {
    return `${theme.fg("success", glyphs.done)} ${theme.fg("success", "done")} ${theme.fg("text", formatDuration(state.lastDoneIn))}`;
  }
  return "";
}
function renderContextBar(theme, ctx, width, glyphs, iconMode) {
  const contextUsage = ctx.getContextUsage();
  const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
  const contextTokens = contextUsage?.tokens ?? 0;
  const contextPct = contextUsage?.percent ?? 0;
  if (contextWindow <= 0)
    return "";
  const pctText = theme.fg(stressColor(contextPct), `${contextPct.toFixed(1)}%`);
  const ctxText = `${theme.fg("text", fmtTokens(contextTokens))}${theme.fg("dim", "/")}${theme.fg("text", fmtTokens(contextWindow))}`;
  const contextIcon = theme.fg(stressColor(contextPct), glyphs.context);
  const reserved = visibleWidth5(contextIcon) + visibleWidth5(pctText) + visibleWidth5(ctxText) + 5 + 2;
  const barWidth = Math.max(4, Math.min(12, width - reserved));
  return `${contextIcon} ${renderBar(theme, contextPct, barWidth, resolveIconMode(iconMode) === "ascii")} ${pctText} ${theme.fg("dim", "\xB7")} ${ctxText}`;
}
function renderStatsSegments(theme, totals, glyphs, segments) {
  const stats = [];
  if (segments.tokens) {
    stats.push(theme.fg("accent", `${glyphs.input} ${formatInputBreakdown(totals.input, totals.cacheRead)}`));
    stats.push(theme.fg("success", `${glyphs.output} ${fmtTokens(totals.output)}`));
    const hasCacheTokens = totals.cacheRead > 0 || totals.cacheWrite > 0;
    if (hasCacheTokens && totals.latestCacheHitRate !== undefined) {
      stats.push(theme.fg(cacheHitColor(totals.latestCacheHitRate), `${glyphs.cacheHit} ${totals.latestCacheHitRate.toFixed(1)}%`));
    }
  }
  return {
    tokens: stats.join(` ${theme.fg("dim", "|")} `),
    cost: segments.cost ? theme.fg("warning", `${glyphs.cost} $${totals.cost.toFixed(3)}`) : ""
  };
}
var ANSI_RESET = "\x1B[0m";
function renderStatusText(theme, status) {
  if (!hasAnsiStyles(status))
    return theme.fg("muted", status);
  return `${status}${ANSI_RESET}`;
}
function renderExtensionStatusLines(theme, extensionStatuses, glyphs, width) {
  const statuses = Array.from(extensionStatuses.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => sanitizeStatusPreservingStyles(text)).filter((text) => text.length > 0);
  if (statuses.length === 0)
    return [];
  const separator = ` ${theme.fg("dim", "|")} `;
  const statusText = statuses.map((status) => renderStatusText(theme, status)).join(separator);
  const line = `${theme.fg("mdLink", glyphs.extensions)} ${statusText}`;
  return wrapTextWithAnsi2(line, width);
}
function fitInlineLine(left, right, width, theme) {
  const rightWidth = visibleWidth5(right);
  if (rightWidth > width) {
    return { left: "", right: truncateToWidth4(right, width, theme.fg("dim", "...")) };
  }
  const availableForLeft = width - rightWidth - 1;
  if (availableForLeft <= 0)
    return { left: "", right };
  return { left: truncateToWidth4(left, availableForLeft, theme.fg("dim", "...")), right };
}
function fitInlineSegments(parts, width, theme) {
  const separator = theme.fg("dim", " \xB7 ");
  const separatorReserve = Math.max(0, parts.length - 1) * Math.max(0, visibleWidth5(separator) - 1);
  return fitSegmentsByPriority(parts, Math.max(0, width - separatorReserve), theme.fg("dim", "...")).filter(Boolean).join(separator);
}
var FOOTER_ANCHORS = {
  plain: {
    1: { left: ["cwd", "hostname", "sessionName", "git", "runtime", "timer"], right: ["context"] },
    2: { left: ["model"], right: ["tokens", "cost"] }
  },
  inline: {
    1: { left: ["sessionName", "git"], right: ["cwd", "hostname", "runtime", "timer", "context"] },
    2: { left: ["model"], right: ["tokens", "cost"] }
  }
};
function fitContributedRow(row, mode, builtins, contributions, width, theme) {
  let contributed = false;
  const collect = (side) => {
    const parts = [];
    const append = (matches) => {
      for (const segment of contributions) {
        if (!matches(segment.position))
          continue;
        contributed = true;
        parts.push({
          text: renderStatusText(theme, segment.text),
          compactText: segment.compactText && visibleWidth5(segment.compactText) > 0 ? renderStatusText(theme, segment.compactText) : undefined,
          priority: segment.priority
        });
      }
    };
    const atEdge = (edge) => append((position) => ("row" in position) && position.row === row && position.side === side && (position.edge ?? "end") === edge);
    atEdge("start");
    for (const anchor of FOOTER_ANCHORS[mode][row][side]) {
      append((position) => ("before" in position) && position.before === anchor);
      const builtin = builtins[anchor];
      if (builtin?.text)
        parts.push(builtin);
      append((position) => ("after" in position) && position.after === anchor);
    }
    atEdge("end");
    return parts;
  };
  const left = collect("left");
  const right = collect("right");
  if (!contributed)
    return;
  const leftSeparator = row === 1 && mode === "plain" ? " " : theme.fg("dim", " \xB7 ");
  const rightSeparator = row === 1 ? leftSeparator : theme.fg("dim", " | ");
  const fitted = fitSegmentsByPriority([...left, ...right], width, theme.fg("dim", "..."), {
    compactOrder: "priority",
    gapWidth: (previous, next) => {
      if (previous < left.length && next >= left.length)
        return 1;
      return visibleWidth5(next < left.length ? leftSeparator : rightSeparator);
    }
  });
  const join = (parts, separator) => parts.filter(Boolean).map((part) => `${part}${ANSI_RESET}`).join(separator);
  return {
    left: join(fitted.slice(0, left.length), leftSeparator),
    right: join(fitted.slice(left.length), rightSeparator)
  };
}
function alignContributedRow(line, width, theme) {
  if (!line.right)
    return truncateToWidth4(line.left, width, theme.fg("dim", "..."));
  return alignRight(line.left, line.right, width, theme);
}
function renderFooterContent(ctx, getState, getConfig, getModelMeta, theme, footerData, width, getLiveTps, getExtensionSegments) {
  if (width <= 0) {
    return {
      mainLines: ["", ""],
      inlineLines: {
        top: { left: "", right: "" },
        bottom: { left: "", right: "" }
      },
      extensionLines: []
    };
  }
  const state = getState();
  const config = getConfig();
  const segments = config.footerSegments;
  const glyphs = { ...resolveGlyphs(config.icons.mode) };
  if (segments.nerdIconSpacing) {
    for (const key of Object.keys(glyphs)) {
      glyphs[key] = spaceFooterIcon(glyphs[key]);
    }
  }
  const meta = getModelMeta();
  const totals = getUsageTotals(ctx);
  const builtins = {};
  const contributions = segments.extensionSegments ? getExtensionSegments().filter((segment) => visibleWidth5(segment.text) > 0) : [];
  const leftParts = [];
  const inlineTopLeftParts = [];
  const inlineTopRightParts = [];
  if (segments.cwd) {
    const maxCwd = Math.min(30, Math.max(10, Math.floor(width * 0.4)));
    const cwd = formatCwd(ctx.sessionManager.getCwd());
    const cwdPrefix = `${theme.fg("mdLink", glyphs.cwd)} `;
    const accent = (text) => theme.fg("accent", text);
    leftParts.push({
      text: `${cwdPrefix}${accent(truncatePath(cwd, maxCwd))}`,
      compactText: `${cwdPrefix}${accent(truncatePath(basenamePath(cwd), maxCwd))}`,
      priority: 4,
      truncate: (_text, maxWidth, ellipsis) => {
        const pathWidth = maxWidth - visibleWidth5(cwdPrefix);
        if (pathWidth <= visibleWidth5(ellipsis)) {
          return truncateToWidth4(`${cwdPrefix}${accent(basenamePath(cwd))}`, maxWidth, ellipsis);
        }
        return `${cwdPrefix}${accent(truncatePath(basenamePath(cwd), pathWidth))}`;
      }
    });
    inlineTopRightParts.push(leftParts.at(-1));
    builtins.cwd = leftParts.at(-1);
  }
  if (segments.hostname) {
    const shortHost = shortHostname(osHostname());
    if (shortHost) {
      leftParts.push({
        text: `${theme.fg("dim", glyphs.host)} ${theme.fg("accent", shortHost)}`,
        priority: 3
      });
      inlineTopRightParts.push(leftParts.at(-1));
      builtins.hostname = leftParts.at(-1);
    }
  }
  const sessionName = ctx.sessionManager.getSessionName();
  if (sessionName) {
    const sessionPart = {
      text: `${theme.fg("dim", glyphs.session)} ${theme.fg("text", truncateToWidth4(sessionName, 24, theme.fg("dim", "...")))}`,
      priority: 2
    };
    if (segments.sessionName) {
      leftParts.push(sessionPart);
      inlineTopLeftParts.push(sessionPart);
      builtins.sessionName = sessionPart;
    }
  }
  const gitSeg = renderGitSegment(theme, state.git, glyphs, segments);
  if (gitSeg) {
    leftParts.push({ text: gitSeg, priority: 1 });
    inlineTopLeftParts.push(leftParts.at(-1));
    builtins.git = leftParts.at(-1);
  }
  if (segments.runtime) {
    const runtimeSeg = renderRuntimeSegment(theme, state.runtime, config.icons.mode, segments.nerdIconSpacing);
    if (runtimeSeg) {
      leftParts.push({ text: runtimeSeg, priority: 0 });
      inlineTopRightParts.push(leftParts.at(-1));
      builtins.runtime = leftParts.at(-1);
    }
  }
  const timerSeg = renderTimerSegment(theme, state, glyphs);
  if (timerSeg) {
    const liveTps = state.workingSince !== undefined && segments.liveTps ? getLiveTps() : null;
    const text = liveTps === null ? timerSeg : `${timerSeg} ${theme.fg("dim", "\xB7")} ${theme.fg(liveTps.stale ? "dim" : "accent", `${glyphs.speed} ~${Math.round(liveTps.tps)} tok/s`)}`;
    leftParts.push({ text, compactText: liveTps === null ? undefined : timerSeg, priority: 3 });
    inlineTopRightParts.push(leftParts.at(-1));
    builtins.timer = leftParts.at(-1);
  }
  let contextText = "";
  let contextCompact;
  if (segments.context) {
    contextText = renderContextBar(theme, ctx, width, glyphs, config.icons.mode);
    const compact = renderContextCompact(theme, ctx, glyphs);
    if (compact && visibleWidth5(compact) < visibleWidth5(contextText)) {
      contextCompact = compact;
    }
  }
  const allParts = [...leftParts];
  if (contextText) {
    allParts.push({ text: contextText, compactText: contextCompact, priority: 0 });
    inlineTopRightParts.push({ text: contextText, compactText: contextCompact, priority: 0 });
    builtins.context = allParts.at(-1);
  }
  const fitted = fitSegmentsByPriority(allParts, width, theme.fg("dim", "..."));
  const fittedContext = contextText ? fitted.pop() ?? "" : "";
  const contributedTop = fitContributedRow(1, "plain", builtins, contributions, width, theme);
  const line1 = contributedTop ? alignContributedRow(contributedTop, width, theme) : alignRight(fitted.filter(Boolean).join(" "), fittedContext, width, theme);
  const inlineLeftBudget = Math.floor(width * 0.45);
  const inlineTopLeft = fitInlineSegments(inlineTopLeftParts, inlineLeftBudget, theme);
  const inlineRightBudget = Math.max(0, width - visibleWidth5(inlineTopLeft) - (inlineTopLeft ? 1 : 0));
  const inlineTop = fitContributedRow(1, "inline", builtins, contributions, width, theme) ?? {
    left: inlineTopLeft,
    right: fitInlineSegments(inlineTopRightParts, inlineRightBudget, theme)
  };
  const modelParts = [];
  modelParts.push(theme.fg("mdLink", glyphs.model));
  if (meta.provider && meta.provider !== "Unknown") {
    modelParts.push(theme.fg(providerColor(ctx.model?.provider ?? "none"), meta.provider));
  }
  modelParts.push(theme.fg("text", meta.model));
  if (meta.effort && meta.effort !== "off") {
    modelParts.push(theme.fg(effortColor(meta.effort), `${glyphs.thinking} ${meta.effort}`));
  }
  const modelBlock = modelParts.join(theme.fg("dim", " \xB7 "));
  const stats = renderStatsSegments(theme, totals, glyphs, segments);
  const statsBlock = [stats.tokens, stats.cost].filter(Boolean).join(` ${theme.fg("dim", "|")} `);
  builtins.model = { text: modelBlock, priority: 0 };
  builtins.tokens = { text: stats.tokens, priority: 2 };
  builtins.cost = { text: stats.cost, priority: 1 };
  const contributedBottom = fitContributedRow(2, "plain", builtins, contributions, width, theme);
  const inlineBottom = contributedBottom ?? fitInlineLine(modelBlock, statsBlock, width, theme);
  const line2 = contributedBottom ? alignContributedRow(contributedBottom, width, theme) : alignRight(inlineBottom.left, inlineBottom.right, width, theme);
  const mainLines = [line1, line2].map((line) => truncateToWidth4(line, width, theme.fg("dim", "...")));
  const extensionLines = segments.extensionStatuses ? renderExtensionStatusLines(theme, footerData.getExtensionStatuses(), glyphs, width) : [];
  return { mainLines, inlineLines: { top: inlineTop, bottom: inlineBottom }, extensionLines };
}
function installFooter(ctx, getState, getConfig, getModelMeta, hooks) {
  let renderInline = () => {
    return;
  };
  let mounted = false;
  ctx.ui.setFooter((tui, theme, footerData) => {
    mounted = true;
    let disposed = false;
    hooks.setRequestRender(() => tui.requestRender());
    const unsubBranch = footerData.onBranchChange(() => {
      hooks.scheduleGitRefresh();
      tui.requestRender();
    });
    const getContent = (width) => renderFooterContent(ctx, getState, getConfig, getModelMeta, theme, footerData, width, hooks.getLiveTps ?? (() => null), hooks.getExtensionSegments ?? (() => []));
    renderInline = (width) => getContent(width).inlineLines;
    return {
      dispose() {
        if (disposed)
          return;
        disposed = true;
        mounted = false;
        unsubBranch();
        hooks.setRequestRender(undefined);
        renderInline = () => {
          return;
        };
      },
      invalidate() {},
      render(width) {
        if (width <= 0)
          return [""];
        const { mainLines, extensionLines } = getContent(width);
        const inline = getConfig().inlineFooter && (hooks.canEmbedInEditor?.() ?? true);
        return inline ? extensionLines : [...mainLines, ...extensionLines];
      }
    };
  });
  return {
    renderInline: (width) => renderInline(width),
    cleanup() {
      if (mounted)
        ctx.ui.setFooter(undefined);
    }
  };
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/footer-segments.ts
import { randomUUID as randomUUID2 } from "crypto";
var BUILTIN_SEGMENTS = [
  "cwd",
  "hostname",
  "sessionName",
  "git",
  "runtime",
  "timer",
  "context",
  "model",
  "tokens",
  "cost"
];
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isAnchor(value) {
  return typeof value === "string" && BUILTIN_SEGMENTS.some((anchor) => anchor === value);
}
function readPosition(value) {
  if (!isRecord(value))
    return;
  if ("before" in value) {
    if ("after" in value || "row" in value || "side" in value || "edge" in value)
      return;
    return isAnchor(value.before) ? { before: value.before } : undefined;
  }
  if ("after" in value) {
    if ("row" in value || "side" in value || "edge" in value)
      return;
    return isAnchor(value.after) ? { after: value.after } : undefined;
  }
  if (value.row !== 1 && value.row !== 2)
    return;
  if (value.side !== "left" && value.side !== "right")
    return;
  if (value.edge !== undefined && value.edge !== "start" && value.edge !== "end")
    return;
  return { row: value.row, side: value.side, edge: value.edge ?? "end" };
}
function readSegment(value) {
  if (typeof value.key !== "string" || value.key.trim().length === 0 || typeof value.text !== "string")
    return;
  if (value.compactText !== undefined && typeof value.compactText !== "string")
    return;
  if (value.order !== undefined && (typeof value.order !== "number" || !Number.isFinite(value.order)))
    return;
  if (value.priority !== undefined && (typeof value.priority !== "number" || !Number.isFinite(value.priority)))
    return;
  const position = readPosition(value.position);
  if (!position)
    return;
  return {
    key: value.key,
    position,
    text: sanitizeStatusPreservingStyles(value.text),
    compactText: value.compactText === undefined ? undefined : sanitizeStatusPreservingStyles(value.compactText),
    order: value.order ?? 0,
    priority: value.priority ?? -1
  };
}
function createFooterSegments(events, requestRender) {
  let lifecycle;
  const segments = new Map;
  let ordered = [];
  const announce = () => {
    const state = lifecycle === undefined ? { available: false } : { available: true, lifecycle };
    events.emit("open-tui:footer:state", state);
  };
  const changed = () => {
    ordered = [...segments.values()].sort((a, b) => a.order - b.order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    requestRender();
  };
  events.on("open-tui:footer:query", announce);
  events.on("open-tui:footer:set", (data) => {
    if (!lifecycle || !isRecord(data) || data.lifecycle !== lifecycle)
      return;
    const segment = readSegment(data);
    if (!segment)
      return;
    segments.set(segment.key, segment);
    changed();
  });
  events.on("open-tui:footer:remove", (data) => {
    if (!lifecycle || !isRecord(data) || data.lifecycle !== lifecycle || typeof data.key !== "string")
      return;
    if (segments.delete(data.key))
      changed();
  });
  return {
    getSegments: () => ordered,
    activate() {
      if (lifecycle !== undefined)
        return;
      lifecycle = randomUUID2();
      announce();
    },
    deactivate() {
      if (lifecycle === undefined)
        return;
      lifecycle = undefined;
      segments.clear();
      ordered = [];
      announce();
    }
  };
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/header.ts
import { VERSION } from "@earendil-works/pi-coding-agent";
var LOGO = [
  "            ",
  "            ",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588   ",
  "\u2588\u2588\u2588   \u2588\u2588\u2588   ",
  "\u2588\u2588\u2588\u2588\u2588\u2588   \u2588\u2588\u2588",
  "\u2588\u2588\u2588      \u2588\u2588\u2588",
  "            "
];
function renderLogo(paintBrand) {
  return LOGO.map((line) => line.replace(/\u2588\u2588\u2588/g, paintBrand));
}
function borderLine(left, label, right, width, paint) {
  if (width <= 1)
    return "";
  if (width < 8 || label.length === 0) {
    return paint(truncateToWidth(left + "\u2500".repeat(Math.max(0, width - 2)) + right, width, ""));
  }
  const before = "\u2500\u2500\u2500 ";
  const after = " \u2500\u2500\u2500\u2500\u2500";
  const fixedWidth = visibleWidth(before) + visibleWidth(label) + visibleWidth(after);
  const fill = Math.max(0, width - 2 - fixedWidth);
  return `${paint(left)}${paint(before)}${label}${paint(after)}${paint("\u2500".repeat(fill))}${paint(right)}`;
}
function boxedLine(content, width, paint) {
  if (width <= 2)
    return truncateToWidth(content, width, "");
  return `${paint("\u2502")}${padRight(content, width - 2)}${paint("\u2502")}`;
}
function twoColumn(left, right, leftWidth, rightWidth, paint) {
  return `${padRight(left, leftWidth)} ${paint("\u2502")} ${padRight(right, rightWidth, "\u2026")}`;
}

class OpenTuiHeader {
  pi;
  ctx;
  tipCommands;
  constructor(pi, ctx, _tui) {
    this.pi = pi;
    this.ctx = ctx;
    const pool = collectPiCommandNames(pi.getCommands());
    this.tipCommands = pickSlashCommandTips(pool, {
      fixed: ["open-tui"],
      count: 3
    });
  }
  render(width) {
    const theme = this.ctx.ui.theme;
    const paint = (s) => theme.fg("accent", s);
    const muted = (s) => theme.fg("muted", s);
    const dim = (s) => theme.fg("dim", s);
    const bold = (s) => theme.bold(s);
    if (width < 24)
      return [truncateToWidth(paint(`Pi v${VERSION}`), width, "")];
    const innerWidth = width - 2;
    const { leftWidth, rightWidth, useTips } = headerColumnWidths(innerWidth);
    const model = formatModelLabel(this.ctx.model);
    const effort = formatThinkingLabel(this.pi.getThinkingLevel());
    const cwd = formatCwd(this.ctx.cwd);
    const leftLines = [
      ...renderLogo(paint).map((line) => center(line, leftWidth)),
      center(bold("Let's build something great"), leftWidth),
      center(muted(`${model} \xB7 ${effort}`), leftWidth),
      center(dim(cwd), leftWidth)
    ];
    const tipDivider = paint("\u2500".repeat(Math.max(8, Math.min(rightWidth, 22))));
    const [cmd0 = "", cmd1 = "", cmd2 = "", cmd3 = ""] = this.tipCommands;
    const tipLines = [
      "",
      paint(bold("Welcome")),
      muted("Ask Pi anything"),
      tipDivider,
      paint(bold("Commands")),
      muted(cmd0),
      muted(cmd1),
      muted(cmd2),
      muted(cmd3),
      ""
    ];
    const lines = [borderLine("\u256D", `${paint("Pi")} v${VERSION}`, "\u256E", width, paint)];
    for (let i = 0;i < leftLines.length; i++) {
      const content = useTips ? twoColumn(leftLines[i] ?? "", tipLines[i] ?? "", leftWidth, rightWidth, paint) : padRight(leftLines[i] ?? "", leftWidth);
      lines.push(boxedLine(content, width, paint));
    }
    lines.push(borderLine("\u2570", "", "\u256F", width, paint));
    return lines.map((line) => truncateToWidth(line, width, ""));
  }
  invalidate() {}
}
function installHeader(pi, ctx) {
  ctx.ui.setHeader((tui) => new OpenTuiHeader(pi, ctx, tui));
  return () => ctx.ui.setHeader(undefined);
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/runtime.ts
import { execFile as execFile2 } from "child_process";
import { existsSync as existsSync3, readdirSync, statSync as statSync2 } from "fs";
import { join as join3 } from "path";
import { promisify as promisify2 } from "util";
var execFileAsync2 = promisify2(execFile2);
var VERSION_TIMEOUT_MS = 2500;
var RUNTIMES = [
  { name: "bun", files: ["bun.lock", "bun.lockb"], versionCommand: { cmd: "bun", args: ["--version"], pattern: /(\d+\.\d+\.\d+)/ } },
  { name: "nodejs", files: ["package.json", ".nvmrc", ".node-version"], versionCommand: { cmd: "node", args: ["--version"], pattern: /v(\d+\.\d+\.\d+)/ } },
  { name: "rust", files: ["Cargo.toml"], versionCommand: { cmd: "rustc", args: ["--version"], pattern: /rustc\s+(\d+\.\d+\.\d+)/ } },
  { name: "go", files: ["go.mod"], versionCommand: { cmd: "go", args: ["version"], pattern: /go(\d+\.\d+\.\d+)/ } },
  { name: "python", files: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile", ".python-version"], versionCommand: { cmd: "python3", args: ["--version"], pattern: /Python\s+(\d+\.\d+\.\d+)/ } },
  { name: "ruby", files: ["Gemfile", ".ruby-version"], versionCommand: { cmd: "ruby", args: ["--version"], pattern: /ruby\s+(\d+\.\d+\.\d+)/ } },
  { name: "java", files: ["pom.xml", "build.gradle", "build.gradle.kts", ".java-version"], versionCommand: { cmd: "java", args: ["-version"], pattern: /version\s+"(\d+\.\d+[\.\d]*)"/ } },
  { name: "swift", files: ["Package.swift"], versionCommand: { cmd: "swift", args: ["--version"], pattern: /Swift\s+(\d+\.\d+)/ } },
  { name: "kotlin", files: ["build.gradle.kts", "settings.gradle.kts"] },
  { name: "cpp", files: ["CMakeLists.txt", "Makefile"] },
  { name: "deno", files: ["deno.json", "deno.jsonc", "deno.lock"], versionCommand: { cmd: "deno", args: ["--version"], pattern: /deno\s+(\d+\.\d+\.\d+)/ } },
  { name: "php", files: ["composer.json"], versionCommand: { cmd: "php", args: ["--version"], pattern: /PHP\s+(\d+\.\d+\.\d+)/ } },
  { name: "haskell", files: ["stack.yaml", "cabal.project"], extensions: [".cabal"], versionCommand: { cmd: "ghc", args: ["--version"], pattern: /(\d+\.\d+\.\d+)/ } },
  { name: "julia", files: ["Project.toml", "Manifest.toml"], versionCommand: { cmd: "julia", args: ["--version"], pattern: /julia\s+(\d+\.\d+\.\d+)/ } },
  { name: "lua", files: ["stylua.toml", ".luarc.json"], versionCommand: { cmd: "lua", args: ["-v"], pattern: /Lua\s+(\d+\.\d+)/ } },
  { name: "elixir", files: ["mix.exs"], versionCommand: { cmd: "elixir", args: ["--version"], pattern: /Elixir\s+(\d+\.\d+\.\d+)/ } },
  { name: "erlang", files: ["rebar.config", "erlang.mk"] },
  { name: "gleam", files: ["gleam.toml"], versionCommand: { cmd: "gleam", args: ["--version"], pattern: /gleam\s+(\d+\.\d+\.\d+)/ } },
  { name: "crystal", files: ["shard.yml"], versionCommand: { cmd: "crystal", args: ["--version"], pattern: /Crystal\s+(\d+\.\d+\.\d+)/ } },
  { name: "dart", files: ["pubspec.yaml"], versionCommand: { cmd: "dart", args: ["--version"], pattern: /Dart\s+SDK\s+version:\s+(\d+\.\d+\.\d+)/ } },
  { name: "nim", files: ["nim.cfg"], extensions: [".nimble"] },
  { name: "zig", files: ["build.zig"], versionCommand: { cmd: "zig", args: ["version"], pattern: /(\d+\.\d+\.\d+)/ } },
  { name: "ocaml", files: ["dune", "dune-project"], extensions: [".opam"] },
  { name: "clojure", files: ["project.clj", "deps.edn"] },
  { name: "scala", files: ["build.sbt", ".metals"], extensions: [".scala"] },
  { name: "perl", files: ["Makefile.PL", "cpanfile"] },
  { name: "r", files: ["DESCRIPTION"], extensions: [".Rproj"] },
  { name: "elm", files: ["elm.json"] },
  { name: "haxe", files: ["haxelib.json", ".haxerc"] },
  { name: "vagrant", files: ["Vagrantfile"] },
  { name: "terraform", files: ["main.tf", "variables.tf"], folders: [".terraform"] },
  { name: "helm", files: ["Chart.yaml", "helmfile.yaml"] },
  { name: "solidity", files: [], extensions: [".sol"] },
  { name: "fortran", files: ["fpm.toml"], extensions: [".f", ".f90", ".f95"] },
  { name: "mojo", files: [], extensions: [".mojo"] },
  { name: "red", files: [], extensions: [".red", ".reds"] },
  { name: "raku", files: ["META6.json"], extensions: [".raku", ".rakumod"] },
  { name: "purescript", files: ["spago.dhall", "spago.yaml"] },
  { name: "fennel", files: [], extensions: [".fnl"] },
  { name: "odin", files: [], extensions: [".odin"] },
  { name: "v", files: ["v.mod", "vpkg.json"], extensions: [".v"] },
  { name: "xmake", files: ["xmake.lua"] },
  { name: "gradle", files: ["build.gradle", "build.gradle.kts"], folders: ["gradle"] },
  { name: "cmake", files: ["CMakeLists.txt", "CMakeCache.txt"] },
  { name: "meson", files: ["meson.build"], env: "MESON_DEVENV" },
  { name: "nix", files: ["flake.nix", "shell.nix"], env: "IN_NIX_SHELL" },
  { name: "guix", files: [], env: "GUIX_ENVIRONMENT" },
  { name: "conda", files: [], env: "CONDA_DEFAULT_ENV" },
  { name: "pixi", files: ["pixi.toml", "pixi.lock"], env: "PIXI_ENVIRONMENT_NAME" },
  { name: "spack", files: [], env: "SPACK_ENV" },
  { name: "pulumi", files: ["Pulumi.yaml", "Pulumi.yml"] },
  { name: "typst", files: ["template.typ"], extensions: [".typ"] },
  { name: "buf", files: ["buf.yaml", "buf.gen.yaml", "buf.work.yaml"] },
  { name: "dotnet", files: ["global.json", "Directory.Build.props"], extensions: [".csproj", ".fsproj"] },
  { name: "cobol", files: [], extensions: [".cbl", ".cob"] }
];
var cache = new Map;
var CACHE_MAX = 32;
function fingerprint(cwd, def) {
  const parts = [];
  for (const f of def.files) {
    try {
      const stat = statSync2(join3(cwd, f));
      parts.push(`${f}:${stat.mtimeMs}`);
    } catch {}
  }
  if (def.extensions || def.folders) {
    try {
      const entries = readdirSync(cwd);
      parts.push(...entries.slice().sort());
    } catch {}
  }
  if (def.env && process.env[def.env]) {
    parts.push(`${def.env}=${process.env[def.env]}`);
  }
  return parts.join("\x00");
}
function matchesDef(cwd, def) {
  if (def.env && process.env[def.env])
    return true;
  if (def.files.some((f) => existsSync3(join3(cwd, f))))
    return true;
  if (def.folders?.some((f) => existsSync3(join3(cwd, f))))
    return true;
  if (def.extensions) {
    try {
      const entries = readdirSync(cwd);
      if (entries.some((e) => def.extensions.some((ext) => e.endsWith(ext))))
        return true;
    } catch {}
  }
  return false;
}
async function fetchVersion(def, cwd) {
  if (!def.versionCommand)
    return;
  try {
    const { stdout, stderr } = await execFileAsync2(def.versionCommand.cmd, def.versionCommand.args ?? [], {
      cwd,
      timeout: VERSION_TIMEOUT_MS,
      maxBuffer: 64 * 1024
    });
    const output = `${stdout}
${stderr}`;
    if (def.versionCommand.pattern) {
      const match = output.match(def.versionCommand.pattern);
      return match?.[1];
    }
    return output.trim() || undefined;
  } catch {
    return;
  }
}
async function readRuntimeInfo(cwd) {
  for (const def of RUNTIMES) {
    if (!matchesDef(cwd, def))
      continue;
    const fp = fingerprint(cwd, def);
    const cacheKey = `${cwd}\x00${def.name}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.fingerprint === fp) {
      return cached.runtime;
    }
    for (const key of cache.keys()) {
      if (key === cacheKey || key.startsWith(`${cwd}\x00`))
        cache.delete(key);
    }
    const version = await fetchVersion(def, cwd);
    const info = {
      name: def.name,
      version
    };
    cache.set(cacheKey, { fingerprint: fp, runtime: info });
    while (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined)
        break;
      cache.delete(oldest);
    }
    return info;
  }
  return null;
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/session-lifecycle.ts
class SessionLifecycle {
  current = 0;
  shutDown = false;
  start() {
    this.current++;
    this.shutDown = false;
  }
  shutdown() {
    this.shutDown = true;
  }
  isCurrent(generation) {
    if (this.shutDown)
      return false;
    if (generation === undefined)
      return true;
    return generation === this.current;
  }
  currentGeneration() {
    return this.current;
  }
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/settings-command.ts
import {
  Box,
  getKeybindings,
  getSelectPageIndex,
  Key,
  matchesKey,
  SelectList,
  Text,
  truncateToWidth as truncateToWidth5,
  visibleWidth as visibleWidth6
} from "@earendil-works/pi-tui";
var TABS = ["features", "icons", "segments", "telemetry"];
var COPY = {
  en: {
    title: "Open TUI Settings",
    tabs: { features: "General", icons: "Appearance", segments: "Footer", telemetry: "Telemetry" },
    sections: {
      extension: "Extension",
      interface: "Interface",
      messages: "Messages & tools",
      footer: "Footer",
      icons: "Icons",
      editor: "Editor",
      location: "Location",
      git: "Git",
      runtime: "Runtime",
      usage: "Usage",
      other: "Other",
      measurements: "Measurements"
    },
    hint: "Tab/Shift+Tab/\u2190/\u2192: tabs \xB7 \u2191/\u2193: move \xB7 Enter/Space: change \xB7 Esc/q: close",
    labels: {
      enabled: "Enabled",
      header: "Override header",
      inlineFooter: "Footer in editor border",
      copyButtons: "Copy buttons",
      thinkingPeek: "Thinking peek",
      toolView: "Tool view",
      extensionTools: "Compact extension tools",
      language: "Language",
      cursorStyle: "Cursor style",
      iconMode: "Icon mode",
      cwd: "CWD",
      hostname: "Hostname",
      sessionName: "Session name",
      gitBranch: "Git branch",
      gitStatus: "Git status",
      gitCommit: "Git tag (detached HEAD)",
      runtime: "Project runtime",
      context: "Context usage",
      tokens: "Session tokens",
      cost: "Session cost",
      extensionStatuses: "Extension status line",
      extensionSegments: "Extension footer segments",
      capitalizeProviderName: "Capitalize provider name",
      nerdIconSpacing: "Extra space after Nerd icons",
      liveTps: "Live TPS",
      totalDuration: "Total duration",
      tokenCounts: "Run tokens",
      stallDetails: "Stall details",
      costRate: "Price per 1M tokens"
    },
    values: {
      on: "On",
      off: "Off",
      thinkingPeek: { off: "Off", one: "1 line", two: "2 lines" },
      toolView: { native: "Native", compact: "Compact" },
      languages: { en: "English", zh: "\u7B80\u4F53\u4E2D\u6587" },
      cursorStyles: { block: "Block", bar: "Bar", underline: "Underline" },
      icons: { auto: "Auto", nerd: "Nerd", unicode: "Unicode", ascii: "ASCII" }
    }
  },
  zh: {
    title: "Open TUI \u8BBE\u7F6E",
    tabs: { features: "\u5E38\u89C4", icons: "\u5916\u89C2", segments: "\u5E95\u680F", telemetry: "\u9065\u6D4B" },
    sections: {
      extension: "\u6269\u5C55",
      interface: "\u754C\u9762",
      messages: "\u6D88\u606F\u4E0E\u5DE5\u5177",
      footer: "\u5E95\u680F",
      icons: "\u56FE\u6807",
      editor: "\u8F93\u5165\u6846",
      location: "\u4F4D\u7F6E",
      git: "Git",
      runtime: "\u8FD0\u884C\u73AF\u5883",
      usage: "\u7528\u91CF",
      other: "\u5176\u4ED6",
      measurements: "\u6D4B\u91CF\u6307\u6807"
    },
    hint: "Tab/Shift+Tab/\u2190/\u2192\uFF1A\u5207\u9875 \xB7 \u2191/\u2193\uFF1A\u79FB\u52A8 \xB7 Enter/Space\uFF1A\u66F4\u6539 \xB7 Esc/q\uFF1A\u5173\u95ED",
    labels: {
      enabled: "\u542F\u7528",
      header: "\u8986\u76D6\u9876\u90E8\u4FE1\u606F\u680F",
      inlineFooter: "\u5E95\u680F\u5D4C\u5165\u8F93\u5165\u6846",
      copyButtons: "\u590D\u5236\u6309\u94AE",
      thinkingPeek: "\u601D\u8003\u9884\u89C8",
      toolView: "\u5DE5\u5177\u89C6\u56FE",
      extensionTools: "\u7D27\u51D1\u663E\u793A\u6269\u5C55\u5DE5\u5177",
      language: "\u8BED\u8A00",
      cursorStyle: "\u5149\u6807\u6837\u5F0F",
      iconMode: "\u56FE\u6807\u6A21\u5F0F",
      cwd: "\u5F53\u524D\u76EE\u5F55",
      hostname: "\u4E3B\u673A\u540D",
      sessionName: "\u4F1A\u8BDD\u540D",
      gitBranch: "Git \u5206\u652F",
      gitStatus: "Git \u72B6\u6001",
      gitCommit: "Git \u6807\u7B7E\uFF08\u5206\u79BB HEAD\uFF09",
      runtime: "\u9879\u76EE\u8FD0\u884C\u73AF\u5883",
      context: "\u4E0A\u4E0B\u6587\u7528\u91CF",
      tokens: "\u4F1A\u8BDD Token",
      cost: "\u4F1A\u8BDD\u8D39\u7528",
      extensionStatuses: "\u6269\u5C55\u72B6\u6001\u884C",
      extensionSegments: "\u6269\u5C55\u5E95\u680F\u7247\u6BB5",
      capitalizeProviderName: "\u63D0\u4F9B\u5546\u540D\u79F0\u9996\u5B57\u6BCD\u5927\u5199",
      nerdIconSpacing: "Nerd \u56FE\u6807\u540E\u989D\u5916\u7559\u7A7A",
      liveTps: "\u5B9E\u65F6 TPS",
      totalDuration: "\u603B\u8017\u65F6",
      tokenCounts: "\u5355\u6B21\u8FD0\u884C Token",
      stallDetails: "\u505C\u987F\u8BE6\u60C5",
      costRate: "\u6BCF\u767E\u4E07 Token \u5355\u4EF7"
    },
    values: {
      on: "\u5F00\u542F",
      off: "\u5173\u95ED",
      thinkingPeek: { off: "\u5173\u95ED", one: "\u5355\u884C", two: "\u53CC\u884C" },
      toolView: { native: "\u539F\u751F", compact: "\u7D27\u51D1" },
      languages: { en: "English", zh: "\u7B80\u4F53\u4E2D\u6587" },
      cursorStyles: { block: "\u5757", bar: "\u7AD6\u7EBF", underline: "\u4E0B\u5212\u7EBF" },
      icons: { auto: "\u81EA\u52A8", nerd: "Nerd", unicode: "Unicode", ascii: "ASCII" }
    }
  }
};
function formatThinkingPeekLines(lines, copy) {
  const values = [copy.values.thinkingPeek.off, copy.values.thinkingPeek.one, copy.values.thinkingPeek.two];
  return values[lines] ?? values[0];
}
function toggleSetting(config, key) {
  return {
    ...config,
    footerSegments: {
      ...config.footerSegments,
      [key]: !config.footerSegments[key]
    }
  };
}
function cycleIconMode(config) {
  const order = ["auto", "nerd", "unicode", "ascii"];
  const currentIdx = order.indexOf(config.icons.mode);
  const next = order[(currentIdx + 1) % order.length];
  return { ...config, icons: { mode: next } };
}
function toggleEnabled(config) {
  return { ...config, enabled: !config.enabled };
}
function toggleLanguage(config) {
  return { ...config, settingsLanguage: config.settingsLanguage === "en" ? "zh" : "en" };
}
function cycleCursorStyle(config) {
  const order = ["block", "bar", "underline"];
  const currentIdx = order.indexOf(config.cursorStyle);
  const next = order[(currentIdx + 1) % order.length];
  return { ...config, cursorStyle: next };
}
function toggleTelemetry(config, key) {
  return {
    ...config,
    telemetry: { ...config.telemetry, [key]: !config.telemetry[key] }
  };
}
function cycleThinkingPeek(config) {
  const next = [1, 2, 0][config.thinkingPeek.lines] ?? 0;
  return {
    ...config,
    thinkingPeek: { lines: next }
  };
}
function buildFeaturesItems(config, copy) {
  const flag = (value) => value ? copy.values.on : copy.values.off;
  return [
    {
      label: copy.sections.extension,
      items: [{ id: "enabled", label: copy.labels.enabled, currentValue: flag(config.enabled) }]
    },
    {
      label: copy.sections.interface,
      items: [
        { id: "header", label: copy.labels.header, currentValue: flag(config.header) },
        { id: "settingsLanguage", label: copy.labels.language, currentValue: copy.values.languages[config.settingsLanguage] }
      ]
    },
    {
      label: copy.sections.messages,
      items: [
        { id: "thinkingPeek", label: copy.labels.thinkingPeek, currentValue: formatThinkingPeekLines(config.thinkingPeek.lines, copy) },
        { id: "copyButtons", label: copy.labels.copyButtons, currentValue: flag(config.copyButtons) },
        { id: "toolView", label: copy.labels.toolView, currentValue: copy.values.toolView[config.toolView.mode] },
        ...config.toolView.mode === "compact" ? [
          { id: "extensionTools", label: `  ${copy.labels.extensionTools}`, currentValue: flag(config.toolView.extensionTools) }
        ] : []
      ]
    },
    {
      label: copy.sections.footer,
      items: [{ id: "inlineFooter", label: copy.labels.inlineFooter, currentValue: flag(config.inlineFooter) }]
    }
  ];
}
function buildIconsItems(config, copy) {
  return [
    {
      label: copy.sections.icons,
      items: [{ id: "mode", label: copy.labels.iconMode, currentValue: copy.values.icons[config.icons.mode] }]
    },
    {
      label: copy.sections.editor,
      items: [{ id: "cursorStyle", label: copy.labels.cursorStyle, currentValue: copy.values.cursorStyles[config.cursorStyle] }]
    }
  ];
}
function buildSegmentsItems(config, copy) {
  const segs = config.footerSegments;
  const flag = (value) => value ? copy.values.on : copy.values.off;
  return [
    {
      label: copy.sections.location,
      items: [
        { id: "cwd", label: copy.labels.cwd, currentValue: flag(segs.cwd) },
        { id: "hostname", label: copy.labels.hostname, currentValue: flag(segs.hostname) },
        { id: "sessionName", label: copy.labels.sessionName, currentValue: flag(segs.sessionName) }
      ]
    },
    {
      label: copy.sections.git,
      items: [
        { id: "gitBranch", label: copy.labels.gitBranch, currentValue: flag(segs.gitBranch) },
        { id: "gitStatus", label: copy.labels.gitStatus, currentValue: flag(segs.gitStatus) },
        { id: "gitCommit", label: copy.labels.gitCommit, currentValue: flag(segs.gitCommit) }
      ]
    },
    {
      label: copy.sections.runtime,
      items: [
        { id: "runtime", label: copy.labels.runtime, currentValue: flag(segs.runtime) },
        { id: "context", label: copy.labels.context, currentValue: flag(segs.context) },
        { id: "liveTps", label: copy.labels.liveTps, currentValue: flag(segs.liveTps) }
      ]
    },
    {
      label: copy.sections.usage,
      items: [
        { id: "tokens", label: copy.labels.tokens, currentValue: flag(segs.tokens) },
        { id: "cost", label: copy.labels.cost, currentValue: flag(segs.cost) }
      ]
    },
    {
      label: copy.sections.other,
      items: [
        { id: "extensionStatuses", label: copy.labels.extensionStatuses, currentValue: flag(segs.extensionStatuses) },
        { id: "extensionSegments", label: copy.labels.extensionSegments, currentValue: flag(segs.extensionSegments) },
        { id: "capitalizeProviderName", label: copy.labels.capitalizeProviderName, currentValue: flag(segs.capitalizeProviderName) },
        { id: "nerdIconSpacing", label: copy.labels.nerdIconSpacing, currentValue: flag(segs.nerdIconSpacing) }
      ]
    }
  ];
}
function buildTelemetryItems(config, copy) {
  const telemetry = config.telemetry;
  const flag = (value) => value ? copy.values.on : copy.values.off;
  return [
    { items: [{ id: "enabled", label: copy.labels.enabled, currentValue: flag(telemetry.enabled) }] },
    {
      label: copy.sections.measurements,
      items: [
        { id: "tps", label: "TPS", currentValue: flag(telemetry.tps) },
        { id: "ttft", label: "TTFT", currentValue: flag(telemetry.ttft) },
        { id: "duration", label: copy.labels.totalDuration, currentValue: flag(telemetry.duration) },
        { id: "tokens", label: copy.labels.tokenCounts, currentValue: flag(telemetry.tokens) },
        { id: "stalls", label: copy.labels.stallDetails, currentValue: flag(telemetry.stalls) },
        { id: "cost", label: copy.labels.costRate, currentValue: flag(telemetry.cost) }
      ]
    }
  ];
}
function buildItems(tab, config) {
  const copy = COPY[config.settingsLanguage];
  let groups;
  switch (tab) {
    case "features":
      groups = buildFeaturesItems(config, copy);
      break;
    case "icons":
      groups = buildIconsItems(config, copy);
      break;
    case "segments":
      groups = buildSegmentsItems(config, copy);
      break;
    case "telemetry":
      groups = buildTelemetryItems(config, copy);
      break;
  }
  return groups.flatMap((group) => [
    ...group.label ? [
      { kind: "header", label: group.label }
    ] : [],
    ...group.items.map((item) => ({ kind: "setting", item }))
  ]);
}
function handleSettingChange(tab, itemId, config) {
  if (tab === "features") {
    if (itemId === "enabled")
      return toggleEnabled(config);
    if (itemId === "header")
      return { ...config, header: !config.header };
    if (itemId === "inlineFooter")
      return { ...config, inlineFooter: !config.inlineFooter };
    if (itemId === "copyButtons")
      return { ...config, copyButtons: !config.copyButtons };
    if (itemId === "settingsLanguage")
      return toggleLanguage(config);
    if (itemId === "thinkingPeek")
      return cycleThinkingPeek(config);
    if (itemId === "toolView") {
      return { ...config, toolView: { ...config.toolView, mode: config.toolView.mode === "native" ? "compact" : "native" } };
    }
    if (itemId === "extensionTools") {
      return { ...config, toolView: { ...config.toolView, extensionTools: !config.toolView.extensionTools } };
    }
  }
  if (tab === "icons") {
    if (itemId === "mode")
      return cycleIconMode(config);
    if (itemId === "cursorStyle")
      return cycleCursorStyle(config);
  }
  if (tab === "segments") {
    return toggleSetting(config, itemId);
  }
  if (tab === "telemetry") {
    return toggleTelemetry(config, itemId);
  }
  return config;
}

class SectionedSettingsList {
  capturesViewportInput = true;
  onSelect;
  onCancel;
  onSelectionChange;
  selectList;
  items;
  rows;
  theme;
  visibleRows;
  showScrollInfo;
  pressedItemId;
  constructor(rows, availableRows, width, theme) {
    this.rows = rows;
    this.theme = theme;
    const compact = width <= 60;
    this.items = rows.flatMap((row) => {
      if (row.kind !== "setting")
        return [];
      const item = row.item;
      return [{
        value: item.id,
        label: compact ? `${truncateToWidth5(item.label, Math.max(0, width - 8 - visibleWidth6(item.currentValue)))}: ${item.currentValue}` : item.label,
        description: compact ? undefined : item.currentValue
      }];
    });
    this.showScrollInfo = rows.length > availableRows && availableRows > 1;
    this.visibleRows = Math.max(1, availableRows - (this.showScrollInfo ? 1 : 0));
    this.selectList = new SelectList(this.items, this.items.length, {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t)
    });
    this.selectList.onSelect = (item) => this.onSelect?.(item);
    this.selectList.onCancel = () => this.onCancel?.();
    this.selectList.onSelectionChange = (item) => this.onSelectionChange?.(item);
  }
  getSelectedItem() {
    return this.selectList.getSelectedItem();
  }
  selectItem(itemId) {
    const index = this.items.findIndex((item) => item.value === itemId);
    if (index >= 0)
      this.selectList.setSelectedIndex(index);
  }
  selectedRowIndex() {
    const selected = this.getSelectedItem();
    return this.rows.findIndex((row) => row.kind === "setting" && row.item.id === selected?.value);
  }
  visibleRange() {
    const start = Math.max(0, Math.min(this.selectedRowIndex() - Math.floor(this.visibleRows / 2), this.rows.length - this.visibleRows));
    return { start, end: Math.min(start + this.visibleRows, this.rows.length) };
  }
  render(width) {
    const settingLines = this.selectList.render(width);
    let itemIndex = 0;
    const lines = this.rows.map((row) => {
      if (row.kind === "setting")
        return settingLines[itemIndex++];
      const label = truncateToWidth5(`  \u2500\u2500${row.label} `, width, "");
      return this.theme.fg("dim", label + "\u2500".repeat(Math.max(0, width - visibleWidth6(label))));
    });
    const { start, end } = this.visibleRange();
    const visible = lines.slice(start, end);
    if (this.showScrollInfo) {
      visible.push(this.theme.fg("dim", truncateToWidth5(`  (${this.selectedRowIndex() + 1}/${this.rows.length})`, width, "")));
    }
    return visible;
  }
  handleInput(data) {
    this.pressedItemId = undefined;
    const kb = getKeybindings();
    const pageIndex = getSelectPageIndex(kb, data, this.selectedRowIndex(), this.rows.length, this.visibleRows);
    if (pageIndex === undefined) {
      this.selectList.handleInput(data);
      return;
    }
    const direction = kb.matches(data, "tui.select.pageUp") ? -1 : 1;
    let index = pageIndex;
    while (index >= 0 && index < this.rows.length && this.rows[index]?.kind !== "setting")
      index += direction;
    if (index < 0 || index >= this.rows.length) {
      index = pageIndex;
      while (index >= 0 && index < this.rows.length && this.rows[index]?.kind !== "setting")
        index -= direction;
    }
    const row = this.rows[index];
    if (row?.kind === "setting") {
      this.selectItem(row.item.id);
      const selected = this.getSelectedItem();
      if (selected)
        this.onSelectionChange?.(selected);
    }
  }
  handleMouse(event) {
    if (event.type === "wheel") {
      this.pressedItemId = undefined;
      return this.selectList.handleMouse(event);
    }
    if (event.button !== "left" || event.type !== "press" && event.type !== "click")
      return;
    const { start, end } = this.visibleRange();
    const rowIndex = start + event.y;
    const row = rowIndex >= start && rowIndex < end ? this.rows[rowIndex] : undefined;
    if (row?.kind !== "setting") {
      this.pressedItemId = undefined;
      return { handled: true, render: false };
    }
    const itemId = event.type === "click" ? this.pressedItemId ?? row.item.id : row.item.id;
    this.pressedItemId = event.type === "press" ? itemId : undefined;
    this.selectItem(itemId);
    const selected = this.getSelectedItem();
    if (selected) {
      this.onSelectionChange?.(selected);
      if (event.type === "click")
        this.onSelect?.(selected);
    }
    return { handled: true, focus: true, render: true };
  }
  invalidate() {
    this.selectList.invalidate();
  }
}

class SettingsUi {
  tab = "features";
  config;
  selectList;
  selectedItemByTab = {};
  container;
  tui;
  theme;
  onChange;
  onClose;
  layoutWidth;
  layoutRows;
  cachedLines;
  constructor(tui, theme, config, onChange, onClose) {
    this.tui = tui;
    this.theme = theme;
    this.config = config;
    this.onChange = onChange;
    this.onClose = onClose;
    this.container = new Box(1, 1, (s) => theme.bg("customMessageBg", s));
    this.rebuild();
  }
  applySetting(itemId) {
    this.selectedItemByTab[this.tab] = itemId;
    this.config = handleSettingChange(this.tab, itemId, this.config);
    this.onChange(this.config);
    this.rebuild(itemId);
  }
  switchTab(offset) {
    const idx = TABS.indexOf(this.tab);
    this.tab = TABS[(idx + offset + TABS.length) % TABS.length];
    this.rebuild();
  }
  rebuild(preferredItemId = this.selectedItemByTab[this.tab], width = this.layoutWidth ?? Math.min(80, this.tui.terminal.columns)) {
    this.layoutWidth = width;
    this.layoutRows = this.tui.terminal.rows;
    const copy = COPY[this.config.settingsLanguage];
    this.container.clear();
    this.container.addChild(new Text(this.theme.bold(this.theme.fg("accent", copy.title)), 1, 0));
    const tabBar = TABS.map((tab) => {
      const active = tab === this.tab;
      const label = active ? `[${copy.tabs[tab]}]` : ` ${copy.tabs[tab]} `;
      return active ? this.theme.fg("accent", label) : this.theme.fg("dim", label);
    }).join(" ");
    this.container.addChild(new Text(tabBar, 1, 0));
    this.container.addChild(new Text(this.theme.fg("dim", copy.hint), 1, 0));
    const availableRows = this.layoutRows - this.container.render(width).length;
    this.selectList = new SectionedSettingsList(buildItems(this.tab, this.config), availableRows, width, this.theme);
    this.selectList.selectItem(preferredItemId);
    this.selectedItemByTab[this.tab] = this.selectList.getSelectedItem()?.value;
    this.selectList.onSelectionChange = (item) => {
      this.selectedItemByTab[this.tab] = item.value;
    };
    this.selectList.onSelect = (item) => {
      this.applySetting(item.value);
    };
    this.selectList.onCancel = () => {
      this.onClose();
    };
    this.container.addChild(this.selectList);
    this.cachedLines = undefined;
  }
  handleInput(data) {
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
      this.switchTab(1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
      this.switchTab(-1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, "q")) {
      this.onClose();
      return;
    }
    if (matchesKey(data, Key.space) || data === " ") {
      const selected = this.selectList.getSelectedItem();
      if (selected)
        this.applySetting(selected.value);
    } else {
      this.selectList.handleInput?.(data);
    }
    this.invalidate();
  }
  handleMouse(event) {
    const result = this.container.handleMouse(event);
    if (result?.handled && result.render !== false)
      this.invalidate();
    return result ? { handled: result.handled, render: result.render } : undefined;
  }
  render(width) {
    if (width !== this.layoutWidth || this.tui.terminal.rows !== this.layoutRows) {
      this.rebuild(undefined, width);
    }
    if (this.cachedLines)
      return this.cachedLines;
    this.cachedLines = this.container.render(width);
    return this.cachedLines;
  }
  invalidate() {
    this.cachedLines = undefined;
    this.container.invalidate();
  }
}
function registerSettingsCommand(pi, hooks) {
  pi.registerCommand("open-tui", {
    description: "Open the open-tui settings UI",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI)
        return;
      await ctx.ui.custom((tui, theme, _kb, done) => {
        const ui = new SettingsUi(tui, theme, hooks.getConfig(), (config) => hooks.onConfigChanged(config), () => done(undefined));
        return {
          capturesViewportInput: true,
          render: (w) => ui.render(w),
          invalidate: () => ui.invalidate(),
          handleInput: (data) => {
            ui.handleInput(data);
            tui.requestRender();
          },
          handleMouse: (event) => {
            const result = ui.handleMouse(event);
            if (result?.handled && result.render !== false)
              tui.requestRender();
            return result;
          }
        };
      }, { overlay: true });
      hooks.onOverlayClosed?.();
    }
  });
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/telemetry.ts
var STALL_THRESHOLD_MS = 1000;
var LIVE_TPS_WINDOW_MS = 2000;
var CJK_CHARS = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;
function isAssistantMessage(message) {
  return message.role === "assistant";
}
function estimateDeltaTokens(delta) {
  const cjk = delta.match(CJK_CHARS)?.length ?? 0;
  return cjk + (delta.length - cjk) / 4;
}
function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

class TurnTelemetryTracker {
  now;
  turn;
  agentStartMs = null;
  agentTurns = [];
  lastLiveTps = null;
  constructor(now = () => performance.now()) {
    this.now = now;
  }
  getLiveTps() {
    const tps = this.windowTps();
    if (tps !== null)
      return { tps, stale: false };
    return this.lastLiveTps === null ? null : { tps: this.lastLiveTps, stale: true };
  }
  windowTps() {
    const samples = this.turn?.currentMessage?.samples;
    if (!samples || samples.length < 2)
      return null;
    const first = samples[0];
    const now = this.now();
    if (now - samples.at(-1).ms >= LIVE_TPS_WINDOW_MS)
      return 0;
    const elapsedMs = now - first.ms;
    if (elapsedMs <= 0)
      return null;
    return round((samples.at(-1).tokens - first.tokens) / (elapsedMs / 1000), 1);
  }
  handle(event) {
    switch (event.type) {
      case "agent_start":
        if (this.agentStartMs === null) {
          this.agentStartMs = this.now();
          this.agentTurns = [];
          this.lastLiveTps = null;
        }
        return;
      case "agent_settled":
        return this.endAgent();
      case "turn_start":
        this.startTurn();
        return;
      case "message_start":
        this.startMessage(event.message);
        return;
      case "message_update":
        this.updateMessage(event);
        return;
      case "message_end":
        this.endMessage(event.message);
        return;
      case "tool_execution_start":
        return;
      case "turn_end":
        return this.endTurnAndCollect();
    }
  }
  startTurn() {
    this.turn = {
      startMs: this.now(),
      firstTokenMs: null,
      currentMessage: null,
      messages: [],
      generationMs: 0,
      stallMs: 0,
      stallCount: 0
    };
  }
  startMessage(message) {
    if (!this.turn || !isAssistantMessage(message))
      return;
    const now = this.now();
    this.turn.currentMessage = {
      lastUpdateMs: now,
      firstOutputMs: null,
      inStall: false,
      estimatedTokens: 0,
      samples: []
    };
  }
  updateMessage(event) {
    const turn = this.turn;
    const current = turn?.currentMessage;
    const streamEvent = event.assistantMessageEvent;
    if (streamEvent.type !== "text_delta" && streamEvent.type !== "thinking_delta" && streamEvent.type !== "toolcall_delta")
      return;
    if (streamEvent.delta.length === 0)
      return;
    const message = event.message;
    if (!turn || !current || !isAssistantMessage(message))
      return;
    const now = this.now();
    current.estimatedTokens += estimateDeltaTokens(streamEvent.delta);
    const samples = current.samples;
    samples.push({ ms: now, tokens: current.estimatedTokens });
    while (samples.length > 2 && samples[1].ms <= now - LIVE_TPS_WINDOW_MS)
      samples.shift();
    if (current.firstOutputMs === null) {
      current.firstOutputMs = now;
      turn.firstTokenMs ??= now;
      current.lastUpdateMs = now;
      return;
    }
    const gap = now - current.lastUpdateMs;
    if (gap >= STALL_THRESHOLD_MS) {
      if (!current.inStall)
        turn.stallCount++;
      current.inStall = true;
      turn.stallMs += gap;
    } else {
      current.inStall = false;
    }
    current.lastUpdateMs = now;
  }
  endMessage(message) {
    const turn = this.turn;
    if (!turn || !isAssistantMessage(message))
      return;
    const current = turn.currentMessage;
    if (current) {
      const endMs = this.now();
      turn.generationMs = endMs - turn.startMs;
      if (current.firstOutputMs === null && finiteOrZero(message.usage?.output) > 0) {
        turn.firstTokenMs ??= endMs;
      }
      this.lastLiveTps = this.windowTps() ?? this.lastLiveTps;
      turn.currentMessage = null;
    }
    turn.messages.push(message);
  }
  endTurnAndCollect() {
    const telemetry = this.endTurn();
    if (telemetry && this.agentStartMs !== null)
      this.agentTurns.push(telemetry);
    return telemetry;
  }
  endTurn() {
    const turn = this.turn;
    this.turn = undefined;
    if (!turn || turn.firstTokenMs === null || turn.messages.length === 0)
      return;
    const endMs = this.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let totalTokens = 0;
    let costUsd = 0;
    for (const message of turn.messages) {
      inputTokens += finiteOrZero(message.usage?.input) + finiteOrZero(message.usage?.cacheWrite);
      outputTokens += finiteOrZero(message.usage?.output);
      cacheReadTokens += finiteOrZero(message.usage?.cacheRead);
      totalTokens += finiteOrZero(message.usage?.totalTokens);
      costUsd += finiteOrZero(message.usage?.cost?.total);
    }
    const measurementMs = outputTokens > 0 && turn.generationMs > 0 ? turn.generationMs : null;
    const tps = measurementMs === null ? null : round(outputTokens / (measurementMs / 1000), 1);
    const validCost = Number.isFinite(costUsd) && costUsd > 0;
    const validTokens = Number.isFinite(totalTokens) && totalTokens > 0;
    return {
      tps,
      ttftMs: turn.firstTokenMs - turn.startMs,
      totalMs: endMs - turn.startMs,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      stallMs: turn.stallMs,
      stallCount: turn.stallCount,
      rateUsdPerMTokens: validCost && validTokens ? round(costUsd / (totalTokens / 1e6), 2) : null,
      generationMs: turn.generationMs,
      totalTokens,
      costUsd: validCost ? costUsd : 0,
      measurementMs
    };
  }
  endAgent() {
    const startMs = this.agentStartMs;
    const turns = this.agentTurns;
    this.agentStartMs = null;
    this.agentTurns = [];
    this.lastLiveTps = null;
    if (startMs === null || turns.length === 0)
      return;
    const outputTokens = turns.reduce((sum, turn) => sum + turn.outputTokens, 0);
    const inputTokens = turns.reduce((sum, turn) => sum + turn.inputTokens, 0);
    const cacheReadTokens = turns.reduce((sum, turn) => sum + turn.cacheReadTokens, 0);
    const totalTokens = turns.reduce((sum, turn) => sum + turn.totalTokens, 0);
    const costUsd = turns.reduce((sum, turn) => sum + turn.costUsd, 0);
    const stallMs = turns.reduce((sum, turn) => sum + turn.stallMs, 0);
    const stallCount = turns.reduce((sum, turn) => sum + turn.stallCount, 0);
    const generationMs = turns.reduce((sum, turn) => sum + turn.generationMs, 0);
    const measurementMs = outputTokens > 0 && generationMs > 0 ? generationMs : null;
    const tps = measurementMs === null ? null : round(outputTokens / (measurementMs / 1000), 1);
    const validRate = costUsd > 0 && totalTokens > 0;
    return {
      tps,
      ttftMs: turns[0].ttftMs,
      totalMs: this.now() - startMs,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      stallMs,
      stallCount,
      rateUsdPerMTokens: validRate ? round(costUsd / (totalTokens / 1e6), 2) : null,
      generationMs,
      totalTokens,
      costUsd,
      measurementMs
    };
  }
}
function formatTurnDuration(ms) {
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : formatDuration(ms);
}
function formatTurnTelemetry(telemetry, theme, config, iconMode) {
  const glyphs = resolveGlyphs(iconMode);
  const parts = [];
  if (config.tps) {
    const value = telemetry.tps === null ? "\u2014" : `${telemetry.tps.toFixed(1)} tok/s`;
    parts.push(theme.fg(telemetry.tps === null ? "muted" : "accent", `${glyphs.speed} TPS ${value}`));
  }
  if (config.ttft) {
    parts.push(theme.fg("text", `${glyphs.latency} TTFT ${formatTurnDuration(telemetry.ttftMs)}`));
  }
  if (config.duration) {
    parts.push(theme.fg("success", `${glyphs.done} ${formatTurnDuration(telemetry.totalMs)}`));
  }
  if (config.tokens) {
    parts.push(theme.fg("accent", `${glyphs.input} ${formatInputBreakdown(telemetry.inputTokens, telemetry.cacheReadTokens)}`));
    parts.push(theme.fg("success", `${glyphs.output} ${fmtTokens(telemetry.outputTokens)}`));
  }
  if (config.stalls && telemetry.stallMs > 0) {
    parts.push(theme.fg("warning", `${glyphs.stall} stall ${telemetry.stallCount}x / ${formatTurnDuration(telemetry.stallMs)}`));
  }
  if (config.cost && telemetry.rateUsdPerMTokens !== null) {
    parts.push(theme.fg("warning", `${glyphs.cost} $${telemetry.rateUsdPerMTokens.toFixed(2)}/M`));
  }
  return parts.join(` ${theme.fg("dim", "|")} `);
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/tool-view.ts
import { homedir as homedir2 } from "os";
import { isAbsolute as isAbsolute3, relative as relative2, sep as sep2 } from "path";
import { Box as Box2, getCapabilities, getImageDimensions, imageFallback, Spacer, Text as Text2, truncateToWidth as truncateToWidth7, visibleWidth as visibleWidth8 } from "@earendil-works/pi-tui";

// stow_modules/main/dot-pi/agent/extensions/open-tui/tool-preview.ts
import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { backgroundAnsi, rgbColor, truncateToWidth as truncateToWidth6, visibleWidth as visibleWidth7 } from "@earendil-works/pi-tui";

// stow_modules/main/dot-pi/agent/extensions/open-tui/vendor/diff/base.js
class Diff {
  diff(oldStr, newStr, options = {}) {
    let callback;
    if (typeof options === "function") {
      callback = options;
      options = {};
    } else if ("callback" in options) {
      callback = options.callback;
    }
    const oldString = this.castInput(oldStr, options);
    const newString = this.castInput(newStr, options);
    const oldTokens = this.removeEmpty(this.tokenize(oldString, options));
    const newTokens = this.removeEmpty(this.tokenize(newString, options));
    return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
  }
  diffWithOptionsObj(oldTokens, newTokens, options, callback) {
    var _a;
    const done = (value) => {
      value = this.postProcess(value, options);
      if (callback) {
        setTimeout(function() {
          callback(value);
        }, 0);
        return;
      } else {
        return value;
      }
    };
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let editLength = 1;
    let maxEditLength = newLen + oldLen;
    if (options.maxEditLength != null) {
      maxEditLength = Math.min(maxEditLength, options.maxEditLength);
    }
    const maxExecutionTime = (_a = options.timeout) !== null && _a !== undefined ? _a : Infinity;
    const abortAfterTimestamp = Date.now() + maxExecutionTime;
    const bestPath = [{ oldPos: -1, lastComponent: undefined }];
    let newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
    if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
      return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
    }
    let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
    const execEditLength = () => {
      for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength);diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
        let basePath;
        const removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
        if (removePath) {
          bestPath[diagonalPath - 1] = undefined;
        }
        let canAdd = false;
        if (addPath) {
          const addPathNewPos = addPath.oldPos - diagonalPath;
          canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
        }
        const canRemove = removePath && removePath.oldPos + 1 < oldLen;
        if (!canAdd && !canRemove) {
          bestPath[diagonalPath] = undefined;
          continue;
        }
        if (!canRemove || canAdd && removePath.oldPos < addPath.oldPos) {
          basePath = this.addToPath(addPath, true, false, 0, options);
        } else {
          basePath = this.addToPath(removePath, false, true, 1, options);
        }
        newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
        if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
          return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
        } else {
          bestPath[diagonalPath] = basePath;
          if (basePath.oldPos + 1 >= oldLen) {
            maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
          }
          if (newPos + 1 >= newLen) {
            minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
          }
        }
      }
      editLength++;
    };
    if (callback) {
      (function exec() {
        setTimeout(function() {
          if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
            return callback(undefined);
          }
          if (!execEditLength()) {
            exec();
          }
        }, 0);
      })();
    } else {
      while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
        const ret = execEditLength();
        if (ret) {
          return ret;
        }
      }
    }
  }
  addToPath(path, added, removed, oldPosInc, options) {
    const last = path.lastComponent;
    if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) {
      return {
        oldPos: path.oldPos + oldPosInc,
        lastComponent: { count: last.count + 1, added, removed, previousComponent: last.previousComponent }
      };
    } else {
      return {
        oldPos: path.oldPos + oldPosInc,
        lastComponent: { count: 1, added, removed, previousComponent: last }
      };
    }
  }
  extractCommon(basePath, newTokens, oldTokens, diagonalPath, options) {
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
    while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
      newPos++;
      oldPos++;
      commonCount++;
      if (options.oneChangePerToken) {
        basePath.lastComponent = { count: 1, previousComponent: basePath.lastComponent, added: false, removed: false };
      }
    }
    if (commonCount && !options.oneChangePerToken) {
      basePath.lastComponent = { count: commonCount, previousComponent: basePath.lastComponent, added: false, removed: false };
    }
    basePath.oldPos = oldPos;
    return newPos;
  }
  equals(left, right, options) {
    if (options.comparator) {
      return options.comparator(left, right);
    } else {
      return left === right || !!options.ignoreCase && left.toLowerCase() === right.toLowerCase();
    }
  }
  removeEmpty(array) {
    const ret = [];
    for (let i = 0;i < array.length; i++) {
      if (array[i]) {
        ret.push(array[i]);
      }
    }
    return ret;
  }
  castInput(value, options) {
    return value;
  }
  tokenize(value, options) {
    return Array.from(value);
  }
  join(chars) {
    return chars.join("");
  }
  postProcess(changeObjects, options) {
    return changeObjects;
  }
  get useLongestToken() {
    return false;
  }
  buildValues(lastComponent, newTokens, oldTokens) {
    const components = [];
    let nextComponent;
    while (lastComponent) {
      components.push(lastComponent);
      nextComponent = lastComponent.previousComponent;
      delete lastComponent.previousComponent;
      lastComponent = nextComponent;
    }
    components.reverse();
    const componentLen = components.length;
    let componentPos = 0, newPos = 0, oldPos = 0;
    for (;componentPos < componentLen; componentPos++) {
      const component = components[componentPos];
      if (!component.removed) {
        if (!component.added && this.useLongestToken) {
          let value = newTokens.slice(newPos, newPos + component.count);
          value = value.map(function(value, i) {
            const oldValue = oldTokens[oldPos + i];
            return oldValue.length > value.length ? oldValue : value;
          });
          component.value = this.join(value);
        } else {
          component.value = this.join(newTokens.slice(newPos, newPos + component.count));
        }
        newPos += component.count;
        if (!component.added) {
          oldPos += component.count;
        }
      } else {
        component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
        oldPos += component.count;
      }
    }
    return components;
  }
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/vendor/util/string.js
function longestCommonPrefix(str1, str2) {
  let i;
  for (i = 0;i < str1.length && i < str2.length; i++) {
    if (str1[i] != str2[i]) {
      return str1.slice(0, i);
    }
  }
  return str1.slice(0, i);
}
function longestCommonSuffix(str1, str2) {
  let i;
  if (!str1 || !str2 || str1[str1.length - 1] != str2[str2.length - 1]) {
    return "";
  }
  for (i = 0;i < str1.length && i < str2.length; i++) {
    if (str1[str1.length - (i + 1)] != str2[str2.length - (i + 1)]) {
      return str1.slice(-i);
    }
  }
  return str1.slice(-i);
}
function replacePrefix(string, oldPrefix, newPrefix) {
  if (string.slice(0, oldPrefix.length) != oldPrefix) {
    throw Error(`string ${JSON.stringify(string)} doesn't start with prefix ${JSON.stringify(oldPrefix)}; this is a bug`);
  }
  return newPrefix + string.slice(oldPrefix.length);
}
function replaceSuffix(string, oldSuffix, newSuffix) {
  if (!oldSuffix) {
    return string + newSuffix;
  }
  if (string.slice(-oldSuffix.length) != oldSuffix) {
    throw Error(`string ${JSON.stringify(string)} doesn't end with suffix ${JSON.stringify(oldSuffix)}; this is a bug`);
  }
  return string.slice(0, -oldSuffix.length) + newSuffix;
}
function removePrefix(string, oldPrefix) {
  return replacePrefix(string, oldPrefix, "");
}
function removeSuffix(string, oldSuffix) {
  return replaceSuffix(string, oldSuffix, "");
}
function maximumOverlap(string1, string2) {
  return string2.slice(0, overlapCount(string1, string2));
}
function overlapCount(a, b) {
  let startA = 0;
  if (a.length > b.length) {
    startA = a.length - b.length;
  }
  let endB = b.length;
  if (a.length < b.length) {
    endB = a.length;
  }
  const map = Array(endB);
  let k = 0;
  map[0] = 0;
  for (let j = 1;j < endB; j++) {
    if (b[j] == b[k]) {
      map[j] = map[k];
    } else {
      map[j] = k;
    }
    while (k > 0 && b[j] != b[k]) {
      k = map[k];
    }
    if (b[j] == b[k]) {
      k++;
    }
  }
  k = 0;
  for (let i = startA;i < a.length; i++) {
    while (k > 0 && a[i] != b[k]) {
      k = map[k];
    }
    if (a[i] == b[k]) {
      k++;
    }
  }
  return k;
}
function segment(string, segmenter) {
  const parts = [];
  for (const segmentObj of Array.from(segmenter.segment(string))) {
    const segment = segmentObj.segment;
    if (parts.length && /\s/.test(parts[parts.length - 1]) && /\s/.test(segment)) {
      parts[parts.length - 1] += segment;
    } else {
      parts.push(segment);
    }
  }
  return parts;
}
function trailingWs(string, segmenter) {
  if (segmenter) {
    return leadingAndTrailingWs(string, segmenter)[1];
  }
  let i;
  for (i = string.length - 1;i >= 0; i--) {
    if (!string[i].match(/\s/)) {
      break;
    }
  }
  return string.substring(i + 1);
}
function leadingWs(string, segmenter) {
  if (segmenter) {
    return leadingAndTrailingWs(string, segmenter)[0];
  }
  const match = string.match(/^\s*/);
  return match ? match[0] : "";
}
function leadingAndTrailingWs(string, segmenter) {
  if (!segmenter) {
    return [leadingWs(string), trailingWs(string)];
  }
  if (segmenter.resolvedOptions().granularity != "word") {
    throw new Error('The segmenter passed must have a granularity of "word"');
  }
  const segments = segment(string, segmenter);
  const firstSeg = segments[0];
  const lastSeg = segments[segments.length - 1];
  const head = /\s/.test(firstSeg) ? firstSeg : "";
  const tail = /\s/.test(lastSeg) ? lastSeg : "";
  return [head, tail];
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/vendor/diff/word.js
var extendedWordChars = "a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}";
var tokenizeIncludingWhitespace = new RegExp(`[${extendedWordChars}]+|\\s+|[^${extendedWordChars}]`, "ug");

class WordDiff extends Diff {
  equals(left, right, options) {
    if (options.ignoreCase) {
      left = left.toLowerCase();
      right = right.toLowerCase();
    }
    return left.trim() === right.trim();
  }
  tokenize(value, options = {}) {
    let parts;
    if (options.intlSegmenter) {
      const segmenter = options.intlSegmenter;
      if (segmenter.resolvedOptions().granularity != "word") {
        throw new Error('The segmenter passed must have a granularity of "word"');
      }
      parts = segment(value, segmenter);
    } else {
      parts = value.match(tokenizeIncludingWhitespace) || [];
    }
    const tokens = [];
    let prevPart = null;
    parts.forEach((part) => {
      if (/\s/.test(part)) {
        if (prevPart == null) {
          tokens.push(part);
        } else {
          tokens.push(tokens.pop() + part);
        }
      } else if (prevPart != null && /\s/.test(prevPart)) {
        if (tokens[tokens.length - 1] == prevPart) {
          tokens.push(tokens.pop() + part);
        } else {
          tokens.push(prevPart + part);
        }
      } else {
        tokens.push(part);
      }
      prevPart = part;
    });
    return tokens;
  }
  join(tokens) {
    return tokens.map((token, i) => {
      if (i == 0) {
        return token;
      } else {
        return token.replace(/^\s+/, "");
      }
    }).join("");
  }
  postProcess(changes, options) {
    if (!changes || options.oneChangePerToken) {
      return changes;
    }
    let lastKeep = null;
    let insertion = null;
    let deletion = null;
    changes.forEach((change) => {
      if (change.added) {
        insertion = change;
      } else if (change.removed) {
        deletion = change;
      } else {
        if (insertion || deletion) {
          dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, change, options.intlSegmenter);
        }
        lastKeep = change;
        insertion = null;
        deletion = null;
      }
    });
    if (insertion || deletion) {
      dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, null, options.intlSegmenter);
    }
    return changes;
  }
}
var wordDiff = new WordDiff;
function dedupeWhitespaceInChangeObjects(startKeep, deletion, insertion, endKeep, segmenter) {
  if (deletion && insertion) {
    const [oldWsPrefix, oldWsSuffix] = leadingAndTrailingWs(deletion.value, segmenter);
    const [newWsPrefix, newWsSuffix] = leadingAndTrailingWs(insertion.value, segmenter);
    if (startKeep) {
      const commonWsPrefix = longestCommonPrefix(oldWsPrefix, newWsPrefix);
      startKeep.value = replaceSuffix(startKeep.value, newWsPrefix, commonWsPrefix);
      deletion.value = removePrefix(deletion.value, commonWsPrefix);
      insertion.value = removePrefix(insertion.value, commonWsPrefix);
    }
    if (endKeep) {
      const commonWsSuffix = longestCommonSuffix(oldWsSuffix, newWsSuffix);
      endKeep.value = replacePrefix(endKeep.value, newWsSuffix, commonWsSuffix);
      deletion.value = removeSuffix(deletion.value, commonWsSuffix);
      insertion.value = removeSuffix(insertion.value, commonWsSuffix);
    }
  } else if (insertion) {
    if (startKeep) {
      const ws = leadingWs(insertion.value, segmenter);
      insertion.value = insertion.value.substring(ws.length);
    }
    if (endKeep) {
      const ws = leadingWs(endKeep.value, segmenter);
      endKeep.value = endKeep.value.substring(ws.length);
    }
  } else if (startKeep && endKeep) {
    const newWsFull = leadingWs(endKeep.value, segmenter), [delWsStart, delWsEnd] = leadingAndTrailingWs(deletion.value, segmenter);
    const newWsStart = longestCommonPrefix(newWsFull, delWsStart);
    deletion.value = removePrefix(deletion.value, newWsStart);
    const newWsEnd = longestCommonSuffix(removePrefix(newWsFull, newWsStart), delWsEnd);
    deletion.value = removeSuffix(deletion.value, newWsEnd);
    endKeep.value = replacePrefix(endKeep.value, newWsFull, newWsEnd);
    startKeep.value = replaceSuffix(startKeep.value, newWsFull, newWsFull.slice(0, newWsFull.length - newWsEnd.length));
  } else if (endKeep) {
    const endKeepWsPrefix = leadingWs(endKeep.value, segmenter);
    const deletionWsSuffix = trailingWs(deletion.value, segmenter);
    const overlap = maximumOverlap(deletionWsSuffix, endKeepWsPrefix);
    deletion.value = removeSuffix(deletion.value, overlap);
  } else if (startKeep) {
    const startKeepWsSuffix = trailingWs(startKeep.value, segmenter);
    const deletionWsPrefix = leadingWs(deletion.value, segmenter);
    const overlap = maximumOverlap(startKeepWsSuffix, deletionWsPrefix);
    deletion.value = removePrefix(deletion.value, overlap);
  }
}

class WordsWithSpaceDiff extends Diff {
  tokenize(value) {
    const regex = new RegExp(`(\\r?\\n)|[${extendedWordChars}]+|[^\\S\\n\\r]+|[^${extendedWordChars}]`, "ug");
    return value.match(regex) || [];
  }
}
var wordsWithSpaceDiff = new WordsWithSpaceDiff;
function diffWordsWithSpace(oldStr, newStr, options) {
  return wordsWithSpaceDiff.diff(oldStr, newStr, options);
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/tool-preview.ts
var MAX_PREVIEW_LINES = 16;
var MAX_HIGHLIGHT_CHARS = 16384;
var MAX_WORD_CHARS = 4096;
var MAX_DETERMINISTIC_WORD_CHARS = 512;
var SGR = /\x1b\[([\d;]*)m/g;
function codeLines(source) {
  if (!source)
    return [];
  const clean = stripAnsi(source).replace(/\r\n?/g, `
`).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFFF9-\uFFFB]/g, "").replace(/\t/g, "   ");
  return clean.replace(/\n$/, "").split(`
`);
}
function parseDiff(source) {
  const rows = [];
  for (const line of codeLines(source)) {
    if (/^ +\.\.\.$/.test(line)) {
      rows.push({ kind: "gap", number: "", text: "\u2026" });
      continue;
    }
    const match = /^([ +\-]) *(\d+) (.*)$/.exec(line);
    if (!match)
      return [];
    rows.push({ kind: match[1], number: match[2], text: match[3] });
  }
  return rows.some((line) => line.kind === "+" || line.kind === "-") ? rows : [];
}
function changedWords(oldLine, newLine) {
  const chars = Math.max(oldLine.text.length, newLine.text.length);
  if (chars > MAX_WORD_CHARS)
    return;
  const options = chars <= MAX_DETERMINISTIC_WORD_CHARS ? { maxEditLength: 256 } : { timeout: 5, maxEditLength: 256 };
  const changes = diffWordsWithSpace(oldLine.text, newLine.text, options);
  if (!changes)
    return;
  const shared = changes.filter((part) => !part.added && !part.removed).reduce((count, part) => count + part.value.replace(/\s/g, "").length, 0);
  if (shared < 0.3 * Math.max(oldLine.text.trim().length, newLine.text.trim().length) || shared === 0)
    return;
  let oldOffset = 0;
  let newOffset = 0;
  oldLine.spans = [];
  newLine.spans = [];
  for (const part of changes) {
    if (part.removed)
      oldLine.spans.push({ start: oldOffset, end: oldOffset + part.value.length });
    if (part.added)
      newLine.spans.push({ start: newOffset, end: newOffset + part.value.length });
    if (!part.added)
      oldOffset += part.value.length;
    if (!part.removed)
      newOffset += part.value.length;
  }
}
function pairChanges(rows, shown) {
  for (let i = 0;i < shown; i++) {
    if (rows[i].kind !== "-")
      continue;
    const start = i;
    while (rows[i]?.kind === "-")
      i++;
    const added = i;
    while (rows[i]?.kind === "+")
      i++;
    for (let n = 0;n < Math.min(added - start, i - added); n++) {
      if (start + n >= shown && added + n >= shown)
        break;
      changedWords(rows[start + n], rows[added + n]);
    }
    i--;
  }
}
function highlight(rows, path, theme) {
  const language = getLanguageFromPath(path);
  for (let start = 0;start < rows.length; ) {
    let end = start;
    while (end < rows.length && rows[end].kind !== "gap")
      end++;
    const segment = rows.slice(start, end);
    for (const side of ["old", "new"]) {
      if (side === "old" && !segment.some((line) => line.kind === "-"))
        continue;
      const selected = segment.filter((line) => line.kind !== (side === "old" ? "+" : "-"));
      const source = selected.map((line) => line.text).join(`
`);
      const colored = language && source.length <= MAX_HIGHLIGHT_CHARS ? highlightCode(source, language) : undefined;
      const unsupported = colored?.every((line, index) => line === theme.fg("mdCodeBlock", selected[index]?.text ?? ""));
      selected.forEach((line, index) => {
        if (side === "new" || line.kind === "-")
          line.highlighted = !unsupported && colored?.[index] !== undefined ? colored[index] : theme.fg("toolOutput", line.text);
      });
    }
    start = end + 1;
  }
}
function withBands(code, spans, base, word) {
  if (spans.length === 0)
    return base + code.replace(SGR, (sgr, values) => values === "" || values.split(";").some((value) => value === "0" || value === "49") ? sgr + base : sgr);
  let output = base;
  let offset = 0;
  let spanIndex = 0;
  let active = base;
  let from = 0;
  const append = (text) => {
    for (const char of text) {
      while (spans[spanIndex] && spans[spanIndex].end <= offset)
        spanIndex++;
      const span = spans[spanIndex];
      const next = span && span.start < offset + char.length && span.end > offset ? word : base;
      if (next !== active)
        output += next;
      active = next;
      output += char;
      offset += char.length;
    }
  };
  for (const match of code.matchAll(SGR)) {
    append(code.slice(from, match.index));
    output += match[0];
    if (match[1] === "" || match[1].split(";").some((value) => value === "0" || value === "49"))
      output += active;
    from = match.index + match[0].length;
  }
  append(code.slice(from));
  return output;
}
function prepareToolPreview(kind, source, path, theme) {
  const rows = kind === "edit" ? parseDiff(source) : codeLines(source).map((text, index) => ({ kind: " ", number: String(index + 1), text }));
  const shown = Math.min(rows.length, MAX_PREVIEW_LINES);
  if (kind === "edit")
    pairChanges(rows, shown);
  const preview = rows.slice(0, shown);
  highlight(preview, path, theme);
  const digits = preview.reduce((max, line) => Math.max(max, line.number.length), 1);
  const palette = theme.appearance === "light" ? { "+": [[229, 245, 232], [174, 226, 185]], "-": [[255, 230, 230], [255, 188, 188]] } : { "+": [[26, 55, 40], [32, 96, 59]], "-": [[70, 30, 32], [124, 42, 48]] };
  const prepared = preview.map((line) => {
    const marker = kind === "edit" ? line.kind === "gap" ? " " : line.kind : "";
    const prefix = `${marker}${line.number.padStart(digits)} `;
    const code = theme.fg("dim", prefix) + (line.highlighted ?? theme.fg("dim", line.text));
    if (line.kind !== "+" && line.kind !== "-")
      return { code };
    const [normal, strong] = palette[line.kind].map(([r, g, b]) => backgroundAnsi(rgbColor(r, g, b), theme.getColorMode()));
    const spans = (line.spans ?? []).map(({ start, end }) => ({ start: start + prefix.length, end: end + prefix.length }));
    return { code: withBands(code, spans, normal, strong), band: normal };
  });
  const hidden = rows.length - shown;
  return (width, indent) => {
    const pad = truncateToWidth6(indent, Math.max(0, width), "");
    const available = Math.max(0, width - visibleWidth7(pad));
    const result = prepared.map(({ code, band }) => {
      const columns = Math.max(0, available - (band ? 2 : 0));
      const clipped = truncateToWidth6(code, columns, band ? `${band}\u2026` : "\u2026");
      return pad + (band && columns > 0 ? clipped + band + " ".repeat(Math.max(0, columns - visibleWidth7(clipped))) + "\x1B[49m" : clipped);
    });
    if (hidden > 0)
      result.push(pad + theme.fg("dim", truncateToWidth6(`\u2026 +${hidden} lines (ctrl+o to expand)`, available, "\u2026")));
    return result;
  };
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/tool-view.ts
var TOOL_LABELS = {
  read: "Read",
  bash: "Bash",
  powershell: "PowerShell",
  edit: "Edit",
  write: "Write",
  grep: "Grep",
  find: "Find",
  ls: "LS"
};
var LIVE_TAIL_LINES = 3;
var GENERIC_DETAIL_KEYS = ["command", "query", "sql", "pattern", "prompt", "task", "url", "path", "file_path"];
var GENERIC_DETAIL_ARGS = 3;
var GENERIC_DETAIL_VALUE_CHARS = 80;
var FFF_TOOLS = new Map([
  ["ffgrep", "grep"],
  ["grep", "grep"],
  ["fffind", "find"],
  ["find", "find"],
  ["fff-multi-grep", "grep"],
  ["multi_grep", "grep"]
]);
var str = (value) => typeof value === "string" ? value : "";
function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}
function cleanOutput(text) {
  return stripAnsi(text).replace(/\r\n/g, `
`).split(`
`).map((line) => {
    const frames = line.replace(/\r+$/, "");
    return frames.slice(frames.lastIndexOf("\r") + 1);
  }).join(`
`).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFF9-\uFFFB]/g, "");
}
function textOutput(result) {
  return cleanOutput(result.content.map((block) => block.type === "text" ? block.text : "").join(`
`));
}
var NOTICE_SIZE = String.raw`\d+(?:\.\d+)?(?:B|KB|MB)`;
var BYTE_LIMIT_NOTICE = `${NOTICE_SIZE} limit reached`;
var GREP_LINES_NOTICE = String.raw`Some lines truncated to \d+ chars\. Use read tool to see full lines`;
var SHOWN_LINES_NOTICE = String.raw`Showing lines \d+-\d+ of \d+(?: \(${NOTICE_SIZE} limit\))?`;
var TOOL_NOTICES = {
  read: new RegExp(String.raw`^(?:${SHOWN_LINES_NOTICE}\. Use offset=\d+ to continue\.|\d+ more lines in file\. Use offset=\d+ to continue\.)$`),
  bash: new RegExp(String.raw`^(?:${SHOWN_LINES_NOTICE}|Showing last ${NOTICE_SIZE} of line \d+ \(line is ${NOTICE_SIZE}\))\. Full output: [^\n]+$`),
  grep: new RegExp(String.raw`^(?:\d+ matches limit reached\. Use limit=\d+ for more, or refine pattern(?:\. ${BYTE_LIMIT_NOTICE})?(?:\. ${GREP_LINES_NOTICE})?|${BYTE_LIMIT_NOTICE}(?:\. ${GREP_LINES_NOTICE})?|${GREP_LINES_NOTICE})$`),
  find: new RegExp(String.raw`^(?:\d+ results limit reached(?:\. Use limit=\d+ for more, or refine pattern)?(?:\. ${BYTE_LIMIT_NOTICE})?|${BYTE_LIMIT_NOTICE})$`),
  ls: new RegExp(String.raw`^(?:\d+ entries limit reached\. Use limit=\d+ for more(?:\. ${BYTE_LIMIT_NOTICE})?|${BYTE_LIMIT_NOTICE})$`)
};
function stripNotice(toolName, text) {
  const notice = /\n\n\[([^\n]+)\]\s*$/.exec(text);
  if (notice && TOOL_NOTICES[toolName === "powershell" ? "bash" : toolName]?.test(notice[1])) {
    text = text.slice(0, notice.index);
  }
  return text.replace(/\n+$/, "");
}
function countLines(text) {
  return text ? text.split(`
`).length : 0;
}
function diffStats(diff) {
  let added = 0;
  let removed = 0;
  for (const line of diff.split(`
`)) {
    if (line.startsWith("+"))
      added++;
    else if (line.startsWith("-"))
      removed++;
  }
  return { added, removed };
}
function firstLine(text) {
  const lines = text.replace(/\r\n?/g, `
`).trim().split(`
`);
  const head = lines[0] ?? "";
  return lines.length > 1 ? `${head} \u2026 (+${lines.length - 1} lines)` : head;
}
function tailLines(text, count) {
  const lines = cleanOutput(text).split(`
`).filter((line) => line.trim() !== "");
  return lines.slice(-count);
}
function inside(base, path) {
  const rel = relative2(base, path);
  return rel !== ".." && !rel.startsWith(`..${sep2}`) && !isAbsolute3(rel) ? rel.split(sep2).join("/") : undefined;
}
function displayPath(path, cwd, home = homedir2()) {
  if (!path || !isAbsolute3(path))
    return path;
  const inCwd = inside(cwd, path);
  if (inCwd)
    return inCwd;
  const inHome = inside(home, path);
  return inHome === undefined ? path : inHome ? `~/${inHome}` : "~";
}
function lineRange(offset, limit) {
  if (typeof offset !== "number" && typeof limit !== "number")
    return "";
  const start = typeof offset === "number" ? offset : 1;
  return typeof limit === "number" ? `:${start}-${start + limit - 1}` : `:${start}`;
}
function callDetail(toolName, args, cwd) {
  const rawPath = str(args.file_path ?? args.path);
  if (rawPath)
    registerKnownFilePath(rawPath, cwd);
  const path = displayPath(rawPath, cwd);
  switch (toolName) {
    case "read":
      return path + lineRange(args.offset, args.limit);
    case "edit":
    case "write":
      return path;
    case "bash":
    case "powershell":
      return firstLine(str(args.command));
    case "grep": {
      const pattern = str(args.pattern);
      return pattern ? `/${pattern}/${path ? ` in ${path}` : ""}` : path;
    }
    case "find": {
      const pattern = str(args.pattern);
      return pattern && path ? `${pattern} in ${path}` : pattern || path;
    }
    case "ls":
      return path || ".";
    default:
      return "";
  }
}
function genericDetail(args, cwd) {
  for (const key of GENERIC_DETAIL_KEYS) {
    const value = args[key];
    if (typeof value !== "string" || !value.trim())
      continue;
    if (key === "path" || key === "file_path") {
      registerKnownFilePath(value, cwd);
      return displayPath(value, cwd);
    }
    return firstLine(value);
  }
  return Object.entries(args).filter(([, value]) => value !== undefined && value !== null).slice(0, GENERIC_DETAIL_ARGS).map(([key, value]) => {
    const shown = typeof value === "string" ? firstLine(value) : JSON.stringify(value) ?? String(value);
    return `${key}=${shown.slice(0, GENERIC_DETAIL_VALUE_CHARS)}`;
  }).join(", ");
}
function linkToolDetail(toolName, sanitizedDetail, args, cwd, generic = false) {
  if (!sanitizedDetail)
    return "";
  let rawPath = "";
  if (generic) {
    for (const key of GENERIC_DETAIL_KEYS) {
      const value = args[key];
      if (typeof value !== "string" || !value.trim())
        continue;
      if (key === "path" || key === "file_path")
        rawPath = value;
      break;
    }
  } else if (toolName === "read" || toolName === "edit" || toolName === "write" || toolName === "grep" || toolName === "find" || toolName === "ls") {
    rawPath = str(args.file_path ?? args.path) || (toolName === "ls" ? "." : "");
  }
  if (!rawPath)
    return sanitizedDetail;
  const url = resolveToolPathHyperlinkUrl(rawPath, cwd);
  if (!url)
    return sanitizedDetail;
  if (generic || toolName === "read" || toolName === "edit" || toolName === "write" || toolName === "ls") {
    return formatOsc8(sanitizedDetail, url);
  }
  const shownPath = sanitizeStatus(displayPath(rawPath, cwd));
  if (shownPath && sanitizedDetail.endsWith(` in ${shownPath}`)) {
    return sanitizedDetail.slice(0, -shownPath.length) + formatOsc8(shownPath, url);
  }
  if (shownPath && sanitizedDetail === shownPath) {
    return formatOsc8(sanitizedDetail, url);
  }
  return sanitizedDetail;
}
function details(result) {
  const value = result.details;
  return typeof value === "object" && value !== null ? value : {};
}
function truncation(result) {
  const value = details(result).truncation;
  if (typeof value !== "object" || value === null)
    return { truncated: false };
  const { truncated, totalLines } = value;
  return { truncated: truncated === true, totalLines: typeof totalLines === "number" ? totalLines : undefined };
}
function incomplete(result) {
  const info = details(result);
  const limit = ["matchLimitReached", "resultLimitReached", "entryLimitReached"].some((key) => info[key] !== undefined);
  return (limit ? " \xB7 limit reached" : "") + (truncation(result).truncated || info.linesTruncated === true ? " \xB7 truncated" : "");
}
function shellLines(output, result) {
  const text = output.trim();
  const lines = text === "(no output)" ? 0 : truncation(result).totalLines ?? countLines(text);
  return (lines === 0 ? "no output" : plural(lines, "line")) + incomplete(result);
}
function summarizeResult(toolName, result, args) {
  const raw = textOutput(result);
  const text = stripNotice(toolName, raw);
  switch (toolName) {
    case "read": {
      if (result.content.some((block) => block.type === "image"))
        return "image";
      const more = /\n\n\[\d+ more lines in file\. Use offset=\d+ to continue\.\]\s*$/.test(raw) ? " \xB7 more" : "";
      return plural(countLines(text), "line") + incomplete(result) + more;
    }
    case "bash":
    case "powershell":
      return `Done \xB7 ${shellLines(text, result)}`;
    case "edit": {
      const diff = details(result).diff;
      if (typeof diff !== "string")
        return "Edited";
      const { added, removed } = diffStats(diff);
      return `+${added} \u2212${removed}`;
    }
    case "write":
      return `${plural(codeLines(str(args.content)).length, "line")} written`;
    case "grep": {
      if (text === "No matches found")
        return "No matches";
      const files = new Set;
      let matches = 0;
      for (const line of text.split(`
`)) {
        const match = /^(.+?):\d+: /.exec(line);
        if (!match)
          continue;
        matches++;
        files.add(match[1]);
      }
      return `${plural(matches, "match", "matches")} in ${plural(files.size, "file")}${incomplete(result)}`;
    }
    case "find":
      return text === "No files found matching pattern" ? "No files" : plural(countLines(text), "file") + incomplete(result);
    case "ls":
      return text === "(empty directory)" ? "Empty" : plural(countLines(text), "entry", "entries") + incomplete(result);
    default:
      return "";
  }
}
function summarizeGeneric(result, duration = "") {
  const body = textOutput(result).split(`
`).filter((line) => line.trim());
  const images = result.content.filter((block) => block.type === "image").length;
  const head = sanitizeStatus((body[0] ?? "").replace(/^#+\s+/, ""));
  const info = truncation(result);
  const totalLines = info.truncated && typeof info.totalLines === "number" && Number.isSafeInteger(info.totalLines) && info.totalLines >= body.length ? info.totalLines : body.length;
  const counts = [
    ...totalLines ? [plural(totalLines, "line")] : [],
    ...images ? [plural(images, "image")] : []
  ].join(" \xB7 ");
  return (counts || "Done") + (info.truncated ? " \xB7 truncated" : "") + duration + (head ? ` \xB7 ${head}` : "");
}
function summarizeFff(kind, result, duration = "") {
  const info = details(result);
  const matched = info.totalMatched;
  if (typeof matched !== "number" || !Number.isSafeInteger(matched) || matched < 0 || result.content.some((block) => block.type === "image"))
    return summarizeGeneric(result, duration);
  const output = textOutput(result).trim();
  const footer = /\n\n\[(Invalid regex: [\s\S]+, used literal match(?:\. Continue with cursor="fff_c\d+")?|[^\n]+)\]$/.exec(output);
  const body = footer ? output.slice(0, footer.index) : output;
  if (matched === 0 && body !== (kind === "grep" ? "No matches found" : "No files found matching pattern")) {
    return summarizeGeneric(result, duration);
  }
  const notice = footer?.[1] ?? "";
  const fuzzy = kind === "grep" && output.startsWith(`[0 exact matches. Maybe you meant this?]
`);
  const literal = kind === "grep" && /^Invalid regex: [\s\S]+, used literal match(?:\. Continue with cursor="fff_c\d+")?$/.test(notice);
  let more;
  let weak = null;
  if (kind === "find") {
    if (typeof info.hasMore !== "boolean" || typeof info.pageIndex !== "number" || !Number.isSafeInteger(info.pageIndex) || info.pageIndex < 0)
      return summarizeGeneric(result, duration);
    weak = /^Query "[^\n]*" produced only weak scattered fuzzy matches\. Output capped at (\d+)\/(\d+)\.$/.exec(notice);
    if (weak && (Number(weak[2]) !== matched || Number(weak[1]) > matched))
      return summarizeGeneric(result, duration);
    more = info.hasMore && /^\d+ more match(?:es)? available\. cursor="\d+" to continue$/.test(notice);
    if (info.hasMore && !more && !weak)
      return summarizeGeneric(result, duration);
  } else {
    more = /(?:^|\. )(?:Continue with cursor="fff_c\d+"|More available\. cursor="fff_c\d+" to continue)$/.test(notice);
  }
  const matchType = fuzzy ? "fuzzy " : literal ? "literal " : "";
  const count = kind === "find" ? `${plural(matched, "file")} matched` : `${plural(matched, `${matchType}match`, `${matchType}matches`)} on this page`;
  const head = sanitizeStatus(output.split(`
`)[fuzzy ? 1 : 0] ?? "");
  return count + (more ? " \xB7 more available" : "") + (literal ? " \xB7 regex fallback" : "") + (weak ? " \xB7 weak matches" + (Number(weak[1]) < matched ? " \xB7 capped" : "") : "") + (truncation(result).truncated ? " \xB7 truncated" : "") + duration + (head ? ` \xB7 ${head}` : "");
}
function fffKind(toolName, sourceInfo) {
  const kind = FFF_TOOLS.get(toolName);
  if (!kind || !sourceInfo)
    return;
  const source = sourceInfo.source;
  const path = sourceInfo.path.replace(/\\/g, "/");
  const git = /^(?:git:)?(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:|github\.com\/)dmtrkovalenko\/fff(?:\.git)?(?:[@#][^\s]+)?$/i.test(source) && /(?:^|\/)packages\/pi-fff\/src\/index\.ts$/.test(path);
  return source === "npm:@ff-labs/pi-fff" || source.startsWith("npm:@ff-labs/pi-fff@") || /(?:^|\/)node_modules\/@ff-labs\/pi-fff\/src\/index\.ts$/.test(path) || git ? kind : undefined;
}
function summarizeError(toolName, result, duration = "") {
  const text = textOutput(result).trim();
  const status = toolName === "bash" || toolName === "powershell" ? /(?:^|\n\n)Command ([^\n]+)$/.exec(text) : null;
  if (status) {
    const reason = status[1];
    const output = stripNotice(toolName, text.slice(0, status.index));
    const last = tailLines(output, 1)[0]?.trim();
    const tail = last && last !== "(no output)" ? ` \xB7 ${last}` : "";
    return `${reason[0].toUpperCase()}${reason.slice(1)} \xB7 ${shellLines(output, result)}${duration}${tail}`;
  }
  return text.split(`
`).find((line) => line.trim())?.trim() ?? "Failed";
}
function formatElapsed(ms) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
function lines(build, theme, glyphs, cacheable = true) {
  let cache;
  return {
    render(width) {
      const icons = glyphs();
      const colors = theme.colors;
      if (cacheable && cache && cache.width === width && cache.colors === colors && cache.toolCall === icons.toolCall && cache.toolResult === icons.toolResult)
        return cache.lines;
      const rendered = build(width, icons).map((line) => truncateToWidth7(linkifyAnsiLineUrls(line), Math.max(0, width), "\u2026"));
      if (cacheable)
        cache = { width, colors, toolCall: icons.toolCall, toolResult: icons.toolResult, lines: rendered };
      return rendered;
    },
    invalidate() {
      cache = undefined;
    }
  };
}
function rowState(context) {
  const state = context.state;
  state.nativeState ??= {};
  return state;
}
function nativeContext(context, row, lastComponent) {
  return { ...context, state: row.nativeState, lastComponent };
}
function statusBg(theme, context) {
  const bg = context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg";
  return (text) => theme.bg(bg, text);
}
function stopPulse(row) {
  if (row.pulse)
    clearInterval(row.pulse);
  row.pulse = undefined;
}
function genericCall(toolName, args, theme) {
  const entries = typeof args === "object" && args !== null ? Object.entries(args) : [];
  const rows = entries.map(([key, value]) => {
    const shown = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);
    return `  ${sanitizeStatus(key)}: ${cleanOutput(shown).replace(/\t/g, "   ").split(`
`).join(`
    `)}`;
  });
  const title = theme.fg("toolTitle", theme.bold(sanitizeStatus(toolName)));
  return new Text2(rows.length ? `${title}
${theme.fg("muted", rows.join(`
`))}` : title, 0, 0);
}
function genericResult(result, theme, context) {
  const inline = getCapabilities().images && context.showImages;
  const missing = inline ? [] : result.content.flatMap((block) => block.type === "image" ? [imageFallback(block.mimeType, getImageDimensions(block.data, block.mimeType) ?? undefined)] : []);
  const output = [textOutput(result).replace(/\t/g, "   "), ...missing].filter(Boolean).join(`
`);
  return new Text2(output ? theme.fg("toolOutput", output) : "", 0, 0);
}
function isZenActive() {
  const sw = globalThis.piZenSwitch;
  return sw !== undefined && sw.look !== undefined && sw.look !== "pi";
}
function createCompactRenderers(toolName, native, glyphs, running, generic = false, summarizeExtension = summarizeGeneric) {
  const label = Object.hasOwn(TOOL_LABELS, toolName) ? TOOL_LABELS[toolName] : sanitizeStatus(toolName);
  const isShell = !generic && (toolName === "bash" || toolName === "powershell");
  const nativeShell = native?.renderShell;
  const renderNativeCall = native?.renderCall ?? (generic ? (args, theme) => genericCall(toolName, args, theme) : undefined);
  const renderNativeResult = native?.renderResult ?? (generic ? (result, _options, theme, context) => genericResult(result, theme, context) : undefined);
  const showNative = (context) => context.expanded;
  const feedCollapsedNative = (row, isPartial, isError) => row.nativeCall !== undefined && (!isPartial || isError);
  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      if (isZenActive()) {
        return renderNativeCall ? renderNativeCall(args, theme, context) : new Box2(0, 0);
      }
      const row = rowState(context);
      if (context.expanded || (generic ? feedCollapsedNative(row, context.isPartial, context.isError) : toolName !== "write")) {
        row.nativeCall = renderNativeCall?.(args, theme, nativeContext(context, row, row.nativeCall));
      }
      if (context.executionStarted)
        row.startedAt ??= Date.now();
      const live = context.executionStarted && context.isPartial && !context.isError;
      if (live && !context.expanded && running?.has(context.toolCallId)) {
        running.set(context.toolCallId, row);
        if (!row.pulse) {
          row.pulseBright = true;
          row.pulse = setInterval(() => {
            row.pulseBright = !row.pulseBright;
            context.invalidate();
          }, 1000);
          row.pulse.unref();
        }
      } else {
        stopPulse(row);
      }
      if (showNative(context) && row.nativeCall) {
        if (nativeShell === "self")
          return row.nativeCall;
        row.callCard ??= new Box2(context.outputPad, 0);
        row.callCardBottom ??= new Spacer(1);
        row.callCard.setBgFn(statusBg(theme, context));
        row.callCard.setPaddingX(context.outputPad);
        row.callCard.clear();
        row.callCard.addChild(new Spacer(1));
        row.callCard.addChild(row.nativeCall);
        row.callCard.addChild(row.callCardBottom);
        return row.callCard;
      }
      const color = context.isError ? "error" : context.isPartial ? live && row.pulseBright !== false ? "accent" : "dim" : "success";
      const titleColor = context.isPartial || context.isError ? "toolTitle" : "dim";
      const callArgs = args ?? {};
      const rawDetail = sanitizeStatus(generic ? genericDetail(callArgs, context.cwd) : callDetail(toolName, callArgs, context.cwd));
      const detail = linkToolDetail(toolName, rawDetail, callArgs, context.cwd, generic);
      const pad = " ".repeat(context.outputPad);
      return lines((_width, icons) => {
        const call = pad + theme.fg(color, icons.toolCall) + " " + theme.fg(titleColor, titleColor === "dim" ? label : theme.bold(label)) + (detail ? theme.fg(context.isPartial || context.isError ? "muted" : "dim", `(${detail})`) : "");
        if (generic && live && !row.hasResult) {
          const elapsed = row.startedAt === undefined ? "" : ` ${formatElapsed(Date.now() - row.startedAt)}`;
          const gutter = `${pad}  ${theme.fg("dim", icons.toolResult)}  `;
          return [call, gutter + theme.fg("warning", `Running\u2026${elapsed}`)];
        }
        return [call];
      }, theme, glyphs, !context.isPartial);
    },
    renderResult(result, options, theme, context) {
      if (isZenActive()) {
        return renderNativeResult ? renderNativeResult(result, options, theme, context) : new Box2(0, 0);
      }
      const row = rowState(context);
      row.hasResult = true;
      const partial = options.isPartial && !context.isError;
      if (!options.isPartial || context.isError)
        stopPulse(row);
      if (!generic || context.expanded || feedCollapsedNative(row, options.isPartial, context.isError)) {
        row.nativeResult = renderNativeResult?.(result, options, theme, nativeContext(context, row, row.nativeResult));
      }
      if (showNative(context) && row.nativeResult) {
        if (nativeShell === "self")
          return row.nativeResult;
        if (row.callCard && row.callCardBottom)
          row.callCard.removeChild(row.callCardBottom);
        row.resultCard ??= new Box2(context.outputPad, 0);
        row.resultCard.setBgFn(statusBg(theme, context));
        row.resultCard.setPaddingX(context.outputPad);
        row.resultCard.clear();
        row.resultCard.addChild(row.nativeResult);
        row.resultCard.addChild(new Spacer(1));
        return row.resultCard;
      }
      const pad = " ".repeat(context.outputPad);
      const args = context.args ?? {};
      if (!generic && !options.isPartial && !context.isError && (toolName === "edit" || toolName === "write")) {
        const source = toolName === "edit" ? str(details(result).diff) : str(args.content);
        const path = str(args.file_path ?? args.path);
        if (!row.preview || row.preview.source !== source || row.preview.path !== path || row.preview.colors !== theme.colors) {
          row.preview = { source, path, colors: theme.colors, render: prepareToolPreview(toolName, source, path, theme) };
        }
      }
      const timed = isShell || generic;
      const duration = timed && context.durationMs !== undefined ? ` \xB7 ${formatElapsed(context.durationMs)}` : "";
      const summary = partial ? "" : context.isError ? summarizeError(generic ? "" : toolName, result, duration) : generic ? summarizeExtension(result, duration) : summarizeResult(toolName, result, args) + duration;
      const tail = partial && isShell ? tailLines(textOutput(result), LIVE_TAIL_LINES) : [];
      return lines((width, { toolResult }) => {
        const gutter = `${pad}  ${theme.fg("dim", toolResult)}  `;
        const indent = `${pad}  ${" ".repeat(visibleWidth8(toolResult))}  `;
        if (partial) {
          if (!timed)
            return [gutter + theme.fg("warning", "Running\u2026")];
          const elapsed = row.startedAt === undefined ? "" : ` ${formatElapsed(Date.now() - row.startedAt)}`;
          return [...tail.map((line) => theme.fg("toolOutput", line)), theme.fg("warning", `Running\u2026${elapsed}`)].map((line, index) => (index === 0 ? gutter : indent) + line);
        }
        if (context.isError)
          return [gutter + theme.fg("error", summary)];
        return [gutter + theme.fg("dim", summary), ...row.preview?.render(width, indent) ?? []];
      }, theme, glyphs, !partial);
    }
  };
}
var OWNED_TOOLS = new Set(Object.keys(TOOL_LABELS));
function registerToolView(pi, getView, glyphs) {
  const running = new Map;
  pi.on("tool_execution_start", (event) => {
    running.set(event.toolCallId, undefined);
  });
  pi.on("tool_execution_end", (event) => {
    const row = running.get(event.toolCallId);
    if (row)
      stopPulse(row);
    running.delete(event.toolCallId);
  });
  pi.on("session_shutdown", () => {
    for (const row of running.values())
      if (row)
        stopPulse(row);
    running.clear();
  });
  pi.registerToolRenderer((toolName, next) => {
    const native = next();
    const view = getView();
    if (view.mode !== "compact" || view.exclude.includes(toolName))
      return native;
    const sourceInfo = OWNED_TOOLS.has(toolName) || view.extensionTools && FFF_TOOLS.has(toolName) ? pi.getAllTools().find((tool) => tool.name === toolName)?.sourceInfo : undefined;
    const builtin = OWNED_TOOLS.has(toolName) && sourceInfo?.source === "builtin";
    if (builtin)
      return native && createCompactRenderers(toolName, native, glyphs, running);
    if (!view.extensionTools)
      return native;
    const fff = fffKind(toolName, sourceInfo);
    return createCompactRenderers(toolName, native, glyphs, running, true, fff ? (result, duration) => summarizeFff(fff, result, duration) : summarizeGeneric);
  });
}

// stow_modules/main/dot-pi/agent/extensions/rounded-tools.ts
import { visibleWidth as visibleWidth9 } from "@earendil-works/pi-tui";

class RoundedFrame {
  inner;
  border;
  mode;
  cachedWidth;
  cachedInnerLines;
  cachedLines;
  constructor(inner, border, mode = "closed") {
    this.inner = inner;
    this.border = border;
    this.mode = mode;
  }
  invalidate() {
    this.cachedWidth = undefined;
    this.cachedInnerLines = undefined;
    this.cachedLines = undefined;
    this.inner.invalidate?.();
  }
  setText(text) {
    this.inner.setText?.(text);
  }
  clear() {
    this.inner.clear?.();
  }
  addChild(child) {
    this.inner.addChild?.(child);
  }
  render(width) {
    if (width < 4) {
      return this.inner.render(width);
    }
    const innerWidth = Math.max(1, width - 4);
    const innerLines = this.inner.render(innerWidth);
    if (this.cachedLines && this.cachedWidth === width && this.cachedInnerLines === innerLines) {
      return this.cachedLines;
    }
    const horizontal = "\u2500".repeat(Math.max(0, width - 2));
    const side = this.border("\u2502");
    const out = [];
    if (this.mode !== "open-top") {
      out.push(this.border("\u256D" + horizontal + "\u256E"));
    }
    if (innerLines.length > 0) {
      for (const line of innerLines) {
        const vis = visibleWidth9(line);
        const pad = " ".repeat(Math.max(0, innerWidth - vis));
        out.push(side + " " + line + pad + " " + side);
      }
    } else if (this.mode === "closed") {
      out.push(side + " ".repeat(width - 2) + side);
    }
    if (this.mode !== "open-bottom") {
      out.push(this.border("\u2570" + horizontal + "\u256F"));
    }
    this.cachedWidth = width;
    this.cachedInnerLines = innerLines;
    this.cachedLines = out;
    return out;
  }
}
var frame = (inner, theme, mode = "closed", colorKey = "border") => new RoundedFrame(inner, (t) => theme.fg(colorKey, t), mode);
function borderColorFor(context) {
  if (context?.isPartial)
    return "warning";
  if (context?.isError)
    return "error";
  return "border";
}
function isZenActive2() {
  const sw = globalThis.piZenSwitch;
  return sw !== undefined && sw.look !== undefined && sw.look !== "pi";
}
function wrapBuiltin(def) {
  return {
    ...def,
    renderShell: "self",
    renderCall: (args, theme, context) => {
      const inner = def.renderCall ? def.renderCall(args, theme, { ...context, lastComponent: undefined }) : { render: () => [] };
      if (context?.isPartial || isZenActive2())
        return inner;
      return frame(inner, theme, "open-bottom", borderColorFor(context));
    },
    renderResult: (result, options, theme, context) => {
      const inner = def.renderResult ? def.renderResult(result, options, theme, { ...context, lastComponent: undefined }) : { render: () => [] };
      if (context?.isPartial || isZenActive2())
        return inner;
      return frame(inner, theme, "open-top", borderColorFor(context));
    }
  };
}
var BUILTIN_TOOLS = new Set(["read", "write", "edit", "bash", "grep", "find", "ls"]);
var REGISTERED_SYMBOL = Symbol.for("pi.roundedTools.registered");
function registerRoundedTools(pi) {
  const holder = pi;
  if (holder[REGISTERED_SYMBOL])
    return;
  holder[REGISTERED_SYMBOL] = true;
  pi.registerToolRenderer((toolName, next) => {
    const base = next();
    if (!base || !BUILTIN_TOOLS.has(toolName))
      return base;
    return wrapBuiltin(base);
  });
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/peek.ts
import { truncateToWidth as truncateToWidth8, visibleWidth as visibleWidth10, wrapTextWithAnsi as wrapTextWithAnsi3 } from "@earendil-works/pi-tui";
var SPINNER_FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
var MAX_PEEK_LINES = 2;
var graphemeSegmenter2 = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function stringValue(value) {
  return typeof value === "string" ? value : undefined;
}
var normalizePeekLineCount = (lineCount) => Math.max(1, Math.min(MAX_PEEK_LINES, Math.floor(lineCount)));
function reducePeek(prev, parts) {
  const tail = parts.thinking ? peekTail(parts.thinking, MAX_PEEK_LINES) : prev.tail;
  let phase = prev.phase;
  if (parts.thinking && phase === "idle")
    phase = "thinking";
  if (parts.text && phase === "thinking")
    phase = "done";
  return { phase, tail };
}
function createPeekState() {
  return { phase: "idle", tail: "" };
}
function collectPeekParts(content) {
  let thinking = "";
  let text = "";
  if (!Array.isArray(content))
    return { thinking, text };
  for (const rawPart of content) {
    if (!rawPart || typeof rawPart !== "object")
      continue;
    const part = rawPart;
    if (part.type === "thinking") {
      thinking += stringValue(part.thinking) ?? stringValue(part.text) ?? "";
    } else if (part.type === "text") {
      text += stringValue(part.text) ?? "";
    }
  }
  return { thinking, text };
}
function peekTail(fullThinking, lineCount = 1) {
  if (!fullThinking)
    return "";
  const count = normalizePeekLineCount(lineCount);
  const lines = [];
  let end = fullThinking.length;
  while (end > 0 && lines.length < count) {
    const start = fullThinking.lastIndexOf(`
`, end - 1) + 1;
    const line = fullThinking.slice(start, end).replace(/\s+/g, " ").trim();
    if (line)
      lines.push(line);
    end = start - 1;
  }
  return lines.reverse().join(`
`);
}
function clipTail(text, budget) {
  if (!text || budget <= 0)
    return "";
  const limit = budget - 1;
  let w = 0;
  let end = text.length;
  let clippedStart = end;
  const segments = graphemeSegmenter2.segment(text);
  while (end > 0) {
    const part = segments.containing(end - 1);
    w += visibleWidth10(part.segment);
    if (w > budget)
      return "\u2026" + text.slice(clippedStart);
    end = part.index;
    if (w <= limit)
      clippedStart = end;
  }
  return text;
}
function buildPeekLabel(state, frame, glyphs, width, lineCount = 1) {
  const w = Math.max(1, Math.floor(width));
  const prefix = `${glyphs.thinking} think`;
  const count = normalizePeekLineCount(lineCount);
  const fit = (line) => truncateToWidth8(line, w, "\u2026");
  switch (state.phase) {
    case "thinking": {
      const spin = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "";
      const marker = `${prefix} ${spin}`;
      const markerWidth = visibleWidth10(`${marker} `);
      const contentWidth = Math.max(0, w - markerWidth);
      const thoughtIndent = " ".repeat(markerWidth);
      const safeLines = state.tail.split(`
`).map((tail) => sanitizeStatus(tail)).filter(Boolean).slice(-count);
      const latest = safeLines.at(-1) ?? "";
      const lineWithMarker = (tail) => fit(tail ? `${marker} ${tail}` : marker);
      if (count >= 2) {
        const window = clipTail(latest, contentWidth * count);
        const latestWrapped = wrapTextWithAnsi3(window, Math.max(1, contentWidth));
        if (latestWrapped.length > 1) {
          const first = latestWrapped.at(-2) ?? "";
          const second = latestWrapped.at(-1) ?? "";
          return `${lineWithMarker(first)}
${fit(`${thoughtIndent}${second}`)}`;
        }
      }
      const firstTail = clipTail(count >= 2 ? safeLines[0] ?? "" : latest, contentWidth);
      if (count < 2 || safeLines.length < 2)
        return lineWithMarker(firstTail);
      const secondTail = clipTail(latest, contentWidth);
      return `${lineWithMarker(firstTail)}
${fit(secondTail ? `${thoughtIndent}${secondTail}` : thoughtIndent)}`;
    }
    case "done":
      return fit(`${prefix} ${glyphs.done}`);
    default:
      return fit(`${prefix} \xB7`);
  }
}

// stow_modules/main/dot-pi/agent/extensions/open-tui/index.ts
function getPendingUiChange(enabled, active) {
  if (enabled === active)
    return;
  return enabled ? "install" : "uninstall";
}
function isTuiContext(ctx) {
  return ctx.hasUI && ctx.mode === "tui";
}
function isZenActive3() {
  const sw = globalThis.piZenSwitch;
  return sw !== undefined && sw.look !== undefined && sw.look !== "pi";
}
function open_tui_default(pi) {
  const sessionLifecycle = new SessionLifecycle;
  const state = createInitialState();
  const turnTelemetry = new TurnTelemetryTracker;
  let config = structuredClone(DEFAULT_CONFIG);
  let configLoaded = false;
  let active = false;
  let lastCtx;
  let requestFooterRender;
  let workingTimer;
  let cleanupHeader;
  let cleanupFooter;
  let editor;
  let copyButtons;
  let pendingUiChange;
  const footerSegments = createFooterSegments(pi.events, () => requestFooterRender?.());
  const peek = createPeekState();
  let peekFrame = 0;
  let peekSettleTimer;
  let peekTaskEpoch = 0;
  let peekLabelActive = false;
  const getThinkingLevel = () => sessionLifecycle.isCurrent() ? pi.getThinkingLevel() : "off";
  const isPeekEnabled = () => sessionLifecycle.isCurrent() && config.enabled && config.thinkingPeek.lines > 0 && active;
  const setPeekLabel = (ctx) => {
    if (!isPeekEnabled() || peek.phase === "idle")
      return;
    const target = ctx ?? lastCtx;
    if (!target || !isTuiContext(target))
      return;
    if (!editor)
      throw new Error("Open TUI editor is not installed");
    const snapshot = { ...peek };
    const frame = peekFrame;
    const glyphs = resolveGlyphs(config.icons.mode);
    const lines = config.thinkingPeek.lines;
    editor.setLatestHiddenThinkingLabel((width) => buildPeekLabel(snapshot, frame, glyphs, width, lines));
    peekLabelActive = true;
  };
  const clearPeekLabel = (ctx) => {
    if (!peekLabelActive)
      return;
    const target = ctx ?? lastCtx;
    if (!target || !isTuiContext(target))
      return;
    target.ui.setHiddenThinkingLabel();
    peekLabelActive = false;
  };
  const resetPeek = () => {
    peek.phase = "idle";
    peek.tail = "";
    editor?.resetHiddenThinkingLabelTarget();
    if (peekSettleTimer) {
      clearTimeout(peekSettleTimer);
      peekSettleTimer = undefined;
    }
  };
  const applyUi = (ctx) => {
    if (!isTuiContext(ctx))
      return;
    if (!config.enabled || isZenActive3()) {
      uninstallUi(ctx);
      return;
    }
    if (!active) {
      if (config.header)
        cleanupHeader = installHeader(pi, ctx);
      const footer = installFooter(ctx, () => state, () => config, () => getModelMeta(ctx, getThinkingLevel, config.footerSegments.capitalizeProviderName), {
        setRequestRender: (fn) => {
          requestFooterRender = fn ?? undefined;
          if (!fn)
            footerSegments.deactivate();
          else if (active && sessionLifecycle.isCurrent())
            footerSegments.activate();
        },
        scheduleGitRefresh: () => {
          scheduleGitRefresh(ctx);
        },
        getLiveTps: () => turnTelemetry.getLiveTps(),
        getExtensionSegments: footerSegments.getSegments,
        canEmbedInEditor: () => editor?.isFramed() ?? false
      });
      cleanupFooter = footer.cleanup;
      editor = installEditor(pi, ctx, config.cursorStyle, {
        enabled: () => config.inlineFooter,
        render: footer.renderInline
      });
      copyButtons = installCopyButtons({
        getTui: editor.getTui,
        getTheme: () => ctx.ui.theme,
        isEnabled: () => config.copyButtons
      });
      active = true;
      if (requestFooterRender)
        footerSegments.activate();
    }
  };
  const uninstallUi = (ctx) => {
    if (!isTuiContext(ctx))
      return;
    if (active) {
      cleanupHeader?.();
      cleanupFooter?.();
      copyButtons?.cleanup();
      editor?.cleanup();
      cleanupHeader = undefined;
      cleanupFooter = undefined;
      copyButtons = undefined;
      editor = undefined;
      requestFooterRender = undefined;
      resetPeek();
      clearPeekLabel(ctx);
      active = false;
    }
  };
  const scheduleGitRefresh = async (ctx) => {
    if (!sessionLifecycle.isCurrent())
      return;
    const segs = config.footerSegments;
    if (!segs.gitBranch && !segs.gitStatus) {
      state.git = emptyGitStatus();
      requestFooterRender?.();
      return;
    }
    const generation = sessionLifecycle.currentGeneration();
    const cwd = ctx.cwd;
    const git = await readGitStatus(cwd, {
      readCommit: segs.gitBranch,
      readTag: segs.gitBranch && segs.gitCommit,
      readCounts: segs.gitStatus
    });
    if (!sessionLifecycle.isCurrent(generation))
      return;
    state.git = git;
    requestFooterRender?.();
  };
  const refreshRuntime = async (ctx) => {
    if (!sessionLifecycle.isCurrent())
      return;
    const generation = sessionLifecycle.currentGeneration();
    const cwd = ctx.cwd;
    const runtime = await readRuntimeInfo(cwd);
    if (!sessionLifecycle.isCurrent(generation))
      return;
    state.runtime = runtime;
    requestFooterRender?.();
  };
  const refreshInteractiveState = (ctx, project = false) => {
    if (!sessionLifecycle.isCurrent() || !ctx.hasUI)
      return;
    if (project) {
      scheduleGitRefresh(ctx);
      refreshRuntime(ctx);
    }
    requestFooterRender?.();
  };
  const startWorkingTimer = () => {
    stopWorkingTimer();
    const tick = () => {
      if (!sessionLifecycle.isCurrent() || !active)
        return;
      requestFooterRender?.();
    };
    tick();
    workingTimer = setInterval(tick, 250);
    workingTimer.unref?.();
  };
  const stopWorkingTimer = () => {
    if (workingTimer) {
      clearInterval(workingTimer);
      workingTimer = undefined;
    }
  };
  pi.events.on("zen:change", () => {
    if (!sessionLifecycle.isCurrent() || !lastCtx)
      return;
    if (isZenActive3()) {
      uninstallUi(lastCtx);
    } else {
      applyUi(lastCtx);
      refreshInteractiveState(lastCtx);
    }
  });
  pi.on("session_start", async (_event, ctx) => {
    sessionLifecycle.start();
    lastCtx = ctx;
    state.workingSince = undefined;
    state.lastDoneIn = undefined;
    invalidateUsageCache();
    ensureConfigExists();
    config = loadConfig((msg, level) => ctx.ui.notify(msg, level));
    configLoaded = true;
    clearPeekLabel(ctx);
    if (isTuiContext(ctx)) {
      const currentThemeName = ctx.ui.theme?.name;
      if (!currentThemeName || currentThemeName === "system" || currentThemeName === "dark") {
        ctx.ui.setTheme("catppuccin-frappe");
      }
    }
    applyUi(ctx);
    refreshInteractiveState(ctx, true);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    sessionLifecycle.shutdown();
    stopWorkingTimer();
    footerSegments.deactivate();
    if (active) {
      uninstallUi(ctx);
    }
    lastCtx = undefined;
  });
  pi.on("agent_start", (event, _ctx) => {
    turnTelemetry.handle(event);
    if (!sessionLifecycle.isCurrent())
      return;
    peekTaskEpoch++;
    state.workingSince = Date.now();
    state.lastDoneIn = undefined;
    startWorkingTimer();
  });
  pi.on("agent_end", (_event, _ctx) => {
    if (!sessionLifecycle.isCurrent())
      return;
    stopWorkingTimer();
    if (state.workingSince !== undefined) {
      state.lastDoneIn = Date.now() - state.workingSince;
      state.workingSince = undefined;
    }
    requestFooterRender?.();
  });
  pi.on("turn_start", (event) => {
    turnTelemetry.handle(event);
  });
  pi.on("message_start", (event, ctx) => {
    turnTelemetry.handle(event);
    if (!sessionLifecycle.isCurrent() || ctx.isIdle())
      return;
    const role = event.message?.role;
    if (role === "user") {
      resetPeek();
      clearPeekLabel(ctx);
    } else if (role === "assistant") {
      resetPeek();
      clearPeekLabel(ctx);
    }
  });
  pi.on("message_update", (event, ctx) => {
    turnTelemetry.handle(event);
    if (!sessionLifecycle.isCurrent() || ctx.isIdle())
      return;
    if (!isPeekEnabled())
      return;
    const message = event.message;
    if (!message || message.role !== "assistant")
      return;
    if (peek.phase === "done")
      return;
    const parts = collectPeekParts(message.content);
    const next = reducePeek(peek, parts);
    const changed = next.phase !== peek.phase || next.tail !== peek.tail;
    peek.phase = next.phase;
    peek.tail = next.tail;
    if (!changed)
      return;
    if (peek.phase === "thinking") {
      peekFrame++;
      setPeekLabel(ctx);
    } else if (peek.phase === "done") {
      setPeekLabel(ctx);
    }
  });
  pi.on("tool_execution_start", (event) => {
    turnTelemetry.handle(event);
  });
  pi.on("turn_end", (event) => {
    turnTelemetry.handle(event);
  });
  pi.on("agent_settled", (event, ctx) => {
    const telemetry = turnTelemetry.handle(event);
    if (telemetry && config.enabled && active && config.telemetry.enabled && isTuiContext(ctx)) {
      const message = formatTurnTelemetry(telemetry, ctx.ui.theme, config.telemetry, config.icons.mode);
      if (message)
        ctx.ui.notify(message, "info");
    }
    const settleEpoch = peekTaskEpoch;
    if (peekSettleTimer)
      clearTimeout(peekSettleTimer);
    peekSettleTimer = setTimeout(() => {
      peekSettleTimer = undefined;
      if (!sessionLifecycle.isCurrent() || peekTaskEpoch !== settleEpoch)
        return;
      resetPeek();
      clearPeekLabel(ctx);
    }, 300);
  });
  pi.on("model_select", (_event, ctx) => {
    refreshInteractiveState(ctx);
  });
  pi.on("thinking_level_select", (_event, ctx) => {
    refreshInteractiveState(ctx);
  });
  pi.on("message_end", (event, ctx) => {
    turnTelemetry.handle(event);
    if (!sessionLifecycle.isCurrent())
      return;
    if (event.message?.role === "assistant" && peek.phase === "thinking") {
      peek.phase = "done";
      setPeekLabel(ctx);
    }
    invalidateUsageCache();
    refreshInteractiveState(ctx);
  });
  pi.on("tool_execution_end", (_event, ctx) => {
    refreshInteractiveState(ctx);
  });
  pi.on("session_compact", (_event, ctx) => {
    if (!sessionLifecycle.isCurrent())
      return;
    invalidateUsageCache();
    refreshInteractiveState(ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    if (!sessionLifecycle.isCurrent())
      return;
    invalidateUsageCache();
    refreshInteractiveState(ctx);
  });
  registerRoundedTools(pi);
  registerToolView(pi, () => {
    if (!configLoaded) {
      config = loadConfig();
      configLoaded = true;
    }
    return config.enabled ? config.toolView : { ...config.toolView, mode: "native" };
  }, () => resolveGlyphs(config.icons.mode));
  pi.registerMarkdownTransformer(markCopyScope);
  registerSettingsCommand(pi, {
    getConfig: () => config,
    onConfigChanged: (newConfig) => {
      const cursorStyleChanged = config.cursorStyle !== newConfig.cursorStyle;
      const headerChanged = config.header !== newConfig.header;
      const copyButtonsChanged = config.copyButtons !== newConfig.copyButtons;
      const thinkingPeekLinesChanged = config.thinkingPeek.lines !== newConfig.thinkingPeek.lines;
      if (!saveConfig(newConfig)) {
        lastCtx?.ui.notify("open-tui settings apply for this session but could not be saved. Check configuration directory permissions and free space.", "warning");
      }
      config = newConfig;
      if (newConfig.thinkingPeek.lines === 0 || !newConfig.enabled) {
        resetPeek();
        clearPeekLabel(lastCtx);
      } else if (thinkingPeekLinesChanged && peekLabelActive) {
        setPeekLabel(lastCtx);
      }
      if (cursorStyleChanged && active && editor) {
        editor.setCursorStyle(newConfig.cursorStyle);
      }
      if (headerChanged && active && lastCtx) {
        cleanupHeader?.();
        cleanupHeader = newConfig.header ? installHeader(pi, lastCtx) : undefined;
      }
      if (copyButtonsChanged)
        copyButtons?.refresh();
      if (lastCtx) {
        pendingUiChange = getPendingUiChange(newConfig.enabled, active);
      }
      const gitNeeded = newConfig.footerSegments.gitBranch || newConfig.footerSegments.gitStatus;
      if (lastCtx && gitNeeded) {
        scheduleGitRefresh(lastCtx);
      } else {
        state.git = emptyGitStatus();
      }
      requestFooterRender?.();
    },
    onOverlayClosed: () => {
      if (!lastCtx || pendingUiChange === undefined)
        return;
      const change = pendingUiChange;
      pendingUiChange = undefined;
      if (!config.enabled || change === "uninstall") {
        uninstallUi(lastCtx);
      } else {
        applyUi(lastCtx);
      }
    }
  });
}
export {
  open_tui_default as default,
  getPendingUiChange
};
