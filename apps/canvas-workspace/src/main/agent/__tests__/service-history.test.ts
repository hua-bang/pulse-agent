import { describe, expect, it, vi } from 'vitest';

const canvasAgentState = vi.hoisted(() => ({
  initialize: vi.fn(async () => undefined),
  getHistory: vi.fn(() => [{ role: 'user', content: 'previous chat', timestamp: 1 }]),
  instances: [] as Array<{ initialize: () => Promise<void>; getHistory: () => unknown[] }>,
}));

vi.mock('../canvas-agent', () => ({
  CanvasAgent: vi.fn().mockImplementation(() => {
    const instance = {
      initialize: canvasAgentState.initialize,
      getHistory: canvasAgentState.getHistory,
    };
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
});
