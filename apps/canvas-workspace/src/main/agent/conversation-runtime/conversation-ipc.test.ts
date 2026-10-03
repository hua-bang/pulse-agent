import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  chat: vi.fn(),
  replay: vi.fn(),
  runningSessionIds: vi.fn(),
  liveSnapshot: vi.fn(),
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
    liveSnapshot: mocks.liveSnapshot,
    abort: vi.fn(),
    stopRelay: vi.fn(),
    answerClarification: vi.fn(),
  })),
}));

vi.mock('../perf-chat-replay', () => ({
  isPerfChatReplayRequest: (_message: string, enabled: boolean) => enabled,
  replayPerfChatStream: mocks.replay,
}));

import { setupConversationRuntimeIpc } from './conversation-ipc';

describe('conversation runtime IPC', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.chat.mockReset();
    mocks.runningSessionIds.mockReset();
    mocks.liveSnapshot.mockReset();
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

  it('streams the rest of a running turn to a window that attaches later', async () => {
    let onText!: (delta: string) => void;
    let finish!: (result: { ok: boolean; response: string }) => void;
    mocks.chat.mockImplementation((_scope, _sessionId, _message, external) => {
      onText = external.onText;
      return new Promise(resolve => { finish = resolve; });
    });
    const snapshot = { status: 'running', messages: [], draft: { role: 'assistant', content: 'Par' } };
    mocks.liveSnapshot.mockReturnValue(snapshot);
    setupConversationRuntimeIpc(() => ({ getAgentForScope: vi.fn() }) as never);
    const original = { isDestroyed: () => false, send: vi.fn() };
    const reloaded = { isDestroyed: () => false, send: vi.fn() };
    const payload = { scope: { kind: 'workspace', workspaceId: 'ws-a' }, sessionId: 'session-a' };

    mocks.handlers.get('canvas-agent:conversation-chat')?.({ sender: original }, { ...payload, message: 'hello' });
    onText('Par');
    expect(mocks.handlers.get('canvas-agent:conversation-attach')?.({ sender: reloaded }, payload))
      .toEqual({ ok: true, running: true, snapshot });
    onText('tial');
    finish({ ok: true, response: 'Partial' });

    await vi.waitFor(() => {
      expect(reloaded.send).toHaveBeenCalledWith('canvas-agent:chat-complete:session-a', { ok: true, response: 'Partial' });
    });
    expect(reloaded.send).toHaveBeenCalledWith('canvas-agent:text-delta:session-a', 'tial');
    expect(reloaded.send).not.toHaveBeenCalledWith('canvas-agent:text-delta:session-a', 'Par');
    expect(original.send).toHaveBeenCalledWith('canvas-agent:text-delta:session-a', 'tial');
  });

  it('reports an idle conversation without subscribing the window', () => {
    mocks.liveSnapshot.mockReturnValue(null);
    setupConversationRuntimeIpc(() => ({ getAgentForScope: vi.fn() }) as never);

    expect(mocks.handlers.get('canvas-agent:conversation-attach')?.(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { scope: { kind: 'global' }, sessionId: 'session-z' },
    )).toEqual({ ok: true, running: false });
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

  it('uses the deterministic perf replay on the conversation IPC path', async () => {
    vi.stubEnv('PULSE_CANVAS_PERF', '1');
    setupConversationRuntimeIpc(() => ({ getAgentForScope: vi.fn() }) as never);
    const handler = mocks.handlers.get('canvas-agent:conversation-chat');
    const sender = { isDestroyed: () => false, send: vi.fn() };

    expect(handler?.({ sender }, {
      scope: { kind: 'global' },
      sessionId: 'perf-session',
      message: '__pulse_perf_chat_stream__',
    })).toEqual({ ok: true, sessionId: 'perf-session' });
    expect(mocks.replay).toHaveBeenCalledWith(sender, 'perf-session');
    vi.unstubAllEnvs();
  });
});
