import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { safeStorage } from 'electron';

export type BuiltInToolCredentialId = 'openai' | 'gemini' | 'tavily';

export interface BuiltInToolCredentialDef {
  id: BuiltInToolCredentialId;
  name: string;
  description: string;
  envKey: string;
  baseUrlEnvKey: string;
  defaultBaseUrl: string;
  tools: string[];
}

export interface BuiltInToolCredentialStatus extends BuiltInToolCredentialDef {
  apiKeyPresent: boolean;
  apiKeyLength?: number;
  source: 'stored' | 'env' | 'missing';
  baseUrl: string;
  baseUrlSource: 'stored' | 'env' | 'default';
}

export interface BuiltInToolsConfigStatus {
  path: string;
  credentials: BuiltInToolCredentialStatus[];
}

export interface SetBuiltInToolCredentialInput {
  id: BuiltInToolCredentialId;
  apiKey?: string;
  baseUrl?: string;
}

interface BuiltInToolsConfigFile {
  credentials?: Partial<Record<BuiltInToolCredentialId, {
    encrypted_api_key?: string;
    base_url?: string;
  }>>;
}

export const BUILT_IN_TOOL_CREDENTIALS: BuiltInToolCredentialDef[] = [
  {
    id: 'openai',
    name: 'OpenAI Images & Vision',
    description: 'Used by canvas_analyze_image, canvas_generate_image, and canvas_generate_mindmap_image when using OpenAI/GPT.',
    envKey: 'OPENAI_API_KEY',
    baseUrlEnvKey: 'OPENAI_API_URL',
    defaultBaseUrl: 'https://api.openai.com/v1',
    tools: ['canvas_analyze_image', 'canvas_generate_image', 'canvas_generate_mindmap_image'],
  },
  {
    id: 'gemini',
    name: 'Gemini Images & Vision',
    description: 'Used by image analysis and image generation when the provider is Gemini.',
    envKey: 'GEMINI_API_KEY',
    baseUrlEnvKey: 'GEMINI_API_BASE_URL',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    tools: ['canvas_analyze_image', 'canvas_generate_image', 'canvas_generate_mindmap_image'],
  },
  {
    id: 'tavily',
    name: 'Tavily Web Tools',
    description: 'Used by built-in Tavily search, extract, crawl, and map tools.',
    envKey: 'TAVILY_API_KEY',
    baseUrlEnvKey: 'TAVILY_API_BASE_URL',
    defaultBaseUrl: 'https://api.tavily.com',
    tools: ['tavily', 'tavily_extract', 'tavily_crawl', 'tavily_map'],
  },
];

const ORIGINAL_ENV = new Map<string, string | undefined>();
for (const def of BUILT_IN_TOOL_CREDENTIALS) {
  ORIGINAL_ENV.set(def.envKey, process.env[def.envKey]);
  ORIGINAL_ENV.set(def.baseUrlEnvKey, process.env[def.baseUrlEnvKey]);
}

function normalizeStr(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeCredentialId(value: unknown): BuiltInToolCredentialId {
  const id = normalizeStr(value);
  if (!id) throw new Error('Tool credential id is required');
  if (id === 'openai' || id === 'gemini' || id === 'tavily') return id;
  throw new Error(`Unknown built-in tool credential: ${id}`);
}

function encryptApiKey(apiKey: string): string {
  // Avoid macOS Keychain prompts for new saves. Legacy `safe:` values are
  // still readable in decryptApiKey for existing users.
  return `plain:${Buffer.from(apiKey, 'utf8').toString('base64')}`;
}

function decryptApiKey(encrypted?: string, options: { allowSafe?: boolean } = {}): string | undefined {
  const value = normalizeStr(encrypted);
  if (!value) return undefined;
  const allowSafe = options.allowSafe ?? true;
  try {
    if (value.startsWith('safe:')) {
      if (!allowSafe) return undefined;
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

function getConfigPath(): string {
  const envPath = normalizeStr(process.env.PULSE_CANVAS_BUILT_IN_TOOLS_CONFIG);
  return envPath ?? join(homedir(), '.pulse-coder', 'canvas', 'built-in-tools-config.json');
}

async function readConfig(): Promise<BuiltInToolsConfigFile> {
  const path = getConfigPath();
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as BuiltInToolsConfigFile;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeConfig(config: BuiltInToolsConfigFile): Promise<void> {
  const path = getConfigPath();
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function getStoredApiKey(config: BuiltInToolsConfigFile, id: BuiltInToolCredentialId): string | undefined {
  return decryptApiKey(config.credentials?.[id]?.encrypted_api_key);
}

function getEnvApiKey(envKey: string): string | undefined {
  return normalizeStr(process.env[envKey]);
}

function getStoredBaseUrl(config: BuiltInToolsConfigFile, id: BuiltInToolCredentialId): string | undefined {
  return normalizeStr(config.credentials?.[id]?.base_url);
}

function getEnvValue(envKey: string): string | undefined {
  return normalizeStr(process.env[envKey]);
}

function credentialStatus(
  def: BuiltInToolCredentialDef,
  config: BuiltInToolsConfigFile,
): BuiltInToolCredentialStatus {
  const encrypted = normalizeStr(config.credentials?.[def.id]?.encrypted_api_key);
  const stored = decryptApiKey(encrypted, { allowSafe: false });
  const storedBaseUrl = getStoredBaseUrl(config, def.id);
  const envBaseUrl = getEnvValue(def.baseUrlEnvKey);
  const baseUrl = storedBaseUrl ?? envBaseUrl ?? def.defaultBaseUrl;
  const baseUrlSource = storedBaseUrl ? 'stored' : envBaseUrl ? 'env' : 'default';

  if (stored || encrypted) {
    return {
      ...def,
      apiKeyPresent: true,
      apiKeyLength: stored ? stored.length : undefined,
      source: 'stored',
      baseUrl,
      baseUrlSource,
    };
  }

  const envKey = getEnvApiKey(def.envKey);
  if (envKey) {
    return {
      ...def,
      apiKeyPresent: true,
      apiKeyLength: envKey.length,
      source: 'env',
      baseUrl,
      baseUrlSource,
    };
  }

  return {
    ...def,
    apiKeyPresent: false,
    source: 'missing',
    baseUrl,
    baseUrlSource,
  };
}

export async function getBuiltInToolsConfigStatus(): Promise<BuiltInToolsConfigStatus> {
  const config = await readConfig();
  return {
    path: resolve(getConfigPath()),
    credentials: BUILT_IN_TOOL_CREDENTIALS.map((def) => credentialStatus(def, config)),
  };
}

export async function setBuiltInToolCredential(
  input: SetBuiltInToolCredentialInput,
): Promise<BuiltInToolsConfigStatus> {
  const id = normalizeCredentialId(input.id);
  const apiKey = normalizeStr(input.apiKey);
  const baseUrl = normalizeStr(input.baseUrl);
  const hasBaseUrlInput = Object.prototype.hasOwnProperty.call(input, 'baseUrl');
  if (!apiKey && !hasBaseUrlInput) throw new Error('API key or Base URL is required');

  const config = await readConfig();
  const existing = config.credentials?.[id] ?? {};
  const next = {
    ...existing,
  };
  if (apiKey) next.encrypted_api_key = encryptApiKey(apiKey);
  if (hasBaseUrlInput) {
    if (baseUrl) next.base_url = baseUrl;
    else delete next.base_url;
  }
  config.credentials = {
    ...(config.credentials ?? {}),
    [id]: next,
  };
  if (!next.encrypted_api_key && !next.base_url) {
    delete config.credentials[id];
  }
  await writeConfig(config);
  applyBuiltInToolsConfigToEnv(config);
  return await getBuiltInToolsConfigStatus();
}

export async function clearBuiltInToolCredential(
  idValue: string,
): Promise<BuiltInToolsConfigStatus> {
  const id = normalizeCredentialId(idValue);
  const config = await readConfig();
  if (config.credentials) {
    delete config.credentials[id];
  }
  await writeConfig(config);
  applyBuiltInToolsConfigToEnv(config);
  return await getBuiltInToolsConfigStatus();
}

export async function applyStoredBuiltInToolsConfigToEnv(): Promise<void> {
  applyBuiltInToolsConfigToEnv(await readConfig());
}

function applyBuiltInToolsConfigToEnv(config: BuiltInToolsConfigFile): void {
  for (const def of BUILT_IN_TOOL_CREDENTIALS) {
    const stored = getStoredApiKey(config, def.id);
    if (stored) {
      process.env[def.envKey] = stored;
    } else {
      const original = normalizeStr(ORIGINAL_ENV.get(def.envKey));
      if (original) {
        process.env[def.envKey] = original;
      } else {
        delete process.env[def.envKey];
      }
    }

    const storedBaseUrl = getStoredBaseUrl(config, def.id);
    if (storedBaseUrl) {
      process.env[def.baseUrlEnvKey] = storedBaseUrl;
      continue;
    }

    const originalBaseUrl = normalizeStr(ORIGINAL_ENV.get(def.baseUrlEnvKey));
    if (originalBaseUrl) {
      process.env[def.baseUrlEnvKey] = originalBaseUrl;
    } else {
      delete process.env[def.baseUrlEnvKey];
    }
  }
}
