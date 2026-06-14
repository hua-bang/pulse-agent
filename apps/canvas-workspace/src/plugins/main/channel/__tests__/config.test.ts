import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let root: string;
let configPath: string;
let previousConfig: string | undefined;
let previousAppId: string | undefined;
let previousAppSecret: string | undefined;
let previousWorkspace: string | undefined;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'channel-config-test-'));
  configPath = join(root, 'channel-config.json');
  previousConfig = process.env.PULSE_CANVAS_CHANNEL_CONFIG;
  previousAppId = process.env.FEISHU_APP_ID;
  previousAppSecret = process.env.FEISHU_APP_SECRET;
  previousWorkspace = process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE;
  process.env.PULSE_CANVAS_CHANNEL_CONFIG = configPath;
  delete process.env.FEISHU_APP_ID;
  delete process.env.FEISHU_APP_SECRET;
  delete process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE;
  vi.resetModules();
});

afterEach(async () => {
  if (previousConfig === undefined) delete process.env.PULSE_CANVAS_CHANNEL_CONFIG;
  else process.env.PULSE_CANVAS_CHANNEL_CONFIG = previousConfig;
  if (previousAppId === undefined) delete process.env.FEISHU_APP_ID;
  else process.env.FEISHU_APP_ID = previousAppId;
  if (previousAppSecret === undefined) delete process.env.FEISHU_APP_SECRET;
  else process.env.FEISHU_APP_SECRET = previousAppSecret;
  if (previousWorkspace === undefined) delete process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE;
  else process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE = previousWorkspace;
  await fs.rm(root, { recursive: true, force: true });
});

describe('channel credential storage', () => {
  it('does not apply legacy safeStorage Feishu secrets to env', async () => {
    await fs.writeFile(configPath, JSON.stringify({
      feishu: {
        appId: 'cli_123',
        encryptedAppSecret: 'safe:legacy-secret',
      },
    }), 'utf8');

    const { applyChannelConfigToEnv, getChannelConfigStatus } = await import('../config');
    applyChannelConfigToEnv();
    const status = await getChannelConfigStatus();

    expect(process.env.FEISHU_APP_ID).toBe('cli_123');
    expect(process.env.FEISHU_APP_SECRET).toBeUndefined();
    expect(status.feishu.secretPresent).toBe(false);
  });

  it('drops a legacy safeStorage secret when saving a non-secret field', async () => {
    await fs.writeFile(configPath, JSON.stringify({
      feishu: {
        appId: 'cli_123',
        encryptedAppSecret: 'safe:legacy-secret',
      },
    }), 'utf8');

    const { setFeishuConfig } = await import('../config');
    await setFeishuConfig({ defaultWorkspaceId: 'workspace-1' });

    const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
    expect(raw.feishu.encryptedAppSecret).toBeUndefined();
    expect(raw.feishu.defaultWorkspaceId).toBe('workspace-1');
  });
});
