import { describe, expect, it, vi } from 'vitest';

const canvasAgentState = vi.hoisted(() => ({
  initialize: vi.fn(async () => undefined),
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
    getHistory: () => unknown[];
    listSessions: () => Promise<unknown[]>;
  }>,
}));

vi.mock('../canvas-agent', () => ({
  CanvasAgent: vi.fn().mockImplementation((config) => {
    const instance = {
      initialize: canvasAgentState.initialize,
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

  it('keeps an active empty-chat scope in the unified session groups', async () => {
    vi.spyOn(SessionStore, 'listAllWorkspaceSessions').mockResolvedValue([]);
    const service = new CanvasAgentService();
    await service.getHistoryForScope({ kind: 'global' });

    const groups = await service.listAllSessions({});

    expect(groups).toEqual([{
      workspaceId: '__global_chat__',
      workspaceName: 'Global Chat',
      sessions: [{
        sessionId: 'session-current',
        date: '2026-07-29',
        messageCount: 0,
        isCurrent: true,
        preview: '',
      }],
    }]);
  });
});
