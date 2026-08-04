import { describe, expect, it } from 'vitest';

import { createPiModelRuntime } from './pi-model-adapter';

describe('createPiModelRuntime', () => {
  it('maps a Canvas OpenAI-compatible model without writing pi config files', async () => {
    const runtime = createPiModelRuntime({
      providerId: 'gateway',
      providerName: 'Gateway',
      providerType: 'openai',
      model: 'vendor/model-x',
      modelLabel: 'Model X',
      provider: (() => undefined) as never,
      connection: {
        baseURL: 'https://gateway.example/v1',
        apiKey: 'secret',
        headers: { 'x-tenant': 'canvas' },
      },
    });

    expect(runtime.model).toMatchObject({
      id: 'vendor/model-x',
      name: 'Model X',
      provider: 'canvas-gateway',
      api: 'openai-responses',
      baseUrl: 'https://gateway.example/v1',
    });
    expect(runtime.models.getModel('canvas-gateway', 'vendor/model-x')).toBe(runtime.model);
    await expect(runtime.models.getAuth(runtime.model)).resolves.toMatchObject({
      auth: {
        apiKey: 'secret',
        baseUrl: 'https://gateway.example/v1',
        headers: { 'x-tenant': 'canvas' },
      },
      source: 'Pulse Canvas model config',
    });
  });

  it('uses the Anthropic messages transport for Claude providers', () => {
    const runtime = createPiModelRuntime({
      providerType: 'claude',
      model: 'claude-test',
      modelLabel: 'Claude Test',
      provider: (() => undefined) as never,
      connection: {},
    });

    expect(runtime.model.api).toBe('anthropic-messages');
    expect(runtime.model.baseUrl).toBe('https://api.anthropic.com');
  });
});
