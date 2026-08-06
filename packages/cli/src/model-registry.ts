import * as fs from 'fs/promises';
import * as path from 'path';

export interface ProviderConfig {
  name: string;
  /** SDK channel: 'openai' (OpenAI-compatible /responses) or 'claude' (Anthropic). */
  type: 'openai' | 'claude';
  baseUrl?: string;
  /** Name of the env var holding the API key. Keys are NEVER stored inline — models.json is committable. */
  apiKeyEnv?: string;
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

/** Short display form: last path segment, truncated. */
export function shortModelLabel(model: string, maxLength = 22): string {
  const segments = model.split('/').filter(Boolean);
  const short = segments[segments.length - 1] ?? model;
  return short.length > maxLength ? `${short.slice(0, maxLength - 1)}…` : short;
}

/**
 * Loads the /model registry from `.pulse-coder/models.json` (or legacy
 * `.coder/models.json`). Shape:
 * `{ "providers": { name: { type, baseUrl?, apiKeyEnv? } },
 *    "models": ["openai:id", { model, provider|type, label?, contextWindow? }] }`
 * A bare array of entries is also accepted.
 */
export async function loadModelRegistry(cwd = process.cwd()): Promise<ModelRegistry> {
  for (const dir of ['.pulse-coder', '.coder']) {
    const filePath = path.join(cwd, dir, 'models.json');
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return normalizeRegistry(JSON.parse(raw));
    } catch {
      continue;
    }
  }
  return EMPTY_MODEL_REGISTRY;
}

function normalizeRegistry(parsed: unknown): ModelRegistry {
  const warnings: string[] = [];
  const providers = normalizeProviders(parsed, warnings);

  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { models?: unknown }).models)
      ? (parsed as { models: unknown[] }).models
      : [];

  const models: ModelChoice[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      const choice = resolveStringEntry(entry, providers);
      if (choice) {
        models.push(choice);
      }
      continue;
    }
    if (entry && typeof entry === 'object') {
      const choice = resolveObjectEntry(entry as Record<string, unknown>, providers, warnings);
      if (choice) {
        models.push(choice);
      }
    }
  }
  return { providers, models, warnings };
}

function normalizeProviders(parsed: unknown, warnings: string[]): Record<string, ProviderConfig> {
  const providers: Record<string, ProviderConfig> = {};
  const raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as { providers?: unknown }).providers
    : undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return providers;
  }

  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const record = value as { type?: unknown; baseUrl?: unknown; base_url?: unknown; apiKeyEnv?: unknown; api_key_env?: unknown; apiKey?: unknown };
    if (record.apiKey !== undefined) {
      warnings.push(`provider "${name}": inline apiKey ignored — use apiKeyEnv (models.json is committable; never store keys in it)`);
    }
    const type = record.type === 'claude' ? 'claude' : 'openai';
    const baseUrl = record.baseUrl ?? record.base_url;
    const apiKeyEnv = record.apiKeyEnv ?? record.api_key_env;
    providers[name] = {
      name,
      type,
      ...(typeof baseUrl === 'string' && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      ...(typeof apiKeyEnv === 'string' && apiKeyEnv.trim() ? { apiKeyEnv: apiKeyEnv.trim() } : {}),
    };
  }
  return providers;
}

function resolveStringEntry(entry: string, providers: Record<string, ProviderConfig>): ModelChoice | null {
  const colonIndex = entry.indexOf(':');
  if (colonIndex > 0) {
    const head = entry.slice(0, colonIndex);
    const rest = entry.slice(colonIndex + 1).trim();
    if (rest && providers[head]) {
      return applyProvider({ model: rest }, providers[head]);
    }
  }
  return parseModelSpec(entry);
}

function resolveObjectEntry(
  record: Record<string, unknown>,
  providers: Record<string, ProviderConfig>,
  warnings: string[],
): ModelChoice | null {
  if (typeof record.model !== 'string' || !record.model.trim()) {
    return null;
  }

  const contextWindow = record.contextWindow ?? record.context_window;
  let choice: ModelChoice = {
    model: record.model.trim(),
    ...(typeof record.label === 'string' && record.label.trim() ? { label: record.label.trim() } : {}),
    ...(typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow: Math.floor(contextWindow) } : {}),
  };

  const providerName = record.provider;
  if (typeof providerName === 'string' && providerName.trim()) {
    const provider = providers[providerName.trim()];
    if (!provider) {
      warnings.push(`model "${choice.model}": unknown provider "${providerName}" — entry kept with default connection`);
    } else {
      choice = applyProvider(choice, provider);
    }
  }

  const type = record.modelType ?? record.type;
  if ((type === 'claude' || type === 'openai') && !choice.modelType) {
    choice.modelType = type;
  }
  return choice;
}

function applyProvider(choice: ModelChoice, provider: ProviderConfig): ModelChoice {
  return {
    ...choice,
    modelType: provider.type,
    providerName: provider.name,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    ...(provider.apiKeyEnv ? { apiKeyEnv: provider.apiKeyEnv } : {}),
  };
}
