import { isStorageError, type PulseStorage, type StorageChange, type WorkspaceFiles } from '@pulse-coder/storage';
import { createCanvasCompatibilityStore, type LegacyCanvas } from '@pulse-coder/storage/canvas';
import {
  createRemoteWorkspaceFiles,
  openRemoteStorage,
  subscribeRemoteChanges,
} from '@pulse-coder/storage/remote';
import {
  getRemoteWorkspaceConfig,
  isRemoteRuntimeEnabled,
  isRemoteStorageEnabled,
  matchRemoteWorkspaceFile,
  resolveRemoteToken,
  type RemoteVpsWorkspaceConfig,
} from './config';
import { closeAllSshTunnels, ensureSshTunnel, onSshTunnelExit } from './ssh-tunnel';
import { startRemoteCapabilityRelay } from './relay/capability-relay';

export interface ResolvedRemoteTarget {
  workspaceId: string;
  remoteWorkspaceId: string;
  endpoint: string;
  token: string;
  cwd?: string;
  allowCapabilityRelay?: boolean;
}

const storagePool = new Map<string, Promise<PulseStorage>>();
const changeSubscriptions = new Map<string, () => void>();
const relaySubscriptions = new Map<string, () => void>();
const activeCanvasSubscriptions = new Map<
  string,
  { endpoint: string; broadcast: BroadcastCanvasChange }
>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelReconnect(workspaceId: string): void {
  const timer = reconnectTimers.get(workspaceId);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(workspaceId);
  }
}

function scheduleRemoteReconnect(workspaceId: string, delayMs = 2_000): void {
  if (reconnectTimers.has(workspaceId)) return;
  const sub = activeCanvasSubscriptions.get(workspaceId);
  if (!sub) return;
  const timer = setTimeout(async () => {
    reconnectTimers.delete(workspaceId);
    const current = activeCanvasSubscriptions.get(workspaceId);
    if (!current) return;
    try {
      const target = await resolveRemoteWorkspaceTarget(workspaceId, 'storage');
      if (!target) {
        activeCanvasSubscriptions.delete(workspaceId);
        return;
      }
      subscribeRemoteCanvas(target, current.broadcast);
      await resyncRemoteCanvas(workspaceId, current.broadcast);
    } catch {
      const nextDelay = Math.min(delayMs * 2, 30_000);
      scheduleRemoteReconnect(workspaceId, nextDelay);
    }
  }, delayMs);
  timer.unref?.();
  reconnectTimers.set(workspaceId, timer);
}

/**
 * The change stream has no replay across a new connection, so edits made while
 * the tunnel was down are never streamed. After a reconnect, announce every
 * node and edge as changed so the renderer reloads and merges the remote
 * document; only nodes someone else changed get the "synced" highlight.
 */
async function resyncRemoteCanvas(workspaceId: string, broadcast: BroadcastCanvasChange): Promise<void> {
  const remote = await getRemoteCanvasBackend(workspaceId);
  if (!remote) return;
  const doc = await remote.backend.readCanvas(remote.target.remoteWorkspaceId);
  if (!doc) return;
  const isId = (id: unknown): id is string => typeof id === 'string' && id.length > 0;
  const nodeIds = (doc.nodes ?? []).map((node) => node.id).filter(isId);
  const edgeIds = (doc.edges ?? []).map((edge) => (edge as { id?: unknown }).id).filter(isId);
  if (nodeIds.length === 0 && edgeIds.length === 0) return;
  broadcast({
    workspaceId,
    nodeIds,
    edgeIds,
    kind: 'update',
    source: 'remote-vps',
    revision: doc.revision ?? 0,
  });
}

function invalidateEndpointCaches(deadEndpoint: string): void {
  const prefix = `${deadEndpoint}::`;
  for (const [key, pending] of storagePool) {
    if (key.startsWith(prefix)) {
      storagePool.delete(key);
      void pending.then((store) => store.close().catch(() => undefined)).catch(() => undefined);
    }
  }
  for (const [key, stop] of changeSubscriptions) {
    if (key.startsWith(prefix)) {
      changeSubscriptions.delete(key);
      try {
        stop();
      } catch {
        /* ignore */
      }
    }
  }
  for (const [key, stop] of relaySubscriptions) {
    if (key.startsWith(prefix)) {
      relaySubscriptions.delete(key);
      try {
        stop();
      } catch {
        /* ignore */
      }
    }
  }
}

onSshTunnelExit((deadEndpoint) => {
  invalidateEndpointCaches(deadEndpoint);
  for (const [workspaceId, sub] of activeCanvasSubscriptions) {
    if (sub.endpoint === deadEndpoint) {
      scheduleRemoteReconnect(workspaceId);
    }
  }
});

export async function resolveRemoteTargetFromConfig(
  workspaceId: string,
  config: RemoteVpsWorkspaceConfig,
): Promise<ResolvedRemoteTarget> {
  let token = config.tokenEnv ? process.env[config.tokenEnv]?.trim() : config.token?.trim();
  let endpoint = config.endpoint?.trim();

  if (!endpoint && config.sshHost) {
    const openTunnel = () =>
      ensureSshTunnel({
        sshHost: config.sshHost!,
        sshPort: config.sshPort,
        remotePort: config.remotePort,
      });

    if (config.autoBootstrap && !token) {
      const { bootstrapRemoteVpsDaemon } = await import('./ssh-bootstrap');
      const boot = await bootstrapRemoteVpsDaemon({
        sshHost: config.sshHost,
        sshPort: config.sshPort,
        remotePort: config.remotePort,
        workDir: config.cwd,
      });
      token = boot.token;
      endpoint = await openTunnel();
    } else {
      try {
        endpoint = await openTunnel();
      } catch (tunnelError) {
        if (!config.autoBootstrap) throw tunnelError;
        const { bootstrapRemoteVpsDaemon } = await import('./ssh-bootstrap');
        const boot = await bootstrapRemoteVpsDaemon({
          sshHost: config.sshHost,
          sshPort: config.sshPort,
          remotePort: config.remotePort,
          workDir: config.cwd,
        });
        token = token || boot.token;
        endpoint = await openTunnel();
      }
    }
  }

  const finalToken = token || resolveRemoteToken(config);
  return {
    workspaceId,
    remoteWorkspaceId: config.remoteWorkspaceId?.trim() || workspaceId,
    endpoint: (endpoint ?? '').replace(/\/+$/, ''),
    token: finalToken,
    cwd: config.cwd,
    allowCapabilityRelay: config.allowCapabilityRelay,
  };
}

export async function resolveRemoteWorkspaceTarget(
  workspaceId: string,
  capability: 'storage' | 'runtime' | 'any' = 'any',
): Promise<ResolvedRemoteTarget | null> {
  const config = getRemoteWorkspaceConfig(workspaceId);
  if (!config) return null;
  if (capability === 'storage' && !isRemoteStorageEnabled(config)) return null;
  if (capability === 'runtime' && !isRemoteRuntimeEnabled(config)) return null;
  return await resolveRemoteTargetFromConfig(workspaceId, config);
}

export async function getRemotePulseStorage(workspaceId: string): Promise<{
  storage: PulseStorage;
  target: ResolvedRemoteTarget;
} | null> {
  const target = await resolveRemoteWorkspaceTarget(workspaceId, 'storage');
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

type BroadcastCanvasChange = (payload: {
  workspaceId: string;
  nodeIds: string[];
  edgeIds: string[];
  kind: 'update' | 'delete';
  source: string;
  revision: number;
}) => void;

function ensureRemoteCapabilityRelay(target: ResolvedRemoteTarget): void {
  const subKey = `${target.endpoint}::${target.remoteWorkspaceId}`;
  if (target.allowCapabilityRelay === false) {
    const existing = relaySubscriptions.get(subKey);
    if (existing) {
      relaySubscriptions.delete(subKey);
      try {
        existing();
      } catch {
        /* ignore */
      }
    }
    return;
  }
  if (relaySubscriptions.has(subKey)) return;
  relaySubscriptions.set(subKey, startRemoteCapabilityRelay(target));
}

function subscribeRemoteCanvas(target: ResolvedRemoteTarget, broadcast: BroadcastCanvasChange): void {
  cancelReconnect(target.workspaceId);
  activeCanvasSubscriptions.set(target.workspaceId, {
    endpoint: target.endpoint,
    broadcast,
  });
  ensureRemoteChangeSubscription(target, (change) => {
    const fileEvent = change as unknown as { domain?: string; uri?: string; relPath?: string };
    if (fileEvent.domain === 'file' && (fileEvent.uri || fileEvent.relPath)) {
      const filePath = fileEvent.relPath
        ? `pulse-remote:///${target.workspaceId}/${fileEvent.relPath}`
        : fileEvent.uri!;
      void import('electron').then(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('canvas:file-changed', { filePath, content: '' });
        }
      });
      return;
    }
    if (change.domain !== 'canvas') return;
    broadcast({
      workspaceId: change.scopeId,
      nodeIds: change.changedIds,
      edgeIds: change.changedIds,
      kind: change.kind === 'removed' ? 'delete' : 'update',
      source: 'remote-vps',
      revision: change.revision,
    });
  });
  ensureRemoteCapabilityRelay(target);
}

export async function loadRemoteCanvas(id: string, broadcast: BroadcastCanvasChange) {
  const remote = await getRemoteCanvasBackend(id);
  if (!remote) return null;
  subscribeRemoteCanvas(remote.target, broadcast);
  return { ok: true as const, data: await remote.backend.readCanvas(remote.target.remoteWorkspaceId) };
}

export async function saveRemoteCanvas(
  id: string,
  input: LegacyCanvas,
  broadcast: BroadcastCanvasChange,
) {
  const remote = await getRemoteCanvasBackend(id);
  if (!remote) return null;
  subscribeRemoteCanvas(remote.target, broadcast);
  if (getRemoteWorkspaceConfig(id)?.shareRole === 'viewer') {
    return {
      ok: true as const,
      revision: input.revision ?? 0,
      storageGeneration: input.storageGeneration ?? '',
    };
  }
  try {
    const receipt = await remote.backend.writeCanvas(remote.target.remoteWorkspaceId, input, {
      allowEmpty: true,
    });
    return { ok: true as const, ...receipt };
  } catch (error) {
    const code = isStorageError(error) ? error.code : 'storage_unavailable';
    if (code === 'revision_conflict') {
      const current = await remote.backend.readCanvas(remote.target.remoteWorkspaceId);
      if (!current) {
        // A baseline read from this VPS store means the canvas existed here and
        // was removed elsewhere: do not silently recreate it. A baseline from
        // another store (first save after binding) initializes the VPS copy.
        if (input.storageGeneration && input.storageGeneration === remote.storage.generation) {
          return {
            ok: false as const,
            code: 'not_found' as const,
            error: 'This canvas was deleted on another device. Reopen the workspace to continue.',
          };
        }
        const { revision: _r, storageGeneration: _g, ...initial } = input;
        const receipt = await remote.backend.writeCanvas(remote.target.remoteWorkspaceId, initial, {
          allowEmpty: true,
        });
        return { ok: true as const, ...receipt };
      }
      return { ok: false as const, code, error: String(error), data: current };
    }
    return { ok: false as const, code, error: String(error) };
  }
}


export async function tryReadRemoteTextFile(
  filePath: string,
): Promise<{ ok: true; content: string; version: string } | { ok: false; error: string } | null> {
  const matched = matchRemoteWorkspaceFile(filePath);
  if (!matched) return null;
  const remote = await getRemoteWorkspaceFiles(matched.workspaceId);
  if (!remote) return null;
  try {
    const uri = `pulse-remote:///${remote.target.remoteWorkspaceId}/${matched.relPath}`;
    const read = await remote.files.readText(uri);
    if (!read) return { ok: false, error: `ENOENT: no such file or directory, open '${filePath}'` };
    return { ok: true, content: read.content, version: read.version };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function tryWriteRemoteTextFile(request: {
  filePath: string;
  content: string;
  expectedVersion?: string;
}): Promise<{ ok: true; version: string } | { ok: false; conflict?: boolean; error: string } | null> {
  const matched = matchRemoteWorkspaceFile(request.filePath);
  if (!matched) return null;
  const remote = await getRemoteWorkspaceFiles(matched.workspaceId);
  if (!remote) return null;
  if (getRemoteWorkspaceConfig(matched.workspaceId)?.shareRole === 'viewer') {
    return { ok: true, version: request.expectedVersion ?? 'viewer-readonly' };
  }
  try {
    const uri = `pulse-remote:///${remote.target.remoteWorkspaceId}/${matched.relPath}`;
    const receipt = await remote.files.write(
      uri,
      request.content,
      request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion },
    );
    return { ok: true, version: receipt.version };
  } catch (error) {
    if (isStorageError(error) && error.code === 'revision_conflict') {
      return {
        ok: false,
        conflict: true,
        error: 'File changed outside this editor. Reload before saving.',
      };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function closeAllRemoteConnections(): Promise<void> {
  for (const timer of reconnectTimers.values()) {
    clearTimeout(timer);
  }
  reconnectTimers.clear();
  activeCanvasSubscriptions.clear();

  for (const stop of changeSubscriptions.values()) {
    try {
      stop();
    } catch {
      /* ignore */
    }
  }
  changeSubscriptions.clear();

  for (const stop of relaySubscriptions.values()) {
    try {
      stop();
    } catch {
      /* ignore */
    }
  }
  relaySubscriptions.clear();

  const stores = [...storagePool.values()];
  storagePool.clear();
  for (const settled of await Promise.allSettled(stores)) {
    if (settled.status === 'fulfilled') {
      await settled.value.close().catch(() => undefined);
    }
  }
  await closeAllSshTunnels();
}
