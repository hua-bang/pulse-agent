import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let root: string;
let configPath: string;
let previousConfig: string | undefined;
let previousOpenAiKey: string | undefined;
let previousOpenAiUrl: string | undefined;
let previousTypesafeKey: string | undefined;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'built-in-tools-config-test-'));
  configPath = join(root, 'built-in-tools-config.json');
  previousConfig = process.env.PULSE_CANVAS_BUILT_IN_TOOLS_CONFIG;
  previousOpenAiKey = process.env.OPENAI_API_KEY;
  previousOpenAiUrl = process.env.OPENAI_API_URL;
  previousTypesafeKey = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
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
  if (previousTypesafeKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = previousTypesafeKey;
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


describe('TypeSafe key settings', () => {
  it('saves and loads the key without exposing it in status, and clears it', async () => {
    const config = await import('../built-in-tools-config');
    const key = 'test-only-jev-settings-key';
    const status = await config.setBuiltInToolCredential({ id: 'typesafe', apiKey: key });
    expect(status.credentials.find(item => item.id === 'typesafe')).toMatchObject({
      source: 'stored', apiKeyPresent: true, apiKeyLength: key.length,
      baseUrl: 'https://api.typesafe.ai/v1', baseUrlEditable: false, tools: ['page_run'],
    });
    expect(JSON.stringify(status)).not.toContain(key);
    expect(process.env.TYPESAFE_API_KEY).toBe(key);
    delete process.env.TYPESAFE_API_KEY;
    await config.applyStoredBuiltInToolsConfigToEnv();
    expect(process.env.TYPESAFE_API_KEY).toBe(key);
    const cleared = await config.clearBuiltInToolCredential('typesafe');
    expect(cleared.credentials.find(item => item.id === 'typesafe')?.source).toBe('missing');
    expect(process.env.TYPESAFE_API_KEY).toBeUndefined();
  });

  it('restores an original environment key when the saved key is cleared', async () => {
    process.env.TYPESAFE_API_KEY = 'test-only-env-key';
    const config = await import('../built-in-tools-config');
    await config.setBuiltInToolCredential({ id: 'typesafe', apiKey: 'test-only-saved-key' });
    const cleared = await config.clearBuiltInToolCredential('typesafe');
    expect(process.env.TYPESAFE_API_KEY).toBe('test-only-env-key');
    expect(cleared.credentials.find(item => item.id === 'typesafe')?.source).toBe('env');
  });

  it('rejects changing the TypeSafe endpoint before writing any configuration', async () => {
    const config = await import('../built-in-tools-config');
    await expect(config.setBuiltInToolCredential({ id: 'typesafe', apiKey: 'test-key', baseUrl: 'https://other.test' }))
      .rejects.toThrow('fixed official API endpoint');
    await expect(fs.access(configPath)).rejects.toThrow();
  });
});
