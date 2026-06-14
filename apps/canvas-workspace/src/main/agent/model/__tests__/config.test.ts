import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let root: string;
let configPath: string;
let previousModelConfig: string | undefined;
let previousOpenAiKey: string | undefined;
let previousAnthropicKey: string | undefined;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'canvas-model-config-test-'));
  configPath = join(root, 'model-config.json');
  previousModelConfig = process.env.PULSE_CANVAS_MODEL_CONFIG;
  previousOpenAiKey = process.env.OPENAI_API_KEY;
  previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
  process.env.PULSE_CANVAS_MODEL_CONFIG = configPath;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  vi.resetModules();
});

afterEach(async () => {
  if (previousModelConfig === undefined) delete process.env.PULSE_CANVAS_MODEL_CONFIG;
  else process.env.PULSE_CANVAS_MODEL_CONFIG = previousModelConfig;
  if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousOpenAiKey;
  if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
  await fs.rm(root, { recursive: true, force: true });
});

describe('canvas model config key storage', () => {
  it('ignores legacy safeStorage API keys without marking the provider configured', async () => {
    await fs.writeFile(configPath, JSON.stringify({
      current_provider: 'openai',
      providers: [{
        id: 'openai',
        name: 'OpenAI',
        provider_type: 'openai',
        base_url: 'https://api.openai.com/v1',
        encrypted_api_key: 'safe:legacy-key',
        models: [{ id: 'gpt-4o' }],
      }],
    }), 'utf8');

    const { getCanvasModelStatus } = await import('../config');
    const status = await getCanvasModelStatus();

    expect(status.apiKeyPresent).toBe(false);
    expect(status.providers[0]?.apiKeyPresent).toBe(false);
    expect(status.providers[0]?.apiKeyLength).toBeUndefined();
  });

  it('rewrites a legacy key when the provider is saved with a new API key', async () => {
    await fs.writeFile(configPath, JSON.stringify({
      providers: [{
        id: 'openai',
        name: 'OpenAI',
        provider_type: 'openai',
        base_url: 'https://api.openai.com/v1',
        encrypted_api_key: 'safe:legacy-key',
        models: [{ id: 'gpt-4o' }],
      }],
    }), 'utf8');

    const { upsertCanvasModelProvider } = await import('../config');
    await upsertCanvasModelProvider({
      id: 'openai',
      name: 'OpenAI',
      provider_type: 'openai',
      base_url: 'https://api.openai.com/v1',
      api_key: 'sk-new',
      models: [{ id: 'gpt-4o' }],
    });

    const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
    expect(raw.providers[0].encrypted_api_key).toBe(`plain:${Buffer.from('sk-new', 'utf8').toString('base64')}`);
  });
});
