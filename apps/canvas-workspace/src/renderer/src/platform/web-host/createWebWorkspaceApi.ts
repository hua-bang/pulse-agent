import { createCanvasCompatibilityStore, type LegacyCanvas } from '@pulse-coder/storage/canvas';
import {
  createRemoteWorkspaceFiles,
  openRemoteStorage,
  subscribeRemoteChanges,
} from '@pulse-coder/storage/remote';
import type { AgentChatMessage, AgentSessionInfo } from '../../../../shared/agent-chat';
import type { CanvasSaveData, CanvasSummary, CanvasSummaryBox } from '../../../../shared/canvas';
import type { CanvasWorkspaceApi } from '../../../../shared/api/workspace-api';
import { createWebRemoteVpsApi } from './chatRoomClient';
import { scopeIdFromRef, toRemoteFileUri } from './remotePaths';
import { WEB_HOST_ACTIVE_WS_KEY, type WebHostAuthSession } from './types';
import { createWebAgentRuntime } from './webAgentClient';
import { createWebPtyClient } from './webPtyClient';

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

function extractConversationMessages(snapshot: {
  messages?: unknown[];
  entries?: Array<{ data?: unknown }>;
}): AgentChatMessage[] {
  if (Array.isArray(snapshot.messages)) {
    return snapshot.messages as AgentChatMessage[];
  }
  if (Array.isArray(snapshot.entries)) {
    return snapshot.entries
      .map((entry) => entry?.data)
      .filter((item): item is AgentChatMessage => Boolean(item && typeof item === 'object'));
  }
  return [];
}

function toSummaryBox(node: {
  type?: string;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): CanvasSummaryBox {
  return {
    type: node.type ?? 'text',
    ...(node.title ? { title: node.title.slice(0, 60) } : {}),
    x: typeof node.x === 'number' ? node.x : 0,
    y: typeof node.y === 'number' ? node.y : 0,
    width: typeof node.width === 'number' ? node.width : 240,
    height: typeof node.height === 'number' ? node.height : 160,
  };
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
            name: wsId === session.workspaceId && session.shareLabel ? session.shareLabel : wsId,
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
        const data = (await canvasStore.readCanvas(id)) as CanvasSaveData | null;
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
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
    read: async (filePath) => {
      const uri = toRemoteFileUri(filePath, currentWorkspaceId, session.workspaceId);
      if (!uri) {
        return { ok: false, error: 'File is outside the shared remote workspace.' };
      }
      try {
        const result = await remoteFiles.readText(uri);
        if (!result) return { ok: false, error: 'File not found' };
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
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
    listSessions: async (scopeRef) => {
      try {
        const scopeId = scopeIdFromRef(scopeRef, currentWorkspaceId);
        if (session.workspaceId && scopeId !== session.workspaceId) {
          return { ok: true, sessions: [] };
        }
        const storage = await getStorage();
        const [scope, page] = await Promise.all([
          storage.conversationScopes.read(scopeId),
          storage.conversations.list(scopeId, { limit: 100 }),
        ]);
        const currentId = scope?.currentSessionId ?? page.items[0]?.sessionId ?? null;
        const sessions: AgentSessionInfo[] = page.items.map((item) => {
          const meta = (item.metadata ?? {}) as Record<string, unknown>;
          return {
            sessionId: item.sessionId,
            date: typeof meta.date === 'string' ? meta.date : new Date().toISOString().slice(0, 10),
            updatedAt: typeof meta.updatedAt === 'number' ? meta.updatedAt : undefined,
            messageCount: typeof meta.messageCount === 'number' ? meta.messageCount : 0,
            isCurrent: item.sessionId === currentId,
            title: typeof meta.title === 'string' ? meta.title : undefined,
            preview: typeof meta.preview === 'string' ? meta.preview : undefined,
            pinned: typeof meta.pinned === 'boolean' ? meta.pinned : undefined,
          };
        });
        return { ok: true, sessions };
      } catch (err) {
        return { ok: false, sessions: [], error: err instanceof Error ? err.message : String(err) };
      }
    },
    getCurrentSession: async (scopeRef) => {
      try {
        const scopeId = scopeIdFromRef(scopeRef, currentWorkspaceId);
        if (session.workspaceId && scopeId !== session.workspaceId) {
          return { ok: true, sessionId: null };
        }
        const storage = await getStorage();
        const scope = await storage.conversationScopes.read(scopeId);
        if (scope?.currentSessionId) {
          return { ok: true, sessionId: scope.currentSessionId };
        }
        const page = await storage.conversations.list(scopeId, { limit: 1 });
        return { ok: true, sessionId: page.items[0]?.sessionId ?? null };
      } catch (err) {
        return { ok: false, sessionId: null, error: err instanceof Error ? err.message : String(err) };
      }
    },
    getHistory: async (scopeRef) => {
      try {
        const scopeId = scopeIdFromRef(scopeRef, currentWorkspaceId);
        if (session.workspaceId && scopeId !== session.workspaceId) {
          return { ok: true, messages: [], activeSessionId: null };
        }
        const storage = await getStorage();
        const scope = await storage.conversationScopes.read(scopeId);
        let activeId = scope?.currentSessionId ?? null;
        if (!activeId) {
          const page = await storage.conversations.list(scopeId, { limit: 1 });
          activeId = page.items[0]?.sessionId ?? null;
        }
        if (!activeId) return { ok: true, messages: [], activeSessionId: null };
        const conv = await storage.conversations.read(scopeId, activeId);
        return {
          ok: true,
          messages: conv ? extractConversationMessages(conv as unknown as { messages?: unknown[] }) : [],
          activeSessionId: activeId,
        };
      } catch {
        return { ok: true, messages: [], activeSessionId: null };
      }
    },
    loadSession: async (scopeRef, sessionId) => {
      try {
        const scopeId = scopeIdFromRef(scopeRef, currentWorkspaceId);
        if (session.workspaceId && scopeId !== session.workspaceId) {
          return { ok: true, messages: [], activeSessionId: sessionId };
        }
        const storage = await getStorage();
        const conv = await storage.conversations.read(scopeId, sessionId);
        return {
          ok: true,
          messages: conv ? extractConversationMessages(conv as unknown as { messages?: unknown[] }) : [],
          activeSessionId: sessionId,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
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
