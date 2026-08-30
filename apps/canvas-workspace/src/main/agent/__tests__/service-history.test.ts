import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const canvasAgentState = vi.hoisted(() => ({
  initialize: vi.fn(async () => undefined),
  chat: vi.fn(),
  getCurrentSessionId: vi.fn(() => 'session-current'),
  getHistory: vi.fn(() => [{ role: 'user', content: 'previous chat', timestamp: 1 }]),
  loadSession: vi.fn(),
  loadGates: new Map<string, Promise<void>>(),
  listSessions: vi.fn(async () => [{
    sessionId: 'session-current',
    date: '2026-07-29',
    messageCount: 0,
    isCurrent: true,
    preview: '',
  }]),
  configs: [] as unknown[],
  instances: [] as Array<{
    initialize: () => Promise<void>;
    chat: (...args: unknown[]) => Promise<unknown>;
    getCurrentSessionId: () => string;
    getHistory: () => unknown[];
    loadSession: (sessionId: string) => Promise<unknown>;
    listSessions: () => Promise<unknown[]>;
  }>,
}));

vi.mock('../canvas-agent', () => ({
  CanvasAgent: vi.fn().mockImplementation((config) => {
    const instance = {
      initialize: canvasAgentState.initialize,
      chat: canvasAgentState.chat,
      getCurrentSessionId: canvasAgentState.getCurrentSessionId,
      getHistory: canvasAgentState.getHistory,
      loadSession: canvasAgentState.loadSession,
      listSessions: canvasAgentState.listSessions,
    };
    canvasAgentState.configs.push(config);
    canvasAgentState.instances.push(instance);
    return instance;
  }),
}));

import { CanvasAgentService } from '../service';
import { SessionStore } from '../session-store';

describe('CanvasAgentService history', () => {
  let sessionRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    canvasAgentState.initialize.mockReset().mockResolvedValue(undefined);
    canvasAgentState.chat.mockReset();
    canvasAgentState.getCurrentSessionId.mockReset().mockReturnValue('session-current');
    canvasAgentState.getHistory.mockReset().mockReturnValue([
      { role: 'user', content: 'previous chat', timestamp: 1 },
    ]);
    canvasAgentState.loadSession.mockReset().mockImplementation(async (sessionId: string) => {
      await canvasAgentState.loadGates.get(sessionId);
      canvasAgentState.getCurrentSessionId.mockReturnValue(sessionId);
      return { sessionId, messages: [] };
    });
    canvasAgentState.loadGates.clear();
    canvasAgentState.listSessions.mockReset().mockResolvedValue([{
      sessionId: 'session-current',
      date: '2026-07-29',
      messageCount: 0,
      isCurrent: true,
      preview: '',
    }]);
    canvasAgentState.configs.length = 0;
    canvasAgentState.instances.length = 0;
    sessionRoot = join(tmpdir(), `service-history-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.PULSE_CANVAS_SESSION_STORE_DIR = sessionRoot;
  });

  afterEach(async () => {
    delete process.env.PULSE_CANVAS_SESSION_STORE_DIR;
    await fs.rm(sessionRoot, { recursive: true, force: true });
  });

  it('reads history from an already-active agent', async () => {
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-history' } as const;
    await service.activate(scope.workspaceId);

    const snapshot = await service.getHistorySnapshotForScope(scope);

    expect(canvasAgentState.initialize).toHaveBeenCalledTimes(1);
    expect(canvasAgentState.getHistory).toHaveBeenCalledTimes(1);
    expect(snapshot).toEqual({
      messages: [{ role: 'user', content: 'previous chat', timestamp: 1 }],
      activeSessionId: 'session-current',
    });
  });

  it('returns cold history before slow engine initialization completes', async () => {
    let finishInitialization: (() => void) | undefined;
    const initializationGate = new Promise<undefined>((resolve) => {
      finishInitialization = () => resolve(undefined);
    });
    canvasAgentState.initialize.mockImplementationOnce(() => initializationGate);
    const scope = { kind: 'workspace', workspaceId: 'ws-cold' } as const;
    const diskStore = new SessionStore(scope.workspaceId, scope);
    await diskStore.startSession();
    const sessionId = diskStore.getCurrentSession()!.sessionId;
    await diskStore.appendToSession(sessionId, [
      { role: 'user', content: 'loaded from disk', timestamp: 1 },
    ]);
    const service = new CanvasAgentService();

    await expect(service.getHistorySnapshotForScope(scope)).resolves.toEqual({
      messages: [{ role: 'user', content: 'loaded from disk', timestamp: 1 }],
      activeSessionId: sessionId,
    });
    expect(canvasAgentState.initialize).not.toHaveBeenCalled();
    expect(service.getAgentForScope(scope)).toBeUndefined();

    finishInitialization?.();
    await service.activate(scope.workspaceId);
    expect(service.getAgentForScope(scope)).toBeDefined();
  });

  it('loads a cold archived session without starting Agent initialization', async () => {
    let finishInitialization: (() => void) | undefined;
    const initializationGate = new Promise<undefined>((resolve) => {
      finishInitialization = () => resolve(undefined);
    });
    canvasAgentState.initialize.mockImplementationOnce(() => initializationGate);
    const scope = { kind: 'workspace', workspaceId: 'ws-cold-load' } as const;
    const diskStore = new SessionStore(scope.workspaceId, scope);
    await diskStore.startSession();
    const archivedSessionId = diskStore.getCurrentSession()!.sessionId;
    await diskStore.appendToSession(archivedSessionId, [
      { role: 'user', content: 'archived conversation', timestamp: 1 },
    ]);
    await diskStore.startSession();
    const service = new CanvasAgentService();

    const load = service.loadSessionForDisplayScope(scope, archivedSessionId);
    await Promise.resolve();
    const initializationStartedBeforeLoadSettled = canvasAgentState.initialize.mock.calls.length;
    finishInitialization?.();
    const result = await load;

    expect(initializationStartedBeforeLoadSettled).toBe(0);
    expect(result).toEqual({
      ok: true,
      activeSessionId: archivedSessionId,
      messages: [{ role: 'user', content: 'archived conversation', timestamp: 1 }],
    });
  });

  it('reconciles an in-flight activation to a newer display session pointer', async () => {
    let finishInitialization: (() => void) | undefined;
    const initializationGate = new Promise<undefined>((resolve) => {
      finishInitialization = () => resolve(undefined);
    });
    canvasAgentState.initialize.mockImplementationOnce(() => initializationGate);
    const scope = { kind: 'workspace', workspaceId: 'ws-activation-race' } as const;
    const diskStore = new SessionStore(scope.workspaceId, scope);
    await diskStore.startSession();
    const selectedSessionId = diskStore.getCurrentSession()!.sessionId;
    await diskStore.appendToSession(selectedSessionId, [
      { role: 'user', content: 'selected while activation waits', timestamp: 1 },
    ]);
    await diskStore.startSession();
    const service = new CanvasAgentService();

    const activation = service.activate(scope.workspaceId);
    await vi.waitFor(() => expect(canvasAgentState.initialize).toHaveBeenCalledTimes(1));
    const displayLoad = await service.loadSessionForDisplayScope(scope, selectedSessionId);
    expect(displayLoad).toMatchObject({ ok: true, activeSessionId: selectedSessionId });

    finishInitialization?.();
    await activation;

    expect(canvasAgentState.loadSession).toHaveBeenCalledWith(selectedSessionId);
    expect(service.getCurrentSessionIdForScope(scope)).toBe(selectedSessionId);
  });

  it('queues a newer display selection behind post-activation reconciliation', async () => {
    let finishInitialization: (() => void) | undefined;
    let finishReconciliation: (() => void) | undefined;
    const initializationGate = new Promise<undefined>((resolve) => {
      finishInitialization = () => resolve(undefined);
    });
    const reconciliationGate = new Promise<void>((resolve) => {
      finishReconciliation = resolve;
    });
    canvasAgentState.initialize.mockImplementationOnce(() => initializationGate);
    const scope = { kind: 'workspace', workspaceId: 'ws-reconcile-order' } as const;
    const diskStore = new SessionStore(scope.workspaceId, scope);
    await diskStore.startSession();
    const firstSelection = diskStore.getCurrentSession()!.sessionId;
    await diskStore.appendToSession(firstSelection, [
      { role: 'user', content: 'first selection', timestamp: 1 },
    ]);
    await diskStore.startSession();
    const newerSelection = diskStore.getCurrentSession()!.sessionId;
    await diskStore.appendToSession(newerSelection, [
      { role: 'user', content: 'newer selection', timestamp: 2 },
    ]);
    await diskStore.startSession();
    const service = new CanvasAgentService();

    const activation = service.activate(scope.workspaceId);
    await vi.waitFor(() => expect(canvasAgentState.initialize).toHaveBeenCalledTimes(1));
    await service.loadSessionForDisplayScope(scope, firstSelection);
    canvasAgentState.loadGates.set(firstSelection, reconciliationGate);
    finishInitialization?.();
    await vi.waitFor(() => expect(canvasAgentState.loadSession).toHaveBeenCalledWith(firstSelection));

    const newerLoad = service.loadSessionForDisplayScope(scope, newerSelection);
    await Promise.resolve();
    expect(canvasAgentState.loadSession).not.toHaveBeenCalledWith(newerSelection);

    finishReconciliation?.();
    await Promise.all([activation, newerLoad]);
    expect(canvasAgentState.loadSession.mock.calls.map(([sessionId]) => sessionId)).toEqual([
      firstSelection,
      newerSelection,
    ]);
    expect(service.getCurrentSessionIdForScope(scope)).toBe(newerSelection);
  });

  it('gives every scheduled task an isolated durable chat store', async () => {
    const service = new CanvasAgentService();

    await service.listSessionsForScope({ kind: 'scheduled', taskId: 'daily-brief' });

    expect(canvasAgentState.configs.at(-1)).toMatchObject({
      scope: { kind: 'scheduled', taskId: 'daily-brief' },
      sessionStoreId: '__scheduled__-daily-brief',
      workspaceId: undefined,
      workspaceDir: undefined,
    });
  });

  it('coalesces concurrent activation requests for the same scope', async () => {
    let finishInitialization: (() => void) | undefined;
    const initializationGate = new Promise<undefined>((resolve) => {
      finishInitialization = () => resolve(undefined);
    });
    canvasAgentState.initialize.mockImplementationOnce(() => initializationGate);
    const initialConfigCount = canvasAgentState.configs.length;
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-concurrent' } as const;

    const firstRead = service.activate(scope.workspaceId);
    const secondRead = service.activate(scope.workspaceId);
    await vi.waitFor(() => {
      expect(canvasAgentState.configs).toHaveLength(initialConfigCount + 1);
    });
    finishInitialization?.();

    await Promise.all([firstRead, secondRead]);
    expect(canvasAgentState.configs).toHaveLength(initialConfigCount + 1);
  });

  it('hides an active empty-chat scope from the unified session groups', async () => {
    const scan = vi.spyOn(SessionStore, 'listAllWorkspaceSessions').mockResolvedValue([]);
    const service = new CanvasAgentService();
    await service.listSessionsForScope({ kind: 'global' });
    canvasAgentState.listSessions.mockResolvedValueOnce([]);

    const groups = await service.listAllSessions({});

    expect(scan).toHaveBeenCalledWith(new Set(['__global_chat__']));

    expect(groups).toEqual([]);
  });

  it('forwards an abort that arrives while scope activation is still pending', async () => {
    let finishInitialization: (() => void) | undefined;
    const initializationGate = new Promise<undefined>((resolve) => {
      finishInitialization = () => resolve(undefined);
    });
    let receivedSignal: AbortSignal | undefined;
    canvasAgentState.initialize.mockImplementationOnce(() => initializationGate);
    canvasAgentState.chat.mockImplementationOnce(async (...args: unknown[]) => {
      receivedSignal = args.find((arg): arg is AbortSignal => arg instanceof AbortSignal);
      return { response: '', stopped: receivedSignal?.aborted };
    });
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-abort-during-activation' } as const;
    const controller = new AbortController();

    const responsePromise = service.chatWithScope(
      scope,
      'stop before activation finishes',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      controller.signal,
    );
    await vi.waitFor(() => {
      expect(canvasAgentState.configs.at(-1)).toMatchObject({ scope });
    });

    controller.abort();
    finishInitialization?.();

    await expect(responsePromise).resolves.toMatchObject({ ok: true, stopped: true });
    expect(receivedSignal?.aborted).toBe(true);
  });
});
