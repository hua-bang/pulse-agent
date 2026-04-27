import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  clearModelOverride,
  getModelStatus,
  resolveModelForRun,
  resolveModelOption,
  writeModelConfig,
} from './model-config.js';

let tmpDir: string;
let configPath: string;
const ENV_KEY = 'PULSE_CODER_MODEL_CONFIG';
const TEST_API_ENV = 'TEST_PROVIDER_API_KEY';

const originalEnv = process.env[ENV_KEY];
const originalApiKey = process.env[TEST_API_ENV];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pulse-model-config-'));
  configPath = join(tmpDir, 'config.json');
  process.env[ENV_KEY] = configPath;
  delete process.env[TEST_API_ENV];
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalEnv;
  if (originalApiKey === undefined) delete process.env[TEST_API_ENV];
  else process.env[TEST_API_ENV] = originalApiKey;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('model-config provider overrides', () => {
  it('returns empty when no config exists', async () => {
    const result = await resolveModelForRun('platform-key');
    expect(result).toEqual({});
  });

  it('writes and reads back top-level provider overrides', async () => {
    await writeModelConfig({
      current_model: 'gpt-4o-mini',
      provider_type: 'openai',
      base_url: 'https://example.com/v1',
      api_key_env: TEST_API_ENV,
      headers: { 'x-test': '1' },
    });

    process.env[TEST_API_ENV] = 'sk-test-123';

    const resolved = await resolveModelForRun('platform-key');
    expect(resolved.model).toBe('gpt-4o-mini');
    expect(resolved.modelType).toBe('openai');
    expect(resolved.baseURL).toBe('https://example.com/v1');
    expect(resolved.apiKey).toBe('sk-test-123');
    expect(resolved.headers).toEqual({ 'x-test': '1' });
  });

  it('option-level overrides take precedence over top-level fallbacks', async () => {
    await writeModelConfig({
      current_model: 'claude-fast',
      provider_type: 'openai',
      base_url: 'https://top.example/v1',
      api_key_env: 'TOP_KEY',
      options: [
        {
          name: 'claude-fast',
          provider_type: 'claude',
          base_url: 'https://opt.example/v1',
          api_key_env: TEST_API_ENV,
          model: 'claude-3-5-sonnet-latest',
          headers: { 'x-opt': '1' },
        },
      ],
    });

    process.env[TEST_API_ENV] = 'opt-key';

    const resolved = await resolveModelForRun('p');
    expect(resolved.model).toBe('claude-3-5-sonnet-latest'); // option.model wins
    expect(resolved.modelType).toBe('claude');
    expect(resolved.baseURL).toBe('https://opt.example/v1');
    expect(resolved.apiKey).toBe('opt-key');
    expect(resolved.headers).toEqual({ 'x-opt': '1' });
  });

  it('apiKey is undefined when env var missing', async () => {
    await writeModelConfig({
      current_model: 'm',
      provider_type: 'openai',
      api_key_env: TEST_API_ENV,
    });
    const resolved = await resolveModelForRun('p');
    expect(resolved.apiKey).toBeUndefined();
  });

  it('getModelStatus reflects resolved provider fields', async () => {
    await writeModelConfig({
      current_model: 'm',
      provider_type: 'claude',
      base_url: 'https://b/v1',
      api_key_env: TEST_API_ENV,
    });
    const status = await getModelStatus();
    expect(status.providerType).toBe('claude');
    expect(status.resolvedBaseURL).toBe('https://b/v1');
    expect(status.resolvedApiKeyEnv).toBe(TEST_API_ENV);
    expect(status.resolvedModel).toBe('m');
  });

  it('clearModelOverride removes provider-level overrides', async () => {
    await writeModelConfig({
      current_model: 'm',
      provider_type: 'claude',
      base_url: 'https://b/v1',
      api_key_env: TEST_API_ENV,
      options: [{ name: 'm', provider_type: 'claude' }],
    });
    await clearModelOverride();
    const status = await getModelStatus();
    expect(status.currentModel).toBeUndefined();
    expect(status.providerType).toBeUndefined();
    expect(status.resolvedBaseURL).toBeUndefined();
    expect(status.resolvedApiKeyEnv).toBeUndefined();
    // options preserved as a dictionary
    expect(status.options?.[0]?.name).toBe('m');
  });

  it('resolveModelOption returns option by name', async () => {
    await writeModelConfig({
      options: [
        { name: 'a', provider_type: 'openai' },
        { name: 'b', provider_type: 'claude', base_url: 'https://b' },
      ],
    });
    const opt = await resolveModelOption('b');
    expect(opt?.provider_type).toBe('claude');
    expect(opt?.base_url).toBe('https://b');
  });
});
