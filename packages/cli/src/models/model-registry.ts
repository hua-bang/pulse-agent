import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

import {
  EMPTY_MODEL_REGISTRY,
  applyProvider,
  parseModelSpec,
  type ModelChoice,
  type ModelRegistry,
  type ProviderConfig,
} from './model-spec.js';

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
      const choice = resolveStringEntry(entry, providers, warnings);
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
    const record = value as { type?: unknown; baseUrl?: unknown; base_url?: unknown; apiKeyEnv?: unknown; api_key_env?: unknown; apiKey?: unknown; promptCacheKey?: unknown; prompt_cache_key?: unknown };
    if (record.apiKey !== undefined) {
      warnings.push(`provider "${name}": inline apiKey ignored — use apiKeyEnv (models.json is committable; never store keys in it)`);
    }
    const type = record.type === 'claude' ? 'claude' : 'openai';
    const baseUrl = record.baseUrl ?? record.base_url;
    const apiKeyEnv = record.apiKeyEnv ?? record.api_key_env;
    const promptCacheKey = record.promptCacheKey ?? record.prompt_cache_key;
    providers[name] = {
      name,
      type,
      ...(typeof baseUrl === 'string' && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      ...(typeof apiKeyEnv === 'string' && apiKeyEnv.trim() ? { apiKeyEnv: apiKeyEnv.trim() } : {}),
      ...(promptCacheKey === true ? { promptCacheKey: true } : {}),
    };
  }
  return providers;
}

function resolveStringEntry(
  entry: string,
  providers: Record<string, ProviderConfig>,
  warnings: string[],
): ModelChoice | null {
  const colonIndex = entry.indexOf(':');
  if (colonIndex > 0) {
    const head = entry.slice(0, colonIndex);
    const rest = entry.slice(colonIndex + 1).trim();
    if (rest && providers[head]) {
      return applyProvider({ model: rest }, providers[head]);
    }
    // Warn like the object form does. Without this a typo'd or deleted provider
    // silently yields a model literally named "provider:model", which only fails
    // much later at the API call.
    if (rest && head !== 'claude' && head !== 'openai') {
      warnings.push(`model "${entry}" references unknown provider "${head}" — using the bare model id`);
      return parseModelSpec(rest);
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
