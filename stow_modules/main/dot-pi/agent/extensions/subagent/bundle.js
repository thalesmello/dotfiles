import { createRequire } from "node:module";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/abortable.ts
function abortable(promise, signal) {
  if (!signal)
    return promise;
  if (signal.aborted)
    return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled)
        return;
      settled = true;
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => {
      if (settled)
        return;
      settled = true;
      cleanup();
      resolve(value);
    }, (error) => {
      if (settled)
        return;
      settled = true;
      cleanup();
      reject(error);
    });
  });
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/default-agents.ts
var DEFAULT_AGENTS;
var init_default_agents = __esm(() => {
  DEFAULT_AGENTS = new Map;
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/agent-types.ts
function isDefaultsDisabled() {
  return disableDefaults;
}
function setDefaultsDisabled(b) {
  disableDefaults = b;
}
function getFallbackSubagent() {
  return fallbackSubagent;
}
function setFallbackSubagent(v) {
  fallbackSubagent = v;
}
function buildAgentRegistry(userAgents) {
  const registry = new Map;
  if (!disableDefaults) {
    for (const [name, config] of DEFAULT_AGENTS)
      registry.set(name, config);
  }
  for (const [name, config] of userAgents)
    registry.set(name, config);
  return registry;
}
function registerAgents(userAgents) {
  agents.clear();
  for (const [name, config] of buildAgentRegistry(userAgents)) {
    agents.set(name, config);
  }
}
function resolveKeyIn(registry, name) {
  if (registry.has(name))
    return name;
  const lower = name.toLowerCase();
  for (const key of registry.keys()) {
    if (key.toLowerCase() === lower)
      return key;
  }
  for (const [key, config] of registry.entries()) {
    if (config.aliases?.some((alias) => alias.toLowerCase() === lower))
      return key;
  }
  return;
}
function resolveKey(name) {
  return resolveKeyIn(agents, name);
}
function resolveTypeIn(registry, name) {
  return resolveKeyIn(registry, name);
}
function getAgentConfigIn(registry, name) {
  const key = resolveKeyIn(registry, name);
  return key ? registry.get(key) : undefined;
}
function getAvailableTypesIn(registry) {
  return [...registry.entries()].filter(([_, config]) => config.enabled !== false).map(([name]) => name);
}
function resolveUnambiguousKeyIn(registry, name) {
  if (registry.has(name))
    return name;
  const lower = name.toLowerCase();
  const matches = [...registry.keys()].filter((key) => key.toLowerCase() === lower);
  if (matches.length === 1)
    return matches[0];
  if (matches.length > 1)
    return;
  const aliasMatches = [...registry.entries()].filter(([_, config]) => config.aliases?.some((alias) => alias.toLowerCase() === lower)).map(([key]) => key);
  return aliasMatches.length === 1 ? aliasMatches[0] : undefined;
}
function resolveEnabledTypeIn(registry, requested) {
  const raw = typeof requested === "string" ? requested.trim() : "";
  if (!raw)
    return;
  const key = resolveUnambiguousKeyIn(registry, raw);
  return key !== undefined && registry.get(key)?.enabled !== false ? key : undefined;
}
function resolveSpawnTypeIn(registry, requested) {
  const raw = typeof requested === "string" ? requested.trim() : "";
  const available = () => getAvailableTypesIn(registry).join(", ") || "(none)";
  const key = resolveEnabledTypeIn(registry, raw);
  if (key !== undefined)
    return { ok: true, type: key };
  const reason = raw ? `Unknown or disabled agent type: "${raw}".` : "No agent type given.";
  const configured = typeof fallbackSubagent === "string" ? fallbackSubagent.trim() : undefined;
  if (configured !== undefined && configured.toLowerCase() === NO_FALLBACK) {
    return { ok: false, message: `${reason} Available: ${available()}.` };
  }
  if (configured !== undefined) {
    const fallbackKey = resolveUnambiguousKeyIn(registry, configured);
    if (fallbackKey === undefined || registry.get(fallbackKey)?.enabled === false) {
      return {
        ok: false,
        message: `${reason} The configured fallbackSubagent "${configured}" is itself ` + `unknown or disabled. Available: ${available()}.`
      };
    }
    return { ok: true, type: fallbackKey, fellBackFrom: raw };
  }
  const defaultFallback = resolveUnambiguousKeyIn(registry, "worker") ?? resolveUnambiguousKeyIn(registry, "general-purpose") ?? "worker";
  return { ok: true, type: defaultFallback, fellBackFrom: raw };
}
function resolveSpawnType(requested) {
  return resolveSpawnTypeIn(agents, requested);
}
function resolveType(name) {
  return resolveKey(name);
}
function getAgentConfig(name) {
  return getAgentConfigIn(agents, name);
}
function getAvailableTypes() {
  return getAvailableTypesIn(agents);
}
function getAllTypes() {
  return [...agents.keys()];
}
function getMemoryToolNames(existingToolNames) {
  return MEMORY_TOOL_NAMES.filter((n) => !existingToolNames.has(n));
}
function getReadOnlyMemoryToolNames(existingToolNames) {
  return READONLY_MEMORY_TOOL_NAMES.filter((n) => !existingToolNames.has(n));
}
function getToolNamesForType(type) {
  const key = resolveKey(type);
  const raw = key ? agents.get(key) : undefined;
  const config = raw?.enabled !== false ? raw : undefined;
  return config?.builtinToolNames ?? [...BUILTIN_TOOL_NAMES];
}
function getConfig(type) {
  const key = resolveKey(type);
  const config = key ? agents.get(key) : undefined;
  if (config && config.enabled !== false) {
    return {
      displayName: config.displayName ?? config.name,
      color: config.color,
      description: config.description,
      builtinToolNames: config.builtinToolNames ?? BUILTIN_TOOL_NAMES,
      extensions: config.extensions,
      excludeExtensions: config.excludeExtensions,
      skills: config.skills,
      promptMode: config.promptMode
    };
  }
  const gpKey = resolveKey("worker") ?? resolveKey("general-purpose");
  const gp = gpKey ? agents.get(gpKey) : undefined;
  if (gp && gp.enabled !== false) {
    return {
      displayName: gp.displayName ?? gp.name,
      color: gp.color,
      description: gp.description,
      builtinToolNames: gp.builtinToolNames ?? BUILTIN_TOOL_NAMES,
      extensions: gp.extensions,
      excludeExtensions: gp.excludeExtensions,
      skills: gp.skills,
      promptMode: gp.promptMode
    };
  }
  return {
    displayName: "Agent",
    description: "General-purpose agent for complex, multi-step tasks",
    builtinToolNames: BUILTIN_TOOL_NAMES,
    extensions: true,
    skills: true,
    promptMode: "append"
  };
}
var BUILTIN_TOOL_NAMES, agents, disableDefaults = false, NO_FALLBACK = "none", fallbackSubagent, MEMORY_TOOL_NAMES, READONLY_MEMORY_TOOL_NAMES;
var init_agent_types = __esm(() => {
  init_default_agents();
  BUILTIN_TOOL_NAMES = [
    "read",
    "bash",
    "edit",
    "write",
    "grep",
    "find",
    "ls"
  ];
  agents = new Map;
  MEMORY_TOOL_NAMES = ["read", "write", "edit"];
  READONLY_MEMORY_TOOL_NAMES = ["read"];
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/agent-color.ts
function resolveAgentColor(value) {
  if (!value)
    return;
  const normalized = value.trim().toLowerCase();
  const resolved = NAMED_AGENT_COLORS[normalized] ?? normalized;
  return /^#[0-9a-f]{6}$/i.test(resolved) ? resolved.toUpperCase() : undefined;
}
function parseHex(hex) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16)
  };
}
function nearest(values, value) {
  return values.reduce((best, v, i) => Math.abs(value - v) < Math.abs(value - values[best]) ? i : best, 0);
}
function rgbTo256({ r, g, b }) {
  const [rIndex, gIndex, bIndex] = [r, g, b].map((channel) => nearest(CUBE_VALUES, channel));
  const distance = ({ r: cr, g: cg, b: cb }) => 0.299 * (r - cr) ** 2 + 0.587 * (g - cg) ** 2 + 0.114 * (b - cb) ** 2;
  const grayIndex = nearest(GRAY_VALUES, Math.round(0.299 * r + 0.587 * g + 0.114 * b));
  const gray = { r: GRAY_VALUES[grayIndex], g: GRAY_VALUES[grayIndex], b: GRAY_VALUES[grayIndex] };
  const cube = { r: CUBE_VALUES[rIndex], g: CUBE_VALUES[gIndex], b: CUBE_VALUES[bIndex] };
  if (Math.max(r, g, b) - Math.min(r, g, b) < 10 && distance(gray) < distance(cube)) {
    return { index: 232 + grayIndex, rgb: gray };
  }
  return { index: 16 + 36 * rIndex + 6 * gIndex + bIndex, rgb: cube };
}
function ansiColor(layer, color) {
  const code = layer === "foreground" ? 38 : 48;
  return typeof color === "number" ? `\x1B[${code};5;${color}m` : `\x1B[${code};2;${color.r};${color.g};${color.b}m`;
}
function relativeLuminance({ r, g, b }) {
  const linear = (value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
function renderAgentNameLabel(name, color, theme, style = {}) {
  const resolved = resolveAgentColor(color);
  if (!resolved) {
    const text = style.bold ? theme.bold(name) : name;
    return style.fallbackColor ? theme.fg(style.fallbackColor, text) : text;
  }
  const rgb = parseHex(resolved);
  const quantized = (theme.getColorMode?.() ?? "truecolor") === "256color" ? rgbTo256(rgb) : undefined;
  const shown = quantized?.rgb ?? rgb;
  const contrasting = relativeLuminance(shown) > 0.179 ? BLACK : WHITE;
  const label = style.bold ? theme.bold(` ${name} `) : ` ${name} `;
  return ansiColor("background", quantized?.index ?? rgb) + ansiColor("foreground", quantized ? rgbTo256(contrasting).index : contrasting) + label + "\x1B[39m" + (style.restoreBackground ?? "\x1B[49m");
}
function hasAgentBadge(type) {
  return type !== undefined && resolveAgentColor(getConfig(type).color) !== undefined;
}
function renderAgentName(type, theme, style = {}) {
  if (!type)
    return renderAgentNameLabel("Agent", undefined, theme, style);
  const config = getConfig(type);
  return renderAgentNameLabel(config.displayName, config.color, theme, style);
}
var NAMED_AGENT_COLORS, CUBE_VALUES, GRAY_VALUES, BLACK, WHITE;
var init_agent_color = __esm(() => {
  init_agent_types();
  NAMED_AGENT_COLORS = {
    red: "#DC2626",
    blue: "#6A9BCC",
    green: "#16A34A",
    yellow: "#CA8A04",
    purple: "#827DBD",
    orange: "#D97757",
    pink: "#C46686",
    cyan: "#0891B2",
    amber: "#F59E0B",
    teal: "#008080",
    indigo: "#6366F1",
    gold: "#EAB308",
    "neon-green": "#10B981",
    "neon-cyan": "#06B6D4",
    "metallic-blue": "#3B82F6",
    violet: "#8B5CF6",
    rose: "#F43F5E",
    lime: "#84CC16",
    gray: "#6B7280",
    grey: "#6B7280",
    fuchsia: "#D946EF",
    slate: "#64748B",
    navy: "#1E3A8A"
  };
  CUBE_VALUES = [0, 95, 135, 175, 215, 255];
  GRAY_VALUES = Array.from({ length: 24 }, (_, i) => 8 + i * 10);
  BLACK = { r: 0, g: 0, b: 0 };
  WHITE = { r: 255, g: 255, b: 255 };
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/package-resources.ts
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DefaultPackageManager, getAgentDir, ProjectTrustStore, SettingsManager } from "@earendil-works/pi-coding-agent";
function setPackageAgentsGate(gate) {
  agentsGate = gate;
  invalidatePackageCache();
}
function setPackageWorkflowsGate(gate) {
  workflowsGate = gate;
  invalidatePackageCache();
}
function getPackageAgentsGate() {
  return agentsGate;
}
function getPackageWorkflowsGate() {
  return workflowsGate;
}
function seedProjectTrust(cwd) {
  try {
    if (typeof ProjectTrustStore !== "function")
      return;
    const agentDir = getAgentDir();
    const saved = new ProjectTrustStore(agentDir).get(cwd);
    if (typeof saved === "boolean") {
      setProjectTrusted(saved);
      return;
    }
    const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
    setProjectTrusted(settings.getGlobalSettings().defaultProjectTrust === "always");
  } catch {}
}
function setProjectTrusted(trusted) {
  if (projectTrustedState === trusted)
    return;
  projectTrustedState = trusted;
  invalidatePackageCache();
}
function stringArray(val) {
  return Array.isArray(val) && val.every((e) => typeof e === "string") ? val : undefined;
}
function normalizeDeclaration(val) {
  const asArray = stringArray(val);
  if (asArray)
    return { agents: asArray };
  if (!val || typeof val !== "object" || Array.isArray(val))
    return;
  const obj = val;
  const agents2 = stringArray(obj.agents);
  const workflows = stringArray(obj.workflows);
  if (!agents2 && !workflows)
    return;
  return { agents: agents2, workflows };
}
function readSubagentManifest(pkg) {
  if (!pkg || typeof pkg !== "object")
    return;
  const obj = pkg;
  const piKey = obj.pi;
  if (piKey && typeof piKey === "object" && !Array.isArray(piKey)) {
    const nested = normalizeDeclaration(piKey.subagents);
    if (nested)
      return nested;
  }
  return normalizeDeclaration(obj["pi-subagents"]);
}
function readPackageJson(root) {
  try {
    const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return;
  }
}
function unscopedShortName(name) {
  const short = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
  return short.toLowerCase();
}
function realOrSelf(path) {
  const abs = resolve(path);
  try {
    return realpathSync(abs);
  } catch {
    const parent = dirname(abs);
    return parent === abs ? abs : join(realOrSelf(parent), basename(abs));
  }
}
function isInside(root, candidate) {
  const rel = relative(realOrSelf(root), realOrSelf(candidate));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
function expandEntry(root, entry) {
  const target = resolve(root, entry);
  if (!isInside(root, target) || !existsSync(target))
    return;
  return target;
}
function resolveDeclaredPaths(root, entries, kind) {
  const dirs = [];
  const files = [];
  const excluded = new Set;
  if (!entries)
    return { dirs, files, excluded };
  for (const entry of entries) {
    if (!entry.startsWith("!"))
      continue;
    const target = resolve(root, entry.slice(1));
    if (isInside(root, target))
      excluded.add(realOrSelf(target));
  }
  const ext = KIND_EXTENSION[kind];
  for (const entry of entries) {
    if (entry.startsWith("!"))
      continue;
    const path = expandEntry(root, entry);
    if (!path || excluded.has(realOrSelf(path)))
      continue;
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (!dirs.includes(path))
        dirs.push(path);
    } else if (stat.isFile() && path.endsWith(ext) && !files.includes(path)) {
      files.push(path);
    }
  }
  return { dirs, files, excluded };
}
function configuredPackages(cwd, projectTrusted) {
  try {
    if (typeof DefaultPackageManager !== "function")
      return [];
    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
    const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
    if (typeof manager.listConfiguredPackages !== "function")
      return [];
    return manager.listConfiguredPackages();
  } catch {
    return [];
  }
}
function listPiPackages(cwd, projectTrusted = false) {
  const seen = new Set;
  const out = [];
  for (const entry of configuredPackages(cwd, projectTrusted)) {
    const root = entry.installedPath;
    if (!root || seen.has(root))
      continue;
    const manifest = readPackageJson(root);
    const declared = manifest ? readSubagentManifest(manifest) : undefined;
    if (!manifest || !declared)
      continue;
    seen.add(root);
    const name = typeof manifest.name === "string" ? manifest.name : undefined;
    out.push({
      source: entry.source,
      name,
      shortName: name ? unscopedShortName(name) : undefined,
      scope: entry.scope,
      root,
      declared
    });
  }
  return out;
}
function packageAllowed(pkg, gate) {
  if (gate === false)
    return false;
  if (gate === undefined || gate === true)
    return true;
  const candidates = new Set([pkg.shortName, pkg.name?.toLowerCase(), pkg.source.toLowerCase()].filter((v) => typeof v === "string"));
  return gate.some((allowed) => candidates.has(allowed.trim().toLowerCase()));
}
function emptyPaths() {
  return { dirs: [], files: [], excluded: new Set };
}
function emptyEntry() {
  return { agents: emptyPaths(), workflows: emptyPaths(), owners: [] };
}
function invalidatePackageCache() {
  cache.clear();
}
function scan(cwd, projectTrusted, gate) {
  const entry = emptyEntry();
  for (const pkg of listPiPackages(cwd, projectTrusted)) {
    if (!packageAllowed(pkg, gate))
      continue;
    entry.owners.push({ root: resolve(pkg.root), name: pkg.name ?? pkg.shortName ?? pkg.source });
    for (const kind of ["agents", "workflows"]) {
      const resolvedPaths = resolveDeclaredPaths(pkg.root, pkg.declared[kind], kind);
      entry[kind].dirs.push(...resolvedPaths.dirs);
      entry[kind].files.push(...resolvedPaths.files);
      for (const path of resolvedPaths.excluded)
        entry[kind].excluded.add(path);
    }
  }
  entry.owners.sort((a, b) => b.root.length - a.root.length);
  return entry;
}
function cacheEntryFor(cwd, kind, opts) {
  const gate = opts.gate ?? (kind === "agents" ? agentsGate : workflowsGate);
  if (gate === false || Array.isArray(gate) && gate.length === 0)
    return emptyEntry();
  const projectTrusted = opts.projectTrusted ?? projectTrustedState;
  const key = `${cwd}\x00${projectTrusted ? 1 : 0}\x00${JSON.stringify(gate ?? true)}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = scan(cwd, projectTrusted, gate);
    cache.set(key, hit);
  }
  return hit;
}
function resolved(cwd, kind, opts) {
  return cacheEntryFor(cwd, kind, opts)[kind];
}
function packageNameForPath(path, cwd, kind = "agents", opts = {}) {
  const abs = resolve(path);
  return cacheEntryFor(cwd, kind, opts).owners.find((o) => abs === o.root || abs.startsWith(o.root + sep))?.name;
}
function packageAgentDirs(cwd, opts = {}) {
  return [...resolved(cwd, "agents", opts).dirs];
}
function packageAgentFiles(cwd, opts = {}) {
  return [...resolved(cwd, "agents", opts).files];
}
function isPackageResourceExcluded(path, cwd, kind, opts = {}) {
  const excluded = resolved(cwd, kind, opts).excluded;
  return excluded.size > 0 && excluded.has(realOrSelf(path));
}
function packageWorkflowDirs(cwd, opts = {}) {
  return [...resolved(cwd, "workflows", opts).dirs];
}
function packageWorkflowFiles(cwd, opts = {}) {
  const out = new Map;
  for (const path of resolved(cwd, "workflows", opts).files) {
    const name = basename(path, KIND_EXTENSION.workflows);
    if (!out.has(name))
      out.set(name, path);
  }
  return out;
}
var KIND_EXTENSION, MAX_PACKAGE_RESOURCE_BYTES = 1048576, agentsGate, workflowsGate, projectTrustedState = false, cache;
var init_package_resources = __esm(() => {
  KIND_EXTENSION = {
    agents: ".md",
    workflows: ".js"
  };
  cache = new Map;
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/custom-agents.ts
import { existsSync as existsSync2, readdirSync, readFileSync as readFileSync2, statSync as statSync2 } from "node:fs";
import { basename as basename2, join as join2 } from "node:path";
import { getAgentDir as getAgentDir2, parseFrontmatter } from "@earendil-works/pi-coding-agent";
function loadCustomAgents(cwd, strict = false, opts = {}) {
  const globalDir = join2(getAgentDir2(), "agents");
  const workspaceProjectDir = join2(cwd, ".agents", "agents");
  const projectDir = join2(cwd, ".pi", "agents");
  const pkgDirs = opts.packageDirs ?? packageAgentDirs(cwd);
  const pkgFiles = opts.packageFiles ?? packageAgentFiles(cwd);
  const excluded = opts.packageExcluded ?? ((path) => isPackageResourceExcluded(path, cwd, "agents"));
  const agents2 = new Map;
  for (const dir of pkgDirs)
    loadFromDir(dir, agents2, "package", strict, excluded);
  for (const file of pkgFiles)
    loadOneFile(file, agents2, "package", strict);
  loadFromDir(globalDir, agents2, "global", strict);
  loadFromDir(workspaceProjectDir, agents2, "project", strict);
  loadFromDir(projectDir, agents2, "project", strict);
  warnedLastLoad = warnedThisLoad;
  warnedThisLoad = new Set;
  return agents2;
}
function loadFromDir(dir, agents2, source, strict, excluded) {
  if (!existsSync2(dir))
    return;
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return;
  }
  for (const file of files) {
    const path = join2(dir, file);
    if (excluded?.(path))
      continue;
    loadOneFile(path, agents2, source, strict);
  }
}
function loadOneFile(path, agents2, source, strict) {
  const filenameType = basename2(path, ".md");
  if (source === "package" && !withinSizeLimit(path)) {
    warnIfNew(`Skipping package agent ${path}: not a regular file, or larger than ${MAX_PACKAGE_RESOURCE_BYTES} bytes.`);
    return;
  }
  const parsed = readAgentFile(path, strict && source !== "package");
  if (!parsed) {
    warnSkippedOverride(filenameType, agents2);
    return;
  }
  const { frontmatter: fm, body } = parsed;
  const declared = str(fm.name)?.trim();
  if (declared?.includes(RESERVED_IN_TYPE)) {
    warnIfNew(`Agent file ${path} declares name "${declared}", which contains "${RESERVED_IN_TYPE}" — reserved for ` + "plugin-scoped identifiers. Rename it, or move the label to `display_name:`. Skipping.");
    return;
  }
  const name = declared || filenameType;
  const { builtinToolNames, extSelectors, mcpToolPatterns } = parseToolsField(fm.tools);
  agents2.set(name, {
    name,
    aliases: csvListOptional(fm.aliases),
    displayName: str(fm.display_name),
    color: str(fm.color),
    description: str(fm.description) ?? name,
    builtinToolNames,
    extSelectors,
    mcpToolPatterns,
    disallowedTools: csvListOptional(fm.disallowed_tools ?? fm.disallowedTools)?.flatMap((n) => [
      ...new Set([n, normalizeToolName(n)])
    ]),
    extensions: inheritField(fm.extensions ?? fm.inherit_extensions),
    excludeExtensions: csvListOptional(fm.exclude_extensions),
    skills: inheritField(fm.skills ?? fm.inherit_skills),
    model: str(fm.model),
    thinking: str(fm.thinking),
    maxTurns: nonNegativeInt(fm.max_turns),
    persistSession: fm.persist_session != null ? fm.persist_session === true : undefined,
    outputTranscript: fm.output_transcript != null ? fm.output_transcript !== false : undefined,
    sessionDir: str(fm.session_dir),
    allowedSubagents: parseAllowedSubagents(fm.allowed_subagents),
    systemPrompt: body.trim(),
    promptMode: fm.prompt_mode === "append" ? "append" : "replace",
    inheritContext: fm.inherit_context != null ? fm.inherit_context === true : undefined,
    runInBackground: fm.run_in_background != null ? fm.run_in_background === true : undefined,
    isolated: fm.isolated != null ? fm.isolated === true : undefined,
    memory: parseMemory(fm.memory),
    isolation: parseIsolation(fm.isolation),
    enabled: fm.enabled !== false,
    source,
    sourcePath: path
  });
}
function withinSizeLimit(path) {
  try {
    const stat = statSync2(path);
    return stat.isFile() && stat.size <= MAX_PACKAGE_RESOURCE_BYTES;
  } catch {
    return false;
  }
}
function parseAgentFrontmatter(content) {
  return parseFrontmatter(content.startsWith("\uFEFF") ? content.slice(1) : content);
}
function readAgentFile(path, strict) {
  try {
    return parseAgentFrontmatter(readFileSync2(path, "utf-8"));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (strict)
      throw new Error(`${path}: ${reason}`);
    warnIfNew(`Skipping agent file ${path}: ${reason}`);
    return;
  }
}
function warnSkippedOverride(name, agents2) {
  const surviving = agents2.get(name);
  if (!surviving?.sourcePath || surviving.enabled === false)
    return;
  warnIfNew(`Agent "${name}" now loads from ${surviving.sourcePath} instead`);
}
function warnIfNew(message) {
  warnedThisLoad.add(message);
  if (warnedLastLoad.has(message))
    return;
  console.warn(`[pi-subagents] ${message}`);
}
function str(val) {
  return typeof val === "string" ? val : undefined;
}
function nonNegativeInt(val) {
  return typeof val === "number" && val >= 0 ? val : undefined;
}
function parseCsvField(val) {
  if (val === undefined || val === null)
    return;
  const s = String(val).trim();
  if (!s || s === "none")
    return;
  const items = s.split(",").map((t) => t.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}
function parseAllowedSubagents(val) {
  if (typeof val === "boolean")
    return val ? "all" : undefined;
  const items = parseCsvField(val);
  if (!items)
    return;
  return items.some((i) => i === "*" || i.toLowerCase() === "all") ? "all" : items;
}
function csvList(val, defaults) {
  if (val === undefined || val === null)
    return defaults;
  return parseCsvField(val) ?? [];
}
function normalizeToolName(name) {
  const lower = name.toLowerCase();
  return BUILTIN_TOOL_NAMES.find((b) => b === lower) ?? CLAUDE_CODE_TOOL_ALIASES[lower] ?? name;
}
function parseToolsField(val) {
  const entries = csvList(val, BUILTIN_TOOL_NAMES);
  const isWildcard = (e) => e === "*" || e.toLowerCase() === "all";
  const isMcp = (e) => e.startsWith("mcp__");
  const hasWildcard = entries.some(isWildcard);
  const plain = [
    ...new Set(entries.filter((e) => !isWildcard(e) && !e.startsWith("ext:") && !isMcp(e)).map(normalizeToolName))
  ];
  const extEntries = entries.filter((e) => e.startsWith("ext:"));
  const mcpEntries = entries.filter(isMcp).map((e) => {
    const server = e.slice("mcp__".length);
    return server && !server.includes("__") ? `${e}__*` : e;
  });
  return {
    builtinToolNames: hasWildcard ? [...new Set([...BUILTIN_TOOL_NAMES, ...plain])] : plain,
    extSelectors: extEntries.length > 0 ? extEntries : undefined,
    mcpToolPatterns: mcpEntries.length > 0 ? mcpEntries : undefined
  };
}
function csvListOptional(val) {
  return parseCsvField(val);
}
function parseMemory(val) {
  if (val === "user" || val === "project" || val === "local")
    return val;
  return;
}
function parseIsolation(val) {
  if (val === "worktree")
    return "worktree";
  if (val === "off" || val === "none" || val === "no" || val === false)
    return "off";
  return;
}
function inheritField(val) {
  if (val === undefined || val === null || val === true)
    return true;
  if (val === false || val === "none")
    return false;
  const items = csvList(val, []);
  return items.length > 0 ? items : false;
}
var RESERVED_IN_TYPE = ":", warnedLastLoad, warnedThisLoad, CLAUDE_CODE_TOOL_ALIASES;
var init_custom_agents = __esm(() => {
  init_agent_types();
  init_package_resources();
  warnedLastLoad = new Set;
  warnedThisLoad = new Set;
  CLAUDE_CODE_TOOL_ALIASES = { glob: "find", multiedit: "edit" };
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/agent-record-entry.ts
import { existsSync as existsSync4 } from "node:fs";
function worktreeLost(record) {
  return record.worktree !== undefined && record.worktreeResult?.hasChanges !== false;
}
function agentRecordEntryData(record) {
  return {
    id: record.id,
    type: record.type,
    description: record.description,
    status: record.status,
    result: record.result,
    error: record.error,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    sessionFile: record.sessionFile,
    handle: record.handle,
    alias: record.alias,
    worktreeLost: worktreeLost(record) || undefined
  };
}
function isAgentRecordEntryData(data) {
  if (typeof data !== "object" || data === null)
    return false;
  const { id, type, status, startedAt } = data;
  return typeof id === "string" && typeof type === "string" && typeof status === "string" && typeof startedAt === "number";
}
function findAgentRecordEntry(ctx, id, matchHandle = false) {
  const entries = ctx.sessionManager.getBranch();
  const wanted = id.toLowerCase();
  let named;
  for (let i = entries.length - 1;i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== AGENT_RECORD_ENTRY_TYPE)
      continue;
    if (!isAgentRecordEntryData(entry.data))
      continue;
    if (entry.data.id === id)
      return entry.data;
    if (matchHandle && named === undefined && (entry.data.handle?.toLowerCase() === wanted || entry.data.alias?.toLowerCase() === wanted)) {
      named = entry.data;
    }
  }
  return named;
}
function reopenTarget(type, sessionFile, worktreeLost2) {
  if (sessionFile === undefined) {
    return { ok: false, reason: "its conversation was not saved (`rememberAgents` or `persist_session` was off)", gone: true };
  }
  if (!existsSync4(sessionFile))
    return { ok: false, reason: "its session is gone", gone: true };
  if (worktreeLost2)
    return { ok: false, reason: "its worktree no longer exists", gone: true };
  const dispatch = resolveSpawnType(type);
  if (!dispatch.ok || dispatch.fellBackFrom !== undefined) {
    return { ok: false, reason: `the ${type} agent is no longer available`, gone: false };
  }
  return { ok: true, type: dispatch.type, sessionFile };
}
var AGENT_RECORD_ENTRY_TYPE = "subagents:record";
var init_agent_record_entry = __esm(() => {
  init_agent_types();
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/child-context.ts
import { AsyncLocalStorage } from "node:async_hooks";
function inChildSessionContext() {
  return childSessionContext.getStore() === true;
}
function runInChildSessionContext(fn) {
  return childSessionContext.run(true, fn);
}
var childSessionContext;
var init_child_context = __esm(() => {
  childSessionContext = new AsyncLocalStorage;
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/context.ts
function extractText(content) {
  return content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(`
`);
}
function buildParentContext(ctx) {
  const entries = ctx.sessionManager.getBranch();
  if (!entries || entries.length === 0)
    return "";
  const parts = [];
  for (const entry of entries) {
    if (entry.type === "message") {
      const msg = entry.message;
      if (msg.role === "user") {
        const text = typeof msg.content === "string" ? msg.content : extractText(msg.content);
        if (text.trim())
          parts.push(`[User]: ${text.trim()}`);
      } else if (msg.role === "assistant") {
        const text = extractText(msg.content);
        if (text.trim())
          parts.push(`[Assistant]: ${text.trim()}`);
      }
    } else if (entry.type === "compaction") {
      if (entry.summary) {
        parts.push(`[Summary]: ${entry.summary}`);
      }
    }
  }
  if (parts.length === 0)
    return "";
  return `# Parent Conversation Context
The following is the conversation history from the parent session that spawned you.
Use this context to understand what has been discussed and decided so far.

${parts.join(`

`)}

---
# Your Task (below)
`;
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/model-resolver.ts
function parseTierSelector(spec) {
  const normalized = spec.trim().toLowerCase();
  if (normalized in CLAUDE_ALIAS_TO_TIER) {
    return { tier: CLAUDE_ALIAS_TO_TIER[normalized], preferAnthropic: true };
  }
  if (normalized === "fast" || normalized === "balanced" || normalized === "deep") {
    return { tier: normalized, preferAnthropic: false };
  }
  return null;
}
function resolveFamilyTierModel(tierMatch, registry, parentModel) {
  const available = registry.getAvailable?.();
  const availableKeys = available ? new Set(available.map((m) => `${m.provider}/${m.id}`.toLowerCase())) : undefined;
  const isAvailable = (provider, id, found) => {
    if (availableKeys)
      return availableKeys.has(`${provider}/${id}`.toLowerCase());
    if (typeof registry.hasConfiguredAuth === "function")
      return registry.hasConfiguredAuth(found);
    return true;
  };
  const preferredProvider = tierMatch.preferAnthropic ? "anthropic" : parentModel?.provider;
  const providerOrder = [];
  if (preferredProvider && preferredProvider in PROVIDER_TIER_CANDIDATES) {
    providerOrder.push(preferredProvider);
  }
  for (const p of FALLBACK_PROVIDER_ORDER) {
    if (!providerOrder.includes(p))
      providerOrder.push(p);
  }
  for (const provider of providerOrder) {
    for (const id of PROVIDER_TIER_CANDIDATES[provider]?.[tierMatch.tier] ?? []) {
      const found = registry.find(provider, id);
      if (found && isAvailable(provider, id, found))
        return found;
    }
  }
  return;
}
function describeModel(model) {
  return {
    modelName: (model.name ?? model.id).replace(/^Claude\s+/i, "").toLowerCase(),
    modelId: `${model.provider}/${model.id}`
  };
}
function resolveModel(input, registry, parentModel) {
  const tierMatch = parseTierSelector(input);
  if (tierMatch) {
    const tierModel = resolveFamilyTierModel(tierMatch, registry, parentModel);
    if (tierModel)
      return tierModel;
  }
  const all = registry.getAvailable?.() ?? registry.getAll();
  const availableSet = new Set(all.map((m) => `${m.provider}/${m.id}`.toLowerCase()));
  const slashIdx = input.indexOf("/");
  if (slashIdx !== -1) {
    const provider = input.slice(0, slashIdx);
    const modelId = input.slice(slashIdx + 1);
    if (availableSet.has(input.toLowerCase())) {
      const found = registry.find(provider, modelId);
      if (found)
        return found;
    }
  }
  const normalize = (s) => s.toLowerCase().replace(/\./g, "-");
  const query = normalize(input);
  let bestMatch;
  let bestScore = 0;
  for (const m of all) {
    const id = normalize(m.id);
    const name = normalize(m.name);
    const full = normalize(`${m.provider}/${m.id}`);
    let score = 0;
    if (id === query || full === query) {
      score = 100;
    } else if (id.includes(query) || full.includes(query)) {
      score = 60 + query.length / id.length * 30;
    } else if (name.includes(query)) {
      score = 40 + query.length / name.length * 20;
    } else if (query.split(/[\s\-/]+/).every((part) => /^\d{8}$/.test(part) || id.includes(part) || name.includes(part) || m.provider.toLowerCase().includes(part))) {
      score = 20;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = m;
    }
  }
  if (bestMatch && bestScore >= 20) {
    const found = registry.find(bestMatch.provider, bestMatch.id);
    if (found)
      return found;
  }
  if (slashIdx !== -1) {
    const bare = resolveModel(input.slice(slashIdx + 1), registry);
    if (typeof bare !== "string")
      return bare;
  }
  const modelList = all.map((m) => `  ${m.provider}/${m.id}`).sort().join(`
`);
  return `Model not found: "${input}".

Available models:
${modelList}`;
}
var PROVIDER_TIER_CANDIDATES, FALLBACK_PROVIDER_ORDER, CLAUDE_ALIAS_TO_TIER;
var init_model_resolver = __esm(() => {
  PROVIDER_TIER_CANDIDATES = {
    anthropic: {
      fast: ["claude-haiku-5-5", "claude-haiku-4-5"],
      balanced: ["claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-sonnet-4-5"],
      deep: [
        "claude-opus-5-5",
        "claude-opus-5",
        "claude-opus-4-8",
        "claude-opus-4-7",
        "claude-opus-4-6",
        "claude-opus-4-5"
      ]
    },
    google: {
      fast: [
        "gemini-3.8-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3-flash-preview",
        "gemini-2.5-flash"
      ],
      balanced: ["gemini-4-argon", "gemini-3.1-pro-preview", "gemini-2.5-pro"],
      deep: ["gemini-4-argon", "gemini-3.1-pro-preview", "gemini-2.5-pro"]
    },
    openai: {
      fast: ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-mini"],
      balanced: ["gpt-5.6-terra", "gpt-6.1-sol", "gpt-5.5"],
      deep: ["gpt-6.1-sol", "gpt-6-sol", "gpt-5.6-sol"]
    },
    meta: {
      fast: ["muse-spark-1.4-internal", "muse-spark-1.3-internal", "muse-latest"],
      balanced: ["muse-latest", "muse-spark-1.4-internal", "muse-spark-1.3-internal"],
      deep: ["muse-wonder-1.0-internal", "muse-latest"]
    }
  };
  FALLBACK_PROVIDER_ORDER = ["anthropic", "google", "openai", "meta"];
  CLAUDE_ALIAS_TO_TIER = {
    haiku: "fast",
    sonnet: "balanced",
    opus: "deep"
  };
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/env.ts
async function detectEnv(pi, cwd) {
  let isGitRepo = false;
  let branch = "";
  try {
    const result = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd, timeout: 5000 });
    isGitRepo = result.code === 0 && result.stdout.trim() === "true";
  } catch {}
  if (isGitRepo) {
    try {
      const result = await pi.exec("git", ["branch", "--show-current"], { cwd, timeout: 5000 });
      branch = result.code === 0 ? result.stdout.trim() : "unknown";
    } catch {
      branch = "unknown";
    }
  }
  return {
    isGitRepo,
    branch,
    platform: process.platform
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/memory.ts
import { existsSync as existsSync5, lstatSync, mkdirSync, readFileSync as readFileSync3 } from "node:fs";
import { homedir } from "node:os";
import { join as join4 } from "node:path";
import { getAgentDir as getAgentDir4 } from "@earendil-works/pi-coding-agent";
function isUnsafeName(name) {
  if (!name || name.length > 128)
    return true;
  return !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name);
}
function isSymlink(filePath) {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}
function safeReadFile(filePath) {
  if (!existsSync5(filePath))
    return;
  if (isSymlink(filePath))
    return;
  try {
    return readFileSync3(filePath, "utf-8");
  } catch {
    return;
  }
}
function resolveMemoryDir(agentName, scope, cwd) {
  if (isUnsafeName(agentName)) {
    throw new Error(`Unsafe agent name for memory directory: "${agentName}"`);
  }
  switch (scope) {
    case "user": {
      const current = join4(getAgentDir4(), "agent-memory", agentName);
      const legacy = join4(homedir(), ".pi", "agent-memory", agentName);
      if (!existsSync5(current) && existsSync5(legacy) && !isSymlink(legacy)) {
        return legacy;
      }
      return current;
    }
    case "project":
      return join4(cwd, ".pi", "agent-memory", agentName);
    case "local":
      return join4(cwd, ".pi", "agent-memory-local", agentName);
  }
}
function ensureMemoryDir(memoryDir) {
  if (existsSync5(memoryDir)) {
    if (isSymlink(memoryDir)) {
      throw new Error(`Refusing to use symlinked memory directory: ${memoryDir}`);
    }
    return;
  }
  mkdirSync(memoryDir, { recursive: true });
}
function readMemoryIndex(memoryDir) {
  if (isSymlink(memoryDir))
    return;
  const memoryFile = join4(memoryDir, "MEMORY.md");
  const content = safeReadFile(memoryFile);
  if (content === undefined)
    return;
  const lines = content.split(`
`);
  if (lines.length > MAX_MEMORY_LINES) {
    return lines.slice(0, MAX_MEMORY_LINES).join(`
`) + `
... (truncated at 200 lines)`;
  }
  return content;
}
function buildMemoryBlock(agentName, scope, cwd) {
  const memoryDir = resolveMemoryDir(agentName, scope, cwd);
  ensureMemoryDir(memoryDir);
  const existingMemory = readMemoryIndex(memoryDir);
  const header = `# Agent Memory

You have a persistent memory directory at: ${memoryDir}/
Memory scope: ${scope}

This memory persists across sessions. Use it to build up knowledge over time.`;
  const memoryContent = existingMemory ? `

## Current MEMORY.md
${existingMemory}` : `

No MEMORY.md exists yet. Create one at ${join4(memoryDir, "MEMORY.md")} to start building persistent memory.`;
  const instructions = `

## Memory Instructions
- MEMORY.md is an index file — keep it concise (under 200 lines). Lines after 200 are truncated.
- Store detailed memories in separate files within ${memoryDir}/ and link to them from MEMORY.md.
- Each memory file should use this frontmatter format:
  \`\`\`markdown
  ---
  name: <memory name>
  description: <one-line description>
  type: <user|feedback|project|reference>
  ---
  <memory content>
  \`\`\`
- Update or remove memories that become outdated. Check for existing memories before creating duplicates.
- You have Read, Write, and Edit tools available for managing memory files.`;
  return header + memoryContent + instructions;
}
function buildReadOnlyMemoryBlock(agentName, scope, cwd) {
  const memoryDir = resolveMemoryDir(agentName, scope, cwd);
  const existingMemory = readMemoryIndex(memoryDir);
  const header = `# Agent Memory (read-only)

Memory scope: ${scope}
You have read-only access to memory. You can reference existing memories but cannot create or modify them.`;
  const memoryContent = existingMemory ? `

## Current MEMORY.md
${existingMemory}` : `

No memory is available yet. Other agents or sessions with write access can create memories for you to consume.`;
  return header + memoryContent;
}
var MAX_MEMORY_LINES = 200;
var init_memory = () => {};

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/invocation-config.ts
import { Type } from "typebox";
function isolationParam(enabled) {
  return enabled ? isolationParamShape : {};
}
function resolveAgentInvocationConfig(agentConfig, params, opts) {
  const requested = agentConfig?.isolation ?? params.isolation;
  const isolation = requested === "worktree" && opts?.worktreeAllowed !== false ? "worktree" : undefined;
  const overriddenThinking = agentConfig?.thinking != null && params.thinking != null && agentConfig.thinking !== params.thinking ? params.thinking : undefined;
  const overriddenModel = agentConfig?.model != null && params.model != null && agentConfig.model !== params.model ? params.model : undefined;
  return {
    modelInput: agentConfig?.model ?? params.model,
    modelFromParams: agentConfig?.model == null && params.model != null,
    thinking: agentConfig?.thinking ?? params.thinking,
    maxTurns: agentConfig?.maxTurns ?? params.max_turns,
    inheritContext: agentConfig?.inheritContext ?? params.inherit_context ?? false,
    runInBackground: agentConfig?.runInBackground ?? params.run_in_background ?? opts?.defaultRunInBackground ?? false,
    isolated: agentConfig?.isolated ?? params.isolated ?? false,
    isolation,
    overridden: overriddenThinking || overriddenModel ? { thinking: overriddenThinking, model: overriddenModel } : undefined
  };
}
function resolveJoinMode(defaultJoinMode, runInBackground) {
  return runInBackground ? defaultJoinMode : undefined;
}
var isolationParamShape;
var init_invocation_config = __esm(() => {
  isolationParamShape = {
    isolation: Type.Optional(Type.Union([Type.Literal("off"), Type.Literal("worktree")], {
      description: 'Isolation mode. Default "off". "off" runs the agent in the current checkout, the same as omitting the field. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo (a copy cannot see uncommitted or staged changes in the main checkout).'
    }))
  };
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/enabled-models.ts
import { existsSync as existsSync6, readFileSync as readFileSync4, statSync as statSync3 } from "node:fs";
import { join as join5 } from "node:path";
import { getAgentDir as getAgentDir5 } from "@earendil-works/pi-coding-agent";
function settingsPaths(cwd) {
  return [
    join5(cwd, ".pi", "settings.json"),
    join5(getAgentDir5(), "settings.json")
  ];
}
function readField(path) {
  if (!existsSync6(path))
    return;
  try {
    const raw = JSON.parse(readFileSync4(path, "utf-8"));
    if (Array.isArray(raw?.enabledModels))
      return raw.enabledModels;
  } catch {}
  return;
}
function readEnabledModels(cwd) {
  const [project, global] = settingsPaths(cwd);
  return readField(project) ?? readField(global);
}
function hashOf(path) {
  try {
    const s = statSync3(path);
    return `${s.mtimeMs}-${s.size}`;
  } catch {
    return "missing";
  }
}
function resolveEnabledModels(patterns, registry, cwd = process.cwd()) {
  const patternsKey = JSON.stringify(patterns);
  const [project, global] = settingsPaths(cwd);
  const fileHash = `${hashOf(project)};${hashOf(global)}`;
  if (fileHash === cachedHash && patternsKey === cachedPatternsKey) {
    return cachedAllowed;
  }
  if (!patterns || patterns.length === 0) {
    cachedHash = fileHash;
    cachedPatternsKey = patternsKey;
    cachedAllowed = undefined;
    return;
  }
  const available = registry.getAvailable?.() ?? registry.getAll();
  const allowed = new Set;
  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (!trimmed)
      continue;
    resolveExact(trimmed, available, allowed);
  }
  const result = allowed.size > 0 ? allowed : undefined;
  cachedHash = fileHash;
  cachedPatternsKey = patternsKey;
  cachedAllowed = result;
  return result;
}
function isModelInScope(model, allowed) {
  return allowed.has(modelKey(model));
}
function modelKey(model) {
  return `${model.provider}/${model.id}`.toLowerCase();
}
function resolveExact(pattern, available, allowed) {
  const slashIdx = pattern.indexOf("/");
  if (slashIdx === -1)
    return;
  const provider = pattern.slice(0, slashIdx).toLowerCase();
  const modelId = pattern.slice(slashIdx + 1).toLowerCase();
  const exact = available.find((m) => m.provider.toLowerCase() === provider && m.id.toLowerCase() === modelId);
  if (exact) {
    allowed.add(modelKey(exact));
  }
}
var cachedAllowed, cachedHash = "", cachedPatternsKey = "";
var init_enabled_models = () => {};

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/model-scope.ts
function isScopeModelsEnabled() {
  return scopeModelsEnabled;
}
function setScopeModelsEnabled(enabled) {
  scopeModelsEnabled = enabled;
}
function checkModelScope(args) {
  const { model, cwd, modelRegistry, callerSupplied, agentLabel, modelInput } = args;
  if (!scopeModelsEnabled || !model)
    return { kind: "ok" };
  const allowed = resolveEnabledModels(readEnabledModels(cwd), modelRegistry, cwd);
  if (!allowed || isModelInScope(model, allowed))
    return { kind: "ok" };
  if (callerSupplied) {
    const list = [...allowed].sort().map((m) => `  ${m}`).join(`
`);
    return {
      kind: "error",
      message: `Model not in scope: "${modelInput}".

Allowed models (from enabledModels):
${list}`
    };
  }
  const modelLabel = modelInput ?? `${model.provider}/${model.id}`;
  return {
    kind: "warn",
    message: `Agent "${agentLabel}" using out-of-scope model "${modelLabel}"`
  };
}
var scopeModelsEnabled = false;
var init_model_scope = __esm(() => {
  init_enabled_models();
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/output-file.ts
import { appendFileSync, chmodSync, mkdirSync as mkdirSync2, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join6 } from "node:path";
function getOutputTranscriptDefault() {
  return outputTranscriptDefault;
}
function setOutputTranscriptDefault(b) {
  outputTranscriptDefault = b;
}
function encodeCwd(cwd) {
  return cwd.replace(/[/\\]/g, "-").replace(/^[A-Za-z]:-/, "").replace(/^-+/, "");
}
function sessionTaskDir(cwd, sessionId) {
  const encoded = encodeCwd(cwd);
  const root = join6(tmpdir(), `pi-subagents-${process.getuid?.() ?? 0}`);
  mkdirSync2(root, { recursive: true, mode: 448 });
  try {
    chmodSync(root, 448);
  } catch (err) {
    if (process.platform !== "win32")
      throw err;
  }
  const dir = join6(root, encoded, sessionId, "tasks");
  mkdirSync2(dir, { recursive: true });
  return dir;
}
function createOutputFilePath(cwd, agentId, sessionId) {
  return join6(sessionTaskDir(cwd, sessionId), `${agentId}.output`);
}
function ensureOutputFile(path) {
  try {
    appendFileSync(path, "", "utf-8");
  } catch {}
}
function writeInitialEntry(path, agentId, prompt, cwd) {
  const entry = {
    isSidechain: true,
    agentId,
    type: "user",
    message: { role: "user", content: prompt },
    timestamp: new Date().toISOString(),
    cwd
  };
  writeFileSync(path, JSON.stringify(entry) + `
`, "utf-8");
}
function streamToOutputFile(session, path, agentId, cwd, startIndex) {
  let writtenCount = startIndex;
  const flush = () => {
    const messages = session.messages;
    if (writtenCount === undefined) {
      const prompt = messages.findIndex((m) => m.role === "user");
      if (prompt === -1)
        return;
      writtenCount = prompt + 1;
    }
    while (writtenCount < messages.length) {
      const msg = messages[writtenCount++];
      if (msg.role === "system")
        continue;
      const entry = {
        isSidechain: true,
        agentId,
        type: msg.role === "assistant" ? "assistant" : msg.role === "user" ? "user" : "toolResult",
        message: msg,
        timestamp: new Date().toISOString(),
        cwd
      };
      try {
        appendFileSync(path, JSON.stringify(entry) + `
`, "utf-8");
      } catch {}
    }
  };
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "turn_end")
      flush();
    if (event.type === "compaction_start")
      flush();
    if (event.type === "compaction_end" && !event.aborted && event.result) {
      queueMicrotask(() => {
        writtenCount = session.messages.length;
      });
    }
  });
  return () => {
    flush();
    unsubscribe();
  };
}
var outputTranscriptDefault = true;
var init_output_file = () => {};

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/status-note.ts
function getStatusNote(status) {
  switch (status) {
    case "stopped":
      return " (STOPPED BY THE USER before completion — output is partial; the task was NOT finished)";
    case "aborted":
      return " (aborted — hit the turn limit before completion; output may be incomplete)";
    case "steered":
      return " (wrapped up at the turn limit — output may be partial)";
    default:
      return "";
  }
}
function getForegroundOutcomeNote(status) {
  switch (status) {
    case "stopped":
      return " (STOPPED BY THE USER — everything the agent produced is above; the task is unfinished)";
    case "aborted":
      return " (aborted at the turn limit — everything the agent produced is above; the task is unfinished)";
    case "steered":
      return " (wrapped up at the turn limit — everything the agent produced is above; the task may be unfinished)";
    default:
      return "";
  }
}
function partialOutputSuffix(record) {
  const partial = record.result?.trim();
  return partial ? `

Partial output before the failure:
${partial}` : "";
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/usage.ts
function getLifetimeTotal(u) {
  return u ? u.input + u.output + u.cacheWrite : 0;
}
function getLifetimeCost(u) {
  return u?.cost ?? 0;
}
function addUsage(into, delta) {
  into.input += delta.input;
  into.output += delta.output;
  into.cacheWrite += delta.cacheWrite;
  if (delta.cacheRead)
    into.cacheRead = (into.cacheRead ?? 0) + delta.cacheRead;
  if (delta.cost)
    into.cost = (into.cost ?? 0) + delta.cost;
}
function toReportedUsage(u) {
  const { input, output, cacheWrite, cacheRead = 0, cost = 0 } = u;
  if (input === 0 && output === 0 && cacheWrite === 0 && cacheRead === 0 && cost === 0)
    return;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost }
  };
}

class PendingUsagePool {
  pending = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0 };
  dirty = false;
  add(delta) {
    addUsage(this.pending, delta);
    this.dirty = true;
  }
  drain() {
    if (!this.dirty)
      return;
    const drained = toReportedUsage(this.pending);
    this.pending = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0 };
    this.dirty = false;
    return drained;
  }
}
function getSessionContextPercent(session) {
  if (!session)
    return null;
  try {
    return session.getSessionStats().contextUsage?.percent ?? null;
  } catch {
    return null;
  }
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/worktree.ts
import { randomUUID } from "node:crypto";
import { existsSync as existsSync7, realpathSync as realpathSync2 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join7, relative as relative2 } from "node:path";
function setWorktreeIsolationEnabled(enabled) {
  worktreeIsolationEnabled = enabled;
}
function isWorktreeIsolationEnabled() {
  return worktreeIsolationEnabled;
}
async function git(pi, cwd, args, timeout) {
  const result = await pi.exec("git", args, { cwd, timeout });
  if (result.killed || result.code !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed (exit ${result.code})`);
  }
  return result.stdout.trim();
}
async function createWorktree(pi, cwd, agentId) {
  let baseSha;
  let subdir;
  try {
    await git(pi, cwd, ["rev-parse", "--is-inside-work-tree"], 5000);
    baseSha = await git(pi, cwd, ["rev-parse", "HEAD"], 5000);
    const topLevel = await git(pi, cwd, ["rev-parse", "--show-toplevel"], 5000);
    subdir = relative2(realpathSync2(topLevel), realpathSync2(cwd));
  } catch {
    return;
  }
  const branch = `pi-agent-${agentId}`;
  const suffix = randomUUID().slice(0, 8);
  const worktreePath = join7(tmpdir2(), `pi-agent-${agentId}-${suffix}`);
  try {
    await git(pi, cwd, ["worktree", "add", "--detach", worktreePath, "HEAD"], 30000);
    return { path: worktreePath, branch, baseSha, workPath: subdir ? join7(worktreePath, subdir) : worktreePath };
  } catch {
    return;
  }
}
async function cleanupWorktree(pi, cwd, worktree, agentDescription) {
  if (!existsSync7(worktree.path)) {
    return { hasChanges: false };
  }
  try {
    const status = await git(pi, worktree.path, ["status", "--porcelain"], 1e4);
    if (status) {
      await git(pi, worktree.path, ["add", "-A"], 1e4);
      const safeDesc = agentDescription.slice(0, 200);
      const commitMsg = `pi-agent: ${safeDesc}`;
      await git(pi, worktree.path, ["commit", "--no-verify", "-m", commitMsg], 1e4);
    } else {
      const currentSha = await git(pi, worktree.path, ["rev-parse", "HEAD"], 5000);
      if (currentSha === worktree.baseSha) {
        await removeWorktree(pi, cwd, worktree.path);
        return { hasChanges: false };
      }
    }
    let branchName = worktree.branch;
    try {
      await git(pi, worktree.path, ["branch", branchName], 5000);
    } catch {
      branchName = `${worktree.branch}-${Date.now()}`;
      await git(pi, worktree.path, ["branch", branchName], 5000);
    }
    worktree.branch = branchName;
    await removeWorktree(pi, cwd, worktree.path);
    return {
      hasChanges: true,
      branch: worktree.branch,
      path: worktree.path
    };
  } catch {
    try {
      await removeWorktree(pi, cwd, worktree.path);
    } catch {}
    return { hasChanges: false };
  }
}
async function removeWorktree(pi, cwd, worktreePath) {
  try {
    await git(pi, cwd, ["worktree", "remove", "--force", worktreePath], 1e4);
  } catch {
    try {
      await git(pi, cwd, ["worktree", "prune"], 5000);
    } catch {}
  }
}
async function pruneWorktrees(pi, cwd) {
  try {
    await git(pi, cwd, ["worktree", "prune"], 5000);
  } catch {}
}
var worktreeIsolationEnabled = true;
var init_worktree = () => {};

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/nested-tools.ts
import {
  defineTool
} from "@earendil-works/pi-coding-agent";
import { Type as Type2 } from "typebox";
function getMaxSubagentDepth() {
  return maxSubagentDepth;
}
function setMaxSubagentDepth(n) {
  maxSubagentDepth = Math.max(0, Math.floor(n));
}
function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], isError, details: {} };
}
function ownsRecord(record, parentAgentId) {
  return record?.parentAgentId === parentAgentId;
}
function formatRecord(record, position) {
  if (record.status === "error") {
    return `Agent failed: ${record.error ?? "unknown error"}${partialOutputSuffix(record)}`;
  }
  if (record.status === "queued" || record.status === "running") {
    return `Agent ${record.id} is ${record.status}.`;
  }
  const text = record.result?.trim() || record.error?.trim() || "No output.";
  const note = position === "inline" ? getForegroundOutcomeNote(record.status) : getStatusNote(record.status);
  return note ? `Nested agent${note}.

${text}` : text;
}
function createNestedSubagentTools(context) {
  const loadRegistry = () => buildAgentRegistry(loadCustomAgents(context.configCwd));
  const allowedTypesIn = (registry) => context.allowedSubagents === "all" ? undefined : new Set(context.allowedSubagents.map((name) => resolveTypeIn(registry, name) ?? name));
  const availableIn = (registry) => {
    const allowed = allowedTypesIn(registry);
    return getAvailableTypesIn(registry).filter((name) => allowed === undefined || allowed.has(name));
  };
  const agentTool = defineTool({
    name: NESTED_TOOL_NAMES[0],
    label: "Agent",
    description: "Launch a child-safe nested subagent for bounded delegated work. " + "Only use agent types allowed by this parent agent; nesting is depth-limited.",
    parameters: Type2.Object({
      prompt: Type2.String({ description: "Self-contained task for the nested agent." }),
      description: Type2.String({ description: "Short 3-5 word task description." }),
      subagent_type: Type2.String({ description: `Allowed nested agent type. Available: ${availableIn(loadRegistry()).join(", ") || "none"}.` }),
      model: Type2.Optional(Type2.String({ description: "Optional provider/model override." })),
      thinking: Type2.Optional(Type2.String({ description: "Optional thinking level." })),
      max_turns: Type2.Optional(Type2.Number({ minimum: 1 })),
      run_in_background: Type2.Optional(Type2.Boolean({
        description: "Defaults to false for nested spawns — the call blocks and returns the child's result inline. Set true only for work you will collect later with get_subagent_result; a detached child is stopped when you finish."
      })),
      resume: Type2.Optional(Type2.String({ description: "Resume a nested agent owned by this parent." })),
      isolated: Type2.Optional(Type2.Boolean()),
      inherit_context: Type2.Optional(Type2.Boolean()),
      ...isolationParam(isWorktreeIsolationEnabled())
    }),
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      if (params.resume) {
        const existing = context.manager.getRecord(params.resume);
        if (!ownsRecord(existing, context.parentAgentId)) {
          return textResult(`Nested agent not found or not owned by this parent: "${params.resume}".`, true);
        }
        const resumed = await context.manager.resume(params.resume, params.prompt, signal, {
          maxTurns: getAgentConfigIn(loadRegistry(), existing.type)?.maxTurns ?? params.max_turns
        });
        return resumed ? textResult(formatRecord(resumed, "inline"), resumed.status === "error") : textResult(`Failed to resume nested agent "${params.resume}".`, true);
      }
      if (context.depth >= context.maxSubagentDepth) {
        return textResult(`Nested subagent call blocked (depth=${context.depth}, max=${context.maxSubagentDepth}). Complete the task directly.`, true);
      }
      const registry = loadRegistry();
      const rawType = params.subagent_type;
      const resolvedType = resolveEnabledTypeIn(registry, rawType);
      if (resolvedType === undefined) {
        return textResult(`Unknown or disabled nested agent type: "${rawType}". Allowed: ${availableIn(registry).join(", ") || "none"}.`, true);
      }
      const allowed = allowedTypesIn(registry);
      if (allowed !== undefined && !allowed.has(resolvedType)) {
        return textResult(`Nested agent type "${resolvedType}" is not allowed for this parent. Allowed: ${[...allowed].join(", ")}.`, true);
      }
      const config = getAgentConfigIn(registry, resolvedType);
      const invocation = resolveAgentInvocationConfig(config, params, {
        worktreeAllowed: isWorktreeIsolationEnabled(),
        defaultRunInBackground: false
      });
      let model = ctx.model;
      if (invocation.modelInput) {
        const resolvedModel = resolveModel(invocation.modelInput, ctx.modelRegistry, ctx.model);
        if (typeof resolvedModel === "string") {
          if (invocation.modelFromParams)
            return textResult(resolvedModel, true);
        } else {
          model = resolvedModel;
        }
      }
      const scopeVerdict = checkModelScope({
        model,
        cwd: context.configCwd,
        modelRegistry: ctx.modelRegistry,
        callerSupplied: invocation.modelFromParams,
        agentLabel: config?.displayName ?? resolvedType,
        modelInput: invocation.modelInput
      });
      if (scopeVerdict.kind === "error")
        return textResult(scopeVerdict.message, true);
      const rootSessionId = context.manager.getRecord(context.parentAgentId)?.rootSessionId;
      const childDepth = context.depth + 1;
      const options = {
        description: params.description,
        model,
        maxTurns: invocation.maxTurns,
        isolated: invocation.isolated,
        inheritContext: invocation.inheritContext,
        thinkingLevel: invocation.thinking,
        isolation: invocation.isolation,
        invocation: {
          thinking: invocation.thinking,
          maxTurns: invocation.maxTurns,
          isolated: invocation.isolated,
          inheritContext: invocation.inheritContext,
          runInBackground: invocation.runInBackground,
          isolation: invocation.isolation
        },
        onAssistantUsage: (usage) => {
          for (let id = context.parentAgentId;id !== undefined; ) {
            const ancestor = context.manager.getRecord(id);
            if (!ancestor)
              break;
            addUsage(ancestor.lifetimeUsage, usage);
            id = ancestor.parentAgentId;
          }
        },
        depth: childDepth,
        parentAgentId: context.parentAgentId,
        maxSubagentDepth: context.maxSubagentDepth,
        configCwd: context.configCwd,
        rootSessionId
      };
      const transcriptSessionId = rootSessionId !== undefined && (config?.outputTranscript ?? getOutputTranscriptDefault()) ? rootSessionId : undefined;
      let childId;
      const attachTranscript = (id) => {
        childId = id;
        if (transcriptSessionId === undefined)
          return;
        const rec = context.manager.getRecord(id);
        if (!rec)
          return;
        rec.outputFile = createOutputFilePath(context.configCwd, id, transcriptSessionId);
        writeInitialEntry(rec.outputFile, id, params.prompt, ctx.cwd);
      };
      options.onSessionCreated = (session) => {
        const rec = childId === undefined ? undefined : context.manager.getRecord(childId);
        if (rec?.outputFile && childId !== undefined) {
          rec.outputCleanup = streamToOutputFile(session, rec.outputFile, childId, ctx.cwd);
        }
      };
      try {
        if (invocation.runInBackground) {
          const id = context.manager.spawn(context.pi, ctx, resolvedType, params.prompt, {
            ...options,
            isBackground: true
          });
          attachTranscript(id);
          await context.manager.awaitStartup(id);
          return textResult(`Nested agent started in background. Agent ID: ${id}`);
        }
        const { record } = await context.manager.spawnAndWait(context.pi, ctx, resolvedType, params.prompt, { ...options, signal }, attachTranscript);
        return textResult(formatRecord(record, "inline"), record.status === "error");
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    }
  });
  const resultTool = defineTool({
    name: NESTED_TOOL_NAMES[1],
    label: "Get Nested Agent Result",
    description: "Check or wait for a background nested agent owned by this parent.",
    parameters: Type2.Object({
      agent_id: Type2.String(),
      wait: Type2.Optional(Type2.Boolean())
    }),
    execute: async (_toolCallId, params, signal) => {
      const record = context.manager.getRecord(params.agent_id);
      if (!ownsRecord(record, context.parentAgentId)) {
        return textResult(`Nested agent not found or not owned by this parent: "${params.agent_id}".`, true);
      }
      if (params.wait && (record.status === "queued" || record.status === "running")) {
        while (record.status === "queued") {
          await abortable(new Promise((resolve2) => setTimeout(resolve2, 250)), signal);
        }
        if (record.promise)
          await abortable(record.promise, signal);
      }
      return textResult(formatRecord(record, "fetched"), record.status === "error");
    }
  });
  const steerTool = defineTool({
    name: NESTED_TOOL_NAMES[2],
    label: "Steer Nested Agent",
    description: "Send guidance to a running nested agent owned by this parent.",
    parameters: Type2.Object({
      agent_id: Type2.String(),
      message: Type2.String()
    }),
    execute: async (_toolCallId, params) => {
      const record = context.manager.getRecord(params.agent_id);
      if (!ownsRecord(record, context.parentAgentId) || record.status !== "running") {
        return textResult(`Running nested agent not found or not owned by this parent: "${params.agent_id}".`, true);
      }
      if (!record.session) {
        if (!record.pendingSteers)
          record.pendingSteers = [];
        record.pendingSteers.push(params.message);
        return textResult(`Steering message queued for nested agent ${params.agent_id}.`);
      }
      try {
        await record.session.steer(params.message);
      } catch (err) {
        return textResult(`Failed to steer nested agent: ${err instanceof Error ? err.message : String(err)}`, true);
      }
      return textResult(`Steering message sent to nested agent ${params.agent_id}.`);
    }
  });
  return [agentTool, resultTool, steerTool];
}
var maxSubagentDepth = 2, NESTED_TOOL_NAMES;
var init_nested_tools = __esm(() => {
  init_agent_types();
  init_custom_agents();
  init_invocation_config();
  init_model_resolver();
  init_model_scope();
  init_output_file();
  init_worktree();
  NESTED_TOOL_NAMES = ["Agent", "get_subagent_result", "steer_subagent"];
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/prompts.ts
function buildAgentPrompt(config, cwd, env, parentSystemPrompt, extras) {
  const activeAgentTag = `<active_agent name="${config.name}"/>

`;
  const envBlock = `# Environment
Working directory: ${cwd}
${env.isGitRepo ? `Git repository: yes
Branch: ${env.branch}` : "Not a git repository"}
Platform: ${env.platform}`;
  const worktreeBlock = extras?.worktreeBase ? `

<worktree_isolation>
Your working directory is an isolated git worktree copy of ${extras.worktreeBase}.
Work only inside it — never in ${extras.worktreeBase}, even if other instructions name that path as your working directory.
</worktree_isolation>` : "";
  const workflowBlock = extras?.workflowChild ? `

<workflow_child>
Your final message IS the return value of this task. A workflow script captures it and passes it to the next stage; no person reads it.
Return only the answer, in exactly the shape the prompt asks for — no preamble, no summary of what you did, no offer to continue.
</workflow_child>` : "";
  const extraSections = [];
  if (extras?.memoryBlock) {
    extraSections.push(extras.memoryBlock);
  }
  if (extras?.skillBlocks?.length) {
    for (const skill of extras.skillBlocks) {
      extraSections.push(`
# Preloaded Skill: ${skill.name}
${skill.content}`);
    }
  }
  const extrasSuffix = extraSections.length > 0 ? `

` + extraSections.join(`
`) : "";
  if (config.promptMode === "append") {
    const identity = parentSystemPrompt || genericBase;
    const bridge = `<sub_agent_context>
You are operating as a sub-agent invoked to handle a specific task.
- Use the read tool instead of cat/head/tail
- Use the edit tool instead of sed/awk
- Use the write tool instead of echo/heredoc
- Use the find tool instead of bash find/ls for file search
- Use the grep tool instead of bash grep/rg for content search
- Make independent tool calls in parallel
- Use absolute file paths
- Do not use emojis
- Be concise but complete
</sub_agent_context>`;
    const customSection = config.systemPrompt?.trim() ? `

<agent_instructions>
${config.systemPrompt}
</agent_instructions>` : "";
    return identity + `

` + bridge + `

` + activeAgentTag + envBlock + worktreeBlock + workflowBlock + customSection + extrasSuffix;
  }
  const replaceHeader = `You are a pi coding agent sub-agent.
You have been invoked to handle a specific task autonomously.

${envBlock}`;
  return activeAgentTag + replaceHeader + worktreeBlock + workflowBlock + `

` + config.systemPrompt + extrasSuffix;
}
function inheritableParentPrompt(rendered, cwd) {
  const cwdAt = rendered.lastIndexOf(`

<cwd>
${cwd.replace(/\\/g, "/")}
</cwd>`);
  if (cwdAt < 0)
    return rendered;
  const head = rendered.slice(0, cwdAt);
  if (!head.endsWith(`
</skills>`))
    return head;
  const skillsAt = head.lastIndexOf(`

<skills>
`);
  return skillsAt < 0 ? head : head.slice(0, skillsAt);
}
var genericBase = `# Role
You are a general-purpose coding agent for complex, multi-step tasks.
You have full access to read, write, edit files, and execute commands.
Do what has been asked; nothing more, nothing less.`;

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/skill-loader.ts
import { existsSync as existsSync8, readdirSync as readdirSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join8 } from "node:path";
import { getAgentDir as getAgentDir6 } from "@earendil-works/pi-coding-agent";
function preloadSkills(skillNames, cwd) {
  return skillNames.map((name) => ({ name, content: loadSkillContent(name, cwd) }));
}
function loadSkillContent(name, cwd) {
  if (isUnsafeName(name)) {
    return `(Skill "${name}" skipped: name contains path traversal characters)`;
  }
  const roots = [
    join8(cwd, ".pi", "skills"),
    join8(cwd, ".agents", "skills"),
    join8(getAgentDir6(), "skills"),
    join8(homedir2(), ".agents", "skills"),
    join8(homedir2(), ".pi", "skills")
  ];
  for (const root of roots) {
    const content = findInRoot(root, name);
    if (content !== undefined)
      return content;
  }
  return `(Skill "${name}" not found in .pi/skills/, .agents/skills/, or global skill locations)`;
}
function findInRoot(root, name) {
  if (isSymlink(root))
    return;
  const flat = safeReadFile(join8(root, `${name}.md`))?.trim();
  if (flat !== undefined)
    return flat;
  return findSkillDirectory(root, name);
}
function findSkillDirectory(root, name) {
  if (!existsSync8(root))
    return;
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined)
      continue;
    let entries;
    try {
      entries = readdirSync2(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (!entry.isDirectory())
        continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules")
        continue;
      const path = join8(current, entry.name);
      const skillMd = join8(path, "SKILL.md");
      const isSkillDir = existsSync8(skillMd);
      if (isSkillDir) {
        if (entry.name === name) {
          const content = safeReadFile(skillMd)?.trim();
          if (content !== undefined)
            return content;
        }
        continue;
      }
      queue.push(path);
    }
  }
  return;
}
var init_skill_loader = __esm(() => {
  init_memory();
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/structured-output.ts
import { defineTool as defineTool2 } from "@earendil-works/pi-coding-agent";
function createStructuredCapture() {
  return { called: false };
}
function createStructuredOutputTool(compiled, capture) {
  return defineTool2({
    name: STRUCTURED_OUTPUT_TOOL_NAME,
    label: "Structured Output",
    description: "Report your final answer. Call this exactly once, with the complete result, and put everything the " + "caller needs inside the arguments — text written outside this call is discarded. If a call is " + "rejected for not matching the schema, fix the reported fields and call it again.",
    promptSnippet: "Report your final answer as structured data",
    promptGuidelines: [
      "Your final answer MUST be reported by calling StructuredOutput. Prose outside that call is discarded."
    ],
    parameters: compiled.schema,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    prepareArguments: (args) => {
      if (typeof args !== "string")
        return args;
      try {
        return JSON.parse(args);
      } catch {
        return args;
      }
    },
    execute: async (_toolCallId, params) => {
      capture.called = true;
      const verdict = compiled.check(params);
      if (verdict !== true) {
        capture.lastError = verdict;
        return {
          content: [{
            type: "text",
            text: `StructuredOutput did not match the required schema:
${verdict}
Call it again with a corrected value.`
          }],
          isError: true,
          details: {}
        };
      }
      capture.json = JSON.stringify(params);
      capture.lastError = undefined;
      return { content: [{ type: "text", text: "Recorded." }], details: {} };
    }
  });
}
function structuredRetryPrompt(capture) {
  const reason = capture.called && capture.lastError !== undefined ? `Your last ${STRUCTURED_OUTPUT_TOOL_NAME} call did not match the required schema: ${capture.lastError}` : `You did not call ${STRUCTURED_OUTPUT_TOOL_NAME}, so your answer was not recorded.`;
  return `${reason}

Call ${STRUCTURED_OUTPUT_TOOL_NAME} now with your complete final answer. Do not reply with prose.`;
}
var STRUCTURED_OUTPUT_TOOL_NAME = "StructuredOutput";
var init_structured_output = () => {};

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/agent-runner.ts
import { readFileSync as readFileSync5 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { basename as basename3, dirname as dirname2, isAbsolute as isAbsolute2, join as join9, resolve as resolve2, sep as sep3 } from "node:path";
import {
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  getAgentDir as getAgentDir7,
  SessionManager,
  SettingsManager as SettingsManager2
} from "@earendil-works/pi-coding-agent";
function extensionCanonicalName(extPath) {
  const base = basename3(extPath);
  const name = base === "index.ts" || base === "index.js" ? basename3(dirname2(extPath)) : base.replace(/\.(ts|js)$/, "");
  return name.toLowerCase();
}
function extensionPackageName(extPath) {
  if (extPath.startsWith("builtin:"))
    return;
  const entry = resolve2(extPath);
  let dir = dirname2(extPath);
  for (;; ) {
    if (basename3(dir) === "node_modules")
      return;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync5(join9(dir, "package.json"), "utf-8"));
    } catch {
      const parent = dirname2(dir);
      if (parent === dir)
        return;
      dir = parent;
      continue;
    }
    const entries = pkg.pi?.extensions;
    if (typeof pkg.name === "string" && Array.isArray(entries) && entries.some((e) => {
      if (typeof e !== "string")
        return false;
      const declared = resolve2(dir, e);
      return declared === entry || entry.startsWith(`${declared}${sep3}`);
    })) {
      const short = pkg.name.startsWith("@") ? pkg.name.slice(pkg.name.indexOf("/") + 1) : pkg.name;
      return short.toLowerCase();
    }
    return;
  }
}
function extensionCanonicalNames(extPath) {
  const canonical = extensionCanonicalName(extPath);
  const pkg = extensionPackageName(extPath);
  return pkg && pkg !== canonical ? [canonical, pkg] : [canonical];
}
function parseExtensionsSpec(entries, cwd) {
  const names = new Set;
  const paths = [];
  let wildcard = false;
  for (const entry of entries) {
    if (!entry)
      continue;
    if (entry === "*") {
      wildcard = true;
      continue;
    }
    const isPathEntry = entry.includes("/") || entry.includes("\\") || entry.startsWith("~");
    if (!isPathEntry) {
      names.add(entry.toLowerCase());
      continue;
    }
    let p = entry;
    if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) {
      p = homedir3() + p.slice(1);
    }
    const abs = isAbsolute2(p) ? p : resolve2(cwd, p);
    paths.push(abs);
    names.add(extensionCanonicalName(abs));
  }
  return { names, paths, wildcard };
}
function parseExtSelectors(entries) {
  const extNames = new Set;
  const narrowing = new Map;
  for (const raw of entries) {
    if (!raw)
      continue;
    const body = raw.slice("ext:".length);
    const slash = body.indexOf("/");
    const name = (slash === -1 ? body : body.slice(0, slash)).trim().toLowerCase();
    if (!name)
      continue;
    extNames.add(name);
    if (slash === -1)
      continue;
    const tool = body.slice(slash + 1).trim();
    if (!tool)
      continue;
    let set = narrowing.get(name);
    if (!set) {
      set = new Set;
      narrowing.set(name, set);
    }
    set.add(tool);
  }
  return { extNames, narrowing };
}
function matchesToolPattern(name, patterns) {
  return patterns.some((p) => p.includes("*") ? new RegExp(`^${p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(name) : p === name);
}
function installExtensionToolScope(session, ctx) {
  const { loader, toolNames, disallowedSet, extNames, narrowing, mcpToolPatterns, readmitToolNames, nestedCallGate } = ctx;
  const inScope = () => {
    const keep = new Set(toolNames.filter((t) => !disallowedSet?.has(t)));
    const optInActive = extNames.size > 0;
    for (const extension of loader.getExtensions().extensions) {
      const canons = extensionCanonicalNames(extension.path);
      if (optInActive && !canons.some((c) => extNames.has(c)))
        continue;
      const narrowed = canons.map((c) => narrowing.get(c)).find(Boolean);
      for (const name of extension.tools.keys()) {
        if (narrowed && !narrowed.has(name))
          continue;
        if (disallowedSet?.has(name))
          continue;
        keep.add(name);
      }
    }
    if (mcpToolPatterns) {
      for (const name of keep) {
        if (isMcpToolName(name) && !matchesToolPattern(name, mcpToolPatterns))
          keep.delete(name);
      }
      for (const extension of loader.getExtensions().extensions) {
        for (const name of extension.tools.keys()) {
          if (disallowedSet?.has(name))
            continue;
          if (MCP_BRIDGE_TOOL_NAMES.has(name) || matchesToolPattern(name, mcpToolPatterns))
            keep.add(name);
        }
      }
    }
    for (const name of EXCLUDED_TOOL_NAMES)
      keep.delete(name);
    for (const name of readmitToolNames)
      keep.add(name);
    return keep;
  };
  const named = new Set([
    ...toolNames,
    ...readmitToolNames,
    ...[...narrowing.values()].flatMap((s) => [...s]),
    ...(mcpToolPatterns ?? []).filter((p) => !p.includes("*"))
  ]);
  const renarrow = () => {
    const allowed = inScope();
    const current = session.getActiveToolNames();
    const active = new Set(current);
    const next = session.getAllTools().filter(({ name, exposure = "direct" }) => {
      if (!allowed.has(name))
        return false;
      if (active.has(name))
        return true;
      if (exposure !== "direct" && exposure !== "model-only")
        return false;
      return named.has(name) || session.getToolDefinition(name)?.defaultActive !== false;
    }).map((t) => t.name);
    if (next.length !== current.length || next.some((n, i) => n !== current[i])) {
      session.setActiveToolsByName(next);
    }
  };
  renarrow();
  session.subscribe((event) => {
    if (event.type === "turn_end")
      renarrow();
  });
  nestedCallGate.allows = (name) => inScope().has(name);
  const priorBeforeToolCall = session.agent.beforeToolCall;
  session.agent.beforeToolCall = async (context, signal) => {
    if (!inScope().has(context.toolCall.name)) {
      return {
        block: true,
        reason: `Tool "${context.toolCall.name}" is not available to this subagent.`
      };
    }
    return priorBeforeToolCall?.(context, signal);
  };
}
function scopeGateExtension(gate) {
  return {
    name: SCOPE_GATE_NAME,
    hidden: true,
    factory: (ext) => {
      ext.on("tool_call", (event) => gate.allows?.(event.toolName) === false ? { block: true, reason: `Tool "${event.toolName}" is not available to this subagent.` } : undefined);
    }
  };
}
function normalizeMaxTurns(n) {
  if (n == null || n === 0)
    return;
  return Math.max(1, n);
}
function getDefaultMaxTurns() {
  return defaultMaxTurns;
}
function setDefaultMaxTurns(n) {
  defaultMaxTurns = normalizeMaxTurns(n);
}
function resolveEffectiveMaxTurns(type, explicit) {
  return normalizeMaxTurns(explicit ?? getAgentConfig(type)?.maxTurns ?? defaultMaxTurns);
}
function getRememberAgents() {
  return rememberAgents;
}
function setRememberAgents(b) {
  rememberAgents = b;
}
function getGraceTurns() {
  return graceTurns;
}
function setGraceTurns(n) {
  graceTurns = Math.max(1, n);
}
function resolveDefaultModel(parentModel, registry, configModel) {
  if (configModel) {
    const trimmed = configModel.trim();
    if (!trimmed || trimmed.toLowerCase() === "inherit")
      return parentModel;
    const tierMatch = parseTierSelector(trimmed);
    if (tierMatch) {
      return resolveFamilyTierModel(tierMatch, registry, parentModel) ?? parentModel;
    }
    const slashIdx = trimmed.indexOf("/");
    if (slashIdx !== -1) {
      const provider = trimmed.slice(0, slashIdx);
      const modelId = trimmed.slice(slashIdx + 1);
      const available = registry.getAvailable?.();
      const availableKeys = available ? new Set(available.map((m) => `${m.provider}/${m.id}`)) : undefined;
      const isAvailable = (p, id) => !availableKeys || availableKeys.has(`${p}/${id}`);
      const found = registry.find(provider, modelId);
      if (found && isAvailable(provider, modelId))
        return found;
    }
  }
  return parentModel;
}
function collectResponseText(session) {
  let text = "";
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_start" && event.message.role === "assistant") {
      text = "";
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      text += event.assistantMessageEvent.delta;
    }
  });
  return { getText: () => text, unsubscribe };
}
function getLastAssistantText(session, startIndex = 0) {
  for (let i = session.messages.length - 1;i >= startIndex; i--) {
    const msg = session.messages[i];
    if (msg.role !== "assistant")
      continue;
    const text = extractText(msg.content).trim();
    if (text)
      return text;
  }
  return "";
}
function finalTurnError(session, startIndex = 0) {
  for (let i = session.messages.length - 1;i >= startIndex; i--) {
    const msg = session.messages[i];
    if (msg.role !== "assistant")
      continue;
    if (msg.stopReason === "error") {
      return msg.errorMessage?.trim() || "provider error with no output";
    }
    if (msg.stopReason === "length" && !extractText(msg.content).trim()) {
      return "run hit the output token limit before producing any text";
    }
    return;
  }
  return;
}
function observeRun(session, options) {
  let turnCount = 0;
  let currentMessageText = "";
  const run = {
    steered: false,
    aborted: false,
    unsubscribe: () => {}
  };
  run.unsubscribe = session.subscribe((event) => {
    if (event.type === "turn_end") {
      turnCount++;
      options.onTurnEnd?.(turnCount);
      if (options.maxTurns != null) {
        if (!run.steered && turnCount >= options.maxTurns) {
          run.steered = true;
          session.steer("You have reached your turn limit. Wrap up immediately — provide your final answer now.");
        } else if (run.steered && turnCount >= options.maxTurns + graceTurns) {
          run.aborted = true;
          session.abort();
        }
      }
    }
    if (event.type === "message_start") {
      currentMessageText = "";
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      currentMessageText += event.assistantMessageEvent.delta;
      options.onTextDelta?.(event.assistantMessageEvent.delta, currentMessageText);
    }
    if (event.type === "tool_execution_start") {
      options.onToolActivity?.({ type: "start", toolName: event.toolName });
    }
    if (event.type === "tool_execution_end") {
      options.onToolActivity?.({ type: "end", toolName: event.toolName });
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const u = event.message.usage;
      if (u)
        options.onAssistantUsage?.({
          input: u.input ?? 0,
          output: u.output ?? 0,
          cacheWrite: u.cacheWrite ?? 0,
          cacheRead: u.cacheRead ?? 0,
          cost: u.cost?.total ?? 0
        });
    }
    if (event.type === "compaction_end" && !event.aborted && event.result) {
      options.onCompaction?.({ reason: event.reason, tokensBefore: event.result.tokensBefore });
    }
  });
  return run;
}
function forwardAbortSignal(session, signal) {
  if (!signal)
    return () => {};
  const onAbort = () => session.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}
function resolveConfiguredSessionDir(sessionDir, cwd) {
  if (!sessionDir)
    return;
  if (sessionDir === "~" || sessionDir.startsWith("~/"))
    return resolve2(homedir3(), sessionDir.slice(2));
  if (isAbsolute2(sessionDir))
    return sessionDir;
  return resolve2(cwd, sessionDir);
}
function reopenSession(file, parentSessionFile, sessionDir) {
  const opened = SessionManager.open(file, sessionDir);
  const owner = opened.getHeader()?.parentSession;
  if (owner === undefined || owner === parentSessionFile)
    return opened;
  return SessionManager.forkFrom(file, opened.getCwd(), sessionDir, { parentSession: parentSessionFile });
}
async function runAgent(ctx, type, prompt, options) {
  const config = getConfig(type);
  const agentConfig = getAgentConfig(type);
  const effectiveCwd = options.cwd ?? ctx.cwd;
  const configCwd = options.configCwd ?? effectiveCwd;
  const env = await detectEnv(options.pi, effectiveCwd);
  const parentSystemPrompt = inheritableParentPrompt(ctx.getSystemPrompt(), ctx.cwd);
  const extras = {};
  if (options.worktreeBase)
    extras.worktreeBase = options.worktreeBase;
  if (options.workflow && !options.structuredOutput)
    extras.workflowChild = true;
  const isolated = agentConfig?.isolated ?? options.isolated;
  const extensions = isolated ? false : config.extensions;
  const excludeExtensions = isolated ? undefined : config.excludeExtensions;
  const skills = isolated ? false : config.skills;
  if (Array.isArray(skills)) {
    const loaded = preloadSkills(skills, configCwd);
    if (loaded.length > 0) {
      extras.skillBlocks = loaded;
    }
  }
  let toolNames = getToolNamesForType(type);
  if (agentConfig?.memory) {
    const existingNames = new Set(toolNames);
    const denied = agentConfig.disallowedTools ? new Set(agentConfig.disallowedTools) : undefined;
    const effectivelyHas = (name) => existingNames.has(name) && !denied?.has(name);
    const hasWriteTools = effectivelyHas("write") || effectivelyHas("edit");
    if (hasWriteTools) {
      const extraNames = getMemoryToolNames(existingNames);
      if (extraNames.length > 0)
        toolNames = [...toolNames, ...extraNames];
      extras.memoryBlock = buildMemoryBlock(agentConfig.name, agentConfig.memory, configCwd);
    } else {
      const extraNames = getReadOnlyMemoryToolNames(existingNames);
      if (extraNames.length > 0)
        toolNames = [...toolNames, ...extraNames];
      extras.memoryBlock = buildReadOnlyMemoryBlock(agentConfig.name, agentConfig.memory, configCwd);
    }
  }
  let systemPrompt;
  if (agentConfig) {
    systemPrompt = buildAgentPrompt(agentConfig, effectiveCwd, env, parentSystemPrompt, extras);
  } else {
    const fallback = DEFAULT_AGENTS.get("general-purpose");
    if (!fallback)
      throw new Error(`No fallback config available for unknown type "${type}"`);
    systemPrompt = buildAgentPrompt({ ...fallback, name: type }, effectiveCwd, env, parentSystemPrompt, extras);
  }
  const noSkills = skills === false || Array.isArray(skills);
  const agentDir = getAgentDir7();
  const { extNames, narrowing } = parseExtSelectors(isolated ? [] : agentConfig?.extSelectors ?? []);
  const noExtensions = extensions === false;
  const extensionsSpec = Array.isArray(extensions) ? parseExtensionsSpec(extensions, configCwd) : undefined;
  const keepNames = extensionsSpec?.names ?? new Set;
  const excludeNames = new Set((excludeExtensions ?? []).map((n) => n.toLowerCase()));
  const hasExcludes = excludeNames.size > 0;
  const loadAll = extensions === true || extensionsSpec?.wildcard === true;
  const additionalExtensionPaths = extensionsSpec?.paths.length ? extensionsSpec.paths : undefined;
  let discoveredNames;
  const extensionsOverride = noExtensions || loadAll && !hasExcludes ? undefined : (base) => {
    discoveredNames = new Set(base.extensions.flatMap((e) => extensionCanonicalNames(e.path)));
    return {
      ...base,
      extensions: base.extensions.filter((e) => {
        if (e.path === `<inline:${SCOPE_GATE_NAME}>`)
          return true;
        const canons = extensionCanonicalNames(e.path);
        if (canons.some((n) => excludeNames.has(n)))
          return false;
        return loadAll || canons.some((n) => keepNames.has(n));
      })
    };
  };
  const projectTrusted = ctx.isProjectTrusted();
  const settingsManager = SettingsManager2.create(configCwd, agentDir, { projectTrusted });
  const sessionSettingsManager = resolve2(effectiveCwd) === resolve2(configCwd) ? settingsManager : Object.assign(SettingsManager2.create(configCwd, agentDir, { projectTrusted }), {
    isProjectTrusted: () => false
  });
  const nestedCallGate = {};
  const loader = new DefaultResourceLoader({
    settingsManager,
    extensionFactories: [
      { name: "codemode", factory: createCodemodeExtension(), builtin: true, replaceable: true },
      { name: "tool-search", factory: createToolSearchExtension(), builtin: true, replaceable: true },
      { name: "mcp", factory: createMcpExtension(), builtin: true, replaceable: true },
      ...noExtensions ? [] : [scopeGateExtension(nestedCallGate)]
    ],
    disabledBuiltinExtensions: process.argv.some((a) => a === "--no-extensions" || a === "-ne") ? ["codemode", "tool-search", "mcp"] : process.argv.includes("--no-mcp") ? ["mcp"] : undefined,
    cwd: configCwd,
    agentDir,
    noExtensions,
    additionalExtensionPaths,
    extensionsOverride,
    noSkills,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => []
  });
  await runInChildSessionContext(() => loader.reload());
  if (agentConfig?.builtinToolNames?.length) {
    const knownBuiltins = new Set(BUILTIN_TOOL_NAMES);
    for (const name of agentConfig.builtinToolNames) {
      if (!knownBuiltins.has(name)) {
        options.onToolActivity?.({
          type: "end",
          toolName: `tools-error:tool "${name}" requested by agent "${type}" is not a known built-in`
        });
      }
    }
  }
  if (agentConfig?.mcpToolPatterns && noExtensions) {
    options.onToolActivity?.({
      type: "end",
      toolName: `tools-error:${agentConfig.mcpToolPatterns.join(", ")} requested by agent "${type}" need extensions, but it loads none`
    });
  }
  if (hasExcludes && noExtensions) {
    options.onToolActivity?.({
      type: "end",
      toolName: `extension-error:exclude_extensions has no effect for agent "${type}" — extensions: false loads nothing`
    });
  }
  if (hasExcludes && discoveredNames) {
    for (const name of excludeNames) {
      if (!discoveredNames.has(name)) {
        options.onToolActivity?.({
          type: "end",
          toolName: `extension-error:exclude_extensions: "${name}" for agent "${type}" did not match any discovered extension`
        });
      }
    }
  }
  if (keepNames.size > 0 || extNames.size > 0) {
    const survivingNames = new Set(loader.getExtensions().extensions.flatMap((e) => extensionCanonicalNames(e.path)));
    for (const name of keepNames) {
      if (!survivingNames.has(name)) {
        options.onToolActivity?.({
          type: "end",
          toolName: excludeNames.has(name) ? `extension-error:extension "${name}" is in both extensions: and exclude_extensions: for agent "${type}" — exclude wins` : `extension-error:extension "${name}" requested by agent "${type}" was not loaded`
        });
      }
    }
    for (const name of extNames) {
      if (!survivingNames.has(name)) {
        options.onToolActivity?.({
          type: "end",
          toolName: `extension-error:ext:${name} referenced by agent "${type}" but extension "${name}" is not loaded (check extensions:/exclude_extensions:)`
        });
      }
    }
  }
  const model = options.model ?? resolveDefaultModel(ctx.model, ctx.modelRegistry, agentConfig?.model);
  const thinkingLevel = options.thinkingLevel ?? agentConfig?.thinking ?? ctx.thinkingLevel;
  const disallowedSet = agentConfig?.disallowedTools ? new Set(agentConfig.disallowedTools) : undefined;
  const effectiveMaxDepth = options.nestedRuntime?.maxSubagentDepth ?? getMaxSubagentDepth();
  const nestedRuntime = options.nestedRuntime && options.nestedRuntime.depth < effectiveMaxDepth ? options.nestedRuntime : undefined;
  const nestedTools = agentConfig?.allowedSubagents && nestedRuntime && !isolated ? createNestedSubagentTools({
    manager: nestedRuntime.manager,
    pi: options.pi,
    parentAgentId: nestedRuntime.parentAgentId,
    depth: nestedRuntime.depth,
    maxSubagentDepth: effectiveMaxDepth,
    allowedSubagents: agentConfig.allowedSubagents,
    configCwd
  }) : [];
  const nestedToolNames = new Set(nestedTools.map((tool) => tool.name));
  const structuredCapture = options.structuredOutput ? createStructuredCapture() : undefined;
  const structuredTools = options.structuredOutput && structuredCapture ? [createStructuredOutputTool(options.structuredOutput, structuredCapture)] : [];
  const structuredToolNames = new Set(structuredTools.map((tool) => tool.name));
  const readmitToolNames = new Set([
    ...[...nestedToolNames].filter((name) => !disallowedSet?.has(name)),
    ...structuredToolNames
  ]);
  const loadedNames = new Set(loader.getExtensions().extensions.filter((e) => e.path !== `<inline:${SCOPE_GATE_NAME}>`).flatMap((e) => extensionCanonicalNames(e.path)));
  const unrecognized = agentConfig?.builtinToolNames?.filter((n) => !BUILTIN_TOOL_NAMES.includes(n)) ?? [];
  const unmatched = [...extNames].filter((n) => !loadedNames.has(n));
  const extensionToolsPossible = loadedNames.size > 0 && (extNames.size === 0 || unmatched.length < extNames.size || !!agentConfig?.mcpToolPatterns);
  if ((unrecognized.length > 0 || unmatched.length > 0) && toolNames.every((n) => !BUILTIN_TOOL_NAMES.includes(n) || disallowedSet?.has(n)) && readmitToolNames.size === 0 && !extensionToolsPossible) {
    const reasons = [
      unrecognized.length > 0 ? `unrecognized [${unrecognized.join(", ")}]` : "",
      unmatched.length > 0 ? `recognized but matched no tools in this session [${unmatched.map((n) => `ext:${n}`).join(", ")}]` : ""
    ].filter(Boolean);
    throw new Error(`Agent '${type}' would be spawned with zero tools — refusing. Its tools list resolved to nothing: ` + `${reasons.join("; ")}. Fix the agent's tools frontmatter or pass a different subagent_type.`);
  }
  const builtinToolNameSet = new Set(toolNames);
  let sessionTools;
  let sessionExcludeTools;
  if (noExtensions) {
    sessionTools = [
      ...toolNames.filter((t) => !EXCLUDED_TOOL_NAMES.includes(t) && !disallowedSet?.has(t)),
      ...[...nestedToolNames].filter((t) => !disallowedSet?.has(t)),
      ...structuredToolNames
    ];
  } else {
    const denyTools = new Set(EXCLUDED_TOOL_NAMES.filter((t) => !nestedToolNames.has(t)));
    for (const name of BUILTIN_TOOL_NAMES) {
      if (!builtinToolNameSet.has(name))
        denyTools.add(name);
    }
    if (disallowedSet) {
      for (const name of disallowedSet) {
        if (!structuredToolNames.has(name))
          denyTools.add(name);
      }
    }
    sessionExcludeTools = [...denyTools];
  }
  const configuredSessionDir = resolveConfiguredSessionDir(agentConfig?.sessionDir, effectiveCwd);
  const defaultSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR ?? settingsManager.getSessionDir?.();
  const persistSession = agentConfig?.persistSession ?? (options.nested ? false : rememberAgents);
  const parentSessionFile = ctx.sessionManager?.getSessionFile?.();
  const sessionManager = options.resumeSessionFile ? reopenSession(options.resumeSessionFile, parentSessionFile, configuredSessionDir ?? defaultSessionDir) : persistSession ? SessionManager.create(effectiveCwd, configuredSessionDir ?? defaultSessionDir, {
    parentSession: parentSessionFile
  }) : SessionManager.inMemory(effectiveCwd);
  const parentModelRuntime = ctx.modelRegistry.runtime;
  const sessionOpts = {
    cwd: effectiveCwd,
    agentDir,
    sessionManager,
    settingsManager: sessionSettingsManager,
    modelRegistry: ctx.modelRegistry,
    ...parentModelRuntime !== undefined && { modelRuntime: parentModelRuntime },
    model,
    tools: sessionTools,
    customTools: [...nestedTools, ...structuredTools],
    resourceLoader: loader
  };
  if (sessionExcludeTools) {
    sessionOpts.excludeTools = sessionExcludeTools;
  }
  if (thinkingLevel) {
    sessionOpts.thinkingLevel = thinkingLevel;
  }
  const { session } = await runInChildSessionContext(() => createAgentSession(sessionOpts));
  const baseSessionName = agentConfig?.name ?? type;
  session.setSessionName(options.agentId ? `${baseSessionName}#${options.agentId.slice(0, 8)}` : baseSessionName);
  await session.bindExtensions({
    onError: (err) => {
      options.onToolActivity?.({
        type: "end",
        toolName: `extension-error:${err.extensionPath}`
      });
    }
  });
  if (!noExtensions) {
    installExtensionToolScope(session, {
      loader,
      toolNames,
      disallowedSet,
      extNames,
      narrowing,
      mcpToolPatterns: isolated ? undefined : agentConfig?.mcpToolPatterns,
      readmitToolNames,
      nestedCallGate
    });
  }
  options.onSessionCreated?.(session);
  const run = observeRun(session, { ...options, maxTurns: resolveEffectiveMaxTurns(type, options.maxTurns) });
  const collector = collectResponseText(session);
  const cleanupAbort = forwardAbortSignal(session, options.signal);
  let effectivePrompt = prompt;
  if (options.inheritContext && !options.resumeSessionFile) {
    const parentContext = buildParentContext(ctx);
    if (parentContext) {
      effectivePrompt = parentContext + prompt;
    }
  }
  const startLen = session.messages.length;
  let structuredRetried = false;
  try {
    if (options.signal?.aborted !== true)
      await session.prompt(effectivePrompt);
    if (structuredCapture !== undefined && structuredCapture.json === undefined && !run.aborted && options.signal?.aborted !== true) {
      structuredRetried = true;
      await session.prompt(structuredRetryPrompt(structuredCapture));
    }
  } finally {
    run.unsubscribe();
    collector.unsubscribe();
    cleanupAbort();
  }
  const responseText = collector.getText().trim() || getLastAssistantText(session, startLen);
  const structuredFailure = structuredCapture !== undefined && structuredCapture.json === undefined ? structuredCapture.lastError !== undefined ? `The agent's StructuredOutput call did not match the required schema: ${structuredCapture.lastError}` : "The agent did not report its answer through StructuredOutput." : undefined;
  return {
    responseText,
    session,
    aborted: run.aborted,
    steered: run.steered,
    failure: finalTurnError(session, startLen) ?? structuredFailure,
    ...structuredCapture?.json !== undefined ? { structuredJson: structuredCapture.json } : {},
    ...structuredRetried ? { structuredRetried } : {}
  };
}
async function resumeAgent(session, prompt, options) {
  const startLen = session.messages.length;
  const collector = collectResponseText(session);
  const cleanupAbort = forwardAbortSignal(session, options.signal);
  const run = observeRun(session, { ...options, maxTurns: resolveEffectiveMaxTurns(options.type, options.maxTurns) });
  try {
    if (options.signal?.aborted !== true)
      await session.prompt(prompt);
  } finally {
    collector.unsubscribe();
    run.unsubscribe();
    cleanupAbort();
  }
  return {
    text: collector.getText().trim() || getLastAssistantText(session, startLen),
    failure: finalTurnError(session, startLen),
    aborted: run.aborted,
    steered: run.steered
  };
}
async function steerAgent(session, message) {
  await session.steer(message);
}
function getAgentConversation(session) {
  const parts = [];
  for (const msg of session.messages) {
    if (msg.role === "user") {
      const text = typeof msg.content === "string" ? msg.content : extractText(msg.content);
      if (text.trim())
        parts.push(`[User]: ${text.trim()}`);
    } else if (msg.role === "assistant") {
      const textParts = [];
      const toolCalls = [];
      for (const c of msg.content) {
        if (c.type === "text" && c.text)
          textParts.push(c.text);
        else if (c.type === "toolCall")
          toolCalls.push(`  Tool: ${c.name ?? c.toolName ?? "unknown"}`);
      }
      if (textParts.length > 0)
        parts.push(`[Assistant]: ${textParts.join(`
`)}`);
      if (toolCalls.length > 0)
        parts.push(`[Tool Calls]:
${toolCalls.join(`
`)}`);
    } else if (msg.role === "toolResult") {
      const text = extractText(msg.content);
      const truncated = text.length > 200 ? text.slice(0, 200) + "..." : text;
      parts.push(`[Tool Result (${msg.toolName})]: ${truncated}`);
    }
  }
  return parts.join(`

`);
}
var SUBAGENT_TOOL_NAMES, EXCLUDED_TOOL_NAMES, MCP_RESOURCE_TOOL_NAMES, MCP_BRIDGE_TOOL_NAMES, isMcpToolName = (name) => name.startsWith("mcp__") || MCP_RESOURCE_TOOL_NAMES.has(name), SCOPE_GATE_NAME = "pi-subagents-scope", defaultMaxTurns, rememberAgents = true, graceTurns = 5;
var init_agent_runner = __esm(() => {
  init_agent_types();
  init_child_context();
  init_default_agents();
  init_model_resolver();
  init_memory();
  init_nested_tools();
  init_skill_loader();
  init_structured_output();
  SUBAGENT_TOOL_NAMES = {
    AGENT: "Agent",
    WORKFLOW: "SubagentWorkflow",
    GET_RESULT: "get_subagent_result",
    STEER: "steer_subagent"
  };
  EXCLUDED_TOOL_NAMES = Object.values(SUBAGENT_TOOL_NAMES);
  MCP_RESOURCE_TOOL_NAMES = new Set(["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]);
  MCP_BRIDGE_TOOL_NAMES = new Set(["codemode", "tool_search"]);
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/mention.ts
function isReservedHandle(handle) {
  return RESERVED_HANDLES.has(handle.toLowerCase());
}
function handleBase(type) {
  const slug = type.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_HANDLE_LENGTH).replace(/-+$/, "");
  return slug || "agent";
}
function assignHandle(base, taken) {
  let candidate = base;
  let n = 1;
  while (taken.has(candidate) || RESERVED_HANDLES.has(candidate)) {
    n++;
    candidate = `${base}-${n}`;
  }
  return candidate;
}
function resolveHandleToType(handle, types) {
  const wanted = handle.toLowerCase();
  if (RESERVED_HANDLES.has(wanted))
    return;
  return types.find((type) => handleBase(type) === wanted);
}
function stripAgentPrefix(handle) {
  const rest = /^agent-(.+)$/i.exec(handle)?.[1];
  return rest || undefined;
}
function describeMention(message) {
  const oneLine = message.split(`
`, 1)[0].replace(/\s+/g, " ").trim();
  return oneLine.length > 40 ? `${oneLine.slice(0, 39).trimEnd()}…` : oneLine;
}
function agentMentionReminder(type) {
  return `<system-reminder>
The user has expressed a desire to invoke the agent "${type}". Please invoke the agent appropriately, passing in the required context to it. 
</system-reminder>`;
}
function parseMention(text) {
  const match = MENTION_SEND.exec(text);
  if (!match)
    return null;
  const message = match[2].trim();
  return message ? { handle: match[1], message } : null;
}
var MENTION_TRIGGER, MENTION_SEND, MAX_HANDLE_LENGTH = 64, RESERVED_HANDLES;
var init_mention = __esm(() => {
  MENTION_TRIGGER = /(^|[\s。、？！])@([\w-]*)$/;
  MENTION_SEND = /^@([\w-]+)\s+([\s\S]+)$/;
  RESERVED_HANDLES = new Set(["main"]);
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/agent-manager.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { statSync as statSync4 } from "node:fs";
import { isAbsolute as isAbsolute3 } from "node:path";
function assertValidSpawnCwd(cwd) {
  if (cwd == null)
    return;
  if (typeof cwd !== "string" || !isAbsolute3(cwd)) {
    throw new Error(`SpawnOptions.cwd must be an absolute path: "${String(cwd)}"`);
  }
  let isDirectory = false;
  try {
    isDirectory = statSync4(cwd).isDirectory();
  } catch {
    throw new Error(`SpawnOptions.cwd does not exist: "${cwd}"`);
  }
  if (!isDirectory) {
    throw new Error(`SpawnOptions.cwd is not a directory: "${cwd}"`);
  }
}
function occupiesPoolSlot(record) {
  return !!record.isBackground && isTopLevelAgent(record);
}
function isTopLevelAgent(record) {
  return record.parentAgentId === undefined && record.workflowId === undefined;
}
function occupiesForegroundSlot(record) {
  return !!record.blocking && isTopLevelAgent(record);
}
async function shutdownChildSession(session) {
  try {
    const runner = session?.extensionRunner;
    if (runner?.hasHandlers?.("session_shutdown")) {
      await Promise.race([
        runner.emit({ type: "session_shutdown", reason: "quit" }),
        new Promise((resolve3) => setTimeout(resolve3, CHILD_SHUTDOWN_TIMEOUT_MS).unref())
      ]);
    }
  } catch {}
  try {
    session?.dispose?.();
  } catch {}
}

class AgentManager {
  agents = new Map;
  cleanupInterval;
  onComplete;
  onStart;
  onCompact;
  onUsage;
  onSteered;
  maxConcurrent;
  maxConcurrentForeground = DEFAULT_MAX_CONCURRENT_FOREGROUND;
  worktreeRepos = new Set;
  startups = new Map;
  tombstones = new Map;
  queue = [];
  runningBackground = 0;
  runningForeground = 0;
  constructor(onComplete, maxConcurrent = DEFAULT_MAX_CONCURRENT, onStart, onCompact, onUsage, onSteered) {
    this.onComplete = onComplete;
    this.onStart = onStart;
    this.onCompact = onCompact;
    this.onUsage = onUsage;
    this.onSteered = onSteered;
    this.maxConcurrent = maxConcurrent;
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    this.cleanupInterval.unref();
  }
  setMaxConcurrent(n) {
    this.maxConcurrent = Math.max(1, n);
    this.drainQueue();
  }
  getMaxConcurrent() {
    return this.maxConcurrent;
  }
  setMaxConcurrentForeground(n) {
    this.maxConcurrentForeground = Math.max(0, n);
    this.drainQueue();
  }
  getMaxConcurrentForeground() {
    return this.maxConcurrentForeground;
  }
  poolFor(record) {
    if (occupiesPoolSlot(record))
      return "background";
    if (this.maxConcurrentForeground > 0 && occupiesForegroundSlot(record))
      return "foreground";
    return;
  }
  poolHasRoom(pool) {
    return pool === "background" ? this.runningBackground < this.maxConcurrent : this.maxConcurrentForeground === 0 || this.runningForeground < this.maxConcurrentForeground;
  }
  spawn(pi, ctx, type, prompt, options) {
    assertValidSpawnCwd(options.cwd);
    if (options.reclaim?.id !== undefined && this.agents.has(options.reclaim.id)) {
      throw new Error(`Agent ${options.reclaim.id} is still in memory, so it cannot be reopened from its saved session.`);
    }
    const id = options.reclaim?.id ?? randomUUID2().slice(0, 17);
    const abortController = new AbortController;
    const record = {
      id,
      type,
      handle: !isTopLevelAgent(options) ? undefined : this.reclaimable(options.reclaim?.handle, options.reclaim?.id) ?? assignHandle(handleBase(type), this.takenHandles()),
      description: options.description,
      alias: isTopLevelAgent(options) ? this.reclaimable(options.reclaim?.alias, options.reclaim?.id) : undefined,
      status: options.isBackground ? "queued" : "running",
      toolUses: 0,
      startedAt: Date.now(),
      abortController,
      lifetimeUsage: { input: 0, output: 0, cacheWrite: 0, cost: 0 },
      compactionCount: 0,
      isBackground: options.isBackground,
      blocking: options.blocking,
      invocation: options.invocation,
      depth: options.depth ?? 1,
      parentAgentId: options.parentAgentId,
      workflowId: options.workflowId,
      maxSubagentDepth: options.maxSubagentDepth,
      rootSessionId: options.rootSessionId,
      sessionFile: options.resumeSessionFile
    };
    this.agents.set(id, record);
    if (record.handle !== undefined && record.alias === undefined && options.name !== undefined) {
      record.alias = assignHandle(handleBase(options.name), this.takenHandles());
    }
    const args = { pi, ctx, type, prompt, options };
    const pool = this.poolFor(record);
    if (pool !== undefined && !options.bypassQueue && !this.poolHasRoom(pool)) {
      record.status = "queued";
      if (!this.armQueuedAbort(id, options.signal))
        return id;
      let release;
      record.startGate = new Promise((resolve3) => {
        release = resolve3;
      });
      this.queue.push({
        id,
        pool,
        start: () => this.launch(id, record, args, pool),
        release: () => release()
      });
      options.onQueued?.(id, this.queue.filter((e) => e.pool === pool).length - 1);
      return id;
    }
    this.launch(id, record, args, undefined);
    return id;
  }
  armQueuedAbort(id, signal) {
    if (signal === undefined)
      return true;
    if (signal.aborted) {
      const record2 = this.agents.get(id);
      if (record2) {
        record2.status = "stopped";
        record2.completedAt = Date.now();
      }
      return false;
    }
    const record = this.agents.get(id);
    if (record)
      this.armParentAbort(record, signal);
    return true;
  }
  armParentAbort(record, signal) {
    this.detachParentAbort(record);
    if (signal === undefined)
      return;
    const onParentAbort = () => this.abort(record.id);
    signal.addEventListener("abort", onParentAbort, { once: true });
    record.detachParentAbort = () => signal.removeEventListener("abort", onParentAbort);
  }
  detachParentAbort(record) {
    record.detachParentAbort?.();
    record.detachParentAbort = undefined;
  }
  chargePool(pool, delta) {
    if (pool === "background")
      this.runningBackground += delta;
    else if (pool === "foreground")
      this.runningForeground += delta;
  }
  launch(id, record, args, queuedPool) {
    const startup = this.startAgent(id, record, args).then(() => {
      this.startups.delete(id);
    }, (err) => {
      this.startups.delete(id);
      if (queuedPool !== undefined) {
        if (queuedPool === "foreground")
          record.resultConsumed = true;
        record.status = "error";
        record.error = err instanceof Error ? err.message : String(err);
        record.completedAt = Date.now();
        this.onComplete?.(record);
      } else {
        this.agents.delete(id);
      }
      this.drainQueue();
      throw err;
    });
    this.startups.set(id, startup);
    return startup.catch(() => {});
  }
  awaitStartup(id) {
    return this.startups.get(id) ?? Promise.resolve();
  }
  async startAgent(id, record, { pi, ctx, type, prompt, options }) {
    assertValidSpawnCwd(options.cwd);
    const customCwd = options.cwd ?? undefined;
    const baseCwd = customCwd ?? ctx.cwd;
    record.chargedPool = this.poolFor(record);
    record.status = "running";
    record.startedAt = Date.now();
    record.startGate = undefined;
    this.chargePool(record.chargedPool, 1);
    const isolation = options.resumeSessionFile !== undefined ? undefined : options.workflowId !== undefined ? options.isolation : getAgentConfig(type)?.isolation ?? options.isolation;
    let worktreeCwd;
    if (isolation === "worktree" && isWorktreeIsolationEnabled()) {
      const wt = await createWorktree(pi, baseCwd, id);
      if (!wt) {
        this.chargePool(record.chargedPool, -1);
        throw new Error('Cannot run with isolation: "worktree" — not a git repo, no commits yet, or `git worktree add` failed. ' + "Initialize git and commit at least once, or omit `isolation`.");
      }
      record.worktree = wt;
      worktreeCwd = customCwd !== undefined ? wt.workPath : wt.path;
      this.worktreeRepos.add(baseCwd);
      record.invocation ??= {};
      record.invocation.isolation = "worktree";
      if (record.status !== "running") {
        this.chargePool(record.chargedPool, -1);
        record.worktreeResult = await cleanupWorktree(pi, baseCwd, wt, options.description);
        this.drainQueue();
        return;
      }
    }
    this.onStart?.(record);
    if (options.signal?.aborted)
      this.abort(id);
    else
      this.armParentAbort(record, options.signal);
    const detach = () => this.detachParentAbort(record);
    const promise = runAgent(ctx, type, prompt, {
      pi,
      agentId: id,
      model: options.model,
      maxTurns: options.maxTurns,
      isolated: options.isolated,
      inheritContext: options.inheritContext,
      thinkingLevel: options.thinkingLevel,
      structuredOutput: options.structuredOutput,
      resumeSessionFile: options.resumeSessionFile,
      nested: options.parentAgentId !== undefined,
      workflow: options.workflowId !== undefined,
      cwd: worktreeCwd ?? customCwd,
      worktreeBase: worktreeCwd ? baseCwd : undefined,
      configCwd: options.configCwd ?? (customCwd !== undefined ? ctx.cwd : undefined),
      signal: record.abortController.signal,
      onToolActivity: (activity) => {
        if (activity.type === "end")
          record.toolUses++;
        options.onToolActivity?.(activity);
      },
      onTurnEnd: options.onTurnEnd,
      onTextDelta: options.onTextDelta,
      onAssistantUsage: (usage) => {
        addUsage(record.lifetimeUsage, usage);
        this.onUsage?.(record, usage);
        options.onAssistantUsage?.(usage);
      },
      onCompaction: (info) => {
        record.compactionCount++;
        this.onCompact?.(record, info);
        options.onCompaction?.(info);
      },
      nestedRuntime: {
        manager: this,
        parentAgentId: id,
        depth: record.depth ?? 1,
        maxSubagentDepth: record.maxSubagentDepth
      },
      onSessionCreated: (session) => {
        record.session = session;
        record.sessionFile = session.sessionManager?.getSessionFile?.();
        if (session.model) {
          record.invocation ??= {};
          const requested = record.invocation.requestedThinking ?? record.invocation.thinking;
          Object.assign(record.invocation, describeModel(session.model));
          if (session.thinkingLevel) {
            record.invocation.thinking = session.thinkingLevel;
            if (requested && requested !== session.thinkingLevel) {
              record.invocation.requestedThinking = requested;
            }
          }
        }
        if (record.pendingSteers?.length) {
          for (const msg of record.pendingSteers) {
            session.steer(msg).catch(() => {});
          }
          record.pendingSteers = undefined;
        }
        options.onSessionCreated?.(session);
      }
    }).then(async ({ responseText, session, aborted, steered, failure, structuredJson, structuredRetried }) => {
      this.settleOutcome(record, { text: responseText, failure, aborted, steered });
      record.structuredJson = structuredJson;
      record.structuredRetried = structuredRetried;
      record.session = session;
      detach();
      if (record.outputCleanup) {
        try {
          record.outputCleanup();
        } catch {}
        record.outputCleanup = undefined;
      }
      if (record.worktree) {
        if (options.onBeforeWorktreeCleanup) {
          try {
            await options.onBeforeWorktreeCleanup(record.worktree.path);
          } catch {}
        }
        const wtResult = await cleanupWorktree(pi, baseCwd, record.worktree, options.description);
        record.worktreeResult = wtResult;
        if (wtResult.hasChanges && wtResult.branch) {
          const repoNote = customCwd !== undefined ? ` in \`${baseCwd}\`` : "";
          record.result = (record.result ?? "") + `

---
Changes saved to branch \`${wtResult.branch}\`${repoNote}. Merge with: \`git merge ${wtResult.branch}\`${customCwd !== undefined ? ` (run in \`${baseCwd}\`)` : ""}`;
        }
      }
      this.abortOwnedChildren(id);
      this.settleRun(record, true);
      return responseText;
    }).catch(async (err) => {
      if (record.status !== "stopped") {
        record.status = "error";
      }
      record.error = err instanceof Error ? err.message : String(err);
      record.completedAt ??= Date.now();
      detach();
      if (record.outputCleanup) {
        try {
          record.outputCleanup();
        } catch {}
        record.outputCleanup = undefined;
      }
      if (record.worktree) {
        try {
          const wtResult = await cleanupWorktree(pi, baseCwd, record.worktree, options.description);
          record.worktreeResult = wtResult;
        } catch {}
      }
      this.abortOwnedChildren(id);
      this.settleRun(record, false);
      return "";
    });
    record.promise = promise;
    options.onSpawned?.(id);
  }
  settleRun(record, guardCallback) {
    if (!record.isBackground)
      record.resultConsumed = true;
    record.blocking = false;
    const pool = record.chargedPool;
    this.chargePool(pool, -1);
    if (guardCallback) {
      try {
        this.onComplete?.(record);
      } catch {}
    } else {
      this.onComplete?.(record);
    }
    if (record.isBackground || pool !== undefined)
      this.drainQueue();
  }
  abortOwnedChildren(parentId) {
    for (const [id, record] of this.agents) {
      if (record.parentAgentId === parentId)
        this.abort(id);
    }
  }
  drainQueue() {
    for (;; ) {
      const i = this.queue.findIndex((e) => this.poolHasRoom(e.pool));
      if (i === -1)
        return;
      const [next] = this.queue.splice(i, 1);
      const record = this.agents.get(next.id);
      if (!record || record.status !== "queued") {
        next.release();
        continue;
      }
      next.start().then(() => next.release(), () => next.release());
    }
  }
  dequeue(pred) {
    const kept = [];
    for (const entry of this.queue) {
      if (pred(entry))
        entry.release();
      else
        kept.push(entry);
    }
    this.queue = kept;
  }
  async spawnAndWait(pi, ctx, type, prompt, options, onSpawned) {
    const id = this.spawn(pi, ctx, type, prompt, {
      ...options,
      isBackground: false,
      blocking: true,
      onSpawned
    });
    const record = this.agents.get(id);
    if (record.status === "queued")
      await record.startGate;
    await this.awaitStartup(id);
    if (record.promise)
      await record.promise;
    if (record.promise === undefined && record.status === "error") {
      throw new Error(record.error ?? "Agent failed to start");
    }
    return { id, record };
  }
  sendToBackground(id) {
    const record = this.agents.get(id);
    if (!record?.blocking || !isTopLevelAgent(record) || record.status !== "running" || !record.promise)
      return false;
    this.detachParentAbort(record);
    this.chargePool(record.chargedPool, -1);
    record.chargedPool = "background";
    this.chargePool(record.chargedPool, 1);
    record.blocking = false;
    record.isBackground = true;
    record.resultConsumed = false;
    this.drainQueue();
    return true;
  }
  async resume(id, prompt, signal, options) {
    const record = this.agents.get(id);
    if (!record?.session)
      return;
    if (options?.isBackground) {
      if (record.status === "running" || record.status === "queued")
        return;
      record.isBackground = true;
      record.resultConsumed = false;
      record.result = undefined;
      record.error = undefined;
      record.completedAt = undefined;
      record.status = "queued";
      const start = () => this.startResume(id, record, prompt, signal, options);
      if (occupiesPoolSlot(record) && !this.poolHasRoom("background")) {
        this.queue.push({
          id,
          pool: "background",
          start: async () => {
            try {
              start();
            } catch (err) {
              record.status = "error";
              record.error = err instanceof Error ? err.message : String(err);
              record.completedAt = Date.now();
              this.onComplete?.(record);
            }
          },
          release: () => {}
        });
      } else {
        start();
      }
      return record;
    }
    record.status = "running";
    record.startedAt = Date.now();
    record.completedAt = undefined;
    record.result = undefined;
    record.error = undefined;
    const abortController = new AbortController;
    record.abortController = abortController;
    this.armParentAbort(record, signal);
    if (signal?.aborted)
      this.abort(id);
    try {
      this.settleOutcome(record, await resumeAgent(record.session, prompt, {
        type: record.type,
        maxTurns: options?.maxTurns ?? record.invocation?.maxTurns,
        onTurnEnd: options?.onTurnEnd,
        onToolActivity: (activity) => {
          if (activity.type === "end")
            record.toolUses++;
          options?.onToolActivity?.(activity);
        },
        onAssistantUsage: (usage) => {
          addUsage(record.lifetimeUsage, usage);
          this.onUsage?.(record, usage);
          options?.onAssistantUsage?.(usage);
        },
        onCompaction: (info) => {
          record.compactionCount++;
          this.onCompact?.(record, info);
          options?.onCompaction?.(info);
        },
        signal: abortController.signal
      }));
    } catch (err) {
      this.failResume(record, err);
    }
    this.detachParentAbort(record);
    this.abortOwnedChildren(id);
    return record;
  }
  settleOutcome(record, { text, failure, aborted, steered }) {
    if (record.status !== "stopped") {
      if (aborted) {
        record.status = "aborted";
      } else if (failure) {
        record.status = "error";
        record.error = failure;
      } else {
        record.status = steered ? "steered" : "completed";
      }
    }
    record.result = text;
    record.completedAt ??= Date.now();
  }
  failResume(record, err) {
    if (record.status !== "stopped") {
      record.status = "error";
      record.error = err instanceof Error ? err.message : String(err);
    }
    record.completedAt ??= Date.now();
  }
  startResume(id, record, prompt, parentSignal, options) {
    if (!record.session)
      return;
    record.status = "running";
    record.startedAt = Date.now();
    if (occupiesPoolSlot(record))
      this.runningBackground++;
    this.onStart?.(record);
    const abortController = new AbortController;
    record.abortController = abortController;
    let detachParentSignal;
    if (parentSignal) {
      const onParentAbort = () => this.abort(id);
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
      detachParentSignal = () => parentSignal.removeEventListener("abort", onParentAbort);
    }
    try {
      options.onStarted?.();
    } catch {}
    const settle = () => {
      detachParentSignal?.();
      detachParentSignal = undefined;
      if (record.outputCleanup) {
        try {
          record.outputCleanup();
        } catch {}
        record.outputCleanup = undefined;
      }
      this.abortOwnedChildren(id);
      if (occupiesPoolSlot(record))
        this.runningBackground--;
      try {
        this.onComplete?.(record);
      } catch {}
      this.drainQueue();
    };
    const promise = resumeAgent(record.session, prompt, {
      type: record.type,
      maxTurns: options.maxTurns ?? record.invocation?.maxTurns,
      onTurnEnd: options.onTurnEnd,
      onToolActivity: (activity) => {
        if (activity.type === "end")
          record.toolUses++;
        options.onToolActivity?.(activity);
      },
      onAssistantUsage: (usage) => {
        addUsage(record.lifetimeUsage, usage);
        this.onUsage?.(record, usage);
        options.onAssistantUsage?.(usage);
      },
      onCompaction: (info) => {
        record.compactionCount++;
        this.onCompact?.(record, info);
        options.onCompaction?.(info);
      },
      signal: abortController.signal
    }).then((outcome) => {
      this.settleOutcome(record, outcome);
      settle();
      return outcome.text;
    }).catch((err) => {
      this.failResume(record, err);
      settle();
      return "";
    });
    record.promise = promise;
  }
  steer(id, message) {
    const record = this.agents.get(id);
    if (!record)
      return false;
    if (record.status !== "running" && record.status !== "queued")
      return false;
    if (record.session) {
      record.session.steer(message).catch(() => {});
    } else {
      if (!record.pendingSteers)
        record.pendingSteers = [];
      record.pendingSteers.push(message);
    }
    this.onSteered?.(record, message);
    return true;
  }
  getRecord(id) {
    return this.agents.get(id);
  }
  takenHandles() {
    const taken = new Set;
    for (const record of this.agents.values()) {
      if (record.handle)
        taken.add(record.handle);
      if (record.alias)
        taken.add(record.alias);
    }
    for (const entry of this.tombstones.values()) {
      taken.add(entry.handle);
      if (entry.alias)
        taken.add(entry.alias);
    }
    return taken;
  }
  reclaimable(name, id) {
    if (name === undefined)
      return;
    for (const record of this.agents.values()) {
      if (record.handle === name || record.alias === name)
        return;
    }
    if (id !== undefined) {
      for (const entry of this.tombstones.values()) {
        if (entry.id !== id && (entry.handle === name || entry.alias === name))
          return;
      }
    }
    return name;
  }
  resolveMention(name) {
    const wanted = name.toLowerCase();
    let fallback;
    for (const record of this.agents.values()) {
      if (record.parentAgentId !== undefined)
        continue;
      if (record.handle?.toLowerCase() !== wanted && record.alias?.toLowerCase() !== wanted)
        continue;
      if (record.status === "running" || record.status === "queued")
        return { kind: "live", record };
      if (!fallback || record.startedAt > fallback.startedAt)
        fallback = record;
    }
    if (fallback)
      return { kind: "live", record: fallback };
    const byId = this.agents.get(name);
    if (byId?.parentAgentId === undefined && byId !== undefined)
      return { kind: "live", record: byId };
    for (const entry of this.tombstones.values()) {
      if (entry.handle.toLowerCase() === wanted || entry.alias?.toLowerCase() === wanted || entry.id === name) {
        return { kind: "tombstone", entry };
      }
    }
    return;
  }
  dropTombstone(handle) {
    this.tombstones.delete(handle);
  }
  listTombstones() {
    return [...this.tombstones.values()].sort((a, b) => b.completedAt - a.completedAt);
  }
  listAgents() {
    return [...this.agents.values()].sort((a, b) => b.startedAt - a.startedAt);
  }
  abort(id) {
    const record = this.agents.get(id);
    if (!record)
      return false;
    if (record.status === "queued") {
      this.dequeue((q) => q.id === id);
      record.status = "stopped";
      record.completedAt = Date.now();
      return true;
    }
    if (record.status !== "running")
      return false;
    record.abortController?.abort();
    record.status = "stopped";
    record.completedAt = Date.now();
    return true;
  }
  removeRecord(id, record) {
    this.tombstone(record);
    const session = record.session;
    record.session = undefined;
    this.agents.delete(id);
    this.startups.delete(id);
    shutdownChildSession(session);
  }
  tombstone(record) {
    if (!record.handle || !record.sessionFile)
      return;
    this.tombstones.set(record.handle, {
      handle: record.handle,
      alias: record.alias,
      id: record.id,
      type: record.type,
      description: record.description,
      sessionFile: record.sessionFile,
      completedAt: record.completedAt ?? Date.now(),
      worktreeLost: worktreeLost(record) || undefined
    });
    while (this.tombstones.size > MAX_TOMBSTONES) {
      const oldest = [...this.tombstones.values()].reduce((a, b) => a.completedAt <= b.completedAt ? a : b);
      this.tombstones.delete(oldest.handle);
    }
  }
  cleanup() {
    const cutoff = Date.now() - 10 * 60000;
    for (const [id, record] of this.agents) {
      if (record.status === "running" || record.status === "queued")
        continue;
      if ((record.completedAt ?? 0) >= cutoff)
        continue;
      this.removeRecord(id, record);
    }
  }
  clearCompleted(skipUnconsumed = false) {
    for (const [id, record] of this.agents) {
      if (record.status === "running" || record.status === "queued")
        continue;
      if (skipUnconsumed && !record.resultConsumed)
        continue;
      this.removeRecord(id, record);
    }
    this.tombstones.clear();
  }
  hasRunning() {
    return [...this.agents.values()].some((r) => r.status === "running" || r.status === "queued");
  }
  abortAll() {
    let count = 0;
    for (const queued of this.queue) {
      const record = this.agents.get(queued.id);
      if (record) {
        record.status = "stopped";
        record.completedAt = Date.now();
        count++;
      }
    }
    this.dequeue(() => true);
    for (const record of this.agents.values()) {
      if (record.status === "running") {
        record.abortController?.abort();
        record.status = "stopped";
        record.completedAt = Date.now();
        count++;
      }
    }
    return count;
  }
  async waitForAll() {
    while (true) {
      this.drainQueue();
      const pending = [];
      for (const record of this.agents.values()) {
        if (record.status !== "running" && record.status !== "queued")
          continue;
        const startup = this.startups.get(record.id);
        if (startup)
          pending.push(startup);
        if (record.promise)
          pending.push(record.promise);
      }
      if (pending.length === 0)
        break;
      await Promise.allSettled(pending);
    }
  }
  async dispose(pi) {
    clearInterval(this.cleanupInterval);
    this.dequeue(() => true);
    const sessions = [...this.agents.values()].map((record) => record.session);
    this.agents.clear();
    this.startups.clear();
    if (pi) {
      const prune = (repo) => {
        pruneWorktrees(pi, repo).catch(() => {});
      };
      prune(process.cwd());
      for (const repo of this.worktreeRepos)
        prune(repo);
    }
    await Promise.all(sessions.map((session) => shutdownChildSession(session)));
  }
}
var DEFAULT_MAX_CONCURRENT = 10, DEFAULT_MAX_CONCURRENT_FOREGROUND = 0, MAX_TOMBSTONES = 100, CHILD_SHUTDOWN_TIMEOUT_MS = 3000;
var init_agent_manager = __esm(() => {
  init_agent_record_entry();
  init_agent_runner();
  init_agent_types();
  init_mention();
  init_model_resolver();
  init_worktree();
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/ui/agent-widget.ts
import { truncateToWidth } from "@earendil-works/pi-tui";
function fgPreservingNestedStyles(theme, color, text) {
  const styledEmpty = theme.fg(color, "");
  const styleStart = styledEmpty.replace(/\u001b\[(?:0|39)m/g, "");
  return theme.fg(color, text.replace(/\u001b\[(?:0|39)m/g, (reset) => `${reset}${styleStart}`));
}
function formatTokens(count) {
  if (count >= 1e6)
    return `${(count / 1e6).toFixed(1)}M token`;
  if (count >= 1000)
    return `${(count / 1000).toFixed(1)}k token`;
  return `${count} token`;
}
function formatCost(cost) {
  if (!(cost > 0))
    return "";
  if (cost < 0.0001)
    return "<$0.0001";
  if (cost >= 1)
    return `~$${cost.toFixed(2)}`;
  const rounded = Number(cost.toFixed(4));
  const decimals = (String(rounded).split(".")[1] ?? "").length;
  return `~$${rounded.toFixed(Math.max(2, decimals))}`;
}
function formatSessionTokens(tokens, percent, theme, compactions = 0) {
  const tokenStr = formatTokens(tokens);
  const annot = [];
  if (percent !== null) {
    const color = percent >= 85 ? "error" : percent >= 70 ? "warning" : "dim";
    annot.push(theme.fg(color, `${Math.round(percent)}%`));
  }
  if (compactions > 0) {
    annot.push(theme.fg("dim", `⇊${compactions}`));
  }
  if (annot.length === 0)
    return tokenStr;
  return `${tokenStr} (${annot.join(" · ")})`;
}
function formatTurns(turnCount, maxTurns) {
  return maxTurns != null ? `↻${turnCount}≤${maxTurns}` : `↻${turnCount}`;
}
function formatMs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}
function formatDuration(startedAt, completedAt) {
  if (completedAt)
    return formatMs(completedAt - startedAt);
  return `${formatMs(Date.now() - startedAt)} (running)`;
}
function getDisplayName(type) {
  return getConfig(type).displayName;
}
function getPromptModeLabel(type) {
  const config = getConfig(type);
  return config.promptMode === "append" ? "twin" : undefined;
}
function buildInvocationTags(invocation) {
  const tags = [];
  if (!invocation)
    return { tags };
  const asked = (value, requested) => value && requested && requested !== value ? `${value} (asked ${requested})` : value;
  const thinking = asked(invocation.thinking, invocation.requestedThinking);
  if (thinking)
    tags.push(`thinking: ${thinking}`);
  if (invocation.isolated)
    tags.push("isolated");
  if (invocation.isolation === "worktree")
    tags.push("worktree");
  if (invocation.inheritContext)
    tags.push("inherit context");
  if (invocation.runInBackground)
    tags.push("background");
  if (invocation.maxTurns != null)
    tags.push(`max turns: ${invocation.maxTurns}`);
  return {
    modelName: asked(invocation.modelName, invocation.requestedModel),
    modelId: asked(invocation.modelId, invocation.requestedModel),
    tags
  };
}
function truncateLine(text, len = 60) {
  const line = text.split(`
`).find((l) => l.trim())?.trim() ?? "";
  if (line.length <= len)
    return line;
  return line.slice(0, len) + "…";
}
function describeActivity(activeTools, responseText) {
  if (activeTools.size > 0) {
    const groups = new Map;
    for (const toolName of activeTools.values()) {
      const action = TOOL_DISPLAY[toolName] ?? toolName;
      groups.set(action, (groups.get(action) ?? 0) + 1);
    }
    const parts = [];
    for (const [action, count] of groups) {
      if (count > 1) {
        parts.push(`${action} ${count} ${action === "searching" ? "patterns" : "files"}`);
      } else {
        parts.push(action);
      }
    }
    return parts.join(", ") + "…";
  }
  if (responseText && responseText.trim().length > 0) {
    return truncateLine(responseText);
  }
  return "thinking…";
}

class AgentWidget {
  manager;
  agentActivity;
  mode;
  showCost;
  showModel;
  uiCtx;
  widgetFrame = 0;
  widgetInterval;
  finishedTurnAge = new Map;
  static ERROR_LINGER_TURNS = 2;
  widgetRegistered = false;
  tui;
  lastStatusText;
  constructor(manager, agentActivity, mode = () => "all", showCost = () => false, showModel = () => false) {
    this.manager = manager;
    this.agentActivity = agentActivity;
    this.mode = mode;
    this.showCost = showCost;
    this.showModel = showModel;
  }
  widgetAgents() {
    const all = this.manager.listAgents().filter(isTopLevelAgent);
    switch (this.mode()) {
      case "off":
        return [];
      case "background":
        return all.filter((a) => a.isBackground !== false);
      default:
        return all;
    }
  }
  setUICtx(ctx) {
    if (ctx !== this.uiCtx) {
      this.uiCtx = ctx;
      this.widgetRegistered = false;
      this.tui = undefined;
      this.lastStatusText = undefined;
    }
  }
  onTurnStart() {
    for (const [id, age] of this.finishedTurnAge) {
      this.finishedTurnAge.set(id, age + 1);
    }
    this.update();
  }
  ensureTimer() {
    if (!this.widgetInterval) {
      this.widgetInterval = setInterval(() => this.update(), 80);
    }
  }
  shouldShowFinished(agentId, status) {
    const age = this.finishedTurnAge.get(agentId) ?? 0;
    const maxAge = ERROR_STATUSES.has(status) ? AgentWidget.ERROR_LINGER_TURNS : 1;
    return age < maxAge;
  }
  markFinished(agentId) {
    if (!this.finishedTurnAge.has(agentId)) {
      this.finishedTurnAge.set(agentId, 0);
    }
  }
  markRunning(agentId) {
    this.finishedTurnAge.delete(agentId);
  }
  renderFinishedLine(a, theme) {
    const modeLabel = getPromptModeLabel(a.type);
    const duration = formatMs((a.completedAt ?? Date.now()) - a.startedAt);
    let icon;
    let statusText;
    if (a.status === "completed") {
      icon = theme.fg("success", "✓");
      statusText = "";
    } else if (a.status === "steered") {
      icon = theme.fg("warning", "✓");
      statusText = theme.fg("warning", " (turn limit)");
    } else if (a.status === "stopped") {
      icon = theme.fg("dim", "■");
      statusText = theme.fg("dim", " stopped");
    } else if (a.status === "error") {
      icon = theme.fg("error", "✗");
      const errMsg = a.error ? `: ${a.error.slice(0, 60)}` : "";
      statusText = theme.fg("error", ` error${errMsg}`);
    } else {
      icon = theme.fg("error", "✗");
      statusText = theme.fg("warning", " aborted");
    }
    const parts = [];
    const activity = this.agentActivity.get(a.id);
    if (activity)
      parts.push(formatTurns(activity.turnCount, activity.maxTurns));
    if (a.toolUses > 0)
      parts.push(`${a.toolUses} tool use${a.toolUses === 1 ? "" : "s"}`);
    const costText = this.showCost() ? formatCost(getLifetimeCost(a.lifetimeUsage)) : "";
    if (costText)
      parts.push(costText);
    parts.push(duration);
    const modeTag = modeLabel ? ` ${theme.fg("dim", `(${modeLabel})`)}` : "";
    return `${icon} ${renderAgentName(a.type, theme, { fallbackColor: "dim" })}${modeTag}  ${theme.fg("dim", a.description)} ${theme.fg("dim", "·")} ${theme.fg("dim", parts.join(" · "))}${statusText}`;
  }
  renderWidget(tui, theme) {
    const allAgents = this.widgetAgents();
    const running = allAgents.filter((a) => a.status === "running");
    const queued = allAgents.filter((a) => a.status === "queued");
    const finished = allAgents.filter((a) => a.status !== "running" && a.status !== "queued" && a.completedAt && this.shouldShowFinished(a.id, a.status));
    const hasActive = running.length > 0 || queued.length > 0;
    const hasFinished = finished.length > 0;
    if (!hasActive && !hasFinished)
      return [];
    const w2 = tui.terminal.columns;
    const truncate = (line) => truncateToWidth(line, w2);
    const headingColor = hasActive ? "accent" : "dim";
    const headingIcon = hasActive ? "●" : "○";
    const frame = SPINNER[this.widgetFrame % SPINNER.length];
    const finishedLines = [];
    for (const a of finished) {
      finishedLines.push(truncate(theme.fg("dim", "├─") + " " + this.renderFinishedLine(a, theme)));
    }
    const runningLines = [];
    for (const a of running) {
      const modeLabel = getPromptModeLabel(a.type);
      const modeTag = modeLabel ? ` ${theme.fg("dim", `(${modeLabel})`)}` : "";
      const elapsed = formatMs(Date.now() - a.startedAt);
      const bg = this.agentActivity.get(a.id);
      const toolUses = bg?.toolUses ?? a.toolUses;
      const tokens = getLifetimeTotal(a.lifetimeUsage);
      const contextPercent = getSessionContextPercent(bg?.session);
      const tokenText = tokens > 0 ? formatSessionTokens(tokens, contextPercent, theme, a.compactionCount) : "";
      const costText = this.showCost() ? formatCost(getLifetimeCost(a.lifetimeUsage)) : "";
      const parts = [];
      if (this.showModel()) {
        const { modelName, tags } = buildInvocationTags(a.invocation);
        if (modelName)
          parts.push(modelName);
        const thinkingTag = tags.find((tag) => tag.startsWith("thinking: "));
        if (thinkingTag)
          parts.push(thinkingTag);
      }
      if (bg)
        parts.push(formatTurns(bg.turnCount, bg.maxTurns));
      if (toolUses > 0)
        parts.push(`${toolUses} tool use${toolUses === 1 ? "" : "s"}`);
      if (tokenText)
        parts.push(tokenText);
      if (costText)
        parts.push(costText);
      parts.push(elapsed);
      const statsText = parts.join(" · ");
      const activity = bg ? describeActivity(bg.activeTools, bg.responseText) : "thinking…";
      runningLines.push([
        truncate(theme.fg("dim", "├─") + ` ${theme.fg("accent", frame)} ${renderAgentName(a.type, theme, { bold: true })}${modeTag}  ${theme.fg("muted", a.description)} ${theme.fg("dim", "·")} ${fgPreservingNestedStyles(theme, "dim", statsText)}`),
        truncate(theme.fg("dim", "│  ") + theme.fg("dim", `  ⎿  ${activity}`))
      ]);
    }
    const queuedLine = queued.length > 0 ? truncate(theme.fg("dim", "├─") + ` ${theme.fg("muted", "◦")} ${theme.fg("dim", `${queued.length} queued`)}`) : undefined;
    const maxBody = MAX_WIDGET_LINES - 1;
    const totalBody = finishedLines.length + runningLines.length * 2 + (queuedLine ? 1 : 0);
    const lines = [truncate(theme.fg(headingColor, headingIcon) + " " + theme.fg(headingColor, "Agents"))];
    if (totalBody <= maxBody) {
      lines.push(...finishedLines);
      for (const pair of runningLines)
        lines.push(...pair);
      if (queuedLine)
        lines.push(queuedLine);
      if (lines.length > 1) {
        const last = lines.length - 1;
        lines[last] = lines[last].replace("├─", "└─");
        if (runningLines.length > 0 && !queuedLine) {
          if (last >= 2) {
            lines[last - 1] = lines[last - 1].replace("├─", "└─");
            lines[last] = lines[last].replace("│  ", "   ");
          }
        }
      }
    } else {
      let budget = maxBody - 1;
      let hiddenRunning = 0;
      let hiddenFinished = 0;
      const queuedReserve = queuedLine ? 1 : 0;
      budget -= queuedReserve;
      for (const pair of runningLines) {
        if (budget >= 2) {
          lines.push(...pair);
          budget -= 2;
        } else {
          hiddenRunning++;
        }
      }
      if (queuedLine) {
        budget += queuedReserve;
        lines.push(queuedLine);
        budget--;
      }
      for (const fl of finishedLines) {
        if (budget >= 1) {
          lines.push(fl);
          budget--;
        } else {
          hiddenFinished++;
        }
      }
      const overflowParts = [];
      if (hiddenRunning > 0)
        overflowParts.push(`${hiddenRunning} running`);
      if (hiddenFinished > 0)
        overflowParts.push(`${hiddenFinished} finished`);
      const overflowText = overflowParts.join(", ");
      lines.push(truncate(theme.fg("dim", "└─") + ` ${theme.fg("dim", `+${hiddenRunning + hiddenFinished} more (${overflowText})`)}`));
    }
    return lines;
  }
  update() {
    if (!this.uiCtx)
      return;
    const allAgents = this.widgetAgents();
    let runningCount = 0;
    let queuedCount = 0;
    let hasFinished = false;
    for (const a of allAgents) {
      if (a.status === "running") {
        runningCount++;
      } else if (a.status === "queued") {
        queuedCount++;
      } else if (a.completedAt && this.shouldShowFinished(a.id, a.status)) {
        hasFinished = true;
      }
    }
    const hasActive = runningCount > 0 || queuedCount > 0;
    if (!hasActive && !hasFinished) {
      if (this.widgetRegistered) {
        this.uiCtx.setWidget("agents", undefined);
        this.widgetRegistered = false;
        this.tui = undefined;
      }
      if (this.lastStatusText !== undefined) {
        this.uiCtx.setStatus("subagents", undefined);
        this.lastStatusText = undefined;
      }
      if (this.widgetInterval) {
        clearInterval(this.widgetInterval);
        this.widgetInterval = undefined;
      }
      for (const [id] of this.finishedTurnAge) {
        if (!allAgents.some((a) => a.id === id))
          this.finishedTurnAge.delete(id);
      }
      return;
    }
    let newStatusText;
    if (hasActive) {
      const statusParts = [];
      if (runningCount > 0)
        statusParts.push(`${runningCount} running`);
      if (queuedCount > 0)
        statusParts.push(`${queuedCount} queued`);
      const total = runningCount + queuedCount;
      newStatusText = `${statusParts.join(", ")} agent${total === 1 ? "" : "s"}`;
    }
    if (newStatusText !== this.lastStatusText) {
      this.uiCtx.setStatus("subagents", newStatusText);
      this.lastStatusText = newStatusText;
    }
    this.widgetFrame++;
    if (!this.widgetRegistered) {
      this.uiCtx.setWidget("agents", (tui, theme) => {
        this.tui = tui;
        return {
          render: () => this.renderWidget(tui, theme),
          invalidate: () => {
            this.widgetRegistered = false;
            this.tui = undefined;
          }
        };
      }, { placement: "aboveEditor" });
      this.widgetRegistered = true;
    } else {
      this.tui?.requestRender();
    }
  }
  dispose() {
    if (this.widgetInterval) {
      clearInterval(this.widgetInterval);
      this.widgetInterval = undefined;
    }
    if (this.uiCtx) {
      this.uiCtx.setWidget("agents", undefined);
      this.uiCtx.setStatus("subagents", undefined);
    }
    this.widgetRegistered = false;
    this.tui = undefined;
    this.lastStatusText = undefined;
  }
}
var MAX_WIDGET_LINES = 12, SPINNER, ERROR_STATUSES, TOOL_DISPLAY;
var init_agent_widget = __esm(() => {
  init_agent_color();
  init_agent_manager();
  init_agent_types();
  SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  ERROR_STATUSES = new Set(["error", "aborted", "steered", "stopped"]);
  TOOL_DISPLAY = {
    read: "reading",
    bash: "running command",
    edit: "editing",
    write: "writing",
    grep: "searching",
    find: "finding files",
    ls: "listing"
  };
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/ui/viewer-keys.ts
import { matchesKey } from "@earendil-works/pi-tui";
function createViewerKeys(keybindings) {
  const matches = (data, id, fallback) => keybindings ? keybindings.matches(data, id) : matchesKey(data, fallback);
  return {
    scrollUp: (data) => matches(data, "tui.select.up", "up") || matchesKey(data, "k"),
    scrollDown: (data) => matches(data, "tui.select.down", "down") || matchesKey(data, "j"),
    pageUp: (data) => matches(data, "tui.select.pageUp", "pageUp") || matchesKey(data, "shift+up"),
    pageDown: (data) => matches(data, "tui.select.pageDown", "pageDown") || matchesKey(data, "shift+down"),
    expand: (data) => matches(data, "app.tools.expand", "ctrl+o")
  };
}
var init_viewer_keys = () => {};

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/ui/conversation-viewer.ts
var exports_conversation_viewer = {};
__export(exports_conversation_viewer, {
  getConversationOverlayOptions: () => getConversationOverlayOptions,
  VIEWPORT_HEIGHT_PCT: () => VIEWPORT_HEIGHT_PCT,
  RESULT_MAX_CHARS: () => RESULT_MAX_CHARS,
  ConversationViewer: () => ConversationViewer
});
import { getMarkdownTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Input, Markdown, matchesKey as matchesKey2, ScrollView, stripTerminalSequences, truncateToWidth as truncateToWidth2, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
function piThemeAvailable() {
  try {
    getMarkdownTheme().heading("probe");
    return true;
  } catch {
    return false;
  }
}
function getConversationOverlayOptions(tui) {
  return tui.mode === "fullscreen" ? { anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0 } : { anchor: "center", width: "90%", maxHeight: `${VIEWPORT_HEIGHT_PCT}%` };
}
function resolveMarkdownTheme(th) {
  try {
    const piTheme = getMarkdownTheme();
    piTheme.heading("probe");
    return piTheme;
  } catch {
    return fallbackMarkdownTheme(th);
  }
}
function fallbackMarkdownTheme(th) {
  const sgr = (on, off) => (text) => `\x1B[${on}m${text}\x1B[${off}m`;
  return {
    heading: (text) => th.bold(th.fg("accent", text)),
    link: (text) => th.fg("accent", text),
    linkUrl: (text) => th.fg("muted", text),
    code: (text) => th.fg("muted", text),
    codeBlock: (text) => th.fg("muted", text),
    codeBlockBorder: (text) => th.fg("dim", text),
    quote: (text) => th.fg("muted", text),
    quoteBorder: (text) => th.fg("dim", text),
    hr: (text) => th.fg("dim", text),
    listBullet: (text) => th.fg("accent", text),
    bold: (text) => th.bold(text),
    italic: sgr(3, 23),
    underline: sgr(4, 24),
    strikethrough: sgr(9, 29)
  };
}
function capResult(text) {
  if (text.length <= RESULT_MAX_CHARS)
    return { text, elided: 0 };
  return {
    text: text.slice(0, RESULT_MAX_CHARS),
    elided: text.length - RESULT_MAX_CHARS
  };
}
function humanCount(n) {
  if (n < 1000)
    return `${n}`;
  const thousands = n < 999950;
  const value = thousands ? n / 1000 : n / 1e6;
  return `${value.toFixed(1).replace(/\.0$/, "")}${thousands ? "k" : "M"}`;
}
function truncationNote(elided) {
  return `... (truncated, ${humanCount(elided)} more character${elided === 1 ? "" : "s"})`;
}

class ConversationViewer {
  tui;
  session;
  record;
  activity;
  theme;
  done;
  onStop;
  onSteer;
  showCost;
  viewerMarkdown;
  onMarkdownMode;
  onBackground;
  scrollOffset = 0;
  autoScroll = true;
  focused = false;
  fullscreen;
  viewport;
  scrollbarGrabOffset;
  footerTargets = [];
  latestTarget;
  newMessages = 0;
  scrollView;
  unsubscribe;
  lastInnerW = 0;
  closed = false;
  stopArmed = false;
  keys;
  composer;
  markdownTheme;
  markdownModeOverride;
  markdownCache = new WeakMap;
  toolBlocks = new Map;
  toolRendering = piThemeAvailable();
  toolsExpanded = false;
  constructor(tui, session, record, activity, theme, done, onStop, keybindings, onSteer, showCost = false, viewerMarkdown, onMarkdownMode, scrollbarMode = "auto", onBackground) {
    this.tui = tui;
    this.session = session;
    this.record = record;
    this.activity = activity;
    this.theme = theme;
    this.done = done;
    this.onStop = onStop;
    this.onSteer = onSteer;
    this.showCost = showCost;
    this.viewerMarkdown = viewerMarkdown;
    this.onMarkdownMode = onMarkdownMode;
    this.onBackground = onBackground;
    this.fullscreen = tui.mode === "fullscreen";
    this.markdownTheme = resolveMarkdownTheme(theme);
    this.keys = createViewerKeys(keybindings);
    this.scrollView = new ScrollView({
      render: (width) => this.buildContentLines(width),
      invalidate: () => {}
    }, { follow: "end", scrollbar: this.fullscreen ? scrollbarMode : "hidden" });
    this.unsubscribe = session.subscribe((event) => {
      if (this.closed)
        return;
      if (this.fullscreen && !this.scrollView.isFollowingEnd && event.type === "message_start" && ["user", "assistant", "toolResult", "bashExecution"].includes(event.message.role)) {
        this.newMessages++;
      }
      this.tui.requestRender();
    });
  }
  handleInput(data) {
    if (this.closed)
      return;
    if (this.fullscreen && (matchesKey2(data, "ctrl+end") || !this.composer && matchesKey2(data, "end"))) {
      this.jumpToLatest();
      return;
    }
    if (this.composer) {
      this.composer.handleInput(data);
      this.tui.requestRender();
      return;
    }
    if (matchesKey2(data, "escape") || matchesKey2(data, "ctrl+c") || matchesKey2(data, "q")) {
      this.closed = true;
      this.done(undefined);
      return;
    }
    if (matchesKey2(data, "enter") && this.canSteer()) {
      this.stopArmed = false;
      this.openComposer();
      return;
    }
    if (matchesKey2(data, "b") && this.canSendToBackground()) {
      this.stopArmed = false;
      this.onBackground?.send();
      this.tui.requestRender();
      return;
    }
    if (matchesKey2(data, "x")) {
      if (this.isStoppable()) {
        if (this.stopArmed) {
          this.stopArmed = false;
          this.onStop?.();
        } else {
          this.stopArmed = true;
        }
        this.tui.requestRender();
      }
      return;
    }
    if (matchesKey2(data, "m")) {
      this.stopArmed = false;
      const next = MARKDOWN_MODES[(MARKDOWN_MODES.indexOf(this.markdownMode()) + 1) % MARKDOWN_MODES.length];
      this.markdownModeOverride = next;
      this.onMarkdownMode?.(next);
      this.tui.requestRender();
      return;
    }
    if (this.stopArmed)
      this.stopArmed = false;
    if (this.keys.expand(data)) {
      this.toolsExpanded = !this.toolsExpanded;
      for (const block of this.toolBlocks.values()) {
        block.component.setExpanded(this.toolsExpanded);
        block.rows = undefined;
      }
      this.tui.requestRender();
      return;
    }
    const totalLines = this.buildContentLines(this.lastInnerW).length;
    const viewportHeight = this.viewportHeight();
    if (this.fullscreen) {
      this.scrollView.updateLayout(totalLines, viewportHeight, () => {
        if (!this.closed)
          this.tui.requestRender();
      });
      if (this.keys.scrollUp(data))
        this.scrollView.scrollBy(-1);
      else if (this.keys.scrollDown(data))
        this.scrollView.scrollBy(1);
      else if (this.keys.pageUp(data))
        this.scrollView.scrollBy(-viewportHeight);
      else if (this.keys.pageDown(data))
        this.scrollView.scrollBy(viewportHeight);
      else if (matchesKey2(data, "home"))
        this.scrollView.scrollToStart();
      return;
    }
    const maxScroll = Math.max(0, totalLines - viewportHeight);
    if (this.keys.scrollUp(data)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.autoScroll = this.scrollOffset >= maxScroll;
    } else if (this.keys.scrollDown(data)) {
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1);
      this.autoScroll = this.scrollOffset >= maxScroll;
    } else if (this.keys.pageUp(data)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - viewportHeight);
      this.autoScroll = false;
    } else if (this.keys.pageDown(data)) {
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + viewportHeight);
      this.autoScroll = this.scrollOffset >= maxScroll;
    } else if (matchesKey2(data, "home")) {
      this.scrollOffset = 0;
      this.autoScroll = false;
    } else if (matchesKey2(data, "end")) {
      this.scrollOffset = maxScroll;
      this.autoScroll = true;
    }
  }
  jumpToLatest() {
    this.scrollView.scrollToEnd();
    this.newMessages = 0;
    this.stopArmed = false;
    this.tui.requestRender();
  }
  handleMouse(event) {
    if (!this.fullscreen)
      return { handled: false };
    if (this.closed || !this.viewport)
      return { handled: true, render: false };
    const view = this.viewport;
    const onScrollbar = this.scrollView.scrollbar !== "hidden" && event.x >= view.width - SCROLLBAR_WIDTH && event.x < view.width && event.y >= view.top && event.y < view.top + view.height;
    if (event.type === "move") {
      this.scrollView.setScrollbarActive(onScrollbar);
      return { handled: true, render: false };
    }
    if (event.type === "wheel") {
      this.stopArmed = false;
      this.scrollView.scrollBy(event.wheelDelta ?? 0);
      return { handled: true, render: true };
    }
    if (event.type === "release") {
      const wasDragging = this.scrollbarGrabOffset !== undefined;
      this.scrollbarGrabOffset = undefined;
      this.scrollView.setScrollbarActive(onScrollbar);
      return { handled: true, render: wasDragging };
    }
    if (event.type === "drag" && this.scrollbarGrabOffset !== undefined) {
      const travel = view.height - view.thumbHeight;
      const position = Math.max(0, Math.min(travel, event.y - view.top - this.scrollbarGrabOffset));
      this.scrollView.scrollTo(travel > 0 ? Math.round(position / travel * view.maxScroll) : 0);
      return { handled: true, render: true };
    }
    if (event.type === "press" && event.button === "left") {
      this.scrollbarGrabOffset = undefined;
      this.scrollView.setScrollbarActive(onScrollbar);
      if (this.latestTarget && event.y === this.latestTarget.row && event.x >= this.latestTarget.start && event.x < this.latestTarget.end) {
        this.jumpToLatest();
        return { handled: true, render: true };
      }
      if (event.y === this.tui.terminal.rows - 1) {
        const target = this.footerTargets.find((t) => event.x >= t.start && event.x < t.end);
        if (target) {
          this.handleInput(target.key);
          return { handled: true, render: true };
        }
      }
      this.stopArmed = false;
      if (this.composer && event.y === this.tui.terminal.rows - 2) {
        this.composer.handleMouse({ ...event, x: event.x - 1, y: 0, width: this.lastInnerW, height: 1 });
        return { handled: true, render: true };
      }
      if (onScrollbar && view.maxScroll > 0) {
        const y = event.y - view.top;
        if (y >= view.thumbTop && y < view.thumbTop + view.thumbHeight) {
          this.scrollbarGrabOffset = y - view.thumbTop;
          return { handled: true, capture: true, render: true };
        }
        this.scrollView.scrollBy(y < view.thumbTop ? -view.height : view.height);
        this.scrollbarGrabOffset = Math.floor(view.thumbHeight / 2);
        return { handled: true, capture: true, render: true };
      }
      return { handled: true, render: true };
    }
    return { handled: true, render: false };
  }
  render(width) {
    this.footerTargets = [];
    this.latestTarget = undefined;
    this.viewport = undefined;
    const rows = Math.max(0, this.tui.terminal.rows);
    if (!this.fullscreen && width < 6)
      return [];
    if (width <= SCROLLBAR_WIDTH + 1)
      return Array.from({ length: rows }, () => " ".repeat(Math.max(0, width)));
    const th = this.theme;
    const innerW = this.fullscreen ? this.scrollView.getContentWidth(width - 1) : width - 4;
    this.lastInnerW = innerW;
    const lines = [];
    const footerActions = [];
    const pad = (s2, len) => {
      const vis = visibleWidth(s2);
      return s2 + " ".repeat(Math.max(0, len - vis));
    };
    const row = (content, scrollbar) => {
      if (this.fullscreen) {
        const contentWidth = width - 1 - (scrollbar ? SCROLLBAR_WIDTH : 0);
        return " " + truncateToWidth2(content, contentWidth, scrollbar ? "" : "...", true) + (scrollbar ?? "");
      }
      return th.fg("border", "│") + " " + truncateToWidth2(pad(content, innerW), innerW, "...", true) + " " + th.fg("border", "│");
    };
    const hrTop = th.fg("border", `╭${"─".repeat(width - 2)}╮`);
    const hrBot = th.fg("border", `╰${"─".repeat(width - 2)}╯`);
    const hrMid = row(th.fg("dim", "─".repeat(innerW)));
    if (!this.fullscreen)
      lines.push(hrTop);
    const modeLabel = getPromptModeLabel(this.record.type);
    const modeTag = modeLabel ? ` ${th.fg("dim", `(${modeLabel})`)}` : "";
    const statusIcon = this.record.status === "running" ? th.fg("accent", "●") : this.record.status === "completed" ? th.fg("success", "✓") : this.record.status === "error" ? th.fg("error", "✗") : th.fg("dim", "○");
    const duration = formatDuration(this.record.startedAt, this.record.completedAt);
    const headerParts = [duration];
    const toolUses = this.activity?.toolUses ?? this.record.toolUses;
    if (toolUses > 0)
      headerParts.unshift(`${toolUses} tool${toolUses === 1 ? "" : "s"}`);
    const tokens = getLifetimeTotal(this.record.lifetimeUsage);
    if (tokens > 0) {
      const percent = getSessionContextPercent(this.activity?.session);
      headerParts.push(formatSessionTokens(tokens, percent, th, this.record.compactionCount));
    }
    const cost = this.showCost ? formatCost(getLifetimeCost(this.record.lifetimeUsage)) : "";
    if (cost)
      headerParts.push(cost);
    lines.push(row(`${statusIcon} ${renderAgentName(this.record.type, th, { bold: true })}${modeTag}  ${th.fg("muted", this.record.description)} ${th.fg("dim", "·")} ${fgPreservingNestedStyles(th, "dim", headerParts.join(" · "))}`));
    const invocationLine = this.invocationLine();
    if (invocationLine)
      lines.push(row(invocationLine));
    lines.push(hrMid);
    const contentLines = this.fullscreen ? this.scrollView.render(width - 1) : this.buildContentLines(innerW);
    const viewportHeight = this.viewportHeight();
    const maxScroll = Math.max(0, contentLines.length - viewportHeight);
    if (this.fullscreen) {
      this.scrollView.updateLayout(contentLines.length, viewportHeight, () => {
        if (!this.closed)
          this.tui.requestRender();
      });
      if (this.scrollView.isFollowingEnd)
        this.newMessages = 0;
    } else if (this.autoScroll) {
      this.scrollOffset = maxScroll;
    }
    const visibleStart = this.fullscreen ? this.scrollView.scrollTop : Math.min(this.scrollOffset, maxScroll);
    const visible = contentLines.slice(visibleStart, visibleStart + viewportHeight);
    const thumbHeight = Math.min(viewportHeight, Math.max(2, Math.round(viewportHeight * viewportHeight / Math.max(1, contentLines.length))));
    const thumbTop = maxScroll > 0 ? Math.round(visibleStart / maxScroll * (viewportHeight - thumbHeight)) : 0;
    this.viewport = { width, top: lines.length, height: viewportHeight, maxScroll, thumbTop, thumbHeight };
    for (let i = 0;i < viewportHeight; i++) {
      let scrollbar;
      if (this.scrollView.isScrollbarVisible) {
        const onThumb = i >= thumbTop && i < thumbTop + thumbHeight;
        if (onThumb) {
          scrollbar = th.fg("scrollbarThumb", this.scrollView.isScrollbarActive ? "█" : "┃");
        } else {
          scrollbar = th.fg("scrollbarTrack", "│");
        }
      }
      lines.push(row(visible[i] ?? "", scrollbar));
    }
    if (this.fullscreen && !this.scrollView.isFollowingEnd && maxScroll > 0 && rows >= this.chromeLines()) {
      const text = this.newMessages > 0 ? `${this.newMessages} new message${this.newMessages === 1 ? "" : "s"}` : "Jump to latest message";
      const label = truncateToWidth2(`[ ↓ ${text} · Ctrl+End ]`, innerW, "…");
      const labelWidth = visibleWidth(label);
      const padding = Math.floor((innerW - labelWidth) / 2);
      this.latestTarget = { row: lines.length, start: padding + 1, end: padding + 1 + labelWidth };
      lines.push(row(th.fg("dim", "─".repeat(padding)) + th.fg("accent", label) + th.fg("dim", "─".repeat(innerW - padding - labelWidth))));
    } else {
      lines.push(hrMid);
    }
    if (this.composer) {
      this.composer.focused = this.focused;
      lines.push(row(this.composer.render(innerW)[0] ?? ""));
      footerActions.push({ label: "Enter send", key: "\r" }, { label: "Esc cancel", key: "\x1B" });
      const composeHint = th.fg("dim", "Enter send · Esc cancel");
      const composeLeft = th.fg("accent", "✎ steer");
      const composeGap = Math.max(1, innerW - visibleWidth(composeLeft) - visibleWidth(composeHint));
      lines.push(row(composeLeft + " ".repeat(composeGap) + composeHint));
    } else {
      const sep4 = th.fg("dim", " · ");
      if (this.canSteer())
        footerActions.push({ label: "Enter steer", key: "\r" });
      if (this.canSendToBackground())
        footerActions.push({ label: "b bg", key: "b" });
      if (this.isStoppable()) {
        footerActions.push({ label: this.stopArmed ? "x again to STOP" : "x stop", key: "x" });
      }
      footerActions.push({ label: `m ${MARKDOWN_MODE_LABELS[this.markdownMode()]}`, key: "m" });
      const actions = footerActions.map((a) => th.fg(a.key === "x" && this.stopArmed ? "error" : "dim", a.label));
      footerActions.push({ label: "Esc close", key: "\x1B" });
      const footerRight = th.fg("dim", "↑↓ scroll · PgUp/PgDn or Shift+↑↓ · Esc close");
      const scrollPct = contentLines.length <= viewportHeight ? "100%" : `${Math.round((visibleStart + viewportHeight) / contentLines.length * 100)}%`;
      const count = th.fg("dim", `${contentLines.length} lines · ${scrollPct}`);
      const withCount = [count, ...actions].join(sep4);
      const footerLeft = visibleWidth(withCount) + visibleWidth(footerRight) + 1 <= innerW ? withCount : actions.join(sep4);
      const footerGap = Math.max(1, innerW - visibleWidth(footerLeft) - visibleWidth(footerRight));
      lines.push(row(footerLeft + " ".repeat(footerGap) + footerRight));
    }
    if (!this.fullscreen) {
      lines.push(hrBot);
      return lines;
    }
    const footer = lines.pop() ?? row("");
    const output = rows > 0 ? [...lines.slice(0, rows - 1), footer] : [];
    const footerText = stripTerminalSequences(footer);
    for (const action of footerActions) {
      const index = footerText.indexOf(action.label);
      if (index < 0)
        continue;
      const start = visibleWidth(footerText.slice(0, index));
      this.footerTargets.push({ start, end: start + visibleWidth(action.label), key: action.key });
    }
    return output;
  }
  isStoppable() {
    return !!this.onStop && (this.record.status === "running" || this.record.status === "queued");
  }
  markdownMode() {
    return this.markdownModeOverride ?? this.viewerMarkdown?.() ?? "assistant";
  }
  rawLines(text, width, dim) {
    const lines = wrapTextWithAnsi(text, width);
    return dim ? lines.map((l) => this.theme.fg("dim", l)) : lines;
  }
  markdownLines(msg, text, width, dim) {
    let entry = this.markdownCache.get(msg);
    if (!entry) {
      entry = {
        md: new Markdown(text, 0, 0, this.markdownTheme, dim ? { color: (t) => this.theme.fg("dim", t) } : undefined, MARKDOWN_OPTIONS),
        text
      };
      this.markdownCache.set(msg, entry);
    } else if (entry.text !== text) {
      const shouldRetry = !text.startsWith(entry.text);
      entry.md.setText(text);
      entry.text = text;
      if (shouldRetry)
        entry.failed = false;
    }
    if (entry.failed)
      return this.rawLines(text, width, dim);
    try {
      return entry.md.render(width);
    } catch {
      entry.failed = true;
      return this.rawLines(text, width, dim);
    }
  }
  canSteer() {
    return !!this.onSteer && (this.record.status === "running" || this.record.status === "queued");
  }
  canSendToBackground() {
    return this.onBackground?.available() === true;
  }
  openComposer() {
    const input = new Input;
    input.focused = true;
    input.onSubmit = (value) => {
      const message = value.trim();
      this.composer = undefined;
      if (message)
        this.onSteer?.(message);
      this.tui.requestRender();
    };
    input.onEscape = () => {
      this.composer = undefined;
      this.tui.requestRender();
    };
    this.composer = input;
    this.tui.requestRender();
  }
  invalidate() {}
  dispose() {
    this.closed = true;
    this.scrollView.setScrollbar("hidden");
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }
  viewportHeight() {
    if (this.fullscreen)
      return Math.max(0, this.tui.terminal.rows - this.chromeLines());
    const maxRows = Math.floor(this.tui.terminal.rows * VIEWPORT_HEIGHT_PCT / 100);
    return Math.max(MIN_VIEWPORT, maxRows - this.chromeLines());
  }
  chromeLines() {
    return CHROME_LINES_BASE - (this.fullscreen ? 2 : 0) + (this.invocationLine() ? 1 : 0) + (this.composer ? 1 : 0);
  }
  invocationLine() {
    const { modelName, modelId, tags } = buildInvocationTags(this.record.invocation);
    const model = modelId ?? modelName;
    const parts = model ? [model, ...tags] : tags;
    if (parts.length === 0)
      return;
    return this.theme.fg("dim", `  ↳ ${parts.join(" · ")}`);
  }
  buildContentLines(width) {
    if (width <= 0)
      return [];
    const th = this.theme;
    const messages = this.session.messages;
    const lines = [];
    if (messages.length === 0) {
      lines.push(th.fg("dim", "(waiting for first message...)"));
      return lines;
    }
    const results = new Map;
    for (const msg of messages) {
      if (msg.role === "toolResult")
        results.set(msg.toolCallId, msg);
    }
    const foldedCalls = new Set;
    const mode = this.markdownMode();
    let needsSeparator = false;
    for (const msg of messages) {
      if (msg.role === "user") {
        const text = typeof msg.content === "string" ? msg.content : extractText(msg.content);
        if (!text.trim())
          continue;
        if (needsSeparator)
          lines.push(th.fg("dim", "───"));
        lines.push(th.fg("accent", "[User]"));
        for (const line of wrapTextWithAnsi(text.trim(), width)) {
          lines.push(line);
        }
      } else if (msg.role === "assistant") {
        const textParts = [];
        const toolCalls = [];
        for (const c of msg.content) {
          if (c.type === "text" && c.text)
            textParts.push(c.text);
          else if (c.type === "toolCall")
            toolCalls.push(c);
        }
        if (needsSeparator)
          lines.push(th.fg("dim", "───"));
        lines.push(th.bold("[Assistant]"));
        if (textParts.length > 0) {
          const text = textParts.join(`
`).trim();
          lines.push(...mode === "off" ? this.rawLines(text, width, false) : this.markdownLines(msg, text, width, false));
        }
        for (const call of toolCalls) {
          if (!this.toolRendering) {
            lines.push(truncateToWidth2(th.fg("muted", `  [Tool: ${call.name}]`), width));
            continue;
          }
          foldedCalls.add(call.id);
          const notRun = msg.stopReason === "aborted" ? "Operation aborted" : msg.stopReason === "error" ? msg.errorMessage || "Error" : undefined;
          lines.push(...this.toolBlockLines(call, results.get(call.id), notRun, width));
        }
      } else if (msg.role === "toolResult") {
        if (foldedCalls.has(msg.toolCallId))
          continue;
        const { text, elided } = capResult(extractText(msg.content).trim());
        if (!text)
          continue;
        if (needsSeparator)
          lines.push(th.fg("dim", "───"));
        lines.push(th.fg("dim", "[Result]"));
        lines.push(...mode === "all" ? this.markdownLines(msg, text, width, true) : this.rawLines(text, width, true));
        if (elided)
          lines.push(truncateToWidth2(th.fg("dim", truncationNote(elided)), width));
      } else if (msg.role === "bashExecution") {
        const bash = msg;
        if (needsSeparator)
          lines.push(th.fg("dim", "───"));
        lines.push(truncateToWidth2(th.fg("muted", `  $ ${bash.command}`), width));
        if (bash.output?.trim()) {
          const { text, elided } = capResult(bash.output.trim());
          lines.push(...this.rawLines(text, width, true));
          if (elided)
            lines.push(truncateToWidth2(th.fg("dim", truncationNote(elided)), width));
        }
      } else {
        continue;
      }
      needsSeparator = true;
    }
    if (this.record.status === "running" && this.activity) {
      const act = describeActivity(this.activity.activeTools, this.activity.responseText);
      lines.push("");
      lines.push(truncateToWidth2(th.fg("accent", "▍ ") + th.fg("dim", act), width));
    }
    return lines.map((l) => visibleWidth(l) > width ? truncateToWidth2(l, width) : l);
  }
  toolBlockLines(call, result, notRun, width) {
    let block = this.toolBlocks.get(call.id);
    let changed = false;
    if (!block) {
      const component = new ToolExecutionComponent(call.name, call.id, call.arguments, { showImages: false }, this.session.extensionRunner.resolveToolRenderers(call.name, () => this.session.getToolDefinition(call.name)) ?? {}, this.tui, this.session.sessionManager.getCwd());
      component.setExpanded(this.toolsExpanded);
      if (notRun && !result)
        component.updateResult({ content: [{ type: "text", text: notRun }], isError: true });
      block = { component };
      this.toolBlocks.set(call.id, block);
      changed = true;
    }
    if (result && block.result !== result) {
      block.result = result;
      block.component.updateResult({
        content: result.content,
        details: result.details,
        isError: result.isError,
        durationMs: result.durationMs
      });
      changed = true;
    }
    if (!changed && block.rows && block.width === width)
      return block.rows;
    block.rows = block.component.render(width);
    block.width = width;
    return block.rows;
  }
}
var CHROME_LINES_BASE = 6, MIN_VIEWPORT = 3, VIEWPORT_HEIGHT_PCT = 70, SCROLLBAR_WIDTH = 1, RESULT_MAX_CHARS = 16000, MARKDOWN_MODES, MARKDOWN_MODE_LABELS, MARKDOWN_OPTIONS;
var init_conversation_viewer = __esm(() => {
  init_agent_color();
  init_agent_widget();
  init_viewer_keys();
  MARKDOWN_MODES = ["off", "assistant", "all"];
  MARKDOWN_MODE_LABELS = {
    off: "raw",
    assistant: "md",
    all: "md+"
  };
  MARKDOWN_OPTIONS = {
    preserveOrderedListMarkers: true,
    preserveBackslashEscapes: true
  };
});

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/index.ts
init_agent_color();
import { existsSync as existsSync13, mkdirSync as mkdirSync5, readFileSync as readFileSync10, unlinkSync as unlinkSync2, writeFileSync as writeFileSync4 } from "node:fs";
import { isAbsolute as isAbsolute5, join as join13 } from "node:path";
import { defineTool as defineTool3, getAgentDir as getAgentDir11, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, isKeyRelease as isKeyRelease2, Key as Key2, matchesKey as matchesKey5, SettingsList, Spacer, Text as Text2 } from "@earendil-works/pi-tui";
import { Type as Type3 } from "typebox";

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/agent-file-toggle.ts
init_custom_agents();
import { existsSync as existsSync3 } from "node:fs";
import { join as join3, sep as sep2 } from "node:path";
import { getAgentDir as getAgentDir3 } from "@earendil-works/pi-coding-agent";
var projectAgentsDir = (cwd = process.cwd()) => join3(cwd, ".pi", "agents");
var workspaceAgentsDir = (cwd = process.cwd()) => join3(cwd, ".agents", "agents");
var personalAgentsDir = () => join3(getAgentDir3(), "agents");
function findAgentFile(name, cwd = process.cwd()) {
  const projectPath = join3(projectAgentsDir(cwd), `${name}.md`);
  if (existsSync3(projectPath))
    return { path: projectPath, location: "project" };
  const workspacePath = join3(workspaceAgentsDir(cwd), `${name}.md`);
  if (existsSync3(workspacePath))
    return { path: workspacePath, location: "workspace" };
  const personalPath = join3(personalAgentsDir(), `${name}.md`);
  if (existsSync3(personalPath))
    return { path: personalPath, location: "personal" };
  return;
}
function locateAgentFile(name, sourcePath, cwd = process.cwd(), source) {
  if (source !== "package" && sourcePath && existsSync3(sourcePath)) {
    return { path: sourcePath, location: classifyAgentDir(sourcePath, cwd) };
  }
  return findAgentFile(name, cwd);
}
function classifyAgentDir(path, cwd) {
  if (path.startsWith(projectAgentsDir(cwd) + sep2))
    return "project";
  if (path.startsWith(workspaceAgentsDir(cwd) + sep2))
    return "workspace";
  return "personal";
}
var ENABLED_FALSE = /^enabled:[ \t]*false[ \t]*$/;
var FENCE = /^---[ \t]*$/;
function splitFrontmatter(content) {
  const lines = content.split(/(?<=\n)/);
  if (lines.length === 0)
    return;
  const bom = content.startsWith("\uFEFF");
  const first = (bom ? lines[0].slice(1) : lines[0]).replace(/\r?\n$/, "");
  if (!FENCE.test(first))
    return;
  const closeIdx = lines.findIndex((l, i) => i > 0 && FENCE.test(l.replace(/\r?\n$/, "")));
  if (closeIdx === -1)
    return;
  return { lines, openIdx: 0, closeIdx, eol: lines[0].endsWith(`\r
`) ? `\r
` : `
` };
}
function isDisabledContent(content) {
  try {
    return parseAgentFrontmatter(content).frontmatter.enabled === false;
  } catch {
    return false;
  }
}
function disableInContent(content) {
  const block = splitFrontmatter(content);
  if (!block)
    return { content, outcome: "no-frontmatter" };
  if (isDisabledContent(content))
    return { content, outcome: "already-disabled" };
  const lines = [...block.lines];
  lines.splice(1, 0, `enabled: false${block.eol}`);
  return { content: lines.join(""), outcome: "disabled" };
}
function enableInContent(content) {
  const block = splitFrontmatter(content);
  if (!block)
    return { content, changed: false };
  const kept = block.lines.filter((l, i) => !(i > 0 && i < block.closeIdx && ENABLED_FALSE.test(l.replace(/\r?\n$/, ""))));
  if (kept.length === block.lines.length)
    return { content, changed: false };
  return { content: kept.join(""), changed: true };
}
function isEmptyStub(content) {
  return content.replace(/\r\n/g, `
`).trim() === `---
---`;
}
function buildNewAgentFile(input) {
  const modelLine = input.model ? `
model: ${JSON.stringify(input.model)}` : "";
  const thinkingLine = input.thinking ? `
thinking: ${input.thinking}` : "";
  return `---
description: ${JSON.stringify(input.description)}
tools: ${input.tools}${modelLine}${thinkingLine}
prompt_mode: replace
---

${input.systemPrompt}
`;
}
function formatToolsField(tools, extSelectors, mcpToolPatterns) {
  const selectors = [...extSelectors ?? [], ...mcpToolPatterns ?? []];
  if (tools === undefined)
    return selectors.length > 0 ? ["*", ...selectors].join(", ") : "all";
  if (tools.length === 0)
    return selectors.length > 0 ? selectors.join(", ") : "none";
  return [...tools, ...selectors].join(", ");
}
function serializeAgentFile(cfg) {
  const fmFields = [];
  fmFields.push(`description: ${JSON.stringify(cfg.description)}`);
  if (cfg.displayName)
    fmFields.push(`display_name: ${cfg.displayName}`);
  if (cfg.color)
    fmFields.push(`color: ${JSON.stringify(cfg.color)}`);
  fmFields.push(`tools: ${formatToolsField(cfg.builtinToolNames, cfg.extSelectors, cfg.mcpToolPatterns)}`);
  if (cfg.model)
    fmFields.push(`model: ${cfg.model}`);
  if (cfg.thinking)
    fmFields.push(`thinking: ${cfg.thinking}`);
  if (cfg.maxTurns)
    fmFields.push(`max_turns: ${cfg.maxTurns}`);
  if (cfg.allowedSubagents !== undefined) {
    fmFields.push(`allowed_subagents: ${cfg.allowedSubagents === "all" ? "all" : cfg.allowedSubagents.join(", ")}`);
  }
  fmFields.push(`prompt_mode: ${cfg.promptMode}`);
  if (cfg.extensions === false)
    fmFields.push("extensions: false");
  else if (Array.isArray(cfg.extensions))
    fmFields.push(`extensions: ${cfg.extensions.join(", ")}`);
  if (cfg.excludeExtensions?.length)
    fmFields.push(`exclude_extensions: ${cfg.excludeExtensions.join(", ")}`);
  if (cfg.skills === false)
    fmFields.push("skills: false");
  else if (Array.isArray(cfg.skills))
    fmFields.push(`skills: ${cfg.skills.join(", ")}`);
  if (cfg.disallowedTools?.length)
    fmFields.push(`disallowed_tools: ${cfg.disallowedTools.join(", ")}`);
  if (cfg.inheritContext)
    fmFields.push("inherit_context: true");
  if (cfg.runInBackground !== undefined)
    fmFields.push(`run_in_background: ${cfg.runInBackground}`);
  if (cfg.outputTranscript === false)
    fmFields.push("output_transcript: false");
  if (cfg.isolated)
    fmFields.push("isolated: true");
  if (cfg.memory)
    fmFields.push(`memory: ${cfg.memory}`);
  if (cfg.isolation)
    fmFields.push(`isolation: ${cfg.isolation}`);
  if (cfg.persistSession !== undefined)
    fmFields.push(`persist_session: ${cfg.persistSession}`);
  if (cfg.sessionDir)
    fmFields.push(`session_dir: ${JSON.stringify(cfg.sessionDir)}`);
  return `---
${fmFields.join(`
`)}
---

${cfg.systemPrompt}
`;
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/index.ts
init_agent_manager();
init_agent_record_entry();
init_agent_runner();

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/agent-source-badge.ts
function sourceIndicator(cfg) {
  const disabled = cfg?.enabled === false;
  if (cfg?.source === "project")
    return disabled ? "✕• " : "•  ";
  if (cfg?.source === "global")
    return disabled ? "✕◦ " : "◦  ";
  if (cfg?.source === "package")
    return disabled ? "✕▪ " : "▪  ";
  if (disabled)
    return "✕  ";
  return "   ";
}
function sourceLegend(cfgs) {
  const parts = [];
  if (cfgs.some((c) => c?.source === "project"))
    parts.push("• = project");
  if (cfgs.some((c) => c?.source === "global"))
    parts.push("◦ = global");
  if (cfgs.some((c) => c?.source === "package"))
    parts.push("▪ = package");
  if (cfgs.some((c) => c?.enabled === false))
    parts.push("✕ = disabled");
  return parts.join("  ");
}
function rowDescription(name, cfg, packageName) {
  const base = cfg?.enabled === false ? "(disabled)" : cfg?.description ?? name;
  return packageName ? `${packageName} · ${base}` : base;
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/index.ts
init_agent_types();
init_child_context();

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/completion-outbox.ts
var NOTIFICATION_HOLD_MS = 200;

class CompletionOutbox {
  send;
  parentRunning;
  items = [];
  timer;
  constructor(send, parentRunning) {
    this.send = send;
    this.parentRunning = parentRunning;
  }
  add(item) {
    for (const id of item.ids)
      this.cancel(id);
    this.items.push(item);
    if (!this.parentRunning())
      this.arm();
  }
  onTurnEnd(stopReason) {
    if (stopReason !== "aborted" && stopReason !== "error")
      this.flush();
  }
  cancel(id) {
    for (const item of this.items)
      item.ids = item.ids.filter((i) => i !== id);
    this.items = this.items.filter((item) => item.ids.length > 0);
  }
  onAgentEnd() {
    if (this.items.length > 0)
      this.arm();
  }
  dispose() {
    if (this.timer)
      clearTimeout(this.timer);
    this.timer = undefined;
    this.items = [];
  }
  arm() {
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, NOTIFICATION_HOLD_MS);
  }
  flush() {
    if (this.timer)
      clearTimeout(this.timer);
    this.timer = undefined;
    const items = this.items;
    this.items = [];
    const messages = items.map((item) => item.build(item.ids));
    if (messages.length === 0)
      return;
    try {
      this.send(combine(messages));
    } catch {}
  }
}
function combine(messages) {
  if (messages.length === 1)
    return messages[0];
  const [first, ...rest] = messages.flatMap(({ details: { others, ...own } }) => [own, ...others ?? []]);
  return {
    content: `${messages.length} background tasks finished.

${messages.map((m) => m.content).join(`

`)}`,
    details: { ...first, others: rest }
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/cross-extension-rpc.ts
init_agent_manager();
init_model_resolver();
init_model_scope();
var PROTOCOL_VERSION = 2;
function handleRpc(events, channel, fn) {
  return events.on(channel, async (raw) => {
    const params = raw;
    try {
      const data = await fn(params);
      const reply = { success: true };
      if (data !== undefined)
        reply.data = data;
      events.emit(`${channel}:reply:${params.requestId}`, reply);
    } catch (err) {
      events.emit(`${channel}:reply:${params.requestId}`, {
        success: false,
        error: err?.message ?? String(err)
      });
    }
  });
}
function registerRpcHandlers(deps) {
  const { events, pi, getCtx, manager } = deps;
  const unsubPing = handleRpc(events, "subagents:rpc:ping", () => {
    return { version: PROTOCOL_VERSION };
  });
  const unsubSpawn = handleRpc(events, "subagents:rpc:spawn", async ({ type, prompt, options }) => {
    const ctx = getCtx();
    if (!ctx)
      throw new Error("No active session");
    let normalizedOptions = options ?? {};
    const override = normalizedOptions.model;
    if (override != null) {
      const { modelRegistry, cwd } = ctx;
      const label = typeof override === "string" ? override : `${override.provider}/${override.id}`;
      if (!modelRegistry) {
        throw new Error(`Model override "${label}" provided but ctx.modelRegistry is unavailable`);
      }
      let model = override;
      if (typeof override === "string") {
        const resolved2 = resolveModel(override, modelRegistry);
        if (typeof resolved2 === "string") {
          throw new Error(resolved2);
        }
        model = resolved2;
        normalizedOptions = { ...normalizedOptions, model: resolved2 };
      }
      const verdict = checkModelScope({
        model,
        cwd: cwd ?? process.cwd(),
        modelRegistry,
        callerSupplied: true,
        agentLabel: type,
        modelInput: label
      });
      if (verdict.kind === "error")
        throw new Error(verdict.message);
    }
    const id = manager.spawn(pi, ctx, type, prompt, normalizedOptions);
    await manager.awaitStartup(id);
    return { id };
  });
  const assertOwned = (agentId) => {
    const record = manager.getRecord(agentId);
    if (!record)
      throw new Error("Agent not found");
    if (!isTopLevelAgent(record))
      throw new Error("Agent is owned by another agent or workflow");
  };
  const unsubStop = handleRpc(events, "subagents:rpc:stop", ({ agentId }) => {
    assertOwned(agentId);
    if (!manager.abort(agentId))
      throw new Error("Agent is not running");
  });
  const unsubConsume = handleRpc(events, "subagents:rpc:consume", ({ agentId }) => {
    if (!manager.consumeResult(agentId))
      throw new Error("Agent not found or still running");
  });
  const unsubSteer = handleRpc(events, "subagents:rpc:steer", ({ agentId, message }) => {
    if (typeof message !== "string" || message.trim().length === 0)
      throw new Error("Steer message must be a non-empty string");
    assertOwned(agentId);
    if (!manager.steer(agentId, message))
      throw new Error("Agent is not running");
  });
  return { unsubPing, unsubSpawn, unsubStop, unsubConsume, unsubSteer };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/index.ts
init_custom_agents();

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/group-join.ts
var DEFAULT_TIMEOUT = 30000;
var STRAGGLER_TIMEOUT = 15000;

class GroupJoinManager {
  deliverCb;
  groupTimeout;
  groups = new Map;
  agentToGroup = new Map;
  constructor(deliverCb, groupTimeout = DEFAULT_TIMEOUT) {
    this.deliverCb = deliverCb;
    this.groupTimeout = groupTimeout;
  }
  registerGroup(groupId, agentIds) {
    const group = {
      groupId,
      agentIds: new Set(agentIds),
      completedRecords: new Map,
      delivered: false,
      isStraggler: false
    };
    this.groups.set(groupId, group);
    for (const id of agentIds) {
      this.agentToGroup.set(id, groupId);
    }
  }
  onAgentComplete(record) {
    const groupId = this.agentToGroup.get(record.id);
    if (!groupId)
      return "pass";
    const group = this.groups.get(groupId);
    if (!group || group.delivered)
      return "pass";
    group.completedRecords.set(record.id, record);
    if (group.completedRecords.size >= group.agentIds.size) {
      this.deliver(group, false);
      return "delivered";
    }
    if (!group.timeoutHandle) {
      const timeout = group.isStraggler ? STRAGGLER_TIMEOUT : this.groupTimeout;
      group.timeoutHandle = setTimeout(() => {
        this.onTimeout(group);
      }, timeout);
    }
    return "held";
  }
  onTimeout(group) {
    if (group.delivered)
      return;
    group.timeoutHandle = undefined;
    const remaining = new Set;
    for (const id of group.agentIds) {
      if (!group.completedRecords.has(id))
        remaining.add(id);
    }
    for (const id of group.completedRecords.keys()) {
      this.agentToGroup.delete(id);
    }
    this.deliverCb([...group.completedRecords.values()], true);
    group.completedRecords.clear();
    group.agentIds = remaining;
    group.isStraggler = true;
  }
  deliver(group, partial) {
    if (group.timeoutHandle) {
      clearTimeout(group.timeoutHandle);
      group.timeoutHandle = undefined;
    }
    group.delivered = true;
    this.deliverCb([...group.completedRecords.values()], partial);
    this.cleanupGroup(group.groupId);
  }
  cleanupGroup(groupId) {
    const group = this.groups.get(groupId);
    if (!group)
      return;
    for (const id of group.agentIds) {
      this.agentToGroup.delete(id);
    }
    this.groups.delete(groupId);
  }
  isGrouped(agentId) {
    return this.agentToGroup.has(agentId);
  }
  dispose() {
    for (const group of this.groups.values()) {
      if (group.timeoutHandle)
        clearTimeout(group.timeoutHandle);
    }
    this.groups.clear();
    this.agentToGroup.clear();
  }
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/index.ts
init_invocation_config();
init_mention();

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/mention-clone.ts
init_child_context();
init_mention();
import {
  createAgentSession as createAgentSession2,
  DefaultResourceLoader as DefaultResourceLoader2,
  getAgentDir as getAgentDir8,
  SessionManager as SessionManager2
} from "@earendil-works/pi-coding-agent";
async function runMentionClone(opts) {
  const { ctx, type, message, agentTool } = opts;
  let spawned = false;
  const cloneAgentTool = {
    ...agentTool,
    execute: (_cloneToolCallId, params, signal, onUpdate, _cloneCtx) => {
      if (spawned) {
        return Promise.resolve({
          content: [{ type: "text", text: "Already started an agent for this mention. Stop here." }],
          details: undefined,
          isError: true
        });
      }
      spawned = true;
      return agentTool.execute(undefined, { ...params, run_in_background: true }, signal, onUpdate, ctx);
    }
  };
  let session;
  try {
    const parentModelRuntime = ctx.modelRegistry.runtime;
    const thinkingLevel = ctx.thinkingLevel;
    const systemPrompt = ctx.getSystemPrompt();
    const loader = new DefaultResourceLoader2({
      cwd: ctx.cwd,
      agentDir: getAgentDir8(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: (base) => systemPrompt || base,
      appendSystemPromptOverride: () => []
    });
    await runInChildSessionContext(() => loader.reload());
    const created = await runInChildSessionContext(() => createAgentSession2({
      cwd: ctx.cwd,
      sessionManager: SessionManager2.inMemory(ctx.cwd, undefined, ctx.sessionManager.getBranch()),
      resourceLoader: loader,
      model: ctx.model,
      ...thinkingLevel && { thinkingLevel },
      modelRegistry: ctx.modelRegistry,
      ...parentModelRuntime !== undefined && { modelRuntime: parentModelRuntime },
      tools: [cloneAgentTool.name],
      customTools: [cloneAgentTool]
    }));
    session = created.session;
    await session.prompt(`${message}

${agentMentionReminder(type)}`);
  } catch (err) {
    return { spawned, error: err instanceof Error ? err.message : String(err) };
  } finally {
    session?.dispose?.();
  }
  return spawned ? { spawned: true } : { spawned: false, error: "the conversation clone did not start it" };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/index.ts
init_model_resolver();
init_model_scope();
init_nested_tools();
init_output_file();
init_package_resources();

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/schedule.ts
import { randomBytes } from "node:crypto";

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/vendor/croner.js
function T(s) {
  return Date.UTC(s.y, s.m - 1, s.d, s.h, s.i, s.s);
}
function D(s, e) {
  return s.y === e.y && s.m === e.m && s.d === e.d && s.h === e.h && s.i === e.i && s.s === e.s;
}
function A(s, e) {
  let t = new Date(Date.parse(s));
  if (isNaN(t))
    throw new Error("Invalid ISO8601 passed to timezone parser.");
  let r = s.substring(9);
  return r.includes("Z") || r.includes("+") || r.includes("-") ? b(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds(), "Etc/UTC") : b(t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds(), e);
}
function v(s, e, t) {
  return k(A(s, e), t);
}
function k(s, e) {
  let t = new Date(T(s)), r = g(t, s.tz), n = T(s), i = T(r), a = n - i, o = new Date(t.getTime() + a), h = g(o, s.tz);
  if (D(h, s)) {
    let u = new Date(o.getTime() - 3600000), d = g(u, s.tz);
    return D(d, s) ? u : o;
  }
  let l = new Date(o.getTime() + T(s) - T(h)), y = g(l, s.tz);
  if (D(y, s))
    return l;
  if (e)
    throw new Error("Invalid date passed to fromTZ()");
  return o.getTime() > l.getTime() ? o : l;
}
function g(s, e) {
  let t, r;
  try {
    t = new Intl.DateTimeFormat("en-US", { timeZone: e, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hour12: false }), r = t.formatToParts(s);
  } catch (i) {
    let a = i instanceof Error ? i.message : String(i);
    throw new RangeError(`toTZ: Invalid timezone '${e}' or date. Please provide a valid IANA timezone (e.g., 'America/New_York', 'Europe/Stockholm'). Original error: ${a}`);
  }
  let n = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (let i of r)
    (i.type === "year" || i.type === "month" || i.type === "day" || i.type === "hour" || i.type === "minute" || i.type === "second") && (n[i.type] = parseInt(i.value, 10));
  if (isNaN(n.year) || isNaN(n.month) || isNaN(n.day) || isNaN(n.hour) || isNaN(n.minute) || isNaN(n.second))
    throw new Error(`toTZ: Failed to parse all date components from timezone '${e}'. This may indicate an invalid date or timezone configuration. Parsed components: ${JSON.stringify(n)}`);
  return n.hour === 24 && (n.hour = 0), { y: n.year, m: n.month, d: n.day, h: n.hour, i: n.minute, s: n.second, tz: e };
}
function b(s, e, t, r, n, i, a) {
  return { y: s, m: e, d: t, h: r, i: n, s: i, tz: a };
}
var O = [1, 2, 4, 8, 16];
var C = class {
  pattern;
  timezone;
  mode;
  alternativeWeekdays;
  sloppyRanges;
  second;
  minute;
  hour;
  day;
  month;
  dayOfWeek;
  year;
  lastDayOfMonth;
  lastWeekday;
  nearestWeekdays;
  starDOM;
  starDOW;
  starYear;
  useAndLogic;
  constructor(e, t, r) {
    this.pattern = e, this.timezone = t, this.mode = r?.mode ?? "auto", this.alternativeWeekdays = r?.alternativeWeekdays ?? false, this.sloppyRanges = r?.sloppyRanges ?? false, this.second = Array(60).fill(0), this.minute = Array(60).fill(0), this.hour = Array(24).fill(0), this.day = Array(31).fill(0), this.month = Array(12).fill(0), this.dayOfWeek = Array(7).fill(0), this.year = Array(1e4).fill(0), this.lastDayOfMonth = false, this.lastWeekday = false, this.nearestWeekdays = Array(31).fill(0), this.starDOM = false, this.starDOW = false, this.starYear = false, this.useAndLogic = false, this.parse();
  }
  parse() {
    if (!(typeof this.pattern == "string" || this.pattern instanceof String))
      throw new TypeError("CronPattern: Pattern has to be of type string.");
    this.pattern.indexOf("@") >= 0 && (this.pattern = this.handleNicknames(this.pattern).trim());
    let e = this.pattern.match(/\S+/g) || [""], t = e.length;
    if (e.length < 5 || e.length > 7)
      throw new TypeError("CronPattern: invalid configuration format ('" + this.pattern + "'), exactly five, six, or seven space separated parts are required.");
    if (this.mode !== "auto") {
      let n;
      switch (this.mode) {
        case "5-part":
          n = 5;
          break;
        case "6-part":
          n = 6;
          break;
        case "7-part":
          n = 7;
          break;
        case "5-or-6-parts":
          n = [5, 6];
          break;
        case "6-or-7-parts":
          n = [6, 7];
          break;
        default:
          n = 0;
      }
      if (!(Array.isArray(n) ? n.includes(t) : t === n)) {
        let a = Array.isArray(n) ? n.join(" or ") : n.toString();
        throw new TypeError(`CronPattern: mode '${this.mode}' requires exactly ${a} parts, but pattern '${this.pattern}' has ${t} parts.`);
      }
    }
    if (e.length === 5 && e.unshift("0"), e.length === 6 && e.push("*"), e[3].toUpperCase() === "LW" ? (this.lastWeekday = true, e[3] = "") : e[3].toUpperCase().indexOf("L") >= 0 && (e[3] = e[3].replace(/L/gi, ""), this.lastDayOfMonth = true), e[3] == "*" && (this.starDOM = true), e[6] == "*" && (this.starYear = true), e[4].length >= 3 && (e[4] = this.replaceAlphaMonths(e[4])), e[5].length >= 3 && (e[5] = this.alternativeWeekdays ? this.replaceAlphaDaysQuartz(e[5]) : this.replaceAlphaDays(e[5])), e[5].startsWith("+") && (this.useAndLogic = true, e[5] = e[5].substring(1), e[5] === ""))
      throw new TypeError("CronPattern: Day-of-week field cannot be empty after '+' modifier.");
    switch (e[5] == "*" && (this.starDOW = true), this.pattern.indexOf("?") >= 0 && (e[0] = e[0].replace(/\?/g, "*"), e[1] = e[1].replace(/\?/g, "*"), e[2] = e[2].replace(/\?/g, "*"), e[3] = e[3].replace(/\?/g, "*"), e[4] = e[4].replace(/\?/g, "*"), e[5] = e[5].replace(/\?/g, "*"), e[6] && (e[6] = e[6].replace(/\?/g, "*"))), this.mode) {
      case "5-part":
        e[0] = "0", e[6] = "*";
        break;
      case "6-part":
        e[6] = "*";
        break;
      case "5-or-6-parts":
        e[6] = "*";
        break;
      case "6-or-7-parts":
        break;
      case "7-part":
      case "auto":
        break;
    }
    this.throwAtIllegalCharacters(e), this.partToArray("second", e[0], 0, 1), this.partToArray("minute", e[1], 0, 1), this.partToArray("hour", e[2], 0, 1), this.partToArray("day", e[3], -1, 1), this.partToArray("month", e[4], -1, 1);
    let r = this.alternativeWeekdays ? -1 : 0;
    this.partToArray("dayOfWeek", e[5], r, 63), this.partToArray("year", e[6], 0, 1), !this.alternativeWeekdays && this.dayOfWeek[7] && (this.dayOfWeek[0] = this.dayOfWeek[7]);
  }
  partToArray(e, t, r, n) {
    let i = this[e], a = e === "day" && this.lastDayOfMonth, o = e === "day" && this.lastWeekday;
    if (t === "" && !a && !o)
      throw new TypeError("CronPattern: configuration entry " + e + " (" + t + ") is empty, check for trailing spaces.");
    if (t === "*")
      return i.fill(n);
    let h = t.split(",");
    if (h.length > 1)
      for (let l = 0;l < h.length; l++)
        this.partToArray(e, h[l], r, n);
    else
      t.indexOf("-") !== -1 && t.indexOf("/") !== -1 ? this.handleRangeWithStepping(t, e, r, n) : t.indexOf("-") !== -1 ? this.handleRange(t, e, r, n) : t.indexOf("/") !== -1 ? this.handleStepping(t, e, r, n) : t !== "" && this.handleNumber(t, e, r, n);
  }
  throwAtIllegalCharacters(e) {
    for (let t = 0;t < e.length; t++)
      if ((t === 3 ? /[^/*0-9,\-WwLl]+/ : t === 5 ? /[^/*0-9,\-#Ll]+/ : /[^/*0-9,\-]+/).test(e[t]))
        throw new TypeError("CronPattern: configuration entry " + t + " (" + e[t] + ") contains illegal characters.");
  }
  handleNumber(e, t, r, n) {
    let i = this.extractNth(e, t), a = e.toUpperCase().includes("W");
    if (t !== "day" && a)
      throw new TypeError("CronPattern: Nearest weekday modifier (W) only allowed in day-of-month.");
    a && (t = "nearestWeekdays");
    let o = parseInt(i[0], 10) + r;
    if (isNaN(o))
      throw new TypeError("CronPattern: " + t + " is not a number: '" + e + "'");
    this.setPart(t, o, i[1] || n);
  }
  setPart(e, t, r) {
    if (!Object.prototype.hasOwnProperty.call(this, e))
      throw new TypeError("CronPattern: Invalid part specified: " + e);
    if (e === "dayOfWeek") {
      if (t === 7 && (t = 0), t < 0 || t > 6)
        throw new RangeError("CronPattern: Invalid value for dayOfWeek: " + t);
      this.setNthWeekdayOfMonth(t, r);
      return;
    }
    if (e === "second" || e === "minute") {
      if (t < 0 || t >= 60)
        throw new RangeError("CronPattern: Invalid value for " + e + ": " + t);
    } else if (e === "hour") {
      if (t < 0 || t >= 24)
        throw new RangeError("CronPattern: Invalid value for " + e + ": " + t);
    } else if (e === "day" || e === "nearestWeekdays") {
      if (t < 0 || t >= 31)
        throw new RangeError("CronPattern: Invalid value for " + e + ": " + t);
    } else if (e === "month") {
      if (t < 0 || t >= 12)
        throw new RangeError("CronPattern: Invalid value for " + e + ": " + t);
    } else if (e === "year" && (t < 1 || t >= 1e4))
      throw new RangeError("CronPattern: Invalid value for " + e + ": " + t + " (supported range: 1-9999)");
    this[e][t] = r;
  }
  validateNotNaN(e, t) {
    if (isNaN(e))
      throw new TypeError(t);
  }
  validateRange(e, t, r, n, i) {
    if (e > t)
      throw new TypeError("CronPattern: From value is larger than to value: '" + i + "'");
    if (r !== undefined) {
      if (r === 0)
        throw new TypeError("CronPattern: Syntax error, illegal stepping: 0");
      if (r > this[n].length)
        throw new TypeError("CronPattern: Syntax error, steps cannot be greater than maximum value of part (" + this[n].length + ")");
    }
  }
  handleRangeWithStepping(e, t, r, n) {
    if (e.toUpperCase().includes("W"))
      throw new TypeError("CronPattern: Syntax error, W is not allowed in ranges with stepping.");
    let i = this.extractNth(e, t), a = i[0].match(/^(\d+)-(\d+)\/(\d+)$/);
    if (a === null)
      throw new TypeError("CronPattern: Syntax error, illegal range with stepping: '" + e + "'");
    let [, o, h, l] = a, y = parseInt(o, 10) + r, u = parseInt(h, 10) + r, d = parseInt(l, 10);
    this.validateNotNaN(y, "CronPattern: Syntax error, illegal lower range (NaN)"), this.validateNotNaN(u, "CronPattern: Syntax error, illegal upper range (NaN)"), this.validateNotNaN(d, "CronPattern: Syntax error, illegal stepping: (NaN)"), this.validateRange(y, u, d, t, e);
    for (let c = y;c <= u; c += d)
      this.setPart(t, c, i[1] || n);
  }
  extractNth(e, t) {
    let r = e, n;
    if (r.includes("#")) {
      if (t !== "dayOfWeek")
        throw new Error("CronPattern: nth (#) only allowed in day-of-week field");
      n = r.split("#")[1], r = r.split("#")[0];
    } else if (r.toUpperCase().endsWith("L")) {
      if (t !== "dayOfWeek")
        throw new Error("CronPattern: L modifier only allowed in day-of-week field (use L alone for day-of-month)");
      n = "L", r = r.slice(0, -1);
    }
    return [r, n];
  }
  handleRange(e, t, r, n) {
    if (e.toUpperCase().includes("W"))
      throw new TypeError("CronPattern: Syntax error, W is not allowed in a range.");
    let i = this.extractNth(e, t), a = i[0].split("-");
    if (a.length !== 2)
      throw new TypeError("CronPattern: Syntax error, illegal range: '" + e + "'");
    let o = parseInt(a[0], 10) + r, h = parseInt(a[1], 10) + r;
    this.validateNotNaN(o, "CronPattern: Syntax error, illegal lower range (NaN)"), this.validateNotNaN(h, "CronPattern: Syntax error, illegal upper range (NaN)"), this.validateRange(o, h, undefined, t, e);
    for (let l = o;l <= h; l++)
      this.setPart(t, l, i[1] || n);
  }
  handleStepping(e, t, r, n) {
    if (e.toUpperCase().includes("W"))
      throw new TypeError("CronPattern: Syntax error, W is not allowed in parts with stepping.");
    let i = this.extractNth(e, t), a = i[0].split("/");
    if (a.length !== 2)
      throw new TypeError("CronPattern: Syntax error, illegal stepping: '" + e + "'");
    if (this.sloppyRanges)
      a[0] === "" && (a[0] = "*");
    else {
      if (a[0] === "")
        throw new TypeError("CronPattern: Syntax error, stepping with missing prefix ('" + e + "') is not allowed. Use wildcard (*/step) or range (min-max/step) instead.");
      if (a[0] !== "*")
        throw new TypeError("CronPattern: Syntax error, stepping with numeric prefix ('" + e + "') is not allowed. Use wildcard (*/step) or range (min-max/step) instead.");
    }
    let o = 0;
    a[0] !== "*" && (o = parseInt(a[0], 10) + r);
    let h = parseInt(a[1], 10);
    this.validateNotNaN(h, "CronPattern: Syntax error, illegal stepping: (NaN)"), this.validateRange(0, this[t].length - 1, h, t, e);
    for (let l = o;l < this[t].length; l += h)
      this.setPart(t, l, i[1] || n);
  }
  replaceAlphaDays(e) {
    return e.replace(/-sun/gi, "-7").replace(/sun/gi, "0").replace(/mon/gi, "1").replace(/tue/gi, "2").replace(/wed/gi, "3").replace(/thu/gi, "4").replace(/fri/gi, "5").replace(/sat/gi, "6");
  }
  replaceAlphaDaysQuartz(e) {
    return e.replace(/sun/gi, "1").replace(/mon/gi, "2").replace(/tue/gi, "3").replace(/wed/gi, "4").replace(/thu/gi, "5").replace(/fri/gi, "6").replace(/sat/gi, "7");
  }
  replaceAlphaMonths(e) {
    return e.replace(/jan/gi, "1").replace(/feb/gi, "2").replace(/mar/gi, "3").replace(/apr/gi, "4").replace(/may/gi, "5").replace(/jun/gi, "6").replace(/jul/gi, "7").replace(/aug/gi, "8").replace(/sep/gi, "9").replace(/oct/gi, "10").replace(/nov/gi, "11").replace(/dec/gi, "12");
  }
  handleNicknames(e) {
    let t = e.trim().toLowerCase();
    if (t === "@yearly" || t === "@annually")
      return "0 0 1 1 *";
    if (t === "@monthly")
      return "0 0 1 * *";
    if (t === "@weekly")
      return "0 0 * * 0";
    if (t === "@daily" || t === "@midnight")
      return "0 0 * * *";
    if (t === "@hourly")
      return "0 * * * *";
    if (t === "@reboot")
      throw new TypeError("CronPattern: @reboot is not supported in this environment. This is an event-based trigger that requires system startup detection.");
    return e;
  }
  setNthWeekdayOfMonth(e, t) {
    if (typeof t != "number" && t.toUpperCase() === "L")
      this.dayOfWeek[e] = this.dayOfWeek[e] | 32;
    else if (t === 63)
      this.dayOfWeek[e] = 63;
    else if (t < 6 && t > 0)
      this.dayOfWeek[e] = this.dayOfWeek[e] | O[t - 1];
    else
      throw new TypeError(`CronPattern: nth weekday out of range, should be 1-5 or L. Value: ${t}, Type: ${typeof t}`);
  }
};
var P = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
var f = [["month", "year", 0], ["day", "month", -1], ["hour", "day", 0], ["minute", "hour", 0], ["second", "minute", 0]];
var m = class s {
  tz;
  ms;
  second;
  minute;
  hour;
  day;
  month;
  year;
  constructor(e, t) {
    if (this.tz = t, e && e instanceof Date)
      if (!isNaN(e))
        this.fromDate(e);
      else
        throw new TypeError("CronDate: Invalid date passed to CronDate constructor");
    else if (e == null)
      this.fromDate(new Date);
    else if (e && typeof e == "string")
      this.fromString(e);
    else if (e instanceof s)
      this.fromCronDate(e);
    else
      throw new TypeError("CronDate: Invalid type (" + typeof e + ") passed to CronDate constructor");
  }
  getLastDayOfMonth(e, t) {
    return t !== 1 ? P[t] : new Date(Date.UTC(e, t + 1, 0)).getUTCDate();
  }
  getLastWeekday(e, t) {
    let r = this.getLastDayOfMonth(e, t), i = new Date(Date.UTC(e, t, r)).getUTCDay();
    return i === 0 ? r - 2 : i === 6 ? r - 1 : r;
  }
  getNearestWeekday(e, t, r) {
    let n = this.getLastDayOfMonth(e, t);
    if (r > n)
      return -1;
    let a = new Date(Date.UTC(e, t, r)).getUTCDay();
    return a === 0 ? r === n ? r - 2 : r + 1 : a === 6 ? r === 1 ? r + 2 : r - 1 : r;
  }
  isNthWeekdayOfMonth(e, t, r, n) {
    let a = new Date(Date.UTC(e, t, r)).getUTCDay(), o = 0;
    for (let h = 1;h <= r; h++)
      new Date(Date.UTC(e, t, h)).getUTCDay() === a && o++;
    if (n & 63 && O[o - 1] & n)
      return true;
    if (n & 32) {
      let h = this.getLastDayOfMonth(e, t);
      for (let l = r + 1;l <= h; l++)
        if (new Date(Date.UTC(e, t, l)).getUTCDay() === a)
          return false;
      return true;
    }
    return false;
  }
  fromDate(e) {
    if (this.tz !== undefined)
      if (typeof this.tz == "number")
        this.ms = e.getUTCMilliseconds(), this.second = e.getUTCSeconds(), this.minute = e.getUTCMinutes() + this.tz, this.hour = e.getUTCHours(), this.day = e.getUTCDate(), this.month = e.getUTCMonth(), this.year = e.getUTCFullYear(), this.apply();
      else
        try {
          let t = g(e, this.tz);
          this.ms = e.getMilliseconds(), this.second = t.s, this.minute = t.i, this.hour = t.h, this.day = t.d, this.month = t.m - 1, this.year = t.y;
        } catch (t) {
          let r = t instanceof Error ? t.message : String(t);
          throw new TypeError(`CronDate: Failed to convert date to timezone '${this.tz}'. This may happen with invalid timezone names or dates. Original error: ${r}`);
        }
    else
      this.ms = e.getMilliseconds(), this.second = e.getSeconds(), this.minute = e.getMinutes(), this.hour = e.getHours(), this.day = e.getDate(), this.month = e.getMonth(), this.year = e.getFullYear();
  }
  fromCronDate(e) {
    this.tz = e.tz, this.year = e.year, this.month = e.month, this.day = e.day, this.hour = e.hour, this.minute = e.minute, this.second = e.second, this.ms = e.ms;
  }
  apply() {
    if (this.month > 11 || this.month < 0 || this.day > P[this.month] || this.day < 1 || this.hour > 59 || this.minute > 59 || this.second > 59 || this.hour < 0 || this.minute < 0 || this.second < 0) {
      let e = new Date(Date.UTC(this.year, this.month, this.day, this.hour, this.minute, this.second, this.ms));
      return this.ms = e.getUTCMilliseconds(), this.second = e.getUTCSeconds(), this.minute = e.getUTCMinutes(), this.hour = e.getUTCHours(), this.day = e.getUTCDate(), this.month = e.getUTCMonth(), this.year = e.getUTCFullYear(), true;
    } else
      return false;
  }
  fromString(e) {
    if (typeof this.tz == "number") {
      let t = v(e);
      this.ms = t.getUTCMilliseconds(), this.second = t.getUTCSeconds(), this.minute = t.getUTCMinutes(), this.hour = t.getUTCHours(), this.day = t.getUTCDate(), this.month = t.getUTCMonth(), this.year = t.getUTCFullYear(), this.apply();
    } else
      return this.fromDate(v(e, this.tz));
  }
  findNext(e, t, r, n) {
    return this._findMatch(e, t, r, n, 1);
  }
  _findMatch(e, t, r, n, i) {
    let a = this[t], o;
    r.lastDayOfMonth && (o = this.getLastDayOfMonth(this.year, this.month));
    let h = !r.starDOW && t == "day" ? new Date(Date.UTC(this.year, this.month, 1, 0, 0, 0, 0)).getUTCDay() : undefined, l = this[t] + n, y = i === 1 ? (u) => u < r[t].length : (u) => u >= 0;
    for (let u = l;y(u); u += i) {
      let d = r[t][u];
      if (t === "day" && !d) {
        for (let c = 0;c < r.nearestWeekdays.length; c++)
          if (r.nearestWeekdays[c]) {
            let M = this.getNearestWeekday(this.year, this.month, c - n);
            if (M === -1)
              continue;
            if (M === u - n) {
              d = 1;
              break;
            }
          }
      }
      if (t === "day" && r.lastWeekday) {
        let c = this.getLastWeekday(this.year, this.month);
        u - n === c && (d = 1);
      }
      if (t === "day" && r.lastDayOfMonth && u - n == o && (d = 1), t === "day" && !r.starDOW) {
        let c = r.dayOfWeek[(h + (u - n - 1)) % 7];
        if (c && c & 63)
          c = this.isNthWeekdayOfMonth(this.year, this.month, u - n, c) ? 1 : 0;
        else if (c)
          throw new Error(`CronDate: Invalid value for dayOfWeek encountered. ${c}`);
        r.useAndLogic ? d = d && c : !e.domAndDow && !r.starDOM ? d = d || c : d = d && c;
      }
      if (d)
        return this[t] = u - n, a !== this[t] ? 2 : 1;
    }
    return 3;
  }
  recurse(e, t, r) {
    if (r === 0 && !e.starYear) {
      if (this.year >= 0 && this.year < e.year.length && e.year[this.year] === 0) {
        let i = -1;
        for (let a = this.year + 1;a < e.year.length && a < 1e4; a++)
          if (e.year[a] === 1) {
            i = a;
            break;
          }
        if (i === -1)
          return null;
        this.year = i, this.month = 0, this.day = 1, this.hour = 0, this.minute = 0, this.second = 0, this.ms = 0;
      }
      if (this.year >= 1e4)
        return null;
    }
    let n = this.findNext(t, f[r][0], e, f[r][2]);
    if (n > 1) {
      let i = r + 1;
      for (;i < f.length; )
        this[f[i][0]] = -f[i][2], i++;
      if (n === 3) {
        if (this[f[r][1]]++, this[f[r][0]] = -f[r][2], this.apply(), r === 0 && !e.starYear) {
          for (;this.year >= 0 && this.year < e.year.length && e.year[this.year] === 0 && this.year < 1e4; )
            this.year++;
          if (this.year >= 1e4 || this.year >= e.year.length)
            return null;
        }
        return this.recurse(e, t, 0);
      } else if (this.apply())
        return this.recurse(e, t, r - 1);
    }
    return r += 1, r >= f.length ? this : (e.starYear ? this.year >= 3000 : this.year >= 1e4) ? null : this.recurse(e, t, r);
  }
  increment(e, t, r) {
    return this.second += t.interval !== undefined && t.interval > 1 && r ? t.interval : 1, this.ms = 0, this.apply(), this.recurse(e, t, 0);
  }
  decrement(e, t) {
    return this.second -= t.interval !== undefined && t.interval > 1 ? t.interval : 1, this.ms = 0, this.apply(), this.recurseBackward(e, t, 0, 0);
  }
  recurseBackward(e, t, r, n = 0) {
    if (n > 1e4)
      return null;
    if (r === 0 && !e.starYear) {
      if (this.year >= 0 && this.year < e.year.length && e.year[this.year] === 0) {
        let a = -1;
        for (let o = this.year - 1;o >= 0; o--)
          if (e.year[o] === 1) {
            a = o;
            break;
          }
        if (a === -1)
          return null;
        this.year = a, this.month = 11, this.day = 31, this.hour = 23, this.minute = 59, this.second = 59, this.ms = 0;
      }
      if (this.year < 0)
        return null;
    }
    let i = this.findPrevious(t, f[r][0], e, f[r][2]);
    if (i > 1) {
      let a = r + 1;
      for (;a < f.length; ) {
        let o = f[a][0], h = f[a][2], l = this.getMaxPatternValue(o, e, h);
        this[o] = l, a++;
      }
      if (i === 3) {
        if (this[f[r][1]]--, r === 0) {
          let y = this.getLastDayOfMonth(this.year, this.month);
          this.day > y && (this.day = y);
        }
        if (r === 1)
          if (this.day <= 0)
            this.day = 1;
          else {
            let y = this.year, u = this.month;
            for (;u < 0; )
              u += 12, y--;
            for (;u > 11; )
              u -= 12, y++;
            let d = u !== 1 ? P[u] : new Date(Date.UTC(y, u + 1, 0)).getUTCDate();
            this.day > d && (this.day = d);
          }
        this.apply();
        let o = f[r][0], h = f[r][2], l = this.getMaxPatternValue(o, e, h);
        if (o === "day") {
          let y = this.getLastDayOfMonth(this.year, this.month);
          this[o] = Math.min(l, y);
        } else
          this[o] = l;
        if (this.apply(), r === 0) {
          let y = f[1][2], u = this.getMaxPatternValue("day", e, y), d = this.getLastDayOfMonth(this.year, this.month), c = Math.min(u, d);
          c !== this.day && (this.day = c, this.hour = this.getMaxPatternValue("hour", e, f[2][2]), this.minute = this.getMaxPatternValue("minute", e, f[3][2]), this.second = this.getMaxPatternValue("second", e, f[4][2]));
        }
        if (r === 0 && !e.starYear) {
          for (;this.year >= 0 && this.year < e.year.length && e.year[this.year] === 0; )
            this.year--;
          if (this.year < 0)
            return null;
        }
        return this.recurseBackward(e, t, 0, n + 1);
      } else if (this.apply())
        return this.recurseBackward(e, t, r - 1, n + 1);
    }
    return r += 1, r >= f.length ? this : this.year < 0 ? null : this.recurseBackward(e, t, r, n + 1);
  }
  getMaxPatternValue(e, t, r) {
    if (e === "day" && t.lastDayOfMonth)
      return this.getLastDayOfMonth(this.year, this.month);
    if (e === "day" && !t.starDOW)
      return this.getLastDayOfMonth(this.year, this.month);
    for (let n = t[e].length - 1;n >= 0; n--)
      if (t[e][n])
        return n - r;
    return t[e].length - 1 - r;
  }
  findPrevious(e, t, r, n) {
    return this._findMatch(e, t, r, n, -1);
  }
  getDate(e) {
    return e || this.tz === undefined ? new Date(this.year, this.month, this.day, this.hour, this.minute, this.second, this.ms) : typeof this.tz == "number" ? new Date(Date.UTC(this.year, this.month, this.day, this.hour, this.minute - this.tz, this.second, this.ms)) : k(b(this.year, this.month + 1, this.day, this.hour, this.minute, this.second, this.tz), false);
  }
  getTime() {
    return this.getDate(false).getTime();
  }
  match(e, t) {
    if (!e.starYear && (this.year < 0 || this.year >= e.year.length || e.year[this.year] === 0))
      return false;
    for (let r = 0;r < f.length; r++) {
      let n = f[r][0], i = f[r][2], a = this[n];
      if (a + i < 0 || a + i >= e[n].length)
        return false;
      let o = e[n][a + i];
      if (n === "day") {
        if (!o) {
          for (let h = 0;h < e.nearestWeekdays.length; h++)
            if (e.nearestWeekdays[h]) {
              let l = this.getNearestWeekday(this.year, this.month, h - i);
              if (l !== -1 && l === a) {
                o = 1;
                break;
              }
            }
        }
        if (e.lastWeekday) {
          let h = this.getLastWeekday(this.year, this.month);
          a === h && (o = 1);
        }
        if (e.lastDayOfMonth) {
          let h = this.getLastDayOfMonth(this.year, this.month);
          a === h && (o = 1);
        }
        if (!e.starDOW) {
          let h = new Date(Date.UTC(this.year, this.month, 1, 0, 0, 0, 0)).getUTCDay(), l = e.dayOfWeek[(h + (a - 1)) % 7];
          l && l & 63 && (l = this.isNthWeekdayOfMonth(this.year, this.month, a, l) ? 1 : 0), e.useAndLogic ? o = o && l : !t.domAndDow && !e.starDOM ? o = o || l : o = o && l;
        }
      }
      if (!o)
        return false;
    }
    return true;
  }
};
function R(s2) {
  if (s2 === undefined && (s2 = {}), delete s2.name, s2.legacyMode !== undefined && s2.domAndDow === undefined ? s2.domAndDow = !s2.legacyMode : s2.domAndDow === undefined && (s2.domAndDow = false), s2.legacyMode = !s2.domAndDow, s2.paused = s2.paused === undefined ? false : s2.paused, s2.maxRuns = s2.maxRuns === undefined ? 1 / 0 : s2.maxRuns, s2.catch = s2.catch === undefined ? false : s2.catch, s2.interval = s2.interval === undefined ? 0 : parseInt(s2.interval.toString(), 10), s2.utcOffset = s2.utcOffset === undefined ? undefined : parseInt(s2.utcOffset.toString(), 10), s2.dayOffset = s2.dayOffset === undefined ? 0 : parseInt(s2.dayOffset.toString(), 10), s2.unref = s2.unref === undefined ? false : s2.unref, s2.mode = s2.mode === undefined ? "auto" : s2.mode, s2.alternativeWeekdays = s2.alternativeWeekdays === undefined ? false : s2.alternativeWeekdays, s2.sloppyRanges = s2.sloppyRanges === undefined ? false : s2.sloppyRanges, !["auto", "5-part", "6-part", "7-part", "5-or-6-parts", "6-or-7-parts"].includes(s2.mode))
    throw new Error("CronOptions: mode must be one of 'auto', '5-part', '6-part', '7-part', '5-or-6-parts', or '6-or-7-parts'.");
  if (s2.startAt && (s2.startAt = new m(s2.startAt, s2.timezone)), s2.stopAt && (s2.stopAt = new m(s2.stopAt, s2.timezone)), s2.interval !== null) {
    if (isNaN(s2.interval))
      throw new Error("CronOptions: Supplied value for interval is not a number");
    if (s2.interval < 0)
      throw new Error("CronOptions: Supplied value for interval can not be negative");
  }
  if (s2.utcOffset !== undefined) {
    if (isNaN(s2.utcOffset))
      throw new Error("CronOptions: Invalid value passed for utcOffset, should be number representing minutes offset from UTC.");
    if (s2.utcOffset < -870 || s2.utcOffset > 870)
      throw new Error("CronOptions: utcOffset out of bounds.");
    if (s2.utcOffset !== undefined && s2.timezone)
      throw new Error("CronOptions: Combining 'utcOffset' with 'timezone' is not allowed.");
  }
  if (s2.unref !== true && s2.unref !== false)
    throw new Error("CronOptions: Unref should be either true, false or undefined(false).");
  if (s2.dayOffset !== undefined && s2.dayOffset !== 0 && isNaN(s2.dayOffset))
    throw new Error("CronOptions: Invalid value passed for dayOffset, should be a number representing days to offset.");
  return s2;
}
function p(s2) {
  return Object.prototype.toString.call(s2) === "[object Function]" || typeof s2 == "function" || s2 instanceof Function;
}
function _(s2) {
  return p(s2);
}
function x(s2) {
  typeof Deno < "u" && typeof Deno.unrefTimer < "u" ? Deno.unrefTimer(s2) : s2 && typeof s2.unref < "u" && s2.unref();
}
var W = 30 * 1000;
var w = [];
var E = class {
  name;
  options;
  _states;
  fn;
  getTz() {
    return this.options.timezone || this.options.utcOffset;
  }
  applyDayOffset(e) {
    if (this.options.dayOffset !== undefined && this.options.dayOffset !== 0) {
      let t = this.options.dayOffset * 24 * 60 * 60 * 1000;
      return new Date(e.getTime() + t);
    }
    return e;
  }
  constructor(e, t, r) {
    let n, i;
    if (p(t))
      i = t;
    else if (typeof t == "object")
      n = t;
    else if (t !== undefined)
      throw new Error("Cron: Invalid argument passed for optionsIn. Should be one of function, or object (options).");
    if (p(r))
      i = r;
    else if (typeof r == "object")
      n = r;
    else if (r !== undefined)
      throw new Error("Cron: Invalid argument passed for funcIn. Should be one of function, or object (options).");
    if (this.name = n?.name, this.options = R(n), this._states = { kill: false, blocking: false, previousRun: undefined, currentRun: undefined, once: undefined, currentTimeout: undefined, maxRuns: n ? n.maxRuns : undefined, paused: n ? n.paused : false, pattern: new C("* * * * *", undefined, { mode: "auto" }) }, e && (e instanceof Date || typeof e == "string" && e.indexOf(":") > 0) ? this._states.once = new m(e, this.getTz()) : this._states.pattern = new C(e, this.options.timezone, { mode: this.options.mode, alternativeWeekdays: this.options.alternativeWeekdays, sloppyRanges: this.options.sloppyRanges }), this.name) {
      if (w.find((o) => o.name === this.name))
        throw new Error("Cron: Tried to initialize new named job '" + this.name + "', but name already taken.");
      w.push(this);
    }
    return i !== undefined && _(i) && (this.fn = i, this.schedule()), this;
  }
  nextRun(e) {
    let t = this._next(e);
    return t ? this.applyDayOffset(t.getDate(false)) : null;
  }
  nextRuns(e, t) {
    this._states.maxRuns !== undefined && e > this._states.maxRuns && (e = this._states.maxRuns);
    let r = t || this._states.currentRun || undefined;
    return this._enumerateRuns(e, r, "next");
  }
  previousRuns(e, t) {
    return this._enumerateRuns(e, t || undefined, "previous");
  }
  _enumerateRuns(e, t, r) {
    let n = [], i = t ? new m(t, this.getTz()) : null, a = r === "next" ? this._next : this._previous;
    for (;e--; ) {
      let o = a.call(this, i);
      if (!o)
        break;
      let h = o.getDate(false);
      n.push(this.applyDayOffset(h)), i = o;
    }
    return n;
  }
  match(e) {
    if (this._states.once) {
      let r = new m(e, this.getTz());
      r.ms = 0;
      let n = new m(this._states.once, this.getTz());
      return n.ms = 0, r.getTime() === n.getTime();
    }
    let t = new m(e, this.getTz());
    return t.ms = 0, t.match(this._states.pattern, this.options);
  }
  getPattern() {
    if (!this._states.once)
      return this._states.pattern ? this._states.pattern.pattern : undefined;
  }
  getOnce() {
    return this._states.once ? this._states.once.getDate() : null;
  }
  isRunning() {
    let e = this.nextRun(this._states.currentRun), t = !this._states.paused, r = this.fn !== undefined, n = !this._states.kill;
    return t && r && n && e !== null;
  }
  isStopped() {
    return this._states.kill;
  }
  isBusy() {
    return this._states.blocking;
  }
  currentRun() {
    return this._states.currentRun ? this._states.currentRun.getDate() : null;
  }
  previousRun() {
    return this._states.previousRun ? this._states.previousRun.getDate() : null;
  }
  msToNext(e) {
    let t = this._next(e);
    return t ? e instanceof m || e instanceof Date ? t.getTime() - e.getTime() : t.getTime() - new m(e).getTime() : null;
  }
  stop() {
    this._states.kill = true, this._states.currentTimeout && clearTimeout(this._states.currentTimeout);
    let e = w.indexOf(this);
    e >= 0 && w.splice(e, 1);
  }
  pause() {
    return this._states.paused = true, !this._states.kill;
  }
  resume() {
    return this._states.paused = false, !this._states.kill;
  }
  schedule(e) {
    if (e && this.fn)
      throw new Error("Cron: It is not allowed to schedule two functions using the same Croner instance.");
    e && (this.fn = e);
    let t = this.msToNext(), r = this.nextRun(this._states.currentRun);
    return t == null || isNaN(t) || r === null ? this : (t > W && (t = W), this._states.currentTimeout = setTimeout(() => this._checkTrigger(r), t), this._states.currentTimeout && this.options.unref && x(this._states.currentTimeout), this);
  }
  async _trigger(e) {
    this._states.blocking = true, this._states.currentRun = new m(undefined, this.getTz());
    try {
      if (this.options.catch)
        try {
          this.fn !== undefined && await this.fn(this, this.options.context);
        } catch (t) {
          if (p(this.options.catch))
            try {
              this.options.catch(t, this);
            } catch {}
        }
      else
        this.fn !== undefined && await this.fn(this, this.options.context);
    } finally {
      this._states.previousRun = new m(e, this.getTz()), this._states.blocking = false;
    }
  }
  async trigger() {
    await this._trigger();
  }
  runsLeft() {
    return this._states.maxRuns;
  }
  _checkTrigger(e) {
    let t = new Date, r = !this._states.paused && t.getTime() >= e.getTime(), n = this._states.blocking && this.options.protect;
    r && !n ? (this._states.maxRuns !== undefined && this._states.maxRuns--, this._trigger()) : r && n && p(this.options.protect) && setTimeout(() => this.options.protect(this), 0), this.schedule();
  }
  _next(e) {
    let t = !!(e || this._states.currentRun), r = false;
    !e && this.options.startAt && this.options.interval && ([e, t] = this._calculatePreviousRun(e, t), r = !e), e = new m(e, this.getTz()), this.options.startAt && e && e.getTime() < this.options.startAt.getTime() && (e = this.options.startAt);
    let n = this._states.once || new m(e, this.getTz());
    return !r && n !== this._states.once && (n = n.increment(this._states.pattern, this.options, t)), this._states.once && this._states.once.getTime() <= e.getTime() || n === null || this._states.maxRuns !== undefined && this._states.maxRuns <= 0 || this._states.kill || this.options.stopAt && n.getTime() >= this.options.stopAt.getTime() ? null : n;
  }
  _previous(e) {
    let t = new m(e, this.getTz());
    this.options.stopAt && t.getTime() > this.options.stopAt.getTime() && (t = this.options.stopAt);
    let r = new m(t, this.getTz());
    return this._states.once ? this._states.once.getTime() < t.getTime() ? this._states.once : null : (r = r.decrement(this._states.pattern, this.options), r === null || this.options.startAt && r.getTime() < this.options.startAt.getTime() ? null : r);
  }
  _calculatePreviousRun(e, t) {
    let r = new m(undefined, this.getTz()), n = e;
    if (this.options.startAt.getTime() <= r.getTime()) {
      n = this.options.startAt;
      let i = n.getTime() + this.options.interval * 1000;
      for (;i <= r.getTime(); )
        n = new m(n, this.getTz()).increment(this._states.pattern, this.options, true), i = n.getTime() + this.options.interval * 1000;
      t = true;
    }
    return n === null && (n = undefined), [n, t];
  }
};

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/schedule.ts
init_agent_runner();
init_agent_types();
init_model_resolver();
var nanoid = (size = 10) => randomBytes(size).toString("base64url").slice(0, size);

class SubagentScheduler {
  jobs = new Map;
  intervals = new Map;
  store;
  pi;
  ctx;
  manager;
  start(pi, ctx, manager, store) {
    this.pi = pi;
    this.ctx = ctx;
    this.manager = manager;
    this.store = store;
    for (const job of store.list()) {
      if (job.enabled)
        this.scheduleJob(job);
    }
  }
  stop() {
    for (const cron of this.jobs.values())
      cron.stop();
    this.jobs.clear();
    for (const t of this.intervals.values())
      clearTimeout(t);
    this.intervals.clear();
    this.store = undefined;
    this.pi = undefined;
    this.ctx = undefined;
    this.manager = undefined;
  }
  isActive() {
    return this.store !== undefined;
  }
  list() {
    return this.store?.list() ?? [];
  }
  buildJob(input) {
    const detected = SubagentScheduler.detectSchedule(input.schedule);
    return {
      id: nanoid(10),
      name: input.name,
      description: input.description,
      schedule: detected.normalized,
      scheduleType: detected.type,
      intervalMs: detected.intervalMs,
      subagent_type: input.subagent_type,
      prompt: input.prompt,
      model: input.model,
      thinking: input.thinking,
      max_turns: input.max_turns,
      isolated: input.isolated,
      isolation: input.isolation,
      enabled: true,
      createdAt: new Date().toISOString(),
      runCount: 0
    };
  }
  addJob(input) {
    const store = this.requireStore();
    if (store.hasName(input.name)) {
      throw new Error(`A scheduled job named "${input.name}" already exists.`);
    }
    const job = this.buildJob(input);
    store.add(job);
    if (job.enabled)
      this.scheduleJob(job);
    this.emit({ type: "added", job });
    return job;
  }
  removeJob(id) {
    const store = this.requireStore();
    if (!store.get(id))
      return false;
    this.unscheduleJob(id);
    const ok = store.remove(id);
    if (ok)
      this.emit({ type: "removed", jobId: id });
    return ok;
  }
  updateJob(id, patch) {
    const store = this.requireStore();
    const updated = store.update(id, patch);
    if (!updated)
      return;
    this.unscheduleJob(id);
    if (updated.enabled)
      this.scheduleJob(updated);
    this.emit({ type: "updated", job: updated });
    return updated;
  }
  getNextRun(jobId) {
    const cron = this.jobs.get(jobId);
    if (cron)
      return cron.nextRun()?.toISOString();
    const job = this.store?.get(jobId);
    if (!job?.enabled)
      return;
    if (job.scheduleType === "once")
      return job.schedule;
    if (job.scheduleType === "interval" && job.intervalMs) {
      const base = job.lastRun ? new Date(job.lastRun).getTime() : Date.now();
      return new Date(base + job.intervalMs).toISOString();
    }
    return;
  }
  scheduleJob(job) {
    const store = this.store;
    if (!store)
      return;
    try {
      if (job.scheduleType === "interval" && job.intervalMs) {
        const t = setInterval(() => this.executeJob(job.id), job.intervalMs);
        this.intervals.set(job.id, t);
      } else if (job.scheduleType === "once") {
        const target = new Date(job.schedule).getTime();
        const delay = target - Date.now();
        if (delay > 0) {
          const t = setTimeout(() => {
            this.executeJob(job.id);
            store.update(job.id, { enabled: false });
            const updated = store.get(job.id);
            if (updated)
              this.emit({ type: "updated", job: updated });
          }, delay);
          this.intervals.set(job.id, t);
        } else {
          store.update(job.id, { enabled: false, lastStatus: "error" });
          this.emit({ type: "error", jobId: job.id, error: `Scheduled time ${job.schedule} is in the past` });
        }
      } else {
        const cron = new E(job.schedule, () => this.executeJob(job.id));
        this.jobs.set(job.id, cron);
      }
    } catch (err) {
      this.emit({ type: "error", jobId: job.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  unscheduleJob(id) {
    const cron = this.jobs.get(id);
    if (cron) {
      cron.stop();
      this.jobs.delete(id);
    }
    const t = this.intervals.get(id);
    if (t) {
      clearTimeout(t);
      clearInterval(t);
      this.intervals.delete(id);
    }
  }
  executeJob(id) {
    const store = this.store;
    const pi = this.pi;
    const ctx = this.ctx;
    const manager = this.manager;
    if (!store || !pi || !ctx || !manager)
      return;
    const job = store.get(id);
    if (!job?.enabled)
      return;
    store.update(id, { lastStatus: "running" });
    let resolvedModel;
    if (job.model) {
      const r = resolveModel(job.model, ctx.modelRegistry, ctx.model);
      if (typeof r !== "string")
        resolvedModel = r;
    }
    let agentId;
    try {
      const dispatch = resolveSpawnType(job.subagent_type);
      if (!dispatch.ok)
        throw new Error(dispatch.message);
      agentId = manager.spawn(pi, ctx, dispatch.type, job.prompt, {
        description: job.description,
        isBackground: true,
        bypassQueue: true,
        model: resolvedModel,
        maxTurns: job.max_turns,
        isolated: job.isolated,
        thinkingLevel: job.thinking,
        isolation: job.isolation,
        invocation: {
          thinking: job.thinking,
          maxTurns: normalizeMaxTurns(job.max_turns),
          isolated: job.isolated,
          runInBackground: true,
          isolation: job.isolation
        }
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      store.update(id, { lastRun: new Date().toISOString(), lastStatus: "error" });
      this.emit({ type: "error", jobId: id, error });
      return;
    }
    this.emit({ type: "fired", jobId: id, agentId, name: job.name });
    const finalize = (status) => {
      const next = this.getNextRun(id);
      const current = store.get(id);
      store.update(id, {
        lastRun: new Date().toISOString(),
        lastStatus: status,
        runCount: (current?.runCount ?? 0) + 1,
        nextRun: next
      });
    };
    manager.awaitStartup(agentId).then(() => manager.getRecord(agentId)?.promise).then(() => {
      const r = manager.getRecord(agentId);
      const failed = r?.status === "error" || r?.status === "aborted" || r?.status === "stopped";
      finalize(failed ? "error" : "success");
    }).catch(() => finalize("error"));
  }
  emit(event) {
    if (this.pi)
      this.pi.events.emit("subagents:scheduled", event);
  }
  requireStore() {
    if (!this.store)
      throw new Error("Scheduler not started — no active session.");
    return this.store;
  }
  static detectSchedule(s2) {
    const trimmed = s2.trim();
    const rel = SubagentScheduler.parseRelativeTime(trimmed);
    if (rel !== null)
      return { type: "once", normalized: rel };
    const ivl = SubagentScheduler.parseInterval(trimmed);
    if (ivl !== null)
      return { type: "interval", intervalMs: ivl, normalized: trimmed };
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      const d = new Date(trimmed);
      if (!Number.isNaN(d.getTime())) {
        if (d.getTime() <= Date.now()) {
          throw new Error(`Scheduled time ${d.toISOString()} is in the past.`);
        }
        return { type: "once", normalized: d.toISOString() };
      }
    }
    const cronCheck = SubagentScheduler.validateCronExpression(trimmed);
    if (cronCheck.valid)
      return { type: "cron", normalized: trimmed };
    throw new Error(`Invalid schedule "${s2}". Use 6-field cron (e.g. "0 0 9 * * 1" — 9am every Monday), interval ("5m"/"1h"), or one-shot ("+10m" / ISO).`);
  }
  static validateCronExpression(expr) {
    const fields = expr.trim().split(/\s+/);
    if (fields.length !== 6) {
      return {
        valid: false,
        error: `Cron must have 6 fields (second minute hour dom month dow), got ${fields.length}. Example: "0 0 9 * * 1" for 9am every Monday.`
      };
    }
    try {
      new E(expr, () => {});
      return { valid: true };
    } catch (e) {
      return { valid: false, error: e instanceof Error ? e.message : "Invalid cron expression" };
    }
  }
  static parseRelativeTime(s2) {
    const m2 = s2.match(/^\+(\d+)(s|m|h|d)$/);
    if (!m2)
      return null;
    const ms = parseInt(m2[1], 10) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m2[2]];
    return new Date(Date.now() + ms).toISOString();
  }
  static parseInterval(s2) {
    const m2 = s2.match(/^(\d+)(s|m|h|d)$/);
    if (!m2)
      return null;
    return parseInt(m2[1], 10) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m2[2]];
  }
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/schedule-store.ts
import { existsSync as existsSync9, mkdirSync as mkdirSync3, readFileSync as readFileSync6, renameSync, unlinkSync, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname3, join as join10 } from "node:path";
var LOCK_RETRY_MS = 50;
var LOCK_MAX_RETRIES = 100;
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function acquireLock(lockPath) {
  for (let i = 0;i < LOCK_MAX_RETRIES; i++) {
    try {
      writeFileSync2(lockPath, `${process.pid}`, { flag: "wx" });
      return;
    } catch (e) {
      if (e.code === "EEXIST") {
        try {
          const pid = parseInt(readFileSync6(lockPath, "utf-8"), 10);
          if (pid && !isProcessRunning(pid)) {
            unlinkSync(lockPath);
            continue;
          }
        } catch {}
        const start = Date.now();
        while (Date.now() - start < LOCK_RETRY_MS) {}
        continue;
      }
      throw e;
    }
  }
  throw new Error(`Failed to acquire schedule lock: ${lockPath}`);
}
function releaseLock(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch {}
}
function resolveStorePath(cwd, sessionId) {
  return join10(cwd, ".pi", "subagent-schedules", `${sessionId}.json`);
}

class ScheduleStore {
  filePath;
  lockPath;
  jobs = new Map;
  constructor(filePath) {
    this.filePath = filePath;
    this.lockPath = filePath + ".lock";
    this.load();
  }
  ensureDir() {
    mkdirSync3(dirname3(this.filePath), { recursive: true });
  }
  load() {
    if (!existsSync9(this.filePath))
      return;
    try {
      const data = JSON.parse(readFileSync6(this.filePath, "utf-8"));
      this.jobs.clear();
      for (const j of data.jobs ?? [])
        this.jobs.set(j.id, j);
    } catch {}
  }
  save() {
    const data = { version: 1, jobs: [...this.jobs.values()] };
    const tmp = this.filePath + ".tmp";
    writeFileSync2(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.filePath);
  }
  withLock(fn) {
    this.ensureDir();
    acquireLock(this.lockPath);
    try {
      this.load();
      const result = fn();
      this.save();
      return result;
    } finally {
      releaseLock(this.lockPath);
    }
  }
  list() {
    return [...this.jobs.values()];
  }
  hasName(name, exceptId) {
    for (const j of this.jobs.values()) {
      if (j.id !== exceptId && j.name === name)
        return true;
    }
    return false;
  }
  get(id) {
    return this.jobs.get(id);
  }
  add(job) {
    this.withLock(() => {
      this.jobs.set(job.id, job);
    });
  }
  update(id, patch) {
    if (!this.jobs.has(id))
      return;
    return this.withLock(() => {
      const existing = this.jobs.get(id);
      if (!existing)
        return;
      const updated = { ...existing, ...patch };
      this.jobs.set(id, updated);
      return updated;
    });
  }
  remove(id) {
    if (!this.jobs.has(id))
      return false;
    return this.withLock(() => this.jobs.delete(id));
  }
  deleteFileIfEmpty() {
    if (this.jobs.size === 0 && existsSync9(this.filePath)) {
      try {
        unlinkSync(this.filePath);
      } catch {}
    }
  }
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/settings.ts
init_agent_types();
import { existsSync as existsSync10, mkdirSync as mkdirSync4, readFileSync as readFileSync7, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname as dirname4, join as join11 } from "node:path";
import { getAgentDir as getAgentDir9 } from "@earendil-works/pi-coding-agent";
var VALID_JOIN_MODES = new Set(["async", "group", "smart"]);
var VALID_TOOL_DESCRIPTION_MODES = new Set(["full", "compact", "custom"]);
var VALID_WIDGET_MODES = new Set(["all", "background", "off"]);
var VALID_VIEWER_MARKDOWN_MODES = new Set(["off", "assistant", "all"]);
var VALID_AGENT_MENTION_MODES = new Set(["model", "direct", "off"]);
var MAX_CONCURRENT_CEILING = 1024;
var MAX_TURNS_CEILING = 1e4;
var GRACE_TURNS_CEILING = 1000;
var SUBAGENT_DEPTH_CEILING = 16;
function sanitizePackageGate(val) {
  if (typeof val === "boolean")
    return val;
  if (typeof val === "string")
    return val.trim() ? [val.trim()] : [];
  if (!Array.isArray(val))
    return;
  return val.filter((e) => typeof e === "string").map((e) => e.trim()).filter(Boolean);
}
function sanitize(raw) {
  if (!raw || typeof raw !== "object")
    return {};
  const r = raw;
  const out = {};
  if (Number.isInteger(r.maxConcurrent) && r.maxConcurrent >= 1 && r.maxConcurrent <= MAX_CONCURRENT_CEILING) {
    out.maxConcurrent = r.maxConcurrent;
  }
  if (Number.isInteger(r.maxConcurrentForeground) && r.maxConcurrentForeground >= 0 && r.maxConcurrentForeground <= MAX_CONCURRENT_CEILING) {
    out.maxConcurrentForeground = r.maxConcurrentForeground;
  }
  if (Number.isInteger(r.defaultMaxTurns) && r.defaultMaxTurns >= 0 && r.defaultMaxTurns <= MAX_TURNS_CEILING) {
    out.defaultMaxTurns = r.defaultMaxTurns;
  }
  if (Number.isInteger(r.graceTurns) && r.graceTurns >= 1 && r.graceTurns <= GRACE_TURNS_CEILING) {
    out.graceTurns = r.graceTurns;
  }
  if (Number.isInteger(r.maxSubagentDepth) && r.maxSubagentDepth >= 0 && r.maxSubagentDepth <= SUBAGENT_DEPTH_CEILING) {
    out.maxSubagentDepth = r.maxSubagentDepth;
  }
  if (typeof r.defaultJoinMode === "string" && VALID_JOIN_MODES.has(r.defaultJoinMode)) {
    out.defaultJoinMode = r.defaultJoinMode;
  }
  if (typeof r.backgroundByDefault === "boolean") {
    out.backgroundByDefault = r.backgroundByDefault;
  }
  if (typeof r.schedulingEnabled === "boolean") {
    out.schedulingEnabled = r.schedulingEnabled;
  }
  if (typeof r.scopeModels === "boolean") {
    out.scopeModels = r.scopeModels;
  }
  if (typeof r.strictAgentFiles === "boolean") {
    out.strictAgentFiles = r.strictAgentFiles;
  }
  if (typeof r.disableDefaultAgents === "boolean") {
    out.disableDefaultAgents = r.disableDefaultAgents;
  }
  if (typeof r.toolDescriptionMode === "string" && VALID_TOOL_DESCRIPTION_MODES.has(r.toolDescriptionMode)) {
    out.toolDescriptionMode = r.toolDescriptionMode;
  }
  if (typeof r.fleetView === "boolean") {
    out.fleetView = r.fleetView;
  }
  if (typeof r.agentMentions === "boolean") {
    out.agentMentions = r.agentMentions ? "model" : "off";
  } else if (typeof r.agentMentions === "string" && VALID_AGENT_MENTION_MODES.has(r.agentMentions)) {
    out.agentMentions = r.agentMentions;
  }
  if (typeof r.rememberAgents === "boolean") {
    out.rememberAgents = r.rememberAgents;
  }
  if (typeof r.widgetMode === "string" && VALID_WIDGET_MODES.has(r.widgetMode)) {
    out.widgetMode = r.widgetMode;
  }
  if (typeof r.outputTranscript === "boolean") {
    out.outputTranscript = r.outputTranscript;
  }
  if (typeof r.worktreeIsolation === "boolean") {
    out.worktreeIsolation = r.worktreeIsolation;
  }
  if (typeof r.reportUsage === "boolean") {
    out.reportUsage = r.reportUsage;
  }
  if (typeof r.showCost === "boolean") {
    out.showCost = r.showCost;
  }
  if (typeof r.showModel === "boolean") {
    out.showModel = r.showModel;
  }
  if (typeof r.viewerMarkdown === "string" && VALID_VIEWER_MARKDOWN_MODES.has(r.viewerMarkdown)) {
    out.viewerMarkdown = r.viewerMarkdown;
  }
  if (typeof r.workflowsEnabled === "boolean") {
    out.workflowsEnabled = r.workflowsEnabled;
  }
  const packageAgents = sanitizePackageGate(r.packageAgents);
  if (packageAgents !== undefined)
    out.packageAgents = packageAgents;
  const packageWorkflows = sanitizePackageGate(r.packageWorkflows);
  if (packageWorkflows !== undefined)
    out.packageWorkflows = packageWorkflows;
  if (r.fallbackSubagent === false) {
    out.fallbackSubagent = NO_FALLBACK;
  } else if (typeof r.fallbackSubagent === "string" && r.fallbackSubagent.trim()) {
    out.fallbackSubagent = r.fallbackSubagent.trim();
  }
  return out;
}
function globalPath() {
  return join11(getAgentDir9(), "subagents.json");
}
function projectPath(cwd) {
  return join11(cwd, ".pi", "subagents.json");
}
function readSettingsFile(path) {
  if (!existsSync10(path))
    return {};
  try {
    return sanitize(JSON.parse(readFileSync7(path, "utf-8")));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[pi-subagents] Ignoring malformed settings at ${path}: ${reason}`);
    return {};
  }
}
function loadSettings(cwd = process.cwd()) {
  return { ...readSettingsFile(globalPath()), ...readSettingsFile(projectPath(cwd)) };
}
function saveSettings(s2, cwd = process.cwd()) {
  const path = projectPath(cwd);
  try {
    mkdirSync4(dirname4(path), { recursive: true });
    writeFileSync3(path, JSON.stringify(s2, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}
function applySettings(s2, appliers) {
  if (typeof s2.maxConcurrent === "number")
    appliers.setMaxConcurrent(s2.maxConcurrent);
  if (typeof s2.maxConcurrentForeground === "number") {
    appliers.setMaxConcurrentForeground(s2.maxConcurrentForeground);
  }
  if (typeof s2.defaultMaxTurns === "number")
    appliers.setDefaultMaxTurns(s2.defaultMaxTurns);
  if (typeof s2.graceTurns === "number")
    appliers.setGraceTurns(s2.graceTurns);
  if (typeof s2.maxSubagentDepth === "number")
    appliers.setMaxSubagentDepth(s2.maxSubagentDepth);
  if (typeof s2.fallbackSubagent === "string")
    appliers.setFallbackSubagent(s2.fallbackSubagent);
  if (s2.defaultJoinMode)
    appliers.setDefaultJoinMode(s2.defaultJoinMode);
  if (typeof s2.backgroundByDefault === "boolean")
    appliers.setBackgroundByDefault(s2.backgroundByDefault);
  if (typeof s2.schedulingEnabled === "boolean")
    appliers.setSchedulingEnabled(s2.schedulingEnabled);
  if (typeof s2.scopeModels === "boolean")
    appliers.setScopeModels(s2.scopeModels);
  if (typeof s2.strictAgentFiles === "boolean")
    appliers.setStrictAgentFiles(s2.strictAgentFiles);
  if (typeof s2.disableDefaultAgents === "boolean")
    appliers.setDisableDefaultAgents(s2.disableDefaultAgents);
  if (s2.toolDescriptionMode)
    appliers.setToolDescriptionMode(s2.toolDescriptionMode);
  if (typeof s2.fleetView === "boolean")
    appliers.setFleetView(s2.fleetView);
  if (s2.agentMentions)
    appliers.setAgentMentions(s2.agentMentions);
  if (typeof s2.rememberAgents === "boolean")
    appliers.setRememberAgents(s2.rememberAgents);
  if (s2.widgetMode)
    appliers.setWidgetMode(s2.widgetMode);
  if (typeof s2.outputTranscript === "boolean")
    appliers.setOutputTranscript(s2.outputTranscript);
  if (typeof s2.worktreeIsolation === "boolean")
    appliers.setWorktreeIsolation(s2.worktreeIsolation);
  if (typeof s2.reportUsage === "boolean")
    appliers.setReportUsage(s2.reportUsage);
  if (typeof s2.showCost === "boolean")
    appliers.setShowCost(s2.showCost);
  if (typeof s2.showModel === "boolean")
    appliers.setShowModel(s2.showModel);
  if (s2.viewerMarkdown)
    appliers.setViewerMarkdown(s2.viewerMarkdown);
  if (typeof s2.workflowsEnabled === "boolean")
    appliers.setWorkflowsEnabled(s2.workflowsEnabled);
  if (s2.packageAgents !== undefined)
    appliers.setPackageAgents(s2.packageAgents);
  if (s2.packageWorkflows !== undefined)
    appliers.setPackageWorkflows(s2.packageWorkflows);
}
function persistToastFor(successMsg, persisted) {
  return persisted ? { message: successMsg, level: "info" } : { message: `${successMsg} (session only; failed to persist)`, level: "warning" };
}
function applyAndEmitLoaded(appliers, emit, cwd = process.cwd()) {
  const settings = loadSettings(cwd);
  applySettings(settings, appliers);
  emit("subagents:settings_loaded", { settings });
  return settings;
}
function saveAndEmitChanged(snapshot, successMsg, emit, cwd = process.cwd()) {
  const persisted = saveSettings(snapshot, cwd);
  emit("subagents:settings_changed", { settings: snapshot, persisted });
  return persistToastFor(successMsg, persisted);
}
// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/ui/agent-mention.ts
init_mention();
function mentionRoster(manager, types, displayNameOf = (type) => type) {
  const live = (r) => r.status === "running" || r.status === "queued";
  const records = manager.listAgents().filter((r) => r.handle !== undefined && r.parentAgentId === undefined).sort((a, b2) => Number(live(b2)) - Number(live(a)) || a.startedAt - b2.startedAt);
  const taken = new Set;
  const targets = [];
  for (const record of records) {
    const handle = record.alias ?? record.handle;
    taken.add(handle.toLowerCase());
    if (record.handle)
      taken.add(record.handle.toLowerCase());
    targets.push({ kind: "record", handle, record, typeLabel: displayNameOf(record.type) });
  }
  for (const entry of manager.listTombstones()) {
    const handle = entry.alias ?? entry.handle;
    if (taken.has(handle.toLowerCase()))
      continue;
    taken.add(handle.toLowerCase());
    taken.add(entry.handle.toLowerCase());
    targets.push({ kind: "tombstone", handle, entry, typeLabel: displayNameOf(entry.type) });
  }
  for (const type of types) {
    const handle = handleBase(type.name);
    if (taken.has(handle))
      continue;
    taken.add(handle);
    targets.push({ kind: "type", handle, type: type.name, description: type.description });
  }
  return targets;
}
function createMentionProvider(current, roster, isEnabled) {
  let warnedInnerFailure = false;
  return {
    triggerCharacters: ["@"],
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const mine = isEnabled() ? mentionItems(roster(), lines[cursorLine] ?? "", cursorCol) : null;
      let theirs = null;
      try {
        theirs = await current.getSuggestions(lines, cursorLine, cursorCol, options);
      } catch (err) {
        if (!warnedInnerFailure) {
          warnedInnerFailure = true;
          console.warn("[pi-subagents] the autocomplete provider below us failed; showing agent rows only:", err);
        }
        theirs = null;
      }
      if (!mine)
        return theirs;
      if (!theirs)
        return mine;
      return { items: [...mine.items, ...theirs.items], prefix: mine.prefix };
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    }
  };
}
function mentionItems(roster, line, cursorCol) {
  const match = MENTION_TRIGGER.exec(line.slice(0, cursorCol));
  if (!match)
    return null;
  const typed = match[2].toLowerCase();
  const items = [];
  for (const target of roster) {
    if (!target.handle.toLowerCase().startsWith(typed))
      continue;
    items.push({ value: `@${target.handle}`, label: `@${target.handle}`, description: describeTarget(target) });
  }
  return items.length > 0 ? { items, prefix: `@${match[2]}` } : null;
}
function describeTarget(target) {
  if (target.kind === "type")
    return `start agent · ${summarize(target.description)}`;
  if (target.kind === "tombstone") {
    return `resume · ${target.typeLabel} · ${target.entry.description}`;
  }
  const { status, description, alias } = target.record;
  const action = status === "running" || status === "queued" ? "send message" : "resume";
  const identity = alias ? `${target.typeLabel} · ` : "";
  return `${action} · ${identity}${status} · ${description}`;
}
function summarize(description) {
  const first = (description.match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? description).replace(/\s+/g, " ").trim();
  return first.length > 60 ? `${first.slice(0, 59).trimEnd()}…` : first;
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/index.ts
init_agent_widget();
init_conversation_viewer();

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/ui/fleet-list.ts
init_agent_color();
init_agent_manager();
init_agent_widget();
init_conversation_viewer();
import { isKeyRelease, Key, matchesKey as matchesKey3, truncateToWidth as truncateToWidth3, visibleWidth as visibleWidth2 } from "@earendil-works/pi-tui";
var FLEET_KEY = "fleet";
var MAX_AGENT_ROWS = 5;
var TICK_MS = 200;
var FINISHED_LINGER_MS = 4000;
function formatFleetElapsed(ms) {
  return `${Math.max(0, Math.round(ms / 1000))}s`;
}
function formatFleetTokens(count) {
  let compact;
  if (count >= 1e6)
    compact = `${(count / 1e6).toFixed(1)}M`;
  else if (count >= 1000)
    compact = `${(count / 1000).toFixed(1)}k`;
  else
    compact = `${count}`;
  return `↓ ${compact} tokens`;
}
function rightAlign(left, right, width) {
  const rightW = visibleWidth2(right);
  const maxLeft = Math.max(0, width - rightW - 1);
  const leftClamped = truncateToWidth3(left, maxLeft);
  const gap = Math.max(1, width - visibleWidth2(leftClamped) - rightW);
  return truncateToWidth3(leftClamped + " ".repeat(gap) + right, width);
}

class FleetList {
  manager;
  agentActivity;
  showCost;
  viewerMarkdown;
  onViewerMarkdown;
  scrollbarMode;
  backgroundAction;
  ui;
  tui;
  inputUnsub;
  widgetRegistered = false;
  timer;
  enabled = true;
  active = false;
  selectedIndex = 0;
  viewerClose;
  viewingAgentId;
  workflowSource;
  openWorkflow;
  viewingWorkflowId;
  constructor(manager, agentActivity, showCost = () => false, viewerMarkdown, onViewerMarkdown, scrollbarMode = () => "auto", backgroundAction) {
    this.manager = manager;
    this.agentActivity = agentActivity;
    this.showCost = showCost;
    this.viewerMarkdown = viewerMarkdown;
    this.onViewerMarkdown = onViewerMarkdown;
    this.scrollbarMode = scrollbarMode;
    this.backgroundAction = backgroundAction;
  }
  setEnabled(enabled) {
    if (enabled === this.enabled)
      return;
    this.enabled = enabled;
    if (!enabled)
      this.active = false;
    this.update();
  }
  setUICtx(ui) {
    if (ui === this.ui)
      return;
    this.inputUnsub?.();
    this.ui = ui;
    this.widgetRegistered = false;
    this.tui = undefined;
    this.inputUnsub = ui.onTerminalInput((data) => this.handleKey(data));
  }
  ensureTimer() {
    if (!this.timer)
      this.timer = setInterval(() => this.update(), TICK_MS);
  }
  onAgentFinished(_id) {
    this.update();
  }
  dispose() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.inputUnsub?.();
    this.inputUnsub = undefined;
    if (this.viewerClose) {
      this.viewerClose();
      this.viewerClose = undefined;
    }
    this.viewingAgentId = undefined;
    this.viewingWorkflowId = undefined;
    if (this.ui && this.widgetRegistered)
      this.ui.setWidget(FLEET_KEY, undefined);
    this.widgetRegistered = false;
    this.tui = undefined;
    this.active = false;
    this.ui = undefined;
  }
  update() {
    if (!this.ui)
      return;
    const hasRows = this.enabled && this.roster().length > 1;
    if (!hasRows) {
      if (this.widgetRegistered) {
        this.ui.setWidget(FLEET_KEY, undefined);
        this.widgetRegistered = false;
        this.tui = undefined;
      }
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
      this.active = false;
      this.selectedIndex = 0;
      return;
    }
    this.clampSelection();
    this.ensureTimer();
    if (!this.widgetRegistered) {
      this.ui.setWidget(FLEET_KEY, (tui, theme) => {
        this.tui = tui;
        return {
          render: (w2) => this.renderBar(w2, theme),
          invalidate: () => {
            this.widgetRegistered = false;
            this.tui = undefined;
          }
        };
      }, { placement: "belowEditor" });
      this.widgetRegistered = true;
    } else {
      this.tui?.requestRender();
    }
  }
  agentRecords() {
    const now = Date.now();
    return this.manager.listAgents().filter((a) => isTopLevelAgent(a) && a.session && (a.status === "running" || a.status === "queued" || a.id === this.viewingAgentId || a.completedAt != null && now - a.completedAt < FINISHED_LINGER_MS)).sort((a, b2) => a.startedAt - b2.startedAt);
  }
  setWorkflowSource(source, open) {
    this.workflowSource = source;
    this.openWorkflow = open;
  }
  workflows() {
    if (!this.workflowSource)
      return [];
    const now = Date.now();
    return [...this.workflowSource()].filter((run) => run.status === "running" || run.status === "paused" || run.completedAt != null && now - run.completedAt < FINISHED_LINGER_MS).sort((a, b2) => a.startedAt - b2.startedAt);
  }
  roster() {
    return [
      { kind: "main" },
      ...this.workflows().map((workflow) => ({ kind: "workflow", workflow })),
      ...this.agentRecords().map((record) => ({ kind: "agent", record }))
    ];
  }
  clampSelection() {
    const max = this.roster().length - 1;
    if (this.selectedIndex > max)
      this.selectedIndex = Math.max(0, max);
    if (this.selectedIndex < 0)
      this.selectedIndex = 0;
  }
  handleKey(data) {
    if (!this.enabled || !this.ui)
      return;
    if (isKeyRelease(data))
      return;
    if (this.viewerClose || this.viewingWorkflowId)
      return;
    if (!this.editorHasFocus()) {
      if (this.active)
        this.deactivate();
      return;
    }
    if (!this.active) {
      const isActivator = matchesKey3(data, "down") || matchesKey3(data, "left");
      if (isActivator && this.roster().length > 1 && this.ui.getEditorText() === "") {
        this.active = true;
        this.selectedIndex = 0;
        this.update();
        return { consume: true };
      }
      return;
    }
    if (matchesKey3(data, "down")) {
      const max = this.roster().length - 1;
      this.selectedIndex = Math.min(max, this.selectedIndex + 1);
      this.update();
      return { consume: true };
    }
    if (matchesKey3(data, "up")) {
      if (this.selectedIndex === 0) {
        this.deactivate();
        return { consume: true };
      }
      this.selectedIndex -= 1;
      this.update();
      return { consume: true };
    }
    if (matchesKey3(data, "escape")) {
      this.deactivate();
      return { consume: true };
    }
    if (matchesKey3(data, Key.enter)) {
      this.openSelected();
      return { consume: true };
    }
    this.deactivate();
    return;
  }
  editorHasFocus() {
    const focused = this.tui?.focusedComponent;
    if (focused == null)
      return true;
    const c = focused;
    return typeof c.getText === "function" && typeof c.setText === "function";
  }
  deactivate() {
    this.active = false;
    this.selectedIndex = 0;
    this.update();
  }
  openSelected() {
    const entry = this.roster()[this.selectedIndex];
    if (!entry || entry.kind === "main") {
      this.deactivate();
      return;
    }
    if (entry.kind === "workflow") {
      this.viewingWorkflowId = entry.workflow.id;
      Promise.resolve(this.openWorkflow?.(entry.workflow.id)).then(() => this.clearViewer(), () => this.clearViewer());
      return;
    }
    const record = entry.record;
    if (!this.ui)
      return;
    if (!record.session) {
      this.ui.notify(`Agent is ${record.status} — no session available.`, "info");
      return;
    }
    const session = record.session;
    const activity = this.agentActivity.get(record.id);
    this.viewingAgentId = record.id;
    let overlayOptions = getConversationOverlayOptions({ mode: "regular" });
    this.ui.custom((tui, theme, keybindings, done) => {
      overlayOptions = getConversationOverlayOptions(tui);
      this.viewerClose = () => done(undefined);
      return new ConversationViewer(tui, session, record, activity, theme, done, () => {
        if (this.manager.abort(record.id))
          this.ui?.notify(`Stopped "${record.description}".`, "info");
      }, keybindings, (message) => this.manager.steer(record.id, message), this.showCost(), this.viewerMarkdown, this.onViewerMarkdown, this.scrollbarMode(), this.backgroundAction?.(record, (message) => this.ui?.notify(message, "info")));
    }, {
      overlay: true,
      overlayOptions: () => overlayOptions
    }).then(() => this.clearViewer(), () => this.clearViewer());
  }
  clearViewer() {
    const viewed = this.viewingAgentId ?? this.viewingWorkflowId;
    if (viewed !== undefined) {
      const idx = this.roster().findIndex((e) => e.kind === "agent" ? e.record.id === viewed : e.kind === "workflow" ? e.workflow.id === viewed : false);
      if (idx >= 0)
        this.selectedIndex = idx;
    }
    this.viewerClose = undefined;
    this.viewingAgentId = undefined;
    this.viewingWorkflowId = undefined;
    this.update();
  }
  renderBar(width, theme) {
    const rows = this.roster().slice(1);
    if (rows.length === 0)
      return [];
    const sel = Math.min(this.selectedIndex, rows.length);
    const hint = this.active ? "↑↓ select · enter view · esc back" : "esc to interrupt · ← for agents · ↓ to manage";
    const lines = [];
    lines.push(truncateToWidth3("  " + theme.fg("dim", hint), width));
    lines.push("");
    lines.push(truncateToWidth3(`  ${this.bullet(0, sel, theme)} main`, width));
    const visible = Math.min(MAX_AGENT_ROWS, rows.length);
    const selRow = Math.max(0, sel - 1);
    const start = selRow < visible ? 0 : selRow - visible + 1;
    const hiddenBelow = rows.length - (start + visible);
    if (start > 0)
      lines.push(rightAlign("", theme.fg("dim", `↑ ${start} more`), width));
    for (let a = start;a < start + visible; a++) {
      const row = rows[a];
      lines.push(row.kind === "workflow" ? this.renderWorkflowRow(a + 1, sel, row.workflow, width, theme) : this.renderAgentRow(a + 1, sel, row.record, width, theme));
    }
    if (hiddenBelow > 0)
      lines.push(rightAlign("", theme.fg("dim", `↓ ${hiddenBelow} more`), width));
    lines.push("");
    return lines;
  }
  bullet(rosterIndex, sel, theme) {
    return rosterIndex === sel ? theme.fg("accent", "●") : theme.fg("dim", "○");
  }
  renderWorkflowRow(rosterIndex, sel, workflow, width, theme) {
    const selected = rosterIndex === sel;
    const kind = theme.fg(selected ? "text" : "muted", "workflow");
    const name = selected ? theme.fg("text", workflow.name) : workflow.name;
    const left = `  ${this.bullet(rosterIndex, sel, theme)} ${kind}  ${name}`;
    const elapsed = (workflow.completedAt ?? Date.now()) - workflow.startedAt;
    const agents2 = `${workflow.doneCount}/${workflow.totalCount} agent${workflow.totalCount === 1 ? "" : "s"}`;
    const stats = `${agents2} · ${formatFleetElapsed(elapsed)} · ${formatFleetTokens(workflow.tokens)}`;
    return rightAlign(left, selected ? theme.fg("text", stats) : theme.fg("dim", stats), width);
  }
  renderAgentRow(rosterIndex, sel, record, width, theme) {
    const selected = rosterIndex === sel;
    const name = renderAgentName(record.type, theme, selected ? { fallbackColor: "text", bold: hasAgentBadge(record.type) } : { fallbackColor: "muted" });
    const description = selected ? theme.fg("text", record.description) : record.description;
    const left = `  ${this.bullet(rosterIndex, sel, theme)} ${name}  ${description}`;
    const tokens = getLifetimeTotal(record.lifetimeUsage);
    const elapsedMs = (record.completedAt ?? Date.now()) - record.startedAt;
    const cost = this.showCost() ? formatCost(getLifetimeCost(record.lifetimeUsage)) : "";
    const stats = `${formatFleetElapsed(elapsedMs)} · ${formatFleetTokens(tokens)}${cost ? ` · ${cost}` : ""}`;
    const right = selected ? theme.fg("text", stats) : theme.fg("dim", stats);
    return rightAlign(left, right, width);
  }
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/ui/select-item.ts
async function selectItem(ui, title, items, format) {
  const width = String(items.length).length;
  const rows = items.map((item, i) => ({
    item,
    label: `${String(i + 1).padStart(width)}. ${format(item, i)}`
  }));
  const choice = await ui.select(title, rows.map((r) => r.label));
  if (!choice)
    return;
  return rows.find((r) => r.label === choice)?.item;
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/ui/schedule-menu.ts
function relTime(iso, now = Date.now()) {
  if (!iso)
    return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t))
    return "—";
  const diff = t - now;
  const abs = Math.abs(diff);
  const future = diff > 0;
  if (abs < 60000)
    return future ? "in <1m" : "<1m ago";
  const m2 = Math.round(abs / 60000);
  if (m2 < 60)
    return future ? `in ${m2}m` : `${m2}m ago`;
  const h = Math.round(abs / 3600000);
  if (h < 24)
    return future ? `in ${h}h` : `${h}h ago`;
  const d = Math.round(abs / 86400000);
  return future ? `in ${d}d` : `${d}d ago`;
}
function statusIcon(j) {
  if (!j.enabled)
    return "✗";
  if (j.lastStatus === "error")
    return "!";
  if (j.lastStatus === "running")
    return "⋯";
  return "✓";
}
function formatJob(j, scheduler) {
  const next = scheduler.getNextRun(j.id);
  return [
    statusIcon(j),
    j.name.padEnd(18).slice(0, 18),
    j.schedule.padEnd(14).slice(0, 14),
    `[${j.subagent_type}]`,
    `next ${relTime(next)}`,
    `last ${relTime(j.lastRun)}`,
    `runs ${j.runCount}`
  ].join("  ");
}
function formatDetails(j, scheduler) {
  const next = scheduler.getNextRun(j.id) ?? "—";
  return [
    `name:      ${j.name}`,
    `schedule:  ${j.schedule} (${j.scheduleType})`,
    `agent:     ${j.subagent_type}`,
    `prompt:    ${j.prompt.slice(0, 200)}${j.prompt.length > 200 ? "…" : ""}`,
    `created:   ${j.createdAt}`,
    `last run:  ${j.lastRun ?? "—"} (${j.lastStatus ?? "—"})`,
    `next run:  ${next}`,
    `runs:      ${j.runCount}`
  ].join(`
`);
}
async function showSchedulesMenu(ctx, scheduler) {
  if (!scheduler.isActive()) {
    ctx.ui.notify("Scheduler is not active in this session.", "warning");
    return;
  }
  const jobs = scheduler.list();
  if (jobs.length === 0) {
    ctx.ui.notify("No scheduled jobs.", "info");
    return;
  }
  const job = await selectItem(ctx.ui, `Scheduled jobs (${jobs.length}) — select to cancel`, jobs, (j) => formatJob(j, scheduler));
  if (!job)
    return;
  const ok = await ctx.ui.confirm(`Cancel "${job.name}"?`, formatDetails(job, scheduler));
  if (!ok)
    return;
  scheduler.removeJob(job.id);
  ctx.ui.notify(`Cancelled "${job.name}".`, "info");
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/ui/workflow-card.ts
import { stripTerminalSequences as stripTerminalSequences2, Text, truncateToWidth as truncateToWidth4, visibleWidth as visibleWidth3 } from "@earendil-works/pi-tui";

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/progress.ts
function collapse(progress) {
  const agents2 = new Map;
  const logs = [];
  const phaseTitles = new Map;
  for (const entry of progress) {
    if (entry.type === "workflow_agent")
      agents2.set(entry.index, entry);
    else if (entry.type === "workflow_log")
      logs.push(entry.message);
    else
      phaseTitles.set(entry.index, entry.title);
  }
  return {
    agents: [...agents2.values()].sort((a, b2) => a.index - b2.index),
    logs,
    phaseTitles
  };
}
function displayState(entry, workflowActive) {
  if (entry.state === "done")
    return "done";
  if (entry.state === "error") {
    if (entry.skipped)
      return "skipped";
    if (entry.blocked)
      return "blocked";
    return "failed";
  }
  if (!workflowActive)
    return "interrupted";
  return entry.queuedAt != null && entry.startedAt == null ? "queued" : "running";
}
function isLive(entry) {
  return entry.state === "start" || entry.state === "progress";
}
function groupByPhase(agents2, phaseTitles) {
  if (!agents2.some((a) => a.phaseIndex != null))
    return null;
  const byPhase = new Map;
  for (const agent of agents2) {
    const phaseIndex = agent.phaseIndex ?? 0;
    let group = byPhase.get(phaseIndex);
    if (!group) {
      group = { phaseIndex, title: phaseTitles.get(phaseIndex) ?? `Phase ${phaseIndex}`, agents: [] };
      byPhase.set(phaseIndex, group);
    }
    group.agents.push(agent);
  }
  return [...byPhase.values()].sort((a, b2) => a.phaseIndex - b2.phaseIndex);
}
function summarize2(group) {
  let done = 0;
  let failed = 0;
  let tokens = 0;
  let minStart = Number.POSITIVE_INFINITY;
  let maxProgress = 0;
  for (const agent of group.agents) {
    if (agent.state === "done")
      done++;
    else if (agent.state === "error")
      failed++;
    if (agent.tokens)
      tokens += agent.tokens;
    if (agent.startedAt != null) {
      if (agent.startedAt < minStart)
        minStart = agent.startedAt;
      const last = agent.lastProgressAt ?? agent.startedAt;
      if (last > maxProgress)
        maxProgress = last;
    }
  }
  const total = group.agents.length;
  const finished = done + failed === total && total > 0;
  return {
    title: group.title,
    status: finished ? failed > 0 ? "failed" : "done" : "running",
    agents: group.agents,
    doneCount: done,
    totalCount: total,
    tokens,
    durationMs: minStart < Number.POSITIVE_INFINITY ? maxProgress - minStart : 0
  };
}
function placeholder(title) {
  return { title, status: "not-started", agents: [], doneCount: 0, totalCount: 0, tokens: 0, durationMs: 0 };
}
var normalizeTitle = (title) => title.toLowerCase().trim();
function mergePhases(declared, observed) {
  const consumed = new Set;
  const merged = [];
  for (const phase of declared ?? []) {
    const wanted = normalizeTitle(phase.title);
    const match = observed.find((group) => {
      if (consumed.has(group))
        return false;
      const actual = normalizeTitle(group.title);
      return actual === wanted || actual.startsWith(wanted) || wanted.startsWith(actual);
    });
    if (match) {
      consumed.add(match);
      merged.push(summarize2(match));
    } else {
      merged.push(placeholder(phase.title));
    }
  }
  for (const group of observed) {
    if (!consumed.has(group))
      merged.push(summarize2(group));
  }
  return merged;
}
function buildPhaseGroups(progress, declared) {
  const { agents: agents2, phaseTitles } = collapse(progress);
  const observed = groupByPhase(agents2, phaseTitles) ?? [];
  const merged = mergePhases(declared, observed);
  if (merged.length === 0 && agents2.length > 0) {
    return [summarize2({ title: "Agents", agents: agents2 })];
  }
  if (agents2.length > 0 && !merged.some((group) => group.totalCount > 0)) {
    return [...merged, summarize2({ title: "Agents", agents: agents2 })];
  }
  return merged;
}
function stats(progress, agentCount = 0) {
  let seen = 0;
  let done = 0;
  let failed = 0;
  let started = 0;
  let anyLive = false;
  for (const entry of collapse(progress).agents) {
    seen++;
    if (entry.state === "done") {
      done++;
      started++;
    } else if (entry.state === "error") {
      failed++;
      started++;
    } else {
      anyLive = true;
      if (entry.startedAt !== undefined || entry.queuedAt === undefined)
        started++;
    }
  }
  const total = Math.max(agentCount, seen);
  return {
    done,
    failedCount: failed,
    running: anyLive,
    total,
    started,
    complete: !anyLive && seen > 0 && done + failed >= total
  };
}
function elapsedMs(task, now) {
  return Math.max(0, (task.endTime ?? now) - task.startTime - (task.totalPausedMs ?? 0));
}
var plural = (n, word) => n === 1 ? word : `${word}s`;
function formatDuration2(ms) {
  if (ms < 1000)
    return `${Math.max(0, Math.round(ms))}ms`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0)
    return `${seconds}s`;
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}
function header(task, meta, groups, agentCount, now) {
  const suffix = task.status === "completed" ? " · done" : task.status === "killed" ? " · stopped" : task.status === "paused" ? " · paused" : task.status === "failed" ? " · failed" : "";
  let doneAgents = 0;
  let totalAgents = 0;
  for (const group of groups) {
    doneAgents += group.doneCount;
    totalAgents += group.totalCount;
  }
  totalAgents = Math.max(agentCount, totalAgents, doneAgents);
  return {
    name: task.workflowName ?? meta?.name ?? task.summary ?? task.description ?? "workflow",
    subtext: meta?.description ?? task.description ?? task.summary ?? "",
    stats: `${doneAgents}/${totalAgents} ${plural(totalAgents, "agent")} · ${formatDuration2(elapsedMs(task, now))}${suffix}`
  };
}
var DEFAULT_AGENT_CAP = 25;
var DEFAULT_TOKEN_CAP = 1500000;
var ASSUMED_TOKENS_PER_AGENT = 70000;
function sizeWarning(input) {
  const agentCap = input.agentCap ?? DEFAULT_AGENT_CAP;
  const tokenCap = input.tokenCap ?? DEFAULT_TOKEN_CAP;
  const perAgent = input.startedAgents > 0 ? input.totalTokens / input.startedAgents : ASSUMED_TOKENS_PER_AGENT;
  const projectedTokens = Math.max(input.totalTokens, Math.round(perAgent * input.scheduledAgents));
  const overAgents = input.scheduledAgents > agentCap;
  const overTokens = input.totalTokens > tokenCap || projectedTokens > tokenCap;
  if (!overAgents && !overTokens)
    return;
  return {
    axis: overAgents && overTokens ? "both" : overAgents ? "agents" : "tokens",
    scheduledAgents: input.scheduledAgents,
    totalTokens: input.totalTokens,
    projectedTokens,
    agentCap,
    tokenCap
  };
}
var GERUND_OVERRIDES = new Map([
  ["commit", "committing"],
  ["submit", "submitting"],
  ["format", "formatting"],
  ["setup", null],
  ["cleanup", null]
]);

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/ui/workflow-card.ts
var LABEL_COLUMN_MAX = 28;
var DEFAULT_WIDTH = 80;
var UNICODE_GLYPHS = {
  pointer: "▸",
  tick: "✔",
  cross: "✘",
  running: "⟳",
  groupTop: "╭─",
  groupMid: "├─",
  groupBottom: "╰─",
  vertical: "│",
  branch: "├─",
  lastBranch: "└─",
  log: "⎿",
  warning: "⚠"
};
var ASCII_GLYPHS = {
  pointer: ">",
  tick: "√",
  cross: "×",
  running: "*",
  groupTop: ",-",
  groupMid: "|-",
  groupBottom: "`-",
  vertical: "|",
  branch: "|-",
  lastBranch: "`-",
  log: "\\",
  warning: "!"
};
function formatCompactTokens(count) {
  if (count >= 1e6)
    return `${(count / 1e6).toFixed(1)}M`;
  if (count >= 1000)
    return `${(count / 1000).toFixed(1)}k`;
  return `${count}`;
}
function formatModel(entry, opts) {
  const { fallbackModel, requestedModel } = entry;
  const model = opts?.canonical ? entry.modelId ?? entry.model : entry.model;
  const primary = model && fallbackModel && model !== fallbackModel ? `${model}→${fallbackModel}` : model ?? fallbackModel;
  if (primary === undefined)
    return;
  return requestedModel !== undefined && requestedModel !== primary ? `${primary} (asked ${requestedModel})` : primary;
}
function formatThinking(entry) {
  const { thinking, requestedThinking } = entry;
  if (!thinking)
    return;
  return requestedThinking !== undefined && requestedThinking !== thinking ? `thinking: ${thinking} (asked ${requestedThinking})` : `thinking: ${thinking}`;
}
var REPLAYED_ANNOTATION = "from resume journal";
function agentStatSegments(entry) {
  const parts = [];
  if (entry.agentType)
    parts.push(entry.agentType);
  const model = formatModel(entry);
  if (model)
    parts.push(model);
  if (entry.tokens)
    parts.push(formatCompactTokens(entry.tokens));
  if (entry.toolCalls)
    parts.push(`${entry.toolCalls} tool call${entry.toolCalls === 1 ? "" : "s"}`);
  if (entry.durationMs)
    parts.push(formatDuration2(entry.durationMs));
  return parts;
}
function rowGlyph(entry, glyphs) {
  if (entry.state === "done")
    return { text: glyphs.tick, color: "success" };
  if (entry.state === "error")
    return { text: glyphs.cross, color: "error" };
  return { text: glyphs.running };
}
function clampLine(line, width) {
  const clamped = [];
  let used = 0;
  for (const segment of line) {
    const segmentWidth = visibleWidth3(segment.text);
    if (used + segmentWidth <= width) {
      clamped.push(segment);
      used += segmentWidth;
      continue;
    }
    const room = width - used;
    if (room > 0) {
      clamped.push({ ...segment, text: stripTerminalSequences2(truncateToWidth4(segment.text, room, "…")) });
    }
    return clamped;
  }
  return clamped;
}
var lineWidth = (line) => line.reduce((sum, s2) => sum + visibleWidth3(s2.text), 0);
function layoutWorkflowCard(input) {
  const glyphs = input.ascii ? ASCII_GLYPHS : UNICODE_GLYPHS;
  const width = Math.max(1, input.width ?? DEFAULT_WIDTH);
  const now = input.now ?? Date.now();
  const groups = buildPhaseGroups(input.progress, input.meta?.phases);
  const { agents: agents2, logs } = collapse(input.progress);
  const totals = stats(input.progress, input.agentCount ?? 0);
  const head = header(input.task, input.meta, groups, input.agentCount ?? 0, now);
  const lines = [];
  const left = input.showToolTitle ? [
    { text: `${glyphs.pointer} `, color: "toolTitle" },
    { text: "SubagentWorkflow", color: "toolTitle", bold: true },
    { text: "  " },
    { text: head.name, color: "muted" }
  ] : [{ text: "  " }, { text: head.name, color: "toolTitle", bold: true }];
  const statsWidth = visibleWidth3(head.stats);
  const clampedLeft = clampLine(left, Math.max(0, width - statsWidth - 1));
  const gap = Math.max(1, width - lineWidth(clampedLeft) - statsWidth);
  lines.push([...clampedLeft, { text: " ".repeat(gap) }, { text: head.stats, color: "dim" }]);
  if (head.subtext)
    lines.push(clampLine([{ text: `  ${head.subtext}`, color: "dim" }], width));
  const labelColumn = Math.min(LABEL_COLUMN_MAX, Math.max(0, ...groups.flatMap((group) => group.agents.map((a) => visibleWidth3(a.label)))));
  groups.forEach((group, groupIndex) => {
    const lastGroup = groupIndex === groups.length - 1;
    lines.push(clampLine([
      { text: "  " },
      {
        text: `${lastGroup ? glyphs.groupBottom : groupIndex === 0 ? glyphs.groupTop : glyphs.groupMid} `,
        color: "dim"
      },
      { text: group.title }
    ], width));
    const rail = lastGroup ? "  " : `${glyphs.vertical} `;
    group.agents.forEach((entry, agentIndex) => {
      const lastAgent = agentIndex === group.agents.length - 1;
      const segments = [
        { text: "  " },
        { text: rail, color: "dim" },
        { text: `${lastAgent ? glyphs.lastBranch : glyphs.branch} `, color: "dim" },
        rowGlyph(entry, glyphs),
        { text: " " }
      ];
      const statParts = entry.cached ? [REPLAYED_ANNOTATION, ...agentStatSegments(entry)] : agentStatSegments(entry);
      const pad = Math.max(0, labelColumn - visibleWidth3(entry.label));
      segments.push({ text: statParts.length > 0 ? entry.label + " ".repeat(pad) : entry.label });
      for (const part of statParts) {
        segments.push({ text: " · ", color: "dim" }, { text: part, color: "dim" });
      }
      lines.push(clampLine(segments, width));
    });
  });
  for (const message of logs) {
    const [first, ...rest] = message.split(`
`);
    lines.push(clampLine([{ text: `  ${glyphs.log}  ${first}`, color: "dim" }], width));
    for (const continuation of rest) {
      lines.push(clampLine([{ text: `     ${continuation}`, color: "dim" }], width));
    }
  }
  const totalTokens = input.totalTokens ?? agents2.reduce((sum, entry) => sum + (entry.tokens ?? 0), 0);
  const warning = sizeWarning({
    scheduledAgents: Math.max(input.agentCount ?? 0, totals.total),
    startedAgents: totals.started,
    totalTokens,
    agentCap: input.agentCap,
    tokenCap: input.tokenCap
  });
  if (warning) {
    lines.push(clampLine([{ text: `  ${glyphs.warning} Large workflow · /agents → Workflows to stop`, color: "warning" }], width));
  }
  return lines;
}
function styleWorkflowCardLines(lines, theme) {
  return lines.map((line) => line.map((segment) => {
    const text = segment.bold ? theme.bold(segment.text) : segment.text;
    return segment.color ? theme.fg(segment.color, text) : text;
  }).join(""));
}
function renderWorkflowCard(input, theme) {
  return new Text(styleWorkflowCardLines(layoutWorkflowCard(input), theme).join(`
`), 0, 0);
}
function renderWorkflowEntryCard(data, theme) {
  if (!data)
    return;
  return renderWorkflowCard({
    progress: data.progress,
    task: {
      status: data.status,
      workflowName: data.name,
      startTime: data.startTime,
      endTime: data.endTime
    },
    meta: data.meta,
    agentCount: data.agentCount,
    totalTokens: data.totalTokens,
    showToolTitle: true
  }, theme);
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/task.ts
import { randomUUID as randomUUID3 } from "node:crypto";

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/xml.ts
function escapeXml(s2) {
  return s2.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/task.ts
function workflowRunId() {
  return `wf_${randomUUID3().replace(/-/g, "").slice(0, 12)}`;
}
function createWorkflowTask(init) {
  return {
    type: "local_workflow",
    id: init.id,
    status: "running",
    script: init.script,
    scriptPath: init.scriptPath,
    args: init.args,
    meta: init.meta,
    workflowName: init.meta?.name,
    toolCallId: init.toolCallId,
    journalPath: init.journalPath,
    replay: init.replay,
    resumedFrom: init.resumedFrom,
    replayedCount: 0,
    workflowProgress: [],
    progressVersion: 0,
    agentCount: 0,
    doneCount: 0,
    totalTokens: 0,
    totalToolCalls: 0,
    logs: [],
    abortController: new AbortController,
    startTime: init.startTime ?? Date.now(),
    totalPausedMs: 0
  };
}
function updateWorkflowProgressBatch(task, entries) {
  if (entries.length === 0)
    return;
  task.workflowProgress.push(...entries);
  task.progressVersion++;
  const { agents: agents2, logs } = collapse(task.workflowProgress);
  task.logs = logs;
  task.agentCount = Math.max(task.agentCount, agents2.length);
  let totalTokens = 0;
  let totalToolCalls = 0;
  let done = 0;
  for (const agent of agents2) {
    totalTokens += agent.tokens ?? 0;
    totalToolCalls += agent.toolCalls ?? 0;
    if (agent.state === "done")
      done++;
  }
  task.totalTokens = totalTokens;
  task.totalToolCalls = totalToolCalls;
  task.doneCount = done;
}
function pauseWorkflowTask(task, now = Date.now()) {
  if (task.status !== "running" || task.control === undefined)
    return false;
  task.control.pause();
  task.status = "paused";
  task.pausedAt = now;
  return true;
}
function resumeWorkflowTask(task, now = Date.now()) {
  if (task.status !== "paused" || task.control === undefined)
    return false;
  task.control.resume();
  task.status = "running";
  task.totalPausedMs = (task.totalPausedMs ?? 0) + Math.max(0, now - (task.pausedAt ?? now));
  task.pausedAt = undefined;
  return true;
}
function completeWorkflowTask(task, result) {
  if (task.pausedAt !== undefined) {
    task.totalPausedMs = (task.totalPausedMs ?? 0) + Math.max(0, Date.now() - task.pausedAt);
    task.pausedAt = undefined;
  }
  task.control = undefined;
  task.status = result.status;
  task.meta ??= result.meta;
  task.workflowName ??= result.meta.name;
  task.agentCount = Math.max(task.agentCount, result.agentCount);
  task.replayedCount = result.replayedCount;
  task.value = result.value;
  task.error = result.error;
  task.endTime = Date.now();
}
function failWorkflowTask(task, error) {
  task.control = undefined;
  task.pausedAt = undefined;
  task.status = "failed";
  task.error = error;
  task.endTime = Date.now();
}
function workflowResultText(task) {
  if (task.error !== undefined)
    return task.error;
  if (task.value === undefined)
    return "No output.";
  if (typeof task.value === "string")
    return task.value;
  return JSON.stringify(task.value, null, 2);
}
function resolveResumeTarget(runId, tasks) {
  const id = runId?.trim();
  if (id === undefined || id === "")
    return;
  const prior = tasks.get(id);
  if (prior === undefined) {
    const known = [...tasks.keys()];
    return {
      ok: false,
      message: `No workflow run "${id}" in this session. ` + (known.length > 0 ? `Runs this session: ${known.join(", ")}.` : "Nothing has run yet — call this without `resumeFromRunId`.")
    };
  }
  if (prior.status === "running") {
    return {
      ok: false,
      message: `Workflow "${id}" is still running. Stop it from /agents → Workflows before resuming it.`
    };
  }
  if (prior.journalPath === undefined) {
    return { ok: false, message: `Workflow "${id}" has no journal to resume from.` };
  }
  return {
    ok: true,
    runId: id,
    journalPath: prior.journalPath,
    scriptPath: prior.scriptPath ?? ""
  };
}
function formatWorkflowNotification(task, now = Date.now()) {
  const totals = stats(task.workflowProgress, task.agentCount);
  const status = task.status === "completed" ? "Done" : task.status === "killed" ? "Stopped" : `Error: ${task.error ?? "unknown"}`;
  const result = workflowResultText(task);
  return [
    `<task-notification>`,
    `<task-id>${task.id}</task-id>`,
    task.toolCallId ? `<tool-use-id>${escapeXml(task.toolCallId)}</tool-use-id>` : null,
    task.scriptPath ? `<script>${escapeXml(task.scriptPath)}</script>` : null,
    `<status>${escapeXml(status)}</status>`,
    `<summary>Workflow "${escapeXml(task.workflowName ?? task.id)}" ${task.status} — ${totals.done}/${totals.total} agents${task.replayedCount > 0 ? `, ${task.replayedCount} replayed from ${escapeXml(task.resumedFrom ?? "an earlier run")}` : ""}</summary>`,
    `<result>${escapeXml(result.length > 4000 ? `${result.slice(0, 4000)}
...(truncated)` : result)}</result>`,
    `<usage><total_tokens>${task.totalTokens}</total_tokens><tool_uses>${task.totalToolCalls}</tool_uses><duration_ms>${elapsedMs(task, now)}</duration_ms></usage>`,
    `</task-notification>`
  ].filter(Boolean).join(`
`);
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/ui/workflow-dialog.ts
import {
  matchesKey as matchesKey4,
  stripTerminalSequences as stripTerminalSequences3,
  truncateToWidth as truncateToWidth5,
  visibleWidth as visibleWidth4,
  wrapTextWithAnsi as wrapTextWithAnsi2
} from "@earendil-works/pi-tui";
init_agent_widget();
var DEFAULT_WIDTH2 = 80;
var LEFT_PANE_WIDTH = 18;
var DEFAULT_PANE_BODY_ROWS = 22;
var MIN_PANE_BODY_ROWS = 6;
var PROMPT_COLLAPSED_LINES = 4;
var WORKFLOW_DIALOG_SPINNER_MS = 80;
var UNICODE_DIALOG_GLYPHS = {
  tick: UNICODE_GLYPHS.tick,
  cross: UNICODE_GLYPHS.cross,
  queued: "◌",
  pointer: "❯",
  focus: UNICODE_GLYPHS.pointer,
  spinner: SPINNER,
  box: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
    topTee: "┬",
    bottomTee: "┴"
  },
  ellipsis: "…",
  upDown: "↑↓",
  enter: "⏎"
};
var ASCII_DIALOG_GLYPHS = {
  tick: ASCII_GLYPHS.tick,
  cross: ASCII_GLYPHS.cross,
  queued: "o",
  pointer: ">",
  focus: ASCII_GLYPHS.pointer,
  spinner: ["-", "\\", "|", "/"],
  box: {
    topLeft: "+",
    topRight: "+",
    bottomLeft: "+",
    bottomRight: "+",
    horizontal: "-",
    vertical: "|",
    topTee: "+",
    bottomTee: "+"
  },
  ellipsis: "~",
  upDown: "up/down",
  enter: "enter"
};
function dialogRowGlyph(state, glyphs, spinnerFrame = 0) {
  switch (state) {
    case "done":
      return { text: glyphs.tick, color: "success" };
    case "failed":
      return { text: glyphs.cross, color: "error" };
    case "skipped":
      return { text: glyphs.cross, color: "dim" };
    case "blocked":
      return { text: glyphs.cross, color: "warning" };
    case "queued":
    case "interrupted":
      return { text: glyphs.queued, color: "dim" };
    case "running":
      return { text: glyphs.spinner[spinnerFrame % glyphs.spinner.length], color: "dim" };
  }
}
var WORKFLOW_DIALOG_COPY = {
  waitingForSlot: "Waiting for an agent slot.",
  availableOnceStarted: "Available once the agent starts.",
  notAvailableYet: "Not available yet (agent still running).",
  noTranscript: "Transcript not available.",
  stoppedEarly: "The workflow stopped before this agent finished.",
  skippedByUser: "Skipped by user.",
  noToolCallsYet: "No tool calls yet.",
  noToolCalls: "No tool calls.",
  noAgents: "No agents"
};
var WORKFLOW_DIALOG_FILTERS = [
  "all",
  "running",
  "queued",
  "done",
  "failed",
  "blocked",
  "skipped",
  "interrupted"
];
function initialWorkflowDialogState(initialPhaseIndex = 0) {
  return {
    selectedPhase: initialPhaseIndex,
    selectedAgent: 0,
    level: "phases",
    filter: "all",
    promptExpanded: false
  };
}
function workflowDialogContentWidth(terminalWidth) {
  return Math.max(12, terminalWidth - 6);
}
var clampIndex = (index, length) => length === 0 ? 0 : Math.min(Math.max(0, Math.trunc(index)), length - 1);
function resolveWorkflowDialog(input) {
  const groups = buildPhaseGroups(input.progress, input.meta?.phases);
  const workflowActive = input.task.status === "running" || input.task.status === "paused";
  const clampedPhase = clampIndex(input.state.selectedPhase, groups.length);
  const all = groups[clampedPhase]?.agents ?? [];
  const visibleAgents = input.state.filter === "all" ? [...all] : all.filter((entry) => displayState(entry, workflowActive) === input.state.filter);
  const clampedAgent = clampIndex(input.state.selectedAgent, visibleAgents.length);
  return {
    groups,
    clampedPhase,
    clampedAgent,
    visibleAgents,
    selectedEntry: visibleAgents[clampedAgent],
    workflowActive,
    paused: input.task.status === "paused"
  };
}
function subStatusAnnotations(entry, state, now) {
  const parts = [];
  if (entry.isolation)
    parts.push(entry.isolation);
  if (entry.cached)
    parts.push(REPLAYED_ANNOTATION);
  if (entry.lastAttemptReason) {
    parts.push(entry.lastAttemptReason === "user-retry" ? "user retry" : entry.lastAttemptReason);
  }
  if (entry.attempt != null && entry.attempt > 1)
    parts.push(`attempt ${entry.attempt}`);
  if (state === "queued" && entry.queuedAt != null) {
    parts.push(`waiting ${formatDuration2(Math.max(0, now - entry.queuedAt))}`);
  }
  return parts;
}
var lineWidth2 = (line) => line.reduce((sum, s2) => sum + visibleWidth4(s2.text), 0);
function rightAlign2(left, right, width) {
  const rightWidth = lineWidth2(right);
  const clampedLeft = clampLine(left, Math.max(0, width - rightWidth - 1));
  const gap = Math.max(1, width - lineWidth2(clampedLeft) - rightWidth);
  return clampLine([...clampedLeft, { text: " ".repeat(gap) }, ...right], width);
}
function windowRange(selected, total, max) {
  const visible = Math.min(max, total);
  const start = selected < visible ? 0 : selected - visible + 1;
  return { start, end: start + visible };
}
function leftPaneWidth(width) {
  const available = Math.max(2, width - 3);
  return Math.max(1, Math.min(LEFT_PANE_WIDTH, Math.floor(available / 3), available - 1));
}
function padTitle(line, width, horizontal) {
  const gap = Math.max(0, width - lineWidth2(line));
  return gap > 0 ? [...line, { text: horizontal.repeat(gap), color: "dim" }] : line;
}
function padCell(line, width) {
  const clamped = clampLine(line, width);
  const gap = Math.max(0, width - lineWidth2(clamped));
  return gap > 0 ? [...clamped, { text: " ".repeat(gap) }] : clamped;
}
function frameTitle(title, width, glyphs) {
  const room = Math.max(0, width - 2);
  const shown = stripTerminalSequences3(truncateToWidth5(title, room, glyphs.ellipsis));
  const rule = Math.max(0, width - visibleWidth4(shown) - 2);
  return clampLine([
    { text: " ", color: "dim" },
    { text: shown, color: "muted", bold: true },
    { text: ` ${glyphs.box.horizontal.repeat(rule)}`, color: "dim" }
  ], width);
}
function paneFrame(options) {
  const { glyphs, width } = options;
  const box = glyphs.box;
  const left = leftPaneWidth(width);
  const right = Math.max(1, width - left - 3);
  const lines = [];
  lines.push([
    { text: box.topLeft, color: "dim" },
    ...padTitle(frameTitle(options.leftTitle, left, glyphs), left, box.horizontal),
    { text: box.topTee, color: "dim" },
    ...padTitle(frameTitle(options.rightTitle, right, glyphs), right, box.horizontal),
    { text: box.topRight, color: "dim" }
  ]);
  for (let row = 0;row < options.bodyRows; row++) {
    lines.push([
      { text: box.vertical, color: "dim" },
      ...padCell(options.leftRows[row] ?? [], left),
      { text: box.vertical, color: "dim" },
      ...padCell(options.rightRows[row] ?? [], right),
      { text: box.vertical, color: "dim" }
    ]);
  }
  lines.push([
    { text: box.bottomLeft, color: "dim" },
    { text: box.horizontal.repeat(left), color: "dim" },
    { text: box.bottomTee, color: "dim" },
    { text: box.horizontal.repeat(right), color: "dim" },
    { text: box.bottomRight, color: "dim" }
  ]);
  return lines;
}
var previewLines = (preview) => preview ? preview.split(`
`) : [];
function activityBody(entry, state) {
  if (state === "queued")
    return WORKFLOW_DIALOG_COPY.availableOnceStarted;
  if ((entry.toolCalls ?? 0) > 0)
    return WORKFLOW_DIALOG_COPY.noTranscript;
  return isLive(entry) ? WORKFLOW_DIALOG_COPY.noToolCallsYet : WORKFLOW_DIALOG_COPY.noToolCalls;
}
function outcomeBody(entry, state) {
  switch (state) {
    case "skipped":
      return WORKFLOW_DIALOG_COPY.skippedByUser;
    case "interrupted":
      return WORKFLOW_DIALOG_COPY.stoppedEarly;
    case "queued":
      return WORKFLOW_DIALOG_COPY.waitingForSlot;
    case "running":
      return WORKFLOW_DIALOG_COPY.notAvailableYet;
    case "failed":
    case "blocked":
      return entry.error ?? WORKFLOW_DIALOG_COPY.noTranscript;
    case "done":
      return entry.resultPreview ?? WORKFLOW_DIALOG_COPY.noTranscript;
  }
}
function agentActions(entry, workflowActive) {
  if (entry === undefined || !workflowActive)
    return { skip: false, retry: false };
  const state = displayState(entry, workflowActive);
  return { skip: state === "queued" || state === "running", retry: state === "running" };
}
function statusWord(state) {
  switch (state) {
    case "done":
      return "Completed";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "blocked":
      return "Blocked";
    case "queued":
      return "Queued";
    case "interrupted":
      return "Stopped";
    case "running":
      return "Running";
  }
}
function detailHeading(title, suffixes, width) {
  const line = [{ text: " " }, { text: title, color: "muted", bold: true }];
  for (const suffix of suffixes) {
    line.push({ text: " · ", color: "dim" }, { text: suffix, color: "dim" });
  }
  return clampLine(line, width);
}
var detailBody = (text, width) => clampLine([{ text: `   ${text}`, color: "dim" }], width);
function agentRow(options) {
  const { entry, selected, glyphs, width } = options;
  const display = displayState(entry, options.workflowActive);
  const head = [
    { text: " " },
    { text: selected ? glyphs.pointer : " ", color: "accent" },
    { text: " " },
    dialogRowGlyph(display, glyphs, options.spinnerFrame),
    { text: " " },
    { text: entry.label, color: selected ? "accent" : undefined }
  ];
  if (options.compact)
    return clampLine(head, width);
  const model = formatModel(entry);
  if (model)
    head.push({ text: ` ${model}`, color: "dim" });
  for (const part of [...subStatusAnnotations(entry, display, options.now), ...rowStatSegments(entry)]) {
    head.push({ text: " · ", color: "dim" }, { text: part, color: "dim" });
  }
  const duration = entry.durationMs ? [{ text: `${formatDuration2(entry.durationMs)} `, color: "dim" }] : [];
  return duration.length > 0 ? rightAlign2(head, duration, width) : clampLine(head, width);
}
function rowStatSegments(entry) {
  return entry.tokens ? [`${formatCompactTokens(entry.tokens)} tok`] : [];
}
function layoutWorkflowDialog(input) {
  const glyphs = input.ascii ? ASCII_DIALOG_GLYPHS : UNICODE_DIALOG_GLYPHS;
  const width = workflowDialogContentWidth(input.width ?? DEFAULT_WIDTH2);
  const now = input.now ?? Date.now();
  const view = resolveWorkflowDialog(input);
  const { state } = input;
  const capacity = Math.max(MIN_PANE_BODY_ROWS, input.bodyRows ?? DEFAULT_PANE_BODY_ROWS);
  const spinnerFrame = input.spinnerFrame ?? 0;
  const lines = [];
  const head = header(input.task, input.meta, view.groups, input.agentCount ?? 0, now);
  lines.push(clampLine([{ text: " " }, { text: head.name, color: "toolTitle", bold: true }], width));
  lines.push(rightAlign2(head.subtext ? [{ text: " " }, { text: head.subtext, color: "dim" }] : [], [{ text: head.stats, color: "dim" }], width));
  lines.push([]);
  const frameWidth = width - 1;
  const leftWidth = leftPaneWidth(frameWidth);
  const rightWidth = Math.max(1, frameWidth - leftWidth - 3);
  const inPhases = state.level === "phases";
  const entry = view.selectedEntry;
  const phaseRows = [];
  const digits = String(view.groups.length).length;
  const phases = windowRange(view.clampedPhase, view.groups.length, capacity);
  for (let i = phases.start;i < Math.min(phases.end, view.groups.length); i++) {
    const group = view.groups[i];
    const selected = i === view.clampedPhase;
    const color = selected ? "accent" : group.status === "done" ? "success" : group.status === "failed" ? "error" : "dim";
    const glyph = group.status === "done" ? glyphs.tick : group.status === "failed" ? glyphs.cross : String(i + 1);
    phaseRows.push(rightAlign2([
      { text: " " },
      { text: selected ? glyphs.pointer : " ", color: "accent" },
      { text: " " },
      { text: glyph.padStart(digits), color },
      { text: " " },
      { text: group.title, color }
    ], group.totalCount === 0 ? [] : [{ text: `${group.doneCount}/${group.totalCount} `, color }], leftWidth));
  }
  const agentPaneWidth = inPhases ? rightWidth : leftWidth;
  const agentRows = [];
  if (view.visibleAgents.length === 0) {
    agentRows.push(clampLine([{ text: `   ${WORKFLOW_DIALOG_COPY.noAgents}`, color: "dim" }], agentPaneWidth));
  } else {
    const agents2 = windowRange(view.clampedAgent, view.visibleAgents.length, capacity);
    for (let i = agents2.start;i < Math.min(agents2.end, view.visibleAgents.length); i++) {
      agentRows.push(agentRow({
        entry: view.visibleAgents[i],
        selected: i === view.clampedAgent,
        compact: !inPhases,
        width: agentPaneWidth,
        glyphs,
        workflowActive: view.workflowActive,
        spinnerFrame,
        now
      }));
    }
  }
  const detailRows = [];
  if (!inPhases && entry) {
    const display = displayState(entry, view.workflowActive);
    const model = formatModel(entry, { canonical: true });
    detailRows.push(clampLine([
      { text: " " },
      dialogRowGlyph(display, glyphs, spinnerFrame),
      { text: ` ${statusWord(display)}`, color: "muted" },
      ...model ? [{ text: " · ", color: "dim" }, { text: model, color: "dim" }] : []
    ], rightWidth));
    const stats2 = [];
    const thinking = formatThinking(entry);
    if (thinking)
      stats2.push(thinking);
    if (entry.tokens)
      stats2.push(`${formatCompactTokens(entry.tokens)} tok`);
    if (entry.toolCalls)
      stats2.push(`${entry.toolCalls} tool call${entry.toolCalls === 1 ? "" : "s"}`);
    if (entry.durationMs)
      stats2.push(formatDuration2(entry.durationMs));
    if (stats2.length > 0) {
      detailRows.push(clampLine([{ text: ` ${stats2.join(" · ")}`, color: "dim" }], rightWidth));
    }
    const prompt = previewLines(entry.promptPreview);
    const collapsed = !state.promptExpanded && prompt.length > PROMPT_COLLAPSED_LINES;
    const promptSuffix = [];
    if (prompt.length > 0)
      promptSuffix.push(`${prompt.length} ${prompt.length === 1 ? "line" : "lines"}`);
    if (prompt.length > PROMPT_COLLAPSED_LINES) {
      promptSuffix.push(`${glyphs.enter} ${state.promptExpanded ? "collapse" : "expand"}`);
    }
    detailRows.push([]);
    detailRows.push(detailHeading("Prompt", promptSuffix, rightWidth));
    if (prompt.length === 0) {
      detailRows.push(detailBody(WORKFLOW_DIALOG_COPY.availableOnceStarted, rightWidth));
    } else {
      const shown2 = collapsed ? prompt.slice(0, PROMPT_COLLAPSED_LINES) : prompt;
      for (const text of shown2)
        detailRows.push(detailBody(text, rightWidth));
      if (collapsed) {
        const hidden = prompt.length - PROMPT_COLLAPSED_LINES;
        detailRows.push(detailBody(`${glyphs.ellipsis} ${hidden} more line${hidden === 1 ? "" : "s"}`, rightWidth));
      }
    }
    const toolCalls = entry.toolCalls ?? 0;
    detailRows.push([]);
    detailRows.push(detailHeading("Activity", toolCalls > 0 ? [`${toolCalls} tool call${toolCalls === 1 ? "" : "s"}`] : [], rightWidth));
    detailRows.push(detailBody(activityBody(entry, display), rightWidth));
    detailRows.push([]);
    detailRows.push(detailHeading("Outcome", [], rightWidth));
    for (const text of wrapTextWithAnsi2(outcomeBody(entry, display), Math.max(1, rightWidth - 4))) {
      detailRows.push(detailBody(text, rightWidth));
    }
  }
  const phaseTitle = view.groups[view.clampedPhase]?.title ?? "Phases";
  const shown = view.visibleAgents.length;
  const agentPaneTitle = state.filter === "all" ? `${phaseTitle} · ${shown} agent${shown === 1 ? "" : "s"}` : `${phaseTitle} · ${shown} ${state.filter}`;
  const leftRows = inPhases ? phaseRows : agentRows;
  const rightRows = inPhases ? agentRows : detailRows;
  lines.push(...paneFrame({
    leftTitle: inPhases ? "Phases" : agentPaneTitle,
    rightTitle: inPhases ? agentPaneTitle : entry?.label ?? WORKFLOW_DIALOG_COPY.noAgents,
    leftRows,
    rightRows,
    width: width - 1,
    bodyRows: Math.min(capacity, Math.max(MIN_PANE_BODY_ROWS, leftRows.length, rightRows.length)),
    glyphs
  }).map((line) => [{ text: " " }, ...line]));
  const can = (action) => input.available?.[action] ?? true;
  const hints = [];
  if (inPhases) {
    hints.push(`${glyphs.upDown} select`);
    if (view.visibleAgents.length > 0)
      hints.push(`${glyphs.enter} open`);
    hints.push("f filter");
  } else {
    hints.push(`${glyphs.upDown} agent`);
    if (previewLines(entry?.promptPreview).length > PROMPT_COLLAPSED_LINES) {
      hints.push(`${glyphs.enter} prompt`);
    }
    const actions = agentActions(entry, view.workflowActive);
    if (actions.skip && can("onSkipAgent"))
      hints.push("s skip");
    if (actions.retry && can("onRetryAgent"))
      hints.push("r retry");
  }
  if (view.paused && can("onResume"))
    hints.push("p resume");
  else if (view.workflowActive && can("onPause"))
    hints.push("p pause");
  if (view.workflowActive && can("onKill"))
    hints.push("x stop");
  hints.push(inPhases ? "esc close" : "esc back");
  if (view.selectedEntry?.recordId !== undefined && can("onOpenAgent")) {
    hints.push("c convo");
  }
  lines.push(clampLine([{ text: ` ${hints.join(" · ")}`, color: "dim" }], width));
  return lines;
}
var nextFilter = (filter) => WORKFLOW_DIALOG_FILTERS[(WORKFLOW_DIALOG_FILTERS.indexOf(filter) + 1) % WORKFLOW_DIALOG_FILTERS.length];
function handleWorkflowDialogKey(data, state, view) {
  if (matchesKey4(data, "ctrl+c"))
    return { state, action: { kind: "cancel" } };
  if (matchesKey4(data, "escape") || matchesKey4(data, "q")) {
    if (state.level === "agent")
      return { state: { ...state, level: "phases", promptExpanded: false } };
    return { state, action: { kind: "cancel" } };
  }
  if (matchesKey4(data, "left") && state.level === "agent") {
    return { state: { ...state, level: "phases", promptExpanded: false } };
  }
  const down = matchesKey4(data, "j") || matchesKey4(data, "down");
  const up = matchesKey4(data, "k") || matchesKey4(data, "up");
  if (down || up) {
    const delta = down ? 1 : -1;
    if (state.level === "phases") {
      const next = clampIndex(view.clampedPhase + delta, view.groups.length);
      return { state: next === view.clampedPhase ? state : { ...state, selectedPhase: next, selectedAgent: 0 } };
    }
    return { state: { ...state, selectedAgent: clampIndex(view.clampedAgent + delta, view.visibleAgents.length) } };
  }
  if (matchesKey4(data, "enter") || matchesKey4(data, "right")) {
    if (state.level === "phases") {
      if (view.visibleAgents.length === 0)
        return { state };
      return { state: { ...state, level: "agent", promptExpanded: false } };
    }
    return { state: { ...state, promptExpanded: !state.promptExpanded } };
  }
  if (matchesKey4(data, "e")) {
    return { state: { ...state, promptExpanded: !state.promptExpanded } };
  }
  if (matchesKey4(data, "c")) {
    const recordId = view.selectedEntry?.recordId;
    return recordId === undefined ? undefined : { state, action: { kind: "open", recordId } };
  }
  if (matchesKey4(data, "f") && state.level === "phases") {
    return { state: { ...state, filter: nextFilter(state.filter), selectedAgent: 0 } };
  }
  if (matchesKey4(data, "x"))
    return view.workflowActive ? { state, action: { kind: "kill" } } : undefined;
  if (matchesKey4(data, "p")) {
    if (!view.workflowActive)
      return;
    return { state, action: { kind: view.paused ? "resume" : "pause" } };
  }
  const actions = agentActions(view.selectedEntry, view.workflowActive);
  if (matchesKey4(data, "s") && actions.skip && view.selectedEntry) {
    return { state, action: { kind: "skip", index: view.selectedEntry.index } };
  }
  if (matchesKey4(data, "r") && actions.retry && view.selectedEntry) {
    return { state, action: { kind: "retry", index: view.selectedEntry.index } };
  }
  return;
}
class WorkflowDialog {
  tui;
  source;
  theme;
  done;
  actions;
  state;
  spinnerFrame = 0;
  timer;
  closed = false;
  constructor(tui, source, theme, done, actions = {}, initialPhaseIndex = 0) {
    this.tui = tui;
    this.source = source;
    this.theme = theme;
    this.done = done;
    this.actions = actions;
    this.state = initialWorkflowDialogState(initialPhaseIndex);
    this.timer = setInterval(() => {
      this.spinnerFrame++;
      if (!this.closed)
        this.tui.requestRender();
    }, WORKFLOW_DIALOG_SPINNER_MS);
    this.timer.unref?.();
  }
  handleInput(data) {
    const input = { ...this.source(), state: this.state };
    const result = handleWorkflowDialogKey(data, this.state, resolveWorkflowDialog(input));
    if (!result)
      return;
    this.state = result.state;
    if (result.action)
      this.dispatch(result.action);
    this.tui.requestRender();
  }
  render(width) {
    const lines = layoutWorkflowDialog({
      ...this.source(),
      state: this.state,
      available: {
        onKill: this.actions.onKill !== undefined,
        onPause: this.actions.onPause !== undefined,
        onResume: this.actions.onResume !== undefined,
        onSkipAgent: this.actions.onSkipAgent !== undefined,
        onRetryAgent: this.actions.onRetryAgent !== undefined,
        onOpenAgent: this.actions.onOpenAgent !== undefined
      },
      width,
      spinnerFrame: this.spinnerFrame
    });
    return styleWorkflowCardLines(lines, this.theme);
  }
  invalidate() {}
  dispose() {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
  dispatch(action) {
    switch (action.kind) {
      case "cancel":
        this.closed = true;
        this.done(undefined);
        return;
      case "kill":
        this.actions.onKill?.();
        return;
      case "pause":
        this.actions.onPause?.();
        return;
      case "resume":
        this.actions.onResume?.();
        return;
      case "skip":
        this.actions.onSkipAgent?.(action.index);
        return;
      case "retry":
        this.actions.onRetryAgent?.(action.index);
        return;
      case "open":
        this.actions.onOpenAgent?.(action.recordId);
        return;
    }
  }
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/ui/workflow-menu.ts
async function showWorkflowDialog(ctx, task, deps) {
  const { VIEWPORT_HEIGHT_PCT: VIEWPORT_HEIGHT_PCT2 } = await Promise.resolve().then(() => (init_conversation_viewer(), exports_conversation_viewer));
  let overlay;
  await ctx.ui.custom((tui, theme, _keybindings, done) => new WorkflowDialog(tui, () => ({
    progress: task.workflowProgress,
    task: {
      status: task.status,
      workflowName: task.workflowName,
      startTime: task.startTime,
      endTime: task.endTime,
      totalPausedMs: task.totalPausedMs
    },
    meta: task.meta,
    agentCount: task.agentCount
  }), theme, done, {
    onKill: () => {
      if (task.abortController.signal.aborted)
        return;
      task.abortController.abort();
      ctx.ui.notify(`Stopped workflow "${task.meta?.name ?? task.id}".`, "info");
    },
    onPause: () => {
      if (pauseWorkflowTask(task)) {
        ctx.ui.notify("Paused — running agents finish, no new ones start.", "info");
      }
    },
    onResume: () => {
      if (resumeWorkflowTask(task))
        ctx.ui.notify("Resumed.", "info");
    },
    onSkipAgent: (index) => {
      if (task.control?.skip(index) !== true) {
        ctx.ui.notify("Nothing to skip — that agent has already finished.", "info");
      }
    },
    onRetryAgent: (index) => {
      if (task.control?.retry(index) !== true) {
        ctx.ui.notify("Only a running agent can be retried.", "info");
      }
    },
    onOpenAgent: (recordId) => {
      const record = deps.getRecord(recordId);
      if (record === undefined) {
        ctx.ui.notify("No conversation left — agent records are dropped ten minutes after they finish.", "info");
        return;
      }
      overlay?.setHidden(true);
      deps.viewAgentConversation(ctx, record).catch((err) => ctx.ui.notify(`Could not open the conversation: ${err instanceof Error ? err.message : String(err)}`, "warning")).finally(() => overlay?.setHidden(false));
    }
  }), {
    overlay: true,
    overlayOptions: { anchor: "center", width: "90%", maxHeight: `${VIEWPORT_HEIGHT_PCT2}%` },
    onHandle: (handle) => {
      overlay = handle;
    }
  });
}
function openWorkflowFromFleet(id, deps) {
  const task = deps.tasks.get(id);
  const ctx = deps.getCtx();
  if (task === undefined || ctx === undefined)
    return;
  return showWorkflowDialog(ctx, task, deps);
}
async function showWorkflowsMenu(ctx, deps) {
  const tasks = [...deps.tasks.values()].sort((a, b2) => b2.startTime - a.startTime);
  if (tasks.length === 0) {
    ctx.ui.notify("No workflows in this session.", "info");
    return;
  }
  if (tasks.length === 1) {
    await showWorkflowDialog(ctx, tasks[0], deps);
    return;
  }
  const labels = tasks.map((task) => `${task.meta?.name ?? task.id} — ${task.status}, ${task.agentCount} agent${task.agentCount === 1 ? "" : "s"} · ${task.id}`);
  const picked = await ctx.ui.select("Workflows", labels);
  const index = picked !== undefined ? labels.indexOf(picked) : -1;
  if (index >= 0)
    await showWorkflowDialog(ctx, tasks[index], deps);
}
// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/collisions.ts
init_agent_runner();
var FOREIGN_WORKFLOW_TOOL_NAMES = new Set([
  SUBAGENT_TOOL_NAMES.WORKFLOW,
  "Workflow",
  "workflow"
]);
function decideWorkflowCollision(input) {
  const foreign = input.tools.find((tool) => FOREIGN_WORKFLOW_TOOL_NAMES.has(tool.name) && tool.description !== input.ownDescription);
  if (foreign === undefined)
    return { kind: "none" };
  const source = foreign.sourceInfo?.source ?? "unknown source";
  const tookOurName = foreign.name === SUBAGENT_TOOL_NAMES.WORKFLOW;
  if (input.pinned) {
    if (!tookOurName)
      return { kind: "none" };
    return {
      kind: "report",
      message: `Another extension (${source}) already registers a "${SUBAGENT_TOOL_NAMES.WORKFLOW}" tool. ` + "Pi keeps the first registration, so this extension's workflow tool is not offered to the " + "model. Disable one of the two."
    };
  }
  return {
    kind: "standDown",
    message: `Another extension (${source}) already provides a "${foreign.name}" tool, so this extension's ` + "workflows are disabled for this session to avoid offering the model two orchestrators. " + 'Set `"workflowsEnabled": true` in .pi/subagents.json to keep both.',
    withdraw: !tookOurName
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/entry.ts
var WORKFLOW_ENTRY_TYPE = "subagents:workflow";
function workflowEntryData(task) {
  return {
    name: task.workflowName ?? task.id,
    status: task.status,
    startTime: task.startTime,
    endTime: task.endTime,
    progress: task.workflowProgress,
    agentCount: task.agentCount,
    totalTokens: task.totalTokens,
    ...task.meta !== undefined ? { meta: task.meta } : {}
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/host.ts
init_agent_record_entry();
init_agent_types();
init_model_resolver();
init_model_scope();
import { existsSync as existsSync12 } from "node:fs";

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/saved.ts
init_memory();
init_package_resources();
import { existsSync as existsSync11, readdirSync as readdirSync3, readFileSync as readFileSync9, statSync as statSync5 } from "node:fs";
import { isAbsolute as isAbsolute4, join as join12 } from "node:path";
import { getAgentDir as getAgentDir10 } from "@earendil-works/pi-coding-agent";

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/meta.ts
import { createContext, Script } from "node:vm";

class WorkflowMetaError extends Error {
}
var META_EVAL_TIMEOUT_MS = 100;
var PURE_LITERAL_HINT = "The `meta` object must be a PURE LITERAL — no variables, function calls, spreads, or template interpolation.";
var META_DECLARATION = /(^|[\r\n])[ \t]*export[ \t\r\n]+const[ \t\r\n]+meta[ \t\r\n]*=/;
function hasMetaDeclaration(source) {
  return META_DECLARATION.test(source);
}
function scanObjectLiteral(source, open) {
  let depth = 0;
  let i = open;
  let sawInterpolation = false;
  let mode = "code";
  const templateStack = [];
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === "line-comment") {
      if (c === `
`)
        mode = "code";
      i++;
      continue;
    }
    if (mode === "block-comment") {
      if (c === "*" && next === "/") {
        mode = "code";
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (mode === "single" || mode === "double" || mode === "regex") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (mode === "single" && c === "'")
        mode = "code";
      else if (mode === "double" && c === '"')
        mode = "code";
      else if (mode === "regex" && c === "/")
        mode = "code";
      else if (c === `
` && mode !== "double")
        mode = "code";
      i++;
      continue;
    }
    if (mode === "template") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        mode = "code";
        i++;
        continue;
      }
      if (c === "$" && next === "{") {
        sawInterpolation = true;
        templateStack.push(depth);
        depth++;
        mode = "code";
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      mode = "line-comment";
      i += 2;
      continue;
    }
    if (c === "/" && next === "*") {
      mode = "block-comment";
      i += 2;
      continue;
    }
    if (c === "'") {
      mode = "single";
      i++;
      continue;
    }
    if (c === '"') {
      mode = "double";
      i++;
      continue;
    }
    if (c === "`") {
      mode = "template";
      i++;
      continue;
    }
    if (c === "/" && isRegexPosition(source, i)) {
      mode = "regex";
      i++;
      continue;
    }
    if (c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === "}") {
      depth--;
      i++;
      if (templateStack.length > 0 && depth === templateStack[templateStack.length - 1]) {
        templateStack.pop();
        mode = "template";
        continue;
      }
      if (depth === 0)
        return { end: i, sawInterpolation };
      continue;
    }
    i++;
  }
  return { end: -1, sawInterpolation };
}
function isRegexPosition(source, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(source[j]))
    j--;
  if (j < 0)
    return true;
  const prev = source[j];
  return !/[\w$)\]]/.test(prev);
}
function fail(message) {
  throw new WorkflowMetaError(message);
}
function assertPhases(value) {
  if (value === undefined)
    return;
  if (!Array.isArray(value))
    fail("`meta.phases` must be an array of { title, detail?, model? } objects.");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`\`meta.phases[${index}]\` must be an object with a \`title\`.`);
    }
    const { title, detail, model } = entry;
    if (typeof title !== "string" || title.trim() === "") {
      fail(`\`meta.phases[${index}].title\` must be a non-empty string.`);
    }
    if (detail !== undefined && typeof detail !== "string") {
      fail(`\`meta.phases[${index}].detail\` must be a string.`);
    }
    if (model !== undefined && typeof model !== "string") {
      fail(`\`meta.phases[${index}].model\` must be a string.`);
    }
    return { title, ...detail !== undefined ? { detail } : {}, ...model !== undefined ? { model } : {} };
  });
}
function extractMeta(source) {
  const declaration = META_DECLARATION.exec(source);
  if (!declaration) {
    fail("A workflow script must begin with `export const meta = { name, description }`.\n" + PURE_LITERAL_HINT);
  }
  const open = source.indexOf("{", declaration.index + declaration[0].length);
  if (open === -1)
    fail("`export const meta` must be assigned an object literal.\n" + PURE_LITERAL_HINT);
  const { end: close, sawInterpolation } = scanObjectLiteral(source, open);
  if (close === -1)
    fail("`meta` object literal is never closed — check for an unbalanced `{`.");
  if (sawInterpolation) {
    fail("`meta` must not use template interpolation (`${...}`).\n" + PURE_LITERAL_HINT);
  }
  const fragment = source.slice(open, close);
  let value;
  try {
    value = new Script(`(${fragment})`, { filename: "workflow-meta.js" }).runInContext(createContext({}), { timeout: META_EVAL_TIMEOUT_MS });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/timed out|Script execution/i.test(detail)) {
      fail(`\`meta\` did not finish evaluating within ${META_EVAL_TIMEOUT_MS}ms — it must be a literal, not a computation.
` + PURE_LITERAL_HINT);
    }
    fail(`\`meta\` could not be evaluated: ${detail}
${PURE_LITERAL_HINT}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("`meta` must be an object literal.\n" + PURE_LITERAL_HINT);
  }
  const raw = value;
  if (typeof raw.name !== "string" || raw.name.trim() === "") {
    fail("`meta.name` is required and must be a non-empty string.");
  }
  if (typeof raw.description !== "string" || raw.description.trim() === "") {
    fail("`meta.description` is required and must be a non-empty string.");
  }
  if (raw.whenToUse !== undefined && typeof raw.whenToUse !== "string") {
    fail("`meta.whenToUse` must be a string.");
  }
  const phases = assertPhases(raw.phases);
  const meta = {
    name: raw.name,
    description: raw.description,
    ...raw.whenToUse !== undefined ? { whenToUse: raw.whenToUse } : {},
    ...phases !== undefined ? { phases } : {}
  };
  const exportAt = source.indexOf("export", declaration.index);
  const body = `${source.slice(0, exportAt)}${" ".repeat(6)}${source.slice(exportAt + 6)}`;
  return { meta, body };
}
var workflowNames = new Map;
function workflowCallName(args) {
  const source = args.script;
  if (source === undefined || source === "") {
    if (args.scriptPath !== undefined)
      return args.scriptPath.split(/[/\\]/).pop() ?? "workflow";
    return args.name !== undefined && args.name !== "" ? args.name : "workflow";
  }
  const cached = workflowNames.get(source);
  if (cached !== undefined)
    return cached;
  let name = "workflow";
  try {
    name = extractMeta(source).meta.name;
  } catch {}
  workflowNames.set(source, name);
  return name;
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/runtime.ts
import { cpus } from "node:os";
import { Worker } from "node:worker_threads";

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/journal.ts
import { createHash } from "node:crypto";
import { appendFileSync as appendFileSync2, readFileSync as readFileSync8 } from "node:fs";
function journalKey(input) {
  const canonical = JSON.stringify([
    input.prompt,
    input.label ?? null,
    input.model ?? null,
    input.agentType ?? null,
    input.effort ?? null,
    input.isolation ?? null,
    input.gate ?? null,
    input.resume ?? null,
    ...input.schema !== undefined ? [input.schema] : []
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
function readJournal(path) {
  let raw;
  try {
    raw = readFileSync8(path, "utf-8");
  } catch {
    return [];
  }
  const entries = [];
  for (const line of raw.split(`
`)) {
    if (line.trim() === "")
      continue;
    try {
      const parsed = JSON.parse(line);
      if (!isEntry(parsed))
        continue;
      entries.push(parsed);
    } catch {}
  }
  entries.sort((a, b2) => a.index - b2.index);
  return entries;
}
function appendJournal(path, entry) {
  try {
    appendFileSync2(path, `${JSON.stringify(entry)}
`, "utf-8");
  } catch {}
}
function isEntry(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const entry = value;
  return Number.isInteger(entry.index) && entry.index >= 0 && typeof entry.key === "string" && typeof entry.ok === "boolean" && (entry.text === undefined || typeof entry.text === "string") && (entry.resumed === undefined || entry.resumed === true);
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/json-schema.ts
import { Check, Errors } from "typebox/value";
var MAX_SCHEMA_BYTES = 64 * 1024;
var MAX_REPORTED_ERRORS = 5;
function compileJsonSchema(schema) {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return { ok: false, message: "agent() opts.schema must be a JSON Schema object." };
  }
  const root = schema;
  if (root.type !== "object") {
    return {
      ok: false,
      message: 'agent() opts.schema must have `type: "object"` at its root — it becomes the tool\'s input schema, ' + "and a non-object root is not something a model can be asked to fill."
    };
  }
  let serialized;
  try {
    serialized = JSON.stringify(root);
  } catch {
    return { ok: false, message: "agent() opts.schema must be JSON-serializable." };
  }
  if (serialized.length > MAX_SCHEMA_BYTES) {
    return {
      ok: false,
      message: `agent() opts.schema is too large (${serialized.length} bytes; the limit is ${MAX_SCHEMA_BYTES}).`
    };
  }
  try {
    Check(root, {});
  } catch (error) {
    return {
      ok: false,
      message: `agent() opts.schema is not a schema this runtime can validate: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  return { ok: true, compiled: { schema: root, check: (value) => checkAgainst(root, value) } };
}
function checkAgainst(schema, value) {
  let valid;
  try {
    valid = Check(schema, value);
  } catch (error) {
    return `the value could not be validated: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (valid)
    return true;
  const reported = [];
  try {
    for (const error of Errors(schema, value)) {
      const path = String(error.instancePath ?? "");
      const where = path === "" ? "$" : `$${path.replace(/\//g, ".")}`;
      reported.push(`${where}: ${error.message}`);
      if (reported.length >= MAX_REPORTED_ERRORS)
        break;
    }
  } catch {}
  return reported.length > 0 ? reported.join("; ") : "the value does not match the required schema";
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/worker-source.ts
var DETERMINISM_PRELUDE = "const Date = (function () {" + " const RealDate = globalThis.Date;" + " const die = function (what) {" + ' throw new Error(what + " is unavailable in workflow scripts (breaks resume).' + ' Stamp results after the workflow returns, or pass timestamps via `args`.");' + " };" + ' RealDate.now = function () { return die("Date.now()"); };' + ' Math.random = function () { return die("Math.random()"); };' + " return class WorkflowDate extends RealDate {" + ' constructor() { if (arguments.length === 0) die("new Date()"); super(...arguments); }' + " };" + "})();";
var WORKER_SOURCE = `"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");

const port = parentPort;
const ITEM_CAP = workerData.itemCap;
const PRELUDE = ${JSON.stringify(DETERMINISM_PRELUDE)};

/* ------------------------------------------------------------------ *
 * RPC to the host
 *
 * The script never touches the agent manager. Every effect leaves as a
 * "call" message and comes back as a "response", so the host owns the
 * semaphore, the caps, and the abort story.
 * ------------------------------------------------------------------ */

let nextCallId = 1;
const pendingCalls = new Map();

/**
 * Output tokens this run has spent, as last reported by the host.
 *
 * A mirror, not a tally: every response carries the host's current total, so
 * there is exactly one counter and it cannot drift. Between responses it cannot
 * be stale in any way the script could observe — tokens only accrue through
 * agents, and an agent's response is the only thing the script waits on.
 */
let spentOutput = 0;

function callHost(method, payload) {
  // Drain first, so the phase() that named this agent reaches the host ahead of
  // the agent entry rather than a tick behind it.
  flushProgress();
  return new Promise(function (resolve, reject) {
    const callId = nextCallId++;
    pendingCalls.set(callId, { resolve: resolve, reject: reject });
    port.postMessage({ type: "call", callId: callId, method: method, payload: payload });
  });
}

port.on("message", function (message) {
  if (!message || message.type !== "response") return;
  if (typeof message.spent === "number") spentOutput = message.spent;
  const waiter = pendingCalls.get(message.callId);
  if (!waiter) return;
  pendingCalls.delete(message.callId);
  if (message.ok) {
    waiter.resolve(message.value);
    return;
  }
  const error = new Error(message.error || "The workflow host rejected the call.");
  // Fatal errors are the run's, not the item's: parallel() and pipeline()
  // swallow ordinary failures into null, and a cap breach must not be
  // silently absorbed that way.
  if (message.fatal) error.workflowFatal = true;
  waiter.reject(error);
});

function isFatal(error) {
  return !!(error && typeof error === "object" && error.workflowFatal === true);
}

/* ------------------------------------------------------------------ *
 * Progress entries
 * ------------------------------------------------------------------ */

let progressQueue = [];
let flushTimer = null;

function emit(entry) {
  progressQueue.push(entry);
  // Batched on a macrotask: a fan-out emits a burst of phase/log entries in one
  // turn, and the host renders once per batch rather than once per entry.
  if (flushTimer === null) flushTimer = setTimeout(flushProgress, 0);
}

function flushProgress() {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (progressQueue.length === 0) return;
  const batch = progressQueue;
  progressQueue = [];
  port.postMessage({ type: "progress", entries: batch });
}

/* ------------------------------------------------------------------ *
 * The JSON boundary
 *
 * Checked here rather than relying on structured clone, which happily
 * carries cycles, BigInt and Maps that the progress log and the resume
 * journal cannot represent. Rejecting loudly beats writing a journal
 * that will not replay.
 * ------------------------------------------------------------------ */

let realmObjectPrototype = null;
/**
 * The realm's own \`JSON.parse\`.
 *
 * Module-scope, not local to main(), because \`agent({ schema })\` parses its
 * result here — outside main's closure — and the object has to carry the
 * *script's* Object.prototype, not the worker's, or \`instanceof Object\` fails
 * inside the script it was handed to.
 */
let realmParse = null;

/**
 * The top-level script's scope.
 *
 * Module-scope because a nested \`workflow()\` needs the realm-native function
 * compiler that \`main()\` builds, and because the compiled child function is
 * cached per body — see {@link workflowIn}.
 */
let rootScope = null;
/**
 * The vm context every script runs in.
 *
 * Held so a nested \`workflow()\` can compile its child there. Compiled from
 * *outside* the realm, with \`vm.Script\`, because the context itself has
 * \`codeGeneration.strings\` off — the script cannot build code, but the worker
 * that owns it still can.
 */
let realmContext = null;
/** Nested invocations made so far, against \`workerData.nestedCap\`. */
let nestedCount = 0;

function boundaryError(what, path) {
  return new Error(
    "Cannot pass " + what + " across the workflow VM boundary (at " + path + ")."
  );
}

function assertBoundary(value, path, seen) {
  if (value === null) return;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return;
  if (kind === "number") {
    if (!Number.isFinite(value)) throw boundaryError("a non-finite number", path);
    return;
  }
  if (kind === "undefined") {
    if (path === "the workflow result") return;
    throw boundaryError("undefined", path);
  }
  if (kind === "bigint") throw boundaryError("a BigInt", path);
  if (kind === "symbol") throw boundaryError("a symbol", path);
  if (kind === "function") throw boundaryError("a function", path);
  if (kind !== "object") throw boundaryError("a " + kind, path);

  if (seen.has(value)) throw boundaryError("a circular structure", path);
  seen.add(value);

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw boundaryError("an object with symbol keys", path);
  }

  if (Array.isArray(value)) {
    const length = value.length;
    for (let i = 0; i < length; i++) {
      // A sparse array round-trips through JSON as nulls, which silently
      // changes the data. Reject instead.
      if (!Object.prototype.hasOwnProperty.call(value, i)) {
        throw boundaryError("a sparse array", path + "[" + i + "]");
      }
      assertBoundary(value[i], path + "[" + i + "]", seen);
    }
    seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  // Two prototypes are legitimate: the realm's own Object.prototype (anything
  // the script built) and the worker's (arrays we hand back from parallel).
  // Everything else — Map, Set, Date, a class instance — loses meaning here.
  if (prototype !== null && prototype !== realmObjectPrototype && prototype !== Object.prototype) {
    throw boundaryError("a non-plain object", path);
  }

  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    assertBoundary(value[keys[i]], path + "." + keys[i], seen);
  }
  seen.delete(value);
}

function checkBoundary(value, path) {
  assertBoundary(value, path, new Set());
  return value;
}

/* ------------------------------------------------------------------ *
 * Realm helpers
 *
 * parallel() and pipeline() build their result arrays in worker code, but
 * the script should get an array its own realm recognises — otherwise
 * \`result instanceof Array\` is false and \`Array.isArray\` is the only thing
 * that works. Item values are moved across untouched.
 * ------------------------------------------------------------------ */

let realmNewArray = null;
let realmPush = null;

function toRealmArray(items) {
  const array = realmNewArray();
  for (let i = 0; i < items.length; i++) realmPush(array, items[i]);
  return array;
}

function toList(value, what) {
  if (!Array.isArray(value)) throw new Error(what + " expects an array.");
  const length = value.length >>> 0;
  if (length > ITEM_CAP) {
    throw new Error(
      what + " was given " + length + " items, over the limit of " + ITEM_CAP + "."
    );
  }
  const out = [];
  for (let i = 0; i < length; i++) out.push(value[i]);
  return out;
}

function requireText(value, what) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(what + " requires a non-empty string.");
  }
  return value;
}

function optionalText(value, what) {
  if (value === undefined || value === null) return undefined;
  return requireText(value, what);
}

/**
 * Reasoning effort a child may be spawned under — pi's \`ThinkingLevel\`.
 *
 * A superset of Claude Code's five, so a script written there runs here; the
 * extra \`minimal\` is pi's own. Validated in the worker rather than the host
 * because a typo should stop the script at the call that made it, not surface
 * later as an agent that quietly ran at the wrong depth.
 */
const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Every option \`agent()\` understands.
 *
 * Checked rather than ignored, because the alternative is the worst failure a
 * ported script can have. Claude Code's \`agent()\` also takes \`schema\`, and its
 * own canonical example uses it; quietly dropping it hands the script the
 * agent's raw text where it expected a validated object, and the run then dies
 * several lines later reading a field off a string. A typo behaves the same
 * way. Naming the option costs one error message and no model calls.
 */
const AGENT_OPTIONS = [
  "label",
  "phase",
  "model",
  "agentType",
  "isolation",
  "gate",
  "resume",
  "effort",
  "schema",
];

/** Claude Code options this runtime does not have, and why. */
const UNSUPPORTED_AGENT_OPTIONS = {};

/* ------------------------------------------------------------------ *
 * Script globals
 * ------------------------------------------------------------------ */

/**
 * Phase indices are allocated once for the whole run, so parent and child never
 * collide. What is per-scope is the *title to index* map: a child's
 * \`phase("Scan")\` must not resolve to the parent's "Scan".
 */
let nextPhaseIndex = 0;

/**
 * One script's view of the world.
 *
 * A nested \`workflow()\` runs in this same worker and this same vm context —
 * which is what makes it share the run's semaphore, agent counter, journal,
 * abort signal and budget without any of them being plumbed anywhere. What it
 * must NOT share is ambient phase state, so that lives here and the child's
 * globals are closures over its own scope.
 */
function makeScope(name, depth) {
  const scope = {
    name: name,
    depth: depth,
    // Prefixed into every phase title the child defines, which is the whole of
    // how a nested run reads as its own group in the progress tree — no new
    // entry type, no renderer change.
    prefix: name === undefined ? "" : "▸ " + name,
    ambientPhaseIndex: undefined,
    ambientPhaseTitle: undefined,
    phaseIndexByTitle: new Map(),
  };
  scope.agent = function (prompt, opts) {
    return agentIn(scope, prompt, opts);
  };
  scope.phase = function (title) {
    return phaseIn(scope, title);
  };
  scope.log = function (message) {
    return logIn(scope, message);
  };
  scope.workflow = function (ref, args) {
    return workflowIn(scope, ref, args);
  };
  scope.console = makeConsole(scope);
  return scope;
}

/** A scope's title for a phase: the child's own group, or the parent's bare title. */
function scopedTitle(scope, title) {
  if (scope.prefix === "") return title;
  return title === undefined ? scope.prefix : scope.prefix + " › " + title;
}

function definePhaseIn(scope, title) {
  let index = scope.phaseIndexByTitle.get(title);
  if (index !== undefined) return index;
  index = nextPhaseIndex++;
  scope.phaseIndexByTitle.set(title, index);
  emit({ type: "workflow_phase", index: index, title: scopedTitle(scope, title) });
  return index;
}

function phaseIn(scope, title) {
  const text = requireText(title, "phase(title)");
  scope.ambientPhaseIndex = definePhaseIn(scope, text);
  scope.ambientPhaseTitle = scopedTitle(scope, text);
}

function describe(value) {
  if (typeof value === "string") return value;
  // Duck-typed, not \`instanceof Error\`: an error thrown by the script belongs
  // to the vm realm, so it fails an instanceof check against the worker's.
  if (value && typeof value === "object" && typeof value.message === "string" && typeof value.stack === "string") {
    return value.message;
  }
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    /* cycles and BigInt fall through to String() */
  }
  return String(value);
}

/** Attribute a line to the child that wrote it; logs carry no phase of their own. */
function logPrefix(scope) {
  return scope.prefix === "" ? "" : scope.prefix + ": ";
}

function logIn(scope, message) {
  emit({ type: "workflow_log", message: logPrefix(scope) + describe(message) });
}

function makeConsole(scope) {
  const write = function () {
    const parts = [];
    for (let i = 0; i < arguments.length; i++) parts.push(describe(arguments[i]));
    emit({ type: "workflow_log", message: logPrefix(scope) + parts.join(" ") });
  };
  return { log: write, info: write, warn: write, error: write, debug: write };
}

async function agentIn(scope, prompt, opts) {
  const text = requireText(prompt, "agent(prompt)");
  const options = opts === undefined || opts === null ? {} : opts;
  if (typeof options !== "object" || Array.isArray(options)) {
    throw new Error("agent(prompt, opts) expects opts to be an object.");
  }

  for (const key of Object.keys(options)) {
    if (AGENT_OPTIONS.indexOf(key) !== -1) continue;
    const why = UNSUPPORTED_AGENT_OPTIONS[key];
    throw new Error(
      why !== undefined
        ? "agent() opts." + key + " is not supported here: " + why
        : "agent() opts." + key + " is not a recognised option. Supported: " + AGENT_OPTIONS.join(", ") + "."
    );
  }

  const label = optionalText(options.label, "agent() opts.label");
  const phaseName = optionalText(options.phase, "agent() opts.phase");
  const model = optionalText(options.model, "agent() opts.model");
  const agentType = optionalText(options.agentType, "agent() opts.agentType");
  const isolation = optionalText(options.isolation, "agent() opts.isolation");
  if (isolation !== undefined && isolation !== "worktree") {
    throw new Error("agent() opts.isolation must be \\"worktree\\".");
  }
  const gate = optionalText(options.gate, "agent() opts.gate");
  const resume = optionalText(options.resume, "agent() opts.resume");
  const effort = optionalText(options.effort, "agent() opts.effort");
  const schema = options.schema;
  if (schema !== undefined) {
    if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
      throw new Error("agent() opts.schema must be a JSON Schema object.");
    }
    // Structured clone would happily carry a Map or a cycle that neither the
    // journal key nor the tool's parameters can survive. Same check the return
    // value gets.
    checkBoundary(schema, "agent() opts.schema");
  }
  if (effort !== undefined && EFFORT_LEVELS.indexOf(effort) === -1) {
    throw new Error("agent() opts.effort must be one of: " + EFFORT_LEVELS.join(", ") + ".");
  }

  // resume revives a child that already exists, so anything describing how to
  // *start* one is not a thing this call gets to decide — the revived child
  // keeps the agent, model and tool contract it was started with. Rejecting is
  // the point: silently ignoring these opts would look like they applied.
  if (resume !== undefined) {
    if (agentType !== undefined) {
      throw new Error(
        "agent() opts.resume and opts.agentType are mutually exclusive: a resumed agent keeps the agent type it was started with."
      );
    }
    if (model !== undefined) {
      throw new Error(
        "agent() opts.resume and opts.model are mutually exclusive: a resumed agent keeps the model it was started with."
      );
    }
    if (isolation !== undefined) {
      throw new Error(
        "agent() opts.resume and opts.isolation are mutually exclusive: a resumed agent keeps the working tree it was started in."
      );
    }
    if (effort !== undefined) {
      throw new Error(
        "agent() opts.resume and opts.effort are mutually exclusive: a resumed agent keeps the reasoning effort it was started with."
      );
    }
    if (schema !== undefined) {
      throw new Error(
        "agent() opts.resume and opts.schema are mutually exclusive: a resumed child re-prompts the session it "
          + "already had, whose tool set was fixed when it started — it has no StructuredOutput tool to answer through."
      );
    }
    if (gate !== undefined) {
      throw new Error("agent() opts.gate cannot be combined with opts.resume.");
    }
  }

  // An explicit opts.phase files this agent under that phase without moving
  // the ambient one, so a stray verify step does not re-point the phases that
  // follow it.
  const phaseIndex = phaseName !== undefined ? definePhaseIn(scope, phaseName) : scope.ambientPhaseIndex;
  const phaseTitle = phaseName !== undefined ? scopedTitle(scope, phaseName) : scope.ambientPhaseTitle;

  const result = await callHost("agent", {
    prompt: text,
    label: label,
    model: model,
    agentType: agentType,
    isolation: isolation,
    phaseIndex: phaseIndex,
    phaseTitle: phaseTitle,
    gate: gate,
    resume: resume,
    effort: effort,
    schema: schema,
  });
  if (result === undefined || result === null) return null;
  if (schema === undefined) return result;
  // Parsed with the realm's own JSON.parse so the script gets an object whose
  // prototype is its own — \`x instanceof Object\` and \`x.list instanceof Array\`
  // both hold, and it survives assertBoundary if the script returns it.
  try {
    return realmParse(result);
  } catch (error) {
    logIn(scope, "agent(): the host returned a structured result that is not JSON");
    return null;
  }
}

/**
 * A barrier: every thunk starts now, and nothing past the await runs until all
 * of them have settled. A thunk that throws resolves to null rather than
 * failing its siblings — the script filters, it does not try/catch.
 */
async function parallel(thunks) {
  const list = toList(thunks, "parallel(thunks)");
  for (let i = 0; i < list.length; i++) {
    if (typeof list[i] !== "function") {
      throw new Error("parallel(thunks) expects an array of functions; item " + i + " is not one.");
    }
  }
  const settled = await Promise.all(
    list.map(async function (thunk) {
      try {
        return await thunk();
      } catch (error) {
        if (isFatal(error)) throw error;
        return null;
      }
    })
  );
  return toRealmArray(settled);
}

/**
 * No barrier between stages. Each item walks its own chain, so item A can be
 * in stage 3 while item B is still in stage 1 — which is the whole point:
 * a barrier makes every stage wait on its slowest sibling, and with agents in
 * the stages that latency is measured in minutes.
 *
 * A stage that throws drops that item to null and skips its remaining stages.
 * Every stage sees (previousResult, originalItem, index).
 */
async function pipeline(items, ...stages) {
  const list = toList(items, "pipeline(items, ...stages)");
  for (let i = 0; i < stages.length; i++) {
    if (typeof stages[i] !== "function") {
      throw new Error("pipeline(items, ...stages) expects stages to be functions; stage " + i + " is not one.");
    }
  }
  const settled = await Promise.all(
    list.map(async function (item, index) {
      let value = item;
      for (let s = 0; s < stages.length; s++) {
        try {
          value = await stages[s](value, item, index);
        } catch (error) {
          if (isFatal(error)) throw error;
          return null;
        }
      }
      return value;
    })
  );
  return toRealmArray(settled);
}

/**
 * The \`workflow(nameOrRef, args?)\` global.
 *
 * Runs another workflow inline. The child executes in *this* worker and *this*
 * vm context, as a function whose parameters shadow the globals — which is why
 * it shares the run's concurrency cap, agent counter, abort signal, journal and
 * budget without any of them being passed anywhere: there is only ever one of
 * each. What it does not share is ambient phase state, which lives on the scope.
 *
 * One level only, as in Claude Code. The child's \`workflow\` is present and
 * throws rather than absent, so the error names the limit instead of reading
 * \`workflow is not defined\`.
 */
async function workflowIn(scope, nameOrRef, args) {
  if (scope.depth > 0) {
    throw new Error(
      "workflow() cannot be nested more than one level deep — you are already inside the workflow '" +
        scope.name + "'. Call the agents inline instead."
    );
  }

  let ref;
  if (typeof nameOrRef === "string") {
    if (nameOrRef.trim() === "") throw new Error("workflow(nameOrRef) expects a non-empty name.");
    ref = { name: nameOrRef };
  } else if (nameOrRef && typeof nameOrRef === "object" && !Array.isArray(nameOrRef)) {
    const scriptPath = optionalText(nameOrRef.scriptPath, "workflow() scriptPath");
    const name = optionalText(nameOrRef.name, "workflow() name");
    if (scriptPath === undefined && name === undefined) {
      throw new Error("workflow({ ... }) expects a \`name\` or a \`scriptPath\`.");
    }
    ref = { name: name, scriptPath: scriptPath };
  } else {
    throw new Error("workflow(nameOrRef) expects a saved workflow name or { scriptPath }.");
  }

  const label = ref.name !== undefined ? ref.name : ref.scriptPath;
  if (args !== undefined) checkBoundary(args, 'workflow("' + label + '") args');

  if (nestedCount >= workerData.nestedCap) {
    // Fatal, like the agent cap: a limit that silently drops work would be
    // worse than no limit.
    const error = new Error(
      "Workflow exceeded its cap of " + workerData.nestedCap + " nested workflow() calls."
    );
    error.workflowFatal = true;
    throw error;
  }
  nestedCount++;

  let loaded;
  try {
    loaded = await callHost("workflow", ref);
  } catch (error) {
    // Resolution failures are the script's to handle — Claude Code documents
    // workflow() as throwing on an unknown name so a script can catch it.
    // Attributed, so a caught error says which reference failed.
    if (isFatal(error)) throw error;
    throw new Error('workflow("' + label + '"): ' + describe(error));
  }

  const child = makeScope(loaded.name, scope.depth + 1);
  // The child's own group, defined before its first agent so a child that never
  // calls phase() still reads as its own section rather than falling into the
  // parent's un-phased bucket.
  child.ambientPhaseIndex = definePhaseIn(child, undefined);
  child.ambientPhaseTitle = scopedTitle(child, undefined);

  let run;
  try {
    const compiled = new vm.Script(
      // \`meta\` is deliberately not a parameter: the body still opens with its
      // own \`const meta = { ... }\` (extractMeta strips only the \`export\`), so a
      // parameter of that name would collide with it.
      "(async (agent, phase, log, workflow, console, args) => {" + PRELUDE + "\\n" + loaded.body + "\\n})",
      { filename: "workflow:" + loaded.name + ".js", lineOffset: -1 }
    );
    run = compiled.runInContext(realmContext);
  } catch (error) {
    throw new Error('workflow("' + label + '"): ' + describe(error));
  }

  const value = await run(child.agent, child.phase, child.log, child.workflow, child.console, args);
  checkBoundary(value, 'the result of workflow("' + label + '")');
  return value;
}

/**
 * The \`budget\` global.
 *
 * \`total\` is permanently null, and that is the honest answer rather than a
 * stub: Claude Code fills it from the user's "+500k" directive and pi has no
 * such directive, so "no target set" is the state this runtime is always in.
 * Every pattern Claude Code documents guards on exactly that — \`while
 * (budget.total && ...)\`, \`budget.total ? ... : 5\` — so those scripts run here
 * unchanged and take the branch they were written for. Leaving \`budget\`
 * undefined instead would turn a graceful guard into a ReferenceError.
 *
 * \`spent()\` is real. It differs from Claude Code's in scope: theirs pools the
 * main loop and every workflow in the turn, ours counts this run's agents.
 */
function makeBudget() {
  return {
    total: null,
    spent: function () {
      return spentOutput;
    },
    remaining: function () {
      // Infinity, not a number, because there is no target to subtract from.
      return Infinity;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

async function main() {
  rootScope = makeScope(undefined, 0);
  const sandbox = {
    agent: rootScope.agent,
    parallel: parallel,
    pipeline: pipeline,
    phase: rootScope.phase,
    log: rootScope.log,
    workflow: rootScope.workflow,
    budget: makeBudget(),
    console: rootScope.console,
  };
  const context = vm.createContext(sandbox, {
    name: "workflow",
    codeGeneration: { strings: false, wasm: false },
  });

  realmObjectPrototype = vm.runInContext("Object.prototype", context);
  realmNewArray = vm.runInContext("(function () { return []; })", context);
  realmPush = vm.runInContext("(function (array, value) { array.push(value); })", context);
  realmParse = vm.runInContext("JSON.parse", context);
  realmContext = context;

  // meta and args are materialised *inside* the realm rather than injected, so
  // the script sees objects whose prototype is its own Object.prototype and
  // whose .constructor is its own Function.
  sandbox.meta = realmParse(workerData.metaJson);
  sandbox.args = workerData.argsJson === undefined ? undefined : realmParse(workerData.argsJson);

  const script = new vm.Script("(async () => {" + PRELUDE + "\\n" + workerData.body + "\\n})()", {
    filename: "workflow.js",
    // The wrapper adds exactly one line above the body; undo it so a thrown
    // error points at the line the author wrote.
    lineOffset: -1,
  });

  const value = await script.runInContext(context);
  checkBoundary(value, "the workflow result");
  flushProgress();
  port.postMessage({
    type: "complete",
    resultJson: value === undefined ? undefined : JSON.stringify(value),
  });
}

main().catch(function (error) {
  flushProgress();
  port.postMessage({
    type: "error",
    message: error && error.message ? String(error.message) : String(error),
    stack: error && error.stack ? String(error.stack) : undefined,
  });
});
`;

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/runtime.ts
var MAX_SCRIPT_LENGTH = 524288;
var WORKFLOW_AGENT_CAP = 1000;
var WORKFLOW_ITEM_CAP = 4096;
var WORKFLOW_NESTED_CAP = 256;
var PREVIEW_LENGTH = 200;

class WorkflowRuntimeError extends Error {
}
function workflowConcurrency(cpuCount = cpus().length) {
  return Math.max(1, Math.min(16, cpuCount - 2));
}
function boundaryError(what, path) {
  return new WorkflowRuntimeError(`Cannot pass ${what} across the workflow VM boundary (at ${path}).`);
}
function walk(value, path, seen) {
  if (value === null)
    return;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean")
    return;
  if (kind === "number") {
    if (!Number.isFinite(value))
      throw boundaryError("a non-finite number", path);
    return;
  }
  if (kind === "undefined") {
    if (path === "args")
      return;
    throw boundaryError("undefined", path);
  }
  if (kind === "bigint")
    throw boundaryError("a BigInt", path);
  if (kind === "symbol")
    throw boundaryError("a symbol", path);
  if (kind === "function")
    throw boundaryError("a function", path);
  if (kind !== "object")
    throw boundaryError(`a ${kind}`, path);
  const object = value;
  if (seen.has(object))
    throw boundaryError("a circular structure", path);
  seen.add(object);
  if (Object.getOwnPropertySymbols(object).length > 0) {
    throw boundaryError("an object with symbol keys", path);
  }
  if (Array.isArray(object)) {
    for (let i = 0;i < object.length; i++) {
      if (!Object.hasOwn(object, i))
        throw boundaryError("a sparse array", `${path}[${i}]`);
      walk(object[i], `${path}[${i}]`, seen);
    }
    seen.delete(object);
    return;
  }
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== null && prototype !== Object.prototype) {
    throw boundaryError("a non-plain object", path);
  }
  for (const [key, entry] of Object.entries(object)) {
    walk(entry, `${path}.${key}`, seen);
  }
  seen.delete(object);
}
function assertBoundarySafe(value, path) {
  walk(value, path, new Set);
}

class Semaphore {
  limit;
  active = 0;
  waiters = [];
  constructor(limit) {
    this.limit = limit;
  }
  acquire() {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve3) => {
      this.waiters.push(resolve3);
    });
  }
  release() {
    const next = this.waiters.shift();
    if (next)
      next();
    else
      this.active--;
  }
  drain() {
    while (this.waiters.length > 0) {
      const next = this.waiters.shift();
      next?.();
    }
  }
}
var CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
var preview = (text) => text.length <= PREVIEW_LENGTH ? text : `${text.slice(0, PREVIEW_LENGTH - 1)}…`;
function derivedLabel(prompt) {
  const line = prompt.split(`
`, 1)[0].trim();
  return line.length <= 60 ? line || "agent" : `${line.slice(0, 59)}…`;
}
function applySchema(result, compiled) {
  let parsed;
  try {
    parsed = JSON.parse(result.text ?? "");
  } catch {
    return {
      ...result,
      ok: false,
      error: "The agent did not return structured output: its answer was not JSON."
    };
  }
  const verdict = compiled.check(parsed);
  if (verdict === true)
    return result;
  return {
    ...result,
    ok: false,
    error: `The agent's answer did not match the requested schema: ${verdict}`
  };
}
async function applyGate(result, command, agentId, runGate) {
  const outcome = result.gate ?? await runGate(command, {
    agentId,
    ...result.cwd !== undefined ? { cwd: result.cwd } : {}
  });
  const { gate: _ran, ...kept } = result;
  if (outcome.ok)
    return kept;
  const { text: _discarded, ...rest } = kept;
  const output = outcome.output.trim();
  return { ...rest, ok: false, error: output === "" ? `Gate command failed: ${command}` : output };
}
function unawaitedLaunchMessage(labels) {
  const list = labels.map((label) => `'${label}'`).join(", ");
  return `workflow script completed with unawaited agent launch(es): ${list}. Await or return each launch.`;
}
function validateScript(script) {
  if (script.length > MAX_SCRIPT_LENGTH) {
    throw new WorkflowRuntimeError(`Workflow script is ${script.length} characters, over the limit of ${MAX_SCRIPT_LENGTH}.`);
  }
  if (CONTROL_CHARACTERS.test(script)) {
    throw new WorkflowRuntimeError("Workflow script contains control characters. Only tab, carriage return and newline are allowed.");
  }
  return extractMeta(script);
}
async function runWorkflow(options) {
  const { script, host } = options;
  assertBoundarySafe(options.args, "args");
  const { meta, body } = validateScript(script);
  const agentCap = options.agentCap ?? WORKFLOW_AGENT_CAP;
  const itemCap = options.itemCap ?? WORKFLOW_ITEM_CAP;
  const semaphore = new Semaphore(options.concurrency ?? workflowConcurrency());
  const progress = [];
  const inflight = new Set;
  const completedByLabel = new Map;
  const openLaunches = new Map;
  let agentCount = 0;
  let aborted = false;
  let settled = false;
  const journalEntries = options.journal?.entries ?? [];
  const recordJournal = options.journal?.append;
  const journalResumes = journalEntries.some((entry) => entry.resumed);
  let prefixIntact = journalEntries.length > 0 && !journalResumes;
  let replayedCount = 0;
  const liveAgents = new Map;
  let spentOutputTokens = 0;
  let paused = false;
  const isPaused = () => paused;
  const pauseWaiters = new Set;
  function releasePause() {
    for (const wake of [...pauseWaiters])
      wake();
    pauseWaiters.clear();
  }
  function pauseGate(live) {
    if (!paused || aborted || settled)
      return Promise.resolve();
    return new Promise((resolve3) => {
      const wake = () => {
        pauseWaiters.delete(wake);
        live.wake = undefined;
        resolve3();
      };
      live.wake = wake;
      pauseWaiters.add(wake);
    });
  }
  options.onControl?.({
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      releasePause();
    },
    isPaused: () => paused,
    skip: (index) => {
      const live = liveAgents.get(index);
      if (live === undefined || live.intent !== undefined)
        return false;
      live.intent = "skip";
      if (live.started)
        host.abortAgent(live.agentId);
      else
        live.wake?.();
      return true;
    },
    retry: (index) => {
      const live = liveAgents.get(index);
      if (live === undefined || !live.started || live.intent !== undefined)
        return false;
      live.intent = "retry";
      host.abortAgent(live.agentId);
      return true;
    }
  });
  function replayAt(index, key) {
    if (!prefixIntact)
      return;
    const entry = journalEntries[index];
    if (entry === undefined || entry.index !== index || entry.key !== key || !entry.ok) {
      prefixIntact = false;
      return;
    }
    return entry;
  }
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: {
      body,
      metaJson: JSON.stringify(meta),
      argsJson: options.args === undefined ? undefined : JSON.stringify(options.args),
      itemCap,
      nestedCap: options.nestedCap ?? WORKFLOW_NESTED_CAP
    }
  });
  return await new Promise((resolve3) => {
    const emit = (entries) => {
      if (entries.length === 0)
        return;
      progress.push(...entries);
      options.onProgress?.(entries);
    };
    const respond = (callId, ok, value, error, fatal) => {
      openLaunches.delete(callId);
      if (settled)
        return;
      worker.postMessage({ type: "response", callId, ok, value, error, fatal, spent: spentOutputTokens });
    };
    const finish = (result) => {
      if (settled)
        return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      releasePause();
      for (const agentId of inflight)
        host.abortAgent(agentId);
      inflight.clear();
      semaphore.drain();
      const settle = () => resolve3({ ...result, meta, progress, agentCount, replayedCount });
      worker.terminate().then(settle, settle);
    };
    function onAbort() {
      aborted = true;
      finish({ status: "killed", error: "Workflow aborted." });
    }
    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
    async function handleAgent(callId, payload) {
      const runGate = host.runGate?.bind(host);
      const resumeAgent2 = host.resumeAgent?.bind(host);
      if (payload.gate !== undefined && runGate === undefined) {
        respond(callId, false, undefined, "This workflow host cannot run gate commands.", true);
        return;
      }
      if (payload.resume !== undefined && resumeAgent2 === undefined) {
        respond(callId, false, undefined, "This workflow host cannot resume agents.", true);
        return;
      }
      let resumed;
      if (payload.resume !== undefined) {
        resumed = completedByLabel.get(payload.resume);
        if (resumed === undefined) {
          const known = [...completedByLabel.keys()];
          respond(callId, false, undefined, replayedCount > 0 ? `agent() opts.resume: "${payload.resume}" was replayed from the resume journal, not run, so there is ` + "no conversation in this run to continue. Re-run without resumeFromRunId." : `agent() opts.resume: no agent has completed under the label "${payload.resume}" in this run. ${known.length === 0 ? "No agent has completed yet." : `Known labels: ${known.map((label2) => `"${label2}"`).join(", ")}.`}`, true);
          return;
        }
      }
      let compiledSchema;
      if (payload.schema !== undefined) {
        const compilation = compileJsonSchema(payload.schema);
        if (!compilation.ok) {
          respond(callId, false, undefined, compilation.message, true);
          return;
        }
        compiledSchema = compilation.compiled;
      }
      if (agentCount >= agentCap) {
        respond(callId, false, undefined, `Workflow exceeded its cap of ${agentCap} agents.`, true);
        return;
      }
      const index = agentCount++;
      const agentId = resumed?.agentId ?? `wf-agent-${index}`;
      const label = payload.label ?? resumed?.label ?? derivedLabel(payload.prompt);
      const agentType = resumed?.agentType ?? payload.agentType ?? "general-purpose";
      const model = resumed !== undefined ? resumed.model : payload.model;
      const isolation = resumed !== undefined ? resumed.isolation : payload.isolation;
      openLaunches.set(callId, label);
      const base = {
        type: "workflow_agent",
        index,
        label,
        state: "start",
        agentId,
        agentType,
        promptPreview: preview(payload.prompt),
        ...model !== undefined ? { model } : {},
        ...isolation !== undefined ? { isolation } : {},
        ...payload.phaseIndex !== undefined ? { phaseIndex: payload.phaseIndex } : {},
        ...payload.phaseTitle !== undefined ? { phaseTitle: payload.phaseTitle } : {}
      };
      const queuedAt = Date.now();
      emit([{ ...base, queuedAt }]);
      const keyInput = {
        ...payload,
        schema: payload.schema !== undefined ? JSON.stringify(payload.schema) : undefined
      };
      let replayed = replayAt(index, journalKey(keyInput));
      if (replayed !== undefined && compiledSchema !== undefined) {
        const recheck = applySchema({ ok: true, text: replayed.text ?? "" }, compiledSchema);
        if (!recheck.ok) {
          prefixIntact = false;
          replayed = undefined;
        }
      }
      if (replayed !== undefined) {
        replayedCount++;
        const replayedText = replayed.text ?? "";
        const at = Date.now();
        emit([
          {
            ...base,
            queuedAt,
            startedAt: at,
            lastProgressAt: at,
            durationMs: 0,
            state: "done",
            cached: true,
            resultPreview: preview(replayedText)
          }
        ]);
        openLaunches.delete(callId);
        recordJournal?.({ index, key: replayed.key, ok: true, text: replayedText });
        respond(callId, true, replayedText);
        return;
      }
      const key = journalKey(keyInput);
      const resumeMark = payload.resume !== undefined ? { resumed: true } : {};
      const settleSkipped = (extra) => {
        recordJournal?.({ index, key, ok: false, ...resumeMark });
        emit([{ ...base, queuedAt, ...extra, state: "error", skipped: true, error: "Skipped by user." }]);
        respond(callId, true, null);
      };
      const live = { agentId, started: false };
      liveAgents.set(index, live);
      const intent = () => live.intent;
      let attempt = 1;
      try {
        for (;; ) {
          await pauseGate(live);
          if (intent() === "skip")
            return settleSkipped({});
          await semaphore.acquire();
          if (aborted || settled) {
            semaphore.release();
            respond(callId, false, undefined, "Workflow aborted.", true);
            return;
          }
          if (isPaused() && !aborted && !settled) {
            semaphore.release();
            continue;
          }
          if (intent() === "skip") {
            semaphore.release();
            return settleSkipped({});
          }
          const attemptMark = attempt > 1 ? { attempt, lastAttemptReason: "user-retry" } : {};
          const startedAt = Date.now();
          emit([{ ...base, queuedAt, startedAt, ...attemptMark }]);
          const onResolved = (info) => {
            if (info.recordId !== undefined)
              base.recordId = info.recordId;
            if (info.modelName !== undefined)
              base.model = info.modelName;
            if (info.modelId !== undefined)
              base.modelId = info.modelId;
            if (info.thinking !== undefined)
              base.thinking = info.thinking;
            if (info.requestedThinking !== undefined)
              base.requestedThinking = info.requestedThinking;
            if (info.requestedModel !== undefined)
              base.requestedModel = info.requestedModel;
            if (!inflight.has(agentId))
              return;
            emit([{ ...base, queuedAt, startedAt, ...attemptMark, lastProgressAt: Date.now() }]);
          };
          live.started = true;
          inflight.add(agentId);
          let result;
          try {
            result = resumed !== undefined && resumeAgent2 !== undefined ? await resumeAgent2(resumed.agentId, payload.prompt, onResolved) : await host.spawnAgent({
              agentId,
              index,
              prompt: payload.prompt,
              label,
              agentType,
              ...model !== undefined ? { model } : {},
              ...payload.effort !== undefined ? { effort: payload.effort } : {},
              ...compiledSchema !== undefined ? { schema: compiledSchema } : {},
              ...isolation !== undefined ? { isolation } : {},
              ...payload.phaseIndex !== undefined ? { phaseIndex: payload.phaseIndex } : {},
              ...payload.phaseTitle !== undefined ? { phaseTitle: payload.phaseTitle } : {},
              ...payload.gate !== undefined ? { gate: payload.gate } : {},
              onResolved
            });
            if (result.ok) {
              completedByLabel.set(label, {
                agentId,
                label,
                agentType,
                ...model !== undefined ? { model } : {},
                ...isolation !== undefined ? { isolation } : {}
              });
              if (compiledSchema !== undefined && result.ok) {
                result = applySchema(result, compiledSchema);
              }
              if (result.ok && payload.gate !== undefined && runGate !== undefined) {
                result = await applyGate(result, payload.gate, agentId, runGate);
              }
            }
          } catch (error) {
            result = { ok: false, error: error instanceof Error ? error.message : String(error) };
          } finally {
            inflight.delete(agentId);
            live.started = false;
            semaphore.release();
          }
          if (settled)
            return;
          if (intent() === "retry" && !aborted) {
            live.intent = undefined;
            attempt++;
            emit([{ ...base, queuedAt, attempt, lastAttemptReason: "user-retry" }]);
            continue;
          }
          spentOutputTokens += result.outputTokens ?? 0;
          const finishedAt = Date.now();
          const common = {
            ...base,
            queuedAt,
            startedAt,
            ...attemptMark,
            lastProgressAt: finishedAt,
            durationMs: finishedAt - startedAt,
            ...result.tokens !== undefined ? { tokens: result.tokens } : {},
            ...result.toolCalls !== undefined ? { toolCalls: result.toolCalls } : {}
          };
          if (result.ok) {
            const text = result.text ?? "";
            emit([{ ...common, state: "done", resultPreview: preview(text) }]);
            recordJournal?.({ index, key, ok: true, text, ...resumeMark });
            respond(callId, true, text);
            return;
          }
          recordJournal?.({ index, key, ok: false, ...resumeMark });
          emit([
            {
              ...common,
              state: "error",
              error: result.error ?? "Agent failed.",
              ...result.skipped ? { skipped: true } : {}
            }
          ]);
          respond(callId, true, null);
          return;
        }
      } finally {
        liveAgents.delete(index);
      }
    }
    async function handleLoadWorkflow(callId, ref) {
      const loadWorkflow = host.loadWorkflow?.bind(host);
      if (loadWorkflow === undefined) {
        respond(callId, false, undefined, "This workflow host cannot run nested workflows.", true);
        return;
      }
      let source;
      try {
        source = await loadWorkflow(ref);
      } catch (error) {
        respond(callId, false, undefined, error instanceof Error ? error.message : String(error));
        return;
      }
      if (!source.ok) {
        respond(callId, false, undefined, source.message);
        return;
      }
      try {
        const child = validateScript(source.script);
        respond(callId, true, {
          name: child.meta.name,
          metaJson: JSON.stringify(child.meta),
          body: child.body
        });
      } catch (error) {
        respond(callId, false, undefined, error instanceof Error ? error.message : String(error));
      }
    }
    worker.on("message", (message) => {
      if (settled)
        return;
      switch (message.type) {
        case "progress":
          emit(message.entries);
          break;
        case "call":
          if (message.method === "workflow") {
            handleLoadWorkflow(message.callId, message.payload);
            break;
          }
          if (message.method !== "agent") {
            respond(message.callId, false, undefined, `Unknown workflow host method "${message.method}".`, true);
            break;
          }
          handleAgent(message.callId, message.payload);
          break;
        case "complete": {
          const unawaited = [...openLaunches.values()];
          if (unawaited.length > 0) {
            finish({ status: "failed", error: unawaitedLaunchMessage(unawaited) });
            break;
          }
          finish({
            status: "completed",
            ...message.resultJson === undefined ? {} : { value: JSON.parse(message.resultJson) }
          });
          break;
        }
        case "error":
          finish({ status: "failed", error: message.message });
          break;
      }
    });
    worker.on("error", (error) => {
      finish({ status: "failed", error: error instanceof Error ? error.message : String(error) });
    });
    worker.on("exit", () => {
      finish({ status: "failed", error: "Workflow worker exited before completing." });
    });
  });
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/saved.ts
var WORKFLOW_EXTENSION = ".js";
function savedWorkflowRoots(cwd) {
  return [
    join12(cwd, ".pi", "workflows"),
    join12(cwd, ".agents", "workflows"),
    join12(getAgentDir10(), "workflows"),
    ...packageWorkflowDirs(cwd)
  ];
}
function readSavedWorkflow(name, cwd) {
  const trimmed = name.trim();
  if (isUnsafeName(trimmed)) {
    return {
      ok: false,
      message: `"${name}" is not a usable workflow name. Use letters, digits, dots, hyphens and underscores only ` + "— a path is what `scriptPath` is for."
    };
  }
  const roots = savedWorkflowRoots(cwd);
  for (const root of roots) {
    if (isSymlink(root))
      continue;
    const path = join12(root, `${trimmed}${WORKFLOW_EXTENSION}`);
    if (isPackageResourceExcluded(path, cwd, "workflows"))
      continue;
    const script = safeReadFile(path);
    if (script === undefined)
      continue;
    if (!hasMetaDeclaration(script)) {
      return {
        ok: false,
        message: `"${path}" is not a workflow script — it has no \`export const meta = { name, description }\` ` + "declaration. Nothing was run."
      };
    }
    return { ok: true, script, path };
  }
  const declared = packageWorkflowFiles(cwd).get(trimmed);
  if (declared !== undefined) {
    const script = safeReadFile(declared);
    if (script !== undefined) {
      if (!hasMetaDeclaration(script)) {
        return {
          ok: false,
          message: `"${declared}" is not a workflow script — it has no \`export const meta = { name, description }\` ` + "declaration. Nothing was run."
        };
      }
      return { ok: true, script, path: declared };
    }
  }
  const known = listSavedWorkflows(cwd);
  return {
    ok: false,
    message: `No saved workflow named "${trimmed}". Looked in: ${roots.join(", ")}. ` + (known.length > 0 ? `Available: ${known.join(", ")}.` : "Save one as `<name>.js` in one of those directories, or pass `script`/`scriptPath` instead.")
  };
}
function resolveWorkflowSource(ref, cwd) {
  const path = ref.scriptPath?.trim();
  if (path !== undefined && path !== "") {
    const resolved2 = isAbsolute4(path) ? path : join12(cwd, path);
    try {
      return { ok: true, script: readFileSync9(resolved2, "utf-8"), path: resolved2 };
    } catch (err) {
      return {
        ok: false,
        message: `Could not read workflow script "${resolved2}": ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }
  const name = ref.name?.trim();
  if (name !== undefined && name !== "")
    return readSavedWorkflow(name, cwd);
  return { ok: false, message: "A workflow reference needs a `name` or a `scriptPath`." };
}
function listSavedWorkflows(cwd) {
  const names = new Set;
  for (const root of savedWorkflowRoots(cwd)) {
    if (!existsSync11(root) || isSymlink(root))
      continue;
    let entries;
    try {
      entries = readdirSync3(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(WORKFLOW_EXTENSION))
        continue;
      const name = entry.slice(0, -WORKFLOW_EXTENSION.length);
      if (isUnsafeName(name))
        continue;
      const path = join12(root, entry);
      if (isPackageResourceExcluded(path, cwd, "workflows"))
        continue;
      if (isWorkflowFile(path))
        names.add(name);
    }
  }
  for (const [name, path] of packageWorkflowFiles(cwd)) {
    if (isUnsafeName(name))
      continue;
    if (isWorkflowFile(path))
      names.add(name);
  }
  return [...names].sort();
}
function isWorkflowFile(path) {
  try {
    if (statSync5(path).size > MAX_SCRIPT_LENGTH)
      return false;
  } catch {
    return false;
  }
  const source = safeReadFile(path);
  return source !== undefined && hasMetaDeclaration(source);
}
function resolveWorkflowScript(params, cwd) {
  const path = params.scriptPath?.trim();
  if (path !== undefined && path !== "") {
    const resolved2 = resolveWorkflowSource({ scriptPath: path }, cwd);
    return resolved2.ok ? { ok: true, script: resolved2.script, scriptPath: resolved2.path } : resolved2;
  }
  const script = params.script;
  if (script !== undefined && script.trim() !== "")
    return { ok: true, script };
  const name = params.name?.trim();
  if (name !== undefined && name !== "") {
    const saved = resolveWorkflowSource({ name }, cwd);
    return saved.ok ? { ok: true, script: saved.script, scriptPath: saved.path } : saved;
  }
  const known = listSavedWorkflows(cwd);
  return {
    ok: false,
    message: "Provide `script` (inline source), `scriptPath` (a file to read), or `name` (a saved workflow). " + "`scriptPath` takes precedence, then `script`, then `name`." + (known.length > 0 ? ` Saved workflows: ${known.join(", ")}.` : "")
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/host.ts
var DEFAULT_GATE_TIMEOUT_MS = 10 * 60000;
function childCwd(record) {
  const path = record.worktree?.path;
  return path !== undefined && existsSync12(path) ? path : undefined;
}
function succeeded(record) {
  return record?.status === "completed" || record?.status === "steered";
}
function resolvedInfo(record) {
  const invocation = record?.invocation;
  if (invocation?.modelName === undefined)
    return;
  return {
    modelName: invocation.modelName,
    modelId: invocation.modelId,
    thinking: invocation.thinking,
    requestedThinking: invocation.requestedThinking,
    requestedModel: invocation.requestedModel
  };
}
function toSpawnResult(record) {
  const tokens = getLifetimeTotal(record.lifetimeUsage);
  const outputTokens = record.lifetimeUsage?.output ?? 0;
  const cwd = childCwd(record);
  const common = {
    ...tokens > 0 ? { tokens } : {},
    ...outputTokens > 0 ? { outputTokens } : {},
    ...record.toolUses > 0 ? { toolCalls: record.toolUses } : {},
    ...cwd !== undefined ? { cwd } : {}
  };
  if (succeeded(record)) {
    return {
      ...common,
      ok: true,
      text: record.structuredJson ?? record.result ?? "",
      ...record.structuredRetried ? { structuredRetried: true } : {}
    };
  }
  if (record.status === "stopped") {
    return { ...common, ok: false, skipped: true, error: record.error ?? "Stopped." };
  }
  return { ...common, ok: false, error: record.error ?? `Agent ${record.status}.` };
}
var GATE_SHELL = process.platform === "win32" ? ["cmd", "/c"] : ["sh", "-c"];
function createWorkflowHost(deps) {
  const { pi, ctx, manager } = deps;
  const records = new Map;
  const settled = new Map;
  const remember = (record) => {
    settled.set(record.id, {
      type: record.type,
      description: record.description,
      sessionFile: record.sessionFile,
      worktreeLost: worktreeLost(record)
    });
  };
  const warnedScopeMessages = new Set;
  async function executeGate(command, cwd) {
    const result = await pi.exec(GATE_SHELL[0], [GATE_SHELL[1], command], {
      cwd,
      timeout: deps.gateTimeoutMs ?? DEFAULT_GATE_TIMEOUT_MS,
      ...deps.signal !== undefined ? { signal: deps.signal } : {}
    });
    const output = [result.stdout, result.stderr].map((stream) => stream.trim()).filter(Boolean).join(`
`);
    if (result.killed) {
      return { ok: false, output: output || `Gate command timed out: ${command}` };
    }
    return { ok: result.code === 0, output };
  }
  async function reopenAgent(id, prompt, onResolved) {
    const kept = settled.get(id);
    if (kept === undefined)
      return { ok: false, error: `Agent ${id} cannot be resumed — it never finished a run to resume from.` };
    const reopen = reopenTarget(kept.type, kept.sessionFile, kept.worktreeLost);
    if (!reopen.ok)
      return { ok: false, error: `Agent ${id} cannot be resumed — ${reopen.reason}.` };
    const config = getAgentConfig(reopen.type);
    try {
      const { record } = await manager.spawnAndWait(pi, ctx, reopen.type, prompt, {
        description: kept.description,
        resumeSessionFile: reopen.sessionFile,
        reclaim: { id },
        ...config?.isolated !== undefined ? { isolated: config.isolated } : {},
        ...deps.workflowId !== undefined ? { workflowId: deps.workflowId } : {},
        ...deps.signal !== undefined ? { signal: deps.signal } : {},
        ...deps.rootSessionId !== undefined ? { rootSessionId: deps.rootSessionId } : {}
      }, () => onResolved?.({ recordId: id }));
      remember(record);
      const info = resolvedInfo(record);
      if (info !== undefined)
        onResolved?.(info);
      return toSpawnResult(record);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return {
    async spawnAgent(request) {
      const dispatch = resolveSpawnType(request.agentType);
      if (!dispatch.ok)
        return { ok: false, error: dispatch.message };
      let model = ctx.model;
      const config = getAgentConfig(dispatch.type);
      const modelInput = request.model ?? config?.model;
      if (modelInput !== undefined) {
        const resolved2 = resolveModel(modelInput, ctx.modelRegistry, ctx.model);
        if (typeof resolved2 === "string") {
          if (request.model !== undefined)
            return { ok: false, error: resolved2 };
        } else {
          model = resolved2;
        }
      }
      const scopeVerdict = checkModelScope({
        model,
        cwd: ctx.cwd,
        modelRegistry: ctx.modelRegistry,
        callerSupplied: request.model !== undefined,
        agentLabel: config?.displayName ?? dispatch.type,
        modelInput
      });
      if (scopeVerdict.kind === "error")
        return { ok: false, error: scopeVerdict.message };
      if (scopeVerdict.kind === "warn" && !warnedScopeMessages.has(scopeVerdict.message)) {
        warnedScopeMessages.add(scopeVerdict.message);
        ctx.ui.notify(scopeVerdict.message, "warning");
      }
      let gate;
      let spawnedId;
      let sessionReady = false;
      const reportResolved = () => {
        if (!sessionReady || spawnedId === undefined)
          return;
        const info = resolvedInfo(manager.getRecord(spawnedId));
        if (info !== undefined)
          request.onResolved?.(info);
      };
      const command = request.gate;
      const onBeforeWorktreeCleanup = command === undefined ? undefined : async (worktreePath) => {
        if (spawnedId === undefined || !succeeded(manager.getRecord(spawnedId)))
          return;
        try {
          gate = await executeGate(command, worktreePath);
        } catch (error) {
          gate = { ok: false, output: error instanceof Error ? error.message : String(error) };
        }
      };
      try {
        const { record } = await manager.spawnAndWait(pi, ctx, dispatch.type, request.prompt, {
          description: request.label,
          ...config?.isolated !== undefined ? { isolated: config.isolated } : {},
          ...deps.workflowId !== undefined ? { workflowId: deps.workflowId } : {},
          ...model !== undefined ? { model } : {},
          ...request.effort !== undefined ? { thinkingLevel: request.effort } : {},
          invocation: {
            ...request.effort !== undefined ? { thinking: request.effort } : {}
          },
          onSessionCreated: () => {
            sessionReady = true;
            reportResolved();
          },
          ...request.schema !== undefined ? { structuredOutput: request.schema } : {},
          ...request.isolation !== undefined ? { isolation: request.isolation } : {},
          ...deps.signal !== undefined ? { signal: deps.signal } : {},
          ...deps.rootSessionId !== undefined ? { rootSessionId: deps.rootSessionId } : {},
          ...onBeforeWorktreeCleanup !== undefined ? { onBeforeWorktreeCleanup } : {}
        }, (id) => {
          spawnedId = id;
          records.set(request.agentId, id);
          request.onResolved?.({ recordId: id });
          reportResolved();
        });
        remember(record);
        return { ...toSpawnResult(record), ...gate !== undefined ? { gate } : {} };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    abortAgent(agentId) {
      const id = records.get(agentId);
      if (id !== undefined)
        manager.abort(id);
    },
    async resumeAgent(agentId, prompt, onResolved) {
      const id = records.get(agentId);
      if (id === undefined) {
        return { ok: false, error: `Cannot resume "${agentId}" — it never started.` };
      }
      const record = await manager.resume(id, prompt, deps.signal);
      if (record === undefined)
        return reopenAgent(id, prompt, onResolved);
      onResolved?.({ recordId: id });
      const info = resolvedInfo(record);
      if (info !== undefined)
        onResolved?.(info);
      return toSpawnResult(record);
    },
    loadWorkflow(ref) {
      return resolveWorkflowSource(ref, ctx.cwd);
    },
    async runGate(command, gate) {
      return await executeGate(command, gate.cwd ?? ctx.cwd);
    }
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/workflow/tool-description.ts
var fullWorkflowToolDescription = `Execute a workflow script that orchestrates multiple subagents deterministically. Workflows run in the background — this tool returns immediately with a task ID, and you are notified when the workflow completes. Use /agents → Workflows to watch live progress.

A workflow structures work across many agents — to be comprehensive (decompose and cover in parallel), to be confident (independent perspectives and adversarial checks before committing), or to take on scale one context can't hold (migrations, audits, broad sweeps). The script is where you encode that structure: what fans out, what verifies, what synthesizes.

ONLY call this tool when the user has explicitly opted into multi-agent orchestration. Workflows can spawn dozens of agents and consume a large amount of tokens; the user must request that scale, not have it inferred. Explicit opt-in means one of:
- The user directly asked you to run a workflow or use multi-agent orchestration in their own words ("use a workflow", "run a workflow", "fan out agents", "orchestrate this with subagents"). The ask must be in the user's words — a task that would merely benefit from a workflow does not count.
- The user invoked a skill or slash command whose instructions tell you to call SubagentWorkflow.
- The user asked you to run a specific named or saved workflow.

For any other task — even one that would clearly benefit from parallelism — do NOT call this tool. Use the Agent tool for individual subagents, or briefly describe what a multi-agent workflow could do and how much it would roughly cost, and ask the user whether to run it. Mention they can ask for one with "use a workflow" in a future message to skip the ask.

When you do call it, the right move is often **hybrid**: scout inline first (list the files, find the channels, scope the diff) to discover the work-list, then call SubagentWorkflow to pipeline over it. You don't need to know the shape before the *task* — only before the *orchestration step*.

Common single-phase workflows you can chain across turns:
- **Understand** — parallel readers over relevant subsystems → structured map
- **Design** — judge panel of N independent approaches → scored synthesis
- **Review** — dimensions → find → adversarially verify (example below)
- **Research** — multi-modal sweep → deep-read → synthesize
- **Migrate** — discover sites → transform each (worktree isolation) → verify

For larger work, run several in sequence — read each result before deciding the next phase. You stay in the loop; each workflow is one well-scoped fan-out.

Pass the script inline via \`script\` — do not Write it to a file first. Every invocation automatically persists its script to a file under the session directory and returns the path in the tool result. To iterate on a workflow, edit that file with Write/Edit and re-invoke SubagentWorkflow with \`{scriptPath: "<path>"}\` instead of resending the full script. A script you will run more than once belongs in \`.pi/workflows/<name>.js\` (or \`.agents/workflows/\`, or \`<agent dir>/workflows/\` for one that follows the user everywhere); call it with \`name: "<name>"\` instead of re-sending the source.

Every script must begin with \`export const meta = {...}\`:
  export const meta = {
    name: 'find-flaky-tests',
    description: 'Find flaky tests and propose fixes',   // one-line, shown in permission dialog
    phases: [                                            // one entry per phase() call
      { title: 'Scan', detail: 'grep test logs for retries' },
      { title: 'Fix', detail: 'one agent per flaky test' },
    ],
  }
  // script body starts here — use agent()/parallel()/pipeline()/phase()/log()
  phase('Scan')
  const flaky = await agent('grep CI logs for retry markers', {schema: FLAKY_SCHEMA})
  ...

The \`meta\` object must be a PURE LITERAL — no variables, function calls, spreads, or template interpolation. Required fields: \`name\`, \`description\`. Optional: \`whenToUse\` (shown in the workflow list), \`phases\`. Use the SAME phase titles in meta.phases as in phase() calls — titles are matched exactly; a phase() call with no matching meta entry just gets its own progress group. Add \`model\` to a phase entry when that phase uses a specific model override.

Script body hooks:
- agent(prompt: string, opts?: {label?: string, phase?: string, schema?: object, model?: string, effort?: string, isolation?: 'worktree', agentType?: string, gate?: string, resume?: string}): Promise<any> — spawn a subagent. Without schema, returns its final text as a string. With schema (a JSON Schema), the subagent is given a StructuredOutput tool built from it and agent() returns the validated object — no parsing needed. A payload that does not match is rejected back to the child, which corrects it; a child that never answers through the tool gets one more prompt and then fails, so the call returns null — filter after every schema stage. Returns null if the user skips the agent mid-run or the subagent dies on a terminal API error after retries (filter with .filter(Boolean)). opts.label overrides the display label. opts.phase explicitly assigns this agent to a progress group (use this inside pipeline()/parallel() stages to avoid races on the global phase() state — same phase string → same group box). opts.model overrides the model for this agent call. Default to omitting it — the agent inherits the main-loop model (the resolved session model), which is almost always correct. Only set it when you're highly confident a different tier fits the task; when unsure, omit. opts.effort overrides the reasoning effort for this agent call ('minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') — omit to inherit the agent definition's own level, then the parent's; use 'low' for cheap mechanical stages and higher tiers only for the hardest verify/judge stages. opts.isolation: 'worktree' runs the agent in a fresh git worktree — EXPENSIVE (setup time + disk per agent), use ONLY when agents mutate files in parallel and would otherwise conflict; the worktree is removed when the agent settles, its changes preserved on a branch. opts.gate: '<command>' runs a shell command after the agent finishes and requires it to pass — a non-zero exit marks the agent failed and the command's output becomes the error; prefer gate: 'npm test' over asking another agent whether the code looks right. opts.resume: '<label>' continues the child that ran under that label instead of starting fresh, so an iterative loop keeps its context — it cannot be combined with agentType, model, effort, isolation, gate or schema. opts.agentType uses a custom subagent type instead of the default workflow subagent — resolved from the same registry as the Agent tool; composes with schema. Available types:
{{typeList}}
- pipeline(items, stage1, stage2, ...): Promise<any[]> — run each item through all stages independently, NO barrier between stages. Item A can be in stage 3 while item B is still in stage 1. This is the DEFAULT for multi-stage work. Wall-clock = slowest single-item chain, not sum-of-slowest-per-stage. Every stage callback receives (prevResult, originalItem, index) — use originalItem/index in later stages to label work without threading context through stage 1's return value. A stage that throws drops that item to \`null\` and skips its remaining stages.
- parallel(thunks: Array<() => Promise<any>>): Promise<any[]> — run tasks concurrently. This is a BARRIER: awaits all thunks before returning. A thunk that throws (or whose agent errors) resolves to \`null\` in the result array, so \`.filter(Boolean)\` before using the results; only a fatal run error — a cap breach, or a nested workflow that could not load — propagates instead of being folded into a null. Use ONLY when you genuinely need all results together.
- log(message: string): void — emit a progress message to the user (shown as a narrator line above the progress tree)
- phase(title: string): void — start a new phase; subsequent agent() calls are grouped under this title in the progress display
- args: any — the value passed as SubagentWorkflow's \`args\` input, verbatim (undefined if not provided). Pass arrays/objects as actual JSON values in the tool call, NOT as a JSON-encoded string — \`args: ["a.ts", "b.ts"]\`, not \`args: "[\\"a.ts\\", ...]"\` (a stringified list reaches the script as one string, so \`args.filter\`/\`args.map\` throw). Use this to parameterize named workflows — e.g. pass a research question, target path, or config object directly instead of via a side-channel file.
- budget: {total: number|null, spent(): number, remaining(): number} — \`budget.total\` is always null here: it comes from a token-target directive pi does not have, so guards like \`while (budget.total && budget.remaining() > 50_000) { ... }\` correctly do not fire rather than throwing on a missing global. \`budget.spent()\` returns output tokens spent by this run's agents. \`budget.remaining()\` returns \`Infinity\` with no target.
- workflow(nameOrRef: string | {scriptPath: string}, args?: any): Promise<any> — run another workflow inline as a sub-step and return whatever it returns. Pass a name to invoke a saved workflow (same registry as {name: "..."}), or {scriptPath} to run a script file you Wrote earlier. The child shares this run's concurrency cap, agent counter, abort signal, and token budget — its agents appear under a "▸ name" group in /agents → Workflows and its tokens count toward budget.spent(). The args param becomes the child's \`args\` global. Nesting is one level only: workflow() inside a child throws. Throws on unknown name / unreadable scriptPath / child syntax error; catch to handle gracefully.

Any agent() option not listed above is rejected by name at the call.

Subagents are told their final text IS the return value (not a human-facing message), so they return raw data. For structured output, use the schema option — validation happens at the tool-call layer so the model retries on mismatch.

Scripts are plain JavaScript, NOT TypeScript — type annotations (\`: string[]\`), interfaces, and generics fail to parse. The script body runs in an async context — use await directly. Standard JS built-ins (JSON, Math, Array, etc.) are available — EXCEPT \`Date.now()\`/\`Math.random()\`/argless \`new Date()\`, which throw (they would break resume); pass timestamps in via \`args\`, stamp results after the workflow returns, and for randomness vary the agent prompt/label by index. \`eval\` and \`Function(...)\` throw. No filesystem or Node.js API access.

DEFAULT TO pipeline(). Only reach for a barrier (parallel between stages) when you genuinely need ALL prior-stage results together.

A barrier is correct ONLY when stage N needs cross-item context from all of stage N-1:
- Dedup/merge across the full result set before expensive downstream work
- Early-exit if the total count is zero ("0 bugs found → skip verification entirely")
- Stage N's prompt references "the other findings" for comparison

A barrier is NOT justified by:
- "I need to flatten/map/filter first" — do it inside a pipeline stage: pipeline(items, stageA, r => transform([r]).flat(), stageB)
- "The stages are conceptually separate" — that's what pipeline() models. Separate stages ≠ synchronized stages.
- "It's cleaner code" — barrier latency is real. If 5 finders run and the slowest takes 3× the fastest, a barrier wastes 2/3 of the fast finders' idle time.

Smell test: if you wrote
  const a = await parallel(...)
  const b = transform(a)        // flatten, map, filter — no cross-item dependency
  const c = await parallel(b.map(...))
that middle transform doesn't need the barrier. Rewrite as a pipeline with the transform inside a stage. When in doubt: pipeline.

Concurrent agent() calls are capped at min(16, available CPUs - 2) per workflow — excess calls queue and run as slots free up. You can still pass 100 items to parallel()/pipeline() and they all complete; only ~10 run at any moment. Total agent count across a workflow's lifetime is capped at 1000 — a runaway-loop backstop set far above any real workflow. A single parallel()/pipeline() call accepts at most 4096 items; passing more is an explicit error, not a silent truncation.

The canonical multi-stage pattern — pipeline by default, each dimension verifies as soon as its review completes:
  export const meta = {
    name: 'review-changes',
    description: 'Review changed files across dimensions, verify each finding',
    phases: [{ title: 'Review' }, { title: 'Verify' }],
  }
  const DIMENSIONS = [{key: 'bugs', prompt: '...'}, {key: 'perf', prompt: '...'}]
  const results = await pipeline(
    DIMENSIONS,
    d => agent(d.prompt, {label: \`review:\${d.key}\`, phase: 'Review', schema: FINDINGS_SCHEMA}),
    review => parallel(review.findings.map(f => () =>
      agent(\`Adversarially verify: \${f.title}\`, {label: \`verify:\${f.file}\`, phase: 'Verify', schema: VERDICT_SCHEMA})
        .then(v => ({...f, verdict: v}))
    ))
  )
  const confirmed = results.flat().filter(Boolean).filter(f => f.verdict?.isReal)
  return { confirmed }
  // Dimension 'bugs' findings verify while dimension 'perf' is still reviewing. No wasted wall-clock.

When a barrier IS correct — dedup across all findings before expensive verification:
  const all = await parallel(DIMENSIONS.map(d => () => agent(d.prompt, {schema: FINDINGS_SCHEMA})))
  const deduped = dedupeByFileAndLine(all.filter(Boolean).flatMap(r => r.findings))  // <-- genuinely needs ALL at once
  const verified = await parallel(deduped.map(f => () => agent(verifyPrompt(f), {schema: VERDICT_SCHEMA})))

Loop-until-count pattern — accumulate to a target:
  const bugs = []
  while (bugs.length < 10) {
    const result = await agent("Find bugs in this codebase.", {schema: BUGS_SCHEMA})
    bugs.push(...result.bugs)
    log(\`\${bugs.length}/10 found\`)
  }

Gate-and-retry pattern — verify by running, and keep the agent's context across attempts:
  let fixed = await agent('Find and fix the failing test.', {label: 'fix', gate: 'npm test'})
  if (fixed === null) {                        // a non-zero exit failed the agent
    // Resume keeps everything the child already learned. It cannot carry the
    // gate, so re-verification needs its own gated call, in the same tree.
    fixed = await agent('\`npm test\` is still failing. Fix the cause.', {label: 'fix', resume: 'fix'})
    const verified = await agent('Run \`npm test\` and report the result. Change nothing.',
      {label: 'verify', phase: 'Verify', gate: 'npm test', effort: 'low'})
    return { passed: verified !== null, summary: fixed }
  }
  return { passed: true, summary: fixed }
  // An LLM judging whether a fix works is a weaker signal than the test suite.

Composing patterns — exhaustive review (find → dedup vs seen → diverse-lens panel → loop-until-dry):
  const seen = new Set(), confirmed = []
  let dry = 0
  while (dry < 2) {                                              // loop-until-dry
    const found = (await parallel(FINDERS.map(f => () =>          // barrier: collect all finders this round
      agent(f.prompt, {phase: 'Find', schema: BUGS})))).filter(Boolean).flatMap(r => r.bugs)
    const fresh = found.filter(b => !seen.has(key(b)))           // dedup vs ALL seen — plain code, not an agent
    if (!fresh.length) { dry++; continue }
    dry = 0; fresh.forEach(b => seen.add(key(b)))
    const judged = await parallel(fresh.map(b => () =>           // every fresh bug judged concurrently...
      parallel(['correctness','security','repro'].map(lens => () =>   // ...each by 3 distinct lenses
        agent(\`Judge "\${b.desc}" via the \${lens} lens — real?\`, {phase: 'Verify', schema: VERDICT})))
        .then(vs => ({ b, real: vs.filter(Boolean).filter(v => v.real).length >= 2 }))))
    confirmed.push(...judged.filter(v => v.real).map(v => v.b))
  }
  return confirmed
  // dedup vs \`seen\`, NOT \`confirmed\` — else judge-rejected findings reappear every round and it never converges.

Quality patterns — common shapes; pick by task and compose freely:
- Adversarial verify: spawn N independent skeptics per finding, each prompted to REFUTE. Kill if ≥majority refute. Prevents plausible-but-wrong findings from surviving.
    const votes = await parallel(Array.from({length: 3}, () => () =>
      agent(\`Try to refute: \${claim}. Default to refuted=true if uncertain.\`, {schema: VERDICT})))
    const survives = votes.filter(Boolean).filter(v => !v.refuted).length >= 2
- Verify by running, not by asking: when a claim is testable, \`gate\` it rather than asking another model whether it holds.
- Perspective-diverse verify: when a finding can fail in more than one way, give each verifier a distinct lens (correctness, security, perf, does-it-reproduce) instead of N identical refuters — diversity catches failure modes redundancy can't.
- Judge panel: generate N independent attempts from different angles (e.g. MVP-first, risk-first, user-first), score with parallel judges, synthesize from the winner while grafting the best ideas from runners-up. Beats one-attempt-iterated when the solution space is wide.
- Loop-until-dry: for unknown-size discovery (bugs, issues, edge cases), keep spawning finders until K consecutive rounds return nothing new. Simple counters (while count < N) miss the tail.
- Multi-modal sweep: parallel agents each searching a different way (by-container, by-content, by-entity, by-time). Each is blind to what the others surface; useful when one search angle won't find everything.
- Completeness critic: a final agent that asks "what's missing — modality not run, claim unverified, source unread?" What it finds becomes the next round of work.
- No silent caps: if a workflow bounds coverage (top-N, no-retry, sampling), \`log()\` what was dropped — silent truncation reads as "covered everything" when it didn't.

Scale to what the user asked for. "find any bugs" → a few finders, single-vote verify. "thoroughly audit this" or "be comprehensive" → larger finder pool, 3–5 vote adversarial pass, synthesis stage. When unsure, lean toward thoroughness for research/review/audit requests and toward brevity for quick checks.

These patterns aren't exhaustive — compose novel harnesses when the task calls for it (tournament brackets, self-repair loops, staged escalation, whatever fits).

Use this tool for multi-step orchestration where control flow should be deterministic (loops, conditionals, fan-out) rather than model-driven.

## Resume

The tool result includes a runId. To resume after a pause, kill, or script edit, relaunch with SubagentWorkflow({scriptPath, resumeFromRunId}) — the longest unchanged prefix of agent() calls returns cached results instantly; the first edited/new call and everything after it runs live. Same script + same args → 100% cache hit. It is a prefix and not a lookup: a later call that still matches is not reused once an earlier one has changed. A journaled failure ends the prefix, so resuming a run that died at agent 5 retries exactly agent 5. Same session only, and the run must have finished — stop it from /agents → Workflows first. Before diagnosing why a completed workflow returned an empty or unexpected result, Read the run's \`<run id>.workflow.jsonl\` beside its script — it records each agent's actual return value; do not assume cached results are non-empty. Date.now()/Math.random()/new Date() are unavailable in scripts (they would break this) — stamp results after the workflow returns, or pass timestamps via args.`;

// dotfiles/stow_modules/main/dot-pi/agent/extensions/subagent/index.ts
init_worktree();
function textResult2(msg, details) {
  return { content: [{ type: "text", text: msg }], details };
}
function renderRunningAgentStatus(frame, statsText, activity, theme) {
  const container = new Container;
  container.addChild(new Text2(theme.fg("accent", frame) + (statsText ? " " + statsText : ""), 0, 0));
  container.addChild(new Text2(theme.fg("dim", `  ⎿  ${activity}`), 0, 0));
  return container;
}
var BACKGROUND_HINT_DELAY_MS = 2000;
function formatLifetimeTokens(o) {
  const t = getLifetimeTotal(o.lifetimeUsage);
  return t > 0 ? formatTokens(t) : "";
}
function createActivityTracker(maxTurns, onStreamUpdate) {
  const state = {
    activeTools: new Map,
    toolUses: 0,
    turnCount: 1,
    maxTurns,
    responseText: "",
    session: undefined
  };
  const callbacks = {
    onToolActivity: (activity) => {
      if (activity.type === "start") {
        state.activeTools.set(activity.toolName + "_" + Date.now(), activity.toolName);
      } else {
        for (const [key, name] of state.activeTools) {
          if (name === activity.toolName) {
            state.activeTools.delete(key);
            break;
          }
        }
        state.toolUses++;
      }
      onStreamUpdate?.();
    },
    onTextDelta: (_delta, fullText) => {
      state.responseText = fullText;
      onStreamUpdate?.();
    },
    onTurnEnd: (turnCount) => {
      state.turnCount = turnCount;
      onStreamUpdate?.();
    },
    onSessionCreated: (session) => {
      state.session = session;
    },
    onAssistantUsage: (_usage) => {
      onStreamUpdate?.();
    }
  };
  return { state, callbacks };
}
var THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
function getStatusLabel(status, error) {
  switch (status) {
    case "error":
      return `Error: ${error ?? "unknown"}`;
    case "aborted":
      return "Aborted (max turns exceeded)";
    case "steered":
      return "Wrapped up (turn limit)";
    case "stopped":
      return "Stopped";
    default:
      return "Done";
  }
}
function formatTaskNotification(record, resultMaxLen, showCost = false) {
  const status = getStatusLabel(record.status, record.error);
  const durationMs = record.completedAt ? record.completedAt - record.startedAt : 0;
  const totalTokens = getLifetimeTotal(record.lifetimeUsage);
  const contextPercent = getSessionContextPercent(record.session);
  const ctxXml = contextPercent !== null ? `<context_percent>${Math.round(contextPercent)}</context_percent>` : "";
  const compactXml = record.compactionCount ? `<compactions>${record.compactionCount}</compactions>` : "";
  const cost = showCost ? getLifetimeCost(record.lifetimeUsage) : 0;
  const costXml = cost > 0 ? `<estimated_cost_usd>${cost.toFixed(4)}</estimated_cost_usd>` : "";
  const resultPreview = record.result ? record.result.length > resultMaxLen ? record.result.slice(0, resultMaxLen) + `
...(truncated, use get_subagent_result for full output)` : record.result : "No output.";
  return [
    `<task-notification>`,
    `<task-id>${record.id}</task-id>`,
    record.toolCallId ? `<tool-use-id>${escapeXml(record.toolCallId)}</tool-use-id>` : null,
    record.outputFile ? `<output-file>${escapeXml(record.outputFile)}</output-file>` : null,
    `<status>${escapeXml(status)}</status>`,
    `<summary>Agent "${escapeXml(record.description)}" ${record.status}${getStatusNote(record.status)}</summary>`,
    `<result>${escapeXml(resultPreview)}</result>`,
    `<usage><total_tokens>${totalTokens}</total_tokens><tool_uses>${record.toolUses}</tool_uses>${ctxXml}${compactXml}${costXml}<duration_ms>${durationMs}</duration_ms></usage>`,
    `</task-notification>`
  ].filter(Boolean).join(`
`);
}
function buildDetails(base, record, activity, overrides) {
  return {
    ...base,
    toolUses: record.toolUses,
    tokens: formatLifetimeTokens(record),
    cost: getLifetimeCost(record.lifetimeUsage),
    turnCount: activity?.turnCount,
    maxTurns: activity?.maxTurns,
    durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
    status: record.status,
    agentId: record.id,
    error: record.error,
    ...overrides
  };
}
function buildNotificationDetails(record, resultMaxLen, activity) {
  const totalTokens = getLifetimeTotal(record.lifetimeUsage);
  return {
    id: record.id,
    description: record.description,
    status: record.status,
    toolUses: record.toolUses,
    turnCount: activity?.turnCount ?? 0,
    maxTurns: activity?.maxTurns,
    totalTokens,
    totalCost: getLifetimeCost(record.lifetimeUsage),
    durationMs: record.completedAt ? record.completedAt - record.startedAt : 0,
    outputFile: record.outputFile,
    error: record.error,
    resultPreview: record.result ? record.result.length > resultMaxLen ? record.result.slice(0, resultMaxLen) + "…" : record.result : "No output."
  };
}
function formatToolsSuffix(cfg) {
  const tools = cfg?.builtinToolNames;
  if (!tools)
    return "*";
  if (tools.length === 0) {
    const noExtensionTools = cfg?.isolated === true || cfg?.extensions === false;
    return noExtensionTools ? "none" : "no built-ins, extension tools only";
  }
  const isFullSet = tools.length === BUILTIN_TOOL_NAMES.length && BUILTIN_TOOL_NAMES.every((t) => tools.includes(t));
  return isFullSet ? "*" : tools.join(", ");
}
var WORKFLOW_FILE_FLAG = "subagents-workflow-file";
function subagent_default(pi) {
  if (inChildSessionContext())
    return;
  pi.registerMessageRenderer("subagent-notification", (message, { expanded }, theme) => {
    const d = message.details;
    if (!d)
      return;
    function renderOne(d2) {
      const isError = d2.status === "error" || d2.status === "stopped" || d2.status === "aborted";
      const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
      const statusText = isError ? d2.status : d2.status === "steered" ? "completed (steered)" : "completed";
      let line = `${icon} ${theme.bold(d2.description)} ${theme.fg("dim", statusText)}`;
      const parts = [];
      if (d2.turnCount > 0)
        parts.push(formatTurns(d2.turnCount, d2.maxTurns));
      if (d2.toolUses > 0)
        parts.push(`${d2.toolUses} tool use${d2.toolUses === 1 ? "" : "s"}`);
      if (d2.totalTokens > 0)
        parts.push(formatTokens(d2.totalTokens));
      if (showCost) {
        const costText = formatCost(d2.totalCost ?? 0);
        if (costText)
          parts.push(costText);
      }
      if (d2.durationMs > 0)
        parts.push(formatMs(d2.durationMs));
      if (parts.length) {
        line += `
  ` + parts.map((p2) => theme.fg("dim", p2)).join(" " + theme.fg("dim", "·") + " ");
      }
      if (expanded) {
        const lines = d2.resultPreview.split(`
`).slice(0, 30);
        for (const l of lines)
          line += `
` + theme.fg("dim", `  ${l}`);
      } else {
        const preview2 = d2.resultPreview.split(`
`)[0]?.slice(0, 80) ?? "";
        line += `
  ` + theme.fg("dim", `⎿  ${preview2}`);
      }
      if (d2.outputFile) {
        line += `
  ` + theme.fg("muted", `transcript: ${d2.outputFile}`);
      }
      return line;
    }
    const all = [d, ...d.others ?? []];
    const rendered = all.map(renderOne);
    if (showCost && all.length > 1) {
      const total = formatCost(all.reduce((sum, a) => sum + (a.totalCost ?? 0), 0));
      if (total) {
        const tokens = all.reduce((sum, a) => sum + a.totalTokens, 0);
        rendered.unshift(theme.fg("dim", `${all.length} agents · ${formatTokens(tokens)} · ${total}`));
      }
    }
    return new Text2(rendered.join(`
`), 0, 0);
  });
  pi.registerEntryRenderer(WORKFLOW_ENTRY_TYPE, (entry, _options, theme) => renderWorkflowEntryCard(entry.data, theme));
  pi.registerFlag(WORKFLOW_FILE_FLAG, {
    type: "string",
    description: `Run a workflow script at startup: --${WORKFLOW_FILE_FLAG}=<path>. ` + "Use the `=` form — the space form consumes the next argument, which would swallow a following prompt."
  });
  const bootSettings = loadSettings(process.cwd());
  let strictAgentFiles = bootSettings.strictAgentFiles === true;
  setPackageAgentsGate(bootSettings.packageAgents);
  setPackageWorkflowsGate(bootSettings.packageWorkflows);
  seedProjectTrust(process.cwd());
  const reloadCustomAgents = (strict = false) => {
    const userAgents = loadCustomAgents(process.cwd(), strict);
    registerAgents(userAgents);
  };
  reloadCustomAgents(strictAgentFiles);
  const agentActivity = new Map;
  let reportUsage = false;
  function isReportUsageEnabled() {
    return reportUsage;
  }
  function setReportUsage(b2) {
    reportUsage = b2;
    if (!b2)
      pendingUsage.drain();
  }
  let showCost = false;
  function isShowCostEnabled() {
    return showCost;
  }
  function setShowCost(b2) {
    showCost = b2;
    widget.update();
    fleet.update();
  }
  let showModel = false;
  function isShowModelEnabled() {
    return showModel;
  }
  function setShowModel(b2) {
    showModel = b2;
    widget.update();
  }
  let viewerMarkdown = "assistant";
  function getViewerMarkdown() {
    return viewerMarkdown;
  }
  function setViewerMarkdown(mode) {
    viewerMarkdown = mode;
  }
  function chooseViewerMarkdown(mode, ctx) {
    setViewerMarkdown(mode);
    persistSettings(ctx, `Viewer markdown set to ${mode}`);
  }
  const pendingUsage = new PendingUsagePool;
  const outbox = new CompletionOutbox((message) => pi.sendMessage({
    customType: "subagent-notification",
    content: message.content,
    display: true,
    details: message.details
  }, { deliverAs: "steer", triggerTurn: true }), () => currentCtx?.signal !== undefined);
  const QUEUE_WAIT_POLL_MS = Math.floor(NOTIFICATION_HOLD_MS / 4);
  function sendIndividualNudge(record) {
    agentActivity.delete(record.id);
    widget.markFinished(record.id);
    fleet.onAgentFinished(record.id);
    try {
      const footer = record.outputFile ? `
Full transcript available at: ${record.outputFile}` : "";
      const message = {
        content: formatTaskNotification(record, 500, showCost) + footer,
        details: buildNotificationDetails(record, 500, agentActivity.get(record.id))
      };
      outbox.add({ ids: [record.id], build: () => message });
    } catch {}
    widget.update();
  }
  const groupJoin = new GroupJoinManager((records, partial) => {
    for (const r of records) {
      agentActivity.delete(r.id);
      widget.markFinished(r.id);
      fleet.onAgentFinished(r.id);
    }
    const members = records.filter((r) => !r.resultConsumed).flatMap((r) => {
      try {
        return [{ id: r.id, text: formatTaskNotification(r, 300, showCost), details: buildNotificationDetails(r, 300, agentActivity.get(r.id)) }];
      } catch {
        return [];
      }
    });
    if (members.length > 0) {
      outbox.add({
        ids: members.map((m2) => m2.id),
        build: (ids) => {
          const unread = members.filter((m2) => ids.includes(m2.id));
          const notifications = unread.map((m2) => m2.text).join(`

`);
          const label = partial ? `${unread.length} agent(s) finished (partial — others still running)` : `${unread.length} agent(s) finished`;
          const [first, ...rest] = unread;
          const details = first.details;
          if (rest.length > 0)
            details.others = rest.map((m2) => m2.details);
          return {
            content: `Background agent group completed: ${label}

${notifications}

Use get_subagent_result for full output.`,
            details
          };
        }
      });
    }
    widget.update();
  }, 30000);
  function buildEventData(record) {
    const durationMs = record.completedAt ? record.completedAt - record.startedAt : Date.now() - record.startedAt;
    const u = record.lifetimeUsage;
    const total = getLifetimeTotal(u);
    const tokens = total > 0 ? { input: u.input, output: u.output, total } : undefined;
    const usage = toReportedUsage(u);
    return {
      id: record.id,
      type: record.type,
      description: record.description,
      result: record.result,
      error: record.error,
      status: record.status,
      toolUses: record.toolUses,
      durationMs,
      tokens,
      usage
    };
  }
  const manager = new AgentManager((record) => {
    if (!isTopLevelAgent(record))
      return;
    const isError = record.status === "error" || record.status === "stopped" || record.status === "aborted";
    const eventData = buildEventData(record);
    if (isError) {
      pi.events.emit("subagents:failed", eventData);
    } else {
      pi.events.emit("subagents:completed", eventData);
    }
    pi.appendEntry(AGENT_RECORD_ENTRY_TYPE, agentRecordEntryData(record));
    if (record.resultConsumed) {
      agentActivity.delete(record.id);
      widget.markFinished(record.id);
      fleet.onAgentFinished(record.id);
      widget.update();
      return;
    }
    if (turnGroupSpawns.includes(record.id)) {
      widget.update();
      return;
    }
    const result = groupJoin.onAgentComplete(record);
    if (result === "pass") {
      sendIndividualNudge(record);
    }
    widget.update();
  }, undefined, (record) => {
    if (!isTopLevelAgent(record))
      return;
    if (currentCtx?.hasUI) {
      widget.ensureTimer();
      widget.update();
      fleet.ensureTimer();
      fleet.update();
    }
    pi.events.emit("subagents:started", {
      id: record.id,
      type: record.type,
      description: record.description
    });
  }, (record, info) => {
    if (!isTopLevelAgent(record))
      return;
    pi.events.emit("subagents:compacted", {
      id: record.id,
      type: record.type,
      description: record.description,
      reason: info.reason,
      tokensBefore: info.tokensBefore,
      compactionCount: record.compactionCount
    });
  }, (record, usage) => {
    if (reportUsage)
      pendingUsage.add(usage);
    const reported = toReportedUsage(usage);
    if (!reported)
      return;
    const invocation = record.invocation;
    pi.events.emit("subagents:usage", {
      id: record.id,
      type: record.type,
      description: record.description,
      ...invocation?.modelId !== undefined ? { model: invocation.modelId } : {},
      ...invocation?.thinking !== undefined ? { thinking: invocation.thinking } : {},
      ...invocation?.requestedThinking !== undefined ? { requestedThinking: invocation.requestedThinking } : {},
      depth: record.depth ?? 1,
      ...record.parentAgentId !== undefined ? { parentAgentId: record.parentAgentId } : {},
      ...record.workflowId !== undefined ? { workflowId: record.workflowId } : {},
      usage: reported
    });
  }, (record, message) => {
    if (!isTopLevelAgent(record))
      return;
    pi.events.emit("subagents:steered", { id: record.id, message });
  });
  const MANAGER_KEY = Symbol.for("pi-subagents:manager");
  const spawnResolved = (piRef, ctxRef, type, prompt, options) => {
    reloadCustomAgents();
    const dispatch = resolveSpawnType(type);
    if (!dispatch.ok)
      throw new Error(dispatch.message);
    const { state, callbacks } = createActivityTracker(resolveEffectiveMaxTurns(dispatch.type, options?.maxTurns));
    const id = manager.spawn(piRef, ctxRef, dispatch.type, prompt, { ...options, ...callbacks });
    agentActivity.set(id, state);
    return id;
  };
  const spawnTopLevel = (piRef, ctxRef, type, prompt, options) => {
    const safeOptions = { ...options ?? {} };
    delete safeOptions.parentAgentId;
    delete safeOptions.workflowId;
    delete safeOptions.depth;
    delete safeOptions.maxSubagentDepth;
    delete safeOptions.configCwd;
    delete safeOptions.rootSessionId;
    delete safeOptions.resumeSessionFile;
    delete safeOptions.reclaim;
    delete safeOptions.blocking;
    return spawnResolved(piRef, ctxRef, type, prompt, safeOptions);
  };
  const resolveAgentRef = (ref) => {
    const byId = manager.getRecord(ref);
    if (byId)
      return byId;
    const resolved2 = manager.resolveMention(ref);
    return resolved2?.kind === "live" ? resolved2.record : undefined;
  };
  const formatSavedAgentRecord = (saved) => `Agent: ${saved.id}
` + `Type: ${getDisplayName(saved.type)} | Status: ${saved.status}${getStatusNote(saved.status)} | Duration: ${formatDuration(saved.startedAt, saved.completedAt)}
` + `Description: ${saved.description}
` + `(From the session's saved record: the live record has been cleaned up, so its stats and conversation are gone.)

` + (saved.status === "error" ? `Error: ${saved.error}${partialOutputSuffix(saved)}` : saved.result?.trim() || "No output.");
  const registryEntry = {
    waitForAll: () => manager.waitForAll(),
    hasRunning: () => manager.hasRunning(),
    spawn: spawnTopLevel,
    getRecord: (id) => {
      const record = manager.getRecord(id);
      return record !== undefined && isTopLevelAgent(record) ? record : undefined;
    }
  };
  const ownsManagerRegistry = globalThis[MANAGER_KEY] === undefined;
  if (ownsManagerRegistry) {
    globalThis[MANAGER_KEY] = registryEntry;
  }
  let currentCtx;
  let rpcHandle;
  let mentionProviderRegistered = false;
  const scheduler = new SubagentScheduler;
  function startScheduler(ctx) {
    try {
      const sessionId = ctx.sessionManager?.getSessionId?.();
      if (!sessionId)
        return;
      const path = resolveStorePath(ctx.cwd, sessionId);
      const store = new ScheduleStore(path);
      scheduler.start(pi, ctx, manager, store);
      pi.events.emit("subagents:scheduler_ready", { sessionId, jobCount: store.list().length });
    } catch (err) {
      console.warn("[pi-subagents] Failed to start scheduler:", err);
    }
  }
  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
    setProjectTrusted(ctx.isProjectTrusted?.() === true);
    invalidatePackageCache();
    reloadCustomAgents();
    if (ctx.hasUI) {
      widget.setUICtx(ctx.ui);
      fleet.setUICtx(ctx.ui);
      watchHandoffKey(ctx.ui);
    }
    manager.clearCompleted(true);
    if (!rpcHandle) {
      rpcHandle = registerRpcHandlers({
        events: pi.events,
        pi,
        getCtx: () => currentCtx,
        manager: {
          spawn: spawnTopLevel,
          awaitStartup: (id) => manager.awaitStartup(id),
          getRecord: (id) => manager.getRecord(id),
          abort: (id) => manager.abort(id),
          consumeResult: (id) => {
            const record = resolveAgentRef(id);
            if (!record || record.parentAgentId)
              return false;
            if (record.status === "running" || record.status === "queued")
              return false;
            record.resultConsumed = true;
            outbox.cancel(record.id);
            return true;
          },
          steer: (id, message) => manager.steer(id, message)
        }
      });
      pi.events.emit("subagents:ready", {});
    }
    if (isSchedulingEnabled() && !scheduler.isActive())
      startScheduler(ctx);
    if (ctx.mode === "tui" && !mentionProviderRegistered) {
      mentionProviderRegistered = true;
      ctx.ui.addAutocompleteProvider((current) => createMentionProvider(current, () => mentionRoster(manager, mentionTypes(), (type) => getConfig(type).displayName), isAgentMentionsEnabled));
    }
    resolveWorkflowCollisions(ctx);
    runWorkflowFlag(ctx);
  });
  const startMentioned = (ctx, type, message) => {
    reloadCustomAgents();
    return spawnTopLevel(pi, ctx, type, message, {
      description: describeMention(message),
      isBackground: true,
      inheritContext: getAgentConfig(type)?.inheritContext
    });
  };
  const mentionTypes = () => getAvailableTypes().map((name) => ({ name, description: getAgentConfig(name)?.description ?? name }));
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension" || !isAgentMentionsEnabled())
      return { action: "continue" };
    const canDispatchDirectly = ctx.mode === "tui";
    if (!canDispatchDirectly && getAgentMentionMode() !== "model")
      return { action: "continue" };
    const mention = parseMention(event.text);
    if (!mention)
      return { action: "continue" };
    if (isReservedHandle(mention.handle)) {
      return { action: "transform", text: mention.message, ...event.images && { images: event.images } };
    }
    const alias = stripAgentPrefix(mention.handle);
    const resolved2 = manager.resolveMention(mention.handle) ?? (alias ? manager.resolveMention(alias) : undefined);
    if (resolved2 && !canDispatchDirectly)
      return { action: "continue" };
    if (resolved2?.kind === "live") {
      const record = resolved2.record;
      const target = `@${record.alias ?? record.handle ?? mention.handle}`;
      if (record.status === "running" || record.status === "queued") {
        record.resultConsumed = false;
        manager.steer(record.id, mention.message);
        ctx.ui.notify(`Sent to ${target}`, "info");
        return { action: "handled" };
      }
      if (record.session) {
        const resumedRecord = await startBackgroundResume(ctx, record, mention.message, {
          outputTranscript: getAgentConfig(record.type)?.outputTranscript ?? getOutputTranscriptDefault(),
          maxTurns: resumeTurnLimit(record)
        });
        ctx.ui.notify(resumedRecord ? `Resuming ${target}` : `Could not resume ${target} — it is still running.`, resumedRecord ? "info" : "warning");
        return { action: "handled" };
      }
    }
    if (resolved2?.kind === "tombstone") {
      const entry = resolved2.entry;
      const target = `@${entry.alias ?? entry.handle}`;
      reloadCustomAgents();
      const reopen = reopenTarget(entry.type, entry.sessionFile, entry.worktreeLost);
      if (!reopen.ok) {
        if (reopen.gone)
          manager.dropTombstone(entry.handle);
        ctx.ui.notify(`Could not resume ${target} — ${reopen.reason}.`, "warning");
        return { action: "handled" };
      }
      try {
        const id = spawnResolved(pi, ctx, reopen.type, mention.message, {
          description: entry.description,
          reclaim: { handle: entry.handle, alias: entry.alias },
          resumeSessionFile: entry.sessionFile,
          isBackground: true
        });
        await manager.awaitStartup(id);
        ctx.ui.notify(`Resuming ${target}`, "info");
      } catch (err) {
        ctx.ui.notify(`Could not resume ${target}: ${err instanceof Error ? err.message : String(err)}`, "warning");
      }
      return { action: "handled" };
    }
    const typeHandle = mention.handle;
    const type = resolveHandleToType(typeHandle, getAvailableTypes()) ?? (alias ? resolveHandleToType(alias, getAvailableTypes()) : undefined);
    if (!type)
      return { action: "continue" };
    if (getAgentMentionMode() === "model") {
      const label = `@${handleBase(type)}`;
      ctx.ui.notify(`Prompting ${label}…`, "info");
      runMentionClone({ ctx, type, message: mention.message, agentTool: registeredAgentTool }).then(async (result) => {
        if (result.spawned)
          return;
        try {
          const id = startMentioned(ctx, type, mention.message);
          await manager.awaitStartup(id);
          ctx.ui.notify(`Started ${label} directly — ${result.error}`, "warning");
        } catch (err) {
          ctx.ui.notify(`Could not start ${label}: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
      });
      return { action: "handled" };
    }
    try {
      const id = startMentioned(ctx, type, mention.message);
      await manager.awaitStartup(id);
      ctx.ui.notify(`Started @${handleBase(type)}`, "info");
    } catch (err) {
      ctx.ui.notify(`Could not start @${handleBase(type)}: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
    return { action: "handled" };
  });
  pi.on("session_before_switch", () => {
    manager.clearCompleted(true);
    scheduler.stop();
  });
  pi.on("session_shutdown", async () => {
    rpcHandle?.unsubSpawn();
    rpcHandle?.unsubStop();
    rpcHandle?.unsubPing();
    rpcHandle?.unsubConsume();
    rpcHandle?.unsubSteer();
    rpcHandle = undefined;
    currentCtx = undefined;
    if (ownsManagerRegistry && globalThis[MANAGER_KEY] === registryEntry) {
      delete globalThis[MANAGER_KEY];
    }
    scheduler.stop();
    for (const task of workflowTasks.values())
      task.abortController.abort();
    workflowTasks.clear();
    manager.abortAll();
    groupJoin.dispose();
    widget.dispose();
    outbox.dispose();
    fleet.dispose();
    unsubHandoffKey?.();
    unsubHandoffKey = undefined;
    handoffKeyUi = undefined;
    await manager.dispose(pi);
    pi.events.emit("subagents:disposed", {});
  });
  let widgetMode = "background";
  function getWidgetMode() {
    return widgetMode;
  }
  const widget = new AgentWidget(manager, agentActivity, getWidgetMode, isShowCostEnabled, isShowModelEnabled);
  function setWidgetMode(m2) {
    widgetMode = m2;
    widget.update();
  }
  const foregroundHandoffs = new Map;
  function sendForegroundToBackground(ids) {
    let sent = 0;
    for (const id of [...ids]) {
      const wake = foregroundHandoffs.get(id);
      if (!wake || !manager.sendToBackground(id))
        continue;
      foregroundHandoffs.delete(id);
      wake();
      sent++;
      const record = manager.getRecord(id);
      if (record) {
        pi.events.emit("subagents:created", {
          id,
          type: record.type,
          description: record.description,
          isBackground: true
        });
      }
    }
    if (sent > 0) {
      widget.ensureTimer();
      widget.update();
      fleet.ensureTimer();
      fleet.update();
    }
    return sent;
  }
  function backgroundActionFor(record, notify) {
    return {
      available: () => foregroundHandoffs.has(record.id),
      send: () => {
        if (sendForegroundToBackground([record.id]) > 0)
          notify(`Sent "${record.description}" to the background.`);
      }
    };
  }
  let handoffKeyUi;
  let unsubHandoffKey;
  function watchHandoffKey(ui) {
    if (ui === handoffKeyUi)
      return;
    unsubHandoffKey?.();
    handoffKeyUi = ui;
    unsubHandoffKey = ui.onTerminalInput((data) => {
      if (isKeyRelease2(data) || foregroundHandoffs.size === 0 || !matchesKey5(data, "ctrl+b"))
        return;
      if (!fleet.editorHasFocus())
        return;
      const sent = sendForegroundToBackground(foregroundHandoffs.keys());
      if (sent > 0)
        ui.notify(`Sent ${sent === 1 ? "1 agent" : `${sent} agents`} to the background.`, "info");
      return { consume: true };
    });
  }
  function getFullscreenScrollbar() {
    const mode = pi.getSettings().fullscreenScrollbar;
    return mode === "always" || mode === "hidden" ? mode : "auto";
  }
  const fleet = new FleetList(manager, agentActivity, isShowCostEnabled, getViewerMarkdown, (mode) => chooseViewerMarkdown(mode, currentCtx), getFullscreenScrollbar, backgroundActionFor);
  let fleetViewEnabled = true;
  function isFleetViewEnabled() {
    return fleetViewEnabled;
  }
  function setFleetViewEnabled(b2) {
    fleetViewEnabled = b2;
    fleet.setEnabled(b2);
  }
  let agentMentionMode = "model";
  function getAgentMentionMode() {
    return agentMentionMode;
  }
  function setAgentMentionMode(mode) {
    agentMentionMode = mode;
  }
  function isAgentMentionsEnabled() {
    return agentMentionMode !== "off";
  }
  let defaultJoinMode = "smart";
  function getDefaultJoinMode() {
    return defaultJoinMode;
  }
  function setDefaultJoinMode(mode) {
    defaultJoinMode = mode;
  }
  let backgroundByDefault = true;
  function getBackgroundByDefault() {
    return backgroundByDefault;
  }
  function setBackgroundByDefault(b2) {
    backgroundByDefault = b2;
  }
  let schedulingEnabled = true;
  function isSchedulingEnabled() {
    return schedulingEnabled;
  }
  function setSchedulingEnabled(b2) {
    schedulingEnabled = b2;
  }
  let workflowsEnabled = true;
  let workflowsPinned = false;
  function isWorkflowsEnabled() {
    return workflowsEnabled;
  }
  function isWorkflowsPinned() {
    return workflowsPinned;
  }
  function setWorkflowsEnabled(b2) {
    workflowsEnabled = b2;
    workflowsPinned = true;
  }
  function setDisableDefaultAgents(b2) {
    setDefaultsDisabled(b2);
    reloadCustomAgents();
  }
  let toolDescriptionMode = "full";
  function getToolDescriptionMode() {
    return toolDescriptionMode;
  }
  function setToolDescriptionMode(mode) {
    toolDescriptionMode = mode;
  }
  let turnGroupSpawns = [];
  let turnGroupCounter = 0;
  function joinTurnGroup(id, joinMode) {
    if (joinMode === "group" && currentCtx?.signal !== undefined)
      turnGroupSpawns.push(id);
  }
  function registerTurnGroup() {
    const ids = turnGroupSpawns;
    turnGroupSpawns = [];
    if (ids.length < 2) {
      const record = ids.length === 1 ? manager.getRecord(ids[0]) : undefined;
      if (record?.completedAt != null && !record.resultConsumed)
        sendIndividualNudge(record);
      return;
    }
    const groupId = `turn-${++turnGroupCounter}`;
    groupJoin.registerGroup(groupId, ids);
    for (const id of ids) {
      const record = manager.getRecord(id);
      if (!record)
        continue;
      record.groupId = groupId;
      if (record.completedAt != null && !record.resultConsumed) {
        groupJoin.onAgentComplete(record);
      }
    }
  }
  function resumeTurnLimit(record, explicit) {
    return normalizeMaxTurns(getAgentConfig(record.type)?.maxTurns ?? explicit ?? record.invocation?.maxTurns ?? getDefaultMaxTurns());
  }
  async function startBackgroundResume(ctx, existing, prompt, opts) {
    const id = existing.id;
    const joinMode = resolveJoinMode(defaultJoinMode, true);
    existing.toolCallId = opts.toolCallId;
    if (joinMode)
      existing.joinMode = joinMode;
    if (opts.outputTranscript) {
      existing.outputFile = createOutputFilePath(ctx.cwd, id, ctx.sessionManager.getSessionId());
      ensureOutputFile(existing.outputFile);
    }
    const transcriptAnchor = existing.session?.messages.length ?? 0;
    const { state: bgState, callbacks: bgCallbacks } = createActivityTracker(opts.maxTurns);
    bgState.session = existing.session;
    const record = await manager.resume(id, prompt, undefined, {
      isBackground: true,
      maxTurns: opts.maxTurns,
      onTurnEnd: bgCallbacks.onTurnEnd,
      onToolActivity: bgCallbacks.onToolActivity,
      onAssistantUsage: bgCallbacks.onAssistantUsage,
      onStarted: () => {
        const rec = manager.getRecord(id);
        if (rec?.session && rec.outputFile) {
          rec.outputCleanup = streamToOutputFile(rec.session, rec.outputFile, id, ctx.cwd, transcriptAnchor);
        }
      }
    });
    if (!record)
      return;
    if (opts.toolCallId !== undefined)
      joinTurnGroup(id, joinMode);
    agentActivity.set(id, bgState);
    widget.markRunning(id);
    widget.ensureTimer();
    widget.update();
    fleet.ensureTimer();
    fleet.update();
    pi.events.emit("subagents:created", {
      id,
      type: existing.type,
      description: existing.description,
      isBackground: true
    });
    return record;
  }
  pi.on("tool_execution_start", async (_event, ctx) => {
    widget.setUICtx(ctx.ui);
    fleet.setUICtx(ctx.ui);
    watchHandoffKey(ctx.ui);
    widget.onTurnStart();
  });
  pi.on("turn_end", (event) => {
    registerTurnGroup();
    outbox.onTurnEnd(event.message.role === "assistant" ? event.message.stopReason : undefined);
  });
  pi.on("agent_end", () => outbox.onAgentEnd());
  pi.on("agent_settled", () => outbox.onAgentEnd());
  const buildTypeListText = () => {
    const available = getAvailableTypes();
    return available.map((name) => {
      const cfg = getAgentConfig(name);
      const modelSuffix = cfg?.model ? ` (${getModelLabelFromConfig(cfg.model)})` : "";
      const toolsSuffix = ` (Tools: ${formatToolsSuffix(cfg)})`;
      return `- ${name}: ${cfg?.description ?? name}${modelSuffix}${toolsSuffix}`;
    }).join(`
`);
  };
  const firstSentence = (text) => {
    const match = text.match(/^.*?[.!?](?=\s|$)/s);
    return (match ? match[0] : text).replace(/\s+/g, " ").trim();
  };
  const buildCompactTypeListText = () => getAvailableTypes().map((name) => {
    const cfg = getAgentConfig(name);
    return `- ${name}: ${firstSentence(cfg?.description ?? name)} (Tools: ${formatToolsSuffix(cfg)})`;
  }).join(`
`);
  function getModelLabelFromConfig(model) {
    const name = model.includes("/") ? model.split("/").pop() : model;
    return name.replace(/-\d{8}$/, "");
  }
  applyAndEmitLoaded({
    setMaxConcurrent: (n) => manager.setMaxConcurrent(n),
    setMaxConcurrentForeground: (n) => manager.setMaxConcurrentForeground(n),
    setDefaultMaxTurns,
    setGraceTurns,
    setDefaultJoinMode,
    setBackgroundByDefault,
    setSchedulingEnabled,
    setScopeModels: setScopeModelsEnabled,
    setStrictAgentFiles: (b2) => {
      strictAgentFiles = b2;
    },
    setDisableDefaultAgents,
    setToolDescriptionMode,
    setFleetView: setFleetViewEnabled,
    setAgentMentions: setAgentMentionMode,
    setRememberAgents,
    setWidgetMode,
    setOutputTranscript: setOutputTranscriptDefault,
    setWorktreeIsolation: setWorktreeIsolationEnabled,
    setWorkflowsEnabled,
    setMaxSubagentDepth,
    setFallbackSubagent,
    setReportUsage,
    setShowCost,
    setShowModel,
    setViewerMarkdown,
    setPackageAgents: setPackageAgentsGate,
    setPackageWorkflows: setPackageWorkflowsGate
  }, (event, payload) => pi.events.emit(event, payload));
  const scheduleParamShape = {
    schedule: Type3.Optional(Type3.String({
      description: "Opt-in only — fire later instead of now. Omit to run immediately (the default, almost always correct). " + 'Formats: 6-field cron ("0 0 9 * * 1" = 9am Mon), interval ("5m"/"1h"), one-shot ("+10m" or ISO). ' + "Forces run_in_background; incompatible with inherit_context and resume. Returns job ID."
    }))
  };
  const scheduleParam = isSchedulingEnabled() ? scheduleParamShape : {};
  const scheduleGuideline = isSchedulingEnabled() ? `
- Use \`schedule\` only when the user explicitly asked for scheduled / recurring / delayed execution (e.g. "every Monday", "in an hour"). Don't auto-schedule from vague intent like "monitor X" — run once now or ask.` : "";
  const isolationGuideline = isWorktreeIsolationEnabled() ? `
- Use isolation: "worktree" to give the agent its own git worktree (safe parallel file modifications); leave it unset, or pass "off", for none. The worktree is removed when the agent finishes; if it made changes, they are committed to a branch and the branch is named in the result.` : "";
  const isolationCompactGuideline = isWorktreeIsolationEnabled() ? `
- isolation: "worktree" gives the agent its own git worktree (removed on completion); changes land on a branch named in the result.` : "";
  const compactAgentToolDescription = `Launch an autonomous agent for complex, multi-step tasks. Agent types:
${buildCompactTypeListText()}

Custom agents: .pi/agents/<name>.md (project) or ${getAgentDir11()}/agents/<name>.md (global).

Notes:
- description: 3-5 words (shown in UI). Prompts must be self-contained — the agent has not seen this conversation.
- Parallel work: one message, multiple Agent calls — they run concurrently.
- Subagents run in the background by default; you'll be notified when one completes. Pass run_in_background: false only when your very next action depends on the result and nothing else could usefully happen while it runs. Never fabricate or predict a pending agent's results — if the user asks before the notification arrives, say it's still running.
- The result is not shown to the user — summarize it for them. Verify an agent's claimed code changes before reporting work done.
- resume continues a previous agent by ID; steer_subagent messages a running one.${isolationCompactGuideline}`;
  const fullAgentToolDescription = `Launch a new agent to handle complex, multi-step tasks autonomously. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
${buildTypeListText()}

Custom agents can be defined in .pi/agents/<name>.md (project) or ${getAgentDir11()}/agents/<name>.md (global) — they are picked up automatically. Project-level agents override global ones. Creating a .md file with the same name as a default agent overrides it.

When using the Agent tool, specify a subagent_type parameter to select which agent type to use.

## When not to use

If the target is already known, use a direct tool — \`read\` for a known path, \`grep\`/\`find\` for a specific symbol or string. Reserve this tool for open-ended questions that span the codebase, or tasks that match an available agent type.

## Usage notes

- Always include a short (3-5 word) description summarizing what the agent will do (shown in UI).
- When you launch multiple agents for independent work, send them in a single message with multiple tool uses so they run concurrently. If the user specifies that they want you to run agents "in parallel", you MUST send a single message with multiple Agent tool use content blocks.
- When the agent is done, it returns a single message back to you. The result is not visible to the user — to show the user, send a text message with a concise summary.
- Trust but verify: an agent's summary describes what it intended to do, not necessarily what it did. When an agent writes or edits code, check the actual changes before reporting the work as done.
- Agents run in the background by default. When an agent runs in the background, you will be automatically notified when it completes — do NOT sleep, poll, or proactively check on its progress. Continue with other work or respond to the user instead.
- **Foreground vs background**: Pass \`run_in_background: false\` only when your very next action depends on the agent's result and nothing else could usefully happen while it runs — e.g., a research agent whose finding gates the edit you're about to make. Otherwise let it run in the background (the default) — this includes fire-and-forget work, independent investigations, and anything where the user might hand you something else in the meantime. Wanting the result "next" is not enough on its own.
- **Don't race**: after launching a background agent, you know nothing about its results. Never fabricate or predict them in any format — not as prose, summary, or structured output. The completion notification arrives in a later turn; it is never something you write yourself. If the user asks before it lands, say the agent is still running — give status, not a guess.
- Use resume with an agent ID to continue a previous agent's work. A new (non-resume) Agent call starts a fresh agent with no memory of prior runs, so the prompt must be self-contained.
- Use steer_subagent to send mid-run messages to a running background agent.
- Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, etc.), since it is not aware of the user's intent.
- If an agent's description says it should be used proactively, try to use it without the user having to ask for it first.
- Use model to specify a different model (as "provider/modelId", or fuzzy e.g. "haiku", "sonnet").
- Use thinking to control extended thinking level.
- Use inherit_context if the agent needs the parent conversation history.${isolationGuideline}${scheduleGuideline}

## Writing the prompt

Brief the agent like a smart colleague who just walked into the room — it hasn't seen this conversation, doesn't know what you've tried, doesn't understand why this task matters.
- Explain what you're trying to accomplish and why.
- Describe what you've already learned or ruled out.
- Give enough context about the surrounding problem that the agent can make judgment calls rather than just following a narrow instruction.
- If you need a short response, say so ("report in under 200 words").
- Lookups: hand over the exact command. Investigations: hand over the question — prescribed steps become dead weight when the premise is wrong.

Terse command-style prompts produce shallow, generic work.

**Never delegate understanding.** Don't write "based on your findings, fix the bug" or "based on the research, implement it." Those phrases push synthesis onto the agent instead of doing it yourself. Write prompts that prove you understood: include file paths, line numbers, what specifically to change.`;
  const renderToolDescriptionTemplate = (template) => {
    const vars = {
      typeList: buildTypeListText,
      compactTypeList: buildCompactTypeListText,
      agentDir: getAgentDir11,
      isolationGuideline: () => isolationGuideline,
      scheduleGuideline: () => scheduleGuideline
    };
    return template.replace(/\{\{(\w+)\}\}/g, (raw, name) => {
      if (vars[name])
        return vars[name]();
      console.warn(`[pi-subagents] agent-tool-description.md: unknown placeholder ${raw} left as-is`);
      return raw;
    });
  };
  const loadCustomToolDescription = () => {
    for (const path of [
      join13(process.cwd(), ".pi", "agent-tool-description.md"),
      join13(getAgentDir11(), "agent-tool-description.md")
    ]) {
      try {
        if (!existsSync13(path))
          continue;
        const text = readFileSync10(path, "utf-8").trim();
        if (text)
          return renderToolDescriptionTemplate(text);
        console.warn(`[pi-subagents] ${path} is empty — ignoring`);
      } catch (err) {
        console.warn(`[pi-subagents] failed to read ${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return;
  };
  const agentToolDescription = (() => {
    const mode = getToolDescriptionMode();
    if (mode === "compact")
      return compactAgentToolDescription;
    if (mode === "custom") {
      const custom = loadCustomToolDescription();
      if (custom)
        return custom;
      console.warn('[pi-subagents] toolDescriptionMode is "custom" but no agent-tool-description.md found — using "full"');
    }
    return fullAgentToolDescription;
  })();
  const agentTool = defineTool3({
    name: SUBAGENT_TOOL_NAMES.AGENT,
    label: "Agent",
    description: agentToolDescription,
    promptSnippet: "Launch autonomous sub-agents for complex multi-step tasks",
    promptGuidelines: [
      "Use Agent with specialized agents when the task matches an agent type's description. Subagents are valuable for parallelizing independent queries or for protecting the main context window from excessive results, but should not be used excessively when not needed. Importantly, avoid duplicating work that subagents are already doing — if you delegate research to a subagent, do not also perform the same searches yourself.",
      `For broad codebase exploration or research, spawn Agent with an appropriate subagent_type${getAvailableTypes().includes("Explore") ? " (e.g. Explore)" : ""}. Otherwise use direct tools (read, grep, find) when the target is already known.`,
      "When an agent runs in the background, you will be notified on completion — do not poll or sleep waiting for it. Continue with other work instead.",
      "Trust but verify: an agent's summary describes intent, not outcome. When an agent writes or edits code, check the actual changes before reporting work as done."
    ],
    parameters: Type3.Object({
      prompt: Type3.String({
        description: "The task for the agent to perform."
      }),
      description: Type3.String({
        description: "A short (3-5 word) description of the task (shown in UI)."
      }),
      name: Type3.Optional(Type3.String({
        description: 'Optional memorable name for this agent, e.g. "auth-audit", so it can be addressed as `@name` at the prompt and by steer_subagent / get_subagent_result. Letters, digits, `_` and `-`. Worth setting when several agents of the same type run at once; omit for one-off work. The agent stays reachable by its type either way.'
      })),
      subagent_type: Type3.String({
        description: `The type of specialized agent to use. Available types: ${getAvailableTypes().join(", ")}. Custom agents from .pi/agents/*.md (project) or ${getAgentDir11()}/agents/*.md (global) are also available.`
      }),
      model: Type3.Optional(Type3.String({
        description: `Optional model override. Accepts "provider/modelId" or fuzzy name (e.g. "haiku", "sonnet"). Omit to use the agent type's default.`
      })),
      thinking: Type3.Optional(Type3.String({
        description: `Thinking level: ${THINKING_LEVELS.join(", ")}. Overrides agent default.`
      })),
      max_turns: Type3.Optional(Type3.Number({
        description: "Maximum number of agentic turns before stopping. Omit for unlimited (default).",
        minimum: 1
      })),
      run_in_background: Type3.Optional(Type3.Boolean({
        description: "Defaults to true — the agent runs detached, returning its ID immediately, and you are notified on completion. Set false only when your very next action depends on the result; the call then blocks and returns the agent's full output inline."
      })),
      resume: Type3.Optional(Type3.String({
        description: "Optional agent ID to resume from. Continues from previous context. Resumes detached like any other spawn; pass run_in_background: false to block and get the result inline. The resumed run gets a fresh max_turns budget. An agent can only be resumed once its current run has finished — use steer_subagent to reach one mid-run."
      })),
      isolated: Type3.Optional(Type3.Boolean({
        description: "If true, agent gets no extension/MCP tools — only built-in tools."
      })),
      inherit_context: Type3.Optional(Type3.Boolean({
        description: "If true, fork parent conversation into the agent. Default: false (fresh context)."
      })),
      ...isolationParam(isWorktreeIsolationEnabled()),
      ...scheduleParam
    }),
    renderCall(args, theme, context) {
      const rowBackground = hasAgentBadge(args.subagent_type) ? theme.getBgAnsi(context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg") : "";
      const desc = args.description ?? "";
      const name = renderAgentName(args.subagent_type, theme, {
        fallbackColor: "toolTitle",
        restoreBackground: rowBackground,
        bold: true
      });
      return new Text2(rowBackground + "▸ " + name + (desc ? "  " + theme.fg("muted", desc) : ""), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, renderContext) {
      const details = result.details;
      const text = result.content[0]?.type === "text" ? result.content[0].text : "";
      if (renderContext.isError || !details?.status) {
        return new Text2(text, 0, 0);
      }
      const stats2 = (d) => {
        const parts = [];
        if (d.modelName)
          parts.push(d.modelName);
        if (d.tags)
          parts.push(...d.tags);
        if (d.turnCount != null && d.turnCount > 0) {
          parts.push(formatTurns(d.turnCount, d.maxTurns));
        }
        if (d.toolUses > 0)
          parts.push(`${d.toolUses} tool use${d.toolUses === 1 ? "" : "s"}`);
        if (d.tokens)
          parts.push(d.tokens);
        if (showCost) {
          const costText = formatCost(d.cost ?? 0);
          if (costText)
            parts.push(costText);
        }
        return parts.map((p2) => fgPreservingNestedStyles(theme, "dim", p2)).join(" " + theme.fg("dim", "·") + " ");
      };
      if (isPartial || details.status === "running") {
        const frame = SPINNER[details.spinnerFrame ?? 0];
        const s3 = stats2(details);
        const status = renderRunningAgentStatus(frame, s3, details.activity ?? "thinking…", theme);
        if (details.backgroundHint && details.durationMs >= BACKGROUND_HINT_DELAY_MS) {
          status.addChild(new Text2(theme.fg("dim", "     (ctrl+b to run in background)"), 0, 0));
        }
        return status;
      }
      if (details.status === "background") {
        return new Text2(theme.fg("dim", `  ⎿  Running in background (ID: ${details.agentId})`), 0, 0);
      }
      if (details.status === "completed" || details.status === "steered") {
        const duration = formatMs(details.durationMs);
        const isSteered = details.status === "steered";
        const icon = isSteered ? theme.fg("warning", "✓") : theme.fg("success", "✓");
        const s3 = stats2(details);
        let line2 = icon + (s3 ? " " + s3 : "");
        line2 += " " + theme.fg("dim", "·") + " " + theme.fg("dim", duration);
        if (expanded) {
          const resultText = result.content[0]?.type === "text" ? result.content[0].text : "";
          if (resultText) {
            const lines = resultText.split(`
`).slice(0, 50);
            for (const l of lines) {
              line2 += `
` + theme.fg("dim", `  ${l}`);
            }
            if (resultText.split(`
`).length > 50) {
              line2 += `
` + theme.fg("muted", "  ... (use get_subagent_result with verbose for full output)");
            }
          }
        } else {
          const doneText = isSteered ? "Wrapped up (turn limit)" : "Done";
          line2 += `
` + theme.fg("dim", `  ⎿  ${doneText}`);
        }
        return new Text2(line2, 0, 0);
      }
      if (details.status === "stopped") {
        const s3 = stats2(details);
        let line2 = theme.fg("dim", "■") + (s3 ? " " + s3 : "");
        line2 += `
` + theme.fg("dim", "  ⎿  Stopped");
        return new Text2(line2, 0, 0);
      }
      if (details.status !== "error" && details.status !== "aborted") {
        return new Text2(text, 0, 0);
      }
      const s2 = stats2(details);
      let line = theme.fg("error", "✗") + (s2 ? " " + s2 : "");
      if (details.status === "error") {
        line += `
` + theme.fg("error", `  ⎿  Error: ${details.error ?? "unknown"}`);
      } else {
        line += `
` + theme.fg("warning", "  ⎿  Aborted (max turns exceeded)");
      }
      return new Text2(line, 0, 0);
    },
    execute: async (toolCallId, callParams, signal, onUpdate, ctx) => {
      widget.setUICtx(ctx.ui);
      reloadCustomAgents();
      const saved = callParams.resume !== undefined && !callParams.schedule && manager.getRecord(callParams.resume) === undefined ? findAgentRecordEntry(ctx, callParams.resume) : undefined;
      let reopenOptions;
      if (saved !== undefined) {
        const reopen = reopenTarget(saved.type, saved.sessionFile, saved.worktreeLost);
        if (!reopen.ok)
          return textResult2(`Agent "${saved.id}" cannot be resumed — ${reopen.reason}.`);
        reopenOptions = {
          resumeSessionFile: reopen.sessionFile,
          reclaim: { id: saved.id, handle: saved.handle, alias: saved.alias }
        };
      }
      const params = saved === undefined ? callParams : {
        prompt: callParams.prompt,
        description: saved.description,
        subagent_type: saved.type,
        run_in_background: callParams.run_in_background,
        max_turns: callParams.max_turns,
        isolation: undefined,
        schedule: undefined
      };
      const rawType = params.subagent_type;
      const dispatch = resolveSpawnType(rawType);
      if (!dispatch.ok && !params.resume)
        return textResult2(dispatch.message);
      const subagentType = dispatch.ok ? dispatch.type : rawType;
      const requestedType = dispatch.ok && dispatch.fellBackFrom || subagentType;
      const fallbackNote = dispatch.ok && dispatch.fellBackFrom !== undefined ? `Note: Unknown agent type "${dispatch.fellBackFrom}" — using ${resolveType(subagentType) ? subagentType : "the fallback agent config"}.

` : "";
      const displayName = getDisplayName(subagentType);
      const customConfig = getAgentConfig(subagentType);
      const resolvedConfig = resolveAgentInvocationConfig(customConfig, params, {
        worktreeAllowed: isWorktreeIsolationEnabled(),
        defaultRunInBackground: getBackgroundByDefault()
      });
      let model = ctx.model;
      if (resolvedConfig.modelInput) {
        const resolved2 = resolveModel(resolvedConfig.modelInput, ctx.modelRegistry, ctx.model);
        if (typeof resolved2 === "string") {
          if (resolvedConfig.modelFromParams)
            return textResult2(resolved2);
        } else {
          model = resolved2;
        }
      }
      const scopeVerdict = checkModelScope({
        model,
        cwd: ctx.cwd,
        modelRegistry: ctx.modelRegistry,
        callerSupplied: resolvedConfig.modelFromParams,
        agentLabel: customConfig?.displayName ?? subagentType,
        modelInput: resolvedConfig.modelInput
      });
      if (scopeVerdict.kind === "error")
        return textResult2(scopeVerdict.message);
      if (scopeVerdict.kind === "warn")
        ctx.ui.notify(scopeVerdict.message, "warning");
      const thinking = resolvedConfig.thinking;
      const inheritContext = resolvedConfig.inheritContext;
      const runInBackground = resolvedConfig.runInBackground;
      const isolated = resolvedConfig.isolated;
      const isolation = resolvedConfig.isolation;
      const outputTranscript = customConfig?.outputTranscript ?? getOutputTranscriptDefault();
      const attachTranscript = (rec, agentId) => {
        if (!rec || !outputTranscript)
          return;
        rec.outputFile = createOutputFilePath(ctx.cwd, agentId, ctx.sessionManager.getSessionId());
        if (reopenOptions)
          ensureOutputFile(rec.outputFile);
        else
          writeInitialEntry(rec.outputFile, agentId, params.prompt, ctx.cwd);
      };
      const transcriptAnchor = (session) => reopenOptions ? session.messages.length : undefined;
      const { modelName, modelId } = model ? describeModel(model) : { modelName: undefined, modelId: undefined };
      const askedModel = ((asked) => {
        if (!asked)
          return;
        const resolvedAsked = resolveModel(asked, ctx.modelRegistry, ctx.model);
        if (typeof resolvedAsked === "string")
          return asked;
        return resolvedAsked.provider === model?.provider && resolvedAsked.id === model?.id ? undefined : asked;
      })(resolvedConfig.overridden?.model);
      const effectiveMaxTurns = normalizeMaxTurns(resolvedConfig.maxTurns ?? getDefaultMaxTurns());
      const agentInvocation = {
        modelName,
        modelId,
        thinking,
        requestedThinking: resolvedConfig.overridden?.thinking,
        requestedModel: askedModel,
        maxTurns: normalizeMaxTurns(resolvedConfig.maxTurns),
        isolated,
        inheritContext: reopenOptions ? undefined : inheritContext,
        runInBackground,
        isolation: reopenOptions ? undefined : isolation
      };
      const modeLabel = getPromptModeLabel(subagentType);
      const { tags: invocationTags } = buildInvocationTags(agentInvocation);
      const agentTags = modeLabel ? [modeLabel, ...invocationTags] : invocationTags;
      const detailBase = {
        displayName,
        description: params.description,
        subagentType,
        modelName,
        tags: agentTags.length > 0 ? agentTags : undefined
      };
      const detailBaseFor = (rec) => {
        if (!rec?.invocation)
          return detailBase;
        const type = rec.type;
        const { modelName: recModelName, tags } = buildInvocationTags(rec.invocation);
        const recModeLabel = getPromptModeLabel(type);
        const recTags = recModeLabel ? [recModeLabel, ...tags] : tags;
        return {
          displayName: getDisplayName(type),
          description: rec.description,
          subagentType: type,
          modelName: recModelName,
          tags: recTags.length > 0 ? recTags : undefined
        };
      };
      if (params.schedule) {
        if (!isSchedulingEnabled()) {
          return textResult2("Scheduling is disabled in this project. Enable via /agents → Settings → Scheduling.");
        }
        if (params.resume) {
          return textResult2("Cannot combine `schedule` with `resume` — schedules create fresh agents.");
        }
        if (params.inherit_context) {
          return textResult2("Cannot combine `schedule` with `inherit_context` — there is no parent conversation at fire time.");
        }
        if (params.run_in_background === false) {
          return textResult2("Cannot combine `schedule` with `run_in_background: false` — scheduled jobs always run in background.");
        }
        if (!scheduler.isActive()) {
          return textResult2("Scheduler is not active in this session yet. Try again after the session has fully started.");
        }
        try {
          const job = scheduler.addJob({
            name: params.description,
            description: params.description,
            schedule: params.schedule,
            subagent_type: requestedType,
            prompt: params.prompt,
            model: params.model,
            thinking,
            max_turns: effectiveMaxTurns,
            isolated,
            isolation
          });
          const next = scheduler.getNextRun(job.id);
          return textResult2(`${fallbackNote}Scheduled "${job.name}" (id: ${job.id}, type: ${job.scheduleType}). ` + `Next run: ${next ?? "(unknown)"}. ` + `Manage via /agents → Scheduled jobs.`);
        } catch (err) {
          return textResult2(err instanceof Error ? err.message : String(err));
        }
      }
      if (params.resume) {
        const existing = manager.getRecord(params.resume);
        if (!existing || !isTopLevelAgent(existing)) {
          return textResult2(`Agent not found: "${params.resume}". It may have been cleaned up.`);
        }
        if (!existing.session) {
          return textResult2(`Agent "${params.resume}" has no active session to resume.`);
        }
        const resumeMaxTurns = resumeTurnLimit(existing, params.max_turns);
        if (runInBackground) {
          const id = existing.id;
          if (existing.status === "running" || existing.status === "queued") {
            return textResult2(`Agent "${params.resume}" is still ${existing.status} — it can only be resumed once its current run finishes.
` + `Use steer_subagent to send it a message mid-run, or get_subagent_result to wait for it.`);
          }
          const record3 = await startBackgroundResume(ctx, existing, params.prompt, {
            outputTranscript,
            maxTurns: resumeMaxTurns,
            toolCallId
          });
          if (!record3) {
            return textResult2(`Failed to resume agent "${params.resume}".`);
          }
          const isQueued = record3.status === "queued";
          return textResult2(`Agent ${isQueued ? "queued" : "resumed"} in background.
` + `Agent ID: ${id}
` + `Type: ${existing.type}
` + (record3.outputFile ? `Output file: ${record3.outputFile}
` : "") + (isQueued ? `Position: queued (max ${manager.getMaxConcurrent()} concurrent)
` : "") + `
You will be notified when this agent completes.
` + `Use get_subagent_result to retrieve full results, or steer_subagent to send it messages.`, { ...detailBaseFor(record3), toolUses: record3.toolUses, tokens: "", durationMs: 0, status: "background", agentId: id });
        }
        const { state: resumeState, callbacks: resumeCallbacks } = createActivityTracker(resumeMaxTurns);
        resumeState.session = existing.session;
        agentActivity.set(existing.id, resumeState);
        widget.markRunning(existing.id);
        widget.ensureTimer();
        fleet.ensureTimer();
        fleet.update();
        let record2;
        try {
          record2 = await manager.resume(params.resume, params.prompt, signal, {
            maxTurns: resumeMaxTurns,
            onTurnEnd: resumeCallbacks.onTurnEnd,
            onToolActivity: resumeCallbacks.onToolActivity
          });
        } finally {
          agentActivity.delete(existing.id);
          widget.markFinished(existing.id);
          fleet.onAgentFinished(existing.id);
        }
        if (!record2) {
          return textResult2(`Failed to resume agent "${params.resume}".`);
        }
        pi.appendEntry(AGENT_RECORD_ENTRY_TYPE, agentRecordEntryData(record2));
        if (record2.status === "error") {
          return textResult2(`Agent failed: ${record2.error}${partialOutputSuffix(record2)}`, buildDetails(detailBaseFor(record2), record2, resumeState));
        }
        return textResult2(record2.result?.trim() || "No output.", buildDetails(detailBaseFor(record2), record2, resumeState));
      }
      const backgroundResult = (id, record2) => {
        const isQueued = record2?.status === "queued";
        return textResult2(`${fallbackNote}Agent ${isQueued ? "queued" : reopenOptions ? "resumed from its saved session" : "started"} in background.
` + `Agent ID: ${id}
` + `Type: ${displayName}
` + `Description: ${params.description}
` + (record2?.outputFile ? `Output file: ${record2.outputFile}
` : "") + (isQueued ? `Position: queued (max ${manager.getMaxConcurrent()} concurrent)
` : "") + `
You will be notified when this agent completes.
` + `Use get_subagent_result to retrieve full results, or steer_subagent to send it messages.
` + `Do not duplicate this agent's work.`, { ...detailBaseFor(record2), toolUses: 0, tokens: "", durationMs: 0, status: "background", agentId: id });
      };
      if (runInBackground) {
        const { state: bgState, callbacks: bgCallbacks } = createActivityTracker(effectiveMaxTurns);
        let id;
        const origBgOnSession = bgCallbacks.onSessionCreated;
        bgCallbacks.onSessionCreated = (session) => {
          origBgOnSession(session);
          const rec = manager.getRecord(id);
          if (rec?.outputFile) {
            rec.outputCleanup = streamToOutputFile(session, rec.outputFile, id, ctx.cwd, transcriptAnchor(session));
          }
        };
        id = manager.spawn(pi, ctx, subagentType, params.prompt, {
          description: params.description,
          name: params.name,
          model,
          maxTurns: effectiveMaxTurns,
          isolated,
          inheritContext,
          thinkingLevel: thinking,
          isBackground: true,
          isolation,
          invocation: agentInvocation,
          rootSessionId: ctx.sessionManager.getSessionId(),
          ...reopenOptions,
          ...bgCallbacks
        });
        const joinMode = resolveJoinMode(defaultJoinMode, true);
        const record2 = manager.getRecord(id);
        if (record2 && joinMode) {
          record2.joinMode = joinMode;
          record2.toolCallId = toolCallId;
          attachTranscript(record2, id);
        }
        await manager.awaitStartup(id);
        joinTurnGroup(id, joinMode);
        agentActivity.set(id, bgState);
        widget.ensureTimer();
        widget.update();
        fleet.ensureTimer();
        fleet.update();
        pi.events.emit("subagents:created", {
          id,
          type: subagentType,
          description: params.description,
          isBackground: true
        });
        return backgroundResult(id, record2);
      }
      let spinnerFrame = 0;
      const startedAt = Date.now();
      let fgId;
      let handoffId;
      let backgrounded = false;
      let queuedAhead;
      const streamUpdate = () => {
        if (backgrounded)
          return;
        const fgRecord = fgId ? manager.getRecord(fgId) : undefined;
        const details2 = {
          ...detailBaseFor(fgRecord),
          toolUses: fgState.toolUses,
          tokens: fgRecord ? formatLifetimeTokens(fgRecord) : "",
          cost: fgRecord ? getLifetimeCost(fgRecord.lifetimeUsage) : 0,
          turnCount: fgState.turnCount,
          maxTurns: fgState.maxTurns,
          durationMs: Date.now() - startedAt,
          status: "running",
          activity: queuedAhead === undefined ? describeActivity(fgState.activeTools, fgState.responseText) : `queued — waiting for a foreground slot${queuedAhead > 0 ? ` (${queuedAhead} ahead)` : ""}`,
          spinnerFrame: spinnerFrame % SPINNER.length,
          backgroundHint: handoffId !== undefined && foregroundHandoffs.keys().next().value === handoffId
        };
        onUpdate?.({
          content: [{ type: "text", text: `${fgState.toolUses} tool uses...` }],
          details: details2
        });
      };
      const { state: fgState, callbacks: fgCallbacks } = createActivityTracker(effectiveMaxTurns, streamUpdate);
      const origOnSession = fgCallbacks.onSessionCreated;
      fgCallbacks.onSessionCreated = (session) => {
        origOnSession(session);
        if (queuedAhead !== undefined) {
          queuedAhead = undefined;
          streamUpdate();
        }
        for (const a of manager.listAgents()) {
          if (a.session === session) {
            fgId = a.id;
            agentActivity.set(a.id, fgState);
            widget.ensureTimer();
            fleet.ensureTimer();
            fleet.update();
            break;
          }
        }
        if (fgId) {
          const rec = manager.getRecord(fgId);
          if (rec?.outputFile) {
            rec.outputCleanup = streamToOutputFile(session, rec.outputFile, fgId, ctx.cwd, transcriptAnchor(session));
          }
        }
      };
      const spinnerInterval = setInterval(() => {
        spinnerFrame++;
        streamUpdate();
      }, 80);
      streamUpdate();
      let wakeBackgrounded;
      const handedOff = new Promise((resolve3) => {
        wakeBackgrounded = () => resolve3(undefined);
      });
      let fgResult;
      try {
        fgResult = await Promise.race([manager.spawnAndWait(pi, ctx, subagentType, params.prompt, {
          description: params.description,
          name: params.name,
          model,
          maxTurns: effectiveMaxTurns,
          isolated,
          inheritContext,
          thinkingLevel: thinking,
          isolation,
          invocation: agentInvocation,
          signal,
          rootSessionId: ctx.sessionManager.getSessionId(),
          ...reopenOptions,
          onQueued: (_id, ahead) => {
            queuedAhead = ahead;
            streamUpdate();
          },
          ...fgCallbacks
        }, (fgAgentId) => {
          const fgRec = manager.getRecord(fgAgentId);
          attachTranscript(fgRec, fgAgentId);
          handoffId = fgAgentId;
          foregroundHandoffs.set(fgAgentId, () => {
            if (fgRec) {
              fgRec.toolCallId = toolCallId;
              fgRec.joinMode = "async";
            }
            backgrounded = true;
            wakeBackgrounded();
          });
        }), handedOff]);
      } finally {
        clearInterval(spinnerInterval);
        if (handoffId !== undefined)
          foregroundHandoffs.delete(handoffId);
        if (fgId && !backgrounded) {
          agentActivity.delete(fgId);
          widget.markFinished(fgId);
          fleet.onAgentFinished(fgId);
        }
      }
      if (fgResult === undefined)
        return backgroundResult(handoffId, manager.getRecord(handoffId));
      const record = fgResult.record;
      const tokenText = formatLifetimeTokens(record);
      const details = buildDetails(detailBaseFor(record), record, fgState, { tokens: tokenText });
      if (record.status === "error") {
        return textResult2(`${fallbackNote}Agent failed: ${record.error}${partialOutputSuffix(record)}`, details);
      }
      const durationMs = (record.completedAt ?? Date.now()) - record.startedAt;
      const statsParts = [`${record.toolUses} tool uses`];
      if (tokenText)
        statsParts.push(tokenText);
      if (showCost) {
        const costText = formatCost(getLifetimeCost(record.lifetimeUsage));
        if (costText)
          statsParts.push(costText);
      }
      return textResult2(`${fallbackNote}Agent completed in ${formatMs(durationMs)} (${statsParts.join(", ")})${getForegroundOutcomeNote(record.status)}.

` + (record.result?.trim() || "No output."), details);
    }
  });
  function withUsageReporting(tool) {
    return {
      ...tool,
      execute: async (toolCallId, ...rest) => {
        const result = await tool.execute(toolCallId, ...rest);
        if (!reportUsage || !toolCallId)
          return result;
        const usage = pendingUsage.drain();
        return usage ? { ...result, usage } : result;
      }
    };
  }
  function registerToolReportingUsage(tool) {
    pi.registerTool(withUsageReporting(tool));
  }
  const registeredAgentTool = withUsageReporting(agentTool);
  pi.registerTool(registeredAgentTool);
  const workflowTasks = new Map;
  function fleetWorkflows() {
    return [...workflowTasks.values()].map((task) => ({
      id: task.id,
      name: task.meta?.name ?? task.workflowName ?? task.id,
      status: task.status,
      doneCount: task.doneCount,
      totalCount: task.agentCount,
      startedAt: task.startTime,
      ...task.endTime !== undefined ? { completedAt: task.endTime } : {},
      tokens: task.totalTokens
    }));
  }
  async function runWorkflowTask(ctx, task) {
    try {
      const result = await runWorkflow({
        script: task.script,
        args: task.args,
        signal: task.abortController.signal,
        host: createWorkflowHost({
          pi,
          ctx,
          manager,
          signal: task.abortController.signal,
          rootSessionId: ctx.sessionManager.getSessionId(),
          workflowId: task.id
        }),
        onProgress: (entries) => updateWorkflowProgressBatch(task, entries),
        onControl: (control) => {
          task.control = control;
        },
        journal: {
          ...task.replay !== undefined ? { entries: task.replay } : {},
          ...task.journalPath !== undefined ? { append: (entry) => appendJournal(task.journalPath, entry) } : {}
        }
      });
      completeWorkflowTask(task, result);
    } catch (err) {
      failWorkflowTask(task, err instanceof Error ? err.message : String(err));
    }
  }
  function notifyWorkflowFinished(task) {
    widget.update();
    fleet.update();
    const result = workflowResultText(task);
    const message = {
      content: formatWorkflowNotification(task),
      details: {
        id: task.id,
        description: `Workflow ${task.workflowName ?? task.id}`,
        status: task.status === "completed" ? "completed" : task.status === "killed" ? "stopped" : "error",
        toolUses: task.totalToolCalls,
        turnCount: 0,
        totalTokens: task.totalTokens,
        durationMs: elapsedMs(task, Date.now()),
        error: task.error,
        resultPreview: result.length > 500 ? `${result.slice(0, 500)}…` : result
      }
    };
    outbox.add({ ids: [task.id], build: () => message });
  }
  const workflowTool = defineTool3({
    name: SUBAGENT_TOOL_NAMES.WORKFLOW,
    label: "SubagentWorkflow",
    description: renderToolDescriptionTemplate(fullWorkflowToolDescription),
    promptSnippet: "Run a deterministic script that orchestrates many subagents",
    promptGuidelines: [
      "Use SubagentWorkflow when the number of agents depends on something discovered at runtime, when work flows through stages, or when findings should be independently verified. Use Agent for one delegated task or a handful you can name up front.",
      "Prefer `pipeline` over `parallel` — a barrier costs wall-clock whenever the stages are unevenly sized.",
      "A workflow runs in the background and notifies you when it finishes — do not poll or sleep waiting for it."
    ],
    parameters: Type3.Object({
      script: Type3.Optional(Type3.String({
        maxLength: 524288,
        description: "Inline workflow source. Must begin with `export const meta = { name, description }`."
      })),
      scriptPath: Type3.Optional(Type3.String({
        description: "Path to a workflow script file, absolute or relative to the project. Takes precedence over `script` — this is how you re-run an edited workflow."
      })),
      name: Type3.Optional(Type3.String({
        description: "Name of a saved workflow — `<name>.js` in .pi/workflows/, .agents/workflows/ or the user's agent dir. Lowest precedence: `scriptPath` and `script` both win over it."
      })),
      args: Type3.Optional(Type3.Any({
        description: "Exposed to the script as the global `args`, verbatim. Must be JSON-shaped."
      })),
      resumeFromRunId: Type3.Optional(Type3.String({
        pattern: "^wf_[a-z0-9-]{6,}$",
        description: "Run id of an earlier workflow in this session. Its unchanged leading agent() calls return their recorded results instantly; the first changed or failed call, and everything after it, runs live. Same script and args means nothing re-runs."
      })),
      title: Type3.Optional(Type3.String({ description: "Ignored — set the workflow title in the script's `meta` block." })),
      description: Type3.Optional(Type3.String({ description: "Ignored — set the workflow description in the script's `meta` block." }))
    }),
    renderCall(args, theme) {
      return new Text2(`${theme.fg("toolTitle", "▸ ")}${theme.bold(theme.fg("toolTitle", "SubagentWorkflow"))}  ${theme.fg("muted", workflowCallName(args))}`, 0, 0);
    },
    renderResult(result, _options, theme, renderContext) {
      const text = result.content[0]?.type === "text" ? result.content[0].text : "";
      const taskId = result.details?.taskId;
      const task = taskId !== undefined ? workflowTasks.get(taskId) : undefined;
      if (renderContext.isError || !task)
        return new Text2(text, 0, 0);
      return renderWorkflowCard({
        progress: task.workflowProgress,
        task: {
          status: task.status,
          workflowName: task.workflowName,
          startTime: task.startTime,
          endTime: task.endTime,
          totalPausedMs: task.totalPausedMs
        },
        meta: task.meta,
        agentCount: task.agentCount,
        totalTokens: task.totalTokens
      }, theme);
    },
    execute: async (toolCallId, params, _signal, _onUpdate, ctx) => {
      const resumeFrom = resolveResumeTarget(params.resumeFromRunId, workflowTasks);
      if (resumeFrom !== undefined && !resumeFrom.ok)
        return textResult2(resumeFrom.message);
      const resolved2 = resolveWorkflowScript(params.script === undefined && params.scriptPath === undefined && params.name === undefined && resumeFrom !== undefined ? { scriptPath: resumeFrom.scriptPath } : params, ctx.cwd);
      if (!resolved2.ok)
        return textResult2(resolved2.message);
      let meta;
      try {
        meta = extractMeta(resolved2.script).meta;
      } catch (err) {
        return textResult2(err instanceof Error ? err.message : String(err));
      }
      const runId = workflowRunId();
      let savedPath;
      let journalPath;
      try {
        const dir = sessionTaskDir(ctx.cwd, ctx.sessionManager.getSessionId());
        savedPath = join13(dir, `${runId}.workflow.js`);
        writeFileSync4(savedPath, resolved2.script, "utf-8");
        journalPath = join13(dir, `${runId}.workflow.jsonl`);
      } catch (err) {
        savedPath = undefined;
        journalPath = undefined;
        console.warn(`[pi-subagents] could not persist workflow script: ${err instanceof Error ? err.message : String(err)}`);
      }
      const replay = resumeFrom !== undefined ? readJournal(resumeFrom.journalPath) : undefined;
      const task = createWorkflowTask({
        id: runId,
        script: resolved2.script,
        scriptPath: resolved2.scriptPath ?? savedPath,
        args: params.args,
        meta,
        toolCallId,
        ...journalPath !== undefined ? { journalPath } : {},
        ...replay !== undefined && replay.length > 0 ? { replay, resumedFrom: resumeFrom.runId } : {}
      });
      workflowTasks.set(runId, task);
      widget.update();
      fleet.update();
      runWorkflowTask(ctx, task).then(() => notifyWorkflowFinished(task));
      return {
        content: [{
          type: "text",
          text: `Workflow "${meta.name}" started in the background.
` + `Task ID: ${runId}
` + (task.scriptPath ? `Script: ${task.scriptPath}
` : "") + (task.resumedFrom !== undefined ? `Resuming ${task.resumedFrom}: ${task.replay?.length ?? 0} recorded call(s) available to replay.
` : params.resumeFromRunId !== undefined ? `Nothing to replay from ${params.resumeFromRunId} — every agent runs live.
` : "") + `
You will be notified when it finishes — do NOT poll or sleep waiting for it.
` + `To iterate, edit the script file and call SubagentWorkflow again with scriptPath.`
        }],
        details: { taskId: runId }
      };
    }
  });
  if (isWorkflowsEnabled())
    pi.registerTool(workflowTool);
  let collisionsChecked = false;
  function resolveWorkflowCollisions(ctx) {
    if (collisionsChecked)
      return;
    collisionsChecked = true;
    const warn = (message) => {
      if (ctx.hasUI)
        ctx.ui.notify(message, "warning");
      else
        console.warn(`[pi-subagents] ${message}`);
    };
    try {
      if (!isWorkflowsEnabled())
        return;
      const verdict = decideWorkflowCollision({
        tools: pi.getAllTools(),
        ownDescription: workflowTool.description,
        pinned: isWorkflowsPinned()
      });
      if (verdict.kind === "none")
        return;
      if (verdict.kind === "report") {
        warn(verdict.message);
        return;
      }
      workflowsEnabled = false;
      widget.update();
      fleet.update();
      warn(verdict.message);
      if (!verdict.withdraw)
        return;
      const active = pi.getActiveTools();
      if (active.includes(SUBAGENT_TOOL_NAMES.WORKFLOW)) {
        pi.setActiveTools(active.filter((name) => name !== SUBAGENT_TOOL_NAMES.WORKFLOW));
      }
    } catch {}
  }
  let workflowFlagHandled = false;
  function runWorkflowFlag(ctx) {
    if (workflowFlagHandled)
      return;
    const flag = pi.getFlag(WORKFLOW_FILE_FLAG);
    if (flag === undefined || flag === false)
      return;
    workflowFlagHandled = true;
    const report = (message, level) => {
      if (ctx.hasUI)
        ctx.ui.notify(message, level);
      else
        console.warn(`[pi-subagents] ${message}`);
    };
    if (!isWorkflowsEnabled()) {
      report(`--${WORKFLOW_FILE_FLAG} ignored: workflows are off. Turn them on in /agents → Settings → Workflows, ` + 'or set `"workflowsEnabled": true` in .pi/subagents.json.', "warning");
      return;
    }
    if (typeof flag !== "string" || flag.trim() === "") {
      report(`--${WORKFLOW_FILE_FLAG} needs a path: --${WORKFLOW_FILE_FLAG}=<path>`, "warning");
      return;
    }
    const path = isAbsolute5(flag.trim()) ? flag.trim() : join13(ctx.cwd, flag.trim());
    let script;
    try {
      script = readFileSync10(path, "utf-8");
    } catch (err) {
      report(`Could not read ${path}: ${err instanceof Error ? err.message : String(err)}`, "warning");
      return;
    }
    let meta;
    try {
      meta = extractMeta(script).meta;
    } catch (err) {
      report(err instanceof Error ? err.message : String(err), "warning");
      return;
    }
    const task = createWorkflowTask({ id: workflowRunId(), script, scriptPath: path, meta });
    workflowTasks.set(task.id, task);
    widget.update();
    fleet.update();
    report(`Running workflow ${meta.name}…`, "info");
    runWorkflowTask(ctx, task).then(() => {
      pi.appendEntry(WORKFLOW_ENTRY_TYPE, workflowEntryData(task));
      pi.sendMessage({
        customType: "workflow-result",
        content: formatWorkflowNotification(task),
        display: false
      }, { deliverAs: "nextTurn" });
      widget.update();
      fleet.update();
    });
  }
  registerToolReportingUsage(defineTool3({
    name: SUBAGENT_TOOL_NAMES.GET_RESULT,
    label: "Get Agent Result",
    description: "Check status and retrieve a background agent's full result — its completion notification carries only a preview. Use the agent ID returned by Agent.",
    promptSnippet: "Check status and retrieve results from a background agent",
    parameters: Type3.Object({
      agent_id: Type3.String({
        description: "The agent ID to check. The agent's handle also works — its `name` if you gave it one, otherwise its type (`explore`, `explore-2`)."
      }),
      wait: Type3.Optional(Type3.Boolean({
        description: "If true, wait for the agent to complete before returning. Default: false."
      })),
      verbose: Type3.Optional(Type3.Boolean({
        description: "If true, include the agent's full conversation (messages + tool calls). Default: false."
      }))
    }),
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      const record = resolveAgentRef(params.agent_id);
      if (!record) {
        const tombstone = manager.resolveMention(params.agent_id);
        const savedId = tombstone?.kind === "tombstone" ? tombstone.entry.id : params.agent_id;
        const saved = findAgentRecordEntry(ctx, savedId, tombstone === undefined);
        if (saved) {
          outbox.cancel(saved.id);
          return textResult2(formatSavedAgentRecord(saved));
        }
      }
      if (!record || !isTopLevelAgent(record)) {
        return textResult2(`Agent not found: "${params.agent_id}". It may have been cleaned up.`);
      }
      if (params.wait && (record.status === "running" || record.status === "queued")) {
        while (record.status === "queued") {
          await abortable(new Promise((resolve3) => setTimeout(resolve3, QUEUE_WAIT_POLL_MS)), signal);
        }
        if (record.promise)
          await abortable(record.promise, signal);
      }
      const displayName = getDisplayName(record.type);
      const duration = formatDuration(record.startedAt, record.completedAt);
      const tokens = formatLifetimeTokens(record);
      const contextPercent = getSessionContextPercent(record.session);
      const statsParts = [`Tool uses: ${record.toolUses}`];
      if (tokens)
        statsParts.push(tokens);
      if (showCost) {
        const costText = formatCost(getLifetimeCost(record.lifetimeUsage));
        if (costText)
          statsParts.push(`Cost: ${costText}`);
      }
      if (contextPercent !== null)
        statsParts.push(`Context: ${Math.round(contextPercent)}%`);
      if (record.compactionCount)
        statsParts.push(`Compactions: ${record.compactionCount}`);
      statsParts.push(`Duration: ${duration}`);
      let output = `Agent: ${record.id}
` + `Type: ${displayName} | Status: ${record.status}${getStatusNote(record.status)} | ${statsParts.join(" | ")}
` + `Description: ${record.description}

`;
      if (record.status === "running") {
        output += "Agent is still running. Use wait: true or check back later.";
      } else if (record.status === "error") {
        output += `Error: ${record.error}${partialOutputSuffix(record)}`;
      } else {
        output += record.result?.trim() || "No output.";
      }
      if (record.status !== "running" && record.status !== "queued") {
        record.resultConsumed = true;
        outbox.cancel(record.id);
      }
      if (params.verbose && record.session) {
        const conversation = getAgentConversation(record.session);
        if (conversation) {
          output += `

--- Agent Conversation ---
${conversation}`;
        }
      }
      return textResult2(output);
    }
  }));
  registerToolReportingUsage(defineTool3({
    name: SUBAGENT_TOOL_NAMES.STEER,
    label: "Steer Agent",
    description: "Send a steering message to a running agent. The message will interrupt the agent after its current tool execution " + "and be injected into its conversation, allowing you to redirect its work mid-run. Only works on running agents.",
    promptSnippet: "Send a steering message to redirect a running background agent",
    parameters: Type3.Object({
      agent_id: Type3.String({
        description: "The agent ID to steer (must be currently running). The agent's handle also works — its `name` if you gave it one, otherwise its type (`explore`, `explore-2`)."
      }),
      message: Type3.String({
        description: "The steering message to send. This will appear as a user message in the agent's conversation."
      })
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const record = resolveAgentRef(params.agent_id);
      if (!record || !isTopLevelAgent(record)) {
        return textResult2(`Agent not found: "${params.agent_id}". It may have been cleaned up.`);
      }
      if (record.status !== "running") {
        return textResult2(`Agent "${params.agent_id}" is not running (status: ${record.status}). Cannot steer a non-running agent.`);
      }
      if (!record.session) {
        if (!record.pendingSteers)
          record.pendingSteers = [];
        record.pendingSteers.push(params.message);
        pi.events.emit("subagents:steered", { id: record.id, message: params.message });
        return textResult2(`Steering message queued for agent ${record.id}. It will be delivered once the session initializes.`);
      }
      try {
        await steerAgent(record.session, params.message);
        pi.events.emit("subagents:steered", { id: record.id, message: params.message });
        const tokens = formatLifetimeTokens(record);
        const contextPercent = getSessionContextPercent(record.session);
        const stateParts = [];
        if (tokens)
          stateParts.push(tokens);
        if (showCost) {
          const costText = formatCost(getLifetimeCost(record.lifetimeUsage));
          if (costText)
            stateParts.push(costText);
        }
        stateParts.push(`${record.toolUses} tool ${record.toolUses === 1 ? "use" : "uses"}`);
        if (contextPercent !== null)
          stateParts.push(`context ${Math.round(contextPercent)}% full`);
        if (record.compactionCount)
          stateParts.push(`${record.compactionCount} compaction${record.compactionCount === 1 ? "" : "s"}`);
        return textResult2(`Steering message sent to agent ${record.id}. The agent will process it after its current tool execution.
` + `Current state: ${stateParts.join(" · ")}`);
      } catch (err) {
        return textResult2(`Failed to steer agent: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }));
  function getModelLabel(type, registry, parentModel) {
    const cfg = getAgentConfig(type);
    if (!cfg?.model)
      return "inherit";
    const label = getModelLabelFromConfig(cfg.model);
    if (!registry)
      return label;
    const resolved2 = resolveModel(cfg.model, registry, parentModel);
    if (typeof resolved2 === "string")
      return `${label} (unavailable, fallback: inherit)`;
    const resolvedFull = `${resolved2.provider}/${resolved2.id}`;
    const norm = (s2) => s2.toLowerCase().replace(/\./g, "-").replace(/-\d{8}$/, "");
    if (norm(cfg.model) === norm(resolvedFull))
      return label;
    return `${label} (→ ${resolvedFull.replace(/-\d{8}$/, "")})`;
  }
  async function showAgentsMenu(ctx) {
    reloadCustomAgents();
    const allNames = getAllTypes();
    const options = [];
    const agents2 = manager.listAgents().filter(isTopLevelAgent);
    if (agents2.length > 0) {
      const running = agents2.filter((a) => a.status === "running" || a.status === "queued").length;
      const done = agents2.filter((a) => a.status === "completed" || a.status === "steered").length;
      options.push(`Running agents (${agents2.length}) — ${running} running, ${done} done`);
    }
    if (allNames.length > 0) {
      options.push(`Agent types (${allNames.length})`);
    }
    if (scheduler.isActive()) {
      const jobCount = scheduler.list().length;
      options.push(`Scheduled jobs (${jobCount})`);
    }
    if (isWorkflowsEnabled()) {
      options.push(`Workflows (${workflowTasks.size})`);
    }
    options.push("Create new agent");
    options.push("Settings");
    const noAgentsMsg = allNames.length === 0 && agents2.length === 0 ? `No agents found. Create specialized subagents that can be delegated to.

` + `Each subagent has its own context window, custom system prompt, and specific tools.

` + `Try creating: Code Reviewer, Security Auditor, Test Writer, or Documentation Writer.

` : "";
    if (noAgentsMsg) {
      ctx.ui.notify(noAgentsMsg, "info");
    }
    const choice = await ctx.ui.select("Agents", options);
    if (!choice)
      return;
    if (choice.startsWith("Running agents (")) {
      await showRunningAgents(ctx);
      await showAgentsMenu(ctx);
    } else if (choice.startsWith("Agent types (")) {
      await showAllAgentsList(ctx);
      await showAgentsMenu(ctx);
    } else if (choice.startsWith("Scheduled jobs (")) {
      await showSchedulesMenu(ctx, scheduler);
      await showAgentsMenu(ctx);
    } else if (choice.startsWith("Workflows (")) {
      await showWorkflowsMenu(ctx, workflowMenuDeps);
      await showAgentsMenu(ctx);
    } else if (choice === "Create new agent") {
      await showCreateWizard(ctx);
    } else if (choice === "Settings") {
      await showSettings(ctx);
      await showAgentsMenu(ctx);
    }
  }
  function packageNameOf(cfg) {
    if (cfg?.source !== "package" || !cfg.sourcePath)
      return;
    return packageNameForPath(cfg.sourcePath, process.cwd());
  }
  async function showAllAgentsList(ctx) {
    const allNames = getAllTypes();
    if (allNames.length === 0) {
      ctx.ui.notify("No agents.", "info");
      return;
    }
    const configs = allNames.map((name) => getAgentConfig(name));
    const items = allNames.map((name, i) => {
      const cfg = configs[i];
      const model = getModelLabel(name, ctx.modelRegistry, ctx.model);
      return {
        id: name,
        label: `${sourceIndicator(cfg)}${name}`,
        currentValue: model,
        description: rowDescription(name, cfg, packageNameOf(cfg)),
        values: [model]
      };
    });
    const legend = sourceLegend(configs);
    const selected = await ctx.ui.custom((_tui, _theme, _kb, done) => {
      const slTheme = getSettingsListTheme();
      const list = new SettingsList(items, Math.min(items.length, 12), slTheme, (id) => done(id), () => done(undefined));
      const container = new Container;
      container.addChild(new Text2("Agent types", 0, 0));
      if (legend)
        container.addChild(new Text2(slTheme.hint(legend), 0, 0));
      container.addChild(new Spacer(1));
      container.addChild(list);
      return {
        render: (w2) => container.render(w2),
        invalidate: () => container.invalidate(),
        handleInput: (data) => list.handleInput?.(data)
      };
    });
    if (selected && getAgentConfig(selected)) {
      await showAgentDetail(ctx, selected);
      await showAllAgentsList(ctx);
    }
  }
  async function showRunningAgents(ctx) {
    const agents2 = manager.listAgents().filter(isTopLevelAgent);
    if (agents2.length === 0) {
      ctx.ui.notify("No agents.", "info");
      return;
    }
    const record = await selectItem(ctx.ui, "Running agents", agents2, (a) => {
      const dn = getDisplayName(a.type);
      const dur = formatDuration(a.startedAt, a.completedAt);
      return `${dn} (${a.description}) · ${a.toolUses} tools · ${a.status} · ${dur}`;
    });
    if (!record)
      return;
    await viewAgentConversation(ctx, record);
    await showRunningAgents(ctx);
  }
  async function viewAgentConversation(ctx, record) {
    if (!record.session) {
      ctx.ui.notify(`Agent is ${record.status === "queued" ? "queued" : "expired"} — no session available.`, "info");
      return;
    }
    const session = record.session;
    const activity = agentActivity.get(record.id);
    let overlayOptions = getConversationOverlayOptions({ mode: "regular" });
    await ctx.ui.custom((tui, theme, keybindings, done) => {
      overlayOptions = getConversationOverlayOptions(tui);
      return new ConversationViewer(tui, session, record, activity, theme, done, () => {
        if (manager.abort(record.id)) {
          ctx.ui.notify(`Stopped "${record.description}".`, "info");
        }
      }, keybindings, (message) => manager.steer(record.id, message), showCost, getViewerMarkdown, (mode) => chooseViewerMarkdown(mode, ctx), getFullscreenScrollbar(), backgroundActionFor(record, (message) => ctx.ui.notify(message, "info")));
    }, {
      overlay: true,
      overlayOptions: () => overlayOptions
    });
  }
  async function showAgentDetail(ctx, name) {
    const cfg = getAgentConfig(name);
    if (!cfg) {
      ctx.ui.notify(`Agent config not found for "${name}".`, "warning");
      return;
    }
    const isPackage = cfg.source === "package";
    const file = locateAgentFile(name, cfg.sourcePath, undefined, cfg.source);
    const isDefault = cfg.isDefault === true;
    const disabled = cfg.enabled === false;
    let menuOptions;
    if (isPackage) {
      menuOptions = disabled ? ["Eject (export as .md)", "Back"] : ["Eject (export as .md)", "Disable", "Back"];
    } else if (disabled && file) {
      menuOptions = isDefault ? ["Enable", "Edit", "Reset to default", "Delete", "Back"] : ["Enable", "Edit", "Delete", "Back"];
    } else if (isDefault && !file) {
      menuOptions = ["Eject (export as .md)", "Disable", "Back"];
    } else if (isDefault && file) {
      menuOptions = ["Edit", "Disable", "Reset to default", "Delete", "Back"];
    } else {
      menuOptions = ["Edit", "Disable", "Delete", "Back"];
    }
    const pkgName = packageNameOf(cfg);
    const choice = await ctx.ui.select(pkgName ? `${name} — ${pkgName}` : name, menuOptions);
    if (!choice || choice === "Back")
      return;
    if (choice === "Edit" && file) {
      const content = readFileSync10(file.path, "utf-8");
      const edited = await ctx.ui.editor(`Edit ${name}`, content);
      if (edited !== undefined && edited !== content) {
        const { writeFileSync: writeFileSync5 } = await import("node:fs");
        writeFileSync5(file.path, edited, "utf-8");
        reloadCustomAgents();
        ctx.ui.notify(`Updated ${file.path}`, "info");
      }
    } else if (choice === "Delete") {
      if (file) {
        const confirmed = await ctx.ui.confirm("Delete agent", `Delete ${name} from ${file.location} (${file.path})?`);
        if (confirmed) {
          unlinkSync2(file.path);
          reloadCustomAgents();
          ctx.ui.notify(`Deleted ${file.path}`, "info");
        }
      }
    } else if (choice === "Reset to default" && file) {
      const confirmed = await ctx.ui.confirm("Reset to default", `Delete override ${file.path} and restore embedded default?`);
      if (confirmed) {
        unlinkSync2(file.path);
        reloadCustomAgents();
        ctx.ui.notify(`Restored default ${name}`, "info");
      }
    } else if (choice.startsWith("Eject")) {
      await ejectAgent(ctx, name, cfg);
    } else if (choice === "Disable") {
      await disableAgent(ctx, name);
    } else if (choice === "Enable") {
      await enableAgent(ctx, name);
    }
  }
  async function ejectAgent(ctx, name, cfg) {
    const location = await ctx.ui.select("Choose location", [
      "Project (.pi/agents/)",
      `Personal (${personalAgentsDir()})`
    ]);
    if (!location)
      return;
    const targetDir = location.startsWith("Project") ? projectAgentsDir() : personalAgentsDir();
    mkdirSync5(targetDir, { recursive: true });
    const targetPath = join13(targetDir, `${name}.md`);
    if (existsSync13(targetPath)) {
      const overwrite = await ctx.ui.confirm("Overwrite", `${targetPath} already exists. Overwrite?`);
      if (!overwrite)
        return;
    }
    const content = serializeAgentFile(cfg);
    const { writeFileSync: writeFileSync5 } = await import("node:fs");
    writeFileSync5(targetPath, content, "utf-8");
    reloadCustomAgents();
    ctx.ui.notify(`Ejected ${name} to ${targetPath}`, "info");
  }
  async function disableAgent(ctx, name) {
    const cfg = getAgentConfig(name);
    const file = locateAgentFile(name, cfg?.sourcePath, undefined, cfg?.source);
    if (file) {
      const content = readFileSync10(file.path, "utf-8");
      const { content: updated, outcome } = disableInContent(content);
      if (outcome === "already-disabled") {
        ctx.ui.notify(`${name} is already disabled.`, "info");
        return;
      }
      if (outcome === "no-frontmatter") {
        ctx.ui.notify(`Cannot disable ${name}: ${file.path} has no frontmatter block.`, "error");
        return;
      }
      const { writeFileSync: writeFileSync6 } = await import("node:fs");
      writeFileSync6(file.path, updated, "utf-8");
      reloadCustomAgents();
      ctx.ui.notify(`Disabled ${name} (${file.path})`, "info");
      return;
    }
    const location = await ctx.ui.select("Choose location", [
      "Project (.pi/agents/)",
      `Personal (${personalAgentsDir()})`
    ]);
    if (!location)
      return;
    const targetDir = location.startsWith("Project") ? projectAgentsDir() : personalAgentsDir();
    mkdirSync5(targetDir, { recursive: true });
    const targetPath = join13(targetDir, `${name}.md`);
    const { writeFileSync: writeFileSync5 } = await import("node:fs");
    writeFileSync5(targetPath, `---
enabled: false
---
`, "utf-8");
    reloadCustomAgents();
    ctx.ui.notify(`Disabled ${name} (${targetPath})`, "info");
  }
  async function enableAgent(ctx, name) {
    const cfg = getAgentConfig(name);
    const file = locateAgentFile(name, cfg?.sourcePath, undefined, cfg?.source);
    if (!file)
      return;
    const content = readFileSync10(file.path, "utf-8");
    const { content: updated, changed } = enableInContent(content);
    if (!changed && !isEmptyStub(updated)) {
      ctx.ui.notify(`${name} is not disabled in ${file.path}.`, "info");
      return;
    }
    const { writeFileSync: writeFileSync5 } = await import("node:fs");
    if (isEmptyStub(updated)) {
      unlinkSync2(file.path);
      reloadCustomAgents();
      ctx.ui.notify(`Enabled ${name} (removed ${file.path})`, "info");
    } else {
      writeFileSync5(file.path, updated, "utf-8");
      reloadCustomAgents();
      ctx.ui.notify(`Enabled ${name} (${file.path})`, "info");
    }
  }
  async function showCreateWizard(ctx) {
    const location = await ctx.ui.select("Choose location", [
      "Project (.pi/agents/)",
      `Personal (${personalAgentsDir()})`
    ]);
    if (!location)
      return;
    const targetDir = location.startsWith("Project") ? projectAgentsDir() : personalAgentsDir();
    const method = await ctx.ui.select("Creation method", [
      "Generate with Claude (recommended)",
      "Manual configuration"
    ]);
    if (!method)
      return;
    if (method.startsWith("Generate")) {
      await showGenerateWizard(ctx, targetDir);
    } else {
      await showManualWizard(ctx, targetDir);
    }
  }
  async function showGenerateWizard(ctx, targetDir) {
    const description = await ctx.ui.input("Describe what this agent should do");
    if (!description)
      return;
    const name = await ctx.ui.input("Agent name (filename, no spaces)");
    if (!name)
      return;
    mkdirSync5(targetDir, { recursive: true });
    const targetPath = join13(targetDir, `${name}.md`);
    if (existsSync13(targetPath)) {
      const overwrite = await ctx.ui.confirm("Overwrite", `${targetPath} already exists. Overwrite?`);
      if (!overwrite)
        return;
    }
    ctx.ui.notify("Generating agent definition...", "info");
    const generatePrompt = `Create a custom pi sub-agent definition file based on this description: "${description}"

Write a markdown file to: ${targetPath}

The file format is a markdown file with YAML frontmatter and a system prompt body:

\`\`\`markdown
---
description: <one-line description shown in UI>
color: <optional agent name badge color: red, blue, green, yellow, purple, orange, pink, cyan, an Agency Agents alias, or quoted "#RRGGBB">
tools: <comma-separated built-in tools: read, bash, edit, write, grep, find, ls. Use "none" for no tools. Omit for all tools>
model: <optional model as "provider/modelId", e.g. "anthropic/claude-haiku-4-5". Omit to inherit parent model>
thinking: <optional thinking level: ${THINKING_LEVELS.join(", ")}. Omit to inherit>
max_turns: <optional max agentic turns. 0 or omit for unlimited (default)>
prompt_mode: <"replace" (body IS the full system prompt) or "append" (body is appended to default prompt). Default: replace>
extensions: <true (inherit all MCP/extension tools), false (none), or comma-separated names. Default: true>
skills: <true (inherit all), false (none), or comma-separated skill names to preload into prompt. Default: true>
disallowed_tools: <comma-separated tool names to block, even if otherwise available. Omit for none>
inherit_context: <true to fork parent conversation into agent so it sees chat history. Default: false>
run_in_background: <pin this agent to background (true) or foreground (false). Omit to follow the backgroundByDefault setting, which is background>
output_transcript: <false to write no transcript file or path for this agent. Independent of persist_session. Default: true>
isolated: <true for no extension/MCP tools, only built-in tools. Default: false>
memory: <"user" (global), "project" (per-project), or "local" (gitignored per-project) for persistent memory. Omit for none>${isWorktreeIsolationEnabled() ? `
isolation: <"worktree" to run in isolated git worktree; "off" to refuse one even when the caller asks. Omit for normal>` : ""}
---

<system prompt body — instructions for the agent>
\`\`\`

Guidelines for choosing settings:
- For read-only tasks (review, analysis): tools: read, bash, grep, find, ls
- For code modification tasks: include edit, write
- Use prompt_mode: append if the agent should keep the default system prompt and add specialization on top
- Use prompt_mode: replace for fully custom agents with their own personality/instructions
- Set inherit_context: true if the agent needs to know what was discussed in the parent conversation
- Set isolated: true if the agent should NOT have access to MCP servers or other extensions
- Set output_transcript: false to skip writing this agent's transcript; this alone doesn't keep the run off disk (persist_session, isolation: worktree commits, and memory still write) — set those too if that's the goal
- Only include frontmatter fields that differ from defaults — omit fields where the default is fine

Write the file using the write tool. Only write the file, nothing else.`;
    const { record } = await manager.spawnAndWait(pi, ctx, "general-purpose", generatePrompt, {
      description: `Generate ${name} agent`,
      maxTurns: 5,
      bypassQueue: true
    });
    if (record.status === "error") {
      ctx.ui.notify(`Generation failed: ${record.error}`, "warning");
      return;
    }
    reloadCustomAgents();
    if (existsSync13(targetPath)) {
      ctx.ui.notify(`Created ${targetPath}`, "info");
    } else {
      ctx.ui.notify("Agent generation completed but file was not created. Check the agent output.", "warning");
    }
  }
  async function showManualWizard(ctx, targetDir) {
    const name = await ctx.ui.input("Agent name (filename, no spaces)");
    if (!name)
      return;
    const description = await ctx.ui.input("Description (one line)");
    if (!description)
      return;
    const toolChoice = await ctx.ui.select("Tools", ["all", "none", "read-only (read, bash, grep, find, ls)", "custom..."]);
    if (!toolChoice)
      return;
    let tools;
    if (toolChoice === "all") {
      tools = BUILTIN_TOOL_NAMES.join(", ");
    } else if (toolChoice === "none") {
      tools = "none";
    } else if (toolChoice.startsWith("read-only")) {
      tools = "read, bash, grep, find, ls";
    } else {
      const customTools = await ctx.ui.input("Tools (comma-separated)", BUILTIN_TOOL_NAMES.join(", "));
      if (!customTools)
        return;
      tools = customTools;
    }
    const modelChoice = await ctx.ui.select("Model", [
      "inherit (parent model)",
      "haiku",
      "sonnet",
      "opus",
      "custom..."
    ]);
    if (!modelChoice)
      return;
    let model;
    if (modelChoice === "haiku")
      model = "anthropic/claude-haiku-4-5";
    else if (modelChoice === "sonnet")
      model = "anthropic/claude-sonnet-4-6";
    else if (modelChoice === "opus")
      model = "anthropic/claude-opus-4-6";
    else if (modelChoice === "custom...") {
      model = await ctx.ui.input("Model (provider/modelId)") || undefined;
    }
    const thinkingChoice = await ctx.ui.select("Thinking level", ["inherit", ...THINKING_LEVELS]);
    if (!thinkingChoice)
      return;
    const systemPrompt = await ctx.ui.editor("System prompt", "");
    if (systemPrompt === undefined)
      return;
    const content = buildNewAgentFile({
      description,
      tools,
      model,
      thinking: thinkingChoice === "inherit" ? undefined : thinkingChoice,
      systemPrompt
    });
    mkdirSync5(targetDir, { recursive: true });
    const targetPath = join13(targetDir, `${name}.md`);
    if (existsSync13(targetPath)) {
      const overwrite = await ctx.ui.confirm("Overwrite", `${targetPath} already exists. Overwrite?`);
      if (!overwrite)
        return;
    }
    const { writeFileSync: writeFileSync5 } = await import("node:fs");
    writeFileSync5(targetPath, content, "utf-8");
    reloadCustomAgents();
    ctx.ui.notify(`Created ${targetPath}`, "info");
  }
  function snapshotSettings() {
    return {
      maxConcurrent: manager.getMaxConcurrent(),
      maxConcurrentForeground: manager.getMaxConcurrentForeground(),
      defaultMaxTurns: getDefaultMaxTurns() ?? 0,
      graceTurns: getGraceTurns(),
      defaultJoinMode: getDefaultJoinMode(),
      backgroundByDefault: getBackgroundByDefault(),
      schedulingEnabled: isSchedulingEnabled(),
      scopeModels: isScopeModelsEnabled(),
      strictAgentFiles,
      disableDefaultAgents: isDefaultsDisabled(),
      toolDescriptionMode: getToolDescriptionMode(),
      fleetView: isFleetViewEnabled(),
      agentMentions: getAgentMentionMode(),
      rememberAgents: getRememberAgents(),
      widgetMode: getWidgetMode(),
      outputTranscript: getOutputTranscriptDefault(),
      worktreeIsolation: isWorktreeIsolationEnabled(),
      workflowsEnabled: isWorkflowsPinned() ? isWorkflowsEnabled() : undefined,
      maxSubagentDepth: getMaxSubagentDepth(),
      fallbackSubagent: getFallbackSubagent(),
      reportUsage: isReportUsageEnabled(),
      showCost: isShowCostEnabled(),
      showModel: isShowModelEnabled(),
      viewerMarkdown: getViewerMarkdown(),
      packageAgents: getPackageAgentsGate(),
      packageWorkflows: getPackageWorkflowsGate()
    };
  }
  const _settingsSnapshotIsComplete = true;
  function gateAdmitsAnything(gate) {
    if (gate === undefined || gate === true)
      return true;
    if (gate === false)
      return false;
    return gate.length > 0;
  }
  function describeGateSetting(gate, base) {
    if (!Array.isArray(gate))
      return base;
    return gate.length > 0 ? `${base} Currently limited to: ${gate.join(", ")}.` : `${base} Currently limited to an empty list, so nothing loads.`;
  }
  const NUMERIC_IDS = new Set([
    "maxConcurrent",
    "maxConcurrentForeground",
    "defaultMaxTurns",
    "graceTurns",
    "maxSubagentDepth"
  ]);
  async function showSettings(ctx) {
    function buildItems() {
      const mc = manager.getMaxConcurrent();
      const mcf = manager.getMaxConcurrentForeground();
      const dmt = getDefaultMaxTurns() ?? 0;
      const gt = getGraceTurns();
      const msd = getMaxSubagentDepth();
      const fallbackValue = getFallbackSubagent() ?? "general-purpose";
      const fallbackValues = [...new Set([...getAvailableTypes(), NO_FALLBACK])];
      return [
        {
          id: "maxConcurrent",
          label: "Max concurrency",
          description: "Max concurrent background agents (Enter to type)",
          currentValue: String(mc),
          values: [String(mc)]
        },
        {
          id: "maxConcurrentForeground",
          label: "Max foreground concurrency",
          description: "Max concurrent foreground (blocking) agents (0 = unlimited, Enter to type)",
          currentValue: String(mcf),
          values: [String(mcf)]
        },
        {
          id: "defaultMaxTurns",
          label: "Default max turns",
          description: "Default max turns before wrap-up (0 = unlimited, Enter to type)",
          currentValue: String(dmt),
          values: [String(dmt)]
        },
        {
          id: "graceTurns",
          label: "Grace turns",
          description: "Grace turns after wrap-up steer (Enter to type)",
          currentValue: String(gt),
          values: [String(gt)]
        },
        {
          id: "maxSubagentDepth",
          label: "Nested depth",
          description: "Hard cap on nested delegation — main is 0, its subagents 1 (0/1 = nesting off, Enter to type)",
          currentValue: String(msd),
          values: [String(msd)]
        },
        {
          id: "joinMode",
          label: "Join mode",
          description: "smart = each completion at the parent's next boundary, as in Claude Code; group = one notification per turn's batch",
          currentValue: getDefaultJoinMode() === "group" ? "group" : "smart",
          values: ["smart", "group"]
        },
        {
          id: "backgroundByDefault",
          label: "Background by default",
          description: "An Agent call that doesn't say runs detached (off = blocks the turn and returns inline)",
          currentValue: getBackgroundByDefault() ? "on" : "off",
          values: ["on", "off"]
        },
        {
          id: "schedulingEnabled",
          label: "Scheduling",
          description: "Schedule subagent feature (off removes `schedule` param from Agent tool spec on next pi session)",
          currentValue: isSchedulingEnabled() ? "on" : "off",
          values: ["on", "off"]
        },
        {
          id: "workflowsEnabled",
          label: "Workflows",
          description: "Scripted workflows, on unless another extension provides a workflow tool (off keeps the SubagentWorkflow tool out of the tool spec; applies on next pi session)",
          currentValue: isWorkflowsEnabled() ? "on" : "off",
          values: ["on", "off"]
        },
        {
          id: "packageAgents",
          label: "Package agents",
          description: describeGateSetting(getPackageAgentsGate(), "Load agents declared by installed pi packages (`pi.subagents.agents` in their package.json). They rank below your global and project agents, so a same-named local file always wins."),
          currentValue: gateAdmitsAnything(getPackageAgentsGate()) ? "on" : "off",
          values: ["on", "off"]
        },
        {
          id: "packageWorkflows",
          label: "Package workflows",
          description: describeGateSetting(getPackageWorkflowsGate(), "Resolve saved workflow names against scripts declared by installed pi packages (`pi.subagents.workflows`). Searched last, after your project, workspace and personal directories."),
          currentValue: gateAdmitsAnything(getPackageWorkflowsGate()) ? "on" : "off",
          values: ["on", "off"]
        },
        {
          id: "scopeModels",
          label: "Scope models",
          description: "Validate subagent models against scoped models (/scoped-models)",
          currentValue: isScopeModelsEnabled() ? "on" : "off",
          values: ["on", "off"]
        },
        {
          id: "strictAgentFiles",
          label: "Strict agent files",
          description: "Fail startup on an unreadable/unparseable agent .md instead of skipping it with a warning",
          currentValue: strictAgentFiles ? "on" : "off",
          values: ["on", "off"]
        },
        {
          id: "disableDefaultAgents",
          label: "Disable defaults",
          description: "Hide built-in agents (general-purpose, Explore, Plan) — custom agents are unaffected",
          currentValue: isDefaultsDisabled() ? "on" : "off",
          values: ["on", "off"]
        },
        {
          id: "fallbackSubagent",
          label: "Fallback agent",
          description: `Agent used when subagent_type is unknown, disabled, or ambiguous; "${NO_FALLBACK}" rejects the call instead (strict dispatch)`,
          currentValue: fallbackValue,
          values: fallbackValues
        },
        {
          id: "outputTranscript",
          label: "Output transcript",
          description: "Write each subagent's .output transcript by default. A custom agent's output_transcript frontmatter overrides this.",
          currentValue: getOutputTranscriptDefault() ? "on" : "off",
          values: ["on", "off"]
        },
        {
          id: "worktreeIsolation",
          label: "Worktree isolation",
          description: "Allow isolation: worktree to copy the repo. Off refuses worktrees on every path immediately — for repos where a copy costs too much time or disk — and drops the `isolation` param from the Agent tool spec on next pi session.",
          currentValue: isWorktreeIsolationEnabled() ? "on" : "off",
          values: ["on", "off"]
        },
        {
          id: "reportUsage",
          label: "Report usage to session",
          description: "Add subagent tokens and cost to this session's own totals, so pi's footer and /cost stop reading a delegating session as nearly free. Reported on the next tool result (agents that finish in the background are counted on the one after). Context-window % is unaffected.",
          currentValue: isReportUsageEnabled() ? "on" : "off",
          values: ["on", "off"]
        },
        {
          id: "showCost",
          label: "Show cost",
          description: "Show an estimated `~$0.0042` beside subagent token counts in the widget, fleet view, results and notifications. Priced by pi from the model's rates — omitted entirely for a model it has no rates for.",
          currentValue: isShowCostEnabled() ? "on" : "off",
          values: ["on", "off"]
        },
        {
          id: "showModel",
          label: "Show model",
          description: "Name the model driving each agent, and the thinking level it is running at, on the widget's running rows. The Agent tool result and the conversation viewer show the pair either way — this adds it to the widget, where the row is already dense.",
          currentValue: isShowModelEnabled() ? "on" : "off",
          values: ["on", "off"]
        },
        {
          id: "viewerMarkdown",
          label: "Viewer markdown",
          description: "How much of the conversation viewer renders as Markdown. assistant = assistant text only (default); all = tool results too, for tools that emit Markdown — accepting that a Markdown pass over a diff or a log eats `#` comments, swallows a `---` line and re-fences indented output; off = everything verbatim. `m` in the viewer cycles the same setting (footer: raw / md / md+).",
          currentValue: getViewerMarkdown(),
          values: ["off", "assistant", "all"]
        },
        {
          id: "fleetView",
          label: "Fleet view",
          description: "Claude Code-style main+subagents list below the editor (↓/← to navigate, Enter to view)",
          currentValue: isFleetViewEnabled() ? "on" : "off",
          values: ["on", "off"]
        },
        {
          id: "agentMentions",
          label: "Agent mentions",
          description: "Route `@handle message` at the prompt to that agent. model = an off-screen clone of this conversation calls the Agent tool, so the agent gets a context-written prompt, a transcript and per-tool detail, and the chat stays clean; direct = started here from your text, no model call. Messaging and resuming are direct either way.",
          currentValue: getAgentMentionMode(),
          values: ["model", "direct", "off"]
        },
        {
          id: "rememberAgents",
          label: "Remember agents",
          description: "Persist subagent sessions so `@handle` can resume one long after it finished (they also appear in /resume)",
          currentValue: getRememberAgents() ? "on" : "off",
          values: ["on", "off"]
        },
        {
          id: "widgetMode",
          label: "Widget",
          description: "Above-editor agent widget: all = every agent; background = hide foreground (they already render inline); off = hide the widget.",
          currentValue: getWidgetMode(),
          values: ["all", "background", "off"]
        },
        {
          id: "toolDescriptionMode",
          label: "Tool description",
          description: "Agent tool description sent to the LLM: full (rich, default), compact (~75% fewer tokens, for small/local models), or custom (.pi/agent-tool-description.md with {{placeholders}})",
          currentValue: getToolDescriptionMode(),
          values: ["full", "compact", "custom"]
        }
      ];
    }
    function applyValue(id, value) {
      if (id === "maxConcurrent") {
        const n = parseInt(value, 10);
        if (n >= 1) {
          manager.setMaxConcurrent(n);
          notifyApplied(ctx, `Max concurrency set to ${n}`);
        }
      } else if (id === "maxConcurrentForeground") {
        const n = parseInt(value, 10);
        if (n >= 0) {
          manager.setMaxConcurrentForeground(n);
          notifyApplied(ctx, n === 0 ? "Max foreground concurrency set to unlimited" : `Max foreground concurrency set to ${n}`);
        }
      } else if (id === "defaultMaxTurns") {
        const n = parseInt(value, 10);
        if (n === 0) {
          setDefaultMaxTurns(undefined);
          notifyApplied(ctx, "Default max turns set to unlimited");
        } else if (n >= 1) {
          setDefaultMaxTurns(n);
          notifyApplied(ctx, `Default max turns set to ${n}`);
        }
      } else if (id === "graceTurns") {
        const n = parseInt(value, 10);
        if (n >= 1) {
          setGraceTurns(n);
          notifyApplied(ctx, `Grace turns set to ${n}`);
        }
      } else if (id === "maxSubagentDepth") {
        const n = parseInt(value, 10);
        if (n >= 0) {
          setMaxSubagentDepth(n);
          notifyApplied(ctx, n <= 1 ? "Nested delegation disabled" : `Nested depth set to ${n}. Applies to agents started from now on.`);
        }
      } else if (id === "joinMode") {
        setDefaultJoinMode(value);
        notifyApplied(ctx, `Default join mode set to ${value}`);
      } else if (id === "backgroundByDefault") {
        const enabled = value === "on";
        setBackgroundByDefault(enabled);
        notifyApplied(ctx, enabled ? "Agent calls run in the background unless they pass run_in_background: false" : "Agent calls block and return inline unless they pass run_in_background: true");
      } else if (id === "schedulingEnabled") {
        const enabled = value === "on";
        if (enabled === isSchedulingEnabled()) {
          ctx.ui.notify(`Scheduling already ${enabled ? "enabled" : "disabled"}.`, "info");
        } else {
          setSchedulingEnabled(enabled);
          if (!enabled)
            scheduler.stop();
          notifyApplied(ctx, `Scheduling ${enabled ? "enabled" : "disabled"}. Tool spec change takes effect on next pi session.`);
        }
      } else if (id === "workflowsEnabled") {
        const enabled = value === "on";
        if (enabled === isWorkflowsEnabled()) {
          ctx.ui.notify(`Workflows already ${enabled ? "enabled" : "disabled"}.`, "info");
        } else {
          setWorkflowsEnabled(enabled);
          notifyApplied(ctx, `Workflows ${enabled ? "enabled" : "disabled"}. Tool spec change takes effect on next pi session.`);
        }
      } else if (id === "scopeModels") {
        const enabled = value === "on";
        setScopeModelsEnabled(enabled);
        notifyApplied(ctx, `Scope models ${enabled ? "enabled" : "disabled"}`);
      } else if (id === "strictAgentFiles") {
        const enabled = value === "on";
        strictAgentFiles = enabled;
        notifyApplied(ctx, `Strict agent files ${enabled ? "enabled" : "disabled"}. Takes effect on next pi session.`);
      } else if (id === "disableDefaultAgents") {
        const enabled = value === "on";
        setDisableDefaultAgents(enabled);
        notifyApplied(ctx, `Default agents ${enabled ? "disabled" : "enabled"}. Tool spec change takes effect on next pi session.`);
      } else if (id === "fallbackSubagent") {
        setFallbackSubagent(value);
        notifyApplied(ctx, value === NO_FALLBACK ? "Unknown or disabled agent types will now be rejected" : `Unknown agent types will fall back to ${value}`);
      } else if (id === "outputTranscript") {
        const enabled = value === "on";
        setOutputTranscriptDefault(enabled);
        notifyApplied(ctx, `Output transcript ${enabled ? "enabled" : "disabled"} by default`);
      } else if (id === "worktreeIsolation") {
        const enabled = value === "on";
        setWorktreeIsolationEnabled(enabled);
        notifyApplied(ctx, `Worktree isolation ${enabled ? "enabled" : "disabled"}. Tool parameter updates on next pi session.`);
      } else if (id === "packageAgents" || id === "packageWorkflows") {
        const enabled = value === "on";
        const isAgents = id === "packageAgents";
        const previous = isAgents ? getPackageAgentsGate() : getPackageWorkflowsGate();
        (isAgents ? setPackageAgentsGate : setPackageWorkflowsGate)(enabled);
        reloadCustomAgents();
        const label = isAgents ? "Package agents" : "Package workflows";
        const replaced = Array.isArray(previous) && previous.length > 0 ? ` Replaced the allowlist (${previous.join(", ")}) — re-add it in .pi/subagents.json to narrow it again.` : "";
        const specNote = isAgents ? " Tool spec change takes effect on next pi session." : "";
        notifyApplied(ctx, `${label} ${enabled ? "enabled" : "disabled"}.${replaced}${specNote}`);
      } else if (id === "toolDescriptionMode") {
        setToolDescriptionMode(value);
        notifyApplied(ctx, `Tool description set to ${value}. Takes effect on next pi session.`);
      } else if (id === "reportUsage") {
        const enabled = value === "on";
        setReportUsage(enabled);
        notifyApplied(ctx, enabled ? "Subagent usage now counted in this session's totals" : "Subagent usage no longer counted in this session's totals");
      } else if (id === "showCost") {
        const enabled = value === "on";
        setShowCost(enabled);
        notifyApplied(ctx, `Cost display ${enabled ? "enabled" : "disabled"}`);
      } else if (id === "showModel") {
        const enabled = value === "on";
        setShowModel(enabled);
        notifyApplied(ctx, `Model display ${enabled ? "enabled" : "disabled"}`);
      } else if (id === "viewerMarkdown") {
        setViewerMarkdown(value);
        notifyApplied(ctx, `Viewer markdown set to ${value}`);
      } else if (id === "fleetView") {
        const enabled = value === "on";
        setFleetViewEnabled(enabled);
        notifyApplied(ctx, `Fleet view ${enabled ? "enabled" : "disabled"}`);
      } else if (id === "agentMentions") {
        const mode = value;
        setAgentMentionMode(mode);
        notifyApplied(ctx, mode === "off" ? "Agent mentions disabled" : mode === "model" ? "Agent mentions on — a conversation clone starts a mentioned agent off-screen" : "Agent mentions on — a mentioned agent starts here, with no model call");
      } else if (id === "rememberAgents") {
        const enabled = value === "on";
        setRememberAgents(enabled);
        notifyApplied(ctx, `Remember agents ${enabled ? "enabled" : "disabled"}`);
      } else if (id === "widgetMode") {
        setWidgetMode(value);
        notifyApplied(ctx, `Widget set to ${value}`);
      }
    }
    let list;
    let currentIndex = 0;
    const result = await ctx.ui.custom((_tui, _theme, _kb, done) => {
      const items = buildItems();
      list = new SettingsList(items, items.length + 2, getSettingsListTheme(), (id, newValue) => {
        applyValue(id, newValue);
      }, () => done(undefined));
      const container = new Container;
      container.addChild(new Text2("⚙  Subagent Settings", 0, 0));
      container.addChild(new Spacer(1));
      container.addChild(list);
      return {
        render: (w2) => container.render(w2),
        invalidate: () => container.invalidate(),
        handleInput: (data) => {
          if (matchesKey5(data, "up")) {
            currentIndex = Math.max(0, currentIndex - 1);
          } else if (matchesKey5(data, "down")) {
            currentIndex = Math.min(items.length - 1, currentIndex + 1);
          }
          if (matchesKey5(data, Key2.enter) && NUMERIC_IDS.has(items[currentIndex].id)) {
            done(items[currentIndex].id);
            return;
          }
          list.handleInput?.(data);
        }
      };
    });
    if (result && NUMERIC_IDS.has(result)) {
      const current = result === "maxConcurrent" ? String(manager.getMaxConcurrent()) : result === "maxConcurrentForeground" ? String(manager.getMaxConcurrentForeground()) : result === "defaultMaxTurns" ? String(getDefaultMaxTurns() ?? 0) : result === "maxSubagentDepth" ? String(getMaxSubagentDepth()) : String(getGraceTurns());
      const label = result === "maxConcurrent" ? "Max concurrency (1+)" : result === "maxConcurrentForeground" ? "Max foreground concurrency (0 = unlimited)" : result === "defaultMaxTurns" ? "Default max turns (0 = unlimited)" : result === "maxSubagentDepth" ? "Nested depth (0/1 = nesting off)" : "Grace turns (1+)";
      let input = await ctx.ui.input(label, current);
      while (input != null) {
        const trimmed = input.trim();
        const n = Number(trimmed);
        if (trimmed !== "" && Number.isInteger(n)) {
          applyValue(result, String(n));
          await showSettings(ctx);
          return;
        }
        input = await ctx.ui.input(label, trimmed);
      }
    }
  }
  function persistSettings(ctx, changeMsg) {
    const { message, level } = saveAndEmitChanged(snapshotSettings(), changeMsg, (event, payload) => pi.events.emit(event, payload));
    if (level === "warning")
      ctx?.ui.notify(message, level);
  }
  function notifyApplied(ctx, successMsg) {
    const { message, level } = saveAndEmitChanged(snapshotSettings(), successMsg, (event, payload) => pi.events.emit(event, payload));
    ctx.ui.notify(message, level);
  }
  pi.registerCommand("agents", {
    description: "Manage agents",
    handler: async (_args, ctx) => {
      await showAgentsMenu(ctx);
    }
  });
  const workflowMenuDeps = {
    tasks: workflowTasks,
    getRecord: (id) => manager.getRecord(id),
    viewAgentConversation,
    getCtx: () => currentCtx
  };
  fleet.setWorkflowSource(fleetWorkflows, (id) => openWorkflowFromFleet(id, workflowMenuDeps));
}
export {
  workflowEntryData,
  renderRunningAgentStatus,
  formatToolsSuffix,
  subagent_default as default,
  WORKFLOW_FILE_FLAG,
  WORKFLOW_ENTRY_TYPE,
  FOREIGN_WORKFLOW_TOOL_NAMES
};
