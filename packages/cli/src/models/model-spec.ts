import { truncateToWidth } from '../terminal/text-width.js';

export interface ProviderConfig {
  name: string;
  /** SDK channel: 'openai' (OpenAI-compatible /responses) or 'claude' (Anthropic). */
  type: 'openai' | 'claude';
  baseUrl?: string;
  /** Name of the env var holding the API key. Keys are NEVER stored inline — models.json is committable. */
  apiKeyEnv?: string;
  /**
   * Opt-in: send a stable per-session `prompt_cache_key` so gateways with
   * several upstream accounts/cache nodes route a session's requests to the
   * same cache node. Off by default — only providers that are known to route
   * by the key should enable it.
   */
  promptCacheKey?: boolean;
}

export interface ModelChoice {
  model: string;
  modelType?: 'openai' | 'claude';
  label?: string;
  /** Context window size in tokens; overrides the engine's CONTEXT_WINDOW_TOKENS for display AND compaction. */
  contextWindow?: number;
  /** Resolved provider connection (from the registry's providers map). */
  providerName?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  /** Inherited from the provider: this choice wants a per-session prompt_cache_key. */
  promptCacheKey?: boolean;
  /** Marks the entry `/model` starts on when nothing else is pinned. */
  isDefault?: boolean;
}

export interface ModelRegistry {
  providers: Record<string, ProviderConfig>;
  models: ModelChoice[];
  warnings: string[];
}

export const EMPTY_MODEL_REGISTRY: ModelRegistry = { providers: {}, models: [], warnings: [] };

/**
 * Parses a model spec string: `claude:<model>` / `openai:<model>` pins the
 * SDK channel; a bare id keeps the engine's default provider resolution.
 */
export function parseModelSpec(spec: string): ModelChoice | null {
  const trimmed = spec.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('claude:')) {
    const model = trimmed.slice('claude:'.length).trim();
    return model ? { model, modelType: 'claude' } : null;
  }
  if (trimmed.startsWith('openai:')) {
    const model = trimmed.slice('openai:'.length).trim();
    return model ? { model, modelType: 'openai' } : null;
  }
  return { model: trimmed };
}

/**
 * Registry-aware spec resolution, in priority order:
 * 1. exact registry model id (optionally `provider:` prefixed) → full choice
 *    including contextWindow and provider connection;
 * 2. `claude:` / `openai:` channel prefix;
 * 3. `<providerName>:<model>` for providers defined in the registry;
 * 4. bare model id.
 */
export function resolveModelSpec(spec: string, registry: ModelRegistry): ModelChoice | null {
  const trimmed = spec.trim();
  if (!trimmed) {
    return null;
  }

  const exact = registry.models.find(choice =>
    choice.model === trimmed
    || (choice.providerName && `${choice.providerName}:${choice.model}` === trimmed));
  if (exact) {
    return exact;
  }

  const colonIndex = trimmed.indexOf(':');
  if (colonIndex > 0) {
    const head = trimmed.slice(0, colonIndex);
    const rest = trimmed.slice(colonIndex + 1).trim();
    if (rest && registry.providers[head]) {
      return applyProvider({ model: rest }, registry.providers[head]);
    }
  }

  return parseModelSpec(trimmed);
}

/**
 * Strict resolution for the startup-restore path.
 *
 * `resolveModelSpec` never fails — an unrecognised spec falls through to
 * `parseModelSpec`, which accepts any non-empty string. That leniency is right
 * for a spec the user just typed, but wrong when silently restoring a persisted
 * choice: once a provider is renamed or removed from models.json, `acme:foo`
 * would come back as the literal model id `"acme:foo"` (colon and all), with no
 * connection and no context window, and the CLI would report it as restored.
 *
 * Returns null for a `provider:model` spec whose provider is neither a live
 * registry provider nor an SDK channel, so the caller can warn and fall back.
 */
export function resolveKnownModelSpec(spec: string, registry: ModelRegistry): ModelChoice | null {
  const trimmed = spec.trim();
  if (!trimmed) {
    return null;
  }

  const colonIndex = trimmed.indexOf(':');
  if (colonIndex > 0) {
    const head = trimmed.slice(0, colonIndex);
    const isKnown = head === 'claude' || head === 'openai' || Boolean(registry.providers[head]);
    const isExactEntry = registry.models.some(choice =>
      choice.providerName && `${choice.providerName}:${choice.model}` === trimmed);
    if (!isKnown && !isExactEntry) {
      return null;
    }
  }

  return resolveModelSpec(trimmed, registry);
}

/** The entry marked `"default": true`, if any (first wins). */
export function findDefaultModel(registry: ModelRegistry): ModelChoice | null {
  return registry.models.find(choice => choice.isDefault) ?? null;
}

/** Canonical spec string for a choice, suitable for persisting and re-resolving. */
export function formatModelSpec(choice: ModelChoice): string {
  const prefix = choice.providerName ?? choice.modelType;
  return prefix ? `${prefix}:${choice.model}` : choice.model;
}

/** Short display form: last path segment, truncated. */
export function shortModelLabel(model: string, maxLength = 22): string {
  const segments = model.split('/').filter(Boolean);
  const short = segments[segments.length - 1] ?? model;
  // Display columns: this feeds the status line and the picker, both of which
  // budget in terminal columns, so a CJK/emoji id must not slip past the cap.
  return truncateToWidth(short, maxLength);
}

export function applyProvider(choice: ModelChoice, provider: ProviderConfig): ModelChoice {
  // The provider is the SSOT for promptCacheKey: drop whatever the choice
  // carried (e.g. from a home-scope provider) before applying this one, or a
  // stale opt-in would survive a project-scope provider redefinition.
  const { promptCacheKey: _stale, ...rest } = choice;
  return {
    ...rest,
    modelType: provider.type,
    providerName: provider.name,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    ...(provider.apiKeyEnv ? { apiKeyEnv: provider.apiKeyEnv } : {}),
    ...(provider.promptCacheKey === true ? { promptCacheKey: true } : {}),
  };
}
