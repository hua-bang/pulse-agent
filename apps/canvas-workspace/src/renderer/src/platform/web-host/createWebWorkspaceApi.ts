import { createCanvasCompatibilityStore, type LegacyCanvas } from '@pulse-coder/storage/canvas';
import {
  createRemoteWorkspaceFiles,
  openRemoteStorage,
  subscribeRemoteChanges,
} from '@pulse-coder/storage/remote';
import type { CanvasSaveData, CanvasSummary } from '../../../../shared/canvas';
import type { CanvasWorkspaceApi } from '../../../../shared/api/workspace-api';
import { createWebRemoteVpsApi } from './chatRoomClient';
import {
  normalizeCanvasData,
  toRemoteFileUri,
  toSummaryBox,
} from './remotePaths';
import { WEB_HOST_ACTIVE_WS_KEY, type WebHostAuthSession } from './types';
import { createWebAgentRuntime } from './webAgentClient';
import { createWebPtyClient } from './webPtyClient';
import { createWebSessionClient } from './webSessionClient';

const MANIFEST_ID = '__workspaces__';

type ExternalUpdateEvent = Parameters<Parameters<CanvasWorkspaceApi['store']['onExternalUpdate']>[0]>[0];

function createNoopNamespace<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as Record<string, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      const name = String(prop);
      if (name === 'then') return undefined;
      if (name.startsWith('on')) {
        return () => () => {};
      }
      return async () => ({ ok: false, error: `Not available in Web mode (${name})` });
    },
  }) as T;
}

function readStoredActiveWorkspace(): string | undefined {
  try {
    return window.localStorage.getItem(WEB_HOST_ACTIVE_WS_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function writeStoredActiveWorkspace(id: string | undefined): void {
  if (!id) return;
  try {
    window.localStorage.setItem(WEB_HOST_ACTIVE_WS_KEY, id);
  } catch {
    // Ignore storage errors.
  }
}

export function createWebWorkspaceApi(session: WebHostAuthSession): CanvasWorkspaceApi {
  const remoteOptions = {
    endpoint: session.endpoint,
    token: session.token,
  };
  let storagePromise: ReturnType<typeof openRemoteStorage> | null = null;
  const getStorage = () => {
    if (!storagePromise) {
      storagePromise = openRemoteStorage(remoteOptions).catch((err) => {
        storagePromise = null;
        throw err;
      });
    }
    return storagePromise;
  };
  const getCanvasStore = async () => createCanvasCompatibilityStore((await getStorage()).canvas);
  const remoteFiles = createRemoteWorkspaceFiles(remoteOptions);
  const remoteVps = createWebRemoteVpsApi(session);

  const externalListeners = new Set<(event: ExternalUpdateEvent) => void>();
  const fileChangeListeners = new Set<(filePath: string, content: string) => void>();
  const watchedStops = new Map<string, () => void>();

  const emitExternalUpdate = (event: ExternalUpdateEvent) => {
    for (const listener of externalListeners) {
      try {
        listener(event);
      } catch {
        // Isolate subscriber errors.
      }
    }
  };

  function ensureCanvasStream(workspaceId: string): void {
    if (!workspaceId || workspaceId === MANIFEST_ID || watchedStops.has(workspaceId)) return;
    const stop = subscribeRemoteChanges(
      { ...remoteOptions, scopeId: workspaceId },
      (change) => {
        const fileEv = change as unknown as { domain?: string; uri?: string };
        if (fileEv.domain === 'file' && fileEv.uri) {
          for (const listener of fileChangeListeners) {
            try { listener(fileEv.uri, ''); } catch { /* isolate */ }
          }
          return;
        }
        if (change.domain !== 'canvas' || !change.scopeId) return;
        emitExternalUpdate({
          workspaceId: change.scopeId,
          nodeIds: [...change.changedIds],
          edgeIds: [...change.changedIds],
          kind: change.kind === 'removed' ? 'delete' : 'update',
          revision: change.revision,
          source: 'remote-vps',
        });
      },
    );
    watchedStops.set(workspaceId, stop);
  }

  async function listWorkspaceIds(): Promise<string[]> {
    if (session.workspaceId) {
      return [session.workspaceId];
    }
    const storage = await getStorage();
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await storage.canvas.list({ cursor, limit: 200 });
      for (const item of page.items) {
        if (!item.workspaceId.startsWith('__')) {
          ids.push(item.workspaceId);
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
    return ids;
  }

  let currentWorkspaceId: string | undefined = session.workspaceId || readStoredActiveWorkspace();

  const store: CanvasWorkspaceApi['store'] = {
    list: async () => {
      try {
        return { ok: true, ids: await listWorkspaceIds() };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    load: async (id) => {
      try {
        if (id === MANIFEST_ID) {
          const ids = await listWorkspaceIds();
          const workspaces = ids.map((wsId) => ({
            id: wsId,
            name:
              wsId === session.workspaceId
                ? session.workspaceName || session.shareLabel || wsId
                : wsId,
          }));
          const storedActive = readStoredActiveWorkspace();
          const activeId =
            (storedActive && ids.includes(storedActive) ? storedActive : undefined) ?? ids[0] ?? 'default';
          if (activeId && activeId !== 'default') {
            currentWorkspaceId = activeId;
          }
          return {
            ok: true,
            data: { workspaces, folders: [], activeId } as unknown as CanvasSaveData,
          };
        }
        currentWorkspaceId = id;
        ensureCanvasStream(id);
        const canvasStore = await getCanvasStore();
        const data = normalizeCanvasData((await canvasStore.readCanvas(id)) as CanvasSaveData | null);
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    save: async (id, data) => {
      if (id === MANIFEST_ID) {
        const activeId = (data as { activeId?: string } | null)?.activeId;
        if (activeId) currentWorkspaceId = activeId;
        writeStoredActiveWorkspace(activeId);
        return { ok: true };
      }
      if (session.role === 'viewer') {
        const legacy = data as LegacyCanvas;
        return {
          ok: true,
          revision: legacy?.revision ?? 0,
          storageGeneration: legacy?.storageGeneration ?? '',
        };
      }
      try {
        ensureCanvasStream(id);
        const canvasStore = await getCanvasStore();
        const receipt = await canvasStore.writeCanvas(id, data as LegacyCanvas, { allowEmpty: true });
        return { ok: true, ...receipt };
      } catch (err) {
        const code =
          err && typeof err === 'object' && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
            ? (err as { code: string }).code
            : 'storage_unavailable';
        const latest =
          code === 'revision_conflict'
            ? ((await getCanvasStore()
                .then((s) => s.readCanvas(id))
                .catch(() => null)) as CanvasSaveData | null)
            : undefined;
        return {
          ok: false,
          code,
          error: err instanceof Error ? err.message : String(err),
          ...(latest !== undefined ? { data: latest } : {}),
        };
      }
    },
    summaries: async (ids) => {
      const summaries: Record<string, CanvasSummary | null> = {};
      const canvasStore = await getCanvasStore().catch(() => null);
      for (const id of ids) {
        if (!canvasStore) {
          summaries[id] = null;
          continue;
        }
        try {
          const legacy = await canvasStore.readCanvas(id);
          if (!legacy) {
            summaries[id] = null;
            continue;
          }
          const nodes = Array.isArray(legacy.nodes) ? legacy.nodes : [];
          const frames = nodes.filter((n) => n.type === 'frame').slice(0, 6).map(toSummaryBox);
          const boxes = nodes.filter((n) => n.type !== 'frame').slice(0, 8).map(toSummaryBox);
          summaries[id] = {
            nodeCount: nodes.length,
            boxes,
            ...(frames.length > 0 ? { frames } : {}),
          };
        } catch {
          summaries[id] = null;
        }
      }
      return { ok: true, summaries };
    },
    delete: async () => ({ ok: false, error: 'Deleting workspaces is disabled in Web mode.' }),
    restoreDeleted: async () => ({ ok: false, error: 'Restoring workspaces is disabled in Web mode.' }),
    getDir: async (id) => ({ ok: true, dir: `vps://${id}` }),
    exportWorkspace: async () => ({ ok: false, canceled: true }),
    importWorkspace: async () => ({ ok: false, canceled: true }),
    importWorkspaceFromPath: async () => ({ ok: false, error: 'Not available in Web mode.' }),
    listPollutedWorkspaces: async () => ({ ok: true, polluted: [] }),
    watchWorkspace: async (workspaceId) => {
      ensureCanvasStream(workspaceId);
      return { ok: true };
    },
    onExternalUpdate: (callback) => {
      externalListeners.add(callback);
      return () => {
        externalListeners.delete(callback);
      };
    },
    onFlushBeforeQuit: () => () => {},
    flushedBeforeQuit: () => {},
    consumeUnsavedQuit: async () => ({ ok: true, pending: false }),
    onMigrationProgress: () => () => {},
  };

  const file = createNoopNamespace<CanvasWorkspaceApi['file']>({
    onChanged: (cb) => { fileChangeListeners.add(cb); return () => { fileChangeListeners.delete(cb); }; },
    read: async (filePath) => {
      const uri = toRemoteFileUri(filePath, currentWorkspaceId, session.workspaceId);
      if (!uri) {
        return { ok: false, error: `ENOENT: file is outside remote workspace, open '${filePath}'` };
      }
      try {
        const result = await remoteFiles.readText(uri);
        if (!result) return { ok: false, error: `ENOENT: no such file or directory, open '${filePath}'` };
        return { ok: true, content: result.content, version: result.version };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    write: async (filePath, content, expectedVersion) => {
      if (session.role === 'viewer') {
        return { ok: false, error: 'Read-only viewer role cannot modify files.' };
      }
      const uri = toRemoteFileUri(filePath, currentWorkspaceId, session.workspaceId);
      if (!uri) {
        return { ok: false, error: 'File is outside the shared remote workspace.' };
      }
      try {
        const receipt = await remoteFiles.write(
          uri,
          content,
          expectedVersion ? { expectedVersion } : undefined,
        );
        return { ok: true, version: receipt.version };
      } catch (err) {
        const code =
          err && typeof err === 'object' && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
            ? (err as { code: string }).code
            : undefined;
        return {
          ok: false,
          ...(code ? { code } : {}),
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  const agent = createNoopNamespace<CanvasWorkspaceApi['agent']>({
    mcpApps: createNoopNamespace<CanvasWorkspaceApi['agent']['mcpApps']>({
      listEntrypoints: async () => ({ ok: true, entrypoints: [] }),
    }),
    getStatus: async () => ({ ok: true, active: false, messageCount: 0 }),
    getScopeRunStatus: async () => ({ ok: true, active: false }),
    getScopeRunningSessions: async () => ({ ok: true, conversationSessionIds: [] }),
    ...createWebSessionClient(session, getStorage, () => currentWorkspaceId),
    conversationAttach: async () => ({ ok: true, running: false }),
    ...createWebAgentRuntime(session, () => currentWorkspaceId),
    warmScope: () => {},
    activate: async () => ({ ok: true }),
    deactivate: async () => ({ ok: true }),
  });

  const shell = createNoopNamespace<CanvasWorkspaceApi['shell']>({
    openExternal: async (url) => {
      if (typeof window !== 'undefined' && /^https?:\/\//i.test(url)) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return { ok: true };
      }
      return { ok: false, error: 'Unsupported URL scheme' };
    },
  });

  return {
    version: session.version ?? 'web',
    runtimeConfig: {
      perfMode: typeof window !== 'undefined' && window.innerWidth <= 768,
      webviewInitialLoadConcurrency: 0,
    },
    appInfo: createNoopNamespace<CanvasWorkspaceApi['appInfo']>(),
    pluginFlags: {},
    pty: createWebPtyClient(session, () => currentWorkspaceId),
    store,
    workspaceNodes: createNoopNamespace<CanvasWorkspaceApi['workspaceNodes']>({
      list: async () => ({ ok: true, nodes: [], tags: [] }),
      tags: async () => ({ ok: true, tags: [] }),
    }),
    file,
    dialog: createNoopNamespace<CanvasWorkspaceApi['dialog']>(),
    skills: createNoopNamespace<CanvasWorkspaceApi['skills']>(),
    canvasSkills: createNoopNamespace<CanvasWorkspaceApi['canvasSkills']>({
      list: async () => ({ ok: true, skills: [] }),
    }),
    canvasMcp: createNoopNamespace<CanvasWorkspaceApi['canvasMcp']>({
      list: async () => ({ ok: true, servers: [] }),
    }),
    canvasPlugins: createNoopNamespace<CanvasWorkspaceApi['canvasPlugins']>({
      list: async () => ({ ok: true, plugins: [] }),
    }),
    experimental: createNoopNamespace<CanvasWorkspaceApi['experimental']>(),
    channelConfig: createNoopNamespace<CanvasWorkspaceApi['channelConfig']>(),
    builtInTools: createNoopNamespace<CanvasWorkspaceApi['builtInTools']>(),
    model: createNoopNamespace<CanvasWorkspaceApi['model']>(),
    memoryReport: createNoopNamespace<CanvasWorkspaceApi['memoryReport']>(),
    scheduled: createNoopNamespace<CanvasWorkspaceApi['scheduled']>({
      list: async () => ({ ok: true, tasks: [] }),
    }),
    artifactCapabilities: createNoopNamespace<CanvasWorkspaceApi['artifactCapabilities']>(),
    promptProfile: createNoopNamespace<CanvasWorkspaceApi['promptProfile']>(),
    agent,
    agentRoles: createNoopNamespace<CanvasWorkspaceApi['agentRoles']>({
      list: async () => ({ ok: true, roles: [] }),
    }),
    codexSessions: createNoopNamespace<CanvasWorkspaceApi['codexSessions']>(),
    agentTeams: createNoopNamespace<CanvasWorkspaceApi['agentTeams']>(),
    iframe: createNoopNamespace<CanvasWorkspaceApi['iframe']>(),
    llm: createNoopNamespace<CanvasWorkspaceApi['llm']>(),
    artifacts: createNoopNamespace<CanvasWorkspaceApi['artifacts']>(),
    references: createNoopNamespace<CanvasWorkspaceApi['references']>({
      list: async () => ({ ok: true, items: [] }),
    }),
    shell,
    link: createNoopNamespace<CanvasWorkspaceApi['link']>(),
    defaultBrowser: createNoopNamespace<CanvasWorkspaceApi['defaultBrowser']>(),
    web: createNoopNamespace<CanvasWorkspaceApi['web']>(),
    dock: createNoopNamespace<CanvasWorkspaceApi['dock']>(),
    history: createNoopNamespace<CanvasWorkspaceApi['history']>(),
    plugin: createNoopNamespace<CanvasWorkspaceApi['plugin']>(),
    pluginMarket: createNoopNamespace<CanvasWorkspaceApi['pluginMarket']>(),
    telemetry: createNoopNamespace<CanvasWorkspaceApi['telemetry']>({
      track: async () => undefined,
    }),
    remoteVps,
  };
}
