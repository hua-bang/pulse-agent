import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
}

interface RemoteConfigFile {
  workspaces?: Record<string, RemoteVpsWorkspaceConfig>;
}

const REMOTE_CONFIG_FILENAME = 'remote-workspaces.json';

function configFilePath(storeDir = DEFAULT_STORE_DIR): string {
  return process.env.PULSE_CANVAS_REMOTE_CONFIG?.trim() || join(storeDir, REMOTE_CONFIG_FILENAME);
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
  let parsed: RemoteConfigFile;
  try {
    parsed = JSON.parse(readFileSync(configFilePath(storeDir), 'utf8')) as RemoteConfigFile;
  } catch {
    return null;
  }
  const entry = parsed?.workspaces?.[workspaceId];
  if (!entry || entry.kind !== 'vps') return null;
  if (!entry.endpoint && !entry.sshHost) return null;
  return entry;
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
  try {
    const parsed = JSON.parse(readFileSync(configFilePath(storeDir), 'utf8')) as RemoteConfigFile;
    if (!parsed?.workspaces || typeof parsed.workspaces !== 'object') return [];
    return Object.entries(parsed.workspaces)
      .filter(([, cfg]) => cfg && cfg.kind === 'vps' && (cfg.endpoint || cfg.sshHost))
      .map(([id]) => id);
  } catch {
    return [];
  }
}
