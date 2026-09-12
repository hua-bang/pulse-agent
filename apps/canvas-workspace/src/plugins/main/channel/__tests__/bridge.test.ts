import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentChatResult,
  AgentSessionInfo,
  AgentStatusInfo,
  CanvasAgentServiceRef,
  PluginStore,
} from '../../../types';
import type { CanvasAgent } from '../../../../main/agent/canvas-agent';
import { ConversationRuntimeService } from '../../../../main/agent/conversation-runtime/conversation-service';
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
    resolveWorkspace: vi.fn(async (ref: string) => workspaces.find(w => w.id === ref)?.id ?? null),
    resolveWorkspaceRef: vi.fn(async (ref: string) => workspaces.find(w => w.id === ref)?.id ?? null),
    workspaceLabel: label,
    workspaceLabelById: vi.fn(async (id: string) => {
      const found = workspaces.find(w => w.id === id);
      return found ? label(found) : id;
    }),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(assertion: () => void): Promise<void> {
  let error: unknown;
  for (let i = 0; i < 30; i += 1) {
    try {
      assertion();
      return;
    } catch (err) {
      error = err;
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  throw error;
}

function memoryStore(): PluginStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) { return map.get(key) as T | undefined; },
    async set<T>(key: string, value: T) { map.set(key, value); },
    async delete(key: string) { map.delete(key); },
    async list() { return Array.from(map.keys()); },
  };
}

function fakeService(overrides: Partial<CanvasAgentServiceRef> = {}): CanvasAgentServiceRef {
  return {
    chat: vi.fn(async (): Promise<AgentChatResult> => ({ ok: true, response: 'legacy' })),
    chatWithScope: vi.fn(async (): Promise<AgentChatResult> => ({ ok: true, response: 'legacy' })),
    abort: () => {},
    abortScope: () => {},
    answerClarification: () => false,
    answerClarificationForScope: () => false,
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
    copySessionToScope: async () => ({ ok: true, sessionId: 'legacy-copy', messageCount: 0 }),
    ...overrides,
  };
}

type AgentPlan = (ctx: {
  message: string;
  sessionId: string;
  signal: AbortSignal;
  clarify?: (req: { id: string; question: string }) => Promise<string> | void;
}) => Promise<{ response: string; stopped?: boolean }>;

function makeRuntime(plan: AgentPlan): ConversationRuntimeService {
  const sessions = new Map<string, unknown[]>();
  const agent = {
    chat: vi.fn(async (...args: unknown[]) => {
      const message = args[0] as string;
      const onClarification = args[5] as ((req: { id: string; question: string }) => Promise<string> | void) | undefined;
      const requestContext = args[6] as { expectedConversationSessionId?: string } | undefined;
      const onRoleTurnStart = args[11] as (() => void) | undefined;
      const signal = args[13] as AbortSignal;
      onRoleTurnStart?.();
      return plan({
        message,
        sessionId: requestContext?.expectedConversationSessionId ?? '',
        signal,
        clarify: onClarification,
      });
    }),
    stopRelay: vi.fn(() => false),
  } as unknown as CanvasAgent;
  const activeSessions = new Set<string>();
  return new ConversationRuntimeService(
    () => agent,
    () => ({
      loadMessages: async sessionId => sessions.get(sessionId) as never ?? null,
      persist: async (sessionId, messages) => { sessions.set(sessionId, [...messages]); },
    }),
    async (_scope, sessionId, operation) => {
      if (activeSessions.has(sessionId)) return null;
      activeSessions.add(sessionId);
      try {
        return await operation();
      } finally {
        activeSessions.delete(sessionId);
      }
    },
  );
}

let messageCounter = 0;
function msg(text: string, overrides: Partial<InboundMessage> = {}): InboundMessage {
  messageCounter += 1;
  return {
    channelId: 'feishu',
    conversationId: 'chatA',
    userId: 'u1',
    messageId: `m-${messageCounter}`,
    text,
    isMention: false,
    isDirect: true,
    reply: { chatId: 'chatA', isGroup: false, triggerMessageId: `m-${messageCounter}` },
    ...overrides,
  };
}

class FakeChannel implements Channel {
  readonly id = 'feishu';
  handler: InboundHandler | null = null;
  sentText: Array<{ target: OutboundTarget; text: string }> = [];
  pickers: Array<{ target: OutboundTarget; picker: WorkspacePicker }> = [];
  streams: FakeStream[] = [];

  isConfigured(): boolean { return true; }
  async start(onInbound: InboundHandler): Promise<void> { this.handler = onInbound; }
  async stop(): Promise<void> { this.handler = null; }
  async openStream(target: OutboundTarget): Promise<ChannelStream> {
    const stream = new FakeStream(target.conversationId, (target.reply as { triggerMessageId?: string } | null)?.triggerMessageId);
    this.streams.push(stream);
    return stream;
  }
  async sendText(target: OutboundTarget, text: string): Promise<void> {
    this.sentText.push({ target, text });
  }
  async sendWorkspacePicker(target: OutboundTarget, picker: WorkspacePicker): Promise<void> {
    this.pickers.push({ target, picker });
  }
}

class FakeStream implements ChannelStream {
  done: string | null = null;
  errors: string[] = [];
  text = '';
  clarification: string | null = null;
  constructor(readonly conversationId: string, readonly triggerMessageId?: string) {}
  onText(delta: string): void { this.text += delta; }
  onToolCall(): void {}
  onClarification(question: string): void { this.clarification = question; }
  onDone(text: string): void { this.done = text; }
  onError(message: string): void { this.errors.push(message); }
}

describe('ChannelBridge conversation isolation', () => {
  let channel: FakeChannel;

  beforeEach(() => {
    messageCounter = 0;
    channel = new FakeChannel();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs simultaneous first messages from two topics in one workspace independently', async () => {
    const started: Array<{ message: string; sessionId: string }> = [];
    const bothStarted = deferred<void>();
    const runtime = makeRuntime(async ({ message, sessionId }) => {
      started.push({ message, sessionId });
      if (started.length === 2) bothStarted.resolve();
      await bothStarted.promise;
      return { response: `reply:${message}` };
    });
    const service = fakeService();
    const bridge = new ChannelBridge(service, runtime, memoryStore());
    await bridge.addChannel(channel);

    channel.handler!(msg('topic-a', {
      conversationId: 'group:thread-a',
      isDirect: false,
      reply: { chatId: 'group', threadId: 'thread-a', isGroup: true, triggerMessageId: 'a' },
    }));
    channel.handler!(msg('topic-b', {
      conversationId: 'group:thread-b',
      isDirect: false,
      reply: { chatId: 'group', threadId: 'thread-b', isGroup: true, triggerMessageId: 'b' },
    }));

    await waitFor(() => expect(started).toHaveLength(2));
    expect(new Set(started.map(entry => entry.sessionId)).size).toBe(2);
    await waitFor(() => expect(channel.streams.every(stream => stream.done)).toBe(true));
    expect(service.chatWithScope).not.toHaveBeenCalled();
    expect(channel.sentText.some(entry => entry.text.includes('Still working'))).toBe(false);
  });

  it('queues same-topic messages FIFO without dropping them', async () => {
    const first = deferred<void>();
    const starts: string[] = [];
    const runtime = makeRuntime(async ({ message }) => {
      starts.push(message);
      if (message === 'first') await first.promise;
      return { response: `done:${message}` };
    });
    const bridge = new ChannelBridge(fakeService(), runtime, memoryStore());
    await bridge.addChannel(channel);

    channel.handler!(msg('first'));
    channel.handler!(msg('second'));
    await waitFor(() => expect(starts).toEqual(['first']));
    expect(channel.sentText).toHaveLength(0);

    first.resolve();
    await waitFor(() => expect(starts).toEqual(['first', 'second']));
    await waitFor(() => expect(['m-1', 'm-2'].map(id => channel.streams.find(stream => stream.triggerMessageId === id)?.done)).toEqual([
      'done:first',
      'done:second',
    ]));
  });

  it('resolves the next message scope after an earlier workspace switch commits', async () => {
    const runtime = makeRuntime(async () => ({ response: 'done' }));
    const chat = vi.spyOn(runtime, 'chat');
    const bridge = new ChannelBridge(fakeService(), runtime, memoryStore());
    await bridge.addChannel(channel);
    channel.handler!(msg('/use ws-B --fresh'));
    channel.handler!(msg('after-switch'));
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    expect(chat.mock.calls[0][0]).toEqual({ kind: 'workspace', workspaceId: 'ws-B' });
    await waitFor(() => expect(channel.streams[0]?.done).toBe('done'));
  });

  it('routes clarification answers only to the requesting topic', async () => {
    const starts: string[] = [];
    const runtime = makeRuntime(async ({ message, clarify }) => {
      starts.push(message);
      if (message === 'ask') {
        const answer = await clarify?.({ id: 'q-a', question: 'which one?' });
        return { response: `answer:${answer}` };
      }
      return { response: `reply:${message}` };
    });
    const bridge = new ChannelBridge(fakeService(), runtime, memoryStore());
    await bridge.addChannel(channel);

    channel.handler!(msg('ask', { conversationId: 'topic-a' }));
    await waitFor(() => expect(channel.streams[0]?.clarification).toBe('which one?'));
    channel.handler!(msg('not-the-answer', { conversationId: 'topic-b' }));
    await waitFor(() => expect(starts).toContain('not-the-answer'));
    expect(channel.streams[0].done).toBeNull();

    channel.handler!(msg('chosen', { conversationId: 'topic-a' }));
    await waitFor(() => expect(channel.streams[0].done).toBe('answer:chosen'));
    expect(starts).toEqual(['ask', 'not-the-answer']);
  });

  it('times out only the targeted topic while another topic continues', async () => {
    vi.useFakeTimers();
    const signals = new Map<string, AbortSignal>();
    const runtime = makeRuntime(async ({ message, signal }) => {
      signals.set(message, signal);
      if (message === 'slow-a') {
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
        return { response: '', stopped: true };
      }
      await new Promise(resolve => setTimeout(resolve, 40));
      return { response: 'topic-b-done' };
    });
    const bridge = new ChannelBridge(fakeService(), runtime, memoryStore(), { runIdleTimeoutMs: 50 });
    await bridge.addChannel(channel);

    channel.handler!(msg('slow-a', { conversationId: 'topic-a' }));
    channel.handler!(msg('slow-b', { conversationId: 'topic-b' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(signals.size).toBe(2);

    await vi.advanceTimersByTimeAsync(50);
    expect(signals.get('slow-a')?.aborted).toBe(true);
    expect(signals.get('slow-b')?.aborted).toBe(false);
    expect(channel.streams.find(stream => stream.conversationId === 'topic-b')?.done).toBe(
      'topic-b-done',
    );
  });

  it('continues the same-topic queue after a failed turn', async () => {
    const starts: string[] = [];
    const runtime = makeRuntime(async ({ message }) => {
      starts.push(message);
      if (message === 'fails') throw new Error('boom');
      return { response: 'recovered' };
    });
    const bridge = new ChannelBridge(fakeService(), runtime, memoryStore());
    await bridge.addChannel(channel);

    channel.handler!(msg('fails'));
    channel.handler!(msg('next'));

    await waitFor(() => expect(starts).toEqual(['fails', 'next']));
    await waitFor(() => expect(channel.streams.find(stream => stream.triggerMessageId === 'm-1')?.errors[0]).toContain('boom'));
    expect(channel.streams.find(stream => stream.triggerMessageId === 'm-2')?.done).toBe('recovered');
  });
});

describe('buildAgentPrompt', () => {
  const withImages = (text: string, imagePaths?: string[]): InboundMessage => ({
    channelId: 'feishu', conversationId: 'c1', userId: 'u1', messageId: 'm1',
    text, isMention: false, isDirect: true, reply: {}, imagePaths,
  });

  it('returns plain text without images', () => {
    expect(buildAgentPrompt(withImages('hello'))).toBe('hello');
  });

  it('appends local image paths and the image tool hint', () => {
    const prompt = buildAgentPrompt(withImages('what is this?', ['/tmp/a.png', '/tmp/b.jpg']));
    expect(prompt).toContain('what is this?');
    expect(prompt).toContain('image_analyze');
    expect(prompt).toContain('/tmp/a.png');
    expect(prompt).toContain('/tmp/b.jpg');
  });
});
