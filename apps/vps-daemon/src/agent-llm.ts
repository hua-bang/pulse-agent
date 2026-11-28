import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createOpenAI } from '@ai-sdk/openai';
import { buildProvider, createTimedFetch, type LLMProviderFactory } from 'pulse-coder-engine';

export type AgentLlmProvider = 'openai' | 'anthropic';

export interface AgentLlmConfig {
  provider: AgentLlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AgentLlmOverride {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

function defaultEnvFilePath(): string {
  return join(homedir(), '.pulse-vps-daemon', '.env');
}

function readDotEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && val) out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveAgentLlmConfigToEnvFile(
  input: AgentLlmOverride,
  envFilePath = defaultEnvFilePath(),
): void {
  const existing = readDotEnvFile(envFilePath);
  const next = { ...existing };
  if (input.provider === 'openai' || input.provider === 'anthropic') {
    next.PULSE_AGENT_PROVIDER = input.provider;
  }
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    next.PULSE_AGENT_API_KEY = input.apiKey.trim();
  }
  if (typeof input.baseUrl === 'string') {
    if (input.baseUrl.trim()) next.PULSE_AGENT_BASE_URL = input.baseUrl.trim();
    else delete next.PULSE_AGENT_BASE_URL;
  }
  if (typeof input.model === 'string') {
    if (input.model.trim()) next.PULSE_AGENT_MODEL = input.model.trim();
    else delete next.PULSE_AGENT_MODEL;
  }
  mkdirSync(dirname(envFilePath), { recursive: true });
  const lines = Object.entries(next).map(([k, v]) => `${k}=${v.replace(/[\r\n]/g, '')}`);
  writeFileSync(envFilePath, `${lines.join('\n')}\n`, { encoding: 'utf-8', mode: 0o600 });
}

export function resolveAgentLlmConfig(override?: AgentLlmOverride): AgentLlmConfig | null {
  const fileEnv = readDotEnvFile(defaultEnvFilePath());
  const get = (key: string): string => (process.env[key] ?? fileEnv[key] ?? '').trim();

  const ovProvider = typeof override?.provider === 'string' ? override.provider.trim().toLowerCase() : '';
  const ovKey = typeof override?.apiKey === 'string' ? override.apiKey.trim() : '';
  const ovBase = typeof override?.baseUrl === 'string' ? override.baseUrl.trim() : '';
  const ovModel = typeof override?.model === 'string' ? override.model.trim() : '';

  const explicitProvider = ovProvider || get('PULSE_AGENT_PROVIDER').toLowerCase();
  const pulseKey = ovKey || get('PULSE_AGENT_API_KEY');
  const anthropicKey = get('ANTHROPIC_API_KEY');
  const openaiKey = get('OPENAI_API_KEY');

  let provider: AgentLlmProvider;
  if (explicitProvider === 'anthropic' || explicitProvider === 'openai') {
    provider = explicitProvider;
  } else if (!pulseKey && anthropicKey && !openaiKey) {
    provider = 'anthropic';
  } else if (
    (ovBase || get('PULSE_AGENT_BASE_URL')).includes('anthropic') ||
    (ovModel || get('PULSE_AGENT_MODEL')).startsWith('claude')
  ) {
    provider = 'anthropic';
  } else {
    provider = 'openai';
  }

  const apiKey = pulseKey || (provider === 'anthropic' ? anthropicKey : openaiKey) || anthropicKey || openaiKey;
  if (!apiKey) return null;

  const defaultBase = provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1';
  const baseUrl = (
    ovBase ||
    get('PULSE_AGENT_BASE_URL') ||
    (provider === 'anthropic' ? get('ANTHROPIC_BASE_URL') : get('OPENAI_BASE_URL')) ||
    defaultBase
  ).replace(/\/+$/, '');

  const model =
    ovModel ||
    get('PULSE_AGENT_MODEL') ||
    (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4.1');

  return { provider, apiKey, baseUrl, model };
}

/**
 * Construct a Vercel AI SDK LanguageModel factory for pulse-coder-engine.
 * Uses Chat Completions (`.chat`) for OpenAI-compatible endpoints so third-party
 * proxies (DeepSeek, OpenRouter, Moonshot, Qwen, local gateways) work seamlessly.
 */
export function buildVpsLlmProvider(config: AgentLlmConfig): LLMProviderFactory {
  if (config.provider === 'anthropic') {
    const normalizedBase = config.baseUrl.endsWith('/v1')
      ? config.baseUrl
      : `${config.baseUrl.replace(/\/+$/, '')}/v1`;
    return buildProvider('claude', {
      apiKey: config.apiKey,
      baseURL: normalizedBase,
    });
  }
  return createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    fetch: createTimedFetch(),
  }).chat as LLMProviderFactory;
}
