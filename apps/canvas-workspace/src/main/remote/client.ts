import type { PulseStorage, StorageChange, WorkspaceFiles } from '@pulse-coder/storage';
import { createCanvasCompatibilityStore } from '@pulse-coder/storage/canvas';
import {
  createRemoteWorkspaceFiles,
  openRemoteStorage,
  subscribeRemoteChanges,
} from '@pulse-coder/storage/remote';
import { getRemoteWorkspaceConfig, resolveRemoteToken } from './config';
import { closeAllSshTunnels, ensureSshTunnel } from './ssh-tunnel';

export interface ResolvedRemoteTarget {
  workspaceId: string;
  remoteWorkspaceId: string;
  endpoint: string;
  token: string;
  cwd?: string;
}

const storagePool = new Map<string, Promise<PulseStorage>>();
const changeSubscriptions = new Map<string, () => void>();

export async function resolveRemoteWorkspaceTarget(
  workspaceId: string,
): Promise<ResolvedRemoteTarget | null> {
  const config = getRemoteWorkspaceConfig(workspaceId);
  if (!config) return null;

  const token = resolveRemoteToken(config);
  const endpoint =
    config.endpoint?.trim() ||
    (await ensureSshTunnel({
      sshHost: config.sshHost!,
      sshPort: config.sshPort,
      remotePort: config.remotePort,
    }));

  return {
    workspaceId,
    remoteWorkspaceId: config.remoteWorkspaceId?.trim() || workspaceId,
    endpoint: endpoint.replace(/\/+$/, ''),
    token,
    cwd: config.cwd,
  };
}

export async function getRemotePulseStorage(workspaceId: string): Promise<{
  storage: PulseStorage;
  target: ResolvedRemoteTarget;
} | null> {
  const target = await resolveRemoteWorkspaceTarget(workspaceId);
  if (!target) return null;

  const poolKey = `${target.endpoint}::${target.token}`;
  let pending = storagePool.get(poolKey);
  if (!pending) {
    pending = openRemoteStorage({ endpoint: target.endpoint, token: target.token }).catch(
      (error) => {
        storagePool.delete(poolKey);
        throw error;
      },
    );
    storagePool.set(poolKey, pending);
  }
  const storage = await pending;
  return { storage, target };
}

export async function getRemoteCanvasBackend(workspaceId: string) {
  const resolved = await getRemotePulseStorage(workspaceId);
  if (!resolved) return null;
  return {
    backend: createCanvasCompatibilityStore(resolved.storage.canvas),
    storage: resolved.storage,
    target: resolved.target,
  };
}

export async function getRemoteWorkspaceFiles(workspaceId: string): Promise<{
  files: WorkspaceFiles;
  target: ResolvedRemoteTarget;
} | null> {
  const target = await resolveRemoteWorkspaceTarget(workspaceId);
  if (!target) return null;
  return {
    files: createRemoteWorkspaceFiles({ endpoint: target.endpoint, token: target.token }),
    target,
  };
}

export function ensureRemoteChangeSubscription(
  target: ResolvedRemoteTarget,
  onChange: (change: StorageChange) => void,
): void {
  const subKey = `${target.endpoint}::${target.remoteWorkspaceId}`;
  if (changeSubscriptions.has(subKey)) return;

  const stop = subscribeRemoteChanges(
    {
      endpoint: target.endpoint,
      token: target.token,
      scopeId: target.remoteWorkspaceId,
    },
    (change) => {
      // Translate remote scopeId back to local workspaceId so renderer listeners match.
      onChange({ ...change, scopeId: target.workspaceId });
    },
    (error) => {
      console.warn(
        `[remote-workspace] SSE change stream interrupted for ${target.workspaceId}:`,
        error.message,
      );
    },
  );
  changeSubscriptions.set(subKey, stop);
}

export async function closeAllRemoteConnections(): Promise<void> {
  for (const stop of changeSubscriptions.values()) {
    try {
      stop();
    } catch {
      /* ignore */
    }
  }
  changeSubscriptions.clear();

  const stores = [...storagePool.values()];
  storagePool.clear();
  for (const settled of await Promise.allSettled(stores)) {
    if (settled.status === 'fulfilled') {
      await settled.value.close().catch(() => undefined);
    }
  }
  await closeAllSshTunnels();
}
