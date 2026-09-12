import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasAgentServiceRef, PluginStore } from '../../../types';
import type { ConversationTurnExternal } from '../../../../main/agent/conversation-runtime/conversation-runtime';
import type { ConversationRuntimeService } from '../../../../main/agent/conversation-runtime/conversation-service';
import { ChannelBridge } from '../core/bridge';
import type { Channel, ChannelStream, InboundHandler, InboundMessage } from '../core/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

function setup(runtimeOverrides: Record<string, unknown> = {}, options: { runIdleTimeoutMs: number; toolExecTimeoutMs?: number; clarificationTimeoutMs?: number } = { runIdleTimeoutMs: 10_000 }) {
  let handler: InboundHandler = () => undefined;
  const streams: ChannelStream[] = [];
  const channel: Channel = {
    id: 'feishu',
    isConfigured: () => true,
    start: async onInbound => { handler = onInbound; },
    stop: async () => undefined,
    openStream: vi.fn(async () => {
      const stream: ChannelStream = {
        onText: vi.fn(), onToolCall: vi.fn(), onClarification: vi.fn(),
        onDone: vi.fn(), onError: vi.fn(),
      };
      streams.push(stream);
      return stream;
    }),
    sendText: vi.fn(async () => undefined),
  };
  const store: PluginStore = {
    get: async () => undefined,
    set: async () => undefined,
    delete: async () => undefined,
    list: async () => [],
  };
  const service = {
    listSessionsForScope: vi.fn(async () => []),
  } as unknown as CanvasAgentServiceRef;
  const runtime = {
    provisionSession: vi.fn(async () => ({ ok: true, sessionId: 'session' })),
    hasSession: vi.fn(async () => true),
    copySessionToScope: vi.fn(),
    chat: vi.fn(async () => ({ ok: true, response: 'hello' })),
    abort: vi.fn(() => true),
    answerClarification: vi.fn(() => false),
    ...runtimeOverrides,
  } as unknown as ConversationRuntimeService;
  const bridge = new ChannelBridge(service, runtime, store, options);
  let messageId = 0;
  const send = (text?: string) => {
    const message: InboundMessage = {
      channelId: 'feishu', conversationId: 'dm', userId: 'user', messageId: `${++messageId}`,
      text: text ?? `hello-${messageId}`, isDirect: true, isMention: false, reply: {},
    };
    handler(message);
  };
  return { bridge, channel, streams, runtime, send };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('channel startup acknowledgement', () => {
  it('opens a stream for every accepted message before single-flight session provisioning', async () => {
    vi.useFakeTimers();
    const gate = deferred<{ ok: boolean; sessionId: string }>();
    const { bridge, channel, streams, runtime, send } = setup({
      provisionSession: vi.fn(async () => gate.promise),
      hasSession: vi.fn(async () => false),
    });
    await bridge.addChannel(channel);

    send();
    send();
    await vi.advanceTimersByTimeAsync(0);

    expect(channel.openStream).toHaveBeenCalledTimes(2);
    expect(runtime.provisionSession).toHaveBeenCalledTimes(1);
    expect(runtime.chat).not.toHaveBeenCalled();
    expect(channel.sendText).not.toHaveBeenCalled();

    gate.resolve({ ok: true, sessionId: 'session' });
    await vi.advanceTimersByTimeAsync(0);
    expect(channel.openStream).toHaveBeenCalledTimes(2);
    expect(runtime.chat).toHaveBeenCalledTimes(2);
    expect(streams.every(stream => vi.mocked(stream.onDone).mock.calls.length === 1)).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let an immediate command release an earlier pending submission', async () => {
    vi.useFakeTimers();
    const gate = deferred<{ ok: boolean; sessionId: string }>();
    const { bridge, channel, runtime, send } = setup({
      provisionSession: vi.fn(async () => gate.promise),
    });
    await bridge.addChannel(channel);
    send('first');
    send('/help');
    send('third');
    await vi.advanceTimersByTimeAsync(0);
    expect(channel.sendText).toHaveBeenCalled();
    expect(channel.openStream).toHaveBeenCalledTimes(2);
    expect(runtime.chat).not.toHaveBeenCalled();
    gate.resolve({ ok: true, sessionId: 'session' });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(runtime.chat).mock.calls.map(call => call[2])).toEqual(['first', 'third']);
  });

  it('rejects route changes during a topic run while keeping stop immediate', async () => {
    vi.useFakeTimers();
    const gate = deferred<{ ok: boolean; response: string }>();
    const { bridge, channel, runtime, send } = setup({ chat: vi.fn(() => gate.promise) });
    await bridge.addChannel(channel);
    send('first');
    await vi.advanceTimersByTimeAsync(0);
    for (const command of ['/new', '/use elsewhere', '/unbind', '/bind elsewhere', '/session other']) {
      send(command);
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.mocked(channel.sendText).mock.lastCall?.[1]).toContain('Wait for this topic');
    }
    expect(runtime.provisionSession).toHaveBeenCalledTimes(1);
    send('/stop');
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.abort).toHaveBeenCalledWith({ kind: 'global' }, 'session');
    gate.resolve({ ok: true, response: 'stopped' });
    await vi.advanceTimersByTimeAsync(0);
  });

  it('closes every early stream with an error when provisioning fails', async () => {
    vi.useFakeTimers();
    const { bridge, channel, streams, runtime, send } = setup({
      provisionSession: vi.fn(async () => ({ ok: false, error: 'session failed' })),
      hasSession: vi.fn(async () => false),
    });
    await bridge.addChannel(channel);

    send();
    send();
    await vi.advanceTimersByTimeAsync(0);

    expect(channel.openStream).toHaveBeenCalledTimes(2);
    expect(runtime.chat).not.toHaveBeenCalled();
    expect(streams.every(stream => vi.mocked(stream.onError).mock.calls[0]?.[0] === 'session failed')).toBe(true);
  });

  it('does not provision a session when opening the stream fails', async () => {
    vi.useFakeTimers();
    const { bridge, channel, runtime, send } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(channel.openStream).mockRejectedValueOnce(new Error('card failed'));
    await bridge.addChannel(channel);

    send();
    await vi.advanceTimersByTimeAsync(0);

    expect(runtime.provisionSession).not.toHaveBeenCalled();
    expect(runtime.chat).not.toHaveBeenCalled();
  });
});


describe('channel watchdog guards', () => {
  it.each([
    { mode: 'idle', duration: 50, error: 'No agent activity' },
    { mode: 'tool', duration: 200, error: 'tool ran for' },
    { mode: 'clarification', duration: 150, error: 'No answer to the question' },
  ])('bounds $mode waits without aborting early', async ({ mode, duration, error }) => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { bridge, channel, runtime, streams, send } = setup({
      chat: vi.fn((_scope, _sessionId, _message, callbacks: ConversationTurnExternal) => {
        callbacks.onText?.('');
        if (mode === 'tool') callbacks.onToolCall?.({ name: 'slow-tool', toolCallId: 't1' });
        if (mode === 'clarification') callbacks.onClarificationRequest?.({ id: 'q1', question: 'Which?' });
        return new Promise(() => undefined);
      }),
    }, { runIdleTimeoutMs: 50, toolExecTimeoutMs: 200, clarificationTimeoutMs: 150 });
    await bridge.addChannel(channel);
    send();
    await vi.advanceTimersByTimeAsync(duration - 1);
    expect(runtime.abort).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.abort).toHaveBeenCalledWith({ kind: 'global' }, 'session');
    expect(streams[0].onError).toHaveBeenCalledWith(expect.stringContaining(error));
    await vi.advanceTimersByTimeAsync(1_000); // also flush debounced dedupe persistence
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails immediately if the clarification cannot be delivered', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { bridge, channel, runtime, streams, send } = setup({
      chat: vi.fn((_scope, _sessionId, _message, callbacks: ConversationTurnExternal) => {
        vi.mocked(streams[0].onClarification).mockRejectedValueOnce(new Error('delivery failed'));
        callbacks.onClarificationRequest?.({ id: 'q1', question: 'Which?' });
        return new Promise(() => undefined);
      }),
    });
    await bridge.addChannel(channel);
    send();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.abort).toHaveBeenCalledWith({ kind: 'global' }, 'session');
    expect(streams[0].onError).toHaveBeenCalledWith(expect.stringContaining("can't be answered"));
    await vi.advanceTimersByTimeAsync(1_000); // also flush debounced dedupe persistence
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not abort a completed model turn while its final card is still sending', async () => {
    vi.useFakeTimers();
    const delivery = deferred<void>();
    const { bridge, channel, runtime, streams, send } = setup({
      chat: vi.fn(async (_scope, _sessionId, _message, callbacks: ConversationTurnExternal) => {
        callbacks.onText?.('done');
        vi.mocked(streams[0].onDone).mockImplementation(() => delivery.promise);
        return { ok: true, response: 'done' };
      }),
    }, { runIdleTimeoutMs: 50 });
    await bridge.addChannel(channel);
    send();
    await vi.advanceTimersByTimeAsync(100);
    expect(streams[0].onDone).toHaveBeenCalledWith('done');
    expect(runtime.abort).not.toHaveBeenCalled();
    delivery.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('forwards streaming tool input and refreshes the idle budget', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let callbacks!: ConversationTurnExternal;
    const { bridge, channel, runtime, streams, send } = setup({
      chat: vi.fn((_scope, _sessionId, _message, external: ConversationTurnExternal) => {
        callbacks = external;
        return new Promise(() => undefined);
      }),
    }, { runIdleTimeoutMs: 50 });
    await bridge.addChannel(channel);
    send();
    await vi.advanceTimersByTimeAsync(0);
    streams[0].onToolInputStart = vi.fn();
    streams[0].onToolInputDelta = vi.fn();
    streams[0].onToolInputEnd = vi.fn();
    callbacks.onToolInputStart?.({ id: 't1', toolName: 'bash' });
    await vi.advanceTimersByTimeAsync(40);
    callbacks.onToolInputDelta?.({ id: 't1', delta: 'args' });
    callbacks.onToolInputEnd?.({ id: 't1' });
    expect(streams[0].onToolInputStart).toHaveBeenCalledWith({ id: 't1', toolName: 'bash' });
    expect(streams[0].onToolInputDelta).toHaveBeenCalledWith({ id: 't1', delta: 'args' });
    expect(streams[0].onToolInputEnd).toHaveBeenCalledWith({ id: 't1' });
    await vi.advanceTimersByTimeAsync(49);
    expect(runtime.abort).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.abort).toHaveBeenCalledWith({ kind: 'global' }, 'session');
  });
});
