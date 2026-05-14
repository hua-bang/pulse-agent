import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { safeStorage } from 'electron';
import { createOpenAI } from '@ai-sdk/openai';
import { buildProvider, type LLMProviderFactory, type ModelType } from 'pulse-coder-engine';

export type CanvasModelProviderType = 'openai' | 'claude';

export interface CanvasModelOption {
  name: string;
  provider_type?: CanvasModelProviderType;
  model?: string;
  base_url?: string;
  api_key_env?: string;
  headers?: Record<string, string>;
}

export interface CanvasProviderModel {
  id: string;
  name?: string;
}

export interface CanvasModelProviderConfig {
  id: string;
  name: string;
  provider_type?: CanvasModelProviderType;
  base_url?: string;
  api_key_env?: string;
  /** Plain API key is accepted from IPC/UI input only and is never returned in status. */
  api_key?: string;
  encrypted_api_key?: string;
  headers?: Record<string, string>;
  models?: CanvasProviderModel[];
}

export interface CanvasModelConfig {
  current_provider?: string;
  current_model?: string;
  provider_type?: CanvasModelProviderType;
  model?: string;
  base_url?: string;
  api_key_env?: string;
  headers?: Record<string, string>;
  options?: CanvasModelOption[];
  providers?: CanvasModelProviderConfig[];
}

export interface CanvasModelProviderStatus {
  id: string;
  name: string;
  provider_type: CanvasModelProviderType;
  base_url?: string;
  api_key_env?: string;
  apiKeyPresent: boolean;
  /**
   * Number of characters in the saved API key when one is present and
   * decryptable. Undefined when no key is saved, or when an encrypted
   * blob exists but couldn't be decrypted on this machine. Exposed so
   * the settings UI can confirm to the user that a key really is on
   * disk without echoing it back.
   */
  apiKeyLength?: number;
  headers?: Record<string, string>;
  models: CanvasProviderModel[];
}

export interface CanvasModelStatus {
  path: string;
  currentProvider?: string;
  currentModel?: string;
  providerType: CanvasModelProviderType;
  resolvedModel: string;
  resolvedBaseURL?: string;
  resolvedApiKeyEnv?: string;
  apiKeyPresent: boolean;
  options: CanvasModelOption[];
  providers: CanvasModelProviderStatus[];
}

export interface ResolvedCanvasModel {
  providerType: CanvasModelProviderType;
  provider: LLMProviderFactory;
  model: string;
  modelType?: ModelType;
}

export interface FetchCanvasModelsInput {
  providerId?: string;
  provider?: CanvasModelProviderConfig;
}

const DEFAULT_CANVAS_MODEL = 'gpt-4o';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_CLAUDE_BASE_URL = 'https://api.anthropic.com';

function normalizeStr(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return undefined;
  }
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const headerName = normalizeStr(key);
    const headerValue = normalizeStr(value);
    if (headerName && headerValue) {
      normalized[headerName] = headerValue;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeProviderType(value: unknown): CanvasModelProviderType | undefined {
  const normalized = normalizeStr(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'openai' || normalized === 'claude') return normalized;
  throw new Error(`Unsupported provider_type: ${String(value)}`);
}

function normalizeProviderId(value: unknown, fallback?: string): string {
  const raw = normalizeStr(value) ?? normalizeStr(fallback);
  if (!raw) throw new Error('Provider id is required');
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) throw new Error('Provider id is required');
  return normalized;
}

function normalizeModelId(value: unknown): string | undefined {
  return normalizeStr(value);
}

function normalizeProviderModels(models: unknown): CanvasProviderModel[] {
  if (!Array.isArray(models)) return [];
  const seen = new Set<string>();
  const result: CanvasProviderModel[] = [];
  for (const item of models) {
    const id = typeof item === 'string'
      ? normalizeModelId(item)
      : item && typeof item === 'object'
        ? normalizeModelId((item as CanvasProviderModel).id)
        : undefined;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = item && typeof item === 'object'
      ? normalizeStr((item as CanvasProviderModel).name)
      : undefined;
    result.push(name && name !== id ? { id, name } : { id });
  }
  return result;
}

function normalizeModelOption(option: CanvasModelOption): CanvasModelOption {
  const name = normalizeStr(option.name);
  if (!name) throw new Error('Model option name is required');

  const normalized: CanvasModelOption = { name };
  const providerType = normalizeProviderType(option.provider_type);
  if (providerType) normalized.provider_type = providerType;
  const model = normalizeStr(option.model);
  if (model) normalized.model = model;
  const baseURL = normalizeStr(option.base_url);
  if (baseURL) normalized.base_url = baseURL;
  const apiKeyEnv = normalizeStr(option.api_key_env);
  if (apiKeyEnv) normalized.api_key_env = apiKeyEnv;
  const headers = normalizeHeaders(option.headers);
  if (headers) normalized.headers = headers;
  return normalized;
}

function encryptApiKey(apiKey: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `safe:${safeStorage.encryptString(apiKey).toString('base64')}`;
    }
  } catch {
    // Fall through to local obfuscation for dev environments without OS keychain.
  }
  return `plain:${Buffer.from(apiKey, 'utf8').toString('base64')}`;
}

function decryptApiKey(encrypted?: string): string | undefined {
  const value = normalizeStr(encrypted);
  if (!value) return undefined;
  try {
    if (value.startsWith('safe:')) {
      return safeStorage.decryptString(Buffer.from(value.slice(5), 'base64'));
    }
    if (value.startsWith('plain:')) {
      return Buffer.from(value.slice(6), 'base64').toString('utf8');
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function normalizeProviderConfig(
  provider: CanvasModelProviderConfig,
  existing?: CanvasModelProviderConfig,
): CanvasModelProviderConfig {
  const name = normalizeStr(provider.name) ?? normalizeStr(existing?.name) ?? normalizeStr(provider.id) ?? 'Custom Provider';
  const id = normalizeProviderId(provider.id, name);
  const providerType = normalizeProviderType(provider.provider_type ?? existing?.provider_type) ?? 'openai';
  const normalized: CanvasModelProviderConfig = { id, name, provider_type: providerType };

  const baseURL = normalizeStr(provider.base_url) ?? normalizeStr(existing?.base_url);
  if (baseURL) normalized.base_url = baseURL;
  const apiKeyEnv = normalizeStr(provider.api_key_env) ?? normalizeStr(existing?.api_key_env);
  if (apiKeyEnv) normalized.api_key_env = apiKeyEnv;
  const headers = normalizeHeaders(provider.headers) ?? normalizeHeaders(existing?.headers);
  if (headers) normalized.headers = headers;

  const plainApiKey = normalizeStr(provider.api_key);
  if (plainApiKey) {
    normalized.encrypted_api_key = encryptApiKey(plainApiKey);
  } else {
    const encrypted = normalizeStr(provider.encrypted_api_key) ?? normalizeStr(existing?.encrypted_api_key);
    if (encrypted) normalized.encrypted_api_key = encrypted;
  }

  const models = normalizeProviderModels(provider.models);
  const existingModels = normalizeProviderModels(existing?.models);
  normalized.models = models.length > 0 ? models : existingModels;
  return normalized;
}

function getConfigPath(): string {
  const envPath = normalizeStr(process.env.PULSE_CANVAS_MODEL_CONFIG);
  return envPath ?? join(homedir(), '.pulse-coder', 'canvas', 'model-config.json');
}

async function readConfig(): Promise<CanvasModelConfig> {
  const path = getConfigPath();
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as CanvasModelConfig;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeConfig(config: CanvasModelConfig): Promise<void> {
  const path = getConfigPath();
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function findCurrentOption(config: CanvasModelConfig): CanvasModelOption | undefined {
  const current = normalizeStr(config.current_model);
  return current ? config.options?.find((option) => option?.name === current) : undefined;
}

function findCurrentProvider(config: CanvasModelConfig): CanvasModelProviderConfig | undefined {
  const currentProvider = normalizeStr(config.current_provider);
  const providers = Array.isArray(config.providers) ? config.providers : [];
  if (currentProvider) {
    const provider = providers.find((item) => item.id === currentProvider);
    if (provider) return provider;
  }
  return providers[0];
}

function flattenProviderOptions(config: CanvasModelConfig): CanvasModelOption[] {
  const providers = Array.isArray(config.providers) ? config.providers : [];
  const options: CanvasModelOption[] = [];
  for (const provider of providers) {
    const providerType = normalizeProviderType(provider.provider_type) ?? 'openai';
    const models = normalizeProviderModels(provider.models);
    for (const model of models) {
      options.push({
        name: `${provider.id}/${model.id}`,
        provider_type: providerType,
        model: model.id,
        base_url: provider.base_url,
        api_key_env: provider.api_key_env,
        headers: provider.headers,
      });
    }
  }
  return [...(config.options ?? []), ...options];
}

function resolveEffectiveFields(config: CanvasModelConfig) {
  const provider = findCurrentProvider(config);
  const providerType = normalizeProviderType(provider?.provider_type ?? config.provider_type) ?? 'openai';
  const option = provider ? undefined : findCurrentOption(config);
  const providerModel = provider ? normalizeProviderModels(provider.models)[0]?.id : undefined;
  const model =
    normalizeStr(config.current_model) ??
    providerModel ??
    normalizeStr(option?.model) ??
    normalizeStr(config.model) ??
    normalizeStr(process.env.OPENAI_MODEL) ??
    DEFAULT_CANVAS_MODEL;
  const baseURL =
    normalizeStr(provider?.base_url) ??
    normalizeStr(option?.base_url) ??
    normalizeStr(config.base_url) ??
    normalizeStr(process.env.OPENAI_API_URL);
  const apiKeyEnv =
    normalizeStr(provider?.api_key_env) ??
    normalizeStr(option?.api_key_env) ??
    normalizeStr(config.api_key_env) ??
    (providerType === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY');
  const headers = normalizeHeaders(provider?.headers) ?? normalizeHeaders(option?.headers) ?? normalizeHeaders(config.headers);
  const apiKey = decryptApiKey(provider?.encrypted_api_key) ?? normalizeStr(process.env[apiKeyEnv]);

  return { providerType, model, baseURL, apiKeyEnv, apiKey, headers, provider };
}

function sanitizeConfig(config: CanvasModelConfig): CanvasModelConfig {
  const sanitized: CanvasModelConfig = {};
  const currentProvider = normalizeStr(config.current_provider);
  if (currentProvider) sanitized.current_provider = normalizeProviderId(currentProvider);
  const currentModel = normalizeStr(config.current_model);
  if (currentModel) sanitized.current_model = currentModel;
  const providerType = normalizeProviderType(config.provider_type);
  if (providerType) sanitized.provider_type = providerType;
  const model = normalizeStr(config.model);
  if (model) sanitized.model = model;
  const baseURL = normalizeStr(config.base_url);
  if (baseURL) sanitized.base_url = baseURL;
  const apiKeyEnv = normalizeStr(config.api_key_env);
  if (apiKeyEnv) sanitized.api_key_env = apiKeyEnv;
  const headers = normalizeHeaders(config.headers);
  if (headers) sanitized.headers = headers;
  if (Array.isArray(config.options)) {
    sanitized.options = config.options.map(normalizeModelOption);
  }
  if (Array.isArray(config.providers)) {
    sanitized.providers = config.providers.map((provider) => normalizeProviderConfig(provider));
  }
  return sanitized;
}

function toProviderStatus(provider: CanvasModelProviderConfig): CanvasModelProviderStatus {
  const providerType = normalizeProviderType(provider.provider_type) ?? 'openai';
  const apiKeyEnv = normalizeStr(provider.api_key_env);
  const decrypted = decryptApiKey(provider.encrypted_api_key);
  const envKey = apiKeyEnv ? normalizeStr(process.env[apiKeyEnv]) : undefined;
  const resolvedKey = decrypted ?? envKey;
  return {
    id: provider.id,
    name: provider.name,
    provider_type: providerType,
    base_url: provider.base_url,
    api_key_env: apiKeyEnv,
    apiKeyPresent: Boolean(resolvedKey),
    apiKeyLength: resolvedKey ? resolvedKey.length : undefined,
    headers: provider.headers,
    models: normalizeProviderModels(provider.models),
  };
}

export async function getCanvasModelStatus(): Promise<CanvasModelStatus> {
  const config = sanitizeConfig(await readConfig());
  const resolved = resolveEffectiveFields(config);
  return {
    path: getConfigPath(),
    currentProvider: normalizeStr(config.current_provider),
    currentModel: normalizeStr(config.current_model),
    providerType: resolved.providerType,
    resolvedModel: resolved.model,
    resolvedBaseURL: resolved.baseURL,
    resolvedApiKeyEnv: resolved.apiKeyEnv,
    apiKeyPresent: Boolean(resolved.apiKey),
    options: flattenProviderOptions(config),
    providers: (config.providers ?? []).map(toProviderStatus),
  };
}

export async function saveCanvasModelConfig(config: CanvasModelConfig): Promise<CanvasModelStatus> {
  const existing = sanitizeConfig(await readConfig());
  const incomingProviders = Array.isArray(config.providers) ? config.providers : [];
  const providers = incomingProviders.map((provider) => {
    const id = normalizeProviderId(provider.id, provider.name);
    return normalizeProviderConfig(provider, existing.providers?.find((item) => item.id === id));
  });
  const sanitized = sanitizeConfig({ ...config, providers });
  await writeConfig(sanitized);
  return await getCanvasModelStatus();
}

export async function upsertCanvasModelProvider(provider: CanvasModelProviderConfig): Promise<CanvasModelStatus> {
  const config = sanitizeConfig(await readConfig());
  const id = normalizeProviderId(provider.id, provider.name);
  const existingProvider = config.providers?.find((item) => item.id === id);
  const normalized = normalizeProviderConfig(provider, existingProvider);
  const providers = Array.isArray(config.providers) ? config.providers : [];
  config.providers = [
    ...providers.filter((item) => item.id !== normalized.id),
    normalized,
  ];
  if (!config.current_provider) {
    config.current_provider = normalized.id;
    config.current_model = normalized.models?.[0]?.id;
  }
  await writeConfig(config);
  return await getCanvasModelStatus();
}

export async function removeCanvasModelProvider(providerId: string): Promise<CanvasModelStatus> {
  const id = normalizeProviderId(providerId);
  const config = sanitizeConfig(await readConfig());
  const providers = Array.isArray(config.providers) ? config.providers : [];
  const nextProviders = providers.filter((item) => item.id !== id);
  if (nextProviders.length === providers.length) {
    throw new Error(`Provider not found: ${id}`);
  }
  config.providers = nextProviders;
  if (config.current_provider === id) {
    const next = nextProviders[0];
    if (next) {
      config.current_provider = next.id;
      config.current_model = next.models?.[0]?.id;
    } else {
      delete config.current_provider;
      delete config.current_model;
    }
  }
  await writeConfig(config);
  return await getCanvasModelStatus();
}

export async function upsertCanvasModelOption(
  option: CanvasModelOption,
  setCurrent = false,
): Promise<CanvasModelStatus> {
  const normalized = normalizeModelOption(option);
  const config = sanitizeConfig(await readConfig());
  const options = Array.isArray(config.options) ? config.options : [];
  config.options = [
    ...options.filter((item) => item.name !== normalized.name),
    normalized,
  ];
  if (setCurrent) {
    delete config.current_provider;
    config.current_model = normalized.name;
  }
  await writeConfig(config);
  return await getCanvasModelStatus();
}

export async function setCanvasCurrentModel(name?: string, providerId?: string): Promise<CanvasModelStatus> {
  const config = sanitizeConfig(await readConfig());
  const currentModel = normalizeStr(name);
  const currentProvider = normalizeStr(providerId);
  if (!currentModel) {
    delete config.current_provider;
    delete config.current_model;
  } else if (currentProvider) {
    const provider = config.providers?.find((item) => item.id === normalizeProviderId(currentProvider));
    if (!provider) throw new Error(`Provider not found: ${currentProvider}`);
    if (!normalizeProviderModels(provider.models).some((item) => item.id === currentModel)) {
      provider.models = [...normalizeProviderModels(provider.models), { id: currentModel }];
    }
    config.current_provider = provider.id;
    config.current_model = currentModel;
  } else {
    delete config.current_provider;
    config.current_model = currentModel;
  }
  await writeConfig(config);
  return await getCanvasModelStatus();
}

export async function removeCanvasModelOption(name: string): Promise<CanvasModelStatus> {
  const modelName = normalizeStr(name);
  if (!modelName) throw new Error('Model name is required');
  const config = sanitizeConfig(await readConfig());
  const options = Array.isArray(config.options) ? config.options : [];
  const nextOptions = options.filter((item) => item.name !== modelName);
  if (nextOptions.length === options.length) {
    throw new Error(`Model option not found: ${modelName}`);
  }
  config.options = nextOptions;
  if (config.current_model === modelName && !config.current_provider) {
    delete config.current_model;
  }
  await writeConfig(config);
  return await getCanvasModelStatus();
}

export async function resetCanvasModelConfig(): Promise<CanvasModelStatus> {
  await writeConfig({});
  return await getCanvasModelStatus();
}

function joinUrl(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function buildOpenAIModelsUrl(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '');
  if (/\/models$/i.test(trimmed)) return trimmed;
  if (/\/v\d+$/i.test(trimmed)) return joinUrl(trimmed, '/models');
  return joinUrl(joinUrl(trimmed, '/v1'), '/models');
}

function buildClaudeModelsUrl(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '');
  if (/\/models$/i.test(trimmed)) return trimmed;
  if (/\/v\d+$/i.test(trimmed)) return joinUrl(trimmed, '/models');
  return joinUrl(joinUrl(trimmed, '/v1'), '/models');
}

function parseModelsPayload(payload: unknown): CanvasProviderModel[] {
  const data = payload && typeof payload === 'object' ? (payload as any).data : undefined;
  const list = Array.isArray(data) ? data : Array.isArray(payload) ? payload : [];
  return normalizeProviderModels(list.map((item: any) => {
    if (typeof item === 'string') return item;
    return { id: item?.id ?? item?.name, name: item?.display_name ?? item?.name };
  }));
}

export async function fetchCanvasProviderModels(input: FetchCanvasModelsInput): Promise<CanvasProviderModel[]> {
  const config = sanitizeConfig(await readConfig());
  let provider = input.provider ? normalizeProviderConfig(input.provider) : undefined;
  if (input.providerId) {
    provider = config.providers?.find((item) => item.id === normalizeProviderId(input.providerId)) ?? provider;
  }
  if (!provider) throw new Error('Provider is required');

  const providerType = normalizeProviderType(provider.provider_type) ?? 'openai';
  const baseURL = normalizeStr(provider.base_url) ?? (providerType === 'claude' ? DEFAULT_CLAUDE_BASE_URL : DEFAULT_OPENAI_BASE_URL);
  const apiKeyEnv = normalizeStr(provider.api_key_env) ?? (providerType === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY');
  const apiKey = decryptApiKey(provider.encrypted_api_key) ?? normalizeStr(provider.api_key) ?? normalizeStr(process.env[apiKeyEnv]);
  const headers: Record<string, string> = {
    ...(normalizeHeaders(provider.headers) ?? {}),
  };
  if (apiKey) {
    if (providerType === 'claude') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01';
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }

  const modelsUrl = providerType === 'claude' ? buildClaudeModelsUrl(baseURL) : buildOpenAIModelsUrl(baseURL);
  const response = await fetch(modelsUrl, { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Fetch models failed: HTTP ${response.status}${text ? ` - ${text.slice(0, 180)}` : ''}`);
  }
  const payload = await response.json();
  const models = parseModelsPayload(payload);
  if (models.length === 0) throw new Error('No models found in provider response');
  return models;
}

export async function resolveCanvasModel(): Promise<ResolvedCanvasModel> {
  const config = sanitizeConfig(await readConfig());
  const resolved = resolveEffectiveFields(config);
  const provider = resolved.providerType === 'claude'
    ? buildProvider('claude', {
        apiKey: resolved.apiKey,
        baseURL: resolved.baseURL,
        headers: resolved.headers,
      })
    : createOpenAI({
        apiKey: resolved.apiKey,
        baseURL: resolved.baseURL,
        headers: resolved.headers,
      });

  return {
    providerType: resolved.providerType,
    provider,
    model: resolved.model,
    modelType: resolved.providerType === 'claude' ? 'claude' : 'openai',
  };
}

export function resolveCanvasModelConfigPath(): string {
  return resolve(getConfigPath());
}
