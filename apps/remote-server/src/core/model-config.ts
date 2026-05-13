import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join, resolve, dirname } from 'path';

export type ProviderType = 'openai' | 'claude';

/**
 * Provider-level overrides for an option / current model.
 * - provider_type 决定走哪个 SDK family（openai / claude），保留二选一以匹配 engine。
 * - base_url / api_key_env / headers 用于覆盖默认 env 解析的连接参数。
 *   api_key_env 只存"环境变量名"，避免明文写入配置文件。
 * - model 允许 option 自带模型名（current_model 不指定时也能解析）。
 */
export type ModelOption = {
  name: string;
  provider_type?: ProviderType;
  base_url?: string;
  api_key_env?: string;
  headers?: Record<string, string>;
  model?: string;
};

type ModelConfig = {
  current_model?: string;
  provider_type?: ProviderType;
  /** 顶层也允许配 base_url / api_key_env / headers，作为 current_model 的兜底。 */
  base_url?: string;
  api_key_env?: string;
  headers?: Record<string, string>;
  options?: ModelOption[];
  models?: Array<{
    name?: string;
  }>;
};

type ModelConfigWriteResult = {
  path: string;
  config: ModelConfig;
};

type ModelStatus = {
  path: string | null;
  currentModel?: string;
  providerType?: ProviderType;
  resolvedModel?: string;
  resolvedBaseURL?: string;
  resolvedApiKeyEnv?: string;
  options?: ModelOption[];
  models?: string[];
};

type CachedConfig = {
  path: string;
  mtimeMs: number;
  data: ModelConfig | null;
};

let cachedConfig: CachedConfig | null = null;

function normalizeStr(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

function assertProviderType(providerType: unknown): asserts providerType is ProviderType | undefined {
  if (providerType === undefined || providerType === null || providerType === '') {
    return;
  }
  if (providerType !== 'openai' && providerType !== 'claude') {
    throw new Error(`Unsupported provider_type: ${String(providerType)}`);
  }
}

function normalizeModelOption(option: ModelOption): ModelOption {
  const name = normalizeStr(option.name);
  if (!name) {
    throw new Error('Model option name is required');
  }
  assertProviderType(option.provider_type);

  const normalized: ModelOption = { name };
  if (option.provider_type) normalized.provider_type = option.provider_type;
  const baseURL = normalizeStr(option.base_url);
  if (baseURL) normalized.base_url = baseURL;
  const apiKeyEnv = normalizeStr(option.api_key_env);
  if (apiKeyEnv) normalized.api_key_env = apiKeyEnv;
  const model = normalizeStr(option.model);
  if (model) normalized.model = model;
  const headers = normalizeHeaders(option.headers);
  if (headers) normalized.headers = headers;
  return normalized;
}

async function findConfigPath(): Promise<string | null> {
  const candidates: string[] = [];
  const envPath = process.env.PULSE_CODER_MODEL_CONFIG?.trim();
  if (envPath) {
    candidates.push(envPath);
  }

  candidates.push(resolve(process.cwd(), '.pulse-coder', 'config.json'));
  candidates.push(join(homedir(), '.pulse-coder', 'config.json'));

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // Ignore missing files.
    }
  }

  return null;
}

async function resolveWritableConfigPath(): Promise<string> {
  const envPath = process.env.PULSE_CODER_MODEL_CONFIG?.trim();
  const configPath = await findConfigPath();
  return envPath || configPath || resolve(process.cwd(), '.pulse-coder', 'config.json');
}

async function loadConfigFromPath(
  path: string,
  options?: { warn?: boolean },
): Promise<ModelConfig | null> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as ModelConfig;
  } catch (error) {
    if (options?.warn) {
      console.warn('[model-config] failed to parse model config:', error);
    }
    return null;
  }
}

async function ensureConfigDir(path: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
}

async function saveModelConfig(path: string, config: ModelConfig): Promise<ModelConfigWriteResult> {
  const payload = `${JSON.stringify(config, null, 2)}\n`;
  await fs.writeFile(path, payload, 'utf8');
  await refreshCache(path, config);
  return { path, config };
}

function applyCurrentModel(config: ModelConfig, name: string, option?: ModelOption | null): void {
  const currentModel = normalizeStr(name);
  if (!currentModel) {
    throw new Error('Model name is required');
  }

  config.current_model = option?.name ?? currentModel;
  if (option?.provider_type) config.provider_type = option.provider_type;
  else delete config.provider_type;
  if (option?.base_url) config.base_url = option.base_url;
  else delete config.base_url;
  if (option?.api_key_env) config.api_key_env = option.api_key_env;
  else delete config.api_key_env;
  if (option?.headers) config.headers = option.headers;
  else delete config.headers;
}

export async function writeModelConfig(next: Partial<ModelConfig>): Promise<ModelConfigWriteResult> {
  const path = await resolveWritableConfigPath();

  await ensureConfigDir(path);
  const existing = await loadConfigFromPath(path, { warn: true });
  const merged: ModelConfig = {
    ...(existing ?? {}),
    ...next,
  };

  return await saveModelConfig(path, merged);
}

export async function upsertModelOption(
  option: ModelOption,
  options?: { setCurrent?: boolean },
): Promise<ModelConfigWriteResult> {
  const normalized = normalizeModelOption(option);
  const path = await resolveWritableConfigPath();

  await ensureConfigDir(path);
  const existing = await loadConfigFromPath(path, { warn: true });
  const merged: ModelConfig = { ...(existing ?? {}) };
  const existingOptions = Array.isArray(merged.options) ? merged.options : [];
  merged.options = [
    ...existingOptions.filter((item) => item?.name !== normalized.name),
    normalized,
  ];

  if (options?.setCurrent) {
    applyCurrentModel(merged, normalized.name, normalized);
  }

  return await saveModelConfig(path, merged);
}

export async function removeModelOption(name: string): Promise<ModelConfigWriteResult> {
  const modelName = normalizeStr(name);
  if (!modelName) {
    throw new Error('Model option name is required');
  }

  const path = await resolveWritableConfigPath();
  await ensureConfigDir(path);
  const existing = await loadConfigFromPath(path, { warn: true });
  const merged: ModelConfig = { ...(existing ?? {}) };
  const existingOptions = Array.isArray(merged.options) ? merged.options : [];
  const nextOptions = existingOptions.filter((item) => item?.name !== modelName);
  if (nextOptions.length === existingOptions.length) {
    throw new Error(`Model option not found: ${modelName}`);
  }
  merged.options = nextOptions;

  if (normalizeStr(merged.current_model) === modelName) {
    delete merged.current_model;
    delete merged.provider_type;
    delete merged.base_url;
    delete merged.api_key_env;
    delete merged.headers;
  }

  return await saveModelConfig(path, merged);
}

export async function setCurrentModel(name: string): Promise<ModelConfigWriteResult> {
  const modelName = normalizeStr(name);
  if (!modelName) {
    throw new Error('Model name is required');
  }

  const path = await resolveWritableConfigPath();
  await ensureConfigDir(path);
  const existing = await loadConfigFromPath(path, { warn: true });
  const merged: ModelConfig = { ...(existing ?? {}) };
  const option = merged.options?.find((item) => item?.name === modelName) ?? null;
  applyCurrentModel(merged, modelName, option);

  return await saveModelConfig(path, merged);
}

async function refreshCache(path: string, data: ModelConfig | null): Promise<void> {
  try {
    const stat = await fs.stat(path);
    cachedConfig = { path, mtimeMs: stat.mtimeMs, data };
  } catch {
    cachedConfig = { path, mtimeMs: 0, data };
  }
}

function selectModel(config: ModelConfig | null): string | null {
  if (!config) {
    return null;
  }

  const current = normalizeStr(config.current_model);
  if (current) {
    // 如果 current_model 命中了某个 option 且 option.model 存在，优先用 option.model
    const opt = config.options?.find((o) => o?.name === current);
    if (opt?.model) {
      return normalizeStr(opt.model) ?? current;
    }
    return current;
  }

  const firstModel = Array.isArray(config.models) ? config.models[0] : null;
  return normalizeStr(firstModel?.name);
}

export async function clearModelOverride(): Promise<ModelConfigWriteResult> {
  const envPath = process.env.PULSE_CODER_MODEL_CONFIG?.trim();
  const configPath = await findConfigPath();
  if (!envPath && !configPath) {
    throw new Error('Model config file not found');
  }
  const path = envPath || configPath || resolve(process.cwd(), '.pulse-coder', 'config.json');

  await ensureConfigDir(path);
  const existing = await loadConfigFromPath(path, { warn: true });
  const merged: ModelConfig = {
    ...(existing ?? {}),
  };
  delete merged.current_model;
  // current model 级别的 provider 覆盖也一并清掉，避免脏状态
  delete merged.provider_type;
  delete merged.base_url;
  delete merged.api_key_env;
  delete merged.headers;

  return await saveModelConfig(path, merged);
}

async function loadConfigCached(): Promise<{ path: string | null; data: ModelConfig | null }> {
  const envPath = process.env.PULSE_CODER_MODEL_CONFIG?.trim();
  const configPath = await findConfigPath();
  const path = envPath || configPath || null;
  if (!path) {
    return { path: null, data: null };
  }

  try {
    const stat = await fs.stat(path);
    if (cachedConfig && cachedConfig.path === path && cachedConfig.mtimeMs === stat.mtimeMs) {
      return { path, data: cachedConfig.data };
    }
    const data = await loadConfigFromPath(path, { warn: true });
    if (data) cachedConfig = { path, mtimeMs: stat.mtimeMs, data };
    return { path, data };
  } catch {
    return { path, data: null };
  }
}

export async function getModelStatus(): Promise<ModelStatus> {
  const { path, data } = await loadConfigCached();
  if (!path) return { path: null };

  const resolvedModel = selectModel(data);
  const models = Array.isArray(data?.models)
    ? data?.models
        .map((item) => normalizeStr(item?.name))
        .filter((name): name is string => Boolean(name))
    : undefined;

  // 解析当前生效的 provider override（option 优先 → 顶层兜底）
  const currentName = normalizeStr(data?.current_model);
  const currentOption = currentName ? data?.options?.find((o) => o?.name === currentName) : undefined;

  const resolvedBaseURL =
    normalizeStr(currentOption?.base_url) ?? normalizeStr(data?.base_url) ?? undefined;
  const resolvedApiKeyEnv =
    normalizeStr(currentOption?.api_key_env) ?? normalizeStr(data?.api_key_env) ?? undefined;
  const providerType =
    currentOption?.provider_type ?? data?.provider_type ?? undefined;

  return {
    path,
    currentModel: currentName ?? undefined,
    providerType,
    resolvedModel: resolvedModel ?? undefined,
    resolvedBaseURL,
    resolvedApiKeyEnv,
    options: Array.isArray(data?.options) && data!.options!.length > 0 ? data!.options : undefined,
    models: models && models.length > 0 ? models : undefined,
  };
}

export async function resolveModelOption(name: string): Promise<ModelOption | null> {
  const { data } = await loadConfigCached();
  return data?.options?.find((o) => o.name === name) ?? null;
}

export type ResolvedRunModel = {
  model?: string;
  modelType?: ProviderType;
  baseURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
};

/**
 * 解析当前运行该使用的 provider/model 参数。
 * 优先级：current_model 命中的 option > 顶层配置 > undefined（让 engine 走 env fallback）。
 */
export async function resolveModelForRun(_platformKey: string): Promise<ResolvedRunModel> {
  const { data } = await loadConfigCached();
  if (!data) return {};

  const currentName = normalizeStr(data.current_model);
  const option = currentName ? data.options?.find((o) => o?.name === currentName) : undefined;

  const model = selectModel(data) ?? undefined;
  const modelType = option?.provider_type ?? data.provider_type;
  const baseURL = normalizeStr(option?.base_url) ?? normalizeStr(data.base_url) ?? undefined;
  const apiKeyEnv = normalizeStr(option?.api_key_env) ?? normalizeStr(data.api_key_env) ?? undefined;
  const apiKey = apiKeyEnv ? process.env[apiKeyEnv]?.trim() || undefined : undefined;
  const headers = option?.headers ?? data.headers;

  return { model, modelType, baseURL, apiKey, headers };
}
