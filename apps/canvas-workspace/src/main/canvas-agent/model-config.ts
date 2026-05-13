import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
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

export interface CanvasModelConfig {
  current_model?: string;
  provider_type?: CanvasModelProviderType;
  model?: string;
  base_url?: string;
  api_key_env?: string;
  headers?: Record<string, string>;
  options?: CanvasModelOption[];
}

export interface CanvasModelStatus {
  path: string;
  currentModel?: string;
  providerType: CanvasModelProviderType;
  resolvedModel: string;
  resolvedBaseURL?: string;
  resolvedApiKeyEnv?: string;
  apiKeyPresent: boolean;
  options: CanvasModelOption[];
}

export interface ResolvedCanvasModel {
  providerType: CanvasModelProviderType;
  provider: LLMProviderFactory;
  model: string;
  modelType?: ModelType;
}

const DEFAULT_CANVAS_MODEL = 'gpt-4o';

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

function resolveEffectiveFields(config: CanvasModelConfig) {
  const option = findCurrentOption(config);
  const providerType = normalizeProviderType(option?.provider_type ?? config.provider_type) ?? 'openai';
  const model =
    normalizeStr(option?.model) ??
    normalizeStr(config.model) ??
    normalizeStr(config.current_model) ??
    normalizeStr(process.env.OPENAI_MODEL) ??
    DEFAULT_CANVAS_MODEL;
  const baseURL =
    normalizeStr(option?.base_url) ??
    normalizeStr(config.base_url) ??
    normalizeStr(process.env.OPENAI_API_URL);
  const apiKeyEnv =
    normalizeStr(option?.api_key_env) ??
    normalizeStr(config.api_key_env) ??
    (providerType === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY');
  const headers = normalizeHeaders(option?.headers) ?? normalizeHeaders(config.headers);
  const apiKey = normalizeStr(process.env[apiKeyEnv]);

  return { providerType, model, baseURL, apiKeyEnv, apiKey, headers };
}

function sanitizeConfig(config: CanvasModelConfig): CanvasModelConfig {
  const sanitized: CanvasModelConfig = {};
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
  return sanitized;
}

export async function getCanvasModelStatus(): Promise<CanvasModelStatus> {
  const config = sanitizeConfig(await readConfig());
  const resolved = resolveEffectiveFields(config);
  return {
    path: getConfigPath(),
    currentModel: normalizeStr(config.current_model),
    providerType: resolved.providerType,
    resolvedModel: resolved.model,
    resolvedBaseURL: resolved.baseURL,
    resolvedApiKeyEnv: resolved.apiKeyEnv,
    apiKeyPresent: Boolean(resolved.apiKey),
    options: config.options ?? [],
  };
}

export async function saveCanvasModelConfig(config: CanvasModelConfig): Promise<CanvasModelStatus> {
  const sanitized = sanitizeConfig(config);
  await writeConfig(sanitized);
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
    config.current_model = normalized.name;
  }
  await writeConfig(config);
  return await getCanvasModelStatus();
}

export async function setCanvasCurrentModel(name: string): Promise<CanvasModelStatus> {
  const currentModel = normalizeStr(name);
  if (!currentModel) throw new Error('Model name is required');
  const config = sanitizeConfig(await readConfig());
  config.current_model = currentModel;
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
  if (config.current_model === modelName) {
    delete config.current_model;
  }
  await writeConfig(config);
  return await getCanvasModelStatus();
}

export async function resetCanvasModelConfig(): Promise<CanvasModelStatus> {
  await writeConfig({});
  return await getCanvasModelStatus();
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
