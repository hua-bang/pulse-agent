import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasAgentServiceRef, PluginStore } from '../../../types';
import { ChannelBridge } from '../core/bridge';
import { SessionRouter } from '../core/sessions';
import type { Channel, ChannelStream, InboundHandler, InboundMessage } from '../core/types';

function setup() {
  let handler: InboundHandler = () => undefined;
  const stream: ChannelStream = {
    onText: vi.fn(), onToolCall: vi.fn(), onClarification: vi.fn(),
    onDone: vi.fn(), onError: vi.fn(),
  };
  const channel: Channel = {
    id: 'feishu', isConfigured: () => true,
    start: async (onInbound) => { handler = onInbound; }, stop: async () => undefined,
    openStream: vi.fn(async () => stream), sendText: vi.fn(async () => undefined),
  };
  const store: PluginStore = {
    get: async () => undefined, set: async () => undefined,
    delete: async () => undefined, list: async () => [],
  };
  const service: CanvasAgentServiceRef = {
    chat: vi.fn(async () => ({ ok: true })),
    chatWithScope: vi.fn(async () => ({ ok: true, response: 'hello' })),
    abort: vi.fn(), abortScope: vi.fn(),
    answerClarification: () => false, answerClarificationForScope: () => false,
    getStatus: () => ({ ok: true, active: false, messageCount: 0 }),
    getStatusForScope: () => ({ ok: true, active: false, messageCount: 0 }),
    getCurrentSessionId: () => null, getCurrentSessionIdForScope: () => null,
    newSession: async () => ({ ok: true }), newSessionForScope: async () => ({ ok: true }),
    loadSession: async () => ({ ok: true }), loadSessionForScope: async () => ({ ok: true }),
    listSessions: async () => [], listSessionsForScope: async () => [],
    copySessionToScope: async () => ({ ok: true, sessionId: 'copy', messageCount: 0 }),
  };
  const bridge = new ChannelBridge(service, store, { runIdleTimeoutMs: 10_000 });
  let messageId = 0;
  const send = () => {
    const message: InboundMessage = {
      channelId: 'feishu', conversationId: 'dm', userId: 'user', messageId: `${++messageId}`,
      text: 'hello', isDirect: true, isMention: false, reply: {},
    };
    handler(message);
  };
  return { bridge, channel, stream, service, send };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('channel startup acknowledgement', () => {
  it('opens the stream before a slow session selection and keeps the scope busy', async () => {
    vi.useFakeTimers();
    const { bridge, channel, stream, service, send } = setup();
    const events: Array<{ event: string; at: number }> = [];
    const start = Date.now();
    vi.mocked(channel.openStream).mockImplementation(async () => {
      events.push({ event: 'card', at: Date.now() - start });
      return stream;
    });
    vi.spyOn(SessionRouter.prototype, 'ensureSession').mockImplementation(async () => {
      events.push({ event: 'session-start', at: Date.now() - start });
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      events.push({ event: 'session-ready', at: Date.now() - start });
    });
    await bridge.addChannel(channel);
    send();
    await vi.advanceTimersByTimeAsync(0);
    const earlyCardCount = vi.mocked(channel.openStream).mock.calls.length;
    expect(service.chatWithScope).not.toHaveBeenCalled();
    send();
    await vi.advanceTimersByTimeAsync(0);
    expect(channel.sendText).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('Still working'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(earlyCardCount).toBe(1);
    expect(events).toEqual([
      { event: 'card', at: 0 }, { event: 'session-start', at: 0 }, { event: 'session-ready', at: 5_000 },
    ]);
    expect(channel.openStream).toHaveBeenCalledTimes(1);
    expect(service.chatWithScope).toHaveBeenCalledTimes(1);
    expect(stream.onDone).toHaveBeenCalledWith('hello');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes the early card with an error if session selection rejects, without starting chat', async () => {
    vi.useFakeTimers();
    const { bridge, channel, stream, service, send } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(SessionRouter.prototype, 'ensureSession').mockRejectedValueOnce(new Error('session failed'));
    await bridge.addChannel(channel);
    send();
    await vi.advanceTimersByTimeAsync(0);
    expect(channel.openStream).toHaveBeenCalledTimes(1);
    expect(stream.onError).toHaveBeenCalledWith('session failed');
    expect(service.chatWithScope).not.toHaveBeenCalled();
    // Let the independent 1s dedupe persistence debounce finish.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.getTimerCount()).toBe(0);
    send();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.chatWithScope).toHaveBeenCalledTimes(1);
  });

  it('cleans up the watchdog and skips session selection if opening the stream fails', async () => {
    vi.useFakeTimers();
    const { bridge, channel, service, send } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const select = vi.spyOn(SessionRouter.prototype, 'ensureSession').mockResolvedValue();
    vi.mocked(channel.openStream).mockRejectedValueOnce(new Error('card failed'));
    await bridge.addChannel(channel);
    send();
    await vi.advanceTimersByTimeAsync(0);
    expect(select).not.toHaveBeenCalled();
    expect(service.chatWithScope).not.toHaveBeenCalled();
    // Let the independent 1s dedupe persistence debounce finish.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.getTimerCount()).toBe(0);
    send();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.chatWithScope).toHaveBeenCalledTimes(1);
  });
});
