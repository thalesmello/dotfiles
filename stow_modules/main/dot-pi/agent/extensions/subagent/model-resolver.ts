/**
 * Model resolution: exact match ("provider/modelId") with fuzzy fallback.
 */

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
}

export interface ModelRegistry {
  find(provider: string, modelId: string): any;
  getAll(): any[];
  getAvailable?(): any[];
  hasConfiguredAuth?(model: any): boolean;
}

type ModelTier = "fast" | "balanced" | "deep";

export const PROVIDER_TIER_CANDIDATES: Record<string, Record<ModelTier, string[]>> = {
  anthropic: {
    fast: ["claude-haiku-5-5", "claude-haiku-4-5"],
    balanced: ["claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-sonnet-4-5"],
    deep: [
      "claude-opus-5-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-opus-4-5",
    ],
  },
  google: {
    fast: [
      "gemini-3.8-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
    ],
    balanced: ["gemini-4-argon", "gemini-3.1-pro-preview", "gemini-2.5-pro"],
    deep: ["gemini-4-argon", "gemini-3.1-pro-preview", "gemini-2.5-pro"],
  },
  openai: {
    fast: ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-mini"],
    balanced: ["gpt-5.6-terra", "gpt-6.1-sol", "gpt-5.5"],
    deep: ["gpt-6.1-sol", "gpt-6-sol", "gpt-5.6-sol"],
  },
  meta: {
    fast: ["muse-spark-1.4-internal", "muse-spark-1.3-internal", "muse-latest"],
    balanced: ["muse-latest", "muse-spark-1.4-internal", "muse-spark-1.3-internal"],
    deep: ["muse-wonder-1.0-internal", "muse-latest"],
  },
};

const FALLBACK_PROVIDER_ORDER = ["anthropic", "google", "openai", "meta"] as const;

const CLAUDE_ALIAS_TO_TIER: Record<string, ModelTier> = {
  haiku: "fast",
  sonnet: "balanced",
  opus: "deep",
};

export function parseTierSelector(spec: string): { tier: ModelTier; preferAnthropic: boolean } | null {
  const normalized = spec.trim().toLowerCase();
  if (normalized in CLAUDE_ALIAS_TO_TIER) {
    return { tier: CLAUDE_ALIAS_TO_TIER[normalized]!, preferAnthropic: true };
  }
  if (normalized === "fast" || normalized === "balanced" || normalized === "deep") {
    return { tier: normalized, preferAnthropic: false };
  }
  return null;
}

export function resolveFamilyTierModel(
  tierMatch: { tier: ModelTier; preferAnthropic: boolean },
  registry: { find(provider: string, modelId: string): any; getAvailable?(): any[]; hasConfiguredAuth?(model: any): boolean },
  parentModel?: { provider?: string; id?: string },
): any | undefined {
  const available = registry.getAvailable?.();
  const availableKeys = available ? new Set(available.map((m: any) => `${m.provider}/${m.id}`.toLowerCase())) : undefined;
  const isAvailable = (provider: string, id: string, found: any): boolean => {
    if (availableKeys) return availableKeys.has(`${provider}/${id}`.toLowerCase());
    if (typeof registry.hasConfiguredAuth === "function") return registry.hasConfiguredAuth(found);
    return true;
  };
  const preferredProvider = tierMatch.preferAnthropic ? "anthropic" : parentModel?.provider;
  const providerOrder: string[] = [];
  if (preferredProvider && preferredProvider in PROVIDER_TIER_CANDIDATES) {
    providerOrder.push(preferredProvider);
  }
  for (const p of FALLBACK_PROVIDER_ORDER) {
    if (!providerOrder.includes(p)) providerOrder.push(p);
  }
  for (const provider of providerOrder) {
    for (const id of PROVIDER_TIER_CANDIDATES[provider]?.[tierMatch.tier] ?? []) {
      const found = registry.find(provider, id);
      if (found && isAvailable(provider, id, found)) return found;
    }
  }
  return undefined;
}

/**
 * Both display forms of a model. The short one goes on tight rows (the widget,
 * the Agent tool result), the canonical one where there is room to disambiguate
 * two providers serving a similarly-named model (the conversation viewer).
 *
 * One function, because `index.ts` labels the model it resolved before the run
 * and `agent-manager.ts` relabels it from the live session afterwards — the two
 * must agree or the label would visibly change the moment the session starts.
 */
export function describeModel(
  model: { provider: string; id: string; name?: string },
): { modelName: string; modelId: string } {
  return {
    modelName: (model.name ?? model.id).replace(/^Claude\s+/i, "").toLowerCase(),
    modelId: `${model.provider}/${model.id}`,
  };
}

/**
 * Resolve a model string to a Model instance.
 * Tries exact match first ("provider/modelId"), then fuzzy match against all available models.
 * Returns the Model on success, or an error message string on failure.
 */
export function resolveModel(
  input: string,
  registry: ModelRegistry,
  parentModel?: { provider?: string; id?: string },
): any | string {
  const tierMatch = parseTierSelector(input);
  if (tierMatch) {
    const tierModel = resolveFamilyTierModel(tierMatch, registry, parentModel);
    if (tierModel) return tierModel;
  }

  // Available models (those with auth configured)
  const all = (registry.getAvailable?.() ?? registry.getAll()) as ModelEntry[];
  const availableSet = new Set(all.map(m => `${m.provider}/${m.id}`.toLowerCase()));

  // 1. Exact match: "provider/modelId" — only if available (has auth)
  const slashIdx = input.indexOf("/");
  if (slashIdx !== -1) {
    const provider = input.slice(0, slashIdx);
    const modelId = input.slice(slashIdx + 1);
    if (availableSet.has(input.toLowerCase())) {
      const found = registry.find(provider, modelId);
      if (found) return found;
    }
  }

  // 2. Fuzzy match against available models. Normalize separators so cosmetic
  // punctuation differences still match — e.g. "claude-haiku-4.5" and
  // "claude-haiku-4-5" (dot vs dash in the version) resolve to the same model.
  const normalize = (s: string) => s.toLowerCase().replace(/\./g, "-");
  const query = normalize(input);

  // Score each model: prefer exact id match > id contains > name contains > provider+id contains
  let bestMatch: ModelEntry | undefined;
  let bestScore = 0;

  for (const m of all) {
    const id = normalize(m.id);
    const name = normalize(m.name);
    const full = normalize(`${m.provider}/${m.id}`);

    let score = 0;
    if (id === query || full === query) {
      score = 100; // exact
    } else if (id.includes(query) || full.includes(query)) {
      score = 60 + (query.length / id.length) * 30; // substring, prefer tighter matches
    } else if (name.includes(query)) {
      score = 40 + (query.length / name.length) * 20;
    } else if (
      // A trailing date-stamp token (e.g. "20251001") is optional, so a
      // date-pinned config like "claude-haiku-4-5-20251001" still matches an
      // undated registry id like "claude-haiku-4-5".
      query
        .split(/[\s\-/]+/)
        .every(part => /^\d{8}$/.test(part) || id.includes(part) || name.includes(part) || m.provider.toLowerCase().includes(part))
    ) {
      score = 20; // all parts present somewhere
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = m;
    }
  }

  if (bestMatch && bestScore >= 20) {
    const found = registry.find(bestMatch.provider, bestMatch.id);
    if (found) return found;
  }

  // 3. Provider fallback: a "provider/modelId" query that didn't match under the
  // named provider (exact or fuzzy above) retries against all providers. The
  // named provider is preferred when present; this only kicks in when it isn't,
  // so the same model from another provider beats falling back to "inherit".
  if (slashIdx !== -1) {
    const bare = resolveModel(input.slice(slashIdx + 1), registry);
    if (typeof bare !== "string") return bare;
  }

  // 4. No match — list available models
  const modelList = all
    .map(m => `  ${m.provider}/${m.id}`)
    .sort()
    .join("\n");
  return `Model not found: "${input}".\n\nAvailable models:\n${modelList}`;
}
