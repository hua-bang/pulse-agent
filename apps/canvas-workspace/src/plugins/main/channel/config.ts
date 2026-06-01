import { safeStorage } from 'electron';
import { promises as fs, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

// Persistent channel credentials, configurable from Settings → Experimental
// instead of (or in addition to) shell env vars. The Feishu app secret is a
// secret, so it is stored encrypted via Electron safeStorage — mirroring how
// the model API key is handled.
//
// Resolution: env vars take precedence (power users / CI). On startup,
// applyChannelConfigToEnv() populates process.env from this file ONLY for
// keys not already set, so the rest of the channel code can keep reading
// process.env unchanged.

function configPath(): string {
  const envPath = process.env.PULSE_CANVAS_CHANNEL_CONFIG?.trim();
  return envPath || join(homedir(), '.pulse-coder', 'canvas', 'channel-config.json');
}

interface FeishuConfig {
  appId?: string;
  encryptedAppSecret?: string;
  defaultWorkspaceId?: string;
}

interface ChannelConfigFile {
  feishu?: FeishuConfig;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function encryptSecret(secret: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `safe:${safeStorage.encryptString(secret).toString('base64')}`;
    }
  } catch {
    // Fall through to obfuscation for dev environments without an OS keychain.
  }
  return `plain:${Buffer.from(secret, 'utf8').toString('base64')}`;
}

function decryptSecret(encrypted?: string): string | undefined {
  const value = trimOrUndefined(encrypted);
  if (!value) return undefined;
  try {
    if (value.startsWith('safe:')) {
      return safeStorage.decryptString(Buffer.from(value.slice(5), 'base64'));
    }
    if (value.startsWith('plain:')) {
      return Buffer.from(value.slice(6), 'base64').toString('utf8');
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function parseConfig(raw: string): ChannelConfigFile {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ChannelConfigFile;
    }
  } catch {
    // ignore — treat as empty
  }
  return {};
}

function readConfigSync(): ChannelConfigFile {
  try {
    return parseConfig(readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

async function readConfig(): Promise<ChannelConfigFile> {
  try {
    return parseConfig(await fs.readFile(configPath(), 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeConfig(cfg: ChannelConfigFile): Promise<void> {
  const p = configPath();
  await fs.mkdir(dirname(p), { recursive: true });
  await fs.writeFile(p, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
}

/**
 * Populate process.env from the stored config for any channel var not
 * already set in the environment (env wins). Called synchronously at app
 * startup, before plugins evaluate `enabledWhen`.
 */
export function applyChannelConfigToEnv(): void {
  const feishu = readConfigSync().feishu;
  if (!feishu) return;

  if (feishu.appId && !process.env.FEISHU_APP_ID) {
    process.env.FEISHU_APP_ID = feishu.appId;
  }
  if (feishu.encryptedAppSecret && !process.env.FEISHU_APP_SECRET) {
    const secret = decryptSecret(feishu.encryptedAppSecret);
    if (secret) process.env.FEISHU_APP_SECRET = secret;
  }
  if (feishu.defaultWorkspaceId && !process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE) {
    process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE = feishu.defaultWorkspaceId;
  }
}

export interface ChannelConfigStatus {
  path: string;
  feishu: {
    /** Stored App ID (safe to echo — not a secret). */
    appId?: string;
    /** App Secret present (stored or via env). The secret itself is never returned. */
    secretPresent: boolean;
    /** Stored default workspace id. */
    defaultWorkspaceId?: string;
    /** Whether each value is currently overridden by an env var. */
    appIdFromEnv: boolean;
    secretFromEnv: boolean;
    defaultWorkspaceFromEnv: boolean;
  };
}

export async function getChannelConfigStatus(): Promise<ChannelConfigStatus> {
  const feishu = (await readConfig()).feishu ?? {};
  const appIdFromEnv = Boolean(process.env.FEISHU_APP_ID);
  const secretFromEnv = Boolean(process.env.FEISHU_APP_SECRET);
  const defaultWorkspaceFromEnv = Boolean(process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE);
  return {
    path: configPath(),
    feishu: {
      appId: feishu.appId,
      secretPresent: Boolean(feishu.encryptedAppSecret) || secretFromEnv,
      defaultWorkspaceId: feishu.defaultWorkspaceId,
      appIdFromEnv,
      secretFromEnv,
      defaultWorkspaceFromEnv,
    },
  };
}

export interface SetFeishuConfigInput {
  appId?: string;
  /** New secret to store. Empty/omitted leaves the existing secret untouched. */
  appSecret?: string;
  defaultWorkspaceId?: string;
  /** When true, remove the stored secret. */
  clearSecret?: boolean;
}

export async function setFeishuConfig(input: SetFeishuConfigInput): Promise<void> {
  const cfg = await readConfig();
  const feishu: FeishuConfig = { ...(cfg.feishu ?? {}) };

  if (input.appId !== undefined) feishu.appId = trimOrUndefined(input.appId);
  if (input.defaultWorkspaceId !== undefined) {
    feishu.defaultWorkspaceId = trimOrUndefined(input.defaultWorkspaceId);
  }
  if (input.clearSecret) {
    delete feishu.encryptedAppSecret;
  } else {
    const secret = trimOrUndefined(input.appSecret);
    if (secret) feishu.encryptedAppSecret = encryptSecret(secret);
  }

  cfg.feishu = feishu;
  await writeConfig(cfg);
}

export async function clearFeishuConfig(): Promise<void> {
  const cfg = await readConfig();
  delete cfg.feishu;
  await writeConfig(cfg);
}
