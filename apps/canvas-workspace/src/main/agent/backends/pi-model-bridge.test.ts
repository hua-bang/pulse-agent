import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { preparePiModelBridge } from './pi-model-bridge';

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

afterEach(() => {
  delete process.env.PULSE_CANVAS_PI_BRIDGE_DIR;
  delete process.env.PULSE_CANVAS_MODEL_CONFIG;
  rmSync(dir, { recursive: true, force: true });
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
    expect(written.providers.canvas).toEqual({
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      api: 'openai-completions',
      apiKey: 'sk-third-party',
      // Mirrors the engine's request shape and survives strict-ish proxies.
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
      models: [{ id: 'deepseek-chat' }],
    });
    // Key material on disk stays user-only, matching the runtime-file trust model.
    expect(statSync(join(agentDir, 'models.json')).mode & 0o777).toBe(0o600);
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
