import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

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
  return short.length > maxLength ? `${short.slice(0, maxLength - 1)}…` : short;
}

/**
 * Loads the /model registry, merging two scopes so a machine-wide setup keeps
 * working in every directory:
 *   1. home:    `~/.pulse-coder/models.json` (or legacy `~/.coder/…`)
 *   2. project: `<cwd>/.pulse-coder/models.json` (or legacy `<cwd>/.coder/…`)
 *
 * Project entries win on conflicts (same provider name / same model id within
 * the same provider), and project-only entries are appended after home ones.
 *
 * Shape: `{ "providers": { name: { type, baseUrl?, apiKeyEnv? } },
 *           "models": ["openai:id", { model, provider|type, label?, contextWindow? }] }`
 * A bare array of entries is also accepted.
 */
export async function loadModelRegistry(cwd = process.cwd(), home = homedir()): Promise<ModelRegistry> {
  const homeRegistry = await readRegistryFrom(home, 'home');
  const projectRegistry = home === cwd ? null : await readRegistryFrom(cwd, 'project');

  if (!homeRegistry && !projectRegistry) {
    return EMPTY_MODEL_REGISTRY;
  }
  if (!projectRegistry) {
    return homeRegistry ?? EMPTY_MODEL_REGISTRY;
  }
  if (!homeRegistry) {
    return projectRegistry;
  }
  return mergeRegistries(homeRegistry, projectRegistry);
}

async function readRegistryFrom(root: string, scope: 'home' | 'project'): Promise<ModelRegistry | null> {
  for (const dir of ['.pulse-coder', '.coder']) {
    const filePath = path.join(root, dir, 'models.json');
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return normalizeRegistry(JSON.parse(raw), scope);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        continue;
      }
      return {
        ...EMPTY_MODEL_REGISTRY,
        warnings: [`${scope} ${filePath}: unreadable or invalid JSON — ignored`],
      };
    }
  }
  return null;
}

/** Project scope wins: same provider name, or same model id under the same provider. */
function mergeRegistries(base: ModelRegistry, override: ModelRegistry): ModelRegistry {
  const providers = { ...base.providers, ...override.providers };

  // Home models referencing a provider the project redefined must pick up the
  // project's connection, so re-resolve them against the merged provider map.
  const rebasedBaseModels = base.models.map(choice => {
    const provider = choice.providerName ? providers[choice.providerName] : undefined;
    return provider ? applyProvider(choice, provider) : choice;
  });

  const identity = (choice: ModelChoice) => `${choice.providerName ?? choice.modelType ?? ''}:${choice.model}`;
  const overrideKeys = new Set(override.models.map(identity));
  const models = [
    ...rebasedBaseModels.filter(choice => !overrideKeys.has(identity(choice))),
    ...override.models,
  ];

  return { providers, models, warnings: [...base.warnings, ...override.warnings] };
}

function normalizeRegistry(parsed: unknown, scope: 'home' | 'project' = 'project'): ModelRegistry {
  const rawWarnings: string[] = [];
  const providers = normalizeProviders(parsed, rawWarnings);
  const warnings = rawWarnings;

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
  return { providers, models, warnings: warnings.map(warning => `${scope}: ${warning}`) };
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
    ...(record.default === true ? { isDefault: true } : {}),
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
