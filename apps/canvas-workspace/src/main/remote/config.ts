import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DEFAULT_STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');

export interface RemoteVpsWorkspaceConfig {
  kind: 'vps';
  /** Direct HTTP endpoint (e.g. Tailscale IP `http://100.x.y.z:4770` or localhost). */
  endpoint?: string;
  /** SSH host or `~/.ssh/config` alias for automatic local port forwarding. */
  sshHost?: string;
  /** Optional SSH port (default: 22). */
  sshPort?: number;
  /** Remote daemon port on the VPS loopback interface (default: 4770). */
  remotePort?: number;
  /** Bearer token for `/v1/*`. Prefer `tokenEnv` to avoid storing plaintext tokens on disk. */
  token?: string;
  /** Name of an environment variable holding the Bearer token. */
  tokenEnv?: string;
  /** Target workspace id on the VPS (defaults to the local workspaceId). */
  remoteWorkspaceId?: string;
  /** Default working directory on the VPS for terminals and external agents. */
  cwd?: string;
  /** Where Canvas/Conversation/File storage lives (default: `'vps'`). Set `'local'` to keep existing local data. */
  storage?: 'vps' | 'local';
  /** Where PTY terminals and external CLI agents run (default: `'vps'`). */
  runtime?: 'vps' | 'local';
  /** Automatically push and start `vps-daemon` over SSH if the remote health check fails. */
  autoBootstrap?: boolean;
  /** Granted role when joined via a share invite code. */
  shareRole?: 'viewer' | 'editor' | 'collaborator';
  /** Allow remote VPS CLI to invoke read-only desktop capabilities over SSE relay (default: true). */
  allowCapabilityRelay?: boolean;
}

interface RemoteConfigFile {
  workspaces?: Record<string, RemoteVpsWorkspaceConfig>;
}

const REMOTE_CONFIG_FILENAME = 'remote-workspaces.json';

function configFilePath(storeDir = DEFAULT_STORE_DIR): string {
  return process.env.PULSE_CANVAS_REMOTE_CONFIG?.trim() || join(storeDir, REMOTE_CONFIG_FILENAME);
}

function readConfigFile(storeDir = DEFAULT_STORE_DIR): RemoteConfigFile {
  try {
    const parsed = JSON.parse(readFileSync(configFilePath(storeDir), 'utf8')) as RemoteConfigFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Load the remote VPS workspace config for a given workspaceId, or `null` for local workspaces.
 * Reads fresh from disk (small JSON file) so edits take effect without restarting the app.
 */
export function getRemoteWorkspaceConfig(
  workspaceId: string,
  storeDir = DEFAULT_STORE_DIR,
): RemoteVpsWorkspaceConfig | null {
  if (!workspaceId) return null;
  const parsed = readConfigFile(storeDir);
  const entry = parsed?.workspaces?.[workspaceId];
  if (!entry || entry.kind !== 'vps') return null;
  if (!entry.endpoint && !entry.sshHost) return null;
  return entry;
}

export function isRemoteStorageEnabled(config: RemoteVpsWorkspaceConfig): boolean {
  return (config.storage ?? 'vps') === 'vps';
}

export function isRemoteRuntimeEnabled(config: RemoteVpsWorkspaceConfig): boolean {
  return (config.runtime ?? 'vps') === 'vps';
}

export function saveRemoteWorkspaceConfig(
  workspaceId: string,
  config: RemoteVpsWorkspaceConfig,
  storeDir = DEFAULT_STORE_DIR,
): void {
  const filePath = configFilePath(storeDir);
  const current = readConfigFile(storeDir);
  const next: RemoteConfigFile = {
    ...current,
    workspaces: {
      ...(current.workspaces ?? {}),
      [workspaceId]: config,
    },
  };
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmpPath, filePath);
}

export function removeRemoteWorkspaceConfig(
  workspaceId: string,
  storeDir = DEFAULT_STORE_DIR,
): boolean {
  const filePath = configFilePath(storeDir);
  const current = readConfigFile(storeDir);
  if (!current.workspaces || !(workspaceId in current.workspaces)) return false;
  const { [workspaceId]: _removed, ...rest } = current.workspaces;
  const next: RemoteConfigFile = { ...current, workspaces: rest };
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmpPath, filePath);
  return true;
}

export function resolveRemoteToken(config: RemoteVpsWorkspaceConfig): string {
  const fromEnv = config.tokenEnv ? process.env[config.tokenEnv]?.trim() : undefined;
  const token = fromEnv || config.token?.trim();
  if (!token) {
    throw new Error('Remote VPS workspace is missing a Bearer token (set tokenEnv or token).');
  }
  return token;
}

export function listConfiguredRemoteWorkspaceIds(storeDir = DEFAULT_STORE_DIR): string[] {
  const parsed = readConfigFile(storeDir);
  if (!parsed?.workspaces || typeof parsed.workspaces !== 'object') return [];
  return Object.entries(parsed.workspaces)
    .filter(([, cfg]) => cfg && cfg.kind === 'vps' && (cfg.endpoint || cfg.sshHost))
    .map(([id]) => id);
}

/**
 * Match a local-style canvas file path against configured remote workspaces.
 * Matches BOTH the local `workspaceId` and the `remoteWorkspaceId` so files
 * created on another machine or joined via invite still route to the VPS.
 */
export function matchRemoteWorkspaceFile(
  filePath: string,
  storeDir = DEFAULT_STORE_DIR,
): { workspaceId: string; relPath: string } | null {
  const normalized = filePath.replace(/\\/g, '/');
  for (const workspaceId of listConfiguredRemoteWorkspaceIds(storeDir)) {
    const cfg = getRemoteWorkspaceConfig(workspaceId, storeDir);
    const candidates = [workspaceId];
    if (cfg?.remoteWorkspaceId && cfg.remoteWorkspaceId !== workspaceId) {
      candidates.push(cfg.remoteWorkspaceId);
    }
    for (const candidate of candidates) {
      const marker = `/${candidate}/`;
      const idx = normalized.indexOf(marker);
      if (idx < 0) continue;
      const relPath = normalized.slice(idx + marker.length).replace(/^\/+/, '');
      if (relPath && !relPath.includes('..')) {
        return { workspaceId, relPath };
      }
    }
  }
  return null;
}

