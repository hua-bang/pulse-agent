import { describe, expect, it, vi } from 'vitest';

const canvasAgentState = vi.hoisted(() => ({
  initialize: vi.fn(async () => undefined),
  getHistory: vi.fn(() => [{ role: 'user', content: 'previous chat', timestamp: 1 }]),
  configs: [] as unknown[],
  instances: [] as Array<{ initialize: () => Promise<void>; getHistory: () => unknown[] }>,
}));

vi.mock('../canvas-agent', () => ({
  CanvasAgent: vi.fn().mockImplementation((config) => {
    const instance = {
      initialize: canvasAgentState.initialize,
      getHistory: canvasAgentState.getHistory,
    };
    canvasAgentState.configs.push(config);
    canvasAgentState.instances.push(instance);
    return instance;
  }),
}));

import { CanvasAgentService } from '../service';

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
});
