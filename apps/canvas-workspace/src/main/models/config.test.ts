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

    const { getCanvasModelStatus } = await import('./config');
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

    const { upsertCanvasModelProvider } = await import('./config');
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

describe('canvas model context windows', () => {
  it('keeps the fetched catalog and resolves the selected model window', async () => {
    const { getCanvasModelStatus, resolveCanvasModel, upsertCanvasModelProvider } = await import('./config');
    await upsertCanvasModelProvider({
      id: 'codex',
      name: 'Codex',
      provider_type: 'openai',
      base_url: 'https://gateway.example/v1',
      api_key: 'sk-test',
      models: [{ id: 'gpt-6-astra', context_window: 1_050_000 }],
      available_models: [{ id: 'gpt-6-astra', context_window: 1_050_000 }, { id: 'gpt-5' }],
    });

    const status = await getCanvasModelStatus();
    expect(status.providers[0]?.available_models).toEqual([
      { id: 'gpt-6-astra', context_window: 1_050_000 },
      { id: 'gpt-5' },
    ]);
    expect((await resolveCanvasModel()).contextWindowTokens).toBe(1_050_000);
  });

  it('prefers the window the user set for the model, then the reported one, then the default', async () => {
    const { resolveCanvasModel, upsertCanvasModelProvider, DEFAULT_CONTEXT_WINDOW_TOKENS } = await import('./config');
    await upsertCanvasModelProvider({
      id: 'gw',
      name: 'Gateway',
      api_key: 'sk-test',
      base_url: 'https://gateway.example/v1',
      models: [{ id: 'm1' }],
    });
    expect((await resolveCanvasModel()).contextWindowTokens).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS);

    await upsertCanvasModelProvider({ id: 'gw', name: 'Gateway', models: [{ id: 'm1', context_window: 200_000 }] });
    expect((await resolveCanvasModel()).contextWindowTokens).toBe(200_000);

    // A window the user set for the model wins over the reported one.
    await upsertCanvasModelProvider({
      id: 'gw',
      name: 'Gateway',
      models: [{ id: 'm1', context_window: 200_000, custom_context_window: 400_000 }],
    });
    expect((await resolveCanvasModel()).contextWindowTokens).toBe(400_000);
  });

  it('moves a provider window saved by an older release onto models without one', async () => {
    await fs.writeFile(configPath, JSON.stringify({
      current_provider: 'gw',
      current_model: 'm1',
      providers: [{
        id: 'gw',
        name: 'Gateway',
        api_key_env: 'OPENAI_API_KEY',
        context_window: 64_000,
        models: [{ id: 'm1' }, { id: 'm2', context_window: 200_000 }],
      }],
    }));
    const { resolveCanvasModel, getCanvasModelStatus } = await import('./config');
    expect((await resolveCanvasModel()).contextWindowTokens).toBe(64_000);
    const provider = (await getCanvasModelStatus()).providers[0];
    expect(provider.models).toEqual([
      { id: 'm1', custom_context_window: 64_000 },
      { id: 'm2', context_window: 200_000 },
    ]);
    expect(provider).not.toHaveProperty('context_window');
  });

  it('reads the window a gateway reports in /models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'a', context_length: 200_000 },
          { id: 'b', top_provider: { context_length: 131_072 } },
          { id: 'c', max_model_len: '32768' },
          { id: 'd' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { fetchCanvasProviderModels } = await import('./config');
      const models = await fetchCanvasProviderModels({
        provider: { id: 'gw', name: 'Gateway', base_url: 'https://gateway.example/v1', api_key: 'sk-test' },
      });
      expect(models).toEqual([
        { id: 'a', context_window: 200_000 },
        { id: 'b', context_window: 131_072 },
        { id: 'c', context_window: 32_768 },
        { id: 'd' },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
