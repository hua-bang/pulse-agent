import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';

import { preparePiModelBridge } from './pi-model-bridge';
import { stopPiStreamRelay } from './pi-stream-relay';

let dir: string;

const plainKey = (key: string) => `plain:${Buffer.from(key, 'utf8').toString('base64')}`;

const writeModelConfig = (config: unknown) => {
  const path = join(dir, 'model-config.json');
  writeFileSync(path, JSON.stringify(config));
  process.env.PULSE_CANVAS_MODEL_CONFIG = path;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pi-bridge-'));
  process.env.PULSE_CANVAS_PI_BRIDGE_DIR = join(dir, 'pi-agent');
});

afterEach(async () => {
  delete process.env.PULSE_CANVAS_PI_BRIDGE_DIR;
  delete process.env.PULSE_CANVAS_MODEL_CONFIG;
  rmSync(dir, { recursive: true, force: true });
  await stopPiStreamRelay();
});

describe('preparePiModelBridge', () => {
  it('mirrors a third-party OpenAI-compatible provider into pi models.json', async () => {
    writeModelConfig({
      current_provider: 'deepseek',
      current_model: 'deepseek-chat',
      providers: [{
        id: 'deepseek',
        name: 'DeepSeek',
        provider_type: 'openai',
        base_url: 'https://api.deepseek.com/v1',
        encrypted_api_key: plainKey('sk-third-party'),
        models: [{ id: 'deepseek-chat' }],
      }],
    });

    const bridge = await preparePiModelBridge();
    expect(bridge).toBeDefined();
    expect(bridge!.extraArgs).toEqual(['--provider', 'canvas', '--model', 'deepseek-chat']);
    const agentDir = bridge!.env.PI_CODING_AGENT_DIR;
    expect(agentDir).toBe(join(dir, 'pi-agent'));

    const written = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf-8'));
    expect(written.providers.canvas).toMatchObject({
      name: 'DeepSeek',
      api: 'openai-completions',
      apiKey: 'sk-third-party',
      // Mirrors the engine's request shape and survives strict-ish proxies.
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
      models: [{ id: 'deepseek-chat' }],
    });
    // OpenAI-compatible upstreams are fronted by the loopback SSE-normalizing
    // relay; the real base URL lives on the relay side.
    expect(written.providers.canvas.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // Key material on disk stays user-only, matching the runtime-file trust model.
    expect(statSync(join(agentDir, 'models.json')).mode & 0o777).toBe(0o600);
  });

  it('preserves Canvas root-base semantics by forwarding pi requests through /v1', async () => {
    let requestedPath: string | undefined;
    const upstream = createServer((req, res) => {
      requestedPath = req.url;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: [DONE]\n\n');
    });
    const port = await new Promise<number>((resolve) => {
      upstream.listen(0, '127.0.0.1', () => {
        resolve((upstream.address() as { port: number }).port);
      });
    });

    try {
      writeModelConfig({
        current_provider: 'gateway',
        current_model: 'gateway-model',
        providers: [{
          id: 'gateway',
          provider_type: 'openai',
          base_url: `http://127.0.0.1:${port}`,
          encrypted_api_key: plainKey('sk-gateway'),
          models: [{ id: 'gateway-model' }],
        }],
      });

      const bridge = await preparePiModelBridge();
      const written = JSON.parse(readFileSync(
        join(bridge!.env.PI_CODING_AGENT_DIR, 'models.json'),
        'utf-8',
      ));
      await fetch(`${written.providers.canvas.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gateway-model', stream: true, messages: [] }),
      });

      expect(requestedPath).toBe('/v1/chat/completions');
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it('honors the per-scope model override and claude → anthropic-messages mapping', async () => {
    writeModelConfig({
      current_provider: 'anthropic',
      current_model: 'claude-sonnet-4-5',
      providers: [{
        id: 'anthropic',
        name: 'Anthropic',
        provider_type: 'claude',
        encrypted_api_key: plainKey('sk-ant'),
        models: [{ id: 'claude-sonnet-4-5' }],
      }],
    });

    const bridge = await preparePiModelBridge('claude-opus-4-6');
    const written = JSON.parse(readFileSync(
      join(bridge!.env.PI_CODING_AGENT_DIR, 'models.json'),
      'utf-8',
    ));
    expect(written.providers.canvas.api).toBe('anthropic-messages');
    expect(written.providers.canvas.baseUrl).toBe('https://api.anthropic.com/v1');
    expect(written.providers.canvas.models).toEqual([{ id: 'claude-opus-4-6' }]);
    expect(written.providers.canvas.compat).toBeUndefined();
    expect(bridge!.extraArgs).toEqual(['--provider', 'canvas', '--model', 'claude-opus-4-6']);
  });

  it('declines to bridge without a usable key so pi falls back to its own config', async () => {
    writeModelConfig({
      current_provider: 'deepseek',
      current_model: 'deepseek-chat',
      providers: [{
        id: 'deepseek',
        provider_type: 'openai',
        base_url: 'https://api.deepseek.com/v1',
        api_key_env: 'PULSE_TEST_KEY_THAT_IS_UNSET',
        models: [{ id: 'deepseek-chat' }],
      }],
    });
    await expect(preparePiModelBridge()).resolves.toBeUndefined();
  });
});
