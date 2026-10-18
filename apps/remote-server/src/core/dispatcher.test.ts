import { describe, expect, it, vi } from 'vitest';

vi.mock('./chat-commands.js', () => ({
  processIncomingCommand: vi.fn(async () => ({ type: 'none' })),
}));

vi.mock('./agent-runner.js', () => ({
  executeAgentTurn: vi.fn(),
  formatCompactionEvents: vi.fn(),
}));

import { webAdapter } from '../adapters/web/adapter.js';
import { connectWriter, createSlot } from '../adapters/web/sse-registry.js';
import { clearActiveRun, setActiveRun } from './active-run-store.js';
import { dispatchIncoming } from './dispatcher.js';
import { executeAgentTurn } from './agent-runner.js';

describe('dispatcher', () => {
  it('sends the busy error to the second Web message\'s own stream', async () => {
    const platformKey = 'web:busy-user';
    setActiveRun(platformKey, {
      streamId: 'first-stream',
      runId: 'first-run',
      ac: new AbortController(),
      startedAt: Date.now(),
    });

    const streamId = 'second-stream';
    createSlot(streamId);
    const events: Array<{ event: string; data: unknown }> = [];
    const done = new Promise<void>((resolve) => {
      connectWriter(streamId, (event, dataStr) => {
        events.push({ event, data: JSON.parse(dataStr) });
        resolve();
      });
    });

    try {
      dispatchIncoming(webAdapter, { platformKey, text: 'second message', streamId });
      await done;
    } finally {
      clearActiveRun(platformKey);
    }

    expect(events).toEqual([{ event: 'error', data: { message: '正在处理上一条消息，请稍候再试。' } }]);
    expect(executeAgentTurn).not.toHaveBeenCalled();
  });
});
