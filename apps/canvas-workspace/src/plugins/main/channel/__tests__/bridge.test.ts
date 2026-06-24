import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentChatResult,
  AgentSessionInfo,
  AgentStatusInfo,
  CanvasAgentServiceRef,
  PluginStore,
} from '../../../types';
import { buildAgentPrompt, ChannelBridge } from '../core/bridge';
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
  /** When set, a stream's onClarification rejects (simulates an undeliverable question). */
  failClarification = false;

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
    const stream = new FakeStream(this.events, this.failClarification);
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
  toolInputs: string[] = [];
  toolCalls: Array<{ name: string; args: unknown; toolCallId?: string }> = [];
  toolResults: Array<{ name: string; result: string; toolCallId?: string }> = [];

  constructor(
    private readonly events: string[],
    private readonly failClarification = false,
  ) {}

  onText(delta: string): void {
    this.text += delta;
  }

  onToolCall(name: string, args: unknown, toolCallId?: string): void {
    this.toolCalls.push({ name, args, toolCallId });
  }

  onToolResult(result: { name: string; result: string; toolCallId?: string }): void {
    this.toolResults.push(result);
  }

  onToolInputStart(data: { id: string; toolName: string }): void {
    this.toolInputs.push(`start:${data.id}:${data.toolName}`);
  }

  onToolInputDelta(data: { id: string; delta: string }): void {
    this.toolInputs.push(`delta:${data.id}:${data.delta}`);
  }

  onToolInputEnd(data: { id: string }): void {
    this.toolInputs.push(`end:${data.id}`);
  }

  async onClarification(): Promise<void> {
    if (this.failClarification) throw new Error('clarification send failed');
  }

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
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function),
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
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function),
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

  it('forwards tool input events and treats them as agent activity', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let onToolInputDelta: ((data: { id: string; delta: string }) => void) | undefined;
    const chatWithScope = vi.fn(
      async (
        _scope,
        _message,
        _onText,
        onToolCall,
        onToolResult,
        _mentioned,
        _onClarification,
        _requestContext,
        _attachments,
        onToolInputStart,
        onToolInputDeltaArg,
        onToolInputEnd,
      ): Promise<AgentChatResult> => {
        onToolInputDelta = onToolInputDeltaArg;
        onToolInputStart?.({ id: 'tool-1', toolName: 'visual_render' });
        onToolInputDeltaArg?.({ id: 'tool-1', delta: 'abc' });
        onToolInputEnd?.({ id: 'tool-1' });
        onToolCall?.({ name: 'visual_render', args: { title: 'Demo' }, toolCallId: 'tool-1' });
        onToolResult?.({ name: 'visual_render', result: 'ok', toolCallId: 'tool-1' });
        return new Promise<AgentChatResult>(() => undefined);
      },
    );
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
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();

      expect(channel.streams[0].toolInputs).toEqual([
        'start:tool-1:visual_render',
        'delta:tool-1:abc',
        'end:tool-1',
      ]);
      expect(channel.streams[0].toolCalls[0]).toEqual({
        name: 'visual_render',
        args: { title: 'Demo' },
        toolCallId: 'tool-1',
      });
      expect(channel.streams[0].toolResults[0]).toEqual({
        name: 'visual_render',
        result: 'ok',
        toolCallId: 'tool-1',
      });

      await vi.advanceTimersByTimeAsync(40);
      onToolInputDelta?.({ id: 'tool-1', delta: 'still-running' });
      await vi.advanceTimersByTimeAsync(49);
      expect(abortScope).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(abortScope).toHaveBeenCalledWith({ kind: 'global' });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not kill a run while a tool is executing past the idle budget', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A tool whose execute() blocks: onToolCall fires (args complete) but no
    // onToolResult — exactly the "single slow tool" case the idle watchdog used
    // to kill mid-run.
    const chatWithScope = vi.fn(
      async (_scope, _message, _onText, onToolCall): Promise<AgentChatResult> => {
        onToolCall?.({ name: 'page_wait_for', args: { nodeId: 'n1' }, toolCallId: 'tool-1' });
        return new Promise<AgentChatResult>(() => undefined);
      },
    );
    const abortScope = vi.fn();
    const service = fakeService({
      chatWithScope,
      abortScope,
      newSessionForScope: vi.fn(async () => ({ ok: true })),
      getCurrentSessionIdForScope: vi.fn(() => 'global-session'),
    });
    const bridge = new ChannelBridge(service, memoryStore(), {
      runIdleTimeoutMs: 50,
      toolExecTimeoutMs: 200,
    });
    await bridge.addChannel(channel);

    try {
      channel.handler!(msg('first'));
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();

      // Well past the idle budget, but the tool is still in flight — survive.
      await vi.advanceTimersByTimeAsync(199);
      expect(abortScope).not.toHaveBeenCalled();

      // Once the tool-exec ceiling elapses, recover the scope.
      await vi.advanceTimersByTimeAsync(1);
      expect(abortScope).toHaveBeenCalledWith({ kind: 'global' });
      expect(channel.streams[0].errors[0]).toContain('tool ran for');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('fails the run when a clarification question cannot be delivered', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    channel.failClarification = true;
    const chatWithScope = vi.fn(
      async (_scope, _message, _onText, _onToolCall, _onToolResult, _mentioned, onClarification): Promise<AgentChatResult> => {
        onClarification?.({ id: 'q1', question: 'which one?' });
        return new Promise<AgentChatResult>(() => undefined);
      },
    );
    const abortScope = vi.fn();
    const service = fakeService({
      chatWithScope,
      abortScope,
      newSessionForScope: vi.fn(async () => ({ ok: true })),
      getCurrentSessionIdForScope: vi.fn(() => 'global-session'),
    });
    const bridge = new ChannelBridge(service, memoryStore(), {
      runIdleTimeoutMs: 50,
      clarificationTimeoutMs: 10_000,
    });
    await bridge.addChannel(channel);

    try {
      channel.handler!(msg('first'));
      // Undeliverable question fails fast — no need to wait out any budget.
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();

      expect(abortScope).toHaveBeenCalledWith({ kind: 'global' });
      expect(channel.streams[0].errors[0]).toContain("can't be answered");
    } finally {
      warnSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('stops a run when a clarification goes unanswered past the budget', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const chatWithScope = vi.fn(
      async (_scope, _message, _onText, _onToolCall, _onToolResult, _mentioned, onClarification): Promise<AgentChatResult> => {
        onClarification?.({ id: 'q1', question: 'which one?' });
        return new Promise<AgentChatResult>(() => undefined);
      },
    );
    const abortScope = vi.fn();
    const service = fakeService({
      chatWithScope,
      abortScope,
      newSessionForScope: vi.fn(async () => ({ ok: true })),
      getCurrentSessionIdForScope: vi.fn(() => 'global-session'),
    });
    const bridge = new ChannelBridge(service, memoryStore(), {
      runIdleTimeoutMs: 50,
      clarificationTimeoutMs: 200,
    });
    await bridge.addChannel(channel);

    try {
      channel.handler!(msg('first'));
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();

      // Parked awaiting an answer — must survive well past the idle budget.
      await vi.advanceTimersByTimeAsync(199);
      expect(abortScope).not.toHaveBeenCalled();

      // Once the clarification budget elapses, recover the scope.
      await vi.advanceTimersByTimeAsync(1);
      expect(abortScope).toHaveBeenCalledWith({ kind: 'global' });
      expect(channel.streams[0].errors[0]).toContain('No answer to the question');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('buildAgentPrompt', () => {
  const withImages = (text: string, imagePaths?: string[]): InboundMessage => ({
    channelId: 'feishu',
    conversationId: 'c1',
    userId: 'u1',
    messageId: 'm1',
    text,
    isMention: false,
    isDirect: true,
    reply: {},
    imagePaths,
  });

  it('returns the plain text when there are no images', () => {
    expect(buildAgentPrompt(withImages('hello'))).toBe('hello');
    expect(buildAgentPrompt(withImages('hello', []))).toBe('hello');
  });

  it('appends an image note with the local paths and tool hint', () => {
    const prompt = buildAgentPrompt(withImages('what is this?', ['/tmp/a.png', '/tmp/b.jpg']));
    expect(prompt).toContain('what is this?');
    expect(prompt).toContain('canvas_analyze_image');
    expect(prompt).toContain('/tmp/a.png');
    expect(prompt).toContain('/tmp/b.jpg');
    expect(prompt).toContain('2 image(s)');
  });

  it('uses only the note for an image-only message', () => {
    const prompt = buildAgentPrompt(withImages('', ['/tmp/a.png']));
    expect(prompt.startsWith('[The user attached 1 image(s)')).toBe(true);
    expect(prompt).toContain('/tmp/a.png');
  });
});
