import { describe, expect, it, vi } from 'vitest';

const canvasAgentState = vi.hoisted(() => ({
  initialize: vi.fn(async () => undefined),
  chat: vi.fn(),
  getCurrentSessionId: vi.fn(() => 'session-current'),
  getHistory: vi.fn(() => [{ role: 'user', content: 'previous chat', timestamp: 1 }]),
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
  it('activates the agent before reading history', async () => {
    const service = new CanvasAgentService();

    const messages = await service.getHistoryForScope({ kind: 'workspace', workspaceId: 'ws-history' });

    expect(canvasAgentState.initialize).toHaveBeenCalledTimes(1);
    expect(canvasAgentState.getHistory).toHaveBeenCalledTimes(1);
    expect(messages).toEqual([{ role: 'user', content: 'previous chat', timestamp: 1 }]);
  });

  it('gives every scheduled task an isolated durable chat store', async () => {
    const service = new CanvasAgentService();

    await service.getHistoryForScope({ kind: 'scheduled', taskId: 'daily-brief' });

    expect(canvasAgentState.configs.at(-1)).toMatchObject({
      scope: { kind: 'scheduled', taskId: 'daily-brief' },
      sessionStoreId: '__scheduled__-daily-brief',
      workspaceId: undefined,
      workspaceDir: undefined,
    });
  });

  it('coalesces concurrent activation reads for the same scope', async () => {
    let finishInitialization: (() => void) | undefined;
    const initializationGate = new Promise<undefined>((resolve) => {
      finishInitialization = () => resolve(undefined);
    });
    canvasAgentState.initialize.mockImplementationOnce(() => initializationGate);
    const initialConfigCount = canvasAgentState.configs.length;
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-concurrent' } as const;

    const firstRead = service.getHistoryForScope(scope);
    const secondRead = service.getHistoryForScope(scope);
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
    await service.getHistoryForScope({ kind: 'global' });
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
