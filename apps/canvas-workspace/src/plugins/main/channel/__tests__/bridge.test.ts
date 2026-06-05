import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentChatResult,
  AgentSessionInfo,
  AgentStatusInfo,
  CanvasAgentServiceRef,
  PluginStore,
} from '../../../types';
import { ChannelBridge } from '../core/bridge';
import type {
  Channel,
  ChannelStream,
  InboundHandler,
  InboundMessage,
  OutboundTarget,
  WorkspacePicker,
} from '../core/types';

vi.mock('../core/workspaces', () => {
  const workspaces = [
    { id: 'ws-A', name: 'Alpha', modifiedAt: 2, isActive: true },
    { id: 'ws-B', name: 'Beta', modifiedAt: 1, isActive: false },
  ];
  const label = (w: { id: string; name?: string }) => (w.name ? `${w.name} (${w.id})` : w.id);
  return {
    listWorkspaces: vi.fn(async () => workspaces),
    resolveWorkspace: vi.fn(async (ref: string) => {
      const byId = workspaces.find((w) => w.id === ref);
      if (byId) return byId.id;
      return workspaces.find((w) => w.name.toLowerCase() === ref.toLowerCase())?.id ?? null;
    }),
    resolveWorkspaceRef: vi.fn(async (ref: string) => {
      if (/^#?\d{1,3}$/.test(ref.trim())) {
        const n = Number(ref.trim().replace('#', ''));
        if (n >= 1 && n <= workspaces.length) return workspaces[n - 1].id;
      }
      const byId = workspaces.find((w) => w.id === ref);
      if (byId) return byId.id;
      return workspaces.find((w) => w.name.toLowerCase() === ref.toLowerCase())?.id ?? null;
    }),
    workspaceLabel: label,
    workspaceLabelById: vi.fn(async (id: string) => {
      const found = workspaces.find((w) => w.id === id);
      return found ? label(found) : id;
    }),
  };
});

function memoryStore(): PluginStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(k: string) {
      return map.get(k) as T | undefined;
    },
    async set<T>(k: string, v: T) {
      map.set(k, v);
    },
    async delete(k: string) {
      map.delete(k);
    },
    async list() {
      return Array.from(map.keys());
    },
  };
}

function fakeService(overrides: Partial<CanvasAgentServiceRef> = {}): CanvasAgentServiceRef {
  return {
    chat: async (): Promise<AgentChatResult> => ({ ok: true, response: 'hi' }),
    chatWithScope: async (): Promise<AgentChatResult> => ({ ok: true, response: 'hi' }),
    abort: () => {},
    abortScope: () => {},
    answerClarification: () => true,
    answerClarificationForScope: () => true,
    getStatus: (): AgentStatusInfo => ({ ok: true, active: false, messageCount: 0 }),
    getStatusForScope: (): AgentStatusInfo => ({ ok: true, active: false, messageCount: 0 }),
    getCurrentSessionId: () => null,
    getCurrentSessionIdForScope: () => null,
    newSession: async () => ({ ok: true }),
    newSessionForScope: async () => ({ ok: true }),
    loadSession: async () => ({ ok: true }),
    loadSessionForScope: async () => ({ ok: true }),
    listSessions: async (): Promise<AgentSessionInfo[]> => [],
    listSessionsForScope: async (): Promise<AgentSessionInfo[]> => [],
    copySessionToScope: async () => ({ ok: true, sessionId: 'copied-session', messageCount: 0 }),
    ...overrides,
  };
}

function msg(text: string, overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channelId: 'feishu',
    conversationId: 'chatA',
    userId: 'u1',
    messageId: `m-${Math.random()}`,
    text,
    isMention: false,
    isDirect: true,
    reply: { chatId: 'chatA', isGroup: false, triggerMessageId: 'm1' },
    ...overrides,
  };
}

async function flushInbound(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeChannel implements Channel {
  readonly id = 'feishu';
  handler: InboundHandler | null = null;
  events: string[] = [];
  sentText: Array<{ target: OutboundTarget; text: string }> = [];
  pickers: Array<{ target: OutboundTarget; picker: WorkspacePicker }> = [];
  streams: FakeStream[] = [];

  isConfigured(): boolean {
    return true;
  }

  async start(onInbound: InboundHandler): Promise<void> {
    this.handler = onInbound;
  }

  async stop(): Promise<void> {
    this.handler = null;
  }

  async openStream(): Promise<ChannelStream> {
    const stream = new FakeStream(this.events);
    this.streams.push(stream);
    return stream;
  }

  async sendText(target: OutboundTarget, text: string): Promise<void> {
    this.sentText.push({ target, text });
  }

  async sendWorkspacePicker(target: OutboundTarget, picker: WorkspacePicker): Promise<void> {
    this.events.push('picker');
    this.pickers.push({ target, picker });
  }
}

class FakeStream implements ChannelStream {
  done: string | null = null;
  errors: string[] = [];
  text = '';

  constructor(private readonly events: string[]) {}

  onText(delta: string): void {
    this.text += delta;
  }

  onToolCall(): void {}

  onClarification(): void {}

  onDone(text: string): void {
    this.events.push('done');
    this.done = text;
  }

  onError(message: string): void {
    this.errors.push(message);
  }
}

describe('ChannelBridge', () => {
  let channel: FakeChannel;

  beforeEach(() => {
    channel = new FakeChannel();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-binds an unbound group message to the active workspace and shows the picker', async () => {
    const service = fakeService({
      chatWithScope: vi.fn(async () => ({ ok: true, response: 'workspace reply' })),
      newSessionForScope: vi.fn(async () => ({ ok: true })),
      getCurrentSessionIdForScope: vi.fn(() => 'workspace-session'),
    });
    const bridge = new ChannelBridge(service, memoryStore());
    await bridge.addChannel(channel);

    channel.handler!(
      msg('你在吗', {
        conversationId: 'groupA:threadA',
        isDirect: false,
        isMention: true,
        reply: { chatId: 'groupA', threadId: 'threadA', isGroup: true, triggerMessageId: 'm1' },
      }),
    );
    await flushInbound();

    expect(service.chatWithScope).toHaveBeenCalledWith(
      { kind: 'workspace', workspaceId: 'ws-A' },
      '你在吗',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      undefined,
      expect.any(Function),
    );
    expect(channel.pickers).toHaveLength(1);
    expect(channel.pickers[0].target.conversationId).toBe('groupA:threadA');
    expect(channel.pickers[0].picker.defaultCarry).toBe(true);
    expect(channel.pickers[0].picker.summary).toContain('Alpha (ws-A)');
    expect(channel.pickers[0].picker.fallbackText).toContain('Alpha (ws-A)');
    expect(channel.streams[0].done).toBe('workspace reply');
    expect(channel.events).toEqual(['done', 'picker']);
  });

  it('still lets an unbound direct chat use the global agent', async () => {
    const service = fakeService({
      chatWithScope: vi.fn(async () => ({ ok: true, response: 'global reply' })),
      newSessionForScope: vi.fn(async () => ({ ok: true })),
      getCurrentSessionIdForScope: vi.fn(() => 'global-session'),
    });
    const bridge = new ChannelBridge(service, memoryStore());
    await bridge.addChannel(channel);

    channel.handler!(msg('你好'));
    await flushInbound();

    expect(service.chatWithScope).toHaveBeenCalledWith(
      { kind: 'global' },
      '你好',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      undefined,
      expect.any(Function),
    );
    expect(channel.pickers).toHaveLength(0);
    expect(channel.streams[0].done).toBe('global reply');
  });

  it('aborts and releases a run when the agent produces no activity', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hangingRun = new Promise<AgentChatResult>(() => undefined);
    const chatWithScope = vi.fn(async () => {
      if (chatWithScope.mock.calls.length > 1) {
        return { ok: true, response: 'second reply' };
      }
      return hangingRun;
    });
    const abortScope = vi.fn();
    const service = fakeService({
      chatWithScope,
      abortScope,
      newSessionForScope: vi.fn(async () => ({ ok: true })),
      getCurrentSessionIdForScope: vi.fn(() => 'global-session'),
    });
    const bridge = new ChannelBridge(service, memoryStore(), { runIdleTimeoutMs: 50 });
    await bridge.addChannel(channel);

    try {
      channel.handler!(msg('first'));
      await vi.advanceTimersByTimeAsync(50);

      expect(abortScope).toHaveBeenCalledWith({ kind: 'global' });
      expect(channel.streams[0].errors[0]).toContain('No agent activity');

      channel.handler!(msg('second', { messageId: 'second' }));
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();

      expect(chatWithScope).toHaveBeenCalledTimes(2);
      expect(channel.streams[1].done).toBe('second reply');
    } finally {
      warnSpy.mockRestore();
    }
  });
});
