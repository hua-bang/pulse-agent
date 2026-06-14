import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let root: string;
let configPath: string;
let previousConfig: string | undefined;
let previousOpenAiKey: string | undefined;
let previousOpenAiUrl: string | undefined;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'built-in-tools-config-test-'));
  configPath = join(root, 'built-in-tools-config.json');
  previousConfig = process.env.PULSE_CANVAS_BUILT_IN_TOOLS_CONFIG;
  previousOpenAiKey = process.env.OPENAI_API_KEY;
  previousOpenAiUrl = process.env.OPENAI_API_URL;
  process.env.PULSE_CANVAS_BUILT_IN_TOOLS_CONFIG = configPath;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_URL;
  vi.resetModules();
});

afterEach(async () => {
  if (previousConfig === undefined) delete process.env.PULSE_CANVAS_BUILT_IN_TOOLS_CONFIG;
  else process.env.PULSE_CANVAS_BUILT_IN_TOOLS_CONFIG = previousConfig;
  if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousOpenAiKey;
  if (previousOpenAiUrl === undefined) delete process.env.OPENAI_API_URL;
  else process.env.OPENAI_API_URL = previousOpenAiUrl;
  await fs.rm(root, { recursive: true, force: true });
});

describe('built-in tool credential storage', () => {
  it('ignores legacy safeStorage API keys when applying stored config', async () => {
    await fs.writeFile(configPath, JSON.stringify({
      credentials: {
        openai: {
          encrypted_api_key: 'safe:legacy-key',
        },
      },
    }), 'utf8');

    const { applyStoredBuiltInToolsConfigToEnv, getBuiltInToolsConfigStatus } = await import('../built-in-tools-config');
    await applyStoredBuiltInToolsConfigToEnv();
    const status = await getBuiltInToolsConfigStatus();
    const openai = status.credentials.find((item) => item.id === 'openai');

    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(openai?.source).toBe('missing');
    expect(openai?.apiKeyPresent).toBe(false);
  });

  it('drops an unusable legacy key when saving another field', async () => {
    await fs.writeFile(configPath, JSON.stringify({
      credentials: {
        openai: {
          encrypted_api_key: 'safe:legacy-key',
        },
      },
    }), 'utf8');

    const { setBuiltInToolCredential } = await import('../built-in-tools-config');
    await setBuiltInToolCredential({
      id: 'openai',
      baseUrl: 'https://example.test/v1',
    });

    const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
    expect(raw.credentials.openai.encrypted_api_key).toBeUndefined();
    expect(raw.credentials.openai.base_url).toBe('https://example.test/v1');
  });
});
