import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  chat: vi.fn(),
  runningSessionIds: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      mocks.handlers.set(channel, handler);
    },
  },
}));

vi.mock('./conversation-service', () => ({
  ConversationRuntimeService: vi.fn().mockImplementation(() => ({
    chat: mocks.chat,
    runningSessionIds: mocks.runningSessionIds,
    abort: vi.fn(),
    stopRelay: vi.fn(),
    answerClarification: vi.fn(),
  })),
}));

import { setupConversationRuntimeIpc } from './conversation-ipc';

describe('conversation runtime IPC', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.chat.mockReset();
    mocks.runningSessionIds.mockReset();
  });

  it('acknowledges an accepted turn before its completion event', async () => {
    let finish!: (result: { ok: boolean; response: string }) => void;
    mocks.chat.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    setupConversationRuntimeIpc(() => ({ getAgentForScope: vi.fn() }) as never);
    const handler = mocks.handlers.get('canvas-agent:conversation-chat');
    const send = vi.fn();
    const invocation = handler?.({
      sender: { isDestroyed: () => false, send },
    }, {
      scope: { kind: 'global' },
      sessionId: 'session-a',
      message: 'hello',
    });
    const settled: unknown[] = [];
    void Promise.resolve(invocation).then((result: unknown) => settled.push(result));

    await Promise.resolve();
    expect(settled).toEqual([{ ok: true, sessionId: 'session-a' }]);
    expect(send).not.toHaveBeenCalledWith(
      'canvas-agent:chat-complete:session-a',
      expect.anything(),
    );

    finish({ ok: true, response: 'done' });
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        'canvas-agent:chat-complete:session-a',
        { ok: true, response: 'done' },
      );
    });
  });

  it('reports running sessions from the conversation runtime registry', () => {
    mocks.runningSessionIds.mockReturnValue(['session-a', 'session-b']);
    setupConversationRuntimeIpc(() => ({ getAgentForScope: vi.fn() }) as never);
    const handler = mocks.handlers.get('canvas-agent:conversation-running-sessions');

    expect(handler?.({}, { scope: { kind: 'global' } })).toEqual({
      ok: true,
      conversationSessionIds: ['session-a', 'session-b'],
    });
  });
});
